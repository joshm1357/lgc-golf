-- 102 — Phone-only accounts can look and play; organising, money and proposing need a saved account (v10.2, Josh's
-- option B, 23 Oct 2026). RUNS AFTER 101. Not applied to any Supabase project yet.
--
-- ADDITIVE ONLY: one new feature switch (phone_only_limited, on by default), three new private functions, new
-- RESTRICTIVE row-level policies (they can only take access away, never give it), and existing security-definer
-- functions re-saved with the same name, arguments and permissions plus one extra first line (the check). Nothing is
-- dropped or renamed. The policy names are new, so "drop policy if exists" below only ever drops this file's own
-- policies (it makes the file safe to run twice).
--
-- In plain words:
--   * "Just this phone" makes a phone-only account (Supabase anonymous sign-in: auth.users.is_anonymous). A SAVED
--     account is one with Google or email added ("Save your spot" — same account, same name, same scores).
--   * Phone-only CAN still: see everything, say In / Maybe / Out, vote in polls (trip votes, rule votes, fines & awards
--     votes, Tribunal and election votes), enter scores (and Cup match holes), post to the Feed, react, comment, give
--     cap tips, opt in to a side game, enter side comps, drop the pin, claim "Latest out" (an award claim) for
--     themselves, and change their own profile.
--   * These need a SAVED account (the database says "Save your spot first (Google or email) to do this"):
--       - proposing or suggesting a trip, starting planning (new plans, vote options, stays, activities, trip finder);
--       - calling or closing a vote; every organiser action (organisers must always be saved);
--       - "I've paid" and any money entry (costs, payments, deposits, budget);
--       - proposing an award, fine or side game; fining / nominating / claiming for someone else;
--       - penalties (apply, propose, decide, waive); disputes and Tribunal cases; proposing rule changes;
--       - creating cups; inviting people (the group's invite links and personal links).
--   * A group can switch it off (Features → "Phone-only accounts: look and play only"). Quick rounds (groups.quick)
--     never ask: they're one-off rounds started from a course page.
--   * The connector and nightly jobs (no signed-in person) are never asked.
--
-- private.is_saved_user(): true when the JWT says is_anonymous = false. A token from just before "Save your spot"
-- still says true for up to an hour, so auth.users is checked as well: saved when either says so.
--
-- TABLES (restrictive policies, insert / update / delete as listed; reads are never touched):
--   all writes:  trips, rounds, teams, team_players, round_players, courses, course_booking_info, trophies,
--                honour_board, handicap_history, draws, quick_results, members (old one-group table),
--                plans, plan_polls, plan_options, plan_stays, plan_groups, plan_group_members, vote_batches,
--                trip_activities, trip_builds, trip_finds, trip_start_points, trip_tee_options,
--                plan_costs, plan_transfers, plan_payments, plan_budget_items,
--                comps, cups, cup_sides, cup_matches, custom_games, round_games, side_comp_defs, side_comp_conditions,
--                season_settings, tee_groups, commentary_settings, history_notes,
--                rules, dinner_awards, cases, tribunal_cases
--   some writes: players (update someone else, delete), dinner_award_nominations (anyone but yourself),
--                side_comp_entries (organiser changes; removing someone else's), commentary (organiser hides),
--                award_moments (organiser removes), course_social_times (organiser removes)
--   left open (the CAN list, or not on either list): scores, posts, comments, reactions, cap_tips, plan_rsvps,
--                plan_votes, rule_votes, rule_opinions, dinner_award_votes, round_game_players, side_entries,
--                round_pins, trip_activity_people, trip_runup_people, trip_tips, tips, plan_items (jobs and the bring
--                list), plan_comments, location_pings, notify_prefs, push_subscriptions, player_home_areas,
--                course_notes, course_ratings, in_jokes
--   (penalty_proposals, score_adjustments, cup_points, award_runs, case_votes, committee_seats and the like have no
--   write access from the app at all — only through the functions below.)
--
-- FUNCTIONS (re-saved with "perform private.require_saved(...)" as their first line):
--   organiser: add_cup_points, admin_create_player, assign_player, release_player, remove_member, set_member_role,
--     set_feature, set_features (both), set_group_look, set_group_source, set_pins, turn_off_admin_pin,
--     reset_group_code, make_group_official, delete_group, set_round_tv, set_cap_tip_name, set_vote_channel,
--     set_vote_decider, set_invited_vote_email, set_tribunal_share_cards, set_governance, apply_governance_preset,
--     save_committee, save_committee_v2, appoint_seat, import_handicaps, import_history_notes, import_honours,
--     import_rounds, import_rules, use_starter_rulebook, remove_history_handicap, copy_library_course, share_course,
--     forget_running_jokes, call_off_plan, delete_empty_plan, settle_dinner_award, award_run_confirm,
--     award_run_no_winner, waive_award_strokes, waive_cup_points, waive_late_penalty, hide_case, approve_mid_trip
--   votes: start_trip_votes, put_stays_to_vote (both), trip_finder_to_group, trip_finder_decide, decide_poll,
--     call_election
--   penalties: apply_rule_penalty, decide_rule_penalty, waive_rule_penalty
--   disputes and the Tribunal: lodge_case, raise_case, raise_dispute, cup_points_dispute, award_run_dispute,
--     withdraw_case, decide_case, chair_close_case, decide_election, apply_dispute_verdict, apply_verdict_draft,
--     nominate
--   invites: group_invite, reset_group_invite, create_player_link, create_my_player_link, make_organiser_link,
--     team_invite, share_join_code
--   only sometimes: award_claim_post (only when claiming for someone else)
--   NOT gated on purpose: finalise_case (cast_vote calls it when the last vote is in), award_for_trip (claiming
--     "Latest out" for yourself calls it), award_propose_from_scores (the app runs it after a round), cast_vote,
--     vote_case, vote_election, answer_nomination, set_defence, add_case_post, report_case, set_cup_hole,
--     runup_* (cars and the bring list), create_group / start_quick_round / join_* / claim_* (getting in).

-- ------------------------------------------------------------------ The switch
insert into public.feature_catalogue (key, default_on, parent, tier) values ('phone_only_limited', true, null, 'free') on conflict (key) do nothing;

-- ------------------------------------------------------------------ Helpers
create or replace function private.is_saved_user() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v text := auth.jwt() ->> 'is_anonymous';
begin
  if auth.uid() is null then return false; end if;
  if v = 'false' then return true; end if;
  -- No claim (older tokens), or a token from just before they saved: the account itself says.
  return not coalesce((select u.is_anonymous from auth.users u where u.id = auth.uid()), true);
end $$;

-- True, or refuses with the message the app shows (hint 'save_spot' lets the app open the Save your spot sheet).
-- p_group null = the group this phone is in.
create or replace function private.saved_ok(p_group uuid default null) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_g uuid := p_group;
begin
  if auth.uid() is null then return true; end if;                 -- the connector, nightly jobs
  if private.is_saved_user() then return true; end if;
  if v_g is null then v_g := private.current_group(); end if;
  if v_g is not null then
    if exists (select 1 from public.groups g where g.id = v_g and g.quick) then return true; end if;
    if not public.feature_on(v_g, 'phone_only_limited') then return true; end if;
  end if;
  raise exception 'Save your spot first (Google or email) to do this' using errcode = '42501', hint = 'save_spot';
end $$;

create or replace function private.require_saved(p_group uuid default null) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.saved_ok(p_group);
end $$;

revoke all on function private.is_saved_user() from public, anon;
revoke all on function private.saved_ok(uuid) from public, anon;
revoke all on function private.require_saved(uuid) from public, anon;
grant execute on function private.is_saved_user() to authenticated, service_role;
grant execute on function private.saved_ok(uuid) to authenticated, service_role;
grant execute on function private.require_saved(uuid) to authenticated, service_role;

-- For the app (and tests): am I saved, and does this group ask? { saved, limited }
create or replace function public.my_saved_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  return jsonb_build_object('saved', private.is_saved_user(),
    'limited', v_g is not null and public.feature_on(v_g, 'phone_only_limited')
               and not exists (select 1 from public.groups g where g.id = v_g and g.quick));
end $$;
revoke all on function public.my_saved_status() from public, anon;
grant execute on function public.my_saved_status() to authenticated;

-- ------------------------------------------------------------------ Tables: every write needs a saved account
do $$
declare t text; v_grp text;
begin
  foreach t in array array[
    'trips', 'rounds', 'teams', 'team_players', 'round_players', 'courses', 'course_booking_info', 'trophies',
    'honour_board', 'handicap_history', 'draws', 'quick_results', 'members',
    'plans', 'plan_polls', 'plan_options', 'plan_stays', 'plan_groups', 'plan_group_members', 'vote_batches',
    'trip_activities', 'trip_builds', 'trip_finds', 'trip_start_points', 'trip_tee_options',
    'plan_costs', 'plan_transfers', 'plan_payments', 'plan_budget_items',
    'comps', 'cups', 'cup_sides', 'cup_matches', 'custom_games', 'round_games', 'side_comp_defs', 'side_comp_conditions',
    'season_settings', 'tee_groups', 'commentary_settings', 'history_notes',
    'rules', 'dinner_awards', 'cases', 'tribunal_cases']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    -- plan_group_members.group_id is a room or car (plan_groups), not a group: use the phone's group there.
    v_grp := case when t <> 'plan_group_members' and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t and c.column_name = 'group_id')
                  then 'group_id' else 'null' end;
    execute format('drop policy if exists "saved accounts only (add)" on public.%I', t);
    execute format('drop policy if exists "saved accounts only (change)" on public.%I', t);
    execute format('drop policy if exists "saved accounts only (remove)" on public.%I', t);
    execute format('create policy "saved accounts only (add)" on public.%I as restrictive for insert to authenticated with check (private.saved_ok(%s))', t, v_grp);
    execute format('create policy "saved accounts only (change)" on public.%I as restrictive for update to authenticated using (private.saved_ok(%s)) with check (private.saved_ok(%s))', t, v_grp, v_grp);
    execute format('create policy "saved accounts only (remove)" on public.%I as restrictive for delete to authenticated using (private.saved_ok(%s))', t, v_grp);
  end loop;
end $$;

-- ------------------------------------------------------------------ Tables: only some writes
-- Players: your own profile stays yours; changing someone else's, or removing anyone, is an organiser's job.
drop policy if exists "saved accounts only (change others)" on public.players;
create policy "saved accounts only (change others)" on public.players as restrictive for update to authenticated
  using (case when id = private.my_player_id(group_id) then true else private.saved_ok(group_id) end)
  with check (case when id = private.my_player_id(group_id) then true else private.saved_ok(group_id) end);
drop policy if exists "saved accounts only (remove)" on public.players;
create policy "saved accounts only (remove)" on public.players as restrictive for delete to authenticated
  using (private.saved_ok(group_id));

-- Fines & awards nominations: yourself is fine (claiming "Latest out"); anyone else is fining or nominating them.
drop policy if exists "saved accounts only (others: add)" on public.dinner_award_nominations;
drop policy if exists "saved accounts only (others: change)" on public.dinner_award_nominations;
drop policy if exists "saved accounts only (others: remove)" on public.dinner_award_nominations;
create policy "saved accounts only (others: add)" on public.dinner_award_nominations as restrictive for insert to authenticated
  with check (case when player_id = private.my_player_id(group_id) then true else private.saved_ok(group_id) end);
create policy "saved accounts only (others: change)" on public.dinner_award_nominations as restrictive for update to authenticated
  using (case when player_id = private.my_player_id(group_id) then true else private.saved_ok(group_id) end)
  with check (case when player_id = private.my_player_id(group_id) then true else private.saved_ok(group_id) end);
create policy "saved accounts only (others: remove)" on public.dinner_award_nominations as restrictive for delete to authenticated
  using (case when player_id = private.my_player_id(group_id) then true else private.saved_ok(group_id) end);

-- Side comp entries: entering and removing your own is playing; an organiser changing or removing one isn't.
drop policy if exists "saved accounts only (change)" on public.side_comp_entries;
drop policy if exists "saved accounts only (others: remove)" on public.side_comp_entries;
create policy "saved accounts only (change)" on public.side_comp_entries as restrictive for update to authenticated
  using (private.saved_ok(group_id)) with check (private.saved_ok(group_id));
create policy "saved accounts only (others: remove)" on public.side_comp_entries as restrictive for delete to authenticated
  using (case when created_by = private.my_player_id(group_id) then true else private.saved_ok(group_id) end);

-- Organiser-only changes on tables players otherwise write.
drop policy if exists "saved accounts only (change)" on public.commentary;
create policy "saved accounts only (change)" on public.commentary as restrictive for update to authenticated
  using (private.saved_ok(group_id)) with check (private.saved_ok(group_id));
drop policy if exists "saved accounts only (remove)" on public.award_moments;
create policy "saved accounts only (remove)" on public.award_moments as restrictive for delete to authenticated
  using (private.saved_ok(group_id));
drop policy if exists "saved accounts only (remove)" on public.course_social_times;
create policy "saved accounts only (remove)" on public.course_social_times as restrictive for delete to authenticated
  using (private.saved_ok(group_id));

-- ------------------------------------------------------------------ Functions: the check as their first line
-- Each function is re-saved from its current definition (pg_get_functiondef) with one line added straight after its
-- first "begin". Same name, arguments, return type, settings and permissions. A function that already has the check
-- is left alone, so this is safe to run twice. A missing function is skipped (an older database).
do $$
declare
  r record; v_def text; v_pos int; v_m text[]; v_check text; v_n int := 0;
  v_default constant text := 'perform private.require_saved(null)';
begin
  for r in
    select p.oid, p.proname, l.lanname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.proname = any (array[
      -- organiser
      'add_cup_points', 'admin_create_player', 'assign_player', 'release_player', 'remove_member', 'set_member_role',
      'set_feature', 'set_features', 'set_group_look', 'set_group_source', 'set_pins', 'turn_off_admin_pin',
      'reset_group_code', 'make_group_official', 'delete_group', 'set_round_tv', 'set_cap_tip_name', 'set_vote_channel',
      'set_vote_decider', 'set_invited_vote_email', 'set_tribunal_share_cards', 'set_governance', 'apply_governance_preset',
      'save_committee', 'save_committee_v2', 'appoint_seat', 'import_handicaps', 'import_history_notes', 'import_honours',
      'import_rounds', 'import_rules', 'use_starter_rulebook', 'remove_history_handicap', 'copy_library_course', 'share_course',
      'forget_running_jokes', 'call_off_plan', 'delete_empty_plan', 'settle_dinner_award', 'award_run_confirm',
      'award_run_no_winner', 'waive_award_strokes', 'waive_cup_points', 'waive_late_penalty', 'hide_case', 'approve_mid_trip',
      -- votes
      'start_trip_votes', 'put_stays_to_vote', 'trip_finder_to_group', 'trip_finder_decide', 'decide_poll', 'call_election',
      -- penalties
      'apply_rule_penalty', 'decide_rule_penalty', 'waive_rule_penalty',
      -- disputes and the Tribunal
      'lodge_case', 'raise_case', 'raise_dispute', 'cup_points_dispute', 'award_run_dispute', 'withdraw_case',
      'decide_case', 'chair_close_case', 'decide_election', 'apply_dispute_verdict', 'apply_verdict_draft', 'nominate',
      -- invites
      'group_invite', 'reset_group_invite', 'create_player_link', 'create_my_player_link', 'make_organiser_link',
      'team_invite', 'share_join_code',
      -- only sometimes
      'award_claim_post'])
    order by p.proname, p.oid
  loop
    v_def := pg_get_functiondef(r.oid);
    if position('private.require_saved' in v_def) > 0 then continue; end if;
    if r.lanname <> 'plpgsql' then raise exception '102: % is %, not plpgsql — add its check by hand', r.proname, r.lanname; end if;
    v_check := case r.proname
      when 'award_claim_post' then
        -- Claiming for yourself is fine; claiming for someone else (or on their post) is nominating them.
        'if coalesce(p_player, (select x.player_id from public.posts x where x.id = p_post), '
        || '(select private.my_player_id(x.group_id) from public.posts x where x.id = p_post)) '
        || 'is distinct from (select private.my_player_id(x.group_id) from public.posts x where x.id = p_post) then '
        || 'perform private.require_saved((select x.group_id from public.posts x where x.id = p_post)); end if'
      when 'set_cap_tip_name' then 'perform private.require_saved(p_group)'
      when 'set_vote_channel' then 'perform private.require_saved(p_group)'
      when 'set_vote_decider' then 'perform private.require_saved(p_group)'
      when 'delete_group' then 'perform private.require_saved(p_group)'
      when 'make_organiser_link' then 'perform private.require_saved(p_group)'
      else v_default end;
    -- The body starts after "AS $function$"; the check goes straight after the body's first "begin".
    v_pos := position('$function$' in v_def);
    if v_pos = 0 then raise exception '102: can''t find the body of %', r.proname; end if;
    v_m := regexp_match(substr(v_def, v_pos), '^(.*?\mbegin\M)', 'is');
    if v_m is null then raise exception '102: can''t find "begin" in %', r.proname; end if;
    v_def := substr(v_def, 1, v_pos - 1) || v_m[1]
             || E'\n  ' || v_check || '; -- 102: saved accounts only'
             || substr(v_def, v_pos + length(v_m[1]));
    execute v_def;
    v_n := v_n + 1;
  end loop;
  raise notice '102: % functions now ask for a saved account', v_n;
end $$;
