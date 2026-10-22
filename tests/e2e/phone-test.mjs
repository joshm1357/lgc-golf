// Phone-width browser check of the built app (dist/) against a fake database.
// No real database is touched: every request to Supabase is answered here.
// Usage: node phone-test.mjs <baseUrl> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4173/lgc-golf/';
const SHOTS = process.argv[3] || './shots';
fs.mkdirSync(SHOTS, { recursive: true });

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const ROUND = 'dddddddd-0000-4000-8000-000000000001';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const ROOM = 'ffffffff-0000-4000-8000-000000000001';
const now = new Date().toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date()); // the app's 'today' is Sydney time
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1, green: { lat: -35.0 + i * 0.001, lng: 150.5 } }));

const db = {
  players: [
    { id: P1, name: 'Josh M', nickname: 'Josh', handicap: 14, approved: true, created_at: now },
    { id: P2, name: 'Mike Morris', nickname: 'Mike', handicap: 18, approved: true, created_at: now },
    { id: P3, name: 'Adam H', nickname: 'Adam', handicap: 22, approved: true, created_at: now },
  ],
  trips: [{ id: TRIP, name: 'Test Trip', start_date: today, end_date: today, status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [],
  courses: [{ id: COURSE, name: 'Test Links', holes, created_at: now }],
  rounds: [{ id: ROUND, trip_id: TRIP, course_id: COURSE, name: 'Saturday', play_date: today, format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now }],
  round_players: [P1, P2, P3].map((p) => ({ round_id: ROUND, player_id: p, playing_handicap: 14 })),
  scores: [{ round_id: ROUND, subject_id: P1, subject_type: 'player', hole: 1, strokes: 4, picked_up: false, updated_at: now }],
  round_pins: holes.map((h) => ({ round_id: ROUND, hole: h.n, lat: -35.0001 + h.n * 0.001, lng: 150.5, set_by: P2, set_at: now })),
  plans: [{ id: PLAN, kind: 'trip', name: 'Spring Trip', status: 'planning', start_date: '2026-11-20', end_date: '2026-11-22', location_name: 'Bowral', proposed: false, rsvp_locked: false, created_by: P1, created_at: now }],
  plan_rsvps: [P1, P2, P3].map((p) => ({ plan_id: PLAN, player_id: p, status: 'in', updated_at: now })),
  plan_groups: [{ id: ROOM, plan_id: PLAN, kind: 'room', name: 'Bunk room', capacity: 2, sort: 0, created_at: now }],
  plan_group_members: [{ group_id: ROOM, player_id: P2 }],
  tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  // L.G.C's switches (migration 030): everything on apart from the two coming-soon features.
  group_features: ['feed', 'side_comps', 'comp_bonus', 'trophies', 'tribunal', 'draw', 'gps', 'location', 'planner', 'planner_tasks',
    'planner_costs', 'planner_rooms', 'rule_voting', 'notifications', 'connector'].map((k) => ({ group_id: 'a0a0a0a0-0000-4000-8000-00000000000a', feature_key: k, enabled: true })),
};

const writes = [];
const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000a';
const reads = [];
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue; // fixtures are all one group
      if (v.startsWith('eq.')) { if (String(r[k]) !== v.slice(3)) return false; }
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
    }
    return true;
  });
}

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  if (url.pathname.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: true, player_id: P1, group_name: 'L.G.C', group_id: GROUP, role: 'organiser', groups: [{ id: GROUP, name: 'L.G.C', slug: 'lgc', role: 'organiser' }] });
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(null);
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.split('/')[3];
    if (method === 'GET') reads.push({ table, group: url.searchParams.get('group_id'), header: req.headers()['x-group-id'] });
    const rows = filterRows(db[table] || [], url.searchParams);
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    if (method === 'GET') return json(single ? rows[0] || null : rows);
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    writes.push({ method, table, query: url.search, body });
    if (method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]).map((b) => ({ id: b.id || `new-${writes.length}`, ...b }));
      return json(single ? list[0] : list, 201);
    }
    if (method === 'DELETE') return json(rows);
    return json(single ? rows[0] || null : rows);
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  geolocation: { latitude: -35.0012, longitude: 150.5 }, permissions: ['geolocation'],
});
await ctx.route('https://luogyzvrbedmicjejilr.supabase.co/**', fakeSupabase);
await ctx.addInitScript(([uid]) => { try { localStorage.setItem('tgt-caddie-hello', '1'); } catch { /* ov22 */ }
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) {
    localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated', is_anonymous: true } }));
  }
  localStorage.setItem('lgc-distances-on', '1');
}, ['99999999-9999-4999-8999-999999999999']);

