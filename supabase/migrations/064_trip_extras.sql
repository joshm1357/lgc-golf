-- 064 — Trip extras (21 Oct 2026). Additive only. Three small things from the DEV-PLAN "Later" list:
--
-- 1. Weather on the trip (feature 'weather', 060): nothing in the database — the phone asks Open-Meteo directly.
--
-- 2. "Same as last time" (part of the planner, no switch of its own): an organiser copies a past trip into a new
--    trip idea. Two new columns on plans:
--      repeat_of     — the past trip it was copied from
--      repeat_shape  — the golf to set up later: { v, from, from_name, rounds: [{ day, course_id, format, ctp_holes,
--                      ld_holes, own_comps, games: [{ kind, stake, options }] }], trophies: [{ name, type,
--                      description }], invited: [player ids] }. Read by the app when the organiser taps
--                      "Set it up in the app" (src/lib/repeat.js). Rounds are made the usual way then, so every
--                      existing check on rounds and games still applies.
--    Only organisers set them (a trigger quietly keeps them as they were for anyone else).
--
-- 3. Fines and dinner awards (feature 'dinner_awards', 060): per trip, awards ("Hack of the day") and fines ("Late to
--    the tee — buys the first round"; words only, no money moves). Anyone in the group adds one and nominates people
--    (a reason, and a photo or feed post as evidence). The organiser opens the voting (nominations close) and closes
--    it. One vote per person per award (changeable until it closes). Tallies and ties are worked out in the app
--    (src/lib/dinnerawards.js). Roast the golf and the mates — never race, religion, sexuality, disability or
--    tragedy: the in-jokes block list (058) plus a short tragedy list, same as the app's (a unit test checks).
--    Refused while the feature is off (reads stay allowed so nothing is lost).

-- ------------------------------------------------------------------ 2. Same as last time
alter table public.plans add column if not exists repeat_of uuid references public.plans(id) on delete set null;
alter table public.plans add column if not exists repeat_shape jsonb
  check (repeat_shape is null or (jsonb_typeof(repeat_shape) = 'object' and length(repeat_shape::text) <= 30000));
create index if not exists plans_repeat_of_idx on public.plans (repeat_of);

-- Runs after aa_fill_group_id (name order), so group_id is set.
create or replace function private.plans_repeat_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.is_group_organiser(new.group_id) then return new; end if;
  if tg_op = 'INSERT' then
    new.repeat_of := null;
    new.repeat_shape := null;
  else
    new.repeat_of := old.repeat_of;
    new.repeat_shape := old.repeat_shape;
  end if;
  return new;
end $$;
revoke all on function private.plans_repeat_guard() from public, anon, authenticated;
create or replace trigger plans_repeat_guard before insert or update on public.plans
  for each row execute function private.plans_repeat_guard();

-- ------------------------------------------------------------------ 3. Fines and dinner awards
-- The block list: the in-jokes list (058) plus tragedy. Whole words after lower-casing and undoing l33t.
create or replace function private.dinner_award_blocked(t text) returns boolean
language sql immutable set search_path = '' as $$
  select private.in_joke_blocked(t)
    or (' ' || btrim(regexp_replace(translate(lower(coalesce(t, '')), '013457@$!', 'oieastasi'), '[^a-z]+', ' ', 'g')) || ' ')
      ~ ('( )(' || array_to_string(array[
-- TRAGEDY-START
      'cancer', 'tumour', 'tumor', 'chemo', 'suicide', 'suicidal', 'overdose', 'overdosed', 'miscarriage', 'stillborn',
      'holocaust', 'terrorist', 'terrorists', 'rape', 'raped', 'rapist', 'paedo', 'pedo', 'paedophile', 'pedophile',
      'dead mum', 'dead dad', 'dead wife', 'dead kid'
-- TRAGEDY-END
      ], '|') || ')( )');
$$;
revoke all on function private.dinner_award_blocked(text) from public, anon, authenticated;

create table if not exists public.dinner_awards (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 60),
  kind text not null default 'award' check (kind in ('award', 'fine')),
  penalty text check (penalty is null or length(btrim(penalty)) between 2 and 80),   -- a fine's "buys the first round"
  status text not null default 'nominating' check (status in ('nominating', 'voting', 'closed')),
  sort int not null default 0,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists dinner_awards_group_idx on public.dinner_awards (group_id);
create index if not exists dinner_awards_trip_idx on public.dinner_awards (trip_id);
create index if not exists dinner_awards_created_by_idx on public.dinner_awards (created_by);

create table if not exists public.dinner_award_nominations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  award_id uuid not null references public.dinner_awards(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,              -- who's nominated
  reason text check (reason is null or length(reason) <= 140),
  post_id uuid references public.posts(id) on delete set null,                          -- evidence: a feed post
  photo_url text check (photo_url is null or (length(photo_url) <= 400 and photo_url ~ '^https://')),  -- or a photo
  nominated_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (award_id, player_id)
);
create index if not exists dinner_award_nominations_group_idx on public.dinner_award_nominations (group_id);
create index if not exists dinner_award_nominations_player_idx on public.dinner_award_nominations (player_id);
create index if not exists dinner_award_nominations_post_idx on public.dinner_award_nominations (post_id);
create index if not exists dinner_award_nominations_by_idx on public.dinner_award_nominations (nominated_by);

create table if not exists public.dinner_award_votes (
  award_id uuid not null references public.dinner_awards(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  nomination_id uuid not null references public.dinner_award_nominations(id) on delete cascade,
  voter_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (award_id, voter_id)                                                        -- one vote per person
);
create index if not exists dinner_award_votes_group_idx on public.dinner_award_votes (group_id);
create index if not exists dinner_award_votes_nomination_idx on public.dinner_award_votes (nomination_id);
create index if not exists dinner_award_votes_voter_idx on public.dinner_award_votes (voter_id);

-- Awards: tidy, keep who made it, only the organiser opens or closes voting, friendly words only, 30 a trip at most.
create or replace function private.dinner_awards_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org boolean := auth.uid() is null or private.is_group_organiser(new.group_id);
begin
  new.title := btrim(new.title);
  new.penalty := nullif(btrim(coalesce(new.penalty, '')), '');
  if new.kind <> 'fine' then new.penalty := null; end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.trip_id := old.trip_id;
  else
    new.created_by := coalesce(new.created_by, private.my_player_id(new.group_id));
    if not v_org then new.status := 'nominating'; end if;
    if (select count(*) from public.dinner_awards where trip_id = new.trip_id) >= 30 then
      raise exception 'That''s plenty of awards for one trip';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.title is distinct from old.title or new.penalty is distinct from old.penalty)
     and (private.dinner_award_blocked(new.title) or private.dinner_award_blocked(new.penalty)) then
    raise exception 'Keep it friendly — roast the golf and the mates, never who someone is or anything tragic';
  end if;
  if new.status = 'closed' then
    if tg_op = 'INSERT' or old.status <> 'closed' then new.closed_at := now(); end if;
  else
    new.closed_at := null;
  end if;
  return new;
end $$;
revoke all on function private.dinner_awards_check() from public, anon, authenticated;

-- Nominations: while nominations are open (the organiser can still add one during voting), never once it's
-- decided; who nominated stays the same; friendly words only; 20 an award at most.
create or replace function private.dinner_award_nominations_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text; v_org boolean := auth.uid() is null or private.is_group_organiser(new.group_id);
begin
  select status into v_status from public.dinner_awards where id = new.award_id;
  new.reason := nullif(btrim(coalesce(new.reason, '')), '');
  if tg_op = 'UPDATE' then
    new.award_id := old.award_id;
    new.player_id := old.player_id;
    new.nominated_by := old.nominated_by;
    new.created_at := old.created_at;
    if v_status = 'closed' and not v_org then raise exception 'That one''s been decided'; end if;
  else
    new.nominated_by := coalesce(new.nominated_by, private.my_player_id(new.group_id));
    if not (v_status = 'nominating' or (v_org and v_status = 'voting')) then
      raise exception 'Nominations are closed for that one';
    end if;
    if (select count(*) from public.dinner_award_nominations where award_id = new.award_id) >= 20 then
      raise exception 'That''s plenty of nominations';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.reason is distinct from old.reason) and private.dinner_award_blocked(new.reason) then
    raise exception 'Keep it friendly — roast the golf and the mates, never who someone is or anything tragic';
  end if;
  return new;
