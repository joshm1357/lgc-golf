-- 110 test: the link preview says what's asked and by when. Whoever proposed an idea sets "have your say by" (a
-- player can't; nor another group); the preview (no sign-in) gives the stage and counts — collecting (answered of
-- people, the guest not counted), the vote (what's open, closing date, voted), decided (where, dates, in) — and never a
-- name; the evening-before nudge goes once, to those who haven't answered.
-- STAGING only, after 110 (checked on a local Postgres 16 with 001–110). Self-contained test groups. Rolled back; the
-- results come back as the error message ("RESULTS: ..."). Expected answers in 110_idea_ask.expected.txt. Run with
-- psql -1 (one transaction).
-- Group A: ao — organiser, a1 (Chris) — proposed it, a2 (Tom) — player, ag — guest. Group B: bo.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated, anon;
grant all on sequence t_results_n_seq to authenticated, anon;

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
grant execute on function pg_temp.try(text, text) to authenticated, anon;
create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'is_anonymous', false)::text, true) $$;
grant execute on function pg_temp.as_user(text) to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000f110', 'test-a110', 'Test Group A110', 'A110-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000f210', 'test-b110', 'Test Group B110', 'B110-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-000000aa0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000aa0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000aa0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000aa0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000aa0a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-000000aa0b01', '00000000-0000-4000-8000-00000000f110', 'A Organiser', 'Ao', 10),
  ('00000000-0000-4000-8000-000000aa0b02', '00000000-0000-4000-8000-00000000f110', 'Chris Idea', 'Chris', 15),
  ('00000000-0000-4000-8000-000000aa0b03', '00000000-0000-4000-8000-00000000f110', 'A Two', 'Tom', 18),
  ('00000000-0000-4000-8000-000000aa0b04', '00000000-0000-4000-8000-00000000f110', 'A Guest', 'Gus', 25),
  ('00000000-0000-4000-8000-000000aa0b10', '00000000-0000-4000-8000-00000000f210', 'B Organiser', null, 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f110', '00000000-0000-4000-8000-000000aa0a01', '00000000-0000-4000-8000-000000aa0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f110', '00000000-0000-4000-8000-000000aa0a02', '00000000-0000-4000-8000-000000aa0b02', 'player'),
  ('00000000-0000-4000-8000-00000000f110', '00000000-0000-4000-8000-000000aa0a03', '00000000-0000-4000-8000-000000aa0b03', 'player'),
  ('00000000-0000-4000-8000-00000000f110', '00000000-0000-4000-8000-000000aa0a04', '00000000-0000-4000-8000-000000aa0b04', 'guest'),
  ('00000000-0000-4000-8000-00000000f210', '00000000-0000-4000-8000-000000aa0a05', '00000000-0000-4000-8000-000000aa0b10', 'organiser');


-- The idea, shared (written directly: the share step itself is tested in 108).
insert into public.plans (id, group_id, kind, name, status, proposed, created_by, idea, idea_when, idea_where, share_token, shared_at)
  values ('00000000-0000-4000-8000-000000aa0c01', '00000000-0000-4000-8000-00000000f110', 'trip', 'Hunter trip', 'planning', true, '00000000-0000-4000-8000-000000aa0b02', true, 'March', 'Hunter Valley', 'tok110tok110tok110tok1', now());

-- ---------------------------------------------------------------- "Have your say by"
select pg_temp.as_user('00000000-0000-4000-8000-000000aa0a02');
set local role authenticated;
select pg_temp.try('chris (proposed it) sets have your say by', $q$select (public.idea_set_answer_by('00000000-0000-4000-8000-000000aa0c01', now() + interval '4 days') > now())::text$q$);
select pg_temp.try('chris sets it a year away', $q$select public.idea_set_answer_by('00000000-0000-4000-8000-000000aa0c01', now() + interval '1 year')::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-000000aa0a03');
set local role authenticated;
select pg_temp.try('tom (a player) sets it', $q$select public.idea_set_answer_by('00000000-0000-4000-8000-000000aa0c01', now() + interval '2 days')::text$q$);
select pg_temp.try('tom sets the column directly (rows)', $q$with u as (update public.plans set idea_answer_by = now() where id = '00000000-0000-4000-8000-000000aa0c01' returning 1) select count(*)::text from u$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-000000aa0a05');
set local role authenticated;
select pg_temp.try('other group sets it', $q$select public.idea_set_answer_by('00000000-0000-4000-8000-000000aa0c01', now() + interval '2 days')::text$q$);
reset role;

-- ---------------------------------------------------------------- collecting
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.try('anon preview: collecting', $q$select concat_ws(' ', p->>'stage', p->>'answered', 'of', p->>'people', (p->>'answer_by' is not null)::text, p->>'by') from (select public.idea_preview('tok110tok110tok110tok1') p) x$q$);
reset role;
insert into public.plan_wishes (plan_id, player_id, spend_band) values ('00000000-0000-4000-8000-000000aa0c01', '00000000-0000-4000-8000-000000aa0b03', 'any');
set local role anon;
select pg_temp.try('anon preview: tom answered', $q$select concat_ws(' ', p->>'stage', p->>'answered', 'of', p->>'people') from (select public.idea_preview('tok110tok110tok110tok1') p) x$q$);
select pg_temp.try('anon preview: no names anywhere', $q$select (public.idea_preview('tok110tok110tok110tok1')::text !~ '(Ao|Tom|Gus|A Two|A Organiser)')::text$q$);
select pg_temp.try('anon preview: made-up token', $q$select coalesce(public.idea_preview('zzzzzzzzzzzzzzzzzzzzzz')::text, 'nothing')$q$);
reset role;

-- ---------------------------------------------------------------- the evening-before nudge
select pg_temp.try('nudge job 2 days early', $q$select private.idea_answer_tick(now() + interval '2 days')::text$q$);
select pg_temp.try('nudge job the evening before', $q$select private.idea_answer_tick(now() + interval '3 days 6 hours')::text$q$);
select pg_temp.try('who is nudged (not tom who answered, not the guest)', $q$select count(*)::text || ' ' || bool_and(user_id in ('00000000-0000-4000-8000-000000aa0a01', '00000000-0000-4000-8000-000000aa0a02'))::text from public.notify_queue where url = '#/idea/00000000-0000-4000-8000-000000aa0c01'$q$);
select pg_temp.try('nudge job again: once only', $q$select private.idea_answer_tick(now() + interval '3 days 7 hours')::text$q$);

-- ---------------------------------------------------------------- the vote
update public.plans set idea_sent_at = now() where id = '00000000-0000-4000-8000-000000aa0c01';
insert into public.plan_polls (id, plan_id, kind, question, status, closes_on) values
  ('00000000-0000-4000-8000-000000aa0d01', '00000000-0000-4000-8000-000000aa0c01', 'dates', 'Which weekend?', 'open', '2026-11-05'),
  ('00000000-0000-4000-8000-000000aa0d02', '00000000-0000-4000-8000-000000aa0c01', 'location', 'Which area?', 'open', '2026-11-03');
insert into public.plan_options (id, poll_id, label, start_date, end_date) values
  ('00000000-0000-4000-8000-000000aa0e01', '00000000-0000-4000-8000-000000aa0d01', '13–15 Mar', '2027-03-13', '2027-03-15'),
  ('00000000-0000-4000-8000-000000aa0e02', '00000000-0000-4000-8000-000000aa0d02', 'Hunter Valley', null, null);
insert into public.plan_votes (option_id, poll_id, player_id, response) values
  ('00000000-0000-4000-8000-000000aa0e01', '00000000-0000-4000-8000-000000aa0d01', '00000000-0000-4000-8000-000000aa0b03', 'yes'),
  ('00000000-0000-4000-8000-000000aa0e02', '00000000-0000-4000-8000-000000aa0d02', '00000000-0000-4000-8000-000000aa0b03', 'yes');
set local role anon;
select pg_temp.try('anon preview: vote open', $q$select concat_ws(' ', p->>'stage', p->'vote_open', p->>'vote_closes', p->>'voted', 'of', p->>'people') from (select public.idea_preview('tok110tok110tok110tok1') p) x$q$);
reset role;

-- ---------------------------------------------------------------- decided
update public.plan_polls set status = 'closed', winner_option_id = '00000000-0000-4000-8000-000000aa0e01' where id = '00000000-0000-4000-8000-000000aa0d01';
update public.plan_polls set status = 'closed', winner_option_id = '00000000-0000-4000-8000-000000aa0e02' where id = '00000000-0000-4000-8000-000000aa0d02';
insert into public.plan_rsvps (plan_id, player_id, status) values ('00000000-0000-4000-8000-000000aa0c01', '00000000-0000-4000-8000-000000aa0b03', 'in');
set local role anon;
select pg_temp.try('anon preview: decided by the vote', $q$select concat_ws(' ', p->>'stage', p->>'decided_where', p->>'decided_start', p->>'decided_end', p->>'in_count', 'in;', p->>'people', 'people') from (select public.idea_preview('tok110tok110tok110tok1') p) x$q$);
reset role;
update public.plans set status = 'confirmed', location_name = 'Cessnock', start_date = '2027-03-20', end_date = '2027-03-22' where id = '00000000-0000-4000-8000-000000aa0c01';
set local role anon;
select pg_temp.try('anon preview: locked in', $q$select concat_ws(' ', p->>'stage', p->>'decided_where', p->>'decided_start', p->>'decided_end') from (select public.idea_preview('tok110tok110tok110tok1') p) x$q$);
select pg_temp.try('anon reads plans', $q$select count(*)::text from public.plans$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-000000aa0a02');
set local role authenticated;
select pg_temp.try('chris sets it after lock-in', $q$select public.idea_set_answer_by('00000000-0000-4000-8000-000000aa0c01', now() + interval '2 days')::text$q$);
reset role;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
