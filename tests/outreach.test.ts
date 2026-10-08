import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool, query } from "@/lib/db";
import { importProspects, parseProspectCsv } from "@/lib/import";
import { ensureSchema } from "@/lib/migrate";
import {
  addToPipeline,
  bucket,
  companyKey,
  getProspect,
  gmailComposeUrl,
  importConnections,
  listProspects,
  missingPitch,
  outreachActionCount,
  parseCsv,
  parseLinkedInConnections,
  saveEdits,
  savePitch,
  templateDrafts,
  transition,
  warmMatches,
  type Prospect,
} from "@/lib/outreach";
import { SCHEMA_SQL } from "@/lib/schema-sql";
import { hasDb, resetDb } from "./helpers";

const pitch = {
  "pitch.company": "Sooz Beverage",
  "pitch.one_liner": "A better-for-you sparkling drink.",
  "pitch.sender_name": "Alex Founder",
  "pitch.sender_title": "Co-founder",
  "pitch.website": "drinksooz.com",
};
const angel = (o: Partial<Prospect> = {}) =>
  ({ name: "Jane Q Doe", details: { firm: "Acme Ventures", role: "Partner" }, why_relevant: "", warm_path: null, ...o }) as Prospect;

describe("templateDrafts", () => {
  it("uses only given facts and the angel's sourced details", () => {
    const d = templateDrafts(angel(), pitch);
    expect(d.body).toContain("Hi Jane,");
    expect(d.body).toContain("Partner at Acme Ventures");
    expect(d.body).toContain("Sooz Beverage. A better-for-you sparkling drink.");
    expect(d.body).not.toMatch(/raising|round|\$/i); // no raise given → no raise mentioned
    expect(d.body).not.toContain("Rice");
    expect(d.body).not.toMatch(/\n{3,}/);
    expect(d.intro_request).toBeNull(); // no warm path → no intro request
  });
  it("adds the fellow-Owl angle only when both sides have a Rice connection", () => {
    const d = templateDrafts(angel({ details: { firm: "Acme", rice_connection: "MBA '09" } }), { ...pitch, "pitch.rice_affiliation": "Rice '25" });
    expect(d.subject).toBe("Fellow Owl building Sooz Beverage");
    expect(d.body).toContain("fellow Rice alum (Rice '25)");
    expect(d.linkedin_note).toContain("fellow Owl");
    const one = templateDrafts(angel({ details: { firm: "Acme", rice_connection: "MBA '09" } }), pitch);
    expect(one.subject).not.toContain("Owl");
  });
  it("mentions the raise and traction only when provided", () => {
    const d = templateDrafts(angel(), { ...pitch, "pitch.raise": "$500k pre-seed", "pitch.traction": "In 40 H-E-B stores." });
    expect(d.body).toContain("ahead of our $500k pre-seed");
    expect(d.body).toContain("In 40 H-E-B stores.");
  });
  it("leaves visible placeholders when pitch facts are missing", () => {
    const d = templateDrafts(angel(), {});
    expect(d.body).toContain("[Company]");
    expect(missingPitch({})).toEqual(["Company", "One-liner", "Sender name"]);
  });
  it("keeps LinkedIn notes within 300 characters and writes an intro request when a warm path exists", () => {
    const d = templateDrafts(angel({ warm_path: "Sam at Acme" }), { ...pitch, "pitch.one_liner": "x".repeat(400) });
    expect(d.linkedin_note.length).toBeLessThanOrEqual(300);
    expect(d.intro_request).toContain("introducing me to Jane Q Doe (Acme Ventures)");
  });
});

