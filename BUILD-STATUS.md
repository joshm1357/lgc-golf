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

**Josh's paste list for staging (approvals time out from here):** `020`, `021`, `027b_remove_member.sql`, `033b_remove_history_handicap.sql` (after 033c), and
`drop function public.tmp_echo_headers();` (a test helper, already emptied and locked).

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

**Tested:** `supabase/tests/stage8_courses.sql` 16 checks (players can't share, 17-hole course refused, table not
readable, search by name with area/holes/greens/credit, distance, only course details kept, copy is the group's own,
copying twice gives the same course, changing a copy leaves the library alone, use count, a copy can't be shared again,
can't share another group's course or see it, sharing again updates the same entry, not signed in sees nothing);
unit test (OpenStreetMap marking); phone width `tests/e2e/courses-test.mjs` 10 checks. All other phone tests pass.

## Known limits
- GPS distances are approximate (±5–10 m) and straight-line; closest-to-pin distance is typed in.
- Location sharing only works while the app is open.
- iPhone notifications only work once the app is added to the Home Screen and opened from there (iOS 16.4+).
- `pg_net` sits in the public schema until 021 runs on live.
- Supabase free plan pauses after 7 days without use — restore it from the dashboard before the next trip.

## Later
- Dinner awards voting, fines.
