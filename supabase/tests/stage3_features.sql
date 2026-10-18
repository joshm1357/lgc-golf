-- Stage 3 test: feature switches are enforced by the database. STAGING only, after 029. Rolled back; results in the
-- error message. Expected answers in stage3_features.expected.txt.
-- Group F: fo — organiser, f1 — player. L.G.C is the legacy group.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values ('00000000-0000-4000-8000-00000000f000', 'test-f', 'Test Group F', 'F-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000000f0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000f0b01', '00000000-0000-4000-8000-00000000f000', 'F Organiser', 10),
  ('00000000-0000-4000-8000-0000000f0b02', '00000000-0000-4000-8000-00000000f000', 'F One', 15);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-0000000f0a01', '00000000-0000-4000-8000-0000000f0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-0000000f0a02', '00000000-0000-4000-8000-0000000f0b02', 'player');
insert into public.trips (id, group_id, name) values ('00000000-0000-4000-8000-0000000f0c01', '00000000-0000-4000-8000-00000000f000', 'F trip');
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000f0c02', '00000000-0000-4000-8000-00000000f000', 'F course', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, trip_id, course_id, name, format, status) values
  ('00000000-0000-4000-8000-0000000f0c03', '00000000-0000-4000-8000-0000000f0c01', '00000000-0000-4000-8000-0000000f0c02', 'F round', 'stableford', 'live');
insert into public.plans (id, group_id, name, created_by) values ('00000000-0000-4000-8000-0000000f0c04', '00000000-0000-4000-8000-00000000f000', 'F plan', '00000000-0000-4000-8000-0000000f0b01');
insert into public.posts (id, group_id, kind, body) values ('00000000-0000-4000-8000-0000000f0c05', '00000000-0000-4000-8000-00000000f000', 'auto', 'F old post');

insert into t_results (label, result) select 'defaults for a new group: feed / location / comp bonus / rooms',
  public.feature_on('00000000-0000-4000-8000-00000000f000', 'feed') || ' / ' || public.feature_on('00000000-0000-4000-8000-00000000f000', 'location') || ' / ' ||
  public.feature_on('00000000-0000-4000-8000-00000000f000', 'comp_bonus') || ' / ' || public.feature_on('00000000-0000-4000-8000-00000000f000', 'planner_rooms');
insert into t_results (label, result) select 'L.G.C: location / rooms / connector / comp bonus / scorecard photo / booking links',
  public.feature_on(private.legacy_group(), 'location') || ' / ' || public.feature_on(private.legacy_group(), 'planner_rooms') || ' / ' ||
  public.feature_on(private.legacy_group(), 'connector') || ' / ' || public.feature_on(private.legacy_group(), 'comp_bonus') || ' / ' ||
  public.feature_on(private.legacy_group(), 'scorecard_photo') || ' / ' || public.feature_on(private.legacy_group(), 'booking_links');

-- ================= f1 — player =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f000"}', true); end $$;
do $$ begin
  insert into public.location_pings (player_id, lat, lng) values ('00000000-0000-4000-8000-0000000f0b02', -33.9, 151.1);
  insert into t_results (label, result) values ('location off by default: share location', 'ok');
exception when others then insert into t_results (label, result) values ('location off by default: share location', 'refused'); end $$;
insert into public.posts (kind, body, player_id) values ('user', 'F hello', '00000000-0000-4000-8000-0000000f0b02');
insert into t_results (label, result) values ('feed on: post', 'ok');
do $$ begin
  perform public.set_feature('feed', false);
  insert into t_results (label, result) values ('player switches a feature', 'ok');
exception when others then insert into t_results (label, result) values ('player switches a feature', 'refused'); end $$;
do $$ begin
  insert into public.group_features (group_id, feature_key, enabled) values ('00000000-0000-4000-8000-00000000f000', 'location', true);
  insert into t_results (label, result) values ('player writes the switches table', 'ok');
exception when others then insert into t_results (label, result) values ('player writes the switches table', 'refused'); end $$;

