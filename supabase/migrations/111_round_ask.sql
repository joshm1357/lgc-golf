-- 111 — "Anyone keen for a round?" v2: ask the group WHEN they can play, match, lock, book, go again (ov43, Josh
-- 11–12 Nov 2026; claude/round-callout-v2-design.md). RUNS AFTER 109 (110 is taken by the open v10.7.2 branch; the
-- two don't touch each other). Applied to staging only.
--
-- ADDITIVE ONLY. Three new columns on plans, three new tables, new functions, one new scheduled job. The ONLY existing
-- thing replaced is private.callout_tick (103's job): same body, plus one line so it skips a v2 ask until it has a
-- vote. Old app versions keep working: a v2 ask looks to them like a call-out with "Time TBC" and no options.
--
-- In plain words:
--   * A v2 ask is a 103 call-out (plans.callout = true) with plans.ask set: the days, parts of the day, how far ahead
--     (a range, specific dates, or "until we play") and any exact times — lib/ask.js works out the squares from it.
--     Made by put_round_ask (never a plain insert — 103's guard).
--   * Each player answers with WINDOWS (callout_answer): date + from–to, already narrowed by their notes on the phone
--     (lib/ask.js narrow()), or "Can't this round". first_at is when they first said they can — reply order decides
--     spots, exactly like 103. Going "can't" and back puts you at the back.
--   * Their usual week (player_usual_weeks) is saved when they send and prefills next time. Only they can read it; the
--     organiser sees non-repliers' usual week as "probably" (callout_probably), never counted as can.
--   * Choose (callout_ask_choose): the chosen window becomes a one-option vote, everyone who can is ticked ✓ in reply
--     order, then 103's callout_lock does the rest (spots, reserves, the round, every buzz, the booker job). ONE
--     lock-in path for v1 and v2.
--   * Put 2–3 to a vote (callout_ask_vote): the windows become a 103 vote, pre-ticked the same way. From there it IS a
--     v1 call-out: same reply buttons, same lock-in.
--   * Full (callout_move): the booker says the course is full → the round moves to the next-best window the phone picked;
--     whoever can make the new time is in (reply order), anyone who can't is told. Only before anyone has scored.
--   * Booked (callout_booked): the booking job is done and the players are told.
--   * The test plan's funnel: callout_events (asked → opened → replied → locked → booked → played, plus vote / moved /
--     easy_yes / easy_no). "Was that easy?" also lands in beta_feedback, the inbox Caddie reads.
--   * The job (every 10 minutes, 'lgc-round-asks'): halfway to closing, ONE nudge to whoever hasn't replied; when a
--     window fills a group, or replies close, ONE card to the organiser ("Sat 21 arvo · 5 can — choose or vote"); the day
--     after it's played, "Go again in 2 weeks?". Buzzes reuse 103's kinds, so the notify function needs no change.
--   * Feature switches (all under 'planner', on by default): ask_usual_week, ask_where, ask_notes, ask_whos_in.

-- =================================================================================================== columns
alter table public.plans add column if not exists ask jsonb check (ask is null or jsonb_typeof(ask) = 'object');
alter table public.plans add column if not exists ask_full text[] not null default '{}';
alter table public.plans add column if not exists booked_at timestamptz;

insert into public.feature_catalogue (key, default_on, parent, tier) values
  ('ask_usual_week', true, 'planner', 'free'),
  ('ask_where', true, 'planner', 'free'),
  ('ask_notes', true, 'planner', 'free'),
  ('ask_whos_in', true, 'planner', 'free')
on conflict (key) do nothing;

-- =================================================================================================== answers
create table if not exists public.callout_answers (
  plan_id uuid not null references public.plans(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  slots jsonb not null default '[]'::jsonb check (jsonb_typeof(slots) = 'array'),
  cant boolean not null default false,
  "where" jsonb not null default '{}'::jsonb check (jsonb_typeof("where") = 'object'),
  first_at timestamptz,            -- when they first said they can (null while "can't")
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, player_id)
);
create index if not exists callout_answers_group_idx on public.callout_answers (group_id);
alter table public.callout_answers enable row level security;
drop policy if exists "members read" on public.callout_answers;
create policy "members read" on public.callout_answers for select to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[]));
drop policy if exists "same group only" on public.callout_answers;
create policy "same group only" on public.callout_answers as restrictive for all to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[])) with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke insert, update, delete on public.callout_answers from anon, authenticated;

