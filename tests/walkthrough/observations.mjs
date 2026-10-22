// The builder's own observations from looking through the shots (filled in after review).
export const HOW_TO_RUN = `## How it was made

- Branch \`walkthrough\` from \`origin/v10-int\`. Nothing under src/ or supabase/ was changed; the scripts are in tests/walkthrough/.
- Build: \`VITE_SIGN_IN=google,password VITE_NEW_GROUPS=on VITE_SUPABASE_URL=https://walkthrough-fake.supabase.co VITE_SUPABASE_KEY=fake-anon-key npx vite build\`
  (sign-in switched on so the late joiner's path is the product's; a made-up database address so nothing could reach a real one).
- Serve: \`npx vite preview --port 4330 --strictPort\` (the app is at http://localhost:4330/lgc-golf/).
- Capture: \`node tests/walkthrough/run-all.mjs\` (Playwright + Chromium, Sydney time zone, en-AU).
- Every request is answered by tests/walkthrough/fake.mjs from in-memory rows (built on tests/e2e/organise-fixtures.mjs);
  map tiles, fonts, weather and Google get empty answers; realtime websockets go nowhere. So maps show pins on a grey
  background and photos are a drawn stand-in.
- "Today" is Sydney's today. Later stages move the trip's dates (run-up: 9 days out; the day: first round today;
  just after: finished yesterday) rather than faking the clock, so dates in the pictures shift between stages.
- Where a screen's own button couldn't be reached, the script wrote the same change into the fake database and says so
  below under "What the run logged". Other players' votes, deposits and scores are written straight into the fake database.`;

export const OBSERVATIONS = '## Observations\n\n(none yet)';
