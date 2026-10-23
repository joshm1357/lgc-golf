-- 099 test: penalties for breaking a rule (Ambrose minimum drives, and any rule on the course). STAGING only, after 099.
-- Rolled back; results in the error message ("RESULTS: ..."). Expected answers in 099_rule_penalties.expected.txt.
-- Group P: Po — organiser; Al, Bo, Cy — players (Ambrose team A, a three); Di — player (team B with Po); a guest.
-- Group Q: its organiser (another group). Also checked locally on a plain Postgres 16 with every migration 001–099.
begin;
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_ids (k text primary key, id uuid);
grant all on t_ids to authenticated;

-- Run one statement as whoever is signed in now; record "ok" (and the first value it returns) or the error.
create function pg_temp.try(p_label text, p_sql text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    insert into t_results (label, result) values (p_label, 'ok' || coalesce(' ' || v, ''));
  exception when others then
    insert into t_results (label, result) values (p_label, 'refused: ' || sqlerrm);
  end;
end $$;
grant execute on function pg_temp.try(text, text) to authenticated;

-- ================= the standard rule: every group has one; L.G.C's own "6 drives each" rule became it =================
insert into t_results (label, result) select 'every group has exactly one', (select count(*) from public.groups g
  where (select count(*) from public.rules r where r.group_id = g.id and r.system_key = 'ambrose_drives') <> 1)::text || ' without';
insert into t_results (label, result) select 'L.G.C (legacy) drives rule', coalesce(string_agg(title || ' · ' || value, ', '), 'none')
  from public.rules where group_id = (select id from public.groups where legacy) and system_key = 'ambrose_drives';
insert into t_results (label, result) select 'L.G.C has no second drives rule', count(*)::text from public.rules
  where group_id = (select id from public.groups where legacy) and status = 'active' and (coalesce(value, '') || ' ' || title) ~* '\d+\s*drive';

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000f990', 'test-p99', 'Test Group P99', 'P99-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000f991', 'test-q99', 'Test Group Q99', 'Q99-CODE-TEST-1', null);
insert into t_results (label, result) select 'new group P has the rule', title || ' · ' || value || ' · ' || category || ' · ' || array_to_string(applies_to, ',')
  || ' · ' || drives_2 || '/' || drives_3 || '/' || drives_4 || ' +' || breach_strokes
  from public.rules where group_id = '00000000-0000-4000-8000-00000000f990' and system_key = 'ambrose_drives';
insert into t_results (label, result) select 'its wording', (detail like 'In Ambrose, each player’s drive must be used at least 6 times in a team of three, 4 in a team of four%costs the team 2 strokes%')::text
  from public.rules where group_id = '00000000-0000-4000-8000-00000000f990' and system_key = 'ambrose_drives';
insert into t_results (label, result) select 'seeding again adds nothing', (select private.seed_drives_rule('00000000-0000-4000-8000-00000000f990'))::text || ' '
  || (select count(*) from public.rules where group_id = '00000000-0000-4000-8000-00000000f990' and system_key = 'ambrose_drives')::text;
insert into t_ids select 'drules', id from public.rules where group_id = '00000000-0000-4000-8000-00000000f990' and system_key = 'ambrose_drives';

-- ================= the maths (same as src/lib/drives.js) =================
insert into t_results (label, result) select 'needed: 18 holes, team of 2/3/4/5', private.drives_needed(null, 6, 6, 4, 2, 18) || '/' || private.drives_needed(null, 6, 6, 4, 3, 18)
  || '/' || private.drives_needed(null, 6, 6, 4, 4, 18) || '/' || private.drives_needed(null, 6, 6, 4, 5, 18);
insert into t_results (label, result) select 'needed: 9 holes, team of 2/3/4', private.drives_needed(null, 6, 6, 4, 2, 9) || '/' || private.drives_needed(null, 6, 6, 4, 3, 9)
  || '/' || private.drives_needed(null, 6, 6, 4, 4, 9);
insert into t_results (label, result) select 'needed: round says 6, team of 3/4', private.drives_needed(6, 6, 6, 4, 3, 18) || '/' || private.drives_needed(6, 6, 6, 4, 4, 18);
insert into t_results (label, result) select 'needed: rule says 9 for a three (capped)', private.drives_needed(null, 6, 9, 4, 3, 18)::text;

-- People.
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000000f9a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f9a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f9a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f9a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f9a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f9a06', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f9a09', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000000f9b01', '00000000-0000-4000-8000-00000000f990', 'P Organiser', 'Po', 10),
  ('00000000-0000-4000-8000-0000000f9b02', '00000000-0000-4000-8000-00000000f990', 'Al One', 'Al', 15),
  ('00000000-0000-4000-8000-0000000f9b03', '00000000-0000-4000-8000-00000000f990', 'Bo Two', 'Bo', 18),
  ('00000000-0000-4000-8000-0000000f9b04', '00000000-0000-4000-8000-00000000f990', 'Cy Three', 'Cy', 20),
  ('00000000-0000-4000-8000-0000000f9b05', '00000000-0000-4000-8000-00000000f990', 'Di Four', null, 22),
  ('00000000-0000-4000-8000-0000000f9b06', '00000000-0000-4000-8000-00000000f990', 'P Guest', null, 24),
  ('00000000-0000-4000-8000-0000000f9b09', '00000000-0000-4000-8000-00000000f991', 'Q Organiser', null, 12);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f990', '00000000-0000-4000-8000-0000000f9a01', '00000000-0000-4000-8000-0000000f9b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f990', '00000000-0000-4000-8000-0000000f9a02', '00000000-0000-4000-8000-0000000f9b02', 'player'),
  ('00000000-0000-4000-8000-00000000f990', '00000000-0000-4000-8000-0000000f9a03', '00000000-0000-4000-8000-0000000f9b03', 'player'),
  ('00000000-0000-4000-8000-00000000f990', '00000000-0000-4000-8000-0000000f9a04', '00000000-0000-4000-8000-0000000f9b04', 'player'),
  ('00000000-0000-4000-8000-00000000f990', '00000000-0000-4000-8000-0000000f9a05', '00000000-0000-4000-8000-0000000f9b05', 'player'),
  ('00000000-0000-4000-8000-00000000f990', '00000000-0000-4000-8000-0000000f9a06', '00000000-0000-4000-8000-0000000f9b06', 'guest'),
  ('00000000-0000-4000-8000-00000000f991', '00000000-0000-4000-8000-0000000f9a09', '00000000-0000-4000-8000-0000000f9b09', 'organiser');
-- P: an organiser decides rule changes (as L.G.C); the Tribunal on.
select private.gov_apply_preset('00000000-0000-4000-8000-00000000f990', 'organiser', null);
insert into public.group_features (group_id, feature_key, enabled) values
  ('00000000-0000-4000-8000-00000000f990', 'tribunal', true), ('00000000-0000-4000-8000-00000000f990', 'rule_challenges', true)
  on conflict (group_id, feature_key) do update set enabled = true;

-- An Ambrose round on a 6-hole course. Team A = Al, Bo, Cy (a three → 6 × 6 ÷ 18 = 2 drives each). Team B = Po, Di
-- (records no drives: not tracked, no penalty). A Stableford round with Al and Di, still in set-up.
insert into public.trips (id, group_id, name) values ('00000000-0000-4000-8000-0000000f9c01', '00000000-0000-4000-8000-00000000f990', 'P trip');
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000f9c02', '00000000-0000-4000-8000-00000000f990', 'P course',
  '[{"n":1,"par":4,"si":1},{"n":2,"par":4,"si":2},{"n":3,"par":4,"si":3},{"n":4,"par":4,"si":4},{"n":5,"par":4,"si":5},{"n":6,"par":4,"si":6}]');
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status) values
  ('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-00000000f990', '00000000-0000-4000-8000-0000000f9c01', '00000000-0000-4000-8000-0000000f9c02', 'P Ambrose', 'ambrose', 'live'),
  ('00000000-0000-4000-8000-0000000f9e02', '00000000-0000-4000-8000-00000000f990', '00000000-0000-4000-8000-0000000f9c01', '00000000-0000-4000-8000-0000000f9c02', 'P Stableford', 'stableford', 'setup');
