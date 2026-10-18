-- Stage 2 test: invite links, roles, guests, picking a name, admin PIN. STAGING only, after 027.
-- Everything is rolled back; the results come back as the error message ("RESULTS: ..."). Expected answers are in
-- stage2_invites.expected.txt.
--
-- Group E (new, not legacy). People: eo — organiser; e1 — joins by player link; eg — joins by guest link;
-- x — in no group yet (tries a revoked link, guesses links). L.G.C is the legacy group.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_tok (k text primary key, v text);
grant all on t_tok to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000e000', 'test-e', 'Test Group E', 'E-CODE-TEST-1', 'e-admin-1234');
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000e0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000000e0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000e0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000e0a09', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000e0b01', '00000000-0000-4000-8000-00000000e000', 'E Organiser', 10),
  ('00000000-0000-4000-8000-0000000e0b02', '00000000-0000-4000-8000-00000000e000', 'E One', 15),
  ('00000000-0000-4000-8000-0000000e0b03', '00000000-0000-4000-8000-00000000e000', 'E Guest', 28);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-0000000e0a01', '00000000-0000-4000-8000-0000000e0b01', 'organiser');
insert into public.rules (id, group_id, title, status) values ('00000000-0000-4000-8000-0000000e0c01', '00000000-0000-4000-8000-00000000e000', 'E rule up for a vote', 'proposed');
insert into public.tribunal_cases (id, group_id, accused_id, lodged_by, proposed_change, case_text) values
  ('00000000-0000-4000-8000-0000000e0c02', '00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-0000000e0b01', '00000000-0000-4000-8000-0000000e0b01', 2, 'E case');

-- ================= eo — organiser makes the links =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e000"}', true); end $$;
insert into t_tok values ('player', public.group_invite('player')), ('guest', public.group_invite('guest'));
insert into t_results (label, result) select 'player link is 12 characters', length(v)::text from t_tok where k = 'player';
insert into t_results (label, result) select 'asking again gives the same link', (public.group_invite('player') = v)::text from t_tok where k = 'player';
insert into t_results (label, result) select 'guest link differs', (a.v <> b.v)::text from t_tok a, t_tok b where a.k = 'player' and b.k = 'guest';
insert into t_tok values ('old', (select v from t_tok where k = 'player'));
update t_tok set v = public.reset_group_invite('player') where k = 'player';
insert into t_results (label, result) select 'reset gives a new link', (a.v <> b.v)::text from t_tok a, t_tok b where a.k = 'player' and b.k = 'old';
do $$ declare n int; begin
  select count(*) into n from public.group_invites;
  insert into t_results (label, result) values ('read the invites table', n::text);
exception when others then insert into t_results (label, result) values ('read the invites table', 'refused'); end $$;

-- ================= x — in no group: old link, guesses =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a09","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
insert into t_results (label, result) select 'old link after reset', coalesce(public.join_by_invite(v)::text, 'null') from t_tok where k = 'old';
do $$ begin
  perform public.group_invite('player');
  insert into t_results (label, result) values ('non-member makes a link', 'ok');
exception when others then insert into t_results (label, result) values ('non-member makes a link', 'refused'); end $$;
do $$ declare i int; v text := ''; begin
  for i in 1 .. 10 loop
    begin v := coalesce(public.join_by_invite('GUESS' || i)::text, 'null'); exception when others then v := sqlerrm; end;
  end loop;
  insert into t_results (label, result) values ('11th wrong link (old one counted too)', v);
end $$;

-- ================= e1 — joins with the player link =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a02","role":"authenticated"}';
insert into t_results (label, result) select 'link says which group', (public.invite_info(v) ->> 'group_name') || ' / ' || (public.invite_info(v) ->> 'role') from t_tok where k = 'player';
insert into t_results (label, result) select 'join by link', (public.join_by_invite(lower(v)) = '00000000-0000-4000-8000-00000000e000')::text from t_tok where k = 'player';
insert into t_results (label, result) select 'joined as', role from public.group_members where user_id = auth.uid();
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e000"}', true); end $$;
do $$ begin
  perform public.claim_player('00000000-0000-4000-8000-0000000e0b01');
  insert into t_results (label, result) values ('pick a name someone has', 'ok');
exception when others then insert into t_results (label, result) values ('pick a name someone has', 'refused'); end $$;
select public.claim_player('00000000-0000-4000-8000-0000000e0b02');
insert into t_results (label, result) select 'pick a free name', (player_id = '00000000-0000-4000-8000-0000000e0b02')::text from public.group_members where user_id = auth.uid();
do $$ begin
  perform public.set_member_role('00000000-0000-4000-8000-0000000e0a02', 'organiser');
  insert into t_results (label, result) values ('player makes self organiser', 'ok');
