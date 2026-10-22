// Guided setup ('Set up your trip') browser check, 21 Oct 2026. Fake database only.
// Usage: node setup-guide-test.mjs <base> <shotDir>   e.g. http://localhost:4301/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4301/lgc-golf/';
const SHOTS = process.argv[3] || './shots-setup';
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
  trips: [],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], round_players: [], scores: [],
  courses: [],
  rounds: [],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
  group_features: ['feed', 'side_comps', 'planner'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
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
    if (name === 'find_courses') return json([{ id: 'lib-cypress', name: 'Cypress Lakes Golf & Country Club', area: 'Pokolbin NSW', holes: 18, greens: 0, copies: 2 }]);
    if (name === 'library_course') return json({ id: 'lib-cypress', name: 'Cypress Lakes Golf & Country Club', holes });
    if (name === 'copy_library_course') { db.courses.push({ id: COURSE, name: 'Cypress Lakes Golf & Country Club', library_id: 'lib-cypress', holes, created_at: now }); return json(COURSE); }
    if (name === 'group_invite') return json('PLAYERLINK23');
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
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), holes: {}, ...(table === 'rounds' ? { status: 'setup', ctp_holes: [], ld_holes: [], own_comps: [] } : {}), ...b };
        rows.push(row);
        made.push(row);
      }
      // .select().single() asks for the row back as one object.
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
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */ localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());

// 1. An organiser with an empty group (just Kurt) sees the guided setup on the leaderboard.
db.players = db.players.slice(0, 1);
await page.goto(`${BASE}#/`);
await page.getByText('Set up your trip').first().waitFor({ timeout: 15000 });
check(true, 'empty leaderboard offers "Set up your trip"');
await page.getByText('Set up your trip').first().click();
await page.getByText('0 of 4 done').waitFor({ timeout: 10000 });
check(true, 'guide opens at 0 of 4 done');
await page.screenshot({ path: `${SHOTS}/1-start.png`, fullPage: true });

// 2. The trip.
await page.getByLabel('Trip name').fill('6th Ryder Cup');
await page.getByLabel('First day').fill('2026-10-22');
await page.getByLabel('Last day').fill('2026-10-24');
await page.getByRole('button', { name: 'Make the trip' }).click();
await page.getByText('1 of 4 done').waitFor({ timeout: 10000 });
check(db.trips.length === 1 && db.trips[0].end_date === '2026-10-24', 'trip made with dates');

// 3. A course from the library (the courses step opens by itself).
await page.getByLabel('Search courses').fill('cypress');
await page.getByText('Cypress Lakes Golf & Country Club').first().click();
await page.getByRole('button', { name: 'Add to our courses' }).click();
await page.getByText('2 of 4 done').waitFor({ timeout: 10000 });
check(db.courses.length === 1, 'course added from the library');
await page.getByRole('button', { name: 'Next: the rounds →' }).click();

// 4. Rounds: Thursday, Friday, Saturday listed; add Friday as Ambrose.
const page3 = await page.locator('.page').innerText();
check(page3.includes('Thursday 22 Oct') && page3.includes('Friday 23 Oct') && page3.includes('Saturday 24 Oct'), 'each day of the trip is listed');
const fri = page.locator('.card.pad', { hasText: 'Friday 23 Oct' });
await fri.getByLabel('Format').selectOption('ambrose');
check(await fri.getByText('“Friday — Cypress Lakes”').isVisible(), 'round name suggested: Friday — Cypress Lakes');
await fri.getByRole('button', { name: 'Add round' }).click();
await page.getByText('3 of 4 done').waitFor({ timeout: 10000 });
const r = db.rounds[0];
check(r && r.play_date === '2026-10-23' && r.format === 'ambrose' && r.name === 'Friday — Cypress Lakes', 'Friday Ambrose round saved');
await page.screenshot({ path: `${SHOTS}/2-rounds.png`, fullPage: true });

// 5. Players: the join link is there; with only Kurt in, it isn't done.
await page.getByRole('button', { name: /Players/ }).click();
await page.getByText('#/join/PLAYERLINK23').first().waitFor({ timeout: 10000 });
check(true, 'players step shows the join link');
db.players.push({ id: ids[0], name: 'Al Blue', handicap: 20, approved: true, created_at: now });
await page.reload();
await page.getByText('4 of 4 done').waitFor({ timeout: 10000 });
check(true, 'two players in: 4 of 4 done');

// 6. Next up: Friday has no teams yet, so it says to pick who's playing (not "Start").
check(await page.getByText('Friday — Cypress Lakes: pick who’s playing').isVisible(), 'next up: Friday needs its teams first');
check(!(await page.getByRole('button', { name: 'Start Friday — Cypress Lakes' }).isVisible().catch(() => false)), 'no Start button for a round with nobody in it');
// Teams made, but Friday isn't today: "start it on the day".
db.teams.push({ id: 'tm1', round_id: db.rounds[0].id, name: 'Team 1', handicap: 8, created_at: now });
db.team_players.push({ team_id: 'tm1', player_id: K }, { team_id: 'tm1', player_id: ids[0] });
await page.reload();
await page.getByText(/All set\. Next up: Friday — Cypress Lakes on Friday 23 Oct — start it on the day/).waitFor({ timeout: 10000 });
check(true, 'next up: all set, start it on the day');
// On the day: Start appears.
const d = new Date();
db.rounds[0].play_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
await page.reload();
await page.getByRole('button', { name: 'Start Friday — Cypress Lakes' }).waitFor({ timeout: 10000 });
check(true, 'on the day: next up offers Start');
await page.getByRole('button', { name: /^5 Extras|Extras/ }).first().click();
await page.getByRole('button', { name: /Use the par 3s/ }).click();
await page.getByRole('button', { name: 'Save holes' }).click();
await page.waitForTimeout(800);
check(JSON.stringify(db.rounds[0].ctp_holes) === JSON.stringify([3, 5, 11, 15]), 'closest to pin set to the par 3s (3, 5, 11, 15)');
await page.screenshot({ path: `${SHOTS}/3-extras.png`, fullPage: true });
await page.getByRole('button', { name: 'Start Friday — Cypress Lakes' }).click();
await page.waitForTimeout(800);
check(db.rounds[0].status === 'live', 'round started from the guide');

// 7. A player doesn't get the guide.
organiser = false;
await page.goto(`${BASE}#/setup`);
await page.reload();
await page.getByText('Only the organiser sets the trip up.').waitFor({ timeout: 10000 });
check(true, 'players are kept out of the guide');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
