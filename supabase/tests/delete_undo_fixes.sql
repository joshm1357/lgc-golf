-- 7-day undo, review fixes (048, 21 Oct 2026). STAGING only, rolled back. Expected: delete_undo_fixes.expected.txt.
-- A deleted group has every feature off (so the connector, reminders, Clubhouse TV and Tribunal refuse it), no
-- "my player", no role changes; a second delete says it's already deleted; only signed-in organisers see the list.
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-0000000fd000', 'test-z', 'Test Group Z', 'Z-CODE-TEST-1', 'z-admin-1234');
insert into auth.users (id, instance_id, aud, role, is_anonymous, email) values
  ('00000000-0000-4000-8000-0000000fda01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'zo@example.com'),
  ('00000000-0000-4000-8000-0000000fda02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, null);
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000fdb01', '00000000-0000-4000-8000-0000000fd000', 'Zed Organiser', 10),
  ('00000000-0000-4000-8000-0000000fdb02', '00000000-0000-4000-8000-0000000fd000', 'Zoe Player', 20);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-0000000fd000', '00000000-0000-4000-8000-0000000fda01', '00000000-0000-4000-8000-0000000fdb01', 'organiser'),
  ('00000000-0000-4000-8000-0000000fd000', '00000000-0000-4000-8000-0000000fda02', '00000000-0000-4000-8000-0000000fdb02', 'player');
insert into t_results (label, result) select 'feature on before (feed)', public.feature_on('00000000-0000-4000-8000-0000000fd000', 'feed')::text;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fda01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-0000000fd000"}', true); end $$;
do $$ begin perform public.delete_group('00000000-0000-4000-8000-0000000fd000', 'Test Group Z'); insert into t_results (label, result) values ('organiser deletes', 'deleted'); end $$;
do $$ begin
  perform public.delete_group('00000000-0000-4000-8000-0000000fd000', 'Test Group Z');
  insert into t_results (label, result) values ('delete twice', 'deleted');
exception when others then insert into t_results (label, result) values ('delete twice', 'refused: ' || left(sqlerrm, 30)); end $$;
insert into t_results (label, result) select 'my player in deleted group', coalesce(private.my_player_id('00000000-0000-4000-8000-0000000fd000')::text, 'none');
reset role;
insert into t_results (label, result) select 'feature on after (feed)', public.feature_on('00000000-0000-4000-8000-0000000fd000', 'feed')::text;
insert into t_results (label, result) select 'feature on after (core)', public.feature_on('00000000-0000-4000-8000-0000000fd000', 'scores')::text;
insert into t_results (label, result) select 'other group still on (L.G.C feed)', public.feature_on((select id from public.groups where legacy limit 1), 'feed')::text;
do $$ begin
  update public.group_members set role = 'organiser' where group_id = '00000000-0000-4000-8000-0000000fd000' and user_id = '00000000-0000-4000-8000-0000000fda02';
  insert into t_results (label, result) values ('role change in deleted group', 'changed');
exception when others then insert into t_results (label, result) values ('role change in deleted group', 'refused: ' || left(sqlerrm, 29)); end $$;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fda02","role":"authenticated"}';
insert into t_results (label, result) select 'phone-only organiser? deleted list (player)', json_array_length(public.my_deleted_groups())::text;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fda01","role":"authenticated"}';
do $$ begin perform public.undo_delete_group('00000000-0000-4000-8000-0000000fd000'); insert into t_results (label, result) values ('organiser brings back', 'back'); end $$;
reset role;
insert into t_results (label, result) select 'feature on after undo (feed)', public.feature_on('00000000-0000-4000-8000-0000000fd000', 'feed')::text;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
