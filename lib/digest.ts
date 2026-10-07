import { query } from "./db";
import type { Item, Section } from "./types";

export interface DigestData {
  fresh: Record<Section, Item[]>; // newly found, not yet emailed
  upcoming: Item[]; // events / deadlines in the next 14 days worth acting on
  generatedAt: string; // YYYY-MM-DD
}

const COLS = `id, section, kind, title, url, source, summary, why_relevant, score, tags, details,
  event_date, deadline, location, status, notes, first_seen, last_seen`;

export async function collectDigest(minScore: number, today: string): Promise<DigestData> {
  const fresh = await query<Item>(
    `select ${COLS} from items
      where digested_at is null and status = 'new' and score >= $1
      order by section, score desc, first_seen desc`,
    [minScore],
  );
  const upcoming = await query<Item>(
    `select ${COLS} from items
      where status in ('new','seen','saved','contacted')
        and (
          (event_date is not null and event_date between $1::date and $1::date + 14)
          or (deadline is not null and deadline between $1::date and $1::date + 14)
        )
      order by coalesce(event_date, deadline), score desc`,
    [today],
  );
  return {
    fresh: {
      sooz: fresh.filter((i) => i.section === "sooz"),
      personal: fresh.filter((i) => i.section === "personal"),
    },
    upcoming,
    generatedAt: today,
  };
}

export async function markDigested(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await query(`update items set digested_at = now() where id = any($1::bigint[])`, [ids]);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function when(i: Item): string {
  const parts: string[] = [];
  if (i.event_date) parts.push(i.event_date);
  if (i.deadline) parts.push(`apply by ${i.deadline}`);
  if (i.location) parts.push(i.location);
  return parts.join(" · ");
}

function angelLine(i: Item): string {
  const d = i.details;
  const bits = [d.role, d.firm, d.rice_connection && `Rice: ${d.rice_connection}`, d.check_size]
    .filter(Boolean)
    .join(" · ");
  return bits;
}

function itemHtml(i: Item): string {
  const meta = i.kind === "angel" ? angelLine(i) : when(i);
  const path = i.kind === "angel" && i.details.contact_path ? `<div style="color:#555">Path: ${esc(i.details.contact_path)}</div>` : "";
  const title = i.url
    ? `<a href="${esc(i.url)}" style="color:#1a56db;text-decoration:none"><b>${esc(i.title)}</b></a>`
    : `<b>${esc(i.title)}</b>`;
  return `<li style="margin:0 0 14px">
    ${title} <span style="color:#888;font-size:12px">· ${esc(i.kind)} · fit ${i.score}</span>
    ${meta ? `<div style="color:#555">${esc(meta)}</div>` : ""}
    <div>${esc(i.summary)}</div>
    <div style="color:#555"><i>${esc(i.why_relevant)}</i></div>${path}
  </li>`;
}

function itemText(i: Item): string {
  const meta = i.kind === "angel" ? angelLine(i) : when(i);
  return [
    `- ${i.title} [${i.kind}, fit ${i.score}]${meta ? ` — ${meta}` : ""}`,
    `  ${i.summary}`,
    i.url ? `  ${i.url}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function digestCount(d: DigestData): number {
  return d.fresh.sooz.length + d.fresh.personal.length;
}

export function renderDigest(d: DigestData, dashboardUrl?: string) {
  const n = digestCount(d);
  const subject = `Query digest: ${n} new find${n === 1 ? "" : "s"}${
    d.upcoming.length ? `, ${d.upcoming.length} coming up` : ""
  } (${d.generatedAt})`;

  const block = (heading: string, items: Item[]) =>
    items.length
      ? `<h2 style="font-size:16px;margin:24px 0 8px">${esc(heading)} (${items.length})</h2><ul style="padding-left:18px;margin:0">${items
          .map(itemHtml)
          .join("")}</ul>`
      : "";
  const textBlock = (heading: string, items: Item[]) =>
    items.length ? `\n${heading.toUpperCase()} (${items.length})\n${items.map(itemText).join("\n")}\n` : "";

  // Anything already shown under "coming up" isn't repeated in the new-finds blocks.
  const shown = new Set(d.upcoming.map((i) => i.id));
  const freshSooz = d.fresh.sooz.filter((i) => !shown.has(i.id));
  const freshPersonal = d.fresh.personal.filter((i) => !shown.has(i.id));
  const soozAngels = freshSooz.filter((i) => i.kind === "angel");
  const soozOther = freshSooz.filter((i) => i.kind !== "angel");

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#111;line-height:1.45">
  <h1 style="font-size:20px;margin:0 0 4px">Query digest</h1>
  <div style="color:#666">${esc(d.generatedAt)}${dashboardUrl ? ` · <a href="${esc(dashboardUrl)}">Open dashboard</a>` : ""}</div>
  ${n === 0 ? `<p>Nothing new this week.</p>` : ""}
  ${block("Coming up in the next 14 days", d.upcoming)}
  ${block("Sooz — new angels", soozAngels)}
  ${block("Sooz — events, funding & resources", soozOther)}
  ${block("Personal", freshPersonal)}
  </body></html>`;

  const text = [
    `QUERY DIGEST — ${d.generatedAt}`,
    dashboardUrl ? `Dashboard: ${dashboardUrl}` : "",
    n === 0 ? "\nNothing new this week." : "",
    textBlock("Coming up in the next 14 days", d.upcoming),
    textBlock("Sooz — new angels", soozAngels),
    textBlock("Sooz — events, funding & resources", soozOther),
    textBlock("Personal", freshPersonal),
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export interface MailConfig {
  apiKey: string;
  to: string;
  from: string;
}

export function mailConfigFromEnv(env = process.env): MailConfig | null {
  if (!env.RESEND_API_KEY || !env.DIGEST_TO || !env.DIGEST_FROM) return null;
  return { apiKey: env.RESEND_API_KEY, to: env.DIGEST_TO, from: env.DIGEST_FROM };
}

export async function sendEmail(
  cfg: MailConfig,
  mail: { subject: string; html: string; text: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.from,
      to: cfg.to.split(",").map((s) => s.trim()),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
}
