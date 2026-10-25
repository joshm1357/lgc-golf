-- 109 test: notes on a trip day. A player adds a day note with a wish; a wish without a day, a bad wish or a home_by
-- without "home by" is refused; a plain chat message still works (old app); another group can't see or add; a player
-- can't delete someone else's note; an organiser can.
-- STAGING only, after 109 (checked on a local Postgres 16 with 001–109). Self-contained test groups. Rolled back; the results come back as the error message
-- ("RESULTS: ..."). Expected answers in 109_day_plan.expected.txt.
-- Group A: ao — organiser, a1 (Hamish), a2 (Tom). Group B: bo.

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
  ('00000000-0000-4000-8000-00000000f109', 'test-a109', 'Test Group A109', 'A109-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000f209', 'test-b109', 'Test Group B109', 'B109-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000009a0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000009a0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000009a0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000009a0a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000009a0b01', '00000000-0000-4000-8000-00000000f109', 'A Organiser', 'Ao', 10),
  ('00000000-0000-4000-8000-0000009a0b02', '00000000-0000-4000-8000-00000000f109', 'A One', 'Hamish', 15),
  ('00000000-0000-4000-8000-0000009a0b03', '00000000-0000-4000-8000-00000000f109', 'A Two', 'Tom', 18),
  ('00000000-0000-4000-8000-0000009a0b10', '00000000-0000-4000-8000-00000000f209', 'B Organiser', null, 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f109', '00000000-0000-4000-8000-0000009a0a01', '00000000-0000-4000-8000-0000009a0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f109', '00000000-0000-4000-8000-0000009a0a02', '00000000-0000-4000-8000-0000009a0b02', 'player'),
  ('00000000-0000-4000-8000-00000000f109', '00000000-0000-4000-8000-0000009a0a03', '00000000-0000-4000-8000-0000009a0b03', 'player'),
  ('00000000-0000-4000-8000-00000000f209', '00000000-0000-4000-8000-0000009a0a05', '00000000-0000-4000-8000-0000009a0b10', 'organiser');
insert into public.plans (id, group_id, kind, name, status, created_by, organiser_id, proposed) values
  ('00000000-0000-4000-8000-0000009a0c01', '00000000-0000-4000-8000-00000000f109', 'trip', 'March trip', 'planning', '00000000-0000-4000-8000-0000009a0b01', '00000000-0000-4000-8000-0000009a0b01', false);

-- ---------------------------------------------------------------- Hamish (a player) writes day notes
select pg_temp.as_user('00000000-0000-4000-8000-0000009a0a02');
set local role authenticated;
select pg_temp.try('hamish: a note on Saturday with "morning free"', $q$insert into public.plan_comments (id, plan_id, body, day_date, day_pref) values ('00000000-0000-4000-8000-0000009a0d01', '00000000-0000-4000-8000-0000009a0c01', 'Keep Saturday morning free, play midday', '2027-03-13', 'morning_free') returning day_pref || ' ' || day_date$q$);
select pg_temp.try('hamish: home by 6 on Sunday', $q$insert into public.plan_comments (plan_id, body, day_date, day_pref, home_by) values ('00000000-0000-4000-8000-0000009a0c01', 'Need to be home by 6', '2027-03-14', 'home_by', '18:00') returning home_by$q$);
select pg_temp.try('hamish: a plain chat message (old app)', $q$insert into public.plan_comments (plan_id, body) values ('00000000-0000-4000-8000-0000009a0c01', 'Count me in') returning coalesce(day_date::text, 'no day')$q$);
select pg_temp.try('hamish: a wish with no day', $q$insert into public.plan_comments (plan_id, body, day_pref) values ('00000000-0000-4000-8000-0000009a0c01', 'early pls', 'early') returning 1$q$);
select pg_temp.try('hamish: a made-up wish', $q$insert into public.plan_comments (plan_id, body, day_date, day_pref) values ('00000000-0000-4000-8000-0000009a0c01', 'x', '2027-03-13', 'never') returning 1$q$);
select pg_temp.try('hamish: home_by without "home by"', $q$insert into public.plan_comments (plan_id, body, day_date, day_pref, home_by) values ('00000000-0000-4000-8000-0000009a0c01', 'x', '2027-03-13', 'early', '18:00') returning 1$q$);
select pg_temp.try('hamish: a bad home_by time', $q$insert into public.plan_comments (plan_id, body, day_date, day_pref, home_by) values ('00000000-0000-4000-8000-0000009a0c01', 'x', '2027-03-14', 'home_by', '6pm') returning 1$q$);
select pg_temp.try('hamish: a day centuries away', $q$insert into public.plan_comments (plan_id, body, day_date) values ('00000000-0000-4000-8000-0000009a0c01', 'x', '2207-03-13') returning 1$q$);
select pg_temp.try('hamish: as Tom', $q$insert into public.plan_comments (plan_id, body, day_date, player_id) values ('00000000-0000-4000-8000-0000009a0c01', 'x', '2027-03-13', '00000000-0000-4000-8000-0000009a0b03') returning 1$q$);
reset role;

-- ---------------------------------------------------------------- Tom reads, can't delete Hamish's
select pg_temp.as_user('00000000-0000-4000-8000-0000009a0a03');
set local role authenticated;
select pg_temp.try('tom sees Saturday''s notes', $q$select count(*)::text from public.plan_comments where plan_id = '00000000-0000-4000-8000-0000009a0c01' and day_date = '2027-03-13'$q$);
select pg_temp.try('tom deletes Hamish''s note (rows)', $q$with d as (delete from public.plan_comments where id = '00000000-0000-4000-8000-0000009a0d01' returning 1) select count(*)::text from d$q$);
reset role;

-- ---------------------------------------------------------------- another group
select pg_temp.as_user('00000000-0000-4000-8000-0000009a0a05');
set local role authenticated;
select pg_temp.try('other group sees the notes', $q$select count(*)::text from public.plan_comments where plan_id = '00000000-0000-4000-8000-0000009a0c01'$q$);
select pg_temp.try('other group adds a note', $q$insert into public.plan_comments (plan_id, body, day_date) values ('00000000-0000-4000-8000-0000009a0c01', 'hi', '2027-03-13') returning 1$q$);
reset role;

-- ---------------------------------------------------------------- the organiser tidies up
select pg_temp.as_user('00000000-0000-4000-8000-0000009a0a01');
set local role authenticated;
select pg_temp.try('organiser deletes Hamish''s note (rows)', $q$with d as (delete from public.plan_comments where id = '00000000-0000-4000-8000-0000009a0d01' returning 1) select count(*)::text from d$q$);
reset role;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
