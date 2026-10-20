-- Stage 8b parts 2–3 test: scans, the club's counts, and the clubhouse TV. STAGING only, after 038 and 039.
-- Rolled back; results in the error message.
update private.platform_flags set is_on = true where key = 'new_groups_open';  -- 047: new groups on for this test (rolled back)
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated, anon;
grant all on sequence t_results_n_seq to authenticated, anon;
create temp table t_ids (k text, id uuid, extra text);
grant all on t_ids to authenticated, anon;

-- A club (manager d01) with a course; a quick round started from its cart code (organiser d02, player d03).
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000d0001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000d0002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000d0003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);
with c as (insert into public.clubs (name, ref) values ('Zzqx TV Club', 'ZZQXTV1') returning id)
insert into t_ids select 'club', id, null from c;
insert into public.club_members (club_id, user_id) values ((select id from t_ids where k = 'club'), '00000000-0000-4000-8000-0000000d0001');
insert into t_ids select 'key', null, tv_key from public.clubs where ref = 'ZZQXTV1';
insert into public.course_library (slug, name, holes, club_id) values ('zzqx-tv-course', 'Zzqx TV Course',
  (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g)) from generate_series(1, 18) g), (select id from t_ids where k = 'club'));
insert into t_ids select 'course', id, null from public.course_library where slug = 'zzqx-tv-course';

-- Scans (nobody signed in).
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select public.log_scan('zzqxtv1', 'cart', 'zzqx-tv-course', null);
select public.count_scan('ZZQXTV1', 'cart', 'zzqx-tv-course', null, 'phone-aaaa-1111');
select public.count_scan('ZZQXTV1', 'cart', 'zzqx-tv-course', null, 'phone-aaaa-1111');
select public.count_scan('ZZQXTV1', 'cart', 'zzqx-tv-course', null, 'phone-bbbb-2222');
select public.count_scan('ZZQXTV1', 'par3', 'zzqx-tv-course', 4, 'phone-aaaa-1111');
select public.log_scan('NOSUCH', 'cart', null, null);
select public.log_scan('ZZQXTV1', 'bogus', null, null);
do $$ begin perform 1 from public.scan_log; insert into t_results (label, result) values ('read the scan log', 'ok');
exception when others then insert into t_results (label, result) values ('read the scan log', 'refused'); end $$;

-- The quick round from the cart code.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0002","role":"authenticated"}';
insert into t_ids select k, (r ->> 'group_id')::uuid, r ->> f from (select public.start_quick_round('zzqx-tv-course', 'Josh Smith', 18, 'stableford', '{}', '{}', '{"ref":"ZZQXTV1","placement":"cart"}') r) x,
  (values ('q', 'round_id'), ('inv', 'invite')) v(k, f);
do $$ begin perform set_config('request.headers', json_build_object('x-group-id', (select id from t_ids where k = 'q'))::text, true); end $$;
do $$ begin perform public.set_round_tv((select extra::uuid from t_ids where k = 'q'), true); insert into t_results (label, result) values ('TV with the switch off', 'ok');
exception when others then insert into t_results (label, result) values ('TV with the switch off', 'refused'); end $$;
reset role;
insert into public.group_features (group_id, feature_key, enabled) values ((select id from t_ids where k = 'q'), 'clubhouse_tv', true)
on conflict (group_id, feature_key) do update set enabled = true;
insert into public.scores (round_id, subject_id, subject_type, hole, strokes, picked_up)
select (select extra::uuid from t_ids where k = 'q'), p.id, 'player', 1, 4, false from public.players p where p.group_id = (select id from t_ids where k = 'q');
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
insert into t_results (label, result) select 'TV before opting in', json_array_length(public.tv_board('zzqx-tv-course', (select extra from t_ids where k = 'key')) -> 'rounds')::text;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0003","role":"authenticated"}';
select public.join_by_invite((select extra from t_ids where k = 'inv'));
do $$ begin perform public.set_round_tv((select extra::uuid from t_ids where k = 'q'), true); insert into t_results (label, result) values ('a guest puts it on TV', 'ok');
exception when others then insert into t_results (label, result) values ('a guest puts it on TV', 'refused'); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0002","role":"authenticated"}';
select public.set_round_tv((select extra::uuid from t_ids where k = 'q'), true);
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
insert into t_results (label, result) select 'TV shows (first names only)', (b -> 'rounds' -> 0 -> 'players' -> 0 ->> 'name') || ' / scores ' || jsonb_array_length(b -> 'rounds' -> 0 -> 'scores')
  || ' / round name sent: ' || ((b -> 'rounds' -> 0) ? 'name') || ' / surname anywhere: ' || (b::text ~* 'smith')
  || ' / ids: ' || (b -> 'rounds' -> 0 ->> 'id') || ' ' || (b -> 'rounds' -> 0 -> 'players' -> 0 ->> 'id') || ' ' || (b -> 'rounds' -> 0 -> 'scores' -> 0 ->> 'subject_id')
  from (select public.tv_board('zzqx-tv-course', (select extra from t_ids where k = 'key'))::jsonb b) x;
