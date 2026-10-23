// ov23 browser check (23 Oct 2026): weekends, areas, the vote's depth, comps in the run-up. Fake database only.
// Josh: every weekend in the window as a shortlist; no accommodation in step 1; the search links use the real head
// count; "+ Add another area"; vote just the areas or go into the detail (optional for voters); summary lines and
// details on the vote cards; primary and backup weekends; "open it up"; how long as a vote; the Overview is the same
// for everyone; comps, rules and handicaps in Organise -> Comps & on the day; no Ryder Cup in early planning.
// Usage: node tests/e2e/weekends-comps-test.mjs <base> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4389/lgc-golf/';
const SHOTS = process.argv[3] || './shots-trip-builder';
const RSHOTS = process.argv[4] || SHOTS; // ov17: the course research screenshots
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(RSHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000f';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const T23 = 'cccccccc-0000-4000-8000-000000000023';
const OWN_NOWRA = 'dddddddd-0000-4000-8000-000000000001';
const now = new Date().toISOString();
const pid = (i) => `${String(i + 1).padStart(8, '0')}-2222-4222-8222-222222222222`;
const K = pid(0);
const names = ['Josh', 'Al', 'Bo', 'Cy', 'Di', 'Ed', 'Fin', 'Gus', 'Hal', 'Ian', 'Jo', 'Kev'];
const players = names.map((n, i) => ({ id: pid(i), name: `${n} Test`, nickname: n, handicap: 10 + i, approved: true, created_at: now }));
const L = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const library = [
  { id: L(1), name: 'Shoalhaven Heads GC', area: 'Shoalhaven Heads NSW', lat: -34.85, lng: 150.73, holes: 18, facts: [] },
  { id: L(2), name: 'Nowra GC', area: 'Nowra NSW', lat: -34.87, lng: 150.61, holes: 18, facts: [], mine_avg: 4.5, mine_n: 6, played: true },
  { id: L(3), name: 'Gerringong GC', area: 'Gerringong NSW', lat: -34.75, lng: 150.82, holes: 18, facts: [] },
  { id: L(4), name: 'Worrigee Links', area: 'Nowra NSW', lat: -34.75, lng: 150.543, holes: 18, facts: [] },
  { id: L(5), name: 'Kiama GC', area: 'Kiama NSW', lat: -34.67, lng: 150.85, holes: 18, facts: [] },
  { id: L(6), name: 'Mollymook Hilltop', area: 'Mollymook NSW', lat: -35.33, lng: 150.46, holes: 18, facts: [], others_avg: 4.3, others_n: 2 },
];
const stayAreas = [
  ['Kiama', 'South Coast NSW', -34.67, 150.85], ['Shoalhaven Heads', 'South Coast NSW', -34.85, 150.74], ['Nowra', 'South Coast NSW', -34.88, 150.60],
  ['Jervis Bay (Huskisson)', 'South Coast NSW', -35.04, 150.67], ['Ulladulla', 'South Coast NSW', -35.36, 150.47],
  ['Cessnock', 'Hunter Valley', -32.83, 151.36], ['Pokolbin', 'Hunter Valley', -32.78, 151.29],
].map(([name, region, lat, lng], i) => ({ id: crypto.randomUUID(), name, state: 'NSW', region, lat, lng, sort: i }));

const db = {
  players,
  trips: [{ id: T23, name: 'South Coast trip', start_date: '2023-03-10', end_date: '2023-03-12', status: 'locked', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], round_pins: [], scores: [], round_players: [],
  honour_board: [{ id: crypto.randomUUID(), trip_id: T23, trophy_name: 'BD', label: '2023', winner_names: 'Kurt', player_ids: [], sort_key: 1, created_at: now }],
  courses: [{ id: OWN_NOWRA, name: 'Nowra GC', library_id: L(2), holes, created_at: now }],
  rounds: [{ id: crypto.randomUUID(), trip_id: T23, course_id: OWN_NOWRA, play_date: '2023-03-11', format: 'stableford', status: 'locked', name: 'Sat', created_at: now }],
  plans: [{ id: PLAN, kind: 'trip', name: 'Spring trip', status: 'planning', start_date: null, end_date: null, proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, created_at: now }],
  plan_polls: [], plan_options: [], plan_votes: [], plan_comments: [], plan_items: [], plan_costs: [], plan_payments: [], plan_transfers: [], notify_prefs: [],
  plan_rsvps: players.map((p) => ({ plan_id: PLAN, player_id: p.id, status: 'in', updated_at: now })),
  plan_groups: [], plan_group_members: [],
  groups: [{ id: GROUP, vote_decider: 'admin' }],
  tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  player_home_areas: [],
  trip_start_points: [{ id: crypto.randomUUID(), group_id: GROUP, plan_id: PLAN, label: 'Inner West', lat: -33.88, lng: 151.16, headcount: 12, leave_after: '06:00', finish_by: '17:00', sort: 0 }],
  trip_finds: [], course_notes: [], course_ratings: [], stay_areas: stayAreas, trip_builds: [], trip_tee_options: [], course_booking_info: [], vote_batches: [],
  group_features: ['feed', 'planner', 'planner_tasks', 'trip_finder', 'ai_helper'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
  // ov17 (088): Josh's course research, shared reference data read straight from the table.
  course_research: [
    { library_id: L(2), name: 'Nowra Golf Club', town: 'North Nowra', state: 'NSW', fee_weekday: 45, fee_weekend: 50, access_type: 'public', good_for_groups: 4,
      booking_url: 'https://nowra.miclub.com.au/cms/public-bookings/', group_enquiry_url: 'https://nowragolf.example/groups', phone: '02 4421 0000 (pro shop)',
      email: 'golf@nowragolf.example', last_checked: '2026-10-01', sources: ['https://www.golfnsw.org.au/golf-clubs/nowra-golf-club/'],
      details: { style: 'parkland', members_times: 'Wed and Sat mornings are member comps (club site, Oct 2026)', visitor_times: 'Sat after 12pm; Sun after 11am',
        stay_and_play: 'Partner motels in Nowra', good_for_groups: '4 - cheap, close to Jervis Bay', group_bookings_how: 'Golf shop for 12+' } },
    { library_id: L(4), name: 'Worrigee Links', town: 'Worrigee', state: 'NSW', fee_weekday: 44, access_type: 'public', good_for_groups: 3, last_checked: '2026-10-01', details: {} },
  ],
};
let asPlayer = false;
const rpcCalls = [];
const notifyCalls = [];
const aiCalls = [];
const match = (r, k, v) => {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(r[k]));
  if (v.startsWith('is.')) return v === 'is.null' ? r[k] == null : true;
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
  if (name === 'my_status') return { is_member: true, is_admin: !asPlayer, player_id: asPlayer ? pid(1) : K, group_name: 'Test Golfers', group_id: GROUP, role: asPlayer ? 'player' : 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Test Golfers', slug: 'test', role: asPlayer ? 'player' : 'organiser' }] };
  if (name === 'trip_finder_courses') return library;
  if (name === 'trip_finder_places') return [];
  if (name === 'copy_library_course') {
    const l = library.find((x) => x.id === body.p_id);
    const had = db.courses.find((c) => c.library_id === body.p_id);
    if (had) return had.id;
    const c = { id: crypto.randomUUID(), group_id: GROUP, name: l.name, library_id: l.id, holes, created_at: new Date().toISOString() };
    db.courses.push(c);
    return c.id;
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
  if (p.startsWith('/functions/v1/notify')) { notifyCalls.push(JSON.parse(req.postData() || '{}')); return json({ sent: 0 }); }
  if (p.startsWith('/functions/v1/ai-helper')) {
    const b = JSON.parse(req.postData() || '{}');
    aiCalls.push(b);
    return json({ draft: { visitor_times: 'Sat 7:00-12:00', phone: '02 4421 0000', booking_method: 'phone', features: ['parkland', 'bar'] }, checkedWeb: false, warning: 'The AI couldn’t check the web — this is from memory. Check it before you save.' });
  }
  if (p.startsWith('/functions/v1/')) return json({ sent: 0 });
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const conflict = url.searchParams.get('on_conflict') || (table === 'plan_rsvps' ? 'plan_id,player_id' : table === 'plan_votes' ? 'option_id,player_id' : null);
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const keys = conflict ? conflict.split(',') : null;
        const old = keys && rows.find((r) => keys.every((k) => String(r[k]) === String(b[k])));
        if (old) { Object.assign(old, b); made.push(old); continue; }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b };
        if (table === 'plan_items') { row.done ??= false; row.created_by ??= K; }
        if (table === 'plan_polls') { row.status ??= 'open'; row.created_by ??= K; }
        if (table === 'trip_tee_options') row.times = [...new Set(row.times)].sort();
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
const state = () => db.trip_builds.find((b) => b.plan_id === PLAN)?.state || {};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.route('https://server.arcgisonline.com/**', (r) => r.fulfill({ status: 204, body: '' }));
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());
const wait = (ms = 500) => page.waitForTimeout(ms);
const step = (k) => page.locator(`[data-testid="tb-step-${k}"]`);

// ----------------------------------------------------------------------------------------------- ov23 fixtures
const SHOTS2 = SHOTS;
const soonISO = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
library.push(
  { id: L(7), name: 'Cypress Lakes', area: 'Pokolbin NSW', lat: -32.79, lng: 151.30, holes: 18, facts: [] },
  { id: L(8), name: 'The Vintage', area: 'Rothbury NSW', lat: -32.74, lng: 151.33, holes: 18, facts: [] },
);
db.course_research.push({ library_id: L(7), name: 'Cypress Lakes', town: 'Pokolbin', state: 'NSW', fee_weekday: 89, fee_weekend: 99, access_type: 'public', good_for_groups: 5, last_checked: '2026-10-01', details: { style: 'resort' } });
db.players.push({ id: pid(12), name: 'Lou Test', nickname: 'Lou', handicap: 22, approved: true, created_at: now }, { id: pid(13), name: 'Mo Test', nickname: 'Mo', handicap: 7, approved: true, created_at: now });
db.plan_rsvps = []; // nobody's said "in" yet: the head count is the group (14), never a made-up 12
db.region_guides = [
  { title: 'NSW: Hunter, Newcastle, Port Stephens, Central Coast', kind: 'region', regions: ['Hunter Valley', 'Central Coast'], body: 'Lots of courses close together. Busy on long weekends.', sort: 1, active: true },
  { title: 'NSW & ACT: Illawarra, South Coast, Southern Highlands', kind: 'region', regions: ['Shoalhaven / South Coast', 'Illawarra'], body: 'Beach towns with plenty of golf.', sort: 2, active: true },
];
// A second trip, locked in, with its trip in the app: the run-up (comps, rules, handicaps).
const PLAN2 = 'eeeeeeee-0000-4000-8000-000000000002';
const T26 = 'cccccccc-0000-4000-8000-000000000026';
const soon = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
db.trips.push({ id: T26, name: 'Summer trip', start_date: soon(20), end_date: soon(22), status: 'locked', created_at: now });
db.plans.push({ id: PLAN2, kind: 'trip', name: 'Summer trip', status: 'confirmed', start_date: soon(20), end_date: soon(22), trip_id: T26, proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, created_at: now, location_name: 'Kiama' });
db.trophies.push({ id: 'aaaaaaaa-0000-4000-8000-0000000000f1', trip_id: T26, name: 'Putt Buddies', type: 'ambrose', created_at: now });
db.comps = [
  { id: 'aaaaaaaa-0000-4000-8000-0000000000c1', group_id: GROUP, trip_id: T26, name: 'BD Trophy', kind: 'individual_points', round_ids: [], settings: {}, sort: 0, retired: false, created_at: now },
  { id: 'aaaaaaaa-0000-4000-8000-0000000000c2', group_id: GROUP, trip_id: T26, name: 'Noodle Cup', kind: 'manual', round_ids: [], settings: {}, sort: 1, retired: false, created_at: now },
  { id: 'aaaaaaaa-0000-4000-8000-0000000000c3', group_id: GROUP, trip_id: T26, name: 'The Cup', kind: 'cup', round_ids: [], settings: {}, sort: 2, retired: false, created_at: now },
];
db.rules.push({ id: 'aaaaaaaa-0000-4000-8000-0000000000a1', group_id: GROUP, title: 'Gimmes inside the leather', value: null, category: 'other', applies_to: ['all'], status: 'active', created_at: now },
  { id: 'aaaaaaaa-0000-4000-8000-0000000000a2', group_id: GROUP, title: 'Mulligan on the first tee', category: 'other', applies_to: ['all'], status: 'proposed', created_at: now });
db.handicap_history = [{ id: crypto.randomUUID(), player_id: pid(1), old_handicap: 13, new_handicap: 11, reason: 'Tribunal', created_at: '2026-10-03T01:00:00Z' }];
db.cases = [{ id: crypto.randomUUID(), group_id: GROUP, status: 'open', title: 'Kev’s handicap', subject_kind: 'players.handicap', subject_ref: { table: 'players', id: pid(11), field: 'handicap' }, created_at: now }];

// Each step at phone (375) and laptop (1440) widths, in order.
const both = async (name) => {
  for (const [w, h] of [[375, 812], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h }); await wait(500);
    await page.screenshot({ path: `${SHOTS2}/${name}-${w}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 812 }); await wait(300);
};
const tb = async () => { await page.goto(`${BASE}#/plan/${PLAN}/build`); await page.reload(); await step('area').waitFor({ timeout: 15000 }); await wait(600); };
await tb();
const area = step('area');

// 1. The areas we're considering: + Add another area (search + the region guide), a chip each, ✕ to take one off.
check(await page.getByTestId('area-bar').innerText().then((t) => t.includes('The areas we’re considering')), 'step 1 starts with "The areas we’re considering"');
await page.getByLabel('Area').fill('South');
await page.locator('[data-testid="tb-region-hits"]').getByRole('button', { name: '+ South Coast NSW' }).click(); await wait();
await page.getByTestId('add-area').click(); await wait(300);
check(await page.getByTestId('region-guides').count() === 1, 'the add-area panel offers the region guide to browse');
await page.getByTestId('region-guides').locator('summary').click(); await wait(200);
await page.getByTestId('region-guides').getByRole('button', { name: '+ Hunter Valley' }).click(); await wait();
await page.getByTestId('add-area').click(); await wait(300);
await page.getByLabel('Area').fill('Ulla');
await page.locator('[data-testid="tb-region-hits"]').getByRole('button').first().click(); await wait();
check(JSON.stringify(state().regionOptions) === JSON.stringify(['South Coast NSW', 'Hunter Valley']), `adding an area that's already there just opens it (${JSON.stringify(state().regionOptions)})`);
check(await page.getByTestId('area-chip').count() === 2, 'two area chips');
const tabTitles = (await page.locator('.tb-steps').locator('.tb-step').allInnerTexts()).map((t) => t.replace(/^\S+\s/, '').replace(/ ↗$/, ''));
check(JSON.stringify(tabTitles) === JSON.stringify(['Areas & weekends', 'Courses & stays', 'Call the courses', 'Pick & lock in', 'Jobs & money', 'The run-up']), `the builder's step bar is the same six steps as Organise (${tabTitles.join(' · ')})`);
await both('flow-01-area-chips');
// Add one more, then take it off with ✕.
const extra = { id: crypto.randomUUID(), name: 'Bowral', state: 'NSW', region: 'Southern Highlands', lat: -34.48, lng: 150.42, sort: 99 };
db.stay_areas.push(extra);
await tb();
await page.getByTestId('add-area').click(); await page.getByLabel('Area').fill('Southern');
await page.locator('[data-testid="tb-region-hits"]').getByRole('button', { name: '+ Southern Highlands' }).click(); await wait();
check(await page.getByTestId('area-chip').count() === 3 && await page.getByTestId('area-start').isVisible(), 'a new area gets its chip and its own page');
await page.locator('[data-testid="area-chip"][data-area="Southern Highlands"]').getByTestId('area-remove').click(); await wait();
check(JSON.stringify(state().regionOptions) === JSON.stringify(['South Coast NSW', 'Hunter Valley']) && await page.getByTestId('area-chip').count() === 2, '✕ takes an area off the table');
// Each area's courses and places (for the detail).
await page.locator('[data-testid="area-chip"][data-area="South Coast NSW"]').getByRole('button').first().click(); await wait();
await page.locator('[data-testid="area-courses"]').getByLabel('Gerringong GC').check(); await wait(300);
await page.locator('[data-testid="area-courses"]').getByLabel('Kiama GC').check(); await wait(300);
await page.locator('[data-testid="area-stays"]').getByLabel('Kiama').check(); await wait(300);
await page.locator('[data-testid="area-stays"]').getByLabel('Shoalhaven Heads').check(); await wait(300);
await both('flow-02a-area-page-south-coast');
await page.locator('[data-testid="area-chip"][data-area="Hunter Valley"]').getByRole('button').first().click(); await wait(800);
await page.locator('[data-testid="area-courses"]').getByLabel('Cypress Lakes').check(); await wait(300);
await page.locator('[data-testid="area-stays"]').getByLabel('Pokolbin').check(); await wait(300);
await both('flow-02b-area-page-hunter');
check(state().areaCourses?.['Hunter Valley']?.length === 1 && state().areaStays?.['South Coast NSW']?.length === 2, 'each area has its own courses and places');
// Compare: the areas side by side.
await page.getByTestId('area-compare-tab').click(); await wait(500);
check(await page.getByTestId('compare-area').count() === 2, 'Compare: the two areas side by side');
await both('flow-03-compare');
await page.locator('[data-testid="area-chip"][data-area="Hunter Valley"]').getByRole('button').first().click(); await wait(600);

// 2. Every weekend in the window, by month, with tags; tick any number into the shortlist.
const months = await page.getByTestId('weekend-month').count();
const chips = await page.getByTestId('weekend-chip').count();
check(months >= 6 && chips >= 22, `every weekend for the next 6 months, grouped by month (${months} months, ${chips} weekends)`);
const firstChip = await page.getByTestId('weekend-chip').first().innerText();
check(/^Fri \d+( [A-Z][a-z]{2})? – Sun \d+ [A-Z][a-z]{2}/.test(firstChip), `chips read "Fri 6 – Sun 8 Mar" (${firstChip.split('\n')[0]})`);
const tags = await page.getByTestId('weekend-tags').allInnerTexts();
check(tags.some((t) => /School holidays/.test(t)) && tags.some((t) => /Long weekend|Day/.test(t)), `long weekends and school holidays are tagged (${tags.slice(0, 3).join(' | ')})`);
for (let i = 2; i < 9; i++) { await page.getByTestId('weekend-chip').nth(i).click(); await wait(250); }
check(state().weekends?.length === 7 && await page.getByTestId('shortlist-weekend').count() === 7, `seven weekends on the shortlist — no cap of 3 (${state().weekends?.length})`);
await page.getByLabel('Own dates from').fill(soonISO(100)); await page.getByLabel('Own dates to').fill(soonISO(102));
await page.getByTestId('custom-dates').getByRole('button', { name: '+ Add' }).click(); await wait(300);
check(state().weekends?.length === 8 && state().weekends.some((w) => w.custom), 'your own dates go on the shortlist too');
// How long: let the group vote (1, 2, 3 nights).
await page.getByTestId('length-vote').check(); await wait(300);
check(state().lengthVote?.on === true, '"Let the group vote on how long" is on');
check(/\(2 nights\)/.test(await page.getByTestId('weekend-chip').first().innerText()), 'weekend chips show their dates for the length');
// No accommodation in step 1.
check(await area.getByTestId('stay-search').count() === 0 && await area.getByTestId('accom-idea').count() === 0, 'no accommodation search links or ideas in step 1');
check(!(await area.innerText()).includes('Ryder'), 'no Ryder Cup in early planning');
await page.getByTestId('extras').getByRole('button').first().click(); await wait(200);
check(await page.getByTestId('comps-later').isVisible() && !(await page.getByTestId('extras').innerText()).includes('Ryder'), 'extras: no Ryder Cup, and "comps get sorted closer to the trip"');
// Who's coming: the group (14) until someone sets it.
check(/14 — everyone in the group/.test(await page.getByTestId('tb-headcount').innerText()), 'who’s coming: 14 (the group), not a default 12');
await page.getByLabel('How many coming').fill('9'); await wait(400);
check(state().headcount === 9 && state().headcountBy === 'organiser', 'the organiser sets 9');
await both('flow-04-step1-weekends-length-headcount');

// 3. Call the vote: choose how deep. Areas only = just the main questions; areas + contents = the detail under each.
// ov35: two cards — "Call both" puts When? and Where? out in one message (each still closes on its own).
await page.getByTestId('call-both').click();
await page.getByTestId('vote-depth').waitFor({ timeout: 5000 });
await page.getByTestId('vote-depth').getByRole('button', { name: 'Areas only' }).click(); await wait(300);
const onlyQs = await page.getByTestId('ballot-section').locator('strong').allInnerTexts();
check(JSON.stringify(onlyQs) === JSON.stringify(['Which area?', 'Which weekend?', 'How long?']), `areas only: ${onlyQs.join(' / ')}`);
check(await page.getByTestId('preview-detail').count() === 0, 'areas only: no detail in the preview');
await both('flow-05a-call-vote-areas-only');
await page.getByTestId('vote-depth').getByRole('button', { name: 'Areas + what’s in them' }).click(); await wait(300);
const fullQs = await page.getByTestId('ballot-section').locator('strong').allInnerTexts();
check(fullQs.includes('Hunter Valley: which courses?') && fullQs.includes('South Coast NSW: where to stay?') && fullQs.includes('How long?'), `areas + contents: ${fullQs.join(' / ')}`);
check(await page.getByTestId('preview-detail').count() >= 3 && (await page.getByTestId('ballot-preview').innerText()).includes('If it’s Hunter Valley — optional detail'), 'the preview groups the detail under each area');
await both('flow-05b-call-vote-areas-and-detail');
await page.getByTestId('call-the-vote').click();
await page.getByTestId('how-it-goes-out').waitFor({ timeout: 8000 });
await page.getByRole('button', { name: 'Done' }).click(); await wait(800);
const batch = db.vote_batches[0];
const vpolls = db.plan_polls.filter((p) => p.vote_batch === batch?.id);
check(vpolls.filter((p) => !p.optional).map((p) => p.question).join('|') === 'Which area?|Which weekend?|How long?', `main questions: ${vpolls.filter((p) => !p.optional).map((p) => p.question).join(', ')}`);
check(vpolls.filter((p) => p.optional).map((p) => `${p.area}:${p.question}`).join('|') === 'South Coast NSW:South Coast NSW: which courses?|South Coast NSW:South Coast NSW: where to stay?|Hunter Valley:Hunter Valley: which courses?|Hunter Valley:Hunter Valley: where to stay?', 'the detail is optional, tagged with its area');
const cyp = db.plan_options.find((o) => o.label === 'Cypress Lakes');
check(/Resort · ★5 for groups · \$89\/\$99 · about/.test(cyp?.notes || ''), `a course's summary line on the ballot (${cyp?.notes})`);
const hunter = db.plan_options.find((o) => o.label === 'Hunter Valley');
check(/course(s)? within 30 min/.test(hunter?.notes || '') && /Lots of courses close together\./.test(hunter?.notes || ''), `an area's summary line (${hunter?.notes})`);

// 4. The voter's ballot (Overview): area + weekends + how long are the questions; the detail is optional per area.
await page.goto(`${BASE}#/plan/${PLAN}?view=overview`);
await page.getByTestId('overview-votes').waitFor({ timeout: 15000 });
const card = page.locator('[data-testid="vote-batch"]').first();
check(await card.getByTestId('vote-batch-section').count() === 3, 'the main questions: area, weekend, how long');
// ov26 V3: "Are you in?" first, a header line with how many are in; V2: each weekend says what a longer trip adds.
const order = await card.locator('[data-testid="vote-batch-keen"], [data-testid="vote-batch-section"]').evaluateAll((els) => els.map((e) => e.dataset.testid));
check(order[0] === 'vote-batch-keen', `V3: "Are you in?" comes first (${order.join(', ')})`);
check(/\d+ in so far$/.test(await card.getByTestId('ballot-header').innerText()), `V3: the header line (${await card.getByTestId('ballot-header').innerText()})`);
const wkNotes = db.plan_options.filter((o) => o.start_date && /^Sat /.test(o.label) && o.poll_id === db.plan_polls.find((p) => p.vote_batch === batch?.id && p.question === 'Which weekend?')?.id).map((o) => o.notes || '');
check(wkNotes.length > 0 && wkNotes.every((n) => /if we go 3 nights/.test(n)), `V2: each weekend says what 3 nights adds (${wkNotes[0]}); a custom range keeps its own dates`);
check(await card.getByTestId('vote-detail-area').count() === 2 && await card.getByTestId('vote-detail-section').count() === 0, 'the detail sits under each area, folded away');
check((await card.getByTestId('vote-detail-area').first().innerText()).includes('Go into the detail →'), '"Go into the detail →"');
check(await card.getByTestId('option-summary-line').count() >= 2, 'options show their summary line on the card');
check(!(await page.locator('.section').first().innerText()).includes('Organise this trip'), 'the Overview has no "Organise this trip"');
check(await page.getByText('Build the trip', { exact: true }).count() === 0, 'the Overview has no "Build the trip" for the organiser');
// Details: the ⓘ opens a sheet; it never casts a vote.
await card.getByTestId('vote-detail-area').nth(1).getByRole('button').first().click(); await wait(400);
const before = db.plan_votes.length;
await card.getByTestId('vote-detail-section').first().getByTestId('option-details').first().click(); await wait(600);
check(await page.getByTestId('tb-course').isVisible() && await page.getByTestId('sheet-toggle').count() === 0, 'ⓘ Details opens the same course sheet as the planning maps (ov22), read-only');
check(db.plan_votes.length === before, 'opening details didn’t cast a vote');
await both('flow-06a-option-details-sheet');
await page.keyboard.press('Escape'); await wait(400);
// Answer only the main questions → answered.
await card.getByTestId('vote-batch-section').nth(0).getByRole('button', { name: '⭐ Keen' }).nth(1).click(); await wait(500);
const wkSection = card.getByTestId('vote-batch-section').nth(1);
const wkButtons = await wkSection.getByRole('button', { name: '✓ Yes' }).count();
for (let i = 0; i < wkButtons; i++) { await wkSection.getByRole('button', { name: '✓ Yes' }).nth(i).click(); await wait(250); }
await card.getByTestId('vote-batch-section').nth(2).getByRole('button', { name: '⭐ Keen' }).nth(2).click(); await wait(500);
await card.getByTestId('vote-batch-keen').getByRole('button', { name: '✓ Yes' }).click(); await wait(600);
check(await card.getByTestId('voter-thanks').isVisible(), 'answering the area, weekends and how long counts as answered — the detail is a bonus');
// And go into the detail for Hunter Valley.
await card.getByTestId('vote-detail-section').first().getByRole('button', { name: '⭐ Keen' }).first().click(); await wait(500);
await both('flow-06b-voter-ballot-main-and-detail');
await page.setViewportSize({ width: 1440, height: 900 });
await page.reload(); await page.getByTestId('overview-votes').waitFor({ timeout: 15000 }); await wait(800);
await page.getByTestId('voted').getByRole('button').first().click(); await wait(600); // 'You\u2019ve voted — see results or change my votes'
check((await page.getByTestId('option-summary-line').first().isVisible()), 'laptop: the summary line shows too (and the row has a hover tooltip)');
check(await page.locator('[data-testid="ballot-option"][title]').count() >= 2, 'laptop: hover tooltips on the options');
await page.setViewportSize({ width: 375, height: 812 });

// 5. Results in the builder: the winner, the rankings inside each area, how many went into the detail. Choose it.
// Two more people vote: Hunter Valley and Pokolbin win; 3 nights wins.
const pollQ = (q) => vpolls.find((p) => p.question === q);
const optL = (poll, label) => db.plan_options.find((o) => o.poll_id === poll.id && o.label === label);
for (const who of [pid(2), pid(3)]) {
  db.plan_votes.push({ id: crypto.randomUUID(), poll_id: pollQ('Which area?').id, option_id: optL(pollQ('Which area?'), 'Hunter Valley').id, player_id: who, response: 'yes', created_at: now });
  db.plan_votes.push({ id: crypto.randomUUID(), poll_id: pollQ('How long?').id, option_id: optL(pollQ('How long?'), '3 nights').id, player_id: who, response: 'yes', created_at: now });
}
// V2: one more says yes to every weekend but only to 2 nights — the organiser's told to check with them.
for (const o of db.plan_options.filter((x) => x.poll_id === pollQ('Which weekend?').id)) db.plan_votes.push({ id: crypto.randomUUID(), poll_id: o.poll_id, option_id: o.id, player_id: pid(4), response: 'yes', created_at: now });
db.plan_votes.push({ id: crypto.randomUUID(), poll_id: pollQ('How long?').id, option_id: optL(pollQ('How long?'), '2 nights').id, player_id: pid(4), response: 'yes', created_at: now });
await tb();
await page.getByTestId('vote-card-where').waitFor({ timeout: 8000 });
const ln = await page.getByTestId('length-check').innerText().catch(() => '');
check(/^3 nights won, so it’s \w{3} \d+ – \w{3} \d+ \w{3}\. 1 person only said yes to a shorter trip — check with them\. \(\w+/.test(ln.trim()), `V2: who to check with (${ln})`);
const hv = page.locator('[data-testid="result-area"][data-area="Hunter Valley"]');
// V4: how many of the Where? voters went into the detail. ov35: the votes are separate now, so it's out of the 3
// who answered Where? (the 4th only answered When?) — 1 of 3 is a third, enough to go by.
check((await hv.innerText()).includes('LEADING') && (await hv.getByTestId('result-detail').innerText()) === '1 of 3 went into the detail', `results: Hunter Valley leads; ${await hv.getByTestId('result-detail').innerText()}`);
check((await page.getByTestId('close-where').innerText()) === 'Close the vote and go with Hunter Valley' && (await page.getByTestId('close-where').count()) === 1, 'O2 + ov35: one gold “Close the vote and go with Hunter Valley”; other areas are under “Other ways”');
check(/3 nights/.test(await page.getByTestId('result-length').innerText()), 'results: 3 nights is leading');
check(/^1\. [\s\S]*LEADING[\s\S]*\n2\. /.test(await page.getByTestId('result-weekends').innerText()) && !/Primary|Backup/.test(await page.getByTestId('result-weekends').innerText()), 'results: the weekends ranked by votes, plain words (v10.5)');
check(/🔒/.test(await step('calls').innerText()), 'Call the courses is locked until the area is chosen');
await both('flow-07-organiser-results');
await page.getByTestId('close-where').click(); await wait(800);
check(state().region === 'Hunter Valley' && state().stays?.map((s) => s.name).join(',') === 'Pokolbin', `chosen: Hunter Valley, Pokolbin ticked for step 2 (${state().stays?.map((s) => s.name)})`);
check(!state().weekendsSettled, 'ov35: going with the area leaves the weekend to its own vote');
check(/^Closed — Hunter Valley won \d+–\d+$/.test((await page.getByTestId('vote-card-where').getByTestId('vote-status').innerText()).replace(/^✓ /, '')), `ov35: Where? says Closed (${await page.getByTestId('vote-card-where').getByTestId('vote-status').innerText()})`);
await page.getByTestId('close-when').click(); await wait(800);
check(state().weekendsSettled === true && state().weekends.length === 2 && state().nights === 3, `primary and backup weekends at 3 nights (${JSON.stringify(state().weekends?.map((w) => [w.start, w.end]))})`);
const posts0 = (db.posts || []).filter((p) => /^(📍|📅) Spring trip — /.test(p.body || ''));
check(posts0.length === 2 && /we’re going to Hunter Valley\..*Still to decide: when\./.test(posts0[0].body) && /the weekend’s decided: \w{3} \d+ – \w{3} \d+ \w{3} \(3 nights\)\..*Next: ringing the courses/.test(posts0[1].body), `I4 + ov35: one result post per vote in the Feed (${posts0.map((p) => p.body).join(' | ')})`);
check(state().days.find((d) => d.leg === 'stay')?.options?.length >= 1, 'stay days pre-filled with the area’s courses');
await step('area').getByRole('button').first().click(); await wait(400);
check(/The weekend: [\s\S]*If the courses can’t fit you: /.test(await page.getByTestId('tb-weekends-settled').innerText()), 'step 1 shows "The weekend" and the fallback in plain words (v10.5)');
check(await page.getByTestId('result-card').count() === 2 && await page.getByTestId('result-calendar').first().isVisible(), 'I4: the result cards (one per vote), with Share and Add to calendar');
await both('flow-08-chosen-primary-backup');
await step('calls').getByRole('button').first().click(); await wait(500);
check(!(await step('calls').innerText()).includes('After:') && await page.getByTestId('tb-make-calls').isVisible(), 'Call the courses is unlocked for the winning area');
await both('flow-09-call-the-courses-unlocked');

// 6. Step 2: where to stay — search links with the right head count (9), and you can change it.
await step('courses').getByRole('button').first().click(); await wait(800);
const ideas = page.getByTestId('stay-ideas');
check(await ideas.isVisible() && /for 9 people · 5\+ bedrooms/.test(await ideas.getByTestId('stay-headcount').innerText()), 'step 2: "for 9 people · 5+ bedrooms"');
const hrefs = await ideas.locator('a.btn').evaluateAll((as) => as.map((a) => a.href));
check(hrefs.length === 3 && hrefs.every((h) => /adults=9\b|group_adults=9\b/.test(h)) && hrefs.some((h) => h.includes('min_bedrooms=5')), `every search link is for 9 (${hrefs.map((h) => (h.match(/adults=\d+/) || [])[0]).join(', ')})`);
await ideas.getByRole('button', { name: 'Change' }).click();
await ideas.getByLabel('People for the search').fill('11'); await wait(500);
check(state().headcount === 11 && (await ideas.locator('a.btn').first().getAttribute('href')).includes('group_adults=11'), 'changing it here updates the links and the trip');
await both('flow-10-step2-stays-headcount');

// 7. Call the courses: locked until the area's chosen; the script says Primary / Backup; open it up.
await step('calls').getByRole('button').first().click(); await wait(500);
check(/Primary:[\s\S]*Backup:/.test(await page.getByTestId('tb-call-weekends').innerText()), 'the calls ask about the primary and backup weekends');
await page.getByTestId('tb-make-calls').click(); await wait(1000);
const callBody = db.plan_items.find((i) => i.kind === 'job' && /Call/.test(i.title))?.body || '';
check(/^Primary: .*; Backup: /.test(callBody), `the call job's script: ${callBody.split('\n')[0]}`);
await page.getByTestId('open-it-up').waitFor({ timeout: 5000 });
const n0 = state().weekends.length;
await page.getByTestId('open-up-weekend').click(); await wait(1200);
check(state().weekends.length === n0 + 1 && state().weekendsSettled, 'open it up: the next weekend from the vote goes on as another backup');
await both('flow-11-calls-open-it-up');
await page.getByTestId('open-up-area').click();
await page.getByTestId('confirm-sheet').waitFor({ timeout: 5000 });
await page.getByTestId('confirm-yes').click(); await wait(1500);
await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {}); await wait(300); // the fresh vote's sheet
check(state().region === null && state().areaCourses?.['Hunter Valley']?.length >= 1, 'or re-open the area choice — nothing lost');
check(/Before you reopened \(1\)/.test(await page.getByTestId('before-reopened').innerText()), 'O5: the old work is kept under “Before you reopened”');
check((db.posts || []).some((p) => /didn’t work out, so where we go is open again/.test(p.body || '')), 'O5: one Feed post when the area re-opens');

// 8. Organise: the steps in the new order; the run-up in "Comps & on the day".
await page.goto(`${BASE}#/plan/${PLAN2}?view=organise&step=day`);
await page.getByTestId('organise-steps').waitFor({ timeout: 15000 }); await wait(800);
const titles = await page.locator('.org-step-title').allInnerTexts();
check(['Areas & weekends', 'Courses & stays', 'Call the courses', 'Pick & lock in', 'Jobs & money', 'The run-up'].every((t, i) => (titles[i] || '').startsWith(t)), `steps: ${titles.map((t) => t.replace(/\s*Now$/i, '')).join(' · ')}`);
const runup = page.getByTestId('comps-day');
await runup.waitFor({ timeout: 8000 });
const grabs = await runup.getByTestId('grab').allInnerTexts();
check(grabs.some((g) => g.includes('BD Trophy')) && grabs.some((g) => g.includes('Putt Buddies')) && grabs.some((g) => g.includes('Noodle Cup')) && !grabs.some((g) => g.includes('The Cup')), `what’s up for grabs (no Cup — the group doesn't use it): ${grabs.map((g) => g.split('\n')[0]).join(', ')}`);
await runup.getByLabel('Noodle Cup').click(); await wait(800);
check(db.comps.find((c) => c.name === 'Noodle Cup').retired === true, 'untick a comp: it’s not on for this trip');
check(/Gimmes inside the leather/.test(await runup.getByTestId('comps-rules').innerText()) && /Mulligan on the first tee/.test(await runup.getByTestId('rules-proposed').innerText()), 'rules for this trip, and what’s up for a vote');
check(await runup.getByTestId('propose-rule').getAttribute('href') === '#/governance/rulebook?propose=1', '"Propose a rule change" goes to the Rulebook');
const hcp = await runup.getByTestId('comps-handicaps').innerText();
check(/Was 13 → 11 on \d+ Oct · Tribunal/.test(hcp) && /disputed/.test(hcp), 'handicaps: last change and an open dispute');
check(await runup.getByTestId('review-handicaps').isVisible(), '"Review handicaps" before the first round');
await runup.getByRole('button', { name: '✓ Done — they’re right' }).click(); await wait(600);
check(await runup.getByTestId('review-handicaps').count() === 0, 'marked reviewed');
check(await page.getByTestId('teams-draw').isVisible(), 'then teams and the draw');
await page.locator('.toast').first().waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {}); await wait(4000); // the toast fades before the picture
await both('flow-12-organise-comps-and-on-the-day');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
