-- Stage 1 isolation test. Run on STAGING only, after 022. Everything is rolled back at the end;
-- the results come back as the error message ("RESULTS: ..."). Expected answers are in
-- stage1_isolation.expected.txt.
--
-- Two groups: L.G.C (the legacy group) and "Test Group B". People:
--   a   — L.G.C player only          b   — Group B organiser
--   b2  — Group B player             ab  — in both (L.G.C first, then B)

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_ids (k text primary key, id uuid);
grant select on t_ids to authenticated;

insert into public.groups (slug, name, group_pin, admin_pin) values ('test-b', 'Test Group B', 'b-pin-1234', 'b-admin-1234');
insert into t_ids select 'B', id from public.groups where slug = 'test-b';
insert into t_ids select 'A', private.legacy_group();

insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000bb01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000bb02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000ab01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

-- Players
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000a0001', (select id from t_ids where k='A'), 'A Player', 12),
  ('00000000-0000-4000-8000-0000000a0002', (select id from t_ids where k='A'), 'AB in LGC', 20),
  ('00000000-0000-4000-8000-0000000b0001', (select id from t_ids where k='B'), 'B Organiser', 10),
  ('00000000-0000-4000-8000-0000000b0002', (select id from t_ids where k='B'), 'B Player', 25),
  ('00000000-0000-4000-8000-0000000b0003', (select id from t_ids where k='B'), 'AB in B', 22);
insert into public.group_members (group_id, user_id, player_id, role, created_at) values
  ((select id from t_ids where k='A'), '00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000a0001', 'player', now() - interval '2 days'),
  ((select id from t_ids where k='B'), '00000000-0000-4000-8000-00000000bb01', '00000000-0000-4000-8000-0000000b0001', 'organiser', now()),
  ((select id from t_ids where k='B'), '00000000-0000-4000-8000-00000000bb02', '00000000-0000-4000-8000-0000000b0002', 'player', now()),
  ((select id from t_ids where k='A'), '00000000-0000-4000-8000-00000000ab01', '00000000-0000-4000-8000-0000000a0002', 'player', now() - interval '1 day'),
  ((select id from t_ids where k='B'), '00000000-0000-4000-8000-00000000ab01', '00000000-0000-4000-8000-0000000b0003', 'player', now());

-- Group B data: trip, course, live round, a score, a plan with a cost, a room, a rule, a post, a Tribunal case.
insert into public.trips (id, group_id, name) values ('00000000-0000-4000-8000-0000000bc001', (select id from t_ids where k='B'), 'B trip');
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000bc002', (select id from t_ids where k='B'), 'B course', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, trip_id, course_id, name, format, status) values
  ('00000000-0000-4000-8000-0000000bc003', '00000000-0000-4000-8000-0000000bc001', '00000000-0000-4000-8000-0000000bc002', 'B round', 'stableford', 'live');
insert into public.scores (round_id, subject_id, subject_type, hole, strokes) values
  ('00000000-0000-4000-8000-0000000bc003', '00000000-0000-4000-8000-0000000b0002', 'player', 1, 4);
insert into public.plans (id, group_id, name, created_by) values ('00000000-0000-4000-8000-0000000bc004', (select id from t_ids where k='B'), 'B plan', '00000000-0000-4000-8000-0000000b0001');
insert into public.plan_costs (id, plan_id, title, amount, paid_by, created_by) values
  ('00000000-0000-4000-8000-0000000bc005', '00000000-0000-4000-8000-0000000bc004', 'B house', 900, '00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-0000000b0001');
insert into public.plan_groups (id, plan_id, kind, name) values ('00000000-0000-4000-8000-0000000bc006', '00000000-0000-4000-8000-0000000bc004', 'room', 'B room');
insert into public.plan_group_members (group_id, player_id) values ('00000000-0000-4000-8000-0000000bc006', '00000000-0000-4000-8000-0000000b0002');
insert into public.rules (id, group_id, title, status) values ('00000000-0000-4000-8000-0000000bc007', (select id from t_ids where k='B'), 'B rule', 'active');
insert into public.posts (id, group_id, kind, body) values ('00000000-0000-4000-8000-0000000bc008', (select id from t_ids where k='B'), 'auto', 'B post');
insert into public.tribunal_cases (id, accused_id, lodged_by, proposed_change, case_text) values
  ('00000000-0000-4000-8000-0000000bc009', '00000000-0000-4000-8000-0000000b0002', '00000000-0000-4000-8000-0000000b0001', 2, 'B case');
