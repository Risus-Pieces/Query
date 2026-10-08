-- Idempotent schema. Run with npm run db:migrate.

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

-- ---------------------------------------------------------------------------------------------
-- Outreach pipeline (angels). One row per angel item in the pipeline. Sending is always done by a
-- human (Gmail compose / LinkedIn); the routine only enriches, drafts, and detects replies.
-- ---------------------------------------------------------------------------------------------

create table if not exists settings (
  key         text primary key,
  value       text not null default '',
  updated_at  timestamptz not null default now()
);

create table if not exists outreach (
  item_id          bigint primary key references items(id) on delete cascade,
  stage            text not null default 'prospect'
                     check (stage in ('prospect', 'drafted', 'sent', 'replied', 'meeting', 'passed', 'closed')),
  email            text,
  email_source     text,
  linkedin_url     text,
  warm_path        text,
  subject          text,
  body             text,
  linkedin_note    text,
  intro_request    text,
  followup_1       text,
  followup_2       text,
  drafted_by       text,
  drafted_at       timestamptz,
  sent_at          timestamptz,
  last_touch_at    timestamptz,
  next_followup_at date,
  touches          integer not null default 0,
  replied_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists outreach_stage_idx on outreach (stage);

create table if not exists outreach_events (
  id       bigserial primary key,
  item_id  bigint not null references items(id) on delete cascade,
  at       timestamptz not null default now(),
  kind     text not null,
  detail   text not null default ''
);
create index if not exists outreach_events_item_idx on outreach_events (item_id, at desc);

-- Your own network (e.g. a LinkedIn "Connections.csv" export) for warm-intro matching.
create table if not exists network (
  id            bigserial primary key,
  full_name     text not null,
  company       text,
  position      text,
  linkedin_url  text,
  email         text,
  connected_on  date,
  source        text not null default 'linkedin',
  company_key   text,
  dedupe_key    text not null unique
);
create index if not exists network_company_key_idx on network (company_key);

-- ---------------------------------------------------------------------------------------------
-- Server-side ingest + digest. The weekly research routine (a Claude session on a Max plan, with
-- only the Neon connector) writes through oq_ingest(); the digest routine reads through
-- oq_digest_email(). Mirrors lib/research.ts (validateCandidates/persistCandidates) and lib/dedupe.ts.
-- ---------------------------------------------------------------------------------------------

create extension if not exists unaccent;

create or replace function oq_slug(t text) returns text language sql stable as $$
  select btrim(regexp_replace(lower(unaccent(coalesce(t, ''))), '[^a-z0-9]+', '-', 'g'), '-')
$$;

create or replace function oq_norm_url(u text) returns text language plpgsql stable as $$
declare m text[]; host text; path text; qs text;
begin
  m := regexp_match(btrim(coalesce(u, '')), '^https?://([^/?#]+)([^?#]*)(?:\?([^#]*))?', 'i');
  if m is null then return null; end if;
  host := lower(regexp_replace(regexp_replace(m[1], '^.*@', ''), ':[0-9]*$', ''));
  host := regexp_replace(host, '^www\.', '');
  if host = '' then return null; end if;
  path := regexp_replace(m[2], '/+$', '');
  select string_agg(p, '&' order by split_part(p, '=', 1), p) into qs
    from unnest(string_to_array(coalesce(m[3], ''), '&')) as p
   where p <> '' and split_part(p, '=', 1) !~* '^(utm_|fbclid|gclid|mc_|ref$|ref_|source$)';
  return host || path || case when qs is not null then '?' || qs else '' end;
end $$;

create or replace function oq_date(s text) returns date language plpgsql immutable as $$
begin
  if s is null or s !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return s::date;
exception when others then
  return null;
end $$;

create or replace function oq_dedupe_key(p_section text, p_kind text, p_title text, p_url text, p_date date, p_firm text)
returns text language plpgsql stable as $$
declare norm text := oq_norm_url(p_url);
begin
  if p_section = 'sooz' and p_kind = 'angel' then
    return 'angel:' || oq_slug(p_title) || case when coalesce(p_firm, '') <> '' then ':' || oq_slug(p_firm) else '' end;
  elsif norm is not null then
    return p_section || ':url:' || norm;
  end if;
  return p_section || ':' || p_kind || ':' || oq_slug(p_title) || ':' || coalesce(p_date::text, '');
end $$;

-- Validate + upsert a batch of findings; returns a JSON summary. Never touches status/notes of existing rows.
create or replace function oq_ingest(p_section text, p_task text, p_kinds text[], p_upcoming boolean, p_findings jsonb)
returns jsonb language plpgsql as $$
declare
  f jsonb; d jsonb;
  v_kind text; v_title text; v_url text; v_score int; v_event date; v_deadline date; v_firm text;
  v_tags text[]; v_details jsonb; v_key text; v_ins boolean; v_run bigint;
  n_valid int := 0; n_ins int := 0; n_upd int := 0; rejected jsonb := '[]'::jsonb;
begin
  if p_section not in ('sooz', 'personal') then raise exception 'section must be sooz or personal'; end if;
  if p_findings is null or jsonb_typeof(p_findings) <> 'array' then raise exception 'findings must be a JSON array'; end if;
  insert into runs (task_id, section) values (p_task, p_section) returning id into v_run;

  for f in select * from jsonb_array_elements(p_findings) loop
    begin
      v_kind  := lower(btrim(coalesce(f->>'kind', '')));
      v_title := left(nullif(btrim(coalesce(f->>'title', '')), ''), 160);
      if v_title is null then raise exception 'missing title'; end if;
      if not (v_kind = any (p_kinds)) then raise exception 'kind % not allowed for this task', v_kind; end if;
      v_url := nullif(btrim(coalesce(f->>'url', '')), '');
      if oq_norm_url(v_url) is null then raise exception 'missing or invalid url'; end if;
      v_score := round(least(100, greatest(0, (f->>'score')::numeric)));
      if v_score < 45 then raise exception 'score below 45'; end if;

      v_event := oq_date(f->>'event_date');
      v_deadline := oq_date(f->>'deadline');
      if p_upcoming and coalesce(v_event, v_deadline) < current_date then raise exception 'already past'; end if;

      d := case when jsonb_typeof(f->'details') = 'object' then f->'details' else '{}'::jsonb end;
      v_firm := left(nullif(btrim(coalesce(d->>'firm', '')), ''), 200);
      v_details := jsonb_strip_nulls(jsonb_build_object(
        'firm', v_firm,
        'role', left(nullif(btrim(coalesce(d->>'role', '')), ''), 200),
        'rice_connection', left(nullif(btrim(coalesce(d->>'rice_connection', '')), ''), 200),
        'check_size', left(nullif(btrim(coalesce(d->>'check_size', '')), ''), 200),
        'contact_path', left(nullif(btrim(coalesce(d->>'contact_path', '')), ''), 300)));

      select coalesce(array_agg(t order by ord), '{}') into v_tags from (
        select t, min(ord) as ord from (
          select left(lower(btrim(x.value)), 30) as t, x.ord
            from jsonb_array_elements_text(coalesce(f->'tags', '[]'::jsonb)) with ordinality as x(value, ord)
        ) s where t <> '' group by t order by min(ord) limit 8
      ) q;
      if v_details ? 'rice_connection' and not ('rice' = any (v_tags)) then v_tags := array_append(v_tags, 'rice'); end if;

      v_key := oq_dedupe_key(p_section, v_kind, v_title, v_url, v_event, v_firm);

      insert into items (section, kind, title, url, source, summary, why_relevant, score, tags, details,
                         event_date, deadline, location, dedupe_key, task_id)
      values (p_section, v_kind, v_title, v_url,
              left(nullif(btrim(coalesce(f->>'source', '')), ''), 120),
              left(btrim(coalesce(f->>'summary', '')), 600),
              left(btrim(coalesce(f->>'why_relevant', '')), 300),
              v_score, v_tags, v_details, v_event, v_deadline,
              left(nullif(btrim(coalesce(f->>'location', '')), ''), 120), v_key, p_task)
      on conflict (dedupe_key) do update set
        last_seen = now(), summary = excluded.summary, why_relevant = excluded.why_relevant,
        score = excluded.score, tags = excluded.tags, details = items.details || excluded.details,
        event_date = coalesce(excluded.event_date, items.event_date),
        deadline = coalesce(excluded.deadline, items.deadline),
        location = coalesce(excluded.location, items.location)
      returning (xmax = 0) into v_ins;

      n_valid := n_valid + 1;
      if v_ins then n_ins := n_ins + 1; else n_upd := n_upd + 1; end if;
    exception when others then
      rejected := rejected || jsonb_build_array(jsonb_build_object('title', left(f->>'title', 80), 'reason', sqlerrm));
    end;
  end loop;

  update runs set finished_at = now(), found = n_valid, inserted = n_ins where id = v_run;
  return jsonb_build_object('run_id', v_run, 'received', jsonb_array_length(p_findings), 'valid', n_valid,
                            'inserted', n_ins, 'updated', n_upd, 'rejected', rejected);
end $$;

create or replace function oq_esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

create or replace function oq_item_meta(i items) returns text language sql immutable as $$
  select case when i.kind = 'angel'
    then concat_ws(' · ', nullif(i.details->>'role', ''), nullif(i.details->>'firm', ''),
                   case when coalesce(i.details->>'rice_connection', '') <> '' then 'Rice: ' || (i.details->>'rice_connection') end,
                   nullif(i.details->>'check_size', ''))
    else concat_ws(' · ', i.event_date::text, case when i.deadline is not null then 'apply by ' || i.deadline::text end, nullif(i.location, ''))
  end
$$;

-- Fully rendered, HTML-escaped digest. The routine just forwards subject/html/text, then calls oq_mark_digested(ids).
create or replace function oq_digest_email(p_min_score int default 55, p_dashboard_url text default null)
returns jsonb language plpgsql stable as $$
declare
  today date := current_date;
  fresh items[]; upcoming items[]; i items;
  shown bigint[]; ids bigint[] := '{}';
  h_up text := ''; h_ang text := ''; h_oth text := ''; h_per text := '';
  t_up text := ''; t_ang text := ''; t_oth text := ''; t_per text := '';
  n_up int := 0; n_ang int := 0; n_oth int := 0; n_per int := 0; n_fresh int := 0;
  li text; tx text; subj text; html text; txt text;
  o_drafts int := 0; o_due int := 0; o_replies int := 0; o_html text := ''; o_txt text := '';
begin
  select coalesce(array_agg(x order by x.section, x.score desc, x.first_seen desc), '{}') into fresh
    from items x where x.digested_at is null and x.status = 'new' and x.score >= p_min_score;
  select coalesce(array_agg(x order by coalesce(x.event_date, x.deadline), x.score desc), '{}') into upcoming
    from items x where x.status in ('new', 'seen', 'saved', 'contacted')
     and ((x.event_date between today and today + 14) or (x.deadline between today and today + 14));
  select coalesce(array_agg(u.id), '{}') into shown from unnest(upcoming) u;

  foreach i in array upcoming loop
    li := format('<li style="margin:0 0 14px"><a href="%s" style="color:#1a56db;text-decoration:none"><b>%s</b></a> <span style="color:#888;font-size:12px">· %s · fit %s</span><div style="color:#555">%s</div><div>%s</div><div style="color:#555"><i>%s</i></div></li>',
      oq_esc(i.url), oq_esc(i.title), oq_esc(i.kind), i.score, oq_esc(oq_item_meta(i)), oq_esc(i.summary), oq_esc(i.why_relevant));
    tx := format('- %s [%s, fit %s] — %s%s%s', i.title, i.kind, i.score, oq_item_meta(i), E'\n  ' || i.summary, E'\n  ' || i.url);
    h_up := h_up || li; t_up := t_up || tx || E'\n'; n_up := n_up + 1;
  end loop;

  foreach i in array fresh loop
    n_fresh := n_fresh + 1; ids := ids || i.id;
    continue when i.id = any (shown);
    li := format('<li style="margin:0 0 14px"><a href="%s" style="color:#1a56db;text-decoration:none"><b>%s</b></a> <span style="color:#888;font-size:12px">· %s · fit %s</span><div style="color:#555">%s</div><div>%s</div><div style="color:#555"><i>%s</i></div>%s</li>',
      oq_esc(i.url), oq_esc(i.title), oq_esc(i.kind), i.score, oq_esc(oq_item_meta(i)), oq_esc(i.summary), oq_esc(i.why_relevant),
      case when i.kind = 'angel' and coalesce(i.details->>'contact_path', '') <> '' then '<div style="color:#555">Path: ' || oq_esc(i.details->>'contact_path') || '</div>' else '' end);
    tx := format('- %s [%s, fit %s] — %s%s%s', i.title, i.kind, i.score, oq_item_meta(i), E'\n  ' || i.summary, E'\n  ' || i.url);
    if i.section = 'personal' then h_per := h_per || li; t_per := t_per || tx || E'\n'; n_per := n_per + 1;
    elsif i.kind = 'angel' then h_ang := h_ang || li; t_ang := t_ang || tx || E'\n'; n_ang := n_ang + 1;
    else h_oth := h_oth || li; t_oth := t_oth || tx || E'\n'; n_oth := n_oth + 1; end if;
  end loop;

  select count(*) filter (where o.stage = 'drafted'),
         count(*) filter (where o.stage = 'sent' and o.next_followup_at <= today),
         count(*) filter (where o.stage = 'replied' and o.replied_at > now() - interval '8 days')
    into o_drafts, o_due, o_replies
    from outreach o;
  if o_drafts + o_due + o_replies > 0 then
    o_html := '<h2 style="font-size:16px;margin:24px 0 8px">Outreach</h2><p style="margin:0">'
      || concat_ws(' · ',
           case when o_drafts > 0 then o_drafts || ' draft' || case when o_drafts = 1 then '' else 's' end || ' to review' end,
           case when o_due > 0 then o_due || ' follow-up' || case when o_due = 1 then '' else 's' end || ' due' end,
           case when o_replies > 0 then o_replies || ' new repl' || case when o_replies = 1 then 'y' else 'ies' end end)
      || case when p_dashboard_url is not null then ' · <a href="' || oq_esc(p_dashboard_url) || '/outreach">Open outreach</a>' else '' end || '</p>';
    o_txt := E'\nOUTREACH\n' || concat_ws(' · ',
           case when o_drafts > 0 then o_drafts || ' drafts to review' end,
           case when o_due > 0 then o_due || ' follow-ups due' end,
           case when o_replies > 0 then o_replies || ' new replies' end) || E'\n';
  end if;

  subj := format('Query digest: %s new find%s%s (%s)', n_fresh, case when n_fresh = 1 then '' else 's' end,
                 case when n_up > 0 then ', ' || n_up || ' coming up' else '' end, today);
  html := '<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#111;line-height:1.45">'
    || '<h1 style="font-size:20px;margin:0 0 4px">Query digest</h1><div style="color:#666">' || today
    || case when p_dashboard_url is not null then ' · <a href="' || oq_esc(p_dashboard_url) || '">Open dashboard</a>' else '' end || '</div>'
    || case when n_up > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Coming up in the next 14 days (' || n_up || ')</h2><ul style="padding-left:18px;margin:0">' || h_up || '</ul>' else '' end
    || case when n_ang > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Sooz — new angels (' || n_ang || ')</h2><ul style="padding-left:18px;margin:0">' || h_ang || '</ul>' else '' end
    || case when n_oth > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Sooz — events, funding &amp; resources (' || n_oth || ')</h2><ul style="padding-left:18px;margin:0">' || h_oth || '</ul>' else '' end
    || case when n_per > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Personal (' || n_per || ')</h2><ul style="padding-left:18px;margin:0">' || h_per || '</ul>' else '' end
    || o_html
    || '</body></html>';
  txt := 'QUERY DIGEST — ' || today || E'\n'
    || case when p_dashboard_url is not null then 'Dashboard: ' || p_dashboard_url || E'\n' else '' end
    || case when n_up > 0 then E'\nCOMING UP IN THE NEXT 14 DAYS (' || n_up || E')\n' || t_up else '' end
    || case when n_ang > 0 then E'\nSOOZ — NEW ANGELS (' || n_ang || E')\n' || t_ang else '' end
    || case when n_oth > 0 then E'\nSOOZ — EVENTS, FUNDING & RESOURCES (' || n_oth || E')\n' || t_oth else '' end
    || case when n_per > 0 then E'\nPERSONAL (' || n_per || E')\n' || t_per else '' end
    || o_txt;

  return jsonb_build_object('count', n_fresh, 'upcoming', n_up, 'subject', subj, 'html', html, 'text', txt, 'ids', to_jsonb(ids),
                            'outreach', jsonb_build_object('drafts', o_drafts, 'followups_due', o_due, 'new_replies', o_replies,
                                                           'actions', o_drafts + o_due + o_replies));
end $$;

create or replace function oq_mark_digested(p_ids bigint[]) returns int language sql as $$
  with u as (update items set digested_at = now() where id = any (p_ids) returning 1) select count(*)::int from u
$$;

-- ---------------------------------------------------------------------------------------------
-- Outreach functions used by the routines (they may only call these, never raw DML).
-- ---------------------------------------------------------------------------------------------

-- Put high-fit, non-dismissed angels into the pipeline. Returns how many were added.
create or replace function oq_outreach_queue(p_min_score int default 70) returns int language sql as $$
  with ins as (
    insert into outreach (item_id)
    select i.id from items i
     where i.section = 'sooz' and i.kind = 'angel' and i.score >= p_min_score
       and i.status not in ('dismissed')
       and not exists (select 1 from outreach o where o.item_id = i.id)
    on conflict do nothing
    returning 1
  )
  select count(*)::int from ins
$$;

create or replace function oq_company_key(t text) returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(regexp_replace(lower(coalesce(t, '')),
           '\m(inc|llc|l\.l\.c|ltd|co|corp|corporation|company|the|lp|llp|plc)\M\.?', '', 'g'),
           '[^a-z0-9]+', ' ', 'g')), '')
