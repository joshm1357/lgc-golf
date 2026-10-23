-- 100 test: automatic awards — the claim window (Sydney, across midnight), the post's server time, claims from posts
-- (yourself / a mate, better claim kept, outside the window refused), guests can't claim, the morning proposal (once,
-- however often the job runs; no claims = no post), per-unit points (whole hours from midnight to 5am), confirm by an
-- organiser / at the first tee / after the Tribunal throws a dispute out, a dispute on one person's points line, a
-- different claim or "No winner", strokes as score_adjustments kind 'award' on the next round, from the scores (once per
-- round), cup_points (pending → confirmed / waived), RLS (members read, only the server writes, other group shut out).
-- STAGING only, after 099 and 100. Rolled back; the results come back as the error message ("RESULTS: ...").
-- Expected answers in 100_auto_awards.expected.txt.
-- Group A: ao — organiser, a1 (Hamish) / a2 (Tom) — players, ag — guest. Group B: bo — organiser of another group.
-- Dates: d0 = four days ago in Sydney (so every claim's time is in the past). The trip runs d0−1 to d0+2, so its nights are d0−1, d0 and d0+1. Round R1 is on d0+1
-- (first tee 8:00am); R0 (finished) was on d0−1.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;
create temp table t_d (d0 date);
-- A player's short name (members can read players).
create function pg_temp.nm(p uuid) returns text language sql stable as $$
  select coalesce((select coalesce(nullif(btrim(nickname), ''), name) from public.players where id = p), 'nobody') $$;
insert into t_d values ((now() at time zone 'Australia/Sydney')::date - 4);
grant all on t_d to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000f100', 'test-a100', 'Test Group A100', 'A100-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000f200', 'test-b100', 'Test Group B100', 'B100-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000000f1a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000000f1b01', '00000000-0000-4000-8000-00000000f100', 'A Organiser', 'Ao', 10),
  ('00000000-0000-4000-8000-0000000f1b02', '00000000-0000-4000-8000-00000000f100', 'A One', 'Hamish', 15),
  ('00000000-0000-4000-8000-0000000f1b03', '00000000-0000-4000-8000-00000000f100', 'A Two', 'Tom', 18),
  ('00000000-0000-4000-8000-0000000f1b04', '00000000-0000-4000-8000-00000000f100', 'A Guest', null, 25),
  ('00000000-0000-4000-8000-0000000f1b10', '00000000-0000-4000-8000-00000000f200', 'B Organiser', null, 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1a01', '00000000-0000-4000-8000-0000000f1b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1a02', '00000000-0000-4000-8000-0000000f1b02', 'player'),
  ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1a03', '00000000-0000-4000-8000-0000000f1b03', 'player'),
  ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1a04', '00000000-0000-4000-8000-0000000f1b04', 'guest'),
  ('00000000-0000-4000-8000-00000000f200', '00000000-0000-4000-8000-0000000f1a05', '00000000-0000-4000-8000-0000000f1b10', 'organiser');
insert into public.group_features (group_id, feature_key, enabled) values
  ('00000000-0000-4000-8000-00000000f100', 'dinner_awards', true), ('00000000-0000-4000-8000-00000000f100', 'rule_voting', true),
  ('00000000-0000-4000-8000-00000000f100', 'feed', true), ('00000000-0000-4000-8000-00000000f100', 'tribunal', true),
  ('00000000-0000-4000-8000-00000000f100', 'rule_challenges', true), ('00000000-0000-4000-8000-00000000f100', 'notifications', true),
  ('00000000-0000-4000-8000-00000000f200', 'dinner_awards', true), ('00000000-0000-4000-8000-00000000f200', 'feed', true)
  on conflict (group_id, feature_key) do nothing;
insert into public.push_subscriptions (endpoint, user_id, player_id, p256dh, auth) values
  ('https://push.example/f1a02', '00000000-0000-4000-8000-0000000f1a02', '00000000-0000-4000-8000-0000000f1b02', 'k', 'a'),
  ('https://push.example/f1a01', '00000000-0000-4000-8000-0000000f1a01', '00000000-0000-4000-8000-0000000f1b01', 'k', 'a');
insert into public.trips (id, group_id, name, start_date, end_date) select
  '00000000-0000-4000-8000-0000000f1c01', '00000000-0000-4000-8000-00000000f100', 'Hunter Trip', d0 - 1, d0 + 2 from t_d;
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000f1c02', '00000000-0000-4000-8000-00000000f100', 'A course', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status, play_date) select
  '00000000-0000-4000-8000-0000000f1c03', '00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01',
  '00000000-0000-4000-8000-0000000f1c02', 'Day 3', 'stableford', 'setup', d0 + 1 from t_d;
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status, play_date) select
  '00000000-0000-4000-8000-0000000f1c04', '00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01',
  '00000000-0000-4000-8000-0000000f1c02', 'Day 1', 'stableford', 'setup', d0 - 1 from t_d;
insert into public.round_players (round_id, player_id, playing_handicap, group_id) values
  ('00000000-0000-4000-8000-0000000f1c03', '00000000-0000-4000-8000-0000000f1b02', 15, '00000000-0000-4000-8000-00000000f100'),
  ('00000000-0000-4000-8000-0000000f1c03', '00000000-0000-4000-8000-0000000f1b03', 18, '00000000-0000-4000-8000-00000000f100'),
  ('00000000-0000-4000-8000-0000000f1c04', '00000000-0000-4000-8000-0000000f1b02', 15, '00000000-0000-4000-8000-00000000f100'),
  ('00000000-0000-4000-8000-0000000f1c04', '00000000-0000-4000-8000-0000000f1b03', 18, '00000000-0000-4000-8000-00000000f100');
insert into public.tee_groups (group_id, round_id, group_no, tee_time, player_ids) values
  ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c03', 1, '08:00',
   '{00000000-0000-4000-8000-0000000f1b02,00000000-0000-4000-8000-0000000f1b03}');
