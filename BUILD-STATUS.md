# Build status

Live app: https://joshm1357.github.io/lgc-golf/
Safe copy of the first working version (Stage 1 only): branch `ambrose-ready`.
Database: Supabase project `lgc-golf` (Sydney), migrations in `supabase/migrations/`.

## Done
- **Database:** full data model for all stages, Row Level Security, PIN-checked join/admin, handicap guard
  (only admin or Tribunal can change a handicap; every change logged), birdie auto-posts, Tribunal functions,
  photo bucket, realtime. Checked with an SQL walk-through (join, admin, scoring, guard, Tribunal verdict).
- **Scoring maths** (`src/lib/scoring.js`, `projection.js`, `board.js`) with 18 tests.
- **Stage 1:** join with group PIN, profile setup with selfie, admin (trips, courses, players, rounds, teams,
  trophies, honour board, PINs, paper-card results), score entry with offline queue, live leaderboard with
  projected finish + win %, scorecards, player profiles with history.
- **Stage 2:** feed (photos, comments, reactions, auto-posts), side comps (closest to pin / longest drive with
  map pins, photos, GPS tee), where's-everyone map (opt-in GPS + "on hole X" from scores).
- **Stage 3:** trophies (BD = Stableford total; Ambrose trophy) with projection, honour board seeded from the
  real trophy, Handicap Tribunal (lodge, evidence, defence, vote, chair overrule, verdict applies handicap),
  courses page.

- **Planner (Coming up):** any number of future trips and one-day rounds. Votes on dates/location/anything
  (✓ 2 pts / ? 1 pt / ✗, anyone suggests options, admin closes and picks the winner, winner can set the
  dates/location), Who's in (In/Maybe/Out + note, admin can lock the list), Details (where/when, Maps link,
  add-to-calendar file, the details text, info cards, day-by-day plan, personal bring checklist), Jobs (owner,
  due date, "I'll do it"), Kitty (costs as total or per head, who fronted, payments, balances), Rooms & cars
  (by hand or the live lotto draw), Organiser's checklist (timed suggestions, never automatic).
  Logic in `src/lib/plan.js` with 15 tests; permissions checked with 20 SQL tests as a non-admin member.
- **Notifications:** Web Push via the `notify` Edge Function (it writes every message itself from an event
  type; admin-only types checked server-side). Daily 9am reminders by pg_cron: votes closing tomorrow,
  reply-by deadline, a week out / day before, jobs due. Push keys live in `server_secrets` (no app access).
  Share-to-Messenger nudges and calendar files need no setup.

- **Planner v2 (18 Oct):** anyone can suggest a trip/round (admin approves or passes); the Rulebook
  (rules + what they apply to; propose → two-tap vote → admin adopts/rejects/retires; seeded with the 2026 rules);
  shared costs (anyone logs what they paid, custom splits, payment details on profiles, who-pays-who with the
  fewest payments, "I've paid" → receiver confirms); review fixes (claimable jobs, row guards, push ownership,
  draw overlay prefers live draws). 43 tests.
- **Offline:** the app opens with no signal (service worker keeps the app; session, players/rounds/courses,
  scores and plans are saved on the phone) and scores entered offline queue and send on reconnect — tested end
  to end in a browser with the network cut. Database client retries are off so a lost signal doesn't freeze reads.
- **Bottom bar:** Leaderboard · Feed · Comps · Coming up · More (Map moved into More).
- **v1.4 (18 Oct night):** GPS distances (front/middle/back/today's pin; `round_pins` table, members can set it
  while the round is live), shot planner (`ShotPlanner.jsx`, `planLegs` in greens.js), green mapper with
  OpenStreetMap fill (line direction + duplicate holes handled), offline course tiles, round rules from the
  Rulebook, trip set-up from a plan, outbox for posts/comp entries (client ids, photos in IndexedDB, 7-day expiry,
  permanent refusals dropped with a message), `lgc-mcp` connector Edge Function (11 tools, key in the URL). 54 tests.
- **Release plan:** DEV-PLAN.md (and the shared doc "L.G.C App — Release plan").

## v1.5 (18 Oct, branch `v1.5`) — built and tested on staging, NOT live yet

**Staging database:** Supabase project `lgc-golf-staging` (Sydney, free plan, ref `ttkaojaqhckiwpgrpxkh`). Loaded with
migrations 001–018 and checked against live: same tables, columns, access rules, triggers, function bodies and
permissions (one difference found and copied across: live's `finalise_case` also clears the Tribunal settings after a
verdict). Staging has no data, no Edge Functions and anonymous sign-in is off.

**Built**
- **Faster first load.** Screens other than Leaderboard, Score entry, Feed and More load when first opened
  (`src/lib/lazy.jsx`). Starting file 856 kB → 492 kB (249 → 145 kB over the wire). The map library only loads with a
  map; the draw ceremony only when a draw is open. The build writes `asset-list.json` and the service worker saves every
  part in the background, so every screen still opens with no signal. If a part has gone (new version), the app reloads
  once to pick up the new version. `NotifyCard` and `useRun`/`must` moved out of the planner (re-exported, nothing renamed).
  A test build can point at staging with `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY`.
