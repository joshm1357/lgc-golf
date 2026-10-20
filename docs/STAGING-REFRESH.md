# Refresh staging from live

Copies the L.G.C's real history from live into the L.G.C group on staging, so the test app looks like the real one.
Live is only ever **read**. Nothing is written to live.

Last done: 20 Oct 2026.

## What is copied, and what never is

Copied (live, read-only → staging L.G.C group `f9e18914-24a2-43ad-8989-ca91e3d1af19`), parents first:
players (without `pay_details`), courses, trips, trophies, rounds, teams, team_players, round_players,
quick_results, side_entries, scores, posts, reactions, honour_board, handicap_history, rules,
tribunal_cases, tribunal_votes, plans, plan_rsvps.

Never copied: sign-ins (`members` / auth users), `players.pay_details`, `push_subscriptions`, `location_pings`.
Photos stay where they are (the copied rows point at live's public photo addresses).

## Steps

1. On staging, create the helper: `supabase/staging/refresh_helper.sql`.
2. On live (read-only), export each table as JSON, e.g.
   `select jsonb_agg(to_jsonb(p) - 'pay_details') from players p;`
   Live has one group, so there is no group filter. Leave out `pay_details` and null fields.
3. On staging, load in one transaction, parents first:
   ```sql
   begin;
   set local session_replication_role = replica;   -- no triggers: no birdie posts, no notifications
   select private.tmp_load('players', '<json>'::jsonb, 'f9e18914-24a2-43ad-8989-ca91e3d1af19');
   -- … courses, trips, trophies, rounds, teams, team_players, round_players, quick_results,
   --   side_entries, scores, posts, reactions, honour_board, handicap_history, rules,
   --   tribunal_cases, tribunal_votes, plans, plan_rsvps
   commit;
   ```
   Rows that are already there are skipped, so running it again is safe (it adds, it doesn't update).
4. Check the counts match live (players, rounds, scores, posts, honour board, Tribunal).
5. Lock any leftover staging test trip so the real trip is the current one.
6. Make personal links for anyone testing on staging (Group & invites → Send link, or insert into `player_links`).
7. Drop the helper: `drop function private.tmp_load(text, jsonb, uuid);`

## 20 Oct 2026 result

17 players, 3 courses, 1 trip, 3 trophies, 3 rounds, 5 teams, 10 team players, 9 round players, 6 quick results,
3 side entries, 144 scores, 22 posts, 4 reactions, 10 honour board, 11 handicap history, 7 rules, 4 Tribunal cases,
12 votes, 1 plan, 3 RSVPs — all match live.
The old staging test rows (Josh Stage, Mike Stage, "L.G.C staging trip", 1 round) are still there; the test trip is locked.
