// The Caddie browser check, 22 Oct 2026. Fake database and a fake ai-helper function only (no model, no key).
//   * Shows on the leaderboard, Trips and the Rulebook; not on the TV or the replay. Moves clear of "Enter score".
//   * Never greyed: AI off / not set up / a guest / no signal → it says why and still finds the right page.
//   * Leaderboard suggestions are about its round; the screen goes to the function as context; an answer with
//     go_to shows "Go there →", which takes you to the round's setup. No go_to → "Might help:".
//   * Laptop width: a panel down the right (and on the laptop tools, e.g. the players table).
// Usage: node caddie-test.mjs <base> <shotDir>   e.g. http://localhost:4385/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4385/lgc-golf/';
const SHOTS = process.argv[3] || './shots-caddie';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const PLAN = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const now = '2026-10-21T08:00:00.000Z';
const holes = [[4, 7], [3, 15], [5, 1], [4, 11], [4, 3], [3, 17], [4, 5], [5, 9], [4, 13], [4, 8], [3, 16], [4, 2], [5, 10], [4, 4], [3, 18], [4, 6], [4, 12], [5, 14]]
  .map(([par, si], i) => ({ n: i + 1, par, si }));
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now, cup_side: null },
    { id: B, name: 'Al Blue', nickname: 'Bluey', handicap: 20, approved: true, created_at: now, cup_side: null },
  ],
  trips: [{ id: TRIP, name: 'Hunter 2026', start_date: '2026-10-21', end_date: '2026-10-23', status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [],
  round_players: [{ round_id: R1, player_id: K, playing_handicap: 12 }, { round_id: R1, player_id: B, playing_handicap: 20 }],
  scores: [
    { id: 's1', round_id: R1, subject_id: K, subject_type: 'player', hole: 1, strokes: 4, picked_up: false, updated_at: now },
    { id: 's2', round_id: R1, subject_id: B, subject_type: 'player', hole: 1, strokes: 5, picked_up: false, updated_at: now },
  ],
  courses: [{ id: COURSE, name: 'Kurri Kurri', holes, created_at: now }],
  rounds: [{ id: R1, trip_id: TRIP, course_id: COURSE, name: 'Wednesday — Kurri', play_date: '2026-10-21', format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now }],
  plans: [{ id: PLAN, group_id: GROUP, kind: 'trip', name: 'Hunter 2026', status: 'booked', trip_id: TRIP, start_date: '2026-10-21', end_date: '2026-10-23', created_by: K, created_at: now }],
  plan_rsvps: [], plan_polls: [], plan_options: [], plan_votes: [], plan_items: [], plan_costs: [], plan_payments: [], plan_transfers: [], plan_comments: [],
  plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
  group_features: ['feed', 'planner', 'planner_tasks', 'planner_costs', 'ai_helper', 'replay', 'notifications'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let organiser = true;
let guest = false;
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
      if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((s) => s.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
    }
    return true;
  });
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: organiser, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: guest ? 'guest' : organiser ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = filterRows(db[table] || [], url.searchParams);
    if (method === 'GET') {
      if ((req.headers().accept || '').includes('vnd.pgrst.object')) return json(rows[0] || null);
      return json(rows);
    }
    return json([], 201);
  }
  return json({});
}

