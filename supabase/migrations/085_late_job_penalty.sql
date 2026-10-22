-- 085 — Late organising jobs cost strokes (Josh, 22 Oct 2026). ADDITIVE ONLY: three nullable columns on rules, two new
-- tables, new functions and triggers, one cron job. Four existing functions are replaced with the same behaviour plus
-- the new bits (noted where they are). Nothing is dropped or renamed, so older app versions keep working: they see the
-- new rule as an ordinary Rulebook rule ("0 strokes · 5 days") and never see a penalty until a group turns it up.
--
-- In plain words:
--   * Every group gets a standard Rulebook rule, "Late organising job": if you're given a trip job and it's more than
--     N days overdue, you cop X penalty strokes in the next round. It starts at X = 0 strokes (listed, does nothing)
--     and N = 5 days. Organisers change X and N (or retire it) through the normal rule editing, under the group's own
--     decision rule; anyone can dispute the numbers like any rule, and an upheld verdict can be applied in one tap.
--   * The server decides when a job is late (never the app): a job with an owner, not done, more than N days past its
--     due date, on a trip that isn't cancelled or finished, with X > 0 and the planner's jobs switched on.
--   * Once a day the server tells the owner when their job turns late (if notifications are on).
--   * When a round goes live, each late job whose owner is playing in it costs X strokes, once per job, as a
--     score_adjustments row ("Late job: Book the bus (+2)"). The round must be on the job's trip — or, if the job's
--     trip has no rounds still to start (or no trip yet), the next round the owner plays in the group.
--     Finishing the job before that round starts means nothing is added.
--   * An organiser can waive it in one tap (recorded), before or after it's applied.
--
-- score_adjustments is the general place for strokes added to (or taken off) one player's score in one round. The
-- leaderboard adds them in lib/scoring.js. Today only late jobs write to it; only the server writes.

-- ============================================================================================ the rule's numbers
alter table public.rules add column if not exists system_key text
  check (system_key is null or system_key ~ '^[a-z_]{2,30}$');
alter table public.rules add column if not exists late_strokes int
  check (late_strokes is null or late_strokes between 0 and 10);
alter table public.rules add column if not exists late_days int
  check (late_days is null or late_days between 0 and 60);
-- One of each standard rule per group.
create unique index if not exists rules_system_key_once on public.rules (group_id, system_key) where system_key is not null;

create or replace function private.late_job_value(p_strokes int, p_days int) returns text
language sql immutable set search_path = '' as $$
  select coalesce(p_strokes, 0) || ' stroke' || case when coalesce(p_strokes, 0) = 1 then '' else 's' end
    || ' · ' || coalesce(p_days, 5) || ' day' || case when coalesce(p_days, 5) = 1 then '' else 's' end
$$;
create or replace function private.late_job_detail(p_strokes int, p_days int) returns text
language sql immutable set search_path = '' as $$
  select 'If you’re given a trip job and it’s more than ' || coalesce(p_days, 5) || ' day'
    || case when coalesce(p_days, 5) = 1 then '' else 's' end || ' overdue, you cop ' || coalesce(p_strokes, 0)
    || ' penalty stroke' || case when coalesce(p_strokes, 0) = 1 then '' else 's' end
    || ' in the next round. Finish it before that round starts and it’s off. An organiser can waive it.'
    || case when coalesce(p_strokes, 0) = 0 then ' (At 0 strokes it’s listed but nothing happens.)' else '' end
$$;
revoke all on function private.late_job_value(int, int) from public, anon, authenticated;
revoke all on function private.late_job_detail(int, int) from public, anon, authenticated;

