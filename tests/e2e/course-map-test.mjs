// ov36 — the trip map's courses (Josh 23 Oct): "There are courses on the map that I can't select as not on the list",
// filters (played / not played, rating, type), "expanding the search", "include ones 'on the way'", and a "custom"
// area you can zoom around. Fake database only — nothing real is touched.
//   A (phone). A dot that isn't in the list → its summary → "+ Put on the table" → the list shows it.
//   B (phone). Filters: Not played, ★4+, type, sort — remembered on the trip (after a reload too); a course on the table
//      stays in the list when a filter would hide it.
//   C (phone). Show more: more rows, then "Search wider: within 40 min of Pokolbin and Cessnock → 45 min", then 1 h —
//      the Newcastle courses turn up.
//   D (phone). On the way up or back: from Inner West, Gosford and Wyong (not the Sydney courses, not the far ones).
//   E (laptop). 🔍 Search this part of the map: pan to Port Stephens, the courses in view, filters on them, save it as
//      "Custom: around Nelson Bay" — a new area with its own courses.
// Usage: node course-map-test.mjs <base> [shotDir]   e.g. http://localhost:4365/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4365/lgc-golf/';
const SHOTS = process.argv[3] || './shots-ov36';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000f';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const now = new Date().toISOString();
const pid = (i) => `${String(i + 1).padStart(8, '0')}-2222-4222-8222-222222222222`;
const K = pid(0);
const players = ['Josh', 'Al', 'Bo', 'Cy', 'Di', 'Ed', 'Fin', 'Gus'].map((n, i) => ({ id: pid(i), name: `${n} Test`, nickname: n, handicap: 10 + i, approved: true, created_at: now }));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fri = (() => { const d = new Date(); d.setDate(d.getDate() + 21); while (d.getDay() !== 5) d.setDate(d.getDate() + 1); return d; })();
const W1 = { start: iso(fri), end: iso(new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 2)), long: false };

const L = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 18 Hunter courses within ~25 min of Pokolbin / Cessnock (more than a page of the list).
const hunter = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2; const r = 0.05 + (i % 4) * 0.03;
  return { id: L(i + 1), name: `Hunter Course ${String(i + 1).padStart(2, '0')}`, area: 'Hunter Valley NSW', lat: -32.80 + Math.sin(a) * r, lng: 151.32 + Math.cos(a) * r };
});
hunter[0].name = 'Cypress Lakes Golf Club'; Object.assign(hunter[0], { mine_avg: 4.5, played: true });
hunter[1].name = 'The Vintage Golf Club'; hunter[1].others_avg = 4.1;
hunter[2].name = 'Links Valley Golf Club'; hunter[2].others_avg = 3.2;
// Low on the list (our ★2.5) but on its own on the map: the dot to pick that isn't in the list.
hunter.push({ id: L(19), name: 'Lone Pine Golf Club', area: 'Pokolbin NSW', lat: -32.745, lng: 151.255, mine_avg: 2.5 });
const newcastle = [
  { id: L(31), name: 'Newcastle Golf Club', area: 'Newcastle NSW', lat: -32.95, lng: 151.80 },
  { id: L(32), name: 'Stockton Dunes Golf', area: 'Newcastle NSW', lat: -32.90, lng: 151.85 },
];
const stephens = [
  { id: L(41), name: 'Nelson Bay Golf Club', area: 'Nelson Bay NSW', lat: -32.725, lng: 152.14 },
  { id: L(42), name: 'Horizons Golf Resort', area: 'Salamander Bay NSW', lat: -32.735, lng: 152.08 },
  { id: L(43), name: 'Shoal Bay Country Club', area: 'Shoal Bay NSW', lat: -32.715, lng: 152.17 },
];
const way = [
  { id: L(51), name: 'Gosford Golf Club', area: 'Gosford NSW', lat: -33.42, lng: 151.34 },
  { id: L(52), name: 'Wyong Golf Club', area: 'Wyong NSW', lat: -33.28, lng: 151.42 },
  { id: L(53), name: 'Strathfield Golf Club', area: 'Strathfield NSW', lat: -33.87, lng: 151.09 }, // home: not "on the way"
  { id: L(54), name: 'Lithgow Golf Club', area: 'Lithgow NSW', lat: -33.48, lng: 150.15 },        // well off the drive
];
const library = [...hunter, ...newcastle, ...stephens, ...way].map((c) => ({ holes: 18, facts: [], played: false, ...c }));
const slim = (c) => ({ id: c.id, name: c.name, area: c.area, lat: c.lat, lng: c.lng });
const stayAreas = [['Pokolbin', 'Hunter Valley', -32.78, 151.29], ['Cessnock', 'Hunter Valley', -32.83, 151.36], ['Nelson Bay', 'Port Stephens', -32.72, 152.14]]
  .map(([name, region, lat, lng], i) => ({ id: crypto.randomUUID(), name, state: 'NSW', region, lat, lng, sort: i }));
