-- 093 test: awards and fines — propose → decide; opinions; the run-up reminder; a fine from a feed post (post_id);
-- "Latest out" with photo + time, settled on the best claim, −1 stroke on the winner's next round; organiser removes a
-- frivolous fine; the fined person appeals; the leftover kitty rule; the other group is shut out; guests refused;
-- switched off. STAGING only, after 093. Rolled back; the results come back as the error message ("RESULTS: ...").
-- Expected answers in 093_awards_fines.expected.txt.
-- NOTE (23 Oct): the Supabase MCP asks a person to confirm any UPDATE / DELETE, so from an unattended session only
-- part A (everything up to "settle before closing", inserts and RPCs only) has been run. Part B (marked below) needs
-- running with someone there to confirm.
-- Group A: ao — organiser, a1 / a2 — players, ag — guest. Group B: bo — organiser of another group.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000e930', 'test-a93', 'Test Group A93', 'A93-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000e940', 'test-b93', 'Test Group B93', 'B93-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000000e9a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e9a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e9a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e9a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e9a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000000e9b01', '00000000-0000-4000-8000-00000000e930', 'A Organiser', 'Ao', 10),
  ('00000000-0000-4000-8000-0000000e9b02', '00000000-0000-4000-8000-00000000e930', 'A One', 'Hamish', 15),
  ('00000000-0000-4000-8000-0000000e9b03', '00000000-0000-4000-8000-00000000e930', 'A Two', 'Tom', 18),
  ('00000000-0000-4000-8000-0000000e9b04', '00000000-0000-4000-8000-00000000e930', 'A Guest', null, 25),
  ('00000000-0000-4000-8000-0000000e9b10', '00000000-0000-4000-8000-00000000e940', 'B Organiser', null, 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000e930', '00000000-0000-4000-8000-0000000e9a01', '00000000-0000-4000-8000-0000000e9b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000e930', '00000000-0000-4000-8000-0000000e9a02', '00000000-0000-4000-8000-0000000e9b02', 'player'),
  ('00000000-0000-4000-8000-00000000e930', '00000000-0000-4000-8000-0000000e9a03', '00000000-0000-4000-8000-0000000e9b03', 'player'),
  ('00000000-0000-4000-8000-00000000e930', '00000000-0000-4000-8000-0000000e9a04', '00000000-0000-4000-8000-0000000e9b04', 'guest'),
  ('00000000-0000-4000-8000-00000000e940', '00000000-0000-4000-8000-0000000e9a05', '00000000-0000-4000-8000-0000000e9b10', 'organiser');
insert into public.group_features (group_id, feature_key, enabled) values
  ('00000000-0000-4000-8000-00000000e930', 'dinner_awards', true), ('00000000-0000-4000-8000-00000000e930', 'rule_voting', true),
  ('00000000-0000-4000-8000-00000000e930', 'feed', true), ('00000000-0000-4000-8000-00000000e930', 'tribunal', true),
  ('00000000-0000-4000-8000-00000000e930', 'rule_challenges', true), ('00000000-0000-4000-8000-00000000e930', 'notifications', true),
  ('00000000-0000-4000-8000-00000000e940', 'dinner_awards', true)
  on conflict (group_id, feature_key) do nothing;
insert into public.trips (id, group_id, name, start_date, end_date) values
  ('00000000-0000-4000-8000-0000000e9c01', '00000000-0000-4000-8000-00000000e930', 'Hunter Trip',
   (now() at time zone 'Australia/Sydney')::date + 5, (now() at time zone 'Australia/Sydney')::date + 7);
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000e9c02', '00000000-0000-4000-8000-00000000e930', 'A course', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status) values
  ('00000000-0000-4000-8000-0000000e9c03', '00000000-0000-4000-8000-00000000e930', '00000000-0000-4000-8000-0000000e9c01',
   '00000000-0000-4000-8000-0000000e9c02', 'Day 1', 'stableford', 'setup');
insert into public.round_players (round_id, player_id, playing_handicap, group_id) values
  ('00000000-0000-4000-8000-0000000e9c03', '00000000-0000-4000-8000-0000000e9b02', 15, '00000000-0000-4000-8000-00000000e930'),
  ('00000000-0000-4000-8000-0000000e9c03', '00000000-0000-4000-8000-0000000e9b03', 18, '00000000-0000-4000-8000-00000000e930');
select private.gov_apply_preset('00000000-0000-4000-8000-00000000e930', 'organiser', null);   -- the organiser decides (as L.G.C)
insert into t_results (label, result) select 'every group has the leftover kitty rule: A / value',
  count(*)::text || ' / ' || min(value) from public.rules where group_id = '00000000-0000-4000-8000-00000000e930' and system_key = 'leftover_kitty';

set local role authenticated;
-- ================= a1 proposes a fine and an award =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e930"}', true); end $$;
with r as (insert into public.rules (group_id, title, detail, category, applies_to, status, proposed_by, award_kind, reward_type, reward_amount, proof)
  values ('00000000-0000-4000-8000-00000000e930', 'Wrong-ball fine', 'Played someone else''s ball', 'other', '{trip}', 'proposed',
          '00000000-0000-4000-8000-0000000e9b02', 'fine', 'money', 5, 'none') returning id)
insert into t_ids select 'fine', id from r;
with r as (insert into public.rules (group_id, title, category, applies_to, status, proposed_by, award_kind, reward_type, reward_amount, proof, best)
  values ('00000000-0000-4000-8000-00000000e930', 'Latest out', 'other', '{trip}', 'proposed',
          '00000000-0000-4000-8000-0000000e9b02', 'award', 'strokes', -1, 'photo_time', 'latest') returning id)
insert into t_ids select 'late', id from r;
insert into t_results (label, result) select 'proposed: category / value / status', string_agg(title || ':' || category || ':' || value || ':' || status, ', ' order by title)
  from public.rules where id in (select v from t_ids where k in ('fine', 'late'));
insert into t_results (label, result) select 'proposals became new-rule cases', count(*)::text from public.cases
  where rule_id in (select v from t_ids where k in ('fine', 'late')) and kind = 'new_rule';
do $$ begin
  insert into public.rules (group_id, title, category, applies_to, status, proposed_by, award_kind, reward_type, reward_amount)
  values ('00000000-0000-4000-8000-00000000e930', 'Zero strokes', 'other', '{all}', 'proposed', '00000000-0000-4000-8000-0000000e9b02', 'award', 'strokes', 0);
  insert into t_results (label, result) values ('award worth 0 strokes', 'allowed');
exception when others then insert into t_results (label, result) values ('award worth 0 strokes', 'refused: ' || sqlerrm); end $$;

-- ================= the guest can't propose; the other group can't see =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a04","role":"authenticated"}';
do $$ begin
  insert into public.rules (group_id, title, category, applies_to, status, proposed_by, award_kind, reward_type)
  values ('00000000-0000-4000-8000-00000000e930', 'Guest award', 'other', '{all}', 'proposed', '00000000-0000-4000-8000-0000000e9b04', 'award', 'bragging');
  insert into t_results (label, result) values ('guest proposes', 'allowed');
exception when others then insert into t_results (label, result) values ('guest proposes', 'refused: ' || sqlerrm); end $$;
do $$ begin
  insert into public.rule_opinions (rule_id, player_id, opinion) values ((select v from t_ids where k = 'fine'), '00000000-0000-4000-8000-0000000e9b04', 'too_much');
  insert into t_results (label, result) values ('guest gives an opinion', 'allowed');
exception when others then insert into t_results (label, result) values ('guest gives an opinion', 'refused: ' || sqlerrm); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a05","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e940"}', true); end $$;
insert into t_results (label, result) select 'other group sees A''s award rules', count(*)::text from public.rules where group_id = '00000000-0000-4000-8000-00000000e930';

-- ================= the run-up reminder (a week out): once, with 2 proposals waiting =================
reset role;
insert into t_results (label, result) values ('reminder tick: trips reminded', (select private.awards_runup_tick())::text);
insert into t_results (label, result) select 'reminder: waiting proposals', waiting::text from public.award_reminders where trip_id = '00000000-0000-4000-8000-0000000e9c01';
insert into t_results (label, result) values ('reminder tick again (once only)', (select count(*) from public.award_reminders where trip_id = '00000000-0000-4000-8000-0000000e9c01')::text
  || ' row, tick=' || (select private.awards_runup_tick())::text);
set local role authenticated;

-- ================= opinions on the fine's size =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a03","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e930"}', true); end $$;
insert into public.rule_opinions (rule_id, player_id, opinion, comment) values ((select v from t_ids where k = 'fine'), '00000000-0000-4000-8000-0000000e9b03', 'too_much', 'Two bucks is plenty');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a02","role":"authenticated"}';
insert into public.rule_opinions (rule_id, player_id, opinion) values ((select v from t_ids where k = 'fine'), '00000000-0000-4000-8000-0000000e9b02', 'about_right');
do $$ begin
  insert into public.rule_opinions (rule_id, player_id, opinion) values ((select v from t_ids where k = 'fine'), '00000000-0000-4000-8000-0000000e9b03', 'too_little');
  insert into t_results (label, result) values ('opinion as someone else', 'allowed');
