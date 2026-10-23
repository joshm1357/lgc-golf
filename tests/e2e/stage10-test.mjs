// Stage 10 — booking links and group booking enquiries (no money). Phone-width browser check against a fake database.
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
  courses: [{ id: COURSE, name: 'Test Links', holes, library_id: 'aaaa0000-0000-4000-8000-0000000000a1', created_at: now }],
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
    if (name === 'admin_usage') return json(USAGE);
    if (name === 'admin_errors') return json(ERRORS);
    if (name === 'admin_stays') return json(STAYS);
    if (name === 'admin_new_stay') { const s = { id: 'st000000-0000-4000-8000-000000000009', name: JSON.parse(req.postData()).p_name, ref: 'SABCD123', scans: 0, groups: 0 }; STAYS.unshift(s); return json(s); }
    if (name === 'send_booking_enquiry') return json({ to: 'bookings@bowral.example', phone: '02 4800 0001', club: 'Bowral Golf Club', subject: 'Group booking enquiry — Bowral Golf Club', body: 'Hi' });
    if (name === 'booking_link') return json({ url: `https://booking.example/search?kind=${JSON.parse(req.postData()).p_kind}`, disclosure: 'The Golf Trip doesn’t earn anything from these links.' });
    if (name === 'booking_disclosure') return json('The Golf Trip doesn’t earn anything from these links.');
    if (name === 'partner_courses_for') return json([{ name: 'Mudgee', slug: 'mudgee-golf-club', course: 'Mudgee Golf Club' }]);
    if (name === 'club_enquiries') return json([{ id: 'e1', course: 'Bowral Golf Club', contact_name: 'Pip Smith', contact_email: 'pip@example.com', contact_phone: null, start_date: '2026-11-20', end_date: '2026-11-22', group_size: 12, rounds: 2, note: 'Carts please', created_at: now }]);
    if (name === 'admin_booking_numbers') return json({ enquiries: [{ name: 'Bowral Golf Club', ref: 'BOWRAL123', n: 1 }], link_taps: { stay: 3 } });
    if (name === 'export_group') return json({ group: { name: 'The Mulligans' }, players: db.players, exported_at: now });
    if (['leave_group', 'delete_my_account', 'delete_group'].includes(name)) return json({ code: 'PGRST202', message: 'Could not find the function public.' + name }, 404);
    if (name === 'find_courses') return json(LIB);
    if (name === 'course_page') return json(PAGE.v);
    if (name === 'admin_club_claims') return json(CLAIMS);
    if (name === 'club_stats') return json(STATS);
    if (name === 'tv_board') return json(JSON.parse(req.postData() || '{}').p_key === 'tvkey123' ? TV.v : null);
    if (name === 'my_club_tv_key') return json('tvkey123');
    if (name === 'new_club_tv_key') return json('tvkey456');
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
const USAGE = { days: 90, groups: { all: 12, new: 5, quick: 7, official: 5, came_back: 3, planned_a_trip: 2, from_another_groups_card: 1 },
  trips: { run: 9, players_scoring_avg: 6.4, players_scoring_max: 14 },
  funnel: [{ name: 'Bowral Golf Club', kind: 'club', ref: 'BOWRAL123', placement: 'cart', scans: 41, groups_started: 6, rounds_started: 5, came_back_or_planned: 2 },
           { name: 'Bowral Motor Inn', kind: 'stay', ref: 'SXYZ9876', placement: 'stay', scans: 4, groups_started: 1, rounds_started: 1, came_back_or_planned: 0 }] };
