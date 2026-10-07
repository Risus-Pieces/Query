import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, query } from "@/lib/db";
import { TASKS } from "@/lib/briefs";
import {
  extract,
  persistCandidates,
  research,
  runTask,
  validateCandidates,
  type RawFindingT,
  type Settings,
} from "@/lib/research";
import { hasDb, resetDb } from "./helpers";

const TODAY = "2026-10-07";
const settings: Settings = { model: "test-model", homeBase: "Houston, TX", maxSearchesCap: null };
const angelsTask = TASKS.find((t) => t.id === "sooz-angels-rice")!;
const eventsTask = TASKS.find((t) => t.id === "sooz-events-cpg")!;

const noDetails = { firm: null, role: null, rice_connection: null, check_size: null, contact_path: null };
const raw = (o: Partial<RawFindingT>): RawFindingT => ({
  kind: "event",
  title: "Thing",
  url: "https://example.com/thing",
  source: null,
  summary: "s",
  why_relevant: "w",
  score: 70,
  tags: [],
  event_date: null,
  deadline: null,
  location: null,
  details: noDetails,
  ...o,
});

describe("validateCandidates", () => {
  it("drops unusable findings and keeps good ones", () => {
    const out = validateCandidates(
      [
        raw({ title: "Good", event_date: "2026-11-01" }),
        raw({ title: "Past", url: "https://example.com/past", event_date: "2026-01-01" }),
        raw({ title: "Past deadline only", url: "https://example.com/pd", deadline: "2026-09-01" }),
        raw({ title: "No url", url: null }),
        raw({ title: "Bad url", url: "javascript:alert(1)" }),
        raw({ title: "Low", url: "https://example.com/low", score: 30 }),
        raw({ title: "Wrong kind", url: "https://example.com/wk", kind: "angel" }),
        raw({ title: "Bad date", url: "https://example.com/bd", event_date: "2026-13-45" }),
      ],
      eventsTask,
      TODAY,
    );
    expect(out.map((c) => c.title)).toEqual(["Good", "Bad date"]);
    expect(out[1].event_date).toBeNull(); // invalid date is nulled, finding kept
  });

  it("clamps scores, trims, lowercases and dedupes tags, and adds the rice tag", () => {
    const [c] = validateCandidates(
      [
        raw({
          kind: "angel",
          title: "  Jane Doe ",
          score: 250,
          tags: ["Houston", "houston", " ", "Food-Bev"],
          details: { ...noDetails, firm: " Acme ", rice_connection: "MBA '09" },
        }),
      ],
      angelsTask,
      TODAY,
    );
    expect(c.title).toBe("Jane Doe");
    expect(c.score).toBe(100);
    expect(c.tags).toEqual(["houston", "food-bev", "rice"]);
    expect(c.details.firm).toBe("Acme");
    expect(c.details.role).toBeNull();
  });

  it("collapses the same person found on two pages", () => {
    const out = validateCandidates(
      [
        raw({ kind: "angel", title: "Jane Doe", url: "https://a.com/1", details: { ...noDetails, firm: "Acme" } }),
        raw({ kind: "angel", title: "jane doe", url: "https://b.com/2", details: { ...noDetails, firm: "ACME" } }),
      ],
      angelsTask,
      TODAY,
    );
    expect(out).toHaveLength(1);
  });

  it("does not drop undated people/resources as 'past'", () => {
    const out = validateCandidates([raw({ kind: "angel", title: "P" })], { ...angelsTask, upcomingOnly: true }, TODAY);
    expect(out).toHaveLength(1);
  });
});

// --- fake Anthropic client ---------------------------------------------------------------------
function msg(partial: Partial<Anthropic.Message>): Anthropic.Message {
  return { content: [], stop_reason: "end_turn", stop_details: null, ...partial } as Anthropic.Message;
}
const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.TextBlock;

