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
## ov38 — the Handicap Tribunal clock and posts (24 Oct 2026, Josh agreed the five items)
- Closing time per case = the group's Handicap "Voting closes after" (default 48 h); an organiser can move it per case.
  Existing open cases when 106 runs: 8pm Sydney on the first evening ≥ 18 h away (= Sun 25 Oct 8pm for L.G.C's three
  if run on Sat 24 Oct), not a hard-coded date, so a later run still gives people a fair go.
- At the closing time the case closes itself through finalise_case (majority; a tie → not guilty), the same path as the
  last vote or the chair. Exception: groups where the chair (organiser) decides handicap cases — never auto-closed;
  organisers get one "time's up" buzz.
- One nudge per case, only to people who can vote and haven't: 4 h before (8am–9pm Sydney) or from 6pm the evening
  before for a morning close. Several cases → one buzz per person. Sent through notify_queue and the hourly send, so
  it can land up to an hour after it's due (fine for a 4-hour heads-up).
- The verdict's "colour" comes from the defence without AI: its first clause if short ("The “one-off” defence didn't
  wash."), else its opening words in quotes. No defence → "No defence offered." (guilty) / nothing (not guilty).
- Phone-only accounts still can't lodge (102) — unchanged; tap count noted in REPORT-ov38.md for Josh.
## ov40 — the day plan, golf on each day, fit lines (25 Oct 2026, Josh 25 Oct + his 19:14 / 19:22 / 19:34 notes)
- COLLECT → SHAPE → DECIDE: wishes come in (ov39's plan_wishes per trip idea, and notes on a day), the day plan shapes them (when you'd leave, which course times fit, dusk), the organiser decides (a course and a time per day). Every time is "about" — for talking it through, not a booking.
- Top priority, golf on the right days: every day has golf none / 9 / 18 / 36 (two rounds) and is a travel day or not (st.days[i].golf / .travel, in the trip builder's own state). Default: 18 every day; day 1 a round on the way there, the last day a round on the way home. Trips 1–6 days (0–5 nights) are tested end to end (1, 2, 3, 4-day fly-to-Melbourne, 6-day).
- The Blue Mountains "only one round" cause (live, read-only check): choosing an area pre-filled only the STAY days (prefillStayDays left the way-there and way-home days empty), so a 2-night trip could only ever make one round. Now every day with golf is filled for its role; trips saved before this get their empty travel days filled once when the organiser opens Plan the trip (st.daysFilled).
- Placing courses: day 1 = least out of the way on the drive from the starting points (tee time after leaving home); stay days = nearest where we stay; last day = on the way home, finishing so people are home by their home_by. Flying: every day's courses are near where we stay (no drive "on the way").
- A course twice in a trip: only when there aren't enough courses to go round (e.g. 6 days, 5 courses in range), ranked after every way that doesn't repeat, and the configuration says so (repeats). Before, the same course twice was never a trip.
- How much golf (organiser setting, default = the group's most common plan_wishes.golf_per_day): max (36 on stay days only where two rounds + lunch fit the daylight on that date) | daily (18 a day) | spare_day (the middle stay day off; a 2-day trip: the last day) | any. Setting it rewrites each day's golf; courses on a day are kept.
- Unknown course facts are guessed and shown as unconfirmed, never blank, never as fact: visitor times = the usual for clubs (Sat after 12:30, Sun after 11, Tue–Thu after 11, Mon/Fri from 7), group size "most clubs take groups of 12–20 — unconfirmed", round length "about 4 h 30 a 4-ball (the usual — unconfirmed)". Real info replaces them: our notes (course_social_times) → the club's visitor times (course_booking_info) → course research.
- Social-time text is read as golf talk: a bare 1–6 means pm ("after 2" = 2 pm); day names split it ("Sat after 2, Sun after 11"); "members only" = no visitors.
- Sunrise/sunset: the NOAA formula, no API, in the place's own clock (Australian states and daylight saving by position). Dusk = sunset. "Tight" = finishing under 30 min before.
- Flying: no fare guesses — flight time (typed, about), check-in, bags/car, airport drives; first flights out about 6 am, last back about 9 pm (the last day's latest finish allows for it).
- Fit lines never a black-box score: "suits 7 of 8 · tee 12:30pm suits “morning free” (2) · 4 h 35 before dusk". Names of who it doesn't suit go to the organiser only; everyone else sees counts.
- Per-day wishes: plan_wishes.day_prefs (weekday → early / midday / late / morning_free / any) and home_by (the last day). A note on a day (plan_comments with day_date, migration 109) can carry its own wish (morning_free / early / midday / late / home_by); a person's latest note on that day beats their plan_wishes. early = by 9, midday = 10:30–1:30, late = from 12:30, morning free = from 11:30.
- The organiser's pick per day (st.dayPlan.picks) puts the course on that day's options; it is never written as a real tee time (trip_tee_options stay for times from calls).
- One organiser for now: the day plan uses the same organiser check and route wrapper as Plan the trip; nothing co-organiser-specific was built.
- ov40 review (coordinator, 25 Oct): the day plan opens with a **Suggested plan** — one line a day ("Fri: The Vintage 10am (on the way, done ~2:40pm, 4 h 35 before dusk) · … · home by ~5pm") picked across all days: suits the most wishes, clear of dusk, the day's own courses first, a different course each day unless nothing else fits; days with the fewest choices are filled first. "Use this plan" picks them all (still "about"); "Change <day>" opens that day. Who it doesn't suit: names for the organiser, a count for everyone else.
- Before a pick, a day's travel follows the suggested tee time (leave = tee − drive − 30 min; never before the starting point's own leave time); after a pick, the pick. Flying: the chain is worked back from the tee (first flights about 6am still apply).
- Course cards fold to one line ("The Vintage · 15 min off the way · 10am–2:35pm fit · suits 8 of 8 ★"), tap to open; the best 3 show, "Show N more" for the rest (the laptop table follows the same 3).
## ov39 — Trip ideas you can share (25 Oct 2026, Josh's messages 25 Oct, 19:14–19:41)
- An idea is a plan in the existing engine (kind 'trip', planning; proposed unless an organiser put it out) with
  plans.idea = true. Discussion can stay in WhatsApp / Messenger; the app holds the lists.
- COLLECT → SHAPE → DECIDE (then the existing book / pay steps). The share link lands on a quick summary first (what's
  set, what's open, the group's answers, the picture) with one-tap feedback — not the organising screen.
- "Help plan — 4 quick taps" is one row per person per plan: plan_wishes { plan_id, player_id, cant_dates (Fridays),
  spend_band lt500 | 500_800 | 800_1200 | any, travel drive | fly | either, max_drive_min, golf_per_day max | daily |
  spare_day | any, day_prefs { thu..mon: early | midday | late | morning_free | any }, home_by, wish, updated_at }.
  ov40 reads it. A set weekend is answered with In / Maybe / Can't (plan_rsvps), not cant_dates.
- The definition: whatever the organiser knows, any mix (a weekend or rough words, an area or "within 3 h of Sydney",
  1–6 days, drive / fly, how much golf). Each part is "Set" (people say in / out; other suggestions go to the
  organiser's queue: accept, or decline with a note) or "Open to ideas" (suggestions go straight on the lists).
- One organiser for now: the idea's organiser (whoever proposed it, until "Hand over organising") or a group organiser.
  v10.6's co-organisers aren't used in the idea flow. Plumbing: a player organising an idea gets the trip's
  co-organiser row behind the scenes when it's sent to the vote or handed to them, so the v10.6 builder and votes work
  for them (plans.idea_organiser holds who organises it; 025's guard keeps plans.organiser_id for group organisers).
- Anyone in the group can comment and suggest once it's shared, phone-only accounts too (like comments and votes).
- Fit lines are counts for everyone ("suits 9 of 11"); names (who can't) for the organiser only — plan_wishes rows are
  read by their owner and the organiser; everyone else gets them without names (idea_wish_answers).
- Flights: no fare guesses — flight time, roughly the first and last flights of the day, and a pre-filled Google Flights
  search link. One destination only; several stops "coming soon". The planning chat's "Don't plan flights" rule is
  replaced by the same single-destination rule.
- Two models: AI_FAST_MODEL (same provider / key, light thinking) for the idea chat; AI_MODEL for "✨ Pull it together"
  (the planning chat), planning and course research. Not set: the usual model. Logged per call in helper_log.model.
  Streaming isn't used: the reply is one short tool call (cards need the whole JSON); aim < 10 s by size instead.
- Paste the chat: the organiser pastes text in; the Caddie suggests what to add; each needs the organiser's tap. No
  chat app is read automatically. "✨ Ideas from the comments" does the same with the idea's comments and queue.
- Leftovers (19:41): when a vote is sent (or suggestions declined) the Caddie groups what was dropped into 1–3 named
  parked ideas; the organiser OKs / edits / discards each. A parked idea is its own plan (idea_pool) in 💭 Future trip
  ideas; anyone can add to it. Its main item's suggester has 48 hours first refusal (told at parking and ~6 h before
  the end), then it's open (a Feed post) and anyone can "Claim it" and organise it. The 48 h is a stored claim_until,
  checked exactly when someone claims; the reminder and the "it's open" post come from a job every 15 minutes
  (pg_cron 'lgc-idea-claims'). "Or start another trip idea now" stays as a direct option.
- Tagging people in comments inside organising: named extension point only (IDEA_TAGS_LATER in lib/ideas.js).
- Link previews: a Cloudflare Pages function at /i/<token> (deployed by the existing `wrangler pages deploy`); the build
  writes /preview-db.json (the public database address and publishable key) for it. GitHub Pages can't: there the
  picture + message with the plain link are the fallback.

## ov41 — nights and day positions (25 Oct 2026)
- "How many nights?" is part of the first quick tap (it stays "4 quick taps"). Multi-pick; "4+" is saved as 4 (the
  database takes 1–6, so an organiser's 5-night trip still suits a "4+"). `[]` = not fussed, null = not answered.
- When to play is keyed by the day's place in the trip (first / middle / last), not the weekday. All middle days share
  one answer. A day trip shows one row ("The day"), read as both first and last. Old weekday rows are still read.
- Migration 108 was edited in place rather than adding 110, because 108 isn't live yet (same release).
- The organiser's length is now shown in nights to match ("2 nights", not "3 days"); the stored value didn't change.


## ov42 — the link preview says what's asked and by when (26 Oct 2026, Josh: "nothing about what is requested")
- Three stages, worked out by the database for the preview (idea_preview, 110) and the same way in the app for the
  picture: collecting → "💡 <name>: have your say by Thu 6pm"; a When? / Where? vote open → "🗳️ <name>: vote by Thu";
  locked in (or sent to the vote with nothing left open and a winner) → "✅ It's on: <where>, <dates>". Counts only.
- "Have your say by" is new (plans.idea_answer_by), set on 📣 Share it: 4 days on at 6pm Sydney unless already set;
  the person sharing can change it there. It shows on the idea's summary and in the chat message.
- The vote's closing is a date (plan_polls.closes_on), so it reads "vote by Thu" with no time.
- "n of m": m is the group's approved non-guest players, or the In / Maybe people once there are any; m never shows
  below n.
- The evening-before nudge is built (cheap): one buzz, 24 h before the deadline, to people who haven't answered —
  its own pg_cron job 'lgc-idea-answer-nudge'. Moving the deadline re-arms it.
- The preview page waits at most 1.5 s in total for the database; after that (or any error) the plain preview goes
  out. The plain one is cached 60 s, a real idea's 5 min.
- An answer from before 110 is applied (no stage) reads as collecting with no deadline — the page works either way.
