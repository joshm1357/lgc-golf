// Tee groups browser check, 21 Oct 2026. Fake database only.
// Usage: node tee-groups-test.mjs <base> <shotDir>   e.g. http://localhost:4313/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4313/lgc-golf/';
const SHOTS = process.argv[3] || './shots-tee-groups';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const now = '2026-10-21T08:00:00.000Z';
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const names = ['Kurt', 'Al', 'Bo', 'Cy', 'Di', 'Ed', 'Fin', 'Gus', 'Hal', 'Ian'];
const hcps = [12, 20, 8, 16, 4, 28, 10, 22, 14, 6];
const pid = (i) => `${String(i + 1).padStart(8, '0')}-1111-4111-8111-111111111111`;
const K = pid(0);
const players = names.map((n, i) => ({ id: pid(i), name: `${n} Test`, nickname: n, handicap: hcps[i], approved: true, created_at: now, cup_side: null }));
const db = {
  players,
  trips: [{ id: TRIP, name: 'Hunter Weekend', start_date: '2026-10-21', end_date: '2026-10-22', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], scores: [],
  round_players: [R1, R2].flatMap((r) => players.map((p) => ({ round_id: r, player_id: p.id, playing_handicap: p.handicap }))),
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
  rounds: [
    { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Friday Stableford', play_date: '2026-10-21', format: 'stableford', status: 'locked', ld_holes: [], ctp_holes: [], own_comps: [], comp_bonus: 0, created_at: now },
    { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Saturday Stableford', play_date: '2026-10-22', format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], own_comps: [], comp_bonus: 0, created_at: now },
  ],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [], tee_groups: [],
  group_features: ['feed', 'tee_groups'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
const organiser = true;
const match = (r, k, v) => {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('gt.')) return Number(r[k]) > Number(v.slice(3));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(r[k]));
  return true;
};
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (!match(r, k, v)) return false;
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
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: organiser, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const conflict = url.searchParams.get('on_conflict');
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const keys = conflict ? conflict.split(',') : null;
        const old = keys && rows.find((r) => keys.every((k) => String(r[k]) === String(b[k])));
        if (old) { Object.assign(old, b); made.push(old); continue; }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b };
        rows.push(row);
        made.push(row);
      }
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
    }
    if (method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      for (const r of filterRows(rows, url.searchParams)) Object.assign(r, body);
      return json([], 200);
    }
    if (method === 'DELETE') {
      const gone = new Set(filterRows(rows, url.searchParams));
      db[table] = rows.filter((r) => !gone.has(r));
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
  // Share: no share sheet in the test browser, so it copies — keep what was copied.
  try { delete navigator.share; } catch { /* ignore */ }
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true });
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());

const nameById = Object.fromEntries(players.map((p) => [p.id, p.nickname]));
const pairsOf = (rows) => {
  const out = new Set();
  for (const r of rows) for (let i = 0; i < r.player_ids.length; i++) for (let j = i + 1; j < r.player_ids.length; j++) out.add([r.player_ids[i], r.player_ids[j]].sort().join('|'));
  return out;
};
const draftGroups = async (card) => {
  const groups = card.locator('[data-testid="tee-draft-group"]');
  const n = await groups.count();
  const out = [];
  for (let i = 0; i < n; i++) out.push((await groups.nth(i).locator('button.chip').allInnerTexts()).map((t) => t.split(' ')[0].trim()));
  return out;
};

// 1. Admin: round 1 (Friday) — make tee groups for 10 players.
await page.goto(`${BASE}#/admin`);
await page.getByText('Tee groups').first().waitFor({ timeout: 15000 });
const cards = page.locator('[data-testid="tee-card"]');
check(await cards.count() === 2, 'each round in Admin has a Tee groups card');
const c1 = cards.nth(0);
await c1.locator('summary').first().click();
await c1.getByRole('button', { name: 'Make tee groups' }).click();
await c1.locator('[data-testid="tee-draft-group"]').first().waitFor({ timeout: 5000 });
let g1 = await draftGroups(c1);
check(g1.length === 3 && g1.map((g) => g.length).sort().join(',') === '3,3,4', `10 players → groups of 4, 3, 3 (${g1.map((g) => g.join(' ')).join(' / ')})`);
check(new Set(g1.flat()).size === 10, 'everyone is in exactly one group');
const explain1 = await c1.locator('[data-testid="tee-explain"]').innerText();
check(explain1.includes('No repeat partners') && explain1.includes('Handicaps mixed'), `explained simply: "${explain1}"`);
// Shuffle again changes the seed (and usually the groups) — then swap two players by tapping them.
await c1.getByRole('button', { name: /Shuffle again/ }).click();
await page.waitForTimeout(600);
g1 = await draftGroups(c1);
const a = g1[0][0];
const b = g1[1][0];
await c1.locator('[data-testid="tee-draft-group"]').nth(0).locator('button.chip').first().click();
await c1.locator('[data-testid="tee-draft-group"]').nth(1).locator('button.chip').first().click();
const g1s = await draftGroups(c1);
check(g1s[0].includes(b) && g1s[1].includes(a) && !g1s[0].includes(a), `tapping ${a} then ${b} swaps them`);
await page.screenshot({ path: `${SHOTS}/1-admin-draft.png`, fullPage: true });
await c1.getByRole('button', { name: 'Save tee groups' }).click();
await page.waitForTimeout(1200);
const r1rows = db.tee_groups.filter((r) => r.round_id === R1).sort((x, y) => x.group_no - y.group_no);
check(r1rows.length === 3 && r1rows.map((r) => r.group_no).join(',') === '1,2,3', 'saved: three rows numbered 1, 2, 3');
check(r1rows.map((r) => r.tee_time).join(',') === '08:00,08:08,08:16' && r1rows.every((r) => r.start_hole == null), `tee times 8:00, 8:08, 8:16 (${r1rows.map((r) => r.tee_time).join(',')})`);
check(r1rows.every((r) => r.player_ids.length >= 3) && new Set(r1rows.flatMap((r) => r.player_ids)).size === 10, 'saved groups: no group of 1 or 2, all ten players');
check(r1rows[0].player_ids.map((id) => nameById[id]).includes(b) && r1rows[1].player_ids.map((id) => nameById[id]).includes(a), 'the swap was saved');
await c1.locator('[data-testid="tee-saved"]').waitFor({ timeout: 5000 });
check((await c1.locator('summary').first().innerText()).includes('3 saved'), 'card says 3 saved');

