-- Stage 1b test: trips, votes, discussion, who decides, lock-in, notification settings. STAGING only, after 025.
-- Everything is rolled back; the results come back as the error message ("RESULTS: ..."). Expected answers are in
-- stage1b_trips.expected.txt.
--
-- Two new groups: C and D. People:
--   co — C organiser (admin)   c1 — C player who suggests the trip   c2 — C player   d1 — D player

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000c000', 'test-c', 'Test Group C', 'c-pin-1234', 'c-admin-1234'),
  ('00000000-0000-4000-8000-00000000d000', 'test-d', 'Test Group D', 'd-pin-1234', 'd-admin-1234');
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000000c0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000c0b01', '00000000-0000-4000-8000-00000000c000', 'C Organiser', 10),
  ('00000000-0000-4000-8000-0000000c0b02', '00000000-0000-4000-8000-00000000c000', 'C One', 15),
  ('00000000-0000-4000-8000-0000000c0b03', '00000000-0000-4000-8000-00000000c000', 'C Two', 20),
  ('00000000-0000-4000-8000-0000000d0b01', '00000000-0000-4000-8000-00000000d000', 'D One', 18);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000c000', '00000000-0000-4000-8000-0000000c0a01', '00000000-0000-4000-8000-0000000c0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000c000', '00000000-0000-4000-8000-0000000c0a02', '00000000-0000-4000-8000-0000000c0b02', 'player'),
  ('00000000-0000-4000-8000-00000000c000', '00000000-0000-4000-8000-0000000c0a03', '00000000-0000-4000-8000-0000000c0b03', 'player'),
  ('00000000-0000-4000-8000-00000000d000', '00000000-0000-4000-8000-0000000d0a01', '00000000-0000-4000-8000-0000000d0b01', 'player');
-- C's current trip, for the "starts on its first day" check.
insert into public.trips (id, group_id, name, status) values ('00000000-0000-4000-8000-0000000c0c01', '00000000-0000-4000-8000-00000000c000', 'C old trip', 'active');

-- ================= c1 suggests a trip =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0a02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000c000"}', true); end $$;

insert into public.plans (id, kind, name, status, proposed, created_by, organiser_id, budget_pp)
values ('00000000-0000-4000-8000-0000000c0d01', 'trip', 'C autumn trip', 'planning', true,
        '00000000-0000-4000-8000-0000000c0b02', '00000000-0000-4000-8000-0000000c0b03', 600);
insert into t_results (label, result)
  select 'suggester is the organiser (cannot name someone else)', (organiser_id = '00000000-0000-4000-8000-0000000c0b02')::text
  from public.plans where id = '00000000-0000-4000-8000-0000000c0d01';

insert into t_results (label, result) values ('suggester opens votes', public.start_trip_votes(
  '00000000-0000-4000-8000-0000000c0d01',
  '[{"start_date":"2031-03-14","end_date":"2031-03-16"},{"start_date":"2031-03-21","end_date":"2031-03-23"},{"label":"Sometime in April"}]',
  '[{"label":"Port Macquarie","cost_pp":450},{"label":"Mudgee"}]', null)::text);
insert into t_results (label, result)
  select 'votes and options made', count(distinct p.id) || ' votes, ' || count(o.id) || ' options'
  from public.plan_polls p left join public.plan_options o on o.poll_id = p.id where p.plan_id = '00000000-0000-4000-8000-0000000c0d01';
insert into t_results (label, result) values ('opening again makes no more', public.start_trip_votes(
  '00000000-0000-4000-8000-0000000c0d01', '[{"start_date":"2031-05-01"}]', '[{"label":"Orange"}]', null)::text);

update public.plans set organiser_id = '00000000-0000-4000-8000-0000000c0b03', name = 'C autumn trip!' where id = '00000000-0000-4000-8000-0000000c0d01';
insert into t_results (label, result)
  select 'suggester edits but cannot hand over organiser', name || ' / ' || (organiser_id = '00000000-0000-4000-8000-0000000c0b02')::text
  from public.plans where id = '00000000-0000-4000-8000-0000000c0d01';

insert into public.plan_comments (plan_id, body) values ('00000000-0000-4000-8000-0000000c0d01', 'Port Mac every time');
insert into t_results (label, result)
  select 'comment lands in group C as me', (group_id = '00000000-0000-4000-8000-00000000c000' and player_id = '00000000-0000-4000-8000-0000000c0b02')::text
  from public.plan_comments where body = 'Port Mac every time';

