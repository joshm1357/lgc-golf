// Round replay browser check, 21 Oct 2026 (ov20 story pacing, voice and speeds: 23 Oct). Fake database only.
// Usage: node replay-test.mjs <base> <shotDir>   e.g. http://localhost:4314/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4314/lgc-golf/';
const SHOTS = process.argv[3] || './shots-replay';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const [A, B, C, D] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001'; // finished (locked)
const R2 = 'dddddddd-0000-4000-8000-000000000002'; // live, half done
const now = '2026-10-21T08:00:00.000Z';
const PARS = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]];
const holes = PARS.map(([par, si], i) => ({ n: i + 1, par, si }));
const t = (i) => new Date(Date.UTC(2026, 9, 21, 8, i * 10)).toISOString();
let sid = 0;
function card(round, subject, diffs, upTo = 18) {
  return diffs.slice(0, upTo).map((d, i) => ({ id: `s${++sid}`, round_id: round, subject_id: subject, subject_type: 'player', hole: i + 1, strokes: PARS[i][0] + d, picked_up: false, updated_at: t(i) }));
}
const zeros = () => Array(18).fill(0);
// Al leads early (birdie 1), blows up on 10; Bo birdies 10 and 11, wins by 2 from Cy. Di bogeys everything.
const a = zeros(); a[0] = -1; a[9] = 3;
const b = zeros(); b[9] = -1; b[10] = -1;

