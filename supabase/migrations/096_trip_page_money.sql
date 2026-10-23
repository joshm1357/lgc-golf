-- 096 — The trip page, money, guests and first open (ov27, Josh's walkthrough review, 23 Oct 2026).
-- ADDITIVE ONLY: two new access rules (policies). No tables, no columns, nothing dropped or renamed; old app versions
-- keep working exactly as before.
--
-- M1 "pay Josh" (option A): everyone's money line now says who to pay by name — the trip's organiser collects the
-- money paid in (plan_transfers with to_id null, what the app used to call "the kitty"), and after "I've paid" it says
-- "waiting for Josh to confirm". Until now only the GROUP's organisers could tick a payment off (016's "confirm a
-- payment"); a trip organiser who isn't one of them couldn't. These two rules let the trip's own organiser
-- (plans.organiser_id) tick off — or remove ("Not received") — money paid in for THEIR trip:
--   * only rows with no to_id (money paid in, not person-to-person payments — those stay with the receiver);
--   * only on a plan they organise (their player in THAT row's group — private.my_player_id(group_id), as 022's rules);
--   * the existing guard trigger (017 plan_rows_guard) still stops anything but `confirmed` changing on an update;
--   * the restrictive "same group only" and "feature on: planner_costs" rules still apply on top (they're AND-ed).
--
-- Nothing else in ov27 needs the database: first-open cards, "one pop-up at a time" and the notifications card are
-- per-phone conveniences (localStorage); "who's joined" reads group_members (members can already read it); guests
-- can already be put in cars by the driver or an organiser (094 runup_join_car); the countdown pushes (I10) use the
-- notify function's existing once-only log (notify_log).
--
-- Apply on STAGING first (lgc-golf-staging), then run supabase/tests/096_trip_page_money_test.sql.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'plan_transfers'
                 and policyname = 'trip organiser confirms money paid in') then
    create policy "trip organiser confirms money paid in" on public.plan_transfers for update to authenticated
      using (to_id is null and exists (select 1 from public.plans p
                                       where p.id = plan_transfers.plan_id and p.organiser_id = private.my_player_id(plan_transfers.group_id)))
      with check (to_id is null and exists (select 1 from public.plans p
                                            where p.id = plan_transfers.plan_id and p.organiser_id = private.my_player_id(plan_transfers.group_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'plan_transfers'
                 and policyname = 'trip organiser removes money paid in') then
    create policy "trip organiser removes money paid in" on public.plan_transfers for delete to authenticated
      using (to_id is null and exists (select 1 from public.plans p
                                       where p.id = plan_transfers.plan_id and p.organiser_id = private.my_player_id(plan_transfers.group_id)));
  end if;
end $$;
