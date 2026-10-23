# Decisions (append-only)

## ov28 — teams, the day, results (23 Oct 2026)
- "Your round" is general: Cup match, Ambrose team, 4BBB pair or playing group, from the existing tables (no new team table).
- Leaderboards order by points by default; "On pace" (points against 2 a hole) is a toggle.
- A finished trip opens on its results; trophies show the new holder straight away and organisers engrave with one tap.
- Tipping is its own feature (`tipping`, on for new groups), bragging rights only, locked by the database at the start.
- Swing alerts ride on live commentary's switch and buzz level; never in a digest.
- The night-before tee time buzz is a new 7pm-Sydney (summer) job; it's sent as well as the 9am "trip tomorrow" one.
- "Dinner awards" is called "Awards and fines" in the app; the feature key stays `dinner_awards`.

## ov32 — the group's cups (23 Oct 2026)
- A cup is set up once in the group's library (`cups`, 101) as golf, weekend (social) or combined. Up for grabs on a trip = a `comps` row with `cup_id` plus a trophy row, so the Trophy Room, honour board and hand-over work unchanged. No cup is on by default.
- Golf cups reuse the existing comp kinds; weekend, combined and eclectic cups are kind 'manual' with `settings.cup` / `settings.counts` (older app versions see an ordinary awarded comp).
- Match play (the Cup) as a library format only shows where the Cup feature is on; Kurt's Cup is untouched.
- Cap tips and vibe points are on by default for weekend and combined cups (vibe on combined too, since it carries the social points). Cap tips: 5 each, 1 point, most 2 to one person, no guests — the database enforces the allowance.
- Golf placings: ties share the places they cover (5/3/1, two tied 1st → 4 each). Ambrose team placings count through "Golf results" (every player gets the team's points); "Team matches" is Cup matches.
- Side games count bets won, never dollars: per skin won, or 1 per finished game a player came out ahead in.
- Vibe: Sydney days, the day before to the day after; posts with a link, scoreboard/Tribunal posts and posts starting 🏆/📜/🏁 don't count. Video = a .mp4/.mov/.webm upload (the Feed can't post video yet, so it's ready for when it can).
- "Counts towards" in the propose sheet writes `rules.comp_id`; with no ov31 points set it defaults to `{mode:'winner', points}` (1 unless changed).
- Later sources (jobs on time/late, early RSVP/deposit, season cups) are named in `LATER_SOURCES` in src/lib/cups.js, not built.
