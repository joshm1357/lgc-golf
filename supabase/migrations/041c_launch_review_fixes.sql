-- 041c — Stage 9 review fixes (the parts that don't remove anything). Additive (replaced function bodies).

-- Export: a fixed list of the group's tables (a new table is only exported once it's added here), rooms and cars
-- included, feature switches without who changed them.
create or replace function public.export_group()
returns json language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); t text; v_out jsonb := '{}'; v_rows json;
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  if coalesce((select is_anonymous from auth.users where id = auth.uid()), true) then
    raise exception 'Add a sign-in first (Group & invites) — then you can download your group''s data';
  end if;
  foreach t in array array['players', 'handicap_history', 'trips', 'courses', 'rounds', 'round_players', 'teams', 'team_players',
    'scores', 'quick_results', 'side_entries', 'draws', 'round_pins', 'honour_board', 'trophies', 'posts', 'comments', 'reactions',
    'rules', 'rule_votes', 'tribunal_cases', 'tribunal_votes', 'plans', 'plan_polls', 'plan_options', 'plan_votes', 'plan_rsvps',
    'plan_items', 'plan_costs', 'plan_payments', 'plan_transfers', 'plan_groups', 'plan_comments'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select coalesce(json_agg(x), ''[]''::json) from public.%I x where x.group_id = $1', t) into v_rows using v_g;
      v_out := v_out || jsonb_build_object(t, v_rows);
    end if;
  end loop;
  v_out := v_out || jsonb_build_object(
    'plan_group_members', (select coalesce(json_agg(json_build_object('room_or_car', m.group_id, 'player_id', m.player_id)), '[]'::json)
                           from public.plan_group_members m join public.plan_groups pg on pg.id = m.group_id where pg.group_id = v_g),
    'features', (select coalesce(json_object_agg(feature_key, enabled), '{}'::json) from public.group_features where group_id = v_g),
    'group', (select json_build_object('name', name, 'slug', slug, 'created_at', created_at) from public.groups where id = v_g),
    'members', (select coalesce(json_agg(json_build_object('player_id', player_id, 'role', role, 'joined', created_at)), '[]'::json)
                from public.group_members where group_id = v_g),
    'exported_at', now());
  return v_out::json;
end $$;

-- App problems: never keep a sign-in token from the page address; Josh's list is the most recent 100.
create or replace function public.report_error(p_message text, p_stack text default null, p_path text default null, p_version text default null, p_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ip text := md5(coalesce(private.request_ip(), 'unknown') || current_date::text || (select salt from private.scan_salt limit 1)); v_g uuid;
        v_path text := coalesce(p_path, '');
begin
  if coalesce(btrim(p_message), '') = '' then return; end if;
  if (select count(*) from public.client_errors where ip_mark = v_ip and created_at > now() - interval '1 hour') >= 30 then return; end if;
  begin v_g := private.current_group(); exception when others then v_g := null; end;
  v_path := split_part(split_part(v_path, '?', 1), '#/join/', 1);
  v_path := regexp_replace(v_path, '(access_token|refresh_token|provider_token|token_hash|error_description|code)=.*$', '', 'g');
  insert into public.client_errors (message, stack, path, version, agent, group_id, ip_mark)
  values (left(p_message, 500), left(p_stack, 3000), left(v_path, 200), left(p_version, 40), left(p_agent, 200), v_g, v_ip);
end $$;

create or replace function public.admin_errors(p_days int default 7)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(x order by x.last_seen desc), '[]'::json) from (
    select e.message, count(*) as times, count(distinct e.ip_mark) as phones, max(e.created_at) as last_seen,
           (array_agg(e.stack order by e.created_at desc))[1] as stack, (array_agg(e.path order by e.created_at desc))[1] as path,
           (array_agg(e.version order by e.created_at desc))[1] as version, (array_agg(e.agent order by e.created_at desc))[1] as agent
    from public.client_errors e
    where e.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
    group by e.message order by max(e.created_at) desc limit 100) x
  where private.is_platform_admin();
$$;

-- Josh's numbers: "came back" = played again at least 30 days after their first round (one two-day trip isn't a
-- return); L.G.C left out of every group count; scores read once.
create or replace function public.admin_usage(p_days int default 90)
returns json language sql stable security definer set search_path = '' as $$
  with since as (select now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 3650)) as t),
       played as (select distinct r.group_id, r.trip_id, r.play_date, s.subject_id
                  from public.rounds r join public.scores s on s.round_id = r.id and s.subject_type = 'player'),
       days as (select group_id, min(play_date) as first_day, max(play_date) as last_day from played group by group_id),
       g as (select gr.id, gr.quick, gr.source, gr.created_at,
                    coalesce((select d.last_day >= d.first_day + 30 from days d where d.group_id = gr.id), false) as came_back,
                    exists (select 1 from public.plans pl where pl.group_id = gr.id) as planned
             from public.groups gr where not coalesce(gr.legacy, false)),
       trips_run as (select trip_id, count(distinct subject_id) as players from played
                     where trip_id is not null and group_id in (select id from g) group by trip_id),
       refs as (select c.id, c.ref, c.name, c.kind from public.clubs c)
  select json_build_object(
    'days', least(greatest(coalesce(p_days, 90), 1), 3650),
    'groups', json_build_object(
      'all', (select count(*) from g),
      'new', (select count(*) from g where g.created_at > (select t from since)),
      'quick', (select count(*) from g where g.quick),
      'official', (select count(*) from g where not g.quick),
      'came_back', (select count(*) from g where g.came_back),
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
                and (g.came_back or g.planned)) as came_back_or_planned
      from refs r cross join (values ('cart'), ('par3'), ('counter'), ('tv'), ('stay')) pl(placement)) f
      where f.scans > 0 or f.groups_started > 0))
  where private.is_platform_admin();
$$;
