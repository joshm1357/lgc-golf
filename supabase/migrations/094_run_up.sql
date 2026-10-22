-- 094 — The run-up (ov25, 23 Oct 2026). ADDITIVE ONLY: new columns, four new tables, new functions and triggers.
-- Nothing is dropped or renamed; old app versions keep working (they simply don't show the new bits).
--
-- Josh: "Think about the lead-up component of the trip — tasks etc., but also the fun stuff like awards, new rules,
-- side activities, organising cars…" The run-up is shown on a locked-in trip's page between lock-in and the first tee.
--
--  * CARS (built on Rooms & cars — plan_groups kind 'car'): a car can now have a driver, a pick-up place and a pick-up
--    time. Anyone (not guests) can say "I've got 2 seats" (runup_offer_car makes their car), hop in a car with a spare
--    seat (runup_join_car) or hop out (runup_leave_car). The driver or an organiser can put someone in or take them out.
--    No fuel/toll split (Josh, 08:46: "a bit complicated for now") — those go in the kitty as ordinary costs.
--  * "I NEED A LIFT" and "HANDICAP LOOKS RIGHT": one row per person per trip in trip_runup_people (your own row only).
--  * SIDE ACTIVITIES (trip_activities + trip_activity_people): anyone proposes one; "I'm in". If it has a cost each,
--    the kitty gets one cost line for it (plan_costs.activity_id), per head, split between those in, fronted by whoever
--    proposed it. Kept in step by a trigger, so it's right whichever phone changes it.
--  * WHAT TO BRING (shared things — speaker, esky, cards): plan_items kind 'bring' with bring_shared = true. Anyone adds
--    an idea; "I'll bring it" (runup_claim_bring) makes it theirs (owner_id). Un-claim allowed.
--  * TIPPING (trip_tips): everyone picks a winner of the main trophy before round 1. Locks at the first tee (the
--    earliest tee time of the trip's first round, else 7am Sydney on its first day) or as soon as a round is under way.
--    An organiser can turn it off per trip (plans.tipping_off). No money.
--
-- Security: every new table has the restrictive "same group only" policy, group_id filled from its parent, links
-- checked to stay in the group, a feature switch, and guests can't write.

-- =================================================================================================== columns
alter table public.plan_groups add column if not exists driver_id uuid references public.players(id) on delete set null;
alter table public.plan_groups add column if not exists pickup_place text check (pickup_place is null or length(pickup_place) <= 120);
alter table public.plan_groups add column if not exists pickup_time text check (pickup_time is null or length(pickup_time) <= 60);
create index if not exists plan_groups_driver_idx on public.plan_groups (driver_id);

alter table public.plans add column if not exists tipping_off boolean not null default false;

alter table public.plan_items add column if not exists bring_shared boolean not null default false;

-- =================================================================================================== tables
create table if not exists public.trip_activities (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 80),
  day date,
  time text check (time is null or length(time) <= 40),
  place text check (place is null or length(place) <= 120),
  cost_pp numeric(10,2) check (cost_pp is null or cost_pp between 0 and 10000),
  link text check (link is null or length(link) <= 500),
  note text check (note is null or length(note) <= 500),
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists trip_activities_group_idx on public.trip_activities (group_id);
create index if not exists trip_activities_plan_idx on public.trip_activities (plan_id);
create index if not exists trip_activities_by_idx on public.trip_activities (created_by);

create table if not exists public.trip_activity_people (
  activity_id uuid not null references public.trip_activities(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (activity_id, player_id)
);
create index if not exists trip_activity_people_group_idx on public.trip_activity_people (group_id);
create index if not exists trip_activity_people_player_idx on public.trip_activity_people (player_id);

create table if not exists public.trip_runup_people (
  plan_id uuid not null references public.plans(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  needs_lift boolean not null default false,
  lift_from text check (lift_from is null or length(lift_from) <= 120),
  handicap_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (plan_id, player_id)
);
create index if not exists trip_runup_people_group_idx on public.trip_runup_people (group_id);
create index if not exists trip_runup_people_player_idx on public.trip_runup_people (player_id);

create table if not exists public.trip_tips (
  plan_id uuid not null references public.plans(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  pick_id uuid not null references public.players(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (plan_id, player_id)
);
create index if not exists trip_tips_group_idx on public.trip_tips (group_id);
create index if not exists trip_tips_player_idx on public.trip_tips (player_id);
create index if not exists trip_tips_pick_idx on public.trip_tips (pick_id);

alter table public.plan_costs add column if not exists activity_id uuid references public.trip_activities(id) on delete cascade;
create unique index if not exists plan_costs_activity_uidx on public.plan_costs (activity_id) where activity_id is not null;

-- group_id from the parent; every link stays in the group.
create or replace trigger aa_fill_group_id before insert or update on public.trip_activities
  for each row execute function private.fill_group_id('plans:plan_id', 'players:created_by');
create or replace trigger aa_fill_group_id before insert or update on public.trip_activity_people
  for each row execute function private.fill_group_id('trip_activities:activity_id', 'players:player_id');
create or replace trigger aa_fill_group_id before insert or update on public.trip_runup_people
  for each row execute function private.fill_group_id('plans:plan_id', 'players:player_id');
create or replace trigger aa_fill_group_id before insert or update on public.trip_tips
  for each row execute function private.fill_group_id('plans:plan_id', 'players:player_id', 'players:pick_id');
create or replace trigger ac_same_group_driver before insert or update on public.plan_groups
  for each row execute function private.same_group_refs('players:driver_id');

-- =================================================================================================== security
do $$
declare t text;
begin
  foreach t in array array['trip_activities', 'trip_activity_people', 'trip_runup_people', 'trip_tips'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'same group only') then
      execute format('create policy "same group only" on public.%I as restrictive for all to authenticated using (group_id = any ((select private.my_group_ids())::uuid[])) with check (group_id = any ((select private.my_group_ids())::uuid[]))', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'members read') then
      execute format('create policy "members read" on public.%I for select to authenticated using (group_id = any ((select private.my_group_ids())::uuid[]))', t);
    end if;
    -- Guests read but never write.
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'no guest writes (add)') then
      execute format('create policy "no guest writes (add)" on public.%I as restrictive for insert to authenticated with check (not private.is_group_guest(group_id))', t);
      execute format('create policy "no guest writes (change)" on public.%I as restrictive for update to authenticated using (not private.is_group_guest(group_id)) with check (not private.is_group_guest(group_id))', t);
      execute format('create policy "no guest writes (remove)" on public.%I as restrictive for delete to authenticated using (not private.is_group_guest(group_id))', t);
    end if;
    -- Switched off: hidden in the app and refused here. Everything sits under the planner.
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'feature on: planner (add)') then
      execute format('create policy "feature on: planner (add)" on public.%I as restrictive for insert with check (public.feature_on(group_id, ''planner''))', t);
      execute format('create policy "feature on: planner (change)" on public.%I as restrictive for update using (public.feature_on(group_id, ''planner'')) with check (public.feature_on(group_id, ''planner''))', t);
      execute format('create policy "feature on: planner (remove)" on public.%I as restrictive for delete using (public.feature_on(group_id, ''planner''))', t);
    end if;
  end loop;
end $$;

-- Who can change what (all also need the restrictive policies above).
--  Activities: anyone adds (as themselves); the proposer, the trip's organiser or a group organiser edits/removes.
--  "I'm in": your own row; the proposer or an organiser can take someone out.
--  Your run-up row and your tip: your own only.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trip_activities' and policyname = 'add activity') then
    create policy "add activity" on public.trip_activities for insert to authenticated
      with check (created_by = private.my_player_id(group_id));
    create policy "change activity" on public.trip_activities for update to authenticated
      using (created_by = private.my_player_id(group_id) or private.is_group_organiser(group_id)
             or exists (select 1 from public.plans p where p.id = plan_id and p.organiser_id = private.my_player_id(group_id)))
      with check (true);
    create policy "remove activity" on public.trip_activities for delete to authenticated
      using (created_by = private.my_player_id(group_id) or private.is_group_organiser(group_id)
             or exists (select 1 from public.plans p where p.id = plan_id and p.organiser_id = private.my_player_id(group_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trip_activity_people' and policyname = 'im in') then
    create policy "im in" on public.trip_activity_people for insert to authenticated
      with check (player_id = private.my_player_id(group_id));
    create policy "im out" on public.trip_activity_people for delete to authenticated
      using (player_id = private.my_player_id(group_id) or private.is_group_organiser(group_id)
             or exists (select 1 from public.trip_activities a where a.id = activity_id and a.created_by = private.my_player_id(group_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trip_runup_people' and policyname = 'own row') then
    create policy "own row" on public.trip_runup_people for all to authenticated
      using (player_id = private.my_player_id(group_id)) with check (player_id = private.my_player_id(group_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trip_tips' and policyname = 'own tip') then
    create policy "own tip" on public.trip_tips for all to authenticated
      using (player_id = private.my_player_id(group_id)) with check (player_id = private.my_player_id(group_id));
  end if;
end $$;

-- =================================================================================================== side activities → kitty
-- One kitty line per activity with a cost each and someone in: per head, split between those in, fronted by whoever
-- proposed it. No cost, or nobody in → no line. Only while the kitty (planner_costs) is switched on.
create or replace function private.activity_cost_sync(p_activity uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.trip_activities; v_people uuid[];
begin
  select * into a from public.trip_activities where id = p_activity;
  if a.id is null then return; end if;
  select coalesce(array_agg(player_id order by created_at), '{}') into v_people from public.trip_activity_people where activity_id = a.id;
  if coalesce(a.cost_pp, 0) <= 0 or cardinality(v_people) = 0 or not public.feature_on(a.group_id, 'planner_costs') then
    delete from public.plan_costs where activity_id = a.id;
    return;
  end if;
  update public.plan_costs set title = left('🎯 ' || a.title, 120), amount = a.cost_pp, per_head = true,
    split_between = v_people, paid_by = coalesce(a.created_by, paid_by), note = 'Side activity'
  where activity_id = a.id;
  if not found then
    insert into public.plan_costs (plan_id, group_id, title, amount, per_head, split_between, paid_by, created_by, note, activity_id)
    values (a.plan_id, a.group_id, left('🎯 ' || a.title, 120), a.cost_pp, true, v_people, a.created_by, a.created_by, 'Side activity', a.id);
  end if;
end $$;
revoke all on function private.activity_cost_sync(uuid) from public, anon, authenticated;

create or replace function private.activity_cost_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'trip_activities' then
    if tg_op <> 'DELETE' then perform private.activity_cost_sync(new.id); end if;
  else
    perform private.activity_cost_sync(case when tg_op = 'DELETE' then old.activity_id else new.activity_id end);
  end if;
  return null;
end $$;
revoke all on function private.activity_cost_trigger() from public, anon, authenticated;
create or replace trigger zz_activity_cost after insert or update on public.trip_activities
  for each row execute function private.activity_cost_trigger();
create or replace trigger zz_activity_cost after insert or delete on public.trip_activity_people
  for each row execute function private.activity_cost_trigger();

-- =================================================================================================== tipping lock
-- When tipping closes for a trip: the first tee (earliest tee time of its first round, else 7am Sydney that day; no
-- rounds yet → 7am on the trip's first day). Any round of the trip under way or finished → closed.
create or replace function public.tips_close_at(p_plan uuid)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare p public.plans; v_round public.rounds; v_tee time; v_day date;
begin
  select * into p from public.plans where id = p_plan;
  if p.id is null then return null; end if;
  if p.trip_id is not null then
    select * into v_round from public.rounds where trip_id = p.trip_id and play_date is not null
      order by play_date, created_at limit 1;
  end if;
  v_day := coalesce(v_round.play_date, p.start_date);
  if v_day is null then return null; end if;
  if v_round.id is not null then
    select min(tee_time::time) into v_tee from public.tee_groups where round_id = v_round.id and tee_time ~ '^\d{1,2}:\d{2}$';
  end if;
  return (v_day + coalesce(v_tee, time '07:00')) at time zone 'Australia/Sydney';
end $$;
revoke all on function public.tips_close_at(uuid) from public, anon;
grant execute on function public.tips_close_at(uuid) to authenticated;

create or replace function private.tips_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_plan uuid := case when tg_op = 'DELETE' then old.plan_id else new.plan_id end; p public.plans; v_close timestamptz;
begin
  -- A trip being deleted takes its tips with it (a cascade, one trigger deeper): never blocked.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  select * into p from public.plans where id = v_plan;
  if p.id is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if p.tipping_off then raise exception 'Tipping is switched off for this trip'; end if;
  if p.status <> 'confirmed' then raise exception 'Tipping opens once the trip is locked in'; end if;
  v_close := public.tips_close_at(v_plan);
  if (v_close is not null and now() >= v_close)
     or exists (select 1 from public.rounds r where r.trip_id = p.trip_id and r.status in ('live', 'locked')) then
    raise exception 'Tipping closed at the first tee';
  end if;
  if tg_op <> 'DELETE' then new.updated_at := now(); return new; end if;
  return old;
end $$;
revoke all on function private.tips_guard() from public, anon, authenticated;
create or replace trigger ab_tips_guard before insert or update or delete on public.trip_tips
  for each row execute function private.tips_guard();

-- =================================================================================================== cars
-- Shared checks for the car functions: the trip is in my group, I'm not a guest, rooms & cars is on. Returns my player.
create or replace function private.runup_me(p_plan uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_g uuid; v_me uuid;
begin
  select group_id into v_g from public.plans where id = p_plan;
  if v_g is null or not (v_g = any ((select private.my_group_ids())::uuid[])) then raise exception 'That trip isn''t in your group'; end if;
  if private.is_group_guest(v_g) then raise exception 'Guests can''t change the cars'; end if;
  if not public.feature_on(v_g, 'planner_rooms') then raise exception 'Rooms & cars is switched off'; end if;
  v_me := private.my_player_id(v_g);
  if v_me is null then raise exception 'Join the group first'; end if;
  return v_me;
end $$;
revoke all on function private.runup_me(uuid) from public, anon, authenticated;

-- "I've got 2 seats": makes (or updates) my car. Seats = spare seats; the car holds them plus me.
create or replace function public.runup_offer_car(p_plan uuid, p_seats int, p_place text default null, p_time text default null, p_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.runup_me(p_plan); v_car uuid; v_name text; v_in int;
begin
  if p_seats is null or p_seats < 0 or p_seats > 11 then raise exception 'Seats: 0 to 11'; end if;
  select id into v_car from public.plan_groups where plan_id = p_plan and kind = 'car' and driver_id = v_me limit 1;
  if v_car is not null then
    select count(*) into v_in from public.plan_group_members where group_id = v_car;
    if v_in > p_seats + 1 then raise exception 'There are % in your car already — take someone out first', v_in; end if;
    update public.plan_groups set capacity = p_seats + 1, pickup_place = nullif(btrim(p_place), ''), pickup_time = nullif(btrim(p_time), ''),
      name = coalesce(nullif(btrim(p_name), ''), name)
    where id = v_car;
  else
    select coalesce(nullif(btrim(p_name), ''), split_part(coalesce(nickname, name), ' ', 1) || '’s car') into v_name from public.players where id = v_me;
    insert into public.plan_groups (plan_id, kind, name, capacity, driver_id, pickup_place, pickup_time, sort)
    values (p_plan, 'car', left(v_name, 60), p_seats + 1, v_me, nullif(btrim(p_place), ''), nullif(btrim(p_time), ''), 100)
    returning id into v_car;
    delete from public.plan_group_members m using public.plan_groups g
      where m.group_id = g.id and g.plan_id = p_plan and g.kind = 'car' and m.player_id = v_me;
    insert into public.plan_group_members (group_id, player_id) values (v_car, v_me);
  end if;
  update public.trip_runup_people set needs_lift = false, updated_at = now() where plan_id = p_plan and player_id = v_me;
  return v_car;
end $$;
revoke all on function public.runup_offer_car(uuid, int, text, text, text) from public, anon;
grant execute on function public.runup_offer_car(uuid, int, text, text, text) to authenticated;

-- Hop in a car (me), or the driver / an organiser puts someone in. Out of any other car on the trip first.
create or replace function public.runup_join_car(p_car uuid, p_player uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.plan_groups; v_me uuid; v_who uuid; v_in int; v_org uuid;
begin
  select * into c from public.plan_groups where id = p_car and kind = 'car';
  if c.id is null then raise exception 'That car''s gone'; end if;
  v_me := private.runup_me(c.plan_id);
  v_who := coalesce(p_player, v_me);
  select organiser_id into v_org from public.plans where id = c.plan_id;
  if v_who <> v_me and not (c.driver_id = v_me or v_org = v_me or private.is_group_organiser(c.group_id)) then
    raise exception 'Only the driver or an organiser can put someone else in';
  end if;
  if not exists (select 1 from public.players where id = v_who and group_id = c.group_id) then raise exception 'They''re not in the group'; end if;
  if exists (select 1 from public.plan_group_members where group_id = c.id and player_id = v_who) then return; end if;
  if exists (select 1 from public.plan_groups where plan_id = c.plan_id and kind = 'car' and driver_id = v_who) then
    raise exception 'They''re driving their own car';
  end if;
  select count(*) into v_in from public.plan_group_members where group_id = c.id;
  if v_in >= c.capacity then raise exception '% is full', c.name; end if;
  delete from public.plan_group_members m using public.plan_groups g
    where m.group_id = g.id and g.plan_id = c.plan_id and g.kind = 'car' and m.player_id = v_who;
  insert into public.plan_group_members (group_id, player_id) values (c.id, v_who);
  update public.trip_runup_people set needs_lift = false, updated_at = now() where plan_id = c.plan_id and player_id = v_who;
end $$;
revoke all on function public.runup_join_car(uuid, uuid) from public, anon;
grant execute on function public.runup_join_car(uuid, uuid) to authenticated;

-- Hop out (me), or the driver / an organiser takes someone out. The driver "stops driving" instead: the car goes and
-- its passengers are back to needing a lift.
create or replace function public.runup_leave_car(p_car uuid, p_player uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.plan_groups; v_me uuid; v_who uuid; v_org uuid;
begin
  select * into c from public.plan_groups where id = p_car and kind = 'car';
  if c.id is null then return; end if;
  v_me := private.runup_me(c.plan_id);
  v_who := coalesce(p_player, v_me);
  select organiser_id into v_org from public.plans where id = c.plan_id;
  if v_who <> v_me and not (c.driver_id = v_me or v_org = v_me or private.is_group_organiser(c.group_id)) then
    raise exception 'Only the driver or an organiser can take someone else out';
  end if;
  if c.driver_id = v_who then
    if not (v_who = v_me or v_org = v_me or private.is_group_organiser(c.group_id)) then raise exception 'Only the driver can stop driving'; end if;
    insert into public.trip_runup_people (plan_id, group_id, player_id, needs_lift)
      select c.plan_id, c.group_id, m.player_id, true from public.plan_group_members m where m.group_id = c.id and m.player_id <> c.driver_id
      on conflict (plan_id, player_id) do update set needs_lift = true, updated_at = now();
    delete from public.plan_groups where id = c.id;
    return;
  end if;
  delete from public.plan_group_members where group_id = c.id and player_id = v_who;
end $$;
revoke all on function public.runup_leave_car(uuid, uuid) from public, anon;
grant execute on function public.runup_leave_car(uuid, uuid) to authenticated;

-- =================================================================================================== what to bring
-- "I'll bring it" (p_on true) / "Actually, I can't" (false) on a shared thing to bring.
create or replace function public.runup_claim_bring(p_item uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare it public.plan_items; v_me uuid;
begin
  select * into it from public.plan_items where id = p_item and kind = 'bring';
  if it.id is null or not (it.group_id = any ((select private.my_group_ids())::uuid[])) then raise exception 'That''s not on the list any more'; end if;
  if private.is_group_guest(it.group_id) then raise exception 'Guests can''t claim things to bring'; end if;
  if not public.feature_on(it.group_id, 'planner_tasks') then raise exception 'Jobs and lists are switched off'; end if;
  v_me := private.my_player_id(it.group_id);
  if v_me is null then raise exception 'Join the group first'; end if;
  if p_on then
    if it.owner_id is not null and it.owner_id <> v_me then raise exception 'Someone''s already bringing that'; end if;
    update public.plan_items set owner_id = v_me, bring_shared = true where id = it.id;
  else
    if it.owner_id is distinct from v_me then return; end if;
    update public.plan_items set owner_id = null where id = it.id;
  end if;
end $$;
revoke all on function public.runup_claim_bring(uuid, boolean) from public, anon;
grant execute on function public.runup_claim_bring(uuid, boolean) to authenticated;

-- =================================================================================================== realtime
do $$
declare t text;
begin
  foreach t in array array['trip_activities', 'trip_activity_people', 'trip_runup_people', 'trip_tips'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
