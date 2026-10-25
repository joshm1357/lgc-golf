# REPORT — ov39: trip ideas you can share (COLLECT → SHAPE → DECIDE), the Caddie as a fast idea-giver

Branch `ov39-trip-ideas` (from `v10-6-release`), pushed. Migration **108** (not applied anywhere). Screenshots:
`shots-ov39/` in the worktree (`/home/claude/wt-ov39/shots-ov39/`, 375 px and 1440 px), not committed (gitignored).

## What I built, item by item
1. **Propose (anyone with a saved account)** — Trips → "✨ Put out a trip idea": a name, roughly when, where, drive / fly
   / either, a note. It's a plan in the engine (kind 'trip', planning, proposed unless an organiser) with `idea = true`.
   Screen `#/idea/<id>` (`src/screens/TripIdea.jsx`, logic in `src/lib/ideas.js`, sheet in `src/components/IdeaSheet.jsx`).
2. **📣 Share it** — (a) Feed post "💡 Josh has a trip idea: March, Hunter Valley. Add your ideas — 4 quick taps." + buzz
   (`idea_shared` in notify); (b) a share card picture (shareCard.js 'idea') with "Picture + link", "Copy link",
   "Share…"; (c) a link preview: a **Cloudflare Pages function** `functions/i/[token].js` (logic + tests in
   `src/lib/ideapreview.js`) serves og:title / description / a 1200×630 picture (uploaded at share time) and hops the
   person into the app. Wrangler's existing `pages deploy dist` picks up `functions/` itself; the build writes
   `/preview-db.json` (public address + publishable key) for it. **GitHub Pages (live today) can't run it** — there the
   app shares the plain link, and the picture + message are the fallback.
3. **Add to it (COLLECT + SHAPE)** — the link lands on a quick summary: what's Set / Open to ideas, the group's answers in
   one line ("9 answered · most can't do 12 Mar · 6 happy to fly · …"), In / Maybe / Can't when the weekend is set,
   "Help plan — 4 quick taps" (plan_wishes, Josh's exact shape incl. day_prefs + home_by), suggest a weekend / area /
   course, comment. "See all the ideas" → the lists: 👍 / 👎, who added what, ✨ Caddie items, fit lines (counts for all,
   names for the organiser). Suggestions outside a "Set" part go to the organiser's queue (accept / decline + note).
4. **Organiser tidies → vote** — 🗳️ Tidy up → tick → `idea_tidy(send)` → the trip builder's state (weekends, areas,
   library courses, fit notes) → the v10.6 builder opens at `?call=auto` and calls the When? / Where? vote(s) with the
   fit lines on each option. **Leftovers** (Josh 19:41 version): the Caddie groups what was dropped into 1–3 named
   parked ideas (no-AI grouping as a fallback), OK / edit / discard each → 💭 Future trip ideas (on Trips). The main
   item's suggester has 48 h first refusal (told at parking and ~6 h before), then it's open (Feed post) and anyone can
   "Claim it". "Or start another trip idea now" (`idea_spin_off`) kept.
5. **The Caddie on an idea (fast)** — ai-helper mode `idea_chat` (`ideas.ts`): one model call, a short reply + up to 3
   cards, group context up front (past trips/where, usual turnout, last budget, home base, the lists, the wishes
   summary), respects what's Set. Flying to ONE place: airports, flight time, roughly first/last flights, a Google
   Flights search link — **no fares** (Josh 19:34). One tap adds a card to the lists (✨). Also "📋 Paste the chat" and
   "✨ Ideas from the comments" (organiser only; each suggestion needs their tap). "✨ Pull it together" (group
   organisers) opens the existing planning chat for that trip with a ready message (strong model). plan.ts's "Don't plan
   flights" rule is replaced by "one flying destination; several stops coming soon".
6. **Two models** — `AI_FAST_MODEL` (same provider/key, OpenRouter `reasoning.effort: 'low'`), used for idea_chat only;
   not set → the usual model. Logged per call in helper_log (mode 'history', area 'ask', job 'idea_chat', model = the
   fast id). **Recommendation:** `AI_FAST_MODEL=google/gemini-2.5-flash` on OpenRouter (fast, cheap, good tool calls);
   `openai/gpt-4.1-mini` as a second choice. Keep `AI_MODEL=moonshotai/kimi-k2.6` for pull-together / research.
   **Not streamed**: the reply is one short tool call whose cards need the whole JSON; speed comes from one call, 700
   max tokens, no tools to wander through and light thinking (the faked e2e shows it; real timing needs the secret).
7. Plain Australian English; phone first, checked at 375 and 1440.
Also: **🤝 Hand over organising** (notifies the new organiser), **one organiser** model (Josh 19:34).

## Migration 108 (additive only)
- `plans`: idea, idea_when, idea_where, idea_travel, share_token, shared_at, card_url, idea_from, idea_sent_at,
  idea_fixed (jsonb, the definition with `set`), idea_pool (parked), idea_organiser, claim_owner, claim_until,
  claim_reminded_at, claim_opened_at, claimed_at. All nullable/defaulted; a guard trigger (`ai_idea_guard`) only lets the
  108 functions change them.
