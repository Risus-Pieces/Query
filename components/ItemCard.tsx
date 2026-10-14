import type { CSSProperties } from "react";
import Link from "next/link";
import { saveNotes, updateStatus } from "@/app/actions";
import { addToOutreach } from "@/app/outreach/actions";
import type { Stage } from "@/lib/outreach";
import { isPersonKind, type Item, type Status } from "@/lib/types";
import { CheckCircleIcon, ChevronIcon, PersonPlusIcon, StarIcon, UndoIcon, XIcon } from "./icons";

function StatusButton({
  id,
  status,
  label,
  className,
  on,
  icon,
}: {
  id: number;
  status: Status;
  label: string;
  className?: string;
  on?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <form action={updateStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={`btn ${className ?? ""}`} data-on={on ? "true" : undefined}>
        {icon}
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

function ringColor(score: number): string {
  return score >= 80 ? "var(--green)" : score >= 60 ? "var(--blue)" : "var(--orange)";
}

export default function ItemCard({ item, outreachStage = null }: { item: Item; outreachStage?: Stage | null }) {
  const d = item.details ?? {};
  const isPerson = isPersonKind(item.kind);
  const canOutreach = isPerson && item.section === "sooz";
  const facts: [string, string][] = [];
  if (isPerson) {
    if (d.role || d.firm) facts.push(["Who", [d.role, d.firm].filter(Boolean).join(" · ")]);
    if (d.rice_connection) facts.push(["Rice", d.rice_connection]);
    if (d.check_size) facts.push(["Check size", d.check_size]);
    if (d.contact_path) facts.push(["Reach via", d.contact_path]);
  }

  const cls = ["card", item.status === "dismissed" ? "is-dismissed" : ""].filter(Boolean).join(" ");
  const ring = { "--p": item.score, "--c": ringColor(item.score) } as CSSProperties;

  return (
    <article className={cls}>
      {item.status === "new" ? <span className="dot" role="img" aria-label="New" /> : null}
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
            <span className="badge kind">{item.kind === "nextgen" ? "next-gen" : item.kind === "media" ? "press" : item.kind}</span>
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
        <span className="ring" style={ring} role="img" aria-label={`Fit score ${item.score} out of 100`} title="Fit score">
          <span>{item.score}</span>
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
        <StatusButton
          id={item.id}
          status="saved"
          className="save"
          on={item.status === "saved"}
          icon={<StarIcon filled={item.status === "saved"} />}
          label={item.status === "saved" ? "Saved" : "Save"}
        />
        {isPerson ? (
          <StatusButton
            id={item.id}
            status="contacted"
            className="done"
            on={item.status === "contacted"}
            icon={<CheckCircleIcon />}
            label={item.status === "contacted" ? "Contacted" : "Mark contacted"}
          />
        ) : null}
        {canOutreach && item.status !== "dismissed" ? (
          outreachStage ? (
            <Link className="btn done" data-on="true" href={`/outreach#p-${item.id}`}>
              <PersonPlusIcon size={15} />
              In outreach
            </Link>
          ) : (
            <form action={addToOutreach}>
              <input type="hidden" name="id" value={item.id} />
              <button className="btn">
                <PersonPlusIcon size={15} />
                Add to outreach
              </button>
            </form>
          )
        ) : null}
        {item.status === "dismissed" ? (
          <StatusButton id={item.id} status="seen" icon={<UndoIcon />} label="Restore" />
        ) : (
          <StatusButton id={item.id} status="dismissed" className="danger" icon={<XIcon />} label="Dismiss" />
        )}
        {item.url ? <span className="src">{host(item.url)}</span> : null}
      </div>

      <details className="notes">
        <summary>
          <ChevronIcon size={14} />
          {item.notes ? "Notes" : "Add notes"}
        </summary>
        <form action={saveNotes}>
          <input type="hidden" name="id" value={item.id} />
          <textarea name="notes" defaultValue={item.notes} placeholder="Intro paths, follow-ups, who to ask…" />
          <button className="btn">Save notes</button>
        </form>
      </details>
    </article>
  );
}
