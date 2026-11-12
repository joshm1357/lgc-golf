-- 112 test: v2.1 — maybe squares (kept, shown, never counted), the 4-ball ready rule with max players as a cap, the
-- AI use log is server-only, and the link-safe lookups (places, courses near) need a real ask token.
-- Run on STAGING after 111 and 112. Self-contained; rolled back; results come back as the error message.
-- (setup copied from the 111 test) "Anyone keen for a round?" v2 — ask, answer (windows, can't, reply order), who can answer, the best
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
  ('00000000-0000-4000-8000-00000000f112', 'test-g112', 'Test Group G112', 'G112-CODE-TEST-1', null, false),
  ('00000000-0000-4000-8000-00000000f192', 'test-o112', 'Other Group O112', 'O112-CODE-TEST-1', null, false);
insert into auth.users (id, instance_id, aud, role, is_anonymous)
  select ('00000000-0000-4000-8000-0000012a0a0' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n in (4, 7)
  from generate_series(1, 9) n;
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000012a0b01', '00000000-0000-4000-8000-00000000f112', 'So Organiser', 'So', 10),
  ('00000000-0000-4000-8000-0000012a0b02', '00000000-0000-4000-8000-00000000f112', 'Bo Red', 'Bo', 12),
  ('00000000-0000-4000-8000-0000012a0b03', '00000000-0000-4000-8000-00000000f112', 'Sam Blue', 'Sam', 18),
  ('00000000-0000-4000-8000-0000012a0b04', '00000000-0000-4000-8000-00000000f112', 'Al Green', 'Al', 20),
  ('00000000-0000-4000-8000-0000012a0b05', '00000000-0000-4000-8000-00000000f112', 'Kurt Dahl', 'Kurt', 3),
  ('00000000-0000-4000-8000-0000012a0b06', '00000000-0000-4000-8000-00000000f112', 'Dan Gold', 'Dan', 25),
  ('00000000-0000-4000-8000-0000012a0b07', '00000000-0000-4000-8000-00000000f112', 'Hamish Grey', 'Ham', 15),
  ('00000000-0000-4000-8000-0000012a0b08', '00000000-0000-4000-8000-00000000f112', 'Gus Guest', 'Gus', 30),
  ('00000000-0000-4000-8000-0000012a0b09', '00000000-0000-4000-8000-00000000f192', 'Other Person', 'Oz', 9);
insert into public.group_members (group_id, user_id, player_id, role)
  select case when n = 9 then '00000000-0000-4000-8000-00000000f192' else '00000000-0000-4000-8000-00000000f112' end::uuid,
         ('00000000-0000-4000-8000-0000012a0a0' || n)::uuid, ('00000000-0000-4000-8000-0000012a0b0' || n)::uuid,
         case when n in (1, 9) then 'organiser' when n = 8 then 'guest' else 'player' end
  from generate_series(1, 9) n;
insert into public.push_subscriptions (endpoint, user_id, player_id, p256dh, auth)
  select 'https://push.test/' || gm.user_id, gm.user_id, gm.player_id, 'k', 'a' from public.group_members gm
  where gm.group_id in ('00000000-0000-4000-8000-00000000f112', '00000000-0000-4000-8000-00000000f192');
insert into public.courses (id, group_id, name, holes) values
  ('00000000-0000-4000-8000-0000012a0c01', '00000000-0000-4000-8000-00000000f112', 'Moore Park', '[{"n":1,"par":4,"si":1}]');
insert into t_ids values
  ('so', '00000000-0000-4000-8000-0000012a0b01'), ('bo', '00000000-0000-4000-8000-0000012a0b02'), ('sam', '00000000-0000-4000-8000-0000012a0b03'),
  ('al', '00000000-0000-4000-8000-0000012a0b04'), ('kurt', '00000000-0000-4000-8000-0000012a0b05'), ('dan', '00000000-0000-4000-8000-0000012a0b06'),
  ('ham', '00000000-0000-4000-8000-0000012a0b07'), ('gus', '00000000-0000-4000-8000-0000012a0b08'), ('moore', '00000000-0000-4000-8000-0000012a0c01');

create function pg_temp.answer(p_n int, p_anon boolean, p_who text, p_plan text, p_slots jsonb, p_cant boolean default false, p_usual jsonb default null) returns void language plpgsql as $$
begin
  perform pg_temp.as_user('00000000-0000-4000-8000-0000012a0a0' || p_n, p_anon);
  set local role authenticated;
  perform pg_temp.try(p_who || ' answers', format('select public.callout_answer(%L, %L::jsonb, %L, %L::jsonb, %L::jsonb)::text',
    pg_temp.id(p_plan), p_slots, p_cant, '{"any": true, "courses": [], "wishes": ["nine_ok"]}', p_usual));
  reset role;
end $$;


-- ---------------------------------------------------------------- Ask: every day, any time, 4 weeks, no group size
select pg_temp.as_user('00000000-0000-4000-8000-0000012a0a02', false);  -- Bo
set local role authenticated;
select pg_temp.try('Bo asks: two Saturdays, any time, no max', $q$
  with x as (select public.put_round_ask(null, '{"days":[],"parts":[],"range":{"kind":"dates","dates":["2030-11-02","2030-11-09"]},"times":[]}'::jsonb,
    null, null, now() + interval '2 days', null, pg_temp.id('moore')) as id) insert into t_ids select 'a1', id from x returning 'made'$q$);
select pg_temp.try('Bo asks again with max 5 players', $q$
  with x as (select public.put_round_ask(null, '{"days":[],"parts":[],"range":{"kind":"dates","dates":["2030-11-16"]},"times":[]}'::jsonb,
    5, null, now() + interval '2 days', null, pg_temp.id('moore')) as id) insert into t_ids select 'a2', id from x returning 'made'$q$);
reset role;
insert into t_results (label, result) select 'spots (none = no cap)', coalesce(spots::text, 'none') from public.plans where id = pg_temp.id('a1');

-- ---------------------------------------------------------------- Answers: ✓ and ? (maybe)
-- Sam ✓ Sat 2 arvo, ? Sat 2 morning. Kurt ✓ Sat 2 arvo. Al ? Sat 2 arvo only. Ham ✓ Sat 2 arvo.
select pg_temp.answer(3, false, 'Sam', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo'), pg_temp.w('2030-11-02', 'morning') || '{"maybe":true}'));
select pg_temp.answer(5, false, 'Kurt', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')));
select pg_temp.answer(4, true, 'Al (all maybe)', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo') || '{"maybe":true}'));
select pg_temp.answer(7, true, 'Ham', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')));
select pg_temp.answer(6, false, 'Dan: "maybe" as a string is not a maybe', 'a1', jsonb_build_array(pg_temp.w('2030-11-09', 'arvo') || '{"maybe":"yes"}'));
insert into t_results (label, result) select 'Sam''s maybe kept', (select string_agg((s ->> 'part') || ':' || coalesce(s ->> 'maybe', 'yes'), ',' order by s ->> 'part')
  from jsonb_array_elements(slots) s) from public.callout_answers where plan_id = pg_temp.id('a1') and player_id = pg_temp.id('sam');
insert into t_results (label, result) select 'can: Sat 2 arvo (✓ only)', pg_temp.names(private.ask_can(pg_temp.id('a1'), '2030-11-02', '11:30', '15:00'));
insert into t_results (label, result) select 'can: Sat 2 morning (only a maybe)', pg_temp.names(private.ask_can(pg_temp.id('a1'), '2030-11-02', '08:00', '11:29'));
insert into t_results (label, result) select 'can: Sat 9 arvo (Dan, not a real maybe)', pg_temp.names(private.ask_can(pg_temp.id('a1'), '2030-11-09', '11:30', '15:00'));
insert into t_results (label, result) select 'best so far', b.o_date || ' ' || b.o_part || ' · ' || b.o_n from private.ask_best(pg_temp.id('a1')) b;

-- ---------------------------------------------------------------- Ready: 3 ✓ + 1 maybe is not a 4-ball
select private.callout_ask_tick(now());
insert into t_results (label, result) select 'ready card at 3 can + 1 maybe', pg_temp.queued(pg_temp.id('a1'), 'callout_lockit');
select pg_temp.answer(2, false, 'Bo', 'a1', jsonb_build_array(pg_temp.w('2030-11-02', 'arvo')));
select private.callout_ask_tick(now());
insert into t_results (label, result) select 'ready card at 4 can', pg_temp.queued(pg_temp.id('a1'), 'callout_lockit');
-- max 5 is a cap, not a target: 4 ✓ still fires the card
select pg_temp.answer(3, false, 'Sam on a2', 'a2', jsonb_build_array(pg_temp.w('2030-11-16', 'arvo')));
select pg_temp.answer(5, false, 'Kurt on a2', 'a2', jsonb_build_array(pg_temp.w('2030-11-16', 'arvo')));
select pg_temp.answer(7, true, 'Ham on a2', 'a2', jsonb_build_array(pg_temp.w('2030-11-16', 'arvo')));
select pg_temp.answer(2, false, 'Bo on a2', 'a2', jsonb_build_array(pg_temp.w('2030-11-16', 'arvo')));
select private.callout_ask_tick(now());
insert into t_results (label, result) select 'a2 (max 5): ready at 4', pg_temp.queued(pg_temp.id('a2'), 'callout_lockit');

-- ---------------------------------------------------------------- Vote: maybes aren't ticked
select pg_temp.as_user('00000000-0000-4000-8000-0000012a0a02', false); set local role authenticated;
select pg_temp.try('Bo puts Sat 2 arvo + morning to a vote', format($q$select cardinality(public.callout_ask_vote(%L, jsonb_build_array(pg_temp.w('2030-11-02', 'arvo'), pg_temp.w('2030-11-02', 'morning'))))::text$q$, pg_temp.id('a1')));
reset role;
insert into t_results (label, result) select 'vote ticks', (select string_agg(o.label || ': ' || coalesce((select string_agg(pl.nickname, ',' order by pl.nickname) from public.plan_votes v join public.players pl on pl.id = v.player_id where v.option_id = o.id and v.response = 'yes'), '-'), ' / ' order by o.start_date, o.label)
  from public.plan_options o join public.plan_polls po on po.id = o.poll_id where po.plan_id = pg_temp.id('a1'));

-- ---------------------------------------------------------------- AI log is server only
select pg_temp.as_user('00000000-0000-4000-8000-0000012a0a02', false); set local role authenticated;
select pg_temp.try('Bo reads the AI log', $q$select count(*)::text from public.ask_ai_uses$q$);
select pg_temp.try('Bo writes the AI log', format($q$insert into public.ask_ai_uses (plan_id, who) values (%L, 'u:bo') returning 'x'$q$, pg_temp.id('a1')));
reset role;

-- ---------------------------------------------------------------- Link-safe lookups (anon, no sign-in)
create temp table t_tok as select ask_token as t from public.plans where id = pg_temp.id('a1');
grant all on t_tok to anon, authenticated;
select set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
select pg_temp.try('anon: places with the link', $q$select count(*)::text from public.ask_places((select t from t_tok), 'Ryde')$q$);
select pg_temp.try('anon: places, a made-up token', $q$select count(*)::text from public.ask_places('AAAAAAAAAAAAAAAA', 'Ryde')$q$);
select pg_temp.try('anon: courses near Leichhardt with the link', $q$select (count(*) > 0 and bool_and(lat is not null))::text from public.ask_courses_near((select t from t_tok), -33.88, 151.16, 8)$q$);
select pg_temp.try('anon: courses near, a made-up token', $q$select count(*)::text from public.ask_courses_near('AAAAAAAAAAAAAAAA', -33.88, 151.16)$q$);
select pg_temp.try('anon: courses near, no point', $q$select count(*)::text from public.ask_courses_near((select t from t_tok), null, null)$q$);
select pg_temp.try('anon: find_courses directly (still refused)', $q$select count(*)::text from public.find_courses('', -33.88, 151.16, 5)$q$);
reset role;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
