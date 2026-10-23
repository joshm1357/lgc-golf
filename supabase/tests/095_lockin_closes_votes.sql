-- 095 checks: locking in closes the planning votes (V1) and the usual jobs move with the dates (O7). Run on STAGING
-- only, AFTER 095_lockin_closes_votes.sql. Everything is rolled back at the end on purpose: the results come back as
-- the error message ("RESULTS: ..."), so nothing is left behind.
-- People: the staging L.G.C test organiser (Josh, ...001) and a player (Mike, ...002).
-- Expected: see 095_lockin_closes_votes.expected.txt.

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

-- Setup (as the database owner): a trip still being planned, 30 days out, with every kind of vote open, and the usual
-- jobs (as if it had been locked in once before and unlocked — the formula's jobs exist with due dates).
insert into public.plans (id, group_id, kind, name, status, start_date, end_date, created_by, organiser_id, proposed)
values ('09500000-0000-4000-8000-000000000001', 'f9e18914-24a2-43ad-8989-ca91e3d1af19', 'trip', 'Lock-in test', 'planning',
        current_date + 30, current_date + 33, '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', false);
insert into public.vote_batches (id, plan_id, title, keen, closes_on)
values ('09500000-0000-4000-8000-0000000000b1', '09500000-0000-4000-8000-000000000001', 'Where and when?', true, current_date + 3);
insert into public.plan_polls (id, plan_id, kind, question, status, purpose, vote_batch, optional, area, closes_on) values
  ('09500000-0000-4000-8000-000000000011', '09500000-0000-4000-8000-000000000001', 'dates', 'Which weekend?', 'open', null, null, false, null, current_date + 3),
  ('09500000-0000-4000-8000-000000000012', '09500000-0000-4000-8000-000000000001', 'location', 'Where should we go?', 'open', null, null, false, null, current_date + 3),
  ('09500000-0000-4000-8000-000000000013', '09500000-0000-4000-8000-000000000001', 'other', 'Where should we stay?', 'open', 'stay', null, false, null, current_date + 3),
  ('09500000-0000-4000-8000-000000000014', '09500000-0000-4000-8000-000000000001', 'other', 'How long?', 'open', null, '09500000-0000-4000-8000-0000000000b1', false, null, current_date + 3),
  ('09500000-0000-4000-8000-000000000015', '09500000-0000-4000-8000-000000000001', 'other', 'Hunter Valley: which courses?', 'open', null, '09500000-0000-4000-8000-0000000000b1', true, 'Hunter Valley', current_date + 3),
  ('09500000-0000-4000-8000-000000000016', '09500000-0000-4000-8000-000000000001', 'other', 'Shirt colour?', 'open', null, null, false, null, current_date + 3);
insert into public.plan_items (id, plan_id, kind, title, formula_key, stage, due, sort, created_by) values
  ('09500000-0000-4000-8000-0000000000e1', '09500000-0000-4000-8000-000000000001', 'job', 'Reserve accommodation', 'reserve_stay', 'todo', current_date + 10, 1, '20000000-0000-4000-8000-000000000001'),
  ('09500000-0000-4000-8000-0000000000e2', '09500000-0000-4000-8000-000000000001', 'job', 'Transport / who’s driving', 'transport', 'todo', current_date + 20, 2, '20000000-0000-4000-8000-000000000001'),
  ('09500000-0000-4000-8000-0000000000e3', '09500000-0000-4000-8000-000000000001', 'job', 'Chase deposits', 'chase_deposits', 'todo', current_date + 40, 3, '20000000-0000-4000-8000-000000000001'),
  ('09500000-0000-4000-8000-0000000000e4', '09500000-0000-4000-8000-000000000001', 'job', 'Pay the balance', 'pay_balance', 'done', current_date + 5, 4, '20000000-0000-4000-8000-000000000001'),
  ('09500000-0000-4000-8000-0000000000e5', '09500000-0000-4000-8000-000000000001', 'job', 'Buy the trophy', null, 'todo', current_date + 3, 5, '20000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------- Mike (a player) can't do either
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('mike locks it in (rows changed)', $q$with u as (update public.plans set status = 'confirmed' where id = '09500000-0000-4000-8000-000000000001' returning 1) select count(*)::text from u$q$);
select pg_temp.try('votes still open after mike', $q$select count(*)::text from public.plan_polls where plan_id = '09500000-0000-4000-8000-000000000001' and status = 'open'$q$);
reset role;

-- ---------------------------------------------------------------- Josh (organiser) locks it in
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('josh locks it in', $q$update public.plans set status = 'confirmed' where id = '09500000-0000-4000-8000-000000000001' returning status$q$);
select pg_temp.try('votes left open', $q$select string_agg(question, ', ' order by question) from public.plan_polls where plan_id = '09500000-0000-4000-8000-000000000001' and status = 'open'$q$);
select pg_temp.try('closed with no winner', $q$select count(*)::text from public.plan_polls where plan_id = '09500000-0000-4000-8000-000000000001' and status = 'closed' and winner_option_id is null$q$);
-- A vote called AFTER lock-in stays open (the trigger is only planning → locked in).
select pg_temp.try('josh calls a dates vote after lock-in', $q$insert into public.plan_polls (id, plan_id, kind, question) values ('09500000-0000-4000-8000-000000000017', '09500000-0000-4000-8000-000000000001', 'dates', 'Still good for the new dates?') returning status$q$);
select pg_temp.try('josh renames the trip', $q$update public.plans set name = 'Lock-in test 2' where id = '09500000-0000-4000-8000-000000000001' returning name$q$);
select pg_temp.try('the new vote is still open', $q$select status from public.plan_polls where id = '09500000-0000-4000-8000-000000000017'$q$);
-- O7: the trip moves a week later → the jobs move a week later (chase deposits stays inside the trip; done and
-- hand-made jobs don't move).
select pg_temp.try('josh moves it a week later', $q$update public.plans set start_date = start_date + 7, end_date = end_date + 7 where id = '09500000-0000-4000-8000-000000000001' returning (start_date - current_date)::text$q$);
select pg_temp.try('jobs after a week later', $q$select string_agg(title || ' +' || (due - current_date), ', ' order by sort) from public.plan_items where plan_id = '09500000-0000-4000-8000-000000000001'$q$);
-- Then 30 days sooner (start in a week): jobs that would land in the past are due today; nothing after the start.
select pg_temp.try('josh moves it 30 days sooner', $q$update public.plans set start_date = start_date - 30, end_date = end_date - 30 where id = '09500000-0000-4000-8000-000000000001' returning (start_date - current_date)::text$q$);
select pg_temp.try('jobs after 30 days sooner', $q$select string_agg(title || ' +' || (due - current_date), ', ' order by sort) from public.plan_items where plan_id = '09500000-0000-4000-8000-000000000001'$q$);
reset role;

-- ---------------------------------------------------------------- nobody can call the trigger functions
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.try('josh calls the function directly', $q$select private.lockin_close_votes()::text$q$);
reset role;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
