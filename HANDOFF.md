# Handoff: broaden Query and move the routines to a session with Neon

Written 2026-10-14 for the next Claude Code session. Read README.md first for the architecture. This file has
the current state, the decisions the owner has already made, and the exact work to do. Do it all without asking
the owner questions; they have asked not to be asked for permission. Report at the end.

## Current state

- **Code**: this repo. 97 tests pass (`eval "$(bash scripts/local-pg.sh)" && npm test`); CI runs the same on push.
- **Dashboard**: Vercel project `opportunity-query` (`prj_GtbcoRcEM4IAyEw5nsOYjjFlJRnO`, team
  `team_B6Yf3CHCK363XIjAlkvKdcZs`), https://opportunity-query.vercel.app. Current production deployment
  `dpl_Hhuiggtq7dCALRTa2xDaQ3KKmyqU` = commit 3b21699's app files. The app self-migrates on cold start
  (`instrumentation.ts` → `lib/migrate.ts`, hash of `lib/schema-sql.ts` stored in `schema_version`).
- **Database**: Neon project `green-hall-60323582`, branch `br-billowing-band-an46gq84`, database
  `opportunity_query`. Never touch any other Neon project, database or table (the owner has other apps there:
  `personal-crm`, calendarsync).
- **Routines**: three triggers bound to the OLD session `session_019PKreKWuWKx2gDHBYjPrJF`, which cannot see the
  Neon connector (connectors load at session start), so last Monday's runs could not touch the DB:
  - `trig_015HjiJhhPCGQz1JyGyAHyJw` "Opportunity radar weekly research", `CRON_TZ=America/Chicago 59 7 * * 1`
  - `trig_01SQpvDu4oY2zVnJDVQL3hiC` "Opportunity radar weekly outreach prep", `CRON_TZ=America/Chicago 13 9 * * 1`
  - `trig_0186G4JDXCYTm6uQuCmtw8a8` "Opportunity radar weekly digest", `CRON_TZ=America/Chicago 27 10 * * 1`
- **Staged data not yet in Neon**:
  - `pending_ingest/2026-10-12/<task-id>.json`: 43 findings from the Oct 12 research run (9 files, one per task id
    in `lib/briefs.ts`). All passed `oq_ingest()` in a local copy of the schema.
  - `reports/angels_prospects.csv`: 68 vetted named angels (each with a public source). The owner was told to upload
    it via Settings → Import angels; they may or may not have.

## Step 1: verify access

1. Neon `run_sql` works on the project/branch/database above: `select count(*) from items`, `select hash, applied_at
   from schema_version`, `select count(*) from outreach`.
2. Gmail, Apollo and WebSearch tools are available (they are used by the routines).

## Step 2: load the staged data

1. For each file in `pending_ingest/2026-10-12/`: `select oq_ingest('<section>', '<task id>', array[<kinds>],
   <upcoming_only>, $oq$<file contents>$oq$::jsonb)` with section/kinds/upcoming_only from that task in
   `lib/briefs.ts`. Findings whose dates have passed are rejected by design; report counts.
2. If `outreach` is empty or the CSV people are missing from `items`, ingest `reports/angels_prospects.csv` the same
   way the app's `importProspects()` does (convert rows to findings: kind `angel`, task id `import`; carry
   `linkedin_url`), then `select oq_outreach_queue(60)` to put the strong ones in the pipeline.

## Step 3: broaden what Query looks for (owner-approved, implement all of it)

The owner: Rice University undergraduate, **class of 2029**. Wants "all of them" from the proposal below. Career
interests: **consumer, retail, bio, VC, PE, AI and hardware, anywhere** (remote fine). Celebrities: wanted **both as
investors and as ambassadors/partners**.

### Data model

- Sections: `sooz`, `personal`, **`career`** (new). Update `lib/types.ts`, the `items.section` check constraint
  (idempotent: `alter table items drop constraint if exists items_section_check; alter table items add constraint
  items_section_check check (section in ('sooz','personal','career'))`), and `oq_ingest`'s section check.
- Kinds:
  - `sooz`: angel, **celebrity**, **nextgen**, **creator**, **buyer**, **media**, event, **sampling**, funding, resource
  - `personal`: hackathon, event, **talk**, **pass**, **speaking**, **perk**, grant, leadership, culture, other
    (move `job` to career)
  - `career`: **internship**, **externship**, **program** (early-insight / discovery / diversity programs),
    **fellowship** (incl. VC fellowships and scout programs), **scholarship**, job
