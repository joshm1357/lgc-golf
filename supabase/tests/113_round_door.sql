-- 113 test: the round door (ov44). The door switch and the invite-only lock, "Make it official" refused, the link's
-- preview (outline only — no contacts, no answers), the share picture, who sees a link answerer's contacts (not the
-- booker, not another group), the per-connection limit on new link answers, weather / quick on the link, the door
-- counts (anyone adds, only Josh reads), and the tidy-up of a hidden group that went nowhere.
-- Run on STAGING after 111, 112 and 113. Self-contained; rolled back; results come back as the error message.
-- People: sid — a stranger with a saved account (no group); mate — another saved stranger; so — organiser of group G;
-- bo — a player in G who puts an ask out; kurt — a player in G who ends up booking; oz — organiser of another group;
-- boss — a platform admin (Josh).

create temp table t_results (n serial, label text, result text);
grant all on t_results to anon, authenticated;
grant all on sequence t_results_n_seq to anon, authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to anon, authenticated;
create temp table t_txt (k text primary key, v text);
grant all on t_txt to anon, authenticated;

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
create function pg_temp.as_nobody() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"anon"}', true) $$;
grant execute on function pg_temp.as_nobody() to anon, authenticated;
create function pg_temp.from_ip(p_ip text, p_group uuid default null) returns void language sql as $$
  select set_config('request.headers', json_strip_nulls(json_build_object('sb-forwarded-for', p_ip, 'x-group-id', p_group))::text, true) $$;
grant execute on function pg_temp.from_ip(text, uuid) to anon, authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
grant execute on function pg_temp.id(text) to anon, authenticated;
create function pg_temp.txt(p_k text) returns text language sql as $$ select v from t_txt where k = p_k $$;
grant execute on function pg_temp.txt(text) to anon, authenticated;
create function pg_temp.u(p_n int) returns text language sql as $$ select '00000000-0000-4000-8000-0000013a0a0' || p_n $$;
grant execute on function pg_temp.u(int) to anon, authenticated;

