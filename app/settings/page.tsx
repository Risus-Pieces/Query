import Header from "@/components/Header";
import { newCount } from "@/lib/items";
import { PITCH_FIELDS, getPitch, networkSize } from "@/lib/outreach";
import { importConnectionsAction, importProspectsAction, savePitchAction } from "../outreach/actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [pitch, net, soozNew, personalNew] = await Promise.all([getPitch(), networkSize(), newCount("sooz"), newCount("personal")]);
  const err = one(sp.err);
  const ok =
    one(sp.saved) === "pitch"
      ? "Pitch facts saved."
      : one(sp.network)
        ? `Imported ${one(sp.network)} connections.`
        : one(sp.imported) !== undefined
          ? `Imported ${one(sp.imported)} of ${one(sp.received)} angels; ${one(sp.queued)} in the outreach pipeline.`
          : null;

  return (
    <div className="wrap">
      <Header active="settings" subtitle="Pitch facts for drafts, your network for warm intros, and imports." badges={{ sooz: soozNew, personal: personalNew }} />
      {err ? <p className="banner error-banner">{err}</p> : null}
      {ok ? <p className="banner ok-banner">{ok}</p> : null}

      <section className="section">
        <h2 className="section-head">Pitch facts</h2>
        <p className="section-hint">Drafts only use what you enter here plus each angel&apos;s public, sourced background. Leave anything unverified blank.</p>
        <form action={savePitchAction} className="group form-group">
          {PITCH_FIELDS.map((f) => (
            <label key={f.key} className="row-field">
              <span>{f.label}</span>
              {f.key === "pitch.one_liner" || f.key === "pitch.traction" ? (
                <textarea name={f.key} rows={2} defaultValue={pitch[f.key] ?? ""} placeholder={f.placeholder} />
              ) : (
                <input name={f.key} defaultValue={pitch[f.key] ?? ""} placeholder={f.placeholder} />
              )}
            </label>
          ))}
          <div className="row-field end">
            <button className="btn primary">Save pitch facts</button>
          </div>
        </form>
      </section>

      <section className="section">
        <h2 className="section-head">Your network <span className="count">{net}</span></h2>
        <p className="section-hint">
          LinkedIn → Settings &amp; Privacy → Data privacy → Get a copy of your data → <b>Connections</b>. Upload the Connections.csv; each angel
          card then shows who you already know at their firm (or if you&apos;re already connected).
        </p>
        <form action={importConnectionsAction} className="group form-group">
          <label className="row-field">
            <span>Connections.csv</span>
            <input type="file" name="file" accept=".csv,text/csv" required />
          </label>
          <div className="row-field end">
            <button className="btn primary">Import connections</button>
          </div>
        </form>
      </section>

      <section className="section">
        <h2 className="section-head">Import angels</h2>
        <p className="section-hint">
          CSV with columns: name, firm, role, rice_connection, check_size, contact_path, summary, why_relevant, url (public source, required),
          location, tags, score, linkedin_url, email. Rows are validated like research findings and added to the outreach pipeline.
        </p>
        <form action={importProspectsAction} className="group form-group">
          <label className="row-field">
            <span>Angels CSV</span>
            <input type="file" name="file" accept=".csv,text/csv" required />
          </label>
          <div className="row-field end">
            <button className="btn primary">Import angels</button>
          </div>
        </form>
      </section>

      <section className="section">
        <h2 className="section-head">How outreach works</h2>
        <div className="group prose">
          <p>
            <b>Weekly, automatically:</b> new high-fit angels join the pipeline; the routine looks up public profiles, drafts a personal email,
            LinkedIn note, intro request and two follow-ups; it watches Gmail to notice when you&apos;ve sent and when someone replies.
          </p>
          <p>
            <b>Always by you:</b> reviewing and sending. Nothing is sent automatically — that protects your sender reputation, keeps notes
            genuinely personal, and keeps you in control of who hears about your raise.
          </p>
        </div>
      </section>
    </div>
  );
}
