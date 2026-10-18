-- 029 — Stage 3: feature switches, per group, enforced by the database. Additive.
-- The list matches src/lib/features.js (a unit test checks them). Reads always stay allowed, so history isn't lost;
-- writes to a switched-off feature are refused — from any app version or the Claude connector.

-- ------------------------------------------------------------------ The list of features
create table if not exists public.feature_catalogue (
  key text primary key,
  default_on boolean not null,            -- for a group that hasn't chosen
  parent text references public.feature_catalogue(key),
  tier text not null default 'free'       -- for a premium plan later; everything is free now
);
alter table public.feature_catalogue enable row level security;
create policy "everyone reads" on public.feature_catalogue for select using (true);
revoke insert, update, delete on public.feature_catalogue from anon, authenticated;
grant select on public.feature_catalogue to authenticated;

insert into public.feature_catalogue (key, default_on, parent, tier) values
  ('feed', true, null, 'free'),
  ('side_comps', true, null, 'free'),
  ('comp_bonus', false, 'side_comps', 'free'),
  ('trophies', true, null, 'free'),
  ('tribunal', true, null, 'free'),
  ('draw', true, null, 'free'),
  ('gps', true, null, 'free'),
  ('location', false, null, 'free'),
  ('planner', true, null, 'free'),
  ('planner_tasks', true, 'planner', 'free'),
  ('planner_costs', true, 'planner', 'free'),
  ('planner_rooms', false, 'planner', 'free'),
  ('rule_voting', true, null, 'free'),
  ('notifications', true, null, 'free'),
  ('connector', false, null, 'free'),
  ('scorecard_photo', false, null, 'free'),
  ('booking_links', false, null, 'free')
on conflict (key) do nothing;

-- ------------------------------------------------------------------ Each group's choices
create table if not exists public.group_features (
  group_id uuid not null references public.groups(id) on delete cascade,
  feature_key text not null references public.feature_catalogue(key),
  enabled boolean not null,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (group_id, feature_key)
);
create index if not exists group_features_key_idx on public.group_features (feature_key);
alter table public.group_features enable row level security;
create policy "members read" on public.group_features for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "same group only" on public.group_features as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke insert, update, delete on public.group_features from anon, authenticated;
grant select on public.group_features to authenticated;
alter publication supabase_realtime add table public.group_features;

-- A premium plan later can say no here; for now every tier is allowed.
create or replace function private.tier_allows(p_group uuid, p_tier text)
returns boolean language sql stable set search_path = '' as $$ select true $$;

