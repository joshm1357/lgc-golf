# Decisions (append-only)

## ov28 — teams, the day, results (23 Oct 2026)
- "Your round" is general: Cup match, Ambrose team, 4BBB pair or playing group, from the existing tables (no new team table).
- Leaderboards order by points by default; "On pace" (points against 2 a hole) is a toggle.
- A finished trip opens on its results; trophies show the new holder straight away and organisers engrave with one tap.
- Tipping is its own feature (`tipping`, on for new groups), bragging rights only, locked by the database at the start.
- Swing alerts ride on live commentary's switch and buzz level; never in a digest.
- The night-before tee time buzz is a new 7pm-Sydney (summer) job; it's sent as well as the 9am "trip tomorrow" one.
- "Dinner awards" is called "Awards and fines" in the app; the feature key stays `dinner_awards`.

## ov27 — trip page, money, guests, first open (23 Oct 2026)
- A locked-in trip's page is Your weekend → Your to-dos → "More about this trip" (folded); nothing repeated above it.
- Money paid in goes to the trip's organiser by name ("pay Josh"); the word "kitty" is gone from players' screens. The
  trip's organiser can tick off money paid in for their own trip (096), not only the group's organisers.
- One pop-up a visit. The notifications ask and Caddie's hello wait for the second visit.
- One-step join is switched by `VITE_SIGN_IN`: listing `email` makes join links Google-or-code; live stays as it is
  until Josh changes `sign_in.live`.
- Countdown pushes: one thing each at 30 days, 7 days and the day before; nothing when there's nothing to do.