const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
let step = 'start';
page.on('pageerror', (e) => errors.push(`[${step}] ${String(e)} ${String(e.stack || '').split('\n').slice(0, 4).join(' / ')}`));
const scripts = new Set();
page.on('request', (r) => { const u = r.url(); if (u.includes('/assets/') && u.endsWith('.js')) scripts.add(u.split('/').pop()); });

// 1. The first screen (the trip on now — ov15/ov21 — with today's leaderboard) opens with only the starting file.
await page.goto(BASE);
await page.getByText('Saturday').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/1-leaderboard.png` });
const startFiles = [...scripts];
check(startFiles.length === 1 && startFiles[0].startsWith('index-'), `leaderboard loads only the starting file (${startFiles.join(', ')})`);

// 2. Service worker saves every part for offline use.
await page.evaluate(() => navigator.serviceWorker.ready);
const listed = await (await page.request.get(`${BASE}asset-list.json`)).json();
let cached = [];
for (let i = 0; i < 20; i++) {
  cached = await page.evaluate(async () => { const c = await caches.open('lgc-shell-v2'); return (await c.keys()).map((r) => new URL(r.url).pathname); });
  if (listed.every((f) => cached.includes(`/lgc-golf/${f}`))) break;
  await page.waitForTimeout(500);
}
check(listed.every((f) => cached.includes(`/lgc-golf/${f}`)), `service worker saved all ${listed.length} parts (${cached.filter((p) => p.includes('/assets/')).length} saved)`);

// 3. Offline: screens that weren't opened yet still open from the saved copy.
await page.reload(); // now controlled by the service worker
await page.getByText('Saturday').first().waitFor();
await ctx.setOffline(true);
for (const [hash, text] of [['#/tribunal', 'Tribunal'], ['#/plan', 'Ideas and voting'], [`#/comps?r=${ROUND}`, 'Closest'], ['#/admin', 'Admin']]) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  let ok = false;
  // Scoped to the page: on a laptop build the (hidden on phones) sidebar has the same words.
  try { await page.locator('.page').getByText(text).first().waitFor({ timeout: 6000 }); ok = true; } catch { /* fail below */ }
  check(ok, `offline: ${hash} opens`);
}
await page.screenshot({ path: `${SHOTS}/2-offline-admin.png` });
await ctx.setOffline(false);

