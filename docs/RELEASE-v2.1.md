# v2.1 release — checklist (STOP: nothing here runs until Josh says go)

v2.1 = Stage 4 (branding), 5 (Rulebook per group), 6 (history import), 7 (start a new group), 8 (shared course
library), 7b (quick round), 8b (club partners and the course list), 9 (launch basics). All built and tested on
**staging** only. Live has not been touched. v2.1 sits on v2.0, which sits on v1.5 — both still waiting for your OK.

## Before the release
1. **v1.5, then v2.0 first** (`docs/RELEASE-v2.0.md`).
2. **Staging paste list** (Supabase SQL editor on `lgc-golf-staging` — these remove rows or drop a test helper, so
   the build tools can't run them): `020`, `021`, `027b_remove_member.sql`, `033b_remove_history_handicap.sql`,
   `drop function public.tmp_echo_headers();`, `041b_delete_my_data.sql`, then run `supabase/tests/stage9_delete.sql`
   and check it matches `stage9_delete.expected.txt`.
3. **Staging settings:** anonymous sign-ins on (Authentication → Sign In / Providers); CAPTCHA for phone-only sign-ins
   and a look at the per-address sign-in limit (30 an hour by default) before any QR code goes out.
4. **A second test group end to end on staging, in a real browser:** Start → wizard → invite a second phone → a quick
   round from a course page → finish → share picture → make it official. (I can't reach staging from my workspace's
   browser — it only allows package downloads — so this one is you, or me if you allow `*.supabase.co` in the
   workspace's network settings.)
5. **Make yourself the approver on live** (after step 1 of the release): `insert into public.platform_admins (user_id)
   values ('<your live user id>');`

## The release (in this order, after your OK)
1. Live database, SQL editor on `lgc-golf` (live), one file at a time:
   `031` → `031b` → `032` → `032b` → `033` → `033c` → `033b` → `034` → `034b` → `035` → `035b` → `036` → `036b` →
   `037` → `038` → `039` → `039b` → `039c` → `040` → `040b` → `041` → `041b`.
   Each adds things only, apart from `033b` and `041b` (they add functions that remove rows when someone taps
   delete — nothing is removed by running them, except `041b` clearing wrong-PIN records older than 30 days).
2. I give you read-only checks for live (L.G.C's counts before/after; no other groups; features unchanged).
3. Merge `product` into `main` → GitHub Pages builds the new app. Old phones keep working.
4. Check on your phone: leaderboard, a score, the Feed, Trips, More → Group & invites → Your data, `#/start`, `#/c`.

## Not in this release (separate STOPs)
- **Course list on live:** the seeding job (`seed-osm-courses`) is only on staging. Live needs your OK on the
  OpenStreetMap licence question (BUILD-STATUS → Stage 8b) and then a one-off run per state.
- **First real club claim** — you approve it by hand at `#/club/claims`.
- **QR kits and stay cards** — marked draft until the app is on `thegolftrip.club`; you pick the pilot club.
- **Hosting move, domain, Supabase Pro** — BUILD-STATUS → Stage 9 → "For Josh — launch steps".
- **Sign-in buttons** (Google / email) — `docs/SIGN-IN-SETUP.md`.

## If something goes wrong
- App: re-deploy the previous `main` commit (GitHub → Actions → re-run the last good deploy).
- Database: the new pieces are additions; the previous app keeps working against them, so nothing needs removing to
  roll the app back.