update public.rounds set status = 'locked' where id = '00000000-0000-4000-8000-0000000f1c04';
insert into public.comps (id, group_id, trip_id, name, kind) values
  ('00000000-0000-4000-8000-0000000f1c05', '00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'Weekend Cup', 'manual');
select private.gov_apply_preset('00000000-0000-4000-8000-00000000f100', 'organiser', null);

-- ================= the time maths (no data) =================
insert into t_results (label, result) select 'night window for d0: opens / closes (Sydney)',
  to_char(w.opens at time zone 'Australia/Sydney', 'HH24:MI') || ' d0 / ' || to_char(w.closes at time zone 'Australia/Sydney', 'HH24:MI') || ' d0+'
  || ((w.closes at time zone 'Australia/Sydney')::date - d0)::text from t_d, private.aa_window('21:00', '06:00', d0) w;
insert into t_results (label, result) select 'which night: 11:30pm d0 / 2:47am d0+1 / 3pm d0 / 6am d0+1',
  concat_ws(' / ', private.aa_window_date('21:00', '06:00', private.aa_at(d0, '23:30')) - d0, private.aa_window_date('21:00', '06:00', private.aa_at(d0 + 1, '02:47')) - d0,
    coalesce((private.aa_window_date('21:00', '06:00', private.aa_at(d0, '15:00')) - d0)::text, 'none'),
    coalesce((private.aa_window_date('21:00', '06:00', private.aa_at(d0 + 1, '06:00')) - d0)::text, 'none')) from t_d;
insert into t_results (label, result) select 'times for night d0 (tee 8am d0+1): propose / confirm',
  to_char(t.propose_at at time zone 'Australia/Sydney', 'HH24:MI') || ' / ' || to_char(t.confirm_by at time zone 'Australia/Sydney', 'HH24:MI')
  from t_d, private.aa_times('00000000-0000-4000-8000-0000000f1c01', d0, '07:00', private.aa_at(d0 + 1, '06:00')) t;
insert into t_results (label, result) select 'times for night d0+1 (no round d0+2): propose / confirm',
  to_char(t.propose_at at time zone 'Australia/Sydney', 'HH24:MI') || ' / ' || to_char(t.confirm_by at time zone 'Australia/Sydney', 'HH24:MI')
  from t_d, private.aa_times('00000000-0000-4000-8000-0000000f1c01', d0 + 1, '07:00', private.aa_at(d0 + 2, '06:00')) t;
insert into t_results (label, result) select 'per-unit points from 12am to 5am, 2:47am: whole / part / max 1 / 5:30am whole / 11pm',
  concat_ws(' / ',
    private.aa_line_points('{"mode":"per_unit","per":1,"size":1,"from":"00:00","to":"05:00","round":"whole"}', 'latest', 'night', '21:00', d0, private.aa_at(d0 + 1, '02:47'), null, 1, true),
    private.aa_line_points('{"mode":"per_unit","per":1,"size":1,"from":"00:00","to":"05:00","round":"part"}', 'latest', 'night', '21:00', d0, private.aa_at(d0 + 1, '02:47'), null, 1, true),
    private.aa_line_points('{"mode":"per_unit","per":1,"from":"00:00","to":"05:00","max":1}', 'latest', 'night', '21:00', d0, private.aa_at(d0 + 1, '02:47'), null, 1, true),
    private.aa_line_points('{"mode":"per_unit","per":1,"from":"00:00","to":"05:00"}', 'latest', 'night', '21:00', d0, private.aa_at(d0 + 1, '05:30'), null, 1, true),
    private.aa_line_points('{"mode":"per_unit","per":1,"from":"00:00","to":"05:00"}', 'latest', 'night', '21:00', d0, private.aa_at(d0, '23:00'), null, 1, true)) from t_d;
insert into t_results (label, result) select 'numbers: 1 pt per 5 m over 10 m, 23 m whole / placings 3-2-1 rank 2 / rank 4 / winner 3',
  concat_ws(' / ',
    private.aa_line_points('{"mode":"per_unit","per":1,"size":5,"from":10}', 'highest', 'night', '21:00', d0, null, 23, 1, true),
    private.aa_line_points('{"mode":"placings","places":[3,2,1]}', 'latest', 'night', '21:00', d0, null, null, 2, false),
    private.aa_line_points('{"mode":"placings","places":[3,2,1]}', 'latest', 'night', '21:00', d0, null, null, 4, false),
    private.aa_line_points('{"mode":"winner","points":3}', 'latest', 'night', '21:00', d0, null, null, 1, true)) from t_d;
insert into t_results (label, result) select 'points in words', concat_ws(' | ',
  private.aa_points_words('{"mode":"per_unit","per":1,"from":"00:00","to":"05:00"}', 'award', 'latest', null),
  private.aa_points_words('{"mode":"placings","places":[3,2,1]}', 'award', 'earliest', null),
  private.aa_points_words('{"mode":"winner","points":2}', 'fine', null, null));
do $$ begin
  perform private.aa_points_check('{"mode":"per_unit","per":1}', 'latest', null);
  insert into t_results (label, result) values ('per-unit with no start time', 'allowed');
exception when others then insert into t_results (label, result) values ('per-unit with no start time', 'refused: ' || sqlerrm); end $$;

-- ================= the awards =================
-- A: the Rulebook's "Latest out" (−1 stroke, photo + time, latest wins; 1 pt an hour after midnight to 5am → the cup).
insert into public.rules (id, group_id, title, category, applies_to, status, award_kind, reward_type, reward_amount, proof, best, points, comp_id)
values ('00000000-0000-4000-8000-0000000f1d01', '00000000-0000-4000-8000-00000000f100', 'Latest out', 'fines', '{trip}', 'active',
  'award', 'strokes', -1, 'photo_time', 'latest', '{"mode":"per_unit","per":1,"size":1,"from":"00:00","to":"05:00","round":"whole"}', null);
insert into t_results (label, result) select 'rule A: value', value from public.rules where id = '00000000-0000-4000-8000-0000000f1d01';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f100"}', true); end $$;
-- B: the trip's own "Earliest up" (a title; time; earliest wins; placings 3-2-1), counting towards the Weekend Cup.
insert into public.dinner_awards (id, group_id, trip_id, title, kind, reward_type, reward_note, proof, best, points, comp_id, created_by)
values ('00000000-0000-4000-8000-0000000f1d02', '00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'Earliest up', 'award',
  'title', 'Wears the hat', 'time', 'earliest', '{"mode":"placings","places":[3,2,1]}', '00000000-0000-4000-8000-0000000f1c05', '00000000-0000-4000-8000-0000000f1b01');
-- C: "Most birdies" from the scores ($10, 3 pts to the winner).
insert into public.dinner_awards (id, group_id, trip_id, title, kind, reward_type, reward_amount, from_scores, points, comp_id, created_by)
values ('00000000-0000-4000-8000-0000000f1d03', '00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'Most birdies', 'award',
  'money', 10, 'birdies_gross', '{"mode":"winner","points":3}', '00000000-0000-4000-8000-0000000f1c05', '00000000-0000-4000-8000-0000000f1b01');
do $$ begin
  insert into t_ids select 'awardA', public.award_for_trip('00000000-0000-4000-8000-0000000f1c01', '00000000-0000-4000-8000-0000000f1d01');
  update public.dinner_awards set comp_id = '00000000-0000-4000-8000-0000000f1c05' where id = (select v from t_ids where k = 'awardA');
  insert into t_results (label, result) values ('organiser sets A''s cup for this trip', 'allowed');
exception when others then insert into t_results (label, result) values ('organiser sets A''s cup for this trip', 'refused: ' || sqlerrm); end $$;
reset role;
insert into t_results (label, result) select 'how they run: Most birdies / Latest out / Earliest up', string_agg(t.runs || coalesce(' ' || t.window_from || '-' || t.window_to, ''), ' / ' order by a.title desc)
  from public.dinner_awards a, private.auto_terms(a.id) t where a.trip_id = '00000000-0000-4000-8000-0000000f1c01' and a.parent_id is null;
set local role authenticated;
do $$ begin
  insert into public.dinner_awards (group_id, trip_id, title, kind, points) values ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'Bad points', 'award', '{"mode":"placings","places":"x"}');
  insert into t_results (label, result) values ('bad points setting', 'allowed');