// 3b. Weak signal: the list of parts fails to download — saved parts must NOT be thrown away.
await ctx.route('**/asset-list.json', (r) => r.abort());
await page.goto(BASE);
await page.getByText('Saturday').first().waitFor();
await page.waitForTimeout(2500);
await ctx.unroute('**/asset-list.json');
const afterFail = await page.evaluate(async () => { const c = await caches.open('lgc-shell-v2'); return (await c.keys()).length; });
check(afterFail >= listed.length, `parts list failed to load: saved parts kept (${afterFail})`);
// 3c. A Wi-Fi login page answers instead of the app — it must not replace the saved app.
await ctx.route(BASE, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Hotel Wi-Fi login</body></html>' }));
await page.goto(BASE).catch(() => {});
await page.waitForTimeout(2500);
await ctx.unroute(BASE);
await ctx.setOffline(true);
await page.goto(BASE).catch(() => {});
let appBack = false;
try { await page.getByText('Saturday').first().waitFor({ timeout: 8000 }); appBack = true; } catch { /* fail below */ }
check(appBack, 'after a Wi-Fi login page, the app still opens offline');
await page.evaluate((r) => { window.location.hash = `#/comps?r=${r}`; }, ROUND); // a round's side comps (ov15)
let compsOk = false;
try { await page.getByText('Closest').first().waitFor({ timeout: 6000 }); compsOk = true; } catch { /* fail below */ }
check(compsOk, 'offline: Comps still opens after the weak-signal and Wi-Fi tests');
await ctx.setOffline(false);

// 4. Score screen: admin sees "Clear today's pin" and it deletes the pin.
await page.evaluate((r) => { window.location.hash = `#/score/${r}`; }, ROUND);
const clear = page.getByRole('button', { name: /Clear today’s pin on \d+/ });
await clear.waitFor({ timeout: 10000 });
await page.screenshot({ path: `${SHOTS}/3-score-pin.png` });
writes.length = 0;
const holeNo = (await clear.textContent()).match(/on (\d+)/)[1];
await clear.click();
await page.waitForTimeout(800);
const del = writes.find((w) => w.method === 'DELETE' && w.table === 'round_pins');
check(!!del && del.query.includes(`hole=eq.${holeNo}`) && del.query.includes(`round_id=eq.${ROUND}`), 'clear pin sends one delete for this round and hole');

step = 'shot planner';
// 5. Shot planner (map) loads on demand.
const before = scripts.size;
await page.getByRole('button', { name: /Plan shots/ }).click();
await page.locator('.leaflet-container').first().waitFor({ timeout: 10000 });
check([...scripts].some((s) => s.includes('CourseMap')), `map part loads only when the shot planner opens (${scripts.size - before} new part(s))`);
const font = await page.locator('.leaflet-container').first().evaluate((el) => getComputedStyle(el).fontFamily);
check(/Barlow/.test(font), `map keeps the app font (${font})`);
await page.screenshot({ path: `${SHOTS}/4-shot-planner.png` });
await page.waitForTimeout(1500);
step = 'after planner settled';

step = 'rooms';
// 6. Rooms: one sheet, one Save.
await page.goto(`${BASE}#/plan/${PLAN}?tab=groups`);
await page.getByText('Bunk room').first().click();
await page.getByText('Who’s in it').waitFor({ timeout: 10000 });
await page.screenshot({ path: `${SHOTS}/5-room-sheet.png` });
writes.length = 0;
await page.getByRole('button', { name: /Adam/ }).click();
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(1000);
const upd = writes.find((w) => w.method === 'PATCH' && w.table === 'plan_groups');
const add = writes.find((w) => w.method === 'POST' && w.table === 'plan_group_members');
check(!!upd && !!add && JSON.stringify(add.body).includes(P3), 'room save updates the room and adds Adam in one step');
// Over capacity is refused before anything is written.
await page.getByText('Bunk room').first().click();
await page.getByText('Who’s in it').waitFor();
writes.length = 0;
await page.getByRole('button', { name: /Adam/ }).click();
await page.getByRole('button', { name: /Josh/ }).click();
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(800);
check(writes.length === 0, 'room over capacity: nothing saved, message shown');
await page.screenshot({ path: `${SHOTS}/6-room-full.png` });

const groupReads = reads.filter((r) => ['players', 'rounds', 'posts', 'plans'].includes(r.table));
check(groupReads.length > 0 && groupReads.every((r) => r.group === `eq.${GROUP}` && r.header === GROUP), `every read of a group table asks for this group only (${groupReads.length} checked)`);
const roomReads = reads.filter((r) => r.table === 'plan_group_members');
check(roomReads.every((r) => r.group !== `eq.${GROUP}`), 'rooms & cars reads are not given the golf-group filter');
check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