insert into public.round_players (round_id, player_id, playing_handicap) values
  ('00000000-0000-4000-8000-0000000f9e02', '00000000-0000-4000-8000-0000000f9b02', 15), ('00000000-0000-4000-8000-0000000f9e02', '00000000-0000-4000-8000-0000000f9b05', 22);
insert into public.teams (id, group_id, round_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000f9d01', '00000000-0000-4000-8000-00000000f990', '00000000-0000-4000-8000-0000000f9e01', 'Team A', 8),
  ('00000000-0000-4000-8000-0000000f9d02', '00000000-0000-4000-8000-00000000f990', '00000000-0000-4000-8000-0000000f9e01', 'Team B', 8);
insert into public.team_players (team_id, player_id) values
  ('00000000-0000-4000-8000-0000000f9d01', '00000000-0000-4000-8000-0000000f9b02'), ('00000000-0000-4000-8000-0000000f9d01', '00000000-0000-4000-8000-0000000f9b03'),
  ('00000000-0000-4000-8000-0000000f9d01', '00000000-0000-4000-8000-0000000f9b04'),
  ('00000000-0000-4000-8000-0000000f9d02', '00000000-0000-4000-8000-0000000f9b01'), ('00000000-0000-4000-8000-0000000f9d02', '00000000-0000-4000-8000-0000000f9b05');
-- Team A's drives: Al 3, Bo 2, Cy 1 (Cy 1 short → +2). Team B: scores, no drives.
insert into public.scores (round_id, subject_id, subject_type, hole, strokes, tee_shot_player)
select '00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9d01', 'team', h, 4, p::uuid from (values
  (1, '00000000-0000-4000-8000-0000000f9b02'), (2, '00000000-0000-4000-8000-0000000f9b02'), (3, '00000000-0000-4000-8000-0000000f9b02'),
  (4, '00000000-0000-4000-8000-0000000f9b03'), (5, '00000000-0000-4000-8000-0000000f9b03'), (6, '00000000-0000-4000-8000-0000000f9b04')) v(h, p);
insert into public.scores (round_id, subject_id, subject_type, hole, strokes)
select '00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9d02', 'team', h, 5 from generate_series(1, 6) h;

insert into t_results (label, result) select 'live shortfall (server)', coalesce(string_agg(name || ' ' || used || '/' || needed || ' +' || strokes, ', '), 'none')
  from private.drive_shortfalls('00000000-0000-4000-8000-0000000f9e01');

-- ================= the rule's numbers: organiser changes them; players and guests can't =================
set local role authenticated;
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f990"}', true); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f9a02","role":"authenticated"}';
do $$ declare k int; begin
  update public.rules set drives_3 = 1 where id = (select id from t_ids where k = 'drules');
  get diagnostics k = row_count;
  insert into t_results (label, result) values ('player changes the drives', k || ' rows');
