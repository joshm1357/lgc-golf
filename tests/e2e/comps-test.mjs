// Comps — "what you're playing for" (migration 067) browser check, 21 Oct 2026. Fake database only.
// Usage: node comps-test.mjs <base> <shotDir>   e.g. http://localhost:4327/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4327/lgc-golf/';
const SHOTS = process.argv[3] || './shots-comps';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const pid = (n) => `2222222${n}-2222-4222-8222-222222222222`;
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const FRI = 'dddddddd-0000-4000-8000-000000000001';
const SAT = 'dddddddd-0000-4000-8000-000000000002';
const SUN = 'dddddddd-0000-4000-8000-000000000003';
const now = '2026-10-21T08:00:00.000Z';
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const names = ['Al', 'Bo', 'Cy', 'Di', 'Ed', 'Fi', 'Gus'];
const round = (id, name, format, play_date) => ({ id, trip_id: TRIP, course_id: COURSE, name, format, play_date, status: 'setup', ctp_holes: [], ld_holes: [], own_comps: [], created_at: now, group_id: GROUP });
const score = (round_id, subject_id, hole, strokes) => ({ round_id, subject_id, hole, strokes, picked_up: false, updated_at: now, group_id: GROUP });
const db = {
  players: [{ id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now, cup_side: null },
    ...names.map((n, i) => ({ id: pid(i + 1), name: `${n} Smith`, nickname: n, handicap: 10 + i, approved: true, created_at: now, cup_side: null }))],
  trips: [{ id: TRIP, name: 'Hunter 2026', start_date: '2026-10-23', end_date: '2026-10-25', status: 'active', created_at: now, group_id: GROUP }],
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now, group_id: GROUP }],
  rounds: [round(FRI, 'Friday — Cypress Lakes', 'stableford', '2026-10-23'), round(SAT, 'Saturday — Cypress Lakes', 'stableford', '2026-10-24'), round(SUN, 'Sunday — Cypress Lakes', 'ambrose', '2026-10-25')],
  round_players: [{ round_id: FRI, player_id: K, playing_handicap: 12 }, { round_id: FRI, player_id: pid(1), playing_handicap: 10 }, { round_id: FRI, player_id: pid(2), playing_handicap: 11 }],
  // Friday: Kurt par, par (3 + 3 points off 12); Al bogey, bogey (2 + 2); Bo par, bogey (3 + 2).
  scores: [score(FRI, K, 1, 4), score(FRI, K, 2, 4), score(FRI, pid(1), 1, 5), score(FRI, pid(1), 2, 5), score(FRI, pid(2), 1, 4), score(FRI, pid(2), 2, 5)],
  // An L.G.C-style trophy from before comps: awarded, a winner on the honour board, and no comp yet.
  trophies: [{ id: 'eeeeeeee-0000-4000-8000-000000000001', trip_id: TRIP, name: 'Noodle Cup', type: 'manual', created_at: now, group_id: GROUP }],
  honour_board: [{ id: 'h1', trophy_name: 'Noodle Cup', label: '2025', winner_names: 'Kurt Dahl', player_ids: [K], sort_key: 10, created_at: now, group_id: GROUP }],
  teams: [], team_players: [], quick_results: [], round_pins: [],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [], comps: [], round_games: [],
  group_features: ['feed', 'side_comps', 'planner', 'trophies'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let organiser = true;
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
    if (name === 'group_invite') return json('PLAYERLINK23');
    if (name === 'team_invite') return json('BLUETEAM2345');
    return json(null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b };
        rows.push(row);
        made.push(row);
        // The server switches the hidden Cup feature on when a Cup comp is added (migration 067).
        if (table === 'comps' && row.kind === 'cup') db.group_features.push({ group_id: GROUP, feature_key: 'cup', enabled: true });
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
const text = () => page.locator('.page').first().innerText();

// 1. The guided setup has the new step, between Rounds and Players.
await page.goto(`${BASE}#/setup`);
const stepBtn = page.getByRole('button', { name: /What are you playing for\?/ });
await stepBtn.waitFor({ timeout: 15000 });
const order = await page.locator('.page .card > button strong').allInnerTexts();
const iR = order.findIndex((t) => t.startsWith('Rounds'));
const iC = order.findIndex((t) => t.startsWith('What are you playing for'));
const iP = order.findIndex((t) => t.startsWith('Players'));
check(iR >= 0 && iR < iC && iC < iP, `step sits between Rounds and Players (${order.join(' / ')})`);
await stepBtn.click();
check((await text()).includes('Noodle Cup') && (await text()).includes('Engrave the winner when it’s decided'), 'the old Noodle Cup trophy is listed as a comp (engrave this trip’s winner)');
await page.getByRole('button', { name: '+ Add another' }).click();
await page.getByText('Over the weekend').first().waitFor();
await page.screenshot({ path: `${SHOTS}/1-picker.png`, fullPage: true });
check((await text()).includes('e.g. the 6th Ryder Cup'), 'cards show plain words and an example');

// 2. Points over Friday + Saturday, with a trophy.
await page.getByRole('button', { name: /Over the weekend/ }).click();
const chips = page.getByRole('group', { name: 'Rounds that count' });
const ct = await chips.innerText();
check(ct.includes('Friday · Stableford') && ct.includes('Saturday · Stableford') && !ct.includes('Sunday'), 'only Stableford rounds are offered');
await page.getByLabel('Name', { exact: true }).fill('BD Trophy');
check(await page.getByRole('checkbox').first().isChecked(), 'has a trophy ticked by default for points over rounds');
await page.getByLabel('Trophy name').fill('The BD');
await page.getByRole('button', { name: 'Add it' }).click();
await page.waitForTimeout(1200);
const bd = db.comps.find((c) => c.name === 'BD Trophy');
const bdT = db.trophies.find((t) => t.name === 'The BD');
check(bd && bd.kind === 'individual_points' && JSON.stringify(bd.round_ids) === '[]', 'points comp saved over all Stableford rounds');
check(bdT && bdT.type === 'stableford_total' && bd?.trophy_id === bdT.id, 'its trophy is made (stableford_total) and linked');

// 3. Ambrose teams on Sunday.
await page.getByRole('button', { name: '+ Add another' }).click();
await page.getByRole('button', { name: /Ambrose teams/ }).click();
await page.getByLabel('Name', { exact: true }).fill('Putt Buddies');
await page.getByRole('button', { name: 'Add it' }).click();
await page.waitForTimeout(1200);
const pb = db.comps.find((c) => c.name === 'Putt Buddies');
check(pb && pb.kind === 'ambrose_teams' && !pb.trophy_id, 'Ambrose teams comp saved (no trophy)');

// 4. A Cup over Friday and Saturday: sides, sessions, points.
await page.getByRole('button', { name: '+ Add another' }).click();
await page.getByRole('button', { name: /Team match play/ }).click();
await page.getByLabel('Name', { exact: true }).fill('6th Ryder Cup');
await page.getByRole('group', { name: 'Rounds that count' }).getByRole('button', { name: /Sunday/ }).click();
await page.getByLabel('Side 1 name').fill('Team Blue');
await page.getByLabel('Side 2 name').fill('Team Gold');
await page.getByLabel('Friday matches').fill('2');
await page.getByLabel('Saturday matches').fill('2');
await page.getByRole('button', { name: /Use 8/ }).click();
await page.screenshot({ path: `${SHOTS}/2-cup-editor.png`, fullPage: true });
await page.getByRole('button', { name: 'Add it' }).click();
await page.waitForTimeout(1500);
const cup = db.comps.find((c) => c.kind === 'cup');
check(cup && cup.round_ids.length === 2 && cup.settings.points === 8 && cup.settings.sessions[FRI]?.matches === 2, 'Cup comp saved with two sessions and 8 points');
check(db.cup_sides.length === 2 && db.cup_sides.every((s) => s.comp_id === cup?.id) && db.cup_sides[1]?.name === 'Team Gold', 'the two sides are made and linked to the Cup comp');
check(Number(db.trips[0].cup_points) === 8, 'the trip’s cup points are set too (older app versions)');

// 5. To-do lists.
await page.reload();
await page.getByRole('button', { name: /What are you playing for\?/ }).click();
await page.getByText('6th Ryder Cup').first().waitFor();
await page.waitForTimeout(600);
const t5 = await text();
check(t5.includes('Friday: 3 playing') && t5.includes('Saturday: pick who’s playing'), 'points comp: who’s playing each counting round');
check(t5.includes('Sunday: make the Ambrose teams'), 'Ambrose comp: make the teams');
check(t5.includes('Cup: Team Blue v Team Gold') && t5.includes('Cup: 8 players not on a side') && t5.includes('Friday: 0 of 2 matches made') && t5.includes('Cup: 8 points, 4½ to win'), 'Cup comp: sides, players, matches, points');
check(t5.includes('Noodle Cup'), 'an old trophy with no comp shows as a comp too');
await page.screenshot({ path: `${SHOTS}/3-todo.png`, fullPage: true });
// A to-do button goes to the right editor.
await page.locator('.card', { hasText: 'Putt Buddies' }).last().getByRole('button', { name: 'Make teams' }).click();
await page.waitForURL(/#\/admin\?round=/);
check(page.url().includes(`round=${SUN}`), 'Make teams opens Admin at Sunday’s round');
await page.locator(`[id="round-${SUN}"]`).getByText('This round counts for:').waitFor({ timeout: 10000 });
check((await page.locator(`[id="round-${SUN}"]`).innerText()).includes('Putt Buddies — make the Ambrose teams'), 'the round card lists what its comps still need');
await page.screenshot({ path: `${SHOTS}/3b-admin-round.png` });

// 6. Standings on the Comps screen.
await page.goto(`${BASE}#/comps-board?c=${bd.id}`);
await page.getByText('Kurt leads · 6 pts').first().waitFor({ timeout: 10000 });
check(true, 'standings: Kurt leads the BD Trophy on 6 points');
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/4-board.png`, fullPage: true });

// 7. Leaderboard chips for the comps Friday counts towards.
await page.goto(`${BASE}#/?r=${FRI}`);
const cf = page.getByRole('group', { name: 'This round counts for' });
await cf.waitFor({ timeout: 10000 });
const cft = await cf.innerText();
check(cft.includes('BD Trophy') && cft.includes('6th Ryder Cup') && !cft.includes('Putt Buddies'), `leaderboard chips: ${cft.replace(/\n/g, ' ')}`);
await page.screenshot({ path: `${SHOTS}/5-leaderboard.png` });

// 8. Features: Team match play is no longer a switch (the Cup is on for this group now).
await page.goto(`${BASE}#/group`);
await page.getByText('Features').first().waitFor({ timeout: 10000 });
await page.waitForTimeout(800);
const gt = await text();
check(gt.includes('Side comps') && !gt.includes('Team match play'), 'Features list no longer shows Team match play');

// 9. Trophy Room: the BD (classic board) and the old Noodle Cup with its honour board.
await page.goto(`${BASE}#/trophies`);
await page.getByText('The Trophy Room').waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
const tr = await page.locator('.room').innerText();
check(tr.includes('The BD') && tr.includes('Noodle Cup') && /HELD BY KURT DAHL/i.test(tr), 'Trophy Room shows the BD and the Noodle Cup (held by Kurt Dahl)');
await page.getByRole('button', { name: /The BD/ }).click();
await page.waitForTimeout(400);
const tr2 = await page.locator('.room').innerText();
check(tr2.includes('R1') && tr2.includes('R2') && tr2.includes('Raw Stableford points added across every Stableford round'), 'the BD shows the classic Stableford table');
await page.screenshot({ path: `${SHOTS}/6-trophies.png`, fullPage: true });

// 10. The Cup reads its comp: the name and the points to win.
await page.goto(`${BASE}#/cup`);
await page.getByText('6th Ryder Cup').first().waitFor({ timeout: 10000 });
check((await text()).includes('4½'), 'the Cup screen shows the comp’s name and 4½ to win');

// 11. A player sees standings but no to-do list or editor.
organiser = false;
await page.goto(`${BASE}#/comps-board?c=${bd.id}`);
await page.reload();
await page.getByText('Kurt leads · 6 pts').first().waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
const pt = await text();
check(!pt.includes('+ Add something to play for') && !pt.includes('To do'), 'players see standings only');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
