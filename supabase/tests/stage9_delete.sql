-- Stage 9 test for 041b (leave, delete my account, delete a group). FOR JOSH: run on STAGING after applying 041b.
-- Everything is rolled back at the end; the results come back as an error message starting "RESULTS:".
begin;
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
-- Group A (to be deleted): Olive organiser, Pete player, Quinn player, Ana phone-only co-organiser.
-- Group B (must survive): Bea organiser and Pete too. Solo group: Sol on his own.
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000f1001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000f1002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000f1003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000f1004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000f1005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000f1006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false);
insert into public.groups (id, slug, name, group_pin, legacy, created_by) values
  ('00000000-0000-4000-8000-0000000f1a00', 'zzqx-del', 'Zzqx Delete Me', 'ZZQXDEL001', false, '00000000-0000-4000-8000-0000000f1001'),
  ('00000000-0000-4000-8000-0000000f2a00', 'zzqx-keep', 'Zzqx Keep Me', 'ZZQXKEEP01', false, '00000000-0000-4000-8000-0000000f1005'),
  ('00000000-0000-4000-8000-0000000f3a00', 'zzqx-solo', 'Zzqx Solo', 'ZZQXSOLO01', false, '00000000-0000-4000-8000-0000000f1006');
insert into public.players (id, group_id, name, nickname, handicap, approved, pay_details) values
  ('00000000-0000-4000-8000-0000000f1b01', '00000000-0000-4000-8000-0000000f1a00', 'Olive Organiser', null, 10, true, null),
  ('00000000-0000-4000-8000-0000000f1b02', '00000000-0000-4000-8000-0000000f1a00', 'Pete Player', 'Petey', 18, true, 'BSB 000-000'),
  ('00000000-0000-4000-8000-0000000f1b03', '00000000-0000-4000-8000-0000000f1a00', 'Quinn Quitter', null, 22, true, null),
  ('00000000-0000-4000-8000-0000000f2b01', '00000000-0000-4000-8000-0000000f2a00', 'Bea Boss', null, 9, true, null),
  ('00000000-0000-4000-8000-0000000f2b02', '00000000-0000-4000-8000-0000000f2a00', 'Pete Player', 'Petey', 18, true, null),
  ('00000000-0000-4000-8000-0000000f3b01', '00000000-0000-4000-8000-0000000f3a00', 'Sol Solo', null, 15, true, null);
insert into public.group_members (group_id, user_id, role, player_id) values
  ('00000000-0000-4000-8000-0000000f1a00', '00000000-0000-4000-8000-0000000f1001', 'organiser', '00000000-0000-4000-8000-0000000f1b01'),
  ('00000000-0000-4000-8000-0000000f1a00', '00000000-0000-4000-8000-0000000f1002', 'player', '00000000-0000-4000-8000-0000000f1b02'),
  ('00000000-0000-4000-8000-0000000f1a00', '00000000-0000-4000-8000-0000000f1003', 'player', '00000000-0000-4000-8000-0000000f1b03'),
  ('00000000-0000-4000-8000-0000000f1a00', '00000000-0000-4000-8000-0000000f1004', 'organiser', null),
  ('00000000-0000-4000-8000-0000000f2a00', '00000000-0000-4000-8000-0000000f1005', 'organiser', '00000000-0000-4000-8000-0000000f2b01'),
  ('00000000-0000-4000-8000-0000000f2a00', '00000000-0000-4000-8000-0000000f1002', 'player', '00000000-0000-4000-8000-0000000f2b02'),
  ('00000000-0000-4000-8000-0000000f3a00', '00000000-0000-4000-8000-0000000f1006', 'organiser', '00000000-0000-4000-8000-0000000f3b01');
insert into public.location_pings (player_id, group_id, lat, lng, accuracy_m) values ('00000000-0000-4000-8000-0000000f1b03', '00000000-0000-4000-8000-0000000f1a00', -34.5, 150.4, 5);
insert into public.trips (id, group_id, name, start_date, end_date) values
  ('00000000-0000-4000-8000-0000000f1c01', '00000000-0000-4000-8000-0000000f1a00', 'Zzqx Trip', current_date, current_date),
  ('00000000-0000-4000-8000-0000000f2c01', '00000000-0000-4000-8000-0000000f2a00', 'Zzqx Keep Trip', current_date, current_date);
