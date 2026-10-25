-- 108 test: trip ideas. A player proposes an idea; before it's shared only they (and the organisers) can add; they
-- share it (a link token, the picture); then anyone in the group adds dates / areas / courses, reacts and answers the
-- 4 quick taps (plan_wishes); only an organiser ticks for the vote and spins off the leftovers; the preview works with
-- no sign-in by token only; another group is shut out.
-- STAGING only, after 108. Self-contained test groups. Rolled back; the results come back as the error message
-- ("RESULTS: ..."). Expected answers in 108_trip_ideas.expected.txt. Run with psql -1 (one transaction).
-- Group A: ao — organiser, a1 (Chris) — player who proposes, a2 (Tom) — player, ag — guest. Group B: bo.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated, anon;
grant all on sequence t_results_n_seq to authenticated, anon;
create temp table t_tok (tok text);
grant all on t_tok to authenticated, anon;

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
  ('00000000-0000-4000-8000-00000000f108', 'test-a108', 'Test Group A108', 'A108-CODE-TEST-1', null),
  ('00000000-0000-4000-8000-00000000f208', 'test-b108', 'Test Group B108', 'B108-CODE-TEST-1', null);
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000008a0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000008a0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000008a0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000008a0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000008a0a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000008a0b01', '00000000-0000-4000-8000-00000000f108', 'A Organiser', 'Ao', 10),
  ('00000000-0000-4000-8000-0000008a0b02', '00000000-0000-4000-8000-00000000f108', 'Chris Idea', 'Chris', 15),
  ('00000000-0000-4000-8000-0000008a0b03', '00000000-0000-4000-8000-00000000f108', 'A Two', 'Tom', 18),
  ('00000000-0000-4000-8000-0000008a0b04', '00000000-0000-4000-8000-00000000f108', 'A Guest', 'Gus', 25),
  ('00000000-0000-4000-8000-0000008a0b10', '00000000-0000-4000-8000-00000000f208', 'B Organiser', null, 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f108', '00000000-0000-4000-8000-0000008a0a01', '00000000-0000-4000-8000-0000008a0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f108', '00000000-0000-4000-8000-0000008a0a02', '00000000-0000-4000-8000-0000008a0b02', 'player'),
  ('00000000-0000-4000-8000-00000000f108', '00000000-0000-4000-8000-0000008a0a03', '00000000-0000-4000-8000-0000008a0b03', 'player'),
  ('00000000-0000-4000-8000-00000000f108', '00000000-0000-4000-8000-0000008a0a04', '00000000-0000-4000-8000-0000008a0b04', 'guest'),
  ('00000000-0000-4000-8000-00000000f208', '00000000-0000-4000-8000-0000008a0a05', '00000000-0000-4000-8000-0000008a0b10', 'organiser');

insert into public.group_features (group_id, feature_key, enabled) values ('00000000-0000-4000-8000-00000000f108', 'trip_finder', true);

-- ---------------------------------------------------------------- Chris proposes an idea
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a02');
set local role authenticated;
select pg_temp.try('chris proposes an idea', $q$insert into public.plans (id, kind, name, status, proposed, created_by, idea, idea_when, idea_where, idea_travel)
  values ('00000000-0000-4000-8000-0000008a0c01', 'trip', 'March fly trip', 'planning', true, '00000000-0000-4000-8000-0000008a0b02', true, 'March', 'Somewhere we fly to', 'fly') returning idea::text$q$);
select pg_temp.try('chris sets his own share token', $q$update public.plans set share_token = 'aaaaaaaaaaaaaaaaaaaa' where id = '00000000-0000-4000-8000-0000008a0c01' returning 1$q$);
select pg_temp.try('chris adds an area before sharing', $q$insert into public.plan_idea_items (plan_id, kind, label) values ('00000000-0000-4000-8000-0000008a0c01', 'area', 'Port Douglas') returning added_by::text = '00000000-0000-4000-8000-0000008a0b02'$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a03');
set local role authenticated;
select pg_temp.try('tom adds before it is shared', $q$insert into public.plan_idea_items (plan_id, kind, label) values ('00000000-0000-4000-8000-0000008a0c01', 'area', 'Hobart') returning 1$q$);
select pg_temp.try('tom shares chris''s idea', $q$select public.share_idea('00000000-0000-4000-8000-0000008a0c01')$q$);
reset role;

-- ---------------------------------------------------------------- Chris shares it
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a02');
set local role authenticated;
select pg_temp.try('chris shares with a picture not from the app', $q$select public.share_idea('00000000-0000-4000-8000-0000008a0c01', 'https://evil.example/x.png')$q$);
select pg_temp.try('chris shares it', $q$select (length(public.share_idea('00000000-0000-4000-8000-0000008a0c01', 'https://x.supabase.co/storage/v1/object/public/photos/g/ideas/1.png')) = 24)::text$q$);
select pg_temp.try('sharing again keeps the link', $q$select (public.share_idea('00000000-0000-4000-8000-0000008a0c01') = (select share_token from public.plans where id = '00000000-0000-4000-8000-0000008a0c01'))::text$q$);
reset role;
insert into t_tok select share_token from public.plans where id = '00000000-0000-4000-8000-0000008a0c01';

-- ---------------------------------------------------------------- everyone adds
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a03');
set local role authenticated;
select pg_temp.try('tom adds a weekend', $q$insert into public.plan_idea_items (id, plan_id, kind, label, start_date, end_date) values ('00000000-0000-4000-8000-0000008a0d01', '00000000-0000-4000-8000-0000008a0c01', 'date', 'Fri 12 – Sun 14 Mar', '2027-03-12', '2027-03-14') returning 1$q$);
select pg_temp.try('tom adds a second weekend', $q$insert into public.plan_idea_items (id, plan_id, kind, label, start_date, end_date) values ('00000000-0000-4000-8000-0000008a0d02', '00000000-0000-4000-8000-0000008a0c01', 'date', 'Fri 19 – Sun 21 Mar', '2027-03-19', '2027-03-21') returning 1$q$);
select pg_temp.try('tom adds a weekend that has gone', $q$insert into public.plan_idea_items (plan_id, kind, label, start_date, end_date) values ('00000000-0000-4000-8000-0000008a0c01', 'date', 'Old one', '2020-03-13', '2020-03-15') returning 1$q$);
select pg_temp.try('tom adds a 10-day "weekend"', $q$insert into public.plan_idea_items (plan_id, kind, label, start_date, end_date) values ('00000000-0000-4000-8000-0000008a0c01', 'date', 'Long one', '2027-04-01', '2027-04-11') returning 1$q$);
select pg_temp.try('tom adds a course', $q$insert into public.plan_idea_items (id, plan_id, kind, label, area) values ('00000000-0000-4000-8000-0000008a0d03', '00000000-0000-4000-8000-0000008a0c01', 'course', 'Sea Temple', 'Port Douglas') returning 1$q$);
select pg_temp.try('tom adds Port Douglas again', $q$insert into public.plan_idea_items (plan_id, kind, label) values ('00000000-0000-4000-8000-0000008a0c01', 'area', ' port douglas ') returning 1$q$);
select pg_temp.try('tom adds as chris', $q$insert into public.plan_idea_items (plan_id, kind, label, added_by) values ('00000000-0000-4000-8000-0000008a0c01', 'area', 'Cairns', '00000000-0000-4000-8000-0000008a0b02') returning 1$q$);
select pg_temp.try('tom adds one already ticked', $q$insert into public.plan_idea_items (plan_id, kind, label, picked) values ('00000000-0000-4000-8000-0000008a0c01', 'area', 'Cairns', true) returning 1$q$);
select pg_temp.try('tom ticks one himself', $q$update public.plan_idea_items set picked = true where plan_id = '00000000-0000-4000-8000-0000008a0c01' returning 1$q$);
select pg_temp.try('tom thumbs up the first weekend', $q$insert into public.plan_idea_reactions (item_id, player_id, value) values ('00000000-0000-4000-8000-0000008a0d01', '00000000-0000-4000-8000-0000008a0b03', 1) returning group_id::text = '00000000-0000-4000-8000-00000000f108'$q$);
select pg_temp.try('tom changes it to thumbs down', $q$update public.plan_idea_reactions set value = -1 where item_id = '00000000-0000-4000-8000-0000008a0d01' and player_id = '00000000-0000-4000-8000-0000008a0b03' returning value::text$q$);
select pg_temp.try('tom reacts as chris', $q$insert into public.plan_idea_reactions (item_id, player_id, value) values ('00000000-0000-4000-8000-0000008a0d01', '00000000-0000-4000-8000-0000008a0b02', 1) returning 1$q$);
select pg_temp.try('tom answers the 4 taps', $q$insert into public.plan_wishes (plan_id, player_id, cant_dates, spend_band, travel, max_drive_min, golf_per_day, day_prefs, home_by, wish)
  values ('00000000-0000-4000-8000-0000008a0c01', '00000000-0000-4000-8000-0000008a0b03', '{2027-03-19,2027-03-12,2027-03-19}', '500_800', 'either', 180, 'daily', '{"fri":"late","sun":"early"}', '16:00', '  Please no 6am tee times  ') returning cardinality(cant_dates)::text || ' ' || (day_prefs->>'fri') || ' ' || home_by::text || ' ' || wish$q$);
select pg_temp.try('tom reads his own answers', $q$select count(*)::text from public.plan_wishes$q$);
select pg_temp.try('tom wants "brunch" on Saturday', $q$update public.plan_wishes set day_prefs = '{"sat":"brunch"}' where plan_id = '00000000-0000-4000-8000-0000008a0c01' returning 1$q$);
select pg_temp.try('tom fixes the weekend himself', $q$select public.idea_set_fixed('00000000-0000-4000-8000-0000008a0c01', '{"area":"Hobart"}')::text$q$);
select pg_temp.try('tom says a Saturday he can''t do', $q$update public.plan_wishes set cant_dates = '{2027-03-13}' where plan_id = '00000000-0000-4000-8000-0000008a0c01' and player_id = '00000000-0000-4000-8000-0000008a0b03' returning 1$q$);
select pg_temp.try('tom spends "heaps"', $q$update public.plan_wishes set spend_band = 'heaps' where plan_id = '00000000-0000-4000-8000-0000008a0c01' returning 1$q$);
select pg_temp.try('tom answers for chris', $q$insert into public.plan_wishes (plan_id, player_id, travel) values ('00000000-0000-4000-8000-0000008a0c01', '00000000-0000-4000-8000-0000008a0b02', 'drive') returning 1$q$);
select pg_temp.try('tom removes chris''s area', $q$delete from public.plan_idea_items where kind = 'area' and label = 'Port Douglas' returning 1$q$);
select pg_temp.try('tom tidies the idea', $q$select public.idea_tidy('00000000-0000-4000-8000-0000008a0c01', array['00000000-0000-4000-8000-0000008a0d01']::uuid[])::text$q$);
select pg_temp.try('tom spins off the leftovers', $q$select public.idea_spin_off('00000000-0000-4000-8000-0000008a0c01')::text$q$);
reset role;

select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a04');
set local role authenticated;
select pg_temp.try('the guest adds a course idea', $q$insert into public.plan_idea_items (id, plan_id, kind, label, by_ai) values ('00000000-0000-4000-8000-0000008a0d04', '00000000-0000-4000-8000-0000008a0c01', 'course', 'Mirage Country Club', true) returning by_ai::text$q$);
reset role;

-- ---------------------------------------------------------------- the organiser fixes the area; suggestions outside it queue
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a01');
set local role authenticated;
select pg_temp.try('organiser sets a 9-night "weekend"', $q$select public.idea_set_fixed('00000000-0000-4000-8000-0000008a0c01', '{"weekend":{"start":"2027-03-12","end":"2027-03-22"}}')::text$q$);
select pg_temp.try('organiser: the area open to ideas, within 3 h of Sydney', $q$select public.idea_set_fixed('00000000-0000-4000-8000-0000008a0c01', '{"area":"Port Douglas","from":"Sydney","within_min":180,"set":[]}')::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a03');
set local role authenticated;
select pg_temp.try('tom suggests another area while it''s open (straight in)', $q$insert into public.plan_idea_items (plan_id, kind, label) values ('00000000-0000-4000-8000-0000008a0c01', 'area', 'Cairns') returning status$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a01');
set local role authenticated;
select pg_temp.try('organiser sets the area, 2 nights, as much golf as possible', $q$select public.idea_set_fixed('00000000-0000-4000-8000-0000008a0c01', '{"area":"Port Douglas","nights":2,"golf":"max","travel":"fly","set":["area","nights","weekend","junk"],"junk":1}')::text$q$);
select pg_temp.try('organiser adds an area outside it (straight in)', $q$insert into public.plan_idea_items (plan_id, kind, label) values ('00000000-0000-4000-8000-0000008a0c01', 'area', 'Noosa') returning status$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a03');
set local role authenticated;
select pg_temp.try('tom suggests another area (queued)', $q$insert into public.plan_idea_items (id, plan_id, kind, label) values ('00000000-0000-4000-8000-0000008a0d05', '00000000-0000-4000-8000-0000008a0c01', 'area', 'Hamilton Island') returning status$q$);
select pg_temp.try('tom adds a course in the area (straight in)', $q$insert into public.plan_idea_items (plan_id, kind, label, area) values ('00000000-0000-4000-8000-0000008a0c01', 'course', 'Palmer Sea Reef', 'port douglas') returning status$q$);
select pg_temp.try('tom accepts his own suggestion', $q$select public.idea_review('00000000-0000-4000-8000-0000008a0d05', true)$q$);
select pg_temp.try('tom sets the definition column by hand', $q$update public.plans set idea_fixed = '{}' where id = '00000000-0000-4000-8000-0000008a0c01' returning 1$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a01');
set local role authenticated;
select pg_temp.try('organiser declines it with a note', $q$select public.idea_review('00000000-0000-4000-8000-0000008a0d05', false, 'Flights too dear')$q$);
select pg_temp.try('organiser looks at it twice', $q$select public.idea_review('00000000-0000-4000-8000-0000008a0d05', true)$q$);
select pg_temp.try('the declined one can''t be ticked', $q$select public.idea_tidy('00000000-0000-4000-8000-0000008a0c01', array['00000000-0000-4000-8000-0000008a0d05']::uuid[])::text$q$);

-- ---------------------------------------------------------------- the organiser tidies and sends
select pg_temp.try('organiser sends nothing to the vote', $q$select public.idea_tidy('00000000-0000-4000-8000-0000008a0c01', '{}'::uuid[], true)::text$q$);
select pg_temp.try('organiser ticks two and sends', $q$select public.idea_tidy('00000000-0000-4000-8000-0000008a0c01', array['00000000-0000-4000-8000-0000008a0d01','00000000-0000-4000-8000-0000008a0d03']::uuid[], true)::text$q$);
select pg_temp.try('the idea is marked sent', $q$select (idea_sent_at is not null)::text from public.plans where id = '00000000-0000-4000-8000-0000008a0c01'$q$);
select pg_temp.try('organiser can''t set sent by hand on another plan', $q$update public.plans set idea_sent_at = null where id = '00000000-0000-4000-8000-0000008a0c01' returning 1$q$);
select pg_temp.try('organiser gives the declined Hamilton Island back to tom', $q$select public.idea_give_back('00000000-0000-4000-8000-0000008a0c01', array['00000000-0000-4000-8000-0000008a0d05']::uuid[])::text$q$);
select pg_temp.try('organiser gives back his own Noosa', $q$select public.idea_give_back('00000000-0000-4000-8000-0000008a0c01', array[(select id from public.plan_idea_items where label = 'Noosa')]::uuid[])::text$q$);
select pg_temp.try('organiser parks Mirage in the future ideas', $q$select (public.idea_park('00000000-0000-4000-8000-0000008a0c01', array['00000000-0000-4000-8000-0000008a0d04']::uuid[]) is not null)::text$q$);
select pg_temp.try('the future ideas pool has it', $q$select p.name || ' · ' || string_agg(i.label, ',') from public.plans p join public.plan_idea_items i on i.plan_id = p.id where p.idea_pool group by p.name$q$);
reset role;
select pg_temp.try('tom is told his idea came back', $q$select count(*)::text || ' ' || min(title) from public.notify_queue where kind = 'idea_given_back' and user_id = '00000000-0000-4000-8000-0000008a0a03'$q$);
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a03');
set local role authenticated;
select pg_temp.try('tom adds a weekend to the future ideas', $q$insert into public.plan_idea_items (plan_id, kind, label, start_date, end_date) values ((select id from public.plans where idea_pool), 'date', 'Fri 7 – Sun 9 May', '2027-05-07', '2027-05-09') returning status$q$);
select pg_temp.try('tom starts his own idea from Hamilton Island', $q$select (public.idea_start_from('00000000-0000-4000-8000-0000008a0d05') is not null)::text$q$);
select pg_temp.try('his new idea', $q$select p.name || ' · proposed ' || p.proposed::text || ' · ' || (select string_agg(label, ',') from public.plan_idea_items where plan_id = p.id) from public.plans p where p.name = 'Hamilton Island trip'$q$);
select pg_temp.try('tom starts it twice', $q$select public.idea_start_from('00000000-0000-4000-8000-0000008a0d05')::text$q$);
select pg_temp.try('tom starts chris''s Port Douglas', $q$select public.idea_start_from((select id from public.plan_idea_items where label = 'Port Douglas' and plan_id = '00000000-0000-4000-8000-0000008a0c01'))::text$q$);
select pg_temp.try('tom makes Mirage (in the pool) a trip idea', $q$select (public.idea_start_from((select i.id from public.plan_idea_items i join public.plans p on p.id = i.plan_id where p.idea_pool and i.label = 'Mirage Country Club')) is not null)::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a01');
set local role authenticated;
select pg_temp.try('organiser spins off the leftovers', $q$select (public.idea_spin_off('00000000-0000-4000-8000-0000008a0c01', 'Plan B') is not null)::text$q$);
select pg_temp.try('the new idea came from the old one', $q$select idea::text || ' ' || (idea_from = '00000000-0000-4000-8000-0000008a0c01')::text || ' ' || (organiser_id = '00000000-0000-4000-8000-0000008a0b01')::text from public.plans where name = 'Plan B'$q$);
select pg_temp.try('leftovers keep who added and the ✨', $q$select string_agg(i.label || ':' || coalesce(p.nickname, '?') || ':' || i.by_ai::text, ', ' order by i.label)
  from public.plans n join public.plan_idea_items i on i.plan_id = n.id left join public.players p on p.id = i.added_by where n.name = 'Plan B'$q$);
select pg_temp.try('organiser removes tom''s weekend', $q$delete from public.plan_idea_items where id = '00000000-0000-4000-8000-0000008a0d02' returning 1$q$);
reset role;

-- ---------------------------------------------------------------- names stay with the organiser; hand over
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a02');
set local role authenticated;
select pg_temp.try('chris (the organiser) reads everyone''s answers', $q$select count(*)::text from public.plan_wishes$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a04');
set local role authenticated;
select pg_temp.try('the guest reads the answers (no names)', $q$select count(*)::text from public.plan_wishes$q$);
select pg_temp.try('the guest gets the answers without names', $q$select jsonb_array_length(public.idea_wish_answers('00000000-0000-4000-8000-0000008a0c01'))::text || ' ' || (public.idea_wish_answers('00000000-0000-4000-8000-0000008a0c01')::text like '%player_id%')::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a03');
set local role authenticated;
select pg_temp.try('tom hands chris''s idea to himself', $q$select public.hand_over_idea('00000000-0000-4000-8000-0000008a0c01', '00000000-0000-4000-8000-0000008a0b03')::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a02');
set local role authenticated;
select pg_temp.try('chris hands it to the guest', $q$select public.hand_over_idea('00000000-0000-4000-8000-0000008a0c01', '00000000-0000-4000-8000-0000008a0b04')::text$q$);
select pg_temp.try('chris hands it to tom', $q$select (public.hand_over_idea('00000000-0000-4000-8000-0000008a0c01', '00000000-0000-4000-8000-0000008a0b03') = '00000000-0000-4000-8000-0000008a0b03')::text$q$);
select pg_temp.try('chris can''t organise it any more', $q$select public.idea_set_fixed('00000000-0000-4000-8000-0000008a0c01', '{}')::text$q$);
reset role;
select pg_temp.try('tom is told', $q$select count(*)::text || ' ' || min(kind) from public.notify_queue where kind = 'organiser_handover' and user_id = '00000000-0000-4000-8000-0000008a0a03'$q$);
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a03');
set local role authenticated;
select pg_temp.try('tom, now organising, reads the answers', $q$select count(*)::text from public.plan_wishes$q$);
select pg_temp.try('tom can run the trip''s votes (the builder)', $q$insert into public.trip_builds (plan_id, state) values ('00000000-0000-4000-8000-0000008a0c01', '{"region":"Port Douglas"}') returning 1$q$);
reset role;

-- ---------------------------------------------------------------- the link preview (no sign-in)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.try('preview by token', $q$select (p->>'name') || ' · ' || (p->>'when') || ' · ' || (p->>'by') || ' · ' || (p->>'group') || ' · ' || (p->>'card_url' like 'https://%')::text
  from (select public.idea_preview((select tok from t_tok)) p) x$q$);
select pg_temp.try('preview with a made-up token', $q$select coalesce(public.idea_preview('bbbbbbbbbbbbbbbbbbbbbbbb')::text, 'nothing')$q$);
select pg_temp.try('anon reads the plans table', $q$select count(*)::text from public.plans$q$);
select pg_temp.try('anon reads the lists', $q$select count(*)::text from public.plan_idea_items$q$);
reset role;

-- ---------------------------------------------------------------- another group
select pg_temp.as_user('00000000-0000-4000-8000-0000008a0a05');
set local role authenticated;
select pg_temp.try('other group sees the lists', $q$select count(*)::text from public.plan_idea_items$q$);
select pg_temp.try('other group sees the wishes', $q$select count(*)::text from public.plan_wishes$q$);
select pg_temp.try('other group adds to the idea', $q$insert into public.plan_idea_items (plan_id, kind, label) values ('00000000-0000-4000-8000-0000008a0c01', 'area', 'Broome') returning 1$q$);
select pg_temp.try('other group shares it', $q$select public.share_idea('00000000-0000-4000-8000-0000008a0c01')$q$);
select pg_temp.try('other group tidies it', $q$select public.idea_tidy('00000000-0000-4000-8000-0000008a0c01', '{}'::uuid[])::text$q$);
reset role;

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
