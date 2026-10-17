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