exception when others then insert into t_results (label, result) values ('bad points setting', 'refused: ' || sqlerrm); end $$;

-- ================= posts: the server's time =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a02","role":"authenticated"}';
with p as (insert into public.posts (group_id, trip_id, kind, body, player_id, photo_url, server_at)
  values ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'user', 'Still out 🍺', '00000000-0000-4000-8000-0000000f1b02',
          'https://example.com/pub1.jpg', '2000-01-01') returning id, server_at)
insert into t_ids select 'p_h_1110', id from p;
insert into t_results (label, result) select 'post server_at is the server''s (not the phone''s)', (server_at = now())::text
  from public.posts where id = (select v from t_ids where k = 'p_h_1110');
do $$ begin
  update public.posts set server_at = '2001-01-01' where id = (select v from t_ids where k = 'p_h_1110');
  insert into t_results (label, result) select 'change server_at later', (server_at = now())::text || ' (unchanged)' from public.posts where id = (select v from t_ids where k = 'p_h_1110');
exception when others then insert into t_results (label, result) values ('change server_at later', 'refused: ' || sqlerrm); end $$;
with p as (insert into public.posts (group_id, trip_id, kind, body, player_id, photo_url)
  values ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'user', 'Last one standing', '00000000-0000-4000-8000-0000000f1b02', 'https://example.com/pub2.jpg') returning id)
