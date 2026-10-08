import type { Section } from "./types";

/**
 * Research tasks. Each task is one focused agent run (search -> notes -> structured extraction).
 * Narrow tasks beat one giant prompt: better recall, easier to debug, and one failure doesn't sink the rest.
 *
 * To change what the tool hunts for, edit the profiles and task briefs below.
 */

export interface ResearchTask {
  id: string;
  section: Section;
  label: string;
  /** Item kinds this task is allowed to emit. */
  kinds: readonly string[];
  /** What to find. Interpolated into the shared research prompt. */
  brief: string;
  /** Whether findings are time-boxed (events) — enables the "must be upcoming" rule. */
  upcomingOnly: boolean;
  maxSearches: number;
}

export const SOOZ_PROFILE = `Sooz is a pre-seed food and beverage consumer packaged goods (CPG) startup.
It is raising its first outside capital (angel / pre-seed). Founders want:
(1) reachable angel investors and operators who back early-stage food & beverage brands,
    with a strong preference for Rice University alumni (warm intros),
(2) events where they can meet investors, retail buyers, distributors and other founders,
(3) funding sources and resources suited to a pre-revenue / early-revenue CPG brand.`;

export const PERSONAL_PROFILE = `The user is a founder-minded, technically curious person with broad interests.
Strongest interests: AI and startups (hackathons, builder events, demo days), leadership development,
and cultural opportunities. They are also open to "anything interesting" — fellowships, unusual
programs, competitions, talks, travel-adjacent or community experiences, jobs that fit a founder/operator.`;

const SOOZ = "sooz" as const;
const PERSONAL = "personal" as const;