-- Only the server makes or re-labels a standard rule; its "worth" line (and its wording, unless an organiser has
-- rewritten it) follows the numbers. Runs before the governance guard (ab_), so a change to the numbers counts as a
-- change to the rule: the group's decision rule applies and a new version is recorded.
create or replace function private.rules_system() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_server boolean := coalesce(current_setting('app.gov_apply', true), '') = 'on'
                             or coalesce(current_setting('app.late_job', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_server then new.system_key := null; end if;
  else
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
create or replace trigger aa_rules_system before insert or update on public.rules
  for each row execute function private.rules_system();

-- A standard rule can be retired (switched off) but not deleted.
create policy "standard rules stay" on public.rules as restrictive for delete to authenticated using (system_key is null);

-- Put the rule in a group's Rulebook (once).
create or replace function private.seed_late_job_rule(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_group is null or exists (select 1 from public.rules where group_id = p_group and system_key = 'late_job') then return; end if;
  -- Put in by the server, not proposed: past the "your group votes on new rules" check, like a starter rulebook.
  perform set_config('app.late_job', 'on', true);
  perform set_config('app.gov_apply', 'on', true);
  insert into public.rules (group_id, title, detail, category, applies_to, value, status, proposed_by, decided_at, decision_note, sort,
    system_key, late_strokes, late_days)
  values (p_group, 'Late organising job', null, 'fines', '{all}', null, 'active', null, now(),
    'Standard rule — starts at 0 strokes, so it’s listed but does nothing until the group changes it.', 900, 'late_job', 0, 5)
  on conflict (group_id, system_key) where system_key is not null do nothing;
  perform set_config('app.late_job', '', true);
  perform set_config('app.gov_apply', '', true);
end $$;
revoke all on function private.seed_late_job_rule(uuid) from public, anon, authenticated;

-- New groups get it too.
create or replace function private.late_job_new_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.seed_late_job_rule(new.id);
  exception when others then
    raise warning 'late job rule for a new group: %', sqlerrm;   -- never stop a group being made
  end;
  return new;
end $$;
revoke all on function private.late_job_new_group() from public, anon, authenticated;
create or replace trigger zz_late_job_new_group after insert on public.groups
  for each row execute function private.late_job_new_group();

-- The standard rule doesn't count as "the group has rules" (starter rulebooks, first rules, history import).
-- As 076, with "and system_key is null" on the first-rules check.
create or replace function private.gov_rules_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_server boolean := coalesce(current_setting('app.gov_apply', true), '') = 'on';
        s_new text; s_change text; s_scrap text; v_wording boolean;
begin
  if v_server then return new; end if;
  s_new := private.gov_settings(new.group_id, 'new_rule')->>'decides';
  if tg_op = 'INSERT' then
    if new.status = 'active' and s_new <> 'organiser' and private.feature_on_safe(new.group_id, 'rule_voting')
       and exists (select 1 from public.rules where group_id = new.group_id and status = 'active' and system_key is null) then
      raise exception 'Your group votes on new rules — put it up for a vote';
    end if;
    return new;
  end if;
  if old.status = 'proposed' and new.status in ('active', 'rejected') and s_new <> 'organiser' then
    raise exception 'Your group votes on new rules — the Tribunal decides this one';
  end if;
  if old.status = 'active' then
    v_wording := (new.title, new.detail, new.value, new.category, new.applies_to, new.scope_kind, new.scope_id, new.scope_key, new.overrides, new.overrides_rule)
      is distinct from (old.title, old.detail, old.value, old.category, old.applies_to, old.scope_kind, old.scope_id, old.scope_key, old.overrides, old.overrides_rule);
    s_change := private.gov_settings(new.group_id, 'change_rule')->>'decides';
    s_scrap := private.gov_settings(new.group_id, 'scrap_rule')->>'decides';
    if v_wording and s_change <> 'organiser' then raise exception 'Your group changes rules by vote — challenge the rule instead'; end if;
    if new.status in ('retired', 'rejected') and s_scrap <> 'organiser' then raise exception 'Your group scraps rules by vote — challenge the rule instead'; end if;
  end if;
  return new;
end $$;
revoke all on function private.gov_rules_guard() from public, anon, authenticated;

-- use_starter_rulebook (032b) and import_rules (070): the same, with the standard rule left out of "already has rules".
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.use_starter_rulebook(text)'::regprocedure);
  if position('system_key is null' in d) = 0 then
    n := regexp_replace(d, 'status in \(''active'', ''proposed''\)\) then', 'status in (''active'', ''proposed'') and system_key is null) then');
    if n = d then raise exception '085: use_starter_rulebook not patched'; end if;
    execute n;
  end if;
  d := pg_get_functiondef('public.import_rules(jsonb)'::regprocedure);
  if position('system_key is null' in d) = 0 then
    n := regexp_replace(d, 'where group_id = v_g and status = ''active''\);', 'where group_id = v_g and status = ''active'' and system_key is null);');
    if n = d then raise exception '085: import_rules not patched'; end if;
    execute n;
  end if;
end $$;

-- ============================================================================================ adjustments
create table if not exists public.score_adjustments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  strokes int not null check (strokes between -20 and 20),
  label text not null check (length(label) between 2 and 160),
  kind text not null default 'late_job' check (kind in ('late_job')),
  item_id uuid references public.plan_items(id) on delete set null,
  rule_id uuid references public.rules(id) on delete set null,
  waived_at timestamptz,
  waived_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Once per job, ever (a second round, a re-run, two triggers at once: never twice).
create unique index if not exists score_adjustments_late_job_once on public.score_adjustments (item_id) where item_id is not null and kind = 'late_job';
create index if not exists score_adjustments_round_idx on public.score_adjustments (round_id);
create index if not exists score_adjustments_group_idx on public.score_adjustments (group_id);
create index if not exists score_adjustments_player_idx on public.score_adjustments (player_id);
create index if not exists score_adjustments_rule_idx on public.score_adjustments (rule_id);
create index if not exists score_adjustments_waived_by_idx on public.score_adjustments (waived_by);
alter table public.score_adjustments enable row level security;
create policy "members read" on public.score_adjustments for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "same group only" on public.score_adjustments as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
-- Only the server's functions write (no insert / update / delete for the app).
revoke all on public.score_adjustments from anon, authenticated;
grant select on public.score_adjustments to authenticated;
create or replace trigger aa_fill_group_id before insert or update on public.score_adjustments
  for each row execute function private.fill_group_id('rounds:round_id');

-- The "(+2)" on a late job's label follows its strokes (a verdict can change them).
create or replace function private.score_adjustments_label() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'late_job' and new.strokes is distinct from old.strokes then
    new.label := left(regexp_replace(new.label, '\s*\([+−-]?\d+\)$', '') || ' (+' || new.strokes || ')', 160);
  end if;
  return new;
end $$;
revoke all on function private.score_adjustments_label() from public, anon, authenticated;
create or replace trigger ac_score_adjustments_label before update on public.score_adjustments
  for each row execute function private.score_adjustments_label();

do $$ begin
  alter publication supabase_realtime add table public.score_adjustments;
exception when others then null; end $$;

-- Per job: when the owner was told it's late, and an organiser's waiver. Server-only writes; members read.
create table if not exists public.job_penalties (
  item_id uuid primary key references public.plan_items(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  notified_owner uuid references public.players(id) on delete set null,
  notified_due date,
  notified_at timestamptz,
  waived_at timestamptz,
  waived_by uuid references public.players(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists job_penalties_group_idx on public.job_penalties (group_id);
create index if not exists job_penalties_notified_owner_idx on public.job_penalties (notified_owner);
create index if not exists job_penalties_waived_by_idx on public.job_penalties (waived_by);
alter table public.job_penalties enable row level security;
create policy "members read" on public.job_penalties for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "same group only" on public.job_penalties as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke all on public.job_penalties from anon, authenticated;
grant select on public.job_penalties to authenticated;
create or replace trigger aa_fill_group_id before insert or update on public.job_penalties
  for each row execute function private.fill_group_id('plan_items:item_id');
do $$ begin
  alter publication supabase_realtime add table public.job_penalties;
exception when others then null; end $$;

-- ============================================================================================ what's late
-- Today in Sydney (as the trips' daily job).
create or replace function private.late_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Australia/Sydney')::date $$;
revoke all on function private.late_today() from public, anon, authenticated;

-- Every late job (optionally one group / one job). Same test as lib/latejobs.js lateInfo().
create or replace function private.late_jobs(p_group uuid default null, p_item uuid default null)
returns table (item_id uuid, group_id uuid, plan_id uuid, trip_id uuid, owner_id uuid, title text, due date,
               days_late int, strokes int, days int, rule_id uuid)
language sql stable security definer set search_path = '' as $$
  select i.id, i.group_id, i.plan_id, p.trip_id, i.owner_id, i.title, i.due,
         (private.late_today() - i.due)::int, r.late_strokes, r.late_days, r.id
  from public.plan_items i
  join public.plans p on p.id = i.plan_id
  join public.rules r on r.group_id = i.group_id and r.system_key = 'late_job' and r.status = 'active' and r.late_strokes > 0
  where i.kind = 'job' and i.owner_id is not null and not i.done and coalesce(i.stage, 'todo') <> 'done' and i.due is not null
    and private.late_today() - i.due > r.late_days
    and p.status in ('planning', 'confirmed')
    and (p_group is null or i.group_id = p_group) and (p_item is null or i.id = p_item)
    and not exists (select 1 from public.job_penalties j where j.item_id = i.id and j.waived_at is not null)
    and public.feature_on(i.group_id, 'planner_tasks')
$$;
revoke all on function private.late_jobs(uuid, uuid) from public, anon, authenticated;

-- A late job's due date is the organiser's to move (otherwise the owner could push it out the night before a round).
create or replace function private.plan_items_late_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.due is distinct from old.due and auth.uid() is not null and not private.is_group_organiser(new.group_id)
     and exists (select 1 from private.late_jobs(old.group_id, old.id)) then
    new.due := old.due;
  end if;
  return new;
end $$;
revoke all on function private.plan_items_late_guard() from public, anon, authenticated;
create or replace trigger plan_items_zz_late_guard before update on public.plan_items
  for each row execute function private.plan_items_late_guard();

-- ============================================================================================ applying it
-- Is this player in this round (on the card, or in a team)?
create or replace function private.plays_in_round(p_round uuid, p_player uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.round_players where round_id = p_round and player_id = p_player)
      or exists (select 1 from public.team_players tp join public.teams t on t.id = tp.team_id where t.round_id = p_round and tp.player_id = p_player)
$$;
revoke all on function private.plays_in_round(uuid, uuid) from public, anon, authenticated;

-- When a round starts: one adjustment per late job whose owner plays in it. Returns how many were added.
create or replace function private.apply_late_job_penalties(p_round uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare rd public.rounds; l record; n int := 0; k int;
begin
  select * into rd from public.rounds where id = p_round;
  if rd.id is null then return 0; end if;
  for l in select * from private.late_jobs(rd.group_id, null) loop
    if not private.plays_in_round(rd.id, l.owner_id) then continue; end if;
    -- The job's own trip first; another round only when the job's trip has no rounds still to start.
    if l.trip_id is distinct from rd.trip_id
       and exists (select 1 from public.rounds r2 where r2.trip_id = l.trip_id and r2.group_id = rd.group_id and r2.status = 'setup' and r2.id <> rd.id) then
      continue;
    end if;
    insert into public.score_adjustments (group_id, round_id, player_id, strokes, label, kind, item_id, rule_id)
    values (rd.group_id, rd.id, l.owner_id, l.strokes, left('Late job: ' || l.title, 150) || ' (+' || l.strokes || ')', 'late_job', l.item_id, l.rule_id)
    on conflict (item_id) where item_id is not null and kind = 'late_job' do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;
revoke all on function private.apply_late_job_penalties(uuid) from public, anon, authenticated;

create or replace function private.rounds_late_jobs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    begin
      perform private.apply_late_job_penalties(new.id);
    exception when others then
      raise warning 'late job penalties: %', sqlerrm;   -- never stop a round starting
    end;
  end if;
  return null;
end $$;
revoke all on function private.rounds_late_jobs() from public, anon, authenticated;
create or replace trigger zz_late_jobs after insert or update of status on public.rounds
  for each row execute function private.rounds_late_jobs();

-- ============================================================================================ telling the owner
-- Once a day: each job that has turned late (for its current owner and due date) gets one notification to its owner.
create or replace function private.late_jobs_tick() returns int
language plpgsql security definer set search_path = '' as $$
declare l record; n int := 0;
begin
  for l in
    select lj.* from private.late_jobs() lj
    left join public.job_penalties j on j.item_id = lj.item_id
    where j.item_id is null or j.notified_at is null or j.notified_owner is distinct from lj.owner_id or j.notified_due is distinct from lj.due
  loop
    insert into public.job_penalties (item_id, group_id, notified_owner, notified_due, notified_at)
    values (l.item_id, l.group_id, l.owner_id, l.due, now())
    on conflict (item_id) do update set notified_owner = excluded.notified_owner, notified_due = excluded.notified_due,
      notified_at = excluded.notified_at, updated_at = now();
    perform private.gov_queue(l.group_id, array[l.owner_id], 'late_job',
      '⚠️ ' || l.title || ' is ' || l.days_late || ' days late',
      l.strokes || ' penalty stroke' || case when l.strokes = 1 then '' else 's' end || ' if it’s not done before the next round.');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.late_jobs_tick() from public, anon, authenticated;

-- 8:10 am Sydney (summer time). Scheduling the same name again just updates it.
select cron.schedule('lgc-late-jobs', '10 21 * * *', 'select private.late_jobs_tick()');

-- ============================================================================================ waiving it
-- An organiser waives a late job's penalty in one tap — before the round (nothing will be added) or after (the
-- adjustment stays on record, marked waived, and stops counting). Returns { status, applied }.
create or replace function public.waive_late_penalty(p_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_g uuid; v_me uuid; k int;
begin
  select group_id into v_g from public.plan_items where id = p_item and kind = 'job';
  if v_g is null or not (v_g = any (private.my_group_ids())) then raise exception 'Job not found'; end if;
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can waive a penalty'; end if;
  perform private.require_feature(v_g, 'planner_tasks');
  v_me := private.my_player_id(v_g);
  insert into public.job_penalties (item_id, group_id, waived_at, waived_by)
  values (p_item, v_g, now(), v_me)
  on conflict (item_id) do update set waived_at = coalesce(public.job_penalties.waived_at, excluded.waived_at),
    waived_by = coalesce(public.job_penalties.waived_by, excluded.waived_by), updated_at = now();
  update public.score_adjustments set waived_at = now(), waived_by = v_me
  where item_id = p_item and kind = 'late_job' and waived_at is null;
  get diagnostics k = row_count;
  return jsonb_build_object('status', 'waived', 'applied', k > 0);
end $$;
revoke all on function public.waive_late_penalty(uuid) from public, anon;
grant execute on function public.waive_late_penalty(uuid) to authenticated;
revoke execute on function public.waive_late_penalty(uuid) from service_role;

-- ============================================================================================ disputes
-- As 082, plus the late job rule's two numbers and one player's penalty.
create or replace function private.dispute_fields(p_table text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_table
    when 'rounds' then array['comp_bonus', 'min_drives', 'rules', 'format', 'ctp_holes', 'ld_holes', 'own_comps']
    when 'teams' then array['handicap']
    when 'round_games' then array['stake', 'options', 'settings']
    when 'cup_matches' then array['points', 'a_hcp', 'b_hcp']
    when 'trips' then array['cup_points']
    when 'comps' then array['settings']
    when 'side_comp_defs' then array['how', 'unit', 'scoring', 'settings', 'conditions']
    when 'trophies' then array['description']
    when 'custom_games' then array['rules_text', 'settings']
    when 'rules' then array['value', 'title', 'detail', 'late_strokes', 'late_days']
    when 'score_adjustments' then array['strokes']
    when 'standard' then array['rule']
    else array[]::text[] end
$$;
revoke all on function private.dispute_fields(text) from public, anon, authenticated;

-- As 084, plus the late job numbers and a penalty's strokes.
create or replace function private.dispute_value(p_table text, p_field text, p_value jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare t text := jsonb_typeof(p_value); n numeric; a jsonb; s text;
begin
  -- Whole numbers / numbers with a range.
  if (p_table, p_field) in (('rounds','comp_bonus'), ('rounds','min_drives'), ('teams','handicap'), ('round_games','stake'),
                            ('cup_matches','points'), ('cup_matches','a_hcp'), ('cup_matches','b_hcp'), ('trips','cup_points'),
                            ('rules','late_strokes'), ('rules','late_days'), ('score_adjustments','strokes')) then
    if t = 'null' and (p_table, p_field) in (('rounds','min_drives'), ('trips','cup_points')) then return 'null'::jsonb; end if;
    begin n := (p_value #>> '{}')::numeric; exception when others then raise exception 'That needs to be a number'; end;
    if n is null then raise exception 'That needs to be a number'; end if;
    if p_field = 'comp_bonus' and (n <> trunc(n) or n < 0 or n > 10) then raise exception 'Side comp strokes: a whole number from 0 to 10'; end if;
    if p_field = 'min_drives' and (n <> trunc(n) or n < 0 or n > 9) then raise exception 'Minimum drives: a whole number from 0 to 9'; end if;
    if p_table = 'teams' and (n < -10 or n > 54) then raise exception 'A team handicap is between −10 and 54'; end if;
    if p_field in ('a_hcp', 'b_hcp') and (n < -10 or n > 54) then raise exception 'A handicap is between −10 and 54'; end if;
    if p_field = 'stake' and (n < 0 or n > 1000 or n * 100 <> trunc(n * 100)) then raise exception 'A stake is dollars and cents, up to $1000'; end if;
    if p_field = 'points' and (n <= 0 or n > 10) then raise exception 'A match is worth more than 0 and up to 10 points'; end if;
    if p_field = 'cup_points' and (n < 0 or n > 200) then raise exception 'The Cup is worth 0 to 200 points'; end if;
    if p_field = 'late_strokes' and (n <> trunc(n) or n < 0 or n > 10) then raise exception 'Late job strokes: a whole number from 0 to 10'; end if;
    if p_field = 'late_days' and (n <> trunc(n) or n < 0 or n > 60) then raise exception 'Days late: a whole number from 0 to 60'; end if;
    if p_table = 'score_adjustments' and (n <> trunc(n) or n < 0 or n > 20) then raise exception 'Penalty strokes: a whole number from 0 to 20'; end if;
    return to_jsonb(n);
  end if;
  -- Holes.
  if (p_table, p_field) in (('rounds','ctp_holes'), ('rounds','ld_holes')) then
    if t <> 'array' or jsonb_array_length(p_value) > 18 then raise exception 'Holes: a list of hole numbers'; end if;
    if exists (select 1 from jsonb_array_elements_text(p_value) h where h !~ '^([1-9]|1[0-8])$') then raise exception 'Holes are 1 to 18'; end if;
    select coalesce(jsonb_agg(distinct (h)::int order by (h)::int), '[]'::jsonb) into a from jsonb_array_elements_text(p_value) h;
    return a;
  end if;
  -- Words.
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

-- As 084, plus: a dispute about the late job rule's numbers (a 'rule' dispute) can be applied too — written as the
-- verdict of the case (the rule's history records it against the case; the group's change rule is the case itself).
create or replace function public.apply_dispute_verdict(p_case uuid, p_value jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cases; r jsonb; v_table text; v_field text; v_id uuid; v_now jsonb; v_found boolean; v_new jsonb; v_me uuid; v_label text;
        v_words text; v_rule_num boolean;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not (c.group_id = any (private.my_group_ids())) then raise exception 'Case not found'; end if;
  if not private.is_group_organiser(c.group_id) then raise exception 'Only an organiser can apply a verdict'; end if;
  r := c.subject_ref; v_table := r->>'table'; v_field := r->>'field';
  v_rule_num := v_table = 'rules' and v_field in ('late_strokes', 'late_days');
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
  if v_rule_num then
    perform set_config('app.gov_apply', 'on', true);
    perform set_config('app.gov_case', c.id::text, true);
  end if;
  -- Write it. Arrays become int[]; the table's own triggers (feature switches, checks) still run.
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
select private.seed_late_job_rule(id) from public.groups;

select private.add_same_group_checks();
