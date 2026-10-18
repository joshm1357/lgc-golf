# v2.0 release — checklist (STOP: nothing here runs until Josh says go)

v2.0 = Stage 1 (groups), 1b (Trips), 2 (invites and roles; sign-in buttons stay hidden), 3 (feature switches).
All built and tested on **staging** only. L.G.C on live has not been touched.

## Before the release
1. **v1.5 first.** v2.0 sits on v1.5, which is also still waiting for your OK (BUILD-STATUS → "Live release steps for
   v1.5"). Release v1.5, check it on your phone, then v2.0.
2. **Staging paste list** (approval prompts time out from here, so these need you, in the Supabase SQL editor on
   `lgc-golf-staging`): `020_merge_policies.sql`, `021_move_pg_net.sql`, `027b_remove_member.sql`, then
   `drop function public.tmp_echo_headers();`
3. **Anonymous sign-ins on in staging** (Authentication → Sign In / Providers) — finishes two Stage 1 tests and the
   old-version browser test against staging.
4. A second test group run end to end on staging (I can do this once 3 is on).

## The release (in this order, after your OK)
1. Live database, in the SQL editor on `lgc-golf` (live): migrations `022` → `023` → `024` → `025` → `026` → `027` →
   `028` → `029`, then `027b`. Each is additive; L.G.C becomes the first group with everything as it is today
   (every feature on apart from scorecard photos and booking links, which it doesn't use).
2. Re-run the test files' read-only checks I'll give you for live (counts of L.G.C rows before/after, no other groups).
3. Deploy the server functions `notify` and `lgc-mcp` to live (I do this once the database is done).
4. Merge `product` (with stages 1–3) into `main` → GitHub Pages builds the new app. Old phones keep working: the
   database fills in the group for them, and every v1.5 screen behaves as before.
5. Check on your phone: leaderboard, a score, the Feed, Trips, More → Group & invites.

## Turning things on afterwards (separate STOPs)
- Sign-in with Google / emailed code — `docs/SIGN-IN-SETUP.md` (staging first).
- Inviting a second group — once you're happy with L.G.C on v2.0.
- Supabase Pro (US$25/month) before the first outside group, so the database doesn't pause (Stage 9).

## If something goes wrong
- App: re-deploy the previous `main` commit (GitHub → Actions → re-run the last good deploy).
- Database: every migration only adds things, so the old app keeps working against the new database. Nothing needs to
  be removed to roll back the app.
