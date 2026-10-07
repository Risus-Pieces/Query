import Link from "next/link";
import ItemCard from "@/components/ItemCard";
import { logout, seeAll } from "./actions";
import {
  SORTS,
  VIEWS,
  kindCounts,
  listItems,
  newCount,
  recentRuns,
  viewCounts,
  type Sort,
  type View,
} from "@/lib/items";
import { KINDS, SECTIONS, type Section } from "@/lib/types";

export const dynamic = "force-dynamic";

const SECTION_META: Record<Section, { label: string; tagline: string }> = {
  sooz: {
    label: "Sooz",
    tagline: "Angels, events and funding for a pre-seed food & beverage brand — Rice alumni first.",
  },
  personal: {
    label: "Personal",
    tagline: "AI & startup builds, leadership, culture — and anything else worth your time.",
  },
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function href(base: Record<string, string | undefined>, over: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/?${s}` : "/";
}

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const section = (SECTIONS as readonly string[]).includes(one(sp.section) ?? "") ? (one(sp.section) as Section) : "sooz";
  const view = (VIEWS as readonly string[]).includes(one(sp.view) ?? "") ? (one(sp.view) as View) : "inbox";
  const kind = KINDS[section].includes(one(sp.kind) ?? "") ? one(sp.kind) : undefined;
  const q = one(sp.q)?.trim().slice(0, 100) || undefined;
  const rice = one(sp.rice) === "1";
  const defaultSort: Sort = kind === "event" || kind === "hackathon" ? "date" : "score";
  const sort = (SORTS as readonly string[]).includes(one(sp.sort) ?? "") ? (one(sp.sort) as Sort) : defaultSort;

  const [items, counts, kinds, fresh, runs, soozNew, personalNew] = await Promise.all([
    listItems({ section, view, kind, q, rice, sort }),
    viewCounts(section),
    kindCounts(section, view),
    newCount(section),
    recentRuns(),
    newCount("sooz"),
    newCount("personal"),
  ]);
  const newBySection: Record<Section, number> = { sooz: soozNew, personal: personalNew };

  const base = { section, view: view === "inbox" ? undefined : view, kind, q, rice: rice ? "1" : undefined, sort: sort === defaultSort ? undefined : sort };
  const lastRun = runs.find((r) => r.finished_at && !r.error);

  return (
    <div className="wrap">
      <header className="top">
        <Link className="brand" href="/">
          Query<small>opportunity radar</small>
        </Link>
        <form action={logout}>
          <button className="linkbtn">Sign out</button>
        </form>
      </header>

      <nav className="tabs" aria-label="Section">
        {SECTIONS.map((s) => (
          <Link key={s} className="tab" href={`/?section=${s}`} aria-current={s === section ? "page" : undefined}>
            {SECTION_META[s].label}
            {newBySection[s] > 0 ? <span className="n">{newBySection[s]} new</span> : null}
          </Link>
        ))}
      </nav>
      <p className="tagline">{SECTION_META[section].tagline}</p>

      <div className="bar" role="tablist" aria-label="View">
        {VIEWS.map((v) => (
          <Link
            key={v}
            className="chip"
            aria-current={v === view ? "true" : undefined}
            href={href({ ...base, view: undefined, kind: undefined }, { view: v === "inbox" ? undefined : v })}
          >
            {v[0].toUpperCase() + v.slice(1)} {counts[v]}
          </Link>
        ))}
      </div>

      <div className="bar" aria-label="Type">
        <Link className="chip" aria-current={!kind ? "true" : undefined} href={href(base, { kind: undefined })}>
          All types
        </Link>
        {KINDS[section].map((k) => {
          const n = kinds.find((x) => x.kind === k)?.n ?? 0;
          if (!n && k !== kind) return null;
          return (
            <Link key={k} className="chip" aria-current={k === kind ? "true" : undefined} href={href(base, { kind: k })}>
              {k} {n}
            </Link>
          );
        })}
        {section === "sooz" ? (
          <>
            <span className="sep" />
            <Link className="chip" aria-current={rice ? "true" : undefined} href={href(base, { rice: rice ? undefined : "1" })}>
              Rice alumni only
            </Link>
          </>
        ) : null}
        <span className="sep" />
        {SORTS.map((s) => (
          <Link key={s} className="chip" aria-current={s === sort ? "true" : undefined} href={href(base, { sort: s })}>
            {s === "score" ? "Best fit" : s === "date" ? "Soonest" : "Newest"}
          </Link>
        ))}
      </div>

      <form className="search" action="/" method="get">
        <input type="hidden" name="section" value={section} />
        {view !== "inbox" ? <input type="hidden" name="view" value={view} /> : null}
        {kind ? <input type="hidden" name="kind" value={kind} /> : null}
        {rice ? <input type="hidden" name="rice" value="1" /> : null}
        <input type="search" name="q" defaultValue={q} placeholder="Search names, firms, topics…" aria-label="Search" />
        <button className="btn">Search</button>
        {section === "sooz" ? (
          <a className="btn" href="/api/export?section=sooz">
            Export angels CSV
          </a>
        ) : null}
      </form>

      <div className="meta-line">
        <span>
          {items.length} shown{items.length === 300 ? "+" : ""}
        </span>
        {lastRun?.finished_at ? <span>Last research: {new Date(lastRun.finished_at).toISOString().slice(0, 10)}</span> : <span>No research runs yet</span>}
        {fresh > 0 ? (
          <form action={seeAll}>
            <input type="hidden" name="section" value={section} />
            <button className="linkbtn">Mark {fresh} new as seen</button>
          </form>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="empty">
          {q || kind || rice ? "Nothing matches these filters." : view === "inbox" ? "Nothing here yet — the next research run will fill this in." : "Nothing in this view."}
        </div>
      ) : (
        items.map((i) => <ItemCard key={i.id} item={i} />)
      )}

      {runs.length > 0 ? (
        <details className="runs">
          <summary>Recent research runs</summary>
          <table>
            <tbody>
              {runs.map((r, i) => (
                <tr key={i}>
                  <td>{new Date(r.started_at).toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td>{r.task_id}</td>
                  <td className={r.error ? "err" : undefined}>{r.error ? r.error.slice(0, 80) : r.finished_at ? `${r.found} found · ${r.inserted} new` : "running…"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>
  );
}
