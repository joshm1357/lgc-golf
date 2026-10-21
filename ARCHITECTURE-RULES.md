# ARCHITECTURE-RULES

Save this section as `ARCHITECTURE-RULES.md` in the repo root and follow it for every task. Also create `BUILD-STATUS.md` and update it at the end of every stage (what was built, what was tested, what's next, any deviations).

## What this is
A mobile web app for a group of mates' golf weekends. Live scoring, a live leaderboard with player photos, a social feed, side comps (longest drive / closest to pin) on a satellite map, and trophy leaderboards across the weekend (a Stableford trophy on total points, and an Ambrose trophy), plus an honour board. It is a friends' app: the security goal is "stop accidents and randoms", not bank-grade.

## Stack (do not change without asking)
- **Front end:** React + Vite, plain JavaScript (JSX). Vitest for tests.
- **Back end:** Supabase — Postgres database, Realtime (live updates), Storage (photos), Auth (anonymous sign-in).
- **Maps:** Leaflet + react-leaflet with Esri World Imagery satellite tiles (with the required attribution). No paid map APIs, no API keys.
- **Hosting:** GitHub Pages, deployed by a GitHub Actions workflow on push to `main`. Set the Vite `base` to the repo name. Use `HashRouter` so refreshing a page never 404s.
- **Installable:** PWA manifest + icons so it can be "Added to Home Screen" on iPhone and Android.

## Rules
1. **Audit before building.** At the start of each stage, inspect the repo and current state, then report what you'll change before changing it.
2. **One stage at a time, all tonight.** Build everything in this prompt tonight, in order. Finish and test each piece before starting the next. Stop for my OK only at the two checkpoints marked **STOP** (after the audit, and after Stage 1). After that, keep going: commit, test and update `BUILD-STATUS.md` after each piece, and give me a two-line summary, but don't wait for me unless something is broken or a decision is genuinely mine.
3. **All scoring maths lives in one place:** `src/lib/scoring.js`, as pure functions with unit tests. No scoring maths inside UI components.
4. **The database is the single source of truth.** Screens subscribe to Supabase Realtime and re-render; no hidden copies of scores.
5. **Patchy signal on a golf course is normal.** Score saves must queue locally (localStorage) when offline and sync automatically when signal returns, with a small "3 scores waiting to sync" indicator.
6. **Mobile first.** Big tap targets (min 48px), readable in sunlight (high contrast), works one-handed. Test at 375px wide. Must work in iOS Safari and Android Chrome.
7. **Security:** Row Level Security on every table. Only the Supabase URL and anon key go in the front end (via `.env` / GitHub Actions secrets) — never a service key. Joining an event requires the group PIN, checked by a database function (`join_event`), which records the device's anonymous user as a member; RLS only lets members read/write. Admin actions require a separate admin PIN, also checked in the database.
8. **Photos:** compress on the phone before upload — feed/side-comp photos max 1600px JPEG ~0.8 quality; player avatars max 400px square. Store in Supabase Storage.
9. **GPS is approximate.** Phone GPS is roughly ±5–10 m. Always show accuracy, label GPS distances as "approx", and allow manual override. Location is opt-in and only collected while the app is open.
10. **Branding in one file:** `src/theme.js` (colours, fonts, logo path). Logo files in `public/brand/`.
11. **Database changes as SQL migration files** in `supabase/migrations/`, numbered. Give me the SQL to paste into the Supabase SQL editor, and tell me exactly which Supabase settings to switch on (e.g. anonymous sign-ins).
12. **Plain language.** Australian English in the UI. Explain what you did in plain words — I'm an engineer but a coding beginner.
13. **Keep it simple.** Prefer fewer files and fewer libraries. Ask before adding any new dependency beyond those listed.
14. **Protect tomorrow's round.** As soon as Stage 1 passes and is live, create a git tag `ambrose-ready`. Build every later piece on its own branch and merge to `main` only when its tests pass. If anything breaks the live app, roll `main` back to the last good tag first and debug second. Any database change after Stage 1 must be additive (new tables/columns only — never drop or rename what Stage 1 uses).

---

## Product phase (from 18 Oct 2026, v2.0 onwards) — these replace the matching rules above

- **What this is now:** the L.G.C app becomes **The Golf Trip**, a product any golf group can use. One codebase and one
  database serve many groups. Each group sees only its own data, plus its own name, crest, rulebook, history and choice
  of features. L.G.C is group number one and keeps its own name, crest and trophies.
- **Security goal (replaces "stop accidents and randoms"):** no group can ever read or change another group's data.
  This covers tables, Edge Functions, scheduled jobs, push notifications, photos, phone storage and the Claude
  connector. It is tested, not assumed.
- **Features can be switched on or off per group.** Every feature beyond the core (scoring, leaderboard, players,
  rounds) sits behind a switch. A switched-off feature is hidden in the app and refused by the database. Switching off
  never deletes data; switching back on brings it back.
- **Pace (replaces rule 2's "all tonight"):** keep building through the stages in order without waiting for Josh,
  except at a **STOP**. Stops come after each audit, before anything touches the live database or `main`, and before
  anything costs money or changes hosting, domains or sign-in settings.
- **L.G.C must keep working.** Its live app, data and PINs work the same after every release. Rule 14 still applies:
  tag before each release, branch per stage, database changes additive only.
- **Old phones keep working.** The service worker keeps the app saved on phones, so some phones run the previous
  version for a while. Every database change must keep the previous app version working until it updates.
- **Build and test on staging first.** Supabase project `lgc-golf-staging` for every database change; the live project
  only after Josh's OK. Database changes that DROP anything need Josh in the chat to approve them.
- **Words:** group, organiser, player, guest, trip, round, rulebook, history, feature — used the same way in code,
  comments and UI. The planner's `plan_groups` / `plan_group_members` tables are rooms and cars, not groups in this
  sense. Leave their names alone and never mix the two up.
- **Tribunal words (Stage 11b):** case (anything raised for the group to decide, serious or silly), hearing (the time a
  case is open), verdict (its result), decision rule (who decides a kind of case, and how), committee (a named set of
  players who decide certain kinds of case), seat / term (a place on a committee, and how long it's held). Organiser,
  not "admin".
- **Plain language, Australian English, mobile first** (375px, one hand, sunlight), as before.
- **Branding (replaces rule 10):** brand values come from the current group (Stage 4); until then they live in
  `src/styles.css` (`:root`) and `src/components/Logo.jsx`.
- **Dev → staging → production (from 20 Oct 2026, `docs/RELEASE-FLOW.md`):** work on a branch and open a pull request
  into `product`. Never push straight to `product` or `main`. Give Josh the branch's preview link
  (`<branch>.thegolftrip-app.pages.dev`) to test, and merge only after his OK with the Check ✅. A release is a pull
  request from `product` into `main`, at a STOP.
