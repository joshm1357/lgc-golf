-- 081: "Import anything from past trips" (22 Oct 2026). Josh: "History import should be more general, like cards,
-- scores, cups, events, commentary, etc. Should allow all."
--
-- The AI import (070, ai-helper 'import' mode) now also proposes past rounds and scorecards, past cups, awards and
-- moments, stories and anything else. The organiser ticks what's right; the app writes it through the two functions
-- here (plus the paths 070 already uses). Additive only: one new table, one new column, two new functions, and the
-- birdie-post trigger taught to stay quiet while history is being written.
--
--   * history_notes — the trip's history that has no table of its own: stories and write-ups, commentary and
--     banter, dinner awards, fines, moments ("Dave's hole-in-one on the 7th"), closest-to-the-pin and longest-drive
--     winners, past cups (the sides, matches and final score in `data`), the totals from a scorecard that the app's
--     rounds can't hold (gross / net, Ambrose teams), and "other" so nothing is lost. On a trip (or the group's
--     history in general), optionally a round. Everyone in the group reads them; organisers change or remove them;
--     they're only ever added through import_history_notes (organisers). import_key makes a second run add nothing.
--   * rounds.import_key — a past round brought in from history ("trip | course | date | name"), so the same
--     scorecard never makes a second round. Null for every round made in the app.
--   * import_rounds(p_rows) — past rounds onto a PAST trip only (never one that's on now or coming up, and never one
--     with a live round), locked, with their players, per-hole strokes (only when the course's pars are known) or the
--     card's Stableford points (quick_results, the same as "Card pts" in Admin). The course: one of the group's, the
--     group's course with that name, or a new one from the card's pars and stroke index — or, with no pars, a plain
--     placeholder (par 4s) that only ever holds totals.
--   * import_history_notes(p_rows) — the notes above.
--   * scores_autopost — unchanged, except it posts nothing while import_rounds is writing (no "Dave made birdie"
--     on today's Feed for a round from 2018).
-- Past cups do NOT go into cup_sides / cup_matches: those hold the group's one current Cup (two sides a group, and
-- players.cup_side), so a past cup there would change the live one. They're kept as a history note instead, and the
-- winning side goes on the honour board through import_honours (the app does that part).

-- ------------------------------------------------------------------ history_notes
create table if not exists public.history_notes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete cascade,
  round_id uuid references public.rounds(id) on delete set null,
  kind text not null check (kind in ('story', 'commentary', 'report', 'award', 'fine', 'moment', 'side_comp', 'cup', 'scorecard', 'other')),
  title text not null check (length(btrim(title)) between 2 and 120),
  body text check (body is null or length(body) <= 4000),
  year int check (year is null or year between 1950 and 2100),
  happened_on date,
  people text check (people is null or length(people) <= 300),
  player_ids uuid[] not null default '{}' check (cardinality(player_ids) <= 40),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and length(data::text) <= 20000),
  source text not null default 'import' check (source in ('import', 'manual')),
  import_key text not null check (length(import_key) <= 400),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (group_id, import_key)
);
create index if not exists history_notes_trip_idx on public.history_notes (trip_id);
create index if not exists history_notes_round_idx on public.history_notes (round_id);
create index if not exists history_notes_created_by_idx on public.history_notes (created_by);

alter table public.history_notes enable row level security;
create policy "members read" on public.history_notes for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.history_notes for update
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "organisers remove" on public.history_notes for delete
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.history_notes as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke all on public.history_notes from anon;
grant select, update, delete on public.history_notes to authenticated;   -- added only through import_history_notes
create trigger aa_fill_group_id before insert or update on public.history_notes
  for each row execute function private.fill_group_id('trips:trip_id', 'rounds:round_id');

-- ------------------------------------------------------------------ Past rounds
alter table public.rounds add column if not exists import_key text check (import_key is null or length(import_key) <= 400);
create unique index if not exists rounds_import_key_idx on public.rounds (group_id, import_key) where import_key is not null;