- **Person kinds** = angel, celebrity, nextgen, creator, buyer, media. Identity/dedupe like angels (name + first
  firm) in both `lib/dedupe.ts` and `oq_dedupe_key` (keep the `angel:` prefix for angels so existing rows keep their
  keys; use `<kind>:` for the others). `oq_item_meta` and the digest treat all person kinds like angels.

### Outreach for any person (not just angels)

- `outreach.purpose text not null default 'invest' check (purpose in ('invest','ambassador','buyer','press','intro'))`
  (add column idempotently; backfill from kind). Defaults: angel/nextgen → invest; celebrity/creator → ambassador;
  buyer → buyer; media → press. Editable on the card (select).
- `addToPipeline`, `oq_outreach_queue`: any person kind in sooz. `oq_outreach_todo`: include `kind` and `purpose`.
  Keep one-person-per-firm.
- `templateDrafts` per purpose: invest (current relationship-first note), ambassador (collaboration / send product;
  **never offer equity in a first note** — that is a securities offer), buyer (15-minute call or sample drop; region,
  category, what is selling), press (a story angle: Rice student founder, Houston brand; offer samples/interview),
  intro (ask a connector for an intro).
- Contact rules for the routine: angels/buyers/media at companies → Apollo work email (≤5 lookups per run, verified
  only, report credits). Celebrities/creators/next-gen → only a business or management contact that the person or
  their team publishes (official site, agency roster, "business inquiries" address in a verified bio), with
  `email_source='public'`; otherwise leave email empty and describe the route in `warm_path`. Never personal
  emails, phone numbers, home addresses, DMs, or anything about family members who are not public figures; adults
  only.
- UI: Header tabs Sooz · Personal · **Career** · Outreach; ItemCard "Add to outreach" for every person kind; the
  ProspectCard shows a purpose badge and kind-specific subtitle; Settings "Import angels" becomes "Import people" with
  optional `kind` and `purpose` columns (default angel/invest). Outreach fineprint: keep the Reg D note, add that paid
  ambassadors and creators must disclose the relationship (FTC endorsement rules) and that NIL deals with college
  athletes must follow their school's NIL rules.

### Research tasks (`lib/briefs.ts`)

Keep the existing 9 tasks (update `personal-ai-startup` to also emit `perk` = cloud/AI credits and student tool
deals; update `sooz-resources` to include corporate beverage venture/accelerator programs). Add:

**Sooz** (all people tasks: ONE person per item, adults only, public professional activity only, public contact
route in `contact_path`):
- `sooz-celebrities` (celebrity): celebrities and pro athletes who invested in, launched or partnered with beverage /
  CPG / wellness brands (round announcements naming celebrity investors, brand partnership news); Houston natives and
  Houston pro athletes (Texans, Rockets, Astros, Dynamo, Dash); Rice/UH/Texas alumni with public profiles; musicians,
  chefs and food personalities. Score higher for beverage deals, Houston/Texas ties, wellness fit and a reachable
  tier (mid-tier beats megastars).
- `sooz-nextgen` (nextgen): adult children and heirs of famous founders, celebrities and prominent (especially
  Texas/Houston) business families who publicly invest, run a family office or venture fund, or run their own
  consumer brand.
- `sooz-creators-nil` (creator): food/drink/wellness creators (Texas first) who partner with or own stakes in
  brands; college athletes at Rice, UH, UT and A&M with NIL deals, especially beverage NIL deals.
- `sooz-buyers` (buyer, event): beverage buyers/category managers at H-E-B, Whole Foods (Southwest), Central Market,
  Kroger Houston, Buc-ee's, Sprouts and specialty grocers/cafés; Texas distributor and broker principals; plus buyer
  pitch days, ECRM sessions and retailer open calls (kind event, upcoming).
- `sooz-media` (media, funding): journalists covering beverage/CPG and Houston food or startups (BevNET, NOSH, Food
  Dive, Houston Chronicle food, InnovationMap, Houston Business Journal, Rice Thresher), podcasts that take founder
  guests (Taste Radio, Startup CPG and similar), and awards with applications (kind funding, with deadline).
- `sooz-sampling` (sampling, upcoming): Houston/Texas festivals, races, markets, campus and corporate events recruiting
  food & beverage vendors or sponsors, and retailer demo/sampling programs; include deadlines and fees.

