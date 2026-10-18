-- Stage 9 test for 041b (leave, delete my account, delete a group). FOR JOSH: run on STAGING after applying 041b.
-- Everything is rolled back at the end; the results come back as an error message starting "RESULTS:".
begin;
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000f1001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000f1002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000f1003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false);
insert into public.groups (id, slug, name, group_pin, legacy, created_by) values
  ('00000000-0000-4000-8000-0000000f1a00', 'zzqx-del', 'Zzqx Delete Me', 'ZZQXDEL001', false, '00000000-0000-4000-8000-0000000f1001');
insert into public.players (id, group_id, name, nickname, handicap, approved, pay_details) values
  ('00000000-0000-4000-8000-0000000f1b01', '00000000-0000-4000-8000-0000000f1a00', 'Olive Organiser', null, 10, true, null),
  ('00000000-0000-4000-8000-0000000f1b02', '00000000-0000-4000-8000-0000000f1a00', 'Pete Player', 'Petey', 18, true, 'BSB 000-000'),
  ('00000000-0000-4000-8000-0000000f1b03', '00000000-0000-4000-8000-0000000f1a00', 'Quinn Quitter', null, 22, true, null);
insert into public.group_members (group_id, user_id, role, player_id) values
  ('00000000-0000-4000-8000-0000000f1a00', '00000000-0000-4000-8000-0000000f1001', 'organiser', '00000000-0000-4000-8000-0000000f1b01'),
  ('00000000-0000-4000-8000-0000000f1a00', '00000000-0000-4000-8000-0000000f1002', 'player', '00000000-0000-4000-8000-0000000f1b02'),
  ('00000000-0000-4000-8000-0000000f1a00', '00000000-0000-4000-8000-0000000f1003', 'player', '00000000-0000-4000-8000-0000000f1b03');
insert into public.location_pings (player_id, group_id, lat, lng, accuracy_m) values ('00000000-0000-4000-8000-0000000f1b03', '00000000-0000-4000-8000-0000000f1a00', -34.5, 150.4, 5);
insert into public.trips (id, group_id, name, start_date, end_date) values ('00000000-0000-4000-8000-0000000f1c01', '00000000-0000-4000-8000-0000000f1a00', 'Zzqx Trip', current_date, current_date);
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000f1d01', '00000000-0000-4000-8000-0000000f1a00', 'Zzqx Course',
  (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g) order by g) from generate_series(1, 18) g));
insert into public.rounds (id, group_id, trip_id, course_id, name, play_date, format, status) values
  ('00000000-0000-4000-8000-0000000f1e01', '00000000-0000-4000-8000-0000000f1a00', '00000000-0000-4000-8000-0000000f1c01', '00000000-0000-4000-8000-0000000f1d01', 'R1', current_date, 'stableford', 'live');
insert into public.round_players (round_id, player_id, playing_handicap) values ('00000000-0000-4000-8000-0000000f1e01', '00000000-0000-4000-8000-0000000f1b02', 18);
insert into public.scores (round_id, subject_id, subject_type, hole, strokes, picked_up) values ('00000000-0000-4000-8000-0000000f1e01', '00000000-0000-4000-8000-0000000f1b02', 'player', 1, 5, false);
set local role authenticated;
select set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-0000000f1a00"}', true);
-- Quinn leaves.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1003","role":"authenticated"}';
select public.leave_group();
reset role;
insert into t_results (label, result) select 'Quinn left', (select count(*) from public.group_members where user_id = '00000000-0000-4000-8000-0000000f1003')::text
  || ' memberships / location ' || (select count(*) from public.location_pings where player_id = '00000000-0000-4000-8000-0000000f1b03') || ' / name kept ' || (select name from public.players where id = '00000000-0000-4000-8000-0000000f1b03');
-- The only organiser can't leave while others are in.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1001","role":"authenticated"}';
do $$ begin perform public.leave_group(); insert into t_results (label, result) values ('only organiser leaves', 'ok');
exception when others then insert into t_results (label, result) values ('only organiser leaves', 'refused'); end $$;
-- Pete deletes his account and his name.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1002","role":"authenticated"}';
select public.delete_my_account(true);
reset role;
insert into t_results (label, result) select 'Pete deleted', (select count(*) from auth.users where id = '00000000-0000-4000-8000-0000000f1002')::text || ' sign-ins / name '
  || (select name || ' / pay ' || coalesce(pay_details, 'gone') from public.players where id = '00000000-0000-4000-8000-0000000f1b02') || ' / his score kept ' || (select count(*) from public.scores where subject_id = '00000000-0000-4000-8000-0000000f1b02');
-- Olive deletes the group: wrong name refused, right name deletes everything.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1001","role":"authenticated"}';
do $$ begin perform public.delete_group('Wrong name'); insert into t_results (label, result) values ('delete with the wrong name', 'ok');
exception when others then insert into t_results (label, result) values ('delete with the wrong name', 'refused'); end $$;
select public.delete_group('zzqx delete me');
reset role;
insert into t_results (label, result) select 'group deleted', (select count(*) from public.groups where id = '00000000-0000-4000-8000-0000000f1a00')::text || ' groups / '
  || (select count(*) from public.players where group_id = '00000000-0000-4000-8000-0000000f1a00') || ' players / ' || (select count(*) from public.scores where group_id = '00000000-0000-4000-8000-0000000f1a00') || ' scores';
-- L.G.C can't be deleted.
insert into t_results (label, result) select 'L.G.C still there', (select count(*) from public.groups where legacy)::text;
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
