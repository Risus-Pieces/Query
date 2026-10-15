# Query — opportunity radar (retired)

> **Retired 2026-10-14.** Query now lives inside Rapport as the **Radar** tab
> (https://rapport-liard.vercel.app/radar, repo `Risus-Pieces/rapport`): research lands there, you approve a person and
> they become a CRM contact/deal with outreach tracked on the record. opportunity-query.vercel.app redirects there, the
> scheduled routines read `rapport/routines/*.md`, and all findings were copied into Rapport's database. This repo and
> its Neon database (`green-hall-60323582` / `opportunity_query`) are kept unchanged as an archive.

A private dashboard + twice-weekly email that keeps looking for things worth your attention, in three sections:

- **Sooz** (pre-seed food & beverage CPG): people and places. People: angel investors (Rice alumni first),
  celebrities and pro athletes (as investors *and* ambassadors), next-gen investors from prominent families,
  creators and college athletes with NIL deals, retail buyers and distributors, and press / podcast hosts.
  Places: CPG and fundraising events, sampling and vendor slots, accelerators, grants, awards and resources.
- **Personal**: AI & startup hackathons, Houston events from Luma / Eventbrite / Meetup and campus calendars,
  talks by people visiting Houston, free conference passes, speaking and op-ed calls, student perks and
  credits, leadership programs, culture, and a "wildcard" search.
- **Career** (Rice class of 2029, so sophomore-eligible first): internships, externships and job simulations,
  early-insight / sophomore / diversity programs, VC fellowships and scout programs, and scholarships, across
  consumer, retail, bio, VC, PE, AI and hardware.
- **Outreach**: a pipeline for specific, named people, each with a purpose (invest, ambassador, buyer, press or
  intro): contact enrichment, one-to-one drafts for that purpose, warm-intro matching against your LinkedIn
  connections, follow-up reminders and reply tracking. You send every message.

```
Claude routines (weekly, on your Claude plan — no API key)        Neon Postgres          Vercel
 ├─ research:  WebSearch → oq_ingest()  ────────────────────────▶  items, runs   ◀────── Next.js dashboard
 ├─ outreach:  oq_outreach_* ⇄ WebSearch / Apollo / Gmail search ▶ outreach      ◀────── (password-gated)
 └─ digest:    oq_digest_email() → Gmail → oq_mark_digested() ──────────▲
```

Findings are de-duplicated (people by kind + name + firm, everything else by canonical URL). Your triage
(`saved`, `contacted`, `dismissed`, notes) is never overwritten by later runs, and the agent is told what it
already found so each run hunts for *new* things.

## How the jobs run (no API key)

Five scheduled tasks run **on your Claude plan** in the Claude desktop app on the owner's Mac (Code tab →
scheduled tasks, working folder = this repo), where the Neon, Gmail, Apollo and web-search tools are connected.
Research is split across two days to spread plan usage:

| Task | When (Central) | Does |
|---|---|---|
| Query: Sooz research | Mon 7:59 | every `sooz-*` task in `lib/briefs.ts` (people tasks return one person per item) → `oq_ingest()`; up to 4 search-only subagents in parallel |
| Query: outreach prep | Mon 9:13 | queues people scoring 75+ with a purpose, finds public LinkedIn URLs and published business contacts, up to 5 Apollo work-email lookups (angels, buyers, press only), drafts email + LinkedIn note + intro request + 2 follow-ups for each person's purpose, and checks Gmail for sent mail and replies |
| Query: digest (Monday) | Mon 10:27 | `oq_digest_email()` → one email to you via Gmail (new finds + outreach to-dos) → `oq_mark_digested()` |
| Query: Personal & Career research | Thu 7:59 | every `personal-*` and `career-*` task → `oq_ingest()` |
| Query: digest (Thursday) | Thu 10:27 | same digest; it only includes items not yet emailed |

Scheduled tasks run while the desktop app is open; if the Mac is asleep or the app is closed at the scheduled time,
the task runs the next time the app opens. Each run starts a fresh session in this folder and notifies the session
that set them up.

Each scheduled task's prompt is a short wrapper (with the hard rules repeated) that reads its full instructions from
`routines/*.md` in this folder at run time. Regenerate them with `npm run routine-prompt -- research sooz`,
`-- research personal,career`, `-- outreach` and `-- digest`; to change what Query looks for, edit `lib/briefs.ts` and
regenerate — the next run picks it up.

## Outreach (the Outreach tab)

1. **Settings → Pitch facts.** Company, one-liner, sender name/title and (optionally) traction, raise, deck and
   calendar links. Drafts use only these facts plus each person's sourced background; leave anything unverified blank.
2. **Settings → Your network.** Upload LinkedIn's `Connections.csv` (Settings & Privacy → Data privacy → Get a copy
   of your data → Connections). Each card then shows who you already know at that person's firm.