end $$;
revoke all on function private.dinner_award_nominations_check() from public, anon, authenticated;

-- Votes: only while voting is open, for a nomination on that award; the voter never changes.
create or replace function private.dinner_award_votes_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if tg_op = 'UPDATE' then
    new.voter_id := old.voter_id;
    new.award_id := old.award_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  select status into v_status from public.dinner_awards where id = new.award_id;
  if v_status is distinct from 'voting' then raise exception 'Voting isn''t open for that one'; end if;
  if not exists (select 1 from public.dinner_award_nominations n where n.id = new.nomination_id and n.award_id = new.award_id) then
    raise exception 'That person isn''t nominated for this one';
  end if;
  return new;
end $$;
revoke all on function private.dinner_award_votes_check() from public, anon, authenticated;

-- Access rules
alter table public.dinner_awards enable row level security;
create policy "members read" on public.dinner_awards for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "members add" on public.dinner_awards for insert
  with check (group_id = any ((select private.my_group_ids())::uuid[]) and created_by = private.my_player_id(group_id));
create policy "organisers change" on public.dinner_awards for update
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
-- Whoever added it can take it back while nominations are open; the organiser any time.
create policy "own or organiser remove" on public.dinner_awards for delete
  using ((created_by = private.my_player_id(group_id) and status = 'nominating')
         or group_id = any ((select private.my_organiser_group_ids())::uuid[]));

