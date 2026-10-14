import { query } from "./db";
import { slug } from "./dedupe";
import { PERSON_KINDS, defaultPurpose, isPurpose, type ItemDetails, type Purpose } from "./types";

/**
 * Outreach pipeline for people: angels and next-gen investors (invest), celebrities and creators
 * (ambassador), retail buyers (buyer), press (press), and connectors (intro).
 *
 * Stages: prospect → drafted → sent → replied → meeting, or passed / closed.
 * Sending is always done by a person (Gmail compose link, LinkedIn). The weekly routine only
 * enriches, drafts, and observes Gmail for sent mail and replies (see db/schema.sql oq_outreach_*).
 */

export const STAGES = ["prospect", "drafted", "sent", "replied", "meeting", "passed", "closed"] as const;
export type Stage = (typeof STAGES)[number];

export const FOLLOWUP_DAYS = [5, 7]; // after first email, then after follow-up 1
export const MAX_TOUCHES = 3;

export interface Prospect {
  item_id: number;
  kind: string;
  purpose: Purpose;
  name: string;
  url: string | null;
  summary: string;
  why_relevant: string;
  score: number;
  tags: string[];
  details: ItemDetails;
  location: string | null;
  stage: Stage;
  email: string | null;
  email_source: string | null;
  linkedin_url: string | null;
  warm_path: string | null;
  subject: string | null;
  body: string | null;
  linkedin_note: string | null;
  intro_request: string | null;
  followup_1: string | null;
  followup_2: string | null;
  drafted_by: string | null;
  sent_at: string | null;
  next_followup_at: string | null;
  touches: number;
  replied_at: string | null;
  updated_at: string;
}

// Pitch profile (settings)

export const PITCH_FIELDS = [
  { key: "pitch.company", label: "Company", placeholder: "Sooz Beverage" },
  { key: "pitch.website", label: "Website", placeholder: "drinksooz.com" },
  { key: "pitch.one_liner", label: "One-liner", placeholder: "What Sooz is, in one sentence" },
  { key: "pitch.traction", label: "Traction (verified facts only)", placeholder: "e.g. 40 retail doors in Houston; 32% repeat rate" },
  { key: "pitch.raise", label: "Raise", placeholder: "e.g. $500k pre-seed SAFE (leave blank to not mention)" },
  { key: "pitch.deck_url", label: "Deck link", placeholder: "DocSend / Drive link (optional)" },
  { key: "pitch.sender_name", label: "Sender name", placeholder: "Your name" },
  { key: "pitch.sender_title", label: "Sender title", placeholder: "Co-founder & CEO" },
  { key: "pitch.sender_email", label: "Send from (Google account)", placeholder: "you@drinksooz.com" },
  { key: "pitch.rice_affiliation", label: "Your Rice affiliation", placeholder: "e.g. Rice '25 (blank if none)" },
  { key: "pitch.calendar_url", label: "Calendar link", placeholder: "Optional" },
] as const;
export type PitchKey = (typeof PITCH_FIELDS)[number]["key"];
export type Pitch = Partial<Record<PitchKey, string>>;

