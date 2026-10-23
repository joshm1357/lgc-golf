-- 100 — Automatic awards and fines: claim from a Feed post, a proposed winner in the morning, confirm or dispute, the
-- reward lands; awards worked out from the scores; points towards a cup (ov31, Josh 23 Oct 2026).
--
-- RUN ORDER: 100 must run AFTER 099. 099 (W5) widens score_adjustments.kind to allow 'award' (and 'rule_breach');
-- strokes won or copped here go in as score_adjustments rows with kind 'award'. On a database without 099 the insert
-- is refused by the old check, the error is caught, and the run's strokes stay "waiting" (nothing else breaks).
--
-- ADDITIVE ONLY: new nullable columns, three new tables, new functions and triggers, one scheduled job, and one function
-- patched in place (private.dispute_fields gains three entries — whatever 099 added stays). Nothing is dropped or
-- renamed. Older app versions keep working: a nightly award's per-night copy is an ordinary dinner award to them
-- ("Latest out · Fri night", with its claims as nominations), and the Feed posts are ordinary auto posts.
--
-- In plain words:
--   * When it runs. An award or fine runs once a trip (as before), each day, or each night of the trip (runs). Anything
--     with a time proof and "latest / earliest wins" runs each night unless the group says otherwise. A night's claim
--     window is 9pm–6am Sydney (window_from / window_to, changeable); a day's is 6am–9pm.
--   * Claiming from a post. A photo posted to the Feed during a claim window can be claimed in one tap: "Claim Latest
--     out?" — for yourself or for a mate ("Hamish is still out 🍺"). The claim's time is the post's SERVER time
--     (posts.server_at, set by the database on insert, never by the phone). Guests can't claim. The claim is an
--     ordinary nomination on that night's copy of the award, so 093's proof checks apply (photo, time).
--   * Proposed winner in the morning. At 7am Sydney (propose_time), or an hour before that day's first tee if that's
--     earlier, the server ranks the night's claims by "best" and posts ONCE to the Feed, notifying the group:
--     "🌙 Proposed — Latest out, last night: Hamish 2:47am 📷 (+2), Bo 1:15am 📷 (+1) · −1 stroke. Confirm or dispute by the first tee (8am)."
--     No claims: no post. Running the job twice posts once (the run's status moves on under a row lock).
--   * Confirm or not. An organiser taps Confirm (or picks a different claim, or "No winner"); otherwise it confirms
--     itself at that day's first tee (noon when there's no round that day) if nobody has disputed. Anyone (not guests)
--     can dispute in one tap: a Tribunal case (raise_dispute, 082) about the proposed winner; the run waits for the
--     verdict. Upheld → back to the organiser to pick another claim or "No winner". Thrown out → confirmed.
--     A dispute can also target one person's points line (cup_points): that line waits; the rest go through.
--   * The reward lands. Strokes: a score_adjustments row (kind 'award', rule_id set, label "Latest out (−1)") on the
--     winner's next round that day, or the next round of the trip (when the round goes live, if it isn't set up yet).
--     Money / drink / title / bragging: in the trip's awards tally (award_runs.worth + the copy's winner_id) — the
--     results page reads it (src/lib/autoawards.js resultLines / components/AutoAwards.jsx AutoAwardResults).
--     Fines work the same way (positive strokes, money).
--   * Worked out from the scores. An award can be "from the scores" (from_scores = a side-comp library 'auto' key,
--     e.g. birdies_gross). When a round is finished the app works out the standings with src/lib/sidecomplib.js (all
--     scoring maths stays in the app's library) and hands them to award_propose_from_scores; the server proposes,
--     posts and notifies the same way, once per award per round. Confirm / dispute as above.
--   * Points towards a cup. An award or fine can name the cup (comp_id → public.comps, a trip's comp) and how it
--     scores (points, a rule value like any other, disputable):
--       {"mode":"winner","points":3}
--       {"mode":"per_unit","per":1,"size":1,"from":"00:00","to":"05:00","round":"whole"|"part","max":5}
--           every confirmed claim scores per unit beyond "from" (a time for latest/earliest — hours; a number for
--           biggest/smallest), not past "to", whole or part units, at most "max" points.
--       {"mode":"placings","places":[3,2,1]}
--     Fines take points off. Points are written to cup_points as PENDING when proposed and count once confirmed.
--
-- Security: RLS on every new table (members read; same group only; the server's functions are the only writers).
-- Feature switches: dinner_awards (everything here), feed (posts), notifications (buzzes), tribunal + rule_challenges
-- (disputes, as 082).

-- ============================================================================================ settings on an award
do $$
declare t text;
begin
  foreach t in array array['rules', 'dinner_awards'] loop
    execute format('alter table public.%I add column if not exists runs text check (runs is null or runs in (''trip'', ''day'', ''night''))', t);
    execute format('alter table public.%I add column if not exists window_from text check (window_from is null or window_from ~ ''^([01][0-9]|2[0-3]):[0-5][0-9]$'')', t);
    execute format('alter table public.%I add column if not exists window_to text check (window_to is null or window_to ~ ''^([01][0-9]|2[0-3]):[0-5][0-9]$'')', t);
    execute format('alter table public.%I add column if not exists propose_time text check (propose_time is null or propose_time ~ ''^([01][0-9]|2[0-3]):[0-5][0-9]$'')', t);
    execute format('alter table public.%I add column if not exists from_scores text check (from_scores is null or from_scores ~ ''^[a-z0-9_]{2,30}$'')', t);
    execute format('alter table public.%I add column if not exists points jsonb check (points is null or (jsonb_typeof(points) = ''object'' and octet_length(points::text) <= 600))', t);
    -- The cup (a trip's comp) this award or fine counts towards; null = no cup.
    execute format('alter table public.%I add column if not exists comp_id uuid references public.comps(id) on delete set null', t);
    execute format('create index if not exists %I on public.%I (comp_id)', t || '_comp_idx', t);
  end loop;
end $$;
-- A night's (or day's, or round's) own copy of an award holds that window's claims (nominations are one per person
-- per award, so each window needs its own award row). parent_id: the trip's award it's a copy of.
alter table public.dinner_awards add column if not exists parent_id uuid references public.dinner_awards(id) on delete cascade;
create index if not exists dinner_awards_parent_idx on public.dinner_awards (parent_id);

-- A post's time as the server saw it (claims use this; the phone can't set it).
alter table public.posts add column if not exists server_at timestamptz;
create or replace function private.posts_server_at() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.server_at := now(); else new.server_at := old.server_at; end if;
  return new;
end $$;
revoke all on function private.posts_server_at() from public, anon, authenticated;
create or replace trigger aa_posts_server_at before insert or update on public.posts
  for each row execute function private.posts_server_at();

-- ============================================================================================ time helpers (Sydney)
-- A Sydney date + "HH:MM" → the moment.
create or replace function private.aa_at(p_date date, p_hhmm text) returns timestamptz
language sql immutable set search_path = '' as $$
  select ((p_date + p_hhmm::time)::timestamp) at time zone 'Australia/Sydney'
$$;
-- "2:47am", "12pm".
create or replace function private.aa_clock(p_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select lower(replace(to_char(p_at at time zone 'Australia/Sydney', 'FMHH12:MIam'), ':00', ''))
$$;
create or replace function private.aa_hhmm_words(p_hhmm text) returns text
language sql immutable set search_path = '' as $$
  select lower(replace(to_char(('2000-01-01'::date + p_hhmm::time)::timestamp, 'FMHH12:MIam'), ':00', ''))
$$;
-- A window for a date: night = from that evening to the next morning when "to" is earlier than "from".
create or replace function private.aa_window(p_from text, p_to text, p_date date, out opens timestamptz, out closes timestamptz)
language sql immutable set search_path = '' as $$
  select private.aa_at(p_date, p_from),
         private.aa_at(p_date + case when p_to::time <= p_from::time then 1 else 0 end, p_to)
$$;
-- Which window (by its date) a moment falls in, or null.
create or replace function private.aa_window_date(p_from text, p_to text, p_at timestamptz) returns date
language plpgsql immutable set search_path = '' as $$
declare d date := (p_at at time zone 'Australia/Sydney')::date; w record;
begin
  for i in reverse 1..0 loop  -- yesterday's window first (a night runs past midnight), then today's
    select * into w from private.aa_window(p_from, p_to, d - i);
    if p_at >= w.opens and p_at < w.closes then return d - i; end if;
  end loop;
  return null;
end $$;
-- The first tee time of a trip's rounds on a date (playing groups and Cup matches), or null.
create or replace function private.aa_first_tee(p_trip uuid, p_date date) returns time
language sql stable security definer set search_path = '' as $$
  select min(x) from (
    select tg.tee_time::time x from public.tee_groups tg join public.rounds r on r.id = tg.round_id
    where r.trip_id = p_trip and r.play_date = p_date and tg.tee_time ~ '^\d{2}:\d{2}$'
    union all
    select cm.tee_time::time from public.cup_matches cm join public.rounds r on r.id = cm.round_id
    where r.trip_id = p_trip and r.play_date = p_date and cm.tee_time ~ '^\d{2}:\d{2}$'
  ) t
$$;
-- When a window's proposal goes up and when it confirms itself. The morning after the window's date: propose at
-- propose_time (7am) or an hour before the first tee if that's earlier (never before the window closes); confirm at
-- the first tee, or noon with no round that day. Same as proposeTimes() in src/lib/autoawards.js.
create or replace function private.aa_times(p_trip uuid, p_date date, p_propose text, p_closes timestamptz,
  out propose_at timestamptz, out confirm_by timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare m date := p_date + 1; tee time := private.aa_first_tee(p_trip, p_date + 1);
begin
  propose_at := private.aa_at(m, coalesce(p_propose, '07:00'));
  if tee is not null then propose_at := least(propose_at, private.aa_at(m, to_char(tee, 'HH24:MI')) - interval '1 hour'); end if;
  propose_at := greatest(propose_at, coalesce(p_closes, propose_at));
  confirm_by := case when tee is not null then private.aa_at(m, to_char(tee, 'HH24:MI')) else private.aa_at(m, '12:00') end;
  confirm_by := greatest(confirm_by, propose_at + interval '15 minutes');
end $$;
revoke all on function private.aa_first_tee(uuid, date) from public, anon, authenticated;
revoke all on function private.aa_times(uuid, date, text, timestamptz) from public, anon, authenticated;

-- ============================================================================================ an award's terms
-- 093's terms plus when it runs, its window, from the scores, points and cup. A copy reads its parent's.
-- runs (effective): 'round' for from-the-scores; else as set; else 'night' for a time proof decided by latest/earliest;
-- else 'trip' (once a trip — no automation, as before).
create or replace function private.auto_terms(p_award uuid)
returns table (source_id uuid, group_id uuid, trip_id uuid, kind text, title text, reward_type text, reward_amount numeric,
  reward_note text, proof text, best text, number_unit text, rule_id uuid, runs text, window_from text, window_to text,
  propose_time text, from_scores text, points jsonb, comp_id uuid)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare a public.dinner_awards; r public.rules; s record;
begin
  select * into a from public.dinner_awards where id = p_award;
  if a.id is null then return; end if;
  if a.parent_id is not null then select * into a from public.dinner_awards where id = a.parent_id; end if;
  select * into r from public.rules where id = a.rule_id and group_id = a.group_id;
  select * into s from private.award_terms(a.id);
  source_id := a.id; group_id := a.group_id; trip_id := a.trip_id; kind := a.kind; title := a.title;
  reward_type := s.reward_type; reward_amount := s.reward_amount; reward_note := s.reward_note; proof := coalesce(s.proof, 'none');
  best := s.best; number_unit := s.number_unit; rule_id := s.rule_id;
  from_scores := case when r.id is null then a.from_scores else r.from_scores end;
  points := coalesce(case when r.id is null then a.points else r.points end, null);
  runs := case when from_scores is not null then 'round'
               else coalesce(case when r.id is null then a.runs else r.runs end,
                             case when best in ('latest', 'earliest') and proof in ('time', 'photo_time') then 'night' else 'trip' end) end;
  window_from := coalesce(case when r.id is null then a.window_from else r.window_from end, case when runs = 'day' then '06:00' else '21:00' end);
  window_to := coalesce(case when r.id is null then a.window_to else r.window_to end, case when runs = 'day' then '21:00' else '06:00' end);
  propose_time := coalesce(case when r.id is null then a.propose_time else r.propose_time end, '07:00');
  -- The cup: the trip's own setting first, else the rule's when that comp is on this trip.
  comp_id := coalesce(a.comp_id, (select c.id from public.comps c where c.id = r.comp_id and c.trip_id = a.trip_id and not c.retired));
  return next;
end $$;
revoke all on function private.auto_terms(uuid) from public, anon, authenticated;

-- ============================================================================================ points
-- Check a points setting. Raises with a plain reason. Same as checkPoints() in src/lib/autoawards.js.
create or replace function private.aa_points_check(p jsonb, p_best text, p_from_scores text) returns void
language plpgsql immutable set search_path = '' as $$
declare m text := p->>'mode'; n numeric; e jsonb;
begin
  if p is null then return; end if;
  if m = 'winner' then
    begin n := (p->>'points')::numeric; exception when others then n := null; end;
    if n is null or n <= 0 or n > 100 then raise exception 'Points to the winner: a number from 0.5 to 100'; end if;
  elsif m = 'placings' then
    if jsonb_typeof(p->'places') <> 'array' or jsonb_array_length(p->'places') not between 1 and 10 then raise exception 'Placings: 1 to 10 places'; end if;
    for e in select * from jsonb_array_elements(p->'places') loop
      if jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric < 0 or (e #>> '{}')::numeric > 100 then raise exception 'Placings: each from 0 to 100 points'; end if;
    end loop;
  elsif m = 'per_unit' then
    if p_from_scores is not null then raise exception 'Per-unit points are for claims, not scores'; end if;
    if p_best is null then raise exception 'Per-unit points need “latest / earliest” or “biggest / smallest” wins'; end if;
    begin n := coalesce((p->>'per')::numeric, 1); exception when others then n := null; end;
    if n is null or n <= 0 or n > 100 then raise exception 'Points per unit: from 0.1 to 100'; end if;
    begin n := coalesce((p->>'size')::numeric, 1); exception when others then n := null; end;
    if n is null or n <= 0 or n > 1000 then raise exception 'Unit size: more than 0'; end if;
    if p_best in ('latest', 'earliest') then
      if coalesce(p->>'from', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Say when the points start (a time)'; end if;
      if p ? 'to' and p->>'to' is not null and p->>'to' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'The cut-off is a time'; end if;
    else
      begin n := (p->>'from')::numeric; exception when others then n := null; end;
      if n is null then raise exception 'Say where the points start (a number)'; end if;
      if p ? 'to' and p->>'to' is not null then
        begin n := (p->>'to')::numeric; exception when others then raise exception 'The cut-off is a number'; end;
      end if;
    end if;
    if coalesce(p->>'round', 'whole') not in ('whole', 'part') then raise exception 'Whole or part units'; end if;
    if p ? 'max' and p->>'max' is not null then
      begin n := (p->>'max')::numeric; exception when others then n := null; end;
      if n is null or n <= 0 or n > 1000 then raise exception 'The most points: more than 0'; end if;
    end if;
  else
    raise exception 'Points: winner, per unit or placings';
  end if;
end $$;

-- For a time threshold on a window: a time earlier than the window's start is the next morning (night windows).
create or replace function private.aa_unit_at(p_hhmm text, p_wfrom text, p_runs text, p_date date) returns timestamptz
language sql immutable set search_path = '' as $$
  select private.aa_at(p_date + case when p_runs = 'night' and p_hhmm::time < p_wfrom::time then 1 else 0 end, p_hhmm)
$$;

-- One claim's points (unsigned; a fine's are taken off by the caller). Same as linePoints() in src/lib/autoawards.js.
--   winner: the winner's points, else 0. placings: by rank (ties share a place). per_unit: units beyond "from", not past
--   "to", whole (rounded down) or part (2 decimals), × per, at most max.
create or replace function private.aa_line_points(p jsonb, p_best text, p_runs text, p_wfrom text, p_date date,
  p_at timestamptz, p_num numeric, p_rank int, p_winner boolean) returns numeric
language plpgsql immutable set search_path = '' as $$
declare m text := p->>'mode'; v numeric; units numeric; pts numeric; lim timestamptz; base timestamptz;
begin
  if p is null then return 0; end if;
  if m = 'winner' then return case when p_winner then (p->>'points')::numeric else 0 end; end if;
  if m = 'placings' then
    if p_rank is null or p_rank < 1 or p_rank > jsonb_array_length(p->'places') then return 0; end if;
    return (p->'places'->>(p_rank - 1))::numeric;
  end if;
  if m <> 'per_unit' then return 0; end if;
  if p_best in ('latest', 'earliest') then
    if p_at is null then return 0; end if;
    base := private.aa_unit_at(p->>'from', p_wfrom, p_runs, p_date);
    lim := case when nullif(p->>'to', '') is not null then private.aa_unit_at(p->>'to', p_wfrom, p_runs, p_date) end;
    v := case when p_best = 'latest' then extract(epoch from (case when lim is null then p_at else least(p_at, lim) end) - base)
              else extract(epoch from base - (case when lim is null then p_at else greatest(p_at, lim) end)) end / 3600.0;
  else
    if p_num is null then return 0; end if;
    v := case when p_best = 'highest' then (case when nullif(p->>'to', '') is null then p_num else least(p_num, (p->>'to')::numeric) end) - (p->>'from')::numeric
              else (p->>'from')::numeric - (case when nullif(p->>'to', '') is null then p_num else greatest(p_num, (p->>'to')::numeric) end) end;
  end if;
  units := v / coalesce((p->>'size')::numeric, 1);
  if units <= 0 then return 0; end if;
  units := case when coalesce(p->>'round', 'whole') = 'part' then round(units, 2) else floor(units) end;
  pts := round(units * coalesce((p->>'per')::numeric, 1), 2);
  if nullif(p->>'max', '') is not null then pts := least(pts, (p->>'max')::numeric); end if;
  return trim_scale(pts);
end $$;

-- "1 pt an hour after 12am, to 5am" — the points setting in words. Same as pointsWords() in src/lib/autoawards.js.
create or replace function private.aa_points_words(p jsonb, p_kind text, p_best text, p_unit text) returns text
language plpgsql immutable set search_path = '' as $$
declare m text := p->>'mode'; sign text := case when p_kind = 'fine' then '−' else '' end; per numeric; size numeric; w text;
  num text := coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'unit');
begin
  if p is null then return null; end if;
  if m = 'winner' then
    return sign || trim_scale((p->>'points')::numeric) || ' pt' || case when (p->>'points')::numeric = 1 then '' else 's' end
      || case when p_kind = 'fine' then ' to whoever cops it' else ' to the winner' end;
  elsif m = 'placings' then
    return sign || (select string_agg(trim_scale((x #>> '{}')::numeric)::text, '-' order by o) from jsonb_array_elements(p->'places') with ordinality e(x, o)) || ' pts';
  elsif m = 'per_unit' then
    per := coalesce((p->>'per')::numeric, 1); size := coalesce((p->>'size')::numeric, 1);
    w := sign || trim_scale(per) || ' pt' || case when per = 1 then '' else 's' end;
    if p_best in ('latest', 'earliest') then
      w := w || case when size = 1 then ' an hour' else ' per ' || trim_scale(size) || ' hours' end
        || case when p_best = 'latest' then ' after ' else ' before ' end || private.aa_hhmm_words(p->>'from')
        || coalesce(case when p_best = 'latest' then ', to ' else ', from ' end || private.aa_hhmm_words(nullif(p->>'to', '')), '');
    else
      w := w || ' per ' || case when size = 1 then '' else trim_scale(size) || ' ' end || num
        || case when p_best = 'highest' then ' over ' else ' under ' end || trim_scale((p->>'from')::numeric)
        || coalesce(case when p_best = 'highest' then ', up to ' else ', down to ' end || trim_scale(nullif(p->>'to', '')::numeric), '');
    end if;
    if coalesce(p->>'round', 'whole') = 'part' then w := w || ' (part ' || case when p_best in ('latest', 'earliest') then 'hours' else 'units' end || ' count)'; end if;
    if nullif(p->>'max', '') is not null then w := w || ', at most ' || trim_scale((p->>'max')::numeric); end if;
    return w;
  end if;
  return null;
end $$;
revoke all on function private.aa_points_check(jsonb, text, text) from public, anon, authenticated;
revoke all on function private.aa_line_points(jsonb, text, text, text, date, timestamptz, numeric, int, boolean) from public, anon, authenticated;
revoke all on function private.aa_points_words(jsonb, text, text, text) from public, anon, authenticated;

-- ============================================================================================ checks on the settings
-- Rules: an award's new settings are tidied and checked; the points words join the rule's "worth" line, so changing
-- the points is a change to the rule's value (the group's decision rule applies, and it can be disputed). Runs after
-- 093's aa_rules_award (alphabetical) and before the governance guard (ab_).
create or replace function private.rules_auto() returns trigger
language plpgsql security definer set search_path = '' as $$
declare w text;
begin
  if new.award_kind is null then
    new.runs := null; new.window_from := null; new.window_to := null; new.propose_time := null; new.from_scores := null;
    new.points := null; new.comp_id := null;
    return new;
  end if;
  if new.from_scores is not null then new.runs := null; end if;
  if tg_op = 'INSERT' or new.points is distinct from old.points or new.best is distinct from old.best or new.from_scores is distinct from old.from_scores then
    perform private.aa_points_check(new.points, new.best, new.from_scores);
  end if;
  if new.comp_id is not null and (tg_op = 'INSERT' or new.comp_id is distinct from old.comp_id)
     and not exists (select 1 from public.comps c where c.id = new.comp_id and c.group_id = new.group_id) then
    raise exception 'That cup isn''t one of this group''s';
  end if;
  w := private.aa_points_words(new.points, new.award_kind, new.best, new.number_unit);
  if new.reward_type is not null or w is not null then
    new.value := left(concat_ws(' · ', private.award_value(new.reward_type, new.reward_amount, new.reward_note), w), 160);
  end if;
  return new;
end $$;
revoke all on function private.rules_auto() from public, anon, authenticated;
create or replace trigger aa_rules_zauto before insert or update on public.rules
  for each row execute function private.rules_auto();

-- A trip's award: the same checks; a copy is made only by the server and never moves; the cup is one of this trip's.
create or replace function private.dinner_awards_auto() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_server boolean := coalesce(current_setting('app.award_auto', true), '') = 'on';
begin
  if tg_op = 'UPDATE' then new.parent_id := old.parent_id;
  elsif not v_server then new.parent_id := null; end if;
  if new.from_scores is not null then new.runs := null; end if;
  if tg_op = 'INSERT' or new.points is distinct from old.points or new.best is distinct from old.best or new.from_scores is distinct from old.from_scores then
    perform private.aa_points_check(new.points, new.best, new.from_scores);
  end if;
  if new.comp_id is not null and (tg_op = 'INSERT' or new.comp_id is distinct from old.comp_id)
     and not exists (select 1 from public.comps c where c.id = new.comp_id and c.trip_id = new.trip_id) then
    raise exception 'Pick one of this trip''s cups';
  end if;
  return new;
end $$;
revoke all on function private.dinner_awards_auto() from public, anon, authenticated;
create or replace trigger ae_dinner_awards_auto before insert or update on public.dinner_awards
  for each row execute function private.dinner_awards_auto();

-- ============================================================================================ a window's run
-- One row per award per window (a night, a day, or a round for "from the scores"): its claims (the copy's
-- nominations), the proposal, the decision and where the reward went. Server writes only; members read.
create table if not exists public.award_runs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  source_id uuid not null references public.dinner_awards(id) on delete cascade,   -- the trip's award
  award_id uuid unique references public.dinner_awards(id) on delete cascade,     -- this window's copy (claims); null for a round
  rule_id uuid references public.rules(id) on delete set null,
  kind text not null check (kind in ('night', 'day', 'round')),
  window_date date not null,                                                       -- the night's evening / the day / the round's day
  round_id uuid references public.rounds(id) on delete cascade,                    -- from the scores: the round
  opens_at timestamptz, closes_at timestamptz, propose_at timestamptz not null, confirm_by timestamptz not null,
  status text not null default 'open' check (status in ('open', 'proposed', 'disputed', 'overturned', 'confirmed', 'no_winner', 'empty')),
  nomination_id uuid references public.dinner_award_nominations(id) on delete set null,   -- the proposed (then winning) claim
  player_id uuid references public.players(id) on delete set null,                        -- the proposed (then winning) player
  claim_at timestamptz, claim_number numeric,
  results jsonb not null default '[]'::jsonb,   -- ranked lines: [{player_id, nomination_id, at, number, display, photo, rank, points}]
  proposal text check (proposal is null or length(proposal) <= 600),
  post_id uuid references public.posts(id) on delete set null,
  proposed_at timestamptz,
  case_id uuid references public.cases(id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references public.players(id) on delete set null,
  decided_how text check (decided_how is null or decided_how in ('organiser', 'auto', 'tribunal')),
  reward_type text, reward_amount numeric, worth text check (worth is null or length(worth) <= 160),
  comp_id uuid references public.comps(id) on delete set null,
  adjustment_id uuid references public.score_adjustments(id) on delete set null,
  adjust_round_id uuid references public.rounds(id) on delete set null,
  adjust_state text not null default 'none' check (adjust_state in ('none', 'waiting', 'applied')),
  created_at timestamptz not null default now()
);
create unique index if not exists award_runs_window_once on public.award_runs (source_id, kind, window_date) where round_id is null;
create unique index if not exists award_runs_round_once on public.award_runs (source_id, round_id) where round_id is not null;
create index if not exists award_runs_group_idx on public.award_runs (group_id);
create index if not exists award_runs_trip_idx on public.award_runs (trip_id);
create index if not exists award_runs_due_idx on public.award_runs (status, propose_at) where status in ('open', 'proposed', 'disputed');
create index if not exists award_runs_rule_idx on public.award_runs (rule_id);
create index if not exists award_runs_round_idx on public.award_runs (round_id);
create index if not exists award_runs_nomination_idx on public.award_runs (nomination_id);
create index if not exists award_runs_player_idx on public.award_runs (player_id);
create index if not exists award_runs_post_idx on public.award_runs (post_id);
create index if not exists award_runs_case_idx on public.award_runs (case_id);
create index if not exists award_runs_decided_by_idx on public.award_runs (decided_by);
create index if not exists award_runs_comp_idx on public.award_runs (comp_id);
create index if not exists award_runs_adjustment_idx on public.award_runs (adjustment_id);
create index if not exists award_runs_adjust_round_idx on public.award_runs (adjust_round_id);
create index if not exists award_runs_waiting_idx on public.award_runs (trip_id) where adjust_state = 'waiting';
alter table public.award_runs enable row level security;
create policy "members read" on public.award_runs for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "same group only" on public.award_runs as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke all on public.award_runs from anon, authenticated;
grant select on public.award_runs to authenticated;
create or replace trigger aa_fill_group_id before insert or update on public.award_runs
  for each row execute function private.fill_group_id('trips:trip_id');

-- ============================================================================================ cup points
-- cup_points — POINTS TOWARDS A CUP. One row = some points for one player on one trip, from one source.
-- How to read it (the cups builder, 101, adds these into each cup's standings):
--   * A row COUNTS when confirmed_at is not null and waived_at is null. confirmed_at null = pending (proposed, waiting
--     for an organiser, the first tee or a Tribunal verdict). waived_at = struck out (a dispute upheld, or no winner).
--   * comp_id: the cup (public.comps) it counts towards. Null = it feeds no cup (still shows in the trip's tally).
--   * points: signed. Fines are negative.
--   * source_type / source_id — where it came from:
--       'award' / 'fine'  written by 100's confirm flow: source_id = award_runs.id, rule_id = the Rulebook rule,
--                         nomination_id = the claim (null for "from the scores"). One row per player per run.
--       'activity'        (101) a trip activity; source_id = its row.
--       'manual'          (101) an organiser's hand entry; source_id null.
--       'kudos'           (101) cap tips 🧢 players give each other; source_id = the cap tip's row.
--       'penalty'         reserved.
--     Scores-based sources (rounds, side comps, games, matches, tips, penalty strokes) are worked out at standings time
--     and are NOT written here.
--   * case_id: an open Tribunal dispute about this one line (it waits for the verdict).
-- Server writes only; members read.
create table if not exists public.cup_points (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  comp_id uuid references public.comps(id) on delete set null,
  player_id uuid not null references public.players(id) on delete cascade,
  points numeric not null check (points between -1000 and 1000),
  source_type text not null check (source_type in ('award', 'fine', 'activity', 'manual', 'penalty', 'kudos')),
  source_id uuid,
  rule_id uuid references public.rules(id) on delete set null,
  nomination_id uuid references public.dinner_award_nominations(id) on delete set null,
  label text not null check (length(label) between 2 and 200),
  case_id uuid references public.cases(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  waived_at timestamptz,
  waived_by uuid references public.players(id) on delete set null
);
create unique index if not exists cup_points_award_once on public.cup_points (source_id, player_id) where source_type in ('award', 'fine');
create index if not exists cup_points_group_idx on public.cup_points (group_id);
create index if not exists cup_points_trip_idx on public.cup_points (trip_id);
create index if not exists cup_points_comp_idx on public.cup_points (comp_id) where confirmed_at is not null and waived_at is null;
create index if not exists cup_points_comp_all_idx on public.cup_points (comp_id);
create index if not exists cup_points_player_idx on public.cup_points (player_id);
create index if not exists cup_points_rule_idx on public.cup_points (rule_id);
create index if not exists cup_points_nomination_idx on public.cup_points (nomination_id);
create index if not exists cup_points_case_idx on public.cup_points (case_id);
create index if not exists cup_points_waived_by_idx on public.cup_points (waived_by);
create index if not exists cup_points_source_idx on public.cup_points (source_id);
alter table public.cup_points enable row level security;
create policy "members read" on public.cup_points for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "same group only" on public.cup_points as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke all on public.cup_points from anon, authenticated;
grant select on public.cup_points to authenticated;
create or replace trigger aa_fill_group_id before insert or update on public.cup_points
  for each row execute function private.fill_group_id('trips:trip_id');

-- ============================================================================================ making a window's run
-- Is a date one of the trip's nights / days? Nights: the start date up to the night before the last day (a one-day
-- trip has its one night). Days: start to end. A trip without dates allows any.
create or replace function private.aa_trip_has(p_trip uuid, p_kind text, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when t.start_date is null then true
                               when p_kind = 'night' then p_date between t.start_date and greatest(coalesce(t.end_date, t.start_date) - 1, t.start_date)
                               else p_date between t.start_date and coalesce(t.end_date, t.start_date) end
                   from public.trips t where t.id = p_trip), false)
$$;
revoke all on function private.aa_trip_has(uuid, text, date) from public, anon, authenticated;

-- The run for an award's window (made the first time it's needed, with its copy of the award). Returns its id.
create or replace function private.aa_run_for(p_source uuid, p_date date, p_round uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t record; w record; tm record; v_id uuid; v_copy uuid; v_title text;
begin
  select * into t from private.auto_terms(p_source);
  if t.source_id is null or t.runs not in ('night', 'day', 'round') then raise exception 'That one isn''t automatic'; end if;
  if p_round is not null then
    select id into v_id from public.award_runs where source_id = t.source_id and round_id = p_round;
  else
    select id into v_id from public.award_runs where source_id = t.source_id and kind = t.runs and window_date = p_date and round_id is null;
  end if;
  if v_id is not null then return v_id; end if;
  if t.runs = 'round' then
    select * into tm from private.aa_times(t.trip_id, p_date, t.propose_time, now());
    insert into public.award_runs (group_id, trip_id, source_id, rule_id, kind, window_date, round_id, propose_at, confirm_by,
      reward_type, reward_amount, worth, comp_id)
    values (t.group_id, t.trip_id, t.source_id, t.rule_id, 'round', p_date, p_round, now(), tm.confirm_by,
      t.reward_type, t.reward_amount, private.award_value(t.reward_type, t.reward_amount, t.reward_note), t.comp_id)
    on conflict do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.award_runs where source_id = t.source_id and round_id = p_round; end if;
    return v_id;
  end if;
  select * into w from private.aa_window(t.window_from, t.window_to, p_date);
  select * into tm from private.aa_times(t.trip_id, p_date, t.propose_time, w.closes);
  v_title := left(t.title, 42) || ' · ' || trim(to_char(p_date, 'Dy')) || case when t.runs = 'night' then ' night' else ' ' || trim(to_char(p_date, 'FMDD')) end;
  perform set_config('app.award_auto', 'on', true);
  insert into public.dinner_awards (group_id, trip_id, title, kind, penalty, created_by, sort, parent_id, reward_type, reward_amount,
    reward_note, proof, best, number_unit, comp_id)
  values (t.group_id, t.trip_id, v_title, t.kind,
    case when t.kind = 'fine' then left(private.award_value(t.reward_type, t.reward_amount, t.reward_note), 80) end,
    private.my_player_id(t.group_id), 500, t.source_id, t.reward_type, t.reward_amount, t.reward_note, t.proof, t.best, t.number_unit, t.comp_id)
  returning id into v_copy;
  perform set_config('app.award_auto', '', true);
  insert into public.award_runs (group_id, trip_id, source_id, award_id, rule_id, kind, window_date, opens_at, closes_at, propose_at, confirm_by,
    reward_type, reward_amount, worth, comp_id)
  values (t.group_id, t.trip_id, t.source_id, v_copy, t.rule_id, t.runs, p_date, w.opens, w.closes, tm.propose_at, tm.confirm_by,
    t.reward_type, t.reward_amount, private.award_value(t.reward_type, t.reward_amount, t.reward_note), t.comp_id)
  on conflict do nothing returning id into v_id;
  if v_id is null then
    delete from public.dinner_awards where id = v_copy;   -- someone else made it at the same moment
    select id into v_id from public.award_runs where source_id = t.source_id and kind = t.runs and window_date = p_date and round_id is null;
  end if;
  return v_id;
end $$;
revoke all on function private.aa_run_for(uuid, date, uuid) from public, anon, authenticated;

-- ============================================================================================ claiming from a post
-- One tap on a Feed photo: "Claim Latest out?" — for yourself or (p_player) a mate. The award is the trip's award
-- (p_award) or a Rulebook award (p_rule). The claim's time is the post's server time; it must fall in one of the
-- trip's claim windows. A second claim the same window by the same person keeps the better one.
-- Returns { status: claimed | improved | kept, run, award, player, at }.
create or replace function public.award_claim_post(p_post uuid, p_award uuid default null, p_rule uuid default null, p_player uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.posts; v_g uuid; v_me uuid; v_trip uuid; v_src uuid; t record; d date; run public.award_runs; v_who uuid;
        n public.dinner_award_nominations; v_better boolean; v_run uuid;
begin
  select * into p from public.posts where id = p_post;
  if p.id is null or not (p.group_id = any (private.my_group_ids())) then raise exception 'Post not found'; end if;
  v_g := p.group_id;
  if private.is_group_guest(v_g) then raise exception 'Guests can''t claim'; end if;
  perform private.require_feature(v_g, 'dinner_awards');
  v_me := private.my_player_id(v_g);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if p.server_at is null then raise exception 'That post is from before claims started'; end if;
  if p_award is not null then
    select coalesce(parent_id, id), trip_id into v_src, v_trip from public.dinner_awards where id = p_award and group_id = v_g;
    if v_src is null then raise exception 'Award not found'; end if;
  else
    v_trip := coalesce(p.trip_id, private.gov_trip_in_progress(v_g));
    if v_trip is null then raise exception 'Claims belong to a trip'; end if;
    v_src := public.award_for_trip(v_trip, p_rule);
  end if;
  if p.trip_id is not null and p.trip_id <> v_trip then raise exception 'That post is from another trip'; end if;
  select * into t from private.auto_terms(v_src);
  if t.runs not in ('night', 'day') then raise exception '% isn''t claimed from posts', t.title; end if;
  d := private.aa_window_date(t.window_from, t.window_to, p.server_at);
  if d is null or not private.aa_trip_has(v_trip, t.runs, d) then
    raise exception 'Claims for % are % to % on the trip', t.title, private.aa_hhmm_words(t.window_from), private.aa_hhmm_words(t.window_to);
  end if;
  if t.proof in ('photo', 'photo_time', 'photo_number') and p.photo_url is null then raise exception 'This one needs a photo'; end if;
  if t.proof in ('number', 'photo_number') then raise exception 'This one needs a number — nominate it on the awards screen'; end if;
  v_who := coalesce(p_player, p.player_id, v_me);
  if not exists (select 1 from public.players where id = v_who and group_id = v_g) then raise exception 'Pick someone in the group'; end if;

  v_run := private.aa_run_for(v_src, d);   -- first (a function in the WHERE would only run if a row was there)
  select * into run from public.award_runs where id = v_run for update;
  if run.status <> 'open' then raise exception 'Too late — % has been proposed', t.title; end if;

  select * into n from public.dinner_award_nominations where award_id = run.award_id and player_id = v_who;
  if n.id is null then
    insert into public.dinner_award_nominations (group_id, award_id, player_id, reason, post_id, photo_url, claim_at, nominated_by)
    values (v_g, run.award_id, v_who, left(nullif(btrim(coalesce(p.body, '')), ''), 140), p.id,
            case when p.photo_url ~ '^https://' and length(p.photo_url) <= 400 then p.photo_url end, p.server_at, v_me);
    return jsonb_build_object('status', 'claimed', 'run', run.id, 'award', run.award_id, 'player', v_who, 'at', p.server_at);
  end if;
  v_better := case when t.best = 'earliest' then p.server_at < n.claim_at else p.server_at > n.claim_at end;
  if not v_better then
    return jsonb_build_object('status', 'kept', 'run', run.id, 'award', run.award_id, 'player', v_who, 'at', n.claim_at);
  end if;
  update public.dinner_award_nominations set post_id = p.id, claim_at = p.server_at,
    photo_url = case when p.photo_url ~ '^https://' and length(p.photo_url) <= 400 then p.photo_url else photo_url end
  where id = n.id;
  return jsonb_build_object('status', 'improved', 'run', run.id, 'award', run.award_id, 'player', v_who, 'at', p.server_at);
end $$;
revoke all on function public.award_claim_post(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.award_claim_post(uuid, uuid, uuid, uuid) to authenticated;
revoke execute on function public.award_claim_post(uuid, uuid, uuid, uuid) from service_role;

-- ============================================================================================ ranking and points
-- A player's name for the posts.
create or replace function private.aa_name(p_player uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(nullif(btrim(nickname), ''), name) from public.players where id = p_player), 'Someone')
$$;
revoke all on function private.aa_name(uuid) from public, anon, authenticated;

-- Rank a run's claims (best first; ties share a rank; with no "best", the first claim first) and work out each
-- line's points for the current proposed winner. Saves and returns results.
create or replace function private.aa_rank(p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run public.award_runs; t record; l record; out jsonb := '[]'::jsonb; v_win uuid; pts numeric; s int;
begin
  select * into run from public.award_runs where id = p_run;
  select * into t from private.auto_terms(run.source_id);
  s := case when t.kind = 'fine' then -1 else 1 end;
  if run.kind = 'round' then
    v_win := coalesce(run.player_id, (select (x->>'player_id')::uuid from jsonb_array_elements(run.results) x order by (x->>'rank')::int, (x->>'i')::int limit 1));
    for l in select x, (x->>'rank')::int rk from jsonb_array_elements(run.results) x order by (x->>'rank')::int, (x->>'i')::int loop
      pts := s * private.aa_line_points(t.points, null, 'round', null, run.window_date, null, nullif(l.x->>'value', '')::numeric, l.rk,
                                         (l.x->>'player_id')::uuid = v_win);
      out := out || jsonb_build_array(l.x || jsonb_build_object('points', pts));
    end loop;
  else
    for l in
      select n.id, n.player_id, n.claim_at, n.claim_number, (n.photo_url is not null or n.post_id is not null) photo, n.created_at,
             rank() over (order by case t.best when 'latest' then -extract(epoch from n.claim_at) when 'earliest' then extract(epoch from n.claim_at)
                                               when 'highest' then -n.claim_number when 'lowest' then n.claim_number
                                               else extract(epoch from n.created_at) end nulls last)::int rk
      from public.dinner_award_nominations n where n.award_id = run.award_id
      order by 7, n.created_at
    loop
      if v_win is null then v_win := coalesce(run.player_id, l.player_id); end if;
      pts := s * private.aa_line_points(t.points, t.best, run.kind, t.window_from, run.window_date, l.claim_at, l.claim_number, l.rk, l.player_id = v_win);
      out := out || jsonb_build_array(jsonb_build_object('player_id', l.player_id, 'nomination_id', l.id, 'at', l.claim_at, 'number', l.claim_number,
        'display', concat_ws(', ', private.aa_clock(l.claim_at), trim_scale(l.claim_number)::text || coalesce(' ' || t.number_unit, '')),
        'photo', l.photo, 'rank', l.rk, 'points', pts));
    end loop;
  end if;
  update public.award_runs set results = out where id = p_run;
  return out;
end $$;
revoke all on function private.aa_rank(uuid) from public, anon, authenticated;

-- Write the run's pending points (cup_points, confirmed_at null), replacing earlier pending ones (a new winner).
-- Lines under an open dispute, and confirmed or waived lines, are left alone.
create or replace function private.aa_write_points(p_run uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare run public.award_runs; t record; n int;
begin
  select * into run from public.award_runs where id = p_run;
  select * into t from private.auto_terms(run.source_id);
  delete from public.cup_points where source_id = run.id and source_type in ('award', 'fine') and confirmed_at is null and waived_at is null and case_id is null;
  if t.points is null then return 0; end if;
  insert into public.cup_points (group_id, trip_id, comp_id, player_id, points, source_type, source_id, rule_id, nomination_id, label)
  select run.group_id, run.trip_id, run.comp_id, (x->>'player_id')::uuid, (x->>'points')::numeric, t.kind, run.id, run.rule_id,
         nullif(x->>'nomination_id', '')::uuid,
         left(t.title || ' · ' || case run.kind when 'night' then trim(to_char(run.window_date, 'Dy')) || ' night'
                                              when 'day' then trim(to_char(run.window_date, 'Dy FMDD'))
                                              else coalesce((select name from public.rounds where id = run.round_id), 'round') end
              || coalesce(' · ' || nullif(x->>'display', ''), ''), 200)
  from jsonb_array_elements(run.results) x
  where coalesce((x->>'points')::numeric, 0) <> 0
  on conflict (source_id, player_id) where source_type in ('award', 'fine') do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.aa_write_points(uuid) from public, anon, authenticated;

-- The proposal post's words. Same as proposalText() in src/lib/autoawards.js.
create or replace function private.aa_proposal_text(p_run uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare run public.award_runs; t record; v_when text; v_lines text; v_per boolean; v_tee time; v_by text;
begin
  select * into run from public.award_runs where id = p_run;
  select * into t from private.auto_terms(run.source_id);
  v_per := coalesce(t.points->>'mode', '') in ('per_unit', 'placings');
  -- Posted the morning after: "last night" / "yesterday".
  v_when := case run.kind when 'night' then 'last night' when 'day' then 'yesterday'
                          else coalesce((select name from public.rounds where id = run.round_id), 'the round') end;
  select string_agg(private.aa_name((x->>'player_id')::uuid) || coalesce(' ' || nullif(x->>'display', ''), '')
           || case when (x->>'photo')::boolean then ' 📷' else '' end
           || case when coalesce((x->>'points')::numeric, 0) <> 0 then ' (' || case when (x->>'points')::numeric > 0 then '+' else '−' end
                     || trim_scale(abs((x->>'points')::numeric)) || ')' else '' end, ', ' order by o)
    into v_lines
  from jsonb_array_elements(run.results) with ordinality e(x, o)
  where o = 1 or (v_per and coalesce((x->>'points')::numeric, 0) <> 0 and o <= 8);
  v_tee := private.aa_first_tee(run.trip_id, run.window_date + 1);
  v_by := case when v_tee is not null and run.confirm_by = private.aa_at(run.window_date + 1, to_char(v_tee, 'HH24:MI'))
               then 'the first tee (' || private.aa_clock(run.confirm_by) || ')' else private.aa_clock(run.confirm_by) end;
  return left(case when run.kind = 'night' then '🌙 ' when t.kind = 'fine' then '🍺 ' else '🏅 ' end || 'Proposed — ' || t.title || ', ' || v_when || ': '
    || coalesce(v_lines, '') || case when coalesce(run.worth, '') <> '' then ' · ' || run.worth else '' end
    || '. Confirm or dispute by ' || v_by || '.', 600);
end $$;
revoke all on function private.aa_proposal_text(uuid) from public, anon, authenticated;

-- Propose: rank, pick the top claim (ties: the earliest claim), write pending points, post once, buzz the group.
-- No claims: 'empty', no post. Only from 'open' (so a second run of the job does nothing).
create or replace function private.aa_propose(p_run uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare run public.award_runs; res jsonb; first jsonb; v_body text; v_post uuid; v_photo text;
begin
  select * into run from public.award_runs where id = p_run for update;
  if run.id is null or run.status <> 'open' then return coalesce(run.status, 'none'); end if;
  if not public.feature_on(run.group_id, 'dinner_awards') then return 'off'; end if;
  res := private.aa_rank(run.id);
  if jsonb_array_length(res) = 0 then
    update public.award_runs set status = 'empty', proposed_at = now() where id = run.id;
    return 'empty';
  end if;
  first := res->0;
  update public.award_runs set status = 'proposed', proposed_at = now(), player_id = (first->>'player_id')::uuid,
    nomination_id = nullif(first->>'nomination_id', '')::uuid, claim_at = nullif(first->>'at', '')::timestamptz,
    claim_number = coalesce(nullif(first->>'number', '')::numeric, nullif(first->>'value', '')::numeric)
  where id = run.id;
  perform private.aa_rank(run.id);
  perform private.aa_write_points(run.id);
  v_body := private.aa_proposal_text(run.id);
  select photo_url into v_photo from public.dinner_award_nominations where id = nullif(first->>'nomination_id', '')::uuid;
  if public.feature_on(run.group_id, 'feed') then
    insert into public.posts (group_id, trip_id, round_id, kind, body, player_id, link, photo_url)
    values (run.group_id, run.trip_id, run.round_id, 'auto', v_body, (first->>'player_id')::uuid, '/award-run/' || run.id, v_photo)
    returning id into v_post;
  end if;
  update public.award_runs set proposal = v_body, post_id = v_post where id = run.id;
  perform private.gov_queue(run.group_id, null, 'award_proposed', left(v_body, 160), 'Confirm or dispute it in the Feed.', null);
  return 'proposed';
end $$;
revoke all on function private.aa_propose(uuid) from public, anon, authenticated;

-- ============================================================================================ the reward lands
-- Strokes on the winner's next round: that day's (or the round's next) round of the trip they play in, not finished.
-- Returns true when placed; otherwise it waits for a round to go live.
create or replace function private.aa_place_strokes(p_run uuid, p_round uuid default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare run public.award_runs; v_round uuid; v_from date; v_strokes int; v_adj uuid; v_title text;
begin
  select * into run from public.award_runs where id = p_run for update;
  if run.id is null or run.status <> 'confirmed' or run.reward_type is distinct from 'strokes' or run.player_id is null
     or run.adjust_state = 'applied' or coalesce(run.reward_amount, 0) = 0 then return false; end if;
  v_from := case when run.kind = 'round' then run.window_date else run.window_date + 1 end;
  if p_round is not null then
    select r.id into v_round from public.rounds r where r.id = p_round and r.trip_id = run.trip_id and r.id is distinct from run.round_id
      and private.plays_in_round(r.id, run.player_id);
  else
    select r.id into v_round from public.rounds r
    where r.trip_id = run.trip_id and r.status <> 'locked' and r.id is distinct from run.round_id
      and coalesce(r.play_date, v_from) >= v_from and private.plays_in_round(r.id, run.player_id)
    order by r.play_date nulls last, r.created_at limit 1;
  end if;
  if v_round is null then
    update public.award_runs set adjust_state = 'waiting' where id = run.id;
    return false;
  end if;
  v_strokes := run.reward_amount::int;
  select title into v_title from public.dinner_awards where id = run.source_id;
  begin
    insert into public.score_adjustments (group_id, round_id, player_id, strokes, label, kind, rule_id)
    values (run.group_id, v_round, run.player_id, v_strokes,
            left(left(v_title, 140) || ' (' || case when v_strokes < 0 then '−' else '+' end || abs(v_strokes) || ')', 160), 'award', run.rule_id)
    returning id into v_adj;
  exception when check_violation then
    raise warning 'award strokes need 099 (score_adjustments kind ''award''): %', sqlerrm;
    update public.award_runs set adjust_state = 'waiting' where id = run.id;
    return false;
  end;
  update public.award_runs set adjustment_id = v_adj, adjust_round_id = v_round, adjust_state = 'applied' where id = run.id;
  return true;
end $$;
revoke all on function private.aa_place_strokes(uuid, uuid) from public, anon, authenticated;

-- When a round goes live: strokes waiting for a winner who plays in it.
create or replace function private.rounds_auto_award_strokes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    for r in select id from public.award_runs where trip_id = new.trip_id and adjust_state = 'waiting' and status = 'confirmed' loop
      begin
        perform private.aa_place_strokes(r.id, new.id);
      exception when others then
        raise warning 'auto award strokes: %', sqlerrm;   -- never stop a round starting
      end;
    end loop;
  end if;
  return null;
end $$;
revoke all on function private.rounds_auto_award_strokes() from public, anon, authenticated;
create or replace trigger zz_auto_award_strokes after insert or update of status on public.rounds
  for each row execute function private.rounds_auto_award_strokes();

-- Confirm a run (organiser, the first tee, or the Tribunal throwing out a dispute). p_nomination / p_player: an
-- organiser picking a different claim (or, from the scores, a different player). Writes the result to the copy, the
-- points (confirmed), the strokes, a short post and a buzz to the winner.
create or replace function private.aa_confirm(p_run uuid, p_how text, p_by uuid, p_nomination uuid default null, p_player uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare run public.award_runs; t record; n public.dinner_award_nominations; v_win uuid; v_body text; v_placed boolean;
begin
  select * into run from public.award_runs where id = p_run for update;
  if run.id is null then raise exception 'Not found'; end if;
  if run.status = 'confirmed' then return jsonb_build_object('status', 'already', 'player', run.player_id); end if;
  if run.status not in ('proposed', 'overturned', 'disputed') then raise exception 'Nothing to confirm yet'; end if;
  select * into t from private.auto_terms(run.source_id);
  if p_nomination is not null then
    select * into n from public.dinner_award_nominations where id = p_nomination and award_id = run.award_id;
    if n.id is null then raise exception 'Pick one of the claims'; end if;
    update public.award_runs set nomination_id = n.id, player_id = n.player_id, claim_at = n.claim_at, claim_number = n.claim_number where id = run.id;
  elsif p_player is not null then
    if not exists (select 1 from jsonb_array_elements(run.results) x where x->>'player_id' = p_player::text) then raise exception 'Pick someone in the results'; end if;
    update public.award_runs set player_id = p_player,
      claim_number = (select nullif(x->>'value', '')::numeric from jsonb_array_elements(run.results) x where x->>'player_id' = p_player::text limit 1)
    where id = run.id;
  elsif run.status = 'overturned' then
    raise exception 'The Tribunal upheld the dispute — pick another claim or “No winner”';
  end if;
  if p_nomination is not null or p_player is not null then
    perform private.aa_rank(run.id);
    perform private.aa_write_points(run.id);
  end if;
  select * into run from public.award_runs where id = p_run;
  v_win := run.player_id;
  update public.award_runs set status = 'confirmed', decided_at = now(), decided_by = p_by, decided_how = p_how where id = run.id;
  -- Points: every pending line not under its own open dispute.
  update public.cup_points cp set confirmed_at = now()
  where cp.source_id = run.id and cp.source_type in ('award', 'fine') and cp.confirmed_at is null and cp.waived_at is null
    and (cp.case_id is null or exists (select 1 from public.cases c where c.id = cp.case_id and c.status in ('failed', 'withdrawn')));
  -- The window's copy shows the winner (older apps too).
  if run.award_id is not null then
    perform set_config('app.award_settle', 'on', true);
    update public.dinner_awards set winner_id = v_win, settled_at = now(), status = 'closed' where id = run.award_id;
    perform set_config('app.award_settle', '', true);
  end if;
  v_placed := private.aa_place_strokes(run.id);
  v_body := '✅ Confirmed — ' || t.title || ': ' || private.aa_name(v_win)
    || case when coalesce(run.worth, '') <> '' then ' · ' || run.worth || case when run.reward_type = 'strokes' then ' next round' else '' end else '' end;
  if public.feature_on(run.group_id, 'feed') then
    insert into public.posts (group_id, trip_id, kind, body, player_id, link)
    values (run.group_id, run.trip_id, 'auto', left(v_body, 500), v_win, '/award-run/' || run.id);
  end if;
  perform private.gov_queue(run.group_id, array[v_win], 'award_confirmed', left(v_body, 160), null, null);
  return jsonb_build_object('status', 'confirmed', 'player', v_win, 'strokes_placed', v_placed);
end $$;
revoke all on function private.aa_confirm(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;

-- ============================================================================================ what people tap
create or replace function private.aa_my_run(p_run uuid, p_organiser boolean) returns public.award_runs
language plpgsql security definer set search_path = '' as $$
declare run public.award_runs;
begin
  select * into run from public.award_runs where id = p_run;
  if run.id is null or not (run.group_id = any (private.my_group_ids())) then raise exception 'Not found'; end if;
  if private.is_group_guest(run.group_id) then raise exception 'Guests can''t do that'; end if;
  perform private.require_feature(run.group_id, 'dinner_awards');
  if p_organiser and not private.is_group_organiser(run.group_id) then raise exception 'Only an organiser can do that'; end if;
  return run;
end $$;
revoke all on function private.aa_my_run(uuid, boolean) from public, anon, authenticated;

-- An organiser confirms (optionally picking a different claim / player).
create or replace function public.award_run_confirm(p_run uuid, p_nomination uuid default null, p_player uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run public.award_runs := private.aa_my_run(p_run, true);
begin
  if run.status = 'disputed' then raise exception 'It''s disputed — the Tribunal decides'; end if;
  return private.aa_confirm(p_run, 'organiser', private.my_player_id(run.group_id), p_nomination, p_player);
end $$;

-- An organiser says "No winner": nothing lands; pending points are struck out.
create or replace function public.award_run_no_winner(p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run public.award_runs := private.aa_my_run(p_run, true); v_me uuid := private.my_player_id(run.group_id);
begin
  select * into run from public.award_runs where id = p_run for update;
  if run.status = 'no_winner' then return jsonb_build_object('status', 'already'); end if;
  if run.status not in ('open', 'proposed', 'overturned') then raise exception 'It''s % — too late for that', run.status; end if;
  update public.award_runs set status = 'no_winner', player_id = null, nomination_id = null, decided_at = now(), decided_by = v_me, decided_how = 'organiser' where id = run.id;
  update public.cup_points set waived_at = now(), waived_by = v_me where source_id = run.id and source_type in ('award', 'fine') and confirmed_at is null and waived_at is null;
  if run.award_id is not null then
    perform set_config('app.award_settle', 'on', true);
    update public.dinner_awards set winner_id = null, settled_at = now(), status = 'closed' where id = run.award_id;
    perform set_config('app.award_settle', '', true);
  end if;
  return jsonb_build_object('status', 'no_winner');
end $$;

-- Anyone (not guests) disputes the proposal in one tap: a Tribunal case about the proposed winner. The run waits.
create or replace function public.award_run_dispute(p_run uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare run public.award_runs := private.aa_my_run(p_run, false); t record; v_case uuid; v_label text;
begin
  select * into run from public.award_runs where id = p_run for update;
  if run.status <> 'proposed' then raise exception 'Only a proposed winner can be disputed'; end if;
  select * into t from private.auto_terms(run.source_id);
  v_label := left(t.title || ', ' || case run.kind when 'night' then trim(to_char(run.window_date, 'Dy')) || ' night'
                                                    when 'day' then trim(to_char(run.window_date, 'Dy FMDD')) else 'the round' end
                  || ': ' || private.aa_name(run.player_id), 120);
  v_case := public.raise_dispute(jsonb_build_object('table', 'award_runs', 'id', run.id, 'field', 'player_id', 'label', v_label,
              'where', jsonb_build_object('trip_id', run.trip_id, 'path', '/award-run/' || run.id)),
            'Dispute: ' || v_label, p_reason, null, null);
  update public.award_runs set status = 'disputed', case_id = v_case where id = run.id;
  return v_case;
end $$;

-- Dispute one person's points line (per-unit or placings). That line waits for the verdict; the rest go through.
create or replace function public.cup_points_dispute(p_line uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cp public.cup_points; v_case uuid;
begin
  select * into cp from public.cup_points where id = p_line for update;
  if cp.id is null or not (cp.group_id = any (private.my_group_ids())) then raise exception 'Not found'; end if;
  if private.is_group_guest(cp.group_id) then raise exception 'Guests can''t do that'; end if;
  if cp.waived_at is not null then raise exception 'That line is already struck out'; end if;
  if cp.case_id is not null and exists (select 1 from public.cases where id = cp.case_id and status = 'open') then raise exception 'Already disputed — see the case'; end if;
  v_case := public.raise_dispute(jsonb_build_object('table', 'cup_points', 'id', cp.id, 'field', 'points',
              'label', left(private.aa_name(cp.player_id) || ': ' || cp.label, 120), 'where', jsonb_build_object('trip_id', cp.trip_id)),
            'Dispute: ' || left(private.aa_name(cp.player_id) || ' — ' || cp.label, 120), p_reason, null, null);
  update public.cup_points set case_id = v_case where id = cp.id;
  return v_case;
end $$;

-- From the scores: when a round is finished the app works out the standings (src/lib/sidecomplib.js) and hands them
-- over, best first: [{ player_id, value, display, rank }]. The server proposes once per award per round (a second
-- call returns 'already'), and the same confirm / dispute applies.
create or replace function public.award_propose_from_scores(p_round uuid, p_award uuid default null, p_rule uuid default null, p_results jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rd public.rounds; v_src uuid; t record; run public.award_runs; v_res jsonb := '[]'::jsonb; x jsonb; i int := 0; v_status text; v_run uuid;
begin
  select * into rd from public.rounds where id = p_round;
  if rd.id is null or not (rd.group_id = any (private.my_group_ids())) then raise exception 'Round not found'; end if;
  if private.is_group_guest(rd.group_id) then raise exception 'Guests can''t do that'; end if;
  perform private.require_feature(rd.group_id, 'dinner_awards');
  if rd.status <> 'locked' then raise exception 'Wait until the round is finished'; end if;
  if p_award is not null then
    select coalesce(parent_id, id) into v_src from public.dinner_awards where id = p_award and group_id = rd.group_id and trip_id = rd.trip_id;
  else
    v_src := public.award_for_trip(rd.trip_id, p_rule);
  end if;
  if v_src is null then raise exception 'Award not found'; end if;
  select * into t from private.auto_terms(v_src);
  if t.runs <> 'round' then raise exception '% isn''t worked out from the scores', t.title; end if;
  v_run := private.aa_run_for(v_src, coalesce(rd.play_date, (now() at time zone 'Australia/Sydney')::date), rd.id);
  select * into run from public.award_runs where id = v_run for update;
  if run.status <> 'open' then return jsonb_build_object('status', 'already', 'run', run.id); end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 40 then raise exception 'Results: a list'; end if;
  for x in select * from jsonb_array_elements(p_results) loop
    i := i + 1;
    if not exists (select 1 from public.players where id = (x->>'player_id')::uuid and group_id = rd.group_id)
       or not private.plays_in_round(rd.id, (x->>'player_id')::uuid) then
      raise exception 'Someone in the results isn''t in this round';
    end if;
    v_res := v_res || jsonb_build_array(jsonb_build_object('player_id', x->>'player_id', 'value', nullif(x->>'value', '')::numeric,
      'display', left(coalesce(x->>'display', ''), 40), 'rank', greatest(1, coalesce((x->>'rank')::int, i)), 'i', i));
  end loop;
  update public.award_runs set results = v_res where id = run.id;
  v_status := private.aa_propose(run.id);
  return jsonb_build_object('status', v_status, 'run', run.id);
end $$;

do $$
declare f text;
begin
  foreach f in array array['award_run_confirm(uuid, uuid, uuid)', 'award_run_no_winner(uuid)', 'award_run_dispute(uuid, text)',
                           'cup_points_dispute(uuid, text)', 'award_propose_from_scores(uuid, uuid, uuid, jsonb)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
    execute 'revoke execute on function public.' || f || ' from service_role';
  end loop;
end $$;

-- ============================================================================================ the job
-- Every 5 minutes: propose what's due, settle disputes the Tribunal has decided, confirm at the first tee.
-- p_now lets the tests step through a night; the job always uses now().
create or replace function private.auto_awards_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; n_prop int := 0; n_conf int := 0; n_case int := 0; v text;
begin
  for r in select id from public.award_runs where status = 'open' and round_id is null and propose_at <= p_now order by propose_at loop
    begin
      v := private.aa_propose(r.id);
      if v = 'proposed' then n_prop := n_prop + 1; end if;
    exception when others then raise warning 'auto award propose %: %', r.id, sqlerrm;
    end;
  end loop;
  -- Disputes decided: thrown out (failed / withdrawn) → confirmed; upheld (passed) → back to the organiser.
  for r in select ar.id, c.status cs, ar.group_id from public.award_runs ar join public.cases c on c.id = ar.case_id
           where ar.status = 'disputed' and c.status <> 'open' loop
    begin
      if r.cs = 'passed' then
        update public.award_runs set status = 'overturned' where id = r.id and status = 'disputed';
        perform private.gov_queue(r.group_id, (select array_agg(player_id) from public.group_members where group_id = r.group_id and role = 'organiser'),
          'award_overturned', '⚖️ Dispute upheld — pick another claim or “No winner”', null, null);
      else
        perform private.aa_confirm(r.id, 'tribunal', null);
      end if;
      n_case := n_case + 1;
    exception when others then raise warning 'auto award case %: %', r.id, sqlerrm;
    end;
  end loop;
  -- One line disputed: upheld → struck out; thrown out → counts once its run is confirmed.
  update public.cup_points cp set waived_at = p_now from public.cases c
  where c.id = cp.case_id and c.status = 'passed' and cp.waived_at is null and cp.confirmed_at is null;
  update public.cup_points cp set confirmed_at = p_now from public.cases c, public.award_runs ar
  where c.id = cp.case_id and c.status in ('failed', 'withdrawn') and cp.waived_at is null and cp.confirmed_at is null
    and ar.id = cp.source_id and ar.status = 'confirmed';
  -- Nobody disputed by the first tee: confirmed.
  for r in select id from public.award_runs where status = 'proposed' and confirm_by <= p_now order by confirm_by loop
    begin
      perform private.aa_confirm(r.id, 'auto', null);
      n_conf := n_conf + 1;
    exception when others then raise warning 'auto award confirm %: %', r.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('proposed', n_prop, 'confirmed', n_conf, 'cases', n_case);
end $$;
revoke all on function private.auto_awards_tick(timestamptz) from public, anon, authenticated;

-- The job: the tick, then (when there's a buzz waiting) the notify function sends the award buzzes straight away to
-- people on "straight away" (the hourly send does the rest). The project's address and the secret are found the way
-- 071's commentary job finds them.
create or replace function private.auto_awards_job() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_base text; v_secret text;
begin
  v := private.auto_awards_tick(now());
  if exists (select 1 from public.notify_queue where kind in ('award_proposed', 'award_confirmed', 'award_overturned')
             and sent_at is null and created_at > now() - interval '30 minutes') then
    select substring(command from 'https://[a-z0-9]+\.supabase\.co') into v_base from cron.job where jobname = 'lgc-daily-reminders';
    select value into v_secret from public.server_secrets where name = 'cron_secret';
    if v_base is not null and v_secret is not null then
      perform net.http_post(url := v_base || '/functions/v1/notify',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body := '{"type":"auto_awards"}'::jsonb);
    end if;
  end if;
  return v;
end $$;
revoke all on function private.auto_awards_job() from public, anon, authenticated;

select cron.schedule('lgc-auto-awards', '*/5 * * * *', 'select private.auto_awards_job()');

-- ============================================================================================ disputes
-- private.dispute_fields gains: award_runs.player_id (the proposed winner), cup_points.points (one person's line),
-- and rules.points (how an award scores — a rule value like any other). Patched in place so whatever 099 added stays.
do $$
declare d text;
begin
  d := pg_get_functiondef('private.dispute_fields(text)'::regprocedure);
  if position('award_runs' in d) = 0 then
    d := replace(d, 'else array[]::text[] end', 'when ''award_runs'' then array[''player_id''] when ''cup_points'' then array[''points''] else array[]::text[] end');
  end if;
  if position('''points'', ''value''' in d) = 0 then
    d := replace(d, 'when ''rules'' then array[''value''', 'when ''rules'' then array[''points'', ''value''');
  end if;
  execute d;
end $$;
revoke all on function private.dispute_fields(text) from public, anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.award_runs, public.cup_points;
exception when others then null; end $$;

select private.add_same_group_checks();