- New tables with RLS like the others: `plan_idea_items`, `plan_idea_reactions`, `plan_wishes`.
- Functions: share_idea, idea_tidy, idea_spin_off, idea_set_fixed, idea_review, hand_over_idea, idea_wish_answers,
  idea_park, idea_claim, idea_preview (anon: by token, name/when/where/by/group/picture/plan id only) + private helpers;
  pg_cron job `lgc-idea-claims` every 15 min (private.idea_claims_tick).
- **No check, policy or function is dropped or re-added. No existing function is changed.**
- SQL test `supabase/tests/108_trip_ideas.sql` + expected (85 checks; run on local Postgres 16 with 001–108, `psql -1`).

## Tests
- vitest: all pass (114 files / 1,853 tests; new `ideas.test.js`, `ideapreview.test.js`, shareCard 'idea').
- Deno ai-helper: 158 pass (9 new in `ideas.test.ts`: fast call, card checks, no fares, paste/comments organiser-only,
  leftover grouping, cap, provider failure, fast-model choice). `deno check` clean for ai-helper and notify index.
- e2e `tests/e2e/trip-ideas-test.mjs`: ALL PASSED (propose, share card + link, two people add dates/areas/courses and
  react, 4 quick taps, queue, Caddie cards with a faked function, tidy → vote, park, spin off, claim).
- v10.6 e2e: votes-coorg, plan-ux, trip-builder, trips pass. **weekends-comps** has 1 failure ("every weekend for the next
  6 months … 5 months, 21 weekends") — date-dependent; it fails identically on a clean `v10-6-release` build.

## What I couldn't do / caveats
- Real link preview only on Cloudflare (branch links, staging, app.thegolftrip.club after release B); not GitHub Pages.
  Not checked against a real WhatsApp fetch — please test on the branch link after 108 is on staging.
- Streaming (see 6). Real speed of the fast model not measured (no secrets set, by brief).
- "✨ Pull it together" is for group organisers only — the planning chat is organisers-only today; a player organising an
  idea can still tidy and send to the vote.
- Tagging in comments: extension point only (`IDEA_TAGS_LATER`).

## Edits to other builders' / shared files (small)
- `src/screens/Trips.jsx` (the new button keeps "💡 Suggest a trip or round" as is; Future trip ideas strip; idea cards
  link to `/idea/`; parked ideas kept out of the stages), `src/lib/trips.js` (an unsent idea stays in "Proposed").
- `src/screens/TripBuilder.jsx` (`?call=` auto-call; fit notes merged into vote option notes).
- `src/components/CaddiePlan.jsx`, `src/components/Caddie.jsx`, `src/lib/chatwanted.js` (open a trip's chat with a message).
- `src/App.jsx` (route `/idea/:planId`), `src/lib/shareCard.js` (+test), `vite.config.js` (preview-db.json).
- `supabase/functions/notify/index.ts` (idea_shared; feature map for idea_parked / organiser_handover),
  `ai-helper/index.ts`, `providers.ts` (fastConfig, `effort`), `plan.ts` (flying rule).
- Not touched: ov40's schedule files / lib/daytiming.js.

## Decisions Josh should know about
- One organiser: `plans.idea_organiser` holds who organises an idea after a hand-over / claim, because 025's guard only
  lets group organisers change `organiser_id`. A player organiser gets the trip's co-organiser row behind the scenes
  when the idea is sent to the vote or handed to them, so the v10.6 builder and votes work for them.
- Anyone in the group (phone-only too) can suggest, comment, react and answer the taps once shared; proposing,
  tidying, parking and claiming need a saved account.
- Parked ideas are their own plans (💭 Future trip ideas); the 48 h is exact at claim time (stored claim_until) and a
  15-minute job sends the reminder and the "up for grabs" post.
- The share picture for the preview goes in the public photos bucket (as all photos do).

## v10.7 review fixes (March test, 25 Oct) — on `v10-7-release`
1. "Weekends you can't do" starts at the idea's month (what's set → rough when → the name, e.g. "March away"), 8
   weekends from the one running into the 1st, "Show more" adds 8; nothing known → the next 3 months (13). Never
   before next week. `weekendsToOffer` / `ideaMonth` in lib/ideas.js (tested).
2. The 4 quick taps are compact: weekends in a 4-across grid, then spend, getting there, how much golf; "More
   (optional)" folds the per-day timings (one row per trip day, smaller chips in one wrapping row), home by and the wish.
3. A weekend row now says what it means, and only once someone's answered: "Al can't do this one" (organiser) /
   "1 can't do it" (others) / "All 3 who've answered can do it". `dateWords` (tested).
4. One "Suggest something" box on the lists page (at the top).
5. The share picture was only the test fake (its storage address isn't served there). The hero now shows the picture
   only once it has loaded — never a broken-image box.
Tests: vitest 1,950 pass; e2e trip-ideas, plan-ux, day-plan all pass. New screenshots in `shots-ov39/` (worktree).
