// Dev-only: fills a LOCAL database with clearly fictional rows so the dashboard can be previewed.
// Refuses to run against anything that isn't localhost.
import { closePool, query } from "../lib/db";
import { dedupeKey } from "../lib/dedupe";

const url = process.env.DATABASE_URL ?? "";
if (!/(@|\/\/)(localhost|127\.0\.0\.1)|host=\/|%2F/.test(url)) {
  console.error("seed-demo only runs against a local database.");
  process.exit(1);
}

const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

interface Seed {
  section: "sooz" | "personal";
  kind: string;
  title: string;
  summary: string;
  why: string;
  score: number;
  tags: string[];
  details?: Record<string, string>;
  event_date?: string;
  deadline?: string;
  location?: string;
  status?: string;
}

const seeds: Seed[] = [
  { section: "sooz", kind: "angel", title: "Demo Person A", summary: "Fictional angel who backs early-stage beverage brands (demo data).", why: "Rice MBA with prior beverage exit.", score: 91, tags: ["rice", "houston", "food-bev", "demo"], details: { firm: "Example Ventures", role: "Partner", rice_connection: "MBA '09", check_size: "$25-100k", contact_path: "Speaks at Rice Alliance events" } },
  { section: "sooz", kind: "angel", title: "Demo Person B", summary: "Fictional operator-angel, ex-retail buyer (demo data).", why: "Can open retail doors for a first launch.", score: 78, tags: ["houston", "retail", "demo"], details: { firm: "Sample Capital", role: "Venture partner", contact_path: "Angel group pitch nights" }, status: "saved" },
  { section: "sooz", kind: "angel", title: "Demo Person C", summary: "Fictional CPG founder turned angel (demo data).", why: "Portfolio is entirely better-for-you snacks.", score: 66, tags: ["rice", "snacks", "demo"], details: { firm: "Placeholder Fund", rice_connection: "BA '14" } },
  { section: "sooz", kind: "event", title: "Demo Natural Foods Expo", summary: "Fictional trade show for emerging food and beverage brands (demo data).", why: "Direct access to buyers and distributors.", score: 84, tags: ["expo", "food-bev", "demo"], event_date: day(21), deadline: day(9), location: "Anaheim, CA" },
  { section: "sooz", kind: "event", title: "Demo Investor Pitch Night", summary: "Fictional monthly angel pitch evening (demo data).", why: "Angels attend; friendly to pre-seed.", score: 72, tags: ["pitch", "houston", "demo"], event_date: day(6), location: "Houston, TX" },
  { section: "sooz", kind: "funding", title: "Demo Food Accelerator Cohort", summary: "Fictional 12-week accelerator for CPG startups (demo data).", why: "Check + retail network for pre-seed brands.", score: 80, tags: ["accelerator", "demo"], deadline: day(30), location: "Remote" },
  { section: "sooz", kind: "resource", title: "Demo Co-Packer Directory", summary: "Fictional directory of small-batch co-manufacturers (demo data).", why: "Needed before first production run.", score: 58, tags: ["co-packer", "demo"] },
  { section: "personal", kind: "hackathon", title: "Demo AI Builders Weekend", summary: "Fictional 48-hour AI hackathon (demo data).", why: "Squarely AI + startups.", score: 88, tags: ["ai", "hackathon", "demo"], event_date: day(12), location: "Austin, TX" },
  { section: "personal", kind: "leadership", title: "Demo Emerging Leaders Fellowship", summary: "Fictional six-month cohort program (demo data).", why: "Leadership development with a founder track.", score: 74, tags: ["fellowship", "demo"], deadline: day(25), location: "Hybrid" },
  { section: "personal", kind: "culture", title: "Demo Lunar New Year Night Market", summary: "Fictional cultural festival with food vendors (demo data).", why: "Cultural + food, very much your thing.", score: 63, tags: ["festival", "demo"], event_date: day(40), location: "Houston, TX" },
  { section: "personal", kind: "other", title: "Demo Open Call: Builders Residency", summary: "Fictional two-week residency for independent builders (demo data).", why: "Wildcard: funded and unusual.", score: 70, tags: ["residency", "demo"], deadline: day(18), location: "Lisbon" },
];

for (const s of seeds) {
  const u = `https://example.com/demo/${s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  await query(
    `insert into items (section, kind, title, url, summary, why_relevant, score, tags, details, event_date, deadline, location, dedupe_key, status, task_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'demo')
     on conflict (dedupe_key) do nothing`,
    [
      s.section, s.kind, s.title, u, s.summary, s.why, s.score, s.tags, JSON.stringify(s.details ?? {}),
      s.event_date ?? null, s.deadline ?? null, s.location ?? null,
      dedupeKey({ section: s.section, kind: s.kind, title: s.title, url: u, event_date: s.event_date, firm: s.details?.firm }),
      s.status ?? "new",
    ],
  );
}
await query(`insert into runs (task_id, section, finished_at, found, inserted) values ('demo','sooz', now(), $1, $1)`, [seeds.length]);
console.log(`Seeded ${seeds.length} demo rows.`);
await closePool();