-- ================= fo — organiser switches things off =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a01","role":"authenticated"}';
select public.set_feature('feed', false), public.set_feature('planner', false), public.set_feature('tribunal', false);
insert into t_results (label, result) select 'switches saved', count(*)::text from public.group_features where group_id = '00000000-0000-4000-8000-00000000f000';

-- ================= f1 — after =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a02","role":"authenticated"}';
do $$ begin
  insert into public.posts (kind, body, player_id) values ('user', 'F after', '00000000-0000-4000-8000-0000000f0b02');
  insert into t_results (label, result) values ('feed off: post', 'ok');
exception when others then insert into t_results (label, result) values ('feed off: post', 'refused'); end $$;
insert into t_results (label, result) select 'feed off: old posts still readable', count(*)::text from public.posts where group_id = '00000000-0000-4000-8000-00000000f000';
do $$ declare n int; begin
  with d as (delete from public.posts where body = 'F hello' returning 1) select count(*) into n from d;
  insert into t_results (label, result) values ('feed off: delete own post (rows)', n::text);
end $$;
do $$ begin
  insert into public.plan_rsvps (plan_id, player_id, status) values ('00000000-0000-4000-8000-0000000f0c04', '00000000-0000-4000-8000-0000000f0b02', 'in');
  insert into t_results (label, result) values ('planner off: say I''m in', 'ok');
exception when others then insert into t_results (label, result) values ('planner off: say I''m in', 'refused'); end $$;
do $$ begin
  insert into public.plan_costs (plan_id, title, amount, paid_by, created_by) values ('00000000-0000-4000-8000-0000000f0c04', 'x', 10, '00000000-0000-4000-8000-0000000f0b02', '00000000-0000-4000-8000-0000000f0b02');
  insert into t_results (label, result) values ('planner off: shared cost (its child)', 'ok');
exception when others then insert into t_results (label, result) values ('planner off: shared cost (its child)', 'refused'); end $$;
do $$ begin
  perform public.lodge_case('00000000-0000-4000-8000-0000000f0b01', 2, 'x', null);
  insert into t_results (label, result) values ('tribunal off: lodge a case', 'ok');
exception when others then insert into t_results (label, result) values ('tribunal off: lodge a case', 'refused: ' || sqlerrm); end $$;
insert into public.scores (round_id, subject_id, subject_type, hole, strokes) values ('00000000-0000-4000-8000-0000000f0c03', '00000000-0000-4000-8000-0000000f0b02', 'player', 1, 3);
insert into t_results (label, result) values ('scoring still works with everything off', 'ok');
insert into t_results (label, result) select 'feed off: no birdie post', count(*)::text from public.posts where round_id = '00000000-0000-4000-8000-0000000f0c03';

-- ================= fo — side comp bonus (off by default) =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a01","role":"authenticated"}';
do $$ begin
  update public.rounds set comp_bonus = 2 where id = '00000000-0000-4000-8000-0000000f0c03';
  insert into t_results (label, result) values ('comp bonus off: set bonus strokes', 'ok');
exception when others then insert into t_results (label, result) values ('comp bonus off: set bonus strokes', 'refused'); end $$;
select public.set_feature('comp_bonus', true);
update public.rounds set comp_bonus = 2 where id = '00000000-0000-4000-8000-0000000f0c03';
insert into t_results (label, result) select 'comp bonus on: set bonus strokes', comp_bonus::text from public.rounds where id = '00000000-0000-4000-8000-0000000f0c03';
select public.set_feature('side_comps', false);
insert into t_results (label, result) values ('parent off switches the child off', public.feature_on('00000000-0000-4000-8000-00000000f000', 'comp_bonus')::text);

-- ================= another group can't see F's switches =================
set local request.jwt.claims to '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
insert into t_results (label, result) select 'L.G.C sees F''s switches', count(*)::text from public.group_features where group_id = '00000000-0000-4000-8000-00000000f000';

reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