insert into t_results (label, result) select 'TV with a wrong key', coalesce(public.tv_board('zzqx-tv-course', 'guess')::text, 'nothing');
insert into t_results (label, result) select 'old TV link (no key)', public.tv_board('zzqx-tv-course')::text;
insert into t_results (label, result) select 'TV for a course nobody is playing', coalesce(public.tv_board('zzqx-no-such', (select extra from t_ids where k = 'key'))::text, 'nothing');

-- The club's counts (counts only).
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0001","role":"authenticated"}';
insert into t_results (label, result) select 'club counts', (s -> 'scans')::text || ' / rounds ' || (s ->> 'rounds_started') || ' / groups ' || (s ->> 'groups_created')
  || ' / came back ' || (s ->> 'groups_came_back') from (select public.club_stats(30)::jsonb s) x;
insert into t_results (label, result) select 'a 1-day period asked for', (public.club_stats(1) ->> 'days');
insert into t_results (label, result) select 'club counts carry no names', (public.club_stats(30)::text ~* 'josh|smith')::text;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0002","role":"authenticated"}';
insert into t_results (label, result) select 'someone else asks for club counts', coalesce(public.club_stats(30)::text, 'nothing');
-- Uploads: a club into its own folder; nobody else into clubs/.
insert into t_results (label, result) select 'a group organiser uploads to clubs/-/', private.photo_path_ok('clubs/-/x.jpg', false)::text;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0001","role":"authenticated"}';
reset role;
insert into t_results (label, result) select 'the club''s own folder', (select count(*) from pg_policies where policyname = 'clubs upload their own logo')::text
  || ' rule / path ok ' || private.photo_path_ok('clubs/' || (select id from t_ids where k = 'club') || '/logo.png', false);
insert into t_results (label, result) select 'photos bucket limits', (file_size_limit / 1024 / 1024)::text || ' MB / ' || array_length(allowed_mime_types, 1) || ' picture types' from storage.buckets where id = 'photos';
-- Saving checked hole data keeps the greens' front and back.
update public.course_library set holes = (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g, 'green', jsonb_build_object('lat', -34.5, 'lng', 150.4),
  'front', jsonb_build_object('lat', -34.50001, 'lng', 150.4)) order by g) from generate_series(1, 18) g) where slug = 'zzqx-tv-course';
set local role authenticated;
select public.club_update_course((select id from t_ids where k = 'course'),
  (select jsonb_agg(jsonb_build_object('n', g, 'par', case when g = 3 then 3 else 4 end, 'si', 19 - g) order by g) from generate_series(1, 18) g));
reset role;
insert into t_results (label, result) select 'club saves pars, keeps the greens', (holes -> 2 ->> 'par') || ' / si ' || (holes -> 0 ->> 'si') || ' / front kept ' || (holes -> 0 ? 'front') || ' / verified ' || verified
  from public.course_library where slug = 'zzqx-tv-course';
-- A group can't move a checked course.
update public.course_library set lat = 10, area = 'Somewhere else' where slug = 'zzqx-tv-course';
insert into t_results (label, result) select 'checked course can''t be moved', (lat <> 10)::text || ' / ' || coalesce(area, 'no area') from public.course_library where slug = 'zzqx-tv-course';
-- The club is removed: the course goes back to unclaimed and unchecked.
update public.course_library set club_id = null where slug = 'zzqx-tv-course';
insert into t_results (label, result) select 'club removed', (club_id is null)::text || ' / verified ' || verified from public.course_library where slug = 'zzqx-tv-course';
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