exception when others then insert into t_results (label, result) values ('player changes the drives', 'refused'); end $$;
do $$ begin
  insert into public.rules (title, status, system_key, drives_3, breach_strokes) values ('Fake drives', 'proposed', 'ambrose_drives', 1, 9);
  insert into t_results (label, result) select 'player''s own rule made a standard one', coalesce(system_key, 'no') || ' / ' || coalesce(drives_3::text, 'none')
    || ' / penalty ' || coalesce(breach_strokes::text, 'none') from public.rules where title = 'Fake drives';
exception when others then insert into t_results (label, result) values ('player''s own rule made a standard one', 'refused: ' || sqlerrm); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f9a06","role":"authenticated"}';
do $$ declare k int; begin
  update public.rules set breach_strokes = 9 where id = (select id from t_ids where k = 'drules');
  get diagnostics k = row_count;
  insert into t_results (label, result) values ('guest changes the penalty', k || ' rows');
exception when others then insert into t_results (label, result) values ('guest changes the penalty', 'refused'); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f9a01","role":"authenticated"}';
update public.rules set drives_4 = 3 where id = (select id from t_ids where k = 'drules');
insert into t_results (label, result) select 'organiser sets 3 in a four', drives_2 || '/' || drives_3 || '/' || drives_4 || ' · ' || value from public.rules where id = (select id from t_ids where k = 'drules');
insert into t_results (label, result) select 'a new version recorded', string_agg(version || ':' || event, ',' order by version, created_at) from public.rule_versions where rule_id = (select id from t_ids where k = 'drules');
select pg_temp.try('organiser sets 10 drives', $q$update public.rules set drives_3 = 10 where id = (select id from t_ids where k = 'drules') returning drives_3$q$);
select pg_temp.try('organiser clears the standard key', $q$update public.rules set system_key = null where id = (select id from t_ids where k = 'drules') returning coalesce(system_key, 'cleared')$q$);
select pg_temp.try('organiser deletes it', $q$with d as (delete from public.rules where id = (select id from t_ids where k = 'drules') returning id) select count(*) || ' rows' from d$q$);
-- Any rule can carry a penalty.
insert into public.rules (id, title, category, applies_to, status) values ('00000000-0000-4000-8000-0000000f9f01', 'No mulligans', 'etiquette', '{all}', 'active');
update public.rules set breach_strokes = 1 where id = '00000000-0000-4000-8000-0000000f9f01';
insert into t_results (label, result) select 'a rule with a penalty', title || ' +' || breach_strokes || ' · value ' || coalesce(value, 'none') || ' · drives ' || coalesce(drives_3::text, 'none')
  from public.rules where id = '00000000-0000-4000-8000-0000000f9f01';
