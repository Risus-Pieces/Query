import { query } from "./db";
import type { Item, Section, Status } from "./types";

export const VIEWS = ["inbox", "saved", "contacted", "dismissed"] as const;
export type View = (typeof VIEWS)[number];

const VIEW_STATUSES: Record<View, Status[]> = {
  inbox: ["new", "seen"],
  saved: ["saved"],
  contacted: ["contacted"],
  dismissed: ["dismissed"],
};

export const SORTS = ["score", "date", "newest"] as const;
export type Sort = (typeof SORTS)[number];

export interface Filters {
  section: Section;
  view: View;
  kind?: string;
  q?: string;
  rice?: boolean;
  sort: Sort;
}

const COLS = `id, section, kind, title, url, source, summary, why_relevant, score, tags, details,
  event_date, deadline, location, status, notes, first_seen, last_seen`;

const ORDER: Record<Sort, string> = {
  score: "score desc, first_seen desc",
  // Soonest first; undated items (people, resources) go last.
  date: "coalesce(event_date, deadline) asc nulls last, score desc",
  newest: "first_seen desc, score desc",
};

export async function listItems(f: Filters): Promise<Item[]> {
  const params: unknown[] = [f.section, VIEW_STATUSES[f.view]];
  const where = ["section = $1", "status = any($2::text[])"];
  if (f.kind) {
    params.push(f.kind);
    where.push(`kind = $${params.length}`);
  }
  if (f.rice) where.push(`'rice' = any(tags)`);
  if (f.q) {
    params.push(`%${f.q.replace(/[%_\\]/g, "\\$&")}%`);
    const n = params.length;
    where.push(
      `(title ilike $${n} or summary ilike $${n} or why_relevant ilike $${n} or details::text ilike $${n} or array_to_string(tags, ' ') ilike $${n})`,
    );
  }
  // Past events are noise in the inbox; keep them if the user acted on them.
  if (f.view === "inbox") where.push(`(coalesce(event_date, deadline) is null or coalesce(event_date, deadline) >= current_date)`);

  return query<Item>(
    `select ${COLS} from items where ${where.join(" and ")} order by ${ORDER[f.sort]} limit 300`,
    params,
  );
}

export async function viewCounts(section: Section): Promise<Record<View, number>> {
  const rows = await query<{ status: Status; n: number }>(
    `select status, count(*)::int as n from items
      where section = $1
        and (status <> 'new' and status <> 'seen' or coalesce(event_date, deadline) is null or coalesce(event_date, deadline) >= current_date)
      group by status`,
    [section],
  );
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<Status, number>>;
  return {
    inbox: (by.new ?? 0) + (by.seen ?? 0),
    saved: by.saved ?? 0,
    contacted: by.contacted ?? 0,
    dismissed: by.dismissed ?? 0,
  };
}

export async function newCount(section: Section): Promise<number> {
  const rows = await query<{ n: number }>(
    `select count(*)::int as n from items where section = $1 and status = 'new'`,
    [section],
  );
  return rows[0]?.n ?? 0;
}

export async function kindCounts(section: Section, view: View): Promise<{ kind: string; n: number }[]> {
  return query<{ kind: string; n: number }>(
    `select kind, count(*)::int as n from items where section = $1 and status = any($2::text[]) group by kind order by n desc`,
    [section, VIEW_STATUSES[view]],
  );
}

export interface RunRow {
  task_id: string;
  section: string;
  started_at: string;
  finished_at: string | null;
  found: number;
  inserted: number;
  error: string | null;
}

export async function recentRuns(limit = 8): Promise<RunRow[]> {
  return query<RunRow>(
    `select task_id, section, started_at, finished_at, found, inserted, error
       from runs order by started_at desc limit $1`,
    [limit],
  );
}

export async function setStatus(id: number, status: Status): Promise<void> {
  await query(`update items set status = $2 where id = $1`, [id, status]);
}

export async function setNotes(id: number, notes: string): Promise<void> {
  await query(`update items set notes = $2 where id = $1`, [id, notes.slice(0, 4000)]);
}

export async function markAllSeen(section: Section): Promise<void> {
  await query(`update items set status = 'seen' where section = $1 and status = 'new'`, [section]);
}

export async function exportAngels(section: Section = "sooz"): Promise<Item[]> {
  return query<Item>(
    `select ${COLS} from items where section = $1 and kind = 'angel' and status <> 'dismissed'
      order by score desc, title`,
    [section],
  );
}
