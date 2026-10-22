-- Sign in first, as part of joining (ov13, 22 Oct 2026). STAGING only, after 086. Everything is rolled back; the
-- results come back as the error message ("RESULTS: ..."). Expected answers are in 086_signin_first_join.expected.txt.
--
-- Checks that the join RPCs work for a SIGNED-IN (non-anonymous) account, not only a phone-only one:
--   player invite, team link (sets cup_side), organiser link (sets role, works once), personal link (046
--   claim_player_link), invite_info's already_in for someone already in, claim_player's "taken", and 086's
--   used_link_info.
--
-- Group S: so — organiser. sa — signed in, no group (player invite). sb — signed in (team link). sc — signed in
--   (organiser link). sd — signed in, tries the used organiser link. se — signed in, already in S as Kurt.
--   sf — signed in, uses Pete's personal link. Last: no sign-in at all can't call used_link_info.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated, anon;
grant all on sequence t_results_n_seq to authenticated, anon;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000f000', 'test-s', 'Test Group S', 'S-CODE-TEST-1', 's-admin-1234');
insert into auth.users (id, instance_id, aud, role, is_anonymous, email) values
  ('00000000-0000-4000-8000-0000000f0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'so@example.com'),
  ('00000000-0000-4000-8000-0000000f0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'sa@example.com'),
  ('00000000-0000-4000-8000-0000000f0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'sb@example.com'),
  ('00000000-0000-4000-8000-0000000f0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'sc@example.com'),
  ('00000000-0000-4000-8000-0000000f0a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'sd@example.com'),
  ('00000000-0000-4000-8000-0000000f0a06', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'se@example.com'),
  ('00000000-0000-4000-8000-0000000f0a07', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'sf@example.com');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000000f0b01', '00000000-0000-4000-8000-00000000f000', 'S Organiser', null, 10),
  ('00000000-0000-4000-8000-0000000f0b02', '00000000-0000-4000-8000-00000000f000', 'Kurt Dahl', 'Kurt', 12),
  ('00000000-0000-4000-8000-0000000f0b03', '00000000-0000-4000-8000-00000000f000', 'Pete Player', 'Pete', 18),
  ('00000000-0000-4000-8000-0000000f0b04', '00000000-0000-4000-8000-00000000f000', 'Mike Morris', 'Mike', 20);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-0000000f0a01', '00000000-0000-4000-8000-0000000f0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-0000000f0a06', '00000000-0000-4000-8000-0000000f0b02', 'player');
insert into public.cup_sides (id, group_id, name, sort) values
  ('00000000-0000-4000-8000-0000000f0c01', '00000000-0000-4000-8000-00000000f000', 'Team Blue', 1),
  ('00000000-0000-4000-8000-0000000f0c02', '00000000-0000-4000-8000-00000000f000', 'Team Gold', 2);
insert into public.group_invites (token, group_id, role) values ('SPLAYRSPLAY2', '00000000-0000-4000-8000-00000000f000', 'player');
insert into public.team_invites (token, group_id, cup_side) values ('STEAMBSTEAM2', '00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-0000000f0c01');
insert into public.organiser_invites (token, group_id) values ('SORGANSORGA2', '00000000-0000-4000-8000-00000000f000');
insert into public.organiser_invites (token, group_id, expires_at) values ('SOLDEXSOLDE2', '00000000-0000-4000-8000-00000000f000', now() - interval '1 day');
insert into public.player_links (token, group_id, player_id, role) values ('SPETEPSPETE2', '00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-0000000f0b03', 'player');

set local role authenticated;

-- ================= sa: signed in, no group → player invite =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
insert into t_results (label, result) select 'sa: signed in (not phone-only)', (public.my_status()->>'signed_in');
insert into t_results (label, result) select 'sa: invite_info before / role', (public.invite_info('splayrsplay2')->>'already_in') || ' / ' || (public.invite_info('SPLAYRSPLAY2')->>'role');
insert into t_results (label, result) select 'sa: join_by_invite → group', (public.join_by_invite('SPLAYRSPLAY2') = '00000000-0000-4000-8000-00000000f000')::text;
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f000"}', true); end $$;
insert into t_results (label, result) select 'sa: now a member as / signed in / no name yet',
  (public.my_status()->>'role') || ' / ' || (public.my_status()->>'signed_in') || ' / ' || coalesce(public.my_status()->>'player_id', 'none');
insert into t_results (label, result) select 'sa: invite_info after', public.invite_info('SPLAYRSPLAY2')->>'already_in';
-- Picking Kurt (se has him) is refused; Mike works.
do $$ begin
  perform public.claim_player('00000000-0000-4000-8000-0000000f0b02');
  insert into t_results (label, result) values ('sa: pick Kurt (taken)', 'allowed');
exception when others then insert into t_results (label, result) values ('sa: pick Kurt (taken)', 'refused: ' || left(sqlerrm, 40)); end $$;
select public.claim_player('00000000-0000-4000-8000-0000000f0b04');
insert into t_results (label, result) select 'sa: pick Mike → player', (public.my_status()->>'player_id' = '00000000-0000-4000-8000-0000000f0b04')::text;
insert into t_results (label, result) select 'sa: join again (tapped twice) → same group, still Mike',
  (public.join_by_invite('SPLAYRSPLAY2') = '00000000-0000-4000-8000-00000000f000')::text || ' / ' || (public.my_status()->>'player_id' = '00000000-0000-4000-8000-0000000f0b04')::text;

-- ================= sb: signed in → team link =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a03","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
insert into t_results (label, result) select 'sb: team link info: team', public.invite_info('STEAMBSTEAM2')->>'team';
insert into t_results (label, result) select 'sb: join_by_invite (team) → group', (public.join_by_invite('STEAMBSTEAM2') = '00000000-0000-4000-8000-00000000f000')::text;
reset role;
insert into t_results (label, result) select 'sb: member row: role / cup_side is Team Blue',
  m.role || ' / ' || (m.cup_side = '00000000-0000-4000-8000-0000000f0c01')::text
  from public.group_members m where m.user_id = '00000000-0000-4000-8000-0000000f0a03';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a03","role":"authenticated"}';
insert into t_results (label, result) select 'sb: team link info after: my_team', public.invite_info('STEAMBSTEAM2')->>'my_team';

-- ================= sc: signed in → organiser link (works once) =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a04","role":"authenticated"}';
insert into t_results (label, result) select 'sc: organiser link info: role', public.invite_info('SORGANSORGA2')->>'role';
insert into t_results (label, result) select 'sc: used_link_info on a live link', coalesce(public.used_link_info('SORGANSORGA2')::text, 'null');
insert into t_results (label, result) select 'sc: join_by_invite (organiser) → group', (public.join_by_invite('SORGANSORGA2') = '00000000-0000-4000-8000-00000000f000')::text;
reset role;
insert into t_results (label, result) select 'sc: member role', m.role from public.group_members m where m.user_id = '00000000-0000-4000-8000-0000000f0a04';
insert into t_results (label, result) select 'organiser link marked used by sc', (o.used_by = '00000000-0000-4000-8000-0000000f0a04')::text from public.organiser_invites o where o.token = 'SORGANSORGA2';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a04","role":"authenticated"}';
insert into t_results (label, result) select 'sc: opens it again → info already_in (so straight in)', public.invite_info('SORGANSORGA2')->>'already_in';

-- ================= sd: signed in, the used organiser link =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a05","role":"authenticated"}';
insert into t_results (label, result) select 'sd: invite_info on a used organiser link', coalesce(public.invite_info('SORGANSORGA2')::text, 'null');
insert into t_results (label, result) select 'sd: used_link_info', public.used_link_info('SORGANSORGA2')->>'state';
insert into t_results (label, result) select 'sd: join_by_invite on it', coalesce(public.join_by_invite('SORGANSORGA2')::text, 'null');
insert into t_results (label, result) select 'sd: used_link_info on a run-out link', public.used_link_info('SOLDEXSOLDE2')->>'state';
insert into t_results (label, result) select 'sd: used_link_info on a player invite / a wrong code',
  coalesce(public.used_link_info('SPLAYRSPLAY2')::text, 'null') || ' / ' || coalesce(public.used_link_info('NOTACODE2345')::text, 'null');
insert into t_results (label, result) select 'sd: still in no group', (public.my_status()->>'is_member');

-- ================= se: signed in, already in S as Kurt =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a06","role":"authenticated"}';
insert into t_results (label, result) select 'se: player invite info already_in', public.invite_info('SPLAYRSPLAY2')->>'already_in';
insert into t_results (label, result) select 'se: join again keeps Kurt',
  (public.join_by_invite('SPLAYRSPLAY2') = '00000000-0000-4000-8000-00000000f000')::text || ' / ' || (public.my_status()->>'player_id' = '00000000-0000-4000-8000-0000000f0b02')::text;

-- ================= sf: signed in → Pete's personal link (046) =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a07","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
insert into t_results (label, result) select 'sf: personal link info: state / mine', (public.player_link_info('SPETEPSPETE2')->>'state') || ' / ' || coalesce(public.player_link_info('SPETEPSPETE2')->>'mine', 'null (not yet)');
insert into t_results (label, result) select 'sf: claim_player_link → group', (public.claim_player_link('SPETEPSPETE2') = '00000000-0000-4000-8000-00000000f000')::text;
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f000"}', true); end $$;
insert into t_results (label, result) select 'sf: now Pete, as a player', (public.my_status()->>'player_id' = '00000000-0000-4000-8000-0000000f0b03')::text || ' / ' || (public.my_status()->>'role');
insert into t_results (label, result) select 'sf: link info after: state / mine', (public.player_link_info('SPETEPSPETE2')->>'state') || ' / ' || coalesce(public.player_link_info('SPETEPSPETE2')->>'mine', 'null (not yet)');
insert into t_results (label, result) select 'sf: use_player_link (signed in → same as claim)', (public.use_player_link('SPETEPSPETE2') = '00000000-0000-4000-8000-00000000f000')::text;

-- ================= no sign-in at all: used_link_info refused =================
reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
do $$ begin
  perform public.used_link_info('SORGANSORGA2');
  insert into t_results (label, result) values ('anon: used_link_info', 'allowed');
exception when others then insert into t_results (label, result) values ('anon: used_link_info', 'refused'); end $$;

reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
