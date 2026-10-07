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

-- Fully rendered, HTML-escaped digest. The routine just forwards `subject`/`html`/`text`, then calls oq_mark_digested(ids).
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

  subj := format('Query digest: %s new find%s%s (%s)', n_fresh, case when n_fresh = 1 then '' else 's' end,
                 case when n_up > 0 then ', ' || n_up || ' coming up' else '' end, today);
  html := '<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#111;line-height:1.45">'
    || '<h1 style="font-size:20px;margin:0 0 4px">Query digest</h1><div style="color:#666">' || today
    || case when p_dashboard_url is not null then ' · <a href="' || oq_esc(p_dashboard_url) || '">Open dashboard</a>' else '' end || '</div>'
    || case when n_up > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Coming up in the next 14 days (' || n_up || ')</h2><ul style="padding-left:18px;margin:0">' || h_up || '</ul>' else '' end
    || case when n_ang > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Sooz — new angels (' || n_ang || ')</h2><ul style="padding-left:18px;margin:0">' || h_ang || '</ul>' else '' end
    || case when n_oth > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Sooz — events, funding &amp; resources (' || n_oth || ')</h2><ul style="padding-left:18px;margin:0">' || h_oth || '</ul>' else '' end
    || case when n_per > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Personal (' || n_per || ')</h2><ul style="padding-left:18px;margin:0">' || h_per || '</ul>' else '' end
    || '</body></html>';
  txt := 'QUERY DIGEST — ' || today || E'\n'
    || case when p_dashboard_url is not null then 'Dashboard: ' || p_dashboard_url || E'\n' else '' end
    || case when n_up > 0 then E'\nCOMING UP IN THE NEXT 14 DAYS (' || n_up || E')\n' || t_up else '' end
    || case when n_ang > 0 then E'\nSOOZ — NEW ANGELS (' || n_ang || E')\n' || t_ang else '' end
    || case when n_oth > 0 then E'\nSOOZ — EVENTS, FUNDING & RESOURCES (' || n_oth || E')\n' || t_oth else '' end
    || case when n_per > 0 then E'\nPERSONAL (' || n_per || E')\n' || t_per else '' end;

  return jsonb_build_object('count', n_fresh, 'upcoming', n_up, 'subject', subj, 'html', html, 'text', txt, 'ids', to_jsonb(ids));
end $$;

create or replace function oq_mark_digested(p_ids bigint[]) returns int language sql as $$
  with u as (update items set digested_at = now() where id = any (p_ids) returning 1) select count(*)::int from u
$$;
