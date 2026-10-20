-- 7-day undo, the purge (048b). STAGING only, AFTER 048b is applied (Josh approves it). Rolled back.
-- Expected (check by eye the first time, then save as delete_undo_purge.expected.txt):
--   rows left in group Z = 0 | group Z gone = true | L.G.C untouched = true | purge of a group deleted today refused
--   | account deletion after deleting your only group = deleted
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
insert into public.groups (id, slug, name, group_pin, admin_pin, deleted_at) values
  ('00000000-0000-4000-8000-0000000fd000', 'test-z', 'Test Group Z', 'Z-CODE-TEST-1', 'z-admin-1234', now() - interval '8 days'),
  ('00000000-0000-4000-8000-0000000fd100', 'test-y', 'Test Group Y', 'Y-CODE-TEST-1', 'y-admin-1234', now());
insert into auth.users (id, instance_id, aud, role, is_anonymous, email) values
  ('00000000-0000-4000-8000-0000000fda01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'zo@example.com'),
  ('00000000-0000-4000-8000-0000000fda09', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'yo@example.com');
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000fdb01', '00000000-0000-4000-8000-0000000fd000', 'Zed Organiser', 10),
  ('00000000-0000-4000-8000-0000000fdb09', '00000000-0000-4000-8000-0000000fd100', 'Yan Organiser', 10);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-0000000fd000', '00000000-0000-4000-8000-0000000fda01', '00000000-0000-4000-8000-0000000fdb01', 'organiser');
-- (Y's member row can't be added once Y is deleted; Y is used for the "too soon" purge and Yan's account below.)
insert into t_results (label, result) select 'L.G.C players before', count(*)::text from public.players where group_id = (select id from public.groups where legacy limit 1);
select private.daily_cleanup();
insert into t_results (label, result) select 'rows left in group Z', count(*)::text from public.players where group_id = '00000000-0000-4000-8000-0000000fd000';
insert into t_results (label, result) select 'group Z gone', (not exists (select 1 from public.groups where id = '00000000-0000-4000-8000-0000000fd000'))::text;
insert into t_results (label, result) select 'group Y (deleted today) still there', exists (select 1 from public.groups where id = '00000000-0000-4000-8000-0000000fd100')::text;
insert into t_results (label, result) select 'L.G.C players after', count(*)::text from public.players where group_id = (select id from public.groups where legacy limit 1);
do $$ begin
  perform private.purge_group('00000000-0000-4000-8000-0000000fd100');
  insert into t_results (label, result) values ('purge a group deleted today', 'purged');
exception when others then insert into t_results (label, result) values ('purge a group deleted today', 'refused: ' || left(sqlerrm, 30)); end $$;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fda09","role":"authenticated"}';
do $$ begin
  perform public.delete_my_account(false);
  insert into t_results (label, result) values ('account deletion, no live groups', 'deleted');
exception when others then insert into t_results (label, result) values ('account deletion, no live groups', 'refused: ' || left(sqlerrm, 30)); end $$;
reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