export async function getPitch(): Promise<Pitch> {
  const rows = await query<{ key: PitchKey; value: string }>(`select key, value from settings where key like 'pitch.%'`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Pitch;
}

export async function savePitch(values: Pitch): Promise<void> {
  for (const f of PITCH_FIELDS) {
    const v = (values[f.key] ?? "").toString().trim().slice(0, 1000);
    await query(
      `insert into settings (key, value) values ($1, $2)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [f.key, v],
    );
  }
}

/** Facts a draft can't be written without. */
export function missingPitch(p: Pitch): string[] {
  const required: PitchKey[] = ["pitch.company", "pitch.one_liner", "pitch.sender_name"];
  return required.filter((k) => !p[k]?.trim()).map((k) => PITCH_FIELDS.find((f) => f.key === k)!.label);
}

// Queries

const PROSPECT_COLS = `i.id as item_id, i.kind, o.purpose, i.title as name, i.url, i.summary, i.why_relevant, i.score, i.tags, i.details, i.location,
  o.stage, o.email, o.email_source, o.linkedin_url, o.warm_path, o.subject, o.body, o.linkedin_note, o.intro_request,
  o.followup_1, o.followup_2, o.drafted_by, o.sent_at, o.next_followup_at, o.touches, o.replied_at, o.updated_at`;

export async function listProspects(): Promise<Prospect[]> {
  return query<Prospect>(
    `select ${PROSPECT_COLS} from outreach o join items i on i.id = o.item_id
      order by case o.stage when 'replied' then 0 when 'meeting' then 1 when 'sent' then 2 when 'drafted' then 3
                            when 'prospect' then 4 else 5 end,
               o.next_followup_at nulls last, i.score desc`,
  );
}

export async function getProspect(itemId: number): Promise<Prospect | undefined> {
  const rows = await query<Prospect>(
    `select ${PROSPECT_COLS} from outreach o join items i on i.id = o.item_id where o.item_id = $1`,
    [itemId],
  );
  return rows[0];
}

export interface Bucketed {
  due: Prospect[]; // follow-ups due today or earlier
  drafts: Prospect[]; // ready to review & send
  prospects: Prospect[]; // need contact info / drafts
  waiting: Prospect[]; // sent, follow-up not yet due
  live: Prospect[]; // replied / meeting
  closed: Prospect[]; // passed / closed
}

export function bucket(rows: Prospect[], today: string): Bucketed {
  const b: Bucketed = { due: [], drafts: [], prospects: [], waiting: [], live: [], closed: [] };
  for (const p of rows) {
    if (p.stage === "sent") {
      if (p.next_followup_at && p.next_followup_at <= today && p.touches < MAX_TOUCHES) b.due.push(p);
      else b.waiting.push(p);
    } else if (p.stage === "drafted") b.drafts.push(p);
    else if (p.stage === "prospect") b.prospects.push(p);
    else if (p.stage === "replied" || p.stage === "meeting") b.live.push(p);
    else b.closed.push(p);
  }
  return b;
}

async function logEvent(itemId: number, kind: string, detail = ""): Promise<void> {
  await query(`insert into outreach_events (item_id, kind, detail) values ($1, $2, $3)`, [itemId, kind, detail.slice(0, 500)]);
}

/** Put one person into the pipeline (idempotent). Returns false if the item isn't a person. */
export async function addToPipeline(itemId: number): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `insert into outreach (item_id, purpose)
     select id, oq_default_purpose(kind) from items where id = $1 and section = 'sooz' and kind = any($2::text[])
     on conflict (item_id) do nothing returning item_id as id`,
    [itemId, [...PERSON_KINDS]],
  );
  if (rows.length) await logEvent(itemId, "added");
  const exists = await query(`select 1 from outreach where item_id = $1`, [itemId]);
  return exists.length > 0;
}

/** Change why we're reaching out (drives which template drafts are written). */
export async function setPurpose(itemId: number, purpose: string): Promise<boolean> {
  if (!isPurpose(purpose)) return false;
  const rows = await query(`update outreach set purpose = $2, updated_at = now() where item_id = $1 returning 1`, [itemId, purpose]);
  if (rows.length) await logEvent(itemId, "purpose", purpose);
  return rows.length > 0;
}

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const LINKEDIN_RE = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#\s]+\/?$/i;

export interface DraftEdit {
  email?: string;
  linkedin_url?: string;
  warm_path?: string;
  subject?: string;
  body?: string;
  linkedin_note?: string;
  intro_request?: string;
  followup_1?: string;
  followup_2?: string;
}

/** Save a person's edits. Invalid email/LinkedIn values are rejected rather than stored. */
export async function saveEdits(itemId: number, e: DraftEdit, draftedBy = "you"): Promise<{ ok: boolean; error?: string }> {
  const email = e.email?.trim() || null;
  const li = e.linkedin_url?.trim() || null;
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "That email address doesn't look valid." };
  if (li && !LINKEDIN_RE.test(li)) return { ok: false, error: "LinkedIn link must look like https://www.linkedin.com/in/name" };
  const clip = (v: string | undefined, n: number) => (v === undefined ? undefined : v.trim().slice(0, n) || null);
  await query(
    `update outreach set
       email = $2, email_source = case when $2::text is distinct from email then 'manual' else email_source end,
       linkedin_url = $3, warm_path = $4, subject = $5, body = $6, linkedin_note = $7, intro_request = $8,
       followup_1 = $9, followup_2 = $10,
       stage = case when stage = 'prospect' and $6::text is not null then 'drafted' else stage end,
       drafted_by = case when drafted_by is null and $6::text is not null then $11 else drafted_by end,
       updated_at = now()
     where item_id = $1`,
    [
      itemId,
      email?.toLowerCase() ?? null,
      li,
      clip(e.warm_path, 500) ?? null,
      clip(e.subject, 160) ?? null,
      clip(e.body, 3000) ?? null,
      clip(e.linkedin_note, 300) ?? null,
      clip(e.intro_request, 2000) ?? null,
      clip(e.followup_1, 1500) ?? null,
      clip(e.followup_2, 1500) ?? null,
      draftedBy,
    ],
  );
  await logEvent(itemId, draftedBy === "you" ? "edited" : `drafted_${draftedBy}`);
  return { ok: true };
}

/** Advance after a human action. All transitions are explicit and logged. */
export async function transition(
  itemId: number,
  action: "mark_sent" | "followup_sent" | "replied" | "meeting" | "passed" | "close" | "reopen",
  now = new Date(),
): Promise<void> {
  const p = await getProspect(itemId);
  if (!p) return;
  const day = (d: Date, plus: number) => new Date(d.getTime() + plus * 864e5).toISOString().slice(0, 10);
  switch (action) {
    case "mark_sent":
      if (p.stage !== "drafted" && p.stage !== "prospect") return;
      await query(
        `update outreach set stage = 'sent', sent_at = $2, last_touch_at = $2, touches = greatest(touches, 1),
           next_followup_at = $3, updated_at = now() where item_id = $1`,
        [itemId, now.toISOString(), day(now, FOLLOWUP_DAYS[0])],
      );
      break;
    case "followup_sent": {
      if (p.stage !== "sent") return;
      const touches = p.touches + 1;
      const next = touches >= MAX_TOUCHES ? null : day(now, FOLLOWUP_DAYS[Math.min(touches - 1, FOLLOWUP_DAYS.length - 1)]);
      await query(
        `update outreach set touches = $2, last_touch_at = $3, next_followup_at = $4, updated_at = now() where item_id = $1`,
        [itemId, touches, now.toISOString(), next],
      );
      break;
    }
    case "replied":
      await query(
        `update outreach set stage = 'replied', replied_at = $2, next_followup_at = null, updated_at = now() where item_id = $1`,
        [itemId, now.toISOString()],
      );
      break;
    case "meeting":
      await query(`update outreach set stage = 'meeting', next_followup_at = null, updated_at = now() where item_id = $1`, [itemId]);
      break;
    case "passed":
    case "close":
      await query(
        `update outreach set stage = $2, next_followup_at = null, updated_at = now() where item_id = $1`,
        [itemId, action === "passed" ? "passed" : "closed"],
      );
      break;
    case "reopen":
      await query(
        `update outreach set stage = case when body is not null then 'drafted' else 'prospect' end, updated_at = now() where item_id = $1`,
        [itemId],
      );
      break;
  }
  await logEvent(itemId, action);
}

export async function outreachStages(): Promise<Map<number, Stage>> {
  const rows = await query<{ item_id: number; stage: Stage }>(`select item_id, stage from outreach`);
  return new Map(rows.map((r) => [r.item_id, r.stage]));
}

// Drafting (deterministic fallback; the weekly routine writes richer, personalised drafts)

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

type DraftInput = Pick<Prospect, "name" | "details" | "why_relevant" | "warm_path"> & Partial<Pick<Prospect, "kind" | "purpose">>;

/** A short, factual hook from the person's public evidence. Never invents anything. */
function hook(p: DraftInput, purpose: Purpose): string {
  const d = p.details ?? {};
  const fallback: Record<Purpose, string> = {
    invest: "I came across your work backing early-stage consumer brands",
    ambassador: "I've been following your work with consumer brands",
    buyer: "I came across your work in the beverage category",
    press: "I've been reading your coverage of food and beverage brands",
    intro: "I came across your work in the consumer and food & beverage community",
  };
  if (d.role && d.firm) return `I came across your work as ${d.role} at ${d.firm}`;
  if (d.firm) return `I came across your work with ${d.firm}`;
  return fallback[purpose];
}

export interface Drafts {
  subject: string;
  body: string;
  linkedin_note: string;
  intro_request: string | null;
  followup_1: string;
  followup_2: string;
}

/** What each purpose asks for, in a first note and in follow-ups. None of these ever offers equity or terms. */
const ASKS: Record<Purpose, { ask: string; note: string; nudge: string; intro: string }> = {
  invest: {
    ask: "I'd value 20 minutes of your perspective on building in the category — and, if it's interesting, I'm happy to share more about what we're doing.",
    note: "I'd love to connect and learn from your perspective on the category.",
    nudge: "Would a 20-minute call in the next couple of weeks work?",
    intro: "I'd value their perspective on the category.",
  },
  ambassador: {
    ask: "We'd love to send you some to try, no strings attached. If you like it, I'd welcome a quick conversation about a collaboration that fits how you already work with brands.",
    note: "We'd love to send you some to try, no strings attached.",
    nudge: "Happy to ship some over to try — just tell me where (or your team's preferred address).",
    intro: "I'd love to send them product and explore a collaboration.",
  },
  buyer: {
    ask: "Could I have 15 minutes to hear what's working in your beverage set, or drop off samples for your team to try?",
    note: "I'd love 15 minutes to learn what's working in your set, or to drop off samples.",
    nudge: "Would 15 minutes, or a sample drop-off for your team, work in the next couple of weeks?",
    intro: "I'd love 15 minutes to learn what's working in their category.",
  },
  press: {
    ask: "If it's a fit for something you're working on, I'm happy to send samples or do a short interview.",
    note: "Happy to send samples or do a short interview if it's ever a fit.",
    nudge: "Happy to send samples or hop on a quick call if the story is useful.",
    intro: "I think there may be a story there for them.",
  },
  intro: {
    ask: "Is there anyone in your network who works with early-stage beverage brands you'd be comfortable introducing me to? I'd be grateful for any pointer.",
    note: "I'd love to connect and learn who you'd suggest I talk to.",
    nudge: "If anyone comes to mind, I'd be grateful for a pointer — and if not, no worries at all.",
    intro: "I'd value their advice on who to talk to.",
  },
};

export function templateDrafts(p: DraftInput, pitch: Pitch): Drafts {
  const purpose: Purpose = p.purpose && isPurpose(p.purpose) ? p.purpose : defaultPurpose(p.kind ?? "angel");
  const A = ASKS[purpose];
  const fn = firstName(p.name);
  const company = pitch["pitch.company"]?.trim() || "[Company]";
  const oneLiner = pitch["pitch.one_liner"]?.trim() || "[one-line description]";
  const sender = pitch["pitch.sender_name"]?.trim() || "[Your name]";
  const title = pitch["pitch.sender_title"]?.trim();
  const site = pitch["pitch.website"]?.trim();
  const traction = pitch["pitch.traction"]?.trim();
  const raise = pitch["pitch.raise"]?.trim();
  const deck = pitch["pitch.deck_url"]?.trim();
  const cal = pitch["pitch.calendar_url"]?.trim();
  const myRice = pitch["pitch.rice_affiliation"]?.trim();
  const theirRice = p.details?.rice_connection?.trim();
  const bothOwls = Boolean(myRice && theirRice);
  const tagline = oneLiner.split(/[.,;—-]/)[0].trim().slice(0, 60);

  const subject = bothOwls
    ? `Fellow Owl building ${company}`
    : purpose === "ambassador"
      ? `Can we send you some ${company}?`
      : purpose === "buyer"
        ? `${company} for ${p.details?.firm?.split(/[;|]/)[0].trim() || "your shelves"}: 15 minutes?`
        : purpose === "press"
          ? `Story idea: ${myRice ? "a Rice student founder building " : ""}${company}`
          : purpose === "intro"
            ? `Quick ask from a ${company} founder`
            : `${company}: ${tagline}`;

  // Only investors hear about a raise, and only as "starting conversations" (never terms).
  const ask = purpose === "invest" && raise
    ? `We're starting conversations ahead of our ${raise}. I'd value 20 minutes of your perspective on the category — and, if it's a fit, I'm happy to share more.`
    : A.ask;
  const pressAngle = purpose === "press" && myRice ? `\nThe angle: a Rice student (${myRice}) building a beverage brand from campus.` : "";

  const lines = [
    `Hi ${fn},`,
    "",
    `${hook(p, purpose)}${bothOwls ? ` — and as a fellow Rice alum (${myRice}), I wanted to reach out directly` : ""}.`,
    "",
    `I'm ${sender}${title ? `, ${title}` : ""} of ${company}. ${oneLiner}`,
    traction ? `\n${traction}` : "",
    pressAngle,
    "",
    ask,
    deck && purpose === "invest" ? `\nA short overview is here: ${deck}` : "",
    cal ? `If easier, here's my calendar: ${cal}` : "",
    "",
    "Best,",
    sender,
    [title, company].filter(Boolean).join(", ") + (site ? ` · ${site}` : ""),
  ];
  const body = lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const note = (
    bothOwls
      ? `Hi ${fn} — fellow Owl (${myRice}) here. I'm building ${company}: ${oneLiner} ${A.note}`
      : `Hi ${fn} — I'm building ${company}: ${oneLiner} ${A.note}`
  ).slice(0, 300);

  const intro = p.warm_path?.trim()
    ? [
        `Hi [mutual],`,
        "",
        `Hope you're well! I'm building ${company} — ${oneLiner}`,
        `Would you be comfortable introducing me to ${p.name}${p.details?.firm ? ` (${p.details.firm})` : ""}? ${A.intro}`,
        "",
        "Here's a short blurb you can forward:",
        `"${sender} is building ${company}. ${oneLiner}${traction ? ` ${traction}` : ""} They'd love to connect with ${fn}."`,
        "",
        "Totally fine if not — thank you either way!",
        sender,
      ].join("\n")
    : null;

  const followup_1 = [
    `Hi ${fn},`,
    "",
    `Quick follow-up on my note about ${company}.${traction ? ` Since then: ${traction}` : ""} ${A.nudge}`,
    "",
    sender,
  ].join("\n");

  const followup_2 = [
    `Hi ${fn},`,
    "",
    `Last note from me — I know inboxes are busy. If ${company} isn't a fit right now, no worries at all; I'd still love to keep you posted as we grow.`,
    "",
    sender,
  ].join("\n");

  return { subject, body, linkedin_note: note, intro_request: intro, followup_1, followup_2 };
}

// Send helpers (human sends)

/** Gmail compose deep link. Opens a pre-filled draft in the browser; nothing is sent automatically. */
export function gmailComposeUrl(o: { to?: string | null; subject?: string | null; body?: string | null; from?: string | null }): string {
  const p = new URLSearchParams({ view: "cm", fs: "1", tf: "1" });
  if (o.to) p.set("to", o.to);
  if (o.subject) p.set("su", o.subject);
  if (o.body) p.set("body", o.body);
  if (o.from) p.set("authuser", o.from);
  return `https://mail.google.com/mail/?${p.toString()}`;
}

export function linkedinSearchUrl(name: string, firm?: string | null): string {
  const q = [name, firm].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

// Your network (LinkedIn "Connections.csv")

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, commas/newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export function companyKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const k = name
    .toLowerCase()
    .replace(/\b(inc|llc|l\.l\.c|ltd|co|corp|corporation|company|the|lp|llp|plc)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return k || null;
}

export interface Connection {
  full_name: string;
  company: string | null;
  position: string | null;
  linkedin_url: string | null;
  email: string | null;
  connected_on: string | null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** LinkedIn export: preamble lines, then "First Name,Last Name,URL,Email Address,Company,Position,Connected On". */
export function parseLinkedInConnections(text: string): Connection[] {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => r.map((c) => c.trim().toLowerCase()).includes("first name"));
  if (h === -1) return [];
  const head = rows[h].map((c) => c.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const [fi, li, ui, ei, ci, pi, di] = ["first name", "last name", "url", "email address", "company", "position", "connected on"].map(col);
  const out: Connection[] = [];
  for (const r of rows.slice(h + 1)) {
    const full = [r[fi], r[li]].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
    if (!full) continue;
    let date: string | null = null;
    const raw = di >= 0 ? (r[di] ?? "").trim() : "";
    const m = raw.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/);
    if (m && MONTHS[m[2].toLowerCase()]) date = `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
    const url = ui >= 0 ? (r[ui] ?? "").trim() : "";
    out.push({
      full_name: full.slice(0, 160),
      company: (ci >= 0 ? r[ci] : "")?.trim().slice(0, 160) || null,
      position: (pi >= 0 ? r[pi] : "")?.trim().slice(0, 160) || null,
      linkedin_url: /^https?:\/\//.test(url) ? url.slice(0, 300) : null,
      email: ei >= 0 && EMAIL_RE.test((r[ei] ?? "").trim()) ? r[ei].trim().toLowerCase() : null,
      connected_on: date,
    });
  }
  return out;
}

export async function importConnections(conns: Connection[]): Promise<number> {
  let n = 0;
  for (const c of conns) {
    const key = c.linkedin_url ? `li:${c.linkedin_url.toLowerCase().replace(/\/+$/, "")}` : `name:${slug(c.full_name)}:${slug(c.company ?? "")}`;
    await query(
      `insert into network (full_name, company, position, linkedin_url, email, connected_on, source, company_key, dedupe_key)
       values ($1,$2,$3,$4,$5,$6,'linkedin',$7,$8)
       on conflict (dedupe_key) do update set company = excluded.company, position = excluded.position,
         email = coalesce(excluded.email, network.email), company_key = excluded.company_key`,
      [c.full_name, c.company, c.position, c.linkedin_url, c.email, c.connected_on, companyKey(c.company), key],
    );
    n++;
  }
  return n;
}

export interface WarmMatch {
  item_id: number;
  full_name: string;
  company: string | null;
  position: string | null;
  linkedin_url: string | null;
  kind: "same_person" | "same_company";
}

/** Who you already know: the angel themself (1st-degree) or someone at their firm. */
export async function warmMatches(itemIds: number[]): Promise<Map<number, WarmMatch[]>> {
  const map = new Map<number, WarmMatch[]>();
  if (!itemIds.length) return map;
  const rows = await query<WarmMatch>(
    `select i.id as item_id, n.full_name, n.company, n.position, n.linkedin_url,
            case when lower(n.full_name) = lower(i.title) then 'same_person' else 'same_company' end as kind
       from items i
       join network n on lower(n.full_name) = lower(i.title)
                      or n.company_key = any (oq_firm_keys(i.details->>'firm'))
      where i.id = any($1::bigint[])
      order by kind desc, n.full_name
      limit 500`,
    [itemIds],
  );
  for (const r of rows) {
    const list = map.get(r.item_id) ?? [];
    if (list.length < 5) list.push(r);
    map.set(r.item_id, list);
  }
  return map;
}

export async function networkSize(): Promise<number> {
  const r = await query<{ n: number }>(`select count(*)::int as n from network`);
  return r[0]?.n ?? 0;
}

/** Drafts to review + follow-ups due (the Outreach tab badge). */
export async function outreachActionCount(today = new Date().toISOString().slice(0, 10)): Promise<number> {
  const r = await query<{ n: number }>(
    `select count(*)::int as n from outreach
      where stage = 'drafted' or (stage = 'sent' and next_followup_at <= $1::date and touches < $2)`,
    [today, MAX_TOUCHES],
  );
  return r[0]?.n ?? 0;
}
