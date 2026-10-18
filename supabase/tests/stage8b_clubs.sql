-- Stage 8b part 1 test: clubs claiming courses. STAGING only, after 037. Rolled back; results in the error message.
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated, anon;
grant all on sequence t_results_n_seq to authenticated, anon;
create temp table t_ids (k text, id uuid);
grant all on t_ids to authenticated, anon;

-- c01 = a club manager (signed in), c02 = phone-only, c03 = Josh (platform admin), c04 = another signed-in person,
-- c05 = organiser of group P that has a copy of the course.
insert into auth.users (id, instance_id, aud, role, email, is_anonymous) values
  ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gm@zzqxclub.example', false),
  ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true),
  ('00000000-0000-4000-8000-0000000c0003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'josh@example', false),
  ('00000000-0000-4000-8000-0000000c0004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@example', false),
  ('00000000-0000-4000-8000-0000000c0005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'org@example', false);
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000c0003');
with x as (insert into public.course_library (slug, name, area, holes) values ('zzqx-club-course', 'Zzqx Club Course', 'Mittagong NSW',
  (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g)) from generate_series(1, 18) g)) returning id)
insert into t_ids select 'course', id from x;
insert into public.groups (id, slug, name, group_pin) values ('00000000-0000-4000-8000-0000000c0100', 'test-p', 'Test Group P', 'P-CODE-TEST-1');
insert into public.group_members (group_id, user_id, role) values ('00000000-0000-4000-8000-0000000c0100', '00000000-0000-4000-8000-0000000c0005', 'organiser');

set local role authenticated;
-- Group P copies the course before the club claims it.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0005","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-0000000c0100"}', true); end $$;
insert into t_ids select 'copy', public.copy_library_course((select id from t_ids where k = 'course'));

-- Claims.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0002","role":"authenticated"}';
do $$ begin perform public.request_club_claim((select id from t_ids where k = 'course'), 'Zzqx Golf Club', 'Pat', 'pat@example.com', null, 'GM', null);
  insert into t_results (label, result) values ('phone-only person claims', 'ok');
exception when others then insert into t_results (label, result) values ('phone-only person claims', 'refused'); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0001","role":"authenticated"}';
insert into t_ids select 'claim', public.request_club_claim((select id from t_ids where k = 'course'), 'Zzqx Golf Club', 'Pat Manager', 'GM@ZzqxClub.example', '02 4800 0000', 'General manager', 'We''d love to be on here');
do $$ begin perform public.request_club_claim((select id from t_ids where k = 'course'), 'Zzqx Golf Club', 'Pat', 'pat@example.com', null, null, null);
  insert into t_results (label, result) values ('the same claim twice', 'ok');
exception when others then insert into t_results (label, result) values ('the same claim twice', 'refused'); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0004","role":"authenticated"}';
insert into t_ids select 'claim2', public.request_club_claim((select id from t_ids where k = 'course'), 'Not The Club', 'Someone', 'x@example.com', null, null, null);
insert into t_results (label, result) select 'someone else sees the claims list', coalesce(json_array_length(public.admin_club_claims())::text, 'nothing');
do $$ begin perform public.decide_club_claim((select id from t_ids where k = 'claim2'), true); insert into t_results (label, result) values ('someone else approves their own claim', 'ok');
exception when others then insert into t_results (label, result) values ('someone else approves their own claim', 'refused'); end $$;
do $$ begin perform public.club_update_profile('Hijack', null, null, null, null, null); insert into t_results (label, result) values ('a non-club person edits a club', 'ok');
exception when others then insert into t_results (label, result) values ('a non-club person edits a club', 'refused'); end $$;

-- Josh approves the real one (by hand).
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0003","role":"authenticated"}';
insert into t_results (label, result) select 'Josh sees the claims', json_array_length(public.admin_club_claims())::text;
select public.decide_club_claim((select id from t_ids where k = 'claim'), true);
reset role;
insert into t_results (label, result) select 'approved: club, its code, course claimed, other claim closed',
  c.name || ' / ' || (c.ref ~ '^[A-Z0-9]{4,12}$') || ' / ' || (l.club_id = c.id) || ' / ' || (select status from public.club_claims where id = (select id from t_ids where k = 'claim2'))
  from public.clubs c join public.course_library l on l.club_id = c.id where l.id = (select id from t_ids where k = 'course');
set local role authenticated;

-- The club edits its page and its course.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0001","role":"authenticated"}';
insert into t_results (label, result) select 'my club', (m -> 'club' ->> 'name') || ' / courses ' || json_array_length(m -> 'club' -> 'courses') from (select public.my_club() m) x;
select public.club_update_profile('Zzqx Golf Club', null, 'bookings@zzqxclub.example', '02 4800 0001', 'Groups of 8+ welcome midweek', 'Stay and play: $99pp');
do $$ begin perform public.club_update_profile('Zzqx Golf Club', 'https://evil.example/logo.png', null, null, null, null); insert into t_results (label, result) values ('logo from somewhere else', 'ok');
exception when others then insert into t_results (label, result) values ('logo from somewhere else', 'refused'); end $$;
select public.club_update_course((select id from t_ids where k = 'course'), (select jsonb_agg(jsonb_build_object('n', g, 'par', case when g in (4, 13) then 3 else 4 end, 'si', 19 - g)) from generate_series(1, 18) g));
insert into t_results (label, result) select 'course page shows the partner club', (p -> 'club' ->> 'booking_email') || ' / verified ' || (p ->> 'verified') || ' / par hole 4 ' || (p -> 'holes' -> 3 ->> 'par')
  from (select public.course_page('zzqx-club-course') p) x;
insert into t_results (label, result) select 'search labels it a partner', partner::text || ' / ' || verified from public.find_courses('zzqx club');
insert into t_results (label, result) select 'club logo folder: own / another', private.photo_path_ok('clubs/' || (public.my_club() -> 'club' ->> 'id') || '/logo.png', false)::text || ' / ' || private.photo_path_ok('clubs/00000000-0000-4000-8000-000000000000/logo.png', false)::text;

-- A group sharing its copy can't change the club's verified course (only fill gaps).
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0005","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-0000000c0100"}', true); end $$;
update public.courses set holes = (select jsonb_agg(jsonb_set(h, '{par}', '5') || jsonb_build_object('green', jsonb_build_object('lat', -34.4, 'lng', 150.4))) from jsonb_array_elements(holes) h)
  where id = (select id from t_ids where k = 'copy');
select public.share_course((select id from t_ids where k = 'copy'));
insert into t_results (label, result) select 'verified course after a group shares', 'par hole 4 ' || (p -> 'holes' -> 3 ->> 'par') || ' / green filled ' || ((p -> 'holes' -> 0 -> 'green') is not null)::text
  from (select public.course_page('zzqx-club-course') p) x;
insert into t_results (label, result) select 'group P''s own copy unchanged by the club', (holes -> 3 ->> 'par') from public.courses where id = (select id from t_ids where k = 'copy');
insert into t_results (label, result) select 'a group organiser sees club claims', coalesce(json_array_length(public.admin_club_claims())::text, 'nothing');
reset role;
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
