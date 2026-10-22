-- 085 test: late organising jobs cost strokes. STAGING only, after 085. Rolled back; results in the error message
-- ("RESULTS: ..."). Expected answers in 085_late_job_penalty.expected.txt.
-- Group J: jo — organiser, j1 — player (owns the jobs), j2 — player, jg — guest. Group K: ko — organiser of another group.
begin;
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_ids (k text primary key, id uuid);
grant all on t_ids to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000f500', 'test-j85', 'Test Group J85', 'J85-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000f600', 'test-k85', 'Test Group K85', 'K85-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000000f5a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f5a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f5a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f5a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f6a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000f5b01', '00000000-0000-4000-8000-00000000f500', 'J Organiser', 10),
  ('00000000-0000-4000-8000-0000000f5b02', '00000000-0000-4000-8000-00000000f500', 'J One', 15),
  ('00000000-0000-4000-8000-0000000f5b03', '00000000-0000-4000-8000-00000000f500', 'J Two', 18),
  ('00000000-0000-4000-8000-0000000f5b04', '00000000-0000-4000-8000-00000000f500', 'J Guest', 20),
  ('00000000-0000-4000-8000-0000000f6b01', '00000000-0000-4000-8000-00000000f600', 'K Organiser', 12);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5a01', '00000000-0000-4000-8000-0000000f5b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5a02', '00000000-0000-4000-8000-0000000f5b02', 'player'),
  ('00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5a03', '00000000-0000-4000-8000-0000000f5b03', 'player'),
  ('00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5a04', '00000000-0000-4000-8000-0000000f5b04', 'guest'),
  ('00000000-0000-4000-8000-00000000f600', '00000000-0000-4000-8000-0000000f6a01', '00000000-0000-4000-8000-0000000f6b01', 'organiser');
-- J: an organiser decides rule changes (as L.G.C). Planner jobs on (the default), Tribunal on.
select private.gov_apply_preset('00000000-0000-4000-8000-00000000f500', 'organiser', null);
insert into public.group_features (group_id, feature_key, enabled) values
  ('00000000-0000-4000-8000-00000000f500', 'planner_tasks', true), ('00000000-0000-4000-8000-00000000f600', 'planner_tasks', true)
  on conflict (group_id, feature_key) do update set enabled = true;

-- ================= the rule is there for new groups, at 0 strokes / 5 days =================
insert into t_results (label, result) select 'new group J has the rule', coalesce(string_agg(title || ' · ' || value || ' · ' || category || ' · ' || status, ','), 'none')
  from public.rules where group_id = '00000000-0000-4000-8000-00000000f500' and system_key = 'late_job';
insert into t_results (label, result) select 'J rule numbers', late_strokes || '/' || late_days from public.rules where group_id = '00000000-0000-4000-8000-00000000f500' and system_key = 'late_job';
insert into t_results (label, result) select 'seeding again adds nothing', (select private.seed_late_job_rule('00000000-0000-4000-8000-00000000f500'))::text || ' ' ||
  (select count(*) from public.rules where group_id = '00000000-0000-4000-8000-00000000f500' and system_key = 'late_job')::text;
insert into t_results (label, result) select 'every group has exactly one', (select count(*) from public.groups g where (select count(*) from public.rules r where r.group_id = g.id and r.system_key = 'late_job') <> 1)::text || ' without';
insert into t_ids select 'rule', id from public.rules where group_id = '00000000-0000-4000-8000-00000000f500' and system_key = 'late_job';
insert into t_ids select 'krule', id from public.rules where group_id = '00000000-0000-4000-8000-00000000f600' and system_key = 'late_job';

