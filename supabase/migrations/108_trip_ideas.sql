-- 108 — Trip ideas you can share: propose → people add → tidy → vote (ov39, Josh 25 Oct 2026).
-- RUNS AFTER 106 (107 is parked on another branch; nothing here touches it). Not applied to any Supabase project yet.
--
-- Josh: "I just want someone to propose … post from my app an idea, people come in, add date, area, course ideas, then
-- if something seems like it might work the organiser can tidy up and send for a vote, and ones that are not included
-- can be used to create another trip idea." And (19:14): COLLECT → SHAPE → DECIDE — the share link lands on "Help plan
-- <idea> — 4 quick taps" (dates I can't do, spend, getting there, golf per day, one wish). And (19:22): respect what's
-- already decided ("the definition"): the organiser can fix the weekend, the area or the length; suggestions outside
-- it go to the organiser's queue (accept / decline with a note), inside it straight into the lists; per-day timing
-- wishes (day_prefs) and "home by" for the last day.
--
-- ADDITIVE ONLY. Nothing is dropped or renamed; no existing check is dropped or re-added; no existing function or
-- policy is changed. Old app versions keep working: an idea is an ordinary planning trip (kind 'trip', status
-- 'planning', proposed as before) with a few extra nullable columns they never read.
--
--   * plans: idea (boolean, default false), idea_when, idea_where, idea_travel ('drive' | 'fly' | 'either'),
--     share_token (the unguessable part of the share link), shared_at, card_url (the share picture), idea_from (the
--     idea this one was started from — "Start another trip idea from these"), idea_sent_at (sent to the vote),
--     idea_fixed (the definition: { weekend: { start, end } | null, area: text | null, nights: int | null }).
--   * plan_idea_items — the idea's lists: dates (a weekend), areas, courses. Anyone the idea is shared with adds;
--     by_ai marks the Caddie's ✨ ones; picked = ticked by the organiser for the vote; status 'in' (on the list),
--     'queued' (a suggestion outside the definition, waiting for the organiser) or 'declined' (with decline_note).
--     Comments use plan_comments (025). Tagging people in comments: a named extension point only (IDEA_TAGS_LATER).
--   * plan_idea_reactions — 👍 / 👎 on an item, one per person.
--   * plan_wishes — "Help plan — 4 quick taps", one row per person per plan (ov40 reads it for the day schedule):
--     { plan_id, player_id, cant_dates (Fridays of weekends they can't do), spend_band, travel, max_drive_min,
--       golf_per_day, day_prefs (jsonb by weekday 'thu'|'fri'|'sat'|'sun'|'mon' → 'early'|'midday'|'late'|
--       'morning_free'|'any'), home_by (time, the last day), wish, updated_at } (+ group_id, like every table).
--     A fixed weekend is answered with the existing In / Maybe / Can't (plan_rsvps), not cant_dates.
--   * Functions: share_idea (who can share; makes the token), idea_tidy (organiser ticks; optionally marks it sent to
--     the vote), idea_spin_off (a new idea from the unused ones), idea_set_fixed (the definition), idea_review
--     (accept / decline a queued suggestion), idea_preview (the link preview — anyone, by token: name, rough
--     when/where and the picture only).
--
-- Who can do what:
--   * Propose an idea: as any plan today (members insert proposals; 102 needs a saved account).
--   * Share it (share_idea): whoever proposed it, a group organiser, the trip's organiser or a co-organiser (104).
--   * Add dates / areas / courses, react, answer the 4 taps: anyone in the group once it's shared (before that: whoever
--     proposed it and the organisers). Phone-only accounts too — like comments and votes (102's "CAN" list).
--   * Tidy, spin off, fix the definition, handle the queue: group organisers, the trip's organiser, co-organisers
--     (v10.6, up to 3).
--   * Remove an item: whoever added it, or the organisers above.

-- =================================================================================================== plans columns
alter table public.plans add column if not exists idea boolean not null default false;
alter table public.plans add column if not exists idea_when text check (idea_when is null or char_length(idea_when) <= 80);
alter table public.plans add column if not exists idea_where text check (idea_where is null or char_length(idea_where) <= 80);
alter table public.plans add column if not exists idea_travel text check (idea_travel is null or idea_travel in ('drive', 'fly', 'either'));
alter table public.plans add column if not exists share_token text check (share_token is null or share_token ~ '^[A-Za-z0-9_-]{16,40}$');
alter table public.plans add column if not exists shared_at timestamptz;
alter table public.plans add column if not exists card_url text check (card_url is null or (char_length(card_url) <= 500 and card_url ~ '^https://'));
alter table public.plans add column if not exists idea_from uuid references public.plans(id) on delete set null;
alter table public.plans add column if not exists idea_sent_at timestamptz;
alter table public.plans add column if not exists idea_fixed jsonb not null default '{}'::jsonb check (jsonb_typeof(idea_fixed) = 'object' and pg_column_size(idea_fixed) <= 600);
create unique index if not exists plans_share_token_idx on public.plans (share_token) where share_token is not null;
create index if not exists plans_idea_from_idx on public.plans (idea_from);

-- The share fields are set only through share_idea (never a plain update from the app).
create or replace function private.plans_idea_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or current_setting('tgt.idea_ok', true) = 'on' then return new; end if; -- functions below, jobs
  if tg_op = 'INSERT' then
    if new.share_token is not null or new.shared_at is not null or new.card_url is not null or new.idea_sent_at is not null
       or coalesce(new.idea_fixed, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Share the idea with the 📣 Share it button';
    end if;
    return new;
  end if;
  if new.share_token is distinct from old.share_token or new.shared_at is distinct from old.shared_at
     or new.card_url is distinct from old.card_url or new.idea_sent_at is distinct from old.idea_sent_at
     or new.idea_fixed is distinct from old.idea_fixed then
    raise exception 'Share the idea with the 📣 Share it button';
  end if;
  return new;
end $$;
revoke all on function private.plans_idea_guard() from public, anon, authenticated;
drop trigger if exists ai_idea_guard on public.plans;
create trigger ai_idea_guard before insert or update on public.plans
  for each row execute function private.plans_idea_guard();

-- =================================================================================================== helpers
-- Can I tidy this idea (tick for the vote, spin off)? A group organiser, the trip's organiser, a co-organiser.
create or replace function private.idea_can_tidy(p_plan uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plans p
    where p.id = p_plan and private.is_group_member(p.group_id)
      and (private.is_group_organiser(p.group_id)
           or (p.organiser_id is not null and p.organiser_id = private.my_player_id(p.group_id))
           or private.is_plan_coorganiser(p.id))
  )
$$;
revoke all on function private.idea_can_tidy(uuid) from public, anon;
grant execute on function private.idea_can_tidy(uuid) to authenticated;

-- Can I add to this idea? Shared (anyone in the group), or not yet shared (whoever proposed it, the organisers).
-- Only while it's being planned.
create or replace function private.idea_can_add(p_plan uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plans p
    where p.id = p_plan and p.idea and p.status = 'planning' and private.is_group_member(p.group_id)
      and (p.shared_at is not null or p.created_by = private.my_player_id(p.group_id) or private.idea_can_tidy(p.id))
  )
$$;
revoke all on function private.idea_can_add(uuid) from public, anon;
grant execute on function private.idea_can_add(uuid) to authenticated;

-- Every date in the list is a Friday (the weekend's Friday) — plan_wishes.cant_dates.
create or replace function private.all_fridays(p_dates date[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(extract(isodow from d) = 5), true) from unnest(coalesce(p_dates, '{}'::date[])) d
$$;

-- day_prefs: { fri: 'late', sun: 'early' } — weekdays thu–mon, each early / midday / late / morning_free / any.
create or replace function private.day_prefs_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object' and coalesce((
    select bool_and(k in ('thu', 'fri', 'sat', 'sun', 'mon') and jsonb_typeof(v) = 'string'
                    and v #>> '{}' in ('early', 'midday', 'late', 'morning_free', 'any'))
    from jsonb_each(p) e(k, v)), true)
$$;

-- =================================================================================================== the lists
create table if not exists public.plan_idea_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  kind text not null check (kind in ('date', 'area', 'course')),
  label text not null check (char_length(btrim(label)) between 2 and 80),
  start_date date,
  end_date date,
  area text check (area is null or char_length(area) <= 80),            -- a course: the area it's in (if known)
  library_course_id uuid references public.course_library(id) on delete set null,
  note text check (note is null or char_length(note) <= 200),
  fit text check (fit is null or char_length(fit) <= 120),              -- the Caddie's fit line ("fits 9 of 11 · within 3 h")
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2000),
  by_ai boolean not null default false,
  picked boolean not null default false,
  status text not null default 'in' check (status in ('in', 'queued', 'declined')),
  decline_note text check (decline_note is null or char_length(decline_note) <= 200),
  added_by uuid references public.players(id) on delete set null default public.my_player_id(),
  created_at timestamptz not null default now(),
  check (kind <> 'date' or (start_date is not null and end_date is not null and end_date >= start_date and end_date - start_date <= 6))
);
create index if not exists plan_idea_items_plan_idx on public.plan_idea_items (plan_id);
create index if not exists plan_idea_items_group_idx on public.plan_idea_items (group_id);
create index if not exists plan_idea_items_added_by_idx on public.plan_idea_items (added_by);
create index if not exists plan_idea_items_library_idx on public.plan_idea_items (library_course_id);
-- The same thing once per list ("Hunter Valley" twice is one item).
create unique index if not exists plan_idea_items_once on public.plan_idea_items (plan_id, kind, lower(btrim(label)));
alter table public.plan_idea_items enable row level security;
revoke all on public.plan_idea_items from anon;
grant select, insert, delete on public.plan_idea_items to authenticated;
drop trigger if exists aa_fill_group_id on public.plan_idea_items;
create trigger aa_fill_group_id before insert or update on public.plan_idea_items
  for each row execute function private.fill_group_id('plans:plan_id');

drop policy if exists "members read" on public.plan_idea_items;
create policy "members read" on public.plan_idea_items for select to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[]));
drop policy if exists "add as me" on public.plan_idea_items;
create policy "add as me" on public.plan_idea_items for insert to authenticated
  with check (added_by = private.my_player_id(group_id) and not picked and status in ('in', 'queued') and decline_note is null
              and private.idea_can_add(plan_id));
