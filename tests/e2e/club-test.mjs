// Stage 8b — club partners (claim, club page, Josh approves). Phone-width browser check against a fake database.
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
  group_features: [{ group_id: 'a0a0a0a0-0000-4000-8000-00000000000a', feature_key: 'feed', enabled: false }, { group_id: 'a0a0a0a0-0000-4000-8000-00000000000a', feature_key: 'planner', enabled: false }, { group_id: 'a0a0a0a0-0000-4000-8000-00000000000a', feature_key: 'tribunal', enabled: false }],
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
    if (name === 'my_club') return json(CLUB.v);
    if (name === 'find_courses') return json(LIB);
    if (name === 'course_page') return json(PAGE.v);
    if (name === 'admin_club_claims') return json(CLAIMS);
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
const H = holes.map((h) => ({ n: h.n, par: h.n % 9 === 3 ? 3 : 4, si: h.n }));
const LIB = [
  { id: 'aaaa0000-0000-4000-8000-0000000000a1', slug: 'bowral-golf-club', name: 'Bowral Golf Club', area: 'Bowral NSW', holes: 18, greens: 18, osm: false, copies: 3, km: null, partner: false, verified: false },
  { id: 'aaaa0000-0000-4000-8000-0000000000a2', slug: 'moss-vale', name: 'Moss Vale Golf Club', area: 'Moss Vale NSW', holes: 18, greens: 0, osm: false, copies: 0, km: null, partner: true, verified: true },
];
const CLUB = { v: { signed_in: false, platform_admin: false, club: null, claims: [] } };
const PAGE = { v: null };
const CLAIMS = [{ id: 'cl000000-0000-4000-8000-000000000001', course: 'Bowral Golf Club', course_slug: 'bowral-golf-club', area: 'Bowral NSW', claimed: false, club_name: 'Bowral Golf Club',
  contact_name: 'Pat', contact_email: 'gm@bowral.example', contact_phone: '02 4800 0000', role_at_club: 'GM', note: null, status: 'pending', created_at: now, signed_in_as: 'gm@bowral.example' }];
STATUS.v = { is_member: false, is_admin: false, player_id: null, group_name: null, group_id: null, legacy: null, role: null, signed_in: false, look: null, groups: [] };
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
let dialogs = 0;
page.on('dialog', (d) => { dialogs++; d.accept(); });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const cssVar = (n) => page.evaluate((x) => getComputedStyle(document.documentElement).getPropertyValue(x).trim(), n);



const rpc = (name) => writes.filter((x) => x.method === 'RPC' && x.table === name);
const noScroll = async (what) => { const w = await page.evaluate(() => document.scrollingElement.scrollWidth); check(w <= 375, `${what}: no sideways scroll (${w}px)`); };

// 1. Not signed in properly: sign in first.
await page.goto(`${BASE}#/club`);
await page.getByText('Is this your course?').waitFor({ timeout: 15000 });
check(await page.getByText('First, sign in').isVisible(), 'a club needs a proper sign-in first');
check(!(await page.getByText('Find your course').count()), 'no claiming before signing in');
await page.screenshot({ path: `${SHOTS}/k1-club.png`, fullPage: true });
await noScroll('Club start');

// 2. Signed in: find the course and claim it.
CLUB.v = { signed_in: true, platform_admin: false, club: null, claims: [] };
await page.reload();
await page.getByText('Find your course').waitFor({ timeout: 15000 });
check(await page.getByRole('button', { name: /Moss Vale Golf Club.*Already claimed/ }).isDisabled(), 'a claimed course can’t be claimed again');
await page.getByRole('button', { name: /Bowral Golf Club.*This is us/ }).click();
await page.getByLabel('Your name').fill('Pat Manager');
await page.getByLabel('Club email').fill('gm@bowral.example');
await page.getByLabel('Your role at the club').fill('General manager');
await page.getByRole('button', { name: 'Send the claim' }).click();
await page.waitForTimeout(800);
const rc = rpc('request_club_claim')[0]?.body;
check(rc?.p_course_id === LIB[0].id && rc?.p_contact_email === 'gm@bowral.example' && rc?.p_position === 'General manager', 'claim sent with the club’s details');
await page.screenshot({ path: `${SHOTS}/k2-claim.png`, fullPage: true });