function fakeClient(opts: { streams?: Anthropic.Message[]; parsed?: unknown; parseMsg?: Partial<Anthropic.Message> }) {
  const calls: { stream: any[]; parse: any[] } = { stream: [], parse: [] };
  const queue = [...(opts.streams ?? [])];
  const client = {
    messages: {
      stream: (params: any) => {
        calls.stream.push(JSON.parse(JSON.stringify(params)));
        return { finalMessage: async () => queue.shift()! };
      },
      parse: async (params: any) => {
        calls.parse.push(params);
        return { ...msg({}), ...opts.parseMsg, parsed_output: opts.parsed };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe("research()", () => {
  it("resumes pause_turn by echoing the paused assistant turn, then returns the final notes", async () => {
    const paused = msg({ stop_reason: "pause_turn", content: [text("searching…")] });
    const done = msg({ content: [text("NOTES: finding one")] });
    const { client, calls } = fakeClient({ streams: [paused, done] });
    const notes = await research(client, eventsTask, settings, ["Known Thing"], TODAY);
    expect(notes).toBe("NOTES: finding one");
    expect(calls.stream).toHaveLength(2);
    const second = calls.stream[1].messages;
    expect(second).toHaveLength(2);
    expect(second[1].role).toBe("assistant");
    // First request: web search tool, model, and the known title is in the prompt
    expect(calls.stream[0].tools[0]).toMatchObject({ type: "web_search_20260209", name: "web_search" });
    expect(calls.stream[0].model).toBe("test-model");
    expect(calls.stream[0].messages[0].content).toContain("Known Thing");
    expect(calls.stream[0].messages[0].content).toContain(TODAY);
  });

  it("honours the RESEARCH_MAX_SEARCHES cap", async () => {
    const { client, calls } = fakeClient({ streams: [msg({ content: [text("n")] })] });
    await research(client, eventsTask, { ...settings, maxSearchesCap: 3 }, [], TODAY);
    expect(calls.stream[0].tools[0].max_uses).toBe(3);
  });

  it("surfaces refusals as errors", async () => {
    const refused = msg({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } as any });
    const { client } = fakeClient({ streams: [refused] });
    await expect(research(client, eventsTask, settings, [], TODAY)).rejects.toThrow(/declined.*cyber/);
  });

  it("gives up if the turn never finishes", async () => {
    const paused = msg({ stop_reason: "pause_turn", content: [text("…")] });
    const { client } = fakeClient({ streams: Array.from({ length: 20 }, () => paused) });
    await expect(research(client, eventsTask, settings, [], TODAY)).rejects.toThrow(/continuation limit/);
  });

  it("errors on empty output", async () => {
    const { client } = fakeClient({ streams: [msg({ content: [] })] });
    await expect(research(client, eventsTask, settings, [], TODAY)).rejects.toThrow(/no text/);
  });
});

describe("extract()", () => {
  it("returns parsed findings and requests a json schema", async () => {
    const { client, calls } = fakeClient({ parsed: { findings: [raw({ title: "A" })] } });
    const out = await extract(client, eventsTask, settings, "notes", TODAY);
    expect(out).toHaveLength(1);
    expect(calls.parse[0].output_config.format).toBeTruthy();
  });
  it("errors when nothing parsed", async () => {
    const { client } = fakeClient({ parsed: null });
    await expect(extract(client, eventsTask, settings, "notes", TODAY)).rejects.toThrow(/parsable/);
  });
});

describe.skipIf(!hasDb)("persistence (postgres)", () => {
  beforeEach(resetDb);
  afterAll(closePool);

  const cand = (o = {}) => ({
    kind: "event",
    title: "Expo",
    url: "https://example.com/expo?utm_source=a",
    summary: "v1",
    why_relevant: "w",
    score: 70,
    tags: ["a"],
    details: {},
    event_date: "2026-12-01",
    ...o,
  });

  it("inserts, then refreshes without resetting the user's status or notes", async () => {
    const task = { id: "t", section: "sooz" as const };
    expect(await persistCandidates(task, [cand()])).toEqual({ inserted: 1, updated: 0 });
    await query(`update items set status = 'saved', notes = 'mine'`);

    const again = await persistCandidates(task, [cand({ summary: "v2", url: "https://www.example.com/expo/", score: 90 })]);
    expect(again).toEqual({ inserted: 0, updated: 1 });
    const [row] = await query<any>(`select status, notes, summary, score, event_date from items`);
    expect(row).toMatchObject({ status: "saved", notes: "mine", summary: "v2", score: 90, event_date: "2026-12-01" });
    expect((await query(`select 1 from items`)).length).toBe(1);
  });

  it("keeps a known date if a later run omits it", async () => {
    const task = { id: "t", section: "sooz" as const };
    await persistCandidates(task, [cand()]);
    await persistCandidates(task, [cand({ event_date: null })]);
    const [row] = await query<any>(`select event_date from items`);
    expect(row.event_date).toBe("2026-12-01");
  });

  it("stores angel details as jsonb without nulls", async () => {
    await persistCandidates({ id: "t", section: "sooz" }, [
      cand({
        kind: "angel",
        title: "Jane Doe",
        url: "https://a.com/jane",
        event_date: null,
        details: { firm: "Acme", role: null, rice_connection: "MBA '09" },
      }),
    ]);
    const [row] = await query<any>(`select details from items`);
    expect(row.details).toEqual({ firm: "Acme", rice_connection: "MBA '09" });
  });

  it("runTask records a run, persists, and passes known titles on the next run", async () => {
    const raws = [raw({ title: "Expo", event_date: "2099-01-01" })];
    const mk = () =>
      fakeClient({ streams: [msg({ content: [text("notes")] })], parsed: { findings: raws } });
    const a = mk();
    const r1 = await runTask(a.client, eventsTask, settings);
    expect(r1).toMatchObject({ found: 1, inserted: 1, updated: 0 });
    const b = mk();
    const r2 = await runTask(b.client, eventsTask, settings);
    expect(r2).toMatchObject({ found: 1, inserted: 0, updated: 1 });
    expect(b.calls.stream[0].messages[0].content).toContain("- Expo");
    const runs = await query<any>(`select found, inserted, error from runs order by id`);
    expect(runs).toEqual([
      { found: 1, inserted: 1, error: null },
      { found: 1, inserted: 0, error: null },
    ]);
  });

  it("runTask records failures instead of throwing", async () => {
    const { client } = fakeClient({ streams: [msg({ content: [] })] });
    const r = await runTask(client, eventsTask, settings);
    expect(r.error).toMatch(/no text/);
    const [run] = await query<any>(`select error, finished_at from runs`);
    expect(run.error).toMatch(/no text/);
    expect(run.finished_at).toBeTruthy();
  });

  it("dry run writes nothing", async () => {
    const { client } = fakeClient({
      streams: [msg({ content: [text("notes")] })],
      parsed: { findings: [raw({ event_date: "2099-01-01" })] },
    });
    const r = await runTask(client, eventsTask, settings, { dryRun: true });
    expect(r.found).toBe(1);
    expect((await query(`select 1 from items`)).length).toBe(0);
    expect((await query(`select 1 from runs`)).length).toBe(0);
  });
});
