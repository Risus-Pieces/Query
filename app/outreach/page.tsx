import Link from "next/link";
import Header from "@/components/Header";
import ProspectCard from "@/components/ProspectCard";
import { TrayIcon } from "@/components/icons";
import { newCount } from "@/lib/items";
import { bucket, getPitch, listProspects, missingPitch, networkSize, warmMatches, type Prospect } from "@/lib/outreach";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Section({ title, hint, items, render }: { title: string; hint?: string; items: Prospect[]; render: (p: Prospect) => React.ReactNode }) {
  if (!items.length) return null;
  return (
    <section className="section">
      <h2 className="section-head">
        {title} <span className="count">{items.length}</span>
      </h2>
      {hint ? <p className="section-hint">{hint}</p> : null}
      <div className="group">{items.map(render)}</div>
    </section>
  );
}

export default async function OutreachPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const [rows, pitch, netSize, soozNew, personalNew] = await Promise.all([
    listProspects(),
    getPitch(),
    networkSize(),
    newCount("sooz"),
    newCount("personal"),
  ]);
  const b = bucket(rows, today);
  const warm = await warmMatches(rows.filter((r) => r.stage !== "closed" && r.stage !== "passed").map((r) => r.item_id));
  const missing = missingPitch(pitch);
  const actions = b.due.length + b.drafts.length;
  const card = (p: Prospect) => <ProspectCard key={p.item_id} p={p} pitch={pitch} warm={warm.get(p.item_id) ?? []} today={today} />;
  const err = one(sp.err);

  return (
    <div className="wrap">
      <Header
        active="outreach"
        subtitle="Specific angels, drafted one-to-one, sent by you. Follow-ups and replies are tracked for you."
        badges={{ sooz: soozNew, personal: personalNew, outreach: actions }}
      />

      <div className="tiles">
        <div className="tile"><span className="n">{b.drafts.length}</span><span>To review</span></div>
        <div className="tile"><span className="n">{b.due.length}</span><span>Follow-ups due</span></div>
        <div className="tile"><span className="n">{b.waiting.length}</span><span>Waiting</span></div>
        <div className="tile"><span className="n">{b.live.length}</span><span>Replies</span></div>
      </div>

      {err ? <p className="banner error-banner">{err}</p> : null}
      {missing.length ? (
        <p className="banner">
          Add your pitch facts ({missing.join(", ")}) in <Link href="/settings">Settings</Link> so drafts don&apos;t contain placeholders.
        </p>
      ) : null}
      {netSize === 0 ? (
        <p className="banner">
          Import your LinkedIn connections in <Link href="/settings">Settings</Link> to see who can introduce you to each angel.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="empty">
          <TrayIcon />
          <span>
            No one in the pipeline yet. Add angels from the <Link href="/?section=sooz&kind=angel">Sooz list</Link>, or import a CSV in{" "}
            <Link href="/settings">Settings</Link>.
          </span>
        </div>
      ) : null}

      <Section title="Follow-ups due" hint="No reply yet — a short, polite nudge." items={b.due} render={card} />
      <Section title="Drafts to review" hint="Edit if needed, open in Gmail, send from your own inbox, then mark sent." items={b.drafts} render={card} />
      <Section title="Needs a draft" hint="The weekly routine drafts these; or start one from the template." items={b.prospects} render={card} />
      <Section title="Replies & meetings" items={b.live} render={card} />
      <Section title="Waiting for a reply" items={b.waiting} render={card} />
      {b.closed.length ? (
        <details className="runs">
          <summary>Closed ({b.closed.length})</summary>
          <div className="group" style={{ marginTop: 8 }}>{b.closed.map(card)}</div>
        </details>
      ) : null}

      <p className="fineprint">
        Send one-to-one from your own inbox and keep the first note relationship-first. Contacting people you don&apos;t already know about an
        investment can count as general solicitation under SEC Reg D — confirm your 506(b)/506(c) approach with counsel before a broad push.
      </p>
    </div>
  );
}