-- Trip, course, plan and two rounds (setup). j1 and j2 play both; jo doesn't.
insert into public.trips (id, group_id, name) values ('00000000-0000-4000-8000-0000000f5c01', '00000000-0000-4000-8000-00000000f500', 'J trip'),
  ('00000000-0000-4000-8000-0000000f5c09', '00000000-0000-4000-8000-00000000f500', 'J next trip');
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000f5c02', '00000000-0000-4000-8000-00000000f500', 'J course', '[{"n":1,"par":4,"si":1}]');
insert into public.plans (id, group_id, kind, name, status, start_date, trip_id) values
  ('00000000-0000-4000-8000-0000000f5d01', '00000000-0000-4000-8000-00000000f500', 'trip', 'J trip plan', 'confirmed', private.late_today() + 1, '00000000-0000-4000-8000-0000000f5c01'),
  ('00000000-0000-4000-8000-0000000f5d02', '00000000-0000-4000-8000-00000000f500', 'trip', 'J next trip plan', 'confirmed', private.late_today() + 60, '00000000-0000-4000-8000-0000000f5c09');
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status) values
  ('00000000-0000-4000-8000-0000000f5e01', '00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5c01', '00000000-0000-4000-8000-0000000f5c02', 'J round 1', 'stableford', 'setup'),
  ('00000000-0000-4000-8000-0000000f5e02', '00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5c01', '00000000-0000-4000-8000-0000000f5c02', 'J round 2', 'stableford', 'setup'),
  ('00000000-0000-4000-8000-0000000f5e09', '00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5c09', '00000000-0000-4000-8000-0000000f5c02', 'J next trip round', 'stableford', 'setup');
insert into public.round_players (round_id, player_id, playing_handicap) values
  ('00000000-0000-4000-8000-0000000f5e01', '00000000-0000-4000-8000-0000000f5b02', 15), ('00000000-0000-4000-8000-0000000f5e01', '00000000-0000-4000-8000-0000000f5b03', 18),
  ('00000000-0000-4000-8000-0000000f5e02', '00000000-0000-4000-8000-0000000f5b02', 15), ('00000000-0000-4000-8000-0000000f5e02', '00000000-0000-4000-8000-0000000f5b03', 18);
-- Jobs (all owned by j1 unless said):
--   bus    due 7 days ago, open           → late (7 > 5)
--   shirts due 7 days ago, done           → not late
--   menu   due 3 days ago, open           → not late (3 ≤ 5)
--   wine   due 9 days ago, open           → late, waived before the round
--   nobody due 9 days ago, no owner       → not late
--   j2job  due 8 days ago, owned by jo (not playing round 1)
--   later  due 8 days ago, j1, on the NEXT trip (which has a round still to start) → waits for that trip
insert into public.plan_items (id, group_id, plan_id, kind, title, owner_id, due, done, stage) values
  ('00000000-0000-4000-8000-0000000f5f01', '00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5d01', 'job', 'Book the bus', '00000000-0000-4000-8000-0000000f5b02', private.late_today() - 7, false, 'todo'),
  ('00000000-0000-4000-8000-0000000f5f02', '00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5d01', 'job', 'Order shirts', '00000000-0000-4000-8000-0000000f5b02', private.late_today() - 7, true, 'done'),
  ('00000000-0000-4000-8000-0000000f5f03', '00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5d01', 'job', 'Book dinner', '00000000-0000-4000-8000-0000000f5b02', private.late_today() - 3, false, 'todo'),
  ('00000000-0000-4000-8000-0000000f5f04', '00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5d01', 'job', 'Buy the wine', '00000000-0000-4000-8000-0000000f5b02', private.late_today() - 9, false, 'asked'),
  ('00000000-0000-4000-8000-0000000f5f05', '00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5d01', 'job', 'Nobody''s job', null, private.late_today() - 9, false, 'todo'),
  ('00000000-0000-4000-8000-0000000f5f06', '00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5d01', 'job', 'Organiser job', '00000000-0000-4000-8000-0000000f5b01', private.late_today() - 8, false, 'todo'),
  ('00000000-0000-4000-8000-0000000f5f07', '00000000-0000-4000-8000-00000000f500', '00000000-0000-4000-8000-0000000f5d02', 'job', 'Next trip job', '00000000-0000-4000-8000-0000000f5b02', private.late_today() - 8, false, 'todo');