drop policy if exists "remove mine or tidy" on public.plan_idea_items;
create policy "remove mine or tidy" on public.plan_idea_items for delete to authenticated
  using (added_by = private.my_player_id(group_id) or private.idea_can_tidy(plan_id));
drop policy if exists "same group only" on public.plan_idea_items;
create policy "same group only" on public.plan_idea_items as restrictive for all to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[])) with check (group_id = any ((select private.my_group_ids())::uuid[]));
drop policy if exists "feature on: planner (add)" on public.plan_idea_items;
create policy "feature on: planner (add)" on public.plan_idea_items as restrictive for insert to authenticated with check (public.feature_on(group_id, 'planner'));

-- Up to 40 of each kind per idea; dates on an idea are weekends from today on.
create or replace function private.plan_idea_items_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.label := btrim(new.label);
  if (select count(*) from public.plan_idea_items where plan_id = new.plan_id and kind = new.kind) >= 40 then
    raise exception 'That list is full (40) — tidy it up first';
  end if;
  if new.kind = 'date' and new.end_date < (now() at time zone 'Australia/Sydney')::date then
    raise exception 'That weekend has been and gone';
  end if;
  -- Outside the definition (a weekend or area the organiser has fixed) → the organiser's queue, unless it's one of the
  -- organisers adding it (or the copying in idea_spin_off).
  if new.status = 'in' and current_setting('tgt.idea_ok', true) is distinct from 'on' and auth.uid() is not null
     and not private.idea_can_tidy(new.plan_id) then
    select case
      when new.kind = 'date' and p.idea_fixed ? 'weekend' and jsonb_typeof(p.idea_fixed->'weekend') = 'object' then 'queued'
      when new.kind = 'area' and coalesce(p.idea_fixed->>'area', '') <> '' and lower(btrim(new.label)) <> lower(btrim(p.idea_fixed->>'area')) then 'queued'
      when new.kind = 'course' and coalesce(p.idea_fixed->>'area', '') <> '' and new.area is not null and lower(btrim(new.area)) <> lower(btrim(p.idea_fixed->>'area')) then 'queued'
      else 'in' end
    into new.status from public.plans p where p.id = new.plan_id;
  end if;
  return new;
