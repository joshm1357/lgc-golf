# Decisions (append-only)

## ov28 — teams, the day, results (23 Oct 2026)
- "Your round" is general: Cup match, Ambrose team, 4BBB pair or playing group, from the existing tables (no new team table).
- Leaderboards order by points by default; "On pace" (points against 2 a hole) is a toggle.
- A finished trip opens on its results; trophies show the new holder straight away and organisers engrave with one tap.
- Tipping is its own feature (`tipping`, on for new groups), bragging rights only, locked by the database at the start.
- Swing alerts ride on live commentary's switch and buzz level; never in a digest.
- The night-before tee time buzz is a new 7pm-Sydney (summer) job; it's sent as well as the 9am "trip tomorrow" one.
- "Dinner awards" is called "Awards and fines" in the app; the feature key stays `dinner_awards`.

## ov30 — rule penalties and Ambrose drives (23 Oct 2026)
- Drives defaults on 18 holes: 6 each in a three, 4 in a four, 6 in a pair; five or more share the four's total (3 each); 9 holes = half, rounded down; never more than holes ÷ team size. +2 strokes a drive short.
- A team that records no drives at all isn't tracked and gets no drives penalty (it wasn't tracked, not broken).
- Drive penalties are added when the round locks; while live they show as "projected" and don't count.
- A player's penalty is a proposal until an organiser confirms it; guests can't give penalties. Organisers' go straight on.
- Rule penalties count on the team score in Ambrose and the player's score otherwise; negative strokes are bonus lines.
- `score_adjustments.kind` widened to 'late_job', 'rule_breach', 'award' ('award' reserved for a later migration).
