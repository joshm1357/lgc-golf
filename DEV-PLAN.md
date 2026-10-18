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

## Next — v1.5: finish and fix up (built 18 Oct, waiting for Josh's OK to go live)

Nothing here changes how L.G.C plays. Branch `v1.5`; tested on the staging database `lgc-golf-staging`.

| Item | Status |
|---|---|
| **Clear today's pin** — admin can remove a wrongly dropped pin | Built + tested |
| **Rooms & cars: one-step save** — name, size, note and who's in it, one Save | Built + tested |
| **Scorecard photo** — keep using the L.G.C connector in a Claude chat (free). In-app reading becomes an optional feature in v2 (switched off by default, needs an Anthropic API key). | No code |
| Josh's stray Tribunal vote — Josh changes it in the app | No code |
| **Faster first load** — leaderboard starts with 492 kB instead of 856 kB (145 kB vs 249 kB over the wire); map, planner, admin, draw, Tribunal and other screens load when opened; the phone still saves every part for offline | Built + tested |
| **Database tidy-up** (019) — 42 indexes, faster access rules, function permissions | On staging |
| **Merge overlapping access rules** (020) | Written; needs Josh to approve the DROP in the chat |
| **Move pg_net** (021) and re-save the 9am reminder job | Written; needs Josh to approve the DROP in the chat |

## v2.0 onwards — The Golf Trip (the product build)

The L.G.C app becomes **The Golf Trip**: one app and one database for many golf groups. Each group sees only its own
data, name, crest, rulebook, history and features. L.G.C is group number one and keeps everything it has.
Full brief: `the-golf-trip-full-build-prompt.md` (in the Claude project). Every stage is built and tested on staging first.