insert into public.courses (id, group_id, name, holes) values
  ('00000000-0000-4000-8000-0000000f1d01', '00000000-0000-4000-8000-0000000f1a00', 'Zzqx Course', (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g) order by g) from generate_series(1, 18) g)),
  ('00000000-0000-4000-8000-0000000f2d01', '00000000-0000-4000-8000-0000000f2a00', 'Zzqx Keep Course', (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g) order by g) from generate_series(1, 18) g));
insert into public.rounds (id, group_id, trip_id, course_id, name, play_date, format, status) values
  ('00000000-0000-4000-8000-0000000f1e01', '00000000-0000-4000-8000-0000000f1a00', '00000000-0000-4000-8000-0000000f1c01', '00000000-0000-4000-8000-0000000f1d01', 'R1', current_date, 'stableford', 'live'),
  ('00000000-0000-4000-8000-0000000f2e01', '00000000-0000-4000-8000-0000000f2a00', '00000000-0000-4000-8000-0000000f2c01', '00000000-0000-4000-8000-0000000f2d01', 'K1', current_date, 'stableford', 'live');
insert into public.round_players (round_id, player_id, playing_handicap) values
  ('00000000-0000-4000-8000-0000000f1e01', '00000000-0000-4000-8000-0000000f1b02', 18), ('00000000-0000-4000-8000-0000000f2e01', '00000000-0000-4000-8000-0000000f2b02', 18);
insert into public.scores (round_id, subject_id, subject_type, hole, strokes, picked_up) values
  ('00000000-0000-4000-8000-0000000f1e01', '00000000-0000-4000-8000-0000000f1b02', 'player', 1, 5, false),
  ('00000000-0000-4000-8000-0000000f2e01', '00000000-0000-4000-8000-0000000f2b02', 'player', 1, 3, false);
insert into public.honour_board (group_id, trophy_name, label, winner_names, player_ids, sort_key) values
  ('00000000-0000-4000-8000-0000000f2a00', 'Keep Cup', '2026', 'Petey & Bea', array['00000000-0000-4000-8000-0000000f2b02', '00000000-0000-4000-8000-0000000f2b01']::uuid[], 10);
insert into public.posts (group_id, trip_id, kind, body) values ('00000000-0000-4000-8000-0000000f2a00', '00000000-0000-4000-8000-0000000f2c01', 'auto', 'Petey made birdie on 1.');
set local role authenticated;
-- Quinn leaves group A (named).
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1003","role":"authenticated"}';
select public.leave_group('00000000-0000-4000-8000-0000000f1a00');
reset role;
insert into t_results (label, result) select 'Quinn left', (select count(*) from public.group_members where user_id = '00000000-0000-4000-8000-0000000f1003')::text
  || ' memberships / location ' || (select count(*) from public.location_pings where player_id = '00000000-0000-4000-8000-0000000f1b03') || ' / name kept ' || (select name from public.players where id = '00000000-0000-4000-8000-0000000f1b03');
