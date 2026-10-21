// Team match play (Ryder Cup) browser check, 21 Oct 2026. Fake database only.
// Usage: node cup-test.mjs <base> <shotDir>   e.g. http://localhost:4301/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4301/lgc-golf/';
const SHOTS = process.argv[3] || './shots-cup';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const ids = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const now = '2026-10-21T08:00:00.000Z';
const holes = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]]
  .map(([par, si], i) => ({ n: i + 1, par, si }));
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now, cup_side: null },
    { id: ids[0], name: 'Al Blue', nickname: null, handicap: 20, approved: true, created_at: now, cup_side: null },
    { id: ids[1], name: 'Bo Red', nickname: null, handicap: 8, approved: true, created_at: now, cup_side: null },
    { id: ids[2], name: 'Cy Red', nickname: null, handicap: 16, approved: true, created_at: now, cup_side: null },
  ],
  trips: [{ id: TRIP, name: '6th Ryder Cup', start_date: '2026-10-22', end_date: '2026-10-24', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], round_players: [], scores: [],
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
  rounds: [
    { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Friday — Cypress Lakes', play_date: '2026-10-23', format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now },
    { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Saturday — The Vintage', play_date: '2026-10-24', format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now },
  ],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  cup_sides: [], cup_matches: [],
  group_features: ['feed', 'cup', 'planner'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let organiser = true;
const rpcs = [];
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
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: organiser, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: organiser ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.split('/').pop();
    const body = JSON.parse(req.postData() || '{}');
    rpcs.push(name);
    if (name === 'team_invite') return json(body.p_side === db.cup_sides[0]?.id ? 'BLUETEAM2345' : 'REDTEAM23456');
    if (name === 'set_cup_hole') {
      const m = db.cup_matches.find((x) => x.id === body.p_match);
      if (body.p_result) m.holes[String(body.p_hole)] = body.p_result; else delete m.holes[String(body.p_hole)];
      m.updated_at = new Date().toISOString();
      return json(m.holes);
    }
    return json(null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || [];
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      for (const b of Array.isArray(body) ? body : [body]) rows.push({ id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), holes: {}, ...b });
      return json([], 201);
    }
    if (method === 'PATCH') {
      const id = eqOf(url.searchParams, 'id');
      const body = JSON.parse(req.postData() || '{}');
      for (const r of rows) if (r.id === id) Object.assign(r, body);
      return json([], 200);
    }
    if (method === 'DELETE') {
      const id = eqOf(url.searchParams, 'id');
      db[table] = rows.filter((r) => r.id !== id);
      return json([], 200);
    }
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
  localStorage.setItem('tgt-whats-new', 'beta-1');
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());

// 1. The Cup tab is there; organiser makes the teams.
await page.goto(`${BASE}#/`);
await page.locator('.tabs a', { hasText: 'Cup' }).waitFor({ timeout: 15000 });
check(true, 'Cup tab shows when the feature is on');
await page.locator('.tabs a', { hasText: 'Cup' }).click();
await page.getByRole('button', { name: /Set up the cup/ }).click();
await page.getByRole('button', { name: 'Make Team Blue and Team Red' }).click();
await page.getByText('Team Blue link').waitFor({ timeout: 10000 });
check(db.cup_sides.length === 2, 'two teams made');
const setupText = await page.locator('.page').innerText();
check(setupText.includes('#/join/BLUETEAM2345'), 'Team Blue has its own link');
check(setupText.includes('#/join/REDTEAM23456'), 'Team Red has its own link');
await page.screenshot({ path: `${SHOTS}/1-setup.png`, fullPage: true });

// 2. Put players on teams.
await page.getByRole('button', { name: /Who’s on which team/ }).click();
const rowOf = (name) => page.locator('.card .row', { hasText: name });
await rowOf('Kurt').getByRole('button', { name: 'Team Blue' }).click();
await page.waitForTimeout(300);
await rowOf('Al Blue').getByRole('button', { name: 'Team Blue' }).click();
await page.waitForTimeout(300);
await rowOf('Bo Red').getByRole('button', { name: 'Team Red' }).click();
await page.waitForTimeout(300);
await rowOf('Cy Red').getByRole('button', { name: 'Team Red' }).click();
await page.waitForTimeout(800);
check(db.players.filter((p) => p.cup_side).length === 4, 'four players on teams');

// 3. Add an Ambrose pairs match: Kurt & Al (12+20)/4 = 8 v Bo & Cy (8+16)/4 = 6.
const add = page.locator('.card', { hasText: 'Add a match' });
await add.getByRole('button', { name: 'Kurt' }).click();
await add.getByRole('button', { name: 'Al Blue' }).click();
await add.getByRole('button', { name: 'Bo Red' }).click();
await add.getByRole('button', { name: 'Cy Red' }).click();
check(await add.locator('input').nth(0).inputValue() === '8' && await add.locator('input').nth(1).inputValue() === '6', 'pair handicaps worked out (8 v 6)');
await add.getByRole('button', { name: 'Add match' }).click();
await page.waitForTimeout(800);
const m = db.cup_matches[0];
check(m && m.format === 'ambrose' && Number(m.points) === 2 && m.a_hcp === 8 && m.b_hcp === 6, 'match saved: Ambrose, 2 points, 8 v 6');
await page.screenshot({ path: `${SHOTS}/2-board.png`, fullPage: true });

// 4. Score it: Blue get 2 shots (SI 1 and 2 = holes 9 and 16).
await page.locator('a[href*="#/cup/"]').first().click();
await page.getByText('Hole 1', { exact: true }).waitFor({ timeout: 10000 });
check(await page.getByText('No shots on this hole').isVisible(), 'hole 1: no shots');
await page.getByRole('button', { name: /^Team Blue — / }).click();
await page.getByText('Hole 2', { exact: true }).waitFor({ timeout: 5000 });
check(m.holes['1'] === 'a', 'hole 1 saved for Blue, moved on to hole 2');
await page.getByRole('button', { name: 'Halved' }).click();
await page.getByText('Hole 3', { exact: true }).waitFor({ timeout: 5000 });
await page.locator('.chips button', { hasText: /^9/ }).click();
check(await page.getByText(/Team Blue .* get a shot here/).isVisible(), 'hole 9 (SI 1): Blue get a shot');
await page.locator('.chips button', { hasText: /^1$/ }).click();
check(await page.getByText('Team Blue 1 UP thru 2').first().isVisible(), 'shows Team Blue 1 UP thru 2');
await page.screenshot({ path: `${SHOTS}/3-match.png`, fullPage: true });

// 5. Win it 3&2 and check the board.
for (const k of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) m.holes[String(k)] = 'h';
m.holes['15'] = 'a'; m.holes['16'] = 'a';
await page.goto(`${BASE}#/cup`);
await page.getByText('Team Blue won 3&2').waitFor({ timeout: 10000 });
check(true, 'board: Team Blue won 3&2');
const board = await page.locator('.page').innerText();
check(/Team Blue\s*2\s/.test(board), 'Team Blue has 2 points');
check(board.includes('to win'), 'shows points needed to win');
await page.screenshot({ path: `${SHOTS}/4-won.png`, fullPage: true });

// 6. A player (not organiser) sees no set-up.
organiser = false;
await page.goto(`${BASE}#/`);
await page.reload();
await page.goto(`${BASE}#/cup`);
await page.getByText('Team Blue won 3&2').waitFor({ timeout: 10000 });
check(!(await page.getByRole('button', { name: /Set up the cup/ }).isVisible().catch(() => false)), 'players don’t see the set-up');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
