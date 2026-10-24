# REPORT — ov37: 📺 The Weekend Recap

Branch `ov37-recap` (from `origin/v10-6-release`), pushed. Migration **107** (renumbered from 105 on the coordinator's
instruction; 105 is unused). Nothing applied to any Supabase project, nothing merged.

## What I built
1. **Facts for a trip** — `src/lib/recap.js` (pure, tested): trophy winner + hand-over line, round winners/podiums, the
   honour board (who held it before, streaks, first win, total wins), Cup verdict, side comps, the moments people
   tagged on the score screen (bomb drive, three-putt, chip-in…), the biggest number on a hole, most birdies, Tribunal
   cases near the trip's dates (charge, defence, verdict — old handicap cases and the newer cases), fines tally,
   award/fine winners, and cards in vs missing per round. Only what's in the data, no money.
2. **The script** — new ai-helper mode `trip_recap` (`supabase/functions/ai-helper/recap.ts`): organiser-only, guests
   refused, needs the `commentary` switch. Counts as one question against the usual caps and is logged in
   `helper_log` (job `trip_recap`, no text). It sends the facts as data, then checks the script (shared
   `supabase/functions/_shared/recap.js` `checkScript`): 8–14 lines, both voices taking turns, short, only people on the
   trip (or named in the facts), no film names, nothing about looks/weight/money/families, no number that isn't in the
   facts. If the script fails, the model gets one more go with the problems listed. Then it falls back to the house script
   (`templateScript`), so there's always a recap. Saved in `trip_recaps`, so it isn't rewritten every time someone
   opens it. Organisers get "Write it again", plus "N new cards since this was written" when more cards come in.