-- K: its own late job, its rule turned up to 3 (server side), its own round with its own player.
insert into public.trips (id, group_id, name) values ('00000000-0000-4000-8000-0000000f6c01', '00000000-0000-4000-8000-00000000f600', 'K trip');
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000f6c02', '00000000-0000-4000-8000-00000000f600', 'K course', '[{"n":1,"par":4,"si":1}]');
insert into public.plans (id, group_id, kind, name, status, start_date, trip_id) values
  ('00000000-0000-4000-8000-0000000f6d01', '00000000-0000-4000-8000-00000000f600', 'trip', 'K plan', 'confirmed', private.late_today() + 1, '00000000-0000-4000-8000-0000000f6c01');
insert into public.plan_items (id, group_id, plan_id, kind, title, owner_id, due) values
  ('00000000-0000-4000-8000-0000000f6f01', '00000000-0000-4000-8000-00000000f600', '00000000-0000-4000-8000-0000000f6d01', 'job', 'K job', '00000000-0000-4000-8000-0000000f6b01', private.late_today() - 9);
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status) values
  ('00000000-0000-4000-8000-0000000f6e01', '00000000-0000-4000-8000-00000000f600', '00000000-0000-4000-8000-0000000f6c01', '00000000-0000-4000-8000-0000000f6c02', 'K round', 'stableford', 'setup');
insert into public.round_players (round_id, player_id, playing_handicap) values ('00000000-0000-4000-8000-0000000f6e01', '00000000-0000-4000-8000-0000000f6b01', 12);
do $$ begin perform set_config('app.gov_apply', 'on', true); end $$;
update public.rules set late_strokes = 3 where id = (select id from t_ids where k = 'krule');
do $$ begin perform set_config('app.gov_apply', '', true); end $$;

-- ================= at 0 strokes nothing is late =================
insert into t_results (label, result) select 'X = 0: late jobs in J', count(*)::text from private.late_jobs('00000000-0000-4000-8000-00000000f500');

-- ================= j1 (player) can't change the rule; jg (guest) neither =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f5a02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f500"}', true); end $$;
do $$ declare k int; begin
  update public.rules set late_strokes = 0, late_days = 60 where id = (select id from t_ids where k = 'rule');
  get diagnostics k = row_count;
  insert into t_results (label, result) values ('player changes the rule', k || ' rows');
exception when others then insert into t_results (label, result) values ('player changes the rule', 'refused'); end $$;
do $$ declare k int; begin
  insert into public.rules (title, status, system_key, late_strokes) values ('Fake late job', 'proposed', 'late_job', 9);
  insert into t_results (label, result) select 'player''s own rule made a standard one', coalesce(system_key, 'no') || ' / ' || coalesce(late_strokes::text, 'none') from public.rules where title = 'Fake late job';