// 2. Round 2 (Saturday): day two avoids day-one partners where possible (10 players in 4/3/3 → at most 1 repeat pair).
const c2 = cards.nth(1);
await c2.locator('summary').first().click();
await c2.getByRole('button', { name: 'Make tee groups' }).click();
await c2.locator('[data-testid="tee-draft-group"]').first().waitFor({ timeout: 5000 });
// Shotgun start for this one.
await c2.getByRole('button', { name: 'Shotgun start' }).click();
await c2.getByLabel('First tee time').fill('12:30');
const explain2 = await c2.locator('[data-testid="tee-explain"]').innerText();
await page.screenshot({ path: `${SHOTS}/2-admin-day2.png`, fullPage: true });
await c2.getByRole('button', { name: 'Save tee groups' }).click();
await page.waitForTimeout(1200);
const r2rows = db.tee_groups.filter((r) => r.round_id === R2).sort((x, y) => x.group_no - y.group_no);
const before = pairsOf(r1rows);
const repeats = [...pairsOf(r2rows)].filter((k) => before.has(k));
check(r2rows.length === 3 && r2rows.every((r) => r.player_ids.length >= 3), 'day two: three groups, none under 3');
check(repeats.length <= 1, `day two avoids day-one partners (${repeats.length} repeat pair — the fewest possible; screen says "${explain2}")`);
check(r2rows.every((r) => r.tee_time === '12:30') && r2rows.map((r) => r.start_hole).join(',') === '1,2,3', 'shotgun: all at 12:30 off holes 1, 2, 3');

// 3. Leaderboard (Saturday is live): "Your group" near the top, and all groups.
await page.goto(`${BASE}#/?r=${R2}`);
await page.locator('[data-testid="tee-mine"]').waitFor({ timeout: 15000 });
const mine = await page.locator('[data-testid="tee-mine"]').innerText();
const myRow = r2rows.find((r) => r.player_ids.includes(K));
const mates = myRow.player_ids.filter((id) => id !== K).map((id) => nameById[id]);
check(mine.startsWith('Your group:') && mine.includes(`12:30pm shotgun, hole ${myRow.start_hole}, with`) && mates.every((m) => mine.includes(m)), `"${mine}"`);
await page.getByText('All tee groups (3)').click();
await page.locator('[data-testid="tee-saved"]').waitFor({ timeout: 5000 });
await page.getByRole('button', { name: 'Share the list' }).click();
await page.waitForTimeout(400);
const copied = await page.evaluate(() => window.__copied || '');
check(copied.startsWith('⛳ Saturday Stableford — tee groups') && copied.includes('Shotgun start 12:30pm') && copied.includes('Hole 1:'), `share copies a tidy list:\n${copied}`);
await page.screenshot({ path: `${SHOTS}/3-leaderboard.png`, fullPage: false });

// 4. Friday is finished: no "Your group" there.
await page.goto(`${BASE}#/?r=${R1}`);
await page.waitForTimeout(1500);
check(!(await page.locator('[data-testid="tee-mine"]').count()), 'a finished round shows no "Your group"');

// 5. Feature off: hidden everywhere.
db.group_features.find((f) => f.feature_key === 'tee_groups').enabled = false;
await page.goto(`${BASE}#/?r=${R2}`);
await page.reload();
await page.locator('.lb-row, .empty').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1000);
check(!(await page.locator('[data-testid="tee-mine"]').count()) && !(await page.getByText('All tee groups').count()), 'feature off: nothing on the leaderboard');
await page.goto(`${BASE}#/admin`);
await page.getByText('Rounds & teams').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
check(!(await page.locator('[data-testid="tee-card"]').count()), 'feature off: no Tee groups card in Admin');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
