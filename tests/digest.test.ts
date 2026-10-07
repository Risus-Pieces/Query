import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, query } from "@/lib/db";
import { collectDigest, digestCount, mailConfigFromEnv, markDigested, renderDigest, sendEmail, type DigestData } from "@/lib/digest";
import type { Item } from "@/lib/types";
import { hasDb, resetDb } from "./helpers";

const item = (o: Partial<Item> = {}): Item => ({
  id: 1, section: "sooz", kind: "event", title: "Expo", url: "https://example.com/e", source: null,
  summary: "Sum", why_relevant: "Why", score: 80, tags: [], details: {}, event_date: "2026-10-20",
  deadline: null, location: "Austin", status: "new", notes: "", first_seen: "", last_seen: "", ...o,
});
const data = (o: Partial<DigestData> = {}): DigestData => ({
  fresh: { sooz: [], personal: [] }, upcoming: [], generatedAt: "2026-10-07", ...o,
});

describe("renderDigest", () => {
  it("escapes HTML from scraped content", () => {
    const evil = item({ title: `<script>alert(1)</script>`, summary: `"><img src=x onerror=1>`, url: `https://a.com/"onmouseover="x` });
    const { html } = renderDigest(data({ fresh: { sooz: [evil], personal: [] } }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain(`"onmouseover="`);
  });
  it("groups angels apart from other Sooz items and includes upcoming", () => {
    const angel = item({ id: 2, kind: "angel", title: "Jane", details: { firm: "Acme", rice_connection: "MBA '09", contact_path: "Rice Alliance" } });
    const { html, text, subject } = renderDigest(
      data({ fresh: { sooz: [angel, item()], personal: [item({ id: 3, section: "personal", title: "Hack" })] }, upcoming: [item({ id: 4, title: "Soon" })] }),
      "https://dash.example",
    );
    expect(subject).toBe("Query digest: 3 new finds, 1 coming up (2026-10-07)");
    expect(html).toContain("Sooz — new angels (1)");
    expect(html).toContain("Sooz — events, funding &amp; resources (1)");
    expect(html).toContain("Rice: MBA '09");
    expect(html).toContain("Open dashboard");
    expect(text).toContain("COMING UP IN THE NEXT 14 DAYS (1)");
    expect(text).toContain("Jane [angel, fit 80]");
  });
  it("does not repeat an item under new finds when it is already listed as coming up", () => {
    const both = item({ id: 9, title: "Both" });
    const { text } = renderDigest(data({ fresh: { sooz: [both], personal: [] }, upcoming: [both] }));
    expect(text.match(/Both \[event/g)).toHaveLength(1);
  });
  it("handles an empty week and singular grammar", () => {
    expect(renderDigest(data()).html).toContain("Nothing new this week.");
    expect(renderDigest(data({ fresh: { sooz: [item()], personal: [] } })).subject).toContain("1 new find ");
  });
});

describe("sendEmail / config", () => {
  it("only configures when all three vars are present", () => {
    expect(mailConfigFromEnv({ RESEND_API_KEY: "k" } as any)).toBeNull();
    expect(mailConfigFromEnv({ RESEND_API_KEY: "k", DIGEST_TO: "a@b.c", DIGEST_FROM: "x@y.z" } as any)).toEqual({ apiKey: "k", to: "a@b.c", from: "x@y.z" });
  });
  it("posts to Resend with bearer auth and split recipients", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendEmail({ apiKey: "k", to: "a@b.c, d@e.f", from: "x@y.z" }, { subject: "S", html: "<p>h</p>", text: "t" }, f as any);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as any).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string).to).toEqual(["a@b.c", "d@e.f"]);
  });
  it("throws on a failed send so items are not marked as emailed", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 422 }));
    await expect(sendEmail({ apiKey: "k", to: "a@b.c", from: "x" }, { subject: "S", html: "", text: "" }, f as any)).rejects.toThrow(/422/);
  });
  it("digestCount sums both sections", () => {
    expect(digestCount(data({ fresh: { sooz: [item()], personal: [item(), item()] } }))).toBe(3);
  });
});

describe.skipIf(!hasDb)("collectDigest (postgres)", () => {
  beforeEach(resetDb);
  afterAll(closePool);

  const ins = (title: string, o: { score?: number; status?: string; event_date?: string | null; deadline?: string | null; section?: string } = {}) =>
    query(
      `insert into items (section, kind, title, url, score, status, event_date, deadline, dedupe_key)
       values ($1,'event',$2,'https://x.com/'||$2,$3,$4,$5,$6,$2)`,
      [o.section ?? "sooz", title, o.score ?? 70, o.status ?? "new", o.event_date ?? null, o.deadline ?? null],
    );

  it("selects only new, un-emailed items above the score threshold", async () => {
    await ins("keep");
    await ins("low", { score: 40 });
    await ins("seen", { status: "seen" });
    await ins("dismissed", { status: "dismissed" });
    await ins("personal one", { section: "personal" });
    const d = await collectDigest(55, "2026-10-07");
    expect(d.fresh.sooz.map((i) => i.title)).toEqual(["keep"]);
    expect(d.fresh.personal.map((i) => i.title)).toEqual(["personal one"]);
  });

  it("does not repeat items once marked digested", async () => {
    await ins("a");
    const first = await collectDigest(55, "2026-10-07");
    await markDigested(first.fresh.sooz.map((i) => i.id));
    const second = await collectDigest(55, "2026-10-07");
    expect(digestCount(second)).toBe(0);
  });

  it("lists things happening or due in the next 14 days, excluding dismissed and past", async () => {
    await ins("today", { event_date: "2026-10-07", status: "saved" });
    await ins("in13", { event_date: "2026-10-20" });
    await ins("in15", { event_date: "2026-10-22" });
    await ins("yesterday", { event_date: "2026-10-06" });
    await ins("deadline soon", { deadline: "2026-10-10", status: "seen" });
    await ins("dismissed soon", { event_date: "2026-10-10", status: "dismissed" });
    const d = await collectDigest(55, "2026-10-07");
    expect(d.upcoming.map((i) => i.title)).toEqual(["today", "deadline soon", "in13"]);
  });
});