exception when others then insert into t_results (label, result) values ('player makes self organiser', 'refused'); end $$;
do $$ begin
  insert into t_results (label, result) values ('admin PIN in a new group', coalesce(public.claim_admin('e-admin-1234')::text, 'null'));
exception when others then insert into t_results (label, result) values ('admin PIN in a new group', 'refused'); end $$;
insert into t_results (label, result) select 'my_status', (s ->> 'role') || ' / legacy ' || (s ->> 'legacy') || ' / signed in ' || (s ->> 'signed_in')
  from (select public.my_status() s) x;
insert into public.rule_votes (rule_id, player_id, vote) values ('00000000-0000-4000-8000-0000000e0c01', '00000000-0000-4000-8000-0000000e0b02', 'yes');
insert into t_results (label, result) values ('player votes on a rule', 'ok');

-- ================= eg — joins with the guest link =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a03","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
select public.join_by_invite(v) from t_tok where k = 'guest';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e000"}', true); end $$;
insert into t_results (label, result) select 'guest joined as', role from public.group_members where user_id = auth.uid();
select public.claim_player('00000000-0000-4000-8000-0000000e0b03');
do $$ begin
  insert into public.rule_votes (rule_id, player_id, vote) values ('00000000-0000-4000-8000-0000000e0c01', '00000000-0000-4000-8000-0000000e0b03', 'yes');
  insert into t_results (label, result) values ('guest votes on a rule', 'ok');
exception when others then insert into t_results (label, result) values ('guest votes on a rule', 'refused'); end $$;
do $$ begin
  insert into public.rules (title, status, proposed_by) values ('guest rule', 'proposed', '00000000-0000-4000-8000-0000000e0b03');
  insert into t_results (label, result) values ('guest proposes a rule', 'ok');
exception when others then insert into t_results (label, result) values ('guest proposes a rule', 'refused'); end $$;
do $$ begin
  perform public.cast_vote('00000000-0000-4000-8000-0000000e0c02', 'guilty', null);
  insert into t_results (label, result) values ('guest votes in the Tribunal', 'ok');
exception when others then insert into t_results (label, result) values ('guest votes in the Tribunal', 'refused'); end $$;
do $$ begin
  insert into public.posts (kind, body, player_id) values ('user', 'guest post', '00000000-0000-4000-8000-0000000e0b03');
  insert into t_results (label, result) values ('guest posts in the feed', 'ok');
exception when others then insert into t_results (label, result) values ('guest posts in the feed', 'refused'); end $$;
-- A guest link for someone already in as a player doesn't demote them.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a02","role":"authenticated"}';
select public.join_by_invite(v) from t_tok where k = 'guest';
insert into t_results (label, result) select 'player opens guest link: still', role from public.group_members where user_id = auth.uid();

-- ================= eo — manages roles =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a01","role":"authenticated"}';
select public.set_member_role('00000000-0000-4000-8000-0000000e0a03', 'player');
insert into t_results (label, result) select 'organiser makes guest a player', role from public.group_members where user_id = '00000000-0000-4000-8000-0000000e0a03';
do $$ begin
  perform public.set_member_role('00000000-0000-4000-8000-0000000e0a01', 'player');
  insert into t_results (label, result) values ('last organiser steps down', 'ok');
exception when others then insert into t_results (label, result) values ('last organiser steps down', 'refused'); end $$;
select public.release_player('00000000-0000-4000-8000-0000000e0b02');
insert into t_results (label, result) select 'release a name', coalesce(player_id::text, 'free') from public.group_members where user_id = '00000000-0000-4000-8000-0000000e0a02';
do $$ begin
  perform public.remove_member('00000000-0000-4000-8000-0000000e0a03');
  insert into t_results (label, result) select 'remove a member (members left)', count(*)::text from public.group_members where group_id = '00000000-0000-4000-8000-00000000e000';
exception when undefined_function then insert into t_results (label, result) values ('remove a member (members left)', 'not yet — needs 027b'); end $$;
do $$ begin
  perform public.set_member_role((select user_id from public.group_members where group_id = private.legacy_group() limit 1), 'guest');
  insert into t_results (label, result) values ('E organiser changes an L.G.C role', 'ok');
exception when others then insert into t_results (label, result) values ('E organiser changes an L.G.C role', 'refused'); end $$;

reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
