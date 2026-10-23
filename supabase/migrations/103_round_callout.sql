-- 103 — "Who's up for a hit?": put a round out to the guys, on the trip-planning engine (ov34, Josh 23 Oct 2026).
-- RUNS AFTER 102. Not applied to any Supabase project yet.
--
-- ADDITIVE ONLY. New nullable / defaulted columns on plans, plan_options, plan_rsvps and plan_votes; one new table
-- (plan_invites); new functions and triggers; one new scheduled job. NOTHING is dropped, renamed or re-checked: no
-- existing check constraint is dropped or re-added. Old app versions keep working: they never set the new columns, and
-- a call-out looks to them like an ordinary one-day round plan.
--
-- In plain words:
--   * A call-out is a plan with kind 'round' and callout = true. It is made by put_round_out() (never a plain insert):
--     the course (or "Course TBC"), the time — ONE option is a fixed time (replies are In / Maybe / Can't, plan_rsvps),
--     2–8 options are a 'dates' vote (✓ / ? / ✗ per option, plan_votes) — the spots (a cap with a reserve list, or no
--     cap), who's asked (the whole group, or a list: plan_invites), when replies close, a note, and the extras.
--   * Anyone in the group with a SAVED account can put one out (102's rule: phone-only accounts can reply but not
--     create — "Save your spot first", errcode 42501, hint save_spot). Guests can't put one out.
--   * Reply order matters for spots, so the database stamps WHEN each person first said they're in (first_in_at) or
--     first ticked ✓ on an option (first_yes_at). Changing your note never moves you; saying maybe / can't and back
--     again puts you at the back. Nobody can set these times from the app — the triggers do.
--   * Only the people asked can reply (and whoever put it out, and the organisers).
--   * Lock it in (callout_lock — whoever put it out, the plan's organiser, or a group organiser): the winning option's
--     ✓ people become In, in the order they ticked; ? become Maybe; ✗ become Out. The plan goes to 'confirmed', which
--     makes its trip (025's guard) and closes its votes (095), and ONE round is made on that trip at the course, with
--     the first N In people as its players. Everyone asked is told where they stand: "✅ You're in", "⏳ You're reserve
--     #1", "🙁 Didn't get a spot this time", or (spots left) "🔒 Locked in — tap to say you're in". "Who's booking?"
--     gets a job and a buzz.
--   * After lock-in, the round's players follow the In list by itself (callout_sync): "I can't make it now" moves the
--     first reserve up and tells them, and tells whoever put it out. Saying you're in later takes a free spot or goes
--     on the end of the reserve list. Once the round has started (live) nothing moves by itself.
--   * Calling a call-out off (091's call_off_plan) removes its round if nobody has scored on it.
--   * Feed posts link to '/plan/<id>?c=1' — the ?c=1 tells the Feed to show the reply buttons on the post.
--   * The job (every 10 minutes): when replies close, whoever put it out is nudged to lock it in (with the app's
--     suggestion); the evening before, everyone with a spot gets "⛳ Tomorrow: 1:20pm at Moore Park — with Bo, Sam and
--     Al". Buzzes are written by the database into notify_queue (kinds callout_*) and the notify function sends them
--     (straight away people at once; digest and "only important" people as they chose).
--
-- New columns (all nullable or defaulted):
--   plans:        callout, spots, course_id, library_course_id, tee_time, closes_at, booker_id, round_id, invite_all,
--                 extras (jsonb: the "➕ Add to this round" switches — course_vote, games, fines, cars, kitty, after)
--   plan_options: part (morning / midday / arvo / twilight), tee_time, course_id, library_course_id
--   plan_rsvps:   first_in_at        plan_votes: first_yes_at

-- =================================================================================================== columns
alter table public.plans add column if not exists callout boolean not null default false;
alter table public.plans add column if not exists spots int check (spots is null or spots between 2 and 72);
alter table public.plans add column if not exists course_id uuid references public.courses(id) on delete set null;
alter table public.plans add column if not exists library_course_id uuid references public.course_library(id) on delete set null;
alter table public.plans add column if not exists tee_time text check (tee_time is null or tee_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.plans add column if not exists closes_at timestamptz;
alter table public.plans add column if not exists booker_id uuid references public.players(id) on delete set null;
alter table public.plans add column if not exists round_id uuid references public.rounds(id) on delete set null;
alter table public.plans add column if not exists invite_all boolean not null default true;
alter table public.plans add column if not exists extras jsonb not null default '{}'::jsonb check (jsonb_typeof(extras) = 'object');

alter table public.plan_options add column if not exists part text check (part is null or part in ('morning', 'midday', 'arvo', 'twilight'));
alter table public.plan_options add column if not exists tee_time text check (tee_time is null or tee_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.plan_options add column if not exists course_id uuid references public.courses(id) on delete set null;
alter table public.plan_options add column if not exists library_course_id uuid references public.course_library(id) on delete set null;

alter table public.plan_rsvps add column if not exists first_in_at timestamptz;
alter table public.plan_votes add column if not exists first_yes_at timestamptz;

create index if not exists plans_callout_idx on public.plans (group_id) where callout;

-- Replies already in: their order is when they last changed (the best there is).
update public.plan_rsvps set first_in_at = updated_at where status = 'in' and first_in_at is null;
update public.plan_votes set first_yes_at = updated_at where response = 'yes' and first_yes_at is null;

-- =================================================================================================== who's asked
create table if not exists public.plan_invites (
  plan_id uuid not null references public.plans(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  invited_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (plan_id, player_id)
);
create index if not exists plan_invites_group_idx on public.plan_invites (group_id);
create index if not exists plan_invites_player_idx on public.plan_invites (player_id);
alter table public.plan_invites enable row level security;
-- Read like every plan table: members of the group. No write policies — only put_round_out / callout_update write it.
drop policy if exists "members read" on public.plan_invites;
create policy "members read" on public.plan_invites for select to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[]));
drop policy if exists "same group only" on public.plan_invites;
create policy "same group only" on public.plan_invites as restrictive for all to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[])) with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke insert, update, delete on public.plan_invites from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plan_invites') then
    alter publication supabase_realtime add table public.plan_invites;
  end if;
end $$;

-- =================================================================================================== helpers
-- Whoever put it out, the plan's organiser, or a group organiser.
create or replace function private.callout_can_manage(p_plan public.plans) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare me uuid;
begin
  if auth.uid() is null then return true; end if;   -- the connector, nightly jobs
  if private.is_group_organiser(p_plan.group_id) then return true; end if;
  me := private.my_player_id(p_plan.group_id);
  return me is not null and me in (p_plan.created_by, p_plan.organiser_id);
end $$;

-- Asked: everyone (invite_all), or on the list, or whoever put it out, or an organiser.
create or replace function private.callout_asked(p_plan public.plans, p_player uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_plan.invite_all
      or p_player = p_plan.created_by
      or exists (select 1 from public.plan_invites i where i.plan_id = p_plan.id and i.player_id = p_player)
      or exists (select 1 from public.group_members gm where gm.group_id = p_plan.group_id and gm.player_id = p_player and gm.role = 'organiser')
$$;

-- '13:20' → '1:20pm', '07:00' → '7am' (the app's clock() says the same).
create or replace function private.callout_clock(p_tee text) returns text
language sql immutable set search_path = '' as $$
  select case when p_tee is null or p_tee = '' then null else
    to_char(p_tee::time, 'FMHH12') || case when split_part(p_tee, ':', 2) = '00' then '' else ':' || split_part(p_tee, ':', 2) end
    || case when split_part(p_tee, ':', 1)::int < 12 then 'am' else 'pm' end end
$$;

-- "Fri 30 Oct 1:20pm" / "Fri 30 Oct arvo" / "Fri 30 Oct".
create or replace function private.callout_when(p_date date, p_tee text, p_part text default null) returns text
language sql immutable set search_path = '' as $$
  select to_char(p_date, 'Dy FMDD Mon') || coalesce(' ' || private.callout_clock(p_tee), ' ' || p_part, '')
$$;

-- A first name (nickname first).
create or replace function private.callout_first(p_player uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(split_part(btrim(coalesce(nullif(p.nickname, ''), p.name)), ' ', 1), 'Someone') from public.players p where p.id = p_player
$$;

-- "Bo, Sam and Al"
create or replace function private.callout_names(p_ids uuid[]) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text[];
begin
  select array_agg(private.callout_first(x) order by o) into v from unnest(p_ids) with ordinality u(x, o);
  if v is null or cardinality(v) = 0 then return ''; end if;
  if cardinality(v) = 1 then return v[1]; end if;
  return array_to_string(v[1:cardinality(v) - 1], ', ') || ' and ' || v[cardinality(v)];
end $$;

-- The whole group, for a call-out: approved players who aren't guests (the app's askable() says the same).
create or replace function private.callout_everyone(p_group uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.id), '{}') from public.players p
  where p.group_id = p_group and p.approved is not false
    and not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.player_id = p.id and gm.role = 'guest')
$$;

-- A buzz, written here and sent by the notify function. To these players of the group (with a phone that takes
-- notifications), never p_except. Belongs to the Trips planner: nothing when notifications or the planner are off.
create or replace function private.callout_queue(p_group uuid, p_players uuid[], p_kind text, p_title text, p_body text,
                                                 p_plan uuid, p_except uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_players is null or cardinality(p_players) = 0 then return 0; end if;
  if not public.feature_on(p_group, 'notifications') or not public.feature_on(p_group, 'planner') then return 0; end if;
  insert into public.notify_queue (group_id, user_id, kind, title, body, url)
  select distinct p_group, gm.user_id, p_kind, left(p_title, 160), left(coalesce(p_body, ''), 300), '#/plan/' || p_plan::text
  from public.group_members gm
  where gm.group_id = p_group and gm.user_id is not null and gm.player_id = any (p_players)
    and gm.player_id is distinct from p_except
    and exists (select 1 from public.push_subscriptions s where s.user_id = gm.user_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- The In list in order: who has a spot, who's a reserve (place 1, 2, …). Ties on time go by id (as the app does).
create or replace function private.callout_order(p_plan uuid)
returns table (player_id uuid, place int, has_spot boolean)
language sql stable security definer set search_path = '' as $$
  with p as (select spots from public.plans where id = p_plan),
  o as (
    select r.player_id, row_number() over (order by r.first_in_at nulls last, r.player_id)::int as n
    from public.plan_rsvps r where r.plan_id = p_plan and r.status = 'in'
  )
  select o.player_id, case when p.spots is null or o.n <= p.spots then o.n else o.n - p.spots end,
         p.spots is null or o.n <= p.spots
  from o, p order by o.n
$$;

do $$
declare f text;
begin
  foreach f in array array['private.callout_can_manage(public.plans)', 'private.callout_asked(public.plans, uuid)',
    'private.callout_clock(text)', 'private.callout_when(date, text, text)', 'private.callout_first(uuid)', 'private.callout_names(uuid[])', 'private.callout_everyone(uuid)',
    'private.callout_queue(uuid, uuid[], text, text, text, uuid, uuid)', 'private.callout_order(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- =================================================================================================== reply order
-- plan_rsvps: stamp when someone first said In (kept while they stay In; cleared otherwise). On a call-out: only the
-- people asked can reply, and once the round has started, only an organiser changes it. Lock-in (callout_lock) writes
-- the order itself (flag lgc.callout_lock).
create or replace function private.callout_rsvp_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.plans; v_round text;
begin
  if coalesce(current_setting('lgc.callout_lock', true), '') = 'on' and new.first_in_at is not null then
    return new;
  end if;
  if new.status = 'in' then
    if tg_op = 'UPDATE' and old.status = 'in' and old.first_in_at is not null then new.first_in_at := old.first_in_at;
    else new.first_in_at := clock_timestamp(); end if;
  else
    new.first_in_at := null;
  end if;
  if auth.uid() is not null then
    select * into v from public.plans where id = new.plan_id;
    if v.callout then
      if not private.callout_asked(v, new.player_id) then
        raise exception 'This round is just for the people asked — ask % to add you', coalesce(private.callout_first(v.created_by), 'whoever put it out');
      end if;
      if v.round_id is not null and not private.is_group_organiser(v.group_id) then
        select status into v_round from public.rounds where id = v.round_id;
        if v_round in ('live', 'locked') then raise exception 'The round has started — ask an organiser to change who''s playing'; end if;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.callout_rsvp_stamp() from public, anon, authenticated;
drop trigger if exists ab_callout_rsvp_stamp on public.plan_rsvps;
create trigger ab_callout_rsvp_stamp before insert or update on public.plan_rsvps
  for each row execute function private.callout_rsvp_stamp();

-- plan_votes: stamp when someone first ticked ✓ on an option (kept while ✓). On a call-out: only the people asked.
create or replace function private.callout_vote_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.plans;
begin
  if new.response = 'yes' then
    if tg_op = 'UPDATE' and old.response = 'yes' and old.first_yes_at is not null then new.first_yes_at := old.first_yes_at;
    else new.first_yes_at := clock_timestamp(); end if;
  else
    new.first_yes_at := null;
  end if;
  if auth.uid() is not null then
    select pl.* into v from public.plans pl join public.plan_polls po on po.plan_id = pl.id where po.id = new.poll_id;
    if v.callout and not private.callout_asked(v, new.player_id) then
      raise exception 'This round is just for the people asked — ask % to add you', coalesce(private.callout_first(v.created_by), 'whoever put it out');
    end if;
  end if;
  return new;
end $$;
revoke all on function private.callout_vote_stamp() from public, anon, authenticated;
drop trigger if exists ab_callout_vote_stamp on public.plan_votes;
create trigger ab_callout_vote_stamp before insert or update on public.plan_votes
  for each row execute function private.callout_vote_stamp();

-- A call-out is only ever made by put_round_out (so its vote, invites and buzzes are always right).
create or replace function private.callout_insert_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.callout and auth.uid() is not null and coalesce(current_setting('lgc.callout', true), '') <> 'on' then
    raise exception 'Put a round out from the app (⛳ Put a round out)';
  end if;
  return new;
end $$;
revoke all on function private.callout_insert_guard() from public, anon, authenticated;
drop trigger if exists ab_callout_insert_guard on public.plans;
create trigger ab_callout_insert_guard before insert on public.plans
  for each row execute function private.callout_insert_guard();

-- =================================================================================================== the round follows the In list
-- After lock-in, while the round hasn't started: the round's players are the first N In (or everyone In, no cap).
-- p_actor: whoever just changed their reply (they aren't buzzed about their own change). p_quiet: no buzzes.
create or replace function private.callout_sync(p_plan uuid, p_actor uuid default null, p_quiet boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.plans; v_status text; v_want uuid[]; v_have uuid[]; v_added uuid[]; v_removed uuid[]; v_when text; v_where text; a uuid;
        v_in int;
begin
  select * into v from public.plans where id = p_plan;
  if v.id is null or not v.callout or v.round_id is null or v.status <> 'confirmed' then return null; end if;
  select status into v_status from public.rounds where id = v.round_id;
  if v_status is distinct from 'setup' then return null; end if;
  select coalesce(array_agg(o.player_id order by o.place), '{}') into v_want from private.callout_order(p_plan) o where o.has_spot;
  select coalesce(array_agg(rp.player_id), '{}') into v_have from public.round_players rp where rp.round_id = v.round_id;
  select coalesce(array_agg(x), '{}') into v_added from unnest(v_want) x where not (x = any (v_have));
  select coalesce(array_agg(x), '{}') into v_removed from unnest(v_have) x where not (x = any (v_want));
  if cardinality(v_removed) > 0 then
    delete from public.round_players where round_id = v.round_id and player_id = any (v_removed);
  end if;
  if cardinality(v_added) > 0 then
    insert into public.round_players (round_id, player_id, playing_handicap, group_id)
    select v.round_id, pl.id, round(coalesce(pl.handicap, 0))::int, v.group_id
    from public.players pl where pl.id = any (v_added) and pl.group_id = v.group_id
    on conflict do nothing;
  end if;
  if not p_quiet then
    v_when := private.callout_when(v.start_date, v.tee_time);
    v_where := coalesce(v.location_name, 'Course TBC');
    foreach a in array v_added loop
      continue when a = p_actor;
      perform private.callout_queue(v.group_id, array[a], 'callout_promoted', '🎉 A spot opened — you’re in: ' || v_when,
        v_where || ' · ' || v.name || '. Can’t make it now? Tap to say so.', v.id);
    end loop;
    -- Someone with a spot pulled out: tell whoever put it out.
    if p_actor is not null and p_actor = any (v_removed) and p_actor is distinct from v.created_by then
      select count(*) into v_in from public.round_players where round_id = v.round_id;
      perform private.callout_queue(v.group_id, array[v.created_by], 'callout_pullout',
        '↩️ ' || private.callout_first(p_actor) || ' can’t make it now — ' || v.name,
        case when cardinality(v_added) > 0 then private.callout_names(v_added) || ' is in from the reserves.'
             else 'No one on reserve — ' || v_in || coalesce(' of ' || v.spots, '') || ' playing.' end, v.id);
    end if;
  end if;
  return jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
end $$;
revoke all on function private.callout_sync(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function private.callout_after_rsvp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_plan uuid := coalesce(new.plan_id, old.plan_id);
begin
  if coalesce(current_setting('lgc.callout_lock', true), '') = 'on' then return null; end if;
  if exists (select 1 from public.plans p where p.id = v_plan and p.callout and p.round_id is not null and p.status = 'confirmed') then
    perform private.callout_sync(v_plan, coalesce(new.player_id, old.player_id), false);
  end if;
  return null;
end $$;
revoke all on function private.callout_after_rsvp() from public, anon, authenticated;
drop trigger if exists zz_callout_after_rsvp on public.plan_rsvps;
create trigger zz_callout_after_rsvp after insert or update or delete on public.plan_rsvps
  for each row execute function private.callout_after_rsvp();

-- Called off: its round goes (if nobody has scored on it), and the people with a spot are told.
create or replace function private.callout_called_off() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; me uuid;
begin
  if not new.callout then return null; end if;
  me := private.my_player_id(new.group_id);
  select coalesce(array_agg(o.player_id), '{}') into v_ids from private.callout_order(new.id) o;
  if new.round_id is not null
     and exists (select 1 from public.rounds r where r.id = new.round_id and r.status = 'setup')
     and not exists (select 1 from public.scores s where s.round_id = new.round_id) then
    delete from public.rounds where id = new.round_id;
  end if;
  perform private.callout_queue(new.group_id, v_ids, 'callout_off', '✖️ Called off: ' || new.name,
    coalesce(private.callout_when(new.start_date, new.tee_time), 'The round') || ' isn’t happening.', new.id, me);
  return null;
end $$;
revoke all on function private.callout_called_off() from public, anon, authenticated;
drop trigger if exists zz_callout_called_off on public.plans;
create trigger zz_callout_called_off after update of status on public.plans
  for each row when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function private.callout_called_off();

-- =================================================================================================== put a round out
-- p_options: [{ "date": "2026-10-30", "part": "arvo", "tee_time": "13:20", "label": "Fri 30 Oct · arvo" }, …] (1–8;
--   one = a fixed time, 2+ = a vote). p_invite: null = the whole group; else the players asked (whoever puts it out
--   is always in it). p_courses (the "vote on the course" extra): [{ "label", "course_id" | "library_course_id" }, …].
-- Returns the plan's id. Buzzes the people asked; the whole group also gets a Feed post.
create or replace function public.put_round_out(p_name text, p_options jsonb, p_spots int default null, p_invite uuid[] default null,
  p_closes_at timestamptz default null, p_note text default null, p_course uuid default null, p_library uuid default null,
  p_course_name text default null, p_extras jsonb default '{}'::jsonb, p_courses jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); me uuid; v_id uuid; v_poll uuid; o jsonb; n int; v_today date := (now() at time zone 'Australia/Sydney')::date;
        v_date date; v_part text; v_tee text; v_label text; v_course_name text; v_first date; v_fixed boolean; v_asked uuid[];
        v_name text; v_extras jsonb := '{}'::jsonb; v_when text; v_opt uuid; v_lib uuid; v_cid uuid;
begin
  perform private.require_saved(v_g);
  if v_g is null or not private.is_group_member(v_g) then raise exception 'Join the group first'; end if;
  if private.is_group_guest(v_g) then raise exception 'Guests can say if they’re in, but can’t put a round out'; end if;
  if not public.feature_on(v_g, 'planner') then raise exception 'The Trips planner is switched off for this group'; end if;
  me := private.my_player_id(v_g);
  if me is null then raise exception 'Pick your name first'; end if;
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 1 and 8 then
    raise exception 'Put out between 1 and 8 times';
  end if;
  if p_spots is not null and p_spots not between 2 and 72 then raise exception 'Spots: from 2 to 72, or no cap'; end if;
  v_fixed := jsonb_array_length(p_options) = 1;
  -- Check every option first.
  for o in select value from jsonb_array_elements(p_options) loop
    v_date := nullif(o ->> 'date', '')::date;
    if v_date is null then raise exception 'Every time needs a day'; end if;
    if v_date < v_today then raise exception 'One of the days has already gone'; end if;
    if nullif(o ->> 'part', '') is not null and o ->> 'part' not in ('morning', 'midday', 'arvo', 'twilight') then raise exception 'Morning, midday, arvo or twilight'; end if;
    if nullif(o ->> 'tee_time', '') is not null and o ->> 'tee_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'A tee time looks like 13:20'; end if;
    v_first := least(coalesce(v_first, v_date), v_date);
  end loop;
  -- The course: one of the group's, one from the library, or just a name (TBC until lock-in).
  if p_course is not null then
    select name into v_course_name from public.courses where id = p_course and group_id = v_g;
    if v_course_name is null then raise exception 'That course isn’t one of the group’s'; end if;
  elsif p_library is not null then
    select name into v_course_name from public.course_library where id = p_library and not hidden;
    if v_course_name is null then raise exception 'That course isn’t in the library'; end if;
  else
    v_course_name := nullif(btrim(left(coalesce(p_course_name, ''), 80)), '');
  end if;
  -- Extras: only the known switches.
  if jsonb_typeof(p_extras) = 'object' then
    select coalesce(jsonb_object_agg(k, val), '{}'::jsonb) into v_extras from jsonb_each(p_extras) e(k, val)
    where (k in ('course_vote', 'games', 'fines', 'cars', 'kitty') and val = 'true'::jsonb)
       or (k = 'after' and jsonb_typeof(val) = 'string' and btrim(val #>> '{}') <> '');
    if v_extras ? 'after' then v_extras := jsonb_set(v_extras, '{after}', to_jsonb(left(btrim(v_extras ->> 'after'), 120))); end if;
  end if;
  -- Who's asked.
  if p_invite is not null then
    select coalesce(array_agg(distinct p.id), '{}') into v_asked from public.players p
    where p.group_id = v_g and p.id = any (p_invite) and p.approved is not false;
    if not (me = any (v_asked)) then v_asked := v_asked || me; end if;
    if cardinality(v_asked) < 2 then raise exception 'Ask at least one other person'; end if;
  end if;

  v_name := nullif(btrim(left(coalesce(p_name, ''), 60)), '');
  if v_name is null then v_name := 'A hit' || coalesce(' at ' || v_course_name, ''); end if;
  o := p_options -> 0;
  perform set_config('lgc.callout', 'on', true);
  insert into public.plans (group_id, kind, callout, name, status, proposed, created_by, start_date, end_date, tee_time,
    location_name, course_id, library_course_id, spots, closes_at, brief, invite_all, extras)
  values (v_g, 'round', true, v_name, 'planning', false, me,
    case when v_fixed then (o ->> 'date')::date end, case when v_fixed then (o ->> 'date')::date end,
    case when v_fixed then nullif(o ->> 'tee_time', '') end,
    v_course_name, p_course, case when p_course is null then p_library end, p_spots,
    coalesce(p_closes_at, (v_first::timestamp + interval '7 hours') at time zone 'Australia/Sydney' - interval '24 hours'),
    nullif(btrim(left(coalesce(p_note, ''), 500)), ''), p_invite is null, v_extras)
  returning id into v_id;
  perform set_config('lgc.callout', 'off', true);

  if p_invite is not null then
    insert into public.plan_invites (plan_id, player_id, group_id, invited_by)
    select v_id, x, v_g, me from unnest(v_asked) x on conflict do nothing;
  end if;

  if v_fixed then
    insert into public.plan_rsvps (plan_id, player_id, status, group_id) values (v_id, me, 'in', v_g)
    on conflict (plan_id, player_id) do update set status = 'in';
    v_when := private.callout_when((o ->> 'date')::date, nullif(o ->> 'tee_time', ''), nullif(o ->> 'part', ''));
  else
    insert into public.plan_polls (plan_id, group_id, kind, question, closes_on, created_by)
    values (v_id, v_g, 'dates', 'When can you play?', (coalesce(p_closes_at, now()) at time zone 'Australia/Sydney')::date, me)
    returning id into v_poll;
    for o in select value from jsonb_array_elements(p_options) loop
      v_date := (o ->> 'date')::date; v_part := nullif(o ->> 'part', ''); v_tee := nullif(o ->> 'tee_time', '');
      v_label := coalesce(nullif(btrim(left(o ->> 'label', 120)), ''), to_char(v_date, 'Dy FMDD Mon') || coalesce(' · ' || private.callout_clock(v_tee), ' · ' || v_part, ''));
      insert into public.plan_options (poll_id, group_id, label, start_date, end_date, part, tee_time, created_by)
      values (v_poll, v_g, v_label, v_date, v_date, v_part, v_tee, me) returning id into v_opt;
      -- Whoever put it out is ✓ on every time they suggested (they can change it).
      insert into public.plan_votes (option_id, poll_id, player_id, response, group_id) values (v_opt, v_poll, me, 'yes', v_g);
    end loop;
    if jsonb_array_length(p_options) <= 3 then
      select string_agg(private.callout_when((x ->> 'date')::date, nullif(x ->> 'tee_time', ''), nullif(x ->> 'part', '')), ' or ' order by (x ->> 'date')) into v_when
      from jsonb_array_elements(p_options) x;
    else
      v_when := jsonb_array_length(p_options) || ' times to pick from';
    end if;
  end if;

  -- The "vote on the course" extra: a 'location' vote with the courses listed.
  if v_extras ? 'course_vote' and jsonb_typeof(p_courses) = 'array' and jsonb_array_length(p_courses) >= 2 then
    insert into public.plan_polls (plan_id, group_id, kind, question, closes_on, created_by)
    values (v_id, v_g, 'location', 'Where should we play?', (coalesce(p_closes_at, now()) at time zone 'Australia/Sydney')::date, me)
    returning id into v_poll;
    for o in select value from jsonb_array_elements(p_courses) limit 6 loop
      v_cid := null; v_lib := null;
      if nullif(o ->> 'course_id', '') is not null then
        select id into v_cid from public.courses where id = (o ->> 'course_id')::uuid and group_id = v_g;
      elsif nullif(o ->> 'library_course_id', '') is not null then
        select id into v_lib from public.course_library where id = (o ->> 'library_course_id')::uuid and not hidden;
      end if;
      v_label := nullif(btrim(left(coalesce(o ->> 'label', ''), 120)), '');
      continue when v_label is null;
      insert into public.plan_options (poll_id, group_id, label, course_id, library_course_id, created_by)
      values (v_poll, v_g, v_label, v_cid, v_lib, me);
    end loop;
  end if;

  -- Tell the people asked (not whoever put it out). The whole group: a Feed post too.
  perform private.callout_queue(v_g, coalesce(v_asked, private.callout_everyone(v_g)),
    'callout_new', '⛳ ' || private.callout_first(me) || ' wants a hit — ' || v_when,
    coalesce(v_course_name, 'Course TBC') || ' · ' || coalesce(p_spots || ' spots', 'no cap') || '. Tap to say if you can.', v_id, me);
  if p_invite is null and public.feature_on(v_g, 'feed') then
    insert into public.posts (group_id, kind, player_id, body, link)
    values (v_g, 'user', me, '⛳ Who’s up for a hit? ' || v_name || ' — ' || v_when || coalesce(' at ' || v_course_name, '')
      || coalesce(' · ' || p_spots || ' spots', '') || '. Say if you can.', '/plan/' || v_id::text || '?c=1');
  end if;
  return v_id;
end $$;
revoke all on function public.put_round_out(text, jsonb, int, uuid[], timestamptz, text, uuid, uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.put_round_out(text, jsonb, int, uuid[], timestamptz, text, uuid, uuid, text, jsonb, jsonb) to authenticated;

-- =================================================================================================== lock it in
-- p_option: the winning time (null for a fixed time). p_tee_time: the exact tee time ('13:20'), if it was a window.
-- p_course / p_library: the course, if it wasn't set (or the course vote's winner). p_booker: who's booking (a job + a
-- buzz). p_format: 'stableford' (default) or 'ambrose'.
-- → { round_id, trip_id, in: [ids], reserve: [ids] }
create or replace function public.callout_lock(p_plan uuid, p_option uuid default null, p_tee_time text default null,
  p_course uuid default null, p_library uuid default null, p_booker uuid default null, p_format text default 'stableford')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; v_today date := (now() at time zone 'Australia/Sydney')::date; v_poll uuid; v_opt public.plan_options;
        v_date date; v_tee text; v_part text; v_course uuid; v_lib uuid; v_course_name text; v_trip uuid; v_round uuid; l record;
        v_in uuid[]; v_res uuid[]; v_maybe uuid[]; v_rest uuid[]; v_when text; v_full boolean; v_asked uuid[]; i int; v_cpoll uuid; v_copt public.plan_options;
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) or not v.callout then raise exception 'Round not found'; end if;
  perform private.require_saved(v.group_id);
  if not private.callout_can_manage(v) then raise exception 'Only whoever put it out (or an organiser) can lock it in'; end if;
  if v.status = 'confirmed' and v.round_id is not null then return jsonb_build_object('round_id', v.round_id, 'trip_id', v.trip_id, 'again', true); end if;
  if v.status <> 'planning' then raise exception 'This one isn’t open any more'; end if;
  me := private.my_player_id(v.group_id);
  if p_format is not null and p_format not in ('stableford', 'ambrose') then raise exception 'Stableford or Ambrose'; end if;
  if nullif(p_tee_time, '') is not null and p_tee_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'A tee time looks like 13:20'; end if;
  if p_booker is not null and not exists (select 1 from public.players where id = p_booker and group_id = v.group_id) then raise exception 'Pick someone in the group to book it'; end if;

  select id into v_poll from public.plan_polls where plan_id = p_plan and kind = 'dates' order by created_at limit 1;
  if v_poll is not null then
    select * into v_opt from public.plan_options where id = p_option and poll_id = v_poll;
    if v_opt.id is null then raise exception 'Pick one of the times'; end if;
    v_date := v_opt.start_date; v_tee := coalesce(nullif(p_tee_time, ''), v_opt.tee_time); v_part := v_opt.part;
  else
    v_date := v.start_date; v_tee := coalesce(nullif(p_tee_time, ''), v.tee_time);
  end if;
  if v_date is null then raise exception 'Pick the day'; end if;
  if v_date < v_today then raise exception 'That day has gone — pick another'; end if;

  -- The course: as given, else as put out, else the course vote's leader.
  v_course := p_course; v_lib := case when p_course is null then p_library end;
  if v_course is null and v_lib is null then v_course := v.course_id; v_lib := v.library_course_id; end if;
  if v_course is null and v_lib is null then
    select id into v_cpoll from public.plan_polls where plan_id = p_plan and kind = 'location' order by created_at limit 1;
    if v_cpoll is not null then
      select o.* into v_copt from public.plan_options o
      where o.poll_id = v_cpoll and (o.course_id is not null or o.library_course_id is not null)
      order by (select count(*) from public.plan_votes pv where pv.option_id = o.id and pv.response = 'yes') desc,
               (select count(*) from public.plan_votes pv where pv.option_id = o.id and pv.response = 'maybe') desc, o.created_at
      limit 1;
      v_course := v_copt.course_id; v_lib := v_copt.library_course_id;
    end if;
  end if;
  if v_course is not null then
    select name into v_course_name from public.courses where id = v_course and group_id = v.group_id;
    if v_course_name is null then raise exception 'That course isn’t one of the group’s'; end if;
  elsif v_lib is not null then
    select * into l from public.course_library where id = v_lib and not hidden;
    if l.id is null then raise exception 'That course isn’t in the library'; end if;
    select id, name into v_course, v_course_name from public.courses where group_id = v.group_id and library_id = l.id;
    if v_course is null then
      perform set_config('lgc.library_link', 'on', true);
      insert into public.courses (group_id, name, holes, library_id) values (v.group_id, l.name, l.holes, l.id)
      returning id, name into v_course, v_course_name;
      perform set_config('lgc.library_link', 'off', true);
      update public.course_library set copies = copies + 1 where id = l.id;
    end if;
  else
    raise exception 'Pick the course first — the round needs one to score on';
  end if;

  -- The winning time's ✓ people become In, in the order they ticked; ? Maybe; ✗ Out.
  perform set_config('lgc.callout_lock', 'on', true);
  if v_poll is not null then
    insert into public.plan_rsvps (plan_id, player_id, status, first_in_at, group_id, updated_at)
    select p_plan, pv.player_id, case pv.response when 'yes' then 'in' when 'maybe' then 'maybe' else 'out' end,
           case when pv.response = 'yes' then coalesce(pv.first_yes_at, pv.updated_at) end, v.group_id, now()
    from public.plan_votes pv where pv.option_id = p_option
    on conflict (plan_id, player_id) do update set status = excluded.status, first_in_at = excluded.first_in_at, updated_at = now();
    update public.plan_polls set status = 'closed', winner_option_id = p_option where id = v_poll;
  end if;
  -- Lock the plan: 025's guard makes the trip, 095 closes the votes.
  update public.plans set status = 'confirmed', start_date = v_date, end_date = v_date, tee_time = v_tee, booker_id = p_booker,
         course_id = v_course, library_course_id = null, location_name = v_course_name, rsvp_locked = false
  where id = p_plan returning trip_id into v_trip;
  if v_trip is null then
    insert into public.trips (group_id, name, start_date, end_date, status, made_by_lock_in)
    values (v.group_id, v.name, v_date, v_date, 'locked', true) returning id into v_trip;
    update public.plans set trip_id = v_trip where id = p_plan;
  end if;
  insert into public.rounds (group_id, trip_id, course_id, name, play_date, format, status)
  values (v.group_id, v_trip, v_course, left(v.name || ' — ' || v_course_name, 80), v_date, coalesce(p_format, 'stableford'), 'setup')
  returning id into v_round;
  update public.plans set round_id = v_round where id = p_plan;
  perform set_config('lgc.callout_lock', 'off', true);
  perform private.callout_sync(p_plan, null, true);

  -- Where everyone stands.
  select coalesce(array_agg(o.player_id order by o.place) filter (where o.has_spot), '{}'),
         coalesce(array_agg(o.player_id order by o.place) filter (where not o.has_spot), '{}')
    into v_in, v_res from private.callout_order(p_plan) o;
  select coalesce(array_agg(r.player_id), '{}') into v_maybe from public.plan_rsvps r where r.plan_id = p_plan and r.status = 'maybe';
  v_full := v.spots is not null and cardinality(v_in) >= v.spots;
  v_when := private.callout_when(v_date, v_tee, v_part);
  for i in 1 .. cardinality(v_in) loop
    continue when v_in[i] = me;
    perform private.callout_queue(v.group_id, array[v_in[i]], 'callout_in', '✅ You’re in — ' || v_when || ', ' || v_course_name,
      v.name || ' with ' || private.callout_names(array_remove(v_in, v_in[i])) || '. Can’t make it now? Tap to say so.', v.id);
  end loop;
  for i in 1 .. cardinality(v_res) loop
    continue when v_res[i] = me;
    perform private.callout_queue(v.group_id, array[v_res[i]], 'callout_reserve', '⏳ You’re reserve #' || i || ' — ' || v_when || ', ' || v_course_name,
      'We’ll tell you straight away if a spot opens.', v.id);
  end loop;
  -- Everyone else asked: maybes when it's full didn't get a spot; otherwise "locked in — tap to say you're in".
  if v.invite_all then
    v_asked := private.callout_everyone(v.group_id);
  else
    select coalesce(array_agg(i2.player_id), '{}') into v_asked from public.plan_invites i2 where i2.plan_id = p_plan;
  end if;
  select coalesce(array_agg(x), '{}') into v_rest from unnest(v_asked) x where not (x = any (v_in)) and not (x = any (v_res)) and x is distinct from me;
  if v_full then
    perform private.callout_queue(v.group_id, (select coalesce(array_agg(x), '{}') from unnest(v_rest) x where x = any (v_maybe)), 'callout_full',
      '🙁 Didn’t get a spot this time — ' || v_when || ', ' || v_course_name, 'It’s full. Say you’re in to go on the reserve list.', v.id);
    perform private.callout_queue(v.group_id, (select coalesce(array_agg(x), '{}') from unnest(v_rest) x where not (x = any (v_maybe))), 'callout_locked',
      '🔒 Locked in (full): ' || v_when || ', ' || v_course_name, 'Say you’re in to go on the reserve list.', v.id);
  else
    perform private.callout_queue(v.group_id, v_rest, 'callout_locked', '🔒 Locked in: ' || v_when || ', ' || v_course_name,
      coalesce((v.spots - cardinality(v_in))::text || ' spot' || case when v.spots - cardinality(v_in) = 1 then '' else 's' end || ' left. ', '')
      || 'Tap to say you’re in.', v.id);
  end if;
  -- Who's booking: a job (with the usual "due tomorrow" reminder) and a buzz.
  if p_booker is not null then
    insert into public.plan_items (plan_id, group_id, kind, title, owner_id, due, created_by)
    values (p_plan, v.group_id, 'job', left('Book the tee time — ' || v_course_name || ', ' || v_when || ' for ' || coalesce(v.spots, cardinality(v_in)), 200),
            p_booker, least(v_date, greatest(v_today + 1, v_date - 2)), me);
    if p_booker is distinct from me then
      perform private.callout_queue(v.group_id, array[p_booker], 'callout_booker', '📞 You’re booking: ' || v_course_name || ', ' || v_when,
        'For ' || coalesce(v.spots, cardinality(v_in)) || '. Tap when it’s booked.', v.id);
    end if;
  end if;
  if v.invite_all and public.feature_on(v.group_id, 'feed') then
    insert into public.posts (group_id, kind, player_id, trip_id, round_id, body, link)
    values (v.group_id, 'user', me, v_trip, v_round, '🔒 Locked in: ' || v.name || ' — ' || v_when || ' at ' || v_course_name || '. '
      || case when cardinality(v_in) > 0 then private.callout_names(v_in) || '.' else '' end
      || case when cardinality(v_res) > 0 then ' ' || cardinality(v_res) || ' on reserve.' else '' end, '/plan/' || p_plan::text || '?c=1');
  end if;
  return jsonb_build_object('round_id', v_round, 'trip_id', v_trip, 'in', to_jsonb(v_in), 'reserve', to_jsonb(v_res));
end $$;
revoke all on function public.callout_lock(uuid, uuid, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.callout_lock(uuid, uuid, text, uuid, uuid, uuid, text) to authenticated;

-- =================================================================================================== change it
-- p_changes keys (any of): name, note, closes_at, spots (null = no cap), extras, tee_time, booker_id, invite_add
-- (array of player ids: ask more people). Whoever put it out (or an organiser). Changing spots after lock-in moves
-- people between the round and the reserve list straight away (and tells anyone moved up).
create or replace function public.callout_update(p_plan uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; v_spots int; v_extras jsonb; v_new uuid[];
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) or not v.callout then raise exception 'Round not found'; end if;
  perform private.require_saved(v.group_id);
  if not private.callout_can_manage(v) then raise exception 'Only whoever put it out (or an organiser) can change it'; end if;
  if v.status in ('cancelled', 'done') then raise exception 'This one is finished'; end if;
  if jsonb_typeof(p_changes) <> 'object' then return; end if;
  me := private.my_player_id(v.group_id);
  if p_changes ? 'name' and nullif(btrim(p_changes ->> 'name'), '') is not null then
    update public.plans set name = left(btrim(p_changes ->> 'name'), 60) where id = p_plan;
  end if;
  if p_changes ? 'note' then
    update public.plans set brief = nullif(btrim(left(coalesce(p_changes ->> 'note', ''), 500)), '') where id = p_plan;
  end if;
  if p_changes ? 'closes_at' then
    update public.plans set closes_at = nullif(p_changes ->> 'closes_at', '')::timestamptz where id = p_plan;
  end if;
  if p_changes ? 'tee_time' then
    if nullif(p_changes ->> 'tee_time', '') is not null and p_changes ->> 'tee_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'A tee time looks like 13:20'; end if;
    update public.plans set tee_time = nullif(p_changes ->> 'tee_time', '') where id = p_plan;
  end if;
  if p_changes ? 'booker_id' then
    if nullif(p_changes ->> 'booker_id', '') is not null and not exists (select 1 from public.players where id = (p_changes ->> 'booker_id')::uuid and group_id = v.group_id) then
      raise exception 'Pick someone in the group to book it';
    end if;
    update public.plans set booker_id = nullif(p_changes ->> 'booker_id', '')::uuid where id = p_plan;
  end if;
  if p_changes ? 'extras' and jsonb_typeof(p_changes -> 'extras') = 'object' then
    select coalesce(jsonb_object_agg(k, val), '{}'::jsonb) into v_extras from jsonb_each(p_changes -> 'extras') e(k, val)
    where (k in ('course_vote', 'games', 'fines', 'cars', 'kitty') and val = 'true'::jsonb)
       or (k = 'after' and jsonb_typeof(val) = 'string' and btrim(val #>> '{}') <> '');
    if v_extras ? 'after' then v_extras := jsonb_set(v_extras, '{after}', to_jsonb(left(btrim(v_extras ->> 'after'), 120))); end if;
    update public.plans set extras = v_extras where id = p_plan;
  end if;
  if p_changes ? 'invite_add' and jsonb_typeof(p_changes -> 'invite_add') = 'array' and not v.invite_all then
    select coalesce(array_agg(p.id), '{}') into v_new from public.players p
    where p.group_id = v.group_id and p.approved is not false
      and p.id in (select (x #>> '{}')::uuid from jsonb_array_elements(p_changes -> 'invite_add') x)
      and not exists (select 1 from public.plan_invites i where i.plan_id = p_plan and i.player_id = p.id);
    insert into public.plan_invites (plan_id, player_id, group_id, invited_by) select p_plan, x, v.group_id, me from unnest(v_new) x on conflict do nothing;
    perform private.callout_queue(v.group_id, v_new, 'callout_new', '⛳ ' || private.callout_first(me) || ' wants a hit — ' || v.name,
      coalesce(v.location_name, 'Course TBC') || '. Tap to say if you can.', v.id, me);
  end if;
  if p_changes ? 'spots' then
    v_spots := nullif(p_changes ->> 'spots', '')::int;
    if v_spots is not null and v_spots not between 2 and 72 then raise exception 'Spots: from 2 to 72, or no cap'; end if;
    update public.plans set spots = v_spots where id = p_plan;
    perform private.callout_sync(p_plan, me, false);
  end if;
end $$;
revoke all on function public.callout_update(uuid, jsonb) from public, anon;
grant execute on function public.callout_update(uuid, jsonb) to authenticated;

-- =================================================================================================== the job
-- p_now: for tests. Replies closed → whoever put it out is nudged to lock it in, once. The evening before (from 5pm
-- Sydney) → everyone with a spot, once.
create or replace function private.callout_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v record; v_local timestamp := p_now at time zone 'Australia/Sydney'; v_n int := 0; v_d int := 0; v_top record; v_body text;
        v_ids uuid[]; x uuid; v_key text; v_hit int;
begin
  -- Replies closed, not locked in yet.
  for v in select * from public.plans p where p.callout and p.status = 'planning' and p.closes_at is not null and p.closes_at <= p_now loop
    v_key := 'callout-close:' || v.id;
    insert into public.notify_log (key) values (v_key) on conflict do nothing;
    get diagnostics v_hit = row_count;
    continue when v_hit = 0;
    select o.label, (select count(*) from public.plan_votes pv where pv.option_id = o.id and pv.response = 'yes') as yes,
           (select count(*) from public.plan_votes pv where pv.option_id = o.id and pv.response = 'maybe') as maybe
      into v_top
      from public.plan_options o join public.plan_polls po on po.id = o.poll_id
      where po.plan_id = v.id and po.kind = 'dates'
      order by 2 desc, 3 desc, o.start_date limit 1;
    if v_top.label is not null then v_body := 'Best so far: ' || v_top.label || ' — ' || v_top.yes || ' can' || case when v_top.maybe > 0 then ', ' || v_top.maybe || ' maybe' else '' end || '. Tap to lock it in.';
    else v_body := (select count(*) from public.plan_rsvps r where r.plan_id = v.id and r.status = 'in') || ' in. Tap to lock it in.';
    end if;
    perform private.callout_queue(v.group_id, array_remove(array[v.created_by, case when v.organiser_id is distinct from v.created_by then v.organiser_id end], null),
      'callout_lockit', '⏰ Replies are in — lock in ' || v.name, v_body, v.id);
    v_n := v_n + 1;
  end loop;
  -- The evening before.
  if extract(hour from v_local) >= 17 then
    for v in select * from public.plans p where p.callout and p.status = 'confirmed' and p.start_date = (v_local::date + 1) and p.round_id is not null loop
      v_key := 'callout-tomorrow:' || v.id;
      insert into public.notify_log (key) values (v_key) on conflict do nothing;
      get diagnostics v_hit = row_count;
      continue when v_hit = 0;
      select coalesce(array_agg(o.player_id order by o.place), '{}') into v_ids from private.callout_order(v.id) o where o.has_spot;
      foreach x in array v_ids loop
        perform private.callout_queue(v.group_id, array[x], 'callout_tomorrow',
          '⛳ Tomorrow: ' || coalesce(private.callout_clock(v.tee_time) || ' at ', '') || coalesce(v.location_name, 'the course'),
          case when cardinality(v_ids) > 1 then 'With ' || private.callout_names(array_remove(v_ids, x)) || '. ' else '' end
            || 'Can’t make it now? Tap to say so — the first reserve gets your spot.', v.id);
      end loop;
      v_d := v_d + 1;
    end loop;
  end if;
  return jsonb_build_object('nudged', v_n, 'tomorrow', v_d);
end $$;
revoke all on function private.callout_tick(timestamptz) from public, anon, authenticated;

-- The tick, then (when something is waiting) the notify function sends the call-out buzzes straight away to people on
-- "straight away" (the hourly send does the rest). Found the way 071 and 100 find the project's address and secret.
create or replace function private.callout_job() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_base text; v_secret text;
begin
  v := private.callout_tick(now());
  if exists (select 1 from public.notify_queue where kind like 'callout\_%' and sent_at is null and created_at > now() - interval '30 minutes') then
    select substring(command from 'https://[a-z0-9]+\.supabase\.co') into v_base from cron.job where jobname = 'lgc-daily-reminders';
    select value into v_secret from public.server_secrets where name = 'cron_secret';
    if v_base is not null and v_secret is not null then
      perform net.http_post(url := v_base || '/functions/v1/notify',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body := '{"type":"callout"}'::jsonb);
    end if;
  end if;
  return v;
end $$;
revoke all on function private.callout_job() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'lgc-round-callouts') then perform cron.unschedule('lgc-round-callouts'); end if;
end $$;
select cron.schedule('lgc-round-callouts', '*/10 * * * *', 'select private.callout_job()');

-- Extension point (not built, Josh 23 Oct): repeating call-outs — "every Saturday 7:30 at Moore Park". A repeat would
-- be a row describing the pattern, and callout_tick would put the next one out by itself each week with put_round_out's
-- insert. Nothing here depends on it.
