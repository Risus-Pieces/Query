import type { CSSProperties } from "react";
import { draftFromTemplate, outreachAction, saveProspect } from "@/app/outreach/actions";
import { gmailComposeUrl, linkedinSearchUrl, MAX_TOUCHES, type Pitch, type Prospect, type WarmMatch } from "@/lib/outreach";
import CopyButton from "./CopyButton";
import { ChevronIcon, LinkIcon, MailIcon, SparkleIcon, XIcon } from "./icons";

const STAGE_LABEL: Record<Prospect["stage"], string> = {
  prospect: "Needs draft",
  drafted: "Draft ready",
  sent: "Sent",
  replied: "Replied",
  meeting: "Meeting",
  passed: "Passed",
  closed: "Closed",
};

function Act({ id, action, label, className = "btn" }: { id: number; action: string; label: string; className?: string }) {
  return (
    <form action={outreachAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <button className={className}>{label}</button>
    </form>
  );
}

function fmt(d: string | null): string {
  if (!d) return "";
  return new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function ProspectCard({
  p,
  pitch,
  warm,
  today,
}: {
  p: Prospect;
  pitch: Pitch;
  warm: WarmMatch[];
  today: string;
}) {
  const d = p.details ?? {};
  const from = pitch["pitch.sender_email"] || null;
  const ring = {
    "--p": p.score,
    "--c": p.score >= 80 ? "var(--green)" : p.score >= 60 ? "var(--blue)" : "var(--orange)",
  } as CSSProperties;
  const followupText = p.touches <= 1 ? p.followup_1 : p.followup_2;
  const due = p.stage === "sent" && p.next_followup_at !== null && p.next_followup_at <= today && p.touches < MAX_TOUCHES;
  const selfMatch = warm.find((w) => w.kind === "same_person");
  const firmMatches = warm.filter((w) => w.kind === "same_company");
  const liHref = p.linkedin_url || linkedinSearchUrl(p.name, d.firm);

  return (
    <article className="card prospect" id={`p-${p.item_id}`}>
      <div className="head">
        <div>
          <h3>{p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a> : p.name}</h3>
          <div className="sub">{[d.role, d.firm].filter(Boolean).join(" · ") || "Angel investor"}</div>
          <div className="badges">
            <span className={`badge stage-${p.stage}`}>{due ? "Follow-up due" : STAGE_LABEL[p.stage]}</span>
            {d.rice_connection ? <span className="badge rice">Rice · {d.rice_connection}</span> : null}
            {selfMatch ? <span className="badge when">1st-degree connection</span> : null}
            {firmMatches.length ? <span className="badge when">Warm path</span> : null}
            {p.email ? <span className="badge">Email ✓</span> : null}
            {p.linkedin_url ? <span className="badge">LinkedIn ✓</span> : null}
            {p.stage === "sent" && p.next_followup_at ? <span className="badge">Next touch {fmt(p.next_followup_at)}</span> : null}
            {p.touches > 0 ? <span className="badge">{p.touches}/{MAX_TOUCHES} touches</span> : null}
          </div>
        </div>
        <span className="ring" style={ring} role="img" aria-label={`Fit score ${p.score} out of 100`}>
          <span>{p.score}</span>
        </span>
      </div>

      {p.summary ? <p className="summary">{p.summary}</p> : null}
      {p.why_relevant ? <p className="why">{p.why_relevant}</p> : null}

      {d.check_size || d.contact_path || p.warm_path || warm.length ? (
        <dl className="facts">
          {d.check_size ? (<><dt>Check size</dt><dd>{d.check_size}</dd></>) : null}
          {d.contact_path ? (<><dt>Public path</dt><dd>{d.contact_path}</dd></>) : null}
          {p.warm_path ? (<><dt>Warm path</dt><dd>{p.warm_path}</dd></>) : null}
          {firmMatches.length ? (
            <>
              <dt>You know</dt>
              <dd>
                {firmMatches.map((w, i) => (
                  <span key={i}>
                    {i ? ", " : ""}
                    {w.linkedin_url ? <a href={w.linkedin_url} target="_blank" rel="noopener noreferrer">{w.full_name}</a> : w.full_name}
                    {w.position ? ` (${w.position})` : ""}
                  </span>
                ))}{" "}
                at {firmMatches[0].company}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {p.body && (p.stage === "drafted" || due) ? (
        <div className="draft">
          <div className="draft-label">{due ? `Follow-up ${p.touches}` : "Email draft"}{p.drafted_by ? ` · by ${p.drafted_by}` : ""}</div>
          {!due && p.subject ? <div className="draft-subject">{p.subject}</div> : null}
          <pre className="draft-body">{due ? followupText ?? "" : p.body}</pre>
        </div>
      ) : null}

      <div className="actions">
        {p.stage === "prospect" ? (
          <form action={draftFromTemplate}>
            <input type="hidden" name="id" value={p.item_id} />
            <button className="btn primary"><SparkleIcon size={15} />Draft from template</button>
          </form>
        ) : null}

        {p.stage === "drafted" ? (
          <>
            <a
              className="btn primary"
              href={gmailComposeUrl({ to: p.email, subject: p.subject, body: p.body, from })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MailIcon size={15} />
              Open in Gmail
            </a>
            <Act id={p.item_id} action="mark_sent" label="Mark sent" />
          </>
        ) : null}

        {due && followupText ? (
          <>
            <a
              className="btn primary"
              href={gmailComposeUrl({ to: p.email, subject: p.subject ? `Re: ${p.subject}` : null, body: followupText, from })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MailIcon size={15} />
              Open follow-up
            </a>
            <Act id={p.item_id} action="followup_sent" label="Mark follow-up sent" />
          </>
        ) : null}

        {(p.stage === "drafted" || p.stage === "sent") && p.linkedin_note ? (
          <CopyButton text={p.linkedin_note} label="Copy LinkedIn note" />
        ) : null}
        {p.stage !== "passed" && p.stage !== "closed" ? (
          <a className="btn" href={liHref} target="_blank" rel="noopener noreferrer">
            <LinkIcon size={15} />
            {p.linkedin_url ? "LinkedIn" : "Find on LinkedIn"}
          </a>
        ) : null}
        {p.intro_request && (p.stage === "drafted" || p.stage === "prospect") ? (
          <a
            className="btn"
            href={gmailComposeUrl({ subject: `Intro to ${p.name}?`, body: p.intro_request, from })}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ask for intro
          </a>
        ) : null}

        {p.stage === "sent" ? <Act id={p.item_id} action="replied" label="They replied" /> : null}
        {p.stage === "replied" ? <Act id={p.item_id} action="meeting" label="Meeting booked" className="btn done" /> : null}
        {p.stage === "passed" || p.stage === "closed" ? (
          <Act id={p.item_id} action="reopen" label="Reopen" />
        ) : (
          <form action={outreachAction}>
            <input type="hidden" name="id" value={p.item_id} />
            <input type="hidden" name="action" value={p.stage === "replied" || p.stage === "meeting" ? "passed" : "close"} />
            <button className="btn danger">
              <XIcon size={15} />
              {p.stage === "replied" || p.stage === "meeting" ? "They passed" : "Not pursuing"}
            </button>
          </form>
        )}
      </div>

      {p.stage === "prospect" || p.stage === "drafted" || p.stage === "sent" ? (
        <details className="notes">
          <summary>
            <ChevronIcon size={14} />
            Edit contact & drafts
          </summary>
          <form action={saveProspect} className="edit-grid">
            <input type="hidden" name="id" value={p.item_id} />
            <label>
              <span>Email</span>
              <input name="email" type="email" defaultValue={p.email ?? ""} placeholder="Only a verified, professional address" />
            </label>
            <label>
              <span>LinkedIn URL</span>
              <input name="linkedin_url" defaultValue={p.linkedin_url ?? ""} placeholder="https://www.linkedin.com/in/…" />
            </label>
            <label className="wide">
              <span>Warm path</span>
              <input name="warm_path" defaultValue={p.warm_path ?? ""} placeholder="Who could introduce you, and how you know them" />
            </label>
            <label className="wide">
              <span>Subject</span>
              <input name="subject" defaultValue={p.subject ?? ""} />
            </label>
            <label className="wide">
              <span>Email</span>
              <textarea name="body" rows={9} defaultValue={p.body ?? ""} />
            </label>
            <label className="wide">
              <span>LinkedIn note (max 300)</span>
              <textarea name="linkedin_note" rows={3} maxLength={300} defaultValue={p.linkedin_note ?? ""} />
            </label>
            <label className="wide">
              <span>Intro request (to a mutual)</span>
              <textarea name="intro_request" rows={5} defaultValue={p.intro_request ?? ""} />
            </label>
            <label className="wide">
              <span>Follow-up 1 (day 5)</span>
              <textarea name="followup_1" rows={4} defaultValue={p.followup_1 ?? ""} />
            </label>
            <label className="wide">
              <span>Follow-up 2 (day 12)</span>
              <textarea name="followup_2" rows={4} defaultValue={p.followup_2 ?? ""} />
            </label>
            <div className="wide">
              <button className="btn primary">Save</button>
            </div>
          </form>
        </details>
      ) : null}
    </article>
  );
}