const ERRORS = [{ message: 'TypeError: x is undefined', times: 3, phones: 2, last_seen: now, stack: 'at Leaderboard (part-Leaderboard.js:1:2)', path: '/lgc-golf/#/', version: 'abc123', agent: 'iPhone' }];
const STAYS = [{ id: 'st000000-0000-4000-8000-000000000001', name: 'Bowral Motor Inn', ref: 'SXYZ9876', scans: 4, groups: 1 }];
const CLUB = { v: { signed_in: false, platform_admin: false, club: null, claims: [] } };
const PAGE = { v: null };
const CLAIMS = [{ id: 'cl000000-0000-4000-8000-000000000001', course: 'Bowral Golf Club', course_slug: 'bowral-golf-club', area: 'Bowral NSW', claimed: false, club_name: 'Bowral Golf Club',
  contact_name: 'Pat', contact_email: 'gm@bowral.example', contact_phone: '02 4800 0000', role_at_club: 'GM', note: null, status: 'pending', created_at: now, signed_in_as: 'gm@bowral.example' }];
const STATS = { days: 90, scans: { cart: 41, par3: 12, counter: 3 }, rounds_started: 17, groups_created: 9, groups_by_placement: { cart: 7, counter: 2 }, groups_came_back: -1, trips_planned: 0, made_official: -1 };
const TV = { v: null };
STATUS.v = { is_member: false, is_admin: false, player_id: null, group_name: null, group_id: null, legacy: null, role: null, signed_in: false, look: null, groups: [] };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://luogyzvrbedmicjejilr.supabase.co/**', fakeSupabase);
await ctx.addInitScript(([uid]) => { try { localStorage.setItem('tgt-caddie-hello', '1'); } catch { /* ov22 */ }
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



const rpc = (name) => writes.filter((x) => x.method === 'RPC' && x.table === name);
const noScroll = async (what) => { const w = await page.evaluate(() => document.scrollingElement.scrollWidth); check(w <= 375, `${what}: no sideways scroll (${w}px)`); };



await ctx.route('https://booking.example/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Booking site</body></html>' }));

// 1. A partner course page: ask about a group booking.
PAGE.v = { id: LIB[0].id, slug: 'bowral-golf-club', name: 'Bowral Golf Club', area: 'Bowral NSW', osm: false, verified: true, holes: H,
  club: { name: 'Bowral Golf Club', logo_url: null, booking_email: 'bookings@bowral.example', booking_phone: '02 4800 0001', booking_note: null, offers: null } };
await page.goto(`${BASE}#/c/bowral-golf-club`);
await page.getByRole('button', { name: '📨 Ask about a group booking' }).click();
// v10.2: an enquiry sends your details to a club, so it needs Google or email first (no phone-only account).
check(await page.getByTestId('sign-in-to-continue').waitFor({ timeout: 8000 }).then(() => true, () => false), 'phone-only: the enquiry asks for Google or email first (v10.2)');
STATUS.v = { ...STATUS.v, signed_in: true };
await page.reload();
await page.getByRole('button', { name: '📨 Ask about a group booking' }).click({ timeout: 15000 });
await page.getByLabel('Your name').fill('Pip Smith');
check(await page.getByRole('button', { name: 'Send to the club' }).isDisabled(), 'needs an email or phone to send');
await page.getByLabel('Email').fill('pip@example.com');
await page.getByLabel('How many golfers').fill('12');
await page.getByLabel('Rounds').fill('2');
await page.getByLabel('Anything else (optional)').fill('Carts please');
await page.screenshot({ path: `${SHOTS}/b1-enquiry.png`, fullPage: true });
await noScroll('Enquiry form');
await page.getByRole('button', { name: 'Send to the club' }).click();
await page.getByText('Nearly done — press Send in your email app.').waitFor({ timeout: 8000 });
const enq = rpc('send_booking_enquiry')[0]?.body;
check(enq?.p_course_slug === 'bowral-golf-club' && enq.p_email === 'pip@example.com' && enq.p_size === 12 && enq.p_rounds === 2, 'enquiry sent with the details');
check(await page.getByLabel(/Group booking/).getByRole('link', { name: '02 4800 0001' }).isVisible(), 'shows the club’s phone as well');
await page.getByRole('button', { name: 'Done' }).click();
await page.goto(`${BASE}#/c/bowral-golf-club?enquire=1`);
await page.reload();
check(await page.getByText('Group booking — Bowral Golf Club').isVisible({ timeout: 8000 }).catch(() => false) || await page.getByText('Group booking — Bowral Golf Club').waitFor({ timeout: 8000 }).then(() => true, () => false), 'a link from a place vote opens the form');
PAGE.v = { ...PAGE.v, club: { ...PAGE.v.club, booking_email: null, booking_phone: null } };
await page.goto(`${BASE}#/c/bowral-golf-club`);
await page.reload();
await page.getByText('Partner course').waitFor({ timeout: 15000 });
check(!(await page.getByRole('button', { name: '📨 Ask about a group booking' }).count()), 'no ask button when the club has no bookings contact');

