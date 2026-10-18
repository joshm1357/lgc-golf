// Stage 7 — start a new group: the public page and the wizard. Phone-width browser check of the built app (dist/) against a fake database.
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
    if (name === 'create_group') { STATUS.v = { ...MEMBER }; return json(NEWG); }
    if (name === 'create_my_player') return json('p0000000-0000-4000-8000-0000000000ff');
    if (name === 'group_invite') return json('NEWGRP234567');
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
const NEWG = 'c0c0c0c0-0000-4000-8000-00000000000c';
const MEMBER = { is_member: true, is_admin: true, player_id: 'p0000000-0000-4000-8000-0000000000ff', group_name: 'The Mulligans', group_id: NEWG, legacy: false, role: 'organiser', signed_in: false,
  look: { short_name: null, crest_url: null, primary: '#1F4B33', accent: '#E0B84A', font: 'condensed' }, groups: [{ id: NEWG, name: 'The Mulligans', slug: 'the-mulligans', role: 'organiser' }] };
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

// Not in a group: the join screen points to starting one.
await page.goto(`${BASE}#/`);
await page.getByText('Running a golf group? Start your own →').waitFor({ timeout: 15000 });
check(true, 'join screen offers to start a group');
await page.getByText('Running a golf group? Start your own →').click();
await page.getByRole('link', { name: 'Start your group' }).waitFor({ timeout: 10000 });
check(await page.getByText('The app for your golf group’s weekends away.').isVisible(), 'public start page says what it is');
await page.screenshot({ path: `${SHOTS}/s1-start.png`, fullPage: true });
await noScroll('Start page');
await page.getByRole('link', { name: 'Start your group' }).click();

// 1. Sign in (providers not switched on here): carry on.
await page.getByText('Step 1 of 7').waitFor({ timeout: 10000 });
check(await page.getByText(/isn’t switched on yet/).isVisible(), 'step 1: says sign-in isn’t on yet, can carry on');
await page.getByRole('button', { name: 'Next' }).click();

// 2. Name: makes the group with the Full trip switches, then the organiser's own player.
await page.getByText('Step 2 of 7').waitFor({ timeout: 5000 });
check(await page.getByRole('button', { name: 'Make the group' }).isDisabled(), 'step 2: can’t make it without a name');
await page.getByLabel('Group name').fill('The Mulligans');
await page.getByLabel('Your name').fill('Josh');
await page.getByLabel('Handicap').fill('14');
await page.screenshot({ path: `${SHOTS}/s2-name.png`, fullPage: true });
await page.getByRole('button', { name: 'Make the group' }).click();
await page.getByText('Step 3 of 7').waitFor({ timeout: 10000 });
const cg = rpc('create_group')[0];
check(!!cg && cg.body.p_name === 'The Mulligans' && cg.body.p_features.feed === true && cg.body.p_features.scorecard_photo === false, 'makes the group (name, Full trip switches)');
check(rpc('create_my_player')[0]?.body.p_name === 'Josh' && rpc('create_my_player')[0]?.body.p_handicap === 14, 'adds the organiser as a player');

// Leaving and coming back carries on at the same step, without making a second group.
await page.reload();
await page.getByText('Step 3 of 7').waitFor({ timeout: 15000 });
check(rpc('create_group').length === 1, 'coming back carries on — no second group');

// 3. Look: the Look card, or skip.
check(await page.getByText('🎨 Look').isVisible() && !(await page.getByText('Group name').count()), 'step 3: crest and colours (name already set)');
await page.screenshot({ path: `${SHOTS}/s3-look.png`, fullPage: true });
await noScroll('Wizard look step');
await page.getByRole('button', { name: 'Skip — keep the plain look' }).click();

// 4. Rulebook.
await page.getByText('Step 4 of 7').waitFor({ timeout: 5000 });
await page.getByRole('button', { name: 'Use these rules' }).first().click();
await page.getByText('Step 5 of 7').waitFor({ timeout: 5000 });
check(rpc('use_starter_rulebook')[0]?.body.p_starter === 'social_stableford', 'step 4: starter rulebook added');

// 5. Features: Just scoring.
await page.getByRole('button', { name: /Just scoring/ }).click();
await page.screenshot({ path: `${SHOTS}/s5-features.png`, fullPage: true });
await page.getByRole('button', { name: 'Custom' }).click();
check(await page.getByRole('checkbox', { name: 'Feed, photos and auto-posts' }).isVisible(), 'custom shows each switch');
await page.getByRole('button', { name: /Just scoring/ }).click();
await page.getByRole('button', { name: 'Next' }).click();
await page.getByText('Step 6 of 7').waitFor({ timeout: 5000 });
const sf = rpc('set_features')[0]?.body.p_switches;
check(!!sf && sf.feed === false && sf.gps === true && sf.tribunal === false, 'step 5: Just scoring switches saved');

// 6. Players.
await page.getByLabel('One per line — name and handicap').fill('Mike, 18\nSam 9.4\nmike 12');
check(await page.getByText(/Mike is on the list twice/i).isVisible(), 'step 6: a name twice is pointed out');
await page.getByLabel('One per line — name and handicap').fill('Mike, 18\nSam 9.4');
await page.getByRole('button', { name: 'Add 2 players' }).click();
await page.getByText('Step 7 of 7').waitFor({ timeout: 5000 });
check(rpc('admin_create_player').map((x) => `${x.body.p_name}:${x.body.p_handicap}`).join(',') === 'Mike:18,Sam:9.4', 'step 6: players added');

// 7. Invite.
await page.getByText(/join\/ABCDEFGH2345/).waitFor({ timeout: 10000 });
check(true, 'step 7: invite link shown');
await page.screenshot({ path: `${SHOTS}/s7-invite.png`, fullPage: true });
await noScroll('Wizard invite step');
check(await page.getByRole('button', { name: 'Open your group' }).isVisible(), 'step 7: open your group');

check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