const pin = (n) => { const a = stayAreas.find((x) => x.name === n); return { key: n, name: n, lat: a.lat, lng: a.lng }; };
const ON = [hunter[4].id, hunter[5].id];
const startState = {
  v: 1, region: null, regionOptions: ['Hunter Valley'], origin: null, nights: 2, weekends: [W1], weekendsSettled: false, stays: [], pins: [], stayMax: 40, detourMax: 25,
  days: [{ index: 0, leg: 'way', options: [] }, { index: 1, leg: 'stay', options: [] }, { index: 2, leg: 'home', options: [] }],
  courses: Object.fromEntries(ON.map((id) => [id, slim(library.find((c) => c.id === id))])), headcount: null, votes: {}, optionKeys: {}, callsMade: false, configs: [], picked: null,
  areaCourses: { 'Hunter Valley': ON }, areaStays: { 'Hunter Valley': [pin('Pokolbin'), pin('Cessnock')] }, suggested: {}, extras: [],
};
const research = [
  { library_id: hunter[0].id, name: hunter[0].name, state: 'NSW', details: { style: 'Parkland, resort', rankings: 'Top 100 public 2026: #41' } },
  { library_id: hunter[1].id, name: hunter[1].name, state: 'NSW', details: { style: 'Parkland', rankings: '#18 Top 100 public' } },
  { library_id: hunter[2].id, name: hunter[2].name, state: 'NSW', details: { style: 'Inland links' } },
  { library_id: stephens[0].id, name: stephens[0].name, state: 'NSW', details: { style: 'Coastal bush' } },
  { library_id: stephens[1].id, name: stephens[1].name, state: 'NSW', details: { style: 'Resort parkland' } },
];