-- =================================================================================================== usual week
-- usual: { pattern: { 'sat|arvo': true, … }, notes: { 'sat|arvo': 'only after 1' } }   where: lib/ask.js cleanWhere
create table if not exists public.player_usual_weeks (
  player_id uuid primary key references public.players(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  usual jsonb not null default '{}'::jsonb check (jsonb_typeof(usual) = 'object'),
  "where" jsonb not null default '{}'::jsonb check (jsonb_typeof("where") = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.player_usual_weeks enable row level security;
-- Only you read yours (the organiser gets non-repliers' days through callout_probably, without the notes).
drop policy if exists "me only" on public.player_usual_weeks;
create policy "me only" on public.player_usual_weeks for select to authenticated
  using (player_id = private.my_player_id(group_id));
revoke insert, update, delete on public.player_usual_weeks from anon, authenticated;

-- =================================================================================================== events (funnel)
create table if not exists public.callout_events (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  kind text not null check (kind in ('asked', 'opened', 'replied', 'locked', 'booked', 'played', 'vote', 'moved', 'easy_yes', 'easy_no')),
  at timestamptz not null default now()
);
create index if not exists callout_events_plan_idx on public.callout_events (plan_id);
create index if not exists callout_events_group_idx on public.callout_events (group_id, at);
alter table public.callout_events enable row level security;
drop policy if exists "members read" on public.callout_events;
create policy "members read" on public.callout_events for select to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[]));
drop policy if exists "same group only" on public.callout_events;
create policy "same group only" on public.callout_events as restrictive for all to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[])) with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke insert, update, delete on public.callout_events from anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'callout_answers') then
      alter publication supabase_realtime add table public.callout_answers;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'callout_events') then
      alter publication supabase_realtime add table public.callout_events;
    end if;
  end if;
end $$;

-- =================================================================================================== helpers
create or replace function private.ask_event(p_plan uuid, p_group uuid, p_player uuid, p_kind text, p_once boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_once and exists (select 1 from public.callout_events e where e.plan_id = p_plan and e.kind = p_kind
                        and e.player_id is not distinct from p_player) then return; end if;
  insert into public.callout_events (plan_id, group_id, player_id, kind) values (p_plan, p_group, p_player, p_kind);
end $$;

-- The people asked (ids), 103's rule.
create or replace function private.ask_asked(p_plan public.plans) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case when p_plan.invite_all then private.callout_everyone(p_plan.group_id)
    else coalesce((select array_agg(i.player_id) from public.plan_invites i where i.plan_id = p_plan.id), '{}') end
$$;

-- A window is { date 'YYYY-MM-DD', from 'HH:MM', to 'HH:MM' }. Same date and the windows touch.
create or replace function private.ask_overlaps(p_slot jsonb, p_date date, p_from text, p_to text) returns boolean
language sql immutable set search_path = '' as $$
  select (p_slot ->> 'date')::date = p_date and (p_slot ->> 'from') <= p_to and p_from <= (p_slot ->> 'to')
$$;

-- Who can play a window, in reply order (first_at).
create or replace function private.ask_can(p_plan uuid, p_date date, p_from text, p_to text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a.player_id order by a.first_at, a.player_id), '{}') from public.callout_answers a
  where a.plan_id = p_plan and not a.cant
    and exists (select 1 from jsonb_array_elements(a.slots) s where private.ask_overlaps(s, p_date, p_from, p_to))
$$;

-- "Sat 21 arvo" / "Sat 21 1:20pm"
create or replace function private.ask_when(p_date date, p_from text, p_part text) returns text
language sql immutable set search_path = '' as $$
  select to_char(p_date, 'Dy FMDD') || ' ' || coalesce(p_part, private.callout_clock(p_from))
$$;