$$;

-- Prospects that still need contact info or drafts, with everything a drafter needs.
create or replace function oq_outreach_todo(p_limit int default 10) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'pitch', coalesce((select jsonb_object_agg(key, value) from settings where key like 'pitch.%'), '{}'::jsonb),
    'prospects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_id', i.id, 'name', i.title, 'url', i.url, 'summary', i.summary, 'why_relevant', i.why_relevant,
               'score', i.score, 'tags', i.tags, 'details', i.details, 'location', i.location,
               'email', o.email, 'linkedin_url', o.linkedin_url, 'warm_path', o.warm_path,
               'network_matches', (
                 select coalesce(jsonb_agg(jsonb_build_object('name', n.full_name, 'company', n.company, 'position', n.position)), '[]'::jsonb)
                   from network n
                  where n.company_key is not null and length(n.company_key) >= 3
                    and n.company_key = oq_company_key(i.details->>'firm')
               )
             ) order by i.score desc)
        from (select o2.* from outreach o2 join items i2 on i2.id = o2.item_id
               where o2.stage = 'prospect' and i2.status <> 'dismissed'
               order by i2.score desc limit p_limit) o
        join items i on i.id = o.item_id
    ), '[]'::jsonb)
  )
$$;


-- Save enrichment and drafts for one prospect. Only touches prospects/drafts, never sent threads.
create or replace function oq_outreach_save(p_item_id bigint, p jsonb) returns jsonb language plpgsql as $$
declare
  o outreach;
  v_email text := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  v_li text := nullif(btrim(coalesce(p->>'linkedin_url', '')), '');
  v_body text := nullif(btrim(coalesce(p->>'body', '')), '');