**Personal**:
- `personal-events` (event, culture, talk, upcoming): cool events of every kind around Houston and notable virtual
  ones, found via Luma (`site:lu.ma Houston`, lu.ma/houston), Eventbrite, Meetup, Partiful public pages, Do713,
  Houston Press and the Rice/UH calendars: AI/tech, founders, food & drink, music, art, culture, wellness; plus
  notable people visiting Houston (book talks, speaker series, office hours) as kind `talk`.
- `personal-passes-speaking` (pass, speaking, upcoming): free student or volunteer passes and scholarships to attend
  major conferences (SXSW, Web Summit, TechCrunch Disrupt, CES, Expo West and similar), calls for speakers or student
  panelists, podcast guest calls, student op-ed calls.

**Career** (owner is a Rice undergraduate, class of 2029, i.e. a sophomore in 2026–27; fields: consumer, retail,
bio/biotech, VC, PE, AI, hardware; location anywhere; always include the deadline when stated and whether
sophomores are eligible):
- `career-internships` (internship, job): summer 2027 internships open to sophomores at startups, consumer & retail
  brands, biotech, AI and hardware companies, VC and PE firms; sources: Y Combinator Work at a Startup, Wellfound,
  Simplify's GitHub internship lists, company career pages, NSF REU and similar research programs for bio/AI/hardware.
  Also flag when junior-summer 2028 banking/PE/consulting recruiting opens (it starts early).
- `career-programs` (program, upcoming): early-insight, discovery, sophomore and diversity programs at banks, PE
  firms, consulting firms and consumer/retail companies, with deadlines.
- `career-externships` (externship, program): winter-break shadowing, micro-internships (Parker Dewey), Extern,
  Forage job simulations, university externship programs.
- `career-fellowships` (fellowship, scholarship): VC fellowships, scout programs and student-run funds; undergraduate
  fellowships and scholarships in AI, bio, hardware and entrepreneurship.

### Routines (two research days, to spread plan usage)

- Monday: **Sooz research** (all `sooz-*` tasks) 7:59 CT → **outreach prep** 9:13 CT → **digest** 10:27 CT.
- Thursday: **Personal & career research** (all `personal-*` and `career-*` tasks) 7:59 CT → **digest** 10:27 CT.
- `lib/routine.ts`: `buildResearchRoutinePrompt` takes the set of sections; tell the research routine it may run
  tasks in parallel with general-purpose subagents (up to 4 at a time) that only search and return JSON, while the
  routine itself makes every `oq_ingest` call. Same hard rules as today. Regenerate `routines/*.md`
  (`npm run routine-prompt -- ...`) and add the new outreach rules (purposes, contact rules) to the outreach prompt.
- `oq_digest_email`: add a Career section and rename "new angels" to "new people". It already only includes
  undigested items, so a Thursday digest works.

### Tests

Extend the existing tests: new sections/kinds validation, person-kind dedupe in TS and SQL, purpose defaults and
drafts, queue/todo for person kinds, digest career section, routine prompt contents. All must pass locally and in CI.

## Step 4: deploy

Vercel MCP `create_deployment` (target `production`, `projectSettings: {framework: "nextjs", nodeVersion: "22.x"}`)
with changed files inline (`encoding: "utf-8"`) and unchanged files by `{file, sha, size}` (sha = `sha1sum`). After it
is READY, `list_deployment_files` and confirm every file's `uid` equals the local `sha1sum`. Runtime logs and
fetching `*.vercel.app` are blocked for this team from the sandbox; after deploy, check `schema_version.applied_at`
in Neon moves (the first request after a cold start applies the migration) and spot-check the new tables/columns.

## Step 5: move the routines to this session

Create the five routines above with `create_trigger` (no `persistent_session_id`, so they bind to THIS session,
which has Neon), prompts from the regenerated `routines/*.md` with the same one-line "Scheduled weekly run … Run it
now, fully autonomously, in this session …" header the old ones have (read them with `get_trigger`). Then delete
the three old triggers listed above. Then fire the outreach-prep routine once now (nothing has been drafted yet).

## Rules that still apply

- Nothing is ever sent to investors, celebrities, buyers or press automatically; a person sends every message.
- Digest emails go only to boxuanzhao1128@gmail.com.
- Public professional information only; never guess or invent emails, phone numbers, people, dates or URLs.
- Apollo is Muyiwa's team account (mo@drinksooz.com): at most 5 `apollo_people_match` lookups per run, no
  sequences, no other Apollo tools; always report the credits block.
- Routines may only run the fixed `oq_*` SQL statements their prompts list.
- Commit and push to `main` of `Risus-Pieces/Query` when done; update README.md for the new sections and routines.
