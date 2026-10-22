-- 090 test: committees and elections (nominate → accept → vote → seat filled; term limits; staggered terms;
-- appointments; resigning and by-elections; ties). STAGING only, after 090. Rolled back; the results come back as the
-- error message ("RESULTS: ..."). Expected answers in 090_committees_elections.expected.txt.
-- Group H: ho — organiser, h1 / h2 / h3 — players, hg — guest. Group I: io — organiser of another group.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000c900', 'test-h90', 'Test Group H90', 'H90-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000c910', 'test-i90', 'Test Group I90', 'I90-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000000c9a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c9a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c9a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c9a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c9a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c9a06', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000000c9b01', '00000000-0000-4000-8000-00000000c900', 'H Organiser', 'Ho', 10),
  ('00000000-0000-4000-8000-0000000c9b02', '00000000-0000-4000-8000-00000000c900', 'H One', 'Uno', 15),
  ('00000000-0000-4000-8000-0000000c9b03', '00000000-0000-4000-8000-00000000c900', 'H Two', 'Dos', 18),
  ('00000000-0000-4000-8000-0000000c9b04', '00000000-0000-4000-8000-00000000c900', 'H Three', 'Tres', 20),
  ('00000000-0000-4000-8000-0000000c9b05', '00000000-0000-4000-8000-00000000c900', 'H Guest', null, 25),
  ('00000000-0000-4000-8000-0000000c9b10', '00000000-0000-4000-8000-00000000c910', 'I Organiser', null, 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000c900', '00000000-0000-4000-8000-0000000c9a01', '00000000-0000-4000-8000-0000000c9b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000c900', '00000000-0000-4000-8000-0000000c9a02', '00000000-0000-4000-8000-0000000c9b02', 'player'),
  ('00000000-0000-4000-8000-00000000c900', '00000000-0000-4000-8000-0000000c9a03', '00000000-0000-4000-8000-0000000c9b03', 'player'),
  ('00000000-0000-4000-8000-00000000c900', '00000000-0000-4000-8000-0000000c9a04', '00000000-0000-4000-8000-0000000c9b04', 'player'),
  ('00000000-0000-4000-8000-00000000c900', '00000000-0000-4000-8000-0000000c9a05', '00000000-0000-4000-8000-0000000c9b05', 'guest'),
  ('00000000-0000-4000-8000-00000000c910', '00000000-0000-4000-8000-0000000c9a06', '00000000-0000-4000-8000-0000000c9b10', 'organiser');
insert into public.group_features (group_id, feature_key, enabled) values
  ('00000000-0000-4000-8000-00000000c900', 'tribunal', true), ('00000000-0000-4000-8000-00000000c900', 'committees', true),
  ('00000000-0000-4000-8000-00000000c900', 'feed', true), ('00000000-0000-4000-8000-00000000c910', 'committees', true)
  on conflict (group_id, feature_key) do update set enabled = true;
insert into t_results (label, result) select 'new group election rule', private.gov_settings('00000000-0000-4000-8000-00000000c900', 'election')->>'decides';

set local role authenticated;
-- ================= ho (organiser) sets up a committee: 2 elected seats, 1-trip term, term limit 1, staggered =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000c900"}', true); end $$;
insert into t_ids values ('rc', public.save_committee_v2(null, 'Rules Committee', array['new_rule','change_rule'], 2, 'election', 1, null, 1, true, 72));
insert into t_results (label, result) select 'committee saved: seats / limit / staggered',
  (select count(*) from public.committee_seats where committee_id = v)::text || ' / ' || c.term_limit || ' / ' || c.staggered
  from t_ids join public.committees c on c.id = v where k = 'rc';
insert into t_results (label, result) select 'staggered: half-term seats',
  (select string_agg(seat_no || '=' || half_term, ',' order by seat_no) from public.committee_seats where committee_id = v) from t_ids where k = 'rc';

-- ================= h1 (player) can't set up committees or call elections =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a02","role":"authenticated"}';
do $$ begin
  perform public.save_committee_v2(null, 'Sneaky', '{}', 1, 'election', null, null, null, false, 72);
  insert into t_results (label, result) values ('player saves a committee', 'allowed');
exception when others then insert into t_results (label, result) values ('player saves a committee', 'refused: ' || sqlerrm); end $$;
do $$ begin
  perform public.call_election((select v from t_ids where k = 'rc'), 1);
  insert into t_results (label, result) values ('player calls an election', 'allowed');
exception when others then insert into t_results (label, result) values ('player calls an election', 'refused: ' || sqlerrm); end $$;

-- ================= ho calls an election for seat 1 =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a01","role":"authenticated"}';
insert into t_ids values ('e1', public.call_election((select v from t_ids where k = 'rc'), 1));
insert into t_results (label, result) select 'election opened: kind / phase / stage', kind || ' / ' || election_phase || ' / ' || stage
  from public.cases where id = (select v from t_ids where k = 'e1');
do $$ begin
  perform public.call_election((select v from t_ids where k = 'rc'), 1);
  insert into t_results (label, result) values ('second election for the same seat', 'allowed');
exception when others then insert into t_results (label, result) values ('second election for the same seat', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'feed post: nominations open', count(*)::text from public.posts
  where group_id = '00000000-0000-4000-8000-00000000c900' and body like '🗳️ Nominations open: Rules Committee, seat 1%';

-- ================= nominations: h1 stands, h1 nominates h2 (pending), h2 accepts; the guest can't =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a02","role":"authenticated"}';
insert into t_results (label, result) values ('h1 stands', public.nominate((select v from t_ids where k = 'e1'), '00000000-0000-4000-8000-0000000c9b02'));
insert into t_results (label, result) values ('h1 nominates h2', public.nominate((select v from t_ids where k = 'e1'), '00000000-0000-4000-8000-0000000c9b03'));
do $$ begin
  perform public.vote_election((select v from t_ids where k = 'e1'), '00000000-0000-4000-8000-0000000c9b02');
  insert into t_results (label, result) values ('vote during nominations', 'allowed');
exception when others then insert into t_results (label, result) values ('vote during nominations', 'refused: ' || sqlerrm); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a03","role":"authenticated"}';
insert into t_results (label, result) values ('h2 accepts', public.answer_nomination((select v from t_ids where k = 'e1'), true));
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a05","role":"authenticated"}';
do $$ begin
  perform public.nominate((select v from t_ids where k = 'e1'), '00000000-0000-4000-8000-0000000c9b05');
  insert into t_results (label, result) values ('guest nominates', 'allowed');
exception when others then insert into t_results (label, result) values ('guest nominates', 'refused: ' || sqlerrm); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a04","role":"authenticated"}';
do $$ begin
  perform public.nominate((select v from t_ids where k = 'e1'), '00000000-0000-4000-8000-0000000c9b05');
  insert into t_results (label, result) values ('nominate a guest', 'allowed');
exception when others then insert into t_results (label, result) values ('nominate a guest', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'nominations seen by a member',
  string_agg(p.nickname || ':' || n.status, ',' order by p.nickname) from public.election_nominations n join public.players p on p.id = n.player_id
  where n.case_id = (select v from t_ids where k = 'e1');

-- ================= the other group sees nothing and can't act =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a06","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000c910"}', true); end $$;
insert into t_results (label, result) select 'other group: H nominations / cases / seats visible',
  (select count(*) from public.election_nominations)::text || ' / ' ||
  (select count(*) from public.cases where group_id = '00000000-0000-4000-8000-00000000c900')::text || ' / ' ||
  (select count(*) from public.committee_seats where group_id = '00000000-0000-4000-8000-00000000c900')::text;
do $$ begin
  perform public.nominate((select v from t_ids where k = 'e1'), '00000000-0000-4000-8000-0000000c9b10');
  insert into t_results (label, result) values ('other group nominates', 'allowed');
exception when others then insert into t_results (label, result) values ('other group nominates', 'refused: ' || sqlerrm); end $$;
do $$ begin
  perform public.call_election((select v from t_ids where k = 'rc'), 2);
  insert into t_results (label, result) values ('other group calls H''s election', 'allowed');
exception when others then insert into t_results (label, result) values ('other group calls H''s election', 'refused: ' || sqlerrm); end $$;

-- ================= nominations close (the hourly clock): the vote opens =================
reset role;
update public.cases set closes_at = now() - interval '1 minute' where id = (select v from t_ids where k = 'e1');
select private.governance_tick_group('00000000-0000-4000-8000-00000000c900');
insert into t_results (label, result) select 'after nominations: phase / stage / closes in future',
  election_phase || ' / ' || stage || ' / ' || (closes_at > now())::text from public.cases where id = (select v from t_ids where k = 'e1');
set local role authenticated;

-- ================= the vote: guest refused, old vote_case refused, then 3 votes for h1 settles it early =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a05","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000c900"}', true); end $$;
do $$ begin
  perform public.vote_election((select v from t_ids where k = 'e1'), '00000000-0000-4000-8000-0000000c9b02');
  insert into t_results (label, result) values ('guest votes', 'allowed');
exception when others then insert into t_results (label, result) values ('guest votes', 'refused: ' || sqlerrm); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a02","role":"authenticated"}';
do $$ begin
  perform public.vote_case((select v from t_ids where k = 'e1'), 'for', null);
  insert into t_results (label, result) values ('old vote_case on an election', 'allowed');
exception when others then insert into t_results (label, result) values ('old vote_case on an election', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) values ('h1 votes h1', public.vote_election((select v from t_ids where k = 'e1'), '00000000-0000-4000-8000-0000000c9b02'));
insert into t_results (label, result) select 'turnout after one vote', (public.election_turnout(v)->>'voted') || ' of ' || (public.election_turnout(v)->>'voters') from t_ids where k = 'e1';
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a03","role":"authenticated"}';
insert into t_results (label, result) values ('h2 votes h1', public.vote_election((select v from t_ids where k = 'e1'), '00000000-0000-4000-8000-0000000c9b02'));
insert into t_results (label, result) select 'h2 sees ballots (own only)', count(*)::text from public.election_ballots;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a04","role":"authenticated"}';
insert into t_results (label, result) values ('h3 votes h1 (nobody can catch them)', public.vote_election((select v from t_ids where k = 'e1'), '00000000-0000-4000-8000-0000000c9b02'));
insert into t_results (label, result) select 'case: status / verdict / tally', status || ' / ' || verdict || ' / ' || votes_for || '–' || votes_against
  from public.cases where id = (select v from t_ids where k = 'e1');
insert into t_results (label, result) select 'seat 1: holder / term_no', p.nickname || ' / ' || s.term_no
  from public.committee_seats s join public.players p on p.id = s.player_id where s.committee_id = (select v from t_ids where k = 'rc') and s.seat_no = 1;
insert into t_results (label, result) select 'feed post: elected', count(*)::text from public.posts
  where group_id = '00000000-0000-4000-8000-00000000c900' and body like '🗳️ Elected: Uno takes seat 1 on the Rules Committee (3–0)%';

-- ================= seat 2: one candidate → elected unopposed (staggered half-term kept) =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a01","role":"authenticated"}';
insert into t_ids values ('e2', public.call_election((select v from t_ids where k = 'rc'), 2));
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a04","role":"authenticated"}';
do $$ begin
  perform public.nominate((select v from t_ids where k = 'e2'), '00000000-0000-4000-8000-0000000c9b02');
  insert into t_results (label, result) values ('nominate h1 for a second seat on the same committee', 'allowed');
exception when others then insert into t_results (label, result) values ('nominate h1 for a second seat on the same committee', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) values ('h3 stands for seat 2', public.nominate((select v from t_ids where k = 'e2'), '00000000-0000-4000-8000-0000000c9b04'));
reset role;
update public.cases set closes_at = now() - interval '1 minute' where id = (select v from t_ids where k = 'e2');
select private.governance_tick_group('00000000-0000-4000-8000-00000000c900');
insert into t_results (label, result) select 'seat 2: status / reason / holder / half_term', c.status || ' / ' || c.reason || ' / ' || p.nickname || ' / ' || s.half_term
  from public.cases c, public.committee_seats s join public.players p on p.id = s.player_id
  where c.id = (select v from t_ids where k = 'e2') and s.committee_id = (select v from t_ids where k = 'rc') and s.seat_no = 2;

-- ================= term ends (a trip has started since): the clock opens an election; h1 is at the limit =================
update public.committee_seats set started_at = now() - interval '200 days' where committee_id = (select v from t_ids where k = 'rc') and seat_no = 1;
insert into public.trips (group_id, name, start_date, end_date, status)
values ('00000000-0000-4000-8000-00000000c900', 'Test trip', current_date - 30, current_date - 28, 'locked');
insert into t_results (label, result) select 'seat 1 term ended', (private.seat_term_ended(s.id)).ended::text
  from public.committee_seats s where committee_id = (select v from t_ids where k = 'rc') and seat_no = 1;
select private.governance_tick_group('00000000-0000-4000-8000-00000000c900');
insert into t_ids select 'e3', id from public.cases where group_id = '00000000-0000-4000-8000-00000000c900' and kind = 'election' and status = 'open'
  and proposal->>'why' = 'term' and (proposal->>'seat_no')::int = 1;
insert into t_results (label, result) select 'term election opened / holder auto-nominated', count(*)::text || ' / ' ||
  (select count(*) from public.election_nominations where case_id = (select v from t_ids where k = 'e3'))::text from t_ids where k = 'e3';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000c900"}', true); end $$;
do $$ begin
  perform public.nominate((select v from t_ids where k = 'e3'), '00000000-0000-4000-8000-0000000c9b02');
  insert into t_results (label, result) values ('h1 at the term limit stands again', 'allowed');
exception when others then insert into t_results (label, result) values ('h1 at the term limit stands again', 'refused: ' || sqlerrm); end $$;
do $$ begin
  perform public.raise_case('election', 'Uno again', null, null, null,
    jsonb_build_object('committee_id', (select v from t_ids where k = 'rc'), 'seat_no', 1, 'candidate', '00000000-0000-4000-8000-0000000c9b02'));
  insert into t_results (label, result) values ('old yes/no election for h1 at the limit', 'allowed');
exception when others then insert into t_results (label, result) values ('old yes/no election for h1 at the limit', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) values ('h1 nominates h2 for seat 1', public.nominate((select v from t_ids where k = 'e3'), '00000000-0000-4000-8000-0000000c9b03'));

-- ================= resigning: h3 steps down from seat 2 → by-election =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a03","role":"authenticated"}';
do $$ begin
  perform public.resign_seat((select v from t_ids where k = 'rc'), 2);
  insert into t_results (label, result) values ('h2 resigns h3''s seat', 'allowed');
exception when others then insert into t_results (label, result) values ('h2 resigns h3''s seat', 'refused: ' || sqlerrm); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a04","role":"authenticated"}';
insert into t_ids values ('e4', public.resign_seat((select v from t_ids where k = 'rc'), 2));
insert into t_results (label, result) select 'after resigning: seat empty / by-election phase',
  (s.player_id is null)::text || ' / ' || c.title || ' ' || c.election_phase
  from public.committee_seats s, public.cases c where s.committee_id = (select v from t_ids where k = 'rc') and s.seat_no = 2 and c.id = (select v from t_ids where k = 'e4');

-- ================= by-election tie: h2 v h3, 2–2 → an organiser not in the tie picks =================
insert into t_results (label, result) values ('h3 stands in the by-election', public.nominate((select v from t_ids where k = 'e4'), '00000000-0000-4000-8000-0000000c9b04'));
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a01","role":"authenticated"}';
insert into t_results (label, result) values ('ho stands in the by-election', public.nominate((select v from t_ids where k = 'e4'), '00000000-0000-4000-8000-0000000c9b01'));
reset role;
update public.cases set closes_at = now() - interval '1 minute' where id = (select v from t_ids where k = 'e4');
select private.governance_tick_group('00000000-0000-4000-8000-00000000c900');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000c900"}', true); end $$;
insert into t_results (label, result) values ('ho votes ho', public.vote_election((select v from t_ids where k = 'e4'), '00000000-0000-4000-8000-0000000c9b01'));
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a02","role":"authenticated"}';
insert into t_results (label, result) values ('h1 votes h3', public.vote_election((select v from t_ids where k = 'e4'), '00000000-0000-4000-8000-0000000c9b04'));
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a03","role":"authenticated"}';
insert into t_results (label, result) values ('h2 votes ho', public.vote_election((select v from t_ids where k = 'e4'), '00000000-0000-4000-8000-0000000c9b01'));
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a04","role":"authenticated"}';
insert into t_results (label, result) values ('h3 votes h3 (a tie)', public.vote_election((select v from t_ids where k = 'e4'), '00000000-0000-4000-8000-0000000c9b04'));
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a01","role":"authenticated"}';
do $$ begin
  perform public.decide_election((select v from t_ids where k = 'e4'), '00000000-0000-4000-8000-0000000c9b01');
  insert into t_results (label, result) values ('ho (in the tie) picks', 'allowed');
exception when others then insert into t_results (label, result) values ('ho (in the tie) picks', 'refused: ' || sqlerrm); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a02","role":"authenticated"}';
do $$ begin
  perform public.decide_election((select v from t_ids where k = 'e4'), '00000000-0000-4000-8000-0000000c9b04');
  insert into t_results (label, result) values ('a player picks the winner', 'allowed');
exception when others then insert into t_results (label, result) values ('a player picks the winner', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'tie: stage / tied', stage || ' / ' || jsonb_array_length(proposal->'tied') from public.cases where id = (select v from t_ids where k = 'e4');
reset role;
-- A second organiser (h1 promoted) breaks the tie.
update public.group_members set role = 'organiser' where player_id = '00000000-0000-4000-8000-0000000c9b02';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000c900"}', true); end $$;
select public.decide_election((select v from t_ids where k = 'e4'), '00000000-0000-4000-8000-0000000c9b04');
insert into t_results (label, result) select 'tie decided: status / reason / seat 2 holder', c.status || ' / ' || c.reason || ' / ' || p.nickname
  from public.cases c, public.committee_seats s join public.players p on p.id = s.player_id
  where c.id = (select v from t_ids where k = 'e4') and s.committee_id = (select v from t_ids where k = 'rc') and s.seat_no = 2;

-- ================= an appointed, staggered committee: non-organiser can't appoint; staggered seats end apart =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a01","role":"authenticated"}';
insert into t_ids values ('hc', public.save_committee_v2(null, 'Handicap Committee', array['handicap'], 2, 'appointment', null, 1, 2, true, 72));
select public.appoint_seat((select v from t_ids where k = 'hc'), 1, '00000000-0000-4000-8000-0000000c9b03');
select public.appoint_seat((select v from t_ids where k = 'hc'), 2, '00000000-0000-4000-8000-0000000c9b04');
do $$ begin
  perform public.call_election((select v from t_ids where k = 'hc'), 1);
  insert into t_results (label, result) values ('election on an appointed committee', 'allowed');
exception when others then insert into t_results (label, result) values ('election on an appointed committee', 'refused: ' || sqlerrm); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a04","role":"authenticated"}';
do $$ begin
  perform public.appoint_seat((select v from t_ids where k = 'hc'), 1, '00000000-0000-4000-8000-0000000c9b04');
  insert into t_results (label, result) values ('player appoints', 'allowed');
exception when others then insert into t_results (label, result) values ('player appoints', 'refused: ' || sqlerrm); end $$;
reset role;
update public.committee_seats set started_at = now() - interval '7 months' where committee_id = (select v from t_ids where k = 'hc');
insert into t_results (label, result) select 'staggered 1-year terms after 7 months: seat ended',
  string_agg(s.seat_no || '=' || (private.seat_term_ended(s.id)).ended, ',' order by s.seat_no) from public.committee_seats s where committee_id = (select v from t_ids where k = 'hc');
-- Re-appointing the same person is a new term; past the limit (2) it's refused.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000c900"}', true); end $$;
select public.appoint_seat((select v from t_ids where k = 'hc'), 2, '00000000-0000-4000-8000-0000000c9b04');
insert into t_results (label, result) select 're-appointed: term_no / half_term', term_no || ' / ' || half_term from public.committee_seats where committee_id = (select v from t_ids where k = 'hc') and seat_no = 2;
reset role;
update public.committee_seats set started_at = now() - interval '13 months' where committee_id = (select v from t_ids where k = 'hc') and seat_no = 2;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c9a01","role":"authenticated"}';
do $$ begin
  perform public.appoint_seat((select v from t_ids where k = 'hc'), 2, '00000000-0000-4000-8000-0000000c9b04');
  insert into t_results (label, result) values ('third term in a row (limit 2)', 'allowed');
exception when others then insert into t_results (label, result) values ('third term in a row (limit 2)', 'refused: ' || sqlerrm); end $$;

reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
