-- 101 — The group's cups (ov32, Josh 23 Oct 2026). RUNS AFTER 100 (ov31's cup_points table): cap tips and the two
-- organiser functions write cup_points rows, and the app reads confirmed, non-waived cup_points rows. Apply 100 first,
-- then this. (If 100 isn't in yet, the cup_points part below is skipped and cap tips refuse until it is.)
--
-- ADDITIVE ONLY: new tables (cups, cap_tips), new columns (comps.cup_id, groups.cap_tip_name), one trigger function
-- replaced with a longer list of allowed settings (private.comps_check: everything allowed before is still allowed),
-- new functions, and a backfill that only inserts library rows and fills empty links. The one check that's dropped and
-- re-added: cup_points' source_type check, ONLY if 100 on this database doesn't already allow 'kudos' (100 now does;
-- the re-added check is 100's list plus 'kudos', so nothing allowed before is refused). Nothing else is dropped or
-- renamed. Older app versions keep working: a social, combined or eclectic cup on a trip is an ordinary "awarded by the
-- group" comp to them (kind 'manual', no rounds), and its trophy is an ordinary trophy.
--
-- In plain words:
--   * The cup library (public.cups): each cup the group has, set up once, with what it's for —
--       golf     decided by scores: Stableford points over rounds, stroke, Ambrose, 4BBB, match play (the Cup,
--                Ryder Cup-style teams) or eclectic;
--       social   the weekend cup: points from awards and fines, side comps, games, tips, side activities, organiser
--                adjustments, cap tips and vibe points (cup_points and what the app works out at standings time);
--       combined golf placings turned into points (a placings scale the organiser sets) plus the social points.
--     Plus the real trophy: has_trophy (null = not asked yet, true = "yes, we've got one", false = "not yet"), a photo of
--     it and who has it now (held_by).
--   * Up for grabs on a trip = a comps row (067) with cup_id set, and its trophy (trophies) for the honour board. Golf
--     cups use the comp kinds that already exist (individual_points, individual_net, ambrose_teams, fourball_pairs, cup).
--     Social, combined and eclectic cups are kind 'manual' with settings.cup = 'social' | 'combined' | 'eclectic',
--     settings.rounds (which rounds count) and settings.counts (what counts towards the cup, and how many points).
--     Unticked = retired, as before. Only organisers change comps (067's policy), so only organisers choose what's up
--     for grabs. No cup is on for a trip until an organiser ticks it.
--   * Cap tips (public.cap_tips): players give each other points on a cup (settings.counts.kudos: how many each, points
--     each, the most to one person, guests or not). The database enforces the allowance; the giver can take one back
--     within 10 minutes. Each one writes a cup_points row (source 'kudos') and taking it back removes that row.
--     The group calls them "Cap tips 🧢", "Fist bumps 👊" or "Shout-outs 📣" (groups.cap_tip_name).
--   * Organisers enter side activity results (go-karts, poker, darts) and manual adjustments (with a reason) as
--     cup_points rows through add_cup_points; take one back with waive_cup_points. Awards and fines are ov31's.
--
-- Security: cups and cap_tips have RLS like every group table — members read; the restrictive "same group only"
-- policy; links checked to stay in the group (add_same_group_checks). Cups: organisers add and change, guests never
-- write. Cap tips: you give as yourself only (guests only if the cup allows it), take back your own within 10 minutes,
-- nobody changes one. Cups are core (like comps and rounds): no feature switch of their own.

-- ============================================================================================ the library
create table if not exists public.cups (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 60),
  purpose text not null check (purpose in ('golf', 'social', 'combined')),
  format text check (format is null or format in ('stableford', 'stroke', 'ambrose', 'fourball', 'match_play', 'eclectic')),
  description text check (description is null or length(description) <= 200),
  counts jsonb not null default '{}'::jsonb,      -- what counts by default on a new trip (same shape as comps.settings.counts)
  has_trophy boolean,                             -- null: not asked yet · true: we've got one · false: not yet
  trophy_photo_url text check (trophy_photo_url is null or (trophy_photo_url ~ '^https://' and length(trophy_photo_url) <= 400)),
  held_by uuid references public.players(id) on delete set null,
  retired boolean not null default false,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cups_group_idx on public.cups (group_id);
create index if not exists cups_held_by_idx on public.cups (held_by);
create index if not exists cups_created_by_idx on public.cups (created_by);
create unique index if not exists cups_one_name_idx on public.cups (group_id, lower(btrim(name))) where not retired;

alter table public.cups enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cups' and policyname = 'members read') then
    create policy "members read" on public.cups for select
      using (group_id = any ((select private.my_group_ids())::uuid[]));
    create policy "organisers change" on public.cups for all
      using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
      with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
    create policy "same group only" on public.cups as restrictive for all
      using (group_id = any ((select private.my_group_ids())::uuid[]))
      with check (group_id = any ((select private.my_group_ids())::uuid[]));
    create policy "no guest writes (add)" on public.cups as restrictive for insert to authenticated with check (not private.is_group_guest(group_id));
    create policy "no guest writes (change)" on public.cups as restrictive for update to authenticated using (not private.is_group_guest(group_id)) with check (not private.is_group_guest(group_id));
    create policy "no guest writes (remove)" on public.cups as restrictive for delete to authenticated using (not private.is_group_guest(group_id));
  end if;
end $$;
revoke all on public.cups from anon;
grant select, insert, update, delete on public.cups to authenticated;
create or replace trigger aa_fill_group_id before insert or update on public.cups
  for each row execute function private.fill_group_id();

-- What counts towards a cup (settings.counts on a trip's comp, and a cup's defaults). Raises on anything else.
-- Each part is { on: boolean, ... }:
--   awards     { rules: [rule ids] }                 points from cup_points (awards and fines, W6)
--   placings   { rounds: [round ids], scale: [n…] }   golf results per round: 1st, 2nd, 3rd… (ties share)
--   matches    { per_win: n }                         Cup matches: each player on the winning side (half each for a halve)
--   side       { ctp, ld, own, dot, penalty_dot }     points per closest-to-pin / longest-drive / own comp won, per dot
--   games      { per_win: n }                         points per skin or bet won (money stays separate)
--   tips       { per_right: n }                       points for tipping right
--   penalties  { per_stroke: n }                      rule breaches and penalty strokes (score_adjustments)
--   activities {}                                     side activities (cup_points, source 'activity')
--   manual     {}                                     organiser adjustments (cup_points, source 'manual')
--   kudos      { allowance, per, max_same, guests }   cap tips (cap_tips → cup_points, source 'kudos')
--   vibe       { post, photo, video, daily_cap }      Feed posts from the day before to the day after
create or replace function private.cup_counts_check(p jsonb, p_trip uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare k text; v jsonb; k2 text; v2 jsonb;
begin
  if p is null or p = '{}'::jsonb then return; end if;
  if jsonb_typeof(p) <> 'object' or octet_length(p::text) > 3000 then raise exception 'What counts is a short list'; end if;
  for k, v in select * from jsonb_each(p) loop
    if k not in ('awards', 'placings', 'matches', 'side', 'games', 'tips', 'penalties', 'activities', 'manual', 'kudos', 'vibe') or jsonb_typeof(v) <> 'object' then
      raise exception 'Unknown thing to count: %', k;
    end if;
    for k2, v2 in select * from jsonb_each(v) loop
      if k2 = 'on' and jsonb_typeof(v2) = 'boolean' then continue; end if;
      if k2 in ('per_win', 'per_right', 'per_stroke', 'ctp', 'ld', 'own', 'dot', 'penalty_dot')
         and jsonb_typeof(v2) = 'number' and (v2 #>> '{}')::numeric between -100 and 100 then continue; end if;
      if k = 'kudos' and k2 = 'guests' and jsonb_typeof(v2) = 'boolean' then continue; end if;
      if k = 'kudos' and k2 = 'per' and jsonb_typeof(v2) = 'number' and (v2 #>> '{}')::numeric between -100 and 100 then continue; end if;
      if k = 'kudos' and k2 in ('allowance', 'max_same') and jsonb_typeof(v2) = 'number' and (v2 #>> '{}')::numeric between 0 and 100 then continue; end if;
      if k = 'vibe' and k2 in ('post', 'photo', 'video', 'daily_cap') and jsonb_typeof(v2) = 'number' and (v2 #>> '{}')::numeric between 0 and 100 then continue; end if;
      if k = 'placings' and k2 = 'scale' and jsonb_typeof(v2) = 'array' and jsonb_array_length(v2) <= 20
         and not exists (select 1 from jsonb_array_elements(v2) x where jsonb_typeof(x) <> 'number' or (x #>> '{}')::numeric not between -100 and 100) then
        continue;
      end if;
      if k = 'placings' and k2 = 'rounds' and jsonb_typeof(v2) = 'array' and jsonb_array_length(v2) <= 20 then
        if exists (select 1 from jsonb_array_elements_text(v2) x where x !~ '^[0-9a-f-]{36}$'
                   or (p_trip is not null and not exists (select 1 from public.rounds r where r.id::text = x and r.trip_id = p_trip))) then
          raise exception 'A round that counts isn''t one of this trip''s rounds';
        end if;
        continue;
      end if;
      if k = 'awards' and k2 = 'rules' and jsonb_typeof(v2) = 'array' and jsonb_array_length(v2) <= 100
         and not exists (select 1 from jsonb_array_elements_text(v2) x where x !~ '^[0-9a-f-]{36}$') then
        continue;
      end if;
      raise exception 'The setting "%" doesn''t fit "%"', k2, k;
    end loop;
  end loop;
end $$;
revoke all on function private.cup_counts_check(jsonb, uuid) from public, anon, authenticated;

create or replace function private.cups_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  if new.purpose = 'golf' and new.format is null then raise exception 'A golf cup needs a format'; end if;
  if new.purpose <> 'golf' then new.format := null; end if;
  if tg_op = 'INSERT' or new.counts is distinct from old.counts then
    perform private.cup_counts_check(new.counts, null);
  end if;
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.cups_check() from public, anon, authenticated;
create or replace trigger ab_cups_check before insert or update on public.cups
  for each row execute function private.cups_check();

-- ============================================================================================ up for grabs: comps.cup_id
alter table public.comps add column if not exists cup_id uuid references public.cups(id) on delete set null;
create index if not exists comps_cup_idx on public.comps (cup_id);

-- 067's settings check, with the cup settings added (everything allowed before is still allowed):
--   manual: cup 'social' | 'combined' | 'eclectic', rounds [the trip's round ids], net (boolean, eclectic),
--           counts (see cup_counts_check)
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
    -- 101: the group's cups.
    if new.kind = 'manual' and k = 'cup' and v #>> '{}' in ('social', 'combined', 'eclectic') then continue; end if;
    if new.kind = 'manual' and k = 'net' and jsonb_typeof(v) = 'boolean' then continue; end if;
    if new.kind = 'manual' and k = 'rounds' and jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= 20 then
      if exists (select 1 from jsonb_array_elements_text(v) x where x !~ '^[0-9a-f-]{36}$'
                 or not exists (select 1 from public.rounds r where r.id::text = x and r.trip_id = new.trip_id)) then
        raise exception 'A round in that cup isn''t one of this trip''s rounds';
      end if;
      continue;
    end if;
    if new.kind = 'manual' and k = 'counts' then
      if tg_op = 'INSERT' or v is distinct from (old.settings -> 'counts') then perform private.cup_counts_check(v, new.trip_id); end if;
      continue;
    end if;
    raise exception 'The setting "%" doesn''t fit this kind of comp', k;
  end loop;
  return new;
end $$;
revoke all on function private.comps_check() from public, anon, authenticated;

-- ============================================================================================ cup_points takes 'kudos'
-- 100 now allows 'kudos' itself. On a database where it doesn't, widen the check (100's list plus 'kudos').
do $$
declare v_def text;
begin
  if to_regclass('public.cup_points') is null then
    raise notice '101: cup_points (100) isn''t here yet. Apply 100, then run 101 again for cap tips.';
    return;
  end if;
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conrelid = 'public.cup_points'::regclass and conname = 'cup_points_source_type_check';
  if v_def is null or v_def not like '%kudos%' then
    alter table public.cup_points drop constraint if exists cup_points_source_type_check;
    alter table public.cup_points add constraint cup_points_source_type_check
      check (source_type in ('award', 'fine', 'activity', 'manual', 'penalty', 'kudos'));
  end if;
end $$;

-- ============================================================================================ cap tips
-- What the group calls them: "Cap tips 🧢" (cap), "Fist bumps 👊" (fist) or "Shout-outs 📣" (shout). Organisers pick.
alter table public.groups add column if not exists cap_tip_name text not null default 'cap'
  check (cap_tip_name in ('cap', 'fist', 'shout'));
grant select (cap_tip_name) on public.groups to authenticated;

create or replace function public.set_cap_tip_name(p_group uuid, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_group_organiser(p_group) then raise exception 'Only an organiser can change that'; end if;
  if p_value not in ('cap', 'fist', 'shout') then raise exception 'Cap tips, fist bumps or shout-outs'; end if;
  update public.groups set cap_tip_name = p_value where id = p_group;
end $$;
revoke all on function public.set_cap_tip_name(uuid, text) from public, anon;
grant execute on function public.set_cap_tip_name(uuid, text) to authenticated;

-- One row per cap tip: who gave it, who got it, on which cup (a trip's comp), why (optional) and the Feed post it was
-- given from (optional).
create table if not exists public.cap_tips (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  comp_id uuid not null references public.comps(id) on delete cascade,
  giver_id uuid not null references public.players(id) on delete cascade,
  receiver_id uuid not null references public.players(id) on delete cascade,
  reason text check (reason is null or length(reason) <= 80),
  post_id uuid references public.posts(id) on delete set null,
  created_at timestamptz not null default now(),
  check (giver_id <> receiver_id)
);
create index if not exists cap_tips_group_idx on public.cap_tips (group_id);
create index if not exists cap_tips_trip_idx on public.cap_tips (trip_id);
create index if not exists cap_tips_comp_giver_idx on public.cap_tips (comp_id, giver_id);
create index if not exists cap_tips_giver_idx on public.cap_tips (giver_id);
create index if not exists cap_tips_receiver_idx on public.cap_tips (receiver_id);
create index if not exists cap_tips_post_idx on public.cap_tips (post_id);

alter table public.cap_tips enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cap_tips' and policyname = 'members read') then
    create policy "members read" on public.cap_tips for select
      using (group_id = any ((select private.my_group_ids())::uuid[]));
    create policy "give as yourself" on public.cap_tips for insert to authenticated
      with check (giver_id = private.my_player_id(group_id));
    create policy "take back your own (10 minutes)" on public.cap_tips for delete to authenticated
      using (giver_id = private.my_player_id(group_id) and created_at > now() - interval '10 minutes');
    create policy "same group only" on public.cap_tips as restrictive for all
      using (group_id = any ((select private.my_group_ids())::uuid[]))
      with check (group_id = any ((select private.my_group_ids())::uuid[]));
  end if;
end $$;
revoke all on public.cap_tips from anon;
revoke update on public.cap_tips from authenticated;
grant select, insert, delete on public.cap_tips to authenticated;
create or replace trigger aa_fill_group_id before insert or update on public.cap_tips
  for each row execute function private.fill_group_id('comps:comp_id', 'players:giver_id', 'players:receiver_id');

-- Is this player a guest of the group?
create or replace function private.player_is_guest(p_player uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where player_id = p_player and role = 'guest')
$$;
revoke all on function private.player_is_guest(uuid) from public, anon, authenticated;

-- The allowance, enforced: the cup is up for grabs with cap tips on; not to yourself; guests only if the cup says so;
-- at most `allowance` each on this cup and `max_same` to the same person. One giver at a time (a lock), so two taps at
-- once can't go over.
create or replace function private.cap_tips_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.comps; s jsonb; v_allow int; v_same int; v_given int; v_to int;
begin
  select * into c from public.comps where id = new.comp_id;
  if c.id is null or c.retired then raise exception 'That cup isn''t up for grabs'; end if;
  new.trip_id := c.trip_id;
  s := c.settings -> 'counts' -> 'kudos';
  if s is null or jsonb_typeof(s -> 'on') <> 'boolean' or not (s ->> 'on')::boolean then
    raise exception 'Cap tips aren''t on for that cup';
  end if;
  if new.giver_id = new.receiver_id then raise exception 'Not to yourself'; end if;
  if not coalesce((s ->> 'guests')::boolean, false) then
    if private.player_is_guest(new.giver_id) then raise exception 'Guests can''t give them on this cup'; end if;
    if private.player_is_guest(new.receiver_id) then raise exception 'Guests can''t get them on this cup'; end if;
  end if;
  v_allow := coalesce((s ->> 'allowance')::numeric, 5)::int;
  v_same := coalesce((s ->> 'max_same')::numeric, 2)::int;
  perform pg_advisory_xact_lock(hashtextextended(new.comp_id::text || new.giver_id::text, 101));
  select count(*), count(*) filter (where receiver_id = new.receiver_id) into v_given, v_to
  from public.cap_tips where comp_id = new.comp_id and giver_id = new.giver_id;
  if v_given >= v_allow then raise exception 'None left to give: % each on this cup', v_allow; end if;
  if v_to >= v_same then raise exception 'Most % to the same person', v_same; end if;
  new.reason := nullif(btrim(coalesce(new.reason, '')), '');
  new.created_at := now();
  return new;
end $$;
revoke all on function private.cap_tips_check() from public, anon, authenticated;
-- (No one changes a cap tip — authenticated has no UPDATE on cap_tips — so this runs on insert only.)
create or replace trigger ab_cap_tips_check before insert on public.cap_tips
  for each row execute function private.cap_tips_check();

-- Each cap tip is a cup_points row (source 'kudos'), confirmed straight away; taking it back removes the row.
create or replace function private.cap_tips_points() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_per numeric; v_word text; v_from text;
begin
  if tg_op = 'DELETE' then
    delete from public.cup_points where source_type = 'kudos' and source_id = old.id;
    return old;
  end if;
  select coalesce((settings -> 'counts' -> 'kudos' ->> 'per')::numeric, 1) into v_per from public.comps where id = new.comp_id;
  select case cap_tip_name when 'fist' then 'Fist bump' when 'shout' then 'Shout-out' else 'Cap tip' end into v_word
  from public.groups where id = new.group_id;
  select coalesce(nickname, name) into v_from from public.players where id = new.giver_id;
  if coalesce(v_per, 0) <> 0 then
    insert into public.cup_points (group_id, trip_id, comp_id, player_id, points, source_type, source_id, label, confirmed_at)
    values (new.group_id, new.trip_id, new.comp_id, new.receiver_id, v_per, 'kudos', new.id,
            left(coalesce(v_word, 'Cap tip') || ' from ' || coalesce(v_from, 'a mate') || coalesce(': ' || new.reason, ''), 200), now());
  end if;
  return new;
end $$;
revoke all on function private.cap_tips_points() from public, anon, authenticated;
create or replace trigger ac_cap_tips_points after insert or delete on public.cap_tips
  for each row execute function private.cap_tips_points();

do $$
declare t text;
begin
  foreach t in array array['cups', 'cap_tips'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
select private.add_same_group_checks();

-- ============================================================================================ results organisers enter
-- A side activity's result (go-karts, poker, darts: source 'activity', source_id = the trip_activities row) or a manual
-- adjustment with a reason (source 'manual'), as a confirmed cup_points row for one player in one cup on a trip.
-- Organisers only. Returns the new row's id.
create or replace function public.add_cup_points(p_comp uuid, p_player uuid, p_points numeric, p_source text,
                                                 p_label text, p_source_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.comps; v_id uuid; v_label text := btrim(coalesce(p_label, ''));
begin
  select * into c from public.comps where id = p_comp;
  if c.id is null or not (c.group_id = any (private.my_group_ids())) then raise exception 'Cup not found'; end if;
  if not private.is_group_organiser(c.group_id) then raise exception 'Only an organiser can do that'; end if;
  if p_source not in ('activity', 'manual') then raise exception 'Organisers enter side activities and adjustments here'; end if;
  if p_points is null or p_points = 0 or p_points < -100 or p_points > 100 then raise exception 'Points: −100 to 100 (not 0)'; end if;
  if length(v_label) < 2 or length(v_label) > 120 then
    raise exception '%', case when p_source = 'manual' then 'Say why (a few words)' else 'Name the activity' end;
  end if;
  if not exists (select 1 from public.players where id = p_player and group_id = c.group_id) then raise exception 'That player isn''t in this group'; end if;
  if p_source = 'activity' and p_source_id is not null
     and not exists (select 1 from public.trip_activities a join public.plans pl on pl.id = a.plan_id
                     where a.id = p_source_id and pl.trip_id = c.trip_id) then
    raise exception 'That activity isn''t on this trip';
  end if;
  insert into public.cup_points (group_id, trip_id, comp_id, player_id, points, source_type, source_id, label, confirmed_at)
  values (c.group_id, c.trip_id, c.id, p_player, p_points, p_source, p_source_id, v_label, now())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_cup_points(uuid, uuid, numeric, text, text, uuid) from public, anon;
grant execute on function public.add_cup_points(uuid, uuid, numeric, text, text, uuid) to authenticated;

-- Take back an activity result or an adjustment (it's waived, not deleted: everyone can still see it happened).
create or replace function public.waive_cup_points(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_g uuid; v_src text;
begin
  select group_id, source_type into v_g, v_src from public.cup_points where id = p_id;
  if v_g is null or not (v_g = any (private.my_group_ids())) then raise exception 'Not found'; end if;
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  if v_src not in ('activity', 'manual') then raise exception 'Only side activities and adjustments are taken back here'; end if;
  update public.cup_points set waived_at = now(), waived_by = private.my_player_id(v_g) where id = p_id and waived_at is null;
end $$;
revoke all on function public.waive_cup_points(uuid) from public, anon;
grant execute on function public.waive_cup_points(uuid) to authenticated;

-- ============================================================================================ backfill (idempotent)
-- Each golf comp the group already plays for becomes a library cup (one per name), linked back to its comps — so the
-- BD Trophy, Putt Buddies and the Cup can be picked again on the next trip. Inserts and empty links only. has_trophy
-- stays null: the run-up asks "Do you have a cup for this?".
do $backfill$
begin
  insert into public.cups (group_id, name, purpose, format, created_at)
  select distinct on (c.group_id, lower(btrim(c.name)))
         c.group_id, left(btrim(c.name), 60), 'golf',
         case c.kind when 'individual_points' then 'stableford' when 'individual_net' then 'stroke'
                     when 'ambrose_teams' then 'ambrose' when 'fourball_pairs' then 'fourball' else 'match_play' end,
         c.created_at
  from public.comps c
  where c.kind in ('individual_points', 'individual_net', 'ambrose_teams', 'fourball_pairs', 'cup')
    and not c.retired and c.cup_id is null and length(btrim(c.name)) >= 2
    and not exists (select 1 from public.cups x where x.group_id = c.group_id and lower(x.name) = lower(btrim(c.name)) and not x.retired)
  order by c.group_id, lower(btrim(c.name)), c.created_at desc;

  update public.comps c set cup_id = x.id
  from public.cups x
  where c.cup_id is null and x.group_id = c.group_id and lower(x.name) = lower(btrim(c.name)) and not x.retired and x.purpose = 'golf'
    and c.kind in ('individual_points', 'individual_net', 'ambrose_teams', 'fourball_pairs', 'cup');
end $backfill$;