insert into t_ids select 'p_h_0247', id from p;
with p as (insert into public.posts (group_id, trip_id, kind, body, player_id, photo_url)
  values ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'user', 'Lunch', '00000000-0000-4000-8000-0000000f1b02', 'https://example.com/lunch.jpg') returning id)
insert into t_ids select 'p_h_1500', id from p;
with p as (insert into public.posts (group_id, trip_id, kind, body, player_id) values ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'user', 'No photo', '00000000-0000-4000-8000-0000000f1b02') returning id)
insert into t_ids select 'p_h_nophoto', id from p;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a03","role":"authenticated"}';
with p as (insert into public.posts (group_id, trip_id, kind, body, player_id, photo_url)
  values ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'user', 'Bed', '00000000-0000-4000-8000-0000000f1b03', 'https://example.com/bed.jpg') returning id)
insert into t_ids select 'p_t_0115', id from p;
with p as (insert into public.posts (group_id, trip_id, kind, body, player_id, photo_url)
  values ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'user', 'Up and at it', '00000000-0000-4000-8000-0000000f1b03', 'https://example.com/sun.jpg') returning id)
insert into t_ids select 'p_t_0540', id from p;
with p as (insert into public.posts (group_id, trip_id, kind, body, player_id, photo_url)
  values ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'user', 'Night two', '00000000-0000-4000-8000-0000000f1b03', 'https://example.com/n2.jpg') returning id)
insert into t_ids select 'p_t_n2', id from p;
with p as (insert into public.posts (group_id, trip_id, kind, body, player_id, photo_url)
  values ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'user', 'Early again', '00000000-0000-4000-8000-0000000f1b03', 'https://example.com/n2b.jpg') returning id)
insert into t_ids select 'p_t_n2b', id from p;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a02","role":"authenticated"}';
with p as (insert into public.posts (group_id, trip_id, kind, body, player_id, photo_url)
  values ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', 'user', 'Sunrise', '00000000-0000-4000-8000-0000000f1b02', 'https://example.com/sunrise.jpg') returning id)
insert into t_ids select 'p_h_0510', id from p;
-- The test moves the posts' server times into the night (as if they'd been posted then): the trigger is paused for it.
reset role;
alter table public.posts disable trigger aa_posts_server_at;
update public.posts p set server_at = case x.k
    when 'p_h_1110' then private.aa_at(d0, '23:10') when 'p_h_0247' then private.aa_at(d0 + 1, '02:47') when 'p_h_1500' then private.aa_at(d0, '15:00')
    when 'p_h_nophoto' then private.aa_at(d0 + 1, '01:00') when 'p_t_0115' then private.aa_at(d0 + 1, '01:15') when 'p_t_0540' then private.aa_at(d0 + 1, '05:40')
    when 'p_h_0510' then private.aa_at(d0 + 1, '05:10') when 'p_t_n2' then private.aa_at(d0 + 2, '00:30') when 'p_t_n2b' then private.aa_at(d0 + 2, '04:50') end
  from t_ids x, t_d where x.v = p.id;
