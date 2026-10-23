-- 104 test: co-organisers. The organiser names up to 3 players as co-organisers of one trip; on THAT trip they can do
-- what an organiser can (the trip builder, calling and closing votes, jobs, money, lock it in, call it off); on another
-- trip they can't; a player who isn't one can't; a guest can't be one; another group is shut out.
-- STAGING only, after 104. Self-contained test groups. Rolled back; the results come back as the error message
-- ("RESULTS: ..."). Expected answers in 104_coorganisers.expected.txt.
-- Group A: ao — organiser, a1 (Hamish) — named co-organiser, a2 (Tom) — a player, ag — guest. Group B: bo.

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
  ('00000000-0000-4000-8000-00000000f104', 'test-a104', 'Test Group A104', 'A104-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000f204', 'test-b104', 'Test Group B104', 'B104-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000004a0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000004a0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000004a0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000004a0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000004a0a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000004a0b01', '00000000-0000-4000-8000-00000000f104', 'A Organiser', 'Ao', 10),
  ('00000000-0000-4000-8000-0000004a0b02', '00000000-0000-4000-8000-00000000f104', 'A One', 'Hamish', 15),
  ('00000000-0000-4000-8000-0000004a0b03', '00000000-0000-4000-8000-00000000f104', 'A Two', 'Tom', 18),
  ('00000000-0000-4000-8000-0000004a0b04', '00000000-0000-4000-8000-00000000f104', 'A Guest', 'Gus', 25),
  ('00000000-0000-4000-8000-0000004a0b10', '00000000-0000-4000-8000-00000000f204', 'B Organiser', null, 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f104', '00000000-0000-4000-8000-0000004a0a01', '00000000-0000-4000-8000-0000004a0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f104', '00000000-0000-4000-8000-0000004a0a02', '00000000-0000-4000-8000-0000004a0b02', 'player'),
  ('00000000-0000-4000-8000-00000000f104', '00000000-0000-4000-8000-0000004a0a03', '00000000-0000-4000-8000-0000004a0b03', 'player'),
  ('00000000-0000-4000-8000-00000000f104', '00000000-0000-4000-8000-0000004a0a04', '00000000-0000-4000-8000-0000004a0b04', 'guest'),
  ('00000000-0000-4000-8000-00000000f204', '00000000-0000-4000-8000-0000004a0a05', '00000000-0000-4000-8000-0000004a0b10', 'organiser');
insert into public.group_features (group_id, feature_key, enabled) values ('00000000-0000-4000-8000-00000000f104', 'trip_finder', true);
-- Two trips being planned (made by the organiser) and a job on the first one made by the organiser.
insert into public.plans (id, group_id, kind, name, status, created_by, organiser_id, proposed) values
  ('00000000-0000-4000-8000-0000004a0c01', '00000000-0000-4000-8000-00000000f104', 'trip', 'March trip', 'planning', '00000000-0000-4000-8000-0000004a0b01', '00000000-0000-4000-8000-0000004a0b01', false),
  ('00000000-0000-4000-8000-0000004a0c02', '00000000-0000-4000-8000-00000000f104', 'trip', 'Spring trip', 'planning', '00000000-0000-4000-8000-0000004a0b01', '00000000-0000-4000-8000-0000004a0b01', false);
insert into public.plan_items (id, plan_id, kind, title, created_by, formula_key) values
  ('00000000-0000-4000-8000-0000004a0e01', '00000000-0000-4000-8000-0000004a0c01', 'job', 'Book the bus', '00000000-0000-4000-8000-0000004a0b01', null);

-- ---------------------------------------------------------------- the organiser names co-organisers
select pg_temp.as_user('00000000-0000-4000-8000-0000004a0a01');
set local role authenticated;
select pg_temp.try('organiser names Hamish on the March trip', $q$insert into public.plan_coorganisers (plan_id, player_id) values ('00000000-0000-4000-8000-0000004a0c01', '00000000-0000-4000-8000-0000004a0b02') returning (group_id = '00000000-0000-4000-8000-00000000f104')::text$q$);
select pg_temp.try('organiser names the guest', $q$insert into public.plan_coorganisers (plan_id, player_id) values ('00000000-0000-4000-8000-0000004a0c01', '00000000-0000-4000-8000-0000004a0b04') returning 1$q$);
select pg_temp.try('organiser names another group''s player', $q$insert into public.plan_coorganisers (plan_id, player_id) values ('00000000-0000-4000-8000-0000004a0c01', '00000000-0000-4000-8000-0000004a0b10') returning 1$q$);
reset role;

-- ---------------------------------------------------------------- Tom (a player) can't name anyone or change the trip
select pg_temp.as_user('00000000-0000-4000-8000-0000004a0a03');
set local role authenticated;
select pg_temp.try('tom names himself', $q$insert into public.plan_coorganisers (plan_id, player_id) values ('00000000-0000-4000-8000-0000004a0c01', '00000000-0000-4000-8000-0000004a0b03') returning 1$q$);
select pg_temp.try('tom sees the co-organisers', $q$select count(*)::text from public.plan_coorganisers where plan_id = '00000000-0000-4000-8000-0000004a0c01'$q$);
select pg_temp.try('tom writes the trip builder', $q$insert into public.trip_builds (plan_id, state) values ('00000000-0000-4000-8000-0000004a0c01', '{"region":"Tom"}') returning 1$q$);
select pg_temp.try('tom renames the trip (rows)', $q$with u as (update public.plans set name = 'Tom''s trip' where id = '00000000-0000-4000-8000-0000004a0c01' returning 1) select count(*)::text from u$q$);
select pg_temp.try('tom can decide', $q$select public.can_decide('00000000-0000-4000-8000-0000004a0c01')::text$q$);
reset role;

-- ---------------------------------------------------------------- Hamish (co-organiser) plans the March trip
select pg_temp.as_user('00000000-0000-4000-8000-0000004a0a02');
set local role authenticated;
select pg_temp.try('hamish writes the trip builder', $q$insert into public.trip_builds (plan_id, state) values ('00000000-0000-4000-8000-0000004a0c01', '{"region":"Hunter Valley"}') returning state ->> 'region'$q$);
select pg_temp.try('hamish changes it', $q$update public.trip_builds set state = '{"region":"South Coast"}' where plan_id = '00000000-0000-4000-8000-0000004a0c01' returning state ->> 'region'$q$);
select pg_temp.try('hamish calls a When? vote card', $q$insert into public.vote_batches (id, plan_id, title, keen, closes_on) values ('00000000-0000-4000-8000-0000004a0d01', '00000000-0000-4000-8000-0000004a0c01', 'When?', false, current_date + 3) returning title$q$);
select pg_temp.try('hamish adds its vote', $q$insert into public.plan_polls (id, plan_id, kind, question, vote_batch, closes_on) values ('00000000-0000-4000-8000-0000004a0d02', '00000000-0000-4000-8000-0000004a0c01', 'dates', 'Which weekend?', '00000000-0000-4000-8000-0000004a0d01', current_date + 3) returning status$q$);
select pg_temp.try('hamish adds two weekends', $q$with i as (insert into public.plan_options (id, poll_id, label, start_date, end_date) values
  ('00000000-0000-4000-8000-0000004a0d03', '00000000-0000-4000-8000-0000004a0d02', 'Fri 12 – Sun 14 Mar', '2027-03-12', '2027-03-14'),
  ('00000000-0000-4000-8000-0000004a0d04', '00000000-0000-4000-8000-0000004a0d02', 'Fri 19 – Sun 21 Mar', '2027-03-19', '2027-03-21') returning 1) select count(*)::text from i$q$);
select pg_temp.try('hamish can decide', $q$select public.can_decide('00000000-0000-4000-8000-0000004a0c01')::text$q$);
select pg_temp.try('hamish closes it with a winner', $q$update public.plan_polls set status = 'closed', winner_option_id = '00000000-0000-4000-8000-0000004a0d03' where id = '00000000-0000-4000-8000-0000004a0d02' returning status$q$);
select pg_temp.try('hamish renames an organiser''s option', $q$update public.plan_options set label = 'Fri 12 – Mon 15 Mar' where id = '00000000-0000-4000-8000-0000004a0d04' returning label$q$);
select pg_temp.try('hamish edits the organiser''s job (not claimed)', $q$update public.plan_items set title = 'Book the minibus', due = current_date + 9 where id = '00000000-0000-4000-8000-0000004a0e01' returning title || ' / owner ' || coalesce(owner_id::text, 'nobody')$q$);
select pg_temp.try('hamish hands the job to Tom', $q$update public.plan_items set owner_id = '00000000-0000-4000-8000-0000004a0b03' where id = '00000000-0000-4000-8000-0000004a0e01' returning (owner_id = '00000000-0000-4000-8000-0000004a0b03')::text$q$);
select pg_temp.try('hamish adds a formula job', $q$insert into public.plan_items (plan_id, kind, title, formula_key) values ('00000000-0000-4000-8000-0000004a0c01', 'job', 'Reserve accommodation', 'reserve_stay') returning coalesce(formula_key, 'dropped')$q$);
select pg_temp.try('hamish logs a cost paid by the organiser', $q$insert into public.plan_costs (plan_id, title, amount, paid_by) values ('00000000-0000-4000-8000-0000004a0c01', 'House deposit', 500, '00000000-0000-4000-8000-0000004a0b01') returning amount::text$q$);
select pg_temp.try('hamish sets Tom as in', $q$insert into public.plan_rsvps (plan_id, player_id, status) values ('00000000-0000-4000-8000-0000004a0c01', '00000000-0000-4000-8000-0000004a0b03', 'in') returning status$q$);
select pg_temp.try('hamish sets the dates and place', $q$update public.plans set start_date = '2027-03-12', end_date = '2027-03-14', location_name = 'Hunter Valley', repeat_shape = '{"rounds":[]}' where id = '00000000-0000-4000-8000-0000004a0c01' returning location_name || ' / shape kept ' || (repeat_shape is not null)::text$q$);
select pg_temp.try('hamish makes himself the organiser', $q$update public.plans set organiser_id = '00000000-0000-4000-8000-0000004a0b02' where id = '00000000-0000-4000-8000-0000004a0c01' returning (organiser_id = '00000000-0000-4000-8000-0000004a0b01')::text$q$);
select pg_temp.try('hamish names Tom too', $q$insert into public.plan_coorganisers (plan_id, player_id) values ('00000000-0000-4000-8000-0000004a0c01', '00000000-0000-4000-8000-0000004a0b03') returning 1$q$);
-- Not on the Spring trip.
select pg_temp.try('hamish writes the Spring trip builder', $q$insert into public.trip_builds (plan_id, state) values ('00000000-0000-4000-8000-0000004a0c02', '{"region":"Nope"}') returning 1$q$);
select pg_temp.try('hamish renames the Spring trip (rows)', $q$with u as (update public.plans set name = 'Nope' where id = '00000000-0000-4000-8000-0000004a0c02' returning 1) select count(*)::text from u$q$);
select pg_temp.try('hamish can decide on Spring', $q$select public.can_decide('00000000-0000-4000-8000-0000004a0c02')::text$q$);
-- Lock it in, then call it off and bring it back.
select pg_temp.try('hamish locks it in', $q$update public.plans set status = 'confirmed' where id = '00000000-0000-4000-8000-0000004a0c01' returning status || ' / trip made ' || (trip_id is not null)::text$q$);
select pg_temp.try('hamish calls it off', $q$select public.call_off_plan('00000000-0000-4000-8000-0000004a0c01', true)::text$q$);
select pg_temp.try('hamish brings it back', $q$select public.call_off_plan('00000000-0000-4000-8000-0000004a0c01', false)::text$q$);
select pg_temp.try('status after', $q$select status from public.plans where id = '00000000-0000-4000-8000-0000004a0c01'$q$);
reset role;

-- ---------------------------------------------------------------- limits, stepping down, another group
select pg_temp.as_user('00000000-0000-4000-8000-0000004a0a01');
set local role authenticated;
select pg_temp.try('organiser names Tom', $q$insert into public.plan_coorganisers (plan_id, player_id) values ('00000000-0000-4000-8000-0000004a0c02', '00000000-0000-4000-8000-0000004a0b03') returning 1$q$);
select pg_temp.try('organiser names Hamish on Spring', $q$insert into public.plan_coorganisers (plan_id, player_id) values ('00000000-0000-4000-8000-0000004a0c02', '00000000-0000-4000-8000-0000004a0b02') returning 1$q$);
select pg_temp.try('organiser names himself on Spring', $q$insert into public.plan_coorganisers (plan_id, player_id) values ('00000000-0000-4000-8000-0000004a0c02', '00000000-0000-4000-8000-0000004a0b01') returning 1$q$);
reset role;
-- A fourth (made as the database owner: a stand-in player) is one too many.
insert into public.players (id, group_id, name) values ('00000000-0000-4000-8000-0000004a0b05', '00000000-0000-4000-8000-00000000f104', 'A Four');
select pg_temp.try('a fourth co-organiser', $q$insert into public.plan_coorganisers (plan_id, player_id, added_by) values ('00000000-0000-4000-8000-0000004a0c02', '00000000-0000-4000-8000-0000004a0b05', null) returning 1$q$);
select pg_temp.as_user('00000000-0000-4000-8000-0000004a0a03');
set local role authenticated;
select pg_temp.try('tom removes Hamish (rows)', $q$with d as (delete from public.plan_coorganisers where plan_id = '00000000-0000-4000-8000-0000004a0c02' and player_id = '00000000-0000-4000-8000-0000004a0b02' returning 1) select count(*)::text from d$q$);
select pg_temp.try('tom steps down (rows)', $q$with d as (delete from public.plan_coorganisers where plan_id = '00000000-0000-4000-8000-0000004a0c02' and player_id = '00000000-0000-4000-8000-0000004a0b03' returning 1) select count(*)::text from d$q$);
select pg_temp.try('tom writes the Spring builder after stepping down', $q$insert into public.trip_builds (plan_id, state) values ('00000000-0000-4000-8000-0000004a0c02', '{"region":"Tom"}') returning 1$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000004a0a05');
set local role authenticated;
select pg_temp.try('other group sees the co-organisers', $q$select count(*)::text from public.plan_coorganisers$q$);
select pg_temp.try('other group names one', $q$insert into public.plan_coorganisers (plan_id, player_id) values ('00000000-0000-4000-8000-0000004a0c01', '00000000-0000-4000-8000-0000004a0b10') returning 1$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000004a0a02');
set local role authenticated;
select pg_temp.try('nobody calls the patch helper', $q$select private.ov35_patch('public.can_decide(uuid)'::regprocedure, 'a', 'b', 'c')$q$);
reset role;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
