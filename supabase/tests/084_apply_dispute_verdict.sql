-- 084 test: an organiser applies an upheld dispute's verdict to the setting. STAGING only, after 082 + 084. Rolled
-- back; results in the error message. Expected answers in 084_apply_dispute_verdict.expected.txt.
-- Group D: do — organiser, d1 — player, dg — guest. Group E: e1 — organiser of another group.
begin;
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_ids (k text primary key, id uuid);
grant all on t_ids to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000d000', 'test-d84', 'Test Group D84', 'D84-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000e000', 'test-e84', 'Test Group E84', 'E84-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000000d0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000d0b01', '00000000-0000-4000-8000-00000000d000', 'D Organiser', 10),
  ('00000000-0000-4000-8000-0000000d0b02', '00000000-0000-4000-8000-00000000d000', 'D One', 15),
  ('00000000-0000-4000-8000-0000000d0b04', '00000000-0000-4000-8000-00000000d000', 'D Guest', 20),
  ('00000000-0000-4000-8000-0000000e0b01', '00000000-0000-4000-8000-00000000e000', 'E One', 12);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000d000', '00000000-0000-4000-8000-0000000d0a01', '00000000-0000-4000-8000-0000000d0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000d000', '00000000-0000-4000-8000-0000000d0a02', '00000000-0000-4000-8000-0000000d0b02', 'player'),
  ('00000000-0000-4000-8000-00000000d000', '00000000-0000-4000-8000-0000000d0a04', '00000000-0000-4000-8000-0000000d0b04', 'guest'),
  ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-0000000e0a01', '00000000-0000-4000-8000-0000000e0b01', 'organiser');
insert into public.group_features (group_id, feature_key, enabled) values ('00000000-0000-4000-8000-00000000d000', 'comp_bonus', true)
  on conflict (group_id, feature_key) do update set enabled = true;
insert into public.trips (id, group_id, name) values ('00000000-0000-4000-8000-0000000d0c01', '00000000-0000-4000-8000-00000000d000', 'D trip');
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000d0c02', '00000000-0000-4000-8000-00000000d000', 'D course', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status, comp_bonus, min_drives, ctp_holes) values
  ('00000000-0000-4000-8000-0000000d0c03', '00000000-0000-4000-8000-00000000d000', '00000000-0000-4000-8000-0000000d0c01', '00000000-0000-4000-8000-0000000d0c02', 'D round', 'ambrose', 'setup', 2, 3, '{6}');

-- d1 raises four disputes.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0a02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000d000"}', true); end $$;
insert into t_ids values
  ('bonus', public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"comp_bonus","label":"Worth 2 strokes"}', 'Is worth 2 right?', null, '1')),
  ('drives', public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"min_drives","label":"Min 3 drives"}', 'Is 3 drives right?')),
  ('holes', public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"ctp_holes","label":"CTP on 6"}', 'CTP on 6?')),
  ('rules', public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"rules","label":"Today''s rules"}', 'Today''s rules?'));
reset role;
-- The Tribunal's verdicts (set directly here): bonus, drives, holes upheld; rules dismissed. Plus one still open.
update public.cases set status = 'passed', decided_at = now() where id in (select id from t_ids where k in ('bonus', 'drives', 'holes'));
update public.cases set status = 'failed', decided_at = now() where id = (select id from t_ids where k = 'rules');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0a02","role":"authenticated"}';
insert into t_ids values ('open', public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"comp_bonus","label":"Worth 2 strokes"}', 'Still worth 2?'));

-- ================= d1 — player =================
do $$ begin
  perform public.apply_dispute_verdict((select id from t_ids where k = 'bonus'), '1');
  insert into t_results (label, result) values ('player applies a verdict', 'ok');
exception when others then insert into t_results (label, result) values ('player applies a verdict', case when sqlerrm like '%Only an organiser%' then 'refused' else 'other: ' || sqlerrm end); end $$;
-- ================= dg — guest =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0a04","role":"authenticated"}';
do $$ begin
  perform public.apply_dispute_verdict((select id from t_ids where k = 'bonus'), '1');
  insert into t_results (label, result) values ('guest applies a verdict', 'ok');
exception when others then insert into t_results (label, result) values ('guest applies a verdict', case when sqlerrm like '%Only an organiser%' then 'refused' else 'other: ' || sqlerrm end); end $$;
-- ================= e1 — organiser of another group =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e000"}', true); end $$;
do $$ begin
  perform public.apply_dispute_verdict((select id from t_ids where k = 'bonus'), '1');
  insert into t_results (label, result) values ('other group''s organiser applies', 'ok');
