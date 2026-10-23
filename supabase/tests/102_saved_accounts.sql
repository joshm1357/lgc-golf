-- 102 test: phone-only accounts look and play; saved accounts organise, pay and propose. Run after 102 (STAGING or a
-- local stand-in only). Self-contained test groups. Rolled back; the results come back as the error message
-- ("RESULTS: ..."). Expected answers in 102_saved_accounts.expected.txt.
-- Group A: so — saved organiser, ao — phone-only organiser, ap — phone-only player (Hamish), sp — saved player (Tom).
-- Quick group Q: aq — phone-only player. nobody — a phone-only account in no group.
-- A "phone-only" session is a JWT with is_anonymous = true and an auth.users row with is_anonymous = true.
-- Where a player couldn't do something anyway (e.g. a player adding a cup — organisers only), the older refusal can
-- come first ("violates row-level security policy"); the phone-only organiser's line shows the save message.
-- Run locally on Postgres 16 with every migration 001–102 and Supabase stand-ins (auth, cron, storage), 23 Oct 2026.

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
create function pg_temp.as_user(p_user text, p_anon boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'is_anonymous', p_anon)::text, true) $$;
grant execute on function pg_temp.as_user(text, boolean) to authenticated;
-- Phone-only: every gated function, called with empty arguments, must say "Save your spot first" (its first line).
create function pg_temp.every_gated_function() returns text language plpgsql as $$
declare r record; v_sql text; v_bad text := ''; v_n int := 0; v_ok int := 0;
begin
  for r in
    select p.oid, p.proname, p.pronargs, p.proargtypes from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%102: saved accounts only%' and p.proname <> 'award_claim_post'
    order by p.proname, p.oid
  loop
    v_n := v_n + 1;
    v_sql := 'select public.' || quote_ident(r.proname) || '(';
    for i in 0 .. r.pronargs - 1 loop
      v_sql := v_sql || case when i > 0 then ', ' else '' end || 'null::' || format_type(r.proargtypes[i], null);
    end loop;
    v_sql := v_sql || ')';
    begin
      execute v_sql;
      v_bad := v_bad || ' ' || r.proname || '(ran)';
    exception when others then
      if sqlerrm = 'Save your spot first (Google or email) to do this' then v_ok := v_ok + 1;
      else v_bad := v_bad || ' ' || r.proname || '(' || sqlerrm || ')'; end if;
    end;
  end loop;
  return v_ok || ' of ' || v_n || ' refused' || case when v_bad <> '' then ';' || v_bad else '' end;
end $$;
grant execute on function pg_temp.every_gated_function() to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin, quick) values
  ('00000000-0000-4000-8000-00000000f102', 'test-a102', 'Test Group A102', 'A102-CODE-TEST-1', null, false),
  ('00000000-0000-4000-8000-00000000f192', 'test-q102', 'Test Quick Q102', 'Q102-CODE-TEST-1', null, true);
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000002a0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000002a0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000002a0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000002a0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-0000002a0a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000002a0a06', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000002a0b01', '00000000-0000-4000-8000-00000000f102', 'Saved Organiser', 'So', 10),
  ('00000000-0000-4000-8000-0000002a0b02', '00000000-0000-4000-8000-00000000f102', 'Phone Organiser', 'Ao', 12),
  ('00000000-0000-4000-8000-0000002a0b03', '00000000-0000-4000-8000-00000000f102', 'Phone Player', 'Hamish', 15),
  ('00000000-0000-4000-8000-0000002a0b04', '00000000-0000-4000-8000-00000000f102', 'Saved Player', 'Tom', 18),
  ('00000000-0000-4000-8000-0000002a0b06', '00000000-0000-4000-8000-00000000f192', 'Quick Player', 'Q', 20);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0a01', '00000000-0000-4000-8000-0000002a0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0a02', '00000000-0000-4000-8000-0000002a0b02', 'organiser'),
  ('00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0a03', '00000000-0000-4000-8000-0000002a0b03', 'player'),
  ('00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0a04', '00000000-0000-4000-8000-0000002a0b04', 'player'),
  ('00000000-0000-4000-8000-00000000f192', '00000000-0000-4000-8000-0000002a0a06', '00000000-0000-4000-8000-0000002a0b06', 'player');