const db = {
  players, trips: [], trophies: [], teams: [], team_players: [], quick_results: [], round_pins: [], scores: [], round_players: [], honour_board: [],
  courses: [], rounds: [],
  plans: [{ id: PLAN, kind: 'trip', name: 'Spring away', status: 'planning', start_date: null, end_date: null, proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, created_at: now }],
  plan_polls: [], plan_options: [], plan_votes: [], plan_comments: [], plan_costs: [], plan_payments: [], plan_transfers: [], notify_prefs: [], plan_budget_items: [], plan_items: [],
  plan_rsvps: players.map((x) => ({ plan_id: PLAN, player_id: x.id, status: 'in', updated_at: now })),
  plan_groups: [], plan_group_members: [], groups: [{ id: GROUP, vote_decider: 'admin', vote_channel: 'app' }],
  tribunal_cases: [], tribunal_votes: [], posts: [], rules: [], player_home_areas: [],
  trip_start_points: [{ id: crypto.randomUUID(), group_id: GROUP, plan_id: PLAN, label: 'Inner West', lat: -33.88, lng: 151.16, headcount: 8, leave_after: '06:00', finish_by: '17:00', sort: 0 }],
  trip_finds: [], course_notes: [], course_ratings: [], stay_areas: stayAreas, trip_tee_options: [], course_booking_info: [], vote_batches: [], course_social_times: [],
  course_research: research,
  trip_builds: [{ plan_id: PLAN, group_id: GROUP, state: startState }],
  plan_stays: [],
  group_features: ['feed', 'planner', 'planner_tasks', 'trip_finder', 'ai_helper', 'planner_costs'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
const state = () => db.trip_builds.find((b) => b.plan_id === PLAN)?.state || {};
const libCalls = [];
const match = (r, k, v) => {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(r[k]));
  if (v.startsWith('is.')) return v === 'is.null' ? r[k] == null : true;
  return true;
};
const filterRows = (rows, params) => rows.filter((r) => {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'group_id' && r.group_id === undefined) continue;
    if (!match(r, k, v)) return false;
  }
  return true;
});
function rpc(name, b) {
  if (name === 'my_status') return { is_member: true, is_admin: true, player_id: K, group_name: 'Test Golfers', group_id: GROUP, role: 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Test Golfers', slug: 'test', role: 'organiser' }] };
  if (name === 'trip_finder_courses') {
    // Like the real one: the courses inside the box, nearest the middle first, up to the limit.
    libCalls.push(b);
    const d = (c) => (c.lat - b.p_lat) ** 2 + (c.lng - b.p_lng) ** 2;
    return library.filter((c) => c.lat >= b.p_south && c.lat <= b.p_north && c.lng >= b.p_west && c.lng <= b.p_east).sort((x, y) => d(x) - d(y)).slice(0, b.p_limit || 300);
  }
  if (name === 'group_invite') return 'ABCDEFGH2345';
  return null;
}
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/')) return json(rpc(p.split('/').pop(), JSON.parse(req.postData() || '{}')));
  if (p.startsWith('/functions/v1/')) return json({ sent: 0 });
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') {
      const out = filterRows(rows, url.searchParams);
      if ((req.headers().accept || '').includes('vnd.pgrst.object')) return json(out[0] || null);
      return json(out);
    }
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const conflict = url.searchParams.get('on_conflict') || (table === 'trip_builds' ? 'plan_id' : null);
      const made = [];
      for (const x of Array.isArray(body) ? body : [body]) {
        const keys = conflict ? conflict.split(',') : null;
        const old = keys && rows.find((r) => keys.every((k) => String(r[k]) === String(x[k])));
        if (old) { Object.assign(old, x); made.push(old); continue; }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...x };
        rows.push(row); made.push(row);
      }
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
    }
    return json([], 200);
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
async function context(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route('https://*.supabase.co/**', fake);
  await ctx.route('https://server.arcgisonline.com/**', (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.addInitScript(([uid]) => {
    if (!localStorage.getItem('tgt-visits')) localStorage.setItem('tgt-visits', '1');
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
    if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
  }, ['99999999-9999-4999-8999-999999999999']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e}`));
  return { ctx, page };
}
const PHONE = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };
const listText = (page) => page.getByTestId('area-courses').innerText();
const rowNames = async (page, id = 'area-course') => (await page.getByTestId(id).allInnerTexts()).map((t) => t.split('\n')[0].replace(/ ✨ suggested$/, '').trim());
// ---------------------------------------------------------------- A–D: phone
{
  const { ctx, page } = await context(PHONE);
  const wait = (ms = 400) => page.waitForTimeout(ms);
  await page.goto(`${BASE}#/plan/${PLAN}/build`);
  await page.getByTestId('area-course').first().waitFor({ timeout: 15000 }); await wait(800);
  const first = await rowNames(page);
  check(first.length === 12, `the list shows a page of 12 (${first.length})`);
  check(/Within 40 min of Pokolbin and Cessnock · 19 courses/.test(await listText(page)), 'says how far and how many');
  const dots = await page.locator('[data-testid="tb-map"] path.leaflet-interactive').count();
  check(dots >= 19, `every course within the drive is a dot on the map (${dots})`);
  check((await listText(page)).includes('All 19 are on the map'), 'and the list says the rest are on the map');
  await page.screenshot({ path: `${SHOTS}/p-01-list-and-map.png`, fullPage: true });

  // A. A dot that isn't in the list → its summary → + Put on the table.
  // The Lone Pine dot (its name label sits 12 px right of the dot and 10 px up).
  await page.getByTestId('tb-map').scrollIntoViewIfNeeded();
  const tip = page.locator('[data-testid="tb-map"] .pm-tip [data-testid="place-tip"]');
  check(!first.includes('Lone Pine Golf Club'), 'Lone Pine isn’t in the first page of the list');
  const lb = await page.locator('[data-testid="tb-map"] .pm-label', { hasText: 'Lone Pine' }).first().boundingBox();
  if (lb) await page.touchscreen.tap(lb.x - 12, lb.y + 10);
  await page.waitForTimeout(400);
  const unlisted = (await tip.innerText({ timeout: 2000 }).catch(() => '')).split('\n')[0].trim() === 'Lone Pine Golf Club' ? 'Lone Pine Golf Club' : null;
  check(!!unlisted, 'tap its dot → its summary');
  const act = tip.getByTestId('place-tip-action');
  check((await act.innerText().catch(() => '')) === '+ Put on the table', 'the summary has "+ Put on the table"');
  await page.screenshot({ path: `${SHOTS}/p-02-dot-summary.png` });
  await act.click(); await wait(600);
  check((state().areaCourses['Hunter Valley'] || []).includes(library.find((c) => c.name === unlisted).id), 'it goes on the table');
  check((await act.innerText().catch(() => '')).startsWith('✓ On the table'), 'the button says it’s on the table');
  check((await rowNames(page)).includes(unlisted) && await page.getByTestId('area-course').filter({ hasText: unlisted }).locator('input:checked').count() === 1, 'and the list shows it, ticked');
  await page.screenshot({ path: `${SHOTS}/p-03-dot-added.png`, fullPage: true });
  await page.mouse.click(5, 5); await page.touchscreen.tap(10, 300); await wait(300);

  // B. Filters.
  await page.getByTestId('cf-played-no').click(); await wait(600);
  check(!(await rowNames(page)).includes('Cypress Lakes Golf Club'), 'Not played: Cypress Lakes (played) drops out');
  check(state().courseFilters?.played === 'no', 'the filter is saved on the trip');
  await page.getByTestId('cf-stars').selectOption('4'); await wait(600);
  const starRows = await rowNames(page);
  check(starRows.includes('The Vintage Golf Club') && !starRows.includes('Links Valley Golf Club'), `★4+: The Vintage (other groups ★4.1) stays, Links Valley (★3.2) goes (${starRows.join(', ')})`);
  const kept = page.getByTestId('area-course').filter({ hasText: hunter[4].name });
  check(await kept.count() === 1 && (await kept.innerText()).includes('outside the filters'), 'a course on the table stays in the list, marked "outside the filters"');
  check(/\(Not played · ★4\+\)/.test(await listText(page)), 'the count line says which filters are on');
  await page.screenshot({ path: `${SHOTS}/p-04-filters.png`, fullPage: true });
  await page.getByTestId('cf-stars').selectOption('0'); await wait(400);
  const types = await page.getByTestId('cf-type').locator('option').allInnerTexts();
  check(types.includes('Links') && types.includes('Parkland') && !types.includes('Heathland'), `type: only the types the research has (${types.join(', ')})`);
  await page.getByTestId('cf-type').selectOption('links'); await wait(500);
  check((await rowNames(page)).filter((n) => !state().areaCourses['Hunter Valley'].some((id) => library.find((c) => c.id === id).name === n)).join() === 'Links Valley Golf Club', 'Links: just Links Valley (plus what’s on the table)');
  await page.getByTestId('cf-type').selectOption(''); await page.getByTestId('cf-played-any').click(); await wait(400);
  await page.getByTestId('cf-sort').selectOption('ranked'); await wait(500);
  const ranked = await rowNames(page);
  check(ranked[0] === 'The Vintage Golf Club' && ranked[1] === 'Cypress Lakes Golf Club', `Top ranked first: #18 then #41 (${ranked.slice(0, 2).join(', ')})`);
  await page.reload();
  await page.getByTestId('area-course').first().waitFor({ timeout: 15000 }); await wait(800);
  check(await page.getByTestId('cf-sort').inputValue() === 'ranked' && (await rowNames(page))[0] === 'The Vintage Golf Club', 'remembered after a reload');
  await page.getByTestId('cf-sort').selectOption('suggested'); await wait(400);

  // C. Show more, then search wider.
  await page.getByTestId('show-more').click(); await wait(400);
  check((await rowNames(page)).length === 19, 'Show more: the rest of the 19');
  const wider = page.getByTestId('search-wider');
  check((await wider.innerText()) === 'Search wider: within 40 min of Pokolbin and Cessnock → 45 min', `then it offers a longer drive (${await wider.innerText()})`);
  await wider.click(); await wait(900);
  check(state().courseReach?.['Hunter Valley'] === 45, 'the longer drive is saved on the trip');
  check((await page.getByTestId('cf-reach').inputValue()) === '45', 'the drive filter shows 45 min');
  await page.getByTestId('search-wider').click(); await wait(1000);
  check(state().courseReach?.['Hunter Valley'] === 60, 'and again: 1 h');
  check(libCalls.length >= 3 && libCalls.at(-1).p_east - libCalls.at(-1).p_west > libCalls[0].p_east - libCalls[0].p_west, 'each step searches a bigger box');
  const all = await page.getByTestId('area-courses').innerText();
  check(all.includes('within 1 h') || all.includes('Within 1 h'), 'says "Within 1 h"');
  await page.getByTestId('cf-sort').selectOption('drive'); await wait(300);
  while (await page.getByTestId('show-more').count()) { await page.getByTestId('show-more').click(); await wait(200); }
  const far = await rowNames(page);
  check(far.includes('Newcastle Golf Club') && far.includes('Stockton Dunes Golf'), 'the Newcastle courses turn up');
  check(far.at(-1) === 'Stockton Dunes Golf' || far.at(-2) === 'Stockton Dunes Golf' || far.slice(-4).includes('Newcastle Golf Club'), 'closest first puts them near the end');
  await page.screenshot({ path: `${SHOTS}/p-05-search-wider.png`, fullPage: true });
  await page.getByTestId('cf-reach').selectOption('40'); await page.getByTestId('cf-sort').selectOption('suggested'); await wait(600);

  // D. On the way.
  const ow = page.getByTestId('area-onway');
  check((await ow.innerText()).includes('Inner West'), 'On the way: from the trip’s starting point');
  await ow.getByTestId('onway-toggle').click(); await wait(1200);
  const wayNames = (await ow.getByTestId('onway-course').allInnerTexts()).map((t) => t.split('\n')[0]);
  check(wayNames.includes('Gosford Golf Club') && wayNames.includes('Wyong Golf Club'), `Gosford and Wyong are on the way (${wayNames.join(', ')})`);
  check(!wayNames.includes('Strathfield Golf Club') && !wayNames.includes('Lithgow Golf Club'), 'not the home course, not one well off the drive');
  check(/On the way up or back · about \d+ min off the drive · .+ from Inner West/.test(await ow.innerText()), 'each says how far off the drive, and from where');
  await ow.getByTestId('onway-course').filter({ hasText: 'Gosford' }).getByRole('checkbox').check(); await wait(600);
  check(state().areaCourses['Hunter Valley'].includes(L(51)), 'tick it → on the table for the area');
  const gos = page.getByTestId('area-course').filter({ hasText: 'Gosford' });
  check(await gos.count() === 1 && (await gos.innerText()).includes('On the way up or back'), 'the area’s list shows it, as on the way');
  check(await page.locator('[data-testid="tb-map"] .pm-label', { hasText: '🚗 Wyong' }).count() === 1, 'the others are on the map with 🚗');
  await ow.getByTestId('onway-detour').selectOption('45'); await wait(1200);
  check(state().onWayDetour === 45, 'the detour is saved on the trip');
  await ow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/p-06-on-the-way.png`, fullPage: true });
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w <= 376, `no sideways scroll at 375px (${w})`);
  await ctx.close();
}

// ---------------------------------------------------------------- E: laptop — your own part of the map
{
  const { ctx, page } = await context(LAPTOP);
  const wait = (ms = 400) => page.waitForTimeout(ms);
  await page.goto(`${BASE}#/plan/${PLAN}/build`);
  await page.getByTestId('area-course').first().waitFor({ timeout: 15000 }); await wait(900);
  await page.screenshot({ path: `${SHOTS}/l-01-laptop.png` });
  const map = page.locator('[data-testid="tb-map"]').first();
  const mb = await map.boundingBox();
  // Drag the map so Nelson Bay (east of the Hunter) is in the middle: the scale from the Pokolbin and Cessnock pins.
  const pinAt = async (n) => { const b = await map.locator('.tb-stay', { hasText: n }).first().boundingBox(); return { x: b.x + 14, y: b.y + 14 }; };
  const pk = await pinAt('Pokolbin'); const ce = await pinAt('Cessnock');
  const pxLng = (ce.x - pk.x) / (151.36 - 151.29); const pxLat = (ce.y - pk.y) / (-32.83 - -32.78);
  const target = { x: pk.x + (152.13 - 151.29) * pxLng, y: pk.y + (-32.73 - -32.78) * pxLat };
  const mid = { x: mb.x + mb.width / 2, y: mb.y + mb.height / 2 };
  const dx = target.x - mid.x; const dy = target.y - mid.y;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (mb.width * 0.6));
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x - dx / steps, mid.y - dy / steps, { steps: 12 });
    await page.mouse.up(); await wait(300);
  }
  await page.screenshot({ path: `${SHOTS}/l-01b-panned.png` });
  await page.getByTestId('search-here').click(); await wait(1000);
  const view = page.getByTestId('area-view');
  check(await view.count() === 1, '🔍 Search this part of the map → the courses in view');
  const inView = (await view.getByTestId('view-course').allInnerTexts()).map((t) => t.split('\n')[0]);
  check(inView.includes('Nelson Bay Golf Club') && inView.includes('Horizons Golf Resort'), `Port Stephens courses in view (${inView.join(', ')})`);
  await view.getByTestId('cf-type').selectOption('coastal'); await wait(400);
  const coastal = (await view.getByTestId('view-course').allInnerTexts()).map((t) => t.split('\n')[0]);
  check(coastal.includes('Nelson Bay Golf Club') && !coastal.includes('Horizons Golf Resort'), 'the same filters work on it (Coastal)');
  await view.getByTestId('cf-type').selectOption(''); await wait(300);
  const saveBtn = view.getByTestId('save-custom-area');
  check((await saveBtn.innerText()).includes('Custom: around Nelson Bay'), `named after the nearest town (${await saveBtn.innerText()})`);
  await page.screenshot({ path: `${SHOTS}/l-02-search-this-part.png` });
  await saveBtn.click(); await wait(1200);
  const st = state();
  check(st.regionOptions.includes('Custom: around Nelson Bay') && st.customAreas?.['Custom: around Nelson Bay']?.north > -32.72, 'saved as an area on the trip, with its part of the map');
  check((st.pins || []).some((p) => p.area === 'Custom: around Nelson Bay'), 'with a place to stay in the middle of it');
  check((await page.getByTestId('area-chips').innerText()).includes('Custom: around Nelson Bay'), 'it’s one of the areas up the top');
  await page.getByTestId('area-course').first().waitFor({ timeout: 10000 }); await wait(500);
  const own = await page.getByTestId('area-courses').innerText();
  check(own.includes('Courses — Custom: around Nelson Bay') && own.includes('Your own part of the map') && own.includes('Nelson Bay Golf Club'), 'its own course list, from its part of the map');
  check(!own.includes('Hunter Course'), 'without the Hunter courses');
  await page.getByTestId('area-courses').getByLabel('Nelson Bay Golf Club').check(); await wait(500);
  check((state().areaCourses['Custom: around Nelson Bay'] || []).includes(L(41)), 'and its own courses on the table');
  await page.screenshot({ path: `${SHOTS}/l-03-custom-area.png` });
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll passed');
process.exit(fails.length ? 1 : 0);