insert into public.notify_prefs (group_id, mode, digest_hour) values ('00000000-0000-4000-8000-00000000c000', 'digest', 7);
insert into t_results (label, result) select 'my notification setting', mode || ' at ' || digest_hour from public.notify_prefs;
do $$ begin
  insert into public.notify_prefs (group_id, user_id, mode) values ('00000000-0000-4000-8000-00000000c000', '00000000-0000-4000-8000-0000000c0a03', 'important');
  insert into t_results (label, result) values ('set someone else''s notifications', 'ok');
exception when others then insert into t_results (label, result) values ('set someone else''s notifications', 'refused'); end $$;
do $$ begin
  insert into public.notify_prefs (group_id, mode) values ('00000000-0000-4000-8000-00000000d000', 'digest');
  insert into t_results (label, result) values ('notification setting for a group not mine', 'ok');
exception when others then insert into t_results (label, result) values ('notification setting for a group not mine', 'refused'); end $$;
do $$ declare n int; begin
  select count(*) into n from public.notify_queue;
  insert into t_results (label, result) values ('read the digest queue', n::text);
exception when others then insert into t_results (label, result) values ('read the digest queue', 'refused'); end $$;

-- With the default "admin decides", the organiser can't pick a winner.
do $$ begin
  perform public.decide_poll(p.id, (select o.id from public.plan_options o where o.poll_id = p.id order by o.start_date nulls last limit 1), true)
  from public.plan_polls p where p.plan_id = '00000000-0000-4000-8000-0000000c0d01' and p.kind = 'dates';
  insert into t_results (label, result) values ('admin-only: organiser picks dates', 'ok');
exception when others then insert into t_results (label, result) values ('admin-only: organiser picks dates', 'refused'); end $$;
do $$ begin
  perform public.set_vote_decider('00000000-0000-4000-8000-00000000c000', 'admin_or_organiser');
  insert into t_results (label, result) values ('player changes who decides', 'ok');
exception when others then insert into t_results (label, result) values ('player changes who decides', 'refused'); end $$;
insert into t_results (label, result) values ('can_decide (admin only)', public.can_decide('00000000-0000-4000-8000-0000000c0d01')::text);

-- ================= c2 — another C player =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0a03","role":"authenticated"}';
do $$ begin
  perform public.start_trip_votes('00000000-0000-4000-8000-0000000c0d01', '[]', '[{"label":"Orange"}]', null);
  insert into t_results (label, result) values ('another player opens the votes', 'ok');
exception when others then insert into t_results (label, result) values ('another player opens the votes', 'refused'); end $$;
insert into public.plan_options (poll_id, label)
  select id, 'Orange' from public.plan_polls where plan_id = '00000000-0000-4000-8000-0000000c0d01' and kind = 'location';
insert into t_results (label, result)
  select 'anyone adds a place option', count(*)::text from public.plan_options o join public.plan_polls p on p.id = o.poll_id
  where p.plan_id = '00000000-0000-4000-8000-0000000c0d01' and p.kind = 'location';
insert into t_results (label, result) select 'c2 sees the discussion', count(*)::text from public.plan_comments;
insert into t_results (label, result) select 'c2 sees only own notification settings', count(*)::text from public.notify_prefs;

-- ================= d1 — group D =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000d0a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
insert into t_results (label, result)
  select 'D sees C trip / votes / options / comments / settings',
    (select count(*) from public.plans where group_id = '00000000-0000-4000-8000-00000000c000') || '/' ||
    (select count(*) from public.plan_polls where group_id = '00000000-0000-4000-8000-00000000c000') || '/' ||
    (select count(*) from public.plan_options where group_id = '00000000-0000-4000-8000-00000000c000') || '/' ||
    (select count(*) from public.plan_comments) || '/' || (select count(*) from public.notify_prefs);
do $$ begin
  insert into public.plan_comments (plan_id, body) values ('00000000-0000-4000-8000-0000000c0d01', 'sneaky');
  insert into t_results (label, result) values ('D comments on C trip', 'ok');
exception when others then insert into t_results (label, result) values ('D comments on C trip', 'refused'); end $$;
do $$ begin
  perform public.start_trip_votes('00000000-0000-4000-8000-0000000c0d01', '[{"label":"x"}]', '[]', null);
  insert into t_results (label, result) values ('D opens C votes', 'ok');