end $$;
revoke all on function private.plan_idea_items_check() from public, anon, authenticated;
drop trigger if exists ac_check on public.plan_idea_items;
create trigger ac_check before insert on public.plan_idea_items
  for each row execute function private.plan_idea_items_check();

-- ------------------------------------------------------------------ 👍 / 👎
create table if not exists public.plan_idea_reactions (
  item_id uuid not null references public.plan_idea_items(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (item_id, player_id)
);
create index if not exists plan_idea_reactions_group_idx on public.plan_idea_reactions (group_id);
create index if not exists plan_idea_reactions_player_idx on public.plan_idea_reactions (player_id);
alter table public.plan_idea_reactions enable row level security;
revoke all on public.plan_idea_reactions from anon;
grant select, insert, update, delete on public.plan_idea_reactions to authenticated;
drop trigger if exists aa_fill_group_id on public.plan_idea_reactions;
create trigger aa_fill_group_id before insert or update on public.plan_idea_reactions
  for each row execute function private.fill_group_id('plan_idea_items:item_id');

create or replace function private.idea_item_open(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plan_idea_items i where i.id = p_item and private.idea_can_add(i.plan_id))
$$;
revoke all on function private.idea_item_open(uuid) from public, anon;
grant execute on function private.idea_item_open(uuid) to authenticated;

drop policy if exists "members read" on public.plan_idea_reactions;
create policy "members read" on public.plan_idea_reactions for select to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[]));
drop policy if exists "react as me" on public.plan_idea_reactions;
create policy "react as me" on public.plan_idea_reactions for insert to authenticated
  with check (player_id = private.my_player_id(group_id) and private.idea_item_open(item_id));