-- New groups are open on this test database (047's platform flag), so "starts a new group" tests only the save check.
update private.platform_flags set is_on = true where key = 'new_groups_open';
insert into public.group_features (group_id, feature_key, enabled) values
  ('00000000-0000-4000-8000-00000000f102', 'dinner_awards', true),
  ('00000000-0000-4000-8000-00000000f102', 'games', true);
insert into public.trips (id, group_id, name, start_date, end_date) values
  ('00000000-0000-4000-8000-0000002a0c01', '00000000-0000-4000-8000-00000000f102', 'Hunter Trip', current_date, current_date + 2);
insert into public.courses (id, group_id, name, holes) values
  ('00000000-0000-4000-8000-0000002a0c02', '00000000-0000-4000-8000-00000000f102', 'A course', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status, play_date) values
  ('00000000-0000-4000-8000-0000002a0c03', '00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0c01',
   '00000000-0000-4000-8000-0000002a0c02', 'Day 1', 'stableford', 'live', current_date);
insert into public.rounds (id, group_id, trip_id, course_id, name, format, status, play_date) values
  ('00000000-0000-4000-8000-0000002a0c04', '00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0c01',
   '00000000-0000-4000-8000-0000002a0c02', 'Day 2', 'stableford', 'setup', current_date + 1);
insert into public.round_players (round_id, player_id, playing_handicap, group_id) values
  ('00000000-0000-4000-8000-0000002a0c03', '00000000-0000-4000-8000-0000002a0b03', 15, '00000000-0000-4000-8000-00000000f102');
insert into public.plans (id, group_id, kind, name, status, created_by) values
  ('00000000-0000-4000-8000-0000002a0d01', '00000000-0000-4000-8000-00000000f102', 'trip', 'Next trip', 'planning', '00000000-0000-4000-8000-0000002a0b01');
insert into public.plan_polls (id, group_id, plan_id, question, kind, status) values
  ('00000000-0000-4000-8000-0000002a0d02', '00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0d01', 'When?', 'dates', 'open');
insert into public.plan_options (id, group_id, poll_id, label) values
  ('00000000-0000-4000-8000-0000002a0d03', '00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0d02', 'March');
insert into public.rules (id, group_id, title, status, proposed_by) values
  ('00000000-0000-4000-8000-0000002a0d04', '00000000-0000-4000-8000-00000000f102', 'Gimmes inside the leather', 'proposed', '00000000-0000-4000-8000-0000002a0b04');
insert into public.posts (id, group_id, player_id, body) values
  ('00000000-0000-4000-8000-0000002a0d05', '00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0b04', 'Hello'),
  ('00000000-0000-4000-8000-0000002a0d15', '00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0b03', 'Out late');
insert into public.dinner_awards (id, group_id, trip_id, title, kind, status) values
  ('00000000-0000-4000-8000-0000002a0d06', '00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0c01', 'Worst shirt', 'fine', 'nominating'),
  ('00000000-0000-4000-8000-0000002a0d07', '00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0c01', 'Shot of the trip', 'award', 'voting');
insert into public.dinner_award_nominations (id, group_id, award_id, player_id, nominated_by) values
  ('00000000-0000-4000-8000-0000002a0d08', '00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0d07',
   '00000000-0000-4000-8000-0000002a0b04', '00000000-0000-4000-8000-0000002a0b01');
insert into public.round_games (id, group_id, round_id, kind, who_in, created_by) values
  ('00000000-0000-4000-8000-0000002a0d09', '00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0c04', 'skins', 'opt_in', '00000000-0000-4000-8000-0000002a0b01');
insert into public.cups (id, group_id, name, purpose) values
  ('00000000-0000-4000-8000-0000002a0d10', '00000000-0000-4000-8000-00000000f102', 'Weekend Cup', 'social');
insert into public.comps (id, group_id, trip_id, cup_id, name, kind, settings) values
  ('00000000-0000-4000-8000-0000002a0d11', '00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000002a0c01',
   '00000000-0000-4000-8000-0000002a0d10', 'Weekend Cup', 'manual',
   '{"cup":"social","counts":{"kudos":{"on":true,"allowance":3,"per":1,"max_same":2,"guests":false}}}');

-- ---------------------------------------------------------------- Hamish: phone-only player — what he CAN do
select pg_temp.as_user('00000000-0000-4000-8000-0000002a0a03', true);
set local role authenticated;
select pg_temp.try('can: reads the trip', $q$select name from public.trips where id = '00000000-0000-4000-8000-0000002a0c01'$q$);
select pg_temp.try('can: In for the trip', $q$insert into public.plan_rsvps (plan_id, player_id, status) values ('00000000-0000-4000-8000-0000002a0d01',
  '00000000-0000-4000-8000-0000002a0b03', 'in') returning status$q$);
select pg_temp.try('can: Maybe instead', $q$update public.plan_rsvps set status = 'maybe' where plan_id = '00000000-0000-4000-8000-0000002a0d01'
  and player_id = '00000000-0000-4000-8000-0000002a0b03' returning status$q$);
select pg_temp.try('can: votes in the trip poll', $q$insert into public.plan_votes (option_id, poll_id, player_id, response) values ('00000000-0000-4000-8000-0000002a0d03',
  '00000000-0000-4000-8000-0000002a0d02', '00000000-0000-4000-8000-0000002a0b03', 'yes') returning response$q$);
select pg_temp.try('can: votes on a proposed rule', $q$insert into public.rule_votes (rule_id, player_id, vote) values ('00000000-0000-4000-8000-0000002a0d04',
  '00000000-0000-4000-8000-0000002a0b03', 'for') returning vote$q$);
select pg_temp.try('can: votes for an award', $q$insert into public.dinner_award_votes (award_id, nomination_id, voter_id) values ('00000000-0000-4000-8000-0000002a0d07',
  '00000000-0000-4000-8000-0000002a0d08', '00000000-0000-4000-8000-0000002a0b03') returning 'voted'$q$);
select pg_temp.try('can: enters a score', $q$insert into public.scores (round_id, subject_id, subject_type, hole, strokes) values ('00000000-0000-4000-8000-0000002a0c03',
  '00000000-0000-4000-8000-0000002a0b03', 'player', 1, 5) returning strokes::text$q$);
select pg_temp.try('can: posts to the Feed', $q$insert into public.posts (player_id, body) values ('00000000-0000-4000-8000-0000002a0b03', 'Birdie!') returning body$q$);
select pg_temp.try('can: reacts', $q$insert into public.reactions (post_id, player_id, emoji) values ('00000000-0000-4000-8000-0000002a0d05',
  '00000000-0000-4000-8000-0000002a0b03', '🔥') returning emoji$q$);
select pg_temp.try('can: comments', $q$insert into public.comments (post_id, player_id, body) values ('00000000-0000-4000-8000-0000002a0d05',
  '00000000-0000-4000-8000-0000002a0b03', 'Nice') returning body$q$);
select pg_temp.try('can: gives a cap tip', $q$insert into public.cap_tips (comp_id, giver_id, receiver_id) values ('00000000-0000-4000-8000-0000002a0d11',
  '00000000-0000-4000-8000-0000002a0b03', '00000000-0000-4000-8000-0000002a0b04') returning 'given'$q$);
select pg_temp.try('can: opts in to a side game', $q$insert into public.round_game_players (game_id, player_id) values ('00000000-0000-4000-8000-0000002a0d09',
  '00000000-0000-4000-8000-0000002a0b03') returning 'in'$q$);
select pg_temp.try('can: claims for himself (past the save check; no award set up here)', $q$select public.award_claim_post('00000000-0000-4000-8000-0000002a0d15')::text$q$);
select pg_temp.try('can: changes his own profile', $q$update public.players set nickname = 'Hammo' where id = '00000000-0000-4000-8000-0000002a0b03' returning nickname$q$);
select pg_temp.try('can: nominates himself', $q$insert into public.dinner_award_nominations (award_id, player_id, nominated_by) values ('00000000-0000-4000-8000-0000002a0d06',
  '00000000-0000-4000-8000-0000002a0b03', '00000000-0000-4000-8000-0000002a0b03') returning 'nominated'$q$);
select pg_temp.try('my_saved_status', $q$select public.my_saved_status()::text$q$);

-- ---------------------------------------------------------------- Hamish: what needs a saved account
select pg_temp.try('no: suggests a trip', $q$insert into public.plans (kind, name, status, proposed, created_by) values ('trip', 'Bali', 'planning', true,
  '00000000-0000-4000-8000-0000002a0b03') returning 'added'$q$);
select pg_temp.try('no: suggests a vote option', $q$insert into public.plan_options (poll_id, label, created_by) values ('00000000-0000-4000-8000-0000002a0d02',
  'April', '00000000-0000-4000-8000-0000002a0b03') returning 'added'$q$);
select pg_temp.try('no: suggests a stay', $q$insert into public.plan_stays (plan_id, name, created_by) values ('00000000-0000-4000-8000-0000002a0d01',
  'Motel', '00000000-0000-4000-8000-0000002a0b03') returning 'added'$q$);
select pg_temp.try('no: suggests an activity', $q$insert into public.trip_activities (plan_id, title, created_by) values ('00000000-0000-4000-8000-0000002a0d01',
  'Go-karts', '00000000-0000-4000-8000-0000002a0b03') returning 'added'$q$);
select pg_temp.try('no: logs a cost', $q$insert into public.plan_costs (plan_id, title, amount, paid_by, created_by) values ('00000000-0000-4000-8000-0000002a0d01', 'Beers', 50,
  '00000000-0000-4000-8000-0000002a0b03', '00000000-0000-4000-8000-0000002a0b03') returning 'added'$q$);
select pg_temp.try('no: "I''ve paid"', $q$insert into public.plan_transfers (plan_id, from_id, to_id, amount, created_by) values ('00000000-0000-4000-8000-0000002a0d01',
  '00000000-0000-4000-8000-0000002a0b03', null, 200, '00000000-0000-4000-8000-0000002a0b03') returning 'paid'$q$);
select pg_temp.try('no: proposes a rule', $q$insert into public.rules (title, status, proposed_by) values ('No mulligans', 'proposed',
  '00000000-0000-4000-8000-0000002a0b03') returning 'proposed'$q$);
select pg_temp.try('no: proposes a fine', $q$insert into public.dinner_awards (trip_id, title, kind, created_by) values ('00000000-0000-4000-8000-0000002a0c01',
  'Late to the tee', 'fine', '00000000-0000-4000-8000-0000002a0b03') returning 'proposed'$q$);
select pg_temp.try('no: fines Tom', $q$insert into public.dinner_award_nominations (award_id, player_id, nominated_by) values ('00000000-0000-4000-8000-0000002a0d06',
  '00000000-0000-4000-8000-0000002a0b04', '00000000-0000-4000-8000-0000002a0b03') returning 'nominated'$q$);
select pg_temp.try('no: claims for Tom', $q$select public.award_claim_post('00000000-0000-4000-8000-0000002a0d15', null, null, '00000000-0000-4000-8000-0000002a0b04')::text$q$);
select pg_temp.try('no: claims on Tom''s post', $q$select public.award_claim_post('00000000-0000-4000-8000-0000002a0d05')::text$q$);
select pg_temp.try('no: proposes a side game', $q$insert into public.round_games (round_id, kind, who_in, created_by) values ('00000000-0000-4000-8000-0000002a0c04',
  'nassau', 'opt_in', '00000000-0000-4000-8000-0000002a0b03') returning 'proposed'$q$);
select pg_temp.try('no: creates a cup', $q$insert into public.cups (name, purpose) values ('Hamish Cup', 'social') returning 'made'$q$);
select pg_temp.try('no: raises a dispute', $q$select public.raise_dispute('{"table":"scores"}', 'That was a 6', null, null, null)::text$q$);
select pg_temp.try('no: lodges a Tribunal case', $q$select public.lodge_case('00000000-0000-4000-8000-0000002a0b04', -2, 'Sandbagger', null)::text$q$);
select pg_temp.try('no: applies a penalty', $q$select public.apply_rule_penalty('00000000-0000-4000-8000-0000002a0c03', '00000000-0000-4000-8000-0000002a0b04', null, 2, 1, null)::text$q$);
select pg_temp.try('no: makes the invite link', $q$select public.group_invite('player')::text$q$);
select pg_temp.try('no: makes his personal link', $q$select public.create_my_player_link()::text$q$);
select pg_temp.try('no: changes Tom''s profile', $q$update public.players set nickname = 'Tommo' where id = '00000000-0000-4000-8000-0000002a0b04' returning nickname$q$);
select pg_temp.try('no: starts a new group', $q$select public.create_group('Hamish Golf', '{}'::jsonb, 'Hamish', 15)::text$q$);
reset role;

-- ---------------------------------------------------------------- Ao: phone-only organiser — every organiser action
select pg_temp.as_user('00000000-0000-4000-8000-0000002a0a02', true);
set local role authenticated;
select pg_temp.try('organiser (phone-only): every gated function', $q$select pg_temp.every_gated_function()$q$);
select pg_temp.try('organiser (phone-only): adds a trip', $q$insert into public.trips (name) values ('Another') returning 'added'$q$);
select pg_temp.try('organiser (phone-only): changes the round', $q$update public.rounds set name = 'Day One' where id = '00000000-0000-4000-8000-0000002a0c03' returning name$q$);
select pg_temp.try('organiser (phone-only): closes the poll', $q$update public.plan_polls set status = 'closed' where id = '00000000-0000-4000-8000-0000002a0d02' returning status$q$);
select pg_temp.try('organiser (phone-only): adds a course', $q$insert into public.courses (name, holes) values ('B course', '[]') returning 'added'$q$);
select pg_temp.try('organiser (phone-only): creates a cup', $q$insert into public.cups (name, purpose) values ('Ao Cup', 'social') returning 'made'$q$);
select pg_temp.try('organiser (phone-only): removes Tom', $q$delete from public.players where id = '00000000-0000-4000-8000-0000002a0b04' returning 'removed'$q$);
select pg_temp.try('organiser (phone-only): switches the limit off', $q$select public.set_feature('phone_only_limited', false)::text$q$);
select pg_temp.try('organiser (phone-only): still enters a score', $q$insert into public.scores (round_id, subject_id, subject_type, hole, strokes) values ('00000000-0000-4000-8000-0000002a0c03',
  '00000000-0000-4000-8000-0000002a0b03', 'player', 2, 4) returning strokes::text$q$);
reset role;

-- A token from just before he saved (still says is_anonymous) — the account itself now says saved.
update auth.users set is_anonymous = false where id = '00000000-0000-4000-8000-0000002a0a02';
select pg_temp.as_user('00000000-0000-4000-8000-0000002a0a02', true);
set local role authenticated;
select pg_temp.try('organiser just saved (old token): adds a trip', $q$insert into public.trips (name) values ('Saved now') returning 'added'$q$);
reset role;
update auth.users set is_anonymous = true where id = '00000000-0000-4000-8000-0000002a0a02';

-- ---------------------------------------------------------------- Saved accounts: allowed
select pg_temp.as_user('00000000-0000-4000-8000-0000002a0a04', false);
set local role authenticated;
select pg_temp.try('saved player: suggests a trip', $q$insert into public.plans (kind, name, status, proposed, created_by) values ('trip', 'Bali', 'planning', true,
  '00000000-0000-4000-8000-0000002a0b04') returning 'added'$q$);
select pg_temp.try('saved player: "I''ve paid"', $q$insert into public.plan_transfers (plan_id, from_id, to_id, amount, created_by) values ('00000000-0000-4000-8000-0000002a0d01',
  '00000000-0000-4000-8000-0000002a0b04', null, 200, '00000000-0000-4000-8000-0000002a0b04') returning 'paid'$q$);
select pg_temp.try('saved player: proposes a rule', $q$insert into public.rules (title, status, proposed_by) values ('No mulligans', 'proposed',
  '00000000-0000-4000-8000-0000002a0b04') returning 'proposed'$q$);
select pg_temp.try('saved player: fines the organiser', $q$insert into public.dinner_award_nominations (award_id, player_id, nominated_by) values ('00000000-0000-4000-8000-0000002a0d06',
  '00000000-0000-4000-8000-0000002a0b01', '00000000-0000-4000-8000-0000002a0b04') returning 'nominated'$q$);
select pg_temp.try('saved player: proposes a side game', $q$insert into public.round_games (round_id, kind, who_in, created_by) values ('00000000-0000-4000-8000-0000002a0c04',
  'nassau', 'opt_in', '00000000-0000-4000-8000-0000002a0b04') returning 'proposed'$q$);
select pg_temp.try('saved player: my_saved_status', $q$select public.my_saved_status()::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000002a0a01', false);
set local role authenticated;
select pg_temp.try('saved organiser: adds a trip', $q$insert into public.trips (name) values ('Another') returning 'added'$q$);
select pg_temp.try('saved organiser: closes the poll', $q$update public.plan_polls set status = 'closed' where id = '00000000-0000-4000-8000-0000002a0d02' returning status$q$);
select pg_temp.try('saved organiser: makes the invite link', $q$select (public.group_invite('player') is not null)::text$q$);
select pg_temp.try('saved organiser: creates a cup', $q$insert into public.cups (name, purpose) values ('Saved Cup', 'social') returning 'made'$q$);
select pg_temp.try('saved organiser: starts a new group', $q$select (public.create_group('Saved Golf', '{}'::jsonb, 'So', 10) is not null)::text$q$);
reset role;

-- ---------------------------------------------------------------- A phone-only account in no group
select pg_temp.as_user('00000000-0000-4000-8000-0000002a0a05', true);
set local role authenticated;
select pg_temp.try('nobody (phone-only): starts a group', $q$select public.create_group('Randoms', '{}'::jsonb)::text$q$);
select pg_temp.try('nobody (phone-only): starts a quick round', $q$select public.start_quick_round('some-course', 'Me', 18, 'stableford', null, null, null)::text$q$);
select pg_temp.try('nobody (phone-only): asks a club about a group booking', $q$select public.send_booking_enquiry('some-course', 'Me', 'me@example.com', null, null, null, null, null, null)::text$q$);
select pg_temp.try('nobody (phone-only): a club claims a course page', $q$select public.request_club_claim(null, 'Club', 'Me', 'me@example.com', null, null, null)::text$q$);
reset role;

-- ---------------------------------------------------------------- A quick round: never asks
select pg_temp.as_user('00000000-0000-4000-8000-0000002a0a06', true);
set local role authenticated;
select pg_temp.try('quick group (phone-only): my_saved_status', $q$select public.my_saved_status()::text$q$);
reset role;

-- ---------------------------------------------------------------- The group switches it off
select pg_temp.as_user('00000000-0000-4000-8000-0000002a0a01', false);
set local role authenticated;
select pg_temp.try('saved organiser switches the limit off', $q$select public.set_feature('phone_only_limited', false)::text$q$);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000002a0a03', true);
set local role authenticated;
select pg_temp.try('switched off: Hamish suggests a trip', $q$insert into public.plans (kind, name, status, proposed, created_by) values ('trip', 'Fiji', 'planning', true,
  '00000000-0000-4000-8000-0000002a0b03') returning 'added'$q$);
select pg_temp.try('switched off: Hamish "I''ve paid"', $q$insert into public.plan_transfers (plan_id, from_id, to_id, amount, created_by) values ('00000000-0000-4000-8000-0000002a0d01',
  '00000000-0000-4000-8000-0000002a0b03', null, 100, '00000000-0000-4000-8000-0000002a0b03') returning 'paid'$q$);
select pg_temp.try('switched off: still can''t start a new group', $q$select public.create_group('Hamish Golf', '{}'::jsonb, 'Hamish', 15)::text$q$);
reset role;

insert into t_results (label, result)
  select 'tables with all three saved-only policies', count(distinct tablename)::text from pg_policies
  where schemaname = 'public' and policyname in ('saved accounts only (add)', 'saved accounts only (change)', 'saved accounts only (remove)')
    and tablename in (select tablename from pg_policies where policyname = 'saved accounts only (add)');
insert into t_results (label, result)
  select 'phone_only_limited default', default_on::text from public.feature_catalogue where key = 'phone_only_limited';

do $$ begin
  raise exception 'RESULTS: %', (select string_agg(n || '. ' || label || ' → ' || result, ' | ' order by n) from t_results);
end $$;