// 3. Josh approves it (by hand).
CLUB.v = { signed_in: true, platform_admin: true, club: null, claims: [] };
await page.goto(`${BASE}#/club/claims`);
await page.reload();
await page.getByText('Club claims').waitFor({ timeout: 15000 });
await page.getByRole('button', { name: 'Approve' }).click();
await page.waitForTimeout(800);
check(rpc('decide_club_claim')[0]?.body.p_approve === true, 'Josh approves a claim (after a confirm)');
await page.screenshot({ path: `${SHOTS}/k3-claims.png`, fullPage: true });
await noScroll('Claims');

// 4. The club edits its page and its hole data.
CLUB.v = { signed_in: true, platform_admin: false, claims: [], club: { id: 'c1000000-0000-4000-8000-000000000001', name: 'Bowral Golf Club', ref: 'BOWRAL123', logo_url: null,
  booking_email: null, booking_phone: null, booking_note: null, offers: null, courses: [{ id: LIB[0].id, slug: LIB[0].slug, name: LIB[0].name, verified: false }] } };
PAGE.v = { id: LIB[0].id, slug: LIB[0].slug, name: LIB[0].name, area: 'Bowral NSW', osm: false, verified: false, club: null, holes: H };
await page.goto(`${BASE}#/club`);
await page.reload();
await page.getByText('Your course page').waitFor({ timeout: 15000 });
await page.getByLabel('Group bookings email').fill('bookings@bowral.example');
await page.getByLabel('Offers for visiting groups').fill('Stay and play from $99');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(800);
const up = rpc('club_update_profile')[0]?.body;
check(up?.p_booking_email === 'bookings@bowral.example' && up?.p_offers === 'Stay and play from $99', 'club saves its booking contact and offers');
await page.getByRole('button', { name: 'Hole data' }).click();
await page.getByRole('button', { name: 'Save checked hole data' }).waitFor({ timeout: 5000 });
await page.getByRole('button', { name: 'Save checked hole data' }).click();
await page.waitForTimeout(800);
const uc = rpc('club_update_course')[0]?.body;
check(uc?.p_holes?.length === 18 && uc.p_holes[2].par === 3, 'club saves checked hole data');
check(!(await page.getByText(/score|scores/i).filter({ hasText: /Mike|Josh/ }).count()), 'the club sees no players or scores');
await page.screenshot({ path: `${SHOTS}/k4-home.png`, fullPage: true });
await noScroll('Club home');

// 5. The course page shows the partner, clearly labelled.
PAGE.v = { ...PAGE.v, verified: true, club: { name: 'Bowral Golf Club', logo_url: null, booking_email: 'bookings@bowral.example', booking_phone: '02 4800 0001', booking_note: null, offers: 'Stay and play from $99' } };
await page.goto(`${BASE}#/c/bowral-golf-club`);
await page.reload();
await page.getByText('Partner course').waitFor({ timeout: 15000 });
check(await page.getByText(/Stay and play from \$99/).isVisible() && await page.getByRole('link', { name: 'bookings@bowral.example' }).isVisible(), 'course page shows the partner’s offer and booking contact');
check(await page.getByText('✓ Hole data checked by the club.').isVisible(), 'checked hole data is labelled');
await page.screenshot({ path: `${SHOTS}/k5-partner.png`, fullPage: true });
PAGE.v = { ...PAGE.v, club: null, verified: false };
await page.reload();
await page.getByText('Work at this club? Claim this page').waitFor({ timeout: 15000 });
check(true, 'an unclaimed course page invites the club to claim it');

check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