-- A plan in L.G.C for the other direction.
insert into public.plans (id, group_id, name, created_by) values ('00000000-0000-4000-8000-0000000ac004', (select id from t_ids where k='A'), 'A plan', '00000000-0000-4000-8000-0000000a0001');

insert into t_results (label, result) select 'parent fills group: B round', (group_id = (select id from t_ids where k='B'))::text from public.rounds where id = '00000000-0000-4000-8000-0000000bc003';
insert into t_results (label, result) select 'parent fills group: B score', (group_id = (select id from t_ids where k='B'))::text from public.scores where round_id = '00000000-0000-4000-8000-0000000bc003';
insert into t_results (label, result) select 'parent fills group: B case', (group_id = (select id from t_ids where k='B'))::text from public.tribunal_cases where id = '00000000-0000-4000-8000-0000000bc009';
do $$ begin
  insert into public.scores (group_id, round_id, subject_id, subject_type, hole, strokes)
  values ((select id from t_ids where k='A'), '00000000-0000-4000-8000-0000000bc003', '00000000-0000-4000-8000-0000000b0002', 'player', 2, 4);
  insert into t_results (label, result) values ('score with wrong group for its round', 'ok');
exception when others then insert into t_results (label, result) values ('score with wrong group for its round', 'refused'); end $$;

-- ================= a — L.G.C only (no group header: like an old phone) =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000aa01","role":"authenticated"}';
do $$
declare t text; n int; total int := 0; seen text := '';
begin
  foreach t in array array['players','trips','courses','honour_board','rules','tribunal_cases','tribunal_votes',
    'location_pings','handicap_history','trophies','rounds','teams','team_players','round_players','scores',
    'quick_results','side_entries','round_pins','draws','posts','comments','reactions','plans','plan_polls',
    'plan_options','plan_votes','plan_rsvps','plan_items','plan_costs','plan_payments','plan_groups',
    'plan_transfers','rule_votes']
  loop
    execute format('select count(*) from public.%I where group_id = (select id from t_ids where k = ''B'')', t) into n;
    total := total + n; if n > 0 then seen := seen || t || ' '; end if;
  end loop;
  select count(*) into n from public.plan_group_members where group_id = '00000000-0000-4000-8000-0000000bc006';
  total := total + n;
  select count(*) into n from public.groups where slug = 'test-b'; total := total + n;
  select count(*) into n from public.group_members where group_id = (select id from t_ids where k = 'B'); total := total + n;
  insert into t_results (label, result) values ('a sees Group B rows (all tables)', total || coalesce(nullif(' ' || seen, ' '), ''));
