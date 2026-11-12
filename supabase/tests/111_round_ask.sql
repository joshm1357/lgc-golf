-- 111 test: "Anyone keen for a round?" v2 — ask, answer (windows, can't, reply order), who can answer, the best
-- window, the ready card, probably (usual week), choose → 103's lock-in, Full → move, booked, "was that easy?",
-- put 2–3 to a vote, the funnel, and the fixed-time call-out still nudged by 103's job. Run on STAGING after 111.
-- Self-contained test group; rolled back; results come back as the error message ("RESULTS: ...").
-- Group G: so — organiser; bo — puts it out; sam, kurt, dan — saved players; al, ham — phone-only; gus — guest;
-- oz — another group.

create temp table t_results (n serial, label text, result text);
grant all on t_results to anon, authenticated;
grant all on sequence t_results_n_seq to anon, authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to anon, authenticated;

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
grant execute on function pg_temp.try(text, text) to anon, authenticated;
create function pg_temp.as_user(p_user text, p_anon boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'is_anonymous', p_anon)::text, true) $$;
grant execute on function pg_temp.as_user(text, boolean) to anon, authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
grant execute on function pg_temp.id(text) to anon, authenticated;
create function pg_temp.names(p uuid[]) returns text language sql as $$
  select coalesce(string_agg(pl.nickname, ',' order by o), '-') from unnest(p) with ordinality u(x, o) join public.players pl on pl.id = u.x $$;
grant execute on function pg_temp.names(uuid[]) to anon, authenticated;
create function pg_temp.order_of(p_plan uuid) returns text language sql as $$
  select coalesce(string_agg(pl.nickname || case when o.has_spot then '' else '(r' || o.place || ')' end, ',' order by o.has_spot desc, o.place), '-')
  from private.callout_order(p_plan) o join public.players pl on pl.id = o.player_id $$;
create function pg_temp.round_people(p_plan uuid) returns text language sql as $$
  select coalesce(string_agg(coalesce(pl.nickname, pl.name), ',' order by coalesce(pl.nickname, pl.name)), '-') from public.plans p
  join public.round_players rp on rp.round_id = p.round_id join public.players pl on pl.id = rp.player_id where p.id = p_plan $$;
create function pg_temp.queued(p_plan uuid, p_kind text) returns text language sql as $$
  select coalesce(string_agg(pl.nickname || ': ' || q.title, ' / ' order by pl.nickname, q.id), '-') from public.notify_queue q
  join public.group_members gm on gm.user_id = q.user_id and gm.group_id = q.group_id join public.players pl on pl.id = gm.player_id
  where q.kind = p_kind and q.url = '#/plan/' || p_plan::text $$;
-- One window: Sat 2 Nov 2030 arvo etc.
create function pg_temp.w(p_date text, p_part text) returns jsonb language sql as $$
  select jsonb_build_object('date', p_date, 'part', p_part,
    'from', case p_part when 'early' then '06:00' when 'morning' then '08:00' when 'arvo' then '11:30' else '16:30' end,
    'to', case p_part when 'early' then '07:59' when 'morning' then '11:29' when 'arvo' then '15:00' else '18:00' end) $$;
grant execute on function pg_temp.w(text, text) to anon, authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin, quick) values
  ('00000000-0000-4000-8000-00000000f111', 'test-g111', 'Test Group G111', 'G111-CODE-TEST-1', null, false),
  ('00000000-0000-4000-8000-00000000f191', 'test-o111', 'Other Group O111', 'O111-CODE-TEST-1', null, false);
