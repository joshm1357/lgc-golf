// ov37 — 📺 The Weekend Recap. Fake database and a faked ai-helper (it writes the house script from the facts the app
// sends, as the real one does with no AI) — nothing touches Supabase. The phone's voices are stubbed.
// Usage: node recap-test.mjs <base> <shotDir>   e.g. http://localhost:4367/lgc-golf/ ./shots-ov37
// The finished trip's results → the recap (empty) → the organiser writes it → the two-voice transcript → ▶️ Play it
// (lines light up in turn, two different voices, Pause / Stop) → 📤 Share → the missing-cards nudge → post it in the
// Feed ("▶️ Listen") → a player sees it but can't write it → new cards → "write it again" → a phone with no voices.
import { start, baseDb, P, GROUP, COURSE, sydney, now, scoreRows } from './ov28-fixtures.mjs';
import crypto from 'node:crypto';
import { templateScript, checkScript } from '../../supabase/functions/_shared/recap.js';

const BASE = process.argv[2] || 'http://localhost:4367/lgc-golf/';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000370';
const OLD = 'aaaaaaaa-0000-4000-8000-000000000371';
const FRI = 'dddddddd-0000-4000-8000-000000000371';
const SAT = 'dddddddd-0000-4000-8000-000000000372';
const SUN = 'dddddddd-0000-4000-8000-000000000373';

const db = baseDb(['feed', 'trophies', 'dinner_awards', 'awards', 'commentary']);
db.trip_recaps = [];
db.cases = []; db.case_posts = [];
db.trips.push(
  { id: TRIP, name: 'L.G.C South Coast Trip 2026', start_date: sydney(-8), end_date: sydney(-6), status: 'active', created_at: now },
  { id: OLD, name: 'Coast 2025', start_date: '2025-10-17', end_date: '2025-10-19', status: 'active', created_at: now },
);
const round = (id, name, d) => ({ id, trip_id: TRIP, course_id: COURSE, name, play_date: sydney(d), format: 'stableford', status: 'locked', ld_holes: [7], ctp_holes: [], comp_bonus: 0, created_at: now });
db.rounds.push(round(FRI, 'Friday', -8), round(SAT, 'Saturday', -7), round(SUN, 'Sunday', -6));
const par = [5, 4, 3, 4, 3, 5, 4, 4, 4, 4, 3, 4, 4, 5, 3, 5, 4, 4];
for (const pid of [P.mo, P.bo, P.kurt]) db.round_players.push({ round_id: FRI, player_id: pid, playing_handicap: 0 });
for (const pid of [P.mo, P.bo, P.kurt, P.al, P.cy, P.di, P.lou, P.ed]) db.round_players.push({ round_id: SAT, player_id: pid, playing_handicap: 0 });
for (const pid of [P.mo, P.bo, P.kurt]) db.round_players.push({ round_id: SUN, player_id: pid, playing_handicap: 0 });
db.scores = [
  ...scoreRows(FRI, { [P.mo]: par.map((p, i) => (i < 3 ? p - 1 : p)), [P.bo]: par, [P.kurt]: par.map((p, i) => (i === 6 ? p + 5 : p)) }),
  ...scoreRows(SAT, { [P.mo]: par, [P.kurt]: par.map((p, i) => (i < 2 ? p - 1 : p)) }),
  ...scoreRows(SUN, { [P.mo]: par.map((p, i) => (i === 0 ? p - 1 : p)), [P.bo]: par, [P.kurt]: par }),
];
db.trophies.push({ id: 'tr-bd', trip_id: TRIP, name: 'BD Trophy', type: 'stableford_total', created_at: now });
db.comps.push({ id: 'comp-bd', group_id: GROUP, trip_id: TRIP, name: 'BD Trophy', kind: 'individual_points', round_ids: [], settings: {}, trophy_id: 'tr-bd', sort: 0, retired: false, created_at: now });
db.honour_board.push({ id: 'hb-old', group_id: GROUP, trophy_name: 'BD Trophy', label: '2025', winner_names: 'Bo', player_ids: [P.bo], sort_key: 10, trip_id: OLD, created_at: now });
db.posts.push(
  { id: 'post-bomb', group_id: GROUP, trip_id: TRIP, round_id: SAT, kind: 'user', player_id: P.kurt, hole: 7, body: 'Bomb drive on 7', created_at: now },
  { id: 'post-3putt', group_id: GROUP, trip_id: TRIP, round_id: FRI, kind: 'user', player_id: P.mo, hole: 18, body: 'Three-putt on 18', created_at: now },
);
db.tribunal_cases.push({ id: 'tc1', group_id: GROUP, accused_id: P.kurt, lodged_by: P.mo, proposed_change: -2, case_text: '40 points off a 12 on Saturday', defence: 'The wind was behind me all day', status: 'closed', verdict: 'upheld', new_handicap: 10, created_at: `${sydney(-7)}T09:00:00Z` });