describe("helpers", () => {
  it("builds a Gmail compose link without sending anything", () => {
    const u = new URL(gmailComposeUrl({ to: "a@b.co", subject: "Hi & bye", body: "Line 1\nLine 2", from: "me@x.co" }));
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/");
    expect(u.searchParams.get("view")).toBe("cm");
    expect(u.searchParams.get("su")).toBe("Hi & bye");
    expect(u.searchParams.get("body")).toBe("Line 1\nLine 2");
    expect(u.searchParams.get("authuser")).toBe("me@x.co");
  });
  it("parses quoted CSV", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\r\n\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
  });
  it("parses a LinkedIn Connections.csv with its preamble", () => {
    const csv = [
      "Notes:",
      '"When exporting your connection data, you may notice that some of the email addresses are missing."',
      "",
      "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
      "Sam,Lee,https://www.linkedin.com/in/samlee,,Acme Ventures LLC,Principal,05 Mar 2024",
      'Ana,"Diaz, PhD",https://www.linkedin.com/in/ana,ana@x.co,"Rice Alliance",Director,17 Oct 2022',
      ",,,,,,",
    ].join("\n");
    const c = parseLinkedInConnections(csv);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ full_name: "Sam Lee", company: "Acme Ventures LLC", connected_on: "2024-03-05", email: null });
    expect(c[1]).toMatchObject({ full_name: "Ana Diaz, PhD", email: "ana@x.co", connected_on: "2022-10-17" });
    expect(parseLinkedInConnections("name,company\nx,y")).toEqual([]);
  });
  it("normalizes company names for matching", () => {
    expect(companyKey("Acme Ventures, LLC")).toBe("acme ventures");
    expect(companyKey("The Acme Co.")).toBe("acme");
    expect(companyKey("")).toBeNull();
  });
  it("maps prospect CSV columns and aliases", () => {
    const { rows, extras } = parseProspectCsv("Full Name,Company,Title,Source URL,Fit,LinkedIn\nJane Doe,Acme,Partner,https://a.com/j,82,https://www.linkedin.com/in/jane\n");
    expect(rows[0]).toMatchObject({ kind: "angel", title: "Jane Doe", url: "https://a.com/j", score: 82, details: { firm: "Acme", role: "Partner" } });
    expect(extras[0].linkedin_url).toBe("https://www.linkedin.com/in/jane");
  });
  it("buckets prospects by what needs doing", () => {
    const p = (stage: Prospect["stage"], o: Partial<Prospect> = {}) => ({ stage, touches: 0, next_followup_at: null, ...o }) as Prospect;
    const b = bucket(
      [p("prospect"), p("drafted"), p("sent", { next_followup_at: "2026-10-01", touches: 1 }), p("sent", { next_followup_at: "2026-12-01", touches: 1 }),
       p("sent", { next_followup_at: "2026-10-01", touches: 3 }), p("replied"), p("passed")],
      "2026-10-08",
    );
    expect([b.prospects, b.drafts, b.due, b.waiting, b.live, b.closed].map((x) => x.length)).toEqual([1, 1, 1, 2, 1, 1]);
  });
  it("embeds the current db/schema.sql (run `npm run gen:schema` if this fails)", () => {
    expect(SCHEMA_SQL).toBe(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  });
});