3. **The recap screen** — `/recap/:tripId` (`src/screens/Recap.jsx`). You get there from the results page ("📺 The
   Weekend Recap") and from the Feed post ("▶️ Listen"). It shows the title, the two-voice transcript, the facts it used
   (collapsed), the missing-cards nudge ("6 cards missing from Saturday — add yours and you're in the recap") with a
   button, and 📤 Share (share sheet on a phone, copy on a computer, via `lib/push.js shareText`).
4. **▶️ Play it** — the phone's own voices through Web Speech. It picks two different English voices, preferring
   different accents (en-AU / en-GB / en-US), and always uses a different pitch and speed for each. The current line
   lights up as it's read. There's Pause, Keep going and Stop, and you can tap a line to start from there. A phone with
   no voices shows "Your phone can't read this out — here's the script." For a real recorded voice later there's a
   named slot, `recordedAudio(recap)` in `src/lib/recap.js`, which returns null until a paid text-to-speech service is
   added (none added).
5. **Feed post** — `publish_trip_recap(trip)` posts "📺 The Weekend Recap is out: <title> — ▶️ have a listen", linked
   to the recap. Publishing again after a rewrite updates the same post ("📣 Update the Feed post").
6. It works on phone and laptop (screenshots `shots-ov37/`, including `6-laptop.png`).

## Tests
- vitest: 1826 passing, 16 of them new (`src/lib/recap.test.js`).
- Deno: `recap.test.ts`, 5 tests with a fake model: the happy path, a bad script then a retry, the house-script
  fallback, organiser/switch/trip checks, no AI or over the cap → no model call. All pass.
- e2e: `tests/e2e/recap-test.mjs`, 41 checks, all pass. It covers the results button, the empty state, the facts,
  writing with a faked function, the transcript, play with stubbed speechSynthesis (lines light up, two voices,
  pause/stop, tap a line), share, the nudge and its button, posting to the Feed, the Listen button, the player view,
  stale → write again, a phone with no voices, and commentary switched off.
- Re-run and passing: results-test, presentation-test, commentary-test, stage2-test. `npx vite build` is fine.
- SQL test `supabase/tests/107_trip_recap.sql` + `.expected.txt` (expected answers written by hand; not run, since
  nothing was applied).

## What I couldn't do
- I haven't run the real AI, because no key is set up here. The tone is judged from the prompt plus my own examples
  below. On live without AI, the house script runs (it's what the e2e screenshots show).
- The migration isn't applied anywhere, so the SQL test hasn't been run.

## Migration 107 (`supabase/migrations/107_trip_recap.sql`)
It only adds things. New table `trip_recaps` (RLS: members read, organisers insert/update, same group only, feature
`commentary`), check function `private.recap_lines_ok`, guard trigger `private.trip_recap_guard`, RPC
`public.publish_trip_recap`, and realtime. **No dropped or re-added checks**, and no existing policy is changed.

## Edits to other builders' files (all tiny)
- `src/components/TripResults.jsx`: one "📺 The Weekend Recap" button (when `commentary` is on).
- `src/screens/Feed.jsx`: the link button says "▶️ Listen" for `/recap/` links.
- `src/App.jsx`: one lazy import + one route.
- `supabase/functions/ai-helper/index.ts`: one import + one line routing `trip_recap`.
- I didn't touch any Tribunal files. They're only read, as data.

## Decisions Josh should know about
- The two commentators are **our own characters**: **Rex Fairway** (play-by-play, booming, treats a two-putt like a
  moon landing) and **Bev Divot** (colour, bone-dry). The checker blocks Dodgeball and other sports-comedy film names
  and quotes. Rename them in one place: `VOICES` in `_shared/recap.js`.
- It's part of **Live commentary** (`commentary`), with no new switch. The AI needs the Caddie (`ai_helper`) on;
  otherwise you get the house script, and the screen says so.
- People who weren't on the trip only come up if the facts name them (e.g. "Bo held the BD Trophy last year").
- Money is never mentioned. Side-game winnings are left out on purpose.
- "Add your card": while a round is open the button goes to the score screen. Once it's locked, organisers get Paper
  cards and players are told to send their card to the organiser. If you want late players to add their own card to a
  finished round, that's a separate change.
- The phone (organiser's app) works out the facts and the server checks them. An organiser could in theory feed it
  made-up facts. I accepted that, since organisers can already post anything.

## Example scripts (written by me, following the tone rules; each one passes `checkScript` against its facts)

### Example 1 — full weekend
**Hamish Takes The Coast**

- **Rex:** Good evening and welcome to The Weekend Recap from the South Coast! I’m Rex Fairway and I have been shouting since Friday.
- **Bev:** Bev Divot. Three rounds, one trophy, and a lot of golf balls the ocean now owns.
- **Rex:** The headline, Bev! Hamish wins the BD Trophy on 104 points and prises it off Josh! A first ever BD Trophy!
- **Bev:** Josh has been seen near the trophy cabinet, just looking at it.
- **Rex:** Friday belonged to Tom, 37 points, off a 22! A fairytale!
- **Bev:** The Tribunal read the same fairytale. Guilty. Tom plays off 19 now. His defence was a YouTube video on Thursday night.
- **Rex:** Kurt posted a bomb drive on the 9th! I am told birds changed course!
- **Bev:** Gaz made an 11 on the par-4 7th. Character building. A lot of character.
- **Rex:** And Josh, three-putting the 18th on Sunday! The trophy was already gone and he still wanted to suffer!
- **Bev:** Mo leads the fines with 3. Wrong ball, late to the bus. Consistent, at least.
- **Rex:** But Bev, Saturday! Only 2 of 8 cards in the app! Where are they?
- **Bev:** Add your card and you’re in the next recap. Until then, as far as we’re concerned, you were at the pub.
- **Rex:** For Bev Divot, I’m Rex Fairway. What. A. Weekend.
- **Bev:** It was a weekend, Rex.

### Example 2 — thin data (what the live app has today)
**The Case of the Missing Cards**

- **Rex:** Welcome to The Weekend Recap! Rex Fairway here, and folks, we have breaking news: we have almost no news.
- **Bev:** Bev Divot. Three rounds were played. I’ve seen proof of about one and a half.
- **Rex:** Friday! Mo with 34 points, and on the evidence available, he’s the greatest golfer of his generation!
- **Bev:** He beat two other cards, Rex. It’s a small generation.
- **Rex:** Al posted a bomb drive on the 4th! The only drive on record! Possibly the only drive ever hit!
- **Bev:** Saturday: 2 of 8 cards in. Sunday: none. Either the scorecards blew into the sea or someone’s hiding something.
- **Rex:** Fellas, it’s simple! Add your card and you’re in the next recap!
- **Bev:** And if you don’t, Mo stays the greatest golfer of his generation. Think about that.
- **Rex:** For Bev Divot, I’m Rex Fairway!
- **Bev:** Get your cards in.

### Example 3 — Tribunal-heavy
**Three-Peat in the Hunter**

- **Rex:** Live, well, recently live, from the Hunter! This is The Weekend Recap, I’m Rex Fairway!
- **Bev:** Bev Divot. Two rounds, one result we all saw coming.
- **Rex:** Kurt keeps the BD Trophy on 71 points! Three in a row, Bev! A dynasty!
- **Bev:** At this point the trophy should just stay at his place.
- **Rex:** But the real drama was in court! Mo, charged with taking a breakfast ball on the 1st without asking!
- **Bev:** His defence: everyone gets one on the first, it’s tradition. Case thrown out.
- **Rex:** Tradition, Bev! The strongest legal argument known to golf!
- **Bev:** Expect everyone to claim it on every hole next trip.
- **Rex:** Lou takes closest to the pin on the 16th on Saturday! Stiff!
- **Bev:** Bo leads the fines with 2. Phone on the green. Apparently it was very important.
- **Rex:** For Bev Divot, I’m Rex Fairway, and I need a lie down!
- **Bev:** Same time next trip.