// The fake ai-helper edge function.
const calls = [];
let notSetUp = false;
async function fakeHelper(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: 'ok' });
  const body = JSON.parse(req.postData() || '{}');
  calls.push(body);
  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
  if (notSetUp) return json({ error: 'The AI helper isn’t switched on yet' });
  if (/teams/i.test(body.text)) return json({ answer: 'Tap Go there and change the teams in the round card.', go: { key: 'admin_teams', label: 'Teams & pairs', round: R1 }, remaining: { month: 50, today: 8 }, log_id: 21 });
  return json({ answer: 'The rules are in the Rulebook.', remaining: { month: 49, today: 7 }, log_id: 22 });
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
async function newCtx(viewport) {
  const phone = viewport.width < 800;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
  await ctx.route('https://*.supabase.co/**', fake);
  await ctx.route('**/functions/v1/ai-helper', fakeHelper); // registered last, so it wins for the function
  await ctx.route('**/functions/v1/notify', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"sent":0}' }));
  await ctx.addInitScript(([uid, group]) => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
    if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem('lgc-group', group);
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
  }, ['99999999-9999-4999-8999-999999999999', GROUP]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e}`));
  return { ctx, page };
}
const visible = (loc) => loc.isVisible().catch(() => false);
const overlap = (a, b) => a && b && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
const box = (p) => p.getByLabel('Ask the caddie', { exact: true }).and(p.locator('textarea'));

const { ctx, page } = await newCtx({ width: 375, height: 812 });
const caddie = page.getByTestId('caddie');

// 1. Leaderboard: there, clear of "Enter score".
await page.goto(`${BASE}#/leaderboard`);
await page.getByText('Enter score').waitFor({ timeout: 15000 });
await caddie.waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
check(true, 'the caddie shows on the leaderboard');
const fabBox = await page.locator('.fab').boundingBox();
const cadBox = await caddie.boundingBox();
check(!overlap(fabBox, cadBox) && cadBox.y + cadBox.height <= fabBox.y, 'the caddie sits clear of (above) "Enter score"');
check(cadBox.width >= 44 && cadBox.height >= 44, 'tap target is at least 44 px');
check(!overlap(await page.locator('.tabs').boundingBox(), cadBox), 'it doesn’t cover the tab bar');
await page.screenshot({ path: `${SHOTS}/1-leaderboard.png` });