const t = await start('ov37', { db, organiser: true, me: P.kurt });
const { page, ctx, check, shot, noSideScroll, state, done } = t;

// The ai-helper, faked: the house script from the facts the app sent, saved like the real one.
const helperCalls = [];
await page.route('**/functions/v1/ai-helper', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  helperCalls.push(body);
  const s = templateScript(body.facts);
  const was = db.trip_recaps.find((r) => r.trip_id === body.trip_id);
  const row = { id: was?.id || crypto.randomUUID(), group_id: GROUP, trip_id: body.trip_id, title: s.title, lines: s.lines, facts: body.facts, cards: body.facts.cards, written_by: 'template',
    version: was ? was.version + 1 : 1, post_id: was?.post_id || null, published_at: was?.published_at || null, created_at: was?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
  db.trip_recaps = [row];
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ recap: row, written_by: 'template', note: 'Written from the facts — the Caddie (AI) isn’t switched on, so the jokes are the house ones.' }) });
});
await page.route('**/rest/v1/rpc/publish_trip_recap', async (route) => {
  const r = db.trip_recaps[0];
  const post = { id: crypto.randomUUID(), group_id: GROUP, trip_id: TRIP, kind: 'auto', body: `📺 The Weekend Recap is out: ${r.title} — ▶️ have a listen`, link: `/recap/${TRIP}`, player_id: P.kurt, created_at: new Date().toISOString() };
  db.posts.push(post);
  r.post_id = post.id;
  r.published_at = new Date(Date.now() + 1000).toISOString();
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(post.id) });
});
// The phone's voices (two English ones), and the share sheet.
await ctx.addInitScript(() => {
  if (localStorage.getItem('test-no-voice') === '1') {
    try { Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true }); } catch { /* fine */ }
  } else {
    window.__spoken = [];
    const synth = {
      speak(u) { window.__spoken.push({ text: u.text, voice: u.voice?.name, pitch: u.pitch }); u.__t = setTimeout(() => u.onend?.(), 350); window.__current = u; },
      cancel() { if (window.__current) clearTimeout(window.__current.__t); },
      getVoices() { return [{ name: 'Karen', lang: 'en-AU', localService: true }, { name: 'Daniel', lang: 'en-GB', localService: true }]; },
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: function U(text) { this.text = text; }, configurable: true });
  }
  window.__shared = [];
  Object.defineProperty(navigator, 'share', { value: async (d) => { window.__shared.push(d); }, configurable: true });
});

// 1. The finished trip's results have the way in.
await page.goto(`${BASE}#/trip-now/${TRIP}`);
await page.getByTestId('trip-results').waitFor({ timeout: 15000 });
const link = page.getByTestId('results-recap');
check(await link.isVisible(), 'results page: 📺 The Weekend Recap button');
await link.click();
await page.getByTestId('recap-page').waitFor({ timeout: 15000 });
await page.getByTestId('recap-empty').waitFor({ timeout: 10000 });
check(/Rex Fairway & Bev Divot/.test(await page.getByTestId('recap-empty').innerText()), 'empty: our own commentary team, ready to go');
const nudge = page.getByTestId('recap-missing');
await nudge.waitFor({ timeout: 10000 });
const nudgeText = await nudge.innerText();
check(/6 cards missing from Saturday — add yours and you’re in the recap/.test(nudgeText), `missing-cards nudge: “${nudgeText.split('\n')[0]}”`);
check(/Saturday: 2 of 8 in/.test(nudgeText), 'nudge says 2 of 8 in on Saturday');
check(await page.getByTestId('recap-add-card').getAttribute('href') === `#/round/${SAT}/cards`, 'finished round: organiser’s button goes to Saturday’s paper cards');
await page.getByTestId('recap-facts').click();
const factsText = await page.getByTestId('recap-facts').innerText();
check(/Kurt posted a bomb drive on the 7th \(Saturday\)/.test(factsText), 'facts: the bomb drive post');
check(/Mo posted a three-putt on the 18th/.test(factsText), 'facts: the three-putt post');
check(/Tribunal: Handicap case: Kurt, -2 — Kurt in the dock.*The defence: “The wind was behind me all day”.*Verdict: guilty, handicap now 10/.test(factsText), 'facts: the Tribunal case with charge, defence and verdict');
check(/Bo held the BD Trophy \(2025\) before this trip/.test(factsText), 'facts: history from the honour board');
check(/Biggest number: Kurt made 9 on the par-4 7th \(Friday\)/.test(factsText), 'facts: the biggest number on a hole');
await shot('1-empty-organiser');

