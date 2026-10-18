-- Stage 8 test: the shared course library. STAGING only, after 035. Rolled back; results in the error message.
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_ids (k text, id uuid);
grant all on t_ids to authenticated;

-- Group M (organiser f01, player f02) has a course; group N (organiser f11) doesn't.
insert into public.groups (id, slug, name, group_pin) values
  ('00000000-0000-4000-8000-00000000af00', 'test-m', 'Test Group M', 'M-CODE-TEST-1'),
  ('00000000-0000-4000-8000-00000000af10', 'test-n', 'Test Group N', 'N-CODE-TEST-1');
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-00000000af01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000af02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000af11', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.group_members (group_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000af00', '00000000-0000-4000-8000-00000000af01', 'organiser'),
  ('00000000-0000-4000-8000-00000000af00', '00000000-0000-4000-8000-00000000af02', 'player'),
  ('00000000-0000-4000-8000-00000000af10', '00000000-0000-4000-8000-00000000af11', 'organiser');
insert into public.courses (id, group_id, name, holes) values
  ('00000000-0000-4000-8000-00000000af21', '00000000-0000-4000-8000-00000000af00', 'Zzqx Test Links',
   (select jsonb_agg(jsonb_build_object('n', g, 'par', case when g % 6 = 0 then 3 when g % 5 = 0 then 5 else 4 end, 'si', g,
      'green', jsonb_build_object('lat', -34.48 + g * 0.001, 'lng', 150.42), 'osm', g = 1, 'pin_note', 'private')) from generate_series(1, 18) g)),
  ('00000000-0000-4000-8000-00000000af22', '00000000-0000-4000-8000-00000000af00', 'Broken Course',
   (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g)) from generate_series(1, 17) g));

set local role authenticated;
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000af00"}', true); end $$;

-- A player can't share; the organiser can.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000af02","role":"authenticated"}';
do $$ begin perform public.share_course('00000000-0000-4000-8000-00000000af21', 'Bowral NSW'); insert into t_results (label, result) values ('player shares', 'ok');
exception when others then insert into t_results (label, result) values ('player shares', 'refused'); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000af01","role":"authenticated"}';
insert into t_ids select 'lib', public.share_course('00000000-0000-4000-8000-00000000af21', 'Bowral NSW');
do $$ begin perform public.share_course('00000000-0000-4000-8000-00000000af22'); insert into t_results (label, result) values ('share a course with 17 holes', 'ok');
exception when others then insert into t_results (label, result) values ('share a course with 17 holes', 'refused'); end $$;
do $$ begin perform 1 from public.course_library; insert into t_results (label, result) values ('read the library table directly', 'ok');
exception when others then insert into t_results (label, result) values ('read the library table directly', 'refused'); end $$;

-- Group N finds it by name and by distance, copies it, and gets its own copy.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000af11","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000af10"}', true); end $$;
insert into t_results (label, result) select 'search by name', name || ' / ' || area || ' / ' || holes || ' holes / ' || greens || ' greens / osm ' || osm
  from public.search_courses('zzqx');
insert into t_results (label, result) select 'search near me (km)', km::text from public.search_courses('zzqx', -34.47, 150.42);
insert into t_results (label, result) select 'what the library keeps', (h ? 'pin_note')::text || ' / osm on hole 1: ' || coalesce(h ->> 'osm', 'no')
  from (select (public.library_course((select id from t_ids where k = 'lib')) -> 'holes' -> 0)::jsonb h) x;
insert into t_ids select 'copy', public.copy_library_course((select id from t_ids where k = 'lib'));
insert into t_results (label, result) select 'copy is N''s own', (group_id = '00000000-0000-4000-8000-00000000af10')::text || ' / ' || name from public.courses where id = (select id from t_ids where k = 'copy');
insert into t_results (label, result) values ('copy again gives the same course', (public.copy_library_course((select id from t_ids where k = 'lib')) = (select id from t_ids where k = 'copy'))::text);
update public.courses set holes = jsonb_set(holes, '{0,par}', '5') where id = (select id from t_ids where k = 'copy');
insert into t_results (label, result) select 'N changes its copy; library par 1 still', (public.library_course((select id from t_ids where k = 'lib')) -> 'holes' -> 0 ->> 'par');
insert into t_results (label, result) select 'used by', copies::text from public.search_courses('zzqx');
do $$ begin perform public.share_course((select id from t_ids where k = 'copy')); insert into t_results (label, result) values ('N shares its copy again', 'ok');
exception when others then insert into t_results (label, result) values ('N shares its copy again', 'refused'); end $$;
do $$ begin perform public.share_course('00000000-0000-4000-8000-00000000af21'); insert into t_results (label, result) values ('N shares M''s course', 'ok');
exception when others then insert into t_results (label, result) values ('N shares M''s course', 'refused'); end $$;
insert into t_results (label, result) select 'N sees M''s course', count(*)::text from public.courses where id = '00000000-0000-4000-8000-00000000af21';

-- M changes its course and shares again: the same library entry is updated.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000af01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000af00"}', true); end $$;
update public.courses set name = 'Zzqx Test Links (new tees)' where id = '00000000-0000-4000-8000-00000000af21';
insert into t_results (label, result) values ('share again updates, not a new entry', (public.share_course('00000000-0000-4000-8000-00000000af21') = (select id from t_ids where k = 'lib'))::text);
insert into t_results (label, result) select 'library entries for it', count(*)::text || ' / ' || min(name) from public.search_courses('zzqx');

-- Not signed in: nothing.
set local request.jwt.claims to '{"role":"anon"}';
insert into t_results (label, result) select 'not signed in searches', count(*)::text from public.search_courses('zzqx');
reset role;
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