const db = {
  players: [
    { id: A, name: 'Al Blue', nickname: 'Al', handicap: 0, approved: true, created_at: now },
    { id: B, name: 'Bo Red', nickname: 'Bo', handicap: 0, approved: true, created_at: now },
    { id: C, name: 'Cy Green', nickname: 'Cy', handicap: 0, approved: true, created_at: now },
    { id: D, name: 'Di Gold', nickname: 'Di', handicap: 0, approved: true, created_at: now },
  ],
  trips: [{ id: TRIP, name: 'Hunter Weekend', start_date: '2026-10-20', end_date: '2026-10-22', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [],
  round_players: [R1, R2].flatMap((r) => [A, B, C, D].map((p) => ({ round_id: r, player_id: p, playing_handicap: 0 }))),
  scores: [
    ...card(R1, A, a), ...card(R1, B, b), ...card(R1, C, zeros()), ...card(R1, D, Array(18).fill(1)),
    ...card(R2, A, zeros(), 9), ...card(R2, B, zeros(), 9),
  ],
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
  rounds: [
    { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Saturday Stableford', play_date: '2026-10-21', format: 'stableford', status: 'locked', ld_holes: [], ctp_holes: [3], comp_bonus: 0, created_at: now },
    { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Sunday Stableford', play_date: '2026-10-22', format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now },
  ],
  side_entries: [{ id: 'se1', round_id: R1, hole: 3, kind: 'ctp', player_id: C, distance_m: 1.8, confirmed: false, created_at: t(2) }],
  posts: [{ id: 'po1', round_id: R1, kind: 'user', player_id: D, body: 'Lost three balls in the dam', photo_url: null, created_at: t(5) }],
  in_jokes: [{ id: 'j1', text: 'Bo still owes everyone for the cab.', player_id: B, moment: 'win' }],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], rules: [],
  group_features: [{ group_id: GROUP, feature_key: 'in_jokes', enabled: true }, { group_id: GROUP, feature_key: 'commentary', enabled: true }, { group_id: GROUP, feature_key: 'awards', enabled: true }],
};
const eqOf = (params, k) => { const v = params.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
    }
    return true;
  });
}
const jokeCalls = { rpc: 0, table: 0 };
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: false, player_id: A, group_name: 'Hunter Weekend', group_id: GROUP, role: 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'player' }] });
  // 072: the list can't be read any more; the replay asks for a few lines instead.
  if (p.startsWith('/rest/v1/rpc/in_joke_lines')) { jokeCalls.rpc++; return json(db.in_jokes.map((j) => j.text)); }
  if (p.startsWith('/rest/v1/in_jokes')) { jokeCalls.table++; return json({ code: '42501', message: 'permission denied for table in_jokes' }, 403); }
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    if (!(table in db)) return json({ code: '42P01', message: `relation "public.${table}" does not exist` }, 404);
    if (method === 'GET') return json(filterRows(db[table], url.searchParams));
    return json([], 201);
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */ localStorage.setItem('tgt-notify-prompt', String(Date.now()));
  // Record each scene the replay shows, each beat's label, when each step started, and the winner's name.
  window.__scenes = [];
  window.__labels = [];
  window.__steps = [];
  window.__winner = null;
  const look = () => {
    const el = document.querySelector('.rp[data-scene]');
    if (!el) return;
    const s = el.dataset.scene;
    if (window.__scenes[window.__scenes.length - 1] !== s) window.__scenes.push(s);
    const st = Number(el.dataset.step);
    if (window.__steps[window.__steps.length - 1]?.step !== st) window.__steps.push({ step: st, scene: s, t: performance.now() });
    const lb = document.querySelector('[data-testid="replay-beat-label"]');
    if (s === 'race' && lb && window.__labels[window.__labels.length - 1] !== lb.textContent) window.__labels.push(lb.textContent);
    const w = document.querySelector('[data-testid="replay-winner"]');
    if (w) window.__winner = w.textContent;
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-scene', 'data-step'] });
  // A stand-in for the phone's voice: records what it's asked to say; a line only "finishes" when the test says so.
  const said = [];
  const fake = {
    current: null,
    getVoices: () => [{ name: 'Karen', lang: 'en-AU', localService: true }, { name: 'Lee (Enhanced)', lang: 'en-AU', localService: true }],
    speak(u) { said.push({ t: 'speak', text: u.text, voice: u.voice?.name || null, rate: u.rate }); if (u.text.trim()) this.current = u; },
    cancel() { said.push({ t: 'cancel' }); const u = this.current; this.current = null; u?.onerror?.({ error: 'interrupted' }); },
    pause() {}, resume() {}, addEventListener() {}, removeEventListener() {},
  };
  window.__said = said;
  window.__endSpeech = () => { const u = fake.current; fake.current = null; u?.onend?.({}); return !!u; };
  window.__speaking = () => fake.current?.text || null;
  try {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => fake });
    window.SpeechSynthesisUtterance = function Utterance(text) { this.text = text; this.volume = 1; };
  } catch { /* no voice */ }
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
const step = () => page.locator('.rp').getAttribute('data-step').then(Number);
const scene = () => page.locator('.rp').getAttribute('data-scene');

// 1. A live round that's half done: no replay button.
await page.goto(`${BASE}#/?r=${R2}`);
await page.locator('.lb-row').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
check(!(await page.getByText('Watch the replay').isVisible().catch(() => false)), 'live, half-done round: no replay button');

