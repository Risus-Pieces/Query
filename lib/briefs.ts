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
    label: "Angels: Rice alumni network",
    kinds: ["angel"],
    upcomingOnly: false,
    maxSearches: 12,
    brief: `Find individual people connected to Rice University who could plausibly invest in or open doors for a
pre-seed food & beverage CPG startup: Rice alumni who are angel investors, venture partners, family-office or
micro-VC principals, successful CPG/food founders, or senior CPG operators (brand, retail, distribution).
Also include Rice-affiliated investor groups' publicly listed members/leads. Good places to look: Rice Alliance for
Technology and Entrepreneurship, Rice Business Plan Competition judges and investors, Rice Business (Jones) alumni
profiles and news, Rice alumni magazine features, Houston-area angel groups, and news about Rice-founded funds.
Each item is ONE PERSON (title = their full name). Fill in firm, role, rice_connection (e.g. "MBA '09" — only if a
source states it), check_size (only if a source states it), and contact_path: the most credible public warm path
(e.g. "speaks at Rice Alliance events; connect via Rice Alliance", "listed on Houston Angel Network team page").
Never guess or invent emails or phone numbers. Put a Rice tag "rice" in tags for confirmed Rice alumni.`,
  },
  {
    id: "sooz-angels-cpg",
    section: SOOZ,
    label: "Angels: CPG & food/bev investors",
    kinds: ["angel"],
    upcomingOnly: false,
    maxSearches: 12,
    brief: `Find individual angel investors, scout/micro-VC partners and operator-angels who actively back
early-stage (pre-seed / seed) food, beverage and CPG brands — NOT limited to Rice. Prioritize people with recent
public evidence of such investments (portfolio pages, press, podcasts, announced rounds in the last 24 months),
people based in or near the user's home base, and founders-turned-investors from successful food/bev exits.
Each item is ONE PERSON (title = full name), with firm, role, check_size (only if stated), a one-line portfolio
proof in summary (named companies), and contact_path (public warm path: a specific community, program, or event
where they are accessible). Never guess or invent emails or phone numbers. Tag with "rice" only if confirmed.`,
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
