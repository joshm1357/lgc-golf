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
## ov36 — the trip map's courses (23 Oct 2026, Josh picked all four)
- The map and the list show the same courses: every course within the drive (after the filters) is a dot; the list shows them 12 at a time ("All 19 are on the map"), and always shows what's on the table, even when a filter or the drive would hide it ("on the table (outside the filters)" / "(further out)").
- Any dot can be picked from its summary card: "+ Put on the table" (and "✓ On the table — take off"). Organisers only.
- Filters: Either / Not played / Played before; ★ rating minimum (ours, else other groups'); type (from the course research "style" words: links, parkland, resort, heathland, sandbelt, coastal, bush, country, hills, lakes & water — only the types some course has are offered); longest drive; sort Suggested / Best rated / Closest / Top ranked (from the research "rankings", lowest # first). A filter with no data is hidden. Saved on the trip (builder state `courseFilters`, one set for the trip); a player's view keeps its own, not saved.
- Search wider: "Show N more" first, then "Search wider: within 40 min of Pokolbin and Cessnock → 45 min", steps 20/30/40/45/60/75/90/120 min. Saved per area (`courseReach`). It's separate from the trip's `stayMax` (which still drives day building and "x of the courses within 40 min").
- Your own part of the map: "🔍 Search this part of the map" lists the courses in view (refuses more than 3° × 4° of map: "Zoom in a bit first"). "Save as an area" names it "Custom: around <nearest town within 60 km>" (else "my area"), keeps its box (`customAreas`) and puts a 🏠 pin in the middle; its course list is the courses inside the box. With an area already chosen, saving goes back to a list of options (like "+ Add another area").
- On the way: straight line from each starting point (trip_start_points, else the "Coming from" centre) to the middle of where you'd stay; courses up to 10/20/30/45 min off that drive (default 20, saved as `onWayDetour`), not within 25 min of home, not further from the area than the start, not already in the area's list. Shown as "On the way up or back" (no direction yet — the same line both ways). Ticking one puts it on the area's table; it doesn't go into stay days automatically.
## ov34 — Round call-outs (23 Oct 2026, Josh: "plan a round too and ask the guys … not being a cup")
- One engine: a call-out is a plan (kind 'round', callout = true) using the dates vote, In/Maybe/Out, lock-in and the feed; lock-in makes ONE round on a trip made by 025's guard. No parallel tables except `plan_invites` (who's asked).
- Time: one option = a set time (In / Maybe / Can't); 2–8 options = ✓ / ? / ✗ per option. Part of the day stored per option (`plan_options.part`, `tee_time`); labels stay human ("Fri 30 Oct · arvo").
- The quick ranges are rolling from tomorrow — "Next 7 days", "Week after", "Next 2 weeks", "Next 4 weeks" — so they're never empty late in the week. In the type-it box, "this fri" = Friday this week (or the coming one if gone), "next fri" = Friday of next week (Mon–Sun weeks), a bare "fri" = the coming one (today if it's Friday).
- Spots: a cap with a reserve list, or no cap, chosen before sending. Order = when you FIRST said in / ticked ✓ (stamped by the database; editing nothing moves you; going to maybe or can't and back puts you at the back).
- Who's asked: whole group by default (approved, not guests); a list gets buzzes only (no Feed post). Only the people asked (plus whoever put it out and organisers) can reply — the database refuses others.
- Who can put one out: anyone in the group with a saved account (102); phone-only and guests can reply only. Lock / change / call off: whoever put it out, the plan's organiser, or a group organiser.
- After lock-in the round's players follow the In list automatically until the round goes live; then only an organiser changes it.
- "Didn't get a spot this time" goes to people who said maybe when it locked full; everyone who said ✓ past the cap is a reserve.
- The day-before buzz is the call-out's own (5pm Sydney onwards); the trip countdown skips call-outs. No new weather API: the round screen shows the existing Open-Meteo forecast after lock-in.
- A locked call-out has a trip (025 makes one) — so it can show as "Next trip" on Home until it's played. Accepted: it's what's on next.
- Josh 23 Oct 9:39pm, "hide any of those things as standard, maybe allow some to be included as options": the round screen hides all trip machinery; "➕ Add to this round" (collapsed, on the sheet and in Change) switches on, per round, stored in `plans.extras`: vote on the course (the plan's 'location' vote), side games (Games, after lock), fines & awards (the trip's, after lock), cars (the plan's cars list), kitty (the plan's kitty), drinks/lunch after (a line). Not included: a comp or trophy (cups/comps need the Cup set-up and a trip's comps — not a clean per-round switch; set up from the Cup screen as now).
- The old "⛳ One-day round" in Suggest and "Same time next year?" open the new sheet. The AI planner (CaddiePlan / AiPlanner) can still draft a kind 'round' trip-style plan — left as is.
- Repeating call-outs ("every Saturday 7:30 at Moore Park"): extension point only (REPEAT_LATER, end of 103).

## ov37 — The Weekend Recap (24 Oct 2026)
- Part of the existing `commentary` feature (no new switch). The `commentary` table didn't fit (round-scoped keys), so a small `trip_recaps` table in 107 (105 left unused, per the coordinator).
- The app works out the facts (it already has the results maths); the server cleans them, checks the trip is the group's, uses the trip's real name and checks the script against the trip's players from the database. An organiser could in theory send made-up facts — accepted: organisers can already write anything in the group.
- Commentators are our own: Rex Fairway (play-by-play) and Bev Divot (colour). Film names (and other sports-comedy film names) are blocked by the checker.
- People not on the trip can be mentioned only if the facts name them (e.g. last year's trophy holder from the honour board).
- A number in the script must appear in the facts (stops invented scores). Years are fine if in the facts.
- No AI / AI off / over the cap / script fails twice → the house script from the facts, and the screen says so. There's always a recap.
- Money is never in the facts (side-game winnings left out on purpose, per the tone rules).
- "Add your card": score screen while a round is open; once locked, organisers get Paper cards, players are told to send it to the organiser.
