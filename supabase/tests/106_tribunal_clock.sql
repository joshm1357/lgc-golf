-- 106 test: the Handicap Tribunal's closing time, Feed posts and the clock — the lodged post (charge, before → after,
-- deadline), the closing time from the group's setting, one defence post (updated, not duplicated), the nudge (once,
-- only to people who haven't voted, daytime or the evening before), closing itself at the deadline through the same
-- finalise path (majority; a tie → not guilty), the verdict words, the organiser-decides groups (never auto-closed),
-- moving the closing time (organisers only), another group kept out. Run after 106 (STAGING or a local stand-in only),
-- in ONE transaction (psql -1). Self-contained test group. Rolled back; the results come back as the error message
-- ("RESULTS: ..."). Expected answers in 106_tribunal_clock.expected.txt.
-- Group G: so — saved organiser (So); bo, sam, kurt, dan — saved players; mike (Mike, off 30), chris (Chris, off 27);
-- al — phone-only player (votes, can't lodge); gu — a guest. Group O: oz — its organiser.
-- Run locally on Postgres 16 with every migration 001–106 and Supabase stand-ins (auth, cron, storage), 24 Oct 2026.

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
create function pg_temp.posts(p_case uuid) returns text language sql as $$
  select count(*) || ' · ' || coalesce(string_agg(body, ' / ' order by created_at, body), '-') from public.posts where link = '/tribunal/' || p_case $$;
create function pg_temp.queued(p_kind text) returns text language sql as $$
  select coalesce(string_agg(pl.nickname || ': ' || q.title, ' / ' order by pl.nickname, q.id), '-') from public.notify_queue q
  join public.group_members gm on gm.user_id = q.user_id and gm.group_id = q.group_id join public.players pl on pl.id = gm.player_id
  where q.kind = p_kind and q.url like '#/tribunal/%' $$;
create function pg_temp.c(p_case uuid) returns text language sql as $$
  select status || coalesce(' · ' || verdict, '') || coalesce(' · ' || guilty_votes || '–' || not_guilty_votes, '')
    || case when old_handicap is not null then ' · ' || private.tribunal_hcp(old_handicap) || '→' || private.tribunal_hcp(new_handicap) else '' end
  from public.tribunal_cases where id = p_case $$;

insert into public.groups (id, slug, name, group_pin, admin_pin, quick) values
  ('00000000-0000-4000-8000-00000000f106', 'test-g106', 'Test Group G106', 'G106-CODE-TEST-1', null, false),
  ('00000000-0000-4000-8000-00000000f196', 'test-o106', 'Other Group O106', 'O106-CODE-TEST-1', null, false);
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000006a0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000006a0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000006a0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000006a0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000006a0a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000006a0a06', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000006a0a07', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000006a0a08', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000006a0a09', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000006a0a10', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false);
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000006a0b01', '00000000-0000-4000-8000-00000000f106', 'So Organiser', 'So', 10),
  ('00000000-0000-4000-8000-0000006a0b02', '00000000-0000-4000-8000-00000000f106', 'Bo Red', 'Bo', 12.4),
  ('00000000-0000-4000-8000-0000006a0b03', '00000000-0000-4000-8000-00000000f106', 'Sam Blue', 'Sam', 18),
  ('00000000-0000-4000-8000-0000006a0b04', '00000000-0000-4000-8000-00000000f106', 'Kurt Dahl', 'Kurt', 3),
  ('00000000-0000-4000-8000-0000006a0b05', '00000000-0000-4000-8000-00000000f106', 'Dan Gold', 'Dan', 25),
  ('00000000-0000-4000-8000-0000006a0b06', '00000000-0000-4000-8000-00000000f106', 'Mike Brown', 'Mike', 30),
  ('00000000-0000-4000-8000-0000006a0b07', '00000000-0000-4000-8000-00000000f106', 'Chris Payton', 'Chris', 27),
  ('00000000-0000-4000-8000-0000006a0b08', '00000000-0000-4000-8000-00000000f106', 'Al Green', 'Al', 20),
  ('00000000-0000-4000-8000-0000006a0b09', '00000000-0000-4000-8000-00000000f106', 'Gus Guest', 'Gus', 30),
  ('00000000-0000-4000-8000-0000006a0b10', '00000000-0000-4000-8000-00000000f196', 'Other Person', 'Oz', 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f106', '00000000-0000-4000-8000-0000006a0a01', '00000000-0000-4000-8000-0000006a0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f106', '00000000-0000-4000-8000-0000006a0a02', '00000000-0000-4000-8000-0000006a0b02', 'player'),
  ('00000000-0000-4000-8000-00000000f106', '00000000-0000-4000-8000-0000006a0a03', '00000000-0000-4000-8000-0000006a0b03', 'player'),
  ('00000000-0000-4000-8000-00000000f106', '00000000-0000-4000-8000-0000006a0a04', '00000000-0000-4000-8000-0000006a0b04', 'player'),
  ('00000000-0000-4000-8000-00000000f106', '00000000-0000-4000-8000-0000006a0a05', '00000000-0000-4000-8000-0000006a0b05', 'player'),
  ('00000000-0000-4000-8000-00000000f106', '00000000-0000-4000-8000-0000006a0a06', '00000000-0000-4000-8000-0000006a0b06', 'player'),
  ('00000000-0000-4000-8000-00000000f106', '00000000-0000-4000-8000-0000006a0a07', '00000000-0000-4000-8000-0000006a0b07', 'player'),
  ('00000000-0000-4000-8000-00000000f106', '00000000-0000-4000-8000-0000006a0a08', '00000000-0000-4000-8000-0000006a0b08', 'player'),
  ('00000000-0000-4000-8000-00000000f106', '00000000-0000-4000-8000-0000006a0a09', '00000000-0000-4000-8000-0000006a0b09', 'guest'),
  ('00000000-0000-4000-8000-00000000f196', '00000000-0000-4000-8000-0000006a0a10', '00000000-0000-4000-8000-0000006a0b10', 'organiser');
insert into public.push_subscriptions (endpoint, user_id, player_id, p256dh, auth)
  select 'https://push.test/' || gm.user_id, gm.user_id, gm.player_id, 'k', 'a' from public.group_members gm
  where gm.group_id in ('00000000-0000-4000-8000-00000000f106', '00000000-0000-4000-8000-00000000f196');
insert into t_ids values
  ('so', '00000000-0000-4000-8000-0000006a0b01'), ('bo', '00000000-0000-4000-8000-0000006a0b02'), ('sam', '00000000-0000-4000-8000-0000006a0b03'),
  ('kurt', '00000000-0000-4000-8000-0000006a0b04'), ('dan', '00000000-0000-4000-8000-0000006a0b05'), ('mike', '00000000-0000-4000-8000-0000006a0b06'),
  ('chris', '00000000-0000-4000-8000-0000006a0b07'), ('al', '00000000-0000-4000-8000-0000006a0b08');

-- ---------------------------------------------------------------- Lodging
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a08', true);   -- Al, phone-only (unchanged since 102)
set local role authenticated;
select pg_temp.try('phone-only Al lodges a case', $q$select public.lodge_case(pg_temp.id('mike'), -4, 'Sandbagger', null)::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a02', false);  -- Bo
set local role authenticated;
select pg_temp.try('Bo lodges against Mike (−4)', $q$select 'lodged' from (select public.lodge_case(pg_temp.id('mike'), -4, '  "Hit them far too well!"  ', null) as x) s$q$);
reset role;
insert into t_ids select 'c_mike', id from public.tribunal_cases where accused_id = pg_temp.id('mike');
insert into t_results (label, result) select 'closes 48 hours after lodging (the default)',
  round(extract(epoch from closes_at - created_at) / 3600)::text from public.tribunal_cases where id = pg_temp.id('c_mike');
insert into t_results (label, result) select 'lodged post (deadline masked)',
  regexp_replace(pg_temp.posts(pg_temp.id('c_mike')), 'Vote by [A-Z][a-z]{2} [0-9:]+[ap]m\.', 'Vote by <Dy time>.');
insert into t_results (label, result) select 'the case remembers its post', (lodged_post_id is not null)::text from public.tribunal_cases where id = pg_temp.id('c_mike');

-- The group's Handicap setting "Voting closes after": 24 hours.
update public.governance_settings set close_hours = 24 where group_id = '00000000-0000-4000-8000-00000000f106' and kind = 'handicap';
insert into public.governance_settings (group_id, kind, decides, raise_by, close_hours)
  select '00000000-0000-4000-8000-00000000f106', 'handicap', 'players_majority', 'players', 24
  where not exists (select 1 from public.governance_settings where group_id = '00000000-0000-4000-8000-00000000f106' and kind = 'handicap');
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a03', false);  -- Sam
set local role authenticated;
select pg_temp.try('Sam lodges against Chris (+2)', $q$select 'lodged' from (select public.lodge_case(pg_temp.id('chris'), 2, 'Shot 25 points and blamed the wind for two days. Two days! It was barely a breeze and he brought a jumper.', null) as x) s$q$);
reset role;
insert into t_ids select 'c_chris', id from public.tribunal_cases where accused_id = pg_temp.id('chris');
insert into t_results (label, result) select 'with the group setting at 24 hours',
  round(extract(epoch from closes_at - created_at) / 3600)::text from public.tribunal_cases where id = pg_temp.id('c_chris');

-- Fixed closing times for the rest (Sun 3 Nov 2030, 8pm Sydney), lodged a day earlier.
update public.tribunal_cases set closes_at = timestamptz '2030-11-03 20:00 Australia/Sydney', created_at = timestamptz '2030-11-02 12:00 Australia/Sydney'
  where id in (pg_temp.id('c_mike'), pg_temp.id('c_chris'));
insert into t_results (label, result) select 'lodged words with a fixed deadline', private.tribunal_lodged_words(pg_temp.id('c_mike'));
insert into t_results (label, result) select 'a long charge is trimmed', private.tribunal_lodged_words(pg_temp.id('c_chris'));

-- ---------------------------------------------------------------- The defence
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a03', false);  -- Sam
set local role authenticated;
select pg_temp.try('Sam writes Mike''s defence', $q$select public.set_defence(pg_temp.id('c_mike'), 'Not me')::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a06', false);  -- Mike
set local role authenticated;
select pg_temp.try('Mike writes his defence', $q$select public.set_defence(pg_temp.id('c_mike'), 'Honestly, I got lucky')::text$q$);
select pg_temp.try('Mike changes it', $q$select public.set_defence(pg_temp.id('c_mike'), 'This was a one-off, I got lucky. The greens were slow, the wind was behind me on every hole and I was hungover, which everyone knows helps. Also my caddie was brilliant and I had new grips on.')::text$q$);
reset role;
insert into t_results (label, result) select 'one defence post, updated (lodged post + defence; deadline masked)',
  regexp_replace(pg_temp.posts(pg_temp.id('c_mike')), 'Vote by [A-Z][a-z]{2} [0-9:]+[ap]m\.', 'Vote by <Dy time>.');

-- ---------------------------------------------------------------- Votes and the nudge
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a03', false);  -- Sam
set local role authenticated;
select pg_temp.try('Sam: guilty on Mike', $q$select public.cast_vote(pg_temp.id('c_mike'), 'guilty', null)::text$q$);
select pg_temp.try('Sam: not guilty on Chris', $q$select public.cast_vote(pg_temp.id('c_chris'), 'not_guilty', null)::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a04', false);  -- Kurt
set local role authenticated;
select pg_temp.try('Kurt: guilty on Mike', $q$select public.cast_vote(pg_temp.id('c_mike'), 'guilty', null)::text$q$);
select pg_temp.try('Kurt: guilty on Chris', $q$select public.cast_vote(pg_temp.id('c_chris'), 'guilty', null)::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a08', true);   -- Al, phone-only: can still vote
set local role authenticated;
select pg_temp.try('phone-only Al: not guilty on Mike', $q$select public.cast_vote(pg_temp.id('c_mike'), 'not_guilty', null)::text$q$);
reset role;

insert into t_results (label, result) select 'nudge due? 2am, closing 8pm', private.tribunal_nudge_due(timestamptz '2030-11-03 20:00 Australia/Sydney', timestamptz '2030-11-02 12:00 Australia/Sydney', timestamptz '2030-11-03 02:00 Australia/Sydney')::text;
insert into t_results (label, result) select 'nudge due? 9am close: 7pm the evening before / 2am / 7am',
  private.tribunal_nudge_due(timestamptz '2030-11-04 09:00 Australia/Sydney', timestamptz '2030-11-02 12:00 Australia/Sydney', timestamptz '2030-11-03 19:00 Australia/Sydney')::text || ' / ' ||
  private.tribunal_nudge_due(timestamptz '2030-11-04 09:00 Australia/Sydney', timestamptz '2030-11-02 12:00 Australia/Sydney', timestamptz '2030-11-04 02:00 Australia/Sydney')::text || ' / ' ||
  private.tribunal_nudge_due(timestamptz '2030-11-04 09:00 Australia/Sydney', timestamptz '2030-11-02 12:00 Australia/Sydney', timestamptz '2030-11-04 07:00 Australia/Sydney')::text;
insert into t_results (label, result) select 'tick at 10am (too early)', private.tribunal_tick(timestamptz '2030-11-03 10:00 Australia/Sydney')::text;
insert into t_results (label, result) select 'tick at 4:30pm', private.tribunal_tick(timestamptz '2030-11-03 16:30 Australia/Sydney')::text;
insert into t_results (label, result) select 'nudges: not voters who voted on both, not the accused on their own, not guests, not the other group', pg_temp.queued('case_closing');
insert into t_results (label, result) select 'tick again at 5:30pm (no second nudge)', private.tribunal_tick(timestamptz '2030-11-03 17:30 Australia/Sydney')::text;

-- ---------------------------------------------------------------- It closes itself
insert into t_results (label, result) select 'tick at 8:05pm', private.tribunal_tick(timestamptz '2030-11-03 20:05 Australia/Sydney')::text;
insert into t_results (label, result) select 'Mike''s case', pg_temp.c(pg_temp.id('c_mike'));
insert into t_results (label, result) select 'Mike''s handicap', private.tribunal_hcp(handicap) from public.players where id = pg_temp.id('mike');
insert into t_results (label, result) select 'Mike''s verdict post', (select body from public.posts where link = '/tribunal/' || pg_temp.id('c_mike') order by created_at desc, body limit 1);
insert into t_results (label, result) select 'Chris''s case (a 1–1 tie)', pg_temp.c(pg_temp.id('c_chris'));
insert into t_results (label, result) select 'Chris''s verdict post', (select body from public.posts where link = '/tribunal/' || pg_temp.id('c_chris') and body like '⚖️ NOT GUILTY%');
insert into t_results (label, result) select 'verdict buzzes (count)', (select count(*)::text from public.notify_queue where kind = 'case_verdict');
insert into t_results (label, result) select 'tick again (nothing left)', private.tribunal_tick(timestamptz '2030-11-03 20:15 Australia/Sydney')::text;

-- Verdict words.
insert into t_results (label, result) select 'words: guilty, no defence', private.tribunal_verdict_words('upheld', 3, 1, 'Mike', 30, 26, null, false);
insert into t_results (label, result) select 'words: not guilty with a defence', private.tribunal_verdict_words('dismissed', 1, 2, 'Chris', 27, 27, 'I was injured!', false);
insert into t_results (label, result) select 'words: chair overrules, a long-winded defence', private.tribunal_verdict_words('upheld', 1, 2, 'Bo', 12.4, 10.4, 'The thing is that every single round I play badly except that one', true);

-- ---------------------------------------------------------------- Moving the closing time
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a02', false);  -- Bo
set local role authenticated;
select pg_temp.try('Bo lodges against Dan', $q$select 'lodged' from (select public.lodge_case(pg_temp.id('dan'), -3, 'Two birdies in a row', null) as x) s$q$);
reset role;
insert into t_ids select 'c_dan', id from public.tribunal_cases where accused_id = pg_temp.id('dan');
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a02', false);  -- Bo (a player)
set local role authenticated;
select pg_temp.try('player Bo moves the closing time', $q$select public.set_case_closing(pg_temp.id('c_dan'), now() + interval '2 days')::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a10', false);  -- Oz, another group's organiser
set local role authenticated;
select pg_temp.try('another group''s organiser moves it', $q$select public.set_case_closing(pg_temp.id('c_dan'), now() + interval '2 days')::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a01', false);  -- So, organiser
set local role authenticated;
select pg_temp.try('So: five minutes away', $q$select public.set_case_closing(pg_temp.id('c_dan'), now() + interval '5 minutes')::text$q$);
select pg_temp.try('So: two months away', $q$select public.set_case_closing(pg_temp.id('c_dan'), now() + interval '60 days')::text$q$);
select pg_temp.try('So: Fri 8pm in two weeks', $q$select 'moved' from (select public.set_case_closing(pg_temp.id('c_dan'), (((now() at time zone 'Australia/Sydney')::date + 14 - extract(isodow from (now() at time zone 'Australia/Sydney'))::int + 5) + time '20:00') at time zone 'Australia/Sydney') as x) s$q$);
select pg_temp.try('So: a closed case', $q$select public.set_case_closing(pg_temp.id('c_mike'), now() + interval '2 days')::text$q$);
reset role;
insert into t_results (label, result) select 'the lodged post follows', (select body from public.posts where link = '/tribunal/' || pg_temp.id('c_dan'));

-- ---------------------------------------------------------------- Organiser decides: never auto-closed
update public.governance_settings set decides = 'organiser' where group_id = '00000000-0000-4000-8000-00000000f106' and kind = 'handicap';
update public.tribunal_cases set closes_at = timestamptz '2030-11-10 20:00 Australia/Sydney' where id = pg_temp.id('c_dan');
insert into t_results (label, result) select 'organiser decides: tick after the close', private.tribunal_tick(timestamptz '2030-11-10 20:10 Australia/Sydney')::text;
insert into t_results (label, result) select 'Dan''s case stays open', pg_temp.c(pg_temp.id('c_dan'));
insert into t_results (label, result) select 'organisers told', pg_temp.queued('case_fallback');
insert into t_results (label, result) select 'tick again (told once)', private.tribunal_tick(timestamptz '2030-11-10 21:10 Australia/Sydney')::text;
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a01', false);  -- So closes it, the chair
set local role authenticated;
select pg_temp.try('the chair closes it (overrules: guilty)', $q$select public.chair_close_case(pg_temp.id('c_dan'), 'upheld', 'Two birdies is two too many')::text$q$);
reset role;
insert into t_results (label, result) select 'Dan''s verdict post', (select body from public.posts where link = '/tribunal/' || pg_temp.id('c_dan') and body like '⚖️ GUILTY%');

-- ---------------------------------------------------------------- Reading, and words
select pg_temp.as_user('00000000-0000-4000-8000-0000006a0a10', false);  -- Oz, another group
set local role authenticated;
select pg_temp.try('another group reads the cases', $q$select count(*)::text from public.tribunal_cases where group_id = '00000000-0000-4000-8000-00000000f106'$q$);
reset role;
insert into t_results (label, result) select 'clock words', private.tribunal_clock(timestamptz '2030-11-03 20:00 Australia/Sydney') || ' | ' ||
  private.tribunal_clock(timestamptz '2030-11-09 07:30 Australia/Sydney') || ' | ' ||
  private.tribunal_when(timestamptz '2030-11-03 20:00 Australia/Sydney', timestamptz '2030-11-03 16:00 Australia/Sydney') || ' | ' ||
  private.tribunal_when(timestamptz '2030-11-04 09:00 Australia/Sydney', timestamptz '2030-11-03 19:00 Australia/Sydney') || ' | ' ||
  private.tribunal_when(timestamptz '2030-11-08 20:00 Australia/Sydney', timestamptz '2030-11-03 19:00 Australia/Sydney');
insert into t_results (label, result) select 'handicap words', private.tribunal_hcp(30) || ' ' || private.tribunal_hcp(12.4) || ' ' || private.tribunal_hcp(-1);

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
