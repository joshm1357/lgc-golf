-- Beta checks (047, 20 Oct 2026). STAGING only. Everything is rolled back; the results come back as the error message
-- ("RESULTS: ..."). Expected answers are in beta.expected.txt.
-- Group F: fo — organiser; fp — player. stranger — signed in, in no group (starts one later). josh — a platform admin.
-- loner (fea05) — phone-only sign-in, never in a group.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

update private.platform_flags set is_on = false where key = 'new_groups_open';   -- start closed, as on live
insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-0000000fe000', 'test-f', 'Test Group F', 'F-CODE-TEST-1', 'f-admin-1234');
insert into auth.users (id, instance_id, aud, role, is_anonymous, email) values
  ('00000000-0000-4000-8000-0000000fea01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'fo@example.com'),
  ('00000000-0000-4000-8000-0000000fea02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'fp@example.com'),
  ('00000000-0000-4000-8000-0000000fea03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'stranger@example.com'),
  ('00000000-0000-4000-8000-0000000fea04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'josh@example.com'),
  ('00000000-0000-4000-8000-0000000fea05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, null);
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000fea04');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000000feb01', '00000000-0000-4000-8000-0000000fe000', 'F Organiser', null, 10),
  ('00000000-0000-4000-8000-0000000feb02', '00000000-0000-4000-8000-0000000fe000', 'Fred Player', 'Freddo', 18);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-0000000fe000', '00000000-0000-4000-8000-0000000fea01', '00000000-0000-4000-8000-0000000feb01', 'organiser'),
  ('00000000-0000-4000-8000-0000000fe000', '00000000-0000-4000-8000-0000000fea02', '00000000-0000-4000-8000-0000000feb02', 'player');
insert into t_results (label, result) values ('migration-style group insert while closed', 'ok');

set local role authenticated;

-- ================= New groups while closed =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fea03","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
insert into t_results (label, result) values ('stranger: open?', public.new_groups_open()::text);
do $$ begin
  perform public.create_group('Stranger Danger', '{}'::jsonb, 'Stan', 20);
  insert into t_results (label, result) values ('stranger starts a group (closed)', 'made');
exception when others then insert into t_results (label, result) values ('stranger starts a group (closed)', 'refused: ' || left(sqlerrm, 32)); end $$;

set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fea04","role":"authenticated"}';
insert into t_results (label, result) values ('josh: open?', public.new_groups_open()::text);
do $$ begin
  perform public.create_group('Josh Test Group', '{}'::jsonb, 'Josh', 13);
  insert into t_results (label, result) values ('josh starts a group (closed)', 'made');
exception when others then insert into t_results (label, result) values ('josh starts a group (closed)', 'refused: ' || left(sqlerrm, 32)); end $$;

-- ================= New groups when open =================
reset role;
update private.platform_flags set is_on = true where key = 'new_groups_open';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fea03","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
insert into t_results (label, result) values ('stranger: open? (after opening)', public.new_groups_open()::text);
do $$ begin
  perform public.create_group('Stranger Group', '{}'::jsonb, 'Stan', 20);
  insert into t_results (label, result) values ('stranger starts a group (open)', 'made');
exception when others then insert into t_results (label, result) values ('stranger starts a group (open)', 'refused: ' || left(sqlerrm, 32)); end $$;

-- ================= Feedback =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fea02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-0000000fe000"}', true); end $$;
do $$ begin
  perform public.send_feedback('idea', '  Weather on the trip page please  ', '/plan?x=1', 'abc123', 'test agent');
  insert into t_results (label, result) values ('player sends an idea', 'sent');
exception when others then insert into t_results (label, result) values ('player sends an idea', 'refused: ' || left(sqlerrm, 32)); end $$;
do $$ begin
  perform public.send_feedback('rant', 'hello there');
  insert into t_results (label, result) values ('unknown kind', 'sent');
exception when others then insert into t_results (label, result) values ('unknown kind', 'refused: ' || left(sqlerrm, 20)); end $$;
do $$ begin
  perform public.send_feedback('like', ' a ');
  insert into t_results (label, result) values ('too short', 'sent');
exception when others then insert into t_results (label, result) values ('too short', 'refused: ' || left(sqlerrm, 20)); end $$;
do $$ begin
  perform count(*) from public.beta_feedback;
  insert into t_results (label, result) values ('player reads the feedback table', 'read');
exception when others then insert into t_results (label, result) values ('player reads the feedback table', 'refused'); end $$;
insert into t_results (label, result) values ('player sees admin list', coalesce(public.admin_feedback(30)::text, 'nothing'));
do $$ begin
  perform public.admin_feedback_done((select gen_random_uuid()), true);
  insert into t_results (label, result) values ('player ticks feedback done', 'done');
exception when others then insert into t_results (label, result) values ('player ticks feedback done', 'refused: ' || left(sqlerrm, 20)); end $$;
do $$ begin
  for i in 1..19 loop perform public.send_feedback('problem', 'Problem number ' || i); end loop;
  perform public.send_feedback('problem', 'One too many');
  insert into t_results (label, result) values ('21st in a day', 'sent');
exception when others then insert into t_results (label, result) values ('21st in a day', 'refused: ' || left(sqlerrm, 14)); end $$;

set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fea05","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
do $$ begin
  perform public.send_feedback('idea', 'I am in no group at all');
  insert into t_results (label, result) values ('someone in no group', 'sent');
exception when others then insert into t_results (label, result) values ('someone in no group', 'refused: ' || left(sqlerrm, 20)); end $$;

set local request.jwt.claims to '{"role":"authenticated"}';
do $$ begin
  perform public.send_feedback('idea', 'nobody signed in');
  insert into t_results (label, result) values ('no sign-in', 'sent');
exception when others then insert into t_results (label, result) values ('no sign-in', 'refused: ' || left(sqlerrm, 13)); end $$;

set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fea04","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
insert into t_results (label, result)
  select 'josh sees', (select count(*)::text from json_array_elements(public.admin_feedback(30)) e where e->>'group_name' = 'Test Group F');
insert into t_results (label, result)
  select 'the idea, as josh sees it', e->>'kind' || ' / ' || (e->>'message') || ' / ' || (e->>'path') || ' / ' || (e->>'player_name') || ' / ' || (e->>'group_name')
  from json_array_elements(public.admin_feedback(30)) e where e->>'kind' = 'idea' and e->>'group_name' = 'Test Group F';
do $$ declare v uuid; begin
  select (e->>'id')::uuid into v from json_array_elements(public.admin_feedback(30)) e where e->>'kind' = 'idea' and e->>'group_name' = 'Test Group F';
  perform public.admin_feedback_done(v, true);
  insert into t_results (label, result) values ('josh ticks it done', (select (e->>'done') from json_array_elements(public.admin_feedback(30)) e where (e->>'id')::uuid = v));
end $$;

insert into t_results (label, result)
  select 'josh list without done items', (select count(*)::text from json_array_elements(public.admin_feedback(30, false)) e where e->>'group_name' = 'Test Group F');

-- An organiser deletes the group: the feedback's words stay (no group name any more).
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fea01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-0000000fe000"}', true); end $$;
do $$ begin
  perform public.delete_group('00000000-0000-4000-8000-0000000fe000', 'Test Group F');
  insert into t_results (label, result) values ('organiser deletes group F', 'deleted');
exception when others then insert into t_results (label, result) values ('organiser deletes group F', 'refused: ' || left(sqlerrm, 30)); end $$;
reset role;
insert into t_results (label, result)
  select 'feedback after the group is deleted', count(*)::text || ' kept, group ' || coalesce(max(from_group::text), 'cleared')
  from public.beta_feedback where message = 'Weather on the trip page please';

reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
