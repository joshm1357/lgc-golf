-- 103 test: putting a round out — who can, reply order, cap + reserves, lock-in makes one round, pull-outs move the
-- first reserve up, the invite list, the job's nudges, calling it off. Run after 103 (STAGING or a local stand-in
-- only). Self-contained test group. Rolled back; the results come back as the error message ("RESULTS: ...").
-- Expected answers in 103_round_callout.expected.txt.
-- Group G: so — saved organiser (So); bo — saved player who puts it out (Bo); sam, kurt, dan — saved players;
-- al, ham — phone-only players (they can reply, not put one out); gu — a guest.
-- Run locally on Postgres 16 with every migration 001–103 and Supabase stand-ins (auth, cron, storage), 23 Oct 2026.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

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
create function pg_temp.as_user(p_user text, p_anon boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'is_anonymous', p_anon)::text, true) $$;
grant execute on function pg_temp.as_user(text, boolean) to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
grant execute on function pg_temp.id(text) to authenticated;
-- Names in order for a list of player ids.
create function pg_temp.names(p uuid[]) returns text language sql as $$
  select coalesce(string_agg(pl.nickname, ',' order by o), '-') from unnest(p) with ordinality u(x, o) join public.players pl on pl.id = u.x $$;
grant execute on function pg_temp.names(uuid[]) to authenticated;
create function pg_temp.order_of(p_plan uuid) returns text language sql as $$
  select coalesce(string_agg(pl.nickname || case when o.has_spot then '' else '(r' || o.place || ')' end, ',' order by o.has_spot desc, o.place), '-')
  from private.callout_order(p_plan) o join public.players pl on pl.id = o.player_id $$;
create function pg_temp.round_people(p_plan uuid) returns text language sql as $$
  select coalesce(string_agg(pl.nickname, ',' order by pl.nickname), '-') from public.plans p
  join public.round_players rp on rp.round_id = p.round_id join public.players pl on pl.id = rp.player_id where p.id = p_plan $$;
create function pg_temp.queued(p_plan uuid, p_kind text) returns text language sql as $$
  select coalesce(string_agg(pl.nickname || ': ' || q.title, ' / ' order by pl.nickname, q.id), '-') from public.notify_queue q
  join public.group_members gm on gm.user_id = q.user_id and gm.group_id = q.group_id join public.players pl on pl.id = gm.player_id
  where q.kind = p_kind and q.url = '#/plan/' || p_plan::text $$;

