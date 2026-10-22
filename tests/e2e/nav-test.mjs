// Trip-centred navigation (ov15) browser check, 22 Oct 2026. Fake database only.
// Usage: node nav-test.mjs <base> <shotDir> [--shots-only <prefix>]
//   e.g. node nav-test.mjs http://localhost:4402/lgc-golf/ ./nav-shots
// --shots-only takes the screenshots of the main tabs at 375 and 1440 px (named <prefix>-<width>-<screen>.png) and
// checks nothing — used for the "before" pictures on the old build.
//
// Checks: the first tab is "This trip" (Day 2 of 3) with today's leaderboard, the trip's comps and its feed, above the
// Feed tab; an old #/?r=<round> recap link still lands on that round's leaderboard; #/comps redirects (to the live
// round's side comps, or the trip's comps); Players & group opens on the players list; a player can't change a
// handicap but can dispute it; an organiser changes one inline; the personal settings are on your own profile.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4402/lgc-golf/';
const SHOTS = process.argv[3] || './nav-shots';
const SHOTS_ONLY = process.argv[4] === '--shots-only' ? (process.argv[5] || 'before') : null;
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-0000000000aa';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const OLD_TRIP = 'aaaaaaaa-0000-4000-8000-000000000002';
const PLAN = 'bbbbbbbb-0000-4000-8000-000000000001';
const OLD_PLAN = 'bbbbbbbb-0000-4000-8000-000000000002';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const R3 = 'dddddddd-0000-4000-8000-000000000003';
const R0 = 'dddddddd-0000-4000-8000-000000000000';
const TROPHY = 'ffffffff-0000-4000-8000-000000000001';
const COMP = 'f0f0f0f0-0000-4000-8000-000000000001';
const now = '2026-12-04T08:00:00.000Z';
const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const SI = [7, 15, 3, 11, 1, 17, 9, 13, 5, 8, 16, 4, 12, 2, 18, 10, 14, 6];
const holes = PAR.map((par, i) => ({ n: i + 1, par, si: SI[i] }));
const names = ['Kurt', 'Al', 'Bo', 'Cy', 'Di', 'Ed'];
const hcps = [12, 20, 8, 16, 4, 28];
const pid = (i) => `${String(i + 1).padStart(8, '0')}-1111-4111-8111-111111111111`;
const K = pid(0); // organiser
const A = pid(1); // player
const uid = (i) => `${String(i + 1).padStart(8, '0')}-9999-4999-8999-999999999999`;

