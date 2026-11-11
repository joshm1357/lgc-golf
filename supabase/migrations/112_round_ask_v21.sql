-- 112 — "Anyone keen for a round?" v2.1 (ov43, Josh 12 Nov 2026; claude/round-ask-v2-1-rethink.md). RUNS AFTER 111.
--
-- ADDITIVE ONLY: one new table, two new link-safe lookups, and four of 111's own functions re-made with a small change
-- each (same names, same arguments). Old app versions keep working: their answers have no "maybe" squares, so they
-- count exactly as before.
--
-- In plain words:
--   * Every square is ✓ (can), ✗ (can't) or ? (not said). The phone sends ✓ and ? squares as windows; a ? one carries
--     "maybe": true. Only ✓ counts toward a tee time, a lock-in or a vote tick — ask_can and ask_best skip maybes.
--     ask_store keeps the flag (111's copy dropped keys it didn't know).
--   * The group size isn't asked any more (it's the answer). The organiser's card fires the first time a 4-ball (4 ✓)
--     can play the same time, or when replies close. plans.spots is now an optional MAX players (a cap, not a target).
--   * The Caddie box's AI (the ask-fill function) logs each use here (ask_ai_uses: which ask, a hashed "who", ok or not,
--     never any text), so it can cap at 5 a person and 60 an ask. Server only: the app can't read or write it.
--   * "Leaving from" and the course list work from the no-sign-in link too: ask_places (suburbs and towns from the
--     course library) and ask_courses_near (library courses near a point, with their location for drive times). Both
--     need the ask's link token, and give back only public course-library facts.

-- =================================================================================================== AI use log
create table if not exists public.ask_ai_uses (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  who text not null check (length(who) between 3 and 80),   -- 'u:<user id>' | 'k:<sha256 of the phone's key>' | 'd:<sha256 of a device id>'
  ok boolean not null default false,
  code text check (code is null or length(code) <= 40),
  at timestamptz not null default now()
);
create index if not exists ask_ai_uses_plan_idx on public.ask_ai_uses (plan_id, at);
alter table public.ask_ai_uses enable row level security;
revoke all on public.ask_ai_uses from anon, authenticated;

-- =================================================================================================== maybe squares
-- 111's ask_store, plus one line: a window's "maybe" flag is kept.
create or replace function private.ask_store(p_plan public.plans, p_player uuid, p_slots jsonb, p_cant boolean, p_where jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare s jsonb; v_old public.callout_answers; v_first timestamptz; v_slots jsonb := '[]'::jsonb; n int := 0;
begin
  if p_plan.status <> 'planning' then raise exception 'This one’s decided — ask whoever put it out'; end if;
  if exists (select 1 from public.plan_polls where plan_id = p_plan.id and kind = 'dates') then raise exception 'It’s gone to a vote — tick the times in the app'; end if;
  if length(coalesce(p_where::text, '')) > 2000 then raise exception 'That answer is too big'; end if;
  if not coalesce(p_cant, false) then
    if coalesce(jsonb_typeof(p_slots), '') <> 'array' then raise exception 'Tick at least one time, or say you can’t'; end if;
    if jsonb_array_length(p_slots) > 400 then raise exception 'Too many times — try “Any time”'; end if;
    for s in select value from jsonb_array_elements(p_slots) loop
      perform private.ask_check_window(nullif(s ->> 'date', '')::date, s ->> 'from', s ->> 'to');
      v_slots := v_slots || jsonb_strip_nulls(jsonb_build_object('date', s ->> 'date', 'from', s ->> 'from', 'to', s ->> 'to',
        'part', case when s ->> 'part' in ('early', 'morning', 'arvo', 'twilight') then s ->> 'part' end,
        'note', nullif(btrim(left(coalesce(s ->> 'note', ''), 120)), ''), 'nine', case when coalesce(s ->> 'nine', '') = 'true' then true end,
        'maybe', case when coalesce(s ->> 'maybe', '') = 'true' then true end));
      n := n + 1;
    end loop;
    if n = 0 then raise exception 'Tick at least one time, or say you can’t'; end if;
  end if;
  select * into v_old from public.callout_answers where plan_id = p_plan.id and player_id = p_player;
  v_first := case when coalesce(p_cant, false) then null when v_old.first_at is not null then v_old.first_at else clock_timestamp() end;
  insert into public.callout_answers (plan_id, player_id, group_id, slots, cant, "where", first_at, updated_at)
  values (p_plan.id, p_player, p_plan.group_id, case when coalesce(p_cant, false) then '[]'::jsonb else v_slots end, coalesce(p_cant, false),
          case when jsonb_typeof(p_where) = 'object' then p_where else '{}'::jsonb end, v_first, now())
  on conflict (plan_id, player_id) do update set slots = excluded.slots, cant = excluded.cant, "where" = excluded."where",
    first_at = excluded.first_at, updated_at = now();
  perform private.ask_event(p_plan.id, p_plan.group_id, p_player, 'opened');
  perform private.ask_event(p_plan.id, p_plan.group_id, p_player, 'replied');
  return n;
end $$;
revoke all on function private.ask_store(public.plans, uuid, jsonb, boolean, jsonb) from public, anon, authenticated;

-- Who can play a window (✓ only — a maybe never counts), in reply order.
create or replace function private.ask_can(p_plan uuid, p_date date, p_from text, p_to text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a.player_id order by a.first_at, a.player_id), '{}') from public.callout_answers a
  where a.plan_id = p_plan and not a.cant
    and exists (select 1 from jsonb_array_elements(a.slots) s
                where coalesce(s ->> 'maybe', '') <> 'true' and private.ask_overlaps(s, p_date, p_from, p_to))