- **Clear today's pin** (admin, on the score screen under the distances) — new `clear pin` rule in 019.
- **Rooms & cars one-step save** — tapping a room/car opens one sheet: name, size, note and who's in it, one Save.
  Moving someone takes them out of their old room/car; too many people for the beds/seats is refused before saving.
- **019_v15_tidy.sql** — 42 foreign-key indexes; 5 rules on `members`/`push_subscriptions` read `auth.uid()` once per
  query; function permissions re-stated; trigger function `scores_touch` closed to direct calls; `clear pin` rule.
- **020_merge_policies.sql** — 7 overlapping rule pairs on `plans`, `plan_costs`, `plan_items` merged (same meaning).
- **021_move_pg_net.sql** — pg_net dropped and re-created in `extensions`; the 9am reminder job re-saved from its own
  settings (so the same file works on live and staging).

**SECURITY DEFINER functions checked (A2.5)** — all 15 have `search_path` fixed to `public`; none can be called by
anyone not signed in (anon/public `EXECUTE` already revoked by 003/005/016 — re-stated in 019).
| Function | Checks inside |
|---|---|
| is_member, is_admin, my_player_id, my_status | Only ever answer about the caller (used by every access rule, so they must stay callable) |
| join_group | Signed in + group PIN |
| claim_admin | Member + admin PIN |
| set_pins, admin_create_player, chair_close_case | Admin |
| create_my_player, claim_player | Member |
| lodge_case, cast_vote | Has a player profile; accused can't vote |
| set_defence | Only the accused, while the case is open |
| save_push_subscription | Member with a profile; saves for themselves only |
Changed: only `scores_touch` (a trigger helper anyone could call) is now closed. The advisor will keep listing the 15:
signed-in players have to be able to call them. Stage 1 moves the access-rule helpers into a schema the app can't call
directly, which takes 4 off the list. **Two things to fix in Stage 2 (proper logins):** `claim_player` lets any member
link their phone to any player (e.g. pose as Josh and change his PayID); `claim_admin` has no limit on PIN guesses.

**Tested**
- 54 unit tests pass; build passes.
- SQL access checks on staging (`supabase/tests/v15_access_checks.sql`, as an ordinary player and as admin, rolled back
  afterwards): 26/26 as expected (`v15_access_checks.expected.txt`). Run again after 020 — must be identical.
- Phone-width (375px) browser check of the built app against a stand-in database (this computer can't reach Supabase):
  leaderboard loads only the starting file; the service worker saves all 21 parts; Tribunal, Coming up, Comps and Admin
  open with no signal; clear pin; shot planner map loads on demand and keeps the app font; rooms save in one step;
  over-full room refused.
- Advisors on staging after 019: unindexed foreign keys 42 → 0; per-row `auth.uid()` 5 → 0. Left: 7 overlapping
  rules (020), pg_net (021), the 15 functions (by design), 3 tables with no rules (by design), "unused index" notes
  (normal on an empty database).

**Known**
- Leaflet logs a harmless error if you leave a map screen within half a second of opening it (existing behaviour).

**What's next:** Josh approves 020 and 021 on staging → re-run access checks + advisors + a pg_net test call →
STOP → live SQL below → merge `v1.5` into `main` (deploys) → check the live app.

### Live release steps for v1.5 (after Josh's OK — in this order)
1. Tag `main` as `v1.4` on GitHub (Releases → Draft a new release → tag `v1.4`, target `main`). The build session
   can't push tags.
2. Live SQL — run `019_v15_tidy.sql` (no DROPs; safe with phones on v1.4).
3. Live SQL — run `020_merge_policies.sql` (Josh approves the DROPs).
4. Live SQL — run `021_move_pg_net.sql` away from 9am Sydney time, then test a reminder call:
   `select net.http_post(url := 'https://luogyzvrbedmicjejilr.supabase.co/functions/v1/notify', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.server_secrets where name='cron_secret')), body := '{"type":"daily"}'::jsonb);`
   then `select status_code from net._http_response order by created desc limit 1;` → expect 200.
   (`daily` only sends what's due and never sends the same reminder twice.)
5. Re-run both advisors on live.
6. Merge `v1.5` into `main` → GitHub Pages deploys → open the app, check the "New version ready" banner, leaderboard,
   a score, Coming up → Rooms, More → Tribunal, and airplane mode.

## Known limits
- GPS distances are approximate (±5–10 m) and straight-line; closest-to-pin distance is typed in.
- Location sharing only works while the app is open.
- iPhone notifications only work once the app is added to the Home Screen and opened from there (iOS 16.4+).
- `pg_net` sits in the public schema until 021 runs on live.
- Supabase free plan pauses after 7 days without use — restore it from the dashboard before the next trip.

## Later
- Dinner awards voting, fines.
