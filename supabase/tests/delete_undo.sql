-- 7-day undo checks (048, 21 Oct 2026). STAGING only. Rolled back; results come back as the error message.
-- Group Z: zo — organiser (signed in); zp — player. Expected answers: delete_undo.expected.txt.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-0000000fd000', 'test-z', 'Test Group Z', 'Z-CODE-TEST-1', 'z-admin-1234');
insert into auth.users (id, instance_id, aud, role, is_anonymous, email) values
  ('00000000-0000-4000-8000-0000000fda01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'zo@example.com'),
  ('00000000-0000-4000-8000-0000000fda02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, null),
  ('00000000-0000-4000-8000-0000000fda03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, null);
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000fdb01', '00000000-0000-4000-8000-0000000fd000', 'Zed Organiser', 10),
  ('00000000-0000-4000-8000-0000000fdb02', '00000000-0000-4000-8000-0000000fd000', 'Zoe Player', 20);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-0000000fd000', '00000000-0000-4000-8000-0000000fda01', '00000000-0000-4000-8000-0000000fdb01', 'organiser'),
  ('00000000-0000-4000-8000-0000000fd000', '00000000-0000-4000-8000-0000000fda02', '00000000-0000-4000-8000-0000000fdb02', 'player');

set local role authenticated;

-- Before: the player sees the group.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fda02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-0000000fd000"}', true); end $$;
insert into t_results (label, result) select 'player before: in group', (public.my_status()->>'is_member');
insert into t_results (label, result) select 'player before: sees players', count(*)::text from public.players where group_id = '00000000-0000-4000-8000-0000000fd000';
do $$ begin
  perform public.delete_group('00000000-0000-4000-8000-0000000fd000', 'Test Group Z');
  insert into t_results (label, result) values ('player deletes', 'deleted');
exception when others then insert into t_results (label, result) values ('player deletes', 'refused: ' || left(sqlerrm, 24)); end $$;

-- The organiser deletes it.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fda01","role":"authenticated"}';
do $$ begin
  perform public.delete_group('00000000-0000-4000-8000-0000000fd000', 'test group z');
  insert into t_results (label, result) values ('organiser deletes', 'deleted');
exception when others then insert into t_results (label, result) values ('organiser deletes', 'refused: ' || left(sqlerrm, 30)); end $$;
insert into t_results (label, result) select 'organiser after: in group', (public.my_status()->>'is_member');
insert into t_results (label, result) select 'organiser after: groups listed', json_array_length(public.my_status()->'groups')::text;
insert into t_results (label, result) select 'organiser after: sees players', count(*)::text from public.players where group_id = '00000000-0000-4000-8000-0000000fd000';
insert into t_results (label, result) select 'organiser: deleted list', (select string_agg(e->>'name', ',') from json_array_elements(public.my_deleted_groups()) e);
do $$ begin
  perform public.delete_group('00000000-0000-4000-8000-0000000fd000', 'Test Group Z');
  insert into t_results (label, result) values ('delete twice', 'deleted');
exception when others then insert into t_results (label, result) values ('delete twice', 'refused: ' || left(sqlerrm, 30)); end $$;

-- Hidden from the player straight away.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fda02","role":"authenticated"}';
insert into t_results (label, result) select 'player after: in group', (public.my_status()->>'is_member');
insert into t_results (label, result) select 'player after: sees players', count(*)::text from public.players where group_id = '00000000-0000-4000-8000-0000000fd000';
insert into t_results (label, result) select 'player: deleted list', json_array_length(public.my_deleted_groups())::text;
do $$ begin
  perform public.undo_delete_group('00000000-0000-4000-8000-0000000fd000');
  insert into t_results (label, result) values ('player brings back', 'back');
exception when others then insert into t_results (label, result) values ('player brings back', 'refused: ' || left(sqlerrm, 24)); end $$;

-- Nobody joins a deleted group.
reset role;
do $$ begin
  insert into public.group_members (group_id, user_id, role) values ('00000000-0000-4000-8000-0000000fd000', '00000000-0000-4000-8000-0000000fda03', 'player');
  insert into t_results (label, result) values ('someone joins it', 'joined');
exception when others then insert into t_results (label, result) values ('someone joins it', 'refused: ' || left(sqlerrm, 29)); end $$;
set local role authenticated;

-- The organiser brings it back.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fda01","role":"authenticated"}';
do $$ begin
  perform public.undo_delete_group('00000000-0000-4000-8000-0000000fd000');
  insert into t_results (label, result) values ('organiser brings back', 'back');
exception when others then insert into t_results (label, result) values ('organiser brings back', 'refused: ' || left(sqlerrm, 30)); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fda02","role":"authenticated"}';
insert into t_results (label, result) select 'player after undo: in group', (public.my_status()->>'is_member');
insert into t_results (label, result) select 'player after undo: sees players', count(*)::text from public.players where group_id = '00000000-0000-4000-8000-0000000fd000';

-- After 7 days it can't come back.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000fda01","role":"authenticated"}';
do $$ begin perform public.delete_group('00000000-0000-4000-8000-0000000fd000', 'Test Group Z'); end $$;
reset role;
update public.groups set deleted_at = now() - interval '8 days' where id = '00000000-0000-4000-8000-0000000fd000';
set local role authenticated;
insert into t_results (label, result) select 'after 8 days: deleted list', json_array_length(public.my_deleted_groups())::text;
do $$ begin
  perform public.undo_delete_group('00000000-0000-4000-8000-0000000fd000');
  insert into t_results (label, result) values ('bring back after 8 days', 'back');
exception when others then insert into t_results (label, result) values ('bring back after 8 days', 'refused: ' || left(sqlerrm, 28)); end $$;

-- L.G.C still can't be deleted.
reset role;
do $$ declare v_uid uuid; v_g uuid; begin
  select id into v_g from public.groups where legacy limit 1;
  select gm.user_id into v_uid from public.group_members gm join auth.users u on u.id = gm.user_id
   where gm.group_id = v_g and gm.role = 'organiser' and not u.is_anonymous limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-group-id', v_g)::text, true);
  begin
    perform public.delete_group(v_g, (select name from public.groups where id = v_g));
    insert into t_results (label, result) values ('delete L.G.C', 'deleted');
  exception when others then insert into t_results (label, result) values ('delete L.G.C', 'refused: ' || left(sqlerrm, 24)); end;
end $$;

reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
