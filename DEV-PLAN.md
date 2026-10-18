# L.G.C App — Release plan

Kept up to date at the end of every build. The shared copy for comments is a Claude Doc
("L.G.C App — Release plan"); this file is the copy future build sessions read first, after ARCHITECTURE-RULES.md.

## Released

| Version | When | What |
|---|---|---|
| 1.0 | Fri 16 Oct 2026 | Join with PIN, profiles + selfies, live leaderboard with projections, score entry with offline queue, feed, side comps with map, trophies (BD, Putt Buddies, Noodle Cup), honour boards, Handicap Tribunal, courses, admin. |
| 1.1 | Sun 18 Oct (morning) | Live lotto-style team draw, Sunday guide page, minimum 6 drives tracking, CTP/LD worth 2 strokes, confirmed comp winners, gold comp tags on the leaderboard, "New version ready" banner. |
| 1.2 | Sun 18 Oct (afternoon) | Comps show the winner once every group is through; two-tap Tribunal voting; new screens open at the top. |
| 1.3 | Sun 18 Oct (evening) | **Coming up** (any number of future trips and rounds): votes on dates/location/anything, Who's in + lock-in, details, day-by-day plan, bring list, jobs, shared costs with custom splits + who-pays-who + payment details, rooms & cars (live draw), organiser's checklist (suggestions only), anyone can suggest a trip or round. **The Rulebook** (rules, what they apply to, propose → vote → admin decides). **Phone notifications** + daily 9am reminders, Share-to-Messenger nudges, add-to-calendar. **Offline**: the app opens and scoring works with no signal. Bottom bar: Map moved into More; Coming up added. |
| 1.4 | Sun 18 Oct (night) | **GPS distances** to the front/middle/back and today's pin (anyone can drop the pin while the round is live), **shot planner** (tap up to 3 targets — distance from you or the tee to each, then on to the pin), greens filled from OpenStreetMap or tapped in by the admin, course map saved for offline. **Rules drive round set-up** (CTP/LD value and minimum drives come from the Rulebook). **Plan → trip** (admin button). **More offline**: feed posts and comp entries (with photos) queue and send later. **L.G.C connector** for Claude (safe actions: leaderboard, enter scores, confirm comps, post, organise). |

## Next — v1.5 (before the next trip)

1. **Scorecard photo → scores.** Snap a paper card (or a screenshot from 18Birdies etc.), the app reads it, you check and save. Needs a decision: an Anthropic API key for the app (small pay-per-use cost) — or keep doing it through the L.G.C connector in a Claude chat (free, works now).
2. **Pins: clear today's pin.** Admin can remove a wrongly dropped pin (today you can only move it).
3. **Tidy-ups.** One-step save for rooms; move the `pg_net` database add-on; Josh's stray Tribunal vote (change it in the app).

## Later — v2

- AI help for the admin (see options below).
- Weather for the plan's location in the week before.
- Fines and dinner awards voting.
- Player stats: history, scoring vs handicap, best and worst holes.
- "Same as last time" template for a new trip.
- Handicap check against GolfLink (manual — no public connection found).

## Decisions and options

### Connecting other golf apps (checked 18 Oct 2026)

| App | Can our app connect? |
|---|---|
| 18Birdies | No public developer API; scores can't be exported to a file. |
| Golf GameBook | No export and no API (their help centre). |
| Garmin Golf | Garmin paused new sign-ups to its developer program in 2026. |
| Hole19, Arccos | No public developer program found. |
| OpenGolfAPI | Free, open course data and scoring formats — US courses only so far. |
| GolfLink / Golf Australia | Official handicaps; no public connection for apps found. |

Options: **A. Keep our own scoring** (recommended — already does Ambrose/Stableford, comps, offline). **B. Import by photo** of a card or another app's screen (v1.4 item 1 — works with any app). **C. Open course data** for GPS distances where it covers Australian courses.

### AI for the admin

- **A. Now — this Claude chat.** Claude is connected to the app's database (that's how Fred & Paul's card and Adam's CTP were entered). No extra cost. It has full access, so treat it like the admin.
- **B. Next — "Ask Claude" inside the app, admin only.** Photo of a scorecard → scores; "draft the next trip" → votes and jobs; weekend summary for the feed. Needs an Anthropic API key; a small pay-per-use cost.
- **C. Later — an L.G.C connector** that lets any Claude chat do only safe app actions (enter scores, add jobs, post results) instead of full database access.

**Decision (18 Oct): C — build the L.G.C connector.** Built and live in v1.4: Claude Settings → Connectors → Add custom connector → paste the private link (needs a paid Claude plan). Anyone with the link acts as admin; change `mcp_key` in `server_secrets` to cut it off.

## Known limits

- iPhone notifications need the app added to the Home Screen and opened from there (iOS 16.4+).
- Supabase free plan pauses after 7 days without use — restore it before a trip.
- Approval prompts for deleting data from this chat time out as "cancelled".

## How each release is built

Start from ARCHITECTURE-RULES.md and an audit → build on a branch → unit tests → phone-size check in a browser → independent review → fix → merge → live → update this plan and BUILD-STATUS.md.