// 2. The organiser writes it.
await page.getByTestId('recap-write').click();
await page.getByTestId('recap-transcript').waitFor({ timeout: 10000 });
const sent = helperCalls[0];
check(sent?.mode === 'trip_recap' && sent.trip_id === TRIP && sent.group_id === GROUP, 'ai-helper called: trip_recap for this trip and group');
check(sent?.facts?.cards === 8 && sent.facts.missing?.[0]?.round === 'Saturday', `facts sent: ${sent?.facts?.cards} cards in, Saturday short`);
check(!JSON.stringify(sent?.facts || {}).match(/\$\d/), 'no money in the facts');
const lines = await page.getByTestId('recap-line').allInnerTexts();
check(lines.length >= 8 && lines.length <= 14, `transcript: ${lines.length} lines`);
check(/^Rex/.test(lines[0]) && /^Bev/.test(lines[1]), 'two voices taking turns (Rex, then Bev)');
const titleText = await page.getByTestId('recap-title').innerText();
check(/South Coast/.test(titleText), `title: ${titleText}`);
const r0 = db.trip_recaps[0];
const r0check = checkScript(r0, { tripNames: ['Mo', 'Bo', 'Kurt', 'Al', 'Cy', 'Di', 'Lou', 'Ed'], otherNames: ['Mike', 'Fin'], facts: r0.facts });
check(r0check.ok, `the saved script passes the checks ${r0check.problems.join(' ')}`);
check(/house script/.test(await page.getByTestId('recap-organiser').innerText()), 'says how it was written (house script, no AI)');
await shot('2-written');
await noSideScroll('recap');

// 3. ▶️ Play it: lines light up in turn, two voices, Pause / Stop.
await page.getByTestId('recap-play').click();
await page.waitForTimeout(200);
check(await page.getByTestId('recap-line').nth(0).getAttribute('aria-current') === 'true', 'playing: line 1 lit up');
await page.waitForFunction(() => window.__spoken.length >= 2, null, { timeout: 5000 });
check(await page.getByTestId('recap-line').nth(1).getAttribute('aria-current') === 'true', 'then line 2');
const spoken = await page.evaluate(() => window.__spoken);
check(spoken[0].voice === 'Karen' && spoken[1].voice === 'Daniel', `two different voices: ${spoken[0].voice} / ${spoken[1].voice}`);
check(spoken[0].pitch < 1 && spoken[1].pitch > 1, 'and different pitch');
check(spoken[0].text === r0.lines[0].text, 'reads the script word for word');
await shot('3-playing');
await page.getByTestId('recap-pause').click();
const atPause = (await page.evaluate(() => window.__spoken.length));
await page.waitForTimeout(900);
check((await page.evaluate(() => window.__spoken.length)) === atPause, 'paused: nothing more is read');
check(/Keep going/.test(await page.getByTestId('recap-play').innerText()), 'Pause → “Keep going”');
await page.getByTestId('recap-stop').click();
check(await page.locator('[data-testid="recap-line"][aria-current="true"]').count() === 0, 'Stop: nothing lit up');
// Tap a line to start there.
await page.getByTestId('recap-line').nth(3).locator('button').click();
await page.waitForTimeout(150);
check(await page.getByTestId('recap-line').nth(3).getAttribute('aria-current') === 'true', 'tap a line: plays from there');
await page.getByTestId('recap-stop').click();

