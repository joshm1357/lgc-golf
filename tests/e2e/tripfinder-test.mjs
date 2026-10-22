// Trip finder browser check (Stage 16), 21 Oct 2026. Fake database only — nothing real is touched.
// 12 players from two areas, a one-day trip → ranked list with reasons, map toggle, put two options to the group
// (a place vote is created), a rating after an earlier trip, the home suburb on a profile, and switched off → hidden.
// Usage: node tripfinder-test.mjs <base> <shotDir>   e.g. http://localhost:4325/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4325/lgc-golf/';
const SHOTS = process.argv[3] || './shots-tripfinder';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000f';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const PAST = 'eeeeeeee-0000-4000-8000-000000000002';
const now = new Date().toISOString();
const pid = (i) => `${String(i + 1).padStart(8, '0')}-2222-4222-8222-222222222222`;
const K = pid(0);
const names = ['Josh', 'Al', 'Bo', 'Cy', 'Di', 'Ed', 'Fin', 'Gus', 'Hal', 'Ian', 'Jo', 'Kev'];
const players = names.map((n, i) => ({ id: pid(i), name: `${n} Test`, nickname: n, handicap: 10 + i, approved: true, created_at: now }));
// 8 in the Inner West, 4 in Newcastle — all shared their home suburb.
const homes = players.map((p, i) => (i < 8
  ? { id: crypto.randomUUID(), group_id: GROUP, player_id: p.id, label: i % 3 ? 'Leichhardt' : 'Annandale', postcode: '2040', lat: -33.88 + (i % 3) * 0.01, lng: 151.16, share: true }
  : { id: crypto.randomUUID(), group_id: GROUP, player_id: p.id, label: 'Newcastle', postcode: '2300', lat: -32.93, lng: 151.78, share: true }));
const L = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const f = (fact, value, extra = {}) => ({ id: crypto.randomUUID(), fact, value, source: 'organiser', status: 'confirmed', checked_at: '2026-09-01', club: false, ...extra });
const library = [
  { id: L(1), name: 'Central Coast GC', area: 'Wyong NSW', lat: -33.30, lng: 151.42, holes: 18, facts: [f('visitor_times', 'Sat 7:00-13:00'), f('max_group', '16'), f('price_18', '95')], mine_avg: null, others_avg: 4.2, others_n: 3 },
  { id: L(2), name: 'Gosford GC', area: 'Gosford NSW', lat: -33.42, lng: 151.34, holes: 18, facts: [f('visitor_times', 'Sat 7:00-13:00'), f('max_group', '20', { club: true }), f('price_18', '70')] },
  { id: L(3), name: 'Unknown Links', area: 'Somersby NSW', lat: -33.37, lng: 151.29, holes: 18, facts: [] },
  { id: L(4), name: 'Small Club', area: 'Wyong NSW', lat: -33.28, lng: 151.45, holes: 9, facts: [f('max_group', '8')] },
  { id: L(5), name: 'Far Away GC', area: 'Cooma NSW', lat: -36.24, lng: 149.12, holes: 18, facts: [] },
  { id: L(6), name: 'Old Facts GC', area: 'Morisset NSW', lat: -33.10, lng: 151.48, holes: 18, facts: [f('visitor_times', 'Sat 7:00-13:00', { checked_at: '2025-01-01' }), f('max_group', '24', { status: 'pending' })] },
];
const db = {
  players,
  trips: [], trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], scores: [], round_players: [],
  courses: [], rounds: [],
  plans: [
    { id: PLAN, kind: 'round', name: 'Spring day out', status: 'planning', start_date: '2026-11-14', end_date: '2026-11-14', proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, created_at: now },
    { id: PAST, kind: 'round', name: 'Winter day out', status: 'done', start_date: '2026-07-11', end_date: '2026-07-11', location_name: 'Gosford GC', proposed: false, created_by: K, organiser_id: K, group_id: GROUP, created_at: now },
  ],
  plan_polls: [], plan_options: [], plan_votes: [], plan_comments: [], plan_items: [], plan_costs: [], plan_payments: [], plan_transfers: [], notify_prefs: [],
  plan_rsvps: players.map((p) => ({ plan_id: PLAN, player_id: p.id, status: 'in', updated_at: now })),
  plan_groups: [], plan_group_members: [],
  groups: [{ id: GROUP, vote_decider: 'admin' }],
  tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  player_home_areas: homes,
  trip_finds: [{ id: crypto.randomUUID(), group_id: GROUP, plan_id: PAST, holes: 18, max_drive_min: 180, preset: 'fair', filters: {}, picks: [], decided_course_id: L(2), created_at: now }],
  trip_start_points: [], course_notes: [], course_ratings: [],
  group_features: ['feed', 'planner', 'planner_tasks', 'trip_finder'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
const rpcCalls = [];
const osmCalls = [];
const match = (r, k, v) => {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
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
function rpc(name, body) {
  rpcCalls.push({ name, body });
  if (name === 'my_status') return { is_member: true, is_admin: true, player_id: K, group_name: 'Test Golfers', group_id: GROUP, role: 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Test Golfers', slug: 'test', role: 'organiser' }] };
  if (name === 'trip_finder_courses') return library;
  if (name === 'trip_finder_places') return [];
  if (name === 'trip_finder_to_group') {
    const poll = { id: crypto.randomUUID(), group_id: GROUP, plan_id: body.p_plan, kind: 'location', question: 'Where should we play?', status: 'open', created_by: K, created_at: new Date().toISOString() };
    db.plan_polls.push(poll);
    for (const o of body.p_options) db.plan_options.push({ id: crypto.randomUUID(), group_id: GROUP, poll_id: poll.id, label: o.label, address: o.address, notes: o.notes, cost_pp: o.cost_pp, created_by: K, created_at: new Date().toISOString() });
    return { poll_id: poll.id, new_poll: true, dates_poll_id: null, options: body.p_options.length };
  }
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
        if (table === 'trip_start_points') { row.lat = Math.round(row.lat * 100) / 100; row.lng = Math.round(row.lng * 100) / 100; }
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
// Map tiles and the OpenStreetMap search: answered here (no outside requests in a test).
await ctx.route('https://server.arcgisonline.com/**', (r) => r.fulfill({ status: 204, body: '' }));
await ctx.route('https://nominatim.openstreetmap.org/**', (r) => { osmCalls.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ lat: '-33.4269', lon: '151.3428', name: 'Gosford', address: { suburb: 'Gosford', postcode: '2250', 'ISO3166-2-lvl4': 'AU-NSW' } }]) }); });
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());

