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
- **021_move_pg_net.sql** — pg_net dropped and re-created in `extensions`. The 9am reminder job calls `net.http_post`
  by name each run, so it isn't touched (re-saving it could create a duplicate job or wake a paused one).

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
- SQL access checks on staging (`supabase/tests/v15_access_checks.sql`, as an ordinary player, a stranger who never
  joined, and the admin; rolled back afterwards): 30/30 as expected (`v15_access_checks.expected.txt`). Run again after
  020 — must be identical.
- **Independent review** (a fresh agent that didn't write the code): 020 merges confirmed exactly equivalent; 019 safe
  for v1.4 phones; "New version ready" banner still works. Fixed what it found: (1) the offline copy could throw away
  saved screens when the parts list failed to load on weak signal, and (2) a Wi-Fi login page could replace the saved
  app — the service worker now only saves a real copy of the app, saves the page after its files, and only clears old
  files after a complete save; opening the app waits at most 4 s for the network before using the saved copy; parts
  inside a screen (draw, shot planner, draw set-up) never reload the page and get a Close button; a real crash says so
  instead of blaming signal; a retried room save can't create a duplicate room; two phones editing a room at once can't
  half-fail; Clear pin is a full-size red button; people no longer "In" are marked in the room sheet.
- Phone-width (375px) browser check of the built app against a stand-in database (this computer can't reach Supabase):
  leaderboard loads only the starting file; the service worker saves all 21 parts; Tribunal, Coming up, Comps and Admin
  open with no signal; saved parts survive a failed parts list and a Wi-Fi login page; clear pin; shot planner map loads on demand and keeps the app font; rooms save in one step;
  over-full room refused.
- Advisors on staging after 019: unindexed foreign keys 42 → 0; per-row `auth.uid()` 5 → 0. Left: 7 overlapping
  rules (020), pg_net (021), the 15 functions (by design), 3 tables with no rules (by design), "unused index" notes
  (normal on an empty database).

**Known**
- Leaflet logs a harmless error if you leave a map screen within half a second of opening it (existing behaviour).

**Decided 18 Oct (Josh):** profiles one per group; photos public with per-group folders; courses per group until
Stage 8; Josh pastes 020 and 021 into the staging SQL editor himself (the tools here can't run DROPs).

**What's next:** Josh pastes 020 and 021 on staging → re-run access checks + advisors + a pg_net test call →
STOP → live SQL below → merge `v1.5` into `main` (deploys) → check the live app.

### Live release steps for v1.5 (after Josh's OK — in this order)
1. Tag `main` as `v1.4` on GitHub (Releases → Draft a new release → tag `v1.4`, target `main`). The build session
   can't push tags.
2. Live SQL — run `019_v15_tidy.sql` (no DROPs; safe with phones on v1.4). Before 020, check live hasn't drifted:
   `select policyname, cmd, qual, with_check from pg_policies where tablename in ('plans','plan_costs','plan_items');`
3. Live SQL — run `020_merge_policies.sql` (Josh approves the DROPs).
4. Live SQL — run `021_move_pg_net.sql` away from 9am Sydney time (indexes in 019 also briefly pause writes — not
   during a live round). Check `select jobid, jobname, active from cron.job;` still shows one active
   `lgc-daily-reminders`, then test a reminder call:
   `select net.http_post(url := 'https://luogyzvrbedmicjejilr.supabase.co/functions/v1/notify', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.server_secrets where name='cron_secret')), body := '{"type":"daily"}'::jsonb);`
   then `select status_code from net._http_response order by created desc limit 1;` → expect 200
   (if nothing after ~10 s: `select net.worker_restart();`).
   (`daily` only sends what's due and never sends the same reminder twice.)
5. Re-run both advisors on live.
6. Merge `v1.5` into `main` → GitHub Pages deploys → open the app, check the "New version ready" banner, leaderboard,
   a score, Coming up → Rooms, More → Tribunal, and airplane mode.


## v2.0 Stage 1 — Groups (branch `stage-1-groups`, on staging only)

**Built**
- **Database (022, 023).** `groups` (L.G.C = the `legacy` group, copied from `settings`) and `group_members`
  (copied from `members`; the 2 admins are organisers). `group_id` on 33 tables, filled in for L.G.C without touching
  anything else (score times unchanged), indexed, then required. A trigger fills it on every new row from the row's
  parent (a score from its round, a post from its round/trip/player…) or from the person's current group; a row can't
  point at another group's parent and can't be moved between groups. Every existing access rule was rewritten in
  place to mean "of this row's group" (same names, same meaning — the 30 L.G.C access checks give identical answers),
  plus a second lock on every table: "same group only". The old function names work as before, answering for the
  person's current group (the group the new app names in the `x-group-id` header, else their first). Photos: new
  uploads go to `<group id>/<folder>/…`; old phones' folders only work for L.G.C. Claude connector keys live in
  `connector_keys` (hashed, one group each; L.G.C keeps its current key). `join_group_id(pin)` tells the app which
  group a PIN opened.
- **Deviation:** `plan_group_members` (rooms & cars) already has a column called `group_id` — its room/car — so it
  gets its golf group through the room/car instead of a column of its own. Its rules and the "same group only" lock
  go through the room/car.
- **Server.** `notify` works inside one group: the group the app names (if you're in it) or your first; every id in a
  request must be that group's; messages only reach phones of people in that group; the daily reminders run group by
  group. `lgc-mcp`: each key reaches one group only.
- **App.** `src/lib/group.js`: every database request carries the group and every read of a group's table is filtered
  to it, centrally, so no screen can show another group's rows. Offline copy and live updates per group; photo folders
  per group (fixed when queued); join opens the joined group. Old offline copy carried over once.

**Tested (staging)**
- Isolation (`supabase/tests/stage1_isolation.sql`): a second group with players, a live round, a score, a plan,
  a cost, a room, a rule, a post and a Tribunal case. An L.G.C player sees **0** of Group B's rows across all tables
  and can't edit, delete, score, post, say In, take a room, claim a player, lodge or vote on a case, or upload into
  B's photo folder; Group B sees **0** L.G.C rows; B's organiser can't touch L.G.C rounds or handicaps; the handicap
  guard works per group and logs in the right group; a person in both groups gets the right group from the header.
- Access checks within L.G.C: 30/30 identical to v1.5.
- Claude connector (called from the database): Group B's key sees only Group B; L.G.C round/plan ids → "No such
  round/plan in this group"; can't score L.G.C players; wrong key → 404.
- Daily reminders: processed per group (both groups' "trip is tomorrow" reminders logged separately); wrong cron
  secret → 401; notify without sign-in → 401.
- App: 63 unit tests; phone-width browser check (all v1.5 checks plus: every group-table read carries this group's
  filter and header; rooms & cars reads are left alone).

**Not yet tested — needs Josh:** notify refusing another group's ids for a *signed-in* caller, and the old-version
(v1.5 build) browser test against staging, both need **anonymous sign-ins switched on in `lgc-golf-staging`**
(Authentication → Sign In / Providers). The old-app behaviour (no header) is covered by the SQL tests.
**Independent review → fixes (migration 024, 18 Oct)** — 3 must-fix, 6 should-fix, all done on staging:
- The old `members` list is L.G.C's only (an organiser of another group could read and change it); nobody can write
  to `members` or `group_members` directly any more.
- A score can't name another group's player or team (the birdie post could leak a name).
- Every link to another row must stay in the group — a round's course, a job's owner, a cost's payer, a vote's option,
  a room's people… (one automatic check per table, rebuilt by later migrations), and a row with two parents is checked
  against both.
- Joining and admin PINs: 10 wrong tries an hour per sign-in (30 per internet address), then "wait an hour". New
  groups get a 10-character joining code made by the app (`reset_group_code()`), so there's nothing to guess and no
  "that PIN is taken" hint; L.G.C keeps choosing its own PIN. Empty PINs refused.
- `group_members` taken off live updates (its delete events reached every phone); notify and the connector read
  options/courses through the group too; the connector no longer remembers wrong keys.
- Tested: isolation test now 47 checks (members list, cross-group job owner, direct membership insert, own-PIN on a
  new group, new joining code, cross-group birdie, the 11th wrong PIN).
- Not done (notes): the photos bucket is public (links are unguessable; a private bucket with signed links is a later
  job); the draw room's live "who's here" channel is public (as in v1.5).

## v2.0 Stage 1b — Trips (branch `stage-1b-trips`, on staging only)

**Built** (spec: `docs/TRIPS-SPEC.md`)
- **Database (025).** `plans.organiser_id` (whoever suggested it; only the admin can change it) and `budget_pp`;
  `groups.vote_decider` (`admin` | `admin_or_organiser`, set in Admin → 8); `start_trip_votes()` — whoever suggested a
  trip opens its first dates and place votes with their options; `decide_poll()` / `can_decide()` — the admin, or the
  trip's organiser if the group allows it, closes a vote and the winner fills in the trip's dates or place;
  `plan_comments` (Chat); `notify_prefs` and `notify_queue`. **Lock-in makes the trip in the app**: when a plan is set
  to Locked in with dates (new button, or the old Edit sheet on an old phone) its `trips` row is made once, and later
  date changes follow it. **Trips start and finish on their own**: on its first day a locked-in trip becomes the
  current trip (the old one closes, and any round still live in it); a week after the last day it's marked Done.
  Past trips with no plan (e.g. the 2026 South Coast trip) got one, so every trip is in one list.
- **Server.** `notify`: each person's choice per group — straight away (default, so nothing changes for L.G.C), a
  daily digest at their hour, or only important (draw room, a job for you, money, your trip tomorrow). "The draw
  room is open" always goes straight away. Hourly digest job (`lgc-hourly-digest`, 3 past each hour). New messages:
  Chat, "locked in"; a suggestion now goes to everyone (they can vote straight away); the suggester can send their
  own vote's message; the organiser can send "decided" when allowed.
- **App.** Bottom bar **Trips** (was Coming up): the trip that's on or next (big card; Leaderboard button while on),
  other locked-in trips, **Ideas and voting** (what's still to decide: "Dates: 3 options, closes Fri"), **Past trips**
  (dates, place, rounds played, first photo; called-off greyed). **Suggest a trip or round**: 2–3 date options or
  "roughly…", 1–3 places with rough cost, budget each, vote closing date. Each trip: stage bar
  (Idea → Deciding → Locked in → On now → Done), organiser, **Chat** tab, **Lock it in** (admin), "Add the rounds" to
  the trip made at lock-in. More → Notifications: **When you hear about things** + iPhone Home Screen steps.

**Tested (staging)**
- `supabase/tests/stage1b_trips.sql` — 39 checks: a suggestion opens its two votes (once), only the suggester or
  admin can, anyone adds options; organiser can't be handed over by a player; Chat lands in the right group; settings
  only your own; nobody reads the digest queue; with "admin" the organiser can't pick a winner, with "admin or
  organiser" they can (own trip only, not another player); a retry of the same pick is fine, changing a decided vote
  isn't; another group sees 0 trips/votes/options/chat/settings and can't comment, open votes or change the setting;
  lock-in makes exactly one trip; dates follow; scoring on it works; old-phone lock-in works; an old phone's setup after
  lock-in leaves one trip; a missed first day is caught up, a round inside a running trip doesn't take over; a week
  later → Done.
- Digest end to end on the staging server: a job due tomorrow for a digest person is queued (not sent); at the wrong
  hour nothing goes; at their hour the 3 waiting items go as one; "only important": the job goes straight away, a
  vote closing tomorrow doesn't. (No real phone subscribed on staging, so "sent" is counted as 0 — the queue and the
  once-a-day log show what happened.)
- Phone width (375 px, `tests/e2e/trips-test.mjs`): 18 checks — Trips tab sections, Suggest sheet, idea's stage bar
  and votes, Chat, closing a vote via `decide_poll`, Lock it in, Admin setting, no sideways scroll, no page errors.
  The v1.5 browser checks (`tests/e2e/phone-test.mjs`) all still pass. 75 unit tests.
- Regression after 024–026 (re-run on staging): isolation 47/47, Trips 39/39, L.G.C access checks 30/30.

**Independent review → fixes (026, 18 Oct)** — nothing leaked between groups; 2 must-fix, 5 should-fix, done:
- An admin on an old phone who taps "Set it up in the app" after lock-in no longer leaves a stray empty trip (the
  empty one lock-in made is tidied away); a trip deleted by hand doesn't come back by itself.
- The new app works before 025 is applied (budget only sent when given; the admin closes votes the old way).
- No flooding: at most 3 "new idea" buzzes a day from one person; one Chat buzz per trip every 10 minutes; people who
  haven't picked their name can't send anything.
- The midnight job never swaps trips in the middle of one that's on (a one-day round inside a long weekend stays
  put), and catches up a missed first day. The hourly digest job is checked to really ask for the digest.
- Trips added in Admin → Trips (no plan) still show on the Trips tab; Trips keeps an offline copy; switching to
  "only important" still delivers waiting important items; the vote-closing button says "Pick this winner".
- "Trusted server" in the lock-in guard is now the request's database role, not "nobody signed in".
- Left as notes: past trips don't show winners yet (the honour board isn't linked to trips — Stage 6 history import
  links them); Chat delete events, like other tables', carry only the deleted row's id to every phone.

### Live order for v2.0 (at the release STOP — not before)
022 → 023 → 024 → 025 → 026 → 027 → 028 → 029 → 030 → 027b on live, then deploy `notify` and `lgc-mcp`, then the app. (On staging 024 ran after 025;
025 calls the same-group check builder again, so the order above is the one for live.)

## v2.0 Stage 2 — Proper login, roles and invites (branch `stage-2-login`, on staging only)

**Decided (18 Oct):** no Apple sign-in for now; Google + emailed code; Facebook later if wanted.
**STOP:** no sign-in provider is switched on. Josh's steps are in `docs/SIGN-IN-SETUP.md` (note: email to anyone needs a
domain, or Gmail SMTP for now).

**Built** (no new sign-in setting needed)
- **Invite links + QR codes (027).** One player link and one guest link per group, 12 letters/numbers made by the
  server; organiser can make a new one (old stops working). Joining by link works before you're in any group, from
  inside the app for another group, while still picking your name, and — for the iPhone Home Screen app, which can't
  open links from chats — by **pasting the link** into the PIN box or Group → "Join another group". Wrong links count
  toward the wrong-PIN limit. L.G.C's group PIN keeps working.
- **Roles:** organiser / player / guest. Guests play, score, post and chat, but don't vote on rules, propose rules, or
  vote or lodge in the Tribunal (the database refuses; the screens hide the buttons) and add themselves rather than
  taking an existing name. Organisers change roles (never zero organisers, even if two act at once), give a nameless
  member a name, free a name, and take people out (027b). Role changes and removals are posted on the feed.
- **Names:** you can only pick a name nobody else has ("taken" shows on the list); an organiser hands it over.
- **Admin PIN:** L.G.C only. An organiser can switch it off in Group & invites; after that it answers like a wrong PIN
  (old phones show their usual message). Using it posts on the feed.
- **Wrong-PIN limits (028):** per person, per real address (checked on staging: the first `x-forwarded-for` entry can
  be faked, so the platform's own address header is used), and 60 an hour across everyone for PINs.
- **Group & invites screen** (More): switch group (fresh start in the other group), invite + guest links with QR and
  share, people and roles. **Sign-in** buttons (Google; email with a 6-digit code, which works inside the Home Screen
  app) are built but hidden until `VITE_SIGN_IN` is set; a phone-only player adds a sign-in to the *same* user (keeps
  scores). Sign-in problems coming back from Google are shown; a Google sign-in that made a new empty account is
  explained and can sign out.

**Tested (staging)**
- `supabase/tests/stage2_invites.sql` — 35 checks pass (links, reset, guessing limit, join, names, roles, guests,
  feed posts, L.G.C admin PIN off). Regression after 027/028: isolation 47/47, Trips 39/39, access 30/30.
- Phone width (`tests/e2e/stage2-test.mjs`, 19 checks): group screen, QR, new link, roles, switching group, joining by
  link and by pasting it, players see no invite controls, new groups have no admin PIN entry. Trips and v1.5 phone
  checks still pass. 78 unit tests.

**Independent review → fixes (028 + app):** iPhone Home Screen joining (must-fix); admin PIN switch-off; faked-address
and fresh-user limit holes; guests taking unclaimed names; New link failures; guest buttons; own-row detection,
confirms; two organisers demoting each other; sign-in traps (silent link failure, empty new Google accounts, email
links opening Safari). Left as notes: invite codes stored plainly (server-only table); duplicate display names allowed.

**Josh's paste list for staging (approvals time out from here):** `020`, `021`, `027b_remove_member.sql`, `033b_remove_history_handicap.sql` (after 033c),
`drop function public.tmp_echo_headers();` (a test helper, already emptied and locked), and (Stage 9)
`041b_delete_my_data.sql` then run `supabase/tests/stage9_delete.sql` (it rolls back; compare with its .expected.txt).

## v2.0 Stage 3 — Feature switches (branch `stage-3-features`, on staging only)

**Built**
- **One list** (`src/lib/features.js`): 17 switchable features with name, description, new-group default, what each
  needs (side comp bonus needs side comps; votes/jobs, shared costs, rooms and cars need the Trips planner) and a tier
  (`free` for all — ready for premium later, no billing). Scoring, leaderboard, players, rounds and courses can't be
  switched off. A unit test checks the database's copy matches.
- **Database (029):** `feature_catalogue`, `group_features` (live updates), `feature_on(group, key)` (the group's choice,
  else the default; off when its parent is off), `set_feature` (organisers). **Enforced:** every feature's tables refuse
  adds, changes and removals while it's off — from any app version or the connector — reads still work; plus rule
  proposals, side comp bonus strokes, Tribunal cases and votes, and trip votes in the server functions. Birdie posts
  aren't made with the Feed off. **L.G.C:** everything on apart from scorecard photos and booking links.
- **App:** `useFeature(key)`; switched-off features disappear cleanly — bottom bar (Feed, Comps, Trips), More (map,
  Trophy Room, Tribunal, notifications), the draw, distances and shot planner, side comp prompts, trip tabs (Vote, Jobs,
  Kitty, Rooms & cars) and the job checklist, rule proposing/voting, bonus strokes. Trips without votes take the first
  date and place straight away. **Features** switches for organisers in Group & invites (dependants greyed out; a
  warning when switching off a parent).
- **Server:** `notify` sends nothing for a switched-off feature (or when notifications are off); the Claude connector's
  link stops working when the connector is off.

**Tested:** 83 unit tests; `supabase/tests/stage3_features.sql`; phone width `tests/e2e/features-test.mjs` (9 checks:
3-tab bar, hidden menu items, greyed dependants, switching, no sideways scroll).

**Independent review → fixes (030 + app + server):** the Claude connector now checks each tool's feature (and hides
tools that are off); every Tribunal step (defence, chair's close, verdict) checks the Tribunal is on; automatic posts
(verdicts, "wants to join", role changes, admin PIN, removals) only when the Feed is on; bonus strokes refuse only a
*change* to the bonus (a round that already has one can still be started and locked); the trip-vote checks are
verified; L.G.C's 17 switches written out; a mistyped feature key fails closed; digest and daily reminders skip
switched-off features (checked before marking anything sent); screens of a switched-off feature say so instead of
half-working (old links, bookmarks); side comp prompts, feed moments/photos, admin trophy/draw/side-comp editors,
the room draw, trophy copying and the draw overlay hidden when off; Trips without votes asks for one date and place;
scorecard photos and booking links show as "coming soon".
**Tested after fixes:** Stage 3 test 27 checks; isolation 47/47, Trips 39/39, Stage 2 35/35, access 30/30 unchanged;
connector on the staging server: L.G.C's link works, a group with the connector off gets "Not found"; all four phone
tests pass (features, Stage 2, Trips, v1.5 regression).

**Release:** see `docs/RELEASE-v2.0.md` — **RELEASE v2.0 is a STOP**.

## v2.1 Stage 4 — Branding from the database (branch `stage-4-branding`, on staging only)

**Built**
- **Database (031):** each group has a name, short name, crest (an uploaded photo in its own folder, or L.G.C's
  built-in one — L.G.C only), main and accent colours, and a heading font (4 set choices). L.G.C's row holds exactly
  today's look; a new group gets the plain The Golf Trip look. `set_group_look` (organisers) checks the colours'
  format, the font, and that a crest comes from the group's own folder. `my_status` returns the look.
- **App:** `src/lib/theme.js` turns a look into the app's colour settings (L.G.C's hand-picked in-between shades kept
  exactly) and paints it at start-up from the last look, so there's no flash. The header and join screen show the
  group's crest (uploaded / L.G.C's / plain). **Look** card for organisers (Group & invites): live preview, crest upload
  (shrunk to 512 px on the phone), colour pickers with a **readability check** (white on the main colour and the main
  colour on the accent must both reach 4.5:1 — readable in the sun), font choice.
- **No L.G.C artwork or wording in other groups:** L.G.C's crest, trophy artwork (BD, Putt Buddies, Noodle Cup) and
  trophy names in menus are L.G.C only; other groups get a plain cup; "L.G.C Golf" / share titles / calendar files
  now use the group's name or "The Golf Trip". (L.G.C's one-off Sunday guide page is unchanged; the home-screen app
  name and icon per group come with Stage 9's hosting move.)

**Independent review — fixed (031b, applied on staging):**
- L.G.C leftovers: the Sunday guide link only shows for L.G.C; the tab title, iPhone Home Screen name and icon now
  follow the group (its name / short name, its uploaded crest or a new plain The Golf Trip icon — L.G.C keeps "L.G.C
  Golf", "L.G.C" and its icon); trophy examples, the notification fallback title and share titles no longer say L.G.C;
  the last hard-coded L.G.C colours use the group's colours.
- Readability check now tests the pairs the app really draws: dark writing on the accent (buttons, finished holes),
  accent writing on the main colour (years on the honour board), white on the lightest in-between shade (badges, 3:1);
  the muted header text is worked out so it always passes. The Look preview shows the real button.
- Crests are saved as PNG (see-through logos stay see-through; photos get a white, not black, background) and must be
  shrunk on the phone — an iPhone HEIC or a huge file is refused with a plain message instead of uploaded as-is.
- The server checks the whole crest address: this project's storage, this group's crest folder, a file that was
  really uploaded, no "..", 300 characters max.
- Signing out, or no longer being in a group, forgets the old group's look; an invite shows the inviting group's
  crest and colours (`invite_info` returns the look).
- Colours: the server checks only their format (an organiser calling it directly only affects their own group); the app
  refuses unreadable pairs. Deliberate.
- "Trophy names" in the brief: trophies already have their own names per group (set in Admin), so nothing else needed.
- Known gaps: Android's installed-app name and icon come from the fixed manifest (still L.G.C) until the hosting move
  (Stage 9) gives each group its own; a first open after the update shows L.G.C colours for a moment until the look
  loads; an iPhone shows a see-through crest's background as black on the Home Screen icon.

**Tested:** `supabase/tests/stage4_branding.sql` 14 checks (L.G.C's look kept, new-group default, only organisers,
crest folder and address checks, L.G.C crest only for L.G.C, bad colour/font refused, invite shows the look, no reading
another group's look); unit tests (theme colour maths, every passing look readable on buttons, header and badges, app
name and icon); phone width `tests/e2e/look-test.mjs` 17 checks (new group's colours/font/plain crest/app name and icon,
no L.G.C artwork or guide link, pale colour blocked, save, L.G.C exact colours, crest, name and icon, look forgotten
when not in a group).

## v2.1 Stage 5 — Rulebook per group (branch `stage-5-rulebook`, on staging only)

**Built**
- The Rulebook was already per group (Stage 1), and round set-up already reads each group's own rules (side comp
  strokes, minimum drives — only applied when bonus strokes are switched on).
- **Starter rulebooks (032):** an organiser of a group with no rules picks one — **Social Stableford weekend**,
  **Ambrose and Stableford** (L.G.C-style, with L.G.C's names removed: "trip trophy", "organiser"), **Just scoring** —
  and edits anything afterwards. Only once (not on top of existing rules), organisers only.

**Independent review — fixed (032b, applied on staging):**
- Two taps (or two organisers) at once can't add two starters: the group is locked while the check and inserts run.
- The Ambrose starter asks for **4 drives each**, not 6 (a team of four on 18 holes can't all have 6). Scoring never
  asks for more drives than the round allows (holes ÷ team size) — nothing changes for L.G.C.
- "Are you sure?" before adding a starter; no "no rules" message under the picker; players are told the organiser can
  start one; the Ambrose card says the −2 strokes need side comp bonus strokes switched on (off by default — deliberate,
  as for every new group).
- A unit test checks the picker's list matches the rules the database adds.

**Tested:** `supabase/tests/stage5_starters.sql` 10 checks (only organisers, unknown refused, 7 rules in force, no
L.G.C names, not twice, only-proposed refused, only-retired allowed, L.G.C organiser refused, L.G.C untouched, 4
drives); unit tests (starter values drive round set-up, picker matches the database, no L.G.C names); phone width
`tests/e2e/rulebook-test.mjs` 10 checks (picker shown, confirm, choosing calls the server, hidden for players and
once there are rules).

## v2.1 Stage 6 — History import (branch `stage-6-history`, on staging only)

**Built**
- **Database (033, applied on staging):** honour board entries can be linked to the trip they were won on and are
  marked when added as history; handicap history entries are marked when added as history. `import_honours` (up to 200
  lines; organisers; needs the Trophy Room switched on) and `import_handicaps` (up to 500 lines; organisers) — a whole
  list is saved or nothing is; only the group's own players and trips are linked; dates can't be in the future;
  handicaps must be −10 to 54. Today's handicaps never change (still only via the admin or the Tribunal).
  **033b** (Josh pastes it — it has a delete): lets an organiser take back a mistyped history handicap; real changes
  can't be removed.
- **History screen** (Admin → Honour board, or "+ Add past winners" in the Trophy Room; organisers only): **Past
  winners** — pick the trophy (or a new one, or "several — trophy named on each line"), add one, or paste a list
  (year, winner(s) — straight from a spreadsheet, commas, semicolons or dashes). A preview shows each line, which
  players it matched and which past trip; lines it can't read are named and must be fixed first. **Past handicaps** —
  player, date (1/6/2023, 2023-06-01, "June 2023" or just "2023"), handicap ("+2" is a plus handicap). Lists what was
  added, with remove.
- **Shown together:** the honour board, Trophy Room plaques (the holder is the newest) and player profiles sort by
  the year in the label, then the order added — so history slots in among the app's own winners. Imported handicaps
  appear on each player's handicap chart and list. Engraving a winner now links it to the current trip, and **past
  trips on the Trips tab show their winners**.

**Independent review — fixed (033c, applied on staging):**
- **Order:** the app's own winners keep exactly the order they always had (so nothing moves for L.G.C); each history
  entry slots in just before the first app winner from an earlier year. A past winner must have a year in its label
  ("2019", "Hunter 2019") — the app and the database both refuse one without, so it can't jump to the top as holder.
- Pasting the same list twice doesn't double it (exact repeats are skipped and shown as "already on the board").
- Names that match no player are pointed out ("Smith, John" → "2 names not matched" — put & between winners); a
  header line is skipped even after blank lines; non-breaking spaces from WhatsApp/Word are fine; "+2" means a plus
  handicap whether pasted or typed; "1/6/99" is 1999.
- Winners link to a past trip only when the label is exactly the trip's name (L.G.C plays twice a year, so a year
  alone could be either trip). Past trip cards sort winners and say "+N more".
- Past handicaps can be added even with the Trophy Room switched off (Admin link); the empty Trophy Room offers
  "add past winners". Dates show the same day everywhere; "today" is this phone's today.
- Profile trophies match whole names ("Sam" no longer matches "Samuel").
- Left as notes: no editing an entry (delete and re-add); organisers could already change handicap history rows
  directly, so 033b's "only history" is what the app offers, not a lock.

**Tested:** `supabase/tests/stage6_history.sql` 21 checks (players refused, 3 winners added as history, other group's
players/trips dropped, the same list again adds 0, no-year refused, a bad line saves nothing, 201 lines refused, honour
linked to another group's trip refused, own trip fine, handicaps added with their dates, the same again adds 0, today's
handicap unchanged, 4 bad handicap lines refused, another group sees none, Trophy Room off refuses winners); 16 unit
tests (reading pasted lists, dates, plus handicaps, matching, repeats, the ordering keeps app-made order); phone width
`tests/e2e/history-test.mjs` 18 checks. All other phone tests still pass.

## v2.1 Stage 7 — Start a new group (branch `stage-7-start`, on staging only)

**Built**
- **Database (034, applied on staging):** `create_group(name, switches)` — anyone signed in (a phone-only session
  works until sign-in providers are switched on); makes an empty group (nothing from L.G.C: no players, trips,
  courses, rules, trophies or history), the plain look, a web-ready address made from the name (unique; names like
  "lgc", "www", "admin" get "-golf"), its own join code, and the maker as organiser. Limits: 3 new groups a day per
  person, 30 an hour across everyone. `set_features(switches)` sets all the feature switches at once (organisers).
- **Public start page** (`#/start`, linked from the join screen and Group & invites): what The Golf Trip is, then
  **Start your group**.
- **The wizard** (`#/start/new`, 7 steps, about 9 minutes, progress bar and minutes left): sign in (or carry on while
  sign-in isn't switched on) → group name + your name and handicap (the group is made here) → crest and colours (the
  Look card, with its readability check; or skip) → starter Rulebook (or empty) → features preset (**Just scoring**,
  **Full trip**, **Everything**, or **Custom** switches) → players (paste "Name, handicap" lines, or skip) → invite
  link and QR → **Open your group**. Leaving half-way and coming back carries on at the same step and never makes a
  second group.

**Independent review — fixed (034b, applied on staging):**
- **Never made twice:** the group and the organiser's own player are made in one step on the server, and the wizard
  saves the new group before anything else — a dropped signal or a reload carries on, it never makes a second group.
- **Nothing lands in L.G.C:** the steps after the group is made only run while the phone is really working in the new
  group ("Reconnecting…" otherwise), and the Features step tells the server which group it's for (refused if the phone
  has drifted). Close / "Back to my group" goes back to the group you came from.
- **Limits:** 3 new groups a day per person; phone-only (not signed-in) makers share 10 an hour, so a script can't
  block signed-in organisers. Web addresses never look like L.G.C's ("lgc", "l-g-c", "lgc-2" → "group-N"), never end
  in a dash, and two at the same instant both work. The first version of the function is retired (refuses politely).
- Players step skips names already on the list (you, or ones added before a dropped signal); the Rulebook step says
  you've already got one when you come back to it; "+2" is a plus handicap everywhere; the start page shows The Golf
  Trip's look, not the last group's; sign-in comes back to the wizard; a tip about adding a sign-in or a second
  organiser; "Under 10 minutes".
- Left as notes: notification links don't carry their group yet (Stage 9); the Features step doesn't re-show the
  preset you picked if you go back to it.

**Tested:** `supabase/tests/stage7_create_group.sql` 22 checks (made with the right address, role and switches, the
organiser on it, starts empty, plain look, set_features, starter, invite, same name → new address, 4th group in a day
refused, outsiders can't change or see it, L.G.C look-alike names, old version refused, set_features for another
group refused, bad names, switches and handicaps refused, not signed in refused, L.G.C untouched); unit tests (presets,
players list, plus handicaps, steps under 10 minutes); phone width `tests/e2e/start-test.mjs` 20 checks (join screen →
start page → all 7 steps → invite, coming back mid-way, someone already on the list skipped, no sideways scroll).

## v2.1 Stage 8 — Shared course library (branch `stage-8-courses`, on staging only)

**Built**
- **Database (035, applied on staging):** a `course_library` shared by every group — name, town, where it is, pars,
  stroke indexes, tees and greens (nothing else: no pins, rounds, scores, players, or which group shared it). Each
  group still plays its own copy in `courses` (rounds don't change, so old phones are unaffected).
  `share_course` (organisers: put one of your courses in the library, or update the entry you shared; a copy of a
  library course can't be shared twice), `search_courses` (by name or town, nearest first when you give a location,
  with distance, holes, greens mapped and how many groups use it), `library_course` (preview), `copy_library_course`
  (your own copy to adjust — tees, greens — without changing the shared one; asking twice gives the same copy).
  The library table itself can't be read or changed directly.
- **App:** Admin → Courses: **📚 Find a course in the library** (search box, **📍 Near me**, preview with the
  scorecard, **Add to our courses**) and **Share** on each course (with town and state). Trip set-up offers the
  library when a course isn't listed.
- **OpenStreetMap credit:** greens filled from OpenStreetMap are marked, and every map showing them (green mapper,
  shot planner, side comps) carries "Greens © OpenStreetMap contributors"; the library and preview say so too.
  (L.G.C's earlier OpenStreetMap fills weren't marked; re-filling a course marks it.)

**Independent review — fixed (035b, applied on staging):**
- Every hole needs a par (3–6) and stroke index; map points must be real places; 18 holes only for now (handicap
  maths is 18-hole).
- **The library can't be wrecked:** phone-only (not signed-in) organisers can't share; 10 shares a day per group; once
  another group has copied an entry, sharing again only fills in missing tees and greens (name, pars and stroke index
  stay); Josh can hide a junk entry (`hidden`).
- **Groups give greens back:** sharing a course that came from the library fills holes the library is missing — never
  overwriting anything — so "one group maps it, the next gets it" works both ways.
- No duplicates when two people share or copy at once; the library link on a course can't be changed from the app.
- OpenStreetMap credit now also on the score screen (distances), and the credits link to openstreetmap.org/copyright.
- Search: % and _ are searched literally, replies can't arrive out of order, "no signal" isn't shown as "no
  courses"; a course you already added by hand is pointed out; adding from trip set-up puts it on the first round.
- Left for Josh: L.G.C's earlier OpenStreetMap greens aren't marked (say which courses were filled from it and they'll
  be marked, adding the credit); the OSM licence question for a public library (see the club-partners note) before the
  public course page and seeding.

**Tested:** `supabase/tests/stage8_courses.sql` 23 checks (phone-only and players can't share, 17 holes / no pars / 9
holes refused, table not readable, search with area/holes/greens/credit, distance, only course details kept, copy is
the group's own, copying twice gives the same course, the link can't be removed from the app, changing a copy leaves the
library alone, use count, a copy gives tees back without changing pars, can't share or see another group's course,
sharing again fills only once others use it, % searched literally, hidden entries, not signed in sees nothing);
unit test (OpenStreetMap marking); phone width `tests/e2e/courses-test.mjs` 11 checks. All other phone tests pass.

## v2.1 Stage 7b — Quick round (club-partners addendum; branch `stage-7b-quick`, on staging only)

**Built**
- **Database (036, applied on staging):** Clubhouse TV switch added to the feature list (off; built in 8b).
  `course_page(slug)` — the public course page, readable without signing in (course details only). 
  `start_quick_round(course, your name, handicap, format, closest-to-pin holes, longest-drive holes, where from)` —
  makes a **quick group** ("Josh's round at Bowral Golf Club") with its own copy of the course, a one-day trip and a
  live round, you on it, a guest link, and just the features a round needs; phone-only sign-in is fine (5 a day per
  person; phone-only starters share 60 an hour). In a quick group, people who join are approved straight away and go
  into today's Stableford round. `make_group_official()` turns it into an ordinary group; `set_group_source()` records
  where an ordinary group came from (once). Groups keep `source` — a club's code and placement, or the group whose
  results card started them — for counting later; never shown to clubs. `my_status` says whether it's a quick group.
- **App:** `#/c/<course>` — the course, its greens on the map (with the OpenStreetMap credit), scorecard, and
  **⛳ Start a round with your mates** → your name (handicap optional, 18 if blank), Stableford or Ambrose (**stroke
  play shown as coming soon** — it needs a database change that's a STOP), closest-to-pin holes pre-filled from the
  par 3s and longest drive from the longest par 5 → **Get your mates in**: the phone's share sheet (Messenger, WhatsApp,
  text) and a QR code → **Start scoring**. `#/c` finds a course. Mates who tap the link type just a name and are in
  the round. After the last hole: **Share the results** (text for the group chat, with "Start your own group" counted
  as coming from this group), **Finish — winner on the honour board**, **📅 Same time next year?** (a Trips idea with
  next year's date, same weekday), **⭐ Make it official** (the Stage 7 wizard from the name-and-crest step).
  The start page links to the quick round.
- **Waiting on Josh:** stroke play (STOP: the round-format rule needs a DROP to widen); share cards as images come in
  Stage 9 (text results now).

**Independent review — fixed (036b, applied on staging):**
- **No fake players:** in a quick round each person adds themselves once; a round tops out at 40 players.
- A quick round no longer counts as "using" a library course (so phone-only rounds can't push a course up the search
  or lock its details); making the group official does. The phone-only limit is per course (20 an hour), so one script
  can't stop quick rounds everywhere.
- **Make it official:** the mates become players; the wizard starts with signing in if the organiser hasn't; its step
  is "Name and crest"; the button only appears once the round is finished (so finishing isn't lost).
- The organiser can finish once anyone has played 18 or the day is over (one mate who never scored can't hold it up);
  "📤 Invite more mates" while playing; guests are asked to add a sign-in to keep the round on their record.
- **Same time next year** names the course as the place and, once saved, opens the share sheet so everyone who played
  gets the vote.
- Where a group came from: the newest code or card, kept 30 days and forgotten once used; mates who join from an
  invite are counted as coming from that group if they start their own.
- **Quick rounds are Stableford for now** — Ambrose is shown as coming soon (it needs a teams step), as is stroke play
  (a STOP).
- Left for Josh (settings — STOP): turn on CAPTCHA for phone-only sign-ins and check Supabase's per-address limit for
  them (30 an hour by default; phones on 4G often share an address) before any QR kit goes out.
- Notes: each quick round makes a new group (a "play with your last group" shortcut can come later); an iPhone that
  scans a code opens Safari, not the Home Screen app.

**Tested:** `supabase/tests/stage7b_quick_round.sql` 20 checks (public course page, no session refused, the quick
group/round/players/features, my_status, a mate joins as a guest, approved and in the round, can't add a second player,
guests can't make it official, bad inputs refused, made official, mates become players, library use counted only then,
source tidied, ordinary groups unchanged); unit tests (side comps pre-fill, where-from incl. expiry, results text, same
time next year); phone width `tests/e2e/quick-test.mjs` 21 checks. All other phone tests pass.

## v2.1 Stage 8b — Club partners (club-partners addendum; branch `stage-8b-clubs`, on staging only)

**Built**
- **Claims and the club screen (037, applied on staging):** `#/club` — "Is this your course?". A club must sign in
  properly (Google or email, not phone-only), finds its course, and sends a claim (name, club email, phone, role). **Josh
  approves each claim by hand** at `#/club/claims` (STOP before the first real one). An approved club gets a club account:
  its logo, a group-bookings email/phone, a note and offers for visiting groups, and **Hole data** — it can check and
  save pars, stroke indexes and greens, after which the course shows "✓ Hole data checked by the club" and other people
  can only fill gaps. The course page shows a clearly labelled **Partner course** card; unclaimed courses still show
  normally with "Work at this club? Claim this page". The library search lists partners with their label but never
  hides anyone else. To make yourself the approver: `insert into public.platform_admins (user_id) values ('<your user id>');`
- **QR kit and counts (038, applied on staging):** `#/club/kit` — a printable kit (cart sticker, counter card, one sign
  per par 3, a TV card), each code carrying the club's ref and where it sits. It's marked **"Draft — please don't print
  yet"**: the codes point at the test address until the move to thegolftrip.club (STOP before any kit is printed or
  sent). A scan is counted once per visit with no person attached (a daily scrambled mark, at most 20 a day per phone).
  A par 3 sign scanned by someone whose group is playing that course right now goes straight to closest-to-the-pin for
  that hole. The club screen shows **How groups find you**: scans (split by cart/par 3/counter/TV), rounds started,
  groups started, came back, trips planned, became a group — 30 days, 90 days or a year. Counts only, never names.
- **Clubhouse TV (039, applied on staging):** the group's **Clubhouse TV** switch now works. With it on, the organiser
  ticks **📺 Show on the clubhouse TV** on the leaderboard for that round. `#/tv/<course>` is a big-screen page for the
  club's TV: today's opted-in rounds only, refreshed every 30 seconds, moving through groups every 15. **First names or
  nicknames only**, no photos, no surnames, no group or round names (boards are "Group 1", "Group 2").
- **Every Australian course listed (040, staging only — STOP before live):** a seeding job (Supabase function
  `seed-osm-courses`, one state at a time) reads golf courses and any mapped holes from OpenStreetMap and adds them to
  the shared course list. Most come as a **listing** — a name and a place, "no scorecard yet": they show in search and
  have a course page (where it is, how to fill it in, "claim this page"), but can't be added to a group or played until
  someone adds the pars. A group that shares the same course (same name, close by) **fills the listing** instead of
  making a second one; a club that claims it adds its hole data. Hole data from OpenStreetMap is only taken when it's
  complete (18 holes, each with a par and stroke index). Seeding never changes a course a club has claimed, a group has
  shared, or anyone uses — at most it fills a missing area or map position — and running it again adds nothing twice.
  Each run is recorded (`private.seed_runs`). Course pages and the library credit OpenStreetMap.
- **Independent review — fixed (040b, applied on staging):** a listing's course page no longer breaks (old phones
  too — the database now sends an empty hole list); a group's course with no greens mapped can only fill a listing
  whose town matches the one given when sharing (it could have taken over a same-named course in another state), and
  filling a listing never renames it; seeding only matches entries with a map position and never hidden ones; names
  like just "Golf Club" are skipped (the one already seeded is hidden); a server that gives up part-way counts as a
  failure, not "no courses"; holes near two courses (36-hole clubs) aren't used; listing search results and the claim
  search credit OpenStreetMap; the job's "no sign-in token check" setting is in config.toml.
- **Seeding done on staging:** 1,423 Australian courses listed (NSW 398 in three slices, VIC 374, QLD 240, WA 187,
  SA 132, TAS 72, NT 12, ACT 10); 25 came with a full scorecard from OpenStreetMap; 1 junk name hidden. OpenStreetMap's
  main query server refuses Supabase's servers (406), so the job works through four public mirrors and skips any that
  answer with nothing; big states run in slices (`?state=NSW&part=1&of=3`).
- **Not built yet:** club photos (logo only for now).
- **For Josh — OpenStreetMap licence (ODbL), before seeding live:** credit is shown everywhere the data appears. The
  licence also says that if we publicly use a database built from OSM data, we must offer that OSM-derived part (course
  names and locations we took from OSM) under the same licence on request. Our groups' own scorecards and the clubs'
  hole data stay ours. Worth a quick read: openstreetmap.org/copyright and the OSMF "Community Guidelines". This is your
  call — the seeding job only runs on staging until you say so.

**Independent review — fixed (039b, applied on staging):**
- **Clubs can upload their logo** (the old "group members only" upload rule blocked club accounts); nobody without a
  club can put files in the clubs folder; the photos bucket now only takes pictures, up to 12 MB.
- Saving checked hole data changes pars and stroke indexes only — the tee and green points stay.
- **Club counts can't follow one group:** rounds are only those on the club's own courses in the period; the period
  is 30, 90 or 365 days only; any count of groups or rounds under 5 shows as "<5".
- **The TV link carries the club's key** (on the kit), so nobody can watch by guessing a course name; the old keyless
  link shows no groups; the TV feed sends list positions, not database ids. The organiser's tick now says "Anyone with
  the club's TV link can see it", and stays visible after the round is finished so it can be turned off.
- Scans count per phone (a random mark the phone keeps), not per internet address, so a clubhouse wifi isn't one
  person; days run on Sydney time; 20 a day per phone, 300 a day per address.
- A par 3 sign only jumps to today's live round in the group you're using.
- Checked courses can't be moved or have their area changed by a group; if a club is removed (or Josh unclaims — new
  "Unclaim this course" button on the claims screen) the course goes back to unclaimed and unchecked.
- Re-check (039c): one internet address can count at most 60 phones a day; the split of groups by code placement only
  shows from 10 groups; the TV card isn't printed (staff keep the link) and a club can get a **new TV key**; AVIF
  pictures are allowed.
- Left as is (low): logos and crests are checked to be on a Supabase storage address, not ours specifically — revisit
  when the app moves to thegolftrip.club (the object must exist in our bucket, so the risk is small).

**Tested (part 4):** `supabase/tests/stage8b_seed.sql` 14 checks (only the seeding job can run it, token check, new
listings added, a shared course matched not duplicated, same name far away kept separate, bad rows skipped, only full
scorecards taken, running twice adds nothing, a listing can't be added or played, a full OSM scorecard can, sharing fills
the nearby listing); phone checks for "no scorecard yet" in the library and on the course page.

**Tested:** `supabase/tests/stage8b_clubs.sql` (claims, approval, club edits, verified hole data protected, partner
search) and `supabase/tests/stage8b_counts_tv.sql` 18 checks (nobody can read the scan log, bad codes ignored, two phones on one
address count as two, TV needs the group's switch and the club's key, a guest can't put a round on TV, rounds not
opted in stay off, first names only with no surname or ids, counts carry no names and show "<5", only 30/90/365 days,
only the club sees its counts, upload rules, hole data keeps greens, checked courses can't be moved, removing a club
unclaims); phone width `tests/e2e/club-test.mjs` 35 checks (claim, approve, club edits, partner card, counts, the kit has every par 3, a scan counted once, par 3 sign to
closest-to-pin, the TV tick only when the switch is on, the TV page on a phone and a big screen). All other phone tests pass.

## v2.1 Stage 9 — Launch basics (branch `stage-9-launch`, on staging only)

**Built**
- **Privacy and Terms — DRAFTS** at `#/privacy` and `#/terms` (linked from Start, the join screen, course pages and
  Group & invites → Your data). Written from what the app actually stores: sign-in, profiles and payment details,
  scores and side comps (with where they were measured), photos (public-if-you-have-the-link), location (only when
  shared, latest position only), notifications (pass through Apple/Google/Mozilla), planner, clubs (counts only; TV
  only when ticked), scan counting, internet addresses (scrambled; wrong PINs kept 30 days), app problem reports,
  other services (Supabase, hosting, Google Fonts, Esri maps, OpenStreetMap, Google/Facebook sign-in, Claude connector
  when on), what's on the phone, deleting. **[Brackets] for Josh:** your name/business and contact email, server
  location, hosting, photo clean-up timing, minimum age (16 or 18), state for the law, notice period, dates.
- **Your data** (Group & invites): organisers **download the group's data** (a file with everything except sign-ins,
  invite codes, locations and notification settings — needs a proper sign-in). **Leave this group**, **Delete my
  account** (optionally "take my name and selfie off the history" → "Former player"), and **Delete this group** (type
  its name; not L.G.C) are built, but say "Coming soon" until Josh applies `041b` (it removes rows — the build tools
  can't). The only organiser of a group with others in it is asked to hand over first.
- **App problems, without a new dependency:** instead of an outside error service, the app reports its own crashes to
  our database (message, where in the code, the screen without anything after '?' and never an invite code, version,
  phone type — no names; at most 10 per visit, 30 an hour per address). Josh sees them grouped at **Josh's screen →
  App problems**. *Question for Josh:* happy with this, or do you still want an outside service (e.g. Sentry's free
  plan — it would be a new dependency, so it's your call)?
- **Share pictures:** "🖼️ Winner picture" and "🖼️ Leaderboard picture" on a finished round, "Share as a picture" on a
  quick round's results, "🖼️ Share the verdict" on a closed Tribunal case. Drawn on the phone in the group's colours
  with "Made with The Golf Trip"; the share sheet adds a "start your own" link (counted as coming from this group).
- **Josh's screen** (`#/club/josh`, platform admins only): **Numbers** — groups (all, new, quick, proper, came back,
  planned a trip, started from another group's card), trips run and players scoring, and the **scan funnel** by club
  and placement (scans → groups started → played → came back or planned); **App problems**; **Stay cards** — type a
  place (e.g. a motel), get a printable card (draft until the real address) pointing at Start or at a course page;
  scans and groups from it are counted. No club account needed.
- **Not done here (STOPs for Josh):** moving to Vercel + `thegolftrip.club` (with a web address and home-screen icon per
  group), Supabase Pro, the photo clean-up job (removes files of deleted groups/selfies — needs deleting, so after 041b).

**Independent review — fixed (041c applied on staging; 041b rewritten for Josh):**
- Leaving or deleting your account can't leave a group behind with nobody in it (the only person deletes the group
  instead), and leaving/deleting name the group (not "whichever one the phone was on").
- "Former player" also comes off the honour board and the app's own feed posts; the wording says what isn't changed.
- 041b now includes a **daily clean-up** (wrong-PIN records 30 days, app problems 90 days, scans 2 years, a shared
  location with no update for a day). The privacy draft says plainly that photo files of deleted groups aren't removed
  from storage yet (that clean-up needs the storage service — a follow-up), and adds: Supabase's own request logs,
  share pictures leave the group, downloads include payment details, problem reports say which group.
- Download: a fixed list of tables (rooms and cars included; feature switches without who changed them).
- Problem reports never keep a sign-in token from the address; Josh's list shows the latest 100.
- Josh's numbers: "came back" = played again 30+ days after the first round; L.G.C left out of every group count.
- Left for Josh to decide: a 7-day "undo" for deleting a group (any organiser can delete it now, after typing its name).

**Tested:** `supabase/tests/stage9_launch.sql` 11 checks (only Josh issues stay cards and sees numbers/problems, stay
card refs, a stay scan counted in the funnel, nobody can read problem reports, page addresses kept without '?…' or
invite codes, export leaves out sign-ins/locations/invites, phone-only organisers and players can't export);
`stage9_delete.sql` 14 checks written for 041b (Josh runs it: leaving, the only person/organiser rules, Former player
on the honour board and feed, deleting refused for players/phone-only/other groups/wrong name, another group untouched,
L.G.C safe, clean-up scheduled); unit tests (problem filter, share-card content); phone width
`tests/e2e/stage9-test.mjs` 23 checks. All 12 phone tests pass.

**For Josh — launch steps (all STOPs, nothing done):**
1. **Domain:** buy `thegolftrip.club` (was free on 18 Oct).
2. **Vercel:** make an account (the free Hobby plan is for non-commercial use — Pro is US$20/month if this earns money
   later), import the GitHub repo, point the domain at it including `*.thegolftrip.club` (needs Vercel's name servers
   for the wildcard). Then I set up a web address and home-screen icon per group, and the L.G.C redirect.
3. **Supabase:** add the new address to Auth → URL configuration (site URL + redirect URLs); Google sign-in: add it to
   the authorised origins. Switch on **Pro** (US$25/month) before the first outside group.
4. Make the repo private once the move is done.

## v2.2 Stage 10–11 — Booking links, group booking enquiries, premium-ready (branch `stage-10-booking`, on staging only)

**Built**
- **Trips planner per group:** already done in Stage 1 (every planner table is per group; the isolation test covers it).
- **Booking links (042; switch "Booking links", off by default):** a trip's Details shows 🏨 Find accommodation,
  ⛳ Find a course and 🚗 Getting there, with the place, dates and how many are "in" filled in. Each tap goes through
  the database (`booking_go`), which builds the address from a template in `booking_targets` — so a referral code can be
  added later without an app update. Taps are counted per group. No referral accounts; the screen says the app earns
  nothing from them.
- **Group booking enquiries (042):** "📨 Ask about a group booking" on a partner course page (when the club has a
  bookings email or phone) and from a trip's place vote when a place is a partner course. A short form (name, email or
  phone, dates, golfers, rounds, note) is logged against the club's code, then the person's own email app opens
  addressed to the club with it written out (no email service needed); the club's phone is shown too. The club sees its
  enquiries on its screen. At most 5 a day per person. **No money changes hands; any future payment goes to the club
  itself, never to staff, and is disclosed.**
- **Premium-ready, all free (043):** `groups.group_plan` (`free` for everyone); the tier check in `feature_on` now means
  a feature marked premium is only on for premium groups (none are marked); only Josh can change a group's plan. The
  list of ideas that could be premium later is in DEV-PLAN.
- **Josh's numbers:** enquiries per club and booking-link taps.

**Independent review — fixed (044, applied on staging):**
- **Enquiry spam:** one enquiry per person per club per day, 5 a day per person, 20 a day per club; a phone-only
  sign-in must give a phone number; checks run under a lock so quick repeats can't slip through.
- After sending, the screen says "Nearly done — press Send in your email app" (or, for a club with only a phone,
  "Saved for the club — give them a call") instead of claiming it was sent.
- What the trip screen says about money now comes from the database with the link: if a referral code is ever added,
  it says "may get a small referral fee… never changes your price" without an app update.
- Booking links open in a new window straight from the tap, so the app stays on the trip underneath.
- The plan guard now works whoever asks (only Josh's function can change a plan); the test checks its own message.
- Place votes: only an option that names a golf course (not just a town) offers the enquiry.
- A one-day trip books one night; an end date needs a start date; whole numbers only for golfers/rounds.
- Deleting your account (041b) unlinks your enquiries from your sign-in (the club keeps its copy).
- Noted for later: the app's own feature list ignores the premium tier — needed once anything is marked premium.

**Tested:** `supabase/tests/stage10_booking.sql` 22 checks (links refused with the switch off, the addresses with place/
dates/people/rooms, made-up kinds refused, templates and enquiries unreadable, taps counted, enquiry email text with the
club's ref, unclaimed course / no way to reply / silly group sizes refused, the club sees only its own, place-vote match,
every group free, organisers can't make their group premium, a premium feature follows the plan, Josh's numbers);
phone width `tests/e2e/stage10-test.mjs`.

## Known limits
- GPS distances are approximate (±5–10 m) and straight-line; closest-to-pin distance is typed in.
- Location sharing only works while the app is open.
- iPhone notifications only work once the app is added to the Home Screen and opened from there (iOS 16.4+).
- `pg_net` sits in the public schema until 021 runs on live.
- Supabase free plan pauses after 7 days without use — restore it from the dashboard before the next trip.

## Later
- Dinner awards voting, fines.

## Launch hosting (20 Oct 2026, branch `launch-hosting`, not merged)
- The app works at any address: `VITE_BASE` (default `/lgc-golf/`, so GitHub Pages is unchanged). `sw.js` and the
  manifest work out their own address. `notify` reads `APP_URL`. There's a safety catch: a non-GitHub build must name
  its database.
- `move-to-app-domain/` (published by `deploy.yml` once `infra/cloudflare.json` says `github_pages_retired`): the hand-over page for moving L.G.C to
  app.thegolftrip.club without anyone losing their sign-in.
- Tested: 138 tests pass; built at `/` and `/lgc-golf/`; checked in a real browser (offline copy, no missing files);
  hand-over checked with Supabase faked.
- Plan and Josh's steps: `docs/LAUNCH-HOSTING.md`. Part A (staging.thegolftrip.club) is safe. Part B is a STOP.
- Dev → staging → production (20 Oct): `cloudflare.yml` deploys every branch to Cloudflare Pages (`<branch>.thegolftrip-app.pages.dev`,
  staging data, TEST tag, link posted on the pull request). `product` is also staging.thegolftrip.club (`infra.yml`). `main` goes to
  production only when `infra/cloudflare.json` says so (release B). `check.yml` runs on every pull request. There's Dependabot weekly.
  `.node-version` is 22. Settings live in `infra/cloudflare.json`; the only secret is `CLOUDFLARE_API_TOKEN`.

## Sign in first, then Your groups (20 Oct 2026, branch `sign-in-home`, pull request into `product`)
Only when sign-in is switched on in the build (`infra/cloudflare.json` → `sign_in`; on for staging builds, off for live).
With it off, the home screen is exactly as before (checked in a browser on a live-style build).
- **Home:** The Golf Trip crest and name; **Sign in with Google**; **Email me a code** (a 6-digit code typed in the app).
  Email now makes an account if there isn't one, so new organisers can sign up. Underneath: "Got a PIN or invite
  link?" (the PIN box, folded away) and "Start a new group". The Golf Trip's own colours, never L.G.C's.
- **No sign-up before the first tee still holds:** an invite link or PIN joins as a guest with no account. On an invite,
  signing in is offered underneath and Google brings them back to the same invite.
- **Your groups** (`src/screens/YourGroups.jsx`): after a fresh sign-in with two or more groups, pick one (crest, name,
  role). One group: straight in (decided: one less tap). No groups: "You're not in a group yet" with Start a new group /
  Join with a PIN or invite link, and "Not you? Sign out". Replaces the old "No account found…" warning.
- **Way back from inside:** More → Your groups, and tapping the crest at the top (`#/groups`). Without sign-in in the
  build, both only show for someone in more than one group.
- **Logic** in `src/lib/home.js` (which screen to show, the "just signed in" flag, code and email checks, group list
  order and crests, the page to come back to after Google) with 20 tests in `home.test.js`.
- **Coming back from Google:** the page they left (an invite, the wizard) is kept on the phone, not in the address sent
  to Google, because Supabase puts the sign-in in the address's `#` part. Restored once, within 15 minutes.
- **Database:** `045_your_groups.sql`. `my_status()`'s group list also carries each group's crest. Additive; applied to
  staging 20 Oct; live gets it at the next release.
- **Tested:** 158 unit tests; both builds; `tests/e2e/signin-home-test.mjs` 46 phone-width checks (home, PIN folded,
  Google hand-off and return address, email code creates an account, Your groups, picking a group, the way back, no
  group yet, one group straight in, invite as a guest, back from Google to the invite, joining while just signed in
  goes in, live build unchanged). Independent review: 2 must-fix and 8 smaller findings, all fixed; `stage2`, `phone` and `start` browser
  checks still pass on the live-style build.
- **Josh's setup (staging only):** `knowledge/prompts/sign-in-chrome-prompt.md` in the Caddie folder; details in
  `docs/SIGN-IN-SETUP.md`. Both Supabase email templates ("Confirm sign up" and "Magic link") need `{{ .Token }}`.
- **Check on a real iPhone:** Google sign-in from the Home Screen app (iPhone may finish it in Safari rather than the
  app, the same issue as emailed links). If so, the email code is the way in on iPhone, and Google is for Android and
  browsers.
- **Later:** real email sending (Resend on thegolftrip.club) before outside groups. Supabase's built-in sender only
  reaches Josh's own address, a few an hour.
- **Release checklist:** the repo rename to `thegolftrip-app` is step 9 of Part B in `docs/LAUNCH-HOSTING.md`.

### Personal links, invite link first, Google's own button (20 Oct, same branch)
- **Personal links** (`046_personal_links.sql`, `src/lib/personal.js`, `src/screens/PersonalLink.jsx`): an organiser sends
  each player their own link (More → Group & invites → Personal links, with "1 of 12 signed in" and a line per player).
  The player opens `#/me/CODE` ("G'day Mike, this link is just for you"), signs in like a new user, taps "Yes, I'm Mike",
  and that sign-in becomes his player: same name, scores and history. One use, 14 days, organisers only; a new link
  replaces the old; refused if someone else has already signed in as that player, or if this sign-in is already
  someone else in the group; a phone-only sign-in can't use one; unapproved players get none. The link gives the role
  the player has when it's made (an organiser's link says so on the card, in the message and on the confirm screen).
  The old phone keeps working, and opening the link there asks to sign in (it isn't "done"). Wrong codes count towards
  the wrong-guess limit. Organisers see a shortened email (m…@gmail.com). SQL check: `supabase/tests/personal_links.sql`,
  33 results (incl. another group's organiser seeing and doing nothing), applied and checked on staging.
- **Invite link first:** the front door says "Got an invite link?"; the box is "Invite link (or group PIN)" and also
  takes a pasted personal link. "You're not in a group yet" points people who played before to their personal link.
  The live build's PIN screen is unchanged.
- **Google's own button** (`src/lib/google.js`): on addresses Google knows (`infra/cloudflare.json` → `google.button_hosts`)
  Google's button signs in without leaving the app (`signInWithIdToken`, with a one-time value), so the Supabase
  address never shows. Anywhere else, or if Google's script won't load, the old redirect. Needs the Google client ID in
  `infra/cloudflare.json` → `google.client_id.staging` (public). Privacy draft updated.
- **Independent review:** 1 must-fix (the old phone was told "all set") and 3 should-fix (role fixed on the link, wrong
  codes counted, live-build wording), all fixed; Google's button now shows "Signing in…" and gets a new one-time value
  after a failed try.
- **Tested:** 169 unit tests; 69 phone-width checks in `signin-home-test.mjs` (adds the personal link, a used link,
  Google's button with its one-time value, the organiser's card and its message); stage2/phone/start still pass.

### Staging refreshed from live (20 Oct)
- Staging L.G.C now has the real history from live: 17 players, 3 rounds, 144 scores, honour board, handicap history,
  Tribunal, rules, posts, reactions, plans (all counts match live). Never copied: sign-ins, pay details, phone
  notification details, locations. Repeatable steps: `docs/STAGING-REFRESH.md` (+ `supabase/staging/refresh_helper.sql`).
- The old staging test trip is locked so South Coast 2026 shows as current. Josh's Google sign-in on staging is freed from
  "Josh Stage" (still organiser) and has a personal link for the real Joshua Moran (organiser).
- Email codes on staging are waiting on custom SMTP (Resend): the form is filled in Supabase, Josh pastes the key and saves;
  then both email templates get `{{ .Token }}`.
- The laptop layout is Stage 11c (not this branch).

## Stage 1, the L.G.C beta (20 Oct 2026, branch `beta-1`, pull request into `product`)
Agreed with Josh 20 Oct: one installable web app on phone and laptop, L.G.C only for the first beta, a light desktop,
as soon as possible. Plan: DEV-PLAN.md → "The road to beta".
- **Light desktop.** 1024 px and up: a fixed sidebar (`src/components/Sidebar.jsx`: crest and group name → Your groups,
  Leaderboard, Feed, Comps, Trips, Trophy Room, Tribunal, Rulebook, Courses, Group & invites, More, and Tell Josh)
  replaces the bottom bar; pages up to 900 px wide; sheets become centred dialogs; the Enter score button and toasts
  centre on the page. 768–1023 px: one wider column (760 px) with the bottom bar. Under 768 px: nothing changes.
  Keyboard: a gold focus outline everywhere (`:focus-visible`). Install on this computer: a card in More when Chrome or
  Edge offers it (`beforeinstallprompt`). Front end only.
- **Tell Josh** (`src/components/Feedback.jsx`): More → beta card, or the sidebar. Idea / Something's wrong / Like it,
  up to 1,000 characters. Sends the words, the screen and the app version (`send_feedback`); Josh sees the name.
  Josh's screen (#/club/josh) → Feedback, with Mark done. No signal: it says so and keeps the words.
- **What's new** (`src/components/WhatsNew.jsx`): once per phone, only on builds with sign-in (never the old GitHub build).
- **New groups off on live.** `infra/cloudflare.json` → `new_groups` (`staging: "on"`, `live: ""`) hides every
  "Start a new group" link, and #/start says "invite-only for now". The database is the real lock: a trigger on
  `groups` refuses new groups (and quick rounds) from app users while `private.platform_flags.new_groups_open` is off,
  except platform admins (Josh). Migrations and the SQL editor aren't affected. Staging has it on; live starts off.
- **Database (047_beta.sql + 047b_beta_review_fixes.sql):** additive only (no DROPs). Both applied to staging 20 Oct; live
  gets them with v2.2, before the front end ships.
- **Tested:** 175 unit tests (6 new in `beta.test.js`); `supabase/tests/beta.sql` 18 results on staging, all as
  `beta.expected.txt` (closed: stranger refused, Josh allowed; open: stranger allowed; feedback sent, checked, rate
  limit 20 a day, table unreadable, only Josh sees and ticks it); `tests/e2e/beta-test.mjs` 42 browser checks: phone
  leaderboard, feed, trips and rulebook pixel-identical to `product` at 375 px; 768/1280/1920 px layouts with no sideways
  scroll; sidebar links and the current page; keyboard Tab + Enter; Tell Josh; What's new once; new groups off and on.
- **At release (v2.2, live):** run 047; then make Josh a platform admin on live
  (`insert into public.platform_admins (user_id) values ('<Josh's live user id>');`) so he sees Feedback and can still
  start groups. Leave `new_groups_open` off until Stage 2.
- **Independent review (20 Oct): 1 must-fix and 5 should-fix, all fixed.**
  - Must-fix: the desktop rules hit every `.app` on the page, so on a laptop score entry shifted right twice and
    ProfileSetup and others had a blank strip. Now only the shell with the sidebar (`.app.with-side`) changes, and
    score entry sits in the page column.
  - The sidebar is only put on the page at 1024 px and up (`useDesktop`), so phones get exactly the page they had.
  - Course pages: no quick round button or start links while new groups are off ("opens soon" note instead).
    Stay cards opened at #/start still count their scan when it's closed.
  - Focus outline only where there's a mouse and 768 px or wider (phones unchanged), navy on light pages and gold on
    navy.
  - Chrome's own "Add to Home screen" prompt is kept on phones; only computers hold it for Install.
  - Feedback (047b) needs a group, with a 300-a-day cap across the app. The column is `from_group`, so deleting a group
    keeps the words. Josh's list leaves done items out in the database. The privacy line now mentions the browser.
  - Older staging tests open `new_groups_open` first (rolled back).
  - Also: the trigger is `create or replace`; What's new is for L.G.C only; Esc closes sheets; Josh's Feedback tab
    shows load errors; desktop pages have room under Enter score; sidebar links are 48 px.
  - Still open: the 7-day undo on deleting a group (agreed 20 Oct) isn't built. It goes in Stage 2, before other groups;
    L.G.C can't be deleted from the app.
- **Tested after fixes:** 175 unit tests; `beta.sql` 22 results as expected on staging; all 15 browser checks pass (333 checks:
  beta 44, signin-home 69, phone 17, start 20, quick 21, stage2 19, club 40, features 9, look 17, trips 18, history 17,
  rulebook 10, stage9 23, stage10 15, courses 14). A few older checks now look inside `.page` or mark the What's new
  note seen, and signin-home expects no "Start your own" on the live build (decided).

## View as a player (21 Oct 2026, branch `view-as`)
Josh asked to see the app exactly as a player saw it ("that's critical"). An organiser opens a player's profile and
taps **View the app as Mike**: the app works as Mike's (his scorecard, profile, a player's More), with a bar on every
screen, "Viewing as Mike · read only", and Stop.
- **Read only, enforced on the phone:** `src/lib/preview.js` + `supabase.js` refuse every request that isn't a read,
  apart from token refresh, sign-out and a short list of read-only functions. The score queue and outbox neither take
  nor send anything while viewing (queued items from before wait until Stop and are never dropped). Notifications,
  draw-room presence and sign-in changes are off.
- **Grants nothing:** it's client-side only, and an organiser can already read everything in their group. It lives
  in one browser tab (`sessionStorage`). It stops by itself if it no longer applies (another group, no longer an
  organiser, the player has gone) and on sign-out. Not offered for unapproved players.
- **Who are you?** (sign-in builds): points people with history to their organiser's personal link, with a paste box.
- **Known:** the role is always shown as "player" (a guest or co-organiser is shown as a player). A few things that
  belong to the phone's real owner (notification settings, sign-in details) aren't shown as the player's.
- **Independent review:** 3 must-fix and 5 should-fix, all fixed (viewing outliving its session; no Stop bar on some
  screens; push on/off; auth writes; stricter block-list; queues; draw presence; read-only list wording).
- **Tested:** 184 unit tests (`preview.test.js` 9); `view-as-test.mjs` 14; beta 47; signin-home 69; every other browser
  check passes.

## Wave 3 — "Bring your history" (AI import), branch `ov3-import`, 21 Oct 2026
- **What:** `/import` (organisers, behind `ai_helper`): paste text, upload .txt/.csv/.md/.docx/.xlsx (read in the
  browser, no new library) or up to 4 photos (shrunk to 1600px JPEG, never stored) → the ai-helper `import` mode
  proposes players, past trips, winners, past handicaps and rules → a confirm screen (tick, edit, "→ already a player",
  "→ new past trip", "not sure about" notes) → **Add these** writes with the organiser's own sign-in
  (admin_create_player, trips, import_honours, import_handicaps, import_rules). Safe to run twice.
- **Ways in:** guided setup card, History ("✨ Import with AI"), Rulebook ("✨ Import rules from a photo or text"),
  Ask (organisers' chip). Privacy page line.
- **Server:** `supabase/functions/ai-helper/import.ts` (+ a 2-line dispatch in index.ts; images in providers.ts).
  Optional secret `AI_VISION_MODEL` for photos (else `AI_MODEL`). Counts against the cap like setup; helper_log gets
  counts only, `job = 'import'`.
- **Migration 070** (staging only): `helper_log.job`, `admin_ai_usage` shows jobs, `import_rules()` (normal rules,
  version 1; in force when the organiser decides or the Rulebook is empty, otherwise up for a vote).
- **Tested:** Deno `import.test.ts` 8 (55 in the folder); Vitest `aiimport.test.js` 22; `ai-import-test.mjs` 35 checks;
  staging SQL checks (organiser adds / re-run skips / player and other group refused / voting group → proposed;
  empty-Rulebook voting group → in force; guard back on afterwards). ai-helper v4 deployed to staging and boot-checked.

## ov8 — Dispute anything that's a rule, branch `ov8-dispute`, 22 Oct 2026
- **What:** `<RuleTag>` (`src/components/RuleTag.jsx`, logic in `src/lib/disputes.js`): a rule value shows as normal
  text with a faint dotted underline. Tap → what it says, where it's from (Rulebook rule / round / comp / game setting,
  value now), "See it in the Rulebook", and "⚖️ Dispute this" → the Tribunal's raise sheet, filled in (a `ruling` case).
  ⚖️ on the chip while a case about it is open; "You've already raised this — see the case"; guests and Tribunal-off
  get the explanation only. The case page shows what was disputed and its value when raised.
- **Where:** side comp "Worth 2 strokes", today's rules (leaderboard), Ambrose team handicap (scorecard), minimum
  drives (score entry), game stakes, Cup match points and handicaps, Cup "to win", comp "how it's decided", the
  Stableford tie-break (countback), own side comps' "how it's won". Rulebook rules (fines, trophy rules) already had
  "Challenge this rule".
- **Migration 082** (staging only): `cases.subject_kind` / `subject_ref` (nullable, checked), one-open-dispute-per-
  person index, `raise_dispute()` (members, not guests; tribunal + rule challenges on; fixed list of tables/fields;
  the value is read by the server). No new way to change a setting: a verdict goes through `apply_verdict_draft`
  (organiser-checked) or an organiser changes the setting where it's set.
- **Tested:** Vitest `disputes.test.js` 17 (1032 in all); `supabase/tests/082_rule_disputes.sql` 18 checks (rolled
  back); `dispute-test.mjs` 23; rulebook-v2/v3, governance, games, cup, comps, own-comps, stroke, fourball, stats pass.
  `rulebook-test`, `phone-test`, `trip-overview-test` time out on wave2-all as well (not from this branch).

## ov8b — Apply a dispute's verdict, branch `ov8b-apply-verdict`, 22 Oct 2026
- **What:** on an upheld dispute about a setting, organisers see "Change it to" (filled from the case's "What it should
  be", checked as they type) and "Apply the verdict: change Worth 2 strokes from 2 to 1". After: "✓ Applied by Josh,
  2:41 pm: 2 → 1" on the case, a feed post, the setting changed. If the setting changed since the case was raised:
  "It's changed since — now 4. Apply anyway?". Settings objects, Rulebook and standard rules are still changed where
  they're set (Rulebook rules via the existing organiser-checked "Into the Rulebook").
- **Migration 084** (staging only): `cases.setting_applied_by / setting_applied_at / setting_change`,
  `private.dispute_value()` (types and ranges per field), `apply_dispute_verdict(case, value, force)` — organiser of
  the case's group only; upheld (`passed`) setting disputes only; once; same fixed field list as 082; refuses (returns
  `changed`) when the value moved since raised unless `p_force`; table triggers still run.
- **Tested:** Vitest `disputes.test.js` 21 (1071 in all); `supabase/tests/084_apply_dispute_verdict.sql` 17 checks
  (rolled back); `dispute-test.mjs` 34; governance 44, comps 24.

## Links, not PINs (083), branch `ov10-links-not-pins`, 22 Oct 2026
- **Why:** Josh: "I don't want PINs any more. It should all be links." A recap link opened with no session showed the
  PIN screen instead of the recap.
- **No PIN anywhere in the UI:** the front door is "Open the link from your group chat" with a paste box that takes
  any app link (invite, guest, team, organiser, personal, or a shared page) + "Lost your link? Ask your organiser to
  send your personal link." (+ Sign in when the build has it). Gone: the PIN box, Admin's "Unlock admin" PIN form and
  "Change PINs", More's "I'm the admin", the admin-PIN card in Group & invites, the PIN on the Sunday guide.
  The server PIN functions (join_group, join_group_id, claim_admin, set_pins, turn_off_admin_pin) stay for old phones.
- **One link scheme:** `#/join/<CODE>?to=<page, URL-encoded>` (`src/lib/links.js`). In that group → straight to the
  page; in another group on this phone → switch, then the page; not in it → Join → pick your name → notifications
  prompt → the page. Old `?vote=<plan>` links still work. Targets must be in-app ("/…", never /join or /me).
  An old link with no code (#/?r=…) is remembered on the phone; after joining by any link they land on it.
- **Every shared link carries the code:** `appLink()` adds the group's join code (fetched once per group,
  `src/lib/joincode.js`), so recap, replay, nudges, trip shares, calendar entries and Call the vote all work with no
  session.
- **Personal links on the live build (sign-in off):** opening one makes that phone the player — no name to pick
  ("Yes, I'm Mike — open the app"). Organisers send them from Group & invites (now shown with sign-in off too);
  players get "📱 Copy my link" on their own profile. Sign-in builds keep 046's flow, plus "Just open it on this phone".
- **Migration 083** (staging only): `share_join_code()` (any member gets the player invite code, a guest gets the guest
  code; made if none is live), `use_player_link(token)` (phone-only use of a 046 link; proper sign-ins go through
  claim_player_link), `create_my_player_link()`.
- **Tested:** Vitest 1073 (`links.test.js` 23 new); SQL `supabase/tests/links_not_pins.sql` 24 checks on staging,
  rolled back; e2e `links-test.mjs` 24 checks; stage2, signin-home, plan-ux, trips, replay, notify-prompt, phone pass.

## Save your spot — sign in once (ov11), branch `ov11-signin-once`, 22 Oct 2026
- **Why:** Josh: "It should have a reminder to log in via Google or email once when the link is opened. Then that's
  how they log in." and "They need to be able to sign up with email and password." The group moves to
  app.thegolftrip.club and everyone picks their name again from a join link.
- **Save your spot:** after join → name → notifications pop-up, a one-time sheet: "Sign in once so the app knows it's
  you on any phone or laptop." Continue with Google (`linkIdentity`, same user — Google's own button on known hosts,
  so no trip away from the iPhone Home Screen app; the redirect elsewhere, coming back to the page they were on) or
  Use my email (email + password: `updateUser({email})` → 6-digit code `verifyOtp type email_change` if the project
  confirms emails, straight through if not → `updateUser({password})`). Not now → a small banner on Home and More;
  closed once it comes back three days later, closed twice it's gone. Always in Group & invites. Only on builds
  with `VITE_SIGN_IN` set.
- **Front door (sign-in builds):** "Been here before? Sign in" first (Google; email + password with Show/Hide,
  "Forgot password?" → emailed code → new password, "Create an account"), then "New here? Open the link from your
  group chat". `VITE_SIGN_IN=google,password`; `google,email` still means a code every time (staging today).
- **Errors in plain words** (`lib/savespot.js authProblem`): Google already used by someone else, email already has an
  account (→ Sign in instead), wrong password (→ Reset it), not confirmed (→ code), weak/leaked password, expired code.
- **Organisers:** Personal links shows ✓ signed in vs not; "🔔 Remind" for someone on the app but not signed in sends
  a `nudge_signin` notification (one new case in the notify function — needs a deploy); if none can be sent, a chat
  message is copied instead.
- **Files:** `src/lib/savespot.js` (+test), `src/lib/auth.js`, `src/components/SaveSpot.jsx`,
  `src/components/SignInForms.jsx`, `src/screens/Join.jsx`, `Group.jsx`, `More.jsx`, `Leaderboard.jsx`, `App.jsx`,
  `supabase/functions/notify/index.ts`, `docs/SIGN-IN-SETUP.md`, `tests/e2e/save-spot-test.mjs`.
- **Tested:** Vitest 1145 (savespot 27 new); e2e `save-spot-test.mjs` 89 checks; signin-home 71, links 24, stage2 19,
  beta 46, phone 17, notify-prompt 31 pass.

## Late organising jobs cost strokes (OV12, 22 Oct 2026) — branch `ov12-late-job-penalty`, migration 085
- **Rule:** every group has a standard Rulebook rule "Late organising job" (Fines): more than N days overdue on a trip
  job → X penalty strokes in the next round. Starts at 0 strokes / 5 days (listed, does nothing). Organisers change X
  and N in the rule's Edit sheet (under the group's decision rule); it can be retired but not deleted. Both numbers are
  RuleTags (disputable); an upheld verdict on either can be applied in one tap.
- **Server decides:** `private.late_jobs()`; when a round goes live (`zz_late_jobs` trigger on rounds) each late job whose
  owner plays costs X strokes once (`score_adjustments`, unique per job): "Late job: Book the bus (+2)". The job's own
  trip first; another round only when that trip has no rounds left to start. Done before the round = nothing.
  Daily `lgc-late-jobs` cron tells the owner once (notify_queue via `gov_queue`). Organiser waiver:
  `waive_late_penalty` (recorded in `job_penalties` / on the adjustment). Owners can't move a late job's due date.
- **Scoring:** `scoring.js penaltyFor / applyPenalty`; Stableford/4BBB −1 point per stroke, Ambrose/stroke play +1 net.
  Leaderboard tag, scorecard line (RuleTag, disputable) + Penalty row, score entry, Stableford trophy.
- **Tested:** SQL `supabase/tests/085_late_job_penalty.sql` (50 results, staging); Vitest 1172 (latejobs 27 new);
  e2e `late-job-test.mjs` 30 checks + trip-plan, stroke, rulebook ×3, dispute, fourball, plan-ux pass.
## Sign in first, as part of joining (ov13), branch `ov13-signin-first-join`, 22 Oct 2026
- **Why:** Josh joined on his phone, missed Save your spot, then tapped "Sign in" with Google on his laptop and got a
  separate, empty account. "That seems weird that I need Save my spot in addition to signing in with Google."
- **Join links (sign-in builds):** any join link (invite, team, organiser) on a phone or laptop that isn't signed in
  shows ONE screen first: "Join <group> — Sign in so it's you on any phone or laptop." Continue with Google (Google's
  own button where it can, else the redirect, which keeps the code and `?to=` page), email + password in one form
  ("Continue with email": tries sign in; no account → "Create my account" → 6-digit code if the project confirms;
  existing email + wrong password → "Forgot password"), and a small "Just this phone for now" (the old phone-only
  join; Save your spot stays for those people). After signing in the link is used by the SIGNED-IN account straight
  away (no second Join tap) → pick name → notifications → the page.
- **Already in:** signed in and already in that group with a name → straight to the page, toast "Welcome back, Kurt".
  In it with no name (names freed) → straight to pick name.
- **Signed in, no group:** "You're signed in as <email> but not in a group yet. Open your group's link (paste it here)
  and you'll join as this account." with the link box showing (pasting joins as that account).
- **Used one-use links:** organiser link → "This link's already been used. If that was you, sign in below." (086);
  personal link opened when not signed in → same words + sign-in below.
- **Taken name:** adds "That's you on another phone? Sign in there and connect Google or email, then sign in here."
- **Save your spot wording:** "Connect Google or email so you can sign in on your laptop".
- **Migration 086** (staging only): `used_link_info(token)` → `{state:'used'|'expired'}` for organiser links, else null.
  Signed-in only, uses the wrong-guess limit, gives nothing else away. Old app versions never call it.
- **Files:** `src/lib/joinfirst.js` (+test), `src/lib/links.js` (inviteNext: signed in → straight there),
  `src/screens/Join.jsx` (JoinSignIn, auto-join), `src/components/SignInForms.jsx` (EmailContinue), `src/App.jsx`
  (welcome back), `src/screens/YourGroups.jsx`, `ProfileSetup.jsx`, `PersonalLink.jsx`, `src/components/SaveSpot.jsx`,
  `Group.jsx`, `src/lib/savespot.js`, `supabase/migrations/086_used_link_info.sql`,
  `supabase/tests/086_signin_first_join.sql` (+expected), `tests/e2e/signin-first-test.mjs`.
- **Tested:** Vitest 1166 (joinfirst 21 new); SQL on staging 32 checks, rolled back (signed-in user joining via player
  invite, team link → cup_side, organiser link → role + once only, personal link via 046 claim_player_link, taken name,
  used_link_info); e2e signin-first 59, save-spot 89, signin-home 76, links 24, stage2, notify-prompt, beta pass.
