-- 096 access checks: the trip's organiser ticks off (or removes) money paid in for THEIR trip — nothing more.
-- Run on STAGING only, AFTER 096_trip_page_money.sql. Everything is rolled back at the end on purpose: the results come
-- back as the error message ("RESULTS: ..."), so nothing is left behind.
-- People (as in 094's test): the staging L.G.C group organiser (Josh, ...001) and a player (Mike, ...002) who organises
-- one trip, and someone in Test Group B (...d1). Expected: see 096_trip_page_money_test.expected.txt.

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

-- Setup (as the database owner): costs on for L.G.C; trip A organised by Mike, trip B organised by Josh.
insert into public.group_features (group_id, feature_key, enabled) values
  ('f9e18914-24a2-43ad-8989-ca91e3d1af19', 'planner_costs', true)
  on conflict (group_id, feature_key) do update set enabled = true;
insert into public.plans (id, group_id, kind, name, status, start_date, end_date, created_by, organiser_id, proposed, deposit_pp) values
  ('09600000-0000-4000-8000-00000000000a', 'f9e18914-24a2-43ad-8989-ca91e3d1af19', 'trip', 'Mike''s trip', 'confirmed',
   current_date + 30, current_date + 32, '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', false, 200),
  ('09600000-0000-4000-8000-00000000000b', 'f9e18914-24a2-43ad-8989-ca91e3d1af19', 'trip', 'Josh''s trip', 'confirmed',
   current_date + 40, current_date + 42, '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', false, 200);
-- Josh pays Mike's trip $200 (money paid in: no to_id), twice (one to tick off, one to remove); Josh also pays trip B.
insert into public.plan_transfers (id, plan_id, from_id, to_id, amount, confirmed, created_by) values
  ('09600000-0000-4000-8000-00000000f001', '09600000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000001', null, 200, false, '20000000-0000-4000-8000-000000000001'),
  ('09600000-0000-4000-8000-00000000f002', '09600000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000001', null, 50, false, '20000000-0000-4000-8000-000000000001'),
  ('09600000-0000-4000-8000-00000000f003', '09600000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-000000000001', null, 200, false, '20000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------- Mike: a player who organises trip A
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('mike ticks off money paid in to his trip (rows)', $q$with u as (update public.plan_transfers set confirmed = true where id = '09600000-0000-4000-8000-00000000f001' returning 1) select count(*)::text from u$q$);
select pg_temp.try('it is ticked off', $q$select confirmed::text from public.plan_transfers where id = '09600000-0000-4000-8000-00000000f001'$q$);
select pg_temp.try('mike tries to change the amount (stays 200)', $q$with u as (update public.plan_transfers set amount = 1, confirmed = true where id = '09600000-0000-4000-8000-00000000f001' returning amount) select min(amount)::text from u$q$);
select pg_temp.try('mike removes a payment that never came (rows)', $q$with d as (delete from public.plan_transfers where id = '09600000-0000-4000-8000-00000000f002' returning 1) select count(*)::text from d$q$);
select pg_temp.try('mike ticks off josh''s trip B payment (rows)', $q$with u as (update public.plan_transfers set confirmed = true where id = '09600000-0000-4000-8000-00000000f003' returning 1) select count(*)::text from u$q$);
select pg_temp.try('mike removes josh''s trip B payment (rows)', $q$with d as (delete from public.plan_transfers where id = '09600000-0000-4000-8000-00000000f003' returning 1) select count(*)::text from d$q$);
select pg_temp.try('mike records his own payment as confirmed', $q$insert into public.plan_transfers (plan_id, from_id, to_id, amount, confirmed, created_by)
  values ('09600000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000002', null, 200, true, '20000000-0000-4000-8000-000000000002') returning 'saved'$q$);
reset role;

-- ---------------------------------------------------------------- Josh: the group's organiser (as before 096)
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('josh ticks off trip B (rows)', $q$with u as (update public.plan_transfers set confirmed = true where id = '09600000-0000-4000-8000-00000000f003' returning 1) select count(*)::text from u$q$);
reset role;

-- ---------------------------------------------------------------- Someone in another group
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('other group ticks off (rows)', $q$with u as (update public.plan_transfers set confirmed = false where plan_id = '09600000-0000-4000-8000-00000000000a' returning 1) select count(*)::text from u$q$);
select pg_temp.try('other group reads them', $q$select count(*)::text from public.plan_transfers where plan_id in ('09600000-0000-4000-8000-00000000000a', '09600000-0000-4000-8000-00000000000b')$q$);
reset role;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
