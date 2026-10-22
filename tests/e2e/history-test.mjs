// Stage 6 — History: past winners and handicaps. Phone-width browser check of the built app (dist/) against a fake database.
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
const NEXT = 'eeeeeeee-0000-4000-8000-000000000002';
const IDEA = 'eeeeeeee-0000-4000-8000-000000000003';
const PAST = 'eeeeeeee-0000-4000-8000-000000000004';
const POLL1 = 'abababab-0000-4000-8000-000000000001';
const POLL2 = 'abababab-0000-4000-8000-000000000002';
const now = new Date().toISOString();
const today = now.slice(0, 10);
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
  plans: [
    { id: PLAN, kind: 'trip', name: 'Spring Trip', status: 'planning', start_date: '2026-11-20', end_date: '2026-11-22', location_name: 'Bowral', proposed: false, rsvp_locked: false, created_by: P1, organiser_id: P1, created_at: now },
    { id: NEXT, kind: 'trip', name: 'Summer Classic', status: 'confirmed', start_date: '2027-01-15', end_date: '2027-01-18', location_name: 'Port Macquarie', proposed: false, rsvp_locked: false, created_by: P1, organiser_id: P1, created_at: now },
    { id: IDEA, kind: 'trip', name: 'Autumn Idea', status: 'planning', proposed: true, rsvp_locked: false, created_by: P2, organiser_id: P2, budget_pp: 600, created_at: now },
    { id: PAST, kind: 'trip', name: 'South Coast 2026', status: 'done', start_date: '2026-03-06', end_date: '2026-03-09', location_name: 'Mollymook', trip_id: TRIP, proposed: false, created_at: now },
  ],
  plan_polls: [
    { id: POLL1, plan_id: IDEA, kind: 'dates', question: 'Which weekend works?', status: 'open', closes_on: '2026-10-23', created_by: P2, created_at: now },
    { id: POLL2, plan_id: IDEA, kind: 'location', question: 'Where should we go?', status: 'open', created_by: P2, created_at: now },
  ],
  plan_options: [
    { id: 'o1000000-0000-4000-8000-000000000001', poll_id: POLL1, label: '13 Mar', start_date: '2027-03-12', end_date: '2027-03-14', created_by: P2, created_at: now },
    { id: 'o1000000-0000-4000-8000-000000000002', poll_id: POLL1, label: '20 Mar', start_date: '2027-03-19', end_date: '2027-03-21', created_by: P2, created_at: now },
    { id: 'o1000000-0000-4000-8000-000000000003', poll_id: POLL2, label: 'Mudgee', cost_pp: 450, created_by: P2, created_at: now },
  ],
  plan_votes: [], plan_comments: [{ id: 'c1000000-0000-4000-8000-000000000001', plan_id: IDEA, player_id: P2, body: 'Mudgee every time', created_at: now }],
  plan_items: [], plan_costs: [], plan_payments: [], plan_transfers: [], notify_prefs: [],
  groups: [{ id: 'a0a0a0a0-0000-4000-8000-00000000000a', vote_decider: 'admin' }],
  group_features: [{ group_id: 'a0a0a0a0-0000-4000-8000-00000000000a', feature_key: 'feed', enabled: false }, { group_id: 'a0a0a0a0-0000-4000-8000-00000000000a', feature_key: 'tribunal', enabled: false }],
  group_members: [
    { group_id: 'a0a0a0a0-0000-4000-8000-00000000000a', user_id: '99999999-9999-4999-8999-999999999999', player_id: P1, role: 'organiser', created_at: now },
    { group_id: 'a0a0a0a0-0000-4000-8000-00000000000a', user_id: '88888888-8888-4888-8888-888888888888', player_id: P2, role: 'player', created_at: now },
    { group_id: 'a0a0a0a0-0000-4000-8000-00000000000a', user_id: '77777777-7777-4777-8777-777777777777', player_id: null, role: 'guest', created_at: now },
  ],
  plan_rsvps: [P1, P2, P3].map((p) => ({ plan_id: PLAN, player_id: p, status: 'in', updated_at: now })),
  plan_groups: [{ id: ROOM, plan_id: PLAN, kind: 'room', name: 'Bunk room', capacity: 2, sort: 0, created_at: now }],
  plan_group_members: [{ group_id: ROOM, player_id: P2 }],
  tribunal_cases: [], tribunal_votes: [], posts: [{ id: 'p1000000-0000-4000-8000-000000000001', trip_id: TRIP, kind: 'user', body: 'pic', photo_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', created_at: now }], rules: [],
};

const writes = [];
const GROUP2 = 'b0b0b0b0-0000-4000-8000-00000000000b';
const STATUS = { v: null };
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
  if (url.pathname.startsWith('/rest/v1/rpc/my_status')) {
    // Like the real server: the group the phone names, if it's one of theirs.
    const asked = req.headers()['x-group-id'];
    const v = STATUS.v;
    const g = v.groups?.find((x) => x.id === asked);
    return json(g && v.is_member ? { ...v, group_id: g.id, group_name: g.name, role: g.role, is_admin: g.role === 'organiser' } : v);
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) { writes.push({ method: 'RPC', table: url.pathname.split('/').pop(), body: req.postData() ? JSON.parse(req.postData()) : null }); const name = url.pathname.split('/').pop();
    if (name === 'group_invite' || name === 'reset_group_invite') return json(name === 'reset_group_invite' ? 'NEWCODE23456' : 'ABCDEFGH2345');
    if (name === 'invite_info') return json({ group_id: GROUP2, group_name: 'Test Group B', role: 'player', already_in: false });
    if (name === 'join_by_invite') return json(GROUP2);
    if (name === 'import_honours' || name === 'import_handicaps') return json(JSON.parse(req.postData()).p_rows.length);
    return json(null); }
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
const NEW = { is_member: true, is_admin: true, player_id: P1, group_name: 'The Mulligans', group_id: GROUP, legacy: false, role: 'organiser', signed_in: false,
  look: { short_name: 'MULL', crest_url: null, primary: '#1F4B33', accent: '#E0B84A', font: 'serif' }, groups: [{ id: GROUP, name: 'The Mulligans', slug: 'mull', role: 'organiser' }] };
STATUS.v = NEW;
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
let dialogs = 0;
page.on('dialog', (d) => { dialogs++; d.accept(); });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const cssVar = (n) => page.evaluate((x) => getComputedStyle(document.documentElement).getPropertyValue(x).trim(), n);



const typeInto = async (label, text) => { const el = page.getByLabel(label); await el.fill(text); await page.waitForTimeout(250); };

// Organiser: paste past winners, a bad line blocks adding until fixed.
await page.goto(`${BASE}#/history`);
await page.getByText('🏆 Past winners').waitFor({ timeout: 15000 });
check(await page.getByRole('textbox', { name: 'Trophy name' }).isVisible(), 'no trophies yet: asks for the trophy name');
await page.getByRole('textbox', { name: 'Trophy name' }).fill('The Cup');
await page.getByRole('textbox', { name: 'Year' }).fill('2017');
await page.getByRole('textbox', { name: 'Winner(s)' }).fill('Josh M');
writes.length = 0;
await page.getByRole('button', { name: 'Add', exact: true }).click();
await page.waitForTimeout(800);
const w0 = writes.find((x) => x.table === 'import_honours');
check(!!w0 && w0.body.p_rows[0].trophy === 'The Cup' && w0.body.p_rows[0].label === '2017' && w0.body.p_rows[0].player_ids[0] === P1, 'adds one winner by hand');
await page.locator('select').first().selectOption('__each_line__');
await typeInto('Paste past winners', '2019, The Cup, Josh M & Mike Morris\n2018, The Cup, Adam H\njust words');
check(await page.getByText(/^Line 3:/).isVisible(), 'a line it can’t read is pointed out');
check(await page.getByRole('button', { name: /Add 2 winners/ }).isDisabled(), 'can’t add while a line is wrong');
await typeInto('Paste past winners', 'Hunter, The Cup, Adam H');
check(await page.getByText(/put the year first/).isVisible(), 'a winner with no year is refused (it couldn’t be put in order)');
await typeInto('Paste past winners', '2019, The Cup, Josh M & Mike Morris\n2018, The Cup, Adam H');
check(await page.getByText('2 matched to players').isVisible(), 'winners matched to players in the preview');
writes.length = 0;
await page.getByRole('button', { name: 'Add 2 winners' }).click();
await page.waitForTimeout(800);
const w1 = writes.find((x) => x.table === 'import_honours');
check(!!w1 && w1.body.p_rows.length === 2 && w1.body.p_rows[0].trophy === 'The Cup' && w1.body.p_rows[0].player_ids.join() === [P1, P2].join(), 'adds the winners with their players');
await page.screenshot({ path: `${SHOTS}/h1-winners.png`, fullPage: true });
let sw = await page.evaluate(() => document.scrollingElement.scrollWidth);
check(sw <= 375, `History: no sideways scroll (${sw}px)`);

// Past handicaps.
await page.getByRole('button', { name: 'Past handicaps' }).click();
await page.getByText('📈 Past handicaps').waitFor({ timeout: 5000 });
await typeInto('Paste past handicaps', 'Josh M, 1/6/2023, 14.2\nBob, 2022, 10');
check(await page.getByText(/no player called “Bob”/).isVisible(), 'an unknown player is pointed out');
await typeInto('Paste past handicaps', 'Josh M, 1/6/2023, 14.2\nMike, 2022, +1');
writes.length = 0;
await page.getByRole('button', { name: 'Add 2 handicaps' }).click();
await page.waitForTimeout(800);
const w2 = writes.find((x) => x.table === 'import_handicaps');
check(!!w2 && JSON.stringify(w2.body.p_rows) === JSON.stringify([{ player_id: P1, date: '2023-06-01', handicap: 14.2 }, { player_id: P2, date: '2022-01-01', handicap: -1 }]), 'adds the handicaps (dates read the Australian way, +1 is a plus handicap)');
await page.screenshot({ path: `${SHOTS}/h2-handicaps.png`, fullPage: true });
sw = await page.evaluate(() => document.scrollingElement.scrollWidth);
check(sw <= 375, `History handicaps: no sideways scroll (${sw}px)`);

// Trophy Room and past trips show history and app-made winners together, newest first.
db.honour_board = [
  { id: 'h1', trophy_name: 'The Cup', label: '2025', winner_names: 'Adam H', player_ids: [P3], sort_key: 10, imported: false, created_at: now },
  { id: 'h2', trophy_name: 'The Cup', label: '2019', winner_names: 'Josh M & Mike Morris', player_ids: [P1, P2], sort_key: 0, imported: true, created_at: now },
  { id: 'h3', trophy_name: 'The Cup', label: '2023', winner_names: 'Mike Morris', player_ids: [P2], sort_key: 0, imported: true, trip_id: TRIP, created_at: now },
];
await page.goto(`${BASE}#/trophies`);
await page.reload();
await page.getByText('HOLDER · 2025').waitFor({ timeout: 15000 });
const order = await page.locator('.plaque .yr').allInnerTexts();
check(order.join('|') === 'HOLDER · 2025|2023|2019', `Trophy Room: history and app-made winners together, newest first (${order.join(', ')})`);
check(await page.getByText('+ Add past winners from before the app').isVisible(), 'organiser can add past winners from the Trophy Room');
await page.screenshot({ path: `${SHOTS}/h3-trophies.png`, fullPage: true });
await page.goto(`${BASE}#/plan`);
await page.getByTestId('trips-section-done').waitFor({ timeout: 15000 }); // ov25: "Previous"
check(await page.getByText('Mike Morris', { exact: true }).first().isVisible() && await page.getByText(/🏆 The Cup:/).isVisible(), 'a past trip shows its winners');
await page.screenshot({ path: `${SHOTS}/h4-past-trip.png`, fullPage: true });

// A player can't add history.
STATUS.v = { ...NEW, is_admin: false, role: 'player', groups: [{ id: GROUP, name: 'The Mulligans', slug: 'mull', role: 'player' }] };
await page.goto(`${BASE}#/history`);
await page.reload();
await page.getByText('Only an organiser can add history.').waitFor({ timeout: 15000 });
check(true, 'a player is told only an organiser can add history');
await page.goto(`${BASE}#/trophies`);
await page.getByText('HOLDER · 2025').waitFor({ timeout: 15000 });
check(!(await page.getByText('+ Add past winners from before the app').count()), 'no add-history link for a player');

check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