insert into auth.users (id, instance_id, aud, role, is_anonymous)
  select pg_temp.u(n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false from generate_series(1, 7) n;
-- 1 sid, 2 mate, 3 so, 4 bo, 5 kurt, 6 oz, 7 boss
insert into public.platform_admins (user_id) values (pg_temp.u(7)::uuid);
insert into public.groups (id, slug, name, group_pin, admin_pin, quick) values
  ('00000000-0000-4000-8000-00000000f113', 'test-g113', 'Test Group G113', 'G113-CODE-TEST-1', null, false),
  ('00000000-0000-4000-8000-00000000f193', 'test-o113', 'Other Group O113', 'O113-CODE-TEST-1', null, false);
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000013a0b03', '00000000-0000-4000-8000-00000000f113', 'So Organiser', 'So', 10),
  ('00000000-0000-4000-8000-0000013a0b04', '00000000-0000-4000-8000-00000000f113', 'Bo Red', 'Bo', 12),
  ('00000000-0000-4000-8000-0000013a0b05', '00000000-0000-4000-8000-00000000f113', 'Kurt Dahl', 'Kurt', 3),
  ('00000000-0000-4000-8000-0000013a0b06', '00000000-0000-4000-8000-00000000f193', 'Other Person', 'Oz', 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f113', pg_temp.u(3)::uuid, '00000000-0000-4000-8000-0000013a0b03', 'organiser'),
  ('00000000-0000-4000-8000-00000000f113', pg_temp.u(4)::uuid, '00000000-0000-4000-8000-0000013a0b04', 'player'),
  ('00000000-0000-4000-8000-00000000f113', pg_temp.u(5)::uuid, '00000000-0000-4000-8000-0000013a0b05', 'player'),
  ('00000000-0000-4000-8000-00000000f193', pg_temp.u(6)::uuid, '00000000-0000-4000-8000-0000013a0b06', 'organiser');
insert into public.group_features (group_id, feature_key, enabled) values
  ('00000000-0000-4000-8000-00000000f113', 'weather', false)
  on conflict (group_id, feature_key) do update set enabled = false;
insert into t_ids values ('g', '00000000-0000-4000-8000-00000000f113'), ('kurt', '00000000-0000-4000-8000-0000013a0b05');

-- ---------------------------------------------------------------- 1. The door: both switches off
update private.platform_flags set is_on = false where key in ('new_groups_open', 'round_asks_open');
select pg_temp.as_user(pg_temp.u(1), false); set local role authenticated;
select pg_temp.try('door shut: the app is told', $q$select public.round_asks_open()::text$q$);
select pg_temp.try('door shut: Sid asks some mates', $q$select public.start_round_ask('Sid', '{"days":[],"parts":[],"range":{"kind":"next","days":28},"times":[]}'::jsonb, null, now() + interval '2 days') ->> 'token'$q$);
reset role;

-- ---------------------------------------------------------------- 2. The round door open; groups still invite-only
update private.platform_flags set is_on = true where key = 'round_asks_open';
select pg_temp.as_user(pg_temp.u(1), false); set local role authenticated;
select pg_temp.try('round door open: the app is told', $q$select public.round_asks_open()::text$q$);
select pg_temp.try('groups still shut: the app is told', $q$select public.new_groups_open()::text$q$);
select pg_temp.try('round door open: Sid asks some mates', $q$
  with x as (select public.start_round_ask('Sid', '{"days":[],"parts":[],"range":{"kind":"next","days":28},"times":[],"place":{"lat":-31.9,"lng":115.9,"name":"Perth","src":"zone"}}'::jsonb, null, now() + interval '2 days') as r),
       a as (insert into t_ids select 'sg', (r ->> 'group_id')::uuid from x returning 1),
       b as (insert into t_ids select 'sp', (r ->> 'plan_id')::uuid from x returning 1),
       c as (insert into t_txt select 'tok', r ->> 'token' from x returning 1)
  select 'made' from a, b, c$q$);
reset role;
insert into t_results (label, result) select 'Sid''s hidden group: quick, weather on', quick::text || ', ' || public.feature_on(id, 'weather')::text from public.groups where id = pg_temp.id('sg');
insert into t_results (label, result) select 'the place is kept inside the ask', ask -> 'place' ->> 'name' from public.plans where id = pg_temp.id('sp');
-- The lock itself (as the database owner, but signed in as Sid — the lock looks at who's signed in).
select pg_temp.try('lock: a proper group', $q$insert into public.groups (slug, name, group_pin, quick) values ('test-x113a', 'X', 'X113-CODE-TEST-A', false) returning 'made'$q$);
select pg_temp.try('lock: a quick group that isn''t a round ask (a quick round)', $q$insert into public.groups (slug, name, group_pin, quick) values ('test-x113b', 'X', 'X113-CODE-TEST-B', true) returning 'made'$q$);
select set_config('lgc.round_ask', 'on', true);
select pg_temp.try('lock: a proper group claiming to be a round ask', $q$insert into public.groups (slug, name, group_pin, quick) values ('test-x113c', 'X', 'X113-CODE-TEST-C', false) returning 'made'$q$);
select set_config('lgc.round_ask', 'off', true);
select pg_temp.from_ip('198.51.100.1', pg_temp.id('sg'));
set local role authenticated;
select pg_temp.try('Sid: Make it official (a back way to a group)', $q$select public.make_group_official()::text$q$);
reset role;
insert into t_results (label, result) select 'Sid''s group still hidden', quick::text from public.groups where id = pg_temp.id('sg');

-- ---------------------------------------------------------------- 3. The link's preview (no sign-in)
select pg_temp.as_nobody(); set local role anon;
select pg_temp.try('anon: preview keys', $q$select (select string_agg(k, ',' order by k) from jsonb_object_keys(public.ask_preview(pg_temp.txt('tok'))) k)$q$);
select pg_temp.try('anon: preview says', $q$select (p ->> 'by') || ' · ' || (p ->> 'status') || ' · place ' || coalesce(p -> 'ask' ->> 'place', 'left out') || ' · range ' || (p -> 'ask' -> 'range' ->> 'days') from (select public.ask_preview(pg_temp.txt('tok')) p) x$q$);
select pg_temp.try('anon: preview, lower case and spaces', $q$select (public.ask_preview(' ' || lower(pg_temp.txt('tok')) || ' ') is not null)::text$q$);
select pg_temp.try('anon: preview, a made-up token', $q$select coalesce(public.ask_preview('AAAAAAAAAAAAAAAA')::text, 'nothing')$q$);
select pg_temp.try('anon: preview, rubbish', $q$select coalesce(public.ask_preview(''' or 1=1 --')::text, 'nothing')$q$);
select pg_temp.try('anon: set a picture', format($q$select public.ask_set_card(%L, 'https://x.supabase.co/storage/v1/object/public/photos/g/asks/1.jpg')::text$q$, pg_temp.id('sp')));
reset role;

-- The share picture: whoever asked, one of our photo addresses only.
select pg_temp.as_user(pg_temp.u(1), false); set local role authenticated;
select pg_temp.try('Sid sets the picture', format($q$select public.ask_set_card(%L, 'https://x.supabase.co/storage/v1/object/public/photos/g/asks/1.jpg')::text$q$, pg_temp.id('sp')));
select pg_temp.try('Sid sets a picture from somewhere else', format($q$select public.ask_set_card(%L, 'https://evil.example/x.jpg')::text$q$, pg_temp.id('sp')));
reset role;
select pg_temp.as_user(pg_temp.u(2), false); set local role authenticated;
select pg_temp.try('Mate (not in it) sets the picture', format($q$select public.ask_set_card(%L, 'https://x.supabase.co/storage/v1/object/public/photos/g/asks/2.jpg')::text$q$, pg_temp.id('sp')));
reset role;
select pg_temp.as_nobody(); set local role anon;
select pg_temp.try('anon: preview has the picture', $q$select public.ask_preview(pg_temp.txt('tok')) ->> 'card_url'$q$);
reset role;

-- ---------------------------------------------------------------- 4. Link answers: the per-connection limit
select pg_temp.as_nobody();
select pg_temp.from_ip('203.0.113.9');
set local role anon;
select pg_temp.try('link answer 1 (keeps its key)', $q$
  with x as (select public.ask_guest_answer(pg_temp.txt('tok'), 'Ann', 'ann@example.com', null, '[{"date":"2030-11-02","from":"11:30","to":"15:00","part":"arvo"}]'::jsonb) as r),
       k as (insert into t_txt select 'key1', r ->> 'key' from x returning 1) select 'sent' from k$q$);
select pg_temp.try('link answers 2–6 from the same connection', $q$
  select count(public.ask_guest_answer(pg_temp.txt('tok'), 'G' || n, null, '0400 000 00' || n, '[{"date":"2030-11-02","from":"11:30","to":"15:00","part":"arvo"}]'::jsonb))::text from generate_series(2, 6) n$q$);
select pg_temp.try('link answer 7 from the same connection', $q$select (public.ask_guest_answer(pg_temp.txt('tok'), 'G7', 'g7@example.com', null, '[{"date":"2030-11-02","from":"11:30","to":"15:00","part":"arvo"}]'::jsonb) ->> 'slots')$q$);
select pg_temp.try('Ann changes her own answer (never limited)', $q$select (public.ask_guest_answer(pg_temp.txt('tok'), null, null, null, '[{"date":"2030-11-02","from":"08:00","to":"11:29","part":"morning"}]'::jsonb, false, null, pg_temp.txt('key1')) ->> 'slots')$q$);
reset role;
select pg_temp.from_ip('203.0.113.77');
set local role anon;
select pg_temp.try('a new answer from another connection', $q$select (public.ask_guest_answer(pg_temp.txt('tok'), 'Zed', 'zed@example.com', null, '[{"date":"2030-11-02","from":"11:30","to":"15:00","part":"arvo"}]'::jsonb) ->> 'slots')$q$);
select pg_temp.try('anon reads the connection marks', $q$select count(*)::text from private.ask_link_marks$q$);
reset role;
insert into t_results (label, result) select 'what''s kept about a connection', (select string_agg(n::text || ' answers, mark of ' || length(mark) || ' letters', ' / ' order by n desc) from private.ask_link_marks where plan_id = pg_temp.id('sp'));
insert into t_results (label, result) select 'link answers on Sid''s ask', count(*)::text from public.callout_guests where plan_id = pg_temp.id('sp');

-- ---------------------------------------------------------------- 5. The link: quick / weather; never contacts
select pg_temp.as_nobody(); set local role anon;
select pg_temp.try('anon: the link says quick + weather', $q$select (p ->> 'quick') || ', ' || (p ->> 'weather') from (select public.ask_public(pg_temp.txt('tok')) p) x$q$);
select pg_temp.try('anon: the link never has contacts', $q$select (public.ask_public(pg_temp.txt('tok'))::text !~ 'example\.com|0400')::text$q$);
select pg_temp.try('anon: the preview never has contacts or names of who answered', $q$select (public.ask_preview(pg_temp.txt('tok'))::text !~ 'example\.com|0400|Ann|Zed')::text$q$);
select pg_temp.try('anon: Ann sees her own contact with her key', $q$select public.ask_public(pg_temp.txt('tok'), pg_temp.txt('key1')) -> 'me' ->> 'email'$q$);
select pg_temp.try('anon: contacts', format($q$select count(*)::text from public.ask_contacts(%L)$q$, pg_temp.id('sp')));
reset role;

-- ---------------------------------------------------------------- 6. Who sees contacts
select pg_temp.as_user(pg_temp.u(1), false); set local role authenticated;
select pg_temp.try('Sid (asked) sees contacts', format($q$select count(*)::text || ' incl. ' || max(email) from public.ask_contacts(%L)$q$, pg_temp.id('sp')));
reset role;
select pg_temp.as_user(pg_temp.u(2), false); set local role authenticated;
select pg_temp.try('Mate (a stranger) sees contacts', format($q$select count(*)::text from public.ask_contacts(%L)$q$, pg_temp.id('sp')));
reset role;
-- In a proper group: Bo asks, someone answers by link, Kurt takes the booking.
select pg_temp.as_user(pg_temp.u(4), false); select pg_temp.from_ip('198.51.100.4', pg_temp.id('g')); set local role authenticated;
select pg_temp.try('Bo asks in group G', $q$
  with x as (select public.put_round_ask(null, '{"days":[],"parts":[],"range":{"kind":"dates","dates":["2030-11-02"]},"times":[]}'::jsonb, null, null, now() + interval '2 days') as id),
       a as (insert into t_ids select 'gp', id from x returning 1) select 'made' from a$q$);
reset role;
insert into t_txt select 'gtok', ask_token from public.plans where id = pg_temp.id('gp');
select pg_temp.as_nobody(); select pg_temp.from_ip('203.0.113.50'); set local role anon;
select pg_temp.try('a link answer on Bo''s ask', $q$select (public.ask_guest_answer(pg_temp.txt('gtok'), 'Lee', 'lee@example.com', null, '[{"date":"2030-11-02","from":"11:30","to":"15:00","part":"arvo"}]'::jsonb) ->> 'slots')$q$);
select pg_temp.try('anon: group G''s link says quick + weather (its switch is off)', $q$select (p ->> 'quick') || ', ' || (p ->> 'weather') from (select public.ask_public(pg_temp.txt('gtok')) p) x$q$);
reset role;
update public.plans set booker_id = pg_temp.id('kurt') where id = pg_temp.id('gp');
select pg_temp.as_user(pg_temp.u(4), false); select pg_temp.from_ip('198.51.100.4', pg_temp.id('g')); set local role authenticated;
select pg_temp.try('Bo (asked) sees contacts', format($q$select count(*)::text from public.ask_contacts(%L)$q$, pg_temp.id('gp')));
reset role;
select pg_temp.as_user(pg_temp.u(3), false); set local role authenticated;
select pg_temp.try('So (the group''s organiser) sees contacts', format($q$select count(*)::text from public.ask_contacts(%L)$q$, pg_temp.id('gp')));
reset role;
select pg_temp.as_user(pg_temp.u(5), false); set local role authenticated;
select pg_temp.try('Kurt (booking it) sees contacts', format($q$select count(*)::text from public.ask_contacts(%L)$q$, pg_temp.id('gp')));
select pg_temp.try('Kurt sets the picture', format($q$select public.ask_set_card(%L, 'https://x.supabase.co/storage/v1/object/public/photos/g/asks/3.jpg')::text$q$, pg_temp.id('gp')));
reset role;
-- Another group: nothing, through any of the new functions.
select pg_temp.as_user(pg_temp.u(6), false); set local role authenticated;
select pg_temp.try('Oz (another group) sees contacts', format($q$select count(*)::text from public.ask_contacts(%L)$q$, pg_temp.id('gp')));
select pg_temp.try('Oz sets the picture on Bo''s ask', format($q$select public.ask_set_card(%L, 'https://x.supabase.co/storage/v1/object/public/photos/g/asks/4.jpg')::text$q$, pg_temp.id('gp')));
select pg_temp.try('Oz reads Bo''s ask''s answers', format($q$select count(*)::text from public.callout_answers where plan_id = %L$q$, pg_temp.id('gp')));
select pg_temp.try('Oz reads the link answerers', $q$select count(*)::text from public.callout_guests$q$);
select pg_temp.try('Oz reads the door funnel', $q$select public.admin_door_funnel(30)::text$q$);
reset role;

-- ---------------------------------------------------------------- 7. Counting the door
delete from public.door_counts where day = current_date;   -- (rolled back) so the counts below are this test's own
select pg_temp.as_nobody(); select pg_temp.from_ip('203.0.113.200'); set local role anon;
select pg_temp.try('anon counts: opened ×2 from the website, built ×1', $q$select count(public.door_count(s, 'web-home'))::text from unnest(array['opened', 'opened', 'built']) s$q$);
select pg_temp.try('anon counts: a made-up step, a bad source', $q$select count(public.door_count(s, src))::text from (values ('hacked', 'web-home'), ('shared', 'Not A Tag!')) v(s, src)$q$);
select pg_temp.try('anon reads the counts', $q$select count(*)::text from public.door_counts$q$);
select pg_temp.try('anon reads the funnel', $q$select public.admin_door_funnel(30)::text$q$);
select pg_temp.try('one connection, 70 more', $q$select count(public.door_count('opened', 'spam'))::text from generate_series(1, 70)$q$);
reset role;
insert into t_results (label, result) select 'today''s counts', string_agg(step || '/' || source || '=' || n, ', ' order by step, source) from public.door_counts where day = current_date;
select pg_temp.as_user(pg_temp.u(7), false); set local role authenticated;
select pg_temp.try('Josh reads the funnel: counts', $q$select (f -> 'counts')::text from (select public.admin_door_funnel(1) f) x$q$);
select pg_temp.try('Josh reads the funnel: no-group asks today', $q$select ((f -> 'asks' ->> 'asks')::int >= 1)::text || ', first reply ' || ((f -> 'asks' ->> 'first_reply')::int >= 1)::text from (select public.admin_door_funnel(1) f) x$q$);
reset role;

-- ---------------------------------------------------------------- 8. Tidy-up
-- Sid's ask (answered by link) made to look years old; and a second hidden group of Sid's that nobody answered.
select pg_temp.as_user(pg_temp.u(1), false); set local role authenticated;
select pg_temp.try('Sid asks again (nobody will answer)', $q$
  with x as (select public.start_round_ask('Sid', '{"days":[],"parts":[],"range":{"kind":"next","days":28},"times":[]}'::jsonb, null, now() + interval '2 days') as r),
       a as (insert into t_ids select 'sg2', (r ->> 'group_id')::uuid from x returning 1) select 'made' from a$q$);
reset role;
select set_config('request.jwt.claims', '', true);
update public.groups set created_at = '1999-01-01' where id = pg_temp.id('sg');
update public.plans set created_at = '1999-01-01', closes_at = '1999-01-03' where group_id = pg_temp.id('sg');
update public.groups set created_at = '2000-01-01' where id = pg_temp.id('sg2');
update public.plans set created_at = '2000-01-01', closes_at = '2000-01-03' where group_id = pg_temp.id('sg2');
insert into t_results (label, result) select 'tidy-up: groups deleted (oldest one that went nowhere)', private.round_door_tidy(now(), 1)::text;
insert into t_results (label, result) select 'the answered one (older) is kept', exists (select 1 from public.groups where id = pg_temp.id('sg'))::text;
insert into t_results (label, result) select 'the one nobody answered is gone, with its ask', (not exists (select 1 from public.groups where id = pg_temp.id('sg2')))::text || ', ' || (not exists (select 1 from public.plans where group_id = pg_temp.id('sg2')))::text;
insert into t_results (label, result) select 'Sid''s account is untouched', exists (select 1 from auth.users where id = pg_temp.u(1)::uuid)::text;
insert into t_results (label, result) select 'a proper group is never tidied', exists (select 1 from public.groups where id = pg_temp.id('g'))::text;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
