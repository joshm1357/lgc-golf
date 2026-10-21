# C — The AI setup helper inside the app (plan for Josh to decide)

21 Oct 2026. This follows A (the guided setup, "Set up your trip"). It changes the 20 Oct rule ("no AI agent inside the app"). Josh chose "A then C" on 21 Oct.

## What it is

There's a "Set it up for me" box at the top of *Set up your trip*. The organiser types or says something plain, for example:

> "Hunter Valley, Thu 22 to Sat 24 Oct. Kurri Thursday, Cypress Lakes Friday, The Vintage Saturday. Stableford all three, closest to pin on the par 3s. About 12 of us."

The helper works out the five steps (trip, courses, rounds, players, extras) and shows a **confirm card** before anything is saved:

> I'll set up: trip "Hunter Valley 2026" 22–24 Oct · 3 courses from the library · 3 Stableford rounds · closest to pin on 3, 7, 12, 16 at Kurri… · join link ready to share. **[Do it] [Change something]**

Nothing is saved until the organiser taps **Do it**. After that, everything shows up in the normal guided setup, ticked off, and can be changed by hand.

## How it would work (safe by design)

- **A new edge function, `setup-helper`**, called by the app with the organiser's own sign-in. Every write goes through the same database rules as tapping buttons (RLS), so the helper can never do more than the organiser could.
- **It calls Claude through the Anthropic API.** The key is a Supabase secret that Josh pastes himself. It's never in code or the app.
- **A short, fixed list of tools,** the same actions as the guided setup:
  - `find_course`, `add_course`
  - `make_trip`
  - `add_round`
  - `set_side_comp_holes`, `add_own_comp`
  - `get_join_link`
  - for a Cup: `make_teams`, `add_match`

  There's no delete, no "run any SQL" and no messaging people. This reuses the pattern of the existing Claude connector (`lgc-mcp`).
- **Two steps:** the helper *plans* (read-only tools plus a proposal), then the app shows the confirm card, then the *do it* call runs the writes.
- **What it sees:** the group's trip, course and round names, and the course library. It doesn't see player phone numbers, emails or chat.
- **A log:** each request and its result goes in a `helper_log` table (group, who, when, tokens used, what it did) for cost and debugging.

## Decisions for Josh

1. **API key.** Create an Anthropic API key in the Claude Console and paste it into Supabase → Edge Functions → Secrets as `ANTHROPIC_API_KEY`. (I can't create accounts or keys.)
2. **Model.** *Recommended:* Haiku 5.5 for planning. It's fast, about a cent a setup, and this job is simple. Alternative: Sonnet 5.5, which is smarter with messy requests and roughly 3–5× the cost.
3. **Cost cap.** *Recommended:* 20 helper requests per group per month, plus a hard monthly spend limit set in the Console (e.g. US$10) as a backstop.
4. **Who gets it.** *Recommended:* free for organisers during the beta, then part of premium. It goes in the feature list as `setup_helper` (off by default; switched on per group).
5. **Voice.** Phase 1 is typing only. The phone keyboard's microphone already does speech-to-text for free.

## Build order once decided

1. Migration 053: `helper_log`, feature `setup_helper`, monthly-count check.
2. Edge function `setup-helper`: plan and do; tool list; prompt; tests against staging.
3. App: the "Set it up for me" box plus the confirm card in *Set up your trip*.
4. Review by an independent agent (security: prompt injection from course names, the cost cap, RLS), then staging, then live.

Estimate: one focused session after the key is in.