// 2. The finished round: the button shows and opens the replay.
await page.goto(`${BASE}#/?r=${R1}`);
const btn = page.getByRole('link', { name: /Watch the replay/ });
await btn.waitFor({ timeout: 15000 });
check(await btn.isVisible(), 'finished round: "▶ Watch the replay" shows');
const recap = page.getByTestId('round-recap');
check(await recap.isVisible() && await recap.getByText('📝 Round recap').isVisible(), 'finished round: the round recap sits at the bottom');
check(await recap.getByText(/ won .*with|finished level on/).first().isVisible(), 'recap: names the winner and the score');
check(await recap.getByRole('button', { name: '📤 Share the recap' }).isVisible(), 'recap: share button');
await page.screenshot({ path: `${SHOTS}/1-leaderboard-button.png`, fullPage: true });
await btn.click();
await page.waitForURL(new RegExp(`#/replay/${R1}`), { timeout: 10000 });
await page.locator('.rp[data-scene="welcome"]').waitFor({ timeout: 15000 });
check(true, 'the replay opens on the welcome scene');
const welcome = await page.locator('.rp-stage').innerText();
check(/Saturday Stableford/i.test(welcome) && /Cypress Lakes/i.test(welcome) && /21 October 2026/.test(welcome), `welcome shows round, course and date (${welcome.replace(/\s+/g, ' ').slice(0, 90)})`);
check(await page.getByRole('button', { name: /Voice off/ }).isVisible(), 'voice toggle 🔈 shows, and the voice is off to start');
check((await page.locator('.rp').getAttribute('data-voice')) === '0', 'voice off by default');
check((await page.locator('.rp').getAttribute('data-speed')) === 'normal', 'plays at Normal by default');
const speedRow = page.getByRole('group', { name: 'Speed' });
check(await speedRow.getByRole('button', { name: 'Normal' }).getAttribute('aria-pressed') === 'true' && await speedRow.getByRole('button', { name: /Fast/ }).isVisible() && await speedRow.getByRole('button', { name: /Skip to the end/ }).isVisible(), 'speed control: Normal · Fast · Skip to the end');
await page.screenshot({ path: `${SHOTS}/2-welcome.png` });

// 3. Hold to pause: nothing moves while held; it carries on when let go.
const box = await page.locator('.rp-stage').boundingBox();
const before = await step();
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(500);
check((await page.locator('.rp').getAttribute('data-paused')) === '1' && await page.getByText('PAUSED').isVisible(), 'holding shows PAUSED');
await page.waitForTimeout(6000); // longer than the welcome scene
check((await step()) === before, `held for 6 s: still on step ${before}`);
await page.mouse.up();
check((await page.locator('.rp').getAttribute('data-paused')) === '0', 'let go: playing again');
check((await step()) === before, 'letting go after a hold doesn’t skip');
await page.waitForFunction((s) => Number(document.querySelector('.rp').dataset.step) > s, before, { timeout: 10000 }).then(() => check(true, 'carries on by itself after the hold'), () => check(false, 'carries on by itself after the hold'));

// 4. Tap right = next, tap left = back. The pause button stops it moving on its own.
await page.getByRole('button', { name: 'Pause' }).click();
const s0 = await step();
await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
check((await step()) === s0 + 1, 'tap on the right: next');
await page.mouse.click(box.x + box.width * 0.1, box.y + box.height / 2);
check((await step()) === s0, 'tap on the left: back');
await page.waitForTimeout(4000);
check((await step()) === s0, 'paused with the button: stays put');

// Walk through the scenes (paused) for screenshots at 375px.
const shots = {};
for (let i = 0; i < 40; i++) {
  const sc = await scene();
  const label = sc === 'race' ? await page.getByTestId('replay-beat-label').innerText() : '';
  const hole10 = sc === 'race' && /^holes? 10\b/i.test(label);
  const beatType = await page.locator('.rp').getAttribute('data-beat');
  const f = hole10 ? 'race-hole10' : sc === 'race' && beatType === 'stretch' ? 'race-stretch' : sc === 'race' && beatType === 'finish' ? 'race-finish-hole' : sc;
  if (!shots[f] && ['field', 'finish', 'winner', 'awards', 'end', 'race-hole10', 'race-stretch', 'race-finish-hole'].includes(f)) {
    await page.waitForTimeout(sc === 'winner' || sc === 'awards' ? 1600 : 1200);
    shots[f] = true;
    await page.screenshot({ path: `${SHOTS}/3-${f}.png` });
  }
  if (hole10) {
    await page.waitForTimeout(1200); // the board settles, then the word pops
    const txt = await page.locator('.rp-stage').innerText();
    check(/NEW LEADER/.test(txt), 'hole 10: the lead change pops "NEW LEADER"');
    check(/Holes? 10/i.test(txt), `hole 10 is labelled (${label})`);
    const first = await page.locator('.rp-row.lead').getAttribute('data-name');
    check(first === 'Bo', `hole 10: Bo glows as the leader (${first})`);
  }
  if (sc === 'end') break;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
}
check(await page.getByRole('button', { name: /Watch again/ }).isVisible(), 'end card: Watch again');
check(await page.getByRole('button', { name: /Share the replay/ }).isVisible(), 'end card: Share');

