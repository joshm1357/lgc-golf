-- 098 test: side games — who's in, opt-in, anyone proposes; house rules optional. STAGING only, after 098.
-- Rolled back: the results come back as the error message ("RESULTS: ..."), so nothing is left behind.
-- Expected answers in 098_side_games_opt_in.expected.txt.
-- Group S: so — organiser, bo — player (proposes), al — player, sg — guest. Group T: to — organiser of another group.
begin;
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

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
create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-000000098500', 'test-s98', 'Test Group S98', 'S98-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-000000098600', 'test-t98', 'Test Group T98', 'T98-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000098a0001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000098a0002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000098a0003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000098a0004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000098a0009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000098b0001', '00000000-0000-4000-8000-000000098500', 'Sam Organiser', null, 10),
  ('00000000-0000-4000-8000-0000098b0002', '00000000-0000-4000-8000-000000098500', 'Bo Red', 'Bo', 15),
  ('00000000-0000-4000-8000-0000098b0003', '00000000-0000-4000-8000-000000098500', 'Al Blue', null, 18),
  ('00000000-0000-4000-8000-0000098b0004', '00000000-0000-4000-8000-000000098500', 'Gus Guest', null, 20),
  ('00000000-0000-4000-8000-0000098b0009', '00000000-0000-4000-8000-000000098600', 'Tom Other', null, 12);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-000000098500', '00000000-0000-4000-8000-0000098a0001', '00000000-0000-4000-8000-0000098b0001', 'organiser'),
  ('00000000-0000-4000-8000-000000098500', '00000000-0000-4000-8000-0000098a0002', '00000000-0000-4000-8000-0000098b0002', 'player'),
  ('00000000-0000-4000-8000-000000098500', '00000000-0000-4000-8000-0000098a0003', '00000000-0000-4000-8000-0000098b0003', 'player'),
  ('00000000-0000-4000-8000-000000098500', '00000000-0000-4000-8000-0000098a0004', '00000000-0000-4000-8000-0000098b0004', 'guest'),
  ('00000000-0000-4000-8000-000000098600', '00000000-0000-4000-8000-0000098a0009', '00000000-0000-4000-8000-0000098b0009', 'organiser');
insert into public.group_features (group_id, feature_key, enabled) values
  ('00000000-0000-4000-8000-000000098500', 'games', true), ('00000000-0000-4000-8000-000000098500', 'feed', true),
  ('00000000-0000-4000-8000-000000098600', 'games', true)
  on conflict (group_id, feature_key) do update set enabled = true;
-- A trip with a round on Saturday 3 Jan 2099 (not started, no tee times yet).
insert into public.trips (id, group_id, name) values ('00000000-0000-4000-8000-0000098c0001', '00000000-0000-4000-8000-000000098500', 'S trip');
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000098c0002', '00000000-0000-4000-8000-000000098500', 'S course', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, group_id, trip_id, course_id, name, play_date, format, status) values
  ('00000000-0000-4000-8000-0000098e0001', '00000000-0000-4000-8000-000000098500', '00000000-0000-4000-8000-0000098c0001', '00000000-0000-4000-8000-0000098c0002', 'S Saturday', '2099-01-03', 'stableford', 'setup');

-- ================================================================ Bo (a player) puts up $5 skins
select pg_temp.as_user('00000000-0000-4000-8000-0000098a0002');
set local role authenticated;
select pg_temp.try('bo proposes $5 skins (opt-in)', $q$insert into public.round_games (id, round_id, kind, stake, who_in, created_by)
  values ('00000000-0000-4000-8000-0000098f0001', '00000000-0000-4000-8000-0000098e0001', 'skins', 5, 'opt_in', '00000000-0000-4000-8000-0000098b0002') returning who_in$q$);
select pg_temp.try('bo is in automatically', $q$select string_agg(player_id::text, ',') from public.round_game_players where game_id = '00000000-0000-4000-8000-0000098f0001'$q$);
select pg_temp.try('one feed post', $q$select count(*) || ' · ' || min(body) || ' · ' || min(link) from public.posts where round_id = '00000000-0000-4000-8000-0000098e0001'$q$);
select pg_temp.try('bo adds an everyone game', $q$insert into public.round_games (round_id, kind, stake, created_by)
  values ('00000000-0000-4000-8000-0000098e0001', 'nassau', 10, '00000000-0000-4000-8000-0000098b0002') returning kind$q$);
