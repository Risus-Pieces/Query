import { exportPeople } from "@/lib/items";
import { SECTIONS, type Section } from "@/lib/types";

export const dynamic = "force-dynamic";

const csv = (v: unknown) => {
  let s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection from scraped text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("section") ?? "sooz";
  const section = (SECTIONS as readonly string[]).includes(raw) ? (raw as Section) : "sooz";
  const rows = await exportPeople(section);
  const header = ["name", "kind", "firm", "role", "rice_connection", "check_size", "contact_path", "fit", "status", "summary", "source_url", "notes"];
  const lines = [header.join(",")];
  for (const i of rows) {
    lines.push(
      [
        i.title,
        i.kind,
        i.details.firm,
        i.details.role,
        i.details.rice_connection,
        i.details.check_size,
        i.details.contact_path,
        i.score,
        i.status,
        i.summary,
        i.url,
        i.notes,
      ]
        .map(csv)
        .join(","),
    );
  }
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="people-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