// 1. The trip: organisers see "Find a course" (Organise → Plan, ov14).
await page.goto(`${BASE}#/plan/${PLAN}?view=organise&step=plan`);
await page.locator('[data-testid="tf-link"]').waitFor({ timeout: 15000 });
check(true, 'the trip shows "Find a course" for the organiser');
await page.locator('[data-testid="tf-link"]').click();

// 2. Fill the starting points from the 12 shared home suburbs → two areas.
await page.getByRole('button', { name: /Fill in from 12 home suburbs/ }).click();
await page.getByText('Leichhardt ×8').first().waitFor({ timeout: 5000 });
const starts = db.trip_start_points;
check(starts.length === 2 && starts.map((s) => `${s.label}×${s.headcount}`).sort().join(',') === 'Leichhardt×8,Newcastle×4', `two starting areas saved (${starts.map((s) => `${s.label}×${s.headcount}`).join(', ')})`);
check(starts.every((s) => !('address' in s) && Math.abs(s.lat * 100 - Math.round(s.lat * 100)) < 1e-6), 'areas only, kept to about 1 km — no addresses');
check((await page.getByLabel('Players').inputValue()) === '12', 'players: 12 (from the headcounts)');
check(await page.getByText('12 players → 3 groups (4, 4, 4)').count() === 1, 'shows 3 groups of 4');

