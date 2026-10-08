import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { query } from "./db";
import {
  ExtractionSchema,
  knownTitles,
  persistCandidates,
  todayISO,
  validateCandidates,
  type PersistResult,
  type RawFindingT,
} from "./ingest";
import {
  SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildResearchPrompt,
  type ResearchTask,
} from "./briefs";

export const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_CONTINUATIONS = 6;
export interface Settings {
  model: string;
  homeBase: string;
  maxSearchesCap: number | null;
}

export function settingsFromEnv(env = process.env): Settings {
  const cap = env.RESEARCH_MAX_SEARCHES ? Number(env.RESEARCH_MAX_SEARCHES) : null;
  return {
    model: env.RESEARCH_MODEL || DEFAULT_MODEL,
    homeBase: env.HOME_BASE || "Houston, TX",
    maxSearchesCap: cap && Number.isFinite(cap) && cap > 0 ? cap : null,
  };
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function assertNotRefused(message: Anthropic.Message, stage: string) {
  if (message.stop_reason === "refusal") {
    const cat = message.stop_details?.category ?? "unknown";
    throw new Error(`Model declined the ${stage} request (category: ${cat})`);
  }
}

/** Phase 1: web research. Returns free-form notes. Resumes server-side tool turns that pause. */
export async function research(
  client: Anthropic,
  task: ResearchTask,
  settings: Settings,
  known: string[],
  today = todayISO(),
): Promise<string> {
  const maxUses = settings.maxSearchesCap
    ? Math.min(task.maxSearches, settings.maxSearchesCap)
    : task.maxSearches;
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: buildResearchPrompt(
        { ...task, maxSearches: maxUses },
        { today, homeBase: settings.homeBase, known },
      ),
    },
  ];

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const stream = client.messages.stream({
      model: settings.model,
      max_tokens: 32000,
      system: SYSTEM_PROMPT,
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses }],
      messages,
    });
    const message = await stream.finalMessage();
    assertNotRefused(message, "research");
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const notes = textOf(message.content);
    if (!notes) throw new Error("Research returned no text");
    return notes;
  }
  throw new Error("Research did not finish within the continuation limit");
}

/** Phase 2: turn notes into schema-valid findings. */
export async function extract(
  client: Anthropic,
  task: ResearchTask,
  settings: Settings,
  notes: string,
  today = todayISO(),
): Promise<RawFindingT[]> {
  const message = await client.messages.parse({
    model: settings.model,
    max_tokens: 32000,
    output_config: { effort: "low", format: zodOutputFormat(ExtractionSchema) },
    messages: [{ role: "user", content: buildExtractionPrompt(task, notes, today) }],
  });
  assertNotRefused(message, "extraction");
  if (!message.parsed_output) throw new Error("Extraction returned no parsable output");
  return message.parsed_output.findings;
}

export interface TaskResult {
  taskId: string;
  found: number;
  inserted: number;
  updated: number;
  error?: string;
}

/** Run one task end to end and record it in `runs`. Never throws: failures are recorded and returned. */
export async function runTask(
  client: Anthropic,
  task: ResearchTask,
  settings: Settings,
  opts: { dryRun?: boolean; log?: (m: string) => void } = {},
): Promise<TaskResult> {
  const log = opts.log ?? (() => {});
  const today = todayISO();
  const runRows = opts.dryRun
    ? []
    : await query<{ id: number }>(`insert into runs (task_id, section) values ($1,$2) returning id`, [
        task.id,
        task.section,
      ]);
  const runId = runRows[0]?.id;

  try {
    const known = opts.dryRun ? [] : await knownTitles(task.section);
    log(`[${task.id}] researching (known: ${known.length})…`);
    const notes = await research(client, task, settings, known, today);
    log(`[${task.id}] extracting…`);
    const raw = await extract(client, task, settings, notes, today);
    const candidates = validateCandidates(raw, task, today);
    log(`[${task.id}] ${raw.length} raw → ${candidates.length} valid`);

    let result: PersistResult = { inserted: 0, updated: 0 };
    if (opts.dryRun) {
      for (const c of candidates) log(`  • (${c.score}) [${c.kind}] ${c.title} — ${c.url}`);
    } else {
      result = await persistCandidates(task, candidates);
    }
    if (runId) {
      await query(`update runs set finished_at = now(), found = $2, inserted = $3 where id = $1`, [
        runId,
        candidates.length,
        result.inserted,
      ]);
    }
    return { taskId: task.id, found: candidates.length, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await query(`update runs set finished_at = now(), error = $2 where id = $1`, [runId, message]);
    }
    return { taskId: task.id, found: 0, inserted: 0, updated: 0, error: message };
  }
}

export { ExtractionSchema, knownTitles, persistCandidates, todayISO, validateCandidates };
export type { PersistResult, RawFindingT };