alter table public.posts enable trigger aa_posts_server_at;
set local role authenticated;

-- ================= claims =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a02","role":"authenticated"}';
insert into t_results (label, result) select 'Hamish claims Latest out (11:10pm)', r->>'status' from public.award_claim_post((select v from t_ids where k = 'p_h_1110'), null, '00000000-0000-4000-8000-0000000f1d01') r;
insert into t_results (label, result) select 'a later post (2:47am) → better', r->>'status' from public.award_claim_post((select v from t_ids where k = 'p_h_0247'), null, '00000000-0000-4000-8000-0000000f1d01') r;
insert into t_results (label, result) select 'the 11:10pm post again → kept 2:47am', (r->>'status') || ' ' || private.aa_clock((r->>'at')::timestamptz) from public.award_claim_post((select v from t_ids where k = 'p_h_1110'), null, '00000000-0000-4000-8000-0000000f1d01') r;
do $$ begin
  perform public.award_claim_post((select v from t_ids where k = 'p_h_1500'), null, '00000000-0000-4000-8000-0000000f1d01');
  insert into t_results (label, result) values ('claim a 3pm post', 'allowed');
exception when others then insert into t_results (label, result) values ('claim a 3pm post', 'refused: ' || sqlerrm); end $$;
do $$ begin
  perform public.award_claim_post((select v from t_ids where k = 'p_h_nophoto'), null, '00000000-0000-4000-8000-0000000f1d01');
  insert into t_results (label, result) values ('claim with no photo', 'allowed');
exception when others then insert into t_results (label, result) values ('claim with no photo', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'Hamish claims Earliest up (5:10am)', r->>'status' from public.award_claim_post((select v from t_ids where k = 'p_h_0510'), '00000000-0000-4000-8000-0000000f1d02') r;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a03","role":"authenticated"}';
insert into t_results (label, result) select 'Tom claims Latest out (1:15am)', r->>'status' from public.award_claim_post((select v from t_ids where k = 'p_t_0115'), null, '00000000-0000-4000-8000-0000000f1d01') r;
insert into t_results (label, result) select 'Tom claims Earliest up (5:40am)', r->>'status' from public.award_claim_post((select v from t_ids where k = 'p_t_0540'), '00000000-0000-4000-8000-0000000f1d02') r;
insert into t_results (label, result) select 'Tom claims Latest out night 2 (12:30am)', r->>'status' from public.award_claim_post((select v from t_ids where k = 'p_t_n2'), null, '00000000-0000-4000-8000-0000000f1d01') r;
insert into t_results (label, result) select 'Tom claims Earliest up night 2 (4:50am)', r->>'status' from public.award_claim_post((select v from t_ids where k = 'p_t_n2b'), '00000000-0000-4000-8000-0000000f1d02') r;
insert into t_results (label, result) select 'claims: who, when, for whom, by whom', string_agg(pg_temp.nm(n.player_id) || ' ' || private.aa_clock(n.claim_at) || ' by ' || pg_temp.nm(n.nominated_by), ', ' order by n.claim_at)
  from public.dinner_award_nominations n join public.dinner_awards a on a.id = n.award_id where a.parent_id = (select id from public.dinner_awards where rule_id = '00000000-0000-4000-8000-0000000f1d01');
insert into t_results (label, result) select 'the nights'' copies: titles', string_agg(a.title, ', ' order by a.title) from public.dinner_awards a
  where a.trip_id = '00000000-0000-4000-8000-0000000f1c01' and a.parent_id is not null;
insert into t_results (label, result) select 'runs: kind / window date / status', string_agg(r.kind || ' d0+' || (r.window_date - d0) || ' ' || r.status, ', ' order by a.title, r.window_date)
  from public.award_runs r join public.dinner_awards a on a.id = r.source_id, t_d where r.trip_id = '00000000-0000-4000-8000-0000000f1c01';
-- For a mate: Tom posts nothing — he claims Hamish's 2:47am post for Hamish (already Hamish's), and the organiser's.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a04","role":"authenticated"}';
do $$ begin
  perform public.award_claim_post((select v from t_ids where k = 'p_h_0247'), null, '00000000-0000-4000-8000-0000000f1d01', '00000000-0000-4000-8000-0000000f1b04');
  insert into t_results (label, result) values ('guest claims', 'allowed');
exception when others then insert into t_results (label, result) values ('guest claims', 'refused: ' || sqlerrm); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a05","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f200"}', true); end $$;
do $$ begin
  perform public.award_claim_post((select v from t_ids where k = 'p_h_0247'), null, '00000000-0000-4000-8000-0000000f1d01');
  insert into t_results (label, result) values ('other group claims A''s post', 'allowed');
