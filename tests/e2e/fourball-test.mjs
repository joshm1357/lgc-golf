// 4BBB (four-ball better ball) browser check, 21 Oct 2026. Fake database only.
// Usage: node fourball-test.mjs <base> <shotDir>   e.g. http://localhost:4301/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4301/lgc-golf/';
const SHOTS = process.argv[3] || './shots-fourball';
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
  trophies: [],
  teams: [{ id: 'tp1', round_id: R1, name: 'Kurt & Al', handicap: 0, created_at: now }, { id: 'tp2', round_id: R1, name: 'Bo & Cy', handicap: 0, created_at: now }],
  team_players: [{ team_id: 'tp1', player_id: K }, { team_id: 'tp1', player_id: ids[0] }, { team_id: 'tp2', player_id: ids[1] }, { team_id: 'tp2', player_id: ids[2] }], quick_results: [], honour_board: [], round_pins: [],
  round_players: [],
  scores: [
    { id: 's1', round_id: R1, subject_id: K, subject_type: 'player', hole: 1, strokes: 5, picked_up: false, updated_at: now },
    { id: 's2', round_id: R1, subject_id: K, subject_type: 'player', hole: 2, strokes: 4, picked_up: false, updated_at: now },
    { id: 's3', round_id: R1, subject_id: K, subject_type: 'player', hole: 3, strokes: 4, picked_up: false, updated_at: now },
    { id: 's4', round_id: R1, subject_id: ids[0], subject_type: 'player', hole: 1, strokes: 6, picked_up: false, updated_at: now },
    { id: 's5', round_id: R1, subject_id: ids[0], subject_type: 'player', hole: 2, strokes: null, picked_up: true, updated_at: now },
    { id: 's6', round_id: R1, subject_id: ids[0], subject_type: 'player', hole: 3, strokes: 3, picked_up: false, updated_at: now },
    { id: 's7', round_id: R1, subject_id: ids[1], subject_type: 'player', hole: 1, strokes: 5, picked_up: false, updated_at: now },
    { id: 's8', round_id: R1, subject_id: ids[1], subject_type: 'player', hole: 2, strokes: 5, picked_up: false, updated_at: now },
    { id: 's9', round_id: R1, subject_id: ids[2], subject_type: 'player', hole: 1, strokes: 6, picked_up: false, updated_at: now },
  ],
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
  rounds: [
    { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Friday — Cypress Lakes', play_date: '2026-10-23', format: 'fourball', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now },
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

// 1. The leaderboard: pairs, better-ball points.
await page.goto(`${BASE}#/?r=${R1}`);
await page.locator('.lb-row').first().waitFor({ timeout: 15000 });
const cols = await page.locator('.lb-cols').innerText();
check(/pair/i.test(cols) && /pts/i.test(cols), 'columns: Pair and Pts');
const rowsTxt = (await page.locator('.lb-row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
check(/Kurt & Al .*3 8 \+2/.test(rowsTxt[0]), `Kurt & Al lead: 8 pts thru 3, +2 (${rowsTxt[0]})`);
check(/Bo & Cy .*1 2/.test(rowsTxt[1] || ''), `Bo & Cy: 2 pts thru 1 — hole 2 waits for Cy (${rowsTxt[1]})`);
check((await page.locator('.note').innerText()).includes('4BBB'), 'the note explains 4BBB');
await page.screenshot({ path: `${SHOTS}/1-board.png`, fullPage: true });

// 2. The pair's card: both players and the better ball.
await page.locator('.lb-row', { hasText: 'Kurt & Al' }).click();
const card = (await page.locator('.sc').innerText()).replace(/\s+/g, ' ');
check(/Best/i.test(card), 'card has a Best column');
check(/2 4 9 4·3 P·0 3/.test(card), `hole 2: Kurt 4·3, Al P·0, best 3 (${card.slice(0, 160)})`);
await page.screenshot({ path: `${SHOTS}/2-card.png`, fullPage: true });

// 3. Score entry: each player in each pair, with points.
await page.goto(`${BASE}#/score/${R1}`);
await page.getByRole('button', { name: 'Picked up' }).waitFor({ timeout: 15000 });
const opts = await page.locator('select[aria-label="Player"] option').allInnerTexts();
check(opts.some((o) => o.includes('Kurt (Kurt & Al)')) && opts.some((o) => o.includes('Cy Red (Bo & Cy)')), `score entry lists each player with their pair (${opts.join(' | ')})`);
check((await page.locator('body').innerText()).includes(' pts'), 'Stableford points shown while entering');

// 4. Admin: pairs editor.
await page.goto(`${BASE}#/admin`);
await page.getByText('Pairs (4BBB)').first().waitFor({ timeout: 15000 });
check(await page.getByText('Add a pair').first().isVisible(), 'Admin offers "Add a pair"');
check(!(await page.getByLabel('Team handicap').first().isVisible().catch(() => false)), 'no team handicap box for pairs');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