insert into public.groups (id, slug, name, group_pin, admin_pin, quick) values
  ('00000000-0000-4000-8000-00000000f103', 'test-g103', 'Test Group G103', 'G103-CODE-TEST-1', null, false),
  ('00000000-0000-4000-8000-00000000f193', 'test-o103', 'Other Group O103', 'O103-CODE-TEST-1', null, false);
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000003a0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000003a0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000003a0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000003a0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000003a0a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000003a0a06', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000003a0a07', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000003a0a08', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000003a0a09', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false);
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000003a0b01', '00000000-0000-4000-8000-00000000f103', 'So Organiser', 'So', 10),
  ('00000000-0000-4000-8000-0000003a0b02', '00000000-0000-4000-8000-00000000f103', 'Bo Red', 'Bo', 12.4),
  ('00000000-0000-4000-8000-0000003a0b03', '00000000-0000-4000-8000-00000000f103', 'Sam Blue', 'Sam', 18),
  ('00000000-0000-4000-8000-0000003a0b04', '00000000-0000-4000-8000-00000000f103', 'Al Green', 'Al', 20),
  ('00000000-0000-4000-8000-0000003a0b05', '00000000-0000-4000-8000-00000000f103', 'Kurt Dahl', 'Kurt', 3),
  ('00000000-0000-4000-8000-0000003a0b06', '00000000-0000-4000-8000-00000000f103', 'Dan Gold', 'Dan', 25),
  ('00000000-0000-4000-8000-0000003a0b07', '00000000-0000-4000-8000-00000000f103', 'Hamish Grey', 'Ham', 15),
  ('00000000-0000-4000-8000-0000003a0b08', '00000000-0000-4000-8000-00000000f103', 'Gus Guest', 'Gus', 30),
  ('00000000-0000-4000-8000-0000003a0b09', '00000000-0000-4000-8000-00000000f193', 'Other Person', 'Oz', 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f103', '00000000-0000-4000-8000-0000003a0a01', '00000000-0000-4000-8000-0000003a0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f103', '00000000-0000-4000-8000-0000003a0a02', '00000000-0000-4000-8000-0000003a0b02', 'player'),
  ('00000000-0000-4000-8000-00000000f103', '00000000-0000-4000-8000-0000003a0a03', '00000000-0000-4000-8000-0000003a0b03', 'player'),
  ('00000000-0000-4000-8000-00000000f103', '00000000-0000-4000-8000-0000003a0a04', '00000000-0000-4000-8000-0000003a0b04', 'player'),
  ('00000000-0000-4000-8000-00000000f103', '00000000-0000-4000-8000-0000003a0a05', '00000000-0000-4000-8000-0000003a0b05', 'player'),
  ('00000000-0000-4000-8000-00000000f103', '00000000-0000-4000-8000-0000003a0a06', '00000000-0000-4000-8000-0000003a0b06', 'player'),
  ('00000000-0000-4000-8000-00000000f103', '00000000-0000-4000-8000-0000003a0a07', '00000000-0000-4000-8000-0000003a0b07', 'player'),
  ('00000000-0000-4000-8000-00000000f103', '00000000-0000-4000-8000-0000003a0a08', '00000000-0000-4000-8000-0000003a0b08', 'guest'),
  ('00000000-0000-4000-8000-00000000f193', '00000000-0000-4000-8000-0000003a0a09', '00000000-0000-4000-8000-0000003a0b09', 'organiser');
-- Everyone has a phone that takes notifications.
insert into public.push_subscriptions (endpoint, user_id, player_id, p256dh, auth)
  select 'https://push.test/' || gm.user_id, gm.user_id, gm.player_id, 'k', 'a' from public.group_members gm
  where gm.group_id in ('00000000-0000-4000-8000-00000000f103', '00000000-0000-4000-8000-00000000f193');
insert into public.courses (id, group_id, name, holes) values
  ('00000000-0000-4000-8000-0000003a0c01', '00000000-0000-4000-8000-00000000f103', 'Moore Park', '[{"n":1,"par":4,"si":1}]'),
  ('00000000-0000-4000-8000-0000003a0c09', '00000000-0000-4000-8000-00000000f193', 'Other Course', '[{"n":1,"par":4,"si":1}]');
insert into t_ids values
  ('so', '00000000-0000-4000-8000-0000003a0b01'), ('bo', '00000000-0000-4000-8000-0000003a0b02'), ('sam', '00000000-0000-4000-8000-0000003a0b03'),
  ('al', '00000000-0000-4000-8000-0000003a0b04'), ('kurt', '00000000-0000-4000-8000-0000003a0b05'), ('dan', '00000000-0000-4000-8000-0000003a0b06'),
  ('ham', '00000000-0000-4000-8000-0000003a0b07'), ('gus', '00000000-0000-4000-8000-0000003a0b08'),
  ('moore', '00000000-0000-4000-8000-0000003a0c01'), ('other_course', '00000000-0000-4000-8000-0000003a0c09');
-- Two Fridays a week apart, far enough ahead that the expected answers stay the same for years.
insert into t_ids values ('d1', null), ('d2', null);
create temp table t_dates as select date '2030-11-01' as d1, date '2030-11-08' as d2;
grant all on t_dates to authenticated;

-- ---------------------------------------------------------------- Who can put one out
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a04', true);   -- Al, phone-only
set local role authenticated;
select pg_temp.try('phone-only Al puts a round out', $q$select public.put_round_out('Fri hit', jsonb_build_array(jsonb_build_object('date', (select d1 from t_dates), 'part', 'arvo')))::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a08', false);  -- Gus, a guest
set local role authenticated;
select pg_temp.try('guest Gus puts a round out', $q$select public.put_round_out('Fri hit', jsonb_build_array(jsonb_build_object('date', (select d1 from t_dates), 'part', 'arvo')))::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a02', false);  -- Bo, saved
set local role authenticated;
select pg_temp.try('Bo makes a call-out by a plain insert', $q$insert into public.plans (kind, name, status, proposed, created_by, callout) values ('round', 'Sneaky', 'planning', true, pg_temp.id('bo'), true) returning 'added'$q$);
select pg_temp.try('Bo: a day that has gone', $q$select public.put_round_out('Old', jsonb_build_array(jsonb_build_object('date', current_date - 1)))::text$q$);
select pg_temp.try('Bo: nine times', $q$select public.put_round_out('Lots', (select jsonb_agg(jsonb_build_object('date', current_date + g)) from generate_series(1, 9) g))::text$q$);
select pg_temp.try('Bo: another group''s course', $q$select public.put_round_out('X', jsonb_build_array(jsonb_build_object('date', current_date + 1)), null, null, null, null, pg_temp.id('other_course'))::text$q$);
select pg_temp.try('Bo puts out Fri arvo, next 2 weeks — 4 spots, whole group, Moore Park', $q$
  with x as (select public.put_round_out('Fri arvo hit',
    jsonb_build_array(jsonb_build_object('date', (select d1 from t_dates), 'part', 'arvo', 'label', 'Option one'),
                      jsonb_build_object('date', (select d2 from t_dates), 'part', 'arvo')),
    4, null, now() + interval '3 days', '$65 green fee, carts optional', pg_temp.id('moore'), null, null,
    '{"games": true, "kitty": false, "after": "  Beers at the Bowlo  ", "junk": true}'::jsonb) as id)
  insert into t_ids select 'c1', id from x returning 'made'$q$);
reset role;
insert into t_results (label, result) select 'the call-out', p.kind || ' · callout ' || p.callout || ' · ' || p.status || ' · proposed ' || p.proposed
  || ' · spots ' || p.spots || ' · ' || p.location_name || ' · invite_all ' || p.invite_all || ' · organiser = Bo ' || (p.organiser_id = pg_temp.id('bo'))
  || ' · extras ' || p.extras::text || ' · note ' || p.brief from public.plans p where p.id = pg_temp.id('c1');
insert into t_results (label, result) select 'its times (a dates vote)', string_agg(o.label || ' [' || coalesce(o.part, '-') || ']', ' | ' order by o.start_date)
  from public.plan_options o join public.plan_polls po on po.id = o.poll_id where po.plan_id = pg_temp.id('c1') and po.kind = 'dates';
insert into t_results (label, result) select 'Bo is ✓ on both', count(*)::text from public.plan_votes v join public.plan_polls po on po.id = v.poll_id
  where po.plan_id = pg_temp.id('c1') and v.player_id = pg_temp.id('bo') and v.response = 'yes' and v.first_yes_at is not null;
insert into t_results (label, result) select 'buzzed (callout_new): not Bo, not the other group', count(*) || ' · ' || pg_temp.names(array_agg(gm.player_id order by pl.nickname))
  from public.notify_queue q join public.group_members gm on gm.user_id = q.user_id and gm.group_id = q.group_id join public.players pl on pl.id = gm.player_id
  where q.kind = 'callout_new' and q.url = '#/plan/' || pg_temp.id('c1');
insert into t_results (label, result) select 'the buzz', min(q.title) || ' — ' || min(q.body) from public.notify_queue q where q.kind = 'callout_new' and q.url = '#/plan/' || pg_temp.id('c1');
insert into t_results (label, result) select 'Feed post', count(*) || ' · ' || min(body) from public.posts where link = '/plan/' || pg_temp.id('c1');

-- ---------------------------------------------------------------- Replies (✓ in the order ticked)
create function pg_temp.tick(p_user text, p_anon boolean, p_who text, p_opt int, p_resp text) returns void language plpgsql as $$
declare v_opt uuid; v_poll uuid;
begin
  select o.id, o.poll_id into v_opt, v_poll from public.plan_options o join public.plan_polls po on po.id = o.poll_id
  where po.plan_id = pg_temp.id('c1') and po.kind = 'dates' order by o.start_date offset p_opt - 1 limit 1;
  perform pg_temp.as_user(p_user, p_anon);
  set local role authenticated;
  perform pg_temp.try(p_who || ' ' || p_resp || ' on option ' || p_opt, format($q$insert into public.plan_votes (option_id, poll_id, player_id, response) values (%L, %L, %L, %L)
    on conflict (option_id, player_id) do update set response = excluded.response, updated_at = now() returning response$q$, v_opt, v_poll, pg_temp.id(p_who), p_resp));
  reset role;
end $$;
select pg_temp.tick('00000000-0000-4000-8000-0000003a0a03', false, 'sam', 1, 'yes');
select pg_temp.tick('00000000-0000-4000-8000-0000003a0a04', true, 'al', 1, 'yes');     -- phone-only can reply
select pg_temp.tick('00000000-0000-4000-8000-0000003a0a05', false, 'kurt', 1, 'yes');
select pg_temp.tick('00000000-0000-4000-8000-0000003a0a06', false, 'dan', 1, 'yes');
select pg_temp.tick('00000000-0000-4000-8000-0000003a0a07', true, 'ham', 1, 'yes');
select pg_temp.tick('00000000-0000-4000-8000-0000003a0a03', false, 'sam', 1, 'yes');    -- the same answer again: keeps his place
select pg_temp.tick('00000000-0000-4000-8000-0000003a0a05', false, 'kurt', 1, 'maybe');
select pg_temp.tick('00000000-0000-4000-8000-0000003a0a05', false, 'kurt', 1, 'yes');   -- maybe and back: to the back
select pg_temp.tick('00000000-0000-4000-8000-0000003a0a03', false, 'sam', 2, 'no');
select pg_temp.tick('00000000-0000-4000-8000-0000003a0a01', false, 'so', 1, 'maybe');
-- Nobody can set their own place.
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a07', true);
set local role authenticated;
select pg_temp.try('Ham tries to jump the queue', $q$update public.plan_votes set first_yes_at = '2000-01-01' where player_id = pg_temp.id('ham') returning (first_yes_at > '2001-01-01')::text$q$);
reset role;
insert into t_results (label, result) select 'option 1 ✓ in tick order', pg_temp.names(array_agg(v.player_id order by v.first_yes_at, v.player_id))
  from public.plan_votes v join public.plan_options o on o.id = v.option_id join public.plan_polls po on po.id = o.poll_id
  where po.plan_id = pg_temp.id('c1') and v.response = 'yes' and o.start_date = (select d1 from t_dates);

-- ---------------------------------------------------------------- Lock it in
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a03', false);  -- Sam (saved, but didn't put it out)
set local role authenticated;
select pg_temp.try('Sam tries to lock it in', $q$select public.callout_lock(pg_temp.id('c1'), (select o.id from public.plan_options o join public.plan_polls po on po.id = o.poll_id where po.plan_id = pg_temp.id('c1') order by o.start_date limit 1))::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a02', false);  -- Bo
set local role authenticated;
select pg_temp.try('Bo: a bad tee time', $q$select public.callout_lock(pg_temp.id('c1'), (select o.id from public.plan_options o join public.plan_polls po on po.id = o.poll_id where po.plan_id = pg_temp.id('c1') order by o.start_date limit 1), '1:20pm')::text$q$);
select pg_temp.try('Bo locks in option 1 at 13:20, Sam booking', $q$select (r ->> 'round_id' is not null)::text || ' · in ' || pg_temp.names(array(select jsonb_array_elements_text(r -> 'in')::uuid))
  || ' · reserve ' || pg_temp.names(array(select jsonb_array_elements_text(r -> 'reserve')::uuid))
  from (select public.callout_lock(pg_temp.id('c1'), (select o.id from public.plan_options o join public.plan_polls po on po.id = o.poll_id where po.plan_id = pg_temp.id('c1') order by o.start_date limit 1),
        '13:20', null, null, pg_temp.id('sam')) as r) x$q$);
select pg_temp.try('Bo locks it again (a retry)', $q$select (public.callout_lock(pg_temp.id('c1')) ->> 'again')$q$);
reset role;
insert into t_results (label, result) select 'the plan', p.status || ' · ' || (p.start_date = (select d1 from t_dates)) || ' · tee ' || p.tee_time || ' · trip made ' || (p.trip_id is not null)
  || ' · booker ' || pg_temp.names(array[p.booker_id]) from public.plans p where p.id = pg_temp.id('c1');
insert into t_results (label, result) select 'the round', r.name || ' · ' || r.format || ' · ' || r.status || ' · on the trip ' || (r.trip_id = p.trip_id) || ' · day ok ' || (r.play_date = p.start_date)
  || ' · course ' || c.name from public.plans p join public.rounds r on r.id = p.round_id join public.courses c on c.id = r.course_id where p.id = pg_temp.id('c1');
insert into t_results (label, result) select 'round players (handicaps)', string_agg(pl.nickname || ' ' || rp.playing_handicap, ',' order by pl.nickname)
  from public.plans p join public.round_players rp on rp.round_id = p.round_id join public.players pl on pl.id = rp.player_id where p.id = pg_temp.id('c1');
insert into t_results (label, result) select 'replies after lock-in', string_agg(pl.nickname || ' ' || r.status, ',' order by pl.nickname)
  from public.plan_rsvps r join public.players pl on pl.id = r.player_id where r.plan_id = pg_temp.id('c1');
insert into t_results (label, result) select 'the order', pg_temp.order_of(pg_temp.id('c1'));
insert into t_results (label, result) select 'votes closed', string_agg(po.kind || ' ' || po.status || ' winner ' || (po.winner_option_id is not null), ', ') from public.plan_polls po where po.plan_id = pg_temp.id('c1');
insert into t_results (label, result) select 'buzz: in', pg_temp.queued(pg_temp.id('c1'), 'callout_in');
insert into t_results (label, result) select 'buzz: reserve', pg_temp.queued(pg_temp.id('c1'), 'callout_reserve');
insert into t_results (label, result) select 'buzz: didn''t get a spot (maybe)', pg_temp.queued(pg_temp.id('c1'), 'callout_full');
insert into t_results (label, result) select 'buzz: locked (full)', pg_temp.queued(pg_temp.id('c1'), 'callout_locked');
insert into t_results (label, result) select 'buzz: booker', pg_temp.queued(pg_temp.id('c1'), 'callout_booker');
insert into t_results (label, result) select 'booking job', i.title || ' · ' || pg_temp.names(array[i.owner_id]) || ' · due set ' || (i.due is not null)
  from public.plan_items i where i.plan_id = pg_temp.id('c1') and i.kind = 'job';
insert into t_results (label, result) select 'lock-in Feed post', count(*)::text from public.posts where link = '/plan/' || pg_temp.id('c1') and body like '🔒 Locked in%';

-- ---------------------------------------------------------------- Pull-outs
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a04', true);   -- Al, phone-only
set local role authenticated;
select pg_temp.try('Al can''t make it now', $q$update public.plan_rsvps set status = 'out' where plan_id = pg_temp.id('c1') and player_id = pg_temp.id('al') returning status$q$);
reset role;
insert into t_results (label, result) select 'after Al pulls out: round', pg_temp.round_people(pg_temp.id('c1'));
insert into t_results (label, result) select 'after Al pulls out: order', pg_temp.order_of(pg_temp.id('c1'));
insert into t_results (label, result) select 'buzz: moved up', pg_temp.queued(pg_temp.id('c1'), 'callout_promoted');
insert into t_results (label, result) select 'buzz: Bo told', pg_temp.queued(pg_temp.id('c1'), 'callout_pullout');
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a04', true);
set local role authenticated;
select pg_temp.try('Al is in again', $q$update public.plan_rsvps set status = 'in' where plan_id = pg_temp.id('c1') and player_id = pg_temp.id('al') returning status$q$);
reset role;
insert into t_results (label, result) select 'Al goes to the back', pg_temp.order_of(pg_temp.id('c1'));
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a02', false);
set local role authenticated;
select pg_temp.try('Bo makes it 5 spots', $q$select public.callout_update(pg_temp.id('c1'), '{"spots": 5, "note": "Carts booked"}'::jsonb)::text$q$);
select pg_temp.try('Bo: 1 spot', $q$select public.callout_update(pg_temp.id('c1'), '{"spots": 1}'::jsonb)::text$q$);
reset role;
insert into t_results (label, result) select 'with 5 spots', pg_temp.round_people(pg_temp.id('c1')) || ' · ' || pg_temp.order_of(pg_temp.id('c1'));
insert into t_results (label, result) select 'buzz: moved up (Kurt now too)', pg_temp.queued(pg_temp.id('c1'), 'callout_promoted');
-- Once the round has started nothing moves by itself.
update public.rounds set status = 'live' where id = (select round_id from public.plans where id = pg_temp.id('c1'));
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a06', false);  -- Dan
set local role authenticated;
select pg_temp.try('round live: Dan pulls out', $q$update public.plan_rsvps set status = 'out' where plan_id = pg_temp.id('c1') and player_id = pg_temp.id('dan') returning status$q$);
reset role;
update public.rounds set status = 'setup' where id = (select round_id from public.plans where id = pg_temp.id('c1'));

-- ---------------------------------------------------------------- The evening before
insert into t_results (label, result) select 'the job at 4pm the day before', private.callout_tick((((select d1 from t_dates) - 1)::timestamp + interval '16 hours') at time zone 'Australia/Sydney')::text;
insert into t_results (label, result) select 'the job at 6pm the day before', private.callout_tick((((select d1 from t_dates) - 1)::timestamp + interval '18 hours') at time zone 'Australia/Sydney')::text;
insert into t_results (label, result) select 'the job again', private.callout_tick((((select d1 from t_dates) - 1)::timestamp + interval '19 hours') at time zone 'Australia/Sydney')::text;
insert into t_results (label, result) select 'buzz: tomorrow', pg_temp.queued(pg_temp.id('c1'), 'callout_tomorrow');
insert into t_results (label, result) select 'Kurt''s tomorrow buzz', q.title || ' — ' || q.body from public.notify_queue q join public.group_members gm on gm.user_id = q.user_id
  where q.kind = 'callout_tomorrow' and gm.player_id = pg_temp.id('kurt');

-- ---------------------------------------------------------------- A list, not the whole group; a fixed time; nudge; call off
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a02', false);  -- Bo
set local role authenticated;
select pg_temp.try('Bo asks just Sam: Sat 7:30, no cap', $q$with x as (select public.put_round_out('Sat early', jsonb_build_array(jsonb_build_object('date', date '2030-11-02', 'tee_time', '07:30')),
    null, array[pg_temp.id('sam')], now() + interval '1 day', null, null, null, 'Somewhere nice') as id) insert into t_ids select 'c2', id from x returning 'made'$q$);
reset role;
insert into t_results (label, result) select 'the list', pg_temp.names(array_agg(i.player_id order by pl.nickname)) from public.plan_invites i join public.players pl on pl.id = i.player_id where i.plan_id = pg_temp.id('c2');
insert into t_results (label, result) select 'a fixed time: no vote, Bo in', (select count(*) from public.plan_polls where plan_id = pg_temp.id('c2'))::text || ' votes · '
  || (select string_agg(pl.nickname || ' ' || r.status, ',') from public.plan_rsvps r join public.players pl on pl.id = r.player_id where r.plan_id = pg_temp.id('c2'))
  || ' · tee ' || (select tee_time from public.plans where id = pg_temp.id('c2'));
insert into t_results (label, result) select 'buzz: only Sam asked', pg_temp.queued(pg_temp.id('c2'), 'callout_new');
insert into t_results (label, result) select 'no Feed post for a list', count(*)::text from public.posts where link = '/plan/' || pg_temp.id('c2');
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a05', false);  -- Kurt, not asked
set local role authenticated;
select pg_temp.try('Kurt (not asked) says he''s in', $q$insert into public.plan_rsvps (plan_id, player_id, status) values (pg_temp.id('c2'), pg_temp.id('kurt'), 'in') returning status$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a03', false);  -- Sam
set local role authenticated;
select pg_temp.try('Sam says he''s in', $q$insert into public.plan_rsvps (plan_id, player_id, status) values (pg_temp.id('c2'), pg_temp.id('sam'), 'in') returning status$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a02', false);
set local role authenticated;
select pg_temp.try('Bo asks Kurt too', $q$select public.callout_update(pg_temp.id('c2'), jsonb_build_object('invite_add', jsonb_build_array(pg_temp.id('kurt'))))::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a05', false);
set local role authenticated;
select pg_temp.try('now Kurt says he''s in', $q$insert into public.plan_rsvps (plan_id, player_id, status) values (pg_temp.id('c2'), pg_temp.id('kurt'), 'in') returning status$q$);
reset role;
update public.plans set closes_at = now() - interval '5 minutes' where id = pg_temp.id('c2');
insert into t_results (label, result) select 'replies closed: the job', private.callout_tick(now())::text;
insert into t_results (label, result) select 'replies closed: once', private.callout_tick(now())::text;
insert into t_results (label, result) select 'buzz: lock it in', pg_temp.queued(pg_temp.id('c2'), 'callout_lockit');
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a02', false);
set local role authenticated;
select pg_temp.try('Bo locks the fixed time (course from the library? no — none set)', $q$select public.callout_lock(pg_temp.id('c2'))::text$q$);
select pg_temp.try('Bo locks it at Moore Park', $q$select pg_temp.names(array(select jsonb_array_elements_text(public.callout_lock(pg_temp.id('c2'), null, null, pg_temp.id('moore')) -> 'in')::uuid))$q$);
reset role;
insert into t_results (label, result) select 'fixed time round', pg_temp.round_people(pg_temp.id('c2'));
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a02', false);
set local role authenticated;
select pg_temp.try('Bo calls it off', $q$select public.call_off_plan(pg_temp.id('c2'), true)::text$q$);
reset role;
insert into t_results (label, result) select 'called off: round gone', (select status from public.plans where id = pg_temp.id('c2')) || ' · round ' || coalesce((select round_id::text from public.plans where id = pg_temp.id('c2')), 'none');
insert into t_results (label, result) select 'buzz: called off', pg_temp.queued(pg_temp.id('c2'), 'callout_off');

-- ---------------------------------------------------------------- Reading
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a04', true);   -- Al, phone-only, same group
set local role authenticated;
select pg_temp.try('Al reads the invite list', $q$select count(*)::text from public.plan_invites$q$);
select pg_temp.try('Al adds himself to a list', $q$insert into public.plan_invites (plan_id, player_id, group_id) values (pg_temp.id('c2'), pg_temp.id('al'), '00000000-0000-4000-8000-00000000f103') returning 'added'$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000003a0a09', false);  -- Oz, another group
set local role authenticated;
select pg_temp.try('another group reads the invite list', $q$select count(*)::text from public.plan_invites$q$);
select pg_temp.try('another group locks Bo''s round', $q$select public.callout_lock(pg_temp.id('c1'))::text$q$);
reset role;

insert into t_results (label, result) select 'clock words', private.callout_when(date '2026-10-30', '13:20') || ' | ' || private.callout_when(date '2026-10-31', '07:00') || ' | ' || private.callout_when(date '2026-10-30', null, 'arvo');

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
