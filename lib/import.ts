import { query } from "./db";
import { dedupeKey } from "./dedupe";
import { persistCandidates, todayISO, validateCandidates, type RawFindingT } from "./ingest";
import { addToPipeline, parseCsv, setPurpose } from "./outreach";
import { PERSON_KINDS, isPersonKind, isPurpose, type Purpose } from "./types";

/**
 * Import people from a CSV (e.g. the research report's prospect list, or an Apollo export).
 * Columns (case-insensitive, any order): name, kind (angel | celebrity | nextgen | creator | buyer | media;
 * default angel), purpose (invest | ambassador | buyer | press | intro; default from kind), firm, role,
 * rice_connection, check_size, contact_path, summary, why_relevant, url (public source), location,
 * tags (";"-separated), score, linkedin_url, email.
 * Rows go through the same validation as research findings; a source URL is required.
 */

const ALIASES: Record<string, string> = {
  "full name": "name",
  company: "firm",
  organization: "firm",
  title: "role",
  "source url": "url",
  source: "url",
  linkedin: "linkedin_url",
  "linkedin url": "linkedin_url",
  "person linkedin url": "linkedin_url",
  "email address": "email",
  evidence: "summary",
  fit: "score",
  type: "kind",
};

export interface ProspectExtra {
  linkedin_url: string | null;
  email: string | null;
  purpose: Purpose | null;
}

export function parseProspectCsv(text: string): { rows: RawFindingT[]; extras: ProspectExtra[] } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], extras: [] };
  const head = table[0].map((h) => {
    const k = h.trim().toLowerCase().replace(/_/g, " ");
    return ALIASES[k] ?? k.replace(/ /g, "_");
  });
  const get = (r: string[], k: string) => {
    const i = head.indexOf(k);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };
  const rows: RawFindingT[] = [];
  const extras: ProspectExtra[] = [];
  for (const r of table.slice(1)) {
    const score = Number(get(r, "score"));
    // A blank kind means angel; anything else is kept as written so validation can reject it.
    const kind = get(r, "kind").toLowerCase() || "angel";
    const purpose = get(r, "purpose").toLowerCase();
    rows.push({
      kind,
      title: get(r, "name"),
      url: get(r, "url") || null,
      source: null,
      summary: get(r, "summary"),
      why_relevant: get(r, "why_relevant"),
      score: Number.isFinite(score) && get(r, "score") !== "" ? score : 70,
      tags: get(r, "tags").split(/[;|]/).map((t) => t.trim()).filter(Boolean),
      event_date: null,
      deadline: null,
      location: get(r, "location") || null,
      details: {
        firm: get(r, "firm") || null,
        role: get(r, "role") || null,
        rice_connection: get(r, "rice_connection") || null,
        check_size: get(r, "check_size") || null,
        contact_path: get(r, "contact_path") || null,
      },
    });
    extras.push({
      linkedin_url: get(r, "linkedin_url") || null,
      email: get(r, "email") || null,
      purpose: isPurpose(purpose) ? purpose : null,
    });
  }
  return { rows, extras };
}

export interface ImportResult {
  received: number;
  valid: number;
  inserted: number;
  updated: number;
  queued: number;
}

export async function importProspects(text: string, today = todayISO()): Promise<ImportResult> {
  const { rows, extras } = parseProspectCsv(text);
  const task = { id: "import", section: "sooz" as const, kinds: PERSON_KINDS, upcomingOnly: false };
  const candidates = validateCandidates(rows, task, today);
  const res = await persistCandidates(task, candidates);

  let queued = 0;
  for (const c of candidates) {
    const key = dedupeKey({ section: "sooz", kind: c.kind, title: c.title, url: c.url, firm: c.details.firm });
    const item = (await query<{ id: number }>(`select id from items where dedupe_key = $1`, [key]))[0];
    if (!item || !isPersonKind(c.kind)) continue;
    if (await addToPipeline(item.id)) queued++;
    // Carry contact fields and purpose through, but never overwrite contact info that's already there.
    const idx = rows.findIndex((r) => r.title.trim() === c.title && r.kind.trim().toLowerCase() === c.kind);
    const extra = idx >= 0 ? extras[idx] : undefined;
    if (extra?.purpose) await setPurpose(item.id, extra.purpose);
    const email = extra?.email && /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(extra.email) ? extra.email.toLowerCase() : null;
    const li = extra?.linkedin_url && /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#\s]+\/?$/i.test(extra.linkedin_url) ? extra.linkedin_url : null;
    if (email || li) {
      await query(
        `update outreach set email = coalesce(email, $2), email_source = case when email is null and $2::text is not null then 'import' else email_source end,
           linkedin_url = coalesce(linkedin_url, $3), updated_at = now() where item_id = $1`,
        [item.id, email, li],
      );
    }
  }
  return { received: rows.length, valid: candidates.length, ...res, queued };
}
