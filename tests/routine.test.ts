import { describe, expect, it } from "vitest";
import { CAREER_PROFILE, TASKS, buildExtractionPrompt, buildResearchPrompt } from "@/lib/briefs";
import { validateCandidates, type RawFindingT } from "@/lib/ingest";
import { buildDigestRoutinePrompt, buildOutreachRoutinePrompt, buildResearchRoutinePrompt } from "@/lib/routine";
import { KINDS, PERSON_KINDS, SECTIONS } from "@/lib/types";

const raw = (o: Partial<RawFindingT>): RawFindingT => ({
  kind: "event", title: "Thing", url: "https://example.com/thing", source: null, summary: "s", why_relevant: "w", score: 70,
  tags: [], event_date: null, deadline: null, location: null,
  details: { firm: null, role: null, rice_connection: null, check_size: null, contact_path: null }, ...o,
});

describe("research tasks", () => {
  it("have unique ids and only emit kinds their section allows", () => {
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length);
    for (const t of TASKS) for (const k of t.kinds) expect(KINDS[t.section], `${t.id}: ${k}`).toContain(k);
  });
  it("cover every section and every new kind", () => {
    const ids = TASKS.map((t) => t.id);
    for (const id of [
      "sooz-celebrities", "sooz-nextgen", "sooz-creators-nil", "sooz-buyers", "sooz-media", "sooz-sampling",
      "personal-events", "personal-passes-speaking", "career-internships", "career-programs", "career-externships", "career-fellowships",
    ]) expect(ids).toContain(id);
    for (const s of SECTIONS) {
      const emitted = new Set(TASKS.filter((t) => t.section === s).flatMap((t) => t.kinds));
      for (const k of KINDS[s]) if (k !== "other" || s === "personal") expect(emitted, `${s}: ${k}`).toContain(k);
    }
  });
  it("moved job to Career and added perks to the AI task", () => {
    expect(KINDS.personal).not.toContain("job");
    expect(KINDS.career).toContain("job");
    expect(TASKS.find((t) => t.id === "personal-ai-startup")!.kinds).toContain("perk");
    expect(TASKS.find((t) => t.id === "sooz-resources")!.brief).toMatch(/corporate beverage venture/);
  });
  it("tells people tasks to stay public, adult and one-person-per-item", () => {
    for (const t of TASKS.filter((t) => t.kinds.some((k) => (PERSON_KINDS as readonly string[]).includes(k) && k !== "angel"))) {
      expect(t.brief, t.id).toMatch(/ONE PERSON/);
      expect(t.brief, t.id).toMatch(/Adults only/);
      expect(t.brief, t.id).toMatch(/never personal emails/);
    }
  });
  it("uses the career profile for career tasks", () => {
    const t = TASKS.find((x) => x.id === "career-internships")!;
    const p = buildResearchPrompt(t, { today: "2026-10-14", homeBase: "Houston, TX", known: [] });
    expect(p).toContain(CAREER_PROFILE);
    expect(p).toContain("class of 2029");
    expect(buildExtractionPrompt(t, "notes", "2026-10-14")).toContain("internship, job");
  });
  it("validates career findings: past deadlines dropped, job allowed, personal job no longer allowed", () => {
    const t = TASKS.find((x) => x.id === "career-internships")!;
    const out = validateCandidates(
      [
        raw({ kind: "internship", title: "Acme: Intern", deadline: "2026-12-01" }),
        raw({ kind: "job", title: "Acme: Part-time", url: "https://example.com/pt" }),
        raw({ kind: "internship", title: "Closed", url: "https://example.com/closed", deadline: "2026-09-01" }),
      ],
      t,
      "2026-10-14",
    );
    expect(out.map((c) => c.title)).toEqual(["Acme: Intern", "Acme: Part-time"]);
    const ai = TASKS.find((x) => x.id === "personal-ai-startup")!;
    expect(validateCandidates([raw({ kind: "job", event_date: "2099-01-01" })], ai, "2026-10-14")).toEqual([]);
  });
  it("keeps undated people in upcoming-only tasks", () => {
    const t = TASKS.find((x) => x.id === "sooz-buyers")!;
    expect(t.upcomingOnly).toBe(true);
    const out = validateCandidates(
      [raw({ kind: "buyer", title: "Bea Buyer" }), raw({ kind: "event", title: "Old pitch day", url: "https://e.com/x", event_date: "2026-01-01" })],
      t,
      "2026-10-14",
    );
    expect(out.map((c) => c.title)).toEqual(["Bea Buyer"]);
  });
});

describe("routine prompts", () => {
  it("research: Monday covers only Sooz tasks", () => {
    const p = buildResearchRoutinePrompt(["sooz"]);
    expect(p).toMatch(/^Scheduled weekly run of the "Query" opportunity radar RESEARCH job \(Sooz\)\. Run it now, fully autonomously/);
    for (const t of TASKS) {
      if (t.section === "sooz") expect(p).toContain(`Task \`${t.id}\``);
      else expect(p).not.toContain(`Task \`${t.id}\``);
    }
    expect(p).not.toContain("Section `career`");
  });
  it("research: Thursday covers Personal and Career tasks, with context for both", () => {
    const p = buildResearchRoutinePrompt(["personal", "career"]);
    expect(p).toContain("RESEARCH job (Personal & Career)");
    expect(p).toContain("Task `career-fellowships`");
    expect(p).toContain("Task `personal-events`");
    expect(p).not.toContain("Task `sooz-angels-rice`");
    expect(p).toContain("Section `career`");
    expect(p).toContain("site:lu.ma Houston");
  });
  it("research: subagents only search; the routine alone ingests; same hard rules", () => {
    const p = buildResearchRoutinePrompt(["sooz"]);
    expect(p).toContain("at most 4 at a time");
    expect(p).toContain("Subagents never call `run_sql`; you make every oq_ingest call yourself.");
    expect(p).toContain(`project_id="green-hall-60323582", branch_id="br-billowing-band-an46gq84", database_name="opportunity_query"`);
    expect(p).toContain("The ONLY SQL you may run is these two shapes");
    expect(p).toContain("Never send email");
    expect(p).toContain("Adults only");
  });
  it("outreach: purposes, contact rules by kind, and compliance notes", () => {
    const p = buildOutreachRoutinePrompt({ apolloBudget: 5, minScore: 75 });
    for (const purpose of ["invest", "ambassador", "buyer", "press", "intro"]) expect(p).toContain(`- ${purpose} (`);
    expect(p).toContain("at most 5 lookups this run");
    expect(p).toContain("select oq_outreach_queue(75) as added");
    expect(p).toContain('email_source="public"');
    expect(p).toContain("Never use Apollo for these");
    expect(p).toMatch(/Never offer equity/);
    expect(p).toContain("FTC endorsement rules");
    expect(p).toContain("school's NIL rules");
    expect(p).toContain("Adults only");
    expect(p).toContain("You NEVER send anything.");
    expect(p).toContain("Never call Gmail send_message");
  });
  it("digest: only to the owner, with the same header", () => {
    const p = buildDigestRoutinePrompt("boxuanzhao1128@gmail.com", "https://opportunity-query.vercel.app");
    expect(p).toMatch(/^Scheduled weekly run of the "Query" opportunity radar DIGEST job\./);
    expect(p).toContain("Send email ONLY to boxuanzhao1128@gmail.com");
    expect(p).toContain("select oq_digest_email(55, 'https://opportunity-query.vercel.app') as d");
  });
});