end $$;
insert into t_results (label, result) select 'a sees own L.G.C plan', count(*)::text from public.plans where id = '00000000-0000-4000-8000-0000000ac004';
insert into t_results (label, result) select 'a my_status group', (public.my_status() ->> 'group_name');
do $$ declare n int; begin
  with u as (update public.plans set name = 'hacked' where id = '00000000-0000-4000-8000-0000000bc004' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('a edits B plan (rows)', n);
end $$;
do $$ declare n int; begin
  with d as (delete from public.plan_costs where id = '00000000-0000-4000-8000-0000000bc005' returning 1) select count(*) into n from d;
  insert into t_results (label, result) values ('a deletes B cost (rows)', n);
end $$;
do $$ declare n int; begin
  with u as (update public.players set handicap = 1 where id = '00000000-0000-4000-8000-0000000b0002' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('a changes B player handicap (rows)', n);
end $$;
do $$ begin
  insert into public.scores (round_id, subject_id, subject_type, hole, strokes) values ('00000000-0000-4000-8000-0000000bc003', '00000000-0000-4000-8000-0000000a0001', 'player', 3, 3);
  insert into t_results (label, result) values ('a enters a score in B round', 'ok');
exception when others then insert into t_results (label, result) values ('a enters a score in B round', 'refused'); end $$;
do $$ begin
  insert into public.posts (group_id, kind, body, player_id) values ((select id from t_ids where k='B'), 'user', 'spam', '00000000-0000-4000-8000-0000000a0001');
  insert into t_results (label, result) values ('a posts into B feed', 'ok');
exception when others then insert into t_results (label, result) values ('a posts into B feed', 'refused'); end $$;
do $$ begin
  insert into public.plan_rsvps (plan_id, player_id, status) values ('00000000-0000-4000-8000-0000000bc004', '00000000-0000-4000-8000-0000000a0001', 'in');
  insert into t_results (label, result) values ('a says In to B plan', 'ok');
exception when others then insert into t_results (label, result) values ('a says In to B plan', 'refused'); end $$;
do $$ begin
  insert into public.plan_group_members (group_id, player_id) values ('00000000-0000-4000-8000-0000000bc006', '00000000-0000-4000-8000-0000000a0001');
  insert into t_results (label, result) values ('a puts self in B room', 'ok');
exception when others then insert into t_results (label, result) values ('a puts self in B room', 'refused'); end $$;
do $$ begin
  perform public.claim_player('00000000-0000-4000-8000-0000000b0002');
  insert into t_results (label, result) values ('a claims B player', 'ok');
exception when others then insert into t_results (label, result) values ('a claims B player', 'refused'); end $$;
do $$ begin
  perform public.lodge_case('00000000-0000-4000-8000-0000000b0002', 1, 'cross-group case', null);
  insert into t_results (label, result) values ('a lodges case against B player', 'ok');
exception when others then insert into t_results (label, result) values ('a lodges case against B player', 'refused'); end $$;
do $$ begin
  perform public.cast_vote('00000000-0000-4000-8000-0000000bc009', 'guilty', null);
  insert into t_results (label, result) values ('a votes in B case', 'ok');
exception when others then insert into t_results (label, result) values ('a votes in B case', 'refused'); end $$;
do $$ begin
  insert into storage.objects (bucket_id, name, owner) values ('photos', (select id from t_ids where k='B')::text || '/feed/x.jpg', auth.uid());
  insert into t_results (label, result) values ('a uploads photo into B folder', 'ok');
exception when others then insert into t_results (label, result) values ('a uploads photo into B folder', 'refused'); end $$;
do $$ begin
  insert into storage.objects (bucket_id, name, owner) values ('photos', 'feed/old-phone.jpg', auth.uid());
  insert into t_results (label, result) values ('a uploads photo the old way (feed/…)', 'ok');
exception when others then insert into t_results (label, result) values ('a uploads photo the old way (feed/…)', 'refused'); end $$;

-- ================= b2 — Group B player =================
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000bb02","role":"authenticated"}';
do $$
declare t text; n int; total int := 0;
begin
  foreach t in array array['players','trips','courses','honour_board','rules','tribunal_cases','tribunal_votes',
    'location_pings','handicap_history','trophies','rounds','teams','team_players','round_players','scores',
    'quick_results','side_entries','round_pins','draws','posts','comments','reactions','plans','plan_polls',
    'plan_options','plan_votes','plan_rsvps','plan_items','plan_costs','plan_payments','plan_groups',
    'plan_transfers','rule_votes']
  loop
    execute format('select count(*) from public.%I where group_id = (select id from t_ids where k = ''A'')', t) into n;
    total := total + n;
  end loop;
  select count(*) into n from public.plan_group_members pgm join public.plan_groups pg on pg.id = pgm.group_id where pg.group_id = (select id from t_ids where k='A');
  total := total + n;
  insert into t_results (label, result) values ('b2 sees L.G.C rows (all tables)', total);
end $$;
insert into t_results (label, result) select 'b2 sees B rows: players', count(*)::text from public.players;
insert into t_results (label, result) select 'b2 my_status group', (public.my_status() ->> 'group_name');
do $$ declare n int; begin
  with u as (update public.players set handicap = 1 where id = '00000000-0000-4000-8000-0000000b0001' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('b2 changes B organiser handicap (rows)', n);
exception when others then insert into t_results (label, result) values ('b2 changes B organiser handicap (rows)', 'refused by handicap guard'); end $$;
do $$ begin
  insert into public.scores (round_id, subject_id, subject_type, hole, strokes) values ('00000000-0000-4000-8000-0000000bc003', '00000000-0000-4000-8000-0000000b0002', 'player', 2, 5);
  insert into t_results (label, result) values ('b2 enters own score in B round', 'ok');
exception when others then insert into t_results (label, result) values ('b2 enters own score in B round', 'refused'); end $$;
do $$ begin
  perform public.claim_admin('stage-admin-9999');
  insert into t_results (label, result) values ('b2 uses L.G.C admin PIN', (select role from public.group_members where user_id = auth.uid()));
exception when others then insert into t_results (label, result) values ('b2 uses L.G.C admin PIN', 'refused'); end $$;
do $$ begin
  perform public.join_group('stage-lgc-1111');
  insert into t_results (label, result) values ('b2 joins L.G.C with its PIN', (select count(*)::text from public.group_members where user_id = auth.uid()));
exception when others then insert into t_results (label, result) values ('b2 joins L.G.C with its PIN', 'refused'); end $$;

-- ================= b — Group B organiser =================
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000bb01","role":"authenticated"}';
do $$ declare n int; begin
  with u as (update public.players set handicap = 24 where id = '00000000-0000-4000-8000-0000000b0002' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('b organiser changes B player handicap (rows)', n);
end $$;
insert into t_results (label, result) select 'b handicap change logged in group B', (count(*) filter (where group_id = (select id from t_ids where k='B')))::text
  from public.handicap_history where player_id = '00000000-0000-4000-8000-0000000b0002' and reason = 'Admin change';
do $$ declare n int; begin
  with u as (update public.rounds set status = 'locked' where group_id = (select id from t_ids where k='A') returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('b organiser locks L.G.C rounds (rows)', n);
end $$;
do $$ declare n int; begin
  with u as (update public.players set handicap = 1 where group_id = (select id from t_ids where k='A') returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('b organiser changes L.G.C handicaps (rows)', n);
end $$;
do $$ begin
  perform public.chair_close_case('00000000-0000-4000-8000-0000000bc009', 'dismissed', 'test');
  insert into t_results (label, result) values ('b organiser closes B case', (select status from public.tribunal_cases where id = '00000000-0000-4000-8000-0000000bc009'));
exception when others then insert into t_results (label, result) values ('b organiser closes B case', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'B verdict post is in group B', (group_id = (select id from t_ids where k='B'))::text
  from public.posts where link = '/tribunal/00000000-0000-4000-8000-0000000bc009' and kind = 'tribunal' limit 1;

-- ================= ab — in both groups =================
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000ab01","role":"authenticated"}';
insert into t_results (label, result) select 'ab no header: group', (public.my_status() ->> 'group_name');
insert into t_results (label, result) select 'ab no header: groups listed', json_array_length(public.my_status() -> 'groups')::text;
do $$ begin perform set_config('request.headers', json_build_object('x-group-id', (select id from t_ids where k='B'))::text, true); end $$;
insert into t_results (label, result) select 'ab header B: group', (public.my_status() ->> 'group_name');
insert into t_results (label, result) select 'ab header B: my player', (public.my_player_id() = '00000000-0000-4000-8000-0000000b0003')::text;
do $$ begin
  insert into public.posts (kind, body, player_id) values ('user', 'hello B', '00000000-0000-4000-8000-0000000b0003');
  insert into t_results (label, result) values ('ab header B: post lands in', (select g.slug from public.posts p join public.groups g on g.id = p.group_id where p.body = 'hello B'));
exception when others then insert into t_results (label, result) values ('ab header B: post lands in', 'refused: ' || sqlerrm); end $$;
do $$ begin
  insert into public.posts (kind, body, player_id) values ('user', 'B post as my LGC self', '00000000-0000-4000-8000-0000000a0002');
  insert into t_results (label, result) values ('ab header B: post as L.G.C profile', (select g.slug from public.posts p join public.groups g on g.id = p.group_id where p.body = 'B post as my LGC self'));
exception when others then insert into t_results (label, result) values ('ab header B: post as L.G.C profile', 'refused'); end $$;
do $$ begin perform set_config('request.headers', json_build_object('x-group-id', '00000000-0000-4000-8000-0000000000ff')::text, true); end $$;
insert into t_results (label, result) select 'ab header for a group not mine: falls back to', (public.my_status() ->> 'group_name');

reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