insert into public.rules (id, title, category, applies_to, status) values ('00000000-0000-4000-8000-0000000f9f02', 'Old rule', 'other', '{all}', 'retired');
insert into public.rules (id, title, category, applies_to, status) values ('00000000-0000-4000-8000-0000000f9f03', 'Ready golf', 'etiquette', '{all}', 'active');

-- ================= a penalty on the course =================
-- Organiser applies one straight on (the rule's 1 stroke by default), on Bo (team A).
select pg_temp.try('organiser applies (default strokes)', $q$select public.apply_rule_penalty('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b03',
  '00000000-0000-4000-8000-0000000f9f01', null, 4, 'Second ball off the 4th')->>'status'$q$);
insert into t_results (label, result) select 'it''s on the card', label || ' = ' || strokes || ' · ' || kind || ' · by ' || (select name from public.players where id = applied_by) || ' · hole ' || hole
  from public.score_adjustments where round_id = '00000000-0000-4000-8000-0000000f9e01' and kind = 'rule_breach';
select pg_temp.try('a rule with no penalty set needs strokes', $q$select public.apply_rule_penalty('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b03',
  '00000000-0000-4000-8000-0000000f9f03', null)->>'status'$q$);
select pg_temp.try('a retired rule', $q$select public.apply_rule_penalty('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b03', '00000000-0000-4000-8000-0000000f9f02', 2)->>'status'$q$);
select pg_temp.try('11 strokes', $q$select public.apply_rule_penalty('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b03', '00000000-0000-4000-8000-0000000f9f01', 11)->>'status'$q$);
select pg_temp.try('someone not in the round', $q$select public.apply_rule_penalty('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b06', '00000000-0000-4000-8000-0000000f9f01', 1)->>'status'$q$);
select pg_temp.try('a round still in set-up', $q$select public.apply_rule_penalty('00000000-0000-4000-8000-0000000f9e02', '00000000-0000-4000-8000-0000000f9b02', '00000000-0000-4000-8000-0000000f9f01', 1)->>'status'$q$);
select pg_temp.try('organiser writes an adjustment directly', $q$insert into public.score_adjustments (round_id, player_id, strokes, label, kind) values
  ('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b02', 2, 'Sneaky (+2)', 'rule_breach') returning id$q$);

-- A player proposes one (on Cy, 2 strokes); a guest can't; another group's organiser can't.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f9a02","role":"authenticated"}';
select pg_temp.try('player proposes', $q$select public.apply_rule_penalty('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b04', '00000000-0000-4000-8000-0000000f9f01', 2, 7)->>'status'$q$);
insert into t_ids select 'prop', id from public.penalty_proposals where proposed_by = '00000000-0000-4000-8000-0000000f9b02';
insert into t_results (label, result) select 'not on the card yet', count(*)::text from public.score_adjustments where player_id = '00000000-0000-4000-8000-0000000f9b04';
select pg_temp.try('player confirms his own', $q$select public.decide_rule_penalty((select id from t_ids where k = 'prop'), true)->>'status'$q$);
select pg_temp.try('player writes a proposal directly', $q$insert into public.penalty_proposals (round_id, player_id, strokes, label) values
  ('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b04', 1, 'Sneaky (+1)') returning id$q$);
select pg_temp.try('player waives a penalty', $q$select public.waive_rule_penalty((select id from public.score_adjustments where kind = 'rule_breach' limit 1))->>'status'$q$);
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f9a06","role":"authenticated"}';
select pg_temp.try('guest applies', $q$select public.apply_rule_penalty('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b04', '00000000-0000-4000-8000-0000000f9f01', 2)->>'status'$q$);
insert into t_results (label, result) select 'guest reads penalties / proposals', (select count(*) from public.score_adjustments)::text || ' / ' || (select count(*) from public.penalty_proposals)::text;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f9a09","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f991"}', true); end $$;
select pg_temp.try('other group applies', $q$select public.apply_rule_penalty('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b04', '00000000-0000-4000-8000-0000000f9f01', 2)->>'status'$q$);
select pg_temp.try('other group confirms', $q$select public.decide_rule_penalty((select id from public.penalty_proposals where round_id = '00000000-0000-4000-8000-0000000f9e01' limit 1), true)->>'status'$q$);
insert into t_results (label, result) select 'other group reads penalties / proposals', (select count(*) from public.score_adjustments where round_id = '00000000-0000-4000-8000-0000000f9e01')::text
  || ' / ' || (select count(*) from public.penalty_proposals)::text;

-- The organiser confirms it at 3 strokes.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f9a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f990"}', true); end $$;
select pg_temp.try('organiser confirms (3 strokes)', $q$select public.decide_rule_penalty((select id from t_ids where k = 'prop'), true, 3)->>'status'$q$);
insert into t_results (label, result) select 'confirmed penalty', label || ' = ' || strokes || ' · proposed by ' || (select name from public.players where id = proposed_by)
  || ' · applied by ' || (select name from public.players where id = applied_by) from public.score_adjustments where player_id = '00000000-0000-4000-8000-0000000f9b04' and kind = 'rule_breach';
insert into t_results (label, result) select 'proposal now', status || ' by ' || (select name from public.players where id = decided_by) from public.penalty_proposals where id = (select id from t_ids where k = 'prop');
select pg_temp.try('confirm it again', $q$select public.decide_rule_penalty((select id from t_ids where k = 'prop'), true)->>'status'$q$);

-- ================= locking the Ambrose round adds the drives =================
reset role;
update public.rounds set status = 'locked' where id = '00000000-0000-4000-8000-0000000f9e01';
insert into t_results (label, result) select 'drives after lock', coalesce(string_agg(label || ' = ' || strokes || ' · ' || kind || ' · rule ' || (rule_id = (select id from t_ids where k = 'drules'))::text, ', ' order by label), 'none')
  from public.score_adjustments where round_id = '00000000-0000-4000-8000-0000000f9e01' and breach_key = 'drives';
insert into t_results (label, result) select 'team B (no drives recorded)', count(*)::text from public.score_adjustments
  where round_id = '00000000-0000-4000-8000-0000000f9e01' and player_id in ('00000000-0000-4000-8000-0000000f9b01', '00000000-0000-4000-8000-0000000f9b05');
insert into t_results (label, result) select 'team A total penalty', sum(strokes)::text from public.score_adjustments
  where round_id = '00000000-0000-4000-8000-0000000f9e01' and waived_at is null and player_id in (select player_id from public.team_players where team_id = '00000000-0000-4000-8000-0000000f9d01');
-- Reopen, fix hole 5 to Cy's drive, lock again: no longer short, the row goes.
update public.rounds set status = 'live' where id = '00000000-0000-4000-8000-0000000f9e01';
update public.scores set tee_shot_player = '00000000-0000-4000-8000-0000000f9b04' where round_id = '00000000-0000-4000-8000-0000000f9e01' and subject_id = '00000000-0000-4000-8000-0000000f9d01' and hole = 3;
update public.rounds set status = 'locked' where id = '00000000-0000-4000-8000-0000000f9e01';
insert into t_results (label, result) select 're-locked, Cy has 2 now', count(*)::text from public.score_adjustments where round_id = '00000000-0000-4000-8000-0000000f9e01' and breach_key = 'drives';
-- Short again (round's own P = 3): a fresh row at 3 a drive.
update public.rounds set status = 'live', drive_penalty = 3 where id = '00000000-0000-4000-8000-0000000f9e01';
update public.scores set tee_shot_player = '00000000-0000-4000-8000-0000000f9b02' where round_id = '00000000-0000-4000-8000-0000000f9e01' and subject_id = '00000000-0000-4000-8000-0000000f9d01' and hole in (3, 6);
update public.rounds set status = 'locked' where id = '00000000-0000-4000-8000-0000000f9e01';
insert into t_results (label, result) select 'round''s own penalty (3)', string_agg(label || ' = ' || strokes, ', ') from public.score_adjustments where round_id = '00000000-0000-4000-8000-0000000f9e01' and breach_key = 'drives';

-- ================= waive =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f9a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f990"}', true); end $$;
select pg_temp.try('organiser waives the drives', $q$select public.waive_rule_penalty((select id from public.score_adjustments where breach_key = 'drives' and round_id = '00000000-0000-4000-8000-0000000f9e01'))->>'status'$q$);
insert into t_results (label, result) select 'drives penalty', label || ' · waived ' || (waived_at is not null)::text || ' by ' || (select name from public.players where id = waived_by)
  from public.score_adjustments where breach_key = 'drives' and round_id = '00000000-0000-4000-8000-0000000f9e01';
reset role;
update public.rounds set status = 'live' where id = '00000000-0000-4000-8000-0000000f9e01';
update public.rounds set status = 'locked' where id = '00000000-0000-4000-8000-0000000f9e01';
insert into t_results (label, result) select 'still waived after re-lock', string_agg(strokes || ' waived ' || (waived_at is not null)::text, ', ') from public.score_adjustments where breach_key = 'drives' and round_id = '00000000-0000-4000-8000-0000000f9e01';

-- ================= the widened kind check =================
select pg_temp.try('kind award (−1)', $q$insert into public.score_adjustments (round_id, player_id, strokes, label, kind) values
  ('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b02', -1, 'Latest out (−1)', 'award') returning kind$q$);
select pg_temp.try('kind made-up', $q$insert into public.score_adjustments (round_id, player_id, strokes, label, kind) values
  ('00000000-0000-4000-8000-0000000f9e01', '00000000-0000-4000-8000-0000000f9b02', 1, 'Nope (+1)', 'nonsense') returning kind$q$);
select pg_temp.try('waive a non-rule penalty', $q$select public.waive_rule_penalty((select id from public.score_adjustments where kind = 'award' and round_id = '00000000-0000-4000-8000-0000000f9e01'))->>'status'$q$);

-- ================= disputes: the drives numbers, a rule's penalty, one penalty =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f9a03","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f990"}', true); end $$;
insert into t_ids select 'case-d3', public.raise_dispute(jsonb_build_object('table', 'rules', 'id', id, 'field', 'drives_3', 'label', '6 drives each in a three'), 'Is 6 drives right?', null, '5')
  from t_ids where k = 'drules';
insert into t_ids select 'case-pen', public.raise_dispute(jsonb_build_object('table', 'score_adjustments', 'id', id, 'field', 'strokes', 'label', label), 'Unfair on Cy?', null, '1')
  from public.score_adjustments where player_id = '00000000-0000-4000-8000-0000000f9b04' and kind = 'rule_breach' and breach_key is null;
insert into t_results (label, result) select 'disputes raised', string_agg(c.subject_kind || ':' || (c.subject_ref->>'field') || '=' || (c.subject_ref->>'value'), ', ' order by c.subject_kind) from public.cases c where id in (select id from t_ids where k like 'case-%');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f9a06","role":"authenticated"}';
select pg_temp.try('guest disputes', $q$select public.raise_dispute(jsonb_build_object('table', 'rules', 'id', '00000000-0000-4000-8000-0000000f9f01', 'field', 'breach_strokes', 'label', '1 stroke'), 'Too much?', null, '0')$q$);
reset role;
update public.cases set status = 'passed', decided_at = now() where id in (select id from t_ids where k like 'case-%');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f9a01","role":"authenticated"}';
insert into t_results (label, result) select 'apply verdict: drives', (public.apply_dispute_verdict(id, '5')->>'status') from t_ids where k = 'case-d3';
insert into t_results (label, result) select 'rule after verdict', drives_3 || ' · ' || value from public.rules where id = (select id from t_ids where k = 'drules');
insert into t_results (label, result) select 'apply verdict: penalty', (public.apply_dispute_verdict(id, '1')->>'status') from t_ids where k = 'case-pen';
insert into t_results (label, result) select 'penalty after verdict', label || ' = ' || strokes from public.score_adjustments where player_id = '00000000-0000-4000-8000-0000000f9b04' and kind = 'rule_breach' and breach_key is null;
reset role;
update public.score_adjustments set strokes = -2 where kind = 'award' and round_id = '00000000-0000-4000-8000-0000000f9e01';
insert into t_results (label, result) select 'an award''s label follows its strokes', label from public.score_adjustments where kind = 'award' and round_id = '00000000-0000-4000-8000-0000000f9e01';

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
rollback;
