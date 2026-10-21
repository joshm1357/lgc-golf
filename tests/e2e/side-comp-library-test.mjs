// The side comps library (068) browser check, 21 Oct 2026. Fake database only.
// Usage: node side-comp-library-test.mjs <base> <shotDir>   e.g. http://localhost:4328/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4328/lgc-golf/';
const SHOTS = process.argv[3] || './shots-side-comp-library';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const AL = '22222222-2222-4222-8222-222222222222';
const BO = '33333333-3333-4333-8333-333333333333';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const now = '2026-10-21T08:00:00.000Z';
const holes = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]]
  .map(([par, si], i) => ({ n: i + 1, par, si }));
const sc = (subject, hole, strokes) => ({ id: crypto.randomUUID(), round_id: R1, subject_id: subject, hole, strokes, picked_up: false, updated_at: now });
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now, cup_side: null },
    { id: AL, name: 'Al Blue', nickname: null, handicap: 20, approved: true, created_at: now, cup_side: null },
    { id: BO, name: 'Bo Red', nickname: null, handicap: 8, approved: true, created_at: now, cup_side: null },
  ],
  trips: [{ id: TRIP, name: '6th Ryder Cup', start_date: '2026-10-20', end_date: '2026-10-24', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [],
  round_players: [K, AL, BO].map((id, i) => ({ round_id: R1, player_id: id, playing_handicap: [12, 20, 8][i] })),
  // Kurt: gross birdies on 1 (4 on a par 5) and 3 (2 on a par 3). Al: a birdie on 1. Bo: pars.
  scores: [sc(K, 1, 4), sc(K, 2, 5), sc(K, 3, 2), sc(AL, 1, 4), sc(AL, 2, 6), sc(BO, 1, 5), sc(BO, 2, 4)],
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
  rounds: [
    { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Friday — Cypress Lakes', play_date: '2026-10-23', format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
    { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Saturday — Ambrose', play_date: '2026-10-24', format: 'ambrose', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
  ],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [], round_games: [],
  group_features: ['feed', 'side_comps', 'planner'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let offline = false;
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
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: true, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || [];
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      if (offline && table === 'side_comp_entries') return route.abort('internetdisconnected');
      const body = JSON.parse(req.postData() || '{}');
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        if (b.id && rows.some((r) => r.id === b.id)) continue; // upsert, ignore duplicates
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...(table === 'side_comp_defs' ? { retired: false, settings: {}, preset: null, scoring: null } : {}), ...b };
        rows.push(row);
        made.push(row);
      }
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
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

// 1. Organiser opens the library in Admin and adds three comps with one tap each.
await page.goto(`${BASE}#/admin`);
await page.getByRole('button', { name: 'Your own side comps' }).waitFor({ timeout: 15000 });
await page.getByRole('button', { name: 'Your own side comps' }).click();
await page.getByRole('button', { name: /Add from the list/ }).click();
const sheet = page.getByRole('dialog').or(page.locator('.sheet')).first();
await page.getByLabel('Search side comps').waitFor({ timeout: 5000 });
check(await page.getByText('Dots — tally comps').isVisible(), 'library shows its groups');
await page.screenshot({ path: `${SHOTS}/1-library.png` });
await page.getByRole('button', { name: 'Add Greenie' }).click();
await page.getByRole('button', { name: 'Greenie added' }).waitFor({ timeout: 5000 });
// Search + filter
await page.getByLabel('Search side comps').fill('birdie');
await page.getByRole('group', { name: 'Kind of comp' }).getByRole('button', { name: 'From scores' }).click();
check(!(await page.getByRole('button', { name: 'Add Birdie on a par 3' }).isVisible().catch(() => false)), 'filtering to "From scores" hides the dots');
await page.getByRole('button', { name: 'Add Most birdies' }).click();
await page.getByRole('button', { name: 'Most birdies added' }).waitFor({ timeout: 5000 });
await page.getByRole('group', { name: 'Kind of comp' }).getByRole('button', { name: 'All' }).click();
await page.getByLabel('Search side comps').fill('in 2');
await page.getByRole('button', { name: 'Add Nearest the pin in 2' }).click();
await page.getByRole('button', { name: 'Nearest the pin in 2 added' }).waitFor({ timeout: 5000 });
await page.screenshot({ path: `${SHOTS}/2-added.png` });
void sheet;

const byPreset = (k) => db.side_comp_defs.find((d) => d.preset === k);
const greenie = byPreset('greenie');
const birdies = byPreset('birdies_gross');
const ntp2 = byPreset('ntp_in_2');
check(greenie && greenie.scoring === 'count' && greenie.how === 'highest' && greenie.name === 'Greenie', 'greenie saved as a tally');
check(birdies && birdies.scoring === 'auto' && birdies.settings?.metric === 'birdies' && birdies.settings?.basis === 'gross', 'most birdies saved as worked out from the scores (gross)');
check(ntp2 && ntp2.scoring === null && ntp2.how === 'lowest' && ntp2.unit === 'm', 'nearest the pin in 2 saved as measured (smallest m)');
const r1 = db.rounds.find((r) => r.id === R1);
const r2 = db.rounds.find((r) => r.id === R2);
const holesOf = (r, d) => JSON.stringify(r.own_comps.find((c) => c.comp === d?.id)?.holes);
check(holesOf(r1, greenie) === '[3,5,11,15]', 'greenie on Friday’s par 3s');
check(holesOf(r1, birdies) === '[]', 'most birdies on Friday (whole round)');
check(holesOf(r1, ntp2) === '[2,4,7,8,9,10,12,13,17,18]', 'nearest the pin in 2 on Friday’s par 4s');
check(holesOf(r2, greenie) === '[3,5,11,15]' && !r2.own_comps.some((c) => c.comp === birdies?.id), 'Ambrose Saturday gets the greenie but not most birdies');

// 2. Log two greenies for Kurt — the second with no signal.
await page.goto(`${BASE}#/comps?r=${R1}`);
await page.getByRole('button', { name: '🟢 Greenie' }).waitFor({ timeout: 15000 });
await page.getByRole('button', { name: '🟢 Greenie' }).click();
await page.getByRole('button', { name: '+1 Kurt' }).waitFor({ timeout: 5000 });
await page.getByRole('button', { name: 'Hole 3' }).click();
await page.getByRole('button', { name: '+1 Kurt' }).click();
await page.waitForTimeout(800);
check(db.side_comp_entries.length === 1 && db.side_comp_entries[0].hole === 3 && db.side_comp_entries[0].player_id === K, 'first greenie saved (hole 3)');
offline = true;
await page.getByRole('button', { name: 'Hole 5' }).click();
await page.getByRole('button', { name: '+1 Kurt' }).click();
await page.getByText('· 1 waiting to send').waitFor({ timeout: 5000 });
check(db.side_comp_entries.length === 1, 'no signal: the second greenie waits on the phone');
check(await page.getByLabel('Kurt has 2').isVisible(), 'the tally already shows Kurt on 2');
await page.screenshot({ path: `${SHOTS}/3-tally-offline.png`, fullPage: true });
offline = false;
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(1500);
check(db.side_comp_entries.length === 2 && db.side_comp_entries[1].hole === 5, 'signal back: the second greenie sent itself (hole 5)');
check(!(await page.getByText('· 1 waiting to send').isVisible().catch(() => false)) && await page.getByLabel('Kurt has 2').isVisible(), 'tally still 2, nothing waiting');
check((await page.locator('.page').innerText()).match(/leader/i), 'Kurt leads the greenies');

// 3. Most birdies: live standings, no entry button.
await page.getByRole('button', { name: '🐦 Most birdies' }).click();
await page.getByText('2 birdies').first().waitFor({ timeout: 5000 });
const autoTxt = await page.locator('[data-auto]').innerText();
check(/^1\s/.test(autoTxt.trim()) && autoTxt.indexOf('Kurt') < autoTxt.indexOf('Al Blue') && autoTxt.includes('1 birdie') && autoTxt.includes('0 birdies'), 'standings: Kurt 2, Al 1, Bo 0');
check(!(await page.getByRole('button', { name: /^\+1|Enter|Nominate/ }).isVisible().catch(() => false)), 'no entry button on a comp worked out from the scores');
await page.screenshot({ path: `${SHOTS}/4-auto.png`, fullPage: true });

// 4. Nearest the pin in 2 works like a measured comp.
await page.getByRole('button', { name: '🎯 Nearest the pin in 2' }).click();
await page.getByRole('button', { name: /Enter — hole 2/ }).waitFor({ timeout: 5000 });
check(true, 'nearest the pin in 2 opens on hole 2 with an Enter button');

// 5. Admin list shows how each is won.
await page.goto(`${BASE}#/admin`);
await page.getByRole('button', { name: 'Your own side comps' }).click();
await page.getByText(/Tap \+1 each time\. Most dots wins/).first().waitFor({ timeout: 10000 }).catch(() => {});
check(await page.getByText(/Tap \+1 each time\. Most dots wins/).first().isVisible(), 'admin list says how a dots comp is won');

// 6. Side comps switched off: hidden.
for (const f of db.group_features) if (f.feature_key === 'side_comps') f.enabled = false;
await page.reload();
await page.getByText('Admin').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
check(!(await page.getByRole('button', { name: 'Your own side comps' }).isVisible().catch(() => false)), 'switched off: no side comps in Admin');
await page.goto(`${BASE}#/comps?r=${R1}`);
await page.waitForTimeout(1500);
check(!(await page.getByRole('button', { name: '🟢 Greenie' }).isVisible().catch(() => false)), 'switched off: the comps screen is hidden');
await page.screenshot({ path: `${SHOTS}/5-off.png` });

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
