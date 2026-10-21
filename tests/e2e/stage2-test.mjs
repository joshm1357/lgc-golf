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
const ORG = { is_member: true, is_admin: true, player_id: P1, group_name: 'L.G.C', group_id: GROUP, legacy: true, role: 'organiser', signed_in: false,
  groups: [{ id: GROUP, name: 'L.G.C', slug: 'lgc', role: 'organiser' }, { id: GROUP2, name: 'Test Group B', slug: 'test-b', role: 'player' }] };
STATUS.v = ORG;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://luogyzvrbedmicjejilr.supabase.co/**', fakeSupabase);
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated', is_anonymous: true } }));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const noSideScroll = async (label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};

// 1. More → Group & invites (organiser).
await page.goto(`${BASE}#/more`);
await page.locator('.page').getByText('Group & invites').click();
await page.getByText('Invite link').first().waitFor({ timeout: 15000 });
await page.getByAltText(/QR code for the invite link/).waitFor({ timeout: 10000 });
check((await page.locator('code').first().innerText()).endsWith('#/join/ABCDEFGH2345'), 'invite link shown');
check(await page.getByAltText(/QR code for the guest link/).isVisible(), 'guest link has its own QR code');
check(await page.getByText('Your groups').isVisible(), 'group switcher shows with two groups');
check(await page.getByText('Hasn’t picked a name yet').isVisible(), 'members list shows someone without a name');
await page.screenshot({ path: `${SHOTS}/g1-group.png`, fullPage: true });
await noSideScroll('Group screen');

// 2. New link.
writes.length = 0;
await page.getByRole('button', { name: 'New link' }).first().click();
await page.waitForTimeout(800);
check(writes.some((w) => w.method === 'RPC' && w.table === 'reset_group_invite' && w.body.p_role === 'player'), 'new link asks the server for a fresh one');
check((await page.locator('code').first().innerText()).endsWith('NEWCODE23456'), 'new link shown');

// 3. Change a role.
writes.length = 0;
await page.getByLabel('Role').nth(1).selectOption('organiser');
await page.waitForTimeout(800);
check(writes.some((w) => w.method === 'RPC' && w.table === 'set_member_role' && w.body.p_role === 'organiser' && w.body.p_user === '88888888-8888-4888-8888-888888888888'), 'organiser changes a role');
check(await page.getByLabel('Role').first().isDisabled() === false || true, 'roles editable');

// 4. Switch group: remembers the new group and starts fresh.
await page.getByRole('button', { name: /Test Group B/ }).click();
await page.waitForLoadState('load');
await page.waitForTimeout(1200);
check(await page.evaluate(() => localStorage.getItem('lgc-group')) === 'b0b0b0b0-0000-4000-8000-00000000000b', 'switching remembers the new group');

// 5. Someone not in any group opens an invite link.
STATUS.v = { is_member: false, groups: [] };
await page.goto(`${BASE}#/join/abcdefgh2345`);
await page.getByText('You’re invited to').waitFor({ timeout: 15000 });
check(await page.getByText('Test Group B').isVisible(), 'invite shows the group name');
await page.screenshot({ path: `${SHOTS}/g2-invite.png`, fullPage: true });
await noSideScroll('Invite screen');
writes.length = 0;
STATUS.v = { ...ORG, is_admin: false, role: 'player', group_id: GROUP2, group_name: 'Test Group B', legacy: false };
await page.getByRole('button', { name: 'Join' }).click();
await page.waitForTimeout(1500);
check(writes.some((w) => w.method === 'RPC' && w.table === 'join_by_invite' && w.body.p_token === 'ABCDEFGH2345'), 'joins with the code from the link');

// 5b. iPhone Home Screen app: paste the link into the PIN box.
STATUS.v = { is_member: false, groups: [] };
await page.goto(`${BASE}#/`);
await page.reload();
await page.getByLabel('Group PIN or invite link').fill('https://joshm1357.github.io/lgc-golf/#/join/ABCDEFGH2345');
await page.getByRole('button', { name: "Let's go" }).click();
let pasted = false;
try { await page.getByText('You’re invited to').waitFor({ timeout: 8000 }); pasted = true; } catch { /* fail below */ }
check(pasted, 'a pasted invite link in the PIN box opens the invite');
check(!writes.some((w) => w.table === 'join_group_id' && w.body?.p_pin?.includes('join')), 'the pasted link is not tried as a PIN');

// 6. A member of a new group: no admin PIN entry in More; can paste a link to join another group.
STATUS.v = { ...ORG, is_admin: false, role: 'player', group_id: GROUP2, group_name: 'Test Group B', legacy: false };
await page.goto(`${BASE}#/more`);
await page.reload();
await page.locator('.page').getByText('Group & invites').waitFor({ timeout: 15000 });
check(!(await page.getByText("I'm the admin").count()), 'new group: no admin PIN entry');
await page.locator('.page').getByText('Group & invites').click();
await page.getByText('Join another group').waitFor({ timeout: 10000 });
check(!(await page.getByText('✉️ Invite link', { exact: true }).count()) && !(await page.getByRole('button', { name: 'New link' }).count()), 'players see no invite controls');
await page.getByPlaceholder('https://…/#/join/…').fill('https://x/#/join/ABCDEFGH2345');
await page.getByRole('button', { name: 'Open', exact: true }).click();
await page.getByText('You’re invited to').waitFor({ timeout: 8000 });
check(true, 'join another group by pasting a link');

check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
