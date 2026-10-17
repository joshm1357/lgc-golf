# Build status

Live app: https://joshm1357.github.io/lgc-golf/
Database: Supabase project `lgc-golf` (Sydney), migrations in `supabase/migrations/`.

## Done
- Database: full data model for all stages, Row Level Security, PIN-checked join/admin, handicap guard
  (only admin or Tribunal can change a handicap; every change logged), birdie auto-posts, Tribunal functions,
  photo bucket, realtime. Checked with an SQL walk-through (join, admin, scoring, guard, Tribunal verdict).
- Scoring maths (`src/lib/scoring.js`, `projection.js`, `board.js`) with 18 tests.
- Stage 1: join with group PIN, profile setup with photo, admin (trips, courses, players, rounds, teams,
  trophies, honour board, PINs, paper-card results), score entry with offline queue, live leaderboard with
  projected finish + win %, scorecards, player profiles with history.

## Next
- Stage 2: feed, side comps with map pins and photos, where's everyone map.
- Stage 3: trophies screen, Tribunal screens, courses page.