exception when others then insert into t_results (label, result) values ('player''s own rule made a standard one', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'player reads the rule', count(*)::text from public.rules where system_key = 'late_job';
insert into t_results (label, result) select 'player reads K''s rule', count(*)::text from public.rules where id = (select id from t_ids where k = 'krule');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f5a04","role":"authenticated"}';
do $$ declare k int; begin
  update public.rules set late_strokes = 9 where id = (select id from t_ids where k = 'rule');
  get diagnostics k = row_count;
  insert into t_results (label, result) values ('guest changes the rule', k || ' rows');
exception when others then insert into t_results (label, result) values ('guest changes the rule', 'refused'); end $$;

-- ================= jo (organiser) turns it up to 2, can't delete it =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f5a01","role":"authenticated"}';
update public.rules set late_strokes = 2 where id = (select id from t_ids where k = 'rule');
insert into t_results (label, result) select 'organiser sets 2 strokes', late_strokes || '/' || late_days || ' · ' || value from public.rules where id = (select id from t_ids where k = 'rule');
insert into t_results (label, result) select 'the wording follows', (detail like '%more than 5 days overdue, you cop 2 penalty strokes%')::text from public.rules where id = (select id from t_ids where k = 'rule');
insert into t_results (label, result) select 'a new version recorded', string_agg(version || ':' || event, ',' order by version, created_at) from public.rule_versions where rule_id = (select id from t_ids where k = 'rule');
do $$ declare k int; begin
  update public.rules set late_strokes = 11 where id = (select id from t_ids where k = 'rule');
  insert into t_results (label, result) values ('organiser sets 11 strokes', 'allowed');
exception when others then insert into t_results (label, result) values ('organiser sets 11 strokes', 'refused'); end $$;
do $$ declare k int; begin
  update public.rules set system_key = null where id = (select id from t_ids where k = 'rule');
  insert into t_results (label, result) select 'organiser clears the standard key', coalesce(system_key, 'cleared') from public.rules where id = (select id from t_ids where k = 'rule');
exception when others then insert into t_results (label, result) values ('organiser clears the standard key', 'refused'); end $$;
do $$ declare k int; begin
  delete from public.rules where id = (select id from t_ids where k = 'rule');
  get diagnostics k = row_count;
  insert into t_results (label, result) values ('organiser deletes it', k || ' rows');
exception when others then insert into t_results (label, result) values ('organiser deletes it', 'refused'); end $$;

-- ================= what's late now (server) =================
reset role;
insert into t_results (label, result) select 'late jobs in J', string_agg(title || ' ' || days_late || 'd +' || strokes, ', ' order by title) from private.late_jobs('00000000-0000-4000-8000-00000000f500');

-- ================= the owner can't push a late job's due date out; the organiser can =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f5a02","role":"authenticated"}';
update public.plan_items set due = (now() at time zone 'Australia/Sydney')::date + 10 where id = '00000000-0000-4000-8000-0000000f5f01';
update public.plan_items set due = (now() at time zone 'Australia/Sydney')::date + 10 where id = '00000000-0000-4000-8000-0000000f5f03';
insert into t_results (label, result) select 'owner moves a late job''s due', (due = (now() at time zone 'Australia/Sydney')::date - 7)::text || ' (unchanged)' from public.plan_items where id = '00000000-0000-4000-8000-0000000f5f01';
insert into t_results (label, result) select 'owner moves an on-time job''s due', (due = (now() at time zone 'Australia/Sydney')::date + 10)::text || ' (moved)' from public.plan_items where id = '00000000-0000-4000-8000-0000000f5f03';
-- (put it back for the rest)
reset role;
update public.plan_items set due = private.late_today() - 3 where id = '00000000-0000-4000-8000-0000000f5f03';

-- ================= waivers: player refused, other group's organiser refused, organiser waives "wine" =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f5a02","role":"authenticated"}';
do $$ begin
  perform public.waive_late_penalty('00000000-0000-4000-8000-0000000f5f04');
  insert into t_results (label, result) values ('player waives', 'ok');
exception when others then insert into t_results (label, result) values ('player waives', case when sqlerrm like '%Only an organiser%' then 'refused' else 'other: ' || sqlerrm end); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f6a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f600"}', true); end $$;
do $$ begin
  perform public.waive_late_penalty('00000000-0000-4000-8000-0000000f5f04');
  insert into t_results (label, result) values ('other group''s organiser waives', 'ok');
exception when others then insert into t_results (label, result) values ('other group''s organiser waives', case when sqlerrm like '%not found%' then 'refused' else 'other: ' || sqlerrm end); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f5a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f500"}', true); end $$;
insert into t_results (label, result) select 'organiser waives wine (before the round)', public.waive_late_penalty('00000000-0000-4000-8000-0000000f5f04')::text;
do $$ begin
  insert into public.score_adjustments (round_id, player_id, strokes, label) values ('00000000-0000-4000-8000-0000000f5e01', '00000000-0000-4000-8000-0000000f5b03', -5, 'Gift');
  insert into t_results (label, result) values ('organiser writes an adjustment directly', 'allowed');
exception when others then insert into t_results (label, result) values ('organiser writes an adjustment directly', 'refused'); end $$;
do $$ begin
  insert into public.job_penalties (item_id, waived_at) values ('00000000-0000-4000-8000-0000000f5f01', now());
  insert into t_results (label, result) values ('organiser writes a waiver directly', 'allowed');
exception when others then insert into t_results (label, result) values ('organiser writes a waiver directly', 'refused'); end $$;

-- ================= the daily tick tells the owners once =================
reset role;
insert into t_results (label, result) select 'tick: told', private.late_jobs_tick()::text;
insert into t_results (label, result) select 'tick again: told', private.late_jobs_tick()::text;
insert into t_results (label, result) select 'told about', string_agg(i.title, ', ' order by i.title) from public.job_penalties j join public.plan_items i on i.id = j.item_id where j.notified_at is not null and j.group_id = '00000000-0000-4000-8000-00000000f500';

-- ================= round 1 goes live (organiser starts it) =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f5a01","role":"authenticated"}';
update public.rounds set status = 'live' where id = '00000000-0000-4000-8000-0000000f5e01';
reset role;
insert into t_results (label, result) select 'round 1 adjustments', coalesce(string_agg(p.name || ' ' || a.label || ' = ' || a.strokes, ', ' order by a.label), 'none')
  from public.score_adjustments a join public.players p on p.id = a.player_id where a.round_id = '00000000-0000-4000-8000-0000000f5e01';
insert into t_results (label, result) select 'run it again', private.apply_late_job_penalties('00000000-0000-4000-8000-0000000f5e01')::text;
update public.rounds set status = 'setup' where id = '00000000-0000-4000-8000-0000000f5e01';
update public.rounds set status = 'live' where id = '00000000-0000-4000-8000-0000000f5e01';
insert into t_results (label, result) select 'stop and restart: adjustments', count(*)::text from public.score_adjustments where round_id = '00000000-0000-4000-8000-0000000f5e01';

-- ================= round 2: the bus is still not done — no second penalty; "menu" turns late but j1 finishes it first =================
update public.plan_items set due = private.late_today() - 6 where id = '00000000-0000-4000-8000-0000000f5f03';
update public.plan_items set done = true where id = '00000000-0000-4000-8000-0000000f5f03';
update public.rounds set status = 'live' where id = '00000000-0000-4000-8000-0000000f5e02';
insert into t_results (label, result) select 'round 2 adjustments', count(*)::text from public.score_adjustments where round_id = '00000000-0000-4000-8000-0000000f5e02';
insert into t_results (label, result) select 'all J adjustments', count(*)::text from public.score_adjustments where group_id = '00000000-0000-4000-8000-00000000f500';

-- ================= K is untouched by J's rounds; K's own round gets K's penalty =================
insert into t_results (label, result) select 'K adjustments before its round', count(*)::text from public.score_adjustments where group_id = '00000000-0000-4000-8000-00000000f600';
update public.rounds set status = 'live' where id = '00000000-0000-4000-8000-0000000f6e01';
insert into t_results (label, result) select 'K round', string_agg(label || ' = ' || strokes, ', ') from public.score_adjustments where group_id = '00000000-0000-4000-8000-00000000f600';

-- ================= the next trip's job waits for the next trip's round =================
insert into t_results (label, result) select 'next trip job applied yet', count(*)::text from public.score_adjustments where item_id = '00000000-0000-4000-8000-0000000f5f07';
insert into public.round_players (round_id, player_id, playing_handicap) values ('00000000-0000-4000-8000-0000000f5e09', '00000000-0000-4000-8000-0000000f5b02', 15);
update public.rounds set status = 'live' where id = '00000000-0000-4000-8000-0000000f5e09';
insert into t_results (label, result) select 'next trip round', string_agg(label, ', ') from public.score_adjustments where round_id = '00000000-0000-4000-8000-0000000f5e09';

-- ================= reading: members see J's penalties, K's organiser sees none of them =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f5a03","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f500"}', true); end $$;
insert into t_results (label, result) select 'j2 sees J adjustments', count(*)::text from public.score_adjustments;
insert into t_results (label, result) select 'j2 sees J waivers / notices', count(*)::text from public.job_penalties;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f6a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f600"}', true); end $$;
insert into t_results (label, result) select 'K organiser sees', count(*)::text || ' adjustments, all K: ' || coalesce(bool_and(group_id = '00000000-0000-4000-8000-00000000f600'), true)::text from public.score_adjustments;

-- ================= waive after the round =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f5a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f500"}', true); end $$;
insert into t_results (label, result) select 'organiser waives the bus (after)', public.waive_late_penalty('00000000-0000-4000-8000-0000000f5f01')::text;
insert into t_results (label, result) select 'bus penalty', (waived_at is not null)::text || ' waived by ' || (select name from public.players where id = waived_by) from public.score_adjustments where item_id = '00000000-0000-4000-8000-0000000f5f01';

-- ================= disputes: the numbers, and one penalty =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f5a03","role":"authenticated"}';
insert into t_ids select 'case-strokes', public.raise_dispute(jsonb_build_object('table', 'rules', 'id', id, 'field', 'late_strokes', 'label', '2 penalty strokes'), 'Is 2 strokes right?', null, '1')
  from t_ids where k = 'rule';
insert into t_ids select 'case-pen', public.raise_dispute(jsonb_build_object('table', 'score_adjustments', 'id', id, 'field', 'strokes', 'label', label), 'Unfair on Next trip job?', null, '0')
  from public.score_adjustments where item_id = '00000000-0000-4000-8000-0000000f5f07';
insert into t_results (label, result) select 'disputes raised', string_agg(c.subject_kind || ':' || (c.subject_ref->>'value'), ', ' order by c.subject_kind) from public.cases c where id in (select id from t_ids where k like 'case-%');
reset role;
update public.cases set status = 'passed', decided_at = now() where id in (select id from t_ids where k like 'case-%');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f5a01","role":"authenticated"}';
insert into t_results (label, result) select 'apply verdict: strokes', public.apply_dispute_verdict(id, '1')::text from t_ids where k = 'case-strokes';
insert into t_results (label, result) select 'rule after verdict', late_strokes || '/' || late_days || ' · ' || value from public.rules where id = (select id from t_ids where k = 'rule');
insert into t_results (label, result) select 'apply verdict: penalty', public.apply_dispute_verdict(id, '0')::text from t_ids where k = 'case-pen';
insert into t_results (label, result) select 'penalty after verdict', label || ' = ' || strokes from public.score_adjustments where item_id = '00000000-0000-4000-8000-0000000f5f07';
do $$ begin
  perform public.apply_dispute_verdict((select id from t_ids where k = 'case-strokes'), '2');
  insert into t_results (label, result) values ('apply it twice', 'ok');
exception when others then insert into t_results (label, result) values ('apply it twice', case when sqlerrm like '%already been applied%' then 'refused' else 'other: ' || sqlerrm end); end $$;

-- ================= switched off: retired rule, or planner jobs off =================
reset role;
update public.plan_items set owner_id = '00000000-0000-4000-8000-0000000f5b02', due = private.late_today() - 20 where id = '00000000-0000-4000-8000-0000000f5f05';
insert into t_results (label, result) select 'late now (on)', count(*)::text from private.late_jobs('00000000-0000-4000-8000-00000000f500');
update public.group_features set enabled = false where group_id = '00000000-0000-4000-8000-00000000f500' and feature_key = 'planner_tasks';
insert into t_results (label, result) select 'late with planner jobs off', count(*)::text from private.late_jobs('00000000-0000-4000-8000-00000000f500');
update public.group_features set enabled = true where group_id = '00000000-0000-4000-8000-00000000f500' and feature_key = 'planner_tasks';
do $$ begin perform set_config('app.gov_apply', 'on', true); end $$;
update public.rules set status = 'retired' where id = (select id from t_ids where k = 'rule');
do $$ begin perform set_config('app.gov_apply', '', true); end $$;
insert into t_results (label, result) select 'late with the rule retired', count(*)::text from private.late_jobs('00000000-0000-4000-8000-00000000f500');

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