describe.skipIf(!hasDb)("outreach pipeline (postgres)", () => {
  beforeEach(resetDb);
  afterAll(closePool);

  const insertItem = (title: string, o: { kind?: string; score?: number; status?: string; firm?: string; rice?: string } = {}) =>
    query<{ id: number }>(
      `insert into items (section, kind, title, url, score, status, details, dedupe_key)
       values ('sooz', $1, $2, 'https://x.com/'||$3, $4, $5, $6::jsonb, $3) returning id`,
      [o.kind ?? "angel", title, title.toLowerCase().replace(/\W+/g, "-"), o.score ?? 80, o.status ?? "new",
       JSON.stringify({ firm: o.firm ?? "Acme Ventures", role: "Partner", ...(o.rice ? { rice_connection: o.rice } : {}) })],
    ).then((r) => r[0].id);

  it("only angels enter the pipeline, idempotently", async () => {
    const a = await insertItem("Jane Doe");
    const e = await insertItem("Some Expo", { kind: "event" });
    expect(await addToPipeline(a)).toBe(true);
    expect(await addToPipeline(a)).toBe(true);
    expect(await addToPipeline(e)).toBe(false);
    expect((await query(`select 1 from outreach`)).length).toBe(1);
  });

  it("validates edits and moves to drafted when a body is written", async () => {
    const a = await insertItem("Jane Doe");
    await addToPipeline(a);
    expect(await saveEdits(a, { email: "not-an-email" })).toMatchObject({ ok: false });
    expect(await saveEdits(a, { linkedin_url: "https://evil.com/in/x" })).toMatchObject({ ok: false });
    expect(await saveEdits(a, { email: "Jane@Acme.vc", linkedin_url: "https://www.linkedin.com/in/jane", subject: "Hi", body: "Hello" })).toEqual({ ok: true });
    const p = await getProspect(a);
    expect(p).toMatchObject({ stage: "drafted", email: "jane@acme.vc", email_source: "manual", drafted_by: "you" });
  });

  it("schedules follow-ups and stops after three touches", async () => {
    const a = await insertItem("Jane Doe");
    await addToPipeline(a);
    await saveEdits(a, { body: "Hello" });
    const t0 = new Date("2026-10-08T15:00:00Z");
    await transition(a, "mark_sent", t0);
    expect(await getProspect(a)).toMatchObject({ stage: "sent", touches: 1, next_followup_at: "2026-10-13" });
    expect(await outreachActionCount("2026-10-12")).toBe(0);
    expect(await outreachActionCount("2026-10-13")).toBe(1);
    await transition(a, "followup_sent", new Date("2026-10-13T15:00:00Z"));
    expect(await getProspect(a)).toMatchObject({ touches: 2, next_followup_at: "2026-10-20" });
    await transition(a, "followup_sent", new Date("2026-10-20T15:00:00Z"));
    expect(await getProspect(a)).toMatchObject({ touches: 3, next_followup_at: null });
    await transition(a, "replied");
    expect((await getProspect(a))!.stage).toBe("replied");
    const events = await query<{ kind: string }>(`select kind from outreach_events where item_id = $1 order by id`, [a]);
    expect(events.map((e) => e.kind)).toEqual(["added", "edited", "mark_sent", "followup_sent", "followup_sent", "replied"]);
  });

  it("ignores out-of-order transitions", async () => {
    const a = await insertItem("Jane Doe");
    await addToPipeline(a);
    await transition(a, "followup_sent");
    expect((await getProspect(a))!.touches).toBe(0);
  });

  it("finds warm paths from imported connections", async () => {
    const a = await insertItem("Jane Doe", { firm: "Acme Ventures, LLC" });
    const b = await insertItem("Ola Smith", { firm: "Other Fund" });
    await importConnections([
      { full_name: "Sam Lee", company: "Acme Ventures", position: "Principal", linkedin_url: "https://www.linkedin.com/in/sam", email: null, connected_on: null },
      { full_name: "Ola Smith", company: "Other Fund", position: "Partner", linkedin_url: "https://www.linkedin.com/in/ola", email: null, connected_on: null },
      { full_name: "Sam Lee", company: "Acme Ventures", position: "Partner", linkedin_url: "https://www.linkedin.com/in/sam/", email: null, connected_on: null },
    ]);
    expect((await query(`select 1 from network`)).length).toBe(2); // same LinkedIn URL → one row
    const m = await warmMatches([a, b]);
    expect(m.get(a)?.map((x) => [x.full_name, x.kind])).toEqual([["Sam Lee", "same_company"]]);
    expect(m.get(b)?.[0]).toMatchObject({ full_name: "Ola Smith", kind: "same_person" });
  });

  it("matches warm paths against every firm in a multi-firm field", async () => {
    const a = await insertItem("Jane Doe", { firm: "The Angel Group; Supernatural Ventures" });
    await importConnections([
      { full_name: "Sam Lee", company: "Supernatural Ventures", position: "Associate", linkedin_url: null, email: null, connected_on: null },
      { full_name: "Kim Ng", company: "Co", position: "Founder", linkedin_url: null, email: null, connected_on: null },
    ]);
    const m = await warmMatches([a]);
    expect(m.get(a)?.map((x) => x.full_name)).toEqual(["Sam Lee"]);
  });

  it("imports a prospect CSV through research validation and queues it", async () => {
    const csv = [
      "name,firm,role,rice_connection,summary,url,score,email,linkedin_url",
      "Jane Doe,Acme,Partner,MBA '09,Backed two beverage brands,https://a.com/jane,85,jane@acme.vc,https://www.linkedin.com/in/jane",
      "No Source,Acme,Partner,,,,80,,",
      "Low Fit,Acme,Partner,,x,https://a.com/low,20,,",
    ].join("\n");
    const r = await importProspects(csv, "2026-10-08");
    expect(r).toMatchObject({ received: 3, valid: 1, inserted: 1, queued: 1 });
    const [p] = await listProspects();
    expect(p).toMatchObject({ name: "Jane Doe", email: "jane@acme.vc", linkedin_url: "https://www.linkedin.com/in/jane" });
    expect(p.tags).toContain("rice");
  });

  describe("routine functions", () => {
    const one = async (sql: string, params: unknown[] = []) => (await query<any>(sql, params))[0];

    it("queues high-fit, non-dismissed angels and hands the drafter everything it needs", async () => {
      await insertItem("Jane Doe", { score: 90 });
      await insertItem("Low Fit", { score: 50 });
      await insertItem("Dismissed", { score: 95, status: "dismissed" });
      await insertItem("An Event", { kind: "event", score: 95 });
      await savePitch(pitch);
      await importConnections([{ full_name: "Sam Lee", company: "Acme Ventures", position: "Principal", linkedin_url: null, email: null, connected_on: null }]);
      expect((await one(`select oq_outreach_queue(70) as n`)).n).toBe(1);
      expect((await one(`select oq_outreach_queue(70) as n`)).n).toBe(0);
      const todo = (await one(`select oq_outreach_todo(10) as t`)).t;
      expect(todo.pitch["pitch.company"]).toBe("Sooz Beverage");
      expect(todo.prospects).toHaveLength(1);
      expect(todo.prospects[0]).toMatchObject({ name: "Jane Doe", network_matches: [{ name: "Sam Lee" }] });
    });

    it("hands out one person per firm, and skips firms with a live thread", async () => {
      await insertItem("Ann Top", { score: 90, firm: "The Angel Group; Supernatural Ventures" });
      await insertItem("Ben Next", { score: 85, firm: "The Angel Group" });
      await insertItem("Cat Solo", { score: 70, firm: "Solo Fund" });
      await insertItem("Dan Nofirm", { score: 60, firm: "" });
      await insertItem("Eve Nofirm", { score: 55, firm: "" });
      await query(`select oq_outreach_queue(50)`);
      const names = async () => (await one(`select oq_outreach_todo(10) as t`)).t.prospects.map((p: { name: string }) => p.name);
      expect(await names()).toEqual(["Ann Top", "Cat Solo", "Dan Nofirm", "Eve Nofirm"]);
      const ann = (await query<{ id: number }>(`select id from items where title = 'Ann Top'`))[0].id;
      await query(`select oq_outreach_save($1, '{"body":"Hi Ann"}'::jsonb)`, [ann]);
      expect(await names()).toEqual(["Cat Solo", "Dan Nofirm", "Eve Nofirm"]); // Ben waits while Ann's thread is live
      await transition(ann, "close");
      expect(await names()).toEqual(["Ben Next", "Cat Solo", "Dan Nofirm", "Eve Nofirm"]);
      expect((await one(`select oq_outreach_todo(1) as t`)).t.prospects).toHaveLength(1);
    });

    it("saves drafts with validation, and freezes them once sent", async () => {
      const a = await insertItem("Jane Doe");
      await query(`select oq_outreach_queue(70)`);
      const r = (await one(`select oq_outreach_save($1, $2::jsonb) as r`, [a, JSON.stringify({
        email: "bad", linkedin_url: "https://www.linkedin.com/in/jane", subject: "s".repeat(500), body: "Hello Jane", linkedin_note: "n".repeat(400),
      })])).r;
      expect(r).toEqual({ ok: true, email_saved: false, linkedin_saved: true, draft_saved: true });
      const p = await getProspect(a);
      expect(p).toMatchObject({ stage: "drafted", email: null, drafted_by: "claude" });
      expect(p!.subject).toHaveLength(160);
      expect(p!.linkedin_note).toHaveLength(300);
      await transition(a, "mark_sent");
      const frozen = (await one(`select oq_outreach_save($1, '{"body":"changed"}'::jsonb) as r`, [a])).r;
      expect(frozen.ok).toBe(false);
      expect((await getProspect(a))!.body).toBe("Hello Jane");
      await expect(query(`select oq_outreach_save(999999, '{}'::jsonb)`)).rejects.toThrow(/not in the outreach pipeline/);
    });

    it("observes Gmail: sent then replied; ignores nonsense", async () => {
      const a = await insertItem("Jane Doe");
      await query(`select oq_outreach_queue(70)`);
      await query(`select oq_outreach_save($1, '{"email":"jane@acme.vc","body":"Hi"}'::jsonb)`, [a]);
      const watch = (await one(`select oq_outreach_watch() as w`)).w;
      expect(watch).toEqual([expect.objectContaining({ item_id: a, email: "jane@acme.vc", stage: "drafted" })]);
      expect((await one(`select oq_outreach_observe($1, 'replied', null) as r`, [999])).r).toBe("not found");
      expect((await one(`select oq_outreach_observe($1, 'sent', '2026-10-08T15:00:00Z') as r`, [a])).r).toBe("ok");
      expect(await getProspect(a)).toMatchObject({ stage: "sent", touches: 1, next_followup_at: "2026-10-13" });
      expect((await one(`select oq_outreach_observe($1, 'sent', now()) as r`, [a])).r).toBe("ignored");
      expect((await one(`select oq_outreach_observe($1, 'replied', '2026-10-09T15:00:00Z') as r`, [a])).r).toBe("ok");
      expect(await getProspect(a)).toMatchObject({ stage: "replied", next_followup_at: null });
    });

    it("adds an outreach block to the digest", async () => {
      const a = await insertItem("Jane Doe", { status: "seen" });
      await query(`select oq_outreach_queue(70)`);
      await query(`select oq_outreach_save($1, '{"body":"Hi"}'::jsonb)`, [a]);
      const d = (await one(`select oq_digest_email(55, 'https://dash.example') as d`)).d;
      expect(d.outreach).toEqual({ drafts: 1, followups_due: 0, new_replies: 0, actions: 1 });
      expect(d.html).toContain("1 draft to review");
      expect(d.html).toContain('href="https://dash.example/outreach"');
    });
  });

  it("migrates idempotently and records the schema hash", async () => {
    await query(`drop table if exists schema_version`);
    expect(await ensureSchema(getPool())).toBe("applied");
    expect(await ensureSchema(getPool())).toBe("current");
    expect(await ensureSchema(getPool(), true)).toBe("applied");
  });
});
