# Stage 1 audit — Groups (one system, many groups)

18 Oct 2026. Read-only: live database (`lgc-golf`), the repo on branch `product` (= `v1.5`), both Edge Functions,
the service worker. Nothing changed. **STOP: Josh reviews the decisions in section 3 before Stage 1 is built.**

## 1. What's there today

**Live data (L.G.C):** 17 players, 11 sign-ins (all anonymous phones), 2 admins, 1 trip, 3 rounds, 144 scores,
21 posts, 7 rules, 0 plans, 7 photos (folders `avatars/`, `comps/`), **0 phones signed up for notifications**.

**Tables (39 in `public`).** Every table has access rules; 31 send live updates (Realtime).

| Group | Tables | How `group_id` gets filled for old phones |
|---|---|---|
| Top-level (no parent) | players, trips, courses, honour_board, rules, tribunal_cases, location_pings, push_subscriptions | From the person doing it (their only group) |
| Under a trip | trophies, rounds, plans (trip optional) | From the trip / the person |
| Under a round | teams, round_players, scores, quick_results, side_entries, round_pins, draws | From the round |
| Under a team / post / case / rule | team_players, comments, reactions, tribunal_votes, rule_votes, handicap_history | From the parent |
| Under a plan | plan_polls, plan_rsvps, plan_items, plan_costs, plan_payments, plan_groups, plan_transfers (+ options, votes, room/car members via their parent) | From the plan |
| Mixed parents | posts (trip, round or none), draws (round or plan) | First parent that's set, else the person |
| Server-only | settings (becomes `groups`), server_secrets, notify_log | — |
| Sign-ins | members (becomes `group_members`) | — |

**Functions that assume one group (21).** `settings`: join_group, claim_admin, set_pins, my_status.
`members`/helpers: is_member, is_admin, my_player_id, and through them every access rule (140) plus create_my_player,
claim_player, cast_vote (counts *all* members as voters), save_push_subscription, plan_rows_guard, the handicap guard.
`lodge_case` writes "The Lads v …" into the feed.

**Edge Functions.**
- `notify`: checks the caller's `members` row (one per sign-in). `send('all')` goes to **every** phone, the daily
  reminders scan **all** plans, and the plan/poll ids in a request are never checked against the caller's group.
  Push keys are app-wide (fine). Link points at `joshm1357.github.io/lgc-golf`; times fixed to Sydney.
- `lgc-mcp` (Claude connector): one key in `server_secrets` = admin of everything; "current round" = latest live
  round in the whole database.
- Daily reminder job: one cron job calling `notify` with `{"type":"daily"}`.

**Photos.** One public bucket `photos`; paths `avatars|feed|comps|tribunal/<time>-<random>.jpg` — no group.
Anyone signed in to any group could upload; only "an admin" can delete.

**Live updates (Realtime).** 13 places subscribe; only `scores` is filtered. Realtime only delivers rows the person
is allowed to read, so other groups' rows won't arrive once the rules are per group — but each phone would still be
woken for every group's changes. Add `group_id=eq.<g>` filters.

**On the phone.** localStorage: `lgc-auth`, `lgc-cache-status-<user>`, `lgc-cache-ref`, `lgc-cache-scores-<round>`,
`lgc-cache-plan-<plan>`, `lgc-score-queue`, `lgc-outbox`, `lgc-ranks-<round>`, `lgc-bring-<plan>`,
`lgc-hide-<plan>`, `lgc-share-location`, `lgc-distances-on`, `lgc-draw-dismissed`. IndexedDB `lgc` → `photos`
(photos waiting to send). Caches `lgc-shell-v2`, `lgc-tiles-v1`. **`lgc-cache-ref`, `status`, the score queue and the
outbox are not per group** — a phone in two groups would mix them.

**Hard-coded L.G.C (for Stage 4, not Stage 1):** crest + "Big Dick Energy" (`Logo.jsx`), BD / Putt Buddies / Noodle Cup
art (`TrophyArt.jsx`), "The Lads v …", Guide and DrawDemo names, `/lgc-golf/` path, manifest, colours in `styles.css`
(there is no `src/theme.js` yet), notification and calendar names.

## 2. The plan for Stage 1 (additive; old phones keep working)

1. `groups` (id, slug, name, group_pin unique, admin_pin, created_at) — L.G.C copied from `settings`.
2. `group_members` (group_id, user_id, player_id, role organiser/player/guest, created_at; key group_id+user_id) —
   L.G.C copied from `members` (2 admins → organisers). `members` stays and is kept in step for L.G.C by a trigger
   until no phone runs v1.5 (old app versions read it through `my_status`).
3. `group_id` on all 36 data tables: add nullable → backfill L.G.C → index → trigger fills it on insert (from the parent
   row, else the person's only group, else refuse with a plain message) → `not null`.
4. Helpers `is_group_member(g)`, `is_group_organiser(g)`, `my_player_id(g)` in a `private` schema the app can't call
   directly (also takes 4 functions off the advisor's list). Every rule rewritten as
   `is_group_member(group_id) and <today's rule>`; same intent (e.g. only the receiver confirms a payment).
5. Old function names keep working: `join_group(pin)` finds the group by PIN; `my_status()` answers for the person's
   current group; `cast_vote` counts voters in the case's group only.
6. `notify` and the reminder job loop per group; every request id checked against the caller's group.
   Connector keys move to `connector_keys(group_id, key_hash, player_id)`; L.G.C keeps its current key.
7. Photos: new uploads to `<group_id>/<folder>/…`; upload/delete rules check the folder's group. Old paths stay
   readable.
8. Phone: cache keys get the group (`lgc-cache-<group>-…`); queue and outbox items carry their group; old keys are
   read once and moved.
9. Tests: isolation SQL (a second test group with a player, plan, rule and cost — zero rows across, no writes across,
   handicap guard per group, notify and connector refuse other groups); old-version test (v1.5 build against staging).

## 3. Decisions for Josh (my recommendation first)

1. **A player profile belongs to one group** (recommended) — someone in two groups has two profiles (own handicap,
   history and photo in each), linked to one sign-in. *Alternative:* one person, shared across groups — simpler for
   the person, but handicaps and Tribunal history would leak between groups.
2. **Photos stay in a public bucket with unguessable names, filed per group** (recommended for v2.0 — old phones keep
   working). *Alternative:* private bucket with short-lived links — properly private but every photo link changes and
   old phones can't show new photos. Could be a later step.
3. **Courses get a `group_id` now** and become shared in Stage 8 (recommended) — keeps Stage 1 simple.
4. **Fix in Stage 2, not Stage 1:** `claim_player` lets any member take over any player's profile (e.g. change Josh's
   PayID); `claim_admin` has no limit on wrong PIN guesses.

## 4. What Josh needs to do before Stage 1 can be tested end to end on staging
- Approve 020 and 021 on staging (they DROP things, so the prompt needs you in the chat).
- Staging → Authentication → Sign In / Providers → turn on **Allow anonymous sign-ins** (only on
  `lgc-golf-staging`; it's how the phone test and old-version test sign in).
- Optional, for the notify test on staging: let me deploy the two Edge Functions to staging (no cost).
