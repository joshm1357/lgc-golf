// Round replay browser check, 21 Oct 2026. Fake database only.
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
  group_features: [{ group_id: GROUP, feature_key: 'in_jokes', enabled: true }],
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
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: false, player_id: A, group_name: 'Hunter Weekend', group_id: GROUP, role: 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'player' }] });
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
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
  // Record each scene the replay shows, and the winner's name, as it plays.
  window.__scenes = [];
  window.__winner = null;
  const look = () => {
    const el = document.querySelector('.rp[data-scene]');
    if (!el) return;
    const s = el.dataset.scene;
    if (window.__scenes[window.__scenes.length - 1] !== s) window.__scenes.push(s);
    const w = document.querySelector('[data-testid="replay-winner"]');
    if (w) window.__winner = w.textContent;
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-scene', 'data-step'] });
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
await page.screenshot({ path: `${SHOTS}/1-leaderboard-button.png`, fullPage: true });
await btn.click();
await page.waitForURL(new RegExp(`#/replay/${R1}`), { timeout: 10000 });
await page.locator('.rp[data-scene="welcome"]').waitFor({ timeout: 15000 });
check(true, 'the replay opens on the welcome scene');
const welcome = await page.locator('.rp-stage').innerText();
check(/Saturday Stableford/i.test(welcome) && /Cypress Lakes/i.test(welcome) && /21 October 2026/.test(welcome), `welcome shows round, course and date (${welcome.replace(/\s+/g, ' ').slice(0, 90)})`);
check(await page.getByRole('button', { name: /Sound off/ }).isVisible(), 'a visible mute toggle (sound off to start)');
await page.screenshot({ path: `${SHOTS}/2-welcome.png` });

// 3. Hold to pause: nothing moves while held; it carries on when let go.
const box = await page.locator('.rp-stage').boundingBox();
const before = await step();
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(500);
check((await page.locator('.rp').getAttribute('data-paused')) === '1' && await page.getByText('PAUSED').isVisible(), 'holding shows PAUSED');
await page.waitForTimeout(3600); // longer than the welcome scene
check((await step()) === before, `held for 4 s: still on step ${before}`);
await page.mouse.up();
check((await page.locator('.rp').getAttribute('data-paused')) === '0', 'let go: playing again');
check((await step()) === before, 'letting go after a hold doesn’t skip');
await page.waitForFunction((s) => Number(document.querySelector('.rp').dataset.step) > s, before, { timeout: 6000 }).then(() => check(true, 'carries on by itself after the hold'), () => check(false, 'carries on by itself after the hold'));

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
  const hole10 = sc === 'race' && /^hole 10$/i.test(await page.locator('.rp-hole .h').innerText());
  const f = hole10 ? 'race-hole10' : sc;
  if (!shots[f] && ['field', 'finish', 'winner', 'awards', 'end', 'race-hole10'].includes(f)) {
    await page.waitForTimeout(sc === 'winner' || sc === 'awards' ? 1600 : 500);
    shots[f] = true;
    await page.screenshot({ path: `${SHOTS}/3-${f}.png` });
  }
  if (hole10) {
    const txt = await page.locator('.rp-stage').innerText();
    check(/NEW LEADER/.test(txt), 'hole 10: the lead change pops "NEW LEADER"');
    check(/Hole 10/i.test(txt), 'hole 10 is labelled');
    const first = await page.locator('.rp-row.lead').getAttribute('data-name');
    check(first === 'Bo', `hole 10: Bo glows as the leader (${first})`);
  }
  if (sc === 'end') break;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
}
check(await page.getByRole('button', { name: /Watch again/ }).isVisible(), 'end card: Watch again');
check(await page.getByRole('button', { name: /Share the replay/ }).isVisible(), 'end card: Share');

// 5. Fast mode plays itself all the way through: every scene, and the right winner.
await page.goto(`${BASE}#/replay/${R2}`); // (somewhere else first, so the next load is fresh)
await page.goto(`${BASE}#/replay/${R1}?fast=1`);
await page.reload();
await page.locator('.rp[data-scene="end"]').waitFor({ timeout: 20000 });
const scenes = await page.evaluate(() => window.__scenes);
const winnerName = await page.evaluate(() => window.__winner);
console.log('   scenes:', scenes.join(' → '));
for (const s of ['welcome', 'field', 'race', 'finish', 'winner', 'awards', 'end']) check(scenes.includes(s), `auto-advances through "${s}"`);
check(scenes.indexOf('winner') > scenes.lastIndexOf('race') && scenes.indexOf('finish') < scenes.indexOf('winner'), 'in order: race, finish, … winner');
check(winnerName === 'Bo', `the winner scene names Bo (${winnerName})`);
check(scenes[scenes.length - 1] === 'end', 'stops on the end card');

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
for (let i = 0; i < 40 && (await scene()) !== 'winner'; i++) await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
const cap = await page.locator('.rp-caption').innerText();
check(/cab/.test(cap), `winner line includes the group's in-joke (${cap})`);
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
