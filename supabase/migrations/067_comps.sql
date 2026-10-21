-- 067 — Comps: what you're playing for (21 Oct 2026, docs/comps-design.md). Additive only: one new table, one new
-- column (cup_sides.comp_id), two trigger functions, and a backfill that only inserts / fills empty links.
--
-- A comp has a name, a kind, which rounds count (round_ids; empty = all of the trip's rounds of a fitting format),
-- kind-specific settings, and optionally a trophy (trophy_id → trophies, so the honour board and older app versions
-- keep working). Teams, pairs, round players, side comps, games and the Cup keep their own tables; a comp only
-- points at the rounds that count. All the maths is in src/lib/comps.js.
--
-- Kinds: individual_points (Stableford points over rounds, e.g. the BD), individual_net (net strokes over rounds),
-- day (one round's winner), ambrose_teams (e.g. Putt Buddies), fourball_pairs, cup (team match play, e.g. the 6th
-- Ryder Cup), side_comps (closest to pin, longest drive, own comps), games (skins, Nassau…), manual (awarded).
--
-- Comps are core (like rounds): no feature switch of their own. A cup comp switches the hidden 'cup' feature on for
-- the group, because the Cup tables (050) still check it.

create table if not exists public.comps (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 60),
  kind text not null check (kind in ('individual_points', 'individual_net', 'day', 'ambrose_teams', 'fourball_pairs',
                                     'cup', 'side_comps', 'games', 'manual')),
  round_ids uuid[] not null default '{}' check (cardinality(round_ids) <= 20),
  settings jsonb not null default '{}'::jsonb,
  trophy_id uuid references public.trophies(id) on delete set null,
  sort smallint not null default 0,
  retired boolean not null default false,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists comps_group_idx on public.comps (group_id);
create index if not exists comps_trip_idx on public.comps (trip_id, sort);
create index if not exists comps_trophy_idx on public.comps (trophy_id);
create index if not exists comps_created_by_idx on public.comps (created_by);
-- One Cup per group for now (cup_sides has unique (group_id, sort), which can't be dropped).
create unique index if not exists comps_one_cup_idx on public.comps (group_id) where kind = 'cup' and not retired;

alter table public.comps enable row level security;
create policy "members read" on public.comps for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.comps for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.comps as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke all on public.comps from anon;
grant select, insert, update, delete on public.comps to authenticated;
create trigger aa_fill_group_id before insert or update on public.comps
  for each row execute function private.fill_group_id('trips:trip_id');

-- The rounds are the trip's, the trophy is the trip's, and the settings fit the kind.
--   every kind: note (text ≤ 200)
--   ambrose_teams: teams 'each_round' | 'fixed'          fourball_pairs: pairs 'each_round' | 'fixed'
--   cup: points (0–200, the whole cup), sessions { "<round id>": { format 'singles'|'ambrose', points 0–10, matches 1–30 } }
--   side_comps: most_wins (boolean)
create or replace function private.comps_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; v jsonb; s jsonb;
begin
  -- (Only rounds new to the comp are checked, so a round deleted later never blocks changing the comp.)
  if exists (select 1 from unnest(new.round_ids) rid
             where not (tg_op = 'UPDATE' and rid = any (old.round_ids))
               and not exists (select 1 from public.rounds r where r.id = rid and r.trip_id = new.trip_id)) then
    raise exception 'A round in that comp isn''t one of this trip''s rounds';
  end if;
  if cardinality(new.round_ids) <> (select count(distinct x) from unnest(new.round_ids) x) then
    raise exception 'A round is in that comp twice';
  end if;
  if new.kind = 'day' and cardinality(new.round_ids) > 1 then raise exception 'A day winner is for one round'; end if;
  if new.kind = 'manual' and cardinality(new.round_ids) > 0 then raise exception 'An awarded comp has no rounds'; end if;
  if new.trophy_id is not null
     and not exists (select 1 from public.trophies t where t.id = new.trophy_id and t.trip_id = new.trip_id) then
    raise exception 'That trophy belongs to another trip';
  end if;

  if jsonb_typeof(new.settings) <> 'object' or octet_length(new.settings::text) > 4000 then
    raise exception 'Comp settings are a short list';
  end if;
  for k, v in select * from jsonb_each(new.settings) loop
    if k = 'note' and jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 200 then continue; end if;
    if new.kind = 'ambrose_teams' and k = 'teams' and v #>> '{}' in ('each_round', 'fixed') then continue; end if;
    if new.kind = 'fourball_pairs' and k = 'pairs' and v #>> '{}' in ('each_round', 'fixed') then continue; end if;
    if new.kind = 'side_comps' and k = 'most_wins' and jsonb_typeof(v) = 'boolean' then continue; end if;
    if new.kind = 'cup' and k = 'points' and jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric > 0 and (v #>> '{}')::numeric <= 200 then continue; end if;
    if new.kind = 'cup' and k = 'sessions' and jsonb_typeof(v) = 'object' then
      for s in select value from jsonb_each(v) loop
        if jsonb_typeof(s) <> 'object'
           or s - array['format', 'points', 'matches'] <> '{}'::jsonb
           or (s ? 'format' and coalesce(s ->> 'format', '') not in ('singles', 'ambrose'))
           or (s ? 'points' and (jsonb_typeof(s -> 'points') <> 'number' or (s ->> 'points')::numeric <= 0 or (s ->> 'points')::numeric > 10))
           or (s ? 'matches' and (jsonb_typeof(s -> 'matches') <> 'number' or (s ->> 'matches')::numeric not between 1 and 30)) then
          raise exception 'A Cup session is a format (singles or Ambrose), points a match (up to 10) and how many matches';
        end if;
      end loop;
      if exists (select 1 from jsonb_object_keys(v) rid where rid !~ '^[0-9a-f-]{36}$') then
        raise exception 'A Cup session is for one of the comp''s rounds';
      end if;
      continue;
    end if;
    raise exception 'The setting "%" doesn''t fit this kind of comp', k;
  end loop;
  return new;
end $$;
revoke all on function private.comps_check() from public, anon, authenticated;
create or replace trigger ab_comps_check before insert or update on public.comps
  for each row execute function private.comps_check();

-- Adding (or bringing back) a Cup comp switches the hidden 'cup' feature on for the group: the Cup tables check it.
-- Only for an organiser (RLS already lets only organisers write comps) or the server — never by the backfill below,
-- so a group that switched its Cup off keeps it off.
create or replace function private.comps_cup_feature() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'cup' and not new.retired
     and (tg_op = 'INSERT' or old.retired or old.kind <> 'cup')
     and coalesce(current_setting('lgc.comps_backfill', true), '') <> 'on'
     and (auth.uid() is null or private.is_group_organiser(new.group_id)) then
    insert into public.group_features (group_id, feature_key, enabled) values (new.group_id, 'cup', true)
    on conflict (group_id, feature_key) do update set enabled = true, updated_by = auth.uid(), updated_at = now()
      where not public.group_features.enabled;
  end if;
  return new;
end $$;
revoke all on function private.comps_cup_feature() from public, anon, authenticated;
create or replace trigger ac_comps_cup_feature after insert or update on public.comps
  for each row execute function private.comps_cup_feature();

-- The Cup's two sides belong to the cup comp (null = not linked yet; everything still works without the link).
alter table public.cup_sides add column if not exists comp_id uuid references public.comps(id) on delete set null;
create index if not exists cup_sides_comp_idx on public.cup_sides (comp_id);

alter publication supabase_realtime add table public.comps;
select private.add_same_group_checks();

-- ------------------------------------------------------------------ Backfill (idempotent; inserts and empty links only)
-- Each trophy becomes a comp with that trophy: stableford_total → points over the trip's Stableford rounds,
-- ambrose → Ambrose teams over the trip's Ambrose rounds, manual → awarded. round_ids stays empty, which means
-- "all of the trip's rounds of that format" — exactly what the Trophy Room has always counted.
do $backfill$
begin
  perform set_config('lgc.comps_backfill', 'on', true);
  insert into public.comps (group_id, trip_id, name, kind, round_ids, settings, trophy_id, sort, created_at)
  select t.group_id, t.trip_id, left(btrim(t.name), 60),
         case t.type when 'stableford_total' then 'individual_points' when 'ambrose' then 'ambrose_teams' else 'manual' end,
         '{}', '{}'::jsonb, t.id,
         (row_number() over (partition by t.trip_id order by case t.type when 'stableford_total' then 0 when 'ambrose' then 1 else 2 end, t.created_at))::smallint,
         t.created_at
  from public.trophies t
  where length(btrim(t.name)) >= 2
    and not exists (select 1 from public.comps c where c.trophy_id = t.id);

  -- One Cup comp per group that has Cup sides: named after the Cup's trip (what the Cup screen shows as its name), over
  -- the rounds that have matches; points = the trip's cup_points. The sides are linked to it.
  with cupg as (
    select distinct s.group_id from public.cup_sides s
    where not exists (select 1 from public.comps c where c.group_id = s.group_id and c.kind = 'cup' and not c.retired)
  ), pick as (
    select g.group_id,
           coalesce(
             (select r.trip_id from public.cup_matches m join public.rounds r on r.id = m.round_id
               where m.group_id = g.group_id order by r.play_date desc nulls last, m.created_at desc limit 1),
             (select t.id from public.trips t where t.group_id = g.group_id
               order by (t.status = 'active') desc, t.start_date desc nulls last, t.created_at desc limit 1)) as trip_id
    from cupg g
  )
  insert into public.comps (group_id, trip_id, name, kind, round_ids, settings, sort)
  select p.group_id, p.trip_id,
         case when length(btrim(t.name)) >= 2 then left(btrim(t.name), 60) else 'The Cup' end,
         'cup',
         coalesce((select array_agg(distinct m.round_id) from public.cup_matches m join public.rounds r on r.id = m.round_id
                    where m.group_id = p.group_id and r.trip_id = p.trip_id), '{}'),
         case when t.cup_points is not null then jsonb_build_object('points', t.cup_points) else '{}'::jsonb end,
         0
  from pick p join public.trips t on t.id = p.trip_id
  where p.trip_id is not null;

  update public.cup_sides s set comp_id = c.id
  from public.comps c
  where c.group_id = s.group_id and c.kind = 'cup' and not c.retired and s.comp_id is null;
  perform set_config('lgc.comps_backfill', '', true);
end $backfill$;