select pg_temp.try('bo proposes as al', $q$insert into public.round_games (round_id, kind, stake, who_in, created_by)
  values ('00000000-0000-4000-8000-0000098e0001', 'nassau', 10, 'opt_in', '00000000-0000-4000-8000-0000098b0003') returning kind$q$);
select pg_temp.try('bo changes his stake', $q$update public.round_games set stake = 50 where id = '00000000-0000-4000-8000-0000098f0001' returning stake::text$q$);
select pg_temp.try('bo puts al in', $q$insert into public.round_game_players (game_id, player_id) values ('00000000-0000-4000-8000-0000098f0001', '00000000-0000-4000-8000-0000098b0003') returning 'in'$q$);
select pg_temp.try('bo proposes a birdie pool', $q$insert into public.round_games (id, round_id, kind, stake, who_in, created_by)
  values ('00000000-0000-4000-8000-0000098f0002', '00000000-0000-4000-8000-0000098e0001', 'birdie_pool', 2, 'opt_in', '00000000-0000-4000-8000-0000098b0002') returning kind$q$);
select pg_temp.try('bo proposes a pot', $q$insert into public.round_games (round_id, kind, stake, who_in, created_by)
  values ('00000000-0000-4000-8000-0000098e0001', 'stableford_pot', 10, 'opt_in', '00000000-0000-4000-8000-0000098b0002') returning kind$q$);
select pg_temp.try('bo proposes a 4th', $q$insert into public.round_games (round_id, kind, stake, who_in, created_by)
  values ('00000000-0000-4000-8000-0000098e0001', 'nassau', 10, 'opt_in', '00000000-0000-4000-8000-0000098b0002') returning kind$q$);
select pg_temp.try('bo takes the birdie pool down', $q$update public.round_games set retired = true where id = '00000000-0000-4000-8000-0000098f0002' returning retired::text$q$);
reset role;

-- ================================================================ Al (another player)
select pg_temp.as_user('00000000-0000-4000-8000-0000098a0003');
set local role authenticated;
select pg_temp.try('al is in', $q$insert into public.round_game_players (game_id, player_id) values ('00000000-0000-4000-8000-0000098f0001', '00000000-0000-4000-8000-0000098b0003') returning 'in'$q$);
select pg_temp.try('al takes bo''s game down (rows)', $q$with u as (update public.round_games set retired = true where id = '00000000-0000-4000-8000-0000098f0001' returning 1) select count(*)::text from u$q$);
select pg_temp.try('al deletes bo''s game (rows)', $q$with d as (delete from public.round_games where id = '00000000-0000-4000-8000-0000098f0001' returning 1) select count(*)::text from d$q$);
select pg_temp.try('al takes bo out (rows)', $q$with d as (delete from public.round_game_players where game_id = '00000000-0000-4000-8000-0000098f0001' and player_id = '00000000-0000-4000-8000-0000098b0002' returning 1) select count(*)::text from d$q$);
select pg_temp.try('al joins the taken-down pool', $q$insert into public.round_game_players (game_id, player_id) values ('00000000-0000-4000-8000-0000098f0002', '00000000-0000-4000-8000-0000098b0003') returning 'in'$q$);
reset role;

-- ================================================================ Gus (a guest)
select pg_temp.as_user('00000000-0000-4000-8000-0000098a0004');
set local role authenticated;
select pg_temp.try('guest reads the games', $q$select count(*)::text from public.round_games where round_id = '00000000-0000-4000-8000-0000098e0001'$q$);
select pg_temp.try('guest proposes', $q$insert into public.round_games (round_id, kind, stake, who_in, created_by)
  values ('00000000-0000-4000-8000-0000098e0001', 'skins', 1, 'opt_in', '00000000-0000-4000-8000-0000098b0004') returning kind$q$);
select pg_temp.try('guest opts in', $q$insert into public.round_game_players (game_id, player_id) values ('00000000-0000-4000-8000-0000098f0001', '00000000-0000-4000-8000-0000098b0004') returning 'in'$q$);
reset role;

-- ================================================================ Tom (another group)
select pg_temp.as_user('00000000-0000-4000-8000-0000098a0009');
set local role authenticated;
select pg_temp.try('other group reads who''s in', $q$select count(*)::text from public.round_game_players$q$);
select pg_temp.try('other group proposes on our round', $q$insert into public.round_games (round_id, kind, stake, who_in, created_by)
  values ('00000000-0000-4000-8000-0000098e0001', 'skins', 1, 'opt_in', '00000000-0000-4000-8000-0000098b0009') returning kind$q$);