exception when others then insert into t_results (label, result) values ('other group claims A''s post', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'other group sees A''s runs / points', (select count(*) from public.award_runs)::text || ' / ' || (select count(*) from public.cup_points)::text;
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f100"}', true); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a03","role":"authenticated"}';
do $$ begin
  insert into public.cup_points (group_id, trip_id, player_id, points, source_type, label)
  values ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f1c01', '00000000-0000-4000-8000-0000000f1b03', 50, 'award', 'Free points');
  insert into t_results (label, result) values ('player writes cup_points', 'allowed');
exception when others then insert into t_results (label, result) values ('player writes cup_points', 'refused: ' || sqlerrm); end $$;
do $$ begin
  update public.award_runs set status = 'confirmed', player_id = '00000000-0000-4000-8000-0000000f1b03';
  insert into t_results (label, result) select 'player changes a run', count(*)::text || ' confirmed' from public.award_runs where status = 'confirmed';
exception when others then insert into t_results (label, result) values ('player changes a run', 'refused: ' || sqlerrm); end $$;

-- ================= the morning: proposals =================
reset role;
insert into t_results (label, result) select 'tick at 6:30am d0+1 (nothing due)', private.auto_awards_tick(private.aa_at(d0 + 1, '06:30'))::text from t_d;
insert into t_results (label, result) select 'tick at 7:00am d0+1', private.auto_awards_tick(private.aa_at(d0 + 1, '07:00'))::text from t_d;
insert into t_results (label, result) select 'tick again at 7:05am', private.auto_awards_tick(private.aa_at(d0 + 1, '07:05'))::text from t_d;
insert into t_results (label, result) select 'proposal posts for night d0', count(*)::text from public.posts p join public.award_runs r on r.post_id = p.id, t_d
  where r.window_date = d0 and r.trip_id = '00000000-0000-4000-8000-0000000f1c01';
insert into t_results (label, result) select 'Latest out d0: proposal', proposal from public.award_runs, t_d where rule_id = '00000000-0000-4000-8000-0000000f1d01' and window_date = d0;
insert into t_results (label, result) select 'Earliest up d0: proposal', proposal from public.award_runs, t_d where source_id = '00000000-0000-4000-8000-0000000f1d02' and window_date = d0;
insert into t_results (label, result) select 'proposal post: kind / photo / link', p.kind || ' / ' || coalesce(p.photo_url, '-') || ' / ' || (p.link = '/award-run/' || r.id)::text
  from public.award_runs r join public.posts p on p.id = r.post_id, t_d where r.rule_id = '00000000-0000-4000-8000-0000000f1d01' and r.window_date = d0;
insert into t_results (label, result) select 'buzzes queued: kind × people', string_agg(kind || '×' || n, ', ') from (select kind, count(*) n from public.notify_queue q
  where q.group_id = '00000000-0000-4000-8000-00000000f100' and kind like 'award_%' group by kind) x;
insert into t_results (label, result) select 'pending points (cup / player / points / counted)', string_agg(coalesce(c.name, 'no cup') || ' ' || pg_temp.nm(cp.player_id) || ' ' || cp.points || ' ' || (cp.confirmed_at is not null)::text, ', ' order by cp.label, cp.points desc)
  from public.cup_points cp left join public.comps c on c.id = cp.comp_id where cp.trip_id = '00000000-0000-4000-8000-0000000f1c01';
do $$ begin
  perform public.award_claim_post((select v from t_ids where k = 'p_t_0115'), null, '00000000-0000-4000-8000-0000000f1d01');
  insert into t_results (label, result) values ('claim after the proposal', 'allowed');
exception when others then insert into t_results (label, result) values ('claim after the proposal', 'refused: ' || sqlerrm); end $$;

-- ================= one person's line disputed; the organiser confirms =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a03","role":"authenticated"}';
insert into t_ids select 'line_case', public.cup_points_dispute(cp.id, 'He was in bed by 1') from public.cup_points cp
  where cp.player_id = '00000000-0000-4000-8000-0000000f1b02' and cp.source_type = 'award' and cp.label like 'Latest out%';
insert into t_results (label, result) select 'line dispute: case kind / subject', kind || ' / ' || (subject_ref->>'table') || '.' || (subject_ref->>'field') from public.cases where id = (select v from t_ids where k = 'line_case');
do $$ begin
  perform public.award_run_confirm(r.id) from public.award_runs r, t_d where r.rule_id = '00000000-0000-4000-8000-0000000f1d01' and r.window_date = d0;
  insert into t_results (label, result) values ('player confirms', 'allowed');
