# ov35 report — When? / Where? votes, co-organisers, several draft trips

Branch `ov35-votes-coorg` (from `origin/v10-5-caddie-plan-link`), pushed. Migration **104**, not applied anywhere. Not merged.

## What I built
1. **Two votes, either order.** Step 1 of the trip builder now has two cards, 📅 When? (weekends, plus How long? if asked) and 📍 Where? (areas, plus their courses and places to stay if you want). Each card has its own Call, status, results, close button and Feed post. You can call either one first. "Call both votes" sends both in one message: one batch, but each card's polls still close on their own. Choosing the area no longer settles the weekend, and settling the weekend no longer chooses the area. The course calls unlock once both are decided, as before. Old trips that already have the combined vote (`votes.v1`) keep the old screen exactly as it was. Files: `src/lib/votecards.js`, `src/components/WhenWhere.jsx`, `src/screens/TripBuilder.jsx`.
2. **Vote status in plain words.** Each card shows one of: "Not called yet", "Out now — 3 of 12 voted, closes Mon", "Closed — Hunter Valley won 2–1", or "Decided — … (no vote)". Any button that closes a vote says so ("Close the vote and go with Fri 25 – Sun 27 Dec"), with "This closes the When? vote now and posts the result in the Feed" under it. Choosing an area from the area page while the Where? vote is out now asks first.
3. **Co-organisers.** The trip has a "👥 Co-organisers" card, on both the Plan the trip view and the map screen. The organiser can add 1–3 players, share "📤 Help me plan this" (the trip link plus `role=co`) and remove people. A co-organiser can step down. They get a notification (new notify type `coorganiser_added`). On that one trip, a co-organiser gets the organiser's view through `PlanRole` (session override). The database enforces what they can do (104). Suggestions from anyone (the optional extra) were not built.
4. **Several drafts.** Trips has a new "🧭 My draft trips" card showing each draft with when it last changed, an Open button and ✨ Chat. The Caddie's ✨ planning chat is now kept per trip (90 days), and the chat that hasn't made a trip yet is kept separately (a week). The Caddie's Plan tab has a "Planning:" picker. "Start a new plan" keeps the current trip's chat. The old one-chat-per-group copy is moved to its trip the first time it's opened. The Trips button reads "Carry on a plan (2 on the go)" when there's more than one. Files: `src/lib/planchat.js`, `src/components/CaddiePlan.jsx`, `src/components/DraftTrips.jsx`, `src/lib/chatwanted.js`.
   - **Were AI-made drafts hidden?** No. They are `planning` with `proposed = false`, so they were already listed under "Being organised".

## What I couldn't do or left out
- **Caddie planning chat is still organisers only.** The ai-helper's `plan_chat` mode refuses non-organisers, so a co-organiser plans on the trip screen instead.
- **"Suggest an area, course or weekend" from anyone** was optional and isn't built.
- **Migration 104** is tested on PGlite only (all 104 migrations, 104 applied twice), not on staging. The notify change is not deployed.
- **Phone-only players:** the saved-account rules from v10.2 (102) still apply on top. A phone-only co-organiser would be refused organiser actions until they save their account.

## Migration 104 (`supabase/migrations/104_coorganisers.sql`)
- **New table `plan_coorganisers`** with RLS. Members can read it. A group organiser or the trip's own organiser can add people. Those organisers, or the person themselves, can remove a row. There are also restrictive same-group and feature `planner` policies. A trigger caps it at 3 per trip, refuses guests and players from other groups, and refuses finished or called-off trips.
- **New permissive "co-organisers add/change/remove" policies** on these tables, so co-organisers get organiser rights there: plan_polls, vote_batches, plan_rsvps, plan_items, plan_costs, plan_payments, plan_transfers, plan_groups, plan_stays, plan_budget_items, trip_builds, trip_tee_options, trip_start_points, plan_options and plan_group_members. Also "co-organisers edit" on plans.
- **Changing who organises a trip, or its link to the app's trip, stays with the group organiser.** The existing `plans_trip_guard` still enforces this.
- **`can_decide` is replaced:** the same as 025, plus co-organisers.
- **Organiser checks inside functions are patched the way 029 did it:** the live function body is read, only the check is changed, and the function is re-created. This covers `plan_rows_guard`, `plan_items_stage`, `plan_stays_guard`, `plan_items_late_guard`, `plans_repeat_guard`, `call_off_plan` and both `put_stays_to_vote` versions. A patch is skipped if it's already done, and the migration fails loudly if the check isn't where it's expected.
- **No policy or check is dropped or re-added.** The only `drop policy if exists` lines are for 104's own new policies, so the migration can re-run cleanly.
- **SQL test** `supabase/tests/104_coorganisers.sql` (+ expected): 41 checks.

## Tests
- **vitest:** 1,743 pass. New tests: votecards (16), coorganisers (3), planchat-trips (7).
- **notify:** deno type-check passes and its 16 tests pass.
- **e2e (port 4363):**
  - New `tests/e2e/votes-coorg-test.mjs` passes. It covers two votes in either order, a co-organiser calling a vote, and two drafts with their own chats.
  - `trip-builder` and `weekends-comps` were adjusted for the two cards and pass. "Call both" replaces the old single Call button. In weekends-comps, the detail count is now out of the Where? voters: "1 of 3 went into the detail" (was "Only 1 of 4").
  - These pass unchanged: plan-ux, calloff, ov26-votes, trips, caddie, ai-helper, ai-helper-v2, trip-overview, trip-plan, trip-page, trip-extras, organise-tidy, desktop, tripfinder, late-job, runup, view-as, email-votes, nav, hello-maps, phone, features.
- **Screenshots** are in the scratchpad: `shots-ov35/`.

## Edits to other builders' files
None of ov36's files were touched (AreaStart.jsx, BuilderMap.jsx, PlanMapTools.jsx, the course lists). The only change near them is that TripBuilder now passes a different `onCallVote` / `onChoose` behaviour into AreaStart.

Small edits to shared files:
- `src/App.jsx`: the plan and build routes are wrapped in `PlanRole`.
- `src/lib/store.jsx`: new `SessionOverride`.
- `src/screens/OrganiseSteps.jsx`: one line for the co-organisers card.
- `src/components/Caddie.jsx`: `openPlanner({ planId })`.
- `src/screens/AiPlanner.jsx`: the "Carry on" words.
- `src/screens/Trips.jsx`: the `<MyDraftTrips />` card.
- `supabase/functions/notify/index.ts`: the new type, and co-organisers may send that trip's organiser messages.

## Decisions Josh should know about
- **"Call both" is one notification and one vote card for voters,** but it shows as two cards in the builder and each closes separately. Its batch title stays "Where and when?".
- **"Are you in?" is asked only on the first vote called.**
- **The co-organiser's view is the organiser's screens for that trip.** Anything outside the trip is refused by the database.
- **Who can add co-organisers:** a group organiser or the trip's named organiser, not other co-organisers.
- **The Where? card's "went into the detail" count** is now out of the people who answered Where?, not everyone who voted on anything.
