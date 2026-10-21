// Games and side bets (055) browser check, 21 Oct 2026. Fake database only.
// Usage: node games-test.mjs <base> <shotDir>   e.g. http://localhost:4312/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4312/lgc-golf/';
const SHOTS = process.argv[3] || './shots-games';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const now = '2026-10-21T08:00:00.000Z';
const holes = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]]
  .map(([par, si], i) => ({ n: i + 1, par, si }));
// Everyone makes par except: hole 1 Kurt birdie (a skin); hole 2 Al and Bo both birdie (tie — carries);
// hole 3 Bo birdie (wins 2 skins); holes 4–9 tie and carry; hole 10 Al birdie (7 skins). Holes 11–18 tie: 8 skins
// left in the pot. Nassau ($10, net, everyone off 0): front Bo −2; back Al −1; the 18 Al and Bo tie on −2.
// Money ($5 a skin from each other player): skins Kurt −$35, Al +$55, Bo −$20; Nassau Kurt −$30, Al +$15, Bo +$15
//   → Al +$70, Bo −$5, Kurt −$65; settle up: Kurt pays Al $65, Bo pays Al $5.
const birdie = { [K]: [1], [A]: [2, 10], [B]: [2, 3] };
const scores = [];
for (const pid of [K, A, B]) {
  for (const h of holes) {
    scores.push({ id: crypto.randomUUID(), round_id: R1, subject_id: pid, subject_type: 'player', hole: h.n, strokes: h.par - (birdie[pid].includes(h.n) ? 1 : 0), picked_up: false, updated_at: now, group_id: GROUP });
  }
}
const feats = (gamesOn) => ['feed', 'side_comps', 'planner', 'games'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: k === 'games' ? gamesOn : true }));
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 0, approved: true, created_at: now },
    { id: A, name: 'Al Blue', nickname: null, handicap: 0, approved: true, created_at: now },
    { id: B, name: 'Bo Red', nickname: null, handicap: 0, approved: true, created_at: now },
  ],
  trips: [{ id: TRIP, name: 'Hunter Weekend', start_date: '2026-10-20', end_date: '2026-10-22', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [],
  round_players: [K, A, B].flatMap((p) => [R1, R2].map((r) => ({ round_id: r, player_id: p, playing_handicap: 0 }))),
  scores,
  courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
  rounds: [
    { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Friday — Cypress Lakes', play_date: '2026-10-21', format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
    { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Saturday — Cypress Lakes', play_date: '2026-10-22', format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
  ],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
  round_games: [
    { id: 'eeeeeeee-0000-4000-8000-000000000001', group_id: GROUP, round_id: R1, kind: 'skins', stake: 5, options: { net: true, carry: true }, retired: false, created_at: now },
    { id: 'eeeeeeee-0000-4000-8000-000000000002', group_id: GROUP, round_id: R1, kind: 'nassau', stake: 10, options: { net: true, scoring: 'stroke' }, retired: false, created_at: now },
  ],
  group_features: feats(true),
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
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: true, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || [];
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      for (const b of Array.isArray(body) ? body : [body]) rows.push({ id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), retired: false, ...b });
      db[table] = rows;
      return json([], 201);
    }
    if (method === 'PATCH') {
      const id = eqOf(url.searchParams, 'id');
      const body = JSON.parse(req.postData() || '{}');
      for (const r of rows) if (r.id === id) Object.assign(r, body);
      return json([], 200);
    }
    if (method === 'DELETE') return json({ message: 'the app should never delete a game' }, 400);
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
const clean = (arr) => arr.map((t) => t.replace(/\s+/g, ' ').trim());

// 1. The leaderboard has a small Games link for the live round.
await page.goto(`${BASE}#/`);
const chip = page.getByRole('link', { name: /Games today/ });
await chip.waitFor({ timeout: 15000 });
check((await chip.innerText()).includes('Skins · Nassau'), 'leaderboard shows "Games today: Skins · Nassau"');
await page.screenshot({ path: `${SHOTS}/1-leaderboard.png`, fullPage: true });
await chip.click();

// 2. Games screen: skins with a carry-over, Nassau leaders, the money and who pays who.
await page.getByTestId('game-skins').waitFor({ timeout: 15000 });
await page.getByTestId('skin-3').getByText('Bo Red').waitFor({ timeout: 15000 });
check((await page.getByTestId('skin-1').innerText()).includes('Kurt'), 'skins: Kurt wins hole 1');
check((await page.getByTestId('skin-2').innerText()).includes('Tie — carries'), 'skins: hole 2 tied — carries');
const s3 = await page.getByTestId('skin-3').innerText();
check(s3.includes('Bo Red') && /2 skins/i.test(s3), 'skins: Bo wins hole 3 worth 2 skins (the carry-over)');
const s10 = await page.getByTestId('skin-10').innerText();
check(s10.includes('Al Blue') && /7 skins/i.test(s10), 'skins: Al wins hole 10 worth 7 skins (holes 4–9 carried)');
check((await page.getByTestId('skins-summary').innerText()).includes('8 still in the pot'), 'skins: 8 still in the pot after 18');
check((await page.getByTestId('nassau-front').innerText()).includes('Bo Red'), 'Nassau: Bo wins the front 9');
check((await page.getByTestId('nassau-back').innerText()).includes('Al Blue'), 'Nassau: Al wins the back 9');
const tot = await page.getByTestId('nassau-total').innerText();
check(tot.includes('Al Blue') && tot.includes('Bo Red') && tot.includes('tied'), 'Nassau: Al and Bo tie the 18');
const tally = clean(await page.getByTestId('tally-row').allInnerTexts());
check(JSON.stringify(tally) === JSON.stringify(['Al Blue +$70', 'Bo Red −$5', 'Kurt −$65']), `tally: Al +$70, Bo −$5, Kurt −$65 (got ${JSON.stringify(tally)})`);
const settle = clean(await page.getByTestId('settle-row').allInnerTexts());
check(JSON.stringify(settle) === JSON.stringify(['Kurt pays Al Blue $65', 'Bo Red pays Al Blue $5']), `settle-up: Kurt pays Al $65, Bo pays Al $5 (got ${JSON.stringify(settle)})`);
check((await page.locator('.page').innerText()).includes('Pick-ups'), 'pick-up rules shown on screen');
await page.screenshot({ path: `${SHOTS}/2-games.png`, fullPage: true });

// 3. Live: a new score changes things (the fake has no realtime, so reload). Al birdies 18: the skin with the 7
//    carried from 11–17 (8 skins), and the 18 outright.
db.scores.find((s) => s.subject_id === A && s.hole === 18).strokes = 3;
await page.reload();
await page.getByTestId('skin-18').getByText('Al Blue').waitFor({ timeout: 15000 });
check(/8 skins/i.test(await page.getByTestId('skin-18').innerText()), 'live: Al’s birdie on 18 takes 8 skins (7 carried)');
await page.getByTestId('tally-row').first().waitFor();
check(clean(await page.getByTestId('tally-row').allInnerTexts())[0] === 'Al Blue +$165', 'live: the tally moves with it (Al +$165)');
check(!(await page.getByTestId('nassau-total').innerText()).includes('tied'), 'live: Al now wins the 18 outright');
db.scores.find((s) => s.subject_id === A && s.hole === 18).strokes = 4;

// 4. Organiser adds a preset to Saturday in Admin, changes the skins stake on Friday, then takes Nassau off.
await page.goto(`${BASE}#/admin`);
const sat = page.getByTestId('round-games').filter({ hasText: '+ Stableford pot $10' }).last();
await sat.waitFor({ timeout: 15000 });
await page.screenshot({ path: `${SHOTS}/3-admin.png`, fullPage: true });
const satCount = await page.getByTestId('round-games').count();
const satGames = page.getByTestId('round-games').nth(satCount - 1);
await satGames.getByRole('button', { name: '+ Stableford pot $10' }).click();
await page.waitForTimeout(800);
const added = db.round_games.find((g) => g.round_id === R2 && g.kind === 'stableford_pot');
check(added && Number(added.stake) === 10 && JSON.stringify(added.options) === '{}' && added.created_by === K, 'Admin: one tap adds "Stableford pot $10" to Saturday');
check(!(await satGames.getByRole('button', { name: '+ Stableford pot $10' }).isVisible().catch(() => false)), 'Admin: the preset disappears once added');
const fri = page.getByTestId('round-games').first();
const skinsRow = fri.locator('.card', { hasText: 'Skins $5' }).first();
await skinsRow.getByRole('button', { name: 'Change' }).click();
await skinsRow.getByLabel(/Stake/).fill('2.50');
await skinsRow.getByRole('button', { name: 'Gross' }).click();
await skinsRow.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(800);
const sk = db.round_games.find((g) => g.kind === 'skins');
check(Number(sk.stake) === 2.5 && sk.options.net === false && sk.options.carry === true, 'Admin: skins changed to $2.50 gross, carry-overs kept');
const nasRow = fri.locator('.card', { hasText: 'Nassau $10' }).first();
await nasRow.getByRole('button', { name: 'Change' }).click();
await nasRow.getByRole('button', { name: 'Take this game off' }).click();
await page.waitForTimeout(800);
check(db.round_games.find((g) => g.kind === 'nassau').retired === true, 'Admin: taking Nassau off retires it (no delete)');
await page.screenshot({ path: `${SHOTS}/4-admin-after.png`, fullPage: true });

// 5. The guided setup's Extras step has the Games card too.
await page.goto(`${BASE}#/setup`);
await page.getByRole('button', { name: /Extras/ }).first().click();
await page.getByTestId('round-games').first().waitFor({ timeout: 10000 }).catch(() => {});
check(await page.getByTestId('round-games').first().isVisible().catch(() => false), 'Set up your trip → Extras shows the Games card');
await page.screenshot({ path: `${SHOTS}/5-setup.png`, fullPage: true });

// 6. Feature off: hidden everywhere.
db.group_features = feats(false);
await page.goto(`${BASE}#/`);
await page.reload();
await page.locator('.lb').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1200);
check(!(await page.getByRole('link', { name: /Games today/ }).isVisible().catch(() => false)), 'feature off: no Games link on the leaderboard');
await page.goto(`${BASE}#/more`);
await page.getByText('My profile').waitFor({ timeout: 10000 });
check(!(await page.getByText('Games & side bets').isVisible().catch(() => false)), 'feature off: no Games in More');
await page.goto(`${BASE}#/games`);
check(await page.getByText(/switched off/).waitFor({ timeout: 10000 }).then(() => true, () => false), 'feature off: /games says it’s switched off');
await page.goto(`${BASE}#/admin`);
await page.getByText('Friday — Cypress Lakes').first().waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);
check(!(await page.getByTestId('round-games').first().isVisible().catch(() => false)), 'feature off: no Games card in Admin');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