drop policy if exists "change mine" on public.plan_idea_reactions;
create policy "change mine" on public.plan_idea_reactions for update to authenticated
  using (player_id = private.my_player_id(group_id)) with check (player_id = private.my_player_id(group_id) and private.idea_item_open(item_id));
drop policy if exists "remove mine" on public.plan_idea_reactions;
create policy "remove mine" on public.plan_idea_reactions for delete to authenticated
  using (player_id = private.my_player_id(group_id));
drop policy if exists "same group only" on public.plan_idea_reactions;
create policy "same group only" on public.plan_idea_reactions as restrictive for all to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[])) with check (group_id = any ((select private.my_group_ids())::uuid[]));

-- ------------------------------------------------------------------ "Help plan — 4 quick taps" (one row per person per plan)
create table if not exists public.plan_wishes (
  plan_id uuid not null references public.plans(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  cant_dates date[] not null default '{}'::date[] check (cardinality(cant_dates) <= 60 and private.all_fridays(cant_dates)),
  spend_band text check (spend_band is null or spend_band in ('lt500', '500_800', '800_1200', 'any')),
  travel text check (travel is null or travel in ('drive', 'fly', 'either')),
  max_drive_min int check (max_drive_min is null or max_drive_min between 30 and 720),
  golf_per_day text check (golf_per_day is null or golf_per_day in ('one', '36_ok', 'mix')),
  day_prefs jsonb not null default '{}'::jsonb check (private.day_prefs_ok(day_prefs)),
  home_by time,
  wish text check (wish is null or char_length(wish) <= 300),
  updated_at timestamptz not null default now(),
  primary key (plan_id, player_id)
);
create index if not exists plan_wishes_group_idx on public.plan_wishes (group_id);
create index if not exists plan_wishes_player_idx on public.plan_wishes (player_id);
alter table public.plan_wishes enable row level security;
revoke all on public.plan_wishes from anon;
grant select, insert, update, delete on public.plan_wishes to authenticated;
drop trigger if exists aa_fill_group_id on public.plan_wishes;
create trigger aa_fill_group_id before insert or update on public.plan_wishes
  for each row execute function private.fill_group_id('plans:plan_id');

-- Answers only while the trip's being planned (any plan, not just ideas: ov40's day schedule asks the same).
create or replace function private.wishes_open(p_plan uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plans p where p.id = p_plan and p.status = 'planning' and private.is_group_member(p.group_id)
                 and (not p.idea or private.idea_can_add(p.id)))
