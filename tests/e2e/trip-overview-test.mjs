// Trip overview (Josh, 21 Oct): past and coming trips open on Overview; organising is a tap away.
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
const TRIP2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const COURSE2 = 'cccccccc-0000-4000-8000-000000000002';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const R3 = 'dddddddd-0000-4000-8000-000000000003';
const PAST = 'eeeeeeee-0000-4000-8000-000000000004';
const NEXT = 'eeeeeeee-0000-4000-8000-000000000002';
const IDEA = 'eeeeeeee-0000-4000-8000-000000000003';
const now = new Date().toISOString();
// 22 Oct: finished days ago but its trip is still 'active'; and a past trip brought in with only a year.
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const SC_TRIP = 'aaaaaaaa-0000-4000-8000-000000000005';
const SC_PLAN = 'eeeeeeee-0000-4000-8000-000000000005';
const YEAR_TRIP = 'aaaaaaaa-0000-4000-8000-000000000006';
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const card = (round, pid, strokes) => holes.map((h) => ({ round_id: round, subject_id: pid, subject_type: 'player', hole: h.n, strokes, picked_up: false, updated_at: now }));
const PIX = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

const db = {
  players: [
    { id: P1, name: 'Josh M', nickname: 'Josh', handicap: 14, approved: true, created_at: now },
    { id: P2, name: 'Mike Morris', nickname: 'Mike', handicap: 18, approved: true, created_at: now },
    { id: P3, name: 'Adam H', nickname: 'Adam', handicap: 22, approved: true, created_at: now },
  ],
  trips: [
    { id: TRIP, name: 'South Coast 2026', start_date: '2026-03-06', end_date: '2026-03-08', status: 'done', created_at: now },
    { id: TRIP2, name: 'Summer Classic', start_date: '2027-01-15', end_date: '2027-01-17', status: 'upcoming', created_at: now },
    { id: SC_TRIP, name: 'South Coast Trip 2026', start_date: daysAgo(6), end_date: daysAgo(4), status: 'active', created_at: now },
    { id: YEAR_TRIP, name: 'Hunter Valley 2019', start_date: '2019-01-01', end_date: '2019-01-01', status: 'locked', created_at: now },
  ],
  trophies: [], teams: [], team_players: [], quick_results: [],
  honour_board: [{ id: 'h1000000-0000-4000-8000-000000000001', trip_id: TRIP, trophy_name: 'BD Trophy', winner_names: 'Josh', label: '2026', created_at: now }],
  courses: [{ id: COURSE, name: 'Mollymook Hilltop', holes, created_at: now }, { id: COURSE2, name: 'Port Macquarie GC', holes, created_at: now }],
  rounds: [
    { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Saturday', play_date: '2026-03-07', format: 'stableford', status: 'locked', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now },
    { id: R2, trip_id: TRIP2, course_id: COURSE2, name: 'Friday', play_date: '2027-01-15', format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now },
    { id: R3, trip_id: TRIP2, course_id: COURSE, name: 'Saturday', play_date: '2027-01-16', format: 'ambrose', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now },
  ],
  round_players: [P1, P2].map((p) => ({ round_id: R1, player_id: p, playing_handicap: 14 })),
  scores: [...card(R1, P1, 4), ...card(R1, P2, 5)],
  plans: [
    { id: NEXT, kind: 'trip', name: 'Summer Classic', status: 'confirmed', start_date: '2027-01-15', end_date: '2027-01-17', location_name: 'Port Macquarie', trip_id: TRIP2, proposed: false, rsvp_locked: false, created_by: P1, organiser_id: P1, created_at: now },
    { id: IDEA, kind: 'trip', name: 'Autumn Idea', status: 'planning', proposed: false, rsvp_locked: false, created_by: P2, organiser_id: P2, created_at: now },
    { id: SC_PLAN, kind: 'trip', name: 'South Coast Trip 2026', status: 'confirmed', start_date: daysAgo(6), end_date: daysAgo(4), location_name: 'Narooma', trip_id: SC_TRIP, proposed: false, rsvp_locked: false, created_by: P1, organiser_id: P1, created_at: now },
    { id: PAST, kind: 'trip', name: 'South Coast 2026', status: 'done', start_date: '2026-03-06', end_date: '2026-03-08', location_name: 'Mollymook', trip_id: TRIP, proposed: false, created_by: P1, created_at: now },
  ],
  plan_polls: [], plan_options: [], plan_votes: [], plan_comments: [],
  plan_items: [
    { id: 'i1000000-0000-4000-8000-000000000001', plan_id: NEXT, kind: 'job', title: 'Book the minibus', owner_id: P1, done: false, sort: 0, created_at: now },
    { id: 'i1000000-0000-4000-8000-000000000002', plan_id: NEXT, kind: 'bring', title: 'Balls', sort: 0, created_at: now },
  ],
  plan_costs: [], plan_payments: [], plan_transfers: [], notify_prefs: [], plan_groups: [], plan_group_members: [],
  groups: [{ id: 'a0a0a0a0-0000-4000-8000-00000000000a', vote_decider: 'admin' }],
  plan_rsvps: [P1, P2, P3].map((p) => ({ plan_id: NEXT, player_id: p, status: 'in', updated_at: now })),
  tribunal_cases: [], tribunal_votes: [], rules: [], comps: [], group_features: [],
  posts: [
    { id: 'p1000000-0000-4000-8000-000000000001', trip_id: TRIP, kind: 'user', body: 'pic', photo_url: PIX, created_at: now },
    { id: 'p1000000-0000-4000-8000-000000000002', trip_id: TRIP, kind: 'user', body: 'pic 2', photo_url: PIX, created_at: now },
  ],
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
      else if (v === 'not.is.null') { if (r[k] == null) return false; }
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
  if (url.pathname.startsWith('/rest/v1/rpc/')) { writes.push({ method: 'RPC', table: url.pathname.split('/').pop(), body: req.postData() ? JSON.parse(req.postData()) : null }); return json(url.pathname.endsWith('start_trip_votes') ? 2 : null); }
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
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://luogyzvrbedmicjejilr.supabase.co/**', fakeSupabase);
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated', is_anonymous: true } }));
  try { localStorage.setItem('tgt-notify-prompt', String(Date.now())); } catch {}
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const noSideScroll = async (label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};


// 1. A past trip opens on its overview: results first.
await page.goto(`${BASE}#/plan/${PAST}`);
await page.getByRole('tab', { name: '⛳ Overview' }).waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
check(await page.getByRole('tab', { name: '⛳ Overview' }).getAttribute('aria-selected') === 'true', 'past trip: opens on Overview');
check(await page.getByText('Done and dusted').isVisible(), 'past trip: says it’s done');
check(await page.getByText('🏆 Honours').isVisible() && await page.getByText('BD Trophy').isVisible(), 'past trip: honours shown');
check(await page.getByText('Mollymook Hilltop').first().isVisible(), 'past trip: the course is listed');
check(await page.getByText(/🏆 Josh · \d+ pts/).isVisible(), 'past trip: the round’s winner with points');
check(await page.getByRole('link', { name: '▶ Watch the replay' }).isVisible(), 'past trip: replay button on the finished round');
check(!(await page.getByRole('tab', { name: /Vote|Kitty/ }).first().isVisible().catch(() => false)), 'past trip: organising tabs are tucked away');
await page.screenshot({ path: `${SHOTS}/1-past.png`, fullPage: true });
await noSideScroll('past overview');

// 2. Organise is one tap away.
await page.getByRole('tab', { name: '🧰 Organise' }).click();
await page.getByRole('tab', { name: '💬 Chat' }).waitFor({ timeout: 5000 });
check(true, 'Organise shows the planner tabs');
await page.getByRole('tab', { name: '⛳ Overview' }).click();
await page.getByText('🏆 Honours').waitFor({ timeout: 5000 });
check(true, 'and back to the overview');

// 3. A coming trip: countdown, who's in, the plan by day, your bits.
await page.goto(`${BASE}#/plan/${NEXT}`);
await page.getByText('🗓️ The plan').waitFor({ timeout: 15000 });
await page.waitForTimeout(600);
check(await page.getByText(/^In \d+ days$/).isVisible(), 'coming trip: countdown');
check(await page.getByText('3 in').isVisible(), 'coming trip: who’s in');
check(await page.getByText('Fri 15 Jan', { exact: true }).isVisible() && await page.getByText('Sat 16 Jan', { exact: true }).isVisible(), 'coming trip: the plan by day');
check(await page.getByText('Port Macquarie GC', { exact: true }).first().isVisible() && await page.getByText('Ambrose').first().isVisible(), 'coming trip: course and format per day');
// ov25: an Upcoming trip shows The run-up — your to-dos replace "Your bits".
check(await page.getByTestId('runup').isVisible() && /days to go · Port Macquarie · Fri 15 – Sun 17 Jan/.test(await page.getByTestId('runup-countdown').innerText()), 'coming trip: The run-up with its countdown');
check(/Book the minibus/.test(await page.getByTestId('runup-todos').innerText()), 'coming trip: your job is in your to-dos');
check(/your own list \(1: balls\)/i.test(await page.getByTestId('runup-bring').innerText()), 'coming trip: your own bring list is mentioned');
await page.screenshot({ path: `${SHOTS}/2-next.png`, fullPage: true });
await noSideScroll('coming overview');
await page.getByTestId('todo-job').getByRole('button', { name: 'Open' }).click();
await page.getByRole('tab', { name: '📋 Jobs' }).waitFor({ timeout: 5000 });
check(await page.getByRole('tab', { name: '📋 Jobs' }).getAttribute('aria-selected') === 'true', 'a job in your to-dos opens Organise on Jobs');

// 4. A trip still being decided opens on Organise.
await page.goto(`${BASE}#/plan/${IDEA}`);
await page.getByRole('tab', { name: '🧰 Organise' }).waitFor({ timeout: 15000 });
check(await page.getByRole('tab', { name: '🧰 Organise' }).getAttribute('aria-selected') === 'true', 'deciding trip: opens on Organise');

// 5. A trip with no plan gets the overview at /trip/:id.
db.plans = db.plans.filter((p) => p.id !== PAST);
await page.goto(`${BASE}#/plan`);
await page.getByText('South Coast 2026').first().waitFor({ timeout: 15000 });
await page.getByText('South Coast 2026').first().click();
await page.getByText('Done and dusted').waitFor({ timeout: 10000 });
check(page.url().includes(`/trip/${TRIP}`), 'trip with no plan: opens its overview');

// A trip that finished days ago, its trip still 'active': Done, never On now.
await page.goto(`${BASE}#/plan/${SC_PLAN}`);
await page.getByText('South Coast Trip 2026').first().waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
check(await page.getByText('Done and dusted').isVisible(), 'finished but still active: says Done');
check(!/on now/i.test(await page.locator('.page').innerText()), 'finished but still active: no "On now"');
await page.screenshot({ path: `${SHOTS}/o5-finished-active.png`, fullPage: true });
// A year-only past trip (from the import): the year, not a made-up 1 January.
await page.goto(`${BASE}#/trip/${YEAR_TRIP}`);
await page.getByText('2019 (date unknown)').first().waitFor({ timeout: 10000 });
check(!/1 Jan/.test(await page.locator('.page').innerText()), 'year-only trip: "2019 (date unknown)", no 1 January');
await page.screenshot({ path: `${SHOTS}/o6-year-only.png`, fullPage: true });

check(!errors.length, `no page errors (${errors.join(' | ')})`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
