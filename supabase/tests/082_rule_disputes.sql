-- 082 test: disputing a rule or setting (raise_dispute). STAGING only, after 082. Rolled back; results in the error
-- message. Expected answers in 082_rule_disputes.expected.txt.
-- Group D: do — organiser, d1 / d2 — players, dg — guest. Group E: e1 — a player in another group.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000d000', 'test-d82', 'Test Group D82', 'D82-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000e000', 'test-e82', 'Test Group E82', 'E82-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000000d0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000d0b01', '00000000-0000-4000-8000-00000000d000', 'D Organiser', 10),
  ('00000000-0000-4000-8000-0000000d0b02', '00000000-0000-4000-8000-00000000d000', 'D One', 15),
  ('00000000-0000-4000-8000-0000000d0b03', '00000000-0000-4000-8000-00000000d000', 'D Two', 18),
  ('00000000-0000-4000-8000-0000000d0b04', '00000000-0000-4000-8000-00000000d000', 'D Guest', 20),
  ('00000000-0000-4000-8000-0000000e0b01', '00000000-0000-4000-8000-00000000e000', 'E One', 12);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000d000', '00000000-0000-4000-8000-0000000d0a01', '00000000-0000-4000-8000-0000000d0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000d000', '00000000-0000-4000-8000-0000000d0a02', '00000000-0000-4000-8000-0000000d0b02', 'player'),
  ('00000000-0000-4000-8000-00000000d000', '00000000-0000-4000-8000-0000000d0a03', '00000000-0000-4000-8000-0000000d0b03', 'player'),
  ('00000000-0000-4000-8000-00000000d000', '00000000-0000-4000-8000-0000000d0a04', '00000000-0000-4000-8000-0000000d0b04', 'guest'),
  ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-0000000e0a01', '00000000-0000-4000-8000-0000000e0b01', 'organiser');
insert into public.group_features (group_id, feature_key, enabled) values ('00000000-0000-4000-8000-00000000d000', 'comp_bonus', true)
  on conflict (group_id, feature_key) do update set enabled = true;
insert into public.trips (id, group_id, name) values ('00000000-0000-4000-8000-0000000d0c01', '00000000-0000-4000-8000-00000000d000', 'D trip');
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000d0c02', '00000000-0000-4000-8000-00000000d000', 'D course', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status, comp_bonus, min_drives) values
  ('00000000-0000-4000-8000-0000000d0c03', '00000000-0000-4000-8000-00000000d000', '00000000-0000-4000-8000-0000000d0c01', '00000000-0000-4000-8000-0000000d0c02', 'D round', 'ambrose', 'setup', 2, 3);
insert into public.rules (id, group_id, title, value, category, applies_to, status) values
  ('00000000-0000-4000-8000-0000000d0c04', '00000000-0000-4000-8000-00000000d000', 'Side comps worth strokes', '2 strokes', 'side_comp', '{ambrose}', 'active');

-- ================= d1 — player =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0a02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000d000"}', true); end $$;
do $$ declare v uuid; c public.cases; begin
  v := public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"comp_bonus","value":99,"label":"Worth 2 strokes","where":{"round_id":"00000000-0000-4000-8000-0000000d0c03","trip_id":"00000000-0000-4000-8000-0000000e0000","path":"/comps?r=1"}}',
    'Is “worth 2 strokes” right?', 'Too much for one shot', '1 stroke');
  select * into c from public.cases where id = v;
  insert into t_results (label, result) values ('member raises a dispute', c.kind || ' / ' || c.subject_kind || ' / value ' || (c.subject_ref->>'value') || ' / ' || (c.proposal->>'answer') || ' / where ' || (c.subject_ref->'where')::text);
exception when others then insert into t_results (label, result) values ('member raises a dispute', 'error: ' || sqlerrm); end $$;
do $$ begin
  perform public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"comp_bonus"}', 'Again: worth 2 strokes?');
  insert into t_results (label, result) values ('same person, same thing again', 'ok');
exception when others then insert into t_results (label, result) values ('same person, same thing again', case when sqlerrm like '%already raised%' then 'refused' else 'other: ' || sqlerrm end); end $$;
do $$ begin
  perform public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"name"}', 'The round''s name');
  insert into t_results (label, result) values ('a field that isn''t a rule (round name)', 'ok');
exception when others then insert into t_results (label, result) values ('a field that isn''t a rule (round name)', case when sqlerrm like '%can''t be disputed%' then 'refused' else 'other: ' || sqlerrm end); end $$;
do $$ begin
  perform public.raise_dispute('{"table":"scores","id":"00000000-0000-4000-8000-0000000d0c03","field":"strokes"}', 'A score');
  insert into t_results (label, result) values ('a score', 'ok');
exception when others then insert into t_results (label, result) values ('a score', case when sqlerrm like '%can''t be disputed%' then 'refused' else 'other: ' || sqlerrm end); end $$;
do $$ begin
  perform public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"min_drives","rule_id":"00000000-0000-4000-8000-0000000d0c04"}', 'Three drives each?');
  insert into t_results (label, result) values ('setting linked to a Rulebook rule', (select coalesce(rule_id::text, 'no rule') from public.cases where title = 'Three drives each?'));