-- Is a feature on for a group? The group's choice, else the default; off if its parent is off.
create or replace function public.feature_on(p_group uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare f public.feature_catalogue; v boolean;
begin
  select * into f from public.feature_catalogue where key = p_key;
  if f.key is null then return true; end if;           -- core things are always on
  select enabled into v from public.group_features where group_id = p_group and feature_key = p_key;
  v := coalesce(v, f.default_on) and private.tier_allows(p_group, f.tier);
  if v and f.parent is not null then return public.feature_on(p_group, f.parent); end if;
  return v;
end $$;
revoke all on function public.feature_on(uuid, text) from public, anon;
grant execute on function public.feature_on(uuid, text) to authenticated, service_role;

-- An organiser switches a feature on or off for their group.
create or replace function public.set_feature(p_key text, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can change features'; end if;
  if not exists (select 1 from public.feature_catalogue where key = p_key) then raise exception 'Unknown feature'; end if;
  insert into public.group_features (group_id, feature_key, enabled) values (v_g, p_key, p_on)
  on conflict (group_id, feature_key) do update set enabled = excluded.enabled, updated_by = auth.uid(), updated_at = now();
end $$;
revoke all on function public.set_feature(text, boolean) from public, anon;
grant execute on function public.set_feature(text, boolean) to authenticated;

-- L.G.C: everything on, apart from scorecard photos and booking links.
insert into public.group_features (group_id, feature_key, enabled, updated_by)
select private.legacy_group(), k, true, null from unnest(array['comp_bonus', 'location', 'planner_rooms', 'connector']) k
where private.legacy_group() is not null
on conflict (group_id, feature_key) do nothing;

-- ------------------------------------------------------------------ The database refuses writes to a switched-off feature
-- Three "restrictive" rules per table (add / change / remove), so reading is never affected.
do $$
declare r record;
begin
  for r in select * from (values
    ('posts', 'feed'), ('comments', 'feed'), ('reactions', 'feed'),
    ('side_entries', 'side_comps'),
    ('trophies', 'trophies'), ('honour_board', 'trophies'),
    ('tribunal_cases', 'tribunal'), ('tribunal_votes', 'tribunal'),
    ('draws', 'draw'),
    ('round_pins', 'gps'),
    ('location_pings', 'location'),
    ('plans', 'planner'), ('plan_rsvps', 'planner'), ('plan_comments', 'planner'),
    ('plan_polls', 'planner_tasks'), ('plan_options', 'planner_tasks'), ('plan_votes', 'planner_tasks'), ('plan_items', 'planner_tasks'),
    ('plan_costs', 'planner_costs'), ('plan_payments', 'planner_costs'), ('plan_transfers', 'planner_costs'),
    ('plan_groups', 'planner_rooms'),
    ('rule_votes', 'rule_voting')
  ) as t(tbl, feature)
  loop
    execute format('create policy %I on public.%I as restrictive for insert with check (public.feature_on(group_id, %L))',
                   'feature on: ' || r.feature || ' (add)', r.tbl, r.feature);
    execute format('create policy %I on public.%I as restrictive for update using (public.feature_on(group_id, %L)) with check (public.feature_on(group_id, %L))',
                   'feature on: ' || r.feature || ' (change)', r.tbl, r.feature, r.feature);
    execute format('create policy %I on public.%I as restrictive for delete using (public.feature_on(group_id, %L))',
                   'feature on: ' || r.feature || ' (remove)', r.tbl, r.feature);
  end loop;
end $$;

-- Rooms and cars' people: through their room or car (their group_id column is the room/car).
create policy "feature on: planner_rooms (add)" on public.plan_group_members as restrictive for insert
  with check (exists (select 1 from public.plan_groups pg where pg.id = plan_group_members.group_id and public.feature_on(pg.group_id, 'planner_rooms')));
create policy "feature on: planner_rooms (change)" on public.plan_group_members as restrictive for update
  using (exists (select 1 from public.plan_groups pg where pg.id = plan_group_members.group_id and public.feature_on(pg.group_id, 'planner_rooms')));
create policy "feature on: planner_rooms (remove)" on public.plan_group_members as restrictive for delete
  using (exists (select 1 from public.plan_groups pg where pg.id = plan_group_members.group_id and public.feature_on(pg.group_id, 'planner_rooms')));

-- Rule proposals from players need rule voting; organisers can always add rules in force.
create policy "feature on: rule_voting (propose)" on public.rules as restrictive for insert
  with check (status <> 'proposed' or public.feature_on(group_id, 'rule_voting'));
-- Side comp bonus strokes need that feature.
create policy "feature on: comp_bonus (add)" on public.rounds as restrictive for insert
  with check (coalesce(comp_bonus, 0) = 0 or public.feature_on(group_id, 'comp_bonus'));
create policy "feature on: comp_bonus (change)" on public.rounds as restrictive for update
  using (true)
  with check (coalesce(comp_bonus, 0) = 0 or public.feature_on(group_id, 'comp_bonus'));

-- ------------------------------------------------------------------ Server functions check too (they bypass the rules above)
create or replace function private.require_feature(p_group uuid, p_key text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.feature_on(p_group, p_key) then
    raise exception '% is switched off for this group', (select coalesce(initcap(replace(p_key, '_', ' ')), p_key));
  end if;
end $$;
revoke all on function private.require_feature(uuid, text) from public, anon;
grant execute on function private.require_feature(uuid, text) to authenticated;

-- Tribunal
create or replace function public.cast_vote(p_case uuid, p_vote text, p_comment text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare c public.tribunal_cases%rowtype; v_me uuid; v_eligible int; v_votes int;
begin
  select * into c from public.tribunal_cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
  perform private.require_feature(c.group_id, 'tribunal');
  if c.status <> 'open' then raise exception 'This case is closed'; end if;
  if private.is_group_guest(c.group_id) then raise exception 'Guests don''t vote in the Tribunal'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if c.accused_id = v_me then raise exception 'The accused can''t vote on their own case'; end if;
  insert into public.tribunal_votes (group_id, case_id, voter_id, vote, comment)
  values (c.group_id, p_case, v_me, p_vote, nullif(trim(coalesce(p_comment,'')), ''))
  on conflict (case_id, voter_id) do update set vote = excluded.vote, comment = excluded.comment, created_at = now();
  select count(distinct gm.player_id) into v_eligible from public.group_members gm
    where gm.group_id = c.group_id and gm.player_id is not null and gm.player_id <> c.accused_id and gm.role <> 'guest';
  select count(*) into v_votes from public.tribunal_votes where case_id = p_case;
  if v_eligible > 0 and v_votes >= v_eligible then
    perform public.finalise_case(p_case, null, null);
  end if;
end $$;

create or replace function public.lodge_case(p_accused uuid, p_change numeric, p_text text, p_exhibit_url text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid := private.current_group(); v_me uuid; v_id uuid; v_name text;
begin
  perform private.require_feature(v_g, 'tribunal');
  if private.is_group_guest(v_g) then raise exception 'Guests can''t lodge Tribunal cases'; end if;
  v_me := private.my_player_id(v_g);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if not exists (select 1 from public.players where id = p_accused and group_id = v_g) then raise exception 'No such player'; end if;
  if p_change = 0 then raise exception 'Propose a change'; end if;
  if exists (select 1 from public.tribunal_cases where accused_id = p_accused and status = 'open') then
    raise exception 'There is already an open case against this player';
  end if;
  insert into public.tribunal_cases (group_id, accused_id, lodged_by, proposed_change, case_text, exhibit_url)
  values (v_g, p_accused, v_me, p_change, trim(p_text), p_exhibit_url) returning id into v_id;
  select coalesce(nickname, name) into v_name from public.players where id = p_accused;
  if public.feature_on(v_g, 'feed') then
    insert into public.posts (group_id, kind, body, player_id, link, photo_url)
    values (v_g, 'tribunal', 'Case lodged: The Lads v ' || v_name || ' (proposed ' ||
      case when p_change > 0 then '+' else '' end || trim(to_char(p_change, 'FM990.0')) || ')', v_me,
      '/tribunal/' || v_id, p_exhibit_url);
  end if;
  return v_id;
end $$;

-- Trip votes
do $$
begin
  -- start_trip_votes / decide_poll: add the planner_tasks check at the top, keeping the rest as in 025.
  execute regexp_replace(pg_get_functiondef('public.start_trip_votes(uuid, jsonb, jsonb, date)'::regprocedure),
    'if v\.status <> ''planning'' then', 'perform private.require_feature(v.group_id, ''planner_tasks'');' || chr(10) || '  if v.status <> ''planning'' then');
  execute regexp_replace(pg_get_functiondef('public.decide_poll(uuid, uuid, boolean)'::regprocedure),
    'if not public\.can_decide\(v_poll\.plan_id\) then', 'perform private.require_feature(v_poll.group_id, ''planner_tasks'');' || chr(10) || '  if not public.can_decide(v_poll.plan_id) then');
end $$;

-- Birdie posts only when the feed is on.
create or replace function public.scores_autopost()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare
  v_par int; v_trip uuid; v_name text; v_word text; v_diff int;
begin
  if new.strokes is null or new.picked_up then return new; end if;
  if tg_op = 'UPDATE' and old.strokes is not distinct from new.strokes then return new; end if;
  if not public.feature_on(new.group_id, 'feed') then return new; end if;
  select (h->>'par')::int, r.trip_id into v_par, v_trip
  from public.rounds r join public.courses c on c.id = r.course_id,
       jsonb_array_elements(c.holes) h
  where r.id = new.round_id and (h->>'n')::int = new.hole;
  if v_par is null then return new; end if;
  v_diff := new.strokes - v_par;
  if new.strokes = 1 then v_word := 'a HOLE IN ONE';
  elsif v_diff <= -3 then v_word := 'an albatross';
  elsif v_diff = -2 then v_word := 'an eagle';
  elsif v_diff = -1 then v_word := 'birdie';
  else return new; end if;
  if new.subject_type = 'team' then
    select name into v_name from public.teams where id = new.subject_id and group_id = new.group_id;
  else
    select coalesce(nickname, name) into v_name from public.players where id = new.subject_id and group_id = new.group_id;
  end if;
  insert into public.posts (trip_id, round_id, kind, body, hole, group_id)
  values (v_trip, new.round_id, 'auto', coalesce(v_name, 'Someone') || ' made ' || v_word || ' on ' || new.hole || '.', new.hole, new.group_id);
  return new;
end $$;

-- The same-group link checks from 024 cover the new table.
select private.add_same_group_checks();