exception when others then insert into t_results (label, result) values ('other group''s organiser applies', case when sqlerrm like '%not found%' then 'refused' else 'other: ' || sqlerrm end); end $$;

-- ================= do — organiser =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000d000"}', true); end $$;
do $$ begin
  perform public.apply_dispute_verdict((select id from t_ids where k = 'open'), '1');
  insert into t_results (label, result) values ('undecided case', 'ok');
exception when others then insert into t_results (label, result) values ('undecided case', case when sqlerrm like '%upheld%' then 'refused' else 'other: ' || sqlerrm end); end $$;
do $$ begin
  perform public.apply_dispute_verdict((select id from t_ids where k = 'rules'), '"New rules"');
  insert into t_results (label, result) values ('dismissed case', 'ok');
exception when others then insert into t_results (label, result) values ('dismissed case', case when sqlerrm like '%upheld%' then 'refused' else 'other: ' || sqlerrm end); end $$;
do $$ begin
  perform public.apply_dispute_verdict((select id from t_ids where k = 'bonus'), '"one and a half"');
  insert into t_results (label, result) values ('a value of the wrong type', 'ok');
exception when others then insert into t_results (label, result) values ('a value of the wrong type', case when sqlerrm like '%number%' then 'refused' else 'other: ' || sqlerrm end); end $$;
do $$ begin
  perform public.apply_dispute_verdict((select id from t_ids where k = 'bonus'), '25');
  insert into t_results (label, result) values ('a value out of range', 'ok');
exception when others then insert into t_results (label, result) values ('a value out of range', case when sqlerrm like '%0 to 10%' then 'refused' else 'other: ' || sqlerrm end); end $$;
do $$ declare r jsonb; begin
  r := public.apply_dispute_verdict((select id from t_ids where k = 'bonus'), '1');
  insert into t_results (label, result) values ('organiser applies', (r->>'status') || ' ' || (r->>'old') || ' → ' || (r->>'new'));
exception when others then insert into t_results (label, result) values ('organiser applies', 'error: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'the setting now', comp_bonus::text from public.rounds where id = '00000000-0000-4000-8000-0000000d0c03';
insert into t_results (label, result) select 'recorded on the case', (setting_applied_by = '00000000-0000-4000-8000-0000000d0b01')::text || ' / ' || (setting_applied_at is not null)::text || ' / ' || (setting_change->>'old') || '→' || (setting_change->>'new')
  from public.cases where id = (select id from t_ids where k = 'bonus');
do $$ begin
  perform public.apply_dispute_verdict((select id from t_ids where k = 'bonus'), '0');
  insert into t_results (label, result) values ('second apply', 'ok');
exception when others then insert into t_results (label, result) values ('second apply', case when sqlerrm like '%already been applied%' then 'refused' else 'other: ' || sqlerrm end); end $$;
do $$ declare r jsonb; begin
  r := public.apply_dispute_verdict((select id from t_ids where k = 'holes'), '[9, 3, 9]');
  insert into t_results (label, result) values ('holes', (r->>'status') || ' ' || (r->>'new'));
exception when others then insert into t_results (label, result) values ('holes', 'error: ' || sqlerrm); end $$;

-- Changed since raised: min drives 3 → 4 by someone, then the verdict says 2.
reset role;
update public.rounds set min_drives = 4 where id = '00000000-0000-4000-8000-0000000d0c03';
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.apply_dispute_verdict((select id from t_ids where k = 'drives'), '2');
  insert into t_results (label, result) values ('changed since, no force', (r->>'status') || ' (now ' || (r->>'now') || ')');
exception when others then insert into t_results (label, result) values ('changed since, no force', 'error: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'min drives after no-force', min_drives::text from public.rounds where id = '00000000-0000-4000-8000-0000000d0c03';
do $$ declare r jsonb; begin
  r := public.apply_dispute_verdict((select id from t_ids where k = 'drives'), '2', true);
  insert into t_results (label, result) values ('changed since, apply anyway', (r->>'status') || ' ' || (r->>'old') || ' → ' || (r->>'new'));
exception when others then insert into t_results (label, result) values ('changed since, apply anyway', 'error: ' || sqlerrm); end $$;
reset role;
insert into t_results (label, result) select 'round after', comp_bonus || ' / ' || min_drives || ' / ' || array_to_string(ctp_holes, ',') from public.rounds where id = '00000000-0000-4000-8000-0000000d0c03';
insert into t_results (label, result) select 'feed posts', count(*)::text from public.posts where group_id = '00000000-0000-4000-8000-00000000d000' and body like '⚖️ Verdict applied%';
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