exception when others then insert into t_results (label, result) values ('opinion as someone else', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'opinions on the fine', string_agg(opinion, ',' order by opinion) from public.rule_opinions where rule_id = (select v from t_ids where k = 'fine');

-- ================= the organiser decides (the group's decision rule: organiser) =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a01","role":"authenticated"}';
do $$ declare c record; begin
  for c in select id from public.cases where rule_id in (select v from t_ids where k in ('fine', 'late')) and kind = 'new_rule' and status = 'open' loop
    perform public.decide_case(c.id, 'passed', 'Good one');
  end loop;
end $$;
insert into t_results (label, result) select 'after deciding: statuses', string_agg(title || ':' || status, ', ' order by title)
  from public.rules where id in (select v from t_ids where k in ('fine', 'late'));

-- ================= a1 posts a photo; a2 fines a1 from the post =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a02","role":"authenticated"}';
with p as (insert into public.posts (group_id, kind, player_id, trip_id, body, photo_url)
  values ('00000000-0000-4000-8000-00000000e930', 'user', '00000000-0000-4000-8000-0000000e9b02', '00000000-0000-4000-8000-0000000e9c01',
          'Found my ball!', 'https://example.com/ball.jpg') returning id)
insert into t_ids select 'post', id from p;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a03","role":"authenticated"}';
insert into t_ids values ('fineA', public.award_for_trip('00000000-0000-4000-8000-0000000e9c01', (select v from t_ids where k = 'fine')));
insert into t_results (label, result) values ('award_for_trip twice → same award',
  ((select v from t_ids where k = 'fineA') = public.award_for_trip('00000000-0000-4000-8000-0000000e9c01', (select v from t_ids where k = 'fine')))::text);
insert into t_results (label, result) select 'trip fine: title / kind / penalty', title || ' / ' || kind || ' / ' || penalty from public.dinner_awards where id = (select v from t_ids where k = 'fineA');
with n as (insert into public.dinner_award_nominations (award_id, player_id, reason, post_id, nominated_by)
  values ((select v from t_ids where k = 'fineA'), '00000000-0000-4000-8000-0000000e9b02', 'Not his ball', (select v from t_ids where k = 'post'), '00000000-0000-4000-8000-0000000e9b03') returning id)
insert into t_ids select 'nomFine', id from n;
insert into t_results (label, result) select 'nomination from a post: post linked / photo copied',
  (post_id = (select v from t_ids where k = 'post'))::text || ' / ' || coalesce(photo_url, 'none') from public.dinner_award_nominations where id = (select v from t_ids where k = 'nomFine');

-- ================= the other group and the guest can't fine =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a05","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e940"}', true); end $$;
do $$ begin
  perform public.award_for_trip('00000000-0000-4000-8000-0000000e9c01', (select v from t_ids where k = 'fine'));
  insert into t_results (label, result) values ('other group: award_for_trip', 'allowed');
exception when others then insert into t_results (label, result) values ('other group: award_for_trip', 'refused: ' || sqlerrm); end $$;
do $$ begin
  insert into public.dinner_award_nominations (award_id, player_id, nominated_by) values ((select v from t_ids where k = 'fineA'), '00000000-0000-4000-8000-0000000e9b03', '00000000-0000-4000-8000-0000000e9b10');
  insert into t_results (label, result) values ('other group: nominate', 'allowed');
exception when others then insert into t_results (label, result) values ('other group: nominate', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'other group sees A''s nominations / opinions',
  (select count(*) from public.dinner_award_nominations)::text || ' / ' || (select count(*) from public.rule_opinions)::text;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a04","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000e930"}', true); end $$;
do $$ begin
  perform public.award_for_trip('00000000-0000-4000-8000-0000000e9c01', (select v from t_ids where k = 'fine'));
  insert into t_results (label, result) values ('guest: award_for_trip', 'allowed');
exception when others then insert into t_results (label, result) values ('guest: award_for_trip', 'refused: ' || sqlerrm); end $$;
do $$ begin
  insert into public.dinner_award_nominations (award_id, player_id, nominated_by) values ((select v from t_ids where k = 'fineA'), '00000000-0000-4000-8000-0000000e9b03', '00000000-0000-4000-8000-0000000e9b04');
  insert into t_results (label, result) values ('guest: nominate', 'allowed');
exception when others then insert into t_results (label, result) values ('guest: nominate', 'refused: ' || sqlerrm); end $$;

-- ================= the fined person appeals (a dispute about "who's fined") =================
-- ================= PART A continues =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a02","role":"authenticated"}';
insert into t_ids values ('appeal', public.raise_dispute(jsonb_build_object('table', 'dinner_award_nominations', 'id', (select v from t_ids where k = 'nomFine'),
  'field', 'player_id', 'label', 'Hamish fined: Wrong-ball fine ($5)'), 'Appeal: Wrong-ball fine', 'It was my ball', null, null));
insert into t_results (label, result) select 'appeal: kind / subject / status', kind || ' / ' || subject_kind || ':' || (subject_ref->>'table') || ' / ' || status
  from public.cases where id = (select v from t_ids where k = 'appeal');

-- ================= PART B (needs UPDATE / DELETE — run with someone there to confirm) =================
-- ================= a player can't remove someone else's nomination; the organiser removes a frivolous one =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a02","role":"authenticated"}';
delete from public.dinner_award_nominations where id = (select v from t_ids where k = 'nomFine');
insert into t_results (label, result) select 'fined player deletes the fine', case when count(*) = 1 then 'still there' else 'gone' end from public.dinner_award_nominations where id = (select v from t_ids where k = 'nomFine');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a01","role":"authenticated"}';
delete from public.dinner_award_nominations where id = (select v from t_ids where k = 'nomFine');
insert into t_results (label, result) select 'organiser removes it', case when count(*) = 1 then 'still there' else 'gone' end from public.dinner_award_nominations where id = (select v from t_ids where k = 'nomFine');

-- ================= "Latest out": photo + time =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a02","role":"authenticated"}';
insert into t_ids values ('lateA', public.award_for_trip('00000000-0000-4000-8000-0000000e9c01', (select v from t_ids where k = 'late')));
do $$ begin
  insert into public.dinner_award_nominations (award_id, player_id, photo_url, nominated_by)
  values ((select v from t_ids where k = 'lateA'), '00000000-0000-4000-8000-0000000e9b03', 'https://example.com/pub.jpg', '00000000-0000-4000-8000-0000000e9b02');
  insert into t_results (label, result) values ('claim without a time', 'allowed');
exception when others then insert into t_results (label, result) values ('claim without a time', 'refused: ' || sqlerrm); end $$;
do $$ begin
  insert into public.dinner_award_nominations (award_id, player_id, claim_at, nominated_by)
  values ((select v from t_ids where k = 'lateA'), '00000000-0000-4000-8000-0000000e9b03', now() - interval '1 hour', '00000000-0000-4000-8000-0000000e9b02');
  insert into t_results (label, result) values ('claim without a photo', 'allowed');
exception when others then insert into t_results (label, result) values ('claim without a photo', 'refused: ' || sqlerrm); end $$;
-- Tom out till 2:47am, Hamish till 11:15pm (Sydney).
insert into public.dinner_award_nominations (award_id, player_id, photo_url, claim_at, nominated_by)
values ((select v from t_ids where k = 'lateA'), '00000000-0000-4000-8000-0000000e9b03', 'https://example.com/pub.jpg',
        ((now() at time zone 'Australia/Sydney')::date - 1 + time '02:47') at time zone 'Australia/Sydney', '00000000-0000-4000-8000-0000000e9b02');
insert into t_results (label, result) select 'claim saved with time', lower(to_char(claim_at at time zone 'Australia/Sydney', 'FMHH12:MIam')) from public.dinner_award_nominations where award_id = (select v from t_ids where k = 'lateA');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a03","role":"authenticated"}';
insert into public.dinner_award_nominations (award_id, player_id, photo_url, claim_at, nominated_by)
values ((select v from t_ids where k = 'lateA'), '00000000-0000-4000-8000-0000000e9b02', 'https://example.com/bar.jpg',
        ((now() at time zone 'Australia/Sydney')::date - 2 + time '23:15') at time zone 'Australia/Sydney', '00000000-0000-4000-8000-0000000e9b03');

-- ================= organiser opens and closes the voting (no votes) and decides: the latest claim wins =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a01","role":"authenticated"}';
do $$ begin
  perform public.settle_dinner_award((select v from t_ids where k = 'lateA'));
  insert into t_results (label, result) values ('settle before closing', 'allowed');
exception when others then insert into t_results (label, result) values ('settle before closing', 'refused: ' || sqlerrm); end $$;
update public.dinner_awards set status = 'voting' where id = (select v from t_ids where k = 'lateA');
update public.dinner_awards set status = 'closed' where id = (select v from t_ids where k = 'lateA');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a02","role":"authenticated"}';
do $$ begin
  perform public.settle_dinner_award((select v from t_ids where k = 'lateA'));
  insert into t_results (label, result) values ('player settles', 'allowed');
exception when others then insert into t_results (label, result) values ('player settles', 'refused: ' || sqlerrm); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a01","role":"authenticated"}';
insert into t_results (label, result) select 'settled: status / post', r->>'status' || ' / ' || (r->>'post')
  from (select public.settle_dinner_award((select v from t_ids where k = 'lateA')) r) x;
insert into t_results (label, result) values ('settle again', public.settle_dinner_award((select v from t_ids where k = 'lateA'))->>'status');
insert into t_results (label, result) select 'feed post', body from public.posts where trip_id = '00000000-0000-4000-8000-0000000e9c01' and kind = 'auto' and link like '/dinner/%';
insert into t_results (label, result) select 'strokes waiting: who / strokes / label / round',
  p.nickname || ' / ' || s.strokes || ' / ' || s.label || ' / ' || coalesce(s.round_id::text, 'none')
  from public.award_strokes s join public.players p on p.id = s.player_id where s.award_id = (select v from t_ids where k = 'lateA');
do $$ begin
  update public.dinner_awards set winner_id = '00000000-0000-4000-8000-0000000e9b02' where id = (select v from t_ids where k = 'lateA');
  insert into t_results (label, result) select 'organiser changes the winner by hand', p.nickname from public.dinner_awards a join public.players p on p.id = a.winner_id where a.id = (select v from t_ids where k = 'lateA');
end $$;

-- ================= the next round goes live: the −1 goes on Tom's card =================
update public.rounds set status = 'live' where id = '00000000-0000-4000-8000-0000000e9c03';
insert into t_results (label, result) select 'after the round starts: round set / applied',
  (s.round_id = '00000000-0000-4000-8000-0000000e9c03')::text || ' / ' || (s.applied_at is not null)::text
  from public.award_strokes s where s.award_id = (select v from t_ids where k = 'lateA');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a03","role":"authenticated"}';
insert into t_results (label, result) select 'Tom reads his strokes', count(*)::text from public.award_strokes where player_id = '00000000-0000-4000-8000-0000000e9b03';
do $$ begin
  update public.award_strokes set strokes = -5 where player_id = '00000000-0000-4000-8000-0000000e9b03';
  insert into t_results (label, result) select 'player edits strokes', min(strokes)::text from public.award_strokes where player_id = '00000000-0000-4000-8000-0000000e9b03';
exception when others then insert into t_results (label, result) values ('player edits strokes', 'refused: ' || sqlerrm); end $$;

-- ================= the leftover kitty rule =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a02","role":"authenticated"}';
update public.rules set leftover = 'rollover' where group_id = '00000000-0000-4000-8000-00000000e930' and system_key = 'leftover_kitty';
insert into t_results (label, result) select 'player changes the leftover rule', value from public.rules where group_id = '00000000-0000-4000-8000-00000000e930' and system_key = 'leftover_kitty';
insert into public.rule_opinions (rule_id, player_id, opinion)
  select id, '00000000-0000-4000-8000-0000000e9b02', 'too_little' from public.rules where group_id = '00000000-0000-4000-8000-00000000e930' and system_key = 'leftover_kitty';
insert into t_results (label, result) select 'opinion on the leftover rule', count(*)::text from public.rule_opinions o join public.rules r on r.id = o.rule_id where r.system_key = 'leftover_kitty' and r.group_id = '00000000-0000-4000-8000-00000000e930';
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a01","role":"authenticated"}';
update public.rules set leftover = 'split' where group_id = '00000000-0000-4000-8000-00000000e930' and system_key = 'leftover_kitty';
insert into t_results (label, result) select 'organiser changes it: value / detail', value || ' / ' || detail from public.rules where group_id = '00000000-0000-4000-8000-00000000e930' and system_key = 'leftover_kitty';
do $$ begin
  update public.rules set leftover = 'other', leftover_note = null where group_id = '00000000-0000-4000-8000-00000000e930' and system_key = 'leftover_kitty';
  insert into t_results (label, result) values ('"other" with no words', 'allowed');
exception when others then insert into t_results (label, result) values ('"other" with no words', 'refused: ' || sqlerrm); end $$;
do $$ begin
  delete from public.rules where group_id = '00000000-0000-4000-8000-00000000e930' and system_key = 'leftover_kitty';
  insert into t_results (label, result) select 'organiser deletes the standard rule', case when count(*) = 1 then 'still there' else 'gone' end
    from public.rules where group_id = '00000000-0000-4000-8000-00000000e930' and system_key = 'leftover_kitty';
end $$;

-- ================= switched off: no new opinions or trip awards (reads stay) =================
reset role;
update public.group_features set enabled = false where group_id = '00000000-0000-4000-8000-00000000e930' and feature_key = 'dinner_awards';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000e9a03","role":"authenticated"}';
do $$ begin
  update public.rule_opinions set opinion = 'about_right' where rule_id = (select v from t_ids where k = 'fine');
  insert into t_results (label, result) select 'switched off: change opinion', opinion from public.rule_opinions where rule_id = (select v from t_ids where k = 'fine') and player_id = '00000000-0000-4000-8000-0000000e9b03';
exception when others then insert into t_results (label, result) values ('switched off: change opinion', 'refused: ' || sqlerrm); end $$;
do $$ begin
  perform public.award_for_trip('00000000-0000-4000-8000-0000000e9c01', (select v from t_ids where k = 'fine'));
  insert into t_results (label, result) values ('switched off: award_for_trip', 'allowed');
exception when others then insert into t_results (label, result) values ('switched off: award_for_trip', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'switched off: still readable', count(*)::text from public.rule_opinions where rule_id = (select v from t_ids where k = 'fine');

reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
