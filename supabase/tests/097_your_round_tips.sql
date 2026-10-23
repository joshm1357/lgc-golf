-- 097 checks: Cup match tee times, and tipping on the Cup, a match and a round. Run on STAGING only, AFTER
-- 097_your_round_tips.sql. Everything is rolled back at the end on purpose: the results come back as the error message
-- ("RESULTS: ..."), so nothing is left behind.
-- People: the staging L.G.C test organiser (Josh, ...001), a player (Mike, ...002) and a player in Test Group B.
-- Expected: see 097_your_round_tips.expected.txt.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

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

-- Setup (as the database owner): the Cup on for L.G.C, a trip with an Ambrose round and a Stableford round, two teams,
-- the two Cup sides (the group's own, if it already has them) and one match.
insert into public.group_features (group_id, feature_key, enabled) values ('f9e18914-24a2-43ad-8989-ca91e3d1af19', 'cup', true)
  on conflict (group_id, feature_key) do update set enabled = true;
insert into public.trips (id, group_id, name, start_date, end_date) values
  ('09700000-0000-4000-8000-000000000001', 'f9e18914-24a2-43ad-8989-ca91e3d1af19', 'Tips test', current_date + 5, current_date + 6);
-- rounds.course_id is required (001), so the test brings its own course.
insert into public.courses (id, group_id, name, holes) values
  ('09700000-0000-4000-8000-0000000000c9', 'f9e18914-24a2-43ad-8989-ca91e3d1af19', 'Tips test course', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status, play_date) values
  ('09700000-0000-4000-8000-0000000000a1', 'f9e18914-24a2-43ad-8989-ca91e3d1af19', '09700000-0000-4000-8000-000000000001', '09700000-0000-4000-8000-0000000000c9', 'Ambrose day', 'ambrose', 'setup', current_date + 5),
  ('09700000-0000-4000-8000-0000000000a2', 'f9e18914-24a2-43ad-8989-ca91e3d1af19', '09700000-0000-4000-8000-000000000001', '09700000-0000-4000-8000-0000000000c9', 'Stableford day', 'stableford', 'setup', current_date + 6);
insert into public.teams (id, group_id, round_id, name) values
  ('09700000-0000-4000-8000-0000000000b1', 'f9e18914-24a2-43ad-8989-ca91e3d1af19', '09700000-0000-4000-8000-0000000000a1', 'Team 1'),
  ('09700000-0000-4000-8000-0000000000b2', 'f9e18914-24a2-43ad-8989-ca91e3d1af19', '09700000-0000-4000-8000-0000000000a1', 'Team 2');
insert into public.round_players (group_id, round_id, player_id, playing_handicap) values
  ('f9e18914-24a2-43ad-8989-ca91e3d1af19', '09700000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-000000000001', 14);
insert into public.cup_sides (group_id, name, colour, sort) values
  ('f9e18914-24a2-43ad-8989-ca91e3d1af19', 'Team Blue', '#1F4B9E', 1), ('f9e18914-24a2-43ad-8989-ca91e3d1af19', 'Team Red', '#B3261E', 2)
  on conflict (group_id, sort) do nothing;
insert into public.cup_matches (id, group_id, round_id, format, a_players, b_players, points) values
  ('09700000-0000-4000-8000-0000000000c1', 'f9e18914-24a2-43ad-8989-ca91e3d1af19', '09700000-0000-4000-8000-0000000000a2', 'singles',
   array['20000000-0000-4000-8000-000000000001']::uuid[], array['20000000-0000-4000-8000-000000000002']::uuid[], 1);

-- ---------------------------------------------------------------- Josh (organiser): tee time on the match
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('josh sets the match tee time', $q$update public.cup_matches set tee_time = '07:52', start_hole = 1 where id = '09700000-0000-4000-8000-0000000000c1' returning tee_time || ' hole ' || start_hole$q$);
select pg_temp.try('josh sets a bad tee time', $q$update public.cup_matches set tee_time = '7.52pm' where id = '09700000-0000-4000-8000-0000000000c1' returning tee_time$q$);
reset role;

-- ---------------------------------------------------------------- Mike (a player): his own tips
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('mike tips the cup (red)', $q$insert into public.tips (trip_id, player_id, target, target_id, pick)
  values ('09700000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'cup', '09700000-0000-4000-8000-000000000001',
          (select id::text from public.cup_sides where group_id = 'f9e18914-24a2-43ad-8989-ca91e3d1af19' and sort = 2)) returning 'tipped'$q$);
select pg_temp.try('mike tips the cup as josh', $q$insert into public.tips (trip_id, player_id, target, target_id, pick)
  values ('09700000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'cup', '09700000-0000-4000-8000-000000000001',
          (select id::text from public.cup_sides where group_id = 'f9e18914-24a2-43ad-8989-ca91e3d1af19' and sort = 1)) returning 'tipped'$q$);
select pg_temp.try('mike tips a made-up side', $q$insert into public.tips (trip_id, player_id, target, target_id, pick)
  values ('09700000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'match', '09700000-0000-4000-8000-0000000000c1', 'x') returning 'tipped'$q$);
select pg_temp.try('mike tips the match (b)', $q$insert into public.tips (trip_id, player_id, target, target_id, pick)
  values ('09700000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'match', '09700000-0000-4000-8000-0000000000c1', 'b') returning 'tipped'$q$);
select pg_temp.try('mike tips team 2 in the ambrose', $q$insert into public.tips (trip_id, player_id, target, target_id, pick)
  values ('09700000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'round', '09700000-0000-4000-8000-0000000000a1', '09700000-0000-4000-8000-0000000000b2') returning 'tipped'$q$);
select pg_temp.try('mike tips josh for stableford', $q$insert into public.tips (trip_id, player_id, target, target_id, pick)
  values ('09700000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'round', '09700000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-000000000001') returning 'tipped'$q$);
select pg_temp.try('mike tips a non-player', $q$update public.tips set pick = 'b0000000-0000-4000-8000-0000000000b1' where target_id = '09700000-0000-4000-8000-0000000000a2' returning 'changed'$q$);
select pg_temp.try('mike moves a tip to another thing', $q$update public.tips set target_id = '09700000-0000-4000-8000-0000000000a1' where target_id = '09700000-0000-4000-8000-0000000000a2' returning 'moved'$q$);
select pg_temp.try('mike changes his match pick', $q$update public.tips set pick = 'h' where target = 'match' returning pick$q$);
select pg_temp.try('mike reads tips', $q$select count(*)::text from public.tips where trip_id = '09700000-0000-4000-8000-000000000001'$q$);
reset role;

-- The match starts (as the owner: hole 1 to Josh) and the Ambrose round goes live → those tips lock.
update public.cup_matches set holes = '{"1":"a"}'::jsonb where id = '09700000-0000-4000-8000-0000000000c1';
update public.rounds set status = 'live' where id = '09700000-0000-4000-8000-0000000000a1';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('mike changes the match pick after it started', $q$update public.tips set pick = 'a' where target = 'match' returning pick$q$);
select pg_temp.try('mike changes the cup pick after the first match', $q$update public.tips set pick = (select id::text from public.cup_sides where group_id = 'f9e18914-24a2-43ad-8989-ca91e3d1af19' and sort = 1) where target = 'cup' returning 'changed'$q$);
select pg_temp.try('mike deletes his ambrose tip after the start', $q$delete from public.tips where target = 'round' and target_id = '09700000-0000-4000-8000-0000000000a1' returning 'gone'$q$);
select pg_temp.try('mike changes stableford tip (not started)', $q$update public.tips set pick = '20000000-0000-4000-8000-000000000001' where target_id = '09700000-0000-4000-8000-0000000000a2' returning 'changed'$q$);
reset role;

-- ---------------------------------------------------------------- Mike as a guest
update public.group_members set role = 'guest' where user_id = '10000000-0000-4000-8000-000000000002' and group_id = 'f9e18914-24a2-43ad-8989-ca91e3d1af19';
delete from public.tips where player_id = '20000000-0000-4000-8000-000000000002' and target = 'round' and target_id = '09700000-0000-4000-8000-0000000000a2';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('guest reads tips', $q$select count(*)::text from public.tips where trip_id = '09700000-0000-4000-8000-000000000001'$q$);
select pg_temp.try('guest tips', $q$insert into public.tips (trip_id, player_id, target, target_id, pick)
  values ('09700000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'round', '09700000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-000000000001') returning 'tipped'$q$);
reset role;
update public.group_members set role = 'player' where user_id = '10000000-0000-4000-8000-000000000002' and group_id = 'f9e18914-24a2-43ad-8989-ca91e3d1af19';

-- ---------------------------------------------------------------- Switched off
update public.group_features set enabled = false where group_id = 'f9e18914-24a2-43ad-8989-ca91e3d1af19' and feature_key = 'tipping';
insert into public.group_features (group_id, feature_key, enabled) values ('f9e18914-24a2-43ad-8989-ca91e3d1af19', 'tipping', false)
  on conflict (group_id, feature_key) do update set enabled = false;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('tipping switched off', $q$insert into public.tips (trip_id, player_id, target, target_id, pick)
  values ('09700000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'round', '09700000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-000000000001') returning 'tipped'$q$);
select pg_temp.try('switched off: still reads', $q$select count(*)::text from public.tips where trip_id = '09700000-0000-4000-8000-000000000001'$q$);
reset role;

-- ---------------------------------------------------------------- Someone in another group
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('other group reads tips', $q$select count(*)::text from public.tips$q$);
select pg_temp.try('other group tips on our trip', $q$insert into public.tips (trip_id, player_id, target, target_id, pick)
  values ('09700000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-0000000000b1', 'cup', '09700000-0000-4000-8000-000000000001', 'x') returning 'tipped'$q$);
select pg_temp.try('other group sees our match tee time', $q$select count(*)::text from public.cup_matches where id = '09700000-0000-4000-8000-0000000000c1'$q$);
reset role;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
