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

## Known limits
- GPS distances are approximate (±5–10 m) and straight-line; closest-to-pin distance is typed in.
- Location sharing only works while the app is open.
- iPhone notifications only work once the app is added to the Home Screen and opened from there (iOS 16.4+).
- `pg_net` sits in the public schema (Supabase advisor warning, harmless; moving it needs a drop/recreate).
- Supabase free plan pauses after 7 days without use — restore it from the dashboard before the next trip.

## Later
- Dinner awards voting, fines.
