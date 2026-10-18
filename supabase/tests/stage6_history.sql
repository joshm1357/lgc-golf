-- Stage 6 test: history import. STAGING only, after 033 and 033c. Rolled back; results in the error message.
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

-- Group K (organiser c01, player c02) and group L (organiser c03).
insert into public.groups (id, slug, name, group_pin) values
  ('00000000-0000-4000-8000-00000000ac00', 'test-k', 'Test Group K', 'K-CODE-TEST-1'),
  ('00000000-0000-4000-8000-00000000ad00', 'test-l', 'Test Group L', 'L-CODE-TEST-1');
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-00000000ac01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000ac02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000ad01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.group_members (group_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000ac00', '00000000-0000-4000-8000-00000000ac01', 'organiser'),
  ('00000000-0000-4000-8000-00000000ac00', '00000000-0000-4000-8000-00000000ac02', 'player'),
  ('00000000-0000-4000-8000-00000000ad00', '00000000-0000-4000-8000-00000000ad01', 'organiser');
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-00000000ac11', '00000000-0000-4000-8000-00000000ac00', 'Kev', 12),
  ('00000000-0000-4000-8000-00000000ad11', '00000000-0000-4000-8000-00000000ad00', 'Lou', 20);
insert into public.trips (id, group_id, name, start_date) values
  ('00000000-0000-4000-8000-00000000ac21', '00000000-0000-4000-8000-00000000ac00', 'K trip 2023', '2023-05-01'),
  ('00000000-0000-4000-8000-00000000ad21', '00000000-0000-4000-8000-00000000ad00', 'L trip 2023', '2023-05-01');
insert into public.group_features (group_id, feature_key, enabled) values ('00000000-0000-4000-8000-00000000ac00', 'trophies', true);

set local role authenticated;
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000ac00"}', true); end $$;

-- A player can't add history.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000ac02","role":"authenticated"}';
do $$ begin perform public.import_honours('[{"trophy":"Cup","label":"2019","winners":"Kev"}]');
  insert into t_results (label, result) values ('player adds winners', 'ok');
exception when others then insert into t_results (label, result) values ('player adds winners', 'refused'); end $$;
do $$ begin perform public.import_handicaps('[{"player_id":"00000000-0000-4000-8000-00000000ac11","date":"2020-01-01","handicap":10}]');
  insert into t_results (label, result) values ('player adds handicaps', 'ok');
exception when others then insert into t_results (label, result) values ('player adds handicaps', 'refused'); end $$;

-- The organiser adds three past winners; another group's player and trip are dropped.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000ac01","role":"authenticated"}';
insert into t_results (label, result) values ('organiser adds 3 winners', public.import_honours('[
  {"trophy":"Cup","label":"2019","winners":"Kev & Lou","player_ids":["00000000-0000-4000-8000-00000000ac11","00000000-0000-4000-8000-00000000ad11"]},
  {"trophy":"Cup","label":"2023","winners":"Kev","trip_id":"00000000-0000-4000-8000-00000000ac21"},
  {"trophy":"Spoon","label":"2023","winners":"Kev","trip_id":"00000000-0000-4000-8000-00000000ad21"}]')::text);
insert into t_results (label, result) select 'saved as history, only own players and trips',
  string_agg(label || ' ' || trophy_name || ' imported=' || imported || ' players=' || coalesce(array_length(player_ids, 1), 0) || ' trip=' || (trip_id is not null), '; ' order by label, trophy_name)
  from public.honour_board where group_id = '00000000-0000-4000-8000-00000000ac00';
insert into t_results (label, result) values ('the same list again adds', public.import_honours('[{"trophy":"cup","label":"2019","winners":"kev & lou"}]')::text);
do $$ begin perform public.import_honours('[{"trophy":"Cup","label":"Hunter","winners":"Kev"}]');
  insert into t_results (label, result) values ('a winner with no year', 'ok');
exception when others then insert into t_results (label, result) values ('a winner with no year', 'refused'); end $$;
do $$ begin perform public.import_honours('[{"trophy":"Cup","label":"2018","winners":"Kev"},{"trophy":"Cup","label":"2017","winners":""}]');
  insert into t_results (label, result) values ('a list with a bad line', 'ok');
exception when others then insert into t_results (label, result) values ('a list with a bad line', 'refused'); end $$;
insert into t_results (label, result) select 'nothing from the bad list saved', count(*)::text from public.honour_board where group_id = '00000000-0000-4000-8000-00000000ac00' and label = '2018';
do $$ begin perform public.import_honours((select jsonb_agg(jsonb_build_object('trophy', 'Cup', 'label', g::text, 'winners', 'Kev')) from generate_series(1, 201) g));
  insert into t_results (label, result) values ('201 lines at once', 'ok');
exception when others then insert into t_results (label, result) values ('201 lines at once', 'refused'); end $$;
do $$ begin insert into public.honour_board (trophy_name, label, winner_names, trip_id) values ('Cup', '2022', 'Kev', '00000000-0000-4000-8000-00000000ad21');
  insert into t_results (label, result) values ('honour linked to another group''s trip', 'ok');
exception when others then insert into t_results (label, result) values ('honour linked to another group''s trip', 'refused'); end $$;

do $$ begin insert into public.honour_board (trophy_name, label, winner_names, trip_id, sort_key) values ('Cup', '2024', 'Kev', '00000000-0000-4000-8000-00000000ac21', 10);
  insert into t_results (label, result) values ('engraving linked to own trip', 'ok');
exception when others then insert into t_results (label, result) values ('engraving linked to own trip', 'refused'); end $$;

-- Past handicaps: history only, today's handicap unchanged.
insert into t_results (label, result) values ('organiser adds 2 handicaps', public.import_handicaps('[
  {"player_id":"00000000-0000-4000-8000-00000000ac11","date":"2021-06-01","handicap":15.2},
  {"player_id":"00000000-0000-4000-8000-00000000ac11","date":"2022-06-01","handicap":-1}]')::text);
insert into t_results (label, result) values ('the same handicap again adds', public.import_handicaps('[{"player_id":"00000000-0000-4000-8000-00000000ac11","date":"2021-06-01","handicap":15.2}]')::text);
insert into t_results (label, result) select 'handicap history', string_agg(new_handicap || ' on ' || (created_at at time zone 'UTC')::date || ' imported=' || imported, '; ' order by created_at)
  from public.handicap_history where player_id = '00000000-0000-4000-8000-00000000ac11';
insert into t_results (label, result) select 'today''s handicap unchanged', handicap::text from public.players where id = '00000000-0000-4000-8000-00000000ac11';
do $$ declare j text; begin
  foreach j in array array[
    '[{"player_id":"00000000-0000-4000-8000-00000000ad11","date":"2021-06-01","handicap":10}]',
    '[{"player_id":"00000000-0000-4000-8000-00000000ac11","date":"2099-06-01","handicap":10}]',
    '[{"player_id":"00000000-0000-4000-8000-00000000ac11","date":"2021-06-01","handicap":70}]',
    '[{"player_id":"00000000-0000-4000-8000-00000000ac11","date":"2021-06-01"}]'] loop
    begin perform public.import_handicaps(j::jsonb); insert into t_results (label, result) values ('bad handicap line', 'ok');
    exception when others then insert into t_results (label, result) values ('bad handicap line', 'refused'); end;
  end loop;
end $$;

-- Group L sees none of K's history.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000ad01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000ad00"}', true); end $$;
insert into t_results (label, result) select 'L sees K''s winners / handicaps',
  (select count(*) from public.honour_board where group_id = '00000000-0000-4000-8000-00000000ac00')::text || ' / ' ||
  (select count(*) from public.handicap_history where player_id = '00000000-0000-4000-8000-00000000ac11')::text;

-- Trophies switched off: no adding winners.
reset role;
update public.group_features set enabled = false where group_id = '00000000-0000-4000-8000-00000000ac00' and feature_key = 'trophies';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000ac01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000ac00"}', true); end $$;
do $$ begin perform public.import_honours('[{"trophy":"Cup","label":"2016","winners":"Kev"}]');
  insert into t_results (label, result) values ('winners with trophies off', 'ok');
exception when others then insert into t_results (label, result) values ('winners with trophies off', 'refused'); end $$;

reset role;
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