exception when others then insert into t_results (label, result) values ('player confirms', 'refused: ' || sqlerrm); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a01","role":"authenticated"}';
insert into t_results (label, result) select 'organiser confirms Latest out d0', x::text from public.award_runs r, t_d, public.award_run_confirm(r.id) x
  where r.rule_id = '00000000-0000-4000-8000-0000000f1d01' and r.window_date = d0;
insert into t_results (label, result) select 'confirm twice', x->>'status' from public.award_runs r, t_d, public.award_run_confirm(r.id) x
  where r.rule_id = '00000000-0000-4000-8000-0000000f1d01' and r.window_date = d0;
insert into t_results (label, result) select 'Latest out d0: status / winner / how / copy''s winner', r.status || ' / ' || pg_temp.nm(r.player_id) || ' / ' || r.decided_how || ' / ' || pg_temp.nm(a.winner_id)
  from public.award_runs r join public.dinner_awards a on a.id = r.award_id, t_d where r.rule_id = '00000000-0000-4000-8000-0000000f1d01' and r.window_date = d0;
insert into t_results (label, result) select 'strokes: kind / label / strokes / round / rule set', s.kind || ' / ' || s.label || ' / ' || s.strokes || ' / ' || rd.name || ' / ' || (s.rule_id is not null)::text
  from public.score_adjustments s join public.rounds rd on rd.id = s.round_id where s.player_id = '00000000-0000-4000-8000-0000000f1b02' and s.kind = 'award';
insert into t_results (label, result) select 'Latest out d0 points: player / points / counted / disputed', string_agg(pg_temp.nm(cp.player_id) || ' ' || cp.points || ' ' || (cp.confirmed_at is not null)::text || ' ' || (cp.case_id is not null)::text, ', ' order by cp.points desc)
  from public.cup_points cp join public.award_runs r on r.id = cp.source_id, t_d where r.rule_id = '00000000-0000-4000-8000-0000000f1d01' and r.window_date = d0;
reset role;
update public.cases set status = 'passed', decided_at = now() where id = (select v from t_ids where k = 'line_case');
insert into t_results (label, result) select 'tick after the line verdict', private.auto_awards_tick(private.aa_at(d0 + 1, '07:30'))::text from t_d;
insert into t_results (label, result) select 'Hamish''s line: counted / struck out', (confirmed_at is not null)::text || ' / ' || (waived_at is not null)::text
  from public.cup_points where player_id = '00000000-0000-4000-8000-0000000f1b02' and label like 'Latest out%';

-- ================= Earliest up d0: disputed → thrown out → confirmed; then the organiser can't change it =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a03","role":"authenticated"}';
insert into t_ids select 'run_case', public.award_run_dispute(r.id, 'Hamish never slept') from public.award_runs r, t_d where r.source_id = '00000000-0000-4000-8000-0000000f1d02' and r.window_date = d0;
insert into t_results (label, result) select 'run dispute: status / case subject', r.status || ' / ' || (c.subject_ref->>'table') || '.' || (c.subject_ref->>'field')
  from public.award_runs r join public.cases c on c.id = r.case_id where c.id = (select v from t_ids where k = 'run_case');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a01","role":"authenticated"}';
do $$ begin
  perform public.award_run_confirm(r.id) from public.award_runs r, t_d where r.source_id = '00000000-0000-4000-8000-0000000f1d02' and r.window_date = d0;
  insert into t_results (label, result) values ('organiser confirms while disputed', 'allowed');
exception when others then insert into t_results (label, result) values ('organiser confirms while disputed', 'refused: ' || sqlerrm); end $$;
reset role;
insert into t_results (label, result) select 'tick at 8am while disputed (no auto-confirm)', private.auto_awards_tick(private.aa_at(d0 + 1, '08:00'))::text from t_d;
update public.cases set status = 'failed', decided_at = now() where id = (select v from t_ids where k = 'run_case');
insert into t_results (label, result) select 'tick after the dispute is thrown out', private.auto_awards_tick(private.aa_at(d0 + 1, '08:05'))::text from t_d;
insert into t_results (label, result) select 'Earliest up d0: status / winner / how', r.status || ' / ' || pg_temp.nm(r.player_id) || ' / ' || r.decided_how
  from public.award_runs r, t_d where r.source_id = '00000000-0000-4000-8000-0000000f1d02' and r.window_date = d0;
insert into t_results (label, result) select 'Earliest up d0 points (placings)', string_agg(pg_temp.nm(cp.player_id) || ' ' || cp.points || ' ' || (cp.confirmed_at is not null)::text, ', ' order by cp.points desc)
  from public.cup_points cp join public.award_runs r on r.id = cp.source_id, t_d where r.source_id = '00000000-0000-4000-8000-0000000f1d02' and r.window_date = d0;