// 2. Trip details: booking links (switch on), through the database's redirect.
STATUS.v = NEW;
db.group_features = db.group_features.filter((f) => f.feature_key !== 'planner');
db.group_features.push({ group_id: GROUP, feature_key: 'booking_links', enabled: true });
await page.evaluate((g) => localStorage.setItem('lgc-group', g), GROUP);
await page.goto(`${BASE}#/plan/${PLAN}?tab=details`);
await page.reload();
await page.getByRole('button', { name: '🏨 Find accommodation' }).waitFor({ timeout: 15000 });
await page.getByText(/doesn’t earn anything from these links/).waitFor({ timeout: 5000 });
check(true, 'says what the app earns from the links (from the database)');
await page.screenshot({ path: `${SHOTS}/b2-links.png`, fullPage: true });
const popup = page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
await page.getByRole('button', { name: '🏨 Find accommodation' }).click();
const win = await popup;
if (win) await win.waitForURL(/booking\.example/, { timeout: 8000 }).catch(() => {});
check(!!win && /booking\.example\/search\?kind=stay/.test(win.url()) && rpc('booking_link')[0]?.body.p_plan === PLAN, 'accommodation link opens in a new window, through the redirect with the trip');
check(/#\/plan\//.test(page.url()), 'the app stays on the trip underneath');
await win?.close();
db.group_features = db.group_features.filter((f) => f.feature_key !== 'booking_links');
await page.goto(`${BASE}#/plan/${PLAN}?tab=details`);
await page.reload();
await page.getByText('When').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
check(!(await page.getByRole('button', { name: '🏨 Find accommodation' }).count()), 'no booking links with the switch off');

// 3. A place vote with a partner course offers the enquiry (Organise → Vote, ov14).
await page.goto(`${BASE}#/plan/${IDEA}?tab=vote`);
await page.reload();
await page.getByText('Where should we go?').waitFor({ timeout: 15000 });
await page.getByRole('link', { name: /Ask about a group booking/ }).waitFor({ timeout: 8000 });
check((await page.getByRole('link', { name: /Ask about a group booking/ }).getAttribute('href')) === '#/c/mudgee-golf-club?enquire=1', 'place vote links a partner course to the enquiry');
await page.screenshot({ path: `${SHOTS}/b3-vote.png`, fullPage: true });

// 4. The club sees its enquiries; Josh sees the totals.
CLUB.v = { signed_in: true, platform_admin: true, claims: [], club: { id: 'c1000000-0000-4000-8000-000000000001', name: 'Bowral Golf Club', ref: 'BOWRAL123', logo_url: null,
  booking_email: 'bookings@bowral.example', booking_phone: null, booking_note: null, offers: null, courses: [{ id: LIB[0].id, slug: LIB[0].slug, name: LIB[0].name, verified: true }] } };
await page.goto(`${BASE}#/club`);
await page.reload();
await page.getByText('Group booking enquiries').waitFor({ timeout: 15000 });
check(await page.getByText(/Pip Smith/).isVisible() && await page.getByRole('link', { name: 'pip@example.com' }).isVisible(), 'the club sees the enquiry with the contact');
await noScroll('Club enquiries');
await page.goto(`${BASE}#/club/josh`);
await page.reload();
await page.getByText('Bookings (no money changes hands)').waitFor({ timeout: 15000 });
check(await page.getByText(/Group booking enquiries: Bowral Golf Club 1/).isVisible() && await page.getByText(/Booking-link taps: accommodation 3/).isVisible(), 'Josh sees enquiries and link taps');

check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
