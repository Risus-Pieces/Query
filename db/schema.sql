-- Idempotent schema. Run with `npm run db:migrate`.

create table if not exists items (
  id            bigserial primary key,
  section       text not null check (section in ('sooz', 'personal')),
  kind          text not null,
  title         text not null,
  url           text,
  source        text,
  summary       text not null default '',
  why_relevant  text not null default '',
  score         integer not null default 50 check (score between 0 and 100),
  tags          text[] not null default '{}',
  details       jsonb not null default '{}'::jsonb,
  event_date    date,
  deadline      date,
  location      text,
  dedupe_key    text not null unique,
  status        text not null default 'new'
                  check (status in ('new', 'seen', 'saved', 'contacted', 'dismissed')),
  notes         text not null default '',
  task_id       text,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  digested_at   timestamptz
);

create index if not exists items_section_status_idx on items (section, status);
create index if not exists items_event_date_idx on items (event_date);
create index if not exists items_score_idx on items (score desc);

create table if not exists runs (
  id           bigserial primary key,
  task_id      text not null,
  section      text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  found        integer not null default 0,
  inserted     integer not null default 0,
  error        text
);

create index if not exists runs_started_idx on runs (started_at desc);