select pg_temp.try('other group opts in', $q$insert into public.round_game_players (game_id, player_id) values ('00000000-0000-4000-8000-0000098f0001', '00000000-0000-4000-8000-0000098b0009') returning 'in'$q$);
reset role;

-- ================================================================ Sam (organiser): unchanged, plus the list
select pg_temp.as_user('00000000-0000-4000-8000-0000098a0001');
set local role authenticated;
select pg_temp.try('organiser adds an everyone game', $q$insert into public.round_games (id, round_id, kind, stake, created_by)
  values ('00000000-0000-4000-8000-0000098f0009', '00000000-0000-4000-8000-0000098e0001', 'nassau', 10, '00000000-0000-4000-8000-0000098b0001') returning who_in$q$);
select pg_temp.try('organiser changes its stake', $q$update public.round_games set stake = 20 where id = '00000000-0000-4000-8000-0000098f0009' returning stake::text$q$);
select pg_temp.try('opt in to an everyone game', $q$insert into public.round_game_players (game_id, player_id) values ('00000000-0000-4000-8000-0000098f0009', '00000000-0000-4000-8000-0000098b0001') returning 'in'$q$);
select pg_temp.try('feed posts: one per proposal, none for the everyone game', $q$select count(*)::text from public.posts where round_id = '00000000-0000-4000-8000-0000098e0001'$q$);
reset role;

-- ================================================================ the first tee goes (as the owner: tee time yesterday)
update public.rounds set play_date = current_date - 1 where id = '00000000-0000-4000-8000-0000098e0001';
insert into public.tee_groups (round_id, group_no, tee_time, player_ids) values
  ('00000000-0000-4000-8000-0000098e0001', 1, '07:00', array['00000000-0000-4000-8000-0000098b0002'::uuid]);
insert into t_results (label, result) select 'open after the first tee', public.side_game_open('00000000-0000-4000-8000-0000098e0001')::text;
select pg_temp.as_user('00000000-0000-4000-8000-0000098a0003');
set local role authenticated;
select pg_temp.try('al opts out after the first tee', $q$delete from public.round_game_players where game_id = '00000000-0000-4000-8000-0000098f0001' and player_id = '00000000-0000-4000-8000-0000098b0003' returning 'out'$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000098a0002');
set local role authenticated;
select pg_temp.try('bo takes his game down after the first tee', $q$update public.round_games set retired = true where id = '00000000-0000-4000-8000-0000098f0001' returning 'down'$q$);
select pg_temp.try('bo proposes after the first tee', $q$insert into public.round_games (round_id, kind, stake, who_in, created_by)
  values ('00000000-0000-4000-8000-0000098e0001', 'skins', 2, 'opt_in', '00000000-0000-4000-8000-0000098b0002') returning kind$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000098a0001');
set local role authenticated;
select pg_temp.try('organiser takes al out', $q$delete from public.round_game_players where game_id = '00000000-0000-4000-8000-0000098f0001' and player_id = '00000000-0000-4000-8000-0000098b0003' returning 'out'$q$);
select pg_temp.try('organiser puts gus in (no phone)', $q$insert into public.round_game_players (game_id, player_id) values ('00000000-0000-4000-8000-0000098f0001', '00000000-0000-4000-8000-0000098b0004') returning 'in'$q$);
select pg_temp.try('who''s in now', $q$select string_agg(p.nickname, ',' order by p.name) || ' / ' || count(*) from public.round_game_players g join public.players p on p.id = g.player_id where g.game_id = '00000000-0000-4000-8000-0000098f0001'$q$);
-- ============================================================ the loosened check (part 6)
select pg_temp.try('custom game with no house rules', $q$insert into public.custom_games (name, base_type, settings, rules_text)
  values ('Our skins', 'skins', '{"stake": 5}', '') returning '[' || rules_text || ']'$q$);
select pg_temp.try('custom game with blank house rules', $q$insert into public.custom_games (name, base_type, settings, rules_text)
  values ('Our pot', 'stableford_pot', '{}', '   ') returning '[' || rules_text || ']'$q$);
select pg_temp.try('custom game with 1001 letters', $q$insert into public.custom_games (name, base_type, settings, rules_text)
  values ('Too long', 'skins', '{}', repeat('x', 1001)) returning 'saved'$q$);
reset role;
insert into t_results (label, result) select 'rules_text checks', string_agg(conname, ',' order by conname) from pg_constraint
  where conrelid = 'public.custom_games'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%rules_text%';

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