// 3. The ranked list, each row saying why.
await page.locator('[data-testid="tf-row"]').first().waitFor({ timeout: 8000 });
const rows = page.locator('[data-testid="tf-row"]');
const n = await rows.count();
const statuses = [];
for (let i = 0; i < n; i++) statuses.push(await rows.nth(i).getAttribute('data-status'));
const order = { fits: 0, check: 1, no: 2 };
check(n === 6 && statuses.every((s, i) => i === 0 || order[statuses[i - 1]] <= order[s]), `six courses, fits first then check then doesn't fit (${statuses.join(',')})`);
const why0 = await rows.nth(0).locator('[data-testid="tf-why"]').innerText();
check(/^Fits \d{1,2}:\d{2}–\d{1,2}:\d{2} · longest drive about \d h( \d{2})? · \$\d+/.test(why0), `top row says why: "${why0}"`);
const allWhy = await page.locator('[data-testid="tf-why"]').allInnerTexts();
check(allWhy.some((w) => w === 'Doesn’t fit: takes groups up to 8'), 'a too-small club says why it doesn’t fit');
check(allWhy.some((w) => /^Doesn’t fit: longest drive about .+ — over your 3 h limit$/.test(w)), 'a far course says it’s over the drive limit');
check(allWhy.some((w) => w.startsWith('Check visitor times and group size')), 'an unknown course says what to check');
await page.screenshot({ path: `${SHOTS}/1-list.png`, fullPage: true });

// Cheapest puts the $70 course first.
await page.getByRole('button', { name: 'Cheapest' }).click();
check((await rows.nth(0).locator('.tf-name').innerText()) === 'Gosford GC', 'Cheapest: Gosford ($70) first');
await page.getByRole('button', { name: 'Fair drive' }).click();

// 4. Map one tap away.
await page.getByRole('button', { name: 'Map' }).click();
await page.locator('[data-testid="tf-map"] .leaflet-container').waitFor({ timeout: 5000 });
const marks = await page.locator('[data-testid="tf-map"] path.leaflet-interactive').count();
check(marks >= 8, `map shows the 2 areas and 6 courses (${marks} shapes)`);
check(!(await page.locator('[data-testid="tf-list"]').count()), 'phone: the map replaces the list');
await page.screenshot({ path: `${SHOTS}/2-map.png`, fullPage: false });
await page.getByRole('button', { name: 'List' }).click();

// 5. A course's facts: shared, with where they came from and when — never who.
await page.getByRole('button', { name: 'Old Facts GC', exact: true }).click();
const sheet = page.locator('[data-testid="tf-course"]');
await sheet.waitFor({ timeout: 5000 });
const st = await sheet.innerText();
check(st.includes('check again') && st.includes('not confirmed yet') && st.includes('from an organiser'), 'old facts say "check again", unconfirmed say so');
await sheet.getByRole('button', { name: '+ Add or correct a fact' }).click();
await page.locator('[data-testid="tf-fact-form"] select').first().selectOption('price_18');
await page.getByLabel('Fact value').fill('85');
await page.getByRole('button', { name: 'Save fact' }).click();
await page.waitForTimeout(600);
const prop = rpcCalls.find((c) => c.name === 'propose_course_fact');
check(prop && prop.body.p_course === L(6) && prop.body.p_fact === 'price_18' && prop.body.p_value === '85', 'a fact is suggested through the database function (pending there)');
await page.getByLabel('Note').fill('Good bar, slow greens');
await sheet.getByRole('button', { name: 'Add', exact: true }).click();
await page.waitForTimeout(500);
check(db.course_notes.some((x) => x.body === 'Good bar, slow greens' && x.course_id === L(6)), 'a private group note is saved');
await page.screenshot({ path: `${SHOTS}/3-course.png`, fullPage: true });
await page.getByRole('button', { name: 'Close' }).click();

// 6. Tick two, put them to the group → a place vote with the facts attached.
await rows.nth(0).locator('.tf-tick').click();
await rows.nth(1).locator('.tf-tick').click();
await page.locator('[data-testid="tf-bar"]').waitFor();
await page.screenshot({ path: `${SHOTS}/4-ticked.png`, fullPage: false });
await page.getByRole('button', { name: 'Put to the group' }).click();
await page.waitForURL(/tab=vote/, { timeout: 8000 });
const call = rpcCalls.find((c) => c.name === 'trip_finder_to_group');
check(call && call.body.p_options.length === 2 && call.body.p_options.every((o) => o.course_id && /^Fits .+ · longest drive about/.test(o.notes) && o.start_date === '2026-11-14'), 'two options sent, each with its facts and the day');
const poll = db.plan_polls.find((x) => x.plan_id === PLAN && x.kind === 'location');
check(poll && db.plan_options.filter((o) => o.poll_id === poll.id).length === 2, 'a place vote is created with the two courses');
await page.getByText('Where should we play?').first().waitFor({ timeout: 8000 });
// The trip now opens with the organiser's next step card first; the vote card (with its options) is further down.
const voteText = await page.locator('body').innerText();
check(voteText.includes('Central Coast GC') || voteText.includes('Gosford GC'), 'the vote shows on the trip');
check(db.posts.some((x) => /up for a vote/.test(x.body)), 'posted to the feed');
await page.screenshot({ path: `${SHOTS}/5-vote.png`, fullPage: true });