-- ================= night d0+1: Latest out confirms itself at noon; Earliest up gets "No winner" =================
insert into t_results (label, result) select 'tick at 7am d0+2', private.auto_awards_tick(private.aa_at(d0 + 2, '07:00'))::text from t_d;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a01","role":"authenticated"}';
insert into t_results (label, result) select 'organiser: No winner for Earliest up d0+1', x->>'status' from public.award_runs r, t_d, public.award_run_no_winner(r.id) x
  where r.source_id = '00000000-0000-4000-8000-0000000f1d02' and r.window_date = d0 + 1;
insert into t_results (label, result) select 'No winner: points struck out', string_agg((cp.waived_at is not null)::text, ',') from public.cup_points cp join public.award_runs r on r.id = cp.source_id, t_d
  where r.source_id = '00000000-0000-4000-8000-0000000f1d02' and r.window_date = d0 + 1;
reset role;
insert into t_results (label, result) select 'tick at 11:55am d0+2', private.auto_awards_tick(private.aa_at(d0 + 2, '11:55'))::text from t_d;
insert into t_results (label, result) select 'tick at 12pm d0+2', private.auto_awards_tick(private.aa_at(d0 + 2, '12:00'))::text from t_d;
insert into t_results (label, result) select 'Latest out d0+1: status / winner / how / strokes', r.status || ' / ' || pg_temp.nm(r.player_id) || ' / ' || r.decided_how || ' / ' || r.adjust_state
  from public.award_runs r, t_d where r.rule_id = '00000000-0000-4000-8000-0000000f1d01' and r.window_date = d0 + 1;

-- ================= from the scores =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a03","role":"authenticated"}';
do $$ begin
  perform public.award_propose_from_scores('00000000-0000-4000-8000-0000000f1c03', '00000000-0000-4000-8000-0000000f1d03', null, '[]');
  insert into t_results (label, result) values ('from the scores before the round is finished', 'allowed');
exception when others then insert into t_results (label, result) values ('from the scores before the round is finished', 'refused: ' || sqlerrm); end $$;
insert into t_results (label, result) select 'from the scores (Day 1)', x->>'status' from public.award_propose_from_scores('00000000-0000-4000-8000-0000000f1c04', '00000000-0000-4000-8000-0000000f1d03', null,
  '[{"player_id":"00000000-0000-4000-8000-0000000f1b03","value":3,"display":"3 birdies","rank":1},{"player_id":"00000000-0000-4000-8000-0000000f1b02","value":1,"display":"1 birdie","rank":2}]') x;
insert into t_results (label, result) select 'from the scores again', x->>'status' from public.award_propose_from_scores('00000000-0000-4000-8000-0000000f1c04', '00000000-0000-4000-8000-0000000f1d03', null, '[]') x;
insert into t_results (label, result) select 'Most birdies: proposal', proposal from public.award_runs where source_id = '00000000-0000-4000-8000-0000000f1d03';
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a01","role":"authenticated"}';
insert into t_results (label, result) select 'organiser picks Hamish instead', x->>'status' || ' ' || pg_temp.nm((x->>'player')::uuid) from public.award_runs r, public.award_run_confirm(r.id, null, '00000000-0000-4000-8000-0000000f1b02') x
  where r.source_id = '00000000-0000-4000-8000-0000000f1d03';
insert into t_results (label, result) select 'Most birdies points', string_agg(pg_temp.nm(cp.player_id) || ' ' || cp.points || ' ' || (cp.confirmed_at is not null)::text, ', ')
  from public.cup_points cp join public.award_runs r on r.id = cp.source_id where r.source_id = '00000000-0000-4000-8000-0000000f1d03';

-- ================= the results: what the app reads =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f1a02","role":"authenticated"}';
insert into t_results (label, result) select 'member reads: runs / counted points', (select count(*) from public.award_runs where trip_id = '00000000-0000-4000-8000-0000000f1c01')::text
  || ' / ' || (select coalesce(sum(points), 0) from public.cup_points where trip_id = '00000000-0000-4000-8000-0000000f1c01' and confirmed_at is not null and waived_at is null)::text;
reset role;
insert into t_results (label, result) select 'the job is scheduled', schedule || ' ' || command from cron.job where jobname = 'lgc-auto-awards';
insert into t_results (label, result) select 'disputable: award_runs / cup_points / rules', array_to_string(private.dispute_fields('award_runs'), ',') || ' / ' || array_to_string(private.dispute_fields('cup_points'), ',')
  || ' / ' || (('points' = any (private.dispute_fields('rules'))))::text;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
