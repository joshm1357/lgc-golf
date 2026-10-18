-- 041 — Stage 9 launch basics (the parts that don't remove anything). Additive.
-- 1. Stay cards: QR cards for accommodation (placement 'stay'). Josh issues them; no club account needed.
-- 2. App problems: the app sends its own errors here (no outside service, no new dependency). Josh sees them.
-- 3. Josh's numbers: groups, trips run, players scoring, groups that came back, and the scan funnel by club and
--    placement. Counts only. Platform admins only.
-- 4. Export: an organiser downloads all of their group's data (not phone numbers of anyone's sign-in, not locations).
-- (Leaving a group, deleting your account and deleting a group remove rows — those are in 041b for Josh to apply.)

-- 1. Stay partners live in clubs with kind = 'stay' (no members, no course pages; just a ref for their cards).
alter table public.clubs add column if not exists kind text not null default 'club';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clubs_kind_check') then
    alter table public.clubs add constraint clubs_kind_check check (kind in ('club', 'stay'));
  end if;
end $$;

create or replace function public.admin_new_stay(p_name text)
returns json language plpgsql security definer set search_path = '' as $$
declare v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g')), 80); v_ref text; v_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'Only Josh can do that'; end if;
  if length(v_name) < 2 then raise exception 'Give the place a name'; end if;
  loop
    v_ref := 'S' || upper(private.random_code(7));
    exit when v_ref ~ '^[A-Z0-9]{4,12}$' and not exists (select 1 from public.clubs where ref = v_ref);
  end loop;
  insert into public.clubs (name, ref, kind) values (v_name, v_ref, 'stay') returning id into v_id;
  return json_build_object('id', v_id, 'name', v_name, 'ref', v_ref);
end $$;

create or replace function public.admin_stays()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'ref', c.ref, 'created_at', c.created_at,
           'scans', (select count(distinct visitor) from public.scan_log s where s.club_id = c.id),
           'groups', (select count(*) from public.groups g where g.source ->> 'ref' = c.ref)) order by c.created_at desc), '[]'::json)
  from public.clubs c where c.kind = 'stay' and private.is_platform_admin();
$$;
revoke all on function public.admin_new_stay(text), public.admin_stays() from public, anon;
grant execute on function public.admin_new_stay(text), public.admin_stays() to authenticated;

-- 2. App problems.
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  message text not null,
  stack text,
  path text,
  version text,
  agent text,
  group_id uuid,
  ip_mark text,
  created_at timestamptz not null default now()
);
create index if not exists client_errors_time_idx on public.client_errors (created_at);
create index if not exists client_errors_ip_idx on public.client_errors (ip_mark, created_at);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

-- Anyone's app can report (it may not be signed in yet). At most 30 an hour from one internet address; the address
-- itself isn't kept (only a daily scrambled mark, for the limit). The page address is kept without anything after '?'.
create or replace function public.report_error(p_message text, p_stack text default null, p_path text default null, p_version text default null, p_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ip text := md5(coalesce(private.request_ip(), 'unknown') || current_date::text || (select salt from private.scan_salt limit 1)); v_g uuid;
begin
  if coalesce(btrim(p_message), '') = '' then return; end if;
  if (select count(*) from public.client_errors where ip_mark = v_ip and created_at > now() - interval '1 hour') >= 30 then return; end if;
  begin v_g := private.current_group(); exception when others then v_g := null; end;
  insert into public.client_errors (message, stack, path, version, agent, group_id, ip_mark)
  values (left(p_message, 500), left(p_stack, 3000), left(split_part(split_part(coalesce(p_path, ''), '?', 1), '#/join/', 1), 200),
          left(p_version, 40), left(p_agent, 200), v_g, v_ip);
end $$;
revoke all on function public.report_error(text, text, text, text, text) from public;
grant execute on function public.report_error(text, text, text, text, text) to anon, authenticated;

create or replace function public.admin_errors(p_days int default 7)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(x order by x.last_seen desc), '[]'::json) from (
    select e.message, count(*) as times, count(distinct e.ip_mark) as phones, max(e.created_at) as last_seen,
           (array_agg(e.stack order by e.created_at desc))[1] as stack, (array_agg(e.path order by e.created_at desc))[1] as path,
           (array_agg(e.version order by e.created_at desc))[1] as version, (array_agg(e.agent order by e.created_at desc))[1] as agent
    from public.client_errors e
    where e.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
    group by e.message limit 100) x
  where private.is_platform_admin();
