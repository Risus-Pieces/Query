import { saveNotes, updateStatus } from "@/app/actions";
import type { Item, Status } from "@/lib/types";

function StatusButton({ id, status, label, on }: { id: number; status: Status; label: string; on?: boolean }) {
  return (
    <form action={updateStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className="btn save" data-on={on ? "true" : undefined}>
        {label}
      </button>
    </form>
  );
}

function fmtDate(d: string): string {
  // d is YYYY-MM-DD; render in UTC so there's no off-by-one from the viewer's timezone.
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function ItemCard({ item }: { item: Item }) {
  const d = item.details ?? {};
  const isAngel = item.kind === "angel";
  const facts: [string, string][] = [];
  if (isAngel) {
    if (d.role || d.firm) facts.push(["Who", [d.role, d.firm].filter(Boolean).join(" · ")]);
    if (d.rice_connection) facts.push(["Rice", d.rice_connection]);
    if (d.check_size) facts.push(["Check size", d.check_size]);
    if (d.contact_path) facts.push(["Reach via", d.contact_path]);
  }

  const cls = ["card", item.status === "new" ? "is-new" : "", item.status === "dismissed" ? "is-dismissed" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cls}>
      <div className="head">
        <div>
          <h3>
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h3>
          <div className="badges">
            {item.status === "new" ? <span className="badge new">New</span> : null}
            <span className="badge kind">{item.kind}</span>
            {item.tags.includes("rice") ? <span className="badge rice">Rice</span> : null}
            {item.event_date ? <span className="badge when">{fmtDate(item.event_date)}</span> : null}
            {item.deadline ? <span className="badge deadline">Apply by {fmtDate(item.deadline)}</span> : null}
            {item.location ? <span className="badge">{item.location}</span> : null}
            {item.tags
              .filter((t) => t !== "rice")
              .slice(0, 4)
              .map((t) => (
                <span className="badge" key={t}>
                  {t}
                </span>
              ))}
          </div>
        </div>
        <span className={`score${item.score >= 75 ? " high" : ""}`} title="Fit score">
          {item.score}
        </span>
      </div>

      {item.summary ? <p className="summary">{item.summary}</p> : null}
      {item.why_relevant ? <p className="why">{item.why_relevant}</p> : null}

      {facts.length ? (
        <dl className="facts">
          {facts.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="actions">
        <StatusButton id={item.id} status="saved" label={item.status === "saved" ? "★ Saved" : "☆ Save"} on={item.status === "saved"} />
        {isAngel ? (
          <StatusButton id={item.id} status="contacted" label={item.status === "contacted" ? "✓ Contacted" : "Mark contacted"} on={item.status === "contacted"} />
        ) : null}
        {item.status === "dismissed" ? (
          <StatusButton id={item.id} status="seen" label="Restore" />
        ) : (
          <StatusButton id={item.id} status="dismissed" label="Dismiss" />
        )}
        {item.url ? <span style={{ color: "var(--muted)", fontSize: 12 }}>{host(item.url)}</span> : null}
      </div>

      <details className="notes">
        <summary>{item.notes ? "Notes ✎" : "Add notes"}</summary>
        <form action={saveNotes}>
          <input type="hidden" name="id" value={item.id} />
          <textarea name="notes" defaultValue={item.notes} placeholder="Intro paths, follow-ups, who to ask…" />
          <button className="btn">Save notes</button>
        </form>
      </details>
    </article>
  );
}