set local role authenticated;
-- Leaving a group you're not in; Sol alone can't leave (or delete his account) — he deletes the group instead.
do $$ begin perform public.leave_group('00000000-0000-4000-8000-0000000f2a00'); insert into t_results (label, result) values ('Quinn leaves a group he isn''t in', 'ok');
exception when others then insert into t_results (label, result) values ('Quinn leaves a group he isn''t in', 'refused'); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1006","role":"authenticated"}';
do $$ begin perform public.leave_group('00000000-0000-4000-8000-0000000f3a00'); insert into t_results (label, result) values ('the only person leaves', 'ok');
exception when others then insert into t_results (label, result) values ('the only person leaves', 'refused'); end $$;
do $$ begin perform public.delete_my_account(false); insert into t_results (label, result) values ('the only person deletes his account', 'ok');
exception when others then insert into t_results (label, result) values ('the only person deletes his account', 'refused'); end $$;
-- Bea is the only organiser of B (with Pete in it): can't leave.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1005","role":"authenticated"}';
do $$ begin perform public.leave_group('00000000-0000-4000-8000-0000000f2a00'); insert into t_results (label, result) values ('the only organiser leaves', 'ok');
exception when others then insert into t_results (label, result) values ('the only organiser leaves', 'refused'); end $$;
-- Pete deletes his account and his name (he's in A and B).
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1002","role":"authenticated"}';
select public.delete_my_account(true);
reset role;
insert into t_results (label, result) select 'Pete deleted', (select count(*) from auth.users where id = '00000000-0000-4000-8000-0000000f1002')::text || ' sign-ins / names '
  || (select string_agg(name, ',' order by name) from public.players where id in ('00000000-0000-4000-8000-0000000f1b02', '00000000-0000-4000-8000-0000000f2b02'))
  || ' / pay ' || coalesce((select pay_details from public.players where id = '00000000-0000-4000-8000-0000000f1b02'), 'gone')
  || ' / scores kept ' || (select count(*) from public.scores where subject_id in ('00000000-0000-4000-8000-0000000f1b02', '00000000-0000-4000-8000-0000000f2b02'))
  || ' / honour board: ' || (select winner_names from public.honour_board where group_id = '00000000-0000-4000-8000-0000000f2a00')
  || ' / feed: ' || (select body from public.posts where group_id = '00000000-0000-4000-8000-0000000f2a00' and kind = 'auto' limit 1);
-- Deleting group A: a player, a phone-only organiser, a wrong name are refused; Olive with the name deletes it.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1004","role":"authenticated"}';
do $$ begin perform public.delete_group('00000000-0000-4000-8000-0000000f1a00', 'Zzqx Delete Me'); insert into t_results (label, result) values ('phone-only organiser deletes', 'ok');
exception when others then insert into t_results (label, result) values ('phone-only organiser deletes', 'refused'); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1005","role":"authenticated"}';
do $$ begin perform public.delete_group('00000000-0000-4000-8000-0000000f1a00', 'Zzqx Delete Me'); insert into t_results (label, result) values ('another group''s organiser deletes', 'ok');
exception when others then insert into t_results (label, result) values ('another group''s organiser deletes', 'refused'); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1001","role":"authenticated"}';
do $$ begin perform public.delete_group('00000000-0000-4000-8000-0000000f1a00', 'Wrong name'); insert into t_results (label, result) values ('delete with the wrong name', 'ok');
exception when others then insert into t_results (label, result) values ('delete with the wrong name', 'refused'); end $$;
select public.delete_group('00000000-0000-4000-8000-0000000f1a00', 'zzqx delete me');
-- Sol deletes his solo group.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1006","role":"authenticated"}';
select public.delete_group('00000000-0000-4000-8000-0000000f3a00', 'Zzqx Solo');
reset role;
insert into t_results (label, result) select 'group A deleted', (select count(*) from public.groups where id = '00000000-0000-4000-8000-0000000f1a00')::text || ' groups / '
  || (select count(*) from public.players where group_id = '00000000-0000-4000-8000-0000000f1a00') || ' players / ' || (select count(*) from public.scores where group_id = '00000000-0000-4000-8000-0000000f1a00') || ' scores';
insert into t_results (label, result) select 'group B untouched', (select count(*) from public.players where group_id = '00000000-0000-4000-8000-0000000f2a00')::text || ' players / '
  || (select count(*) from public.scores where group_id = '00000000-0000-4000-8000-0000000f2a00') || ' scores / ' || (select count(*) from public.rounds where group_id = '00000000-0000-4000-8000-0000000f2a00') || ' rounds';
insert into t_results (label, result) select 'solo group deleted', (select count(*) from public.groups where id = '00000000-0000-4000-8000-0000000f3a00')::text;
-- L.G.C can't be deleted (by its organiser either).
insert into t_results (label, result) select 'L.G.C still there', (select count(*) from public.groups where legacy)::text;
insert into t_results (label, result) select 'daily clean-up scheduled', (select count(*) from cron.job where jobname = 'lgc-daily-cleanup')::text;
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
