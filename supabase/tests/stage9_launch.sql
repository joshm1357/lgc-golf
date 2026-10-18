-- Stage 9 test: stay cards, app problems, Josh's numbers, group export. STAGING only, after 041. Rolled back.
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated, anon;
grant all on sequence t_results_n_seq to authenticated, anon;
create temp table t_ids (k text, id uuid, extra text);
grant all on t_ids to authenticated, anon;

-- Josh (f01, platform admin), an organiser signed in properly (f02), a phone-only organiser (f03), a player (f04).
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000f0001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000f0002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000f0003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000f0004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false);
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000f0001');
insert into public.groups (id, slug, name, group_pin, legacy, created_by) values
  ('00000000-0000-4000-8000-0000000f0a00', 'zzqx-nine', 'Zzqx Nine', 'ZZQXNINE01', false, '00000000-0000-4000-8000-0000000f0002');
insert into public.players (id, group_id, name, handicap, approved) values
  ('00000000-0000-4000-8000-0000000f0b01', '00000000-0000-4000-8000-0000000f0a00', 'Pat Organiser', 12, true),
  ('00000000-0000-4000-8000-0000000f0b04', '00000000-0000-4000-8000-0000000f0a00', 'Sam Player', 20, true);
insert into public.group_members (group_id, user_id, role, player_id) values
  ('00000000-0000-4000-8000-0000000f0a00', '00000000-0000-4000-8000-0000000f0002', 'organiser', '00000000-0000-4000-8000-0000000f0b01'),
  ('00000000-0000-4000-8000-0000000f0a00', '00000000-0000-4000-8000-0000000f0003', 'organiser', null),
  ('00000000-0000-4000-8000-0000000f0a00', '00000000-0000-4000-8000-0000000f0004', 'player', '00000000-0000-4000-8000-0000000f0b04');
insert into public.group_features (group_id, feature_key, enabled, updated_by) values ('00000000-0000-4000-8000-0000000f0a00', 'feed', true, '00000000-0000-4000-8000-0000000f0003')
on conflict (group_id, feature_key) do update set updated_by = excluded.updated_by;
insert into public.location_pings (player_id, group_id, lat, lng, accuracy_m) values ('00000000-0000-4000-8000-0000000f0b04', '00000000-0000-4000-8000-0000000f0a00', -34.5, 150.4, 5);

-- Josh's screens: refused for anyone else.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0002","role":"authenticated"}';
do $$ begin perform public.admin_new_stay('Zzqx Motel'); insert into t_results (label, result) values ('an organiser issues a stay card', 'ok');
exception when others then insert into t_results (label, result) values ('an organiser issues a stay card', 'refused'); end $$;
insert into t_results (label, result) select 'an organiser asks for Josh''s numbers',
  coalesce(public.admin_usage(90)::text, 'nothing') || ' / errors ' || coalesce(public.admin_errors(7)::text, 'nothing') || ' / stays ' || public.admin_stays()::text;

-- Josh issues a stay card; a scan of it is counted against the stay.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0001","role":"authenticated"}';
insert into t_ids select 'stay', (s ->> 'id')::uuid, s ->> 'ref' from (select public.admin_new_stay('Zzqx Motel')::jsonb s) x;
insert into t_results (label, result) select 'stay card ref', ((select extra from t_ids where k = 'stay') ~ '^S[A-Z0-9]{7}$')::text;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select public.count_scan((select extra from t_ids where k = 'stay'), 'stay', null, null, 'phone-stay-0001');
-- The app reports a problem (without a sign-in); the page address loses anything after '?' and any invite code.
select public.report_error('TypeError: x is undefined', 'at Leaderboard (index.js:1:2)', '/lgc-golf/#/c/bowral?ref=ABC&p=cart', 'v2.1', 'Mozilla/5.0');
select public.report_error('TypeError: x is undefined', null, '/lgc-golf/#/join/SECRETCODE12', 'v2.1', 'Mozilla/5.0');
select public.report_error('TypeError: x is undefined', null, '/lgc-golf/#access_token=eyJabc&refresh_token=zzz', 'v2.1', 'Mozilla/5.0');
select public.report_error('', null, null, null, null);
do $$ begin perform 1 from public.client_errors; insert into t_results (label, result) values ('read the problems table', 'ok');
exception when others then insert into t_results (label, result) values ('read the problems table', 'refused'); end $$;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0001","role":"authenticated"}';
insert into t_results (label, result) select 'Josh sees the problem', (e ->> 'message') || ' / ' || (e ->> 'times') || ' times'
  from (select json_array_elements(public.admin_errors(7)) e) x where e ->> 'message' = 'TypeError: x is undefined';
insert into t_results (label, result) select 'Josh''s stays', (s ->> 'name') || ' / scans ' || (s ->> 'scans') from (select json_array_elements(public.admin_stays()) s) x where s ->> 'name' = 'Zzqx Motel';
insert into t_results (label, result) select 'Josh''s numbers', (u -> 'groups' ? 'came_back')::text || ' / funnel has the stay: '
  || exists (select 1 from jsonb_array_elements(u -> 'funnel') f where f ->> 'name' = 'Zzqx Motel' and f ->> 'placement' = 'stay' and (f ->> 'scans')::int = 1)
  from (select public.admin_usage(90)::jsonb u) x;

-- Export: the organiser (signed in) gets the group's data — not sign-ins, invites or locations.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0002","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-0000000f0a00"}', true); end $$;
insert into t_results (label, result) select 'export', (e -> 'group' ->> 'name') || ' / players ' || jsonb_array_length(e -> 'players')
  || ' / members ' || jsonb_array_length(e -> 'members') || ' / user ids in it: ' || (e::text ~ '0000000f0003|0000000f0004')
  || ' / locations in it: ' || (e ? 'location_pings') || ' / invites in it: ' || (e ? 'group_invites') || ' / rooms in it: ' || (e ? 'plan_group_members')
  from (select public.export_group()::jsonb e) x;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0003","role":"authenticated"}';
do $$ begin perform public.export_group(); insert into t_results (label, result) values ('phone-only organiser exports', 'ok');
exception when others then insert into t_results (label, result) values ('phone-only organiser exports', 'refused'); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0004","role":"authenticated"}';
do $$ begin perform public.export_group(); insert into t_results (label, result) values ('a player exports', 'ok');
exception when others then insert into t_results (label, result) values ('a player exports', 'refused'); end $$;
reset role;
insert into t_results (label, result) select 'page addresses kept', string_agg(path, ' , ' order by id) from public.client_errors where message = 'TypeError: x is undefined';
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
