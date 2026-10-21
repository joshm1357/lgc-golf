-- Stage 8b part 4 test: listing courses from OpenStreetMap. STAGING only, after 040. Rolled back; results in the error.
update private.platform_flags set is_on = true where key = 'new_groups_open';  -- 047: new groups on for this test (rolled back)
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated, anon, service_role;
grant all on sequence t_results_n_seq to authenticated, anon, service_role;
create temp table t_ids (k text, id uuid, extra text);
grant all on t_ids to authenticated, anon, service_role;

-- A group (organiser e01, signed in properly) with a course a group already shared ("Zzqx Shared GC") and one it hasn't.
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false);
insert into public.groups (id, slug, name, group_pin, legacy, created_by) values
  ('00000000-0000-4000-8000-0000000e0a00', 'zzqx-seed-group', 'Zzqx Seed Group', 'ZZQXSEED01', false, '00000000-0000-4000-8000-0000000e0001');
insert into public.group_members (group_id, user_id, role) values ('00000000-0000-4000-8000-0000000e0a00', '00000000-0000-4000-8000-0000000e0001', 'organiser');
insert into public.course_library (slug, name, area, lat, lng, holes, source_group_id) values
  ('zzqx-shared-golf-club', 'Zzqx Shared Golf Club', null, -33.5, 150.5,
   (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g) order by g) from generate_series(1, 18) g), '00000000-0000-4000-8000-0000000e0a00');
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000e0c01', '00000000-0000-4000-8000-0000000e0a00', 'Zzqx Lakes Golf Club',
  (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g, 'green', jsonb_build_object('lat', -33.9 + g * 0.0005, 'lng', 151.0)) order by g) from generate_series(1, 18) g));

insert into t_ids select 'token', null, token from private.seed_secret limit 1;

-- Not allowed for anyone but the seeding job.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0001","role":"authenticated"}';
do $$ begin perform public.seed_courses('NSW', '[]'); insert into t_results (label, result) values ('a player runs the seeding', 'ok');
exception when others then insert into t_results (label, result) values ('a player runs the seeding', 'refused'); end $$;
do $$ begin perform public.seed_token_ok('x'); insert into t_results (label, result) values ('a player checks a token', 'ok');
exception when others then insert into t_results (label, result) values ('a player checks a token', 'refused'); end $$;

-- The seeding job.
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';
insert into t_results (label, result) select 'token check', public.seed_token_ok('wrong')::text || ' / ' || public.seed_token_ok((select extra from t_ids where k = 'token'))::text;
insert into t_results (label, result) select 'first run', public.seed_courses('NSW', jsonb_build_array(
  jsonb_build_object('ref', 'w900000001', 'name', 'Zzqx Lakes Golf Club', 'lat', -33.896, 'lng', 151.0, 'area', 'Zzqxville NSW'),
  jsonb_build_object('ref', 'w900000002', 'name', 'Zzqx Shared GC', 'lat', -33.501, 'lng', 150.501, 'area', 'Sharedtown NSW'),
  jsonb_build_object('ref', 'r900000003', 'name', 'Zzqx Mapped Golf Course', 'lat', -34.0, 'lng', 151.1, 'area', 'NSW',
    'holes', (select jsonb_agg(jsonb_build_object('n', g, 'par', case when g in (3, 12) then 3 else 4 end, 'si', 19 - g,
              'tee', jsonb_build_object('lat', -34.0, 'lng', 151.1), 'green', jsonb_build_object('lat', -34.001, 'lng', 151.1), 'osm', true) order by g) from generate_series(1, 18) g)),
  jsonb_build_object('ref', 'w900000004', 'name', 'Zzqx Half Mapped Golf Club', 'lat', -34.2, 'lng', 151.2,
    'holes', (select jsonb_agg(jsonb_build_object('n', g, 'par', 4) order by g) from generate_series(1, 9) g)),
  jsonb_build_object('ref', 'w900000005', 'name', 'Zzqx Lakes Golf Club', 'lat', -36.9, 'lng', 149.9, 'area', 'Faraway NSW'),
  jsonb_build_object('ref', 'w900000006', 'name', 'Nowhere Golf Club', 'lat', 51.5, 'lng', -0.1),
  jsonb_build_object('ref', 'bad ref', 'name', 'Zzqx Bad Ref', 'lat', -34, 'lng', 151)))::text;
insert into t_results (label, result) select 'second run changes nothing new', public.seed_courses('NSW', jsonb_build_array(
  jsonb_build_object('ref', 'w900000001', 'name', 'Zzqx Lakes Golf Club', 'lat', -33.896, 'lng', 151.0, 'area', 'Zzqxville NSW')))::text;
reset role;
insert into t_results (label, result) select 'listings', string_agg(slug || ' (' || jsonb_array_length(holes) || ' holes' || case when osm_ref is not null then ', osm' else '' end || ')', ', ' order by slug)
  from public.course_library where slug like 'zzqx-%';
insert into t_results (label, result) select 'the shared course kept its holes and owner', jsonb_array_length(holes) || ' holes / area ' || coalesce(area, '-') || ' / owner kept ' || (source_group_id is not null)
  from public.course_library where slug = 'zzqx-shared-golf-club';

-- A listing with no scorecard can't be copied or played; sharing the group's own course fills it.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0001","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-0000000e0a00"}', true); end $$;
do $$ begin perform public.copy_library_course((select id from public.search_courses('Zzqx Lakes', -33.9, 151.0, 1)));
  insert into t_results (label, result) values ('add a listing with no scorecard', 'ok');
exception when others then insert into t_results (label, result) values ('add a listing with no scorecard', sqlerrm); end $$;
do $$ begin perform public.start_quick_round((select slug from public.search_courses('Zzqx Lakes', -33.9, 151.0, 1)), 'Pat', 18, 'stableford', '{}', '{}', '{}');
  insert into t_results (label, result) values ('quick round on a listing with no scorecard', 'ok');
exception when others then insert into t_results (label, result) values ('quick round on a listing with no scorecard', 'refused'); end $$;
insert into t_results (label, result) select 'mapped course can be added', (public.copy_library_course((select id from public.search_courses('Zzqx Mapped', null, null, 1))) is not null)::text;
insert into t_results (label, result) select 'share our Lakes course', (public.share_course('00000000-0000-4000-8000-0000000e0c01') = (select id from public.search_courses('Zzqx Lakes', -33.9, 151.0, 1)))::text || ' (filled the nearby listing)';
-- A course with no greens mapped, same name as a listing in another state: a new entry, not that listing.
reset role;
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000e0c02', '00000000-0000-4000-8000-0000000e0a00', 'Zzqx Lakes Golf Club',
  (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g) order by g) from generate_series(1, 18) g));
set local role authenticated;
insert into t_results (label, result) select 'unmapped course, listing elsewhere', (public.share_course('00000000-0000-4000-8000-0000000e0c02', 'Other Town NSW')
  <> (select id from public.search_courses('Zzqx Lakes', -36.9, 149.9, 1)))::text || ' (left the far-away listing alone)';
reset role;
insert into t_results (label, result) select 'Lakes listing now', jsonb_array_length(holes) || ' holes / ' || area || ' / owner set ' || (source_group_id is not null) || ' / osm ' || osm
  from public.course_library where osm_ref = 'w900000001';
insert into t_results (label, result) select 'the far-away Lakes listing untouched', jsonb_array_length(holes)::text || ' holes' from public.course_library where osm_ref = 'w900000005';
insert into t_results (label, result) select 'runs recorded', count(*)::text from private.seed_runs where ran_at > now() - interval '1 minute';
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