// 7. After an earlier trip: one-tap rating.
await page.goto(`${BASE}#/plan/${PAST}`);
await page.locator('[data-testid="tf-rate"]').waitFor({ timeout: 10000 });
check((await page.locator('[data-testid="tf-rate"]').innerText()).includes('How was Winter day out') || (await page.locator('[data-testid="tf-rate"]').innerText()).includes('How was Gosford GC'), 'the rating asks about the course played');
await page.getByRole('button', { name: '4 out of 5' }).click();
await page.waitForTimeout(600);
check(db.course_ratings.some((r) => r.plan_id === PAST && r.course_id === L(2) && r.rating === 4 && r.player_id === K), 'rated 4 — saved for the group');
check(!(await page.locator('[data-testid="tf-link"]').count()), 'no "Find a course" on a finished trip');

// 8. My profile: the home suburb card.
db.player_home_areas = db.player_home_areas.filter((h) => h.player_id !== K);
await page.goto(`${BASE}#/player/${K}`);
await page.locator('[data-testid="home-area"]').waitFor({ timeout: 10000 }).catch(() => {});
const home = page.locator('[data-testid="home-area"]');
if (await home.count()) {
  await home.getByRole('button', { name: 'Add your home suburb' }).click();
  await home.getByLabel('Suburb or town').fill('Gosford');
  await home.getByRole('button', { name: 'Search' }).click();
  await home.getByRole('button', { name: /Gosford NSW 2250/ }).waitFor({ timeout: 5000 });
  check((await home.innerText()).includes('© OpenStreetMap contributors'), 'OpenStreetMap credit shown with its results');
  await home.getByRole('button', { name: /Gosford NSW 2250/ }).click();
  await home.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(600);
  const mine = db.player_home_areas.find((h) => h.player_id === K);
  check(mine && mine.label === 'Gosford' && mine.postcode === '2250' && mine.lat === -33.43 && mine.lng === 151.34 && mine.share === true, `home suburb saved as an area (${JSON.stringify(mine && { l: mine.label, lat: mine.lat, lng: mine.lng })})`);
  check(osmCalls.length === 1 && osmCalls[0].includes('featureType=settlement'), 'one OpenStreetMap search, for towns and suburbs only');
  await page.screenshot({ path: `${SHOTS}/6-profile.png`, fullPage: true });
} else check(false, 'home suburb card on my profile');

// 9. Desktop (1280 px): map and list side by side.
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}#/plan/${PLAN}/find`);
await page.locator('[data-testid="tf-row"]').first().waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
check(await page.locator('[data-testid="tf-list"]').count() === 1 && await page.locator('[data-testid="tf-map"]').count() === 1, 'desktop: list and map side by side');
await page.screenshot({ path: `${SHOTS}/7-desktop.png`, fullPage: false });
await page.setViewportSize({ width: 375, height: 812 });

// 10. Switched off: hidden.
db.group_features.find((x) => x.feature_key === 'trip_finder').enabled = false;
await page.goto(`${BASE}#/plan/${PLAN}`);
await page.reload();
await page.getByText('Spring day out').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
check(!(await page.locator('[data-testid="tf-link"]').count()), 'feature off: no "Find a course"');
await page.goto(`${BASE}#/plan/${PLAN}/find`);
await page.waitForTimeout(1500);
check(!(await page.locator('[data-testid="tf-starts"]').count()), 'feature off: the finder page is closed');
await page.goto(`${BASE}#/player/${K}`);
await page.waitForTimeout(1500);
check(!(await page.locator('[data-testid="home-area"]').count()), 'feature off: no home suburb card');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
