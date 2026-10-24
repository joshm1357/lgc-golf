# REPORT — ov38: the Handicap Tribunal (posts, closing time, verdict sharing)

Branch `ov38-tribunal` (from `v10-6-release`), pushed. Migration **106_tribunal_clock.sql** — not applied anywhere.

## What I built, per item
1. **Lodged post** — "⚖️ Mike's in the dock: “Hit them far too well!” 30 → 26 if guilty. Guilty or not? Vote by Sun 8pm."
   Charge tidied (wrapping quotes stripped) and trimmed to 90 characters on a word; exhibit photo kept on the post.
2. **Defence post** — "🗣️ Mike's defence: “This was a one-off, I got lucky…”" (140 characters). One post per case,
   updated in place when the defence changes, removed if it's cleared. Done with a trigger; `set_defence` untouched.
3. **Closing time** — new `tribunal_cases.closes_at`. Default = the group's Handicap "Voting closes after"
   (`governance_settings.close_hours`, already there, default 48 h), now shown in Governance → settings for handicap
   cases. Organisers move it per case from the chair's sheet ("Or move the closing time" → `set_case_closing`,
   15 min to 30 days). Case list and case page say "Voting closes Sun 8pm (sooner if everyone votes)".
   **The clock**: pg_cron `lgc-tribunal` every 10 min → `private.tribunal_tick`: closes due cases via `finalise_case`
   (majority; tie → not guilty; the chair can still close early or overrule). **Nudge**, once per case, to people who
   can vote and haven't (not the accused, not guests; the committee if it decides): 4 h before (8am–9pm Sydney) or
   from 6pm the evening before for a morning close. Several cases → one buzz each person:
   "⚖️ Verdicts at 8pm — 2 votes so far on Chris, 3 on Mike. Have your say."
   **Existing open cases**: 8pm Sydney on the first evening at least 18 h after 106 runs — i.e. **Sun 25 Oct 8pm** if
   run on Sat 24 Oct (or before 2am Sun); later runs roll to the next evening rather than closing instantly.
4. **Verdict post** — "⚖️ GUILTY 3–1. Mike goes 30 → 26. The “This was a one-off” defence didn't wash." /
   "⚖️ NOT GUILTY 2–1. Chris walks free and stays on 27." (+ "The “…” defence did the trick." when there is one;
   long defences → their opening words in quotes; no defence on a guilty → "No defence offered."; "(Chair's ruling)").
   Also a `case_verdict` buzz. **Share**: "📤 Share the verdict" (existing verdict card from shareCard.js) on the case
   page AND one tap on the Feed verdict post (not on lodged/defence posts). Before, it was Feed → Case → Share.
5. **Phone-only lodging** — not changed. Taps, for Josh to decide:
   - Saved account, from the Tribunal tab: Raise a case → (Handicap, if other kinds are on) → pick the accused →
     +/− the change → type the case → Lodge = **about 6–8 taps** plus typing.
   - Phone-only: Raise a case opens "Save your spot" first. **Google: +3–4 taps** (Continue with Google, pick the
     account, maybe Allow) — it leaves the app and comes back to the page, so they tap Raise a case again.
     **Email: +4–6 taps** plus typing an email and password (and, on the email-code build, a trip to their inbox for
     the code). After that it's the same flow as a saved account, and every later case needs nothing extra.

## The migration (106) — additive, nothing dropped, no check dropped or re-added
- 4 nullable columns on `tribunal_cases` (`closes_at`, `reminded_at`, `lodged_post_id`, `defence_post_id` → posts,
  on delete set null) + 3 indexes. RLS unchanged (existing table policies, incl. 102's restrictive ones, still apply).
- `lodge_case`: **patched** 029/104-style — live body read, only its Feed-post block swapped for
  `private.tribunal_lodged_post(...)`, fails loudly if the block isn't found, skipped if done. Its 102 saved-account
  line is kept.
- `finalise_case`: **fully replaced** (small; nobody patched it after 030; 102 leaves it ungated on purpose). Same maths.
- New: `set_case_closing` (authenticated; organisers; saved account; same group), private word helpers, trigger
  functions, `tribunal_tick`/`tribunal_job`, cron job `lgc-tribunal` (`*/10 * * * *`).
- Notifications use existing kinds (`case_closing` — "only important" still gets it, `case_verdict`, `case_fallback`)
  via `notify_queue`; the hourly send delivers them per person's choice. **No edge-function change** (so no Deno run).
  There are no "quiet hours" in notify today; the nudge picks daytime/evening itself.
- Re-runs cleanly (checked).

## Tests
- vitest: new `src/lib/tribunalWords.test.js` (5); governance.test.js handicap ruleLine updated; all 1815 pass.
- SQL: `supabase/tests/106_tribunal_clock.sql` + expected (52 checks; local Postgres 16, migrations 001–106; run with
  `psql -1`).
- e2e: new `tests/e2e/tribunal-clock-test.mjs` (12 checks, port 4369) passes; governance, governance-hub, dispute,
  rulebook-v3, stage10 pass. save-spot not run (needs special sign-in builds; gating untouched).

## Edits to other builders' files
- `src/screens/Feed.jsx`: 2 import lines + 1 line under the call-out card (the share button on verdict posts).
- `src/screens/Cases.jsx`: "Voting closes after" select for handicap cases in the settings sheet.
- `src/lib/governance.js`: handicap `ruleLine` wording ("closes after 2 days, or once everyone has voted").

## Decisions Josh should know about
- **Chair-decides groups** (Handicap: "an organiser decides") are never auto-closed — organisers get one "⚖️ Time's up
  on Dan's case — the chair closes it." buzz instead. Say if you'd rather they close themselves too.
- Nudges and verdict buzzes ride the hourly send, so they can land up to ~1 hour after they're due.
- The verdict's "colour" is picked from the defence without AI (first short clause, else the opening words).
- The old posts on L.G.C's three open cases stay as they are ("Case lodged: …"); only new cases get the new lodged
  post. The nudge on Sunday afternoon tells everyone the deadline.
- "Share cards" switch (Tribunal settings) still only governs the newer kinds of case, as before — handicap verdicts
  were always shareable; I kept that.