begin
  select * into o from outreach where item_id = p_item_id for update;
  if not found then raise exception 'item % is not in the outreach pipeline', p_item_id; end if;
  if o.stage not in ('prospect', 'drafted') then
    return jsonb_build_object('ok', false, 'reason', 'stage is ' || o.stage || '; drafts are frozen once sent');
  end if;
  if v_email is not null and v_email !~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' then v_email := null; end if;
  if v_li is not null and v_li !~* '^https://([a-z]{2,3}\.)?linkedin\.com/in/[^/?#\s]+/?$' then v_li := null; end if;

  update outreach set
    email         = coalesce(v_email, email),
    email_source  = case when v_email is not null then left(coalesce(nullif(p->>'email_source', ''), 'routine'), 40) else email_source end,
    linkedin_url  = coalesce(v_li, linkedin_url),
    warm_path     = coalesce(left(nullif(btrim(p->>'warm_path'), ''), 500), warm_path),
    subject       = coalesce(left(nullif(btrim(p->>'subject'), ''), 160), subject),
    body          = coalesce(left(v_body, 3000), body),
    linkedin_note = coalesce(left(nullif(btrim(p->>'linkedin_note'), ''), 300), linkedin_note),
    intro_request = coalesce(left(nullif(btrim(p->>'intro_request'), ''), 2000), intro_request),
    followup_1    = coalesce(left(nullif(btrim(p->>'followup_1'), ''), 1500), followup_1),
    followup_2    = coalesce(left(nullif(btrim(p->>'followup_2'), ''), 1500), followup_2),
    drafted_by    = case when v_body is not null then 'claude' else drafted_by end,
    drafted_at    = case when v_body is not null then now() else drafted_at end,
    stage         = case when v_body is not null or o.body is not null then 'drafted' else stage end,
    updated_at    = now()
  where item_id = p_item_id;
  insert into outreach_events (item_id, kind, detail)
    values (p_item_id, 'routine_saved', left(concat_ws(', ',
      case when v_email is not null then 'email' end, case when v_li is not null then 'linkedin' end,
      case when v_body is not null then 'draft' end), 200));
  return jsonb_build_object('ok', true, 'email_saved', v_email is not null, 'linkedin_saved', v_li is not null,
                            'draft_saved', v_body is not null);
