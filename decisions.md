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
## ov29 — side games opt-in (23 Oct 2026)
- Every side game is "Everyone in the round" (default, all existing games) or "Opt-in"; only those in count in results and money. Ambrose: a team is in if any of its players is.
- Opt-ins close when the round goes live, or at the first tee time if one is set (Sydney). Organisers can still add or take out anyone after that.
- Any member (not guests) can put up an opt-in game; they're in automatically; one Feed post and one `game_proposed` buzz (once per game, max 3 a day per person). Max 3 games up per person per round.
- A proposer can only take their game down (before the round), not change it — people opted in to what they saw.
- House rules are optional; the 073 check on `custom_games.rules_text` is replaced by 0–1000 letters (the one non-additive change, agreed with Josh).
- Opt-in games aren't copied by "Do it again" — they were someone's offer for that trip.
## ov30 — rule penalties and Ambrose drives (23 Oct 2026)
- Drives defaults on 18 holes: 6 each in a three, 4 in a four, 6 in a pair; five or more share the four's total (3 each); 9 holes = half, rounded down; never more than holes ÷ team size. +2 strokes a drive short.
- A team that records no drives at all isn't tracked and gets no drives penalty (it wasn't tracked, not broken).
- Drive penalties are added when the round locks; while live they show as "projected" and don't count.
- A player's penalty is a proposal until an organiser confirms it; guests can't give penalties. Organisers' go straight on.
- Rule penalties count on the team score in Ambrose and the player's score otherwise; negative strokes are bonus lines.
- `score_adjustments.kind` widened to 'late_job', 'rule_breach', 'award' ('award' reserved for a later migration).
## ov31 — automatic awards (23 Oct 2026)
- A time-proof award decided by latest / earliest runs each night by default (9pm–6am, proposed 7am or an hour before the first tee). Others stay once a trip unless set.
- A claim is judged by the post's server time and the claim window, not by when you tap: a night's photos can be claimed until the proposal goes up.
- The confirm deadline is that day's first tee, or noon with no round.
- One tap claims for whoever posted the photo; "Someone else" picks a mate.
- Points are written as pending when proposed and count only once confirmed; a dispute on one line holds just that line.
## ov33 — the presentation (23 Oct 2026)
- It's "the presentation" (never "dinner"); one screen at `#/present/awards/<trip>` presents every award, comp, trophy and cup.
- Default running order: side comps → fines → awards → extras (tips, photos) → round podiums → other trophies → cups → main trophy last.
- The running order is kept on the presenting device only (no database change); the organiser can untick, drag or ↑↓.
- Honourable mentions are 4th and beyond with a story (score, reason, claim or photo), at most 4; for one-winner awards, the nominations that missed out.
- Ties share a place: "Joint 2nd" shows both and the next place is skipped.
- Sharing an item to the Feed uses a fixed post id per trip + item, so it's only ever one post per item.
## ov27 — trip page, money, guests, first open (23 Oct 2026)
- A locked-in trip's page is Your weekend → Your to-dos → "More about this trip" (folded); nothing repeated above it.
- Money paid in goes to the trip's organiser by name ("pay Josh"); the word "kitty" is gone from players' screens. The
  trip's organiser can tick off money paid in for their own trip (096), not only the group's organisers.
- One pop-up a visit. The notifications ask and Caddie's hello wait for the second visit.
- One-step join is switched by `VITE_SIGN_IN`: listing `email` makes join links Google-or-code; live stays as it is
  until Josh changes `sign_in.live`.
- Countdown pushes: one thing each at 30 days, 7 days and the day before; nothing when there's nothing to do.
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