// 5. Test mode (?quick=1) plays itself all the way through: every scene, grouped beats, and the right winner.
await page.goto(`${BASE}#/replay/${R2}`); // (somewhere else first, so the next load is fresh)
await page.goto(`${BASE}#/replay/${R1}?quick=1`);
await page.reload();
await page.locator('.rp[data-scene="end"]').waitFor({ timeout: 20000 });
const scenes = await page.evaluate(() => window.__scenes);
const winnerName = await page.evaluate(() => window.__winner);
const labels = await page.evaluate(() => window.__labels);
console.log('   scenes:', scenes.join(' → '));
console.log('   beats:', labels.join(' | '));
for (const s of ['welcome', 'field', 'race', 'finish', 'winner', 'awards', 'end']) check(scenes.includes(s), `auto-advances through "${s}"`);
check(scenes.indexOf('winner') > scenes.lastIndexOf('race') && scenes.indexOf('finish') < scenes.indexOf('winner'), 'in order: race, finish, … winner');
check(winnerName === 'Bo', `the winner scene names Bo (${winnerName})`);
check(scenes[scenes.length - 1] === 'end', 'stops on the end card');
check(labels.length >= 6 && labels.length < 14, `holes grouped into beats: ${labels.length} beats for 18 holes`);
check(labels.some((l) => /^Holes \d+–\d+$/.test(l)), 'a quiet stretch shares one beat ("Holes a–b")');
check(labels.slice(-3).join(',') === 'Hole 16,Hole 17,Hole 18', `the last three holes get a beat each (${labels.slice(-3).join(', ')})`);

// 5b. Normal holds each beat long enough to read; Fast is about twice as quick.
const durations = async () => page.evaluate(() => window.__steps.slice(0, -1).map((s, i) => ({ scene: s.scene, ms: Math.round(window.__steps[i + 1].t - s.t) })));
await page.goto(`${BASE}#/replay/${R2}`);
await page.goto(`${BASE}#/replay/${R1}`);
await page.reload();
await page.waitForFunction(() => window.__steps.length >= 4, null, { timeout: 30000 });
const normal = await durations();
console.log('   normal:', normal.map((d) => `${d.scene} ${d.ms}`).join(', '));
check(normal[1]?.ms >= 3800, `Normal: the field holds ~4 s (${normal[1]?.ms} ms)`);
check(normal[2]?.scene === 'race' && normal[2].ms >= 3800, `Normal: the first beat holds 4 s or more (${normal[2]?.ms} ms)`);
await page.screenshot({ path: `${SHOTS}/4-normal-first-beat.png` });
await page.reload();
await page.locator('.rp[data-scene="welcome"]').waitFor({ timeout: 15000 });
await page.getByRole('group', { name: 'Speed' }).getByRole('button', { name: /Fast/ }).click();
check((await page.locator('.rp').getAttribute('data-speed')) === 'fast', 'Fast is picked');
await page.screenshot({ path: `${SHOTS}/4-fast-picked.png` });
await page.waitForFunction(() => window.__steps.length >= 4, null, { timeout: 30000 });
const fast = await durations();
console.log('   fast:', fast.map((d) => `${d.scene} ${d.ms}`).join(', '));
check(fast[1].ms < normal[1].ms * 0.7 && fast[2].ms < normal[2].ms * 0.7, `Fast is quicker (field ${fast[1].ms} vs ${normal[1].ms} ms, first beat ${fast[2].ms} vs ${normal[2].ms} ms)`);
check(await page.evaluate(() => localStorage.getItem('tgt-replay-speed')) === 'fast', 'the speed is remembered on this phone');
await page.getByRole('group', { name: 'Speed' }).getByRole('button', { name: 'Normal' }).click();