insert into auth.users (id, instance_id, aud, role, is_anonymous)
  select ('00000000-0000-4000-8000-0000011a0a0' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n in (4, 7)
  from generate_series(1, 9) n;
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000011a0b01', '00000000-0000-4000-8000-00000000f111', 'So Organiser', 'So', 10),
  ('00000000-0000-4000-8000-0000011a0b02', '00000000-0000-4000-8000-00000000f111', 'Bo Red', 'Bo', 12),
  ('00000000-0000-4000-8000-0000011a0b03', '00000000-0000-4000-8000-00000000f111', 'Sam Blue', 'Sam', 18),
  ('00000000-0000-4000-8000-0000011a0b04', '00000000-0000-4000-8000-00000000f111', 'Al Green', 'Al', 20),
  ('00000000-0000-4000-8000-0000011a0b05', '00000000-0000-4000-8000-00000000f111', 'Kurt Dahl', 'Kurt', 3),
  ('00000000-0000-4000-8000-0000011a0b06', '00000000-0000-4000-8000-00000000f111', 'Dan Gold', 'Dan', 25),
  ('00000000-0000-4000-8000-0000011a0b07', '00000000-0000-4000-8000-00000000f111', 'Hamish Grey', 'Ham', 15),
  ('00000000-0000-4000-8000-0000011a0b08', '00000000-0000-4000-8000-00000000f111', 'Gus Guest', 'Gus', 30),
  ('00000000-0000-4000-8000-0000011a0b09', '00000000-0000-4000-8000-00000000f191', 'Other Person', 'Oz', 9);
insert into public.group_members (group_id, user_id, player_id, role)
  select case when n = 9 then '00000000-0000-4000-8000-00000000f191' else '00000000-0000-4000-8000-00000000f111' end::uuid,
         ('00000000-0000-4000-8000-0000011a0a0' || n)::uuid, ('00000000-0000-4000-8000-0000011a0b0' || n)::uuid,
         case when n in (1, 9) then 'organiser' when n = 8 then 'guest' else 'player' end
  from generate_series(1, 9) n;
insert into public.push_subscriptions (endpoint, user_id, player_id, p256dh, auth)
  select 'https://push.test/' || gm.user_id, gm.user_id, gm.player_id, 'k', 'a' from public.group_members gm
  where gm.group_id in ('00000000-0000-4000-8000-00000000f111', '00000000-0000-4000-8000-00000000f191');
insert into public.courses (id, group_id, name, holes) values
  ('00000000-0000-4000-8000-0000011a0c01', '00000000-0000-4000-8000-00000000f111', 'Moore Park', '[{"n":1,"par":4,"si":1}]');
insert into t_ids values
  ('so', '00000000-0000-4000-8000-0000011a0b01'), ('bo', '00000000-0000-4000-8000-0000011a0b02'), ('sam', '00000000-0000-4000-8000-0000011a0b03'),
  ('al', '00000000-0000-4000-8000-0000011a0b04'), ('kurt', '00000000-0000-4000-8000-0000011a0b05'), ('dan', '00000000-0000-4000-8000-0000011a0b06'),
  ('ham', '00000000-0000-4000-8000-0000011a0b07'), ('gus', '00000000-0000-4000-8000-0000011a0b08'), ('moore', '00000000-0000-4000-8000-0000011a0c01');

create function pg_temp.answer(p_n int, p_anon boolean, p_who text, p_plan text, p_slots jsonb, p_cant boolean default false, p_usual jsonb default null) returns void language plpgsql as $$
begin
  perform pg_temp.as_user('00000000-0000-4000-8000-0000011a0a0' || p_n, p_anon);
  set local role authenticated;
  perform pg_temp.try(p_who || ' answers', format('select public.callout_answer(%L, %L::jsonb, %L, %L::jsonb, %L::jsonb)::text',
    pg_temp.id(p_plan), p_slots, p_cant, '{"any": true, "courses": [], "wishes": ["nine_ok"]}', p_usual));
  reset role;
end $$;

-- ---------------------------------------------------------------- Ask
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a04', true);   -- Al, phone-only: can't ask
set local role authenticated;
select pg_temp.try('phone-only Al asks', $q$select public.put_round_ask('x', '{"days":[],"parts":[],"range":{"kind":"next","days":14}}')::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a02', false);  -- Bo
set local role authenticated;
select pg_temp.try('Bo: no range', $q$select public.put_round_ask('x', '{"days":[]}')::text$q$);
select pg_temp.try('Bo asks: two Saturdays, any time, 3 spots, Moore Park', $q$
  with x as (select public.put_round_ask(null, '{"days":[],"parts":[],"range":{"kind":"dates","dates":["2030-11-02","2030-11-09"]},"times":[]}'::jsonb,
    3, null, now() + interval '2 days', null, pg_temp.id('moore')) as id) insert into t_ids select 'a1', id from x returning 'made'$q$);
select pg_temp.try('Bo makes a plain fixed-time call-out too (103, unchanged)', $q$
  with x as (select public.put_round_out('Sat 1:20', jsonb_build_array(jsonb_build_object('date', '2030-11-02', 'tee_time', '13:20')), 4, null,
    now() + interval '1 day', null, pg_temp.id('moore')) as id) insert into t_ids select 'fixed', id from x returning 'made'$q$);
reset role;
insert into t_results (label, result) select 'the ask', p.name || ' · callout ' || p.callout || ' · ' || p.status || ' · start ' || coalesce(p.start_date::text, '-')
  || ' · ' || p.location_name || ' · spots ' || p.spots || ' · range ' || (p.ask -> 'range' ->> 'kind') from public.plans p where p.id = pg_temp.id('a1');
insert into t_results (label, result) select 'asked events', count(*)::text from public.callout_events where plan_id = pg_temp.id('a1') and kind = 'asked';
insert into t_results (label, result) select 'buzzed', pg_temp.queued(pg_temp.id('a1'), 'callout_new');

-- ---------------------------------------------------------------- Answers (reply order: Sam, Kurt, Al, Dan(can't), Ham, Bo)
select pg_temp.answer(3, false, 'Sam', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')));
select pg_temp.answer(5, false, 'Kurt', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo'), pg_temp.w('2030-11-09', 'morning')));
select pg_temp.answer(4, true, 'phone-only Al', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo') || '{"note":"9 holes only","nine":true}'));
select pg_temp.answer(6, false, 'Dan (can''t this round)', 'a1', null, true);
select pg_temp.answer(7, true, 'Ham', 'a1', jsonb_build_array(pg_temp.w('2030-11-09', 'morning')), false, '{"pattern":{"sat|morning":true},"notes":{}}');
select pg_temp.answer(2, false, 'Bo', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')));
select pg_temp.answer(8, false, 'guest Gus (not asked)', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')));
select pg_temp.answer(9, false, 'Oz (other group)', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')));
select pg_temp.answer(3, false, 'Sam: a bad window', 'a1', '[{"date":"2030-11-02","from":"15:00","to":"11:00"}]');
select pg_temp.answer(3, false, 'Sam: nothing ticked', 'a1', '[]');
-- Sam changes his answer: keeps his place.
select pg_temp.answer(3, false, 'Sam adds Sat 9 early', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo'), pg_temp.w('2030-11-09', 'early')));
insert into t_results (label, result) select 'can: Sat 2 arvo (reply order)', pg_temp.names(private.ask_can(pg_temp.id('a1'), '2030-11-02', '11:30', '15:00'));
insert into t_results (label, result) select 'can: Sat 9 morning', pg_temp.names(private.ask_can(pg_temp.id('a1'), '2030-11-09', '08:00', '11:29'));
insert into t_results (label, result) select 'can: Sat 2 at 1:20pm (an exact time)', pg_temp.names(private.ask_can(pg_temp.id('a1'), '2030-11-02', '13:20', '13:20'));
insert into t_results (label, result) select 'best so far', b.o_date || ' ' || b.o_part || ' · ' || b.o_n from private.ask_best(pg_temp.id('a1')) b;
insert into t_results (label, result) select 'Al''s note kept', (slots -> 0 ->> 'note') || ' / nine ' || (slots -> 0 ->> 'nine') from public.callout_answers where plan_id = pg_temp.id('a1') and player_id = pg_temp.id('al');
insert into t_results (label, result) select 'usual week saved for Ham only', string_agg(pl.nickname, ',') from public.player_usual_weeks u join public.players pl on pl.id = u.player_id where u.group_id = '00000000-0000-4000-8000-00000000f111';
-- Others can't read Ham's usual week; Ham can.
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a03', false); set local role authenticated;
select pg_temp.try('Sam reads usual weeks', $q$select count(*)::text from public.player_usual_weeks$q$);
select pg_temp.try('Sam writes an answer directly', $q$insert into public.callout_answers (plan_id, player_id, group_id) values (pg_temp.id('a1'), pg_temp.id('sam'), '00000000-0000-4000-8000-00000000f111') returning 'x'$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a07', true); set local role authenticated;
select pg_temp.try('Ham reads usual weeks', $q$select count(*)::text from public.player_usual_weeks$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a09', false); set local role authenticated;
select pg_temp.try('Oz reads the answers', $q$select count(*)::text from public.callout_answers where plan_id = pg_temp.id('a1')$q$);
reset role;

-- ---------------------------------------------------------------- The job
insert into t_results (label, result) select 'ask tick (group of 3 fills)', private.callout_ask_tick(now())::text;
insert into t_results (label, result) select 'ready card', pg_temp.queued(pg_temp.id('a1'), 'callout_lockit');
insert into t_results (label, result) select 'ask tick again (once only)', private.callout_ask_tick(now())::text;
update public.plans set closes_at = now() - interval '1 minute' where id in (pg_temp.id('a1'), pg_temp.id('fixed'));
insert into t_results (label, result) select '103 tick: fixed-time nudged, the ask left alone', private.callout_tick(now())::text;
insert into t_results (label, result) select '103 nudge on the fixed one', pg_temp.queued(pg_temp.id('fixed'), 'callout_lockit');
update public.plans set closes_at = now() + interval '2 days' where id = pg_temp.id('a1');

-- ---------------------------------------------------------------- Probably (a second ask)
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a02', false); set local role authenticated;
select pg_temp.try('Bo asks again', $q$with x as (select public.put_round_ask('Again', '{"days":["sat"],"parts":[],"range":{"kind":"open"}}'::jsonb) as id) insert into t_ids select 'a2', id from x returning 'made'$q$);
select pg_temp.try('probably on the second ask', $q$select string_agg(pg_temp.names(array[player_id]) || ' ' || pattern::text, ', ') from public.callout_probably(pg_temp.id('a2'))$q$);
reset role;

-- ---------------------------------------------------------------- Choose → lock in (103)
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a03', false); set local role authenticated;
select pg_temp.try('Sam chooses (not his)', $q$select public.callout_ask_choose(pg_temp.id('a1'), '2030-11-02', '11:30', '15:00', 'arvo')::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a02', false); set local role authenticated;
select pg_temp.try('Bo: tee time outside the window', $q$select public.callout_ask_choose(pg_temp.id('a1'), '2030-11-02', '11:30', '15:00', 'arvo', '07:00')::text$q$);
select pg_temp.try('Bo chooses Sat 2 arvo, 1:20pm, Sam booking', $q$select (public.callout_ask_choose(pg_temp.id('a1'), '2030-11-02', '11:30', '15:00', 'arvo', '13:20', null, null, pg_temp.id('sam')) ? 'round_id')::text$q$);
reset role;
select pg_temp.answer(5, false, 'Kurt answers after lock-in', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')));
insert into t_results (label, result) select 'locked', p.status || ' · ' || p.start_date || ' ' || p.tee_time || ' · chosen ' || (p.ask -> 'chosen' ->> 'part') from public.plans p where p.id = pg_temp.id('a1');
insert into t_results (label, result) select 'in / reserve', pg_temp.order_of(pg_temp.id('a1'));
insert into t_results (label, result) select 'round players', pg_temp.round_people(pg_temp.id('a1'));
insert into t_results (label, result) select 'you''re in buzzes', pg_temp.queued(pg_temp.id('a1'), 'callout_in');
insert into t_results (label, result) select 'reserve buzz', pg_temp.queued(pg_temp.id('a1'), 'callout_reserve');
insert into t_results (label, result) select 'booking job', title || ' · ' || pg_temp.names(array[owner_id]) from public.plan_items where plan_id = pg_temp.id('a1') and kind = 'job';

-- ---------------------------------------------------------------- Full → move
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a06', false); set local role authenticated;
select pg_temp.try('Dan moves it (not his)', $q$select public.callout_move(pg_temp.id('a1'), '2030-11-09', '08:00', '11:29', 'morning')::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a03', false); set local role authenticated;
select pg_temp.try('Sam (booking) says full → Sat 9 morning', $q$select public.callout_move(pg_temp.id('a1'), '2030-11-09', '08:00', '11:29', 'morning', '08:40')::text$q$);
reset role;
insert into t_results (label, result) select 'moved', p.start_date || ' ' || p.tee_time || ' · full ' || array_to_string(p.ask_full, ',') || ' · round on ' || r.play_date
  from public.plans p join public.rounds r on r.id = p.round_id where p.id = pg_temp.id('a1');
insert into t_results (label, result) select 'in / reserve after the move', pg_temp.order_of(pg_temp.id('a1'));
insert into t_results (label, result) select 'round players after the move', pg_temp.round_people(pg_temp.id('a1'));
insert into t_results (label, result) select 'told they''re out', pg_temp.queued(pg_temp.id('a1'), 'callout_full');

-- ---------------------------------------------------------------- Booked, easy
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a07', true); set local role authenticated;
select pg_temp.try('Ham says booked (not his)', $q$select public.callout_booked(pg_temp.id('a1'))::text$q$);
select pg_temp.try('Ham: was that easy? 👍', $q$select public.callout_easy(pg_temp.id('a1'), true, 'dead easy')::text$q$);
select pg_temp.try('Ham: again (once only)', $q$select public.callout_easy(pg_temp.id('a1'), false)::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a03', false); set local role authenticated;
select pg_temp.try('Sam says booked', $q$select public.callout_booked(pg_temp.id('a1'))::text$q$);
reset role;
insert into t_results (label, result) select 'booked', (p.booked_at is not null)::text || ' · job done ' || (select bool_and(done)::text from public.plan_items where plan_id = p.id and kind = 'job')
  from public.plans p where p.id = pg_temp.id('a1');
insert into t_results (label, result) select 'Caddie''s inbox', kind || ' · ' || message from public.beta_feedback where path = '/plan/' || pg_temp.id('a1');
update public.rounds set status = 'live' where id = (select round_id from public.plans where id = pg_temp.id('a1'));
insert into t_results (label, result) select 'funnel', string_agg(kind || '=' || n, ' ' order by kind) from (select kind, count(*) n from public.callout_events where plan_id = pg_temp.id('a1') group by kind) x;

-- ---------------------------------------------------------------- Put 2–3 to a vote
select pg_temp.answer(3, false, 'Sam answers ask 2', 'a2', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo'), pg_temp.w('2030-11-09', 'arvo')));
select pg_temp.answer(5, false, 'Kurt answers ask 2', 'a2', jsonb_build_array(pg_temp.w('2030-11-09', 'arvo')));
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a02', false); set local role authenticated;
select pg_temp.try('Bo: one window isn''t a vote', $q$select public.callout_ask_vote(pg_temp.id('a2'), jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')))::text$q$);
select pg_temp.try('Bo puts 2 to a vote', $q$select cardinality(public.callout_ask_vote(pg_temp.id('a2'), jsonb_build_array(pg_temp.w('2030-11-02', 'arvo'), pg_temp.w('2030-11-09', 'arvo'))))::text$q$);
select pg_temp.try('Bo then tries Choose', $q$select public.callout_ask_choose(pg_temp.id('a2'), '2030-11-02', '11:30', '15:00', 'arvo')::text$q$);
reset role;
insert into t_results (label, result) select 'the vote, pre-ticked', string_agg(o.label || ' [' || coalesce(o.part, '-') || '] ✓ ' ||
  coalesce((select pg_temp.names(array_agg(v.player_id order by v.first_yes_at)) from public.plan_votes v where v.option_id = o.id and v.response = 'yes'), '-'), ' | ' order by o.start_date)
  from public.plan_options o join public.plan_polls po on po.id = o.poll_id where po.plan_id = pg_temp.id('a2') and po.kind = 'dates';


-- ---------------------------------------------------------------- The link: answer with no sign-in (anon)
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000011a0a10', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000011a0a11', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a02', false); set local role authenticated;
select pg_temp.try('Bo asks just Sam (an invite list)', $q$with x as (select public.put_round_ask(null, '{"days":["sat"],"parts":[],"range":{"kind":"dates","dates":["2030-11-02"]}}'::jsonb, 4, array[pg_temp.id('sam')]) as id) insert into t_ids select 'a3', id from x returning 'made'$q$);
reset role;
insert into t_ids select 'tok3', null;
create temp table t_tok as select ask_token as t from public.plans where id = pg_temp.id('a3');
grant all on t_tok to anon, authenticated;
create temp table t_key (k text);
grant all on t_key to anon, authenticated;
insert into t_results (label, result) select 'the ask has a 16-letter link', (length(t) = 16)::text from t_tok;
-- anon: no sign-in at all
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.try('anon: a wrong link', $q$select public.ask_public('AAAAAAAAAAAAAAAA')::text$q$);
select pg_temp.try('anon: the link shows the ask', $q$select (x ->> 'by') || ' · ' || coalesce(x ->> 'course', 'course TBC') || ' · ' || (x ->> 'status') || ' · answers ' || jsonb_array_length(x -> 'answers') || ' · member ' || (x ->> 'member') from (select public.ask_public((select t from t_tok)) as x) y$q$);
select pg_temp.try('anon: no email or mobile', $q$select public.ask_guest_answer((select t from t_tok), 'Pete', null, null, jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')))::text$q$);
select pg_temp.try('anon: a bad email', $q$select public.ask_guest_answer((select t from t_tok), 'Pete', 'pete@', null, jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')))::text$q$);
select pg_temp.try('anon: Pete answers Sat 2 arvo', $q$with x as (select public.ask_guest_answer((select t from t_tok), 'Pete Guest', 'Pete@Example.com', null, jsonb_build_array(pg_temp.w('2030-11-02', 'arvo'))) as r)
  insert into t_key select r ->> 'key' from x returning 'key kept'$q$);
select pg_temp.try('anon: Pete changes his answer with his key (same person)', $q$select (public.ask_guest_answer((select t from t_tok), null, null, '0400 000 000', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo'), pg_temp.w('2030-11-02', 'morning')), false, null, (select k from t_key)) ->> 'slots')$q$);
select pg_temp.try('anon: the link with his key shows his answer', $q$select (x -> 'me' ->> 'name') || ' · slots ' || jsonb_array_length(x -> 'me' -> 'answer' -> 'slots') from (select public.ask_public((select t from t_tok), (select k from t_key)) as x) y$q$);
select pg_temp.try('anon: reads the guests table', $q$select count(*)::text from public.callout_guests$q$);
select pg_temp.try('anon: reads players', $q$select count(*)::text from public.players$q$);
select pg_temp.try('anon: Bo''s organiser tools', $q$select count(*)::text from public.ask_contacts(pg_temp.id('a3'))$q$);
reset role;
insert into t_results (label, result) select 'Pete: a player waiting for approval (normal group), on the invite list', p.name || ' · approved ' || p.approved || ' · invited ' ||
  exists (select 1 from public.plan_invites i where i.plan_id = pg_temp.id('a3') and i.player_id = p.id) || ' · ' || g.email || ' / ' || g.phone
  from public.callout_guests g join public.players p on p.id = g.player_id where g.plan_id = pg_temp.id('a3');
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a02', false); set local role authenticated;
select pg_temp.try('Bo sees the contacts', $q$select string_agg(name || ' ' || coalesce(email, '-') || ' ' || coalesce(phone, '-'), ', ') from public.ask_contacts(pg_temp.id('a3'))$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a03', false); set local role authenticated;
select pg_temp.try('Sam (not running it) sees the contacts', $q$select count(*)::text from public.ask_contacts(pg_temp.id('a3'))$q$);
select pg_temp.try('Sam answers Sat 2 arvo', $q$select public.callout_answer(pg_temp.id('a3'), jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')))::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a02', false); set local role authenticated;
select pg_temp.try('Bo answers and chooses Sat 2 arvo', $q$select public.callout_answer(pg_temp.id('a3'), jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')))::text || ' ' || (public.callout_ask_choose(pg_temp.id('a3'), '2030-11-02', '11:30', '15:00', 'arvo', null, pg_temp.id('moore')) ? 'round_id')::text$q$);
reset role;
insert into t_results (label, result) select 'the round includes Pete (answered from the link)', pg_temp.round_people(pg_temp.id('a3'));
select set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
select pg_temp.try('anon: Pete sees he''s in', $q$select (public.ask_public((select t from t_tok), (select k from t_key)) -> 'me' -> 'standing')::text$q$);
reset role;
-- Pete signs in later: the answer becomes his.
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a11', true); set local role authenticated;
select pg_temp.try('phone-only claims Pete''s answer', $q$select public.ask_guest_claim((select t from t_tok), (select k from t_key))::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a10', false); set local role authenticated;
select pg_temp.try('Pete signs in (Google) and claims it', $q$select (public.ask_guest_claim((select t from t_tok), (select k from t_key)) ->> 'plan_id' = pg_temp.id('a3')::text)::text$q$);
select pg_temp.try('a wrong key', $q$select public.ask_guest_claim((select t from t_tok), 'WRONGKEY')::text$q$);
reset role;
insert into t_results (label, result) select 'Pete is in the group now', m.role || ' · ' || p.name from public.group_members m join public.players p on p.id = m.player_id
  where m.user_id = '00000000-0000-4000-8000-0000011a0a10';

-- ---------------------------------------------------------------- No group needed
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a11', true); set local role authenticated;
select pg_temp.try('phone-only starts an ask with no group', $q$select public.start_round_ask('Ann', '{"days":[],"parts":[],"range":{"kind":"next","days":14}}')::text$q$);
reset role;
-- New groups are open on staging (047's switch; on live only platform admins until the friends' beta).
update private.platform_flags set is_on = true where key = 'new_groups_open';
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000011a0a12', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false);
select pg_temp.as_user('00000000-0000-4000-8000-0000011a0a12', false); set local role authenticated;
select pg_temp.try('Ann (signed in, in no group) asks some mates', $q$with x as (select public.start_round_ask('Ann', '{"days":["sat","sun"],"parts":[],"range":{"kind":"next","days":14}}'::jsonb, 4) as r)
  insert into t_ids select 'a4', (r ->> 'plan_id')::uuid from x returning 'made'$q$);
reset role;
insert into t_results (label, result) select 'Ann''s ask', g.name || ' · quick ' || g.quick || ' · organiser ' || (select m.role from public.group_members m where m.group_id = g.id and m.user_id = '00000000-0000-4000-8000-0000011a0a12')
  || ' · ask_* on ' || (select count(*) from public.group_features f where f.group_id = g.id and f.feature_key like 'ask\_%' and f.enabled) || ' · has a link ' || (p.ask_token is not null)
  from public.plans p join public.groups g on g.id = p.group_id where p.id = pg_temp.id('a4');
create temp table t_tok4 as select ask_token as t from public.plans where id = pg_temp.id('a4');
grant all on t_tok4 to anon, authenticated;
select set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
select pg_temp.try('anon: a mate answers Ann''s ask', $q$select (public.ask_guest_answer((select t from t_tok4), 'Mo', null, '0412 345 678', '[]'::jsonb, true) ->> 'slots')$q$);
reset role;
insert into t_results (label, result) select 'Mo: approved straight away (quick group), can''t this round', p.name || ' · approved ' || p.approved || ' · cant ' || a.cant
  from public.callout_answers a join public.players p on p.id = a.player_id where a.plan_id = pg_temp.id('a4');

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
