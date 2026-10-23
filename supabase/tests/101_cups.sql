-- 101 test: the group's cups — the library (organisers only; guests never change one; RLS; links stay in the group),
-- up for grabs on a trip (organisers only; what counts is checked), cap tips (the allowance enforced by the database:
-- how many each, the most to one person, not to yourself, guests only if the cup allows, take back within 10 minutes,
-- each one a cup_points row), the group's name for them, organiser side activities and adjustments, another group
-- shut out. STAGING only, after 100 and 101. Self-contained test groups. Rolled back; the results come back as the
-- error message ("RESULTS: ..."). Expected answers in 101_cups.expected.txt.
-- Group A: ao — organiser, a1 (Hamish) / a2 (Tom) — players, ag — guest. Group B: bo — organiser of another group.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

create function pg_temp.try(p_label text, p_sql text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    insert into t_results (label, result) values (p_label, 'ok' || coalesce(' ' || v, ''));
  exception when others then
    insert into t_results (label, result) values (p_label, 'refused: ' || sqlerrm);
  end;
end $$;
grant execute on function pg_temp.try(text, text) to authenticated;
create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;
grant execute on function pg_temp.as_user(text) to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000f101', 'test-a101', 'Test Group A101', 'A101-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000f201', 'test-b101', 'Test Group B101', 'B101-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000001a0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000001a0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000001a0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000001a0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000001a0a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000001a0b01', '00000000-0000-4000-8000-00000000f101', 'A Organiser', 'Ao', 10),
  ('00000000-0000-4000-8000-0000001a0b02', '00000000-0000-4000-8000-00000000f101', 'A One', 'Hamish', 15),
  ('00000000-0000-4000-8000-0000001a0b03', '00000000-0000-4000-8000-00000000f101', 'A Two', 'Tom', 18),
  ('00000000-0000-4000-8000-0000001a0b04', '00000000-0000-4000-8000-00000000f101', 'A Guest', 'Gus', 25),
  ('00000000-0000-4000-8000-0000001a0b10', '00000000-0000-4000-8000-00000000f201', 'B Organiser', null, 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-0000001a0a01', '00000000-0000-4000-8000-0000001a0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-0000001a0a02', '00000000-0000-4000-8000-0000001a0b02', 'player'),
  ('00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-0000001a0a03', '00000000-0000-4000-8000-0000001a0b03', 'player'),
  ('00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-0000001a0a04', '00000000-0000-4000-8000-0000001a0b04', 'guest'),
  ('00000000-0000-4000-8000-00000000f201', '00000000-0000-4000-8000-0000001a0a05', '00000000-0000-4000-8000-0000001a0b10', 'organiser');
insert into public.trips (id, group_id, name, start_date, end_date) values
  ('00000000-0000-4000-8000-0000001a0c01', '00000000-0000-4000-8000-00000000f101', 'Hunter Trip', current_date, current_date + 2);
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000001a0c02', '00000000-0000-4000-8000-00000000f101', 'A course', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status, play_date) values
  ('00000000-0000-4000-8000-0000001a0c03', '00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-0000001a0c01',
   '00000000-0000-4000-8000-0000001a0c02', 'Day 1', 'stableford', 'setup', current_date);

-- ---------------------------------------------------------------- the organiser sets up the library and the trip
select pg_temp.as_user('00000000-0000-4000-8000-0000001a0a01');
set local role authenticated;
select pg_temp.try('organiser adds a weekend cup', $q$insert into public.cups (id, name, purpose, counts)
  values ('00000000-0000-4000-8000-0000001a0d01', 'Weekend Cup', 'social', '{"vibe":{"on":true,"post":1,"photo":2,"video":3,"daily_cap":10}}') returning purpose$q$);
select pg_temp.try('organiser adds a golf cup with no format', $q$insert into public.cups (name, purpose) values ('BD Trophy', 'golf') returning id::text$q$);
select pg_temp.try('organiser adds a golf cup (Stableford)', $q$insert into public.cups (name, purpose, format) values ('BD Trophy', 'golf', 'stableford') returning format$q$);
select pg_temp.try('organiser adds the same name twice', $q$insert into public.cups (name, purpose, format) values ('bd trophy', 'golf', 'stroke') returning format$q$);
select pg_temp.try('organiser: a made-up thing to count', $q$insert into public.cups (name, purpose, counts) values ('Odd Cup', 'social', '{"karaoke":{"on":true}}') returning id::text$q$);
select pg_temp.try('organiser: "we have a cup", held by Hamish', $q$update public.cups set has_trophy = true, held_by = '00000000-0000-4000-8000-0000001a0b02'
  where id = '00000000-0000-4000-8000-0000001a0d01' returning has_trophy::text$q$);
select pg_temp.try('organiser: held by someone in another group', $q$update public.cups set held_by = '00000000-0000-4000-8000-0000001a0b10'
  where id = '00000000-0000-4000-8000-0000001a0d01' returning 'changed'$q$);
select pg_temp.try('organiser puts the weekend cup up for grabs', $q$insert into public.comps (id, trip_id, cup_id, name, kind, settings) values
  ('00000000-0000-4000-8000-0000001a0e01', '00000000-0000-4000-8000-0000001a0c01', '00000000-0000-4000-8000-0000001a0d01', 'Weekend Cup', 'manual',
   '{"cup":"social","counts":{"awards":{"on":true},"kudos":{"on":true,"allowance":3,"per":1,"max_same":2,"guests":false},"vibe":{"on":true,"daily_cap":10},"placings":{"on":false,"scale":[5,3,1],"rounds":["00000000-0000-4000-8000-0000001a0c03"]}}}') returning settings->>'cup'$q$);
select pg_temp.try('organiser: a round from another trip counts', $q$update public.comps set settings = jsonb_set(settings, '{counts,placings,rounds}', '["00000000-0000-4000-8000-0000001a9999"]')
  where id = '00000000-0000-4000-8000-0000001a0e01' returning 'changed'$q$);
select pg_temp.try('organiser: points out of range', $q$update public.comps set settings = jsonb_set(settings, '{counts,kudos,per}', '500')
  where id = '00000000-0000-4000-8000-0000001a0e01' returning 'changed'$q$);
select pg_temp.try('organiser: a weekend cup with rounds on the comp itself', $q$update public.comps set round_ids = '{00000000-0000-4000-8000-0000001a0c03}'
  where id = '00000000-0000-4000-8000-0000001a0e01' returning 'changed'$q$);
select pg_temp.try('organiser calls them fist bumps', $q$select public.set_cap_tip_name('00000000-0000-4000-8000-00000000f101', 'fist')::text$q$);
reset role;

-- ---------------------------------------------------------------- a player
select pg_temp.as_user('00000000-0000-4000-8000-0000001a0a02');
set local role authenticated;
select pg_temp.try('player reads the cups', $q$select count(*)::text from public.cups$q$);
select pg_temp.try('player adds a cup', $q$insert into public.cups (name, purpose) values ('My Cup', 'social') returning id::text$q$);
select pg_temp.try('player changes a cup', $q$with u as (update public.cups set name = 'Hamish Cup' returning 1) select count(*)::text from u$q$);
select pg_temp.try('player ticks a cup off for the trip', $q$with u as (update public.comps set retired = true where id = '00000000-0000-4000-8000-0000001a0e01' returning 1) select count(*)::text from u$q$);
select pg_temp.try('player renames cap tips', $q$select public.set_cap_tip_name('00000000-0000-4000-8000-00000000f101', 'shout')::text$q$);
select pg_temp.try('Hamish → Tom (1)', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id, reason) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b02', '00000000-0000-4000-8000-0000001a0b03', '  Great putt  ') returning reason$q$);
select pg_temp.try('Hamish → Tom (2)', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b02', '00000000-0000-4000-8000-0000001a0b03') returning 'given'$q$);
select pg_temp.try('Hamish → Tom (3): most 2 to one person', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b02', '00000000-0000-4000-8000-0000001a0b03') returning 'given'$q$);
select pg_temp.try('Hamish → Hamish', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b02', '00000000-0000-4000-8000-0000001a0b02') returning 'given'$q$);
select pg_temp.try('Hamish gives as Tom', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b03', '00000000-0000-4000-8000-0000001a0b01') returning 'given'$q$);
select pg_temp.try('Hamish → the guest (guests off)', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b02', '00000000-0000-4000-8000-0000001a0b04') returning 'given'$q$);
select pg_temp.try('Hamish → the organiser (3 of 3)', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b02', '00000000-0000-4000-8000-0000001a0b01') returning 'given'$q$);
select pg_temp.try('Hamish: a 4th (allowance 3)', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b02', '00000000-0000-4000-8000-0000001a0b01') returning 'given'$q$);
select pg_temp.try('cap tip points (cup_points, kudos): Tom / labels', $q$select sum(points)::text || ' / ' || string_agg(label, ', ' order by label) from public.cup_points
  where source_type = 'kudos' and player_id = '00000000-0000-4000-8000-0000001a0b03'$q$);
select pg_temp.try('Hamish changes a cap tip', $q$update public.cap_tips set receiver_id = '00000000-0000-4000-8000-0000001a0b01' where giver_id = '00000000-0000-4000-8000-0000001a0b02' returning 'changed'$q$);
select pg_temp.try('Hamish takes one back (just now)', $q$with d as (delete from public.cap_tips where giver_id = '00000000-0000-4000-8000-0000001a0b02'
  and receiver_id = '00000000-0000-4000-8000-0000001a0b01' returning 1) select count(*)::text from d$q$);
select pg_temp.try('its points went with it', $q$select count(*)::text from public.cup_points where source_type = 'kudos' and player_id = '00000000-0000-4000-8000-0000001a0b01'$q$);
select pg_temp.try('player enters an adjustment', $q$select public.add_cup_points('00000000-0000-4000-8000-0000001a0e01', '00000000-0000-4000-8000-0000001a0b02', 5, 'manual', 'Because')::text$q$);
reset role;

-- Eleven minutes later (as the owner: the tips were given 11 minutes ago).
update public.cap_tips set created_at = now() - interval '11 minutes' where giver_id = '00000000-0000-4000-8000-0000001a0b02';
select pg_temp.as_user('00000000-0000-4000-8000-0000001a0a02');
set local role authenticated;
select pg_temp.try('Hamish takes one back after 10 minutes', $q$with d as (delete from public.cap_tips where giver_id = '00000000-0000-4000-8000-0000001a0b02' returning 1) select count(*)::text from d$q$);
reset role;

-- ---------------------------------------------------------------- the guest
select pg_temp.as_user('00000000-0000-4000-8000-0000001a0a04');
set local role authenticated;
select pg_temp.try('guest reads the cups', $q$select count(*)::text from public.cups$q$);
select pg_temp.try('guest adds a cup', $q$insert into public.cups (name, purpose) values ('Guest Cup', 'social') returning id::text$q$);
select pg_temp.try('guest changes a cup', $q$with u as (update public.cups set name = 'Gus Cup' returning 1) select count(*)::text from u$q$);
select pg_temp.try('guest puts a cup up for grabs', $q$insert into public.comps (trip_id, cup_id, name, kind) values ('00000000-0000-4000-8000-0000001a0c01',
  '00000000-0000-4000-8000-0000001a0d01', 'Weekend Cup', 'manual') returning 'on'$q$);
select pg_temp.try('guest gives a cap tip (guests off)', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b04', '00000000-0000-4000-8000-0000001a0b02') returning 'given'$q$);
reset role;

-- ---------------------------------------------------------------- the organiser: guests on, activities, adjustments
select pg_temp.as_user('00000000-0000-4000-8000-0000001a0a01');
set local role authenticated;
select pg_temp.try('organiser lets guests in', $q$update public.comps set settings = jsonb_set(settings, '{counts,kudos,guests}', 'true')
  where id = '00000000-0000-4000-8000-0000001a0e01' returning 'changed'$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000001a0a04');
set local role authenticated;
select pg_temp.try('guest gives a cap tip (guests on)', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b04', '00000000-0000-4000-8000-0000001a0b02') returning 'given'$q$);
select pg_temp.try('its label uses the group''s name', $q$select label from public.cup_points where source_type = 'kudos' and player_id = '00000000-0000-4000-8000-0000001a0b02'$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000001a0a01');
set local role authenticated;
select pg_temp.try('organiser: go-karts 1st', $q$select (public.add_cup_points('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b03', 3, 'activity', 'Go-karts 1st') is not null)::text$q$);
select pg_temp.try('… written as a confirmed cup_points row', $q$select string_agg(label || ' ' || points::text || ' ' || source_type || ' ' || (confirmed_at is not null)::text, ', ')
  from public.cup_points where source_type = 'activity'$q$);
select pg_temp.try('organiser: an adjustment with no reason', $q$select public.add_cup_points('00000000-0000-4000-8000-0000001a0e01', '00000000-0000-4000-8000-0000001a0b03', -2, 'manual', ' ')::text$q$);
select pg_temp.try('organiser: an adjustment for another group''s player', $q$select public.add_cup_points('00000000-0000-4000-8000-0000001a0e01', '00000000-0000-4000-8000-0000001a0b10', -2, 'manual', 'Sledging')::text$q$);
select pg_temp.try('organiser: takes the go-karts back', $q$select public.waive_cup_points((select id from public.cup_points where label = 'Go-karts 1st'))::text$q$);
select pg_temp.try('organiser: can''t waive a cap tip here', $q$select public.waive_cup_points((select id from public.cup_points where source_type = 'kudos' limit 1))::text$q$);
select pg_temp.try('organiser turns cap tips off', $q$update public.comps set settings = jsonb_set(settings, '{counts,kudos,on}', 'false')
  where id = '00000000-0000-4000-8000-0000001a0e01' returning 'changed'$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000001a0a03');
set local role authenticated;
select pg_temp.try('Tom gives one (cap tips off)', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b03', '00000000-0000-4000-8000-0000001a0b02') returning 'given'$q$);
select pg_temp.try('player reads the cup''s points', $q$select count(*)::text from public.cup_points where comp_id = '00000000-0000-4000-8000-0000001a0e01'$q$);
reset role;

-- ---------------------------------------------------------------- another group
select pg_temp.as_user('00000000-0000-4000-8000-0000001a0a05');
set local role authenticated;
select pg_temp.try('other group reads our cups / cap tips', $q$select (select count(*) from public.cups where group_id = '00000000-0000-4000-8000-00000000f101')::text
  || ' / ' || (select count(*) from public.cap_tips where group_id = '00000000-0000-4000-8000-00000000f101')::text$q$);
select pg_temp.try('other group changes our cup', $q$with u as (update public.cups set name = 'Stolen' where group_id = '00000000-0000-4000-8000-00000000f101' returning 1) select count(*)::text from u$q$);
select pg_temp.try('other group gives on our cup', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000001a0e01',
  '00000000-0000-4000-8000-0000001a0b10', '00000000-0000-4000-8000-0000001a0b02') returning 'given'$q$);
select pg_temp.try('other group adds points on our cup', $q$select public.add_cup_points('00000000-0000-4000-8000-0000001a0e01', '00000000-0000-4000-8000-0000001a0b02', 5, 'manual', 'Bribe')::text$q$);
reset role;

insert into t_results (label, result) select 'cap tips left in the table', count(*)::text from public.cap_tips where comp_id = '00000000-0000-4000-8000-0000001a0e01';
insert into t_results (label, result) select 'the group calls them', cap_tip_name from public.groups where id = '00000000-0000-4000-8000-00000000f101';

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
