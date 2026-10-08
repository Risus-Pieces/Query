import { z } from "zod";
import { query } from "./db";
import { dedupeKey, normalizeUrl } from "./dedupe";
import type { Candidate, ItemDetails, Section } from "./types";

/** The parts of a research task that validation and persistence need. */
export interface TaskShape {
  id: string;
  section: Section;
  kinds: readonly string[];
  upcomingOnly: boolean;
}

/** Validation + persistence for findings, shared by the research script and CSV import. */

export const MIN_SCORE = 45;

// Kept deliberately loose (strings / nullable) so the structured-output schema stays simple;
// real validation happens in validateCandidates().
const RawFinding = z.object({
  kind: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  source: z.string().nullable(),
  summary: z.string(),
  why_relevant: z.string(),
  score: z.number(),
  tags: z.array(z.string()),
  event_date: z.string().nullable(),
  deadline: z.string().nullable(),
  location: z.string().nullable(),
  details: z.object({
    firm: z.string().nullable(),
    role: z.string().nullable(),
    rice_connection: z.string().nullable(),
    check_size: z.string().nullable(),
    contact_path: z.string().nullable(),
  }),
});
export const ExtractionSchema = z.object({ findings: z.array(RawFinding) });
export type RawFindingT = z.infer<typeof RawFinding>;

export const todayISO = () => new Date().toISOString().slice(0, 10);

function validDate(s: string | null | undefined): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** Drop anything unusable and normalise the rest. Pure — easy to test. */
export function validateCandidates(
  raw: RawFindingT[],
  task: Pick<TaskShape, "section" | "kinds" | "upcomingOnly">,
  today: string,
): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    const kind = f.kind.trim().toLowerCase();
    const title = f.title.trim();
    if (!title || !task.kinds.includes(kind)) continue;
    if (!f.url || !normalizeUrl(f.url)) continue;
    const score = Math.round(Math.min(100, Math.max(0, f.score)));
    if (score < MIN_SCORE) continue;

    const event_date = validDate(f.event_date);
    const deadline = validDate(f.deadline);
    if (task.upcomingOnly) {
      // Past events are noise. If only a deadline is known, it must still be ahead of us.
      const anchor = event_date ?? deadline;
      if (anchor && anchor < today) continue;
    }

    const details: ItemDetails = {
      firm: clean(f.details.firm),
      role: clean(f.details.role),
      rice_connection: clean(f.details.rice_connection),
      check_size: clean(f.details.check_size),
      contact_path: clean(f.details.contact_path),
    };
    const tags = [...new Set(f.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
    if (details.rice_connection && !tags.includes("rice")) tags.push("rice");

    // Within one run, collapse duplicates (same person / same URL).
    const runKey = dedupeKey({
      section: task.section,
      kind,
      title,
      url: f.url,
      event_date,
      firm: details.firm,
    });
    if (seen.has(runKey)) continue;
    seen.add(runKey);

    out.push({
      kind,
      title,
      url: f.url.trim(),
      source: clean(f.source),
      summary: f.summary.trim(),
      why_relevant: f.why_relevant.trim(),
      score,
      tags,
      details,
      event_date,
      deadline,
      location: clean(f.location),
    });
  }
  return out;
}

export interface PersistResult {
  inserted: number;
  updated: number;
}

/** Insert new findings; refresh last_seen (and content) for ones we already had — never touch status/notes. */
export async function persistCandidates(
  task: Pick<TaskShape, "id" | "section">,
  candidates: Candidate[],
): Promise<PersistResult> {
  let inserted = 0;
  let updated = 0;
  for (const c of candidates) {
    const key = dedupeKey({
      section: task.section,
      kind: c.kind,
      title: c.title,
      url: c.url,
      event_date: c.event_date,
      firm: c.details.firm,
    });
    const rows = await query<{ inserted: boolean }>(
      `insert into items
         (section, kind, title, url, source, summary, why_relevant, score, tags, details,
          event_date, deadline, location, dedupe_key, task_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (dedupe_key) do update set
         last_seen = now(),
         summary = excluded.summary,
         why_relevant = excluded.why_relevant,
         score = excluded.score,
         tags = excluded.tags,
         details = items.details || excluded.details,
         event_date = coalesce(excluded.event_date, items.event_date),
         deadline = coalesce(excluded.deadline, items.deadline),
         location = coalesce(excluded.location, items.location)
       returning (xmax = 0) as inserted`,
      [
        task.section,
        c.kind,
        c.title,
        c.url,
        c.source ?? null,
        c.summary,
        c.why_relevant,
        c.score,
        c.tags,
        JSON.stringify(stripNulls(c.details)),
        c.event_date ?? null,
        c.deadline ?? null,
        c.location ?? null,
        key,
        task.id,
      ],
    );
    if (rows[0]?.inserted) inserted++;
    else updated++;
  }
  return { inserted, updated };
}

function stripNulls<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as Partial<T>;
}

/** Titles we already have for this section, newest first — so the agent hunts for NEW things. */
export async function knownTitles(section: string): Promise<string[]> {
  const rows = await query<{ title: string }>(
    `select title from items where section = $1 order by first_seen desc limit 150`,
    [section],
  );
  return rows.map((r) => r.title);
}