$$;
revoke all on function private.wishes_open(uuid) from public, anon;
grant execute on function private.wishes_open(uuid) to authenticated;

drop policy if exists "members read" on public.plan_wishes;
create policy "members read" on public.plan_wishes for select to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[]));
drop policy if exists "answer as me" on public.plan_wishes;
create policy "answer as me" on public.plan_wishes for insert to authenticated
  with check (player_id = private.my_player_id(group_id) and private.wishes_open(plan_id));
drop policy if exists "change mine" on public.plan_wishes;
create policy "change mine" on public.plan_wishes for update to authenticated
  using (player_id = private.my_player_id(group_id)) with check (player_id = private.my_player_id(group_id) and private.wishes_open(plan_id));
drop policy if exists "remove mine" on public.plan_wishes;
create policy "remove mine" on public.plan_wishes for delete to authenticated
  using (player_id = private.my_player_id(group_id));
drop policy if exists "same group only" on public.plan_wishes;
create policy "same group only" on public.plan_wishes as restrictive for all to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[])) with check (group_id = any ((select private.my_group_ids())::uuid[]));
drop policy if exists "feature on: planner (add)" on public.plan_wishes;
create policy "feature on: planner (add)" on public.plan_wishes as restrictive for insert to authenticated with check (public.feature_on(group_id, 'planner'));

create or replace function private.plan_wishes_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.cant_dates := coalesce((select array_agg(distinct d order by d) from unnest(new.cant_dates) d), '{}'::date[]);
  new.wish := nullif(btrim(coalesce(new.wish, '')), '');
  return new;
end $$;
revoke all on function private.plan_wishes_touch() from public, anon, authenticated;
drop trigger if exists ac_touch on public.plan_wishes;
create trigger ac_touch before insert or update on public.plan_wishes
  for each row execute function private.plan_wishes_touch();

