-- 094 run-up access checks. Run on STAGING only, AFTER 094_run_up.sql. Everything is rolled back at the end on
-- purpose: the results come back as the error message ("RESULTS: ..."), so nothing is left behind.
-- People: the staging L.G.C test organiser (Josh, ...001), a player (Mike, ...002) and a player in Test Group B.
-- Expected: see 094_run_up_test.expected.txt.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

-- Run one statement as whoever is signed in now; record "ok" (and the first value it returns) or the error.
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

-- Setup (as the database owner): rooms & cars on for L.G.C, a locked-in trip 20 days out, Josh and Mike in.
insert into public.group_features (group_id, feature_key, enabled) values
  ('f9e18914-24a2-43ad-8989-ca91e3d1af19', 'planner_rooms', true), ('f9e18914-24a2-43ad-8989-ca91e3d1af19', 'planner_costs', true)
  on conflict (group_id, feature_key) do update set enabled = true;
insert into public.plans (id, group_id, kind, name, status, start_date, end_date, created_by, organiser_id, proposed)
values ('09400000-0000-4000-8000-000000000001', 'f9e18914-24a2-43ad-8989-ca91e3d1af19', 'trip', 'Run-up test', 'confirmed',
        current_date + 20, current_date + 22, '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', false);
insert into public.plan_rsvps (plan_id, player_id, status) values
  ('09400000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'in'),
  ('09400000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'in');
insert into public.plan_items (id, plan_id, kind, title, created_by, bring_shared) values
  ('09400000-0000-4000-8000-0000000000b1', '09400000-0000-4000-8000-000000000001', 'bring', 'Speaker', '20000000-0000-4000-8000-000000000001', true);

-- ---------------------------------------------------------------- Mike (a player)
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('mike adds an activity', $q$insert into public.trip_activities (id, plan_id, title, cost_pp, created_by)
  values ('09400000-0000-4000-8000-0000000000a1', '09400000-0000-4000-8000-000000000001', 'Go-karts', 40, '20000000-0000-4000-8000-000000000002') returning title$q$);
select pg_temp.try('mike adds one as josh', $q$insert into public.trip_activities (plan_id, title, created_by)
  values ('09400000-0000-4000-8000-000000000001', 'Fake', '20000000-0000-4000-8000-000000000001') returning title$q$);
select pg_temp.try('mike is in', $q$insert into public.trip_activity_people (activity_id, player_id)
  values ('09400000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000002') returning player_id::text$q$);
select pg_temp.try('mike puts josh in', $q$insert into public.trip_activity_people (activity_id, player_id)
  values ('09400000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001') returning player_id::text$q$);
select pg_temp.try('kitty line after mike', $q$select amount || ' each x ' || cardinality(split_between) from public.plan_costs where activity_id = '09400000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.try('mike offers 2 seats', $q$select public.runup_offer_car('09400000-0000-4000-8000-000000000001', 2, 'Leichhardt', '6:30am Fri') is not null$q$);
select pg_temp.try('mike''s car', $q$select name || ', ' || capacity || ' seats, ' || pickup_place || ' ' || pickup_time from public.plan_groups where plan_id = '09400000-0000-4000-8000-000000000001' and kind = 'car'$q$);
select pg_temp.try('mike needs a lift row', $q$insert into public.trip_runup_people (plan_id, player_id, handicap_checked_at)
  values ('09400000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', now()) returning 'saved'$q$);
select pg_temp.try('mike writes josh''s row', $q$insert into public.trip_runup_people (plan_id, player_id, needs_lift)
  values ('09400000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', true) returning 'saved'$q$);
select pg_temp.try('mike tips josh', $q$insert into public.trip_tips (plan_id, player_id, pick_id)
  values ('09400000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001') returning 'tipped'$q$);
select pg_temp.try('mike claims the speaker', $q$select public.runup_claim_bring('09400000-0000-4000-8000-0000000000b1', true)::text$q$);
select pg_temp.try('mike edits a car directly (rows changed)', $q$with u as (update public.plan_groups set capacity = 9 where plan_id = '09400000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$);
reset role;

-- ---------------------------------------------------------------- Josh (organiser)
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('josh is in', $q$insert into public.trip_activity_people (activity_id, player_id)
  values ('09400000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001') returning player_id::text$q$);
select pg_temp.try('kitty line after josh', $q$select amount || ' each x ' || cardinality(split_between) || ' paid by mike ' || (paid_by = '20000000-0000-4000-8000-000000000002') from public.plan_costs where activity_id = '09400000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.try('josh hops in mike''s car', $q$select public.runup_join_car((select id from public.plan_groups where plan_id = '09400000-0000-4000-8000-000000000001' and kind = 'car'))::text$q$);
select pg_temp.try('car count', $q$select count(*)::text from public.plan_group_members m join public.plan_groups g on g.id = m.group_id where g.plan_id = '09400000-0000-4000-8000-000000000001'$q$);
select pg_temp.try('josh claims mike''s speaker', $q$select public.runup_claim_bring('09400000-0000-4000-8000-0000000000b1', true)::text$q$);
select pg_temp.try('speaker is mike''s', $q$select (owner_id = '20000000-0000-4000-8000-000000000002')::text from public.plan_items where id = '09400000-0000-4000-8000-0000000000b1'$q$);
reset role;

-- The trip's first tee has gone (as the owner: move it to yesterday) → tipping is closed.
update public.plans set start_date = current_date - 1 where id = '09400000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('mike changes tip after first tee', $q$update public.trip_tips set pick_id = '20000000-0000-4000-8000-000000000002' where plan_id = '09400000-0000-4000-8000-000000000001' returning 'changed'$q$);
select pg_temp.try('mike stops driving', $q$select public.runup_leave_car((select id from public.plan_groups where plan_id = '09400000-0000-4000-8000-000000000001' and kind = 'car'))::text$q$);
select pg_temp.try('josh needs a lift again', $q$select needs_lift::text from public.trip_runup_people where player_id = '20000000-0000-4000-8000-000000000001'$q$);
select pg_temp.try('mike is out of go-karts', $q$delete from public.trip_activity_people where activity_id = '09400000-0000-4000-8000-0000000000a1' and player_id = '20000000-0000-4000-8000-000000000002' returning 'out'$q$);
select pg_temp.try('kitty line after mike out', $q$select amount || ' each x ' || cardinality(split_between) from public.plan_costs where activity_id = '09400000-0000-4000-8000-0000000000a1'$q$);
reset role;

-- ---------------------------------------------------------------- Mike as a guest
update public.group_members set role = 'guest' where user_id = '10000000-0000-4000-8000-000000000002' and group_id = 'f9e18914-24a2-43ad-8989-ca91e3d1af19';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('guest reads activities', $q$select count(*)::text from public.trip_activities where plan_id = '09400000-0000-4000-8000-000000000001'$q$);
select pg_temp.try('guest adds an activity', $q$insert into public.trip_activities (plan_id, title, created_by)
  values ('09400000-0000-4000-8000-000000000001', 'Guest idea', '20000000-0000-4000-8000-000000000002') returning title$q$);
select pg_temp.try('guest offers seats', $q$select public.runup_offer_car('09400000-0000-4000-8000-000000000001', 3)::text$q$);
select pg_temp.try('guest claims a thing', $q$select public.runup_claim_bring('09400000-0000-4000-8000-0000000000b1', false)::text$q$);
reset role;

-- ---------------------------------------------------------------- Someone in another group
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('other group reads activities', $q$select count(*)::text from public.trip_activities$q$);
select pg_temp.try('other group reads tips', $q$select count(*)::text from public.trip_tips$q$);
select pg_temp.try('other group joins activity', $q$insert into public.trip_activity_people (activity_id, player_id)
  values ('09400000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000b1') returning 'in'$q$);
select pg_temp.try('other group hops in car', $q$select public.runup_join_car((select id from public.plan_groups where plan_id = '09400000-0000-4000-8000-000000000001' and kind = 'car' limit 1))::text$q$);
select pg_temp.try('other group offers seats', $q$select public.runup_offer_car('09400000-0000-4000-8000-000000000001', 3)::text$q$);
reset role;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
