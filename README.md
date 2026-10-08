# Query — opportunity radar

A private dashboard + weekly email that keeps looking for things worth your attention, in two sections:

- **Sooz** (pre-seed food & beverage CPG): angel investors (Rice alumni first), CPG / fundraising / general
  events, accelerators, grants and other resources.
- **Personal**: AI & startup hackathons, leadership programs, cultural opportunities, and a "wildcard"
  search for anything interesting.
- **Outreach**: a pipeline for specific, named angels: contact enrichment, one-to-one drafts, warm-intro
  matching against your LinkedIn connections, follow-up reminders and reply tracking. You send every message.

```
Claude routines (weekly, on your Claude plan — no API key)        Neon Postgres          Vercel
 ├─ research:  WebSearch → oq_ingest()  ────────────────────────▶  items, runs   ◀────── Next.js dashboard
 ├─ outreach:  oq_outreach_* ⇄ WebSearch / Apollo / Gmail search ▶ outreach      ◀────── (password-gated)
 └─ digest:    oq_digest_email() → Gmail → oq_mark_digested() ──────────▲
```

Findings are de-duplicated (people by name + firm, everything else by canonical URL). Your triage
(`saved`, `contacted`, `dismissed`, notes) is never overwritten by later runs, and the agent is told what it
already found so each run hunts for *new* things.

## How the weekly job runs (no API key)

Three scheduled Claude routines run **on your Claude plan** inside a session that holds your Neon, Gmail and
Apollo connectors:

| Routine | When | Does |
|---|---|---|
| Opportunity radar weekly research | Mondays ~8:00 Central | 9 research tasks (briefs in `lib/briefs.ts`; angel tasks return individual people) → `oq_ingest()` into Neon |
| Opportunity radar weekly outreach prep | Mondays ~9:15 Central | queues angels scoring 75+, finds public LinkedIn URLs, up to 5 Apollo work-email lookups, drafts email + LinkedIn note + intro request + 2 follow-ups, and checks Gmail for sent mail and replies |
| Opportunity radar weekly digest | Mondays ~10:30 Central | `oq_digest_email()` → one email to you via Gmail (new finds + outreach to-dos) → `oq_mark_digested()` |

The prompts live in `routines/*.md` (regenerate with `npm run routine-prompt -- research|outreach|digest`). To change
what it looks for, edit `lib/briefs.ts`, regenerate, and update the routine's prompt.

## Outreach (the Outreach tab)

1. **Settings → Pitch facts.** Company, one-liner, sender name/title and (optionally) traction, raise, deck and
   calendar links. Drafts use only these facts plus each angel's sourced background; leave anything unverified blank.
2. **Settings → Your network.** Upload LinkedIn's `Connections.csv` (Settings & Privacy → Data privacy → Get a copy
   of your data → Connections). Each angel card then shows who you already know at their firm.
3. **Settings → Import angels.** A CSV of named people (e.g. `reports/angels_prospects.csv`); rows are validated
   like research findings and added to the pipeline. Angels from the Sooz list can also be added with one click.
4. **Weekly.** The outreach routine enriches and drafts; you review on the Outreach tab, press *Open in Gmail*,
   send from your own inbox and *Mark sent*. Follow-ups come due on day 5 and day 12 (3 touches max); the routine
   also notices sends and replies in Gmail and moves cards along.

Nothing is ever sent automatically. First notes are relationship-first (asking for perspective, not pitching
terms) because contacting people you don't know about an offering can be general solicitation under SEC
Regulation D — confirm your 506(b)/506(c) approach with counsel before a broad push.

**Safety design.** The routines can only call a fixed set of SQL functions (all validation, length caps and
de-duplication live in `db/schema.sql`), the research routine is told never to email, the digest is rendered
(and HTML-escaped) in SQL so the email step only forwards it, and both are told to treat web/database text as
untrusted data. Because a session with web + database + email access is a prompt-injection target, consider moving
each routine into its own claude.ai Routine with only the connector it needs (research: Neon; digest: Neon + Gmail).

## Setup (already done for this instance — see the bottom)

1. **Database (Neon).** Create a Neon database and a restricted role; copy the pooled connection string.
2. **Dashboard (Vercel).** Env vars: `DATABASE_URL`, `DASHBOARD_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`).
3. **Migrate:** `DATABASE_URL=... npm run db:migrate` (creates tables + the `oq_*` functions).
4. **Routines:** create the three routines from `routines/research.md`, `routines/outreach.md` and `routines/digest.md`.

## Local development

```bash
cp .env.example .env        # DATABASE_URL, DASHBOARD_PASSWORD, SESSION_SECRET
npm install
npm run db:migrate
npm run db:seed-demo        # fictional rows, refuses to run against a non-local database
npm run dev                 # dashboard on :3000
npm test                    # set TEST_DATABASE_URL to include the Postgres tests
```

An optional API-key path exists for running research from a script instead of a routine
(`npm run research -- --dry`, needs `ANTHROPIC_API_KEY`; and `npm run digest` with Resend). It is not used by default.

## Notes and limits

- **Public information only.** The agent is instructed to use public professional sources and never to guess
  emails/phones. Rice's alumni tools (alumni directory, Sallyportal, Ask an Owl) are login-gated and not scraped; use them by hand for warm intros.
- **Search-only research.** WebFetch is blocked by the cloud environment's network allowlist unless you widen
  *Network access* in the environment settings, so research relies on search results. Dates found only on
  aggregator sites are tagged `verify-dates` — confirm at the source before acting.
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
- **Routines:** see `mcp__claude-code-remote` triggers "Opportunity radar weekly research / outreach prep / digest".