select private.add_same_group_checks();
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['plan_idea_items', 'plan_idea_reactions', 'plan_wishes'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- =================================================================================================== functions
-- 📣 Share it: whoever proposed it or the organisers. Makes the link's token (once), keeps the share picture's address
-- (a public photo the app just uploaded), and marks it shared — from then on anyone in the group can add. Returns the
-- token. Sharing again keeps the same link (a new picture replaces the old one).
create or replace function public.share_idea(p_plan uuid, p_card_url text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; tok text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  if not public.feature_on(v.group_id, 'planner') then raise exception 'The Trips planner is switched off for this group'; end if;
  if not v.idea then raise exception 'Only a trip idea can be shared this way'; end if;
  if v.status <> 'planning' then raise exception 'This trip isn''t being planned any more'; end if;
  me := private.my_player_id(v.group_id);
  if not (me is not null and me = v.created_by) and not private.idea_can_tidy(v.id) then
    raise exception 'Only whoever proposed it, or an organiser, can share it';
  end if;
  if p_card_url is not null and (char_length(p_card_url) > 500 or p_card_url !~ '^https://[^\s]+/storage/v1/object/public/photos/[^\s]+$') then
    raise exception 'That picture isn''t one of the app''s';
  end if;
  tok := coalesce(v.share_token, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_'));
  perform set_config('tgt.idea_ok', 'on', true);
  update public.plans set share_token = tok, shared_at = coalesce(shared_at, now()), card_url = coalesce(p_card_url, card_url) where id = v.id;
  perform set_config('tgt.idea_ok', 'off', true);
  return tok;
end $$;
revoke all on function public.share_idea(uuid, text) from public, anon;
grant execute on function public.share_idea(uuid, text) to authenticated;

-- Tidy: the organiser ticks which dates / areas / courses go to the vote (everything else unticked). p_send marks the
-- idea as sent to the vote (the app then writes the trip builder and calls the When? / Where? votes, as v10.6 does).
-- Returns how many are ticked.
create or replace function public.idea_tidy(p_plan uuid, p_picked uuid[], p_send boolean default false) returns int
language plpgsql security definer set search_path = '' as $$
declare v public.plans; n int;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  if not v.idea then raise exception 'Only a trip idea can be tidied this way'; end if;
  if v.status <> 'planning' then raise exception 'This trip isn''t being planned any more'; end if;
  if not private.idea_can_tidy(v.id) then raise exception 'Only an organiser can tidy it up'; end if;
  if not private.is_saved_user() then raise exception 'Save your spot first (Google or email) to do this' using errcode = '42501', hint = 'save_spot'; end if;
  update public.plan_idea_items set picked = (status = 'in' and id = any (coalesce(p_picked, '{}'::uuid[]))) where plan_id = v.id;
  select count(*) into n from public.plan_idea_items where plan_id = v.id and picked;
  if p_send then
    if n = 0 then raise exception 'Tick at least one thing for the vote'; end if;
    perform set_config('tgt.idea_ok', 'on', true);
    update public.plans set idea_sent_at = now() where id = v.id;
    perform set_config('tgt.idea_ok', 'off', true);
  end if;
  return n;
end $$;
revoke all on function public.idea_tidy(uuid, uuid[], boolean) from public, anon;
grant execute on function public.idea_tidy(uuid, uuid[], boolean) to authenticated;

-- "Start another trip idea from these": a new idea with the dates, areas and courses NOT ticked for the vote (who added
-- each, and the ✨ marks, kept). Organisers (as idea_tidy). Returns the new plan's id.
create or replace function public.idea_spin_off(p_plan uuid, p_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; nid uuid; nm text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v from public.plans where id = p_plan;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  if not v.idea then raise exception 'Only a trip idea can be split this way'; end if;
  if not private.idea_can_tidy(v.id) then raise exception 'Only an organiser can start another idea from these'; end if;
  if not private.is_saved_user() then raise exception 'Save your spot first (Google or email) to do this' using errcode = '42501', hint = 'save_spot'; end if;
  if not public.feature_on(v.group_id, 'planner') then raise exception 'The Trips planner is switched off for this group'; end if;
  if not exists (select 1 from public.plan_idea_items where plan_id = v.id and not picked and status = 'in') then
    raise exception 'Nothing left over — everything went to the vote';
  end if;
  me := private.my_player_id(v.group_id);
  nm := left(coalesce(nullif(btrim(p_name), ''), v.name || ' — another idea'), 80);
  insert into public.plans (group_id, kind, name, status, proposed, created_by, organiser_id, idea, idea_travel, idea_from, brief)
  values (v.group_id, 'trip', nm, 'planning', false, me, me, true, v.idea_travel, v.id, null)
  returning id into nid;
  perform set_config('tgt.idea_ok', 'on', true);
  insert into public.plan_idea_items (plan_id, group_id, kind, label, start_date, end_date, area, library_course_id, note, fit, detail, by_ai, added_by, created_at)
  select nid, v.group_id, i.kind, i.label, i.start_date, i.end_date, i.area, i.library_course_id, i.note, i.fit, i.detail, i.by_ai, i.added_by, i.created_at
  from public.plan_idea_items i
  where i.plan_id = v.id and not i.picked and i.status = 'in' and (i.kind <> 'date' or i.end_date >= (now() at time zone 'Australia/Sydney')::date)
  order by i.created_at;
  perform set_config('tgt.idea_ok', 'off', true);
  if me is not null then
    insert into public.plan_rsvps (plan_id, player_id, status) values (nid, me, 'in') on conflict do nothing;
  end if;
  return nid;
end $$;
revoke all on function public.idea_spin_off(uuid, text) from public, anon;
grant execute on function public.idea_spin_off(uuid, text) to authenticated;

-- The definition: what the organiser has fixed — { weekend: { start, end } } (a weekend of up to 6 nights), { area },
-- { nights } (1–6). Pass {} to open it all up again. Organisers and co-organisers. Returns what's stored.
create or replace function public.idea_set_fixed(p_plan uuid, p_fixed jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.plans; f jsonb := '{}'::jsonb; s date; e date; n int;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  if not v.idea then raise exception 'Only a trip idea has this'; end if;
  if v.status <> 'planning' then raise exception 'This trip isn''t being planned any more'; end if;
  if not private.idea_can_tidy(v.id) then raise exception 'Only an organiser can fix parts of the idea'; end if;
  if not private.is_saved_user() then raise exception 'Save your spot first (Google or email) to do this' using errcode = '42501', hint = 'save_spot'; end if;
  if p_fixed is null or jsonb_typeof(p_fixed) <> 'object' then raise exception 'Nothing to fix'; end if;
  if jsonb_typeof(p_fixed->'weekend') = 'object' then
    begin
      s := (p_fixed->'weekend'->>'start')::date; e := coalesce((p_fixed->'weekend'->>'end')::date, s);
    exception when others then raise exception 'That weekend isn''t a date';
    end;
    if s is null or e < s or e - s > 6 then raise exception 'That weekend isn''t right'; end if;
    f := f || jsonb_build_object('weekend', jsonb_build_object('start', s, 'end', e));
  end if;
  if coalesce(btrim(p_fixed->>'area'), '') <> '' then f := f || jsonb_build_object('area', left(btrim(p_fixed->>'area'), 80)); end if;
  if p_fixed ? 'nights' and jsonb_typeof(p_fixed->'nights') = 'number' then
    n := (p_fixed->>'nights')::int;
    if n < 1 or n > 6 then raise exception 'One to six nights'; end if;
    f := f || jsonb_build_object('nights', n);
  end if;
  perform set_config('tgt.idea_ok', 'on', true);
  update public.plans set idea_fixed = f where id = v.id;
  perform set_config('tgt.idea_ok', 'off', true);
  return f;
end $$;
revoke all on function public.idea_set_fixed(uuid, jsonb) from public, anon;
grant execute on function public.idea_set_fixed(uuid, jsonb) to authenticated;

-- The organiser's queue: accept a suggestion (onto the list) or decline it (with an optional note the person sees).
create or replace function public.idea_review(p_item uuid, p_accept boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare i public.plan_idea_items;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into i from public.plan_idea_items where id = p_item for update;
  if i.id is null or not private.is_group_member(i.group_id) then raise exception 'Suggestion not found'; end if;
  if not private.idea_can_tidy(i.plan_id) then raise exception 'Only an organiser can look at suggestions'; end if;
  if i.status <> 'queued' then raise exception 'That one''s already been looked at'; end if;
  update public.plan_idea_items set status = case when p_accept then 'in' else 'declined' end,
    decline_note = case when p_accept then null else nullif(left(btrim(coalesce(p_note, '')), 200), '') end
  where id = i.id;
  return case when p_accept then 'in' else 'declined' end;
end $$;
revoke all on function public.idea_review(uuid, boolean, text) from public, anon;
grant execute on function public.idea_review(uuid, boolean, text) to authenticated;

-- The link preview (WhatsApp / Messenger fetch the link with no sign-in): by the link's token only, a shared idea's
-- name, rough when / where / getting there, who proposed it (first name), the group's name, the picture and the plan's
-- id (for the link into the app — the database still decides who can open it). Nothing else: no lists, no people. Callable by anyone (the Cloudflare page function uses the public key).
create or replace function public.idea_preview(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object(
    'name', p.name, 'when', p.idea_when, 'fixed', p.idea_fixed, 'where', p.idea_where, 'travel', p.idea_travel, 'card_url', p.card_url,
    'by', private.callout_first(p.created_by), 'group', g.name, 'plan_id', p.id)
  end
  from (select 1) one
  left join public.plans p on p.share_token = p_token and p_token ~ '^[A-Za-z0-9_-]{16,40}$' and p.idea and p.shared_at is not null
                              and p.status in ('planning', 'confirmed')
  left join public.groups g on g.id = p.group_id
$$;
revoke all on function public.idea_preview(text) from public;
grant execute on function public.idea_preview(text) to anon, authenticated;