create or replace function private.ask_check_window(p_date date, p_from text, p_to text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_date is null then raise exception 'Pick the day'; end if;
  if coalesce(p_from, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_to, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_from > p_to then
    raise exception 'A time window looks like 11:30–15:00';
  end if;
end $$;

-- The 103 option part for an ask part ('early' sits in the morning).
create or replace function private.ask_option_part(p_part text) returns text
language sql immutable set search_path = '' as $$
  select case when p_part in ('morning', 'arvo', 'twilight') then p_part when p_part = 'early' then 'morning' else null end
$$;

-- Make a dates vote for these windows and tick ✓ for everyone who can, in reply order (the vote trigger stamps
-- first_yes_at with clock_timestamp(), so inserting in reply order keeps reply order). → the option ids, in order.
create or replace function private.ask_make_vote(p_plan public.plans, p_cells jsonb, p_me uuid) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare v_poll uuid; c jsonb; v_opt uuid; v_ids uuid[] := '{}'; v_date date; v_from text; v_to text; v_part text; v_tee text; p uuid;
begin
  insert into public.plan_polls (plan_id, group_id, kind, question, closes_on, created_by)
  values (p_plan.id, p_plan.group_id, 'dates', 'When can you play?', (coalesce(p_plan.closes_at, now()) at time zone 'Australia/Sydney')::date, p_me)
  returning id into v_poll;
  for c in select value from jsonb_array_elements(p_cells) loop
    v_date := (c ->> 'date')::date; v_from := c ->> 'from'; v_to := c ->> 'to'; v_part := nullif(c ->> 'part', '');
    perform private.ask_check_window(v_date, v_from, v_to);
    v_tee := case when v_part is null or v_from = v_to then v_from end;
    insert into public.plan_options (poll_id, group_id, label, start_date, end_date, part, tee_time, created_by)
    values (v_poll, p_plan.group_id, private.ask_when(v_date, v_from, v_part) || case when v_part is not null then ' (' || private.callout_clock(v_from) || '–' || private.callout_clock(v_to) || ')' else '' end,
            v_date, v_date, private.ask_option_part(v_part), v_tee, p_me)
    returning id into v_opt;
    v_ids := v_ids || v_opt;
    foreach p in array private.ask_can(p_plan.id, v_date, v_from, v_to) loop
      insert into public.plan_votes (option_id, poll_id, player_id, response, group_id) values (v_opt, v_poll, p, 'yes', p_plan.group_id)
      on conflict (option_id, player_id) do nothing;
    end loop;
  end loop;
  return v_ids;
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.ask_event(uuid, uuid, uuid, text, boolean)', 'private.ask_asked(public.plans)',
    'private.ask_overlaps(jsonb, date, text, text)', 'private.ask_can(uuid, date, text, text)', 'private.ask_when(date, text, text)',
    'private.ask_check_window(date, text, text)', 'private.ask_option_part(text)', 'private.ask_make_vote(public.plans, jsonb, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- =================================================================================================== ask
-- p_ask: lib/ask.js cleanAsk() — { days: [...], parts: [...], range: { kind: 'next', days } | { kind: 'dates', dates } |
-- { kind: 'open' }, times: [{ date, at }] }. The rest as put_round_out. → the plan id.
create or replace function public.put_round_ask(p_name text, p_ask jsonb, p_spots int default null, p_invite uuid[] default null,
  p_closes_at timestamptz default null, p_note text default null, p_course uuid default null, p_library uuid default null,
  p_course_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); me uuid; v_id uuid; v_asked uuid[]; v_name text; v_course_name text; v_kind text; p uuid;
        v_closes timestamptz;
begin
  perform private.require_saved(v_g);
  if v_g is null or not private.is_group_member(v_g) then raise exception 'Join the group first'; end if;
  if private.is_group_guest(v_g) then raise exception 'Guests can say when they can play, but can’t ask the group'; end if;
  if not public.feature_on(v_g, 'planner') then raise exception 'The Trips planner is switched off for this group'; end if;
  me := private.my_player_id(v_g);
  if me is null then raise exception 'Pick your name first'; end if;
  if jsonb_typeof(p_ask) <> 'object' or jsonb_typeof(p_ask -> 'range') <> 'object' then raise exception 'Say how far ahead'; end if;
  v_kind := p_ask -> 'range' ->> 'kind';
  if v_kind not in ('next', 'dates', 'open') then raise exception 'Say how far ahead'; end if;
  if v_kind = 'dates' and coalesce(jsonb_array_length(p_ask -> 'range' -> 'dates'), 0) = 0 then raise exception 'Pick at least one date'; end if;
  if length(p_ask::text) > 4000 then raise exception 'That ask is too big — fewer dates'; end if;
  if p_spots is not null and p_spots not between 2 and 72 then raise exception 'Spots: from 2 to 72, or no cap'; end if;
  if p_course is not null then
    select name into v_course_name from public.courses where id = p_course and group_id = v_g;
    if v_course_name is null then raise exception 'That course isn’t one of the group’s'; end if;
  elsif p_library is not null then
    select name into v_course_name from public.course_library where id = p_library and not hidden;
    if v_course_name is null then raise exception 'That course isn’t in the library'; end if;
  else
    v_course_name := nullif(btrim(left(coalesce(p_course_name, ''), 80)), '');
  end if;
  if p_invite is not null then
    select coalesce(array_agg(distinct pl.id), '{}') into v_asked from public.players pl
    where pl.group_id = v_g and pl.id = any (p_invite) and pl.approved is not false;
    if not (me = any (v_asked)) then v_asked := v_asked || me; end if;
    if cardinality(v_asked) < 2 then raise exception 'Ask at least one other person'; end if;
  end if;
  v_closes := coalesce(p_closes_at, now() + interval '2 days');
  if v_closes <= now() then raise exception 'Replies need to close in the future'; end if;
  v_name := coalesce(nullif(btrim(left(coalesce(p_name, ''), 60)), ''), 'Anyone keen for a round?');

  perform set_config('lgc.callout', 'on', true);
  insert into public.plans (group_id, kind, callout, name, status, proposed, created_by, location_name, course_id, library_course_id,
    spots, closes_at, brief, invite_all, ask)
  values (v_g, 'round', true, v_name, 'planning', false, me, v_course_name, p_course, case when p_course is null then p_library end,
    p_spots, v_closes, nullif(btrim(left(coalesce(p_note, ''), 500)), ''), p_invite is null, p_ask)
  returning id into v_id;
  perform set_config('lgc.callout', 'off', true);
  if p_invite is not null then
    insert into public.plan_invites (plan_id, player_id, group_id, invited_by) select v_id, x, v_g, me from unnest(v_asked) x on conflict do nothing;
  end if;
  foreach p in array coalesce(v_asked, private.callout_everyone(v_g)) loop
    perform private.ask_event(v_id, v_g, p, 'asked');
  end loop;
  perform private.callout_queue(v_g, coalesce(v_asked, private.callout_everyone(v_g)), 'callout_new',
    '⛳ ' || private.callout_first(me) || ': anyone keen for a round?',
    'Tap the times you can play' || coalesce(' · ' || v_course_name, '') || '. 10 seconds.', v_id, me);
  if p_invite is null and public.feature_on(v_g, 'feed') then
    insert into public.posts (group_id, kind, player_id, body, link)
    values (v_g, 'user', me, '⛳ Anyone keen for a round? Tap the times you can play' || coalesce(' — ' || v_course_name, '') || '.',
      '/plan/' || v_id::text || '?c=1');
  end if;
  return v_id;
end $$;
revoke all on function public.put_round_ask(text, jsonb, int, uuid[], timestamptz, text, uuid, uuid, text) from public, anon;
grant execute on function public.put_round_ask(text, jsonb, int, uuid[], timestamptz, text, uuid, uuid, text) to authenticated;

-- =================================================================================================== answer
-- p_slots: [{ date, from, to, part?, note?, nine? }] (≤ 400). p_cant: "Can't this round". p_where: lib/ask.js cleanWhere.
-- p_usual: { pattern, notes } to save as your usual week (null = leave it). Anyone asked, saved account or not (103).
create or replace function public.callout_answer(p_plan uuid, p_slots jsonb, p_cant boolean default false, p_where jsonb default null,
  p_usual jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; s jsonb; v_old public.callout_answers; v_first timestamptz; v_slots jsonb := '[]'::jsonb; n int := 0;
begin
  select * into v from public.plans where id = p_plan;
  if v.id is null or not private.is_group_member(v.group_id) or not v.callout or v.ask is null then raise exception 'Round not found'; end if;
  if v.status <> 'planning' then raise exception 'This one’s decided — ask whoever put it out'; end if;
  me := private.my_player_id(v.group_id);
  if me is null then raise exception 'Pick your name first'; end if;
  if not private.callout_asked(v, me) then
    raise exception 'This round is just for the people asked — ask % to add you', coalesce(private.callout_first(v.created_by), 'whoever put it out');
  end if;
  if length(coalesce(p_where::text, '')) > 2000 or length(coalesce(p_usual::text, '')) > 6000 then raise exception 'That answer is too big'; end if;
  if not coalesce(p_cant, false) then
    if jsonb_typeof(p_slots) <> 'array' then raise exception 'Tick at least one time, or say you can’t'; end if;
    if jsonb_array_length(p_slots) > 400 then raise exception 'Too many times — try “Any time”'; end if;
    for s in select value from jsonb_array_elements(p_slots) loop
      perform private.ask_check_window(nullif(s ->> 'date', '')::date, s ->> 'from', s ->> 'to');
      v_slots := v_slots || jsonb_strip_nulls(jsonb_build_object('date', s ->> 'date', 'from', s ->> 'from', 'to', s ->> 'to',
        'part', case when s ->> 'part' in ('early', 'morning', 'arvo', 'twilight') then s ->> 'part' end,
        'note', nullif(btrim(left(coalesce(s ->> 'note', ''), 120)), ''), 'nine', case when (s ->> 'nine')::boolean then true end));
      n := n + 1;
    end loop;
    if n = 0 then raise exception 'Tick at least one time, or say you can’t'; end if;
  end if;
  select * into v_old from public.callout_answers where plan_id = p_plan and player_id = me;
  v_first := case when coalesce(p_cant, false) then null when v_old.first_at is not null then v_old.first_at else clock_timestamp() end;
  insert into public.callout_answers (plan_id, player_id, group_id, slots, cant, "where", first_at, updated_at)
  values (p_plan, me, v.group_id, case when coalesce(p_cant, false) then '[]'::jsonb else v_slots end, coalesce(p_cant, false),
          case when jsonb_typeof(p_where) = 'object' then p_where else '{}'::jsonb end, v_first, now())
  on conflict (plan_id, player_id) do update set slots = excluded.slots, cant = excluded.cant, "where" = excluded."where",
    first_at = excluded.first_at, updated_at = now();
  if jsonb_typeof(p_usual) = 'object' and public.feature_on(v.group_id, 'ask_usual_week') then
    insert into public.player_usual_weeks (player_id, group_id, usual, "where", updated_at)
    values (me, v.group_id, p_usual, case when jsonb_typeof(p_where) = 'object' then p_where else '{}'::jsonb end, now())
    on conflict (player_id) do update set usual = excluded.usual,
      "where" = case when jsonb_typeof(p_where) = 'object' then excluded."where" else public.player_usual_weeks."where" end, updated_at = now();
  end if;
  perform private.ask_event(p_plan, v.group_id, me, 'opened');
  perform private.ask_event(p_plan, v.group_id, me, 'replied');
  return jsonb_build_object('slots', n, 'cant', coalesce(p_cant, false));
end $$;
revoke all on function public.callout_answer(uuid, jsonb, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.callout_answer(uuid, jsonb, boolean, jsonb, jsonb) to authenticated;

-- Opened (the funnel's second step), once per person.
create or replace function public.callout_seen(p_plan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid;
begin
  select * into v from public.plans where id = p_plan;
  if v.id is null or not private.is_group_member(v.group_id) or v.ask is null then return; end if;
  me := private.my_player_id(v.group_id);
  if me is not null then perform private.ask_event(p_plan, v.group_id, me, 'opened'); end if;
end $$;
revoke all on function public.callout_seen(uuid) from public, anon;
grant execute on function public.callout_seen(uuid) to authenticated;

-- Non-repliers' usual week (days only, no notes), for "probably" — marked unconfirmed on the screen.
create or replace function public.callout_probably(p_plan uuid) returns table (player_id uuid, pattern jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v public.plans;
begin
  select * into v from public.plans where id = p_plan;
  if v.id is null or not private.is_group_member(v.group_id) or v.ask is null or not public.feature_on(v.group_id, 'ask_usual_week') then return; end if;
  return query
    select u.player_id, coalesce(u.usual -> 'pattern', '{}'::jsonb) from public.player_usual_weeks u
    where u.group_id = v.group_id and u.player_id = any (private.ask_asked(v))
      and not exists (select 1 from public.callout_answers a where a.plan_id = p_plan and a.player_id = u.player_id);
end $$;
revoke all on function public.callout_probably(uuid) from public, anon;
grant execute on function public.callout_probably(uuid) to authenticated;

-- =================================================================================================== choose / vote
-- Choose one window and lock it in through 103's callout_lock. p_tee_time inside the window (default: its start).
create or replace function public.callout_ask_choose(p_plan uuid, p_date date, p_from text, p_to text, p_part text default null,
  p_tee_time text default null, p_course uuid default null, p_library uuid default null, p_booker uuid default null,
  p_format text default 'stableford')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; v_opts uuid[]; r jsonb;
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) or not v.callout or v.ask is null then raise exception 'Round not found'; end if;
  perform private.require_saved(v.group_id);
  if not private.callout_can_manage(v) then raise exception 'Only whoever put it out (or an organiser) can choose'; end if;
  if v.status <> 'planning' then raise exception 'This one isn’t open any more'; end if;
  if exists (select 1 from public.plan_polls where plan_id = p_plan and kind = 'dates') then raise exception 'It’s gone to a vote — lock it in from the vote'; end if;
  perform private.ask_check_window(p_date, p_from, p_to);
  if nullif(p_tee_time, '') is not null and (p_tee_time < p_from or p_tee_time > p_to) then raise exception 'Pick a tee time inside %–%', private.callout_clock(p_from), private.callout_clock(p_to); end if;
  me := private.my_player_id(v.group_id);
  v_opts := private.ask_make_vote(v, jsonb_build_array(jsonb_build_object('date', p_date, 'from', p_from, 'to', p_to, 'part', p_part)), me);
  update public.plans set ask = ask || jsonb_build_object('chosen', jsonb_build_object('date', p_date, 'from', p_from, 'to', p_to, 'part', p_part))
  where id = p_plan;
  r := public.callout_lock(p_plan, v_opts[1], coalesce(nullif(p_tee_time, ''), p_from), p_course, p_library, p_booker, p_format);
  perform private.ask_event(p_plan, v.group_id, me, 'locked');
  return r;
end $$;
revoke all on function public.callout_ask_choose(uuid, date, text, text, text, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.callout_ask_choose(uuid, date, text, text, text, text, uuid, uuid, uuid, text) to authenticated;

-- Put 2–3 windows to a vote (103's vote from here on). p_cells: [{ date, from, to, part }].
create or replace function public.callout_ask_vote(p_plan uuid, p_cells jsonb, p_closes_at timestamptz default null)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; v_opts uuid[]; v_rest uuid[];
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) or not v.callout or v.ask is null then raise exception 'Round not found'; end if;
  perform private.require_saved(v.group_id);
  if not private.callout_can_manage(v) then raise exception 'Only whoever put it out (or an organiser) can start a vote'; end if;
  if v.status <> 'planning' then raise exception 'This one isn’t open any more'; end if;
  if exists (select 1 from public.plan_polls where plan_id = p_plan and kind = 'dates') then raise exception 'There’s already a vote'; end if;
  if jsonb_typeof(p_cells) <> 'array' or jsonb_array_length(p_cells) not between 2 and 3 then raise exception 'Put 2 or 3 times to the vote'; end if;
  me := private.my_player_id(v.group_id);
  update public.plans set closes_at = greatest(coalesce(p_closes_at, now() + interval '24 hours'), now() + interval '1 hour') where id = p_plan
  returning * into v;
  v_opts := private.ask_make_vote(v, p_cells, me);
  -- 103's "replies closed → lock it in" nudge fires again for the vote.
  delete from public.notify_log where key = 'callout-close:' || p_plan;
  perform private.ask_event(p_plan, v.group_id, me, 'vote');
  select coalesce(array_agg(x), '{}') into v_rest from unnest(private.ask_asked(v)) x;
  perform private.callout_queue(v.group_id, v_rest, 'callout_new', '🗳️ Down to ' || jsonb_array_length(p_cells) || ' — ' || v.name,
    'Tick the ones you can make (you’re already ticked where you said you could).', p_plan, me);
  return v_opts;
end $$;
revoke all on function public.callout_ask_vote(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.callout_ask_vote(uuid, jsonb, timestamptz) to authenticated;

-- =================================================================================================== full → move
-- The course is full at that time: move the round to another window (the phone picks the next best). Whoever put it
-- out, an organiser, or whoever's booking. Only before anyone has scored. → { in, reserve, out }
create or replace function public.callout_move(p_plan uuid, p_date date, p_from text, p_to text, p_part text default null,
  p_tee_time text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; v_round public.rounds; v_can uuid[]; v_was uuid[]; v_in uuid[]; v_res uuid[]; v_out uuid[]; v_key text;
        v_tee text; v_when text; i int; p uuid;
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) or not v.callout or v.ask is null then raise exception 'Round not found'; end if;
  me := private.my_player_id(v.group_id);
  if not (private.callout_can_manage(v) or me = v.booker_id) then raise exception 'Only whoever put it out, an organiser or whoever’s booking can move it'; end if;
  if v.status <> 'confirmed' or v.round_id is null then raise exception 'Lock it in first'; end if;
  select * into v_round from public.rounds where id = v.round_id;
  if v_round.status <> 'setup' or exists (select 1 from public.scores s where s.round_id = v.round_id) then raise exception 'The round has started — it can’t move now'; end if;
  perform private.ask_check_window(p_date, p_from, p_to);
  if p_date < (now() at time zone 'Australia/Sydney')::date then raise exception 'That day has gone — pick another'; end if;
  v_tee := coalesce(nullif(p_tee_time, ''), p_from);
  if v_tee < p_from or v_tee > p_to then raise exception 'Pick a tee time inside the window'; end if;
  -- Remember the full window.
  if v.ask ? 'chosen' then
    v_key := (v.ask -> 'chosen' ->> 'date') || '|' || coalesce(v.ask -> 'chosen' ->> 'part', '@' || (v.ask -> 'chosen' ->> 'from'));
    update public.plans set ask_full = array_append(ask_full, v_key) where id = p_plan and not (v_key = any (ask_full));
  end if;
  select coalesce(array_agg(o.player_id order by o.place), '{}') into v_was from private.callout_order(p_plan) o;
  v_can := private.ask_can(p_plan, p_date, p_from, p_to);
  -- The new In list: whoever can, in reply order; everyone else who was in is out.
  perform set_config('lgc.callout_lock', 'on', true);
  insert into public.plan_rsvps (plan_id, player_id, status, first_in_at, group_id, updated_at)
  select p_plan, a.player_id, 'in', a.first_at, v.group_id, now() from public.callout_answers a where a.plan_id = p_plan and a.player_id = any (v_can)
  on conflict (plan_id, player_id) do update set status = 'in', first_in_at = excluded.first_in_at, updated_at = now();
  update public.plan_rsvps set status = 'out', first_in_at = null, updated_at = now() where plan_id = p_plan and status = 'in' and not (player_id = any (v_can));
  update public.plans set start_date = p_date, end_date = p_date, tee_time = v_tee,
    ask = ask || jsonb_build_object('chosen', jsonb_build_object('date', p_date, 'from', p_from, 'to', p_to, 'part', p_part))
  where id = p_plan;
  update public.rounds set play_date = p_date where id = v.round_id;
  if v.trip_id is not null then update public.trips set start_date = p_date, end_date = p_date where id = v.trip_id; end if;
  perform set_config('lgc.callout_lock', 'off', true);
  perform private.callout_sync(p_plan, null, true);
  select coalesce(array_agg(o.player_id order by o.place) filter (where o.has_spot), '{}'),
         coalesce(array_agg(o.player_id order by o.place) filter (where not o.has_spot), '{}') into v_in, v_res from private.callout_order(p_plan) o;
  select coalesce(array_agg(x), '{}') into v_out from unnest(v_was) x where not (x = any (v_can));
  v_when := private.callout_when(p_date, v_tee, null);
  for i in 1 .. cardinality(v_in) loop
    continue when v_in[i] = me;
    perform private.callout_queue(v.group_id, array[v_in[i]], 'callout_in', '📅 Moved — you’re in: ' || v_when || ', ' || coalesce(v.location_name, 'the course'),
      'The first time was full. Can’t make this one? Tap to say so.', p_plan);
  end loop;
  for i in 1 .. cardinality(v_res) loop
    continue when v_res[i] = me;
    perform private.callout_queue(v.group_id, array[v_res[i]], 'callout_reserve', '📅 Moved — you’re reserve #' || i || ': ' || v_when, 'We’ll tell you if a spot opens.', p_plan);
  end loop;
  foreach p in array v_out loop
    continue when p = me;
    perform private.callout_queue(v.group_id, array[p], 'callout_full', '📅 Moved to ' || v_when || ' — you said you couldn’t make that',
      'The first time was full. Can make it after all? Tap to say you’re in.', p_plan);
  end loop;
  perform private.ask_event(p_plan, v.group_id, me, 'moved', false);
  return jsonb_build_object('in', to_jsonb(v_in), 'reserve', to_jsonb(v_res), 'out', to_jsonb(v_out));
end $$;
revoke all on function public.callout_move(uuid, date, text, text, text, text) from public, anon;
grant execute on function public.callout_move(uuid, date, text, text, text, text) to authenticated;

-- =================================================================================================== booked, easy
create or replace function public.callout_booked(p_plan uuid, p_tee_time text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; v_ids uuid[];
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) or not v.callout then raise exception 'Round not found'; end if;
  me := private.my_player_id(v.group_id);
  if not (private.callout_can_manage(v) or me = v.booker_id) then raise exception 'Only whoever’s booking (or whoever put it out) can say it’s booked'; end if;
  if v.status <> 'confirmed' then raise exception 'Lock it in first'; end if;
  if nullif(p_tee_time, '') is not null then
    if p_tee_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'A tee time looks like 13:20'; end if;
    update public.plans set tee_time = p_tee_time where id = p_plan;
    v.tee_time := p_tee_time;
  end if;
  update public.plans set booked_at = coalesce(booked_at, now()) where id = p_plan;
  update public.plan_items set done = true where plan_id = p_plan and kind = 'job' and title like 'Book the tee time%';
  select coalesce(array_agg(o.player_id), '{}') into v_ids from private.callout_order(p_plan) o where o.has_spot;
  perform private.callout_queue(v.group_id, v_ids, 'callout_locked', '✅ Booked: ' || private.callout_when(v.start_date, v.tee_time) || ', ' || coalesce(v.location_name, 'the course'),
    v.name || '. See you there.', p_plan, me);
  perform private.ask_event(p_plan, v.group_id, me, 'booked');
end $$;
revoke all on function public.callout_booked(uuid, text) from public, anon;
grant execute on function public.callout_booked(uuid, text) to authenticated;

-- "I'll book it": anyone asked takes the booking job when nobody has it.
create or replace function public.callout_take_booking(p_plan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; v_when text;
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) or not v.callout then raise exception 'Round not found'; end if;
  me := private.my_player_id(v.group_id);
  if me is null or not private.callout_asked(v, me) then raise exception 'Only the people asked can take the booking'; end if;
  if v.status <> 'confirmed' then raise exception 'Lock it in first'; end if;
  if v.booker_id is not null and v.booker_id <> me then raise exception '% is already booking it', private.callout_first(v.booker_id); end if;
  update public.plans set booker_id = me where id = p_plan;
  if not exists (select 1 from public.plan_items where plan_id = p_plan and kind = 'job' and title like 'Book the tee time%') then
    v_when := private.callout_when(v.start_date, v.tee_time);
    insert into public.plan_items (plan_id, group_id, kind, title, owner_id, due, created_by)
    values (p_plan, v.group_id, 'job', left('Book the tee time — ' || coalesce(v.location_name, 'the course') || ', ' || v_when, 200), me,
            least(v.start_date, greatest((now() at time zone 'Australia/Sydney')::date + 1, v.start_date - 2)), me);
  else
    update public.plan_items set owner_id = me where plan_id = p_plan and kind = 'job' and title like 'Book the tee time%';
  end if;
end $$;
revoke all on function public.callout_take_booking(uuid) from public, anon;
grant execute on function public.callout_take_booking(uuid) to authenticated;

-- "Was that easy to organise?" 👍 / 👎 and a line → the funnel and Caddie's inbox (beta_feedback).
create or replace function public.callout_easy(p_plan uuid, p_easy boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; v_note text := nullif(btrim(left(coalesce(p_note, ''), 300)), '');
begin
  select * into v from public.plans where id = p_plan;
  if v.id is null or not private.is_group_member(v.group_id) or not v.callout then raise exception 'Round not found'; end if;
  me := private.my_player_id(v.group_id);
  if exists (select 1 from public.callout_events e where e.plan_id = p_plan and e.player_id = me and e.kind in ('easy_yes', 'easy_no')) then return; end if;
  perform private.ask_event(p_plan, v.group_id, me, case when p_easy then 'easy_yes' else 'easy_no' end);
  insert into public.beta_feedback (group_id, user_id, player_id, kind, message, path, version)
  values (v.group_id, auth.uid(), me, case when p_easy then 'like' else 'problem' end,
    '[Round ask] Was that easy to organise? ' || case when p_easy then '👍' else '👎' end || coalesce(' — ' || v_note, ''),
    '/plan/' || p_plan::text, 'ov43');
end $$;
revoke all on function public.callout_easy(uuid, boolean, text) from public, anon;
grant execute on function public.callout_easy(uuid, boolean, text) to authenticated;

-- Played: the round went live.
create or replace function private.ask_round_played() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.plans;
begin
  select * into v from public.plans where round_id = new.id and callout limit 1;
  if v.id is not null then perform private.ask_event(v.id, v.group_id, null, 'played'); end if;
  return null;
end $$;
revoke all on function private.ask_round_played() from public, anon, authenticated;
drop trigger if exists zz_ask_round_played on public.rounds;
create trigger zz_ask_round_played after update of status on public.rounds
  for each row when (new.status in ('live', 'locked') and old.status = 'setup') execute function private.ask_round_played();

-- =================================================================================================== the job
-- 103's tick, unchanged except: a v2 ask without a vote yet is left to callout_ask_tick (its own words).
create or replace function private.callout_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v record; v_local timestamp := p_now at time zone 'Australia/Sydney'; v_n int := 0; v_d int := 0; v_top record; v_body text;
        v_ids uuid[]; x uuid; v_key text; v_hit int;
begin
  -- Replies closed, not locked in yet.
  for v in select * from public.plans p where p.callout and p.status = 'planning' and p.closes_at is not null and p.closes_at <= p_now
             and (p.ask is null or exists (select 1 from public.plan_polls po where po.plan_id = p.id and po.kind = 'dates')) loop
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

-- The best window so far (answers only): { date, part, from, to, n }.
create or replace function private.ask_best(p_plan uuid, out o_date date, out o_part text, out o_from text, out o_to text, out o_n int)
language sql stable security definer set search_path = '' as $$
  select (s ->> 'date')::date, s ->> 'part', s ->> 'from', s ->> 'to',
         array_length(private.ask_can(p_plan, (s ->> 'date')::date, s ->> 'from', s ->> 'to'), 1)
  from public.callout_answers a, jsonb_array_elements(a.slots) s
  where a.plan_id = p_plan and not a.cant
  order by 5 desc nulls last, 1, 3 limit 1
$$;
revoke all on function private.ask_best(uuid) from public, anon, authenticated;

-- v2 asks: halfway → one nudge to non-repliers; a window fills a group, or replies close → one card to the organiser;
-- the day after it's played → "Go again in 2 weeks?".
create or replace function private.callout_ask_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v record; v_hit int; v_rest uuid[]; v_best record; v_need int; n_nudge int := 0; n_ready int := 0; n_again int := 0;
        v_today date := (p_now at time zone 'Australia/Sydney')::date; v_mgr uuid[];
begin
  for v in select * from public.plans p where p.callout and p.ask is not null and p.status = 'planning' and p.closes_at is not null
             and not exists (select 1 from public.plan_polls po where po.plan_id = p.id and po.kind = 'dates') loop
    v_mgr := array_remove(array[v.created_by, case when v.organiser_id is distinct from v.created_by then v.organiser_id end], null);
    -- Halfway: one nudge.
    if p_now >= v.created_at + (v.closes_at - v.created_at) / 2 and p_now < v.closes_at then
      insert into public.notify_log (key) values ('ask-nudge:' || v.id) on conflict do nothing;
      get diagnostics v_hit = row_count;
      if v_hit > 0 then
        select coalesce(array_agg(x), '{}') into v_rest from unnest(private.ask_asked(v)) x
        where x is distinct from v.created_by and not exists (select 1 from public.callout_answers a where a.plan_id = v.id and a.player_id = x);
        perform private.callout_queue(v.group_id, v_rest, 'callout_new', '⛳ Still keen? ' || private.callout_first(v.created_by) || '’s sorting a round',
          'Tap the times you can play — or “Can’t this round”. 10 seconds.', v.id);
        n_nudge := n_nudge + 1;
      end if;
    end if;
    -- Ready: a group fills, or replies close.
    select * into v_best from private.ask_best(v.id);
    v_need := case when v.spots >= 2 then v.spots else 4 end;
    if coalesce(v_best.o_n, 0) >= v_need or p_now >= v.closes_at then
      insert into public.notify_log (key) values ('ask-ready:' || v.id) on conflict do nothing;
      get diagnostics v_hit = row_count;
      if v_hit > 0 then
        perform private.callout_queue(v.group_id, v_mgr, 'callout_lockit',
          case when v_best.o_date is null then '⏰ Replies are in — nobody’s matched yet' else '⏰ ' || private.ask_when(v_best.o_date, v_best.o_from, v_best.o_part) || ' · ' || v_best.o_n || ' can' end,
          case when coalesce(v_best.o_n, 0) >= v_need then 'That’s a group. Tap to choose it, or put 2–3 to a vote.' else 'Replies have closed. Tap to choose, or put 2–3 to a vote.' end, v.id);
        n_ready := n_ready + 1;
      end if;
    end if;
  end loop;
  -- Go again: the day after a v2 round was played.
  for v in select p.* from public.plans p join public.rounds r on r.id = p.round_id
           where p.callout and p.ask is not null and p.status in ('confirmed', 'done') and p.start_date = v_today - 1 and r.status <> 'setup' loop
    insert into public.notify_log (key) values ('ask-again:' || v.id) on conflict do nothing;
    get diagnostics v_hit = row_count;
    continue when v_hit = 0;
    perform private.callout_queue(v.group_id, array[v.created_by], 'callout_lockit', '⛳ Go again in 2 weeks?',
      'Same ask as last time, one tap. And: was that easy to organise?', v.id);
    n_again := n_again + 1;
  end loop;
  return jsonb_build_object('nudged', n_nudge, 'ready', n_ready, 'again', n_again);
end $$;
revoke all on function private.callout_ask_tick(timestamptz) from public, anon, authenticated;

create or replace function private.callout_ask_job() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_base text; v_secret text;
begin
  v := private.callout_ask_tick(now());
  if exists (select 1 from public.notify_queue where kind like 'callout\_%' and sent_at is null and created_at > now() - interval '30 minutes') then
    select substring(command from 'https://[a-z0-9]+\.supabase\.co') into v_base from cron.job where jobname = 'lgc-daily-reminders';
    select value into v_secret from public.server_secrets where name = 'cron_secret';
    if v_base is not null and v_secret is not null then
      perform net.http_post(url := v_base || '/functions/v1/notify',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret), body := '{"type":"callout"}'::jsonb);
    end if;
  end if;
  return v;
end $$;
revoke all on function private.callout_ask_job() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'lgc-round-asks') then perform cron.unschedule('lgc-round-asks'); end if;
end $$;
select cron.schedule('lgc-round-asks', '5-59/10 * * * *', 'select private.callout_ask_job()');
