-- 057 test: the connector's learning loop (tool-call log, wishes, Josh's admin functions). STAGING only, after 057.
-- Everything is rolled back: the block ends by raising 'RESULTS: ...'. Compare with 057_connector_learning.expected.txt.
-- Staging test data: L.G.C (organiser ...0001, player ...0002) and Test Group B (user ...d1).
do $t$ declare out text[] := '{}'; v text; n int;
  lgc uuid := 'f9e18914-24a2-43ad-8989-ca91e3d1af19';
  grp_b uuid := 'b0000000-0000-4000-8000-00000000000b';
  org text := '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
  ply text := '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
  oth text := '{"sub":"d1000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
begin
  -- 1. The connector's path (server key = service_role): it can write calls and wishes.
  execute 'set local role service_role';
  insert into public.connector_calls (group_id, tool, ok, ms) values (lgc, 'get_leaderboard', true, 120), (lgc, 'get_leaderboard', true, 80),
    (lgc, 'enter_scores', false, 40), (grp_b, 'lgc_overview', true, 300);
  update public.connector_calls set error = 'not_found' where group_id = lgc and tool = 'enter_scores';
  insert into public.feature_wishes (group_id, job) values (lgc, 'Chase who hasn''t paid'), (lgc, 'chase who has not paid'), (grp_b, 'Book a tee time');
  select count(*) into n from public.connector_calls where group_id in (lgc, grp_b) and created_at > now() - interval '1 minute';
  out := out || ('service path: calls ' || n)::text;
  select count(*) into n from public.feature_wishes where group_id in (lgc, grp_b) and created_at > now() - interval '1 minute';
  out := out || ('service path: wishes ' || n)::text;
  begin insert into public.feature_wishes (group_id, job) values (lgc, ' x '); out := out || 'too-short wish: saved'::text;
  exception when check_violation then out := out || 'too-short wish: refused'::text; end;
  begin insert into public.connector_calls (group_id, tool, ok, error) values (lgc, 't', false, repeat('x', 41)); out := out || 'long error: saved'::text;
  exception when check_violation then out := out || 'long error: refused'::text; end;
  execute 'reset role';

  -- 2. An organiser (not a platform admin): no reading, no writing, no admin functions.
  perform set_config('request.headers', json_build_object('x-group-id', lgc)::text, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', org, true);
  begin select count(*) into n from public.connector_calls; out := out || ('organiser reads calls: ' || n)::text;
  exception when insufficient_privilege then out := out || 'organiser reads calls: refused'::text; end;
  begin select count(*) into n from public.feature_wishes; out := out || ('organiser reads wishes: ' || n)::text;
  exception when insufficient_privilege then out := out || 'organiser reads wishes: refused'::text; end;
  begin insert into public.feature_wishes (group_id, job) values (lgc, 'sneaky wish'); out := out || 'organiser writes a wish: saved'::text;
  exception when insufficient_privilege then out := out || 'organiser writes a wish: refused'::text; end;
  begin insert into public.connector_calls (group_id, tool, ok) values (lgc, 'x', true); out := out || 'organiser writes a call: saved'::text;
  exception when insufficient_privilege then out := out || 'organiser writes a call: refused'::text; end;
  begin v := public.admin_connector_stats(30)::text; out := out || 'organiser stats: shown'::text;
  exception when others then out := out || ('organiser stats: ' || sqlerrm)::text; end;
  begin v := public.admin_wishes(90)::text; out := out || 'organiser wishes: shown'::text;
  exception when others then out := out || ('organiser wishes: ' || sqlerrm)::text; end;
  out := out || ('organiser am_platform_admin: ' || public.am_platform_admin())::text;

  -- 3. Another group's user: the same.
  perform set_config('request.headers', json_build_object('x-group-id', grp_b)::text, true);
  perform set_config('request.jwt.claims', oth, true);
  begin select count(*) into n from public.connector_calls; out := out || ('group B reads calls: ' || n)::text;
  exception when insufficient_privilege then out := out || 'group B reads calls: refused'::text; end;
  begin v := public.admin_wishes(90)::text; out := out || 'group B wishes: shown'::text;
  exception when others then out := out || ('group B wishes: ' || sqlerrm)::text; end;
  execute 'reset role';

  -- 4. Nobody signed in (anon): can't even call the functions.
  execute 'set local role anon';
  begin v := public.admin_connector_stats(30)::text; out := out || 'anon stats: shown'::text;
  exception when insufficient_privilege then out := out || 'anon stats: refused'::text; end;
  begin v := public.am_platform_admin()::text; out := out || 'anon am_platform_admin: answered'::text;
  exception when insufficient_privilege then out := out || 'anon am_platform_admin: refused'::text; end;
  begin select count(*) into n from public.feature_wishes; out := out || 'anon reads wishes: shown'::text;
  exception when insufficient_privilege then out := out || 'anon reads wishes: refused'::text; end;
  execute 'reset role';

  -- 5. A platform admin (the L.G.C player, made Josh for this test only) sees the counts and the wishes.
  insert into public.platform_admins (user_id) values ('10000000-0000-4000-8000-000000000002') on conflict do nothing;
  perform set_config('request.headers', json_build_object('x-group-id', lgc)::text, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', ply, true);
  out := out || ('admin am_platform_admin: ' || public.am_platform_admin())::text;
  select json_build_object('lgc_calls', (select (g ->> 'calls')::int from json_array_elements(s -> 'groups') g where g ->> 'group_id' = lgc::text),
                           'lgc_failed', (select (g ->> 'failed')::int from json_array_elements(s -> 'groups') g where g ->> 'group_id' = lgc::text),
                           'lgc_top_tool', (select g -> 'tools' -> 0 ->> 'tool' from json_array_elements(s -> 'groups') g where g ->> 'group_id' = lgc::text),
                           'has_not_found', (select count(*) > 0 from json_array_elements(s -> 'errors') e where e ->> 'error' = 'not_found'))::text
    into v from (select public.admin_connector_stats(30) s) x;
  out := out || ('admin stats: ' || v)::text;
  select count(*) into n from json_array_elements(public.admin_wishes(90)) w where w ->> 'group_id' in (lgc::text, grp_b::text) and (w ->> 'created_at')::timestamptz > now() - interval '1 minute';
  out := out || ('admin wishes (this test): ' || n)::text;
  begin select count(*) into n from public.feature_wishes; out := out || 'admin reads the table directly: shown'::text;
  exception when insufficient_privilege then out := out || 'admin reads the table directly: refused'::text; end;
  execute 'reset role';

  raise exception 'RESULTS: %', array_to_string(out, ' | ');
end $t$;