exception when others then insert into t_results (label, result) values ('setting linked to a Rulebook rule', 'error: ' || sqlerrm); end $$;
do $$ begin
  insert into public.cases (group_id, kind, title, settings, subject_kind, subject_ref) values ('00000000-0000-4000-8000-00000000d000', 'ruling', 'Sneaky', '{}', 'setting', '{"table":"rounds","field":"comp_bonus"}');
  insert into t_results (label, result) values ('member writes a case directly', 'ok');
exception when others then insert into t_results (label, result) values ('member writes a case directly', 'refused'); end $$;
do $$ declare n int; begin
  update public.cases set subject_ref = '{"table":"rounds","field":"rules"}' where raised_by = '00000000-0000-4000-8000-0000000d0b02';
  get diagnostics n = row_count;
  insert into t_results (label, result) values ('member changes a dispute directly', n || ' rows');
exception when others then insert into t_results (label, result) values ('member changes a dispute directly', 'refused'); end $$;
do $$ begin
  update public.rounds set comp_bonus = 1 where id = '00000000-0000-4000-8000-0000000d0c03';
exception when others then null; end $$;

-- ================= d2 — another player, same setting; and the rule itself =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0a03","role":"authenticated"}';
do $$ begin
  perform public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"comp_bonus"}', 'I dispute it too');
  insert into t_results (label, result) values ('another player, same setting', 'ok');
exception when others then insert into t_results (label, result) values ('another player, same setting', 'other: ' || sqlerrm); end $$;
do $$ begin
  perform public.raise_dispute('{"table":"rules","id":"00000000-0000-4000-8000-0000000d0c04","field":"value"}', 'The rule itself');
  insert into t_results (label, result) values ('the rule while it already has an open case', 'ok');
exception when others then insert into t_results (label, result) values ('the rule while it already has an open case', case when sqlerrm like '%already has an open case%' then 'refused' else 'other: ' || sqlerrm end); end $$;
do $$ begin
  perform public.raise_dispute('{"table":"standard","field":"rule","key":"stableford.countback","value":"Ties: last round, then countback"}', 'Countback is a lottery');
  insert into t_results (label, result) values ('a standard rule', (select subject_kind || ' / ' || (subject_ref->>'value') from public.cases where title = 'Countback is a lottery'));
exception when others then insert into t_results (label, result) values ('a standard rule', 'error: ' || sqlerrm); end $$;

-- ================= dg — guest =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0a04","role":"authenticated"}';
do $$ begin
  perform public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"min_drives"}', 'Guest disputes');
  insert into t_results (label, result) values ('guest raises a dispute', 'ok');
exception when others then insert into t_results (label, result) values ('guest raises a dispute', case when sqlerrm like '%Guests%' then 'refused' else 'other: ' || sqlerrm end); end $$;
insert into t_results (label, result) select 'guest can read the disputes', count(*)::text from public.cases where subject_kind is not null;

-- ================= e1 — another group =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e000"}', true); end $$;
do $$ begin
  perform public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"comp_bonus"}', 'Another group disputes');
  insert into t_results (label, result) values ('other group disputes D''s round', 'ok');
exception when others then insert into t_results (label, result) values ('other group disputes D''s round', case when sqlerrm like '%isn''t one of this group%' then 'refused' else 'other: ' || sqlerrm end); end $$;
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000d000"}', true); end $$;
do $$ begin
  perform public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"comp_bonus"}', 'Another group, D header');
  insert into t_results (label, result) values ('other group with D''s header', 'ok');
exception when others then insert into t_results (label, result) values ('other group with D''s header', case when sqlerrm like '%isn''t one of this group%' then 'refused' else 'other: ' || sqlerrm end); end $$;
insert into t_results (label, result) select 'other group reads D''s disputes', count(*)::text from public.cases where group_id = '00000000-0000-4000-8000-00000000d000';

-- ================= tribunal switched off =================
reset role;
insert into public.group_features (group_id, feature_key, enabled) values ('00000000-0000-4000-8000-00000000d000', 'tribunal', false)
  on conflict (group_id, feature_key) do update set enabled = false;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0a03","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000d000"}', true); end $$;
do $$ begin
  perform public.raise_dispute('{"table":"rounds","id":"00000000-0000-4000-8000-0000000d0c03","field":"min_drives"}', 'Tribunal off dispute');
  insert into t_results (label, result) values ('tribunal off', 'ok');
exception when others then insert into t_results (label, result) values ('tribunal off', case when sqlerrm like '%switched off%' then 'refused' else 'other: ' || sqlerrm end); end $$;

reset role;
insert into t_results (label, result) select 'setting unchanged by disputes (comp bonus)', comp_bonus::text from public.rounds where id = '00000000-0000-4000-8000-0000000d0c03';
insert into t_results (label, result) select 'open disputes in D', count(*)::text from public.cases where group_id = '00000000-0000-4000-8000-00000000d000' and subject_kind is not null and status = 'open';
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