**Phase 1 — Foundations (release v2.0)**
1. **Groups** — `groups` and `group_members` tables, `group_id` on every table (filled in automatically so old phones
   keep working), access rules per group, notifications/reminders/connector/photos/phone storage per group,
   isolation tests (no group can see or change another's data), old-version test.
1b. ✅ on staging — **Trips** (decided 18 Oct — spec in `docs/TRIPS-SPEC.md`) — one Trip from idea → votes on dates and place with
   discussion → locked in → on the trip → done (the record). The Trips tab replaces Coming up: now/next, ideas and
   voting, past trips. Admin picks vote winners (group setting can let the trip's organiser too). Rules, players,
   handicaps, Tribunal, courses and trophies stay group-wide. Plus **notification choices** per person: straight away,
   daily digest at a chosen time, or only important; iPhone Home Screen guide.
2. ✅ on staging, sign-in providers not yet on (STOP) — **Proper login, roles and invites** — Apple, Google and emailed link; guests stay anonymous and can upgrade
   without losing scores; organiser / player / guest; invite link + QR code; group switcher. STOP before switching
   any sign-in provider on.
3. ✅ on staging — **Feature switches** — `src/lib/features.js`, `group_features` table, `feature_on()` checked by the database
   (not just hidden), Group settings → Features screen, L.G.C has everything on except scorecard photo and booking links.

**Phase 2 — Make it theirs (release v2.1 with Phase 3)**
4. ✅ on staging, reviewed, in `product` — Branding from the database (name, crest, colours, font; trophy names were
already per group). 5. ✅ on staging, reviewed, in `product` — Rulebook per group with starter rulebooks.
6. ✅ on staging, reviewed, in `product` — History import: past winners and handicaps, by hand or pasted from a list; honour board
and Trophy Room mix history and app-made winners by year; past trips show their winners.

**Phase 3 — Open the doors**
7. ✅ on staging, reviewed, in `product` — Start-a-group wizard (under 10 minutes). 8. ✅ on staging, reviewed, in `product` — Shared course library (OpenStreetMap credit). 9. Launch basics:
move to Vercel with `<slug>.thegolftrip.club` (STOP — Josh buys the domain), Supabase Pro (STOP — Josh switches it on),
DRAFT privacy policy and terms, delete-my-data, error alerts (ask first), share cards, basic usage numbers.

**Target user** (club-partners addendum, 18 Oct)
- **The organiser:** the bloke in a group of 6–16 mates who books the trip, runs the group chat and chases the money.
  Roughly 25–50, social golfer, often not a club member, phone-first, Messenger or WhatsApp.
- **Design rules:** no app store and no sign-up before the first tee. One-handed on a cart in sunlight. Sharing to the
  group chat comes first. Every screen a first-time guest sees makes sense with no explanation.

**Added by the club-partners addendum** (order agreed: Stage 8 shared courses → 7b → 8b, because the quick round needs
the public course page and shared courses)
- **Stage 3 addition:** feature switch "Clubhouse TV leaderboard" (new group default off; the group also opts in per round).
- **7b. Quick round** (✅ on staging, review next — stroke play waits for its STOP): public course page `/c/<course>` (no sign-in) with "Start a round with your mates"; a quick
  group ("Josh's round at <course>") with a one-day trip and one round, guest sign-in only — under 2 minutes from scan
  to first score; invite via the phone's share sheet, mates join with just a name as guests; format picker
  (Stableford, Ambrose, **stroke play** — new format: STOP for the check-constraint change), closest-to-pin pre-filled
  from par 3s, longest drive from a par 5; after the last hole: results card (share sheet), winner on the honour board,
  "Same time next year?" (a Trips idea with a dates vote), "Make it official" (the Stage 7 wizard, pre-filled); guests
  keep history by signing in later; every card and invite carries "Start your own group" with its source tracked.
  Quick groups get their own new-group limit.
- **8b. Club partners:** every Australian course listed (seeded from OpenStreetMap with credit — STOP before seeding
  live); "Claim your course" (Josh approves each claim by hand — STOP before the first real one; club accounts need
  real sign-in, so the Stage 2 STOP comes first); club role edits verified hole data, logo, booking contact, offers,
  photos; QR kit PDF (cart, par 3 signs, counter, TV; each code carries club ref and placement — STOP before any kit is
  printed or sent, and codes only ever carry the final thegolftrip.club address); attribution (first scan's club and
  placement; per club: scans, rounds, groups, returns, trips — counts only, never names); Clubhouse TV mode (opted-in
  groups, first names only, no photos); "Partner course" label that never hides unclaimed courses; privacy: clubs see
  nothing about players unless a group opts in to TV (goes in the Stage 9 privacy draft).
- **Stage 9 additions:** scan funnel in the usage numbers (by club and placement); stay cards (placement `stay`) issued
  by Josh from the admin screen. Share cards are built once in 7b and reused.
- **Stage 10 addition:** "Ask about a group booking" on claimed course pages and in trip place votes (form → email to
  the club, logged against its code). No money changes hands yet; any future payment goes to the club itself, never to
  staff, and is disclosed.

**Phase 4 — Earn later (release v2.2)**
10. Planner per group + booking links (switched off, one redirect so referral codes can be added later).
11. `group_plan` field (`free` for everyone) and the tier check in `feature_on`; list of possible premium features. No payments.

### Ideas that could be premium later (no payments built)
- Multi-trip seasons and season-long ladders.
- In-app scorecard photo reading (needs an Anthropic API key — a pay-per-use cost).
- Extra crest/branding options.

## Later — ideas not yet in a stage

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
- Approval prompts for deleting data from this chat time out as "cancelled". Database changes that DROP something
  (e.g. 020, 021) need Josh in the chat to approve them, on staging as well as live.
- The build session's computer can't reach Supabase directly, so the in-browser phone checks run against a
  stand-in database; the database rules themselves are checked with SQL tests on staging.

## How each release is built

Start from ARCHITECTURE-RULES.md and an audit → build on a branch → apply database changes to **staging**
(`lgc-golf-staging`) → unit tests + SQL access checks (`supabase/tests/`) → phone-size check in a browser →
independent review → fix → STOP for Josh's OK → database changes on live → merge → live → update this plan and BUILD-STATUS.md.
