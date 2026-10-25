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
--     idea_fixed (the definition — whatever the organiser knows, any mix: { weekend: { start, end }, when (rough words,
--     e.g. "the 4-day long weekend"), area, from (e.g. "Sydney"), within_min (e.g. 180 = "within 3 h"), travel, nights
--     (0–5: trips of 1–6 days), golf, set: [the parts marked "Set" — weekend / area / nights / travel / golf] }. A part
--     not in `set` is "Open to ideas").
--   * plan_idea_items — the idea's lists: dates (a weekend), areas, courses. Anyone the idea is shared with adds;
--     by_ai marks the Caddie's ✨ ones; picked = ticked by the organiser for the vote; status 'in' (on the list),
--     'queued' (a suggestion outside the definition, waiting for the organiser) or 'declined' (with decline_note).
--     Comments use plan_comments (025). Tagging people in comments: a named extension point only (IDEA_TAGS_LATER).
--   * plan_idea_reactions — 👍 / 👎 on an item, one per person.
--   * plan_wishes — "Help plan — 4 quick taps", one row per person per plan (ov40 reads it for the day schedule):
--     { plan_id, player_id, cant_dates (Fridays of weekends they can't do), spend_band, travel, max_drive_min,
--       golf_per_day ('max' as much as possible | 'daily' a round a day | 'spare_day' leave a spare day | 'any'), day_prefs (jsonb by the day's place in the trip 'first'|'middle'|'last' → 'early'|'midday'|'late'|
--       'morning_free'|'any'; old weekday keys 'thu'…'mon' are still accepted and read for that weekday), home_by (time,
--       the last day), nights (int[]: the trip lengths they'd do, 1–6 nights, 4 = "4+"; null = not answered, {} = not
--       fussed — Josh 21:12 "the number of nights should be an input too"), wish, updated_at } (+ group_id, like every table).
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
alter table public.plans add column if not exists idea_pool boolean not null default false;     -- parked (Future trip ideas)
alter table public.plans add column if not exists claim_owner uuid references public.players(id) on delete set null;
alter table public.plans add column if not exists claim_until timestamptz;
alter table public.plans add column if not exists claim_reminded_at timestamptz;
alter table public.plans add column if not exists claim_opened_at timestamptz;
alter table public.plans add column if not exists claimed_at timestamptz;
create index if not exists plans_claim_owner_idx on public.plans (claim_owner);
create index if not exists plans_parked_idx on public.plans (group_id) where idea_pool;
alter table public.plans add column if not exists idea_organiser uuid references public.players(id) on delete set null;
create index if not exists plans_idea_organiser_idx on public.plans (idea_organiser);
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
       or coalesce(new.idea_fixed, '{}'::jsonb) <> '{}'::jsonb or new.idea_organiser is not null or new.idea_pool
       or new.claim_owner is not null or new.claim_until is not null then
      raise exception 'Share the idea with the 📣 Share it button';
    end if;
    return new;
  end if;
  if new.share_token is distinct from old.share_token or new.shared_at is distinct from old.shared_at
     or new.card_url is distinct from old.card_url or new.idea_sent_at is distinct from old.idea_sent_at
     or new.idea_fixed is distinct from old.idea_fixed or new.idea_organiser is distinct from old.idea_organiser
     or new.idea_pool is distinct from old.idea_pool or new.claim_owner is distinct from old.claim_owner
     or new.claim_until is distinct from old.claim_until or new.claimed_at is distinct from old.claimed_at then
    raise exception 'Share the idea with the 📣 Share it button';
  end if;
  return new;
end $$;
revoke all on function private.plans_idea_guard() from public, anon, authenticated;
drop trigger if exists ai_idea_guard on public.plans;
create trigger ai_idea_guard before insert or update on public.plans
  for each row execute function private.plans_idea_guard();

-- =================================================================================================== helpers
-- Can I organise this idea (tick for the vote, spin off, the definition, the queue)? ONE organiser (Josh 19:34): the
-- trip's organiser — plans.idea_organiser once it's been handed over, else plans.organiser_id (whoever proposed it) —
-- or a group organiser.
create or replace function private.idea_can_tidy(p_plan uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plans p
    where p.id = p_plan and private.is_group_member(p.group_id)
      and (private.is_group_organiser(p.group_id)
           or coalesce(p.idea_organiser, p.organiser_id) = private.my_player_id(p.group_id))
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

-- day_prefs: { first: 'late', last: 'early' } — by the day's place in the trip (first / middle / last; Josh 21:12), each
-- early / midday / late / morning_free / any. Old weekday keys (thu–mon) are still accepted.
create or replace function private.day_prefs_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object' and coalesce((
    select bool_and(k in ('first', 'middle', 'last', 'thu', 'fri', 'sat', 'sun', 'mon') and jsonb_typeof(v) = 'string'
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
  leftover text check (leftover is null or leftover in ('parked', 'spun_off')),
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
  with check (added_by = private.my_player_id(group_id) and not picked and status in ('in', 'queued') and decline_note is null and leftover is null
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
    -- Only what the organiser marked "Set" (idea_fixed.set); "Open to ideas" parts take suggestions straight in.
    select case
      when new.kind = 'date' and coalesce(p.idea_fixed->'set', '[]') ? 'weekend' then 'queued'
      when new.kind = 'area' and coalesce(p.idea_fixed->'set', '[]') ? 'area' and coalesce(p.idea_fixed->>'area', '') <> ''
           and lower(btrim(new.label)) <> lower(btrim(p.idea_fixed->>'area')) then 'queued'
      when new.kind = 'course' and coalesce(p.idea_fixed->'set', '[]') ? 'area' and coalesce(p.idea_fixed->>'area', '') <> ''
           and new.area is not null and lower(btrim(new.area)) <> lower(btrim(p.idea_fixed->>'area')) then 'queued'
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
  golf_per_day text check (golf_per_day is null or golf_per_day in ('max', 'daily', 'spare_day', 'any')),
  day_prefs jsonb not null default '{}'::jsonb check (private.day_prefs_ok(day_prefs)),
  home_by time,
  nights int[] check (nights is null or (cardinality(nights) <= 6 and nights <@ array[1, 2, 3, 4, 5, 6])),
  wish text check (wish is null or char_length(wish) <= 300),
  updated_at timestamptz not null default now(),
  primary key (plan_id, player_id)
);
-- nights came in late in the release (ov41); a database that already ran an earlier copy of 108 gets it here.
alter table public.plan_wishes add column if not exists nights int[]
  check (nights is null or (cardinality(nights) <= 6 and nights <@ array[1, 2, 3, 4, 5, 6]));
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

-- Names stay with the organiser: you read your own row; the trip's organiser and group organisers read everyone's.
-- Everyone else gets the answers without names from idea_wish_answers().
drop policy if exists "mine or the organiser's" on public.plan_wishes;
create policy "mine or the organiser's" on public.plan_wishes for select to authenticated
  using (player_id = private.my_player_id(group_id) or private.is_group_organiser(group_id)
         or exists (select 1 from public.plans p where p.id = plan_id and coalesce(p.idea_organiser, p.organiser_id) = private.my_player_id(p.group_id)));
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
    perform private.idea_organiser_can_run(v.id);
  end if;
  return n;
end $$;
revoke all on function public.idea_tidy(uuid, uuid[], boolean) from public, anon;
grant execute on function public.idea_tidy(uuid, uuid[], boolean) to authenticated;

-- ------------------------------------------------------------------ the leftovers: parked ideas (Josh 19:37, 19:41)
-- Anything not sent to the vote, and declined suggestions. When a vote is sent (or suggestions are declined) the
-- Caddie groups what was dropped into 1–3 named future-trip ideas ("Fly to Tassie — Barnbougle"); the organiser OKs,
-- edits or discards each, one tap each. An OK'd one is PARKED: its own idea (plans.idea_pool = true) in the group's
-- "💭 Future trip ideas", with those items on its lists. Anyone can still add to it (dates, areas, courses, comments, 👍).
--   * First refusal: whoever suggested its main item (claim_owner) has 48 hours (claim_until) to "Claim it". They're
--     told when it's parked, and once more about 6 hours before their time runs out.
--   * After that it's OPEN: anyone in the group can "Claim it" and becomes its organiser; it turns into a normal trip
--     idea they can share. The group hears when it goes open (a Feed post).
--   * The 48 hours: stored (claim_until) and checked when someone claims (so it's exact); the reminder and the "it's
--     open" post come from a job every 15 minutes (pg_cron 'lgc-idea-claims', private.idea_claims_tick).
-- "Or start another trip idea now" (idea_spin_off) stays for the organiser who wants that straight away.
-- plan_idea_items.leftover says what happened to it ('parked' / 'spun_off').

-- A new trip idea (planning, kind 'trip'), organised by me. Proposed unless I'm a group organiser.
create or replace function private.idea_new(p_group uuid, p_name text, p_travel text, p_from uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.my_player_id(p_group); nid uuid;
begin
  insert into public.plans (group_id, kind, name, status, proposed, created_by, organiser_id, idea, idea_travel, idea_from)
  values (p_group, 'trip', left(p_name, 80), 'planning', not private.is_group_organiser(p_group), me, me, true, p_travel, p_from)
  returning id into nid;
  if me is not null then
    insert into public.plan_rsvps (plan_id, player_id, status) values (nid, me, 'in') on conflict do nothing;
  end if;
  return nid;
end $$;
revoke all on function private.idea_new(uuid, text, text, uuid) from public, anon, authenticated;

-- Copy items onto another idea (who added each, and the ✨ marks, kept). Weekends that have gone are left behind.
create or replace function private.idea_copy_items(p_to uuid, p_items uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform set_config('tgt.idea_ok', 'on', true);
  insert into public.plan_idea_items (plan_id, group_id, kind, label, start_date, end_date, area, library_course_id, note, fit, detail, by_ai, added_by, created_at)
  select p_to, t.group_id, i.kind, i.label, i.start_date, i.end_date, i.area, i.library_course_id, i.note, i.fit, i.detail, i.by_ai, i.added_by, i.created_at
  from public.plan_idea_items i join public.plans t on t.id = p_to
  where i.id = any (p_items) and i.group_id = t.group_id and (i.kind <> 'date' or i.end_date >= (now() at time zone 'Australia/Sydney')::date)
  order by i.created_at
  on conflict do nothing;
  get diagnostics n = row_count;
  perform set_config('tgt.idea_ok', 'off', true);
  return n;
end $$;
revoke all on function private.idea_copy_items(uuid, uuid[]) from public, anon, authenticated;

-- The leftovers the organiser may act on: not ticked, on the list or declined, from this idea.
create or replace function private.idea_leftovers(p_plan uuid, p_items uuid[]) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(i.id order by i.created_at), '{}'::uuid[]) from public.plan_idea_items i
  where i.plan_id = p_plan and not i.picked and i.status in ('in', 'declined') and i.leftover is null
    and (p_items is null or i.id = any (p_items))
$$;
revoke all on function private.idea_leftovers(uuid, uuid[]) from public, anon, authenticated;

create or replace function private.idea_organise_check(p_plan uuid) returns public.plans
language plpgsql security definer set search_path = '' as $$
declare v public.plans;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v from public.plans where id = p_plan;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  if not v.idea then raise exception 'Only a trip idea has leftovers'; end if;
  if not private.idea_can_tidy(v.id) then raise exception 'Only the organiser can do that'; end if;
  if not private.is_saved_user() then raise exception 'Save your spot first (Google or email) to do this' using errcode = '42501', hint = 'save_spot'; end if;
  if not public.feature_on(v.group_id, 'planner') then raise exception 'The Trips planner is switched off for this group'; end if;
  return v;
end $$;
revoke all on function private.idea_organise_check(uuid) from public, anon, authenticated;

-- "Or start another trip idea now": a new idea with these leftovers (null = all of them). Returns its id.
create or replace function public.idea_spin_off(p_plan uuid, p_name text default null, p_items uuid[] default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.plans; ids uuid[]; nid uuid;
begin
  v := private.idea_organise_check(p_plan);
  ids := private.idea_leftovers(v.id, p_items);
  if cardinality(ids) = 0 then raise exception 'Nothing left over — everything went to the vote'; end if;
  nid := private.idea_new(v.group_id, coalesce(nullif(btrim(p_name), ''), v.name || ' — another idea'), v.idea_travel, v.id);
  perform private.idea_copy_items(nid, ids);
  perform set_config('tgt.idea_ok', 'on', true);
  update public.plan_idea_items set leftover = 'spun_off' where id = any (ids);
  perform set_config('tgt.idea_ok', 'off', true);
  return nid;
end $$;
revoke all on function public.idea_spin_off(uuid, text, uuid[]) from public, anon;
grant execute on function public.idea_spin_off(uuid, text, uuid[]) to authenticated;

-- Park some leftovers as a named future-trip idea. The organiser (of the idea they came from). Returns its id.
create or replace function public.idea_park(p_plan uuid, p_name text, p_items uuid[], p_why text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.plans; ids uuid[]; nid uuid; owner uuid; nm text := left(btrim(coalesce(p_name, '')), 80); main public.plan_idea_items;
begin
  v := private.idea_organise_check(p_plan);
  if v.idea_pool then raise exception 'That''s already parked'; end if;
  if char_length(nm) < 2 then raise exception 'Give it a name'; end if;
  ids := private.idea_leftovers(v.id, p_items);
  if p_items is null or cardinality(ids) = 0 then raise exception 'Pick what goes in it'; end if;
  -- The main item: an area first, else a weekend, else a course — the first of them in the list given.
  select i.* into main from public.plan_idea_items i
  where i.id = any (ids) order by case i.kind when 'area' then 0 when 'date' then 1 else 2 end, array_position(p_items, i.id) limit 1;
  owner := main.added_by;
  if owner is not null and exists (select 1 from public.group_members where group_id = v.group_id and player_id = owner and role = 'guest') then owner := null; end if;
  perform set_config('tgt.idea_ok', 'on', true);
  insert into public.plans (group_id, kind, name, status, proposed, created_by, organiser_id, idea, idea_pool, shared_at, idea_from, brief,
                            claim_owner, claim_until)
  values (v.group_id, 'trip', nm, 'planning', false, private.my_player_id(v.group_id), null, true, true, now(), v.id,
          nullif(left(btrim(coalesce(p_why, '')), 300), ''), owner, case when owner is null then now() else now() + interval '48 hours' end)
  returning id into nid;
  perform set_config('tgt.idea_ok', 'off', true);
  perform private.idea_copy_items(nid, ids);
  perform set_config('tgt.idea_ok', 'on', true);
  update public.plan_idea_items set leftover = 'parked' where id = any (ids);
  perform set_config('tgt.idea_ok', 'off', true);
  if owner is not null then
    insert into public.notify_queue (group_id, user_id, kind, title, body, url)
    select v.group_id, gm.user_id, 'idea_parked', '💭 Your ' || left(nm, 50) || ' idea is parked',
           'It’s yours if you want it for the next 48 hours: Claim it.', '#/idea/' || nid
    from public.group_members gm where gm.group_id = v.group_id and gm.player_id = owner and gm.user_id is not null;
  end if;
  return nid;
end $$;
revoke all on function public.idea_park(uuid, text, uuid[], text) from public, anon;
grant execute on function public.idea_park(uuid, text, uuid[], text) to authenticated;

-- "Claim it": a parked idea becomes a normal trip idea organised by me. The first 48 hours only its owner can; after
-- that anyone in the group (not guests). Checked here against claim_until, so it's exact whatever the job is doing.
create or replace function public.idea_claim(p_plan uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'That idea isn''t there any more'; end if;
  if not v.idea_pool or v.status <> 'planning' then raise exception 'Someone''s already claimed it'; end if;
  me := private.my_player_id(v.group_id);
  if me is null or exists (select 1 from public.group_members where group_id = v.group_id and player_id = me and role = 'guest') then
    raise exception 'Guests can''t organise a trip';
  end if;
  if not private.is_saved_user() then raise exception 'Save your spot first (Google or email) to do this' using errcode = '42501', hint = 'save_spot'; end if;
  if not public.feature_on(v.group_id, 'planner') then raise exception 'The Trips planner is switched off for this group'; end if;
  if v.claim_owner is not null and v.claim_owner <> me and now() < v.claim_until then
    raise exception 'It''s %''s for now — you can claim it from %', private.callout_first(v.claim_owner),
      to_char(v.claim_until at time zone 'Australia/Sydney', 'Dy FMHH12:MIam');
  end if;
  perform set_config('tgt.idea_ok', 'on', true);
  update public.plans set idea_pool = false, idea_organiser = me, claimed_at = now(), shared_at = null,
         proposed = not private.is_group_organiser(v.group_id) where id = v.id;
  perform set_config('tgt.idea_ok', 'off', true);
  insert into public.plan_rsvps (plan_id, player_id, status) values (v.id, me, 'in') on conflict do nothing;
  return v.id;
end $$;
revoke all on function public.idea_claim(uuid) from public, anon;
grant execute on function public.idea_claim(uuid) to authenticated;

-- The job: ~6 hours before an owner's time runs out, one reminder; when it runs out, a Feed post ("It's open").
create or replace function private.idea_claims_tick(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  perform set_config('tgt.idea_ok', 'on', true);
  for r in select * from public.plans where idea_pool and status = 'planning' and claim_owner is not null
             and claim_reminded_at is null and claim_until > p_now and claim_until <= p_now + interval '6 hours' loop
    insert into public.notify_queue (group_id, user_id, kind, title, body, url)
    select r.group_id, gm.user_id, 'idea_parked', '⏳ Still want ' || left(r.name, 50) || '?',
           'It’s yours until ' || to_char(r.claim_until at time zone 'Australia/Sydney', 'FMHH12:MIam Dy') || ' — then anyone can claim it.', '#/idea/' || r.id
    from public.group_members gm where gm.group_id = r.group_id and gm.player_id = r.claim_owner and gm.user_id is not null;
    update public.plans set claim_reminded_at = p_now where id = r.id;
    n := n + 1;
  end loop;
  for r in select * from public.plans where idea_pool and status = 'planning' and claim_opened_at is null and claim_until <= p_now loop
    insert into public.posts (group_id, kind, body, player_id, link)
    values (r.group_id, 'auto', left('💭 Up for grabs: ' || r.name || ' — a parked trip idea anyone can claim and organise.', 500), null, '/idea/' || r.id);
    update public.plans set claim_opened_at = p_now where id = r.id;
    n := n + 1;
  end loop;
  perform set_config('tgt.idea_ok', 'off', true);
  return n;
end $$;
revoke all on function private.idea_claims_tick(timestamptz) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'lgc-idea-claims') then perform cron.unschedule('lgc-idea-claims'); end if;
    perform cron.schedule('lgc-idea-claims', '*/15 * * * *', 'select private.idea_claims_tick()');
  end if;
end $$;

-- The definition: what the organiser has fixed — { weekend: { start, end } } (a weekend of up to 6 nights), { area },
-- { nights } (1–6). Pass {} to open it all up again. Organisers and co-organisers. Returns what's stored.
create or replace function public.idea_set_fixed(p_plan uuid, p_fixed jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.plans; f jsonb := '{}'::jsonb; s date; e date; n int; k text; sets text[] := '{}';
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  if not v.idea then raise exception 'Only a trip idea has this'; end if;
  if v.status <> 'planning' then raise exception 'This trip isn''t being planned any more'; end if;
  if not private.idea_can_tidy(v.id) then raise exception 'Only the organiser can set parts of the idea'; end if;
  if not private.is_saved_user() then raise exception 'Save your spot first (Google or email) to do this' using errcode = '42501', hint = 'save_spot'; end if;
  if p_fixed is null or jsonb_typeof(p_fixed) <> 'object' then raise exception 'Nothing to set'; end if;
  if jsonb_typeof(p_fixed->'weekend') = 'object' then
    begin
      s := (p_fixed->'weekend'->>'start')::date; e := coalesce((p_fixed->'weekend'->>'end')::date, s);
    exception when others then raise exception 'That weekend isn''t a date';
    end;
    if s is null or e < s or e - s > 5 then raise exception 'That weekend isn''t right (1 to 6 days)'; end if;
    f := f || jsonb_build_object('weekend', jsonb_build_object('start', s, 'end', e));
  end if;
  if coalesce(btrim(p_fixed->>'when'), '') <> '' then f := f || jsonb_build_object('when', left(btrim(p_fixed->>'when'), 60)); end if;
  if coalesce(btrim(p_fixed->>'area'), '') <> '' then f := f || jsonb_build_object('area', left(btrim(p_fixed->>'area'), 80)); end if;
  if coalesce(btrim(p_fixed->>'from'), '') <> '' then f := f || jsonb_build_object('from', left(btrim(p_fixed->>'from'), 60)); end if;
  if jsonb_typeof(p_fixed->'within_min') = 'number' then
    n := (p_fixed->>'within_min')::int;
    if n < 30 or n > 720 then raise exception 'Half an hour to 12 hours'; end if;
    f := f || jsonb_build_object('within_min', n);
  end if;
  if p_fixed->>'travel' in ('drive', 'fly', 'either') then f := f || jsonb_build_object('travel', p_fixed->>'travel'); end if;
  if jsonb_typeof(p_fixed->'nights') = 'number' then
    n := (p_fixed->>'nights')::int;
    if n < 0 or n > 5 then raise exception 'Trips are 1 to 6 days'; end if;
    f := f || jsonb_build_object('nights', n);
  end if;
  if p_fixed->>'golf' in ('max', 'daily', 'spare_day', 'any') then f := f || jsonb_build_object('golf', p_fixed->>'golf'); end if;
  -- "Set" (people say in / out; other suggestions go to the queue) — only for parts that have a value.
  if jsonb_typeof(p_fixed->'set') = 'array' then
    for k in select jsonb_array_elements_text(p_fixed->'set') loop
      if k in ('weekend', 'area', 'nights', 'travel', 'golf') and (f ? k or (k = 'weekend' and f ? 'when')) and not k = any (sets) then
        sets := sets || k;
      end if;
    end loop;
  end if;
  f := f || jsonb_build_object('set', to_jsonb(sets));
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

-- "Hand over organising" (Josh 19:34): the idea's organiser (or a group organiser) makes another player its organiser.
-- They're told (notify_queue, kind 'organiser_handover'). Not a guest; someone in the group. Returns their player id.
create or replace function public.hand_over_idea(p_plan uuid, p_player uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  if v.status not in ('planning', 'confirmed') then raise exception 'This trip is finished'; end if;
  if not private.idea_can_tidy(v.id) then raise exception 'Only the organiser can hand it over'; end if;
  if not private.is_saved_user() then raise exception 'Save your spot first (Google or email) to do this' using errcode = '42501', hint = 'save_spot'; end if;
  if not exists (select 1 from public.players where id = p_player and group_id = v.group_id) then raise exception 'That player isn''t in this group'; end if;
  if exists (select 1 from public.group_members where group_id = v.group_id and player_id = p_player and role = 'guest') then
    raise exception 'A guest can''t organise a trip';
  end if;
  if p_player = coalesce(v.idea_organiser, v.organiser_id) then return p_player; end if;
  me := private.my_player_id(v.group_id);
  -- idea_organiser is who organises it from now on. plans.organiser_id (025) follows only when a group organiser hands
  -- over — 025's guard keeps it for everyone else, which is fine: the idea screens read idea_organiser first.
  perform set_config('tgt.idea_ok', 'on', true);
  update public.plans set idea_organiser = p_player, organiser_id = p_player where id = v.id;
  perform set_config('tgt.idea_ok', 'off', true);
  perform private.idea_organiser_can_run(v.id);
  insert into public.notify_queue (group_id, user_id, kind, title, body, url)
  select v.group_id, gm.user_id, 'organiser_handover', '🧭 You’re organising ' || left(v.name, 60),
         coalesce(private.callout_first(me), 'Someone') || ' handed it over to you — tidy it up and send it to the vote when it’s ready.',
         '#/idea/' || v.id
  from public.group_members gm where gm.group_id = v.group_id and gm.player_id = p_player and gm.user_id is not null;
  return p_player;
end $$;
revoke all on function public.hand_over_idea(uuid, uuid) from public, anon;
grant execute on function public.hand_over_idea(uuid, uuid) to authenticated;

-- The v10.6 trip builder and votes are for group organisers (and a trip's co-organisers, 104). An idea's organiser who
-- is a plain player gets that trip's co-organiser row behind the scenes, so "Send to the vote" works for them. One
-- organiser in the app's words; 104's table is only the plumbing (Josh 19:34: co-organisers unused here).
create or replace function private.idea_organiser_can_run(p_plan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.plans; who uuid;
begin
  select * into v from public.plans where id = p_plan;
  who := coalesce(v.idea_organiser, v.organiser_id);
  if who is null then return; end if;
  if exists (select 1 from public.group_members where group_id = v.group_id and player_id = who and role = 'organiser') then return; end if;
  insert into public.plan_coorganisers (plan_id, group_id, player_id, added_by) values (v.id, v.group_id, who, who)
  on conflict (plan_id, player_id) do nothing;
exception when others then null; -- e.g. already 3 co-organisers: the group organiser can still send it
end $$;
revoke all on function private.idea_organiser_can_run(uuid) from public, anon, authenticated;

-- The group's answers to the 4 quick taps WITHOUT names, for everyone in the group (Josh 19:34: "names visible to the
-- organiser only"). The rows themselves (plan_wishes) are read by their owner and the idea's organiser.
create or replace function public.idea_wish_answers(p_plan uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('cant_dates', w.cant_dates, 'spend_band', w.spend_band, 'travel', w.travel,
           'max_drive_min', w.max_drive_min, 'golf_per_day', w.golf_per_day, 'day_prefs', w.day_prefs, 'home_by', w.home_by, 'nights', w.nights, 'wish', w.wish)
           order by w.updated_at), '[]'::jsonb)
  from public.plan_wishes w join public.plans p on p.id = w.plan_id
  where w.plan_id = p_plan and private.is_group_member(p.group_id) and public.feature_on(p.group_id, 'planner')
$$;
revoke all on function public.idea_wish_answers(uuid) from public, anon;
grant execute on function public.idea_wish_answers(uuid) to authenticated;

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