// 4. 📤 Share to the group chat (the share sheet on a phone).
await page.getByTestId('recap-share').click();
await page.waitForTimeout(300);
const shared = await page.evaluate(() => window.__shared[0]);
check(!!shared && shared.text.startsWith(`📺 ${r0.title}`) && /Rex: /.test(shared.text) && /Bev: /.test(shared.text) && new RegExp(`▶️ Have a listen: .*#/recap/${TRIP}`).test(shared.text), `share: title, both voices and the link (${JSON.stringify(shared?.text?.slice(-120))})`);

// 5. Post it in the Feed.
await page.getByTestId('recap-publish').click();
await page.getByTestId('recap-posted').waitFor({ timeout: 10000 });
check(db.posts.some((p) => p.link === `/recap/${TRIP}` && /📺 The Weekend Recap is out: .* — ▶️ have a listen/.test(p.body)), 'Feed post made');
await page.goto(`${BASE}#/feed`);
const fp = page.locator('article.post', { hasText: 'The Weekend Recap is out' }).first();
await fp.waitFor({ timeout: 15000 });
check(await fp.getByRole('link', { name: '▶️ Listen' }).count() === 1, 'Feed post has “▶️ Listen”');
await shot('4-feed');
await fp.getByRole('link', { name: '▶️ Listen' }).click();
await page.getByTestId('recap-transcript').waitFor({ timeout: 10000 });
check(true, 'Listen opens the recap');

// 6. A player sees it, can play it, but can't write it.
state.organiser = false;
state.me = P.mo;
await page.reload();
await page.getByTestId('recap-transcript').waitFor({ timeout: 15000 });
check(await page.getByTestId('recap-write').count() === 0 && await page.getByTestId('recap-publish').count() === 0, 'player: no Write / Post buttons');
check(/send your card to the organiser/.test(await page.getByTestId('recap-add-card').innerText()), 'player: finished round → send your card to the organiser');
await shot('5-player');

// 7. New cards come in → the organiser is told to write it again; writing again bumps the version.
state.organiser = true;
state.me = P.kurt;
db.scores.push(...scoreRows(SAT, { [P.al]: par }));
await page.reload();
await page.getByTestId('recap-stale').waitFor({ timeout: 15000 });
check(/1 new card since this was written/.test(await page.getByTestId('recap-stale').innerText()), 'out of date: 1 new card');
check(/5 cards missing from Saturday/.test(await page.getByTestId('recap-missing').innerText()), 'nudge now: 5 missing');
await page.getByTestId('recap-write').click();
await page.waitForFunction(() => !document.querySelector('[data-testid="recap-stale"]'), null, { timeout: 10000 });
check(db.trip_recaps[0].version === 2 && helperCalls.length === 2 && helperCalls[1].facts.cards === 9, 'written again with 9 cards (version 2)');
check(await page.getByTestId('recap-publish').count() === 1 && /Update the Feed post/.test(await page.getByTestId('recap-publish').innerText()), 'rewritten after posting → “Update the Feed post”');

// 8. Laptop width.
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(300);
await shot('6-laptop');
await page.setViewportSize({ width: 375, height: 812 });

// 9. A phone with no voices: the script, and a plain message.
await page.evaluate(() => localStorage.setItem('test-no-voice', '1'));
await page.reload();
await page.getByTestId('recap-transcript').waitFor({ timeout: 15000 });
await page.getByTestId('recap-play').click();
check(/Your phone can’t read this out — here’s the script/.test(await page.getByTestId('recap-novoice').innerText()), 'no voices: says so, script still there');
await shot('7-no-voice');
await page.evaluate(() => localStorage.removeItem('test-no-voice'));

// 10. Commentary switched off: no button on the results page.
db.group_features = db.group_features.filter((f) => f.feature_key !== 'commentary');
db.group_features.push({ group_id: GROUP, feature_key: 'commentary', enabled: false });
await page.goto(`${BASE}#/trip-now/${TRIP}`);
await page.reload();
await page.getByTestId('trip-results').waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
check(await page.getByTestId('results-recap').count() === 0, 'commentary off: no recap button');

await done();
