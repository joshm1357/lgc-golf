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
## v10.2 — saved accounts (23 Oct 2026, Josh's option B)
- Phone-only ("Just this phone: scoring and voting only") can look and play: see everything, In / Maybe / Out, vote, score, post / react / comment, cap tips, side-game opt-in, claim "Latest out" for yourself, change your own profile.
- Needs a saved account (Google or email): suggesting a trip or starting planning (vote options, stays, activities, trip finder), calling or closing a vote, every organiser action, money ("I've paid", costs, payments, deposits), proposing an award / fine / side game, fining or nominating or claiming for someone else, penalties, disputes and Tribunal cases, proposing rule changes, creating cups, invite links and personal links.
- Left open on purpose (not on either list): jobs and the bring list (plan_items, "I'll do it"), cars, tipping, voting on Tribunal / election cases, a case's defence and posts, accepting a nomination, Cup match holes (scoring).
- One gate in the app (lib/savedgate.js + components/SavedGate.jsx): buttons are marked, never hidden; the tap opens "Save your spot to do this", which links Google or email to the SAME account and then repeats the tap. The database's refusal opens the same sheet.
- The database refuses the same things (102) with "Save your spot first (Google or email) to do this". Saved = the JWT's is_anonymous is false, or the account itself (auth.users) now says so (a token from just before saving).
- Feature `phone_only_limited`, on by default (every preset), so a group can switch it off. Quick rounds never ask.
- Phone-only accounts only come from joining an existing group by its link (or a personal link). Starting a group, a quick round, a club claiming its course page and a group-booking enquiry need Google or email first; the database refuses them for phone-only whatever the switch. No anonymous sign-in left on Start, Club or course pages.
- Searching the course library (#/c) needs a session (search_courses refuses signed-out callers, which stops scraping), so signed out it's a sign-in card; a course's own page still opens for anyone.
## ov35 — two votes, co-organisers, several drafts (23 Oct 2026, Josh's picks)
- The start vote is two cards, 📅 When? (weekends, How long?) and 📍 Where? (areas, and optionally their courses / places to stay). Call either first, or "Call both" (one batch, one message, title "Where and when?"); each card's polls close on their own. Which card a poll belongs to is worked out from its kind / option keys (lib/votecards.js), so a shared batch splits cleanly.
- Choosing the area never settles the weekend, and settling the weekend never chooses the area. Course calls unlock once both are decided (or skipped), as before.
- Any button that closes a vote says so: "Close the vote and go with …", with "This closes the … vote now and posts the result in the Feed" under it. Choosing an area from the area page while the Where? vote is out asks first ("That closes the Where? vote now and posts the result").
- One Feed post per card ("📅 … the weekend's decided … Still to decide: where." / "📍 … we're going to … Next: ringing the courses"), once per vote; no post when there was no vote.
- Old trips with the combined vote (state.votes.v1 and no when/where) keep the old screen untouched.
- The Where? card's "went into the detail" count is out of the people who answered Where? (no longer everyone who answered anything).
- Co-organisers: 1–3 players per trip, named by a group organiser or the trip's own organiser. On that trip they can do everything an organiser can (builder, votes, jobs, money, rooms & cars, lock in, call off); not who organises it or its link to the app's trip. A co-organiser can step down. Guests can't be one. Enforced in the database (104); the app gives them the organiser's view of that trip only (PlanRole).
- "Suggestions from anyone" (optional) not built.
- The Caddie's ✨ planning chat stays organisers-only (the AI helper only plans for organisers); a co-organiser plans on the trip screen.
- Planning chats are kept per trip on the phone for 90 days (the not-yet-a-trip chat a week). The Caddie's Plan tab has a "Planning:" picker; "Start a new plan" keeps the trip's chat.
- AI-made drafts were never hidden: they're planning trips (proposed = false) and show under "Being organised". "My draft trips" lists every planning trip an organiser can change (all non-proposed ones + their own proposals), or the ones a player co-organises.