$$;
revoke all on function public.admin_errors(int) from public, anon;
grant execute on function public.admin_errors(int) to authenticated;

-- 3. Josh's numbers.
create or replace function public.admin_usage(p_days int default 90)
returns json language sql stable security definer set search_path = '' as $$
  with since as (select now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 3650)) as t),
       played as (select r.group_id, r.trip_id, r.play_date, s.subject_id
                  from public.rounds r join public.scores s on s.round_id = r.id and s.subject_type = 'player'),
       g as (select gr.*, (select count(distinct p.play_date) from played p where p.group_id = gr.id) as days_played,
                    exists (select 1 from public.plans pl where pl.group_id = gr.id) as planned
             from public.groups gr),
       trips_run as (select trip_id, count(distinct subject_id) as players from played where trip_id is not null group by trip_id),
       refs as (select c.id, c.ref, c.name, c.kind from public.clubs c)
  select json_build_object(
    'days', least(greatest(coalesce(p_days, 90), 1), 3650),
    'groups', json_build_object(
      'all', (select count(*) from g where not coalesce(g.legacy, false)),
      'new', (select count(*) from g where g.created_at > (select t from since)),
      'quick', (select count(*) from g where g.quick),
      'official', (select count(*) from g where not g.quick),
      'came_back', (select count(*) from g where g.days_played >= 2),
      'planned_a_trip', (select count(*) from g where g.planned),
      'from_another_groups_card', (select count(*) from g where g.source ? 'from_group')),
    'trips', json_build_object(
      'run', (select count(*) from trips_run),
      'players_scoring_avg', (select round(avg(players), 1) from trips_run),
      'players_scoring_max', (select max(players) from trips_run)),
    'funnel', (select coalesce(json_agg(f order by f.scans desc, f.name), '[]'::json) from (
      select r.name, r.kind, r.ref, pl.placement,
             (select count(distinct s.visitor) from public.scan_log s where s.club_id = r.id and s.placement = pl.placement and s.created_at > (select t from since)) as scans,
             (select count(*) from g where g.source ->> 'ref' = r.ref and g.source ->> 'placement' = pl.placement and g.created_at > (select t from since)) as groups_started,
             (select count(*) from g where g.source ->> 'ref' = r.ref and g.source ->> 'placement' = pl.placement and g.created_at > (select t from since)
                and exists (select 1 from public.rounds x where x.group_id = g.id)) as rounds_started,
             (select count(*) from g where g.source ->> 'ref' = r.ref and g.source ->> 'placement' = pl.placement and g.created_at > (select t from since)
                and (g.days_played >= 2 or g.planned)) as came_back_or_planned
      from refs r cross join (values ('cart'), ('par3'), ('counter'), ('tv'), ('stay')) pl(placement)) f
      where f.scans > 0 or f.groups_started > 0))
  where private.is_platform_admin();
$$;
revoke all on function public.admin_usage(int) from public, anon;
grant execute on function public.admin_usage(int) to authenticated;

-- 4. Export the group's data (organiser, signed in properly). Leaves out: who signs in as whom, invite codes,
--    connector keys, phone locations, notification settings.
create or replace function public.export_group()
returns json language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); t record; v_out jsonb := '{}'; v_rows json;
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  if coalesce((select is_anonymous from auth.users where id = auth.uid()), true) then
    raise exception 'Add a sign-in first (Group & invites) — then you can download your group''s data';
  end if;
  for t in
    select c.table_name from information_schema.columns c join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'group_id'
      and c.table_name not in ('group_members', 'group_invites', 'connector_keys', 'location_pings', 'notify_prefs', 'notify_queue',
                               'client_errors', 'push_subscriptions')
    order by c.table_name
  loop
    execute format('select coalesce(json_agg(x), ''[]''::json) from public.%I x where x.group_id = $1', t.table_name) into v_rows using v_g;
    v_out := v_out || jsonb_build_object(t.table_name, v_rows);
  end loop;
  v_out := v_out || jsonb_build_object(
    'group', (select json_build_object('name', name, 'slug', slug, 'created_at', created_at) from public.groups where id = v_g),
    'members', (select coalesce(json_agg(json_build_object('player_id', player_id, 'role', role, 'joined', created_at)), '[]'::json)
                from public.group_members where group_id = v_g),
    'exported_at', now());
  return v_out::json;
end $$;
revoke all on function public.export_group() from public, anon;
grant execute on function public.export_group() to authenticated;
