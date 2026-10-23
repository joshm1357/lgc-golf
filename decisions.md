# Decisions (append-only)

## ov28 — teams, the day, results (23 Oct 2026)
- "Your round" is general: Cup match, Ambrose team, 4BBB pair or playing group, from the existing tables (no new team table).
- Leaderboards order by points by default; "On pace" (points against 2 a hole) is a toggle.
- A finished trip opens on its results; trophies show the new holder straight away and organisers engrave with one tap.
- Tipping is its own feature (`tipping`, on for new groups), bragging rights only, locked by the database at the start.
- Swing alerts ride on live commentary's switch and buzz level; never in a digest.
- The night-before tee time buzz is a new 7pm-Sydney (summer) job; it's sent as well as the 9am "trip tomorrow" one.
- "Dinner awards" is called "Awards and fines" in the app; the feature key stays `dinner_awards`.

## ov33 — the presentation (23 Oct 2026)
- It's "the presentation" (never "dinner"); one screen at `#/present/awards/<trip>` presents every award, comp, trophy and cup.
- Default running order: side comps → fines → awards → extras (tips, photos) → round podiums → other trophies → cups → main trophy last.
- The running order is kept on the presenting device only (no database change); the organiser can untick, drag or ↑↓.
- Honourable mentions are 4th and beyond with a story (score, reason, claim or photo), at most 4; for one-winner awards, the nominations that missed out.
- Ties share a place: "Joint 2nd" shows both and the next place is skipped.
- Sharing an item to the Feed uses a fixed post id per trip + item, so it's only ever one post per item.