exception when others then insert into t_results (label, result) values ('D opens C votes', 'refused'); end $$;
insert into t_results (label, result) values ('D can_decide on C trip', public.can_decide('00000000-0000-4000-8000-0000000c0d01')::text);
do $$ begin
  perform public.set_vote_decider('00000000-0000-4000-8000-00000000c000', 'admin_or_organiser');
  insert into t_results (label, result) values ('D changes C setting', 'ok');
exception when others then insert into t_results (label, result) values ('D changes C setting', 'refused'); end $$;

-- ================= co — C admin: allows organisers to decide =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000c000"}', true); end $$;
select public.set_vote_decider('00000000-0000-4000-8000-00000000c000', 'admin_or_organiser');
insert into t_results (label, result) select 'admin sets who decides', vote_decider from public.groups where id = '00000000-0000-4000-8000-00000000c000';

-- ================= c1 — organiser now picks the dates =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0a02","role":"authenticated"}';
insert into t_results (label, result) values ('can_decide (admin or organiser)', public.can_decide('00000000-0000-4000-8000-0000000c0d01')::text);
select public.decide_poll(p.id, (select o.id from public.plan_options o where o.poll_id = p.id order by o.start_date nulls last limit 1), true)
  from public.plan_polls p where p.plan_id = '00000000-0000-4000-8000-0000000c0d01' and p.kind = 'dates';
insert into t_results (label, result)
  select 'organiser picks dates → trip dates', start_date || '..' || end_date from public.plans where id = '00000000-0000-4000-8000-0000000c0d01';
-- The same pick again (a retry) is fine; a different pick on a closed vote isn't.
do $$ begin
  perform public.decide_poll(p.id, p.winner_option_id, true) from public.plan_polls p where p.plan_id = '00000000-0000-4000-8000-0000000c0d01' and p.kind = 'dates';
  insert into t_results (label, result) values ('retry the same pick', 'ok');
exception when others then insert into t_results (label, result) values ('retry the same pick', 'refused'); end $$;
do $$ begin
  perform public.decide_poll(p.id, (select o.id from public.plan_options o where o.poll_id = p.id and o.id <> p.winner_option_id limit 1), true)
  from public.plan_polls p where p.plan_id = '00000000-0000-4000-8000-0000000c0d01' and p.kind = 'dates';
  insert into t_results (label, result) values ('change a decided vote', 'ok');
exception when others then insert into t_results (label, result) values ('change a decided vote', 'refused'); end $$;

-- ================= c2 — not the organiser, still can't =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0a03","role":"authenticated"}';
do $$ begin
  perform public.decide_poll(p.id, (select o.id from public.plan_options o where o.poll_id = p.id limit 1), true)
  from public.plan_polls p where p.plan_id = '00000000-0000-4000-8000-0000000c0d01' and p.kind = 'location';
  insert into t_results (label, result) values ('non-organiser picks place', 'ok');
exception when others then insert into t_results (label, result) values ('non-organiser picks place', 'refused'); end $$;

-- ================= co — admin picks the place, approves, locks it in =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c0a01","role":"authenticated"}';
select public.decide_poll(p.id, (select o.id from public.plan_options o where o.poll_id = p.id and o.label = 'Port Macquarie'), true)
  from public.plan_polls p where p.plan_id = '00000000-0000-4000-8000-0000000c0d01' and p.kind = 'location';
insert into t_results (label, result) select 'admin picks place', location_name from public.plans where id = '00000000-0000-4000-8000-0000000c0d01';
update public.plans set proposed = false where id = '00000000-0000-4000-8000-0000000c0d01';
insert into t_results (label, result) select 'approved, not locked: no trip yet', (trip_id is null)::text from public.plans where id = '00000000-0000-4000-8000-0000000c0d01';
update public.plans set status = 'confirmed' where id = '00000000-0000-4000-8000-0000000c0d01';
update public.plans set status = 'confirmed', brief = 'retry' where id = '00000000-0000-4000-8000-0000000c0d01';
insert into t_results (label, result)
  select 'lock-in makes the trip once', count(*) || ' trip, ' || min(t.status) || ', ' || min(t.start_date)::text
  from public.trips t where t.name = 'C autumn trip!';
