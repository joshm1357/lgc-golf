-- 019: v1.5 tidy-up from the 18 Oct health check. Nothing here changes how the app plays.
-- Safe for phones still running v1.4: no table, column or function the app uses is changed or removed.
--   1. Indexes for the 42 foreign keys that had none (faster joins and deletes).
--   2. Access rules that read auth.uid() once per row now read it once per query.
--   3. (moved to 020 — merging access rules needs a DROP, which needs Josh's OK in the chat)
--   4. Function permissions: the one trigger function that anyone could call is closed off.
--   5. Admin can clear a wrongly dropped pin (new delete rule on round_pins).
-- Overlapping rules are merged in 020; pg_net is moved in 021. Both need DROP statements,
-- which the database tools only run after Josh approves them.

-- ---------- 1. Foreign-key indexes ----------
create index if not exists comments_player_id_idx on public.comments (player_id);
create index if not exists comments_post_id_idx on public.comments (post_id);
create index if not exists draws_round_id_idx on public.draws (round_id);
create index if not exists handicap_history_player_id_idx on public.handicap_history (player_id);
create index if not exists members_player_id_idx on public.members (player_id);
create index if not exists plan_costs_created_by_idx on public.plan_costs (created_by);
create index if not exists plan_costs_paid_by_idx on public.plan_costs (paid_by);
create index if not exists plan_group_members_player_id_idx on public.plan_group_members (player_id);
create index if not exists plan_items_created_by_idx on public.plan_items (created_by);
create index if not exists plan_items_owner_id_idx on public.plan_items (owner_id);
create index if not exists plan_options_created_by_idx on public.plan_options (created_by);
create index if not exists plan_payments_player_id_idx on public.plan_payments (player_id);
create index if not exists plan_polls_created_by_idx on public.plan_polls (created_by);
create index if not exists plan_polls_winner_option_id_idx on public.plan_polls (winner_option_id);
create index if not exists plan_rsvps_player_id_idx on public.plan_rsvps (player_id);
create index if not exists plan_transfers_created_by_idx on public.plan_transfers (created_by);
create index if not exists plan_transfers_from_id_idx on public.plan_transfers (from_id);
create index if not exists plan_transfers_to_id_idx on public.plan_transfers (to_id);
create index if not exists plan_votes_player_id_idx on public.plan_votes (player_id);
create index if not exists plans_created_by_idx on public.plans (created_by);
create index if not exists plans_trip_id_idx on public.plans (trip_id);
create index if not exists posts_player_id_idx on public.posts (player_id);
create index if not exists posts_round_id_idx on public.posts (round_id);
create index if not exists posts_trip_id_idx on public.posts (trip_id);
create index if not exists quick_results_player_id_idx on public.quick_results (player_id);
create index if not exists reactions_player_id_idx on public.reactions (player_id);
create index if not exists round_pins_set_by_idx on public.round_pins (set_by);
create index if not exists round_players_player_id_idx on public.round_players (player_id);
create index if not exists rounds_course_id_idx on public.rounds (course_id);
create index if not exists rounds_trip_id_idx on public.rounds (trip_id);
create index if not exists rule_votes_player_id_idx on public.rule_votes (player_id);
create index if not exists rules_proposed_by_idx on public.rules (proposed_by);
create index if not exists scores_entered_by_idx on public.scores (entered_by);
create index if not exists scores_tee_shot_player_idx on public.scores (tee_shot_player);
create index if not exists side_entries_created_by_idx on public.side_entries (created_by);
create index if not exists side_entries_player_id_idx on public.side_entries (player_id);
create index if not exists side_entries_round_id_idx on public.side_entries (round_id);
create index if not exists team_players_player_id_idx on public.team_players (player_id);
create index if not exists teams_round_id_idx on public.teams (round_id);
create index if not exists tribunal_cases_lodged_by_idx on public.tribunal_cases (lodged_by);
create index if not exists tribunal_votes_voter_id_idx on public.tribunal_votes (voter_id);
create index if not exists trophies_trip_id_idx on public.trophies (trip_id);

-- ---------- 2. auth.uid() once per query, not once per row ----------
alter policy "read own membership" on public.members
  using (user_id = (select auth.uid()) or public.is_admin());
alter policy "own subs read" on public.push_subscriptions
  using (user_id = (select auth.uid()));
alter policy "own subs add" on public.push_subscriptions
  with check (user_id = (select auth.uid()) and player_id = public.my_player_id() and public.is_member());
alter policy "own subs update" on public.push_subscriptions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and player_id = public.my_player_id());
alter policy "own subs remove" on public.push_subscriptions
  using (user_id = (select auth.uid()));

-- ---------- 4. Function permissions ----------
-- Every SECURITY DEFINER function was checked (list in BUILD-STATUS.md): each one checks
-- membership/admin/ownership itself and has search_path fixed to public; none can be called by
-- visitors who haven't signed in. Re-stated here so a fresh database ends up the same.
revoke execute on function
  public.is_member(), public.is_admin(), public.my_player_id(), public.my_status(),
  public.join_group(text), public.claim_admin(text), public.set_pins(text, text),
  public.create_my_player(text, text, numeric, text), public.claim_player(uuid),
  public.admin_create_player(text, text, numeric, text), public.lodge_case(uuid, numeric, text, text),
  public.set_defence(uuid, text), public.cast_vote(uuid, text, text), public.chair_close_case(uuid, text, text),
  public.save_push_subscription(text, text, text, text)
  from public, anon;
-- Trigger-only functions: nobody calls these directly.
revoke execute on function public.scores_touch() from public, anon, authenticated;
revoke execute on function public.finalise_case(uuid, text, text), public.plan_rows_guard(),
  public.players_approval_guard(), public.players_handicap_guard(), public.scores_autopost()
  from public, anon, authenticated;

-- ---------- 5. Clear today's pin (admin) ----------
create policy "clear pin" on public.round_pins for delete to authenticated
  using (public.is_admin());