$$;
revoke all on function private.ask_can(uuid, date, text, text) from public, anon, authenticated;

-- The best window so far (✓ answers only).
create or replace function private.ask_best(p_plan uuid, out o_date date, out o_part text, out o_from text, out o_to text, out o_n int)
language sql stable security definer set search_path = '' as $$
  select (s ->> 'date')::date, s ->> 'part', s ->> 'from', s ->> 'to',
         array_length(private.ask_can(p_plan, (s ->> 'date')::date, s ->> 'from', s ->> 'to'), 1)
  from public.callout_answers a, jsonb_array_elements(a.slots) s
  where a.plan_id = p_plan and not a.cant and coalesce(s ->> 'maybe', '') <> 'true'
  order by 5 desc nulls last, 1, 3 limit 1
$$;
revoke all on function private.ask_best(uuid) from public, anon, authenticated;

-- =================================================================================================== the 4-ball rule
-- 111's job, with the ready rule changed: the first time a 4-ball can play (max players is a cap, never a target).
create or replace function private.callout_ask_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v record; v_hit int; v_rest uuid[]; v_best record; n_nudge int := 0; n_ready int := 0; n_again int := 0;
        v_today date := (p_now at time zone 'Australia/Sydney')::date; v_mgr uuid[]; v_tt int;
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
          'Tell the Caddie when you can play — or “Can’t this round”. 10 seconds.', v.id);
        n_nudge := n_nudge + 1;
      end if;
    end if;
    -- Ready: a 4-ball can play the same time, or replies close.
    select * into v_best from private.ask_best(v.id);
    if coalesce(v_best.o_n, 0) >= 4 or p_now >= v.closes_at then
      insert into public.notify_log (key) values ('ask-ready:' || v.id) on conflict do nothing;
      get diagnostics v_hit = row_count;
      if v_hit > 0 then
        v_tt := ceil(least(coalesce(v_best.o_n, 0), coalesce(nullif(v.spots, 0), 72)) / 4.0)::int;
        perform private.callout_queue(v.group_id, v_mgr, 'callout_lockit',
          case when v_best.o_date is null then '⏰ Replies are in — nobody’s matched yet'
               else '⏰ ' || private.ask_when(v_best.o_date, v_best.o_from, v_best.o_part) || ' · ' || v_best.o_n || ' can' end,
          case when coalesce(v_best.o_n, 0) >= 4
               then 'That’s ' || case when v_tt <= 1 then 'a 4-ball' else v_tt || ' tee times' end || '. Tap to choose it, or put 2–3 to a vote.'
               else 'Replies have closed. Tap to choose, or put 2–3 to a vote.' end, v.id);
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

-- =================================================================================================== link-safe lookups
-- The ask behind a link token (any status), or null.
create or replace function private.ask_by_token(p_token text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.plans where ask_token = upper(btrim(coalesce(p_token, ''))) and callout and ask is not null
$$;
revoke all on function private.ask_by_token(text) from public, anon, authenticated;

-- "Leaving from": suburbs and towns from the course library (the same list the trip finder uses).
create or replace function public.ask_places(p_token text, p_query text)
returns table (area text, lat double precision, lng double precision, courses integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.ask_by_token(p_token) is null then raise exception 'That link isn’t working — ask whoever sent it for a new one'; end if;
  if length(btrim(coalesce(p_query, ''))) < 2 then return; end if;
  -- The trip finder's own query (trip_finder_places), which needs a sign-in; the link has none.
  return query
    with q as (select replace(replace(replace(left(btrim(p_query), 60), '\', '\\'), '%', '\%'), '_', '\_') as t)
    select l.area, avg(l.lat)::double precision, avg(l.lng)::double precision, count(*)::int
    from public.course_library l, q
    where not l.hidden and l.area is not null and l.lat is not null and l.area ilike '%' || q.t || '%'
    group by l.area
    order by bool_or(l.area ilike q.t || '%') desc, count(*) desc, l.area
    limit 8;
end $$;
revoke all on function public.ask_places(text, text) from public;
grant execute on function public.ask_places(text, text) to anon, authenticated;

-- Library courses near a point, with their location (for drive times). Public course-library facts only.
create or replace function public.ask_courses_near(p_token text, p_lat double precision, p_lng double precision, p_limit int default 12)
returns table (id uuid, name text, area text, lat double precision, lng double precision, holes integer, km numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.ask_by_token(p_token) is null then raise exception 'That link isn’t working — ask whoever sent it for a new one'; end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then return; end if;
  -- search_courses' own distance sum (it needs a sign-in; the link has none).
  return query
    select l.id, l.name, l.area, l.lat::double precision, l.lng::double precision, jsonb_array_length(l.holes),
           round((6371 * 2 * asin(sqrt(power(sin(radians(l.lat - p_lat) / 2), 2)
             + cos(radians(p_lat)) * cos(radians(l.lat)) * power(sin(radians(l.lng - p_lng) / 2), 2))))::numeric, 1)
    from public.course_library l
    where not l.hidden and l.lat is not null and l.lng is not null
    order by (l.lat - p_lat) ^ 2 + ((l.lng - p_lng) * cos(radians(p_lat))) ^ 2, l.copies desc, l.name
    limit least(greatest(coalesce(p_limit, 12), 1), 20);
end $$;
revoke all on function public.ask_courses_near(text, double precision, double precision, int) from public;
grant execute on function public.ask_courses_near(text, double precision, double precision, int) to anon, authenticated;
