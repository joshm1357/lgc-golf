-- 105 test: the Weekend Recap. The organiser writes a trip's recap (as the ai-helper does, with their own sign-in);
-- players read it but can't write it; odd scripts are refused by the table; only publish_trip_recap sets the Feed post;
-- publishing twice updates the one post; switched off = refused; another group is shut out.
-- STAGING only, after 105. Self-contained test groups. Rolled back; the results come back as the error message
-- ("RESULTS: ..."). Expected answers in 105_trip_recap.expected.txt.
-- Group A: ao — organiser, a1 (Tom) — a player, ag — guest. Group B: bo.

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
  ('00000000-0000-4000-8000-00000000f105', 'test-a105', 'Test Group A105', 'A105-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000f205', 'test-b105', 'Test Group B105', 'B105-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000005a0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000005a0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000005a0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000005a0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000005a0b01', '00000000-0000-4000-8000-00000000f105', 'A Organiser', 'Ao', 10),
  ('00000000-0000-4000-8000-0000005a0b02', '00000000-0000-4000-8000-00000000f105', 'A One', 'Tom', 18),
  ('00000000-0000-4000-8000-0000005a0b03', '00000000-0000-4000-8000-00000000f105', 'A Guest', 'Gus', 25),
  ('00000000-0000-4000-8000-0000005a0b04', '00000000-0000-4000-8000-00000000f205', 'B Organiser', null, 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f105', '00000000-0000-4000-8000-0000005a0a01', '00000000-0000-4000-8000-0000005a0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f105', '00000000-0000-4000-8000-0000005a0a02', '00000000-0000-4000-8000-0000005a0b02', 'player'),
  ('00000000-0000-4000-8000-00000000f105', '00000000-0000-4000-8000-0000005a0a03', '00000000-0000-4000-8000-0000005a0b03', 'guest'),
  ('00000000-0000-4000-8000-00000000f205', '00000000-0000-4000-8000-0000005a0a04', '00000000-0000-4000-8000-0000005a0b04', 'organiser');
insert into public.trips (id, group_id, name, start_date, end_date) values ('00000000-0000-4000-8000-0000005a0c01', '00000000-0000-4000-8000-00000000f105', 'South Coast 2026', '2026-10-16', '2026-10-18');

select pg_temp.as_user('00000000-0000-4000-8000-0000005a0a02');
set local role authenticated;
select pg_temp.try('tom writes the recap', $q$insert into public.trip_recaps (trip_id, title, lines, facts, cards, written_by) values ('00000000-0000-4000-8000-0000005a0c01', 'Tom says', '[{"who":"A","text":"Line 0"},{"who":"B","text":"Line 1"},{"who":"A","text":"Line 2"},{"who":"B","text":"Line 3"},{"who":"A","text":"Line 4"},{"who":"B","text":"Line 5"},{"who":"A","text":"Line 6"},{"who":"B","text":"Line 7"}]'::jsonb, '{"cards":2}'::jsonb, 2, 'ai') returning version::text || ' ' || (group_id = '00000000-0000-4000-8000-00000000f105')::text$q$);
reset role;

select pg_temp.as_user('00000000-0000-4000-8000-0000005a0a03');
set local role authenticated;
select pg_temp.try('guest writes the recap', $q$insert into public.trip_recaps (trip_id, title, lines, facts, cards, written_by) values ('00000000-0000-4000-8000-0000005a0c01', 'Gus says', '[{"who":"A","text":"Line 0"},{"who":"B","text":"Line 1"},{"who":"A","text":"Line 2"},{"who":"B","text":"Line 3"},{"who":"A","text":"Line 4"},{"who":"B","text":"Line 5"},{"who":"A","text":"Line 6"},{"who":"B","text":"Line 7"}]'::jsonb, '{"cards":2}'::jsonb, 2, 'ai') returning version::text || ' ' || (group_id = '00000000-0000-4000-8000-00000000f105')::text$q$);
reset role;

select pg_temp.as_user('00000000-0000-4000-8000-0000005a0a01');
set local role authenticated;
select pg_temp.try('organiser writes the recap', $q$insert into public.trip_recaps (trip_id, title, lines, facts, cards, written_by) values ('00000000-0000-4000-8000-0000005a0c01', 'The Big Weekend', '[{"who":"A","text":"Line 0"},{"who":"B","text":"Line 1"},{"who":"A","text":"Line 2"},{"who":"B","text":"Line 3"},{"who":"A","text":"Line 4"},{"who":"B","text":"Line 5"},{"who":"A","text":"Line 6"},{"who":"B","text":"Line 7"}]'::jsonb, '{"cards":2}'::jsonb, 2, 'ai') returning version::text || ' ' || (group_id = '00000000-0000-4000-8000-00000000f105')::text$q$);
select pg_temp.try('organiser sets the post itself', $q$update public.trip_recaps set published_at = now() where trip_id = '00000000-0000-4000-8000-0000005a0c01' returning coalesce(published_at::text, 'still unpublished')$q$);
select pg_temp.try('organiser writes it again', $q$update public.trip_recaps set lines = jsonb_set(lines, '{0,text}', '"New opening"'), cards = 5 where trip_id = '00000000-0000-4000-8000-0000005a0c01' returning version::text || ' ' || cards$q$);
select pg_temp.try('a three-line script', $q$update public.trip_recaps set lines = '[{"who":"A","text":"a"},{"who":"B","text":"b"},{"who":"A","text":"c"}]'::jsonb where trip_id = '00000000-0000-4000-8000-0000005a0c01' returning 1$q$);
select pg_temp.try('a third voice', $q$update public.trip_recaps set lines = jsonb_set(lines, '{0,who}', '"C"') where trip_id = '00000000-0000-4000-8000-0000005a0c01' returning 1$q$);
select pg_temp.try('a line too long', $q$update public.trip_recaps set lines = jsonb_set(lines, '{0,text}', to_jsonb(repeat('x', 301))) where trip_id = '00000000-0000-4000-8000-0000005a0c01' returning 1$q$);
select pg_temp.try('an extra field on a line', $q$update public.trip_recaps set lines = jsonb_set(lines, '{0,audio}', '"http://x"') where trip_id = '00000000-0000-4000-8000-0000005a0c01' returning 1$q$);
select pg_temp.try('a second recap for the trip', $q$insert into public.trip_recaps (trip_id, title, lines, facts, cards, written_by) values ('00000000-0000-4000-8000-0000005a0c01', 'Again', '[{"who":"A","text":"Line 0"},{"who":"B","text":"Line 1"},{"who":"A","text":"Line 2"},{"who":"B","text":"Line 3"},{"who":"A","text":"Line 4"},{"who":"B","text":"Line 5"},{"who":"A","text":"Line 6"},{"who":"B","text":"Line 7"}]'::jsonb, '{"cards":2}'::jsonb, 2, 'ai') returning version::text || ' ' || (group_id = '00000000-0000-4000-8000-00000000f105')::text$q$);
select pg_temp.try('publish it', $q$select (public.publish_trip_recap('00000000-0000-4000-8000-0000005a0c01') is not null)::text$q$);
select pg_temp.try('the Feed post', $q$select body || ' ' || link || ' ' || kind from public.posts where trip_id = '00000000-0000-4000-8000-0000005a0c01'$q$);
select pg_temp.try('published', $q$select (published_at is not null and post_id is not null)::text from public.trip_recaps where trip_id = '00000000-0000-4000-8000-0000005a0c01'$q$);
select pg_temp.try('rename and publish again', $q$update public.trip_recaps set title = 'The Bigger Weekend' where trip_id = '00000000-0000-4000-8000-0000005a0c01' returning version::text$q$);
select pg_temp.try('publish again', $q$select public.publish_trip_recap('00000000-0000-4000-8000-0000005a0c01') is not null$q$);
select pg_temp.try('still one Feed post, new title', $q$select count(*)::text || ' ' || max(body) from public.posts where trip_id = '00000000-0000-4000-8000-0000005a0c01'$q$);
reset role;

select pg_temp.as_user('00000000-0000-4000-8000-0000005a0a02');
set local role authenticated;
select pg_temp.try('tom reads it', $q$select title || ' v' || version from public.trip_recaps where trip_id = '00000000-0000-4000-8000-0000005a0c01'$q$);
select pg_temp.try('tom changes it', $q$update public.trip_recaps set title = 'Tom was here' where trip_id = '00000000-0000-4000-8000-0000005a0c01' returning 1$q$);
select pg_temp.try('tom publishes it', $q$select public.publish_trip_recap('00000000-0000-4000-8000-0000005a0c01')::text$q$);
reset role;

select pg_temp.as_user('00000000-0000-4000-8000-0000005a0a04');
set local role authenticated;
select pg_temp.try('other group reads it', $q$select count(*)::text from public.trip_recaps$q$);
select pg_temp.try('other group writes one for the trip', $q$insert into public.trip_recaps (trip_id, title, lines, facts, cards, written_by) values ('00000000-0000-4000-8000-0000005a0c01', 'Not yours', '[{"who":"A","text":"Line 0"},{"who":"B","text":"Line 1"},{"who":"A","text":"Line 2"},{"who":"B","text":"Line 3"},{"who":"A","text":"Line 4"},{"who":"B","text":"Line 5"},{"who":"A","text":"Line 6"},{"who":"B","text":"Line 7"}]'::jsonb, '{"cards":2}'::jsonb, 2, 'ai') returning version::text || ' ' || (group_id = '00000000-0000-4000-8000-00000000f105')::text$q$);
select pg_temp.try('other group publishes it', $q$select public.publish_trip_recap('00000000-0000-4000-8000-0000005a0c01')::text$q$);
reset role;

-- Switched off: no writing (commentary off).
insert into public.group_features (group_id, feature_key, enabled) values ('00000000-0000-4000-8000-00000000f105', 'commentary', false)
  on conflict (group_id, feature_key) do update set enabled = false;

select pg_temp.as_user('00000000-0000-4000-8000-0000005a0a01');
set local role authenticated;
select pg_temp.try('switched off: organiser writes it again', $q$update public.trip_recaps set title = 'Off' where trip_id = '00000000-0000-4000-8000-0000005a0c01' returning 1$q$);
select pg_temp.try('switched off: publish', $q$select public.publish_trip_recap('00000000-0000-4000-8000-0000005a0c01')::text$q$);
reset role;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