update public.plans set start_date = '2031-03-15', end_date = '2031-03-17' where id = '00000000-0000-4000-8000-0000000c0d01';
insert into t_results (label, result) select 'date change follows to the trip', start_date || '..' || end_date from public.trips where name = 'C autumn trip!';
update public.plans set organiser_id = '00000000-0000-4000-8000-0000000c0b03' where id = '00000000-0000-4000-8000-0000000c0d01';
insert into t_results (label, result) select 'admin hands over organiser', (organiser_id = '00000000-0000-4000-8000-0000000c0b03')::text from public.plans where id = '00000000-0000-4000-8000-0000000c0d01';
-- Scoring on the trip made at lock-in works as today.
insert into public.courses (id, name, holes) values ('00000000-0000-4000-8000-0000000c0e01', 'C links', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, trip_id, course_id, name, format, status)
  select '00000000-0000-4000-8000-0000000c0e02', trip_id, '00000000-0000-4000-8000-0000000c0e01', 'C round 1', 'stableford', 'live'
  from public.plans where id = '00000000-0000-4000-8000-0000000c0d01';
insert into public.scores (round_id, subject_id, subject_type, hole, strokes)
  values ('00000000-0000-4000-8000-0000000c0e02', '00000000-0000-4000-8000-0000000c0b02', 'player', 1, 3);
insert into t_results (label, result) select 'score on the locked-in trip (birdie post in group C)', count(*)::text
  from public.posts where round_id = '00000000-0000-4000-8000-0000000c0e02' and group_id = '00000000-0000-4000-8000-00000000c000';
-- An old phone: the admin plans something with dates and sets it straight to Locked in.
insert into public.plans (id, kind, name, status, start_date) values ('00000000-0000-4000-8000-0000000c0d02', 'round', 'C xmas round', 'confirmed', (now() at time zone 'Australia/Sydney')::date);
insert into t_results (label, result) select 'old-phone lock-in makes the trip', (trip_id is not null)::text from public.plans where id = '00000000-0000-4000-8000-0000000c0d02';
-- A long weekend that started yesterday (the midnight job missed it) — the xmas round falls inside it.
insert into public.plans (id, kind, name, status, start_date, end_date) values ('00000000-0000-4000-8000-0000000c0d04', 'trip', 'C long weekend', 'confirmed',
  (now() at time zone 'Australia/Sydney')::date - 1, (now() at time zone 'Australia/Sydney')::date + 1);
-- An old phone's "Set it up in the app" after lock-in: it makes its own trip and links it; the empty one goes.
insert into public.plans (id, kind, name, status, start_date) values ('00000000-0000-4000-8000-0000000c0d05', 'trip', 'C spring', 'confirmed', '2031-09-01');
insert into public.trips (id, name, start_date, status) values ('00000000-0000-4000-8000-0000000c0c05', 'C spring (old phone)', '2031-09-01', 'locked');
update public.plans set trip_id = '00000000-0000-4000-8000-0000000c0c05' where id = '00000000-0000-4000-8000-0000000c0d05';
insert into t_results (label, result) select 'old-phone setup after lock-in: trips for it', count(*)::text from public.trips where name like 'C spring%';
-- A finished trip from a fortnight ago.
insert into public.plans (id, kind, name, status, start_date, end_date) values ('00000000-0000-4000-8000-0000000c0d03', 'trip', 'C winter trip', 'confirmed', current_date - 16, current_date - 14);

-- ================= the scheduler =================
reset role;
select private.trips_daily();
insert into t_results (label, result)
  select 'missed first day: long weekend is current / round inside it / old trip',
    (select status from public.trips where id = (select trip_id from public.plans where id = '00000000-0000-4000-8000-0000000c0d04')) || ' / ' ||
    (select status from public.trips where id = (select trip_id from public.plans where id = '00000000-0000-4000-8000-0000000c0d02')) || ' / ' ||
    (select status from public.trips where id = '00000000-0000-4000-8000-0000000c0c01');
insert into t_results (label, result) select 'a week after: Done', status from public.plans where id = '00000000-0000-4000-8000-0000000c0d03';
insert into t_results (label, result) select 'future trip untouched', p.status || ' / ' || t.status
  from public.plans p join public.trips t on t.id = p.trip_id where p.id = '00000000-0000-4000-8000-0000000c0d01';

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
