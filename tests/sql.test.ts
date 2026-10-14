import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, query } from "@/lib/db";
import { dedupeKey, normalizeUrl, slug } from "@/lib/dedupe";
import { hasDb, resetDb } from "./helpers";

// The weekly routine writes through SQL functions; these tests pin them to the TypeScript reference implementation.
describe.skipIf(!hasDb)("SQL ingest/digest (postgres)", () => {
  beforeEach(resetDb);
  afterAll(closePool);

  const one = async <T = any>(sql: string, params: unknown[] = []) => (await query<any>(sql, params))[0] as T;
  const ingest = (section: string, kinds: string[], upcoming: boolean, findings: unknown) =>
    one<{ oq_ingest: any }>(`select oq_ingest($1, 't1', $2::text[], $3, $4::jsonb) as r`, [
      section, kinds, upcoming, JSON.stringify(findings),
    ]).then((r: any) => r.r);
  const f = (o: Record<string, unknown> = {}) => ({
    kind: "event", title: "Expo", url: "https://example.com/expo", summary: "s", why_relevant: "w",
    score: 70, tags: ["a"], event_date: "2099-01-01", ...o,
  });

  describe("parity with lib/dedupe.ts", () => {
    const urls = [
      "https://www.Example.com/Events/?utm_source=x&b=2&a=1#top",
      "http://a.com/p/", "https://a.com/p?utm_campaign=1", "https://a.com", "https://a.com/",
      "https://sub.a.com/x/y/?ref=1&q=2", "https://a.com/x?source=z&fbclid=1&keep=1", "https://A.COM:8080/x",
      "javascript:alert(1)", "not a url", "ftp://x.com/a", "",
    ];
    it.each(urls)("normalizes %s the same way", async (u) => {
      const sqlVal = (await one<{ v: string | null }>(`select oq_norm_url($1) as v`, [u])).v;
      // TS keeps ports out via hostname; both strip them.
      expect(sqlVal).toBe(normalizeUrl(u));
    });
    it.each(["José  O'Neil!", "Jane Doe", "  --x--  ", "Ünïcödé Çafé"])("slugs %s the same way", async (s) => {
      expect((await one<{ v: string }>(`select oq_slug($1) as v`, [s])).v).toBe(slug(s));
    });
    const keys = [
      { section: "sooz", kind: "angel", title: "Jane Doe", url: "https://a.com/x", firm: "Acme VC" },
      { section: "sooz", kind: "angel", title: "jane doe", firm: null },
      { section: "personal", kind: "event", title: "Hack", url: "https://www.x.com/e/?utm_source=a" },
      { section: "personal", kind: "other", title: "No url", url: null, event_date: "2026-12-01" },
      { section: "sooz", kind: "event", title: "No url or date" },
      { section: "sooz", kind: "angel", title: "Ann Top", firm: "The Angel Group; Supernatural Ventures" },
      { section: "sooz", kind: "celebrity", title: "Sam Star", url: "https://a.com/x", firm: "Houston Texans" },
      { section: "sooz", kind: "nextgen", title: "Ann Heir", firm: "Heir Family Office; Heir Ventures" },
      { section: "sooz", kind: "creator", title: "Cree Ator", firm: " ; Other" },
      { section: "sooz", kind: "buyer", title: "Bea Buyer", firm: "H-E-B | Central Market" },
      { section: "sooz", kind: "media", title: "Pat Writer", firm: null },
      { section: "personal", kind: "celebrity", title: "Not a person outside sooz", url: "https://x.com/p" },
      { section: "career", kind: "internship", title: "Acme: Intern", url: "https://acme.com/jobs/1?utm_source=x" },
      { section: "career", kind: "fellowship", title: "No url fellowship", event_date: "2027-01-15" },
    ];
    it.each(keys)("builds the same dedupe key for %o", async (k) => {
      const v = (await one<{ v: string }>(`select oq_dedupe_key($1,$2,$3,$4,$5::date,$6) as v`, [
        k.section, k.kind, k.title, (k as any).url ?? null, (k as any).event_date ?? null, (k as any).firm ?? null,
      ])).v;
      expect(v).toBe(dedupeKey(k as any));
    });
  });

  describe("oq_ingest", () => {
    it("inserts valid findings and rejects bad ones with reasons", async () => {
      const r = await ingest("sooz", ["event"], true, [
        f(), // good
        f({ title: "Past", url: "https://example.com/past", event_date: "2020-01-01" }),
        f({ title: "Low", url: "https://example.com/low", score: 30 }),
        f({ title: "No url", url: null }),
        f({ title: "Bad url", url: "javascript:alert(1)" }),
        f({ title: "Wrong kind", url: "https://example.com/wk", kind: "angel" }),
        f({ title: "", url: "https://example.com/blank" }),
        f({ title: "Bad score", url: "https://example.com/bs", score: "high" }),
        f({ title: "Bad date", url: "https://example.com/bd", event_date: "2026-13-45" }),
      ]);
      expect(r).toMatchObject({ received: 9, valid: 2, inserted: 2, updated: 0 });
      expect(r.rejected.map((x: any) => x.title).sort()).toEqual(["", "Bad score", "Bad url", "Low", "No url", "Past", "Wrong kind"].sort());
      const rows = await query<any>(`select title, event_date from items order by title`);
      expect(rows).toEqual([{ title: "Bad date", event_date: null }, { title: "Expo", event_date: "2099-01-01" }]);
    });

    it("normalises fields: clamps score, lowercases/dedupes/caps tags, adds rice, trims, caps lengths", async () => {
      await ingest("sooz", ["angel"], false, [
        {
          kind: "Angel", title: "  Jane Doe ", url: "https://a.com/jane", score: 250,
          tags: ["Houston", "houston", " ", "Food-Bev", "a", "b", "c", "d", "e", "f"],
          summary: "x".repeat(900), why_relevant: "y".repeat(500),
          details: { firm: " Acme ", role: null, rice_connection: "MBA '09", contact_path: "Rice Alliance" },
        },
      ]);
      const r = await one<any>(`select * from items`);
      expect(r.title).toBe("Jane Doe");
      expect(r.score).toBe(100);
      expect(r.tags).toEqual(["houston", "food-bev", "a", "b", "c", "d", "e", "f", "rice"]);
      expect(r.summary).toHaveLength(600);
      expect(r.why_relevant).toHaveLength(300);
      expect(r.details).toEqual({ firm: "Acme", rice_connection: "MBA '09", contact_path: "Rice Alliance" });
      expect(r.dedupe_key).toBe("angel:jane-doe:acme");
    });

    it("never resets triage state and keeps known dates on refresh; records runs", async () => {
      await ingest("sooz", ["event"], true, [f()]);
      await query(`update items set status = 'saved', notes = 'mine'`);
      const again = await ingest("sooz", ["event"], true, [f({ summary: "v2", score: 90, url: "https://www.example.com/expo/", event_date: null })]);
      expect(again).toMatchObject({ inserted: 0, updated: 1 });
      const r = await one<any>(`select status, notes, summary, score, event_date from items`);
      expect(r).toMatchObject({ status: "saved", notes: "mine", summary: "v2", score: 90, event_date: "2099-01-01" });
      const runs = await query<any>(`select found, inserted, finished_at is not null as done from runs order by id`);
      expect(runs).toEqual([{ found: 1, inserted: 1, done: true }, { found: 1, inserted: 0, done: true }]);
    });

    it("collapses the same person across pages and survives hostile text safely", async () => {
      const evil = "'; drop table items; --";
      const r = await ingest("sooz", ["angel"], false, [
        { kind: "angel", title: `Jane ${evil}`, url: "https://a.com/1", score: 80, tags: [], summary: evil, why_relevant: "", details: { firm: "Acme" } },
        { kind: "angel", title: `Jane ${evil}`, url: "https://b.com/2", score: 82, tags: [], summary: "", why_relevant: "", details: { firm: "acme" } },
      ]);
      expect(r).toMatchObject({ inserted: 1, updated: 1 });
      expect((await one<any>(`select count(*)::int n from items`)).n).toBe(1);
    });

    it("accepts the career section and new person kinds", async () => {
      const c = await ingest("career", ["internship", "job"], true, [
        f({ kind: "internship", title: "Acme: Summer 2027 Intern", url: "https://acme.com/jobs/1", event_date: null, deadline: "2099-01-01" }),
        f({ kind: "internship", title: "Closed", url: "https://acme.com/jobs/2", event_date: null, deadline: "2020-01-01" }),
      ]);
      expect(c).toMatchObject({ valid: 1, inserted: 1 });
      const p = await ingest("sooz", ["celebrity"], false, [
        { kind: "celebrity", title: "Sam Star", url: "https://a.com/s", score: 80, tags: [], summary: "", why_relevant: "",
          details: { firm: "Houston Texans; Star Drinks", role: "Linebacker", contact_path: "Agency roster" } },
        { kind: "celebrity", title: "Sam Star", url: "https://b.com/s", score: 82, tags: [], summary: "", why_relevant: "",
          details: { firm: "Houston Texans", role: "Linebacker" } },
      ]);
      expect(p).toMatchObject({ inserted: 1, updated: 1 });
      const rows = await query<any>(`select section, kind, dedupe_key from items order by id`);
      expect(rows).toEqual([
        { section: "career", kind: "internship", dedupe_key: "career:url:acme.com/jobs/1" },
        { section: "sooz", kind: "celebrity", dedupe_key: "celebrity:sam-star:houston-texans" },
      ]);
    });

    it("rejects malformed calls atomically", async () => {
      await expect(ingest("nope", ["event"], false, [f()])).rejects.toThrow(/section/);
      await expect(ingest("sooz", ["event"], false, { not: "array" })).rejects.toThrow(/array/);
      expect((await one<any>(`select count(*)::int n from runs`)).n).toBe(0);
    });
  });

  describe("oq_digest_email", () => {
    const ins = (title: string, o: Record<string, unknown> = {}) =>
      query(
        `insert into items (section, kind, title, url, summary, why_relevant, score, status, event_date, deadline, details, dedupe_key)
         values ($1,$2,$3,'https://x.com/'||$3,$4,'why',$5,$6,$7,$8,$9::jsonb,$3)`,
        [o.section ?? "sooz", o.kind ?? "event", title, o.summary ?? "sum", o.score ?? 70, o.status ?? "new",
         o.event_date ?? null, o.deadline ?? null, JSON.stringify(o.details ?? {})],
      );
    const digest = async (min = 55, url: string | null = "https://dash.example") =>
      (await one<any>(`select oq_digest_email($1, $2) as d`, [min, url])).d;

    it("selects new, un-emailed, high-fit items and groups them", async () => {
      await ins("angel1", { kind: "angel", details: { firm: "Acme", rice_connection: "MBA '09", contact_path: "Rice Alliance" } });
      await ins("event1");
      await ins("personal1", { section: "personal", kind: "hackathon" });
      await ins("low", { score: 40 });
      await ins("seen", { status: "seen" });
      await ins("dismissed", { status: "dismissed" });
      const d = await digest();
      expect(d.count).toBe(3);
      expect(d.subject).toMatch(/^Query digest: 3 new finds \(\d{4}-\d{2}-\d{2}\)$/);
      expect(d.html).toContain("Sooz — new people (1)");
      expect(d.html).toContain("Sooz — events, funding &amp; resources (1)");
      expect(d.html).toContain("Personal (1)");
      expect(d.html).toContain("Rice: MBA &#39;09");
      expect(d.html).toContain("Path: Rice Alliance");
      expect(d.html).toContain("Open dashboard");
      expect(d.ids).toHaveLength(3);
    });

    it("groups every person kind under new people and adds a Career section", async () => {
      await ins("Sam Star", { kind: "celebrity", details: { firm: "Houston Texans", role: "Linebacker", contact_path: "Agency roster" } });
      await ins("Bea Buyer", { kind: "buyer", details: { firm: "H-E-B" } });
      await ins("expo");
      await ins("Acme: Intern", { section: "career", kind: "internship", deadline: "2099-01-01" });
      await ins("Hack", { section: "personal", kind: "hackathon" });
      const d = await digest();
      expect(d.count).toBe(5);
      expect(d.html).toContain("Sooz — new people (2)");
      expect(d.html).toContain("Sooz — events, funding &amp; resources (1)");
      expect(d.html).toContain("Linebacker · Houston Texans");
      expect(d.html).toContain("Path: Agency roster");
      expect(d.html).toContain("Personal (1)");
      expect(d.html).toContain("Career (1)");
      expect(d.text).toContain("SOOZ — NEW PEOPLE (2)");
      expect(d.text).toContain("CAREER (1)\n- Acme: Intern [internship, fit 70] — apply by 2099-01-01");
      expect(d.html.indexOf("Personal (1)")).toBeLessThan(d.html.indexOf("Career (1)"));
    });

    it("lists the next 14 days once, and does not repeat after marking digested", async () => {
      await ins("soon", { event_date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) });
      await ins("far", { event_date: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10) });
      await ins("past", { event_date: "2020-01-01", status: "saved" });
      const d = await digest();
      expect(d.upcoming).toBe(1);
      expect(d.text.match(/- soon \[/g)).toHaveLength(1); // not duplicated under new finds
      expect(d.text).not.toContain("- past [");
      const n = (await one<any>(`select oq_mark_digested($1::bigint[]) as n`, [d.ids])).n;
      expect(n).toBe(2);
      expect((await digest()).count).toBe(0);
    });

    it("escapes hostile content in HTML", async () => {
      await ins(`<script>alert(1)</script>`, { summary: `"><img src=x onerror=1>` });
      const d = await digest();
      expect(d.html).not.toContain("<script>");
      expect(d.html).not.toContain("<img");
    });

    it("handles an empty database", async () => {
      const d = await digest();
      expect(d).toMatchObject({ count: 0, upcoming: 0, ids: [] });
    });
  });
});