alter table public.dinner_award_nominations enable row level security;
create policy "members read" on public.dinner_award_nominations for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "members add" on public.dinner_award_nominations for insert
  with check (group_id = any ((select private.my_group_ids())::uuid[]) and nominated_by = private.my_player_id(group_id));
create policy "own or organiser change" on public.dinner_award_nominations for update
  using (nominated_by = private.my_player_id(group_id) or group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (nominated_by = private.my_player_id(group_id) or group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "own or organiser remove" on public.dinner_award_nominations for delete
  using ((nominated_by = private.my_player_id(group_id)
          and exists (select 1 from public.dinner_awards a where a.id = award_id and a.status = 'nominating'))
         or group_id = any ((select private.my_organiser_group_ids())::uuid[]));

alter table public.dinner_award_votes enable row level security;
create policy "members read" on public.dinner_award_votes for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "vote as yourself" on public.dinner_award_votes for insert
  with check (group_id = any ((select private.my_group_ids())::uuid[]) and voter_id = private.my_player_id(group_id));
create policy "change own vote" on public.dinner_award_votes for update
  using (voter_id = private.my_player_id(group_id))
  with check (voter_id = private.my_player_id(group_id));
create policy "take back own vote" on public.dinner_award_votes for delete
  using (voter_id = private.my_player_id(group_id)
         and exists (select 1 from public.dinner_awards a where a.id = award_id and a.status = 'voting'));

do $$
declare t text;
begin
  foreach t in array array['dinner_awards', 'dinner_award_nominations', 'dinner_award_votes'] loop
    execute format('create policy "same group only" on public.%I as restrictive for all using (group_id = any ((select private.my_group_ids())::uuid[])) with check (group_id = any ((select private.my_group_ids())::uuid[]))', t);
    execute format('create policy "feature on: dinner_awards (add)" on public.%I as restrictive for insert with check (public.feature_on(group_id, %L))', t, 'dinner_awards');
    execute format('create policy "feature on: dinner_awards (change)" on public.%I as restrictive for update using (public.feature_on(group_id, %L)) with check (public.feature_on(group_id, %L))', t, 'dinner_awards', 'dinner_awards');
    execute format('create policy "feature on: dinner_awards (remove)" on public.%I as restrictive for delete using (public.feature_on(group_id, %L))', t, 'dinner_awards');
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create trigger aa_fill_group_id before insert or update on public.dinner_awards
  for each row execute function private.fill_group_id('trips:trip_id');
create trigger aa_fill_group_id before insert or update on public.dinner_award_nominations
  for each row execute function private.fill_group_id('dinner_awards:award_id');
create trigger aa_fill_group_id before insert or update on public.dinner_award_votes
  for each row execute function private.fill_group_id('dinner_awards:award_id');
create trigger ac_dinner_awards_check before insert or update on public.dinner_awards
  for each row execute function private.dinner_awards_check();
create trigger ac_dinner_award_nominations_check before insert or update on public.dinner_award_nominations
  for each row execute function private.dinner_award_nominations_check();
create trigger ac_dinner_award_votes_check before insert or update on public.dinner_award_votes
  for each row execute function private.dinner_award_votes_check();

alter publication supabase_realtime add table public.dinner_awards, public.dinner_award_nominations, public.dinner_award_votes;
select private.add_same_group_checks();
