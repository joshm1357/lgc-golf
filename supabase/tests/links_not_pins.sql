-- Links, not PINs test (22 Oct 2026). STAGING only, after 083. Everything is rolled back; the results come back as
-- the error message ("RESULTS: ..."). Expected answers are in links_not_pins.expected.txt.
--
-- Group L: lo — organiser; lp — player (phone only); lg — guest; ln — a new phone-only sign-in in no group;
--   lm — a player's second phone (phone only), already in L as someone else; lgoo — a proper (Google) sign-in, no group.
-- Group M: mo — organiser of another group.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_tok (k text primary key, v text);
grant all on t_tok to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000e000', 'test-l', 'Test Group L', 'L-CODE-TEST-1', 'l-admin-1234'),
  ('00000000-0000-4000-8000-00000000e100', 'test-m', 'Test Group M', 'M-CODE-TEST-1', 'm-admin-1234');
insert into auth.users (id, instance_id, aud, role, is_anonymous, email) values
  ('00000000-0000-4000-8000-0000000e0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'lo@example.com'),
  ('00000000-0000-4000-8000-0000000e0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, null),
  ('00000000-0000-4000-8000-0000000e0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, null),
  ('00000000-0000-4000-8000-0000000e0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, null),
  ('00000000-0000-4000-8000-0000000e0a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, null),
  ('00000000-0000-4000-8000-0000000e0a06', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'mo@example.com'),
  ('00000000-0000-4000-8000-0000000e0a07', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'goo@example.com');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000000e0b01', '00000000-0000-4000-8000-00000000e000', 'L Organiser', null, 10),
  ('00000000-0000-4000-8000-0000000e0b02', '00000000-0000-4000-8000-00000000e000', 'Pete Player', 'Pete', 18),
  ('00000000-0000-4000-8000-0000000e0b03', '00000000-0000-4000-8000-00000000e000', 'Gus Guest', null, 30),
  ('00000000-0000-4000-8000-0000000e0b04', '00000000-0000-4000-8000-00000000e000', 'Other Ollie', null, 22),
  ('00000000-0000-4000-8000-0000000e0b10', '00000000-0000-4000-8000-00000000e100', 'M Organiser', null, 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-0000000e0a01', '00000000-0000-4000-8000-0000000e0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-0000000e0a02', '00000000-0000-4000-8000-0000000e0b02', 'player'),
  ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-0000000e0a03', '00000000-0000-4000-8000-0000000e0b03', 'guest'),
  ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-0000000e0a05', '00000000-0000-4000-8000-0000000e0b04', 'player'),
  ('00000000-0000-4000-8000-00000000e100', '00000000-0000-4000-8000-0000000e0a06', '00000000-0000-4000-8000-0000000e0b10', 'organiser');

set local role authenticated;
-- ================= organiser: the standing player invite =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e000"}', true); end $$;
insert into t_tok values ('org-invite', public.group_invite('player'));
insert into t_tok values ('org-share', public.share_join_code());
insert into t_results (label, result) select 'organiser share code = the player invite', (a.v = b.v)::text from t_tok a, t_tok b where a.k = 'org-invite' and b.k = 'org-share';

-- ================= player: gets the same code =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a02","role":"authenticated"}';
insert into t_tok values ('player-share', public.share_join_code());
insert into t_results (label, result) select 'player gets the player invite', (a.v = b.v)::text from t_tok a, t_tok b where a.k = 'org-invite' and b.k = 'player-share';
insert into t_results (label, result) select 'that code joins as', public.invite_info(v)->>'role' from t_tok where k = 'player-share';

-- ================= guest: gets the guest code =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a03","role":"authenticated"}';
insert into t_tok values ('guest-share', public.share_join_code());
insert into t_results (label, result) select 'guest code differs from the player one', (a.v <> b.v)::text from t_tok a, t_tok b where a.k = 'org-invite' and b.k = 'guest-share';
insert into t_results (label, result) select 'guest code joins as', public.invite_info(v)->>'role' from t_tok where k = 'guest-share';

-- ================= other group's organiser asking with L's id: gets their own group's code, never L's =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a06","role":"authenticated"}';
insert into t_tok values ('m-share', public.share_join_code());
insert into t_results (label, result) select 'other group asking with L''s header gets L''s code', (a.v = b.v)::text from t_tok a, t_tok b where a.k = 'org-invite' and b.k = 'm-share';
insert into t_results (label, result) select 'their code is for group', public.invite_info(v)->>'group_name' from t_tok where k = 'm-share';

-- ================= someone in no group =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a04","role":"authenticated"}';
do $$ begin
  perform public.share_join_code();
  insert into t_results (label, result) values ('no group: share code', 'given');
exception when others then insert into t_results (label, result) values ('no group: share code', 'refused'); end $$;

-- ================= revoked invite is never returned =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e000"}', true); end $$;
insert into t_tok values ('org-reset', public.reset_group_invite('player'));
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a02","role":"authenticated"}';
insert into t_tok values ('player-after-reset', public.share_join_code());
insert into t_results (label, result) select 'after a reset: not the old code / the new one',
  (a.v <> o.v)::text || ' / ' || (a.v = n.v)::text
  from t_tok a, t_tok o, t_tok n where a.k = 'player-after-reset' and o.k = 'org-invite' and n.k = 'org-reset';
-- all revoked (no live code at all): a new one is made, still not the revoked one
reset role;
update public.group_invites set revoked_at = now() where group_id = '00000000-0000-4000-8000-00000000e000' and role = 'player';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a02","role":"authenticated"}';
insert into t_tok values ('player-fresh', public.share_join_code());
reset role;
insert into t_results (label, result) select 'nothing live: a fresh code (not a revoked one)',
  (not exists (select 1 from public.group_invites g where g.token = f.v and g.revoked_at is not null))::text || ' / ' || length(f.v)::text
  from t_tok f where f.k = 'player-fresh';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a02","role":"authenticated"}';

-- ================= Copy my link: a player makes their own personal link =================
insert into t_tok values ('pete-link', public.create_my_player_link());
insert into t_results (label, result) select 'my link is 12 characters', length(v)::text from t_tok where k = 'pete-link';
insert into t_tok values ('pete-link2', public.create_my_player_link());
insert into t_results (label, result) select 'a new one replaces the old', (public.player_link_info(o.v)->>'state') || ' / ' || (public.player_link_info(n.v)->>'state')
  from t_tok o, t_tok n where o.k = 'pete-link' and n.k = 'pete-link2';
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a04","role":"authenticated"}';
do $$ begin
  perform public.create_my_player_link();
  insert into t_results (label, result) values ('no group: my link', 'made');
exception when others then insert into t_results (label, result) values ('no group: my link', 'refused'); end $$;

-- ================= a new phone (no sign-in, no group) opens Pete's link =================
insert into t_results (label, result) select 'new phone uses the link: group', (public.use_player_link(v) = '00000000-0000-4000-8000-00000000e000')::text from t_tok where k = 'pete-link2';
reset role;
insert into t_results (label, result)
  select 'new phone is now Pete, as a player', (player_id = '00000000-0000-4000-8000-0000000e0b02')::text || ' / ' || role
  from public.group_members where user_id = '00000000-0000-4000-8000-0000000e0a04' and group_id = '00000000-0000-4000-8000-00000000e000';
insert into t_results (label, result)
  select 'Pete''s old phone still Pete', (count(*) = 1)::text from public.group_members
  where user_id = '00000000-0000-4000-8000-0000000e0a02' and player_id = '00000000-0000-4000-8000-0000000e0b02';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a04","role":"authenticated"}';
insert into t_results (label, result) select 'tapped twice on the same phone', (public.use_player_link(v) is not null)::text from t_tok where k = 'pete-link2';

-- someone else's phone tries the used link
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a03","role":"authenticated"}';
do $$ begin
  perform public.use_player_link((select v from t_tok where k = 'pete-link2'));
  insert into t_results (label, result) values ('used link on another phone', 'used');
exception when others then insert into t_results (label, result) values ('used link on another phone', 'refused: ' || left(sqlerrm, 32)); end $$;
-- a replaced link
do $$ begin
  perform public.use_player_link((select v from t_tok where k = 'pete-link'));
  insert into t_results (label, result) values ('replaced link', 'used');
exception when others then insert into t_results (label, result) values ('replaced link', 'refused: ' || left(sqlerrm, 26)); end $$;
-- a phone already someone else in the group
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a01","role":"authenticated"}';
insert into t_tok values ('pete-link3', public.create_player_link('00000000-0000-4000-8000-0000000e0b02'));
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a05","role":"authenticated"}';
do $$ begin
  perform public.use_player_link((select v from t_tok where k = 'pete-link3'));
  insert into t_results (label, result) values ('phone that is already Ollie', 'used');
exception when others then insert into t_results (label, result) values ('phone that is already Ollie', 'refused: ' || left(sqlerrm, 38)); end $$;
-- a wrong code
insert into t_results (label, result) values ('wrong code', coalesce(public.use_player_link('ZZZZZZZZZZZZ')::text, 'null'));
-- a proper sign-in goes through 046 (claim_player_link)
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a07","role":"authenticated"}';
insert into t_results (label, result) select 'proper sign-in uses the link', (public.use_player_link(v) is not null)::text from t_tok where k = 'pete-link3';
insert into t_results (label, result) select 'proper sign-in: info says mine', public.player_link_info(v)->>'mine' from t_tok where k = 'pete-link3';

-- ================= the old PIN functions still work for old app versions =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e0a04","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
insert into t_results (label, result) values ('old join_group_id with a PIN', coalesce((public.join_group_id('M-CODE-TEST-1') = '00000000-0000-4000-8000-00000000e100')::text, 'null'));

reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