3. **Settings → Import people.** A CSV of named people (e.g. `reports/angels_prospects.csv`) with optional `kind`
   (angel, celebrity, nextgen, creator, buyer, media; default angel) and `purpose` columns; rows are validated like
   research findings and added to the pipeline. Anyone in the Sooz people lists can also be added with one click.
4. **Purpose.** Each card has a purpose that picks the draft: *invest* (angels, next-gen: 20 minutes of perspective),
   *ambassador* (celebrities, creators, athletes: send product, talk collaboration — never equity in a first note),
   *buyer* (15 minutes or a sample drop), *press* (a story angle, samples or an interview) and *intro* (ask a
   connector). Change it under *Edit purpose, contact & drafts*.
5. **Weekly.** The outreach routine enriches and drafts; you review on the Outreach tab, press *Open in Gmail*,
   send from your own inbox and *Mark sent*. Follow-ups come due on day 5 and day 12 (3 touches max); the routine
   also notices sends and replies in Gmail and moves cards along.

Contact rules: people at companies (angels, buyers, press) get a verified work email via Apollo (≤5 lookups per run);
celebrities, creators and next-gen investors only get a business or management contact they or their team publish
(`email_source = public`), otherwise the route (agency, manager, NIL office) goes in *warm path*. Never personal
emails, phone numbers, addresses or DMs; adults only.

Nothing is ever sent automatically. First notes are relationship-first (asking for perspective, not pitching
terms) because contacting people you don't know about an offering can be general solicitation under SEC
Regulation D — confirm your 506(b)/506(c) approach with counsel before a broad push. Paid ambassadors and creators
must disclose the relationship (FTC endorsement rules), and NIL deals with college athletes must follow their
school's NIL rules.

**Safety design.** The routines can only call a fixed set of SQL functions (all validation, length caps and
de-duplication live in `db/schema.sql`), the research routine is told never to email, the digest is rendered
(and HTML-escaped) in SQL so the email step only forwards it, and both are told to treat web/database text as
untrusted data. Because a session with web + database + email access is a prompt-injection target, consider moving
each routine into its own claude.ai Routine with only the connector it needs (research: Neon; digest: Neon + Gmail).

## Setup (already done for this instance — see the bottom)

1. **Database (Neon).** Create a Neon database and a restricted role; copy the pooled connection string.
2. **Dashboard (Vercel).** Env vars: `DATABASE_URL`, `DASHBOARD_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`).
3. **Migrate:** `DATABASE_URL=... npm run db:migrate` (creates tables + the `oq_*` functions).
4. **Routines:** create the five scheduled tasks above from `routines/research-sooz.md`,
   `routines/research-personal-career.md`, `routines/outreach.md` and `routines/digest.md` (twice).

## Local development

```bash
cp .env.example .env        # DATABASE_URL, DASHBOARD_PASSWORD, SESSION_SECRET
npm install
npm run db:migrate
npm run db:seed-demo        # fictional rows, refuses to run against a non-local database
npm run dev                 # dashboard on :3000
npm test                    # set TEST_DATABASE_URL to include the Postgres tests
                            # (Linux cloud sandbox: eval "$(bash scripts/local-pg.sh)" first)
```

An optional API-key path exists for running research from a script instead of a routine
(`npm run research -- --dry`, needs `ANTHROPIC_API_KEY`; and `npm run digest` with Resend). It is not used by default.

## Notes and limits

- **Public information only.** The agent is instructed to use public professional sources and never to guess
  emails/phones. Rice's alumni tools (alumni directory, Sallyportal, Ask an Owl) are login-gated and not scraped; use them by hand for warm intros.
- **Search-first research.** The routines rely mainly on search results (WebFetch is used when it works). Dates
  found only on aggregator sites are tagged `verify-dates` — confirm at the source before acting.
- **Verify before you reach out.** Findings carry a source link; confirm details (check sizes, dates) there.
- The dashboard is a single-user password gate (signed cookie, 30 days). Rotating `SESSION_SECRET` signs everyone out.

## Where this instance is deployed

- **Dashboard:** Vercel project `opportunity-query` → https://opportunity-query.vercel.app (Vercel Authentication
  is on by default for `*.vercel.app`; turn it off under Project → Settings → Deployment Protection to open it on
  a device that isn't signed in to Vercel — the app has its own password gate).
- **Database:** Neon project `neon-rose-plank` (`green-hall-60323582`), database `opportunity_query`, owned by the
  restricted role `oq_app` (no privileges on the project's other databases/tables). Neon projects in a
  Vercel-managed org can only be created from the Vercel dashboard, so this reuses an existing project; to move to a
  dedicated one later, create it in Vercel → Storage → Neon, run `npm run db:migrate`, and swap `DATABASE_URL`.
- **Vercel env vars (sensitive):** `DATABASE_URL`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`.
- **Routines:** Claude desktop scheduled tasks `query-research-sooz`, `query-outreach-prep`, `query-digest-monday`,
  `query-research-personal-career`, `query-digest-thursday` (prompts in `routines/`). The older cloud routines
  ("Opportunity radar weekly …") are disabled; they could not see the Neon connector.