// 2. Open it: round-specific suggestions; the screen goes as context; go_to → Go there → round setup.
await caddie.click();
await page.getByRole('dialog', { name: 'Ask the caddie' }).waitFor({ timeout: 10000 });
await page.getByTestId('caddie-chat').waitFor({ timeout: 10000 });
check(await visible(page.getByRole('button', { name: 'Who’s leading in Wednesday — Kurri?' })), 'leaderboard suggestions are about its round');
check(await visible(page.getByRole('button', { name: 'Change the teams' })), 'organisers get "Change the teams"');
check((await page.getByTestId('caddie-chat').getAttribute('data-ai')) === 'on', 'AI on');
await page.screenshot({ path: `${SHOTS}/2-sheet.png` });
check(/Connect Claude or ChatGPT to your group/.test(await page.getByTestId('caddie-connector').innerText().catch(() => '')), 'v8: a quiet line at the bottom notes the Claude / ChatGPT connector (organiser)');
await box(page).fill('How do I change the teams?');
await page.getByRole('button', { name: 'Ask', exact: true }).click();
await page.getByText('Tap Go there and change the teams').waitFor({ timeout: 10000 });
const c1 = calls.at(-1);
check(c1.mode === 'history' && c1.context?.screen === 'leaderboard' && c1.context?.round_id === R1 && c1.group_id === GROUP, 'the question goes with the screen as context (leaderboard + round)');
const goBtn = page.getByRole('button', { name: /Teams & pairs.*Go there/ });
check(await visible(goBtn), '"Go there →" shows under the answer');
check(await visible(page.getByRole('button', { name: 'Helpful', exact: true })), '👍 / 👎 still there');
await page.screenshot({ path: `${SHOTS}/3-answer-go.png` });
check(/#\/leaderboard$/.test(page.url()), 'nothing moves until you tap');
await goBtn.click();
await page.waitForURL(new RegExp(`#/admin\\?round=${R1}`), { timeout: 10000 });
check(true, 'tapping it opens the round’s admin setup');
check(!(await visible(page.getByRole('dialog', { name: 'Ask the caddie' }))), 'the sheet closes');

// 3. An answer with no go_to → "Might help:" places.
await caddie.click();
await box(page).fill('Where are the rules?');
await page.getByRole('button', { name: 'Ask', exact: true }).click();
await page.getByText('The rules are in the Rulebook.').waitFor({ timeout: 10000 });
check(await visible(page.getByText('Might help:')) && await visible(page.getByRole('button', { name: /The Rulebook.*Go there/ })), 'no go_to → "Might help:" with the Rulebook');
check(calls.at(-1).context?.screen === 'admin', 'context follows the screen (admin)');
await page.keyboard.press('Escape');

// 4. Shows on Trips and the Rulebook; not on the TV or the replay. More has no "Ask the AI helper".
for (const [path, wait] of [['/plan', 'Hunter 2026'], ['/rules', 'Rulebook']]) {
  await page.goto(`${BASE}#${path}`);
  await page.getByText(wait).first().waitFor({ timeout: 15000 });
  check(await visible(caddie), `the caddie shows on ${path}`);
}
await page.screenshot({ path: `${SHOTS}/4-rulebook.png` });
await page.goto(`${BASE}#/more`);
await page.getByText('My profile').waitFor({ timeout: 10000 });
check(!(await visible(page.getByText('✨ Ask the AI helper'))), 'More no longer lists "Ask the AI helper"');
await page.goto(`${BASE}#/replay/${R1}`);
await page.waitForTimeout(1500);
check(!(await visible(caddie)), 'not on the round replay');
await page.goto(`${BASE}#/tv/hunter`);
await page.waitForTimeout(1500);
check(!(await visible(caddie)), 'not on the TV');

// 5. AI switched off: still opens, says why, finds the page; the function isn't called.
db.group_features.find((f) => f.feature_key === 'ai_helper').enabled = false;
await page.goto(`${BASE}#/`);
await page.reload();
await caddie.waitFor({ timeout: 15000 });
let before = calls.length;
await caddie.click();
await page.getByTestId('caddie-chat').waitFor({ timeout: 10000 });
check((await page.getByTestId('caddie-chat').getAttribute('data-ai')) === 'off', 'feature off: the caddie still opens (not greyed)');
check(await visible(page.getByText(/the AI is switched off for your group/).first()), 'feature off: it says why in one line');
await box(page).fill('ambrose teams');
await page.getByRole('button', { name: 'Find it' }).click();
await page.getByText('I can’t answer questions yet — the AI is switched off for your group — but I can take you to the right page:').waitFor({ timeout: 5000 });
check(await visible(page.getByRole('button', { name: /Teams & pairs.*Go there/ })), 'feature off: "ambrose teams" → Teams & pairs');
await page.screenshot({ path: `${SHOTS}/5-off.png` });
await box(page).fill('money');
await page.getByRole('button', { name: 'Find it' }).click();
const kitty = page.getByRole('button', { name: /Kitty.*Go there/ }).first();
await kitty.waitFor({ timeout: 5000 });
await kitty.click();
await page.waitForURL(new RegExp(`#/plan/${PLAN}\\?view=organise&tab=kitty`), { timeout: 10000 });
check(true, 'feature off: "money" → the trip’s kitty');
check(calls.length === before, 'feature off: the function is never called');
db.group_features.find((f) => f.feature_key === 'ai_helper').enabled = true;

// 6. AI not set up: the function says so once → remembered; then the built-in search.
notSetUp = true;
await page.goto(`${BASE}#/`);
await page.reload();
await caddie.click();
await box(page).fill('Where are the rules?');
await page.getByRole('button', { name: 'Ask', exact: true }).click();
await page.getByText(/the AI isn’t switched on for your group — but I can take you/).first().waitFor({ timeout: 10000 });
check(await visible(page.getByRole('button', { name: /The Rulebook.*Go there/ })), 'not set up: says so and offers the Rulebook');
before = calls.length;
await box(page).fill('gimme');
await page.getByRole('button', { name: 'Find it' }).click();
await page.waitForTimeout(400);
check(calls.length === before, 'not set up: remembered — the next one doesn’t call the function');
await page.screenshot({ path: `${SHOTS}/6-not-set-up.png` });
notSetUp = false;
await ctx.close();

// 7. A guest: says why; no organiser places; still finds the Rulebook.
guest = true; organiser = false;
{
  const { ctx: g, page: gp } = await newCtx({ width: 375, height: 812 });
  await gp.goto(`${BASE}#/rules`);
  await gp.getByTestId('caddie').click();
  await gp.getByTestId('caddie-chat').waitFor({ timeout: 15000 });
  check(await visible(gp.getByText(/the AI is for the group’s players/).first()), 'guest: says the AI is for the group’s players');
  await box(gp).fill('teams rules');
  await gp.getByRole('button', { name: 'Find it' }).click();
  await gp.getByRole('button', { name: /The Rulebook.*Go there/ }).waitFor({ timeout: 5000 });
  check(!(await visible(gp.getByRole('button', { name: /Teams & pairs/ }))), 'guest: no organiser-only places');
  check(/ask your organiser to switch it on/.test(await gp.getByTestId('caddie-connector').innerText().catch(() => '')), 'v8: not an organiser → “ask your organiser to switch it on” (connector off)');
  await gp.screenshot({ path: `${SHOTS}/7-guest.png` });
  await g.close();
}
guest = false; organiser = true;

// 7b. v8: the organiser's connector line goes to Players & group → Features, the Claude connector highlighted.
{
  const { ctx: o, page: op } = await newCtx({ width: 375, height: 812 });
  await op.goto(`${BASE}#/rules`);
  await op.getByTestId('caddie').click();
  await op.getByTestId('caddie-connector').waitFor({ timeout: 15000 });
  await op.getByTestId('caddie-connector').getByRole('button').click();
  await op.waitForURL(/#\/group\?feature=connector/, { timeout: 10000 });
  const row = op.locator('[data-feature="connector"]');
  await row.waitFor({ timeout: 15000 });
  check(await row.getAttribute('data-highlight') === 'true', 'v8: organiser → Features with the Claude connector highlighted');
  await op.screenshot({ path: `${SHOTS}/7b-connector-highlight.png` });
  await o.close();
}

// 8. No signal: says so; the search still works.
{
  const { ctx: o, page: op } = await newCtx({ width: 375, height: 812 });
  await op.goto(`${BASE}#/`);
  await op.getByTestId('caddie').waitFor({ timeout: 15000 });
  await op.waitForTimeout(800);
  await o.setOffline(true);
  await op.getByTestId('caddie').click();
  await op.getByTestId('caddie-chat').waitFor({ timeout: 10000 });
  check(await visible(op.getByText(/there’s no signal/).first()), 'offline: says there’s no signal');
  await box(op).fill('notifications');
  await op.getByRole('button', { name: 'Find it' }).click();
  check(await visible(op.getByRole('button', { name: /Notifications.*Go there/ })), 'offline: "notifications" → notification settings');
  await o.setOffline(false);
  await o.close();
}

// 9. Laptop width: a panel down the right.
{
  const { ctx: d, page: dp } = await newCtx({ width: 1280, height: 800 });
  await dp.goto(`${BASE}#/`);
  await dp.getByTestId('caddie').waitFor({ timeout: 15000 });
  const tb = await dp.getByTestId('caddie').boundingBox();
  check(tb.x + tb.width >= 1278, 'laptop: the caddie tab is docked on the right edge');
  await dp.getByTestId('caddie').click();
  await dp.getByTestId('caddie-panel').waitFor({ timeout: 5000 });
  await dp.getByTestId('caddie-chat').waitFor({ timeout: 10000 });
  const pb = await dp.getByTestId('caddie-panel').boundingBox();
  check(pb.x >= 900 && pb.height >= 790, 'laptop: the side panel is open down the right');
  const ap = await dp.locator('.app.with-side').boundingBox();
  check(ap.x + ap.width <= pb.x + 1, 'laptop: the page makes room for it');
  await dp.screenshot({ path: `${SHOTS}/8-desktop.png` });
  await dp.goto(`${BASE}#/group/players`); // the players table (was on the Trip desk)
  await dp.getByTestId('caddie-panel').waitFor({ timeout: 10000 });
  check(true, 'laptop: on the players table too');
  await d.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