// 5c. Skip to the end goes straight to the result.
await page.reload();
await page.locator('.rp[data-scene="welcome"]').waitFor({ timeout: 15000 });
await page.getByRole('group', { name: 'Speed' }).getByRole('button', { name: /Skip to the end/ }).click();
await page.locator('.rp[data-scene="winner"]').waitFor({ timeout: 3000 }).then(() => check(true, 'Skip to the end: straight to the winner'), () => check(false, 'Skip to the end: straight to the winner'));
check((await page.getByTestId('replay-winner').textContent()) === 'Bo', 'Skip: the result is Bo');
await page.waitForTimeout(1600);
await page.screenshot({ path: `${SHOTS}/5-skip-winner.png` });

// 5d. The voice (a stand-in for the phone's): off by default; when on, the next beat waits for the line to finish,
// a new line never starts over the old one, and pause cuts it cleanly.
await page.goto(`${BASE}#/replay/${R2}`);
await page.goto(`${BASE}#/replay/${R1}?quick=1`);
await page.reload();
await page.locator('.rp[data-scene]').first().waitFor({ timeout: 15000 });
await page.getByRole('button', { name: 'Pause' }).click();
check((await page.evaluate(() => window.__said.filter((x) => x.t === 'speak').length)) === 0, 'voice off by default: nothing is said');
await page.getByRole('button', { name: /Voice off/ }).click();
await page.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForTimeout(300);
const vStep = await step();
const vCap = (await page.locator('.rp-caption').innerText()).trim();
await page.waitForTimeout(1500); // ten steps' worth in test mode
check((await step()) === vStep, `voice on: the step waits for the line to finish (still step ${vStep} after 1.5 s)`);
check((await page.evaluate(() => window.__speaking())) === vCap, 'it is reading the caption on screen');
const lastSpeak = await page.evaluate(() => window.__said.filter((x) => x.t === 'speak' && x.text.trim()).pop());
check(lastSpeak?.voice === 'Lee (Enhanced)' && lastSpeak.rate < 1, `picks the Australian enhanced voice, slightly slower (${lastSpeak?.voice}, rate ${lastSpeak?.rate})`);
await page.evaluate(() => window.__endSpeech());
await page.waitForFunction((s) => Number(document.querySelector('.rp').dataset.step) === s + 1, vStep, { timeout: 3000 }).then(() => check(true, 'line finished: on to the next step'), () => check(false, 'line finished: on to the next step'));
await page.waitForTimeout(400);
const said = await page.evaluate(() => window.__said);
const speaks = said.map((x, i) => ({ ...x, i })).filter((x) => x.t === 'speak' && x.text.trim());
check(speaks.length >= 2 && speaks.every((x) => said[x.i - 1]?.t === 'cancel'), 'every line clears the last one first (never talks over itself)');
check((await step()) === vStep + 1, 'and waits again on the next line');
await page.getByRole('button', { name: 'Pause' }).click();
check((await page.evaluate(() => window.__speaking())) === null && (await page.evaluate(() => window.__said[window.__said.length - 1].t)) === 'cancel', 'pause stops the voice cleanly');
await page.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForTimeout(300);
check((await page.evaluate(() => window.__speaking())) === (await page.locator('.rp-caption').innerText()).trim(), 'play again: the line is read from the top');
await page.screenshot({ path: `${SHOTS}/6-voice-on.png` });
await page.getByRole('button', { name: /Voice on/ }).click();
await page.locator('.rp[data-scene="end"]').waitFor({ timeout: 20000 }).then(() => check(true, 'voice off again: plays through to the end'), () => check(false, 'voice off again: plays through to the end'));