end $$;

-- Threads we are waiting on (for reply / sent detection in Gmail).
create or replace function oq_outreach_watch() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', o.item_id, 'name', i.title, 'email', o.email,
                                               'stage', o.stage, 'subject', o.subject, 'sent_at', o.sent_at)), '[]'::jsonb)
    from outreach o join items i on i.id = o.item_id
   where o.email is not null and o.stage in ('drafted', 'sent')
$$;

-- Record what Gmail shows: 'sent' (the user sent the first email) or 'replied'.
create or replace function oq_outreach_observe(p_item_id bigint, p_event text, p_at timestamptz) returns text language plpgsql as $$
declare o outreach;
begin
  select * into o from outreach where item_id = p_item_id for update;
  if not found then return 'not found'; end if;
  if p_event = 'sent' and o.stage = 'drafted' then
    update outreach set stage = 'sent', sent_at = coalesce(p_at, now()), last_touch_at = coalesce(p_at, now()),
           touches = greatest(touches, 1), next_followup_at = (coalesce(p_at, now()) + interval '5 days')::date, updated_at = now()
     where item_id = p_item_id;
  elsif p_event = 'replied' and o.stage in ('drafted', 'sent') then
    update outreach set stage = 'replied', replied_at = coalesce(p_at, now()), next_followup_at = null, updated_at = now()
     where item_id = p_item_id;
  else
    return 'ignored';
  end if;
  insert into outreach_events (item_id, kind, detail) values (p_item_id, 'gmail_' || p_event, coalesce(p_at::text, ''));
  return 'ok';
end $$;