function freshDb() {
  const players = names.map((n, i) => ({ id: pid(i), group_id: GROUP, name: `${n} Test`, nickname: i === 1 ? 'Big Al' : null, handicap: hcps[i], approved: true, created_at: now, cup_side: null }));
  const scores = [];
  // Friday (done): everyone through 18. Saturday (live): through 9.
  for (const [round, upto] of [[R1, 18], [R2, 9]]) {
    players.slice(0, 4).forEach((p, i) => {
      for (let h = 1; h <= upto; h++) scores.push({ id: crypto.randomUUID(), round_id: round, subject_id: p.id, player_id: p.id, hole: h, strokes: PAR[h - 1] + ((h + i) % 3 === 0 ? 1 : 0), picked_up: false, created_at: now });
    });
  }
  return {
    players,
    groups: [{ id: GROUP, vote_decider: 'admin', vote_channel: 'app' }],
    group_members: [
      ...players.slice(0, 5).map((p, i) => ({ group_id: GROUP, user_id: uid(i), player_id: p.id, role: i === 0 ? 'organiser' : i === 4 ? 'guest' : 'player', created_at: now })),
    ],
    trips: [
      { id: TRIP, group_id: GROUP, name: 'Hunter Weekend', start_date: '2026-12-04', end_date: '2026-12-06', status: 'active', created_at: now },
      { id: OLD_TRIP, group_id: GROUP, name: 'Bowral 2025', start_date: '2025-11-07', end_date: '2025-11-08', status: 'locked', created_at: '2025-11-01T00:00:00.000Z' },
    ],
    trophies: [{ id: TROPHY, group_id: GROUP, trip_id: TRIP, name: 'BD Trophy', type: 'stableford_total', description: null, created_at: now }],
    comps: [{ id: COMP, group_id: GROUP, trip_id: TRIP, name: 'BD Trophy', kind: 'individual_points', round_ids: [], settings: {}, trophy_id: TROPHY, sort: 0, retired: false, created_at: now }],
    quick_results: [], round_pins: [], scores,
    honour_board: [{ id: crypto.randomUUID(), trophy_name: 'BD Trophy', label: '2025', winner_names: 'Bo Test', player_ids: [pid(2)], sort_key: 10, trip_id: OLD_TRIP }],
    teams: [], team_players: [],
    round_players: [R0, R1, R2, R3].flatMap((r) => players.slice(0, 4).map((p) => ({ round_id: r, player_id: p.id, playing_handicap: p.handicap }))),
    courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
    rounds: [
      { id: R0, trip_id: OLD_TRIP, course_id: COURSE, name: 'Bowral Stableford', play_date: '2025-11-07', format: 'stableford', status: 'locked', ld_holes: [], ctp_holes: [], own_comps: [], comp_bonus: 0, created_at: '2025-11-01T00:00:00.000Z' },
      { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Friday Stableford', play_date: '2026-12-04', format: 'stableford', status: 'locked', ld_holes: [], ctp_holes: [], own_comps: [], comp_bonus: 0, created_at: now },
      { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Saturday Stableford', play_date: '2026-12-05', format: 'stableford', status: 'live', ld_holes: [9], ctp_holes: [6], own_comps: [], comp_bonus: 0, created_at: now },
      { id: R3, trip_id: TRIP, course_id: COURSE, name: 'Sunday Stableford', play_date: '2026-12-06', format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], own_comps: [], comp_bonus: 0, created_at: now },
    ],
    plans: [
      { id: PLAN, group_id: GROUP, name: 'Hunter Weekend', kind: 'trip', status: 'confirmed', start_date: '2026-12-04', end_date: '2026-12-06', location_name: 'Hunter Valley', trip_id: TRIP, rsvp_locked: false, proposed: false, created_at: now },
      { id: OLD_PLAN, group_id: GROUP, name: 'Bowral 2025', kind: 'trip', status: 'done', start_date: '2025-11-07', end_date: '2025-11-08', location_name: 'Bowral', trip_id: OLD_TRIP, rsvp_locked: true, proposed: false, created_at: '2025-11-01T00:00:00.000Z' },
    ],
    plan_polls: [], plan_options: [], plan_votes: [], plan_rsvps: [0, 1, 2, 3].map((i) => ({ plan_id: PLAN, player_id: pid(i), status: 'in' })),
    plan_items: [], plan_costs: [], plan_payments: [], plan_groups: [], plan_group_members: [], plan_transfers: [], plan_comments: [],
    tribunal_cases: [], tribunal_votes: [], rules: [], cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
    cases: [], case_votes: [], case_posts: [], governance_settings: [], governance_group: [], committees: [], committee_seats: [],
    posts: [
      { id: crypto.randomUUID(), group_id: GROUP, kind: 'user', player_id: pid(2), trip_id: TRIP, round_id: R2, body: 'Birdie on 4! Drinks on me', created_at: '2026-12-04T23:10:00.000Z' },
      { id: crypto.randomUUID(), group_id: GROUP, kind: 'user', player_id: pid(1), trip_id: TRIP, round_id: R1, body: 'Lost three balls on the 7th. Send help.', created_at: '2026-12-04T05:00:00.000Z' },
      { id: crypto.randomUUID(), group_id: GROUP, kind: 'user', player_id: pid(3), trip_id: OLD_TRIP, body: 'Bowral was cold', created_at: '2025-11-08T05:00:00.000Z' },
    ],
    comments: [], reactions: [],
    handicap_history: [{ id: crypto.randomUUID(), player_id: A, old_handicap: 22, new_handicap: 20, reason: 'Tribunal', created_at: '2026-09-01T00:00:00.000Z' }],
    group_features: ['planner', 'planner_tasks', 'feed', 'side_comps', 'trophies', 'tribunal', 'rule_challenges', 'rule_voting', 'stats']
      .map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
  };
}

let db = freshDb();
let role = 'organiser';
const writes = [];
const match = (r, k, v) => {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(r[k]));
  if (v.startsWith('is.')) return v.slice(3) === 'null' ? r[k] == null : true;
  if (v.startsWith('not.is.')) return r[k] != null;
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
const me = () => (role === 'organiser' ? K : A);
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.split('/').pop();
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    if (fn !== 'my_status') writes.push({ method: 'RPC', table: fn, body });
    if (fn === 'my_status') return json({ is_member: true, is_admin: role === 'organiser', player_id: me(), group_name: 'Hunter Weekend', group_id: GROUP, role, legacy: false, signed_in: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role }] });
    if (fn === 'player_sign_ins') {
      if (role !== 'organiser') return json({ message: 'Only an organiser can see that' }, 400);
      return json(db.players.map((pl, i) => ({ player_id: pl.id, signed_in: i < 2, email: i < 2 ? `${pl.name[0].toLowerCase()}…@example.com` : null, phones: i < 5 ? 1 : 0, link_waiting: false, role: i === 0 ? 'organiser' : 'player' })));
    }
    if (fn === 'vote_channels') return json(db.players.map((pl, i) => ({ player_id: pl.id, on_app: i < 5, choice: i === 1 ? 'email' : 'app', has_email: i === 1 || i === 5, email_hint: i === 1 ? 'a…@example.com' : i === 5 ? 'e…@example.com' : null, source: i === 5 ? 'invited' : 'own' })));
    if (fn === 'my_vote_email') return json([{ email: null, signin_email: null, vote_channel: null, group_default: 'app', source: null }]);
    if (fn === 'raise_dispute') {
      const id = crypto.randomUUID();
      const pl = db.players.find((x) => x.id === body.p_ref.id);
      db.cases.unshift({ id, group_id: GROUP, kind: 'ruling', title: body.p_title, body: body.p_body, rule_id: null, proposal: body.p_suggest ? { answer: body.p_suggest } : {},
        raised_by: me(), raised_via: 'app', settings: { decides: 'players_majority', close_hours: 48 }, stage: 'voting', status: 'open', closes_at: '2026-12-07T08:00:00.000Z',
        hidden: false, created_at: new Date().toISOString(), subject_kind: 'setting', subject_ref: { ...body.p_ref, value: pl ? pl.handicap : null } });
      return json(id);
    }
    return json(fn === 'governance_tick' ? 0 : null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    const one = /vnd\.pgrst\.object/.test(req.headers().accept || '');
    if (method === 'GET') {
      let out = filterRows(rows, url.searchParams);
      const order = url.searchParams.get('order');
      if (order && /created_at\.desc/.test(order)) out = [...out].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const limit = Number(url.searchParams.get('limit') || 0);
      if (limit) out = out.slice(0, limit);
      return json(one ? out[0] || null : out);
    }
    writes.push({ method, table, body: req.postData() });
    if (method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      const hit = filterRows(rows, url.searchParams);
      for (const r of hit) {
        if (table === 'players' && 'handicap' in body) db.handicap_history.unshift({ id: crypto.randomUUID(), player_id: r.id, old_handicap: r.handicap, new_handicap: body.handicap, reason: 'Admin change', created_at: new Date().toISOString() });
        Object.assign(r, body);
      }
      return json(url.searchParams.has('select') ? hit : [], 200);
    }
    if (method === 'POST') return json([], 201);
    return json([], 200);
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();

async function open(width, { mobile = width < 600 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 812 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.route('https://*.supabase.co/**', fake);
  await ctx.addInitScript(([u]) => {
    const exp = Math.floor(Date.now() / 1000) + 86400 * 400; // the page clock is set weeks ahead
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u, exp, role: 'authenticated' })}.x`;
    if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: u, aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now() + 86400000 * 400));
    try { sessionStorage.setItem('tgt-savespot-later', '1'); } catch { /* fine */ }
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  }, [uid(0)]);
  const page = await ctx.newPage();
  // Saturday morning of a Friday–Sunday trip: Day 2 of 3, Saturday's round live.
  await page.clock.setFixedTime(new Date('2026-12-05T10:00:00+11:00'));
  page.on('pageerror', (e) => fails.push(`page error (${width}): ${e}`));
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
const go = async (page, hash) => { await page.goto(`${BASE}#${hash}`); };
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash);
const settle = async (page) => { await page.locator(".page, .room").first().waitFor({ timeout: 15000 }).catch(async (e) => { await page.screenshot({ path: `${SHOTS}/debug.png` }); console.log((await page.locator("body").innerText()).slice(0, 500)); throw e; }); await page.waitForTimeout(900); };

// The main tabs, before and after (same set, same names).
const SCREENS = [
  ['1-home', '/'], ['2-feed', '/feed'], ['3-comps', '/comps'], ['4-trips', '/plan'], ['5-group', '/group'],
  ['6-more', '/more'], ['7-trophies', '/trophies'], ['8-profile', `/player/${K}`], ['9-round', `/?r=${R2}`],
];
async function shots(prefix) {
  for (const width of [375, 1440]) {
    db = freshDb(); role = 'organiser';
    const { ctx, page } = await open(width);
    for (const [name, hash] of SCREENS) {
      await go(page, hash);
      await settle(page);
      await page.screenshot({ path: `${SHOTS}/${prefix}-${width}-${name}.png`, fullPage: width < 600 });
    }
    await ctx.close();
  }
}

if (SHOTS_ONLY) {
  await shots(SHOTS_ONLY);
  await browser.close();
  console.log(`Screenshots saved (${SHOTS_ONLY}-*).`);
  process.exit(0);
}

// ---------------------------------------------------------------- 1. Phone: the first tab is This trip
{
  db = freshDb(); role = 'player';
  const { ctx, page } = await open(375);
  await go(page, '/');
  const card = page.getByTestId('this-trip');
  await card.waitFor({ timeout: 15000 });
  const t = await card.innerText();
  check(t.includes('Hunter Weekend') && t.includes('Day 2 of 3'), `this trip: name and "Day 2 of 3" (${t.split('\n').slice(0, 3).join(' | ')})`);
  const tabs = await page.locator('nav.tabs .tab span').allInnerTexts();
  check(tabs[0] === 'This trip' && tabs[1] === 'Feed', `bottom tabs: This trip first, Feed next (${tabs.join(', ')})`);
  check(!tabs.includes('Leaderboard') && !tabs.includes('Comps'), 'no Leaderboard or Comps tab any more');
  check(tabs.includes('Players'), 'a Players tab');
  const board = page.getByTestId('trip-round-board');
  await board.waitFor({ timeout: 10000 });
  const bt = await board.innerText();
  check(bt.includes('Saturday Stableford') && /live/i.test(bt), 'trip status: today’s round leaderboard, live');
  check((await board.locator('[data-testid="mini-row"]').count()) === 4, 'trip status: everyone in today’s round');
  const comps = page.getByTestId('trip-comps');
  await comps.waitFor({ timeout: 10000 });
  check((await comps.innerText()).includes('BD Trophy'), 'trip status: the trip’s comps (BD Trophy)');
  const feed = page.getByTestId('trip-feed');
  await feed.waitFor({ timeout: 10000 });
  const ft = await feed.innerText();
  check(ft.includes('Birdie on 4') && !ft.includes('Bowral was cold'), 'trip status: this trip’s feed only');
  check((await page.getByTestId('trip-rounds').innerText()).includes('Friday Stableford'), 'trip status: the trip’s rounds');
  check((await page.getByTestId('trip-side-comps').innerText()).includes('Closest to pin'), 'trip status: side comps today, to record');
  await page.screenshot({ path: `${SHOTS}/check-375-this-trip.png`, fullPage: true });

  // Tap the leaderboard → the full board of that round.
  await board.getByRole('link', { name: /Full leaderboard/ }).click();
  await page.waitForFunction((r) => location.hash.includes(`r=${r}`), R2, { timeout: 5000 });
  await page.locator('.lb-cols').waitFor({ timeout: 10000 });
  check(true, 'tap → the full leaderboard of Saturday’s round');
  check(await page.locator('nav.tabs .tab.active span').innerText() === 'This trip', 'the round’s leaderboard sits under This trip');

  // 2. Old recap links still land on the round.
  await go(page, `/?r=${R1}`);
  await page.locator('.lb-cols').waitFor({ timeout: 10000 });
  check((await page.locator('.hdr-title').first().innerText()).includes('Friday Stableford'), 'old #/?r=<round> recap link → that round’s leaderboard');
  // And a past trip's leaderboard: Trips → past trip → Rounds.
  await go(page, `/plan/${OLD_PLAN}`);
  const rounds = page.getByTestId('trip-rounds');
  await rounds.waitFor({ timeout: 15000 });
  check((await rounds.innerText()).includes('Bowral Stableford'), 'past trip overview: its rounds');
  await rounds.getByRole('link', { name: /Bowral Stableford/ }).click();
  await page.waitForFunction((r) => location.hash.includes(`r=${r}`), R0, { timeout: 5000 });
  check(true, 'past trip → round → its leaderboard');

  // 3. #/comps redirects: a live round with side comp holes → its side comps; else the trip's comps.
  await go(page, '/comps');
  await page.waitForFunction((r) => location.hash.includes(`/comps?r=${r}`), R2, { timeout: 8000 }).catch(() => {});
  check(hashOf(page).includes(`/comps?r=${R2}`), `#/comps → the live round’s side comps (${hashOf(page)})`);
  db.rounds.find((r) => r.id === R2).ctp_holes = [];
  db.rounds.find((r) => r.id === R2).ld_holes = [];
  await page.reload();
  await go(page, '/comps');
  await page.waitForFunction(() => location.hash.includes('/comps-board'), null, { timeout: 8000 }).catch(() => {});
  check(hashOf(page).includes(`/comps-board?trip=${TRIP}`), `#/comps with no side comps today → the trip’s comps (${hashOf(page)})`);
  await page.getByText('BD Trophy').first().waitFor({ timeout: 10000 });
  check(true, 'the trip’s comps page lists BD Trophy');

  // 4. Group opens on the players list; a player sees handicaps read-only and can dispute one.
  await go(page, '/group');
  const list = page.getByTestId('players-list');
  await list.waitFor({ timeout: 15000 });
  const top = await page.locator('.page .section > *').first().getAttribute('data-testid');
  check(top === 'players-list', `Players & group opens on the players list (first: ${top})`);
  const lt = await list.innerText();
  check(lt.includes('Al Test') && lt.includes('Big Al') && lt.includes('20'), 'players list: name, nickname, handicap');
  check(!/@/.test(await page.locator('.page').innerText()), 'no email addresses anywhere on Players & group (player)');
  check(!(await page.getByTestId('sign-in-card').isVisible().catch(() => false)), 'Save your spot is not on Players & group');
  check(await page.getByRole('button', { name: /Change .* handicap/ }).count() === 0, 'a player can’t change a handicap');
  await page.screenshot({ path: `${SHOTS}/check-375-players-player.png`, fullPage: true });
  await list.getByTestId('hcp-tag').nth(1).click();
  await page.getByTestId('rule-sheet').waitFor({ timeout: 5000 });
  const st = await page.getByTestId('rule-sheet').innerText();
  check(st.includes('handicap') && st.includes('now: 8'), 'tap a handicap → the rule sheet (Bo, now 8)');
  await page.getByTestId('dispute-this').click();
  await page.getByTestId('raise-dispute').waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/check-375-dispute-handicap.png` });
  await page.getByRole('button', { name: 'Raise the dispute' }).click();
  await page.waitForURL(/tribunal\/case\//, { timeout: 10000 }).catch(() => {});
  const rpc = writes.find((w) => w.table === 'raise_dispute');
  check(rpc && rpc.body.p_ref.table === 'players' && rpc.body.p_ref.id === pid(2) && rpc.body.p_ref.field === 'handicap', 'raise_dispute gets players.handicap for Bo');
  check(!writes.some((w) => w.table === 'players' && w.method === 'PATCH'), 'a dispute changes nothing by itself');

  // 5. Profile holds the personal settings.
  await go(page, `/player/${A}`);
  await page.getByTestId('my-settings').waitFor({ timeout: 15000 });
  check(await page.getByTestId('my-link').waitFor({ timeout: 8000 }).then(() => true, () => false), 'profile: Copy my link');
  check(await page.getByTestId('vote-channel-card').waitFor({ timeout: 8000 }).then(() => true, () => false), 'profile: how I get votes, and my email for votes');
  await page.screenshot({ path: `${SHOTS}/check-375-profile.png`, fullPage: true });
  await go(page, `/player/${K}`);
  await page.locator('.hdr-title').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  check(!(await page.getByTestId('my-settings').isVisible().catch(() => false)), 'someone else’s profile: no personal settings');
  await ctx.close();
}

// ---------------------------------------------------------------- 6. Organiser: inline handicaps, aggregate vote info
{
  db = freshDb(); role = 'organiser'; writes.length = 0;
  const { ctx, page } = await open(375);
  await go(page, '/group');
  const list = page.getByTestId('players-list');
  await list.waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const lt = await list.innerText();
  check(/Organiser/.test(lt) && /signed in/i.test(lt), 'organiser: roles and signed-in on the players list');
  await list.getByRole('button', { name: /Change Al Test’s handicap/ }).click();
  const inp = list.getByRole('textbox', { name: /Al Test handicap/ });
  await inp.fill('18.5');
  await inp.press('Enter');
  await page.waitForTimeout(800);
  const patch = writes.find((w) => w.table === 'players' && w.method === 'PATCH');
  check(patch && JSON.parse(patch.body).handicap === 18.5, 'organiser changes a handicap inline (20 → 18.5)');
  const body = await page.locator('.page').innerText();
  check(!/@example\.com/.test(body), 'organiser: no email addresses on Players & group');
  const ve = page.getByTestId('group-vote-email');
  if (await ve.count()) {
    const vt = await ve.innerText();
    check(/2 on email/.test(vt) && !/Al Test|Ed Test/.test(vt), `votes by email: counts only, no names (${vt.replace(/\n/g, ' | ').slice(0, 120)})`);
  } else check(false, 'votes by email card shows for organisers');
  await page.screenshot({ path: `${SHOTS}/check-375-players-organiser.png`, fullPage: true });
  // A player's card: no email address, even for organisers.
  await list.getByRole('button', { name: /Ed Test/ }).first().click();
  const pc = page.getByTestId('player-card');
  await pc.waitFor({ timeout: 5000 });
  const pct = await pc.innerText();
  check(/email/i.test(pct) && !/@/.test(pct), 'a player’s card (not on the app): email for votes ✓, no address');
  await ctx.close();
}

// ---------------------------------------------------------------- 7. Desktop: sidebar, no trip
{
  db = freshDb(); role = 'organiser';
  const { ctx, page } = await open(1440);
  await go(page, '/');
  await page.getByTestId('this-trip').waitFor({ timeout: 15000 });
  const side = await page.locator('nav.side .side-link span').allInnerTexts();
  check(side[0] === 'This trip' && side[1] === 'Feed', `sidebar: This trip, then Feed (${side.join(', ')})`);
  check(side.includes('Players & group') && !side.includes('Comps') && !side.includes('Leaderboard'), 'sidebar: Players & group; no Comps or Leaderboard');
  await page.screenshot({ path: `${SHOTS}/check-1440-this-trip.png` });
  // No trip on: the compact "plan one" card.
  db.trips = db.trips.filter((t) => t.id === OLD_TRIP);
  db.rounds = db.rounds.filter((r) => r.trip_id === OLD_TRIP);
  await page.reload();
  await page.getByTestId('no-trip').waitFor({ timeout: 15000 });
  check((await page.getByTestId('no-trip').innerText()).includes('No trip on'), 'no trip on: "No trip on — plan one"');
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n${fails.join('\n')}` : '\nAll passed.');
process.exit(fails.length ? 1 : 0);
