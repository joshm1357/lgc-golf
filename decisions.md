# Decisions (append-only)

## ov28 — teams, the day, results (23 Oct 2026)
- "Your round" is general: Cup match, Ambrose team, 4BBB pair or playing group, from the existing tables (no new team table).
- Leaderboards order by points by default; "On pace" (points against 2 a hole) is a toggle.
- A finished trip opens on its results; trophies show the new holder straight away and organisers engrave with one tap.
- Tipping is its own feature (`tipping`, on for new groups), bragging rights only, locked by the database at the start.
- Swing alerts ride on live commentary's switch and buzz level; never in a digest.
- The night-before tee time buzz is a new 7pm-Sydney (summer) job; it's sent as well as the 9am "trip tomorrow" one.
- "Dinner awards" is called "Awards and fines" in the app; the feature key stays `dinner_awards`.

## ov26 — votes and the organiser's planning flow (23 Oct 2026)
- Locking a trip in closes its votes on where and when (dates, places, stays, vote cards, the optional detail), done by the database (095) as well as the app. Votes on anything else stay open. Closed ones have no winner and show as "Decided: <dates>, <place>".
- Answer words: Yes / Maybe / No for dates, how long and "Are you in?"; Keen / Happy with it / Not keen for places and extras. Stored answers stay yes / maybe / no.
- The detail vote counts only when at least a third of voters went into it; otherwise it's "for info" and the organiser chooses.
- One headcount rule (`lib/headcount.js`): target first (labelled a target), else in, else in or maybe, else the group.
- When a trip's start date changes, the usual (formula) jobs move by the same number of days, clamped to between today and the trip's start. Jobs people added themselves don't move.
- A weekend "works" when every golf day has a course with enough tee times in a row; it's "out" when a golf day has every course answered and none can take us.
- Feed posts for plan changes are one per real change (result, calls done, going with the backup, backup added, area re-opened), remembered in the builder's state so a second tap doesn't post again.