-- Words the same way in the app (lib/historyimport.js normKey) and here: lower case, one space, trimmed.
create or replace function private.norm_key(t text) returns text language sql immutable set search_path = '' as $$
  select lower(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')));
$$;
revoke all on function private.norm_key(text) from public, anon;
grant execute on function private.norm_key(text) to authenticated, service_role;

-- Birdie posts: the same as 029, but not while history is being brought in.
create or replace function public.scores_autopost()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare
  v_par int; v_trip uuid; v_name text; v_word text; v_diff int;
begin
  if coalesce(current_setting('app.history_import', true), '') = 'on' then return new; end if;
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
revoke execute on function public.scores_autopost() from public, anon, authenticated;

-- p_rows: [{ trip_id, course_id?, course: { name, holes: [{ n, par, si }] | null }, name, play_date, format,
--            players: [{ player_id, handicap, strokes: [int|null ×≤18] | null, points }], summary }] (at most 60).
-- Returns { added, already, players_skipped, courses_made, round_ids }.
create or replace function public.import_rounds(p_rows jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); r jsonb; p jsonb; t record; v_course uuid; v_cname text; v_holes jsonb;
        v_real boolean; v_n int; v_key text; v_date date; v_fmt text; v_round uuid; v_rname text; v_hcp numeric;
        v_pid uuid; v_strokes jsonb; v_i int; v_s int; v_wrote boolean; v_pts int; v_summary text;
        v_added int := 0; v_already int := 0; v_skipped int := 0; v_courses int := 0; v_ids uuid[] := '{}';
        v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can add history'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then raise exception 'Up to 60 rounds at a time'; end if;
  perform pg_advisory_xact_lock(hashtext('import_rounds:' || v_g::text));
  perform set_config('app.history_import', 'on', true);
  for r in select value from jsonb_array_elements(p_rows) loop
    -- The trip: this group's, and over (not on now or coming up, and no round live).
    select id, name, status, start_date, end_date into t from public.trips
     where group_id = v_g and id::text = coalesce(r ->> 'trip_id', '');
    if t.id is null then raise exception 'A round on the list has no trip in this group'; end if;
    if (t.status = 'active' and coalesce(t.end_date, t.start_date, v_today) >= v_today)
       or exists (select 1 from public.rounds x where x.trip_id = t.id and x.status = 'live') then
      raise exception '% is on now or coming up — add its rounds from the trip itself', t.name;
    end if;
    -- The course.
    v_course := null; v_real := true;
    select id, name, holes into v_course, v_cname, v_holes from public.courses
     where group_id = v_g and id::text = coalesce(r ->> 'course_id', '');
    if v_course is null then
      v_cname := left(btrim(regexp_replace(coalesce(r #>> '{course,name}', ''), '\s+', ' ', 'g')), 60);
      if char_length(v_cname) < 2 then raise exception 'Each round needs its course'; end if;
      select id, holes into v_course, v_holes from public.courses
       where group_id = v_g and private.norm_key(name) = private.norm_key(v_cname) order by created_at limit 1;
    end if;
    if v_course is null then
      v_holes := r #> '{course,holes}';
      v_n := case when jsonb_typeof(v_holes) = 'array' then jsonb_array_length(v_holes) else 0 end;
      if v_n in (9, 18)
         and not exists (select 1 from jsonb_array_elements(v_holes) h
                         where jsonb_typeof(h -> 'par') <> 'number' or (h ->> 'par')::numeric not in (3, 4, 5, 6)
                            or jsonb_typeof(h -> 'si') <> 'number' or (h ->> 'si')::numeric not between 1 and v_n
                            or jsonb_typeof(h -> 'n') <> 'number' or (h ->> 'n')::numeric not between 1 and v_n)
         and (select count(distinct (h ->> 'si')) = v_n and count(distinct (h ->> 'n')) = v_n from jsonb_array_elements(v_holes) h) then
        select jsonb_agg(jsonb_build_object('n', (h ->> 'n')::int, 'par', (h ->> 'par')::int, 'si', (h ->> 'si')::int) order by (h ->> 'n')::int)
          into v_holes from jsonb_array_elements(v_holes) h;
      else
        -- No scorecard: a placeholder that only ever holds totals (its pars aren't real, so no strokes go on it).
        select jsonb_agg(jsonb_build_object('n', i, 'par', 4, 'si', i) order by i) into v_holes from generate_series(1, 18) i;
        v_real := false;
      end if;
      insert into public.courses (group_id, name, holes) values (v_g, v_cname, v_holes) returning id into v_course;
      v_courses := v_courses + 1;
    end if;
    v_n := jsonb_array_length(coalesce(v_holes, '[]'::jsonb));
    -- The round, once: the same trip, course, date and name is "already in".
    v_date := case when coalesce(r ->> 'play_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'play_date')::date end;
    if v_date is not null and (v_date > v_today or v_date < date '1950-01-01') then v_date := null; end if;
    v_rname := nullif(left(btrim(regexp_replace(coalesce(r ->> 'name', ''), '\s+', ' ', 'g')), 60), '');
    v_key := left(t.id::text || '|' || private.norm_key(v_cname) || '|' || coalesce(v_date::text, '') || '|' || private.norm_key(v_rname), 400);
    if exists (select 1 from public.rounds where group_id = v_g and import_key = v_key) then
      v_already := v_already + 1;
      continue;
    end if;
    v_fmt := coalesce(r ->> 'format', 'stableford');
    if v_fmt not in ('stableford', 'stroke', 'ambrose', 'fourball') then v_fmt := 'stableford'; end if;
    insert into public.rounds (group_id, trip_id, course_id, name, play_date, format, status, import_key)
    values (v_g, t.id, v_course, coalesce(v_rname, v_cname), v_date, v_fmt, 'locked', v_key)
    returning id into v_round;
    v_ids := v_ids || v_round;
    -- Its players: only this group's. Strokes only on a real scorecard; else the card's Stableford points.
    for p in select value from jsonb_array_elements(coalesce(r -> 'players', '[]'::jsonb)) limit 40 loop
      select id, handicap into v_pid, v_hcp from public.players where group_id = v_g and id::text = coalesce(p ->> 'player_id', '');
      if v_pid is null then v_skipped := v_skipped + 1; continue; end if;
      if jsonb_typeof(p -> 'handicap') = 'number' and (p ->> 'handicap')::numeric between -10 and 54 then v_hcp := (p ->> 'handicap')::numeric; end if;
      insert into public.round_players (round_id, player_id, playing_handicap, group_id)
      values (v_round, v_pid, round(coalesce(v_hcp, 18)), v_g) on conflict do nothing;
      v_wrote := false;
      v_strokes := p -> 'strokes';
      if v_real and jsonb_typeof(v_strokes) = 'array' then
        for v_i in 1 .. least(jsonb_array_length(v_strokes), v_n, 18) loop
          continue when jsonb_typeof(v_strokes -> (v_i - 1)) <> 'number';
          v_s := round((v_strokes ->> (v_i - 1))::numeric);
          continue when v_s not between 1 and 20;
          insert into public.scores (round_id, subject_id, subject_type, hole, strokes, group_id)
          values (v_round, v_pid, 'player', v_i, v_s, v_g) on conflict do nothing;
          v_wrote := true;
        end loop;
      end if;
      if not v_wrote and v_fmt = 'stableford' and jsonb_typeof(p -> 'points') = 'number' then
        v_pts := round((p ->> 'points')::numeric);
        if v_pts between 0 and 120 then
          insert into public.quick_results (round_id, player_id, points, group_id) values (v_round, v_pid, v_pts, v_g) on conflict do nothing;
        end if;
      end if;
    end loop;
    -- What the card says that a round can't hold (gross / net, teams, names not in the group): a note on the round.
    v_summary := nullif(left(btrim(coalesce(r ->> 'summary', '')), 4000), '');
    if v_summary is not null then
      insert into public.history_notes (group_id, trip_id, round_id, kind, title, body, year, happened_on, import_key)
      values (v_g, t.id, v_round, 'scorecard', left('Scorecard — ' || coalesce(v_rname, v_cname), 120), v_summary,
              extract(year from coalesce(v_date, t.start_date))::int, v_date, left('scorecard|' || v_key, 400))
      on conflict (group_id, import_key) do nothing;
    end if;
    v_added := v_added + 1;
  end loop;
  perform set_config('app.history_import', '', true);
  return json_build_object('added', v_added, 'already', v_already, 'players_skipped', v_skipped, 'courses_made', v_courses, 'round_ids', to_json(v_ids));
end $$;
revoke all on function public.import_rounds(jsonb) from public, anon;
grant execute on function public.import_rounds(jsonb) to authenticated;

-- p_rows: [{ kind, title, body, trip_id, round_id, year, happened_on, people, player_ids, data }] (at most 300).
-- The key (kind | trip | title | year | the body's first 60 letters) is worked out here, so a second run adds nothing.
-- Returns { added, already }.
create or replace function public.import_history_notes(p_rows jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); r jsonb; v_kind text; v_title text; v_body text; v_trip uuid; v_round uuid;
        v_year int; v_on date; v_key text; v_data jsonb; v_added int := 0; v_already int := 0;
        v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can add history'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 300 then raise exception 'Up to 300 at a time'; end if;
  perform pg_advisory_xact_lock(hashtext('import_history_notes:' || v_g::text));
  for r in select value from jsonb_array_elements(p_rows) loop
    v_kind := coalesce(r ->> 'kind', 'other');
    if v_kind not in ('story', 'commentary', 'report', 'award', 'fine', 'moment', 'side_comp', 'cup', 'scorecard', 'other') then v_kind := 'other'; end if;
    v_title := left(btrim(regexp_replace(coalesce(r ->> 'title', ''), '\s+', ' ', 'g')), 120);
    if char_length(v_title) < 2 then raise exception 'Each one needs a title'; end if;
    v_body := nullif(left(btrim(coalesce(r ->> 'body', '')), 4000), '');
    select id into v_trip from public.trips where group_id = v_g and id::text = coalesce(r ->> 'trip_id', '');
    select id into v_round from public.rounds where group_id = v_g and id::text = coalesce(r ->> 'round_id', '');
    v_year := case when coalesce(r ->> 'year', '') ~ '^\d{4}$' and (r ->> 'year')::int between 1950 and extract(year from v_today)::int + 1 then (r ->> 'year')::int end;
    v_on := case when coalesce(r ->> 'happened_on', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'happened_on')::date end;
    if v_on is not null and (v_on > v_today or v_on < date '1950-01-01') then v_on := null; end if;
    if v_year is null and v_on is not null then v_year := extract(year from v_on)::int; end if;
    v_data := case when jsonb_typeof(r -> 'data') = 'object' and length((r -> 'data')::text) <= 20000 then r -> 'data' else '{}'::jsonb end;
    v_key := left(v_kind || '|' || coalesce(v_trip::text, '') || '|' || private.norm_key(v_title) || '|' || coalesce(v_year::text, '')
                  || '|' || left(private.norm_key(v_body), 60), 400);
    insert into public.history_notes (group_id, trip_id, round_id, kind, title, body, year, happened_on, people, player_ids, data, import_key)
    values (v_g, v_trip, v_round, v_kind, v_title, v_body, v_year, v_on,
            nullif(left(btrim(coalesce(r ->> 'people', '')), 300), ''),
            coalesce((select (array_agg(distinct p.id))[1:40] from public.players p
                      where p.group_id = v_g and p.id::text in (select jsonb_array_elements_text(case when jsonb_typeof(r -> 'player_ids') = 'array' then r -> 'player_ids' else '[]'::jsonb end))), '{}'),
            v_data, v_key)
    on conflict (group_id, import_key) do nothing;
    if found then v_added := v_added + 1; else v_already := v_already + 1; end if;
  end loop;
  return json_build_object('added', v_added, 'already', v_already);
end $$;
revoke all on function public.import_history_notes(jsonb) from public, anon;
grant execute on function public.import_history_notes(jsonb) to authenticated;

-- The same-group link checks (024) cover the new table's links to trips and rounds.
select private.add_same_group_checks();