export const TASKS: ResearchTask[] = [
  {
    id: "sooz-angels-rice",
    section: SOOZ,
    label: "Angels: Rice network (individuals)",
    kinds: ["angel"],
    upcomingOnly: false,
    maxSearches: 12,
    brief: `Find INDIVIDUAL PEOPLE connected to Rice University who could invest in or open doors for a pre-seed beverage
brand: Rice alumni who angel invest, Rice-affiliated angel-network leads and members, Rice Business Plan Competition
judges and investor-panelists, Rice Alliance / Liu Idea Lab (Lilie) / OwlSpark mentors and advisors who invest,
Rice Business (Jones) alumni at consumer funds, and Rice alumni who founded or ran CPG/food/beverage brands.
Each item is ONE PERSON (title = full name). Never submit a group, fund or program as an item — if you only find a
group, search for its publicly named leaders, committee chairs or members and submit them instead.
Fill firm, role, rice_connection (only if a source states it, e.g. "MBA '09"), check_size (only if stated), and
contact_path: the most credible public route (e.g. "Rice Alliance mentor — ask the Rice Alliance team for an intro",
"judge at RBPC 2026"). Prefer people with evidence of consumer/CPG/food interest; still include strong Rice
connectors (score lower if no consumer signal). Never guess or invent emails or phone numbers.`,
  },
  {
    id: "sooz-angels-cpg",
    section: SOOZ,
    label: "Angels: beverage & CPG operators (individuals)",
    kinds: ["angel"],
    upcomingOnly: false,
    maxSearches: 14,
    brief: `Find INDIVIDUAL angel investors who wrote pre-seed or seed checks into beverage, food or CPG brands in the last
24 months. The best evidence is a round announcement that names them, so mine recent funding news: search BevNET,
NOSH, Taste Radio, Food Dive, FoodNavigator-USA, Indie CPG, PR Newswire and Business Wire for phrases like
"participation from angel investors including", "seasoned CPG operators", "other participants included" together
with "pre-seed" or "seed" and "beverage". Also look at operator-angels (founders/executives of scaled or exited
beverage and CPG brands), CPG syndicate leads (e.g. The Angel Group, Consumer Packaged Growth on AngelList), Startup
CPG "Investor Spotlight" guests, and NFX Signal / OpenVC food & beverage angel lists. Each item is ONE PERSON
(title = full name) with firm/role, a one-line proof in summary naming the brands they backed and when, check_size
only if stated, and a public contact_path (syndicate page, community, podcast, event). Score higher for beverage
specifically, for repeat recent checks, and for Texas ties. Never submit a fund or group as an item.`,
  },
  {
    id: "sooz-angels-texas",
    section: SOOZ,
    label: "Angels: Texas consumer investors (individuals)",
    kinds: ["angel"],
    upcomingOnly: false,
    maxSearches: 12,
    brief: `Find INDIVIDUAL angel investors in Texas who back early-stage consumer/CPG brands. Austin is the Texas CPG hub:
look at SKU accelerator mentors and investors, Naturally Austin leaders, Central Texas Angel Network members active in
consumer, and Austin founders/executives of brands that scaled or exited (beverage, snacks, natural foods) who now
angel invest. Also Houston (Houston Angel Network consumer committee members, TiE Houston Angels food & beverage
investors, Houston consumer founders who invest) and Dallas (consumer angels, Dallas Angel Network). Each item is ONE
PERSON with evidence of consumer/CPG angel activity (named portfolio brands, a quote, a committee role), check_size
only if stated, and a public contact_path. Never submit a group as an item; find its named people.`,
  },
  {
    id: "sooz-events-cpg",
    section: SOOZ,
    label: "Events: CPG & food/bev",
    kinds: ["event"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find upcoming CPG and food & beverage industry events a pre-seed brand should attend or apply to:
trade shows and expos (natural/specialty food, beverage, retail), retailer pitch days / buyer meetings,
CPG founder conferences, food-tech and food-innovation summits, distributor and broker showcases, and
food/bev pitch competitions. Prefer events in the next 6 months; include region, price/application notes in
summary, and an application or registration deadline when one exists. Use kind "event".`,
  },
  {
    id: "sooz-events-fundraising",
    section: SOOZ,
    label: "Events: fundraising & investors",
    kinds: ["event", "funding"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find upcoming fundraising-related opportunities for a pre-seed startup raising angel money:
investor meetups and angel-group pitch nights, demo days, startup pitch competitions (esp. consumer / food /
Texas / Rice-affiliated, e.g. Rice Business Plan Competition), fundraising workshops, and general startup
networking events where angels attend. Use kind "event" for events and kind "funding" for applications with a
deadline (accelerators, pitch-competition applications, non-dilutive grants). Include deadline dates.`,
  },
  {
    id: "sooz-resources",
    section: SOOZ,
    label: "Funding, programs & resources",
    kinds: ["funding", "resource"],
    upcomingOnly: false,
    maxSearches: 10,
    brief: `Find other things that would genuinely help a pre-seed food & beverage CPG startup:
accelerators and incubators for food/bev/CPG (with open application windows), non-dilutive grants and
competitions (USDA, state, SBA, corporate), co-manufacturing / co-packer directories and communities,
retail/distribution programs for emerging brands (e.g. retailer emerging-brand programs), notable recent
CPG funding news or investor theses worth knowing, and founder communities. Use kind "funding" for anything
with money or an application; "resource" for everything else. Include deadlines when they exist.`,
  },
  {
    id: "personal-ai-startup",
    section: PERSONAL,
    label: "AI & startup: hackathons, demo days",
    kinds: ["hackathon", "event", "grant", "job"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find upcoming AI and startup opportunities: hackathons (in person near the home base and notable
virtual / travel-worthy ones), AI builder events and meetups, demo days, startup weeks and founder conferences,
AI grants and credits programs, and fellowships or competitions for builders. Prefer things with concrete dates,
and include application deadlines. Kinds: "hackathon", "event", "grant" (money/credits), "job" (only roles that
strongly fit a founder/operator interested in AI).`,
  },
  {
    id: "personal-leadership-culture",
    section: PERSONAL,
    label: "Leadership & cultural opportunities",
    kinds: ["leadership", "culture", "event", "grant"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find leadership-development and cultural opportunities: leadership fellowships and programs for
young professionals / founders (cohort-based, with applications), speaker series, civic and nonprofit board
programs, cultural festivals, exhibitions, performances, food/arts/community events, language and cultural
exchange programs, and notable lectures. Near the home base first, then notable virtual or travel-worthy options.
Kinds: "leadership", "culture", "event", "grant".`,
  },
  {
    id: "personal-wildcard",
    section: PERSONAL,
    label: "Wildcard: anything interesting",
    kinds: ["other", "event", "grant", "job", "culture", "leadership", "hackathon"],
    upcomingOnly: true,
    maxSearches: 10,
    brief: `Surprise the user. Find unusual, high-quality opportunities that a curious founder-minded person
with broad interests would love but would not think to search for: competitions with big prizes, residencies,
travel grants, unusual cohorts, notable one-off events, open calls, and special programs opening soon.
Avoid generic listicles and anything that is just an ad. Quality over quantity: 3-6 great finds beats 15 mediocre ones.`,
  },
];

export function tasksFor(section?: Section, taskId?: string): ResearchTask[] {
  return TASKS.filter((t) => (!section || t.section === section) && (!taskId || t.id === taskId));
}

export interface PromptContext {
  today: string; // YYYY-MM-DD
  homeBase: string;
  known: string[]; // titles already in the database (so the agent finds NEW things)
}

export const SYSTEM_PROMPT = `You are a meticulous research analyst working for a small startup team. You search the live web
and report only what you actually found. You never invent people, events, dates, URLs, or contact details.
If something cannot be verified from a page you saw, leave it out or state the uncertainty.
Use only public, professional information. Do not collect private emails, phone numbers, or home addresses.`;

export function buildResearchPrompt(task: ResearchTask, ctx: PromptContext): string {
  const profile = task.section === "sooz" ? SOOZ_PROFILE : PERSONAL_PROFILE;
  const known = ctx.known.length
    ? `\nAlready in the database (do NOT repeat these; find new ones):\n${ctx.known
        .slice(0, 150)
        .map((t) => `- ${t}`)
        .join("\n")}\n`
    : "";
  const upcoming = task.upcomingOnly
    ? `\nOnly include things that have NOT happened yet as of ${ctx.today}. Skip anything past. Prefer the next 6 months.`
    : "";

  return `Today's date: ${ctx.today}. Home base: ${ctx.homeBase}.

CONTEXT
${profile}

YOUR TASK: ${task.label}
${task.brief}
${upcoming}
${known}
HOW TO WORK
- Run searches (up to ${task.maxSearches}), open the most promising results, and cross-check key facts.
- Aim for 8-15 solid findings. Fewer excellent ones beat many weak ones.
- For every finding, note: name/title, the exact source URL you saw, what it is, why it fits, any dates
  (YYYY-MM-DD), location, and a fit score 0-100 (80+ = strong fit and actionable soon, 60-79 = good,
  45-59 = maybe, below 45 = leave out).
- Allowed kinds for this task: ${task.kinds.join(", ")}.

When you're done, write your findings as clear notes, one block per finding, with the fields above.
Do not add commentary beyond the findings and a one-line note on anything you could not verify.`;
}

export function buildExtractionPrompt(task: ResearchTask, notes: string, today: string): string {
  return `Convert the research notes below into structured findings.

Rules:
- Use only information present in the notes. Do not add anything.
- "kind" must be one of: ${task.kinds.join(", ")}.
- "url" must be the specific source URL from the notes (https). Drop any finding with no URL.
- Dates must be YYYY-MM-DD or null. ${task.upcomingOnly ? `Drop findings whose date is before ${today}.` : ""}
- "score" is an integer 0-100 for fit; drop findings below 45.
- For angels, "title" is the person's full name; put firm, role, rice_connection, check_size and contact_path in "details" (null when unknown).
- Add short lowercase tags (e.g. "rice", "houston", "food-bev", "ai", "virtual", "deadline-soon").
- summary: 1-2 factual sentences. why_relevant: 1 sentence on why it fits.

RESEARCH NOTES
${notes}`;
}
