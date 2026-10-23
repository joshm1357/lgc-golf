-- 099 — Penalties for breaking a rule, on the scorecard (Josh, 23 Oct 2026: "not taking 6 drives from each player is
-- 2 strokes per drive under the requirement").
--
-- ADDITIVE, with ONE check widened (see the clearly marked block below): new nullable columns on rules, rounds and
-- score_adjustments, one new table (penalty_proposals), new functions and triggers. Five existing functions are
-- replaced with the same names and arguments, each a superset of what was there (noted where they are). Nothing is
-- renamed. Older app versions keep working: they see the drives rule as an ordinary Rulebook rule ("6 drives each in
-- a three · …", which their round set-up still reads as 6), and they add any new penalty row to the score exactly as
-- they add a late-job one (a proposal is a separate table, so an unconfirmed one never reaches an old phone's total).
--
-- In plain words:
--   * Any Rulebook rule can carry a penalty: rules.breach_strokes = strokes per breach (0–10). It's changed the same
--     way as the rule (the group's decision rule; anyone can dispute it, and an upheld verdict applies in one tap).
--   * Every group gets a standard rule, "Ambrose minimum drives" (system_key 'ambrose_drives'): each player's drive
--     must be used N times; each drive short costs the team P strokes. N is set per team size for an 18-hole round
--     (drives_2 / drives_3 / drives_4; defaults 6 / 6 / 4), scaled for 9 holes (half, rounded down) and never more
--     than a fair share of the holes. P = breach_strokes (default 2). A group that already had its own "N drives"
--     Ambrose rule (L.G.C's "Minimum drives — 6 drives each") has that rule turned into the standard one — no
--     duplicate — with its N kept for a team of three.
--   * For one round, the organiser can change N (rounds.min_drives, as before) and P (rounds.drive_penalty, new).
--   * Whose drive is already saved per hole (scores.tee_shot_player, 010) and queues offline with the score.
--   * When an Ambrose round is locked, each player short of N becomes a score_adjustments row on the team:
--     "Drives: Cy 4 of 6 (+4)" (kind 'rule_breach'). A team that recorded no drives at all gets nothing (it wasn't
--     tracked). Re-locking after a reopen re-counts (a waived row, or one a dispute verdict changed, is left alone).
--   * Any rule broken on the course: apply_rule_penalty(round, player, rule, strokes, hole, note). An organiser's
--     goes straight on; a player's is a proposal (penalty_proposals) until an organiser confirms it; guests can't.
--     On an Ambrose team the player's strokes count for the team (as late-job penalties already do).
--   * An organiser waives a rule penalty in one tap (waive_rule_penalty — recorded who and when). Anyone (not
--     guests) disputes it with the existing RuleTag / Tribunal flow (score_adjustments.strokes was already disputable).
--   * Also fixed here: 087 replaced dispute_value and apply_dispute_verdict without 085's late-job numbers, so an
--     upheld verdict on "Late job strokes / days" or on a penalty's strokes could no longer be applied. Put back.

-- ============================================================================================ WIDENED CHECK (for Josh)
-- score_adjustments.kind allowed only 'late_job' (085). It now allows a SUPERSET:
--   'late_job'    — as before (late organising jobs, 085)
--   'rule_breach' — this migration (drives short, or any rule broken on the course)
--   'award'       — reserved for migration 100 (strokes won or copped from an award/fine, e.g. "Latest out (−1)")
-- Every existing row is 'late_job', so every existing row still passes. This is the only DROP in 099.
alter table public.score_adjustments drop constraint if exists score_adjustments_kind_check;
alter table public.score_adjustments add constraint score_adjustments_kind_check
  check (kind in ('late_job', 'rule_breach', 'award'));
-- ============================================================================================ end of widened check

-- ============================================================================================ rules: the numbers
alter table public.rules add column if not exists breach_strokes int check (breach_strokes is null or breach_strokes between 0 and 10);
alter table public.rules add column if not exists drives_2 int check (drives_2 is null or drives_2 between 0 and 9);
alter table public.rules add column if not exists drives_3 int check (drives_3 is null or drives_3 between 0 and 9);
alter table public.rules add column if not exists drives_4 int check (drives_4 is null or drives_4 between 0 and 9);

-- Same words as drivesValue() / drivesDetail() in src/lib/drives.js.
create or replace function private.drives_value(p2 int, p3 int, p4 int, p_strokes int) returns text
language sql immutable set search_path = '' as $$
  select coalesce(p3, 6) || ' drives each in a three · ' || coalesce(p4, 4) || ' in a four · ' || coalesce(p2, 6) || ' in a pair · +'
    || coalesce(p_strokes, 2) || ' a drive short'
$$;
create or replace function private.drives_detail(p2 int, p3 int, p4 int, p_strokes int) returns text
language sql immutable set search_path = '' as $$
  select 'In Ambrose, each player’s drive must be used at least ' || coalesce(p3, 6) || ' times in a team of three, '
    || coalesce(p4, 4) || ' in a team of four and ' || coalesce(p2, 6) || ' in a pair (over 18 holes; half that on 9). '
    || 'Each drive short costs the team ' || coalesce(p_strokes, 2) || ' stroke' || case when coalesce(p_strokes, 2) = 1 then '' else 's' end
    || ', added when the round is locked. Tap whose drive it was on each hole. The organiser can change the numbers for a round and waive a penalty; anyone can dispute it.'
$$;
revoke all on function private.drives_value(int, int, int, int) from public, anon, authenticated;
revoke all on function private.drives_detail(int, int, int, int) from public, anon, authenticated;

-- Before the governance guard (ab_), so changing a number on the drives rule changes its value line, which the guard
-- treats as a change to the rule (the group's decision rule applies; a new version is recorded). For any other rule,
-- the penalty is a number beside the rule: in a group that changes rules by vote, an organiser can't just change it.
-- As 085, plus: the server can turn a group's own rule into a standard one, once (app.adopt_rule — used only by
-- seed_drives_rule below). Otherwise the standard key still can't be set, changed or cleared from the app.
create or replace function private.rules_system() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_server boolean := coalesce(current_setting('app.gov_apply', true), '') = 'on'
                             or coalesce(current_setting('app.late_job', true), '') = 'on';
        v_adopt boolean := coalesce(current_setting('app.adopt_rule', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_server then new.system_key := null; end if;
  elsif not (v_adopt and old.system_key is null) then
    new.system_key := old.system_key;
  end if;
  if new.system_key is distinct from 'late_job' then
    new.late_strokes := null; new.late_days := null;
    return new;
  end if;
  new.late_strokes := coalesce(new.late_strokes, 0);
  new.late_days := coalesce(new.late_days, 5);
  new.value := private.late_job_value(new.late_strokes, new.late_days);
  if tg_op = 'INSERT' or new.detail is null
     or (new.detail is not distinct from old.detail and old.detail is not distinct from private.late_job_detail(old.late_strokes, old.late_days)) then
    new.detail := private.late_job_detail(new.late_strokes, new.late_days);
  end if;
  return new;
end $$;
revoke all on function private.rules_system() from public, anon, authenticated;

create or replace function private.rules_breach() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_key text := case when tg_op = 'UPDATE' and not (coalesce(current_setting('app.adopt_rule', true), '') = 'on' and old.system_key is null)
                           then old.system_key else new.system_key end;
        v_server boolean := coalesce(current_setting('app.gov_apply', true), '') = 'on';
begin
  if tg_op = 'INSERT' and not v_server then v_key := null; end if;
  if v_key is distinct from 'ambrose_drives' then
    new.drives_2 := null; new.drives_3 := null; new.drives_4 := null;
    if tg_op = 'UPDATE' and not v_server and old.status = 'active' and new.breach_strokes is distinct from old.breach_strokes
       and coalesce(private.gov_settings(new.group_id, 'change_rule')->>'decides', 'organiser') <> 'organiser' then
      raise exception 'Your group changes rules by vote — challenge the rule instead';
    end if;
    return new;
  end if;
  new.drives_2 := coalesce(new.drives_2, 6);
  new.drives_3 := coalesce(new.drives_3, 6);
  new.drives_4 := coalesce(new.drives_4, 4);
  new.breach_strokes := coalesce(new.breach_strokes, 2);
  new.value := private.drives_value(new.drives_2, new.drives_3, new.drives_4, new.breach_strokes);
  if tg_op = 'INSERT' or new.detail is null
     or (new.detail is not distinct from old.detail
         and old.detail is not distinct from private.drives_detail(old.drives_2, old.drives_3, old.drives_4, old.breach_strokes)) then
    new.detail := private.drives_detail(new.drives_2, new.drives_3, new.drives_4, new.breach_strokes);
  end if;
  return new;
end $$;
revoke all on function private.rules_breach() from public, anon, authenticated;
create or replace trigger aa_rules_breach before insert or update on public.rules
  for each row execute function private.rules_breach();

-- Put the standard drives rule in a group's Rulebook (once). A group's own active "N drives" Ambrose rule becomes it.
create or replace function private.seed_drives_rule(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_own uuid; v_n int;
begin
  if p_group is null or exists (select 1 from public.rules where group_id = p_group and system_key = 'ambrose_drives') then return; end if;
  perform set_config('app.gov_apply', 'on', true);
  select id, least(9, (substring(lower(coalesce(value, '') || ' ' || title) from '(\d+)\s*drive'))::int) into v_own, v_n
  from public.rules
  where group_id = p_group and status = 'active' and system_key is null and award_kind is null
    and applies_to && array['ambrose', 'all'] and (coalesce(value, '') || ' ' || title) ~* '(\d+)\s*drive'
  order by (applies_to @> array['ambrose']) desc, sort, created_at
  limit 1;
  if v_own is not null then
    perform set_config('app.adopt_rule', 'on', true);
    update public.rules set system_key = 'ambrose_drives', drives_3 = v_n, drives_4 = least(4, v_n), drives_2 = 6,
      breach_strokes = 2, detail = null,
      decision_note = left(coalesce(nullif(decision_note, '') || ' · ', '') || 'Made the standard drives rule (with a penalty) on 23 Oct 2026.', 500)
    where id = v_own;
    perform set_config('app.adopt_rule', '', true);
  else
    insert into public.rules (group_id, title, detail, category, applies_to, value, status, proposed_by, decided_at, decision_note, sort,
      system_key, drives_2, drives_3, drives_4, breach_strokes)
    values (p_group, 'Ambrose minimum drives', null, 'format', '{ambrose}', null, 'active', null, now(),
      'Standard rule — the usual numbers; the group can change them.', 905, 'ambrose_drives', 6, 6, 4, 2)
    on conflict (group_id, system_key) where system_key is not null do nothing;
  end if;
  perform set_config('app.gov_apply', '', true);
end $$;
revoke all on function private.seed_drives_rule(uuid) from public, anon, authenticated;

create or replace function private.drives_new_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.seed_drives_rule(new.id);
  exception when others then
    raise warning 'drives rule for a new group: %', sqlerrm;   -- never stop a group being made
  end;
  return new;
end $$;
revoke all on function private.drives_new_group() from public, anon, authenticated;
create or replace trigger zz_drives_new_group after insert on public.groups
  for each row execute function private.drives_new_group();

-- The standard rule doesn't count as "the group has rules" (starter rulebooks, history import): as 085 did for its
-- rule, these already check "system_key is null".

-- ============================================================================================ rounds: this round's numbers
-- rounds.min_drives (010) stays this round's N (blank = the Rulebook's, by team size). drive_penalty is this round's P.
alter table public.rounds add column if not exists drive_penalty int check (drive_penalty is null or drive_penalty between 0 and 10);

-- ============================================================================================ score_adjustments: more detail
alter table public.score_adjustments add column if not exists applied_by uuid references public.players(id) on delete set null;
alter table public.score_adjustments add column if not exists proposed_by uuid references public.players(id) on delete set null;
alter table public.score_adjustments add column if not exists hole int check (hole is null or hole between 1 and 18);
alter table public.score_adjustments add column if not exists note text check (note is null or length(note) <= 200);
-- 'drives' on the automatic drives rows: one per player per round.
alter table public.score_adjustments add column if not exists breach_key text check (breach_key is null or breach_key ~ '^[a-z_]{2,30}$');
create unique index if not exists score_adjustments_breach_once on public.score_adjustments (round_id, player_id, breach_key) where breach_key is not null;
create index if not exists score_adjustments_applied_by_idx on public.score_adjustments (applied_by);
create index if not exists score_adjustments_proposed_by_idx on public.score_adjustments (proposed_by);

-- As 085, for every kind: the "(+2)" / "(−1)" on the end of a label follows its strokes (a verdict can change them).
create or replace function private.score_adjustments_label() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.strokes is distinct from old.strokes then
    new.label := left(regexp_replace(new.label, '\s*\([+−-]?\d+\)$', ''), 150)
      || ' (' || case when new.strokes < 0 then '−' || abs(new.strokes) else '+' || new.strokes end || ')';
  end if;
  return new;
end $$;
revoke all on function private.score_adjustments_label() from public, anon, authenticated;

-- ============================================================================================ proposals
-- A player's "he broke this rule" — waits for an organiser. Server writes only; members read.
create table if not exists public.penalty_proposals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  rule_id uuid references public.rules(id) on delete set null,
  strokes int not null check (strokes between 1 and 10),
  hole int check (hole is null or hole between 1 and 18),
  note text check (note is null or length(note) <= 200),
  label text not null check (length(label) between 2 and 160),
  proposed_by uuid references public.players(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'confirmed', 'declined')),
  decided_by uuid references public.players(id) on delete set null,
  decided_at timestamptz,
  adjustment_id uuid references public.score_adjustments(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists penalty_proposals_group_idx on public.penalty_proposals (group_id);
create index if not exists penalty_proposals_round_idx on public.penalty_proposals (round_id);
create index if not exists penalty_proposals_player_idx on public.penalty_proposals (player_id);
create index if not exists penalty_proposals_rule_idx on public.penalty_proposals (rule_id);
create index if not exists penalty_proposals_proposed_by_idx on public.penalty_proposals (proposed_by);
create index if not exists penalty_proposals_decided_by_idx on public.penalty_proposals (decided_by);
create index if not exists penalty_proposals_adjustment_idx on public.penalty_proposals (adjustment_id);
alter table public.penalty_proposals enable row level security;
create policy "members read" on public.penalty_proposals for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "same group only" on public.penalty_proposals as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke all on public.penalty_proposals from anon, authenticated;
grant select on public.penalty_proposals to authenticated;
create or replace trigger aa_fill_group_id before insert or update on public.penalty_proposals
  for each row execute function private.fill_group_id('rounds:round_id');

do $$ begin
  alter publication supabase_realtime add table public.penalty_proposals;
exception when others then null; end $$;

-- ============================================================================================ the drives maths
-- Same as minDrivesFor() in src/lib/drives.js. Base N for 18 holes by team size; scaled to the holes; never more
-- than a fair share (holes ÷ team size). The round's own N (rounds.min_drives) wins when it's set.
create or replace function private.drives_needed(p_round_n int, p2 int, p3 int, p4 int, p_size int, p_holes int) returns int
language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_size, 0) < 2 or coalesce(p_holes, 0) < 1 then 0
    when p_round_n is not null then greatest(0, least(p_round_n, p_holes / p_size))
    else greatest(0, least(
      (case p_size when 2 then coalesce(p2, 6) when 3 then coalesce(p3, 6) when 4 then coalesce(p4, 4)
                   else (coalesce(p4, 4) * 4) / p_size end) * p_holes / 18,
      p_holes / p_size)) end
$$;
revoke all on function private.drives_needed(int, int, int, int, int, int) from public, anon, authenticated;

-- Every player short of their drives in an Ambrose round → one row each (only teams that recorded any drives).
create or replace function private.drive_shortfalls(p_round uuid)
returns table (team_id uuid, player_id uuid, name text, used int, needed int, short int, strokes int, rule_id uuid)
language sql stable security definer set search_path = '' as $$
  with rd as (
    select r.*, coalesce(jsonb_array_length(case when jsonb_typeof(c.holes) = 'array' then c.holes end), 18) as n_holes
    from public.rounds r left join public.courses c on c.id = r.course_id
    where r.id = p_round and r.format = 'ambrose'
  ), rule as (
    select ru.* from public.rules ru join rd on ru.group_id = rd.group_id where ru.system_key = 'ambrose_drives' and ru.status = 'active'
  ), p as (
    -- P: the round's, else the rule's. With the rule retired, only a round that sets both its own N and P counts.
    select coalesce(rd.drive_penalty, (select breach_strokes from rule)) as per, (select id from rule) as rule_id,
           exists (select 1 from rule) or (rd.min_drives is not null and rd.drive_penalty is not null) as on_
    from rd
  ), team as (
    select t.id, count(tp.player_id)::int as size from public.teams t join rd on t.round_id = rd.id
    join public.team_players tp on tp.team_id = t.id group by t.id
  ), used as (
    select s.subject_id as team_id, s.tee_shot_player as player_id, count(*)::int as n
    from public.scores s join rd on s.round_id = rd.id
    where s.subject_type = 'team' and s.tee_shot_player is not null group by 1, 2
  ), tracked as (select distinct team_id from used)
  select team.id, tp.player_id, coalesce(nullif(btrim(pl.nickname), ''), pl.name), coalesce(u.n, 0),
         x.needed, x.needed - coalesce(u.n, 0), (x.needed - coalesce(u.n, 0)) * p.per, p.rule_id
  from team
  join rd on true join p on true
  join public.team_players tp on tp.team_id = team.id
  join public.players pl on pl.id = tp.player_id
  left join used u on u.team_id = team.id and u.player_id = tp.player_id
  cross join lateral (select private.drives_needed(rd.min_drives, (select drives_2 from rule), (select drives_3 from rule),
                                                   (select drives_4 from rule), team.size, rd.n_holes) as needed) x
  where p.on_ and coalesce(p.per, 0) > 0 and team.id in (select team_id from tracked) and coalesce(u.n, 0) < x.needed
$$;
revoke all on function private.drive_shortfalls(uuid) from public, anon, authenticated;

-- When an Ambrose round is locked: write (or re-count) each shortfall. Returns how many rows are now on the round.
create or replace function private.apply_drive_penalties(p_round uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare rd public.rounds; s record; n int := 0; v_keep uuid[] := '{}';
begin
  select * into rd from public.rounds where id = p_round;
  if rd.id is null or rd.format <> 'ambrose' then return 0; end if;
  for s in select * from private.drive_shortfalls(p_round) loop
    insert into public.score_adjustments (group_id, round_id, player_id, strokes, label, kind, rule_id, breach_key)
    values (rd.group_id, rd.id, s.player_id, s.strokes,
            left('Drives: ' || s.name, 120) || ' ' || s.used || ' of ' || s.needed || ' (+' || s.strokes || ')', 'rule_breach', s.rule_id, 'drives')
    on conflict (round_id, player_id, breach_key) where breach_key is not null do update
      set strokes = excluded.strokes, label = excluded.label, rule_id = excluded.rule_id
      where public.score_adjustments.waived_at is null
        and not exists (select 1 from public.cases c where c.subject_ref->>'table' = 'score_adjustments'
                          and c.subject_ref->>'id' = public.score_adjustments.id::text and c.setting_applied_at is not null);
    v_keep := v_keep || s.player_id;
    n := n + 1;
  end loop;
  -- Re-counted after a reopen and no longer short: the old row goes (unless waived or settled by a verdict).
  delete from public.score_adjustments a
  where a.round_id = rd.id and a.breach_key = 'drives' and a.waived_at is null and not (a.player_id = any (v_keep))
    and not exists (select 1 from public.cases c where c.subject_ref->>'table' = 'score_adjustments'
                      and c.subject_ref->>'id' = a.id::text and c.setting_applied_at is not null);
  return n;
end $$;
revoke all on function private.apply_drive_penalties(uuid) from public, anon, authenticated;

create or replace function private.rounds_drive_penalties() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'locked' and new.format = 'ambrose' and (tg_op = 'INSERT' or old.status is distinct from 'locked') then
    begin
      perform private.apply_drive_penalties(new.id);
    exception when others then
      raise warning 'drive penalties: %', sqlerrm;   -- never stop a round being locked
    end;
  end if;
  return null;
end $$;
revoke all on function private.rounds_drive_penalties() from public, anon, authenticated;
create or replace trigger zz_drive_penalties after insert or update of status on public.rounds
  for each row execute function private.rounds_drive_penalties();

-- ============================================================================================ a penalty on the course
-- Organisers apply it; players propose it (an organiser confirms); guests can't. Returns { status, id }.
create or replace function public.apply_rule_penalty(p_round uuid, p_player uuid, p_rule uuid, p_strokes int default null,
  p_hole int default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rd public.rounds; ru public.rules; v_me uuid; v_strokes int; v_label text; v_note text; v_id uuid;
begin
  select * into rd from public.rounds where id = p_round;
  if rd.id is null or not (rd.group_id = any (private.my_group_ids())) then raise exception 'Round not found'; end if;
  if private.is_group_guest(rd.group_id) then raise exception 'Guests can''t give penalties'; end if;
  v_me := private.my_player_id(rd.group_id);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if rd.status not in ('live', 'locked') then raise exception 'Penalties go on a round once it''s started'; end if;
  if not private.plays_in_round(rd.id, p_player) then raise exception 'Pick someone playing this round'; end if;
  select * into ru from public.rules where id = p_rule and group_id = rd.group_id and status = 'active';
  if ru.id is null then raise exception 'Pick a rule from the Rulebook'; end if;
  v_strokes := coalesce(p_strokes, nullif(ru.breach_strokes, 0));
  if v_strokes is null then raise exception 'How many strokes?'; end if;
  if v_strokes not between 1 and 10 then raise exception 'Penalty strokes: a whole number from 1 to 10'; end if;
  if p_hole is not null and p_hole not between 1 and 18 then raise exception 'Holes are 1 to 18'; end if;
  v_note := nullif(left(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]+', ' ', 'g')), 200), '');
  v_label := left(ru.title, 110) || coalesce(' · hole ' || p_hole, '') || ' (+' || v_strokes || ')';
  if private.is_group_organiser(rd.group_id) then
    insert into public.score_adjustments (group_id, round_id, player_id, strokes, label, kind, rule_id, applied_by, hole, note)
    values (rd.group_id, rd.id, p_player, v_strokes, v_label, 'rule_breach', ru.id, v_me, p_hole, v_note)
    returning id into v_id;
    return jsonb_build_object('status', 'applied', 'id', v_id);
  end if;
  if (select count(*) from public.penalty_proposals where round_id = rd.id and proposed_by = v_me and status = 'open') >= 10 then
    raise exception 'You''ve got 10 waiting already — let an organiser catch up';
  end if;
  insert into public.penalty_proposals (group_id, round_id, player_id, rule_id, strokes, hole, note, label, proposed_by)
  values (rd.group_id, rd.id, p_player, ru.id, v_strokes, p_hole, v_note, v_label, v_me)
  returning id into v_id;
  perform private.gov_queue(rd.group_id, array(select m.player_id from public.group_members m
    where m.group_id = rd.group_id and m.role = 'organiser' and m.player_id is not null), 'penalty_proposed',
    '⚖️ Penalty to confirm: ' || left(v_label, 120), null, v_me);
  return jsonb_build_object('status', 'proposed', 'id', v_id);
end $$;
revoke all on function public.apply_rule_penalty(uuid, uuid, uuid, int, int, text) from public, anon;
grant execute on function public.apply_rule_penalty(uuid, uuid, uuid, int, int, text) to authenticated;
revoke execute on function public.apply_rule_penalty(uuid, uuid, uuid, int, int, text) from service_role;

-- An organiser confirms (optionally changing the strokes) or declines a player's proposal.
create or replace function public.decide_rule_penalty(p_proposal uuid, p_confirm boolean, p_strokes int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pp public.penalty_proposals; v_me uuid; v_strokes int; v_id uuid; v_label text;
begin
  select * into pp from public.penalty_proposals where id = p_proposal for update;
  if pp.id is null or not (pp.group_id = any (private.my_group_ids())) then raise exception 'Not found'; end if;
  if not private.is_group_organiser(pp.group_id) then raise exception 'Only an organiser can confirm a penalty'; end if;
  if pp.status <> 'open' then raise exception 'That one''s already been decided'; end if;
  v_me := private.my_player_id(pp.group_id);
  if not coalesce(p_confirm, false) then
    update public.penalty_proposals set status = 'declined', decided_by = v_me, decided_at = now() where id = pp.id;
    return jsonb_build_object('status', 'declined');
  end if;
  v_strokes := coalesce(p_strokes, pp.strokes);
  if v_strokes not between 1 and 10 then raise exception 'Penalty strokes: a whole number from 1 to 10'; end if;
  v_label := left(regexp_replace(pp.label, '\s*\(\+\d+\)$', ''), 150) || ' (+' || v_strokes || ')';
  insert into public.score_adjustments (group_id, round_id, player_id, strokes, label, kind, rule_id, applied_by, proposed_by, hole, note)
  values (pp.group_id, pp.round_id, pp.player_id, v_strokes, v_label, 'rule_breach', pp.rule_id, v_me, pp.proposed_by, pp.hole, pp.note)
  returning id into v_id;
  update public.penalty_proposals set status = 'confirmed', decided_by = v_me, decided_at = now(), adjustment_id = v_id where id = pp.id;
  return jsonb_build_object('status', 'confirmed', 'id', v_id);
end $$;
revoke all on function public.decide_rule_penalty(uuid, boolean, int) from public, anon;
grant execute on function public.decide_rule_penalty(uuid, boolean, int) to authenticated;
revoke execute on function public.decide_rule_penalty(uuid, boolean, int) from service_role;

-- An organiser waives a rule penalty in one tap (drives or any rule). It stays on the card, struck out.
create or replace function public.waive_rule_penalty(p_adjustment uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.score_adjustments;
begin
  select * into a from public.score_adjustments where id = p_adjustment for update;
  if a.id is null or not (a.group_id = any (private.my_group_ids())) then raise exception 'Not found'; end if;
  if a.kind <> 'rule_breach' then raise exception 'Waive this one where it''s set'; end if;
  if not private.is_group_organiser(a.group_id) then raise exception 'Only an organiser can waive a penalty'; end if;
  if a.waived_at is not null then return jsonb_build_object('status', 'already'); end if;
  update public.score_adjustments set waived_at = now(), waived_by = private.my_player_id(a.group_id) where id = a.id;
  return jsonb_build_object('status', 'waived');
end $$;
revoke all on function public.waive_rule_penalty(uuid) from public, anon;
grant execute on function public.waive_rule_penalty(uuid) to authenticated;
revoke execute on function public.waive_rule_penalty(uuid) from service_role;

-- ============================================================================================ disputes
-- As 093, plus: a rule's penalty and the drives numbers, and this round's drive penalty.
create or replace function private.dispute_fields(p_table text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_table
    when 'rounds' then array['comp_bonus', 'min_drives', 'rules', 'format', 'ctp_holes', 'ld_holes', 'own_comps', 'drive_penalty']
    when 'teams' then array['handicap']
    when 'players' then array['handicap']
    when 'round_games' then array['stake', 'options', 'settings']
    when 'cup_matches' then array['points', 'a_hcp', 'b_hcp']
    when 'trips' then array['cup_points']
    when 'comps' then array['settings']
    when 'side_comp_defs' then array['how', 'unit', 'scoring', 'settings', 'conditions']
    when 'trophies' then array['description']
    when 'custom_games' then array['rules_text', 'settings']
    when 'rules' then array['value', 'title', 'detail', 'late_strokes', 'late_days', 'breach_strokes', 'drives_2', 'drives_3', 'drives_4']
    when 'score_adjustments' then array['strokes']
    when 'dinner_award_nominations' then array['player_id']
    when 'standard' then array['rule']
    else array[]::text[] end
$$;
revoke all on function private.dispute_fields(text) from public, anon, authenticated;

-- As 087 (players' handicaps), plus 085's late job numbers and penalty strokes (which 087 dropped), plus the new numbers.
-- A penalty's strokes may now be negative (an award, migration 100).
create or replace function private.dispute_value(p_table text, p_field text, p_value jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare t text := jsonb_typeof(p_value); n numeric; a jsonb; s text;
begin
  if (p_table, p_field) in (('rounds','comp_bonus'), ('rounds','min_drives'), ('rounds','drive_penalty'), ('teams','handicap'), ('players','handicap'),
                            ('round_games','stake'), ('cup_matches','points'), ('cup_matches','a_hcp'), ('cup_matches','b_hcp'), ('trips','cup_points'),
                            ('rules','late_strokes'), ('rules','late_days'), ('rules','breach_strokes'), ('rules','drives_2'), ('rules','drives_3'),
                            ('rules','drives_4'), ('score_adjustments','strokes')) then
    if t = 'null' and (p_table, p_field) in (('rounds','min_drives'), ('rounds','drive_penalty'), ('trips','cup_points')) then return 'null'::jsonb; end if;
    begin n := (p_value #>> '{}')::numeric; exception when others then raise exception 'That needs to be a number'; end;
    if n is null then raise exception 'That needs to be a number'; end if;
    if p_field = 'comp_bonus' and (n <> trunc(n) or n < 0 or n > 10) then raise exception 'Side comp strokes: a whole number from 0 to 10'; end if;
    if p_field = 'min_drives' and (n <> trunc(n) or n < 0 or n > 9) then raise exception 'Minimum drives: a whole number from 0 to 9'; end if;
    if p_field = 'drive_penalty' and (n <> trunc(n) or n < 0 or n > 10) then raise exception 'Strokes per drive short: a whole number from 0 to 10'; end if;
    if p_table = 'teams' and (n < -10 or n > 54) then raise exception 'A team handicap is between −10 and 54'; end if;
    if p_table = 'players' and (n < -10 or n > 54) then raise exception 'A handicap is between −10 and 54'; end if;
    if p_field in ('a_hcp', 'b_hcp') and (n < -10 or n > 54) then raise exception 'A handicap is between −10 and 54'; end if;
    if p_field = 'stake' and (n < 0 or n > 1000 or n * 100 <> trunc(n * 100)) then raise exception 'A stake is dollars and cents, up to $1000'; end if;
    if p_field = 'points' and (n <= 0 or n > 10) then raise exception 'A match is worth more than 0 and up to 10 points'; end if;
    if p_field = 'cup_points' and (n < 0 or n > 200) then raise exception 'The Cup is worth 0 to 200 points'; end if;
    if p_field = 'late_strokes' and (n <> trunc(n) or n < 0 or n > 10) then raise exception 'Late job strokes: a whole number from 0 to 10'; end if;
    if p_field = 'late_days' and (n <> trunc(n) or n < 0 or n > 60) then raise exception 'Days late: a whole number from 0 to 60'; end if;
    if p_field = 'breach_strokes' and (n <> trunc(n) or n < 0 or n > 10) then raise exception 'Penalty strokes: a whole number from 0 to 10'; end if;
    if p_field in ('drives_2', 'drives_3', 'drives_4') and (n <> trunc(n) or n < 0 or n > 9) then raise exception 'Drives each: a whole number from 0 to 9'; end if;
    if p_table = 'score_adjustments' and (n <> trunc(n) or n < -20 or n > 20) then raise exception 'Penalty strokes: a whole number from −20 to 20'; end if;
    return to_jsonb(n);
  end if;
  if (p_table, p_field) in (('rounds','ctp_holes'), ('rounds','ld_holes')) then
    if t <> 'array' or jsonb_array_length(p_value) > 18 then raise exception 'Holes: a list of hole numbers'; end if;
    if exists (select 1 from jsonb_array_elements_text(p_value) h where h !~ '^([1-9]|1[0-8])$') then raise exception 'Holes are 1 to 18'; end if;
    select coalesce(jsonb_agg(distinct (h)::int order by (h)::int), '[]'::jsonb) into a from jsonb_array_elements_text(p_value) h;
    return a;
  end if;
  if (p_table, p_field) in (('rounds','rules'), ('side_comp_defs','how'), ('side_comp_defs','unit'), ('trophies','description'), ('custom_games','rules_text')) then
    if t not in ('string', 'null') then raise exception 'That needs to be words'; end if;
    s := nullif(btrim(coalesce(p_value #>> '{}', '')), '');
    if p_field = 'how' and coalesce(s, '') not in ('lowest', 'highest', 'pick') then raise exception 'How it''s won: lowest, highest or pick'; end if;
    if p_field = 'unit' and length(coalesce(s, '')) > 12 then raise exception 'A unit is up to 12 letters'; end if;
    if p_field = 'rules' and length(coalesce(s, '')) > 1000 then raise exception 'Up to 1000 letters'; end if;
    if p_field = 'description' and length(coalesce(s, '')) > 500 then raise exception 'Up to 500 letters'; end if;
    if p_field = 'rules_text' and length(coalesce(s, '')) > 2000 then raise exception 'Up to 2000 letters'; end if;
    return to_jsonb(s);
  end if;
  raise exception 'This one can''t be changed from the case — change it where it''s set';
end $$;
revoke all on function private.dispute_value(text, text, jsonb) from public, anon, authenticated;

-- As 087 (a player's handicap goes into the handicap history), plus 085's rule numbers (put back) and 099's.
create or replace function public.apply_dispute_verdict(p_case uuid, p_value jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cases; r jsonb; v_table text; v_field text; v_id uuid; v_now jsonb; v_found boolean; v_new jsonb; v_me uuid; v_label text;
        v_words text; v_rule_num boolean;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not (c.group_id = any (private.my_group_ids())) then raise exception 'Case not found'; end if;
  if not private.is_group_organiser(c.group_id) then raise exception 'Only an organiser can apply a verdict'; end if;
  r := c.subject_ref; v_table := r->>'table'; v_field := r->>'field';
  v_rule_num := v_table = 'rules' and v_field in ('late_strokes', 'late_days', 'breach_strokes', 'drives_2', 'drives_3', 'drives_4');
  if c.kind <> 'ruling' or not (c.subject_kind = 'setting' or (c.subject_kind = 'rule' and v_rule_num)) then raise exception 'This case isn''t about a setting'; end if;
  if c.status <> 'passed' then raise exception 'Only an upheld verdict can be applied'; end if;
  if c.setting_applied_at is not null then raise exception 'This verdict has already been applied'; end if;
  if not (v_field = any (private.dispute_fields(v_table))) or (v_table in ('rules', 'standard') and not v_rule_num) or nullif(r->>'key', '') is not null then
    raise exception 'This one can''t be changed from the case — change it where it''s set';
  end if;
  v_id := (r->>'id')::uuid;
  v_new := private.dispute_value(v_table, v_field, p_value);
  -- The table and field come from the fixed list (dispute_fields), so naming them here is safe.
  execute format('select true, to_jsonb(t) -> %L from public.%I t where t.id = $1 and t.group_id = $2 for update', v_field, v_table)
    into v_found, v_now using v_id, c.group_id;
  if v_found is null then raise exception 'That setting isn''t there any more'; end if;
  if v_now is distinct from (r->'value') and not coalesce(p_force, false) then
    return jsonb_build_object('status', 'changed', 'now', v_now, 'raised', r->'value');
  end if;
  if v_new is not distinct from v_now then raise exception 'That''s what it already is'; end if;
  if v_table = 'players' then
    perform set_config('app.handicap_reason', 'Tribunal verdict (dispute)', true);
    perform set_config('app.case_id', c.id::text, true);
  end if;
  if v_rule_num then
    perform set_config('app.gov_apply', 'on', true);
    perform set_config('app.gov_case', c.id::text, true);
  end if;
  if jsonb_typeof(v_new) = 'array' then
    execute format('update public.%I set %I = (select coalesce(array_agg(x::int), ''{}'') from jsonb_array_elements_text($1) x) where id = $2', v_table, v_field)
      using v_new, v_id;
  else
    execute format('update public.%I t set %I = (jsonb_populate_record(t, jsonb_build_object(%L, $1))).%I where id = $2', v_table, v_field, v_field, v_field)
      using v_new, v_id;
  end if;
  if v_rule_num then
    perform set_config('app.gov_apply', '', true);
    perform set_config('app.gov_case', '', true);
  end if;
  v_me := private.my_player_id(c.group_id);
  update public.cases set setting_applied_by = v_me, setting_applied_at = now(),
    setting_change = jsonb_build_object('field', v_field, 'old', v_now, 'new', v_new, 'raised', r->'value', 'forced', coalesce(p_force, false) and v_now is distinct from (r->'value'))
  where id = c.id;
  v_label := coalesce(r->>'label', v_field);
  v_words := coalesce(v_now #>> '{}', 'not set') || ' → ' || coalesce(v_new #>> '{}', 'not set');
  if not c.hidden then
    perform private.gov_post(c.group_id, '⚖️ Verdict applied: ' || left(v_label, 100) || ' — ' || left(v_words, 200), v_me, c.id);
  end if;
  return jsonb_build_object('status', 'applied', 'old', v_now, 'new', v_new);
end $$;
revoke all on function public.apply_dispute_verdict(uuid, jsonb, boolean) from public, anon;
grant execute on function public.apply_dispute_verdict(uuid, jsonb, boolean) to authenticated;
revoke execute on function public.apply_dispute_verdict(uuid, jsonb, boolean) from service_role;

-- ============================================================================================ every group, now
select private.seed_drives_rule(id) from public.groups;

select private.add_same_group_checks();
