# Query — opportunity radar

A private dashboard + weekly email that keeps looking for things worth your attention, in two sections:

- **Sooz** (pre-seed food & beverage CPG): angel investors (Rice alumni first), CPG / fundraising / general
  events, accelerators, grants and other resources.
- **Personal**: AI & startup hackathons, leadership programs, cultural opportunities, and a "wildcard"
  search for anything interesting.

```
Claude routines (weekly, on your Claude plan — no API key)        Neon Postgres          Vercel
 ├─ research:  WebSearch → oq_ingest()  ────────────────────────▶  items, runs   ◀────── Next.js dashboard
 └─ digest:    oq_digest_email() → Gmail → oq_mark_digested() ──────────▲                (password-gated)
```

Findings are de-duplicated (people by name + firm, everything else by canonical URL). Your triage
(`saved`, `contacted`, `dismissed`, notes) is never overwritten by later runs, and the agent is told what it
already found so each run hunts for *new* things.

## How the weekly job runs (no API key)

Two scheduled Claude routines run **on your Claude plan** inside a session that holds your Neon and Gmail
connectors:

| Routine | When | Does |
|---|---|---|
| Opportunity radar weekly research | Mondays ~8:00 Central | 8 research tasks (briefs in `lib/briefs.ts`) → `oq_ingest()` into Neon |
| Opportunity radar weekly digest | Mondays ~10:30 Central | `oq_digest_email()` → one email to you via Gmail → `oq_mark_digested()` |

The prompts live in `routines/*.md` (regenerate with `npm run routine-prompt -- research|digest`). To change what
it looks for, edit `lib/briefs.ts`, regenerate, and update the routine's prompt.

**Safety design.** The routines can only call a fixed set of SQL functions (all validation, length caps and
de-duplication live in `db/schema.sql`), the research routine is told never to email, the digest is rendered
(and HTML-escaped) in SQL so the email step only forwards it, and both are told to treat web/database text as
untrusted data. Because a session with web + database + email access is a prompt-injection target, consider moving
each routine into its own claude.ai Routine with only the connector it needs (research: Neon; digest: Neon + Gmail).

## Setup (already done for this instance — see the bottom)

1. **Database (Neon).** Create a Neon database and a restricted role; copy the pooled connection string.
2. **Dashboard (Vercel).** Env vars: `DATABASE_URL`, `DASHBOARD_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`).
3. **Migrate:** `DATABASE_URL=... npm run db:migrate` (creates tables + the `oq_*` functions).
4. **Routines:** create the two routines from `routines/research.md` and `routines/digest.md`.

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
  emails/phones. Rice's alumni directory (Owls Connect) is login-gated and not scraped.
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
- **Routines:** see `mcp__claude-code-remote` triggers "Opportunity radar weekly research / digest".