// 6. The in-joke (in_jokes switched on) lands on Bo's win; Larrikins style is remembered for the group.
await page.goto(`${BASE}#/replay/${R1}?fast=1`);
await page.reload();
await page.locator('.rp[data-scene="end"]').waitFor({ timeout: 20000 });
await page.getByRole('group', { name: 'Commentary style' }).getByRole('button', { name: 'Larrikins' }).click();
const saved = await page.evaluate((g) => localStorage.getItem(`tgt-replay-style-${g}`), GROUP);
check(saved === 'larrikins', `Larrikins saved for this group (${saved})`);
// Normal speed, paused, tapped through to the winner.
await page.goto(`${BASE}#/replay/${R1}`);
await page.locator('.rp[data-scene="welcome"]').waitFor({ timeout: 15000 });
await page.getByRole('button', { name: 'Pause' }).click();
// 072: the jokes come as a few lines (any moment, nobody in particular), so the joke can land on any caption up to the win.
const caps = [];
for (let i = 0; i < 40 && (await scene()) !== 'winner'; i++) {
  caps.push(await page.locator('.rp-caption').innerText().catch(() => ''));
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
}
const cap = await page.locator('.rp-caption').innerText();
caps.push(cap);
check(caps.some((c) => /cab/.test(c)), `a caption includes the group's running joke (${caps.find((c) => /cab/.test(c)) || cap})`);
check(jokeCalls.rpc > 0 && jokeCalls.table === 0, `jokes come from in_joke_lines, never the table (rpc ${jokeCalls.rpc}, table ${jokeCalls.table})`);
check(await page.getByRole('button', { name: /Larrikins/ }).first().isVisible(), 'top bar shows the Larrikins style');

// 7. A team round (Ambrose): teams race, the winning team is named.
const R3 = 'dddddddd-0000-4000-8000-000000000003';
db.rounds.push({ id: R3, trip_id: TRIP, course_id: COURSE, name: 'Friday Ambrose', play_date: '2026-10-20', format: 'ambrose', status: 'locked', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now });
db.teams.push({ id: 'tm1', round_id: R3, name: 'The Hackers', handicap: 6, created_at: now }, { id: 'tm2', round_id: R3, name: 'Shank Redemption', handicap: 6, created_at: now });
db.team_players.push({ team_id: 'tm1', player_id: A }, { team_id: 'tm1', player_id: B }, { team_id: 'tm2', player_id: C }, { team_id: 'tm2', player_id: D });
const tm2 = zeros(); tm2[4] = -1; tm2[12] = -1;
db.scores.push(...card(R3, 'tm1', zeros()).map((s) => ({ ...s, subject_type: 'team' })), ...card(R3, 'tm2', tm2).map((s) => ({ ...s, subject_type: 'team' })));
await page.goto(`${BASE}#/replay/${R3}?fast=1`);
await page.reload();
await page.locator('.rp[data-scene="end"]').waitFor({ timeout: 20000 });
const teamScenes = await page.evaluate(() => window.__scenes);
check(teamScenes.includes('winner') && teamScenes.includes('race'), `Ambrose replay plays through (${teamScenes.join(' → ')})`);
const teamWinner = await page.evaluate(() => window.__winner);
check(teamWinner === 'Shank Redemption', `Ambrose: the winning team is named (${teamWinner})`);

// 8. Switched off: no button, and the route says so.
db.group_features.push({ group_id: GROUP, feature_key: 'replay', enabled: false });
await page.goto(`${BASE}#/?r=${R1}`);
await page.reload();
await page.locator('.lb-row').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1000);
check(!(await page.getByText('Watch the replay').isVisible().catch(() => false)), 'replay switched off: no button');
await page.goto(`${BASE}#/replay/${R1}`);
await page.getByText('Round replay is switched off').waitFor({ timeout: 10000 }).then(() => check(true, 'replay switched off: the route says so'), () => check(false, 'replay switched off: the route says so'));

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
