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
// 22 Oct: a trip that finished days ago but whose trip in the app is still 'active' must say Done, not On now.
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const SC_TRIP = 'eeeeeeee-0000-4000-8000-0000000000sc'.replace('sc', '05');
const SC_PLAN = 'eeeeeeee-0000-4000-8000-000000000006';
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1, green: { lat: -35.0 + i * 0.001, lng: 150.5 } }));

const db = {
  players: [
    { id: P1, name: 'Josh M', nickname: 'Josh', handicap: 14, approved: true, created_at: now },
    { id: P2, name: 'Mike Morris', nickname: 'Mike', handicap: 18, approved: true, created_at: now },
    { id: P3, name: 'Adam H', nickname: 'Adam', handicap: 22, approved: true, created_at: now },
  ],
  trips: [
    { id: TRIP, name: 'Test Trip', start_date: today, end_date: today, status: 'active', created_at: now },
    { id: SC_TRIP, name: 'South Coast Trip', start_date: daysAgo(6), end_date: daysAgo(4), status: 'active', created_at: now },
  ],
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
    { id: SC_PLAN, kind: 'trip', name: 'South Coast Trip 2026', status: 'confirmed', start_date: daysAgo(6), end_date: daysAgo(4), location_name: 'Narooma', trip_id: SC_TRIP, proposed: false, rsvp_locked: false, created_by: P1, organiser_id: P1, created_at: now },
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
  plan_rsvps: [P1, P2, P3].map((p) => ({ plan_id: PLAN, player_id: p, status: 'in', updated_at: now })),
  plan_groups: [{ id: ROOM, plan_id: PLAN, kind: 'room', name: 'Bunk room', capacity: 2, sort: 0, created_at: now }],
  plan_group_members: [{ group_id: ROOM, player_id: P2 }],
  tribunal_cases: [], tribunal_votes: [], posts: [{ id: 'p1000000-0000-4000-8000-000000000001', trip_id: TRIP, kind: 'user', body: 'pic', photo_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', created_at: now }], rules: [],
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

const me = { admin: true, player: P1 };
async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  if (url.pathname.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: me.admin, player_id: me.player, group_name: 'L.G.C', group_id: GROUP, role: me.admin ? 'organiser' : 'player', groups: [{ id: GROUP, name: 'L.G.C', slug: 'lgc', role: me.admin ? 'organiser' : 'player' }] });
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
await ctx.addInitScript(([uid]) => { try { localStorage.setItem('tgt-caddie-hello', '1'); } catch { /* ov22 */ }
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

// 1. The Trips tab.
await page.goto(`${BASE}#/plan`);
await page.getByTestId('trips-next').waitFor({ timeout: 15000 });
await page.waitForTimeout(600);
check(/Summer Classic/.test(await page.getByTestId('trips-next').innerText()), 'Upcoming: the next locked-in trip is the first Upcoming card');
check(await page.getByTestId('trips-section-idea').isVisible() && /Proposed/i.test(await page.getByTestId('trips-section-idea').innerText()), 'Proposed section shows');
check(await page.getByText('Dates: 2 options, closes').first().isVisible(), 'idea card says what is still to decide');
check(await page.getByTestId('trips-section-done').isVisible() && /South Coast 2026/.test(await page.getByTestId('trips-section-done').innerText()), 'Previous trips listed');
{
  // ov25: each stage looks different — its own label, icon, class and tag, in order.
  const order = await page.locator('[data-testid^="trips-section-"], [data-testid="trips-being-planned"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  check(order.join(',') === 'trips-section-locked,trips-being-planned,trips-section-idea,trips-section-done', `stage sections in order: Upcoming, Being organised, Proposed, Previous (${order.join(',')})`);
  const looks = await page.locator('.trip-card').evaluateAll((els) => els.map((e) => ({ stage: e.dataset.stage, cls: e.className, pill: e.querySelector('[data-testid="stage-pill"]')?.textContent, tag: e.querySelector('[data-testid="stage-tag"]')?.textContent })));
  const of = (st) => looks.find((l) => l.stage === st) || {};
  check(/🔒 Upcoming/.test(of('locked').pill) && /stage-upcoming/.test(of('locked').cls) && /^(\d+ (days|weeks)|Tomorrow|Today)$/.test(of('locked').tag), `Upcoming: navy, 🔒, a countdown (${of('locked').tag})`);
  check(/🧭 Being organised/.test(of('deciding').pill) && /stage-organising/.test(of('deciding').cls) && /calling courses|voting|getting started/.test(of('deciding').tag), `Being organised: outline, 🧭, what it's up to (${of('deciding').tag})`);
  check(/💡 Proposed/.test(of('idea').pill) && /stage-proposed/.test(of('idea').cls) && /keen/.test(of('idea').tag), `Proposed: dashed, 💡, how many are keen (${of('idea').tag})`);
  check(/🏁 Previous/.test(of('done').pill) && /stage-previous/.test(of('done').cls) && /^[A-Z][a-z]{2} \d{4}$/.test(of('done').tag), `Previous: muted, 🏁, month and year (${of('done').tag})`);
  const borders = await page.locator('.trip-card').evaluateAll((els) => els.map((e) => `${e.dataset.stage}:${getComputedStyle(e).borderTopStyle}`));
  check(borders.includes('idea:dashed') && borders.some((b) => /^deciding:solid/.test(b)), `Proposed is dashed, Being organised is a solid outline (${borders.join(' ')})`);
  check((await page.getByTestId('trips-next').locator('a').first().getAttribute('href')).includes(`/plan/${NEXT}`), 'an Upcoming trip opens its trip page (The run-up)');
}
check((await page.locator('nav.tabs').innerText()).includes('Trips'), 'bottom bar says Trips');
await page.screenshot({ path: `${SHOTS}/t1-trips.png`, fullPage: true });
await noSideScroll('Trips tab');
{
  // Finished 4 days ago, trip still 'active' in the app: a past trip, never "On now".
  const tripsText = await page.locator('.page').innerText();
  const pastPart = await page.getByTestId('trips-section-done').innerText();
  check(pastPart.includes('South Coast Trip 2026'), 'a finished trip still marked active is listed with the Previous trips');
  check(!/on now/i.test(tripsText), 'nothing says "On now" (the finished trip is done)');
  await page.goto(`${BASE}#/plan/${SC_PLAN}`);
  await page.getByText('South Coast Trip 2026').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const planText = await page.locator('.page').innerText();
  check(!/on now/i.test(planText) && /Done/.test(planText), 'its page says Done, not On now');
  await page.screenshot({ path: `${SHOTS}/t1b-finished-active.png`, fullPage: true });
  await page.goto(`${BASE}#/plan`);
  await page.getByTestId('trips-next').waitFor({ timeout: 15000 });
}

// 2. Suggest a trip: makes the plan, opens its votes.
await page.getByRole('button', { name: /Suggest a trip or round/ }).click();
await page.getByText('When? (2–3 options to vote on)').waitFor();
await page.getByLabel('Name').fill('Winter Escape');
const dateInputs = page.locator('.sheet input[type=date]');
await dateInputs.nth(0).fill('2027-06-11');
await dateInputs.nth(1).fill('2027-06-13');
await page.getByLabel('Place 1').fill('Orange');
await page.screenshot({ path: `${SHOTS}/t2-suggest.png`, fullPage: true });
await noSideScroll('Suggest sheet');
writes.length = 0;
await page.getByRole('button', { name: '🗳️ Call the vote' }).click();
await page.waitForTimeout(1200);
const ins = writes.find((w) => w.method === 'POST' && w.table === 'plans');
const rpc = writes.find((w) => w.method === 'RPC' && w.table === 'start_trip_votes');
check(!!ins && ins.body.name === 'Winter Escape' && ins.body.proposed === false, 'suggestion saved as a trip (admin: not just an idea)');
check(!!rpc && rpc.body.p_dates.length === 1 && rpc.body.p_dates[0].end_date === '2027-06-13' && rpc.body.p_places[0].label === 'Orange', 'its dates and place votes are opened with the options typed');

// 3. An idea: the steps (Plan is current — approve or pass), its votes under Vote, chat under More.
await page.goto(`${BASE}#/plan/${IDEA}`);
await page.getByTestId('step-plan').waitFor({ timeout: 10000 });
check(await page.getByTestId('step-plan').getAttribute('data-state') === 'current', 'an idea: the Plan step is current');
check(await page.getByTestId('step-plan').getByRole('button', { name: /Approve/ }).isVisible(), 'an idea: Approve is on the Plan step');
check(await page.getByText('Organiser:').first().isVisible(), 'organiser shown');
await page.getByTestId('step-vote').getByRole('button').first().click();
await page.getByText('Which weekend works?').first().waitFor({ timeout: 10000 });
await page.screenshot({ path: `${SHOTS}/t3-idea-vote.png`, fullPage: true });
await noSideScroll('Trip vote tab');
await page.getByRole('tab', { name: /Chat/ }).click();
await page.getByText('Mudgee every time').waitFor();
writes.length = 0;
await page.getByLabel('Message').fill('Orange is closer');
await page.getByRole('button', { name: 'Send' }).click();
await page.waitForTimeout(800);
check(writes.some((w) => w.method === 'POST' && w.table === 'plan_comments' && w.body.body === 'Orange is closer'), 'chat message sent');
await page.screenshot({ path: `${SHOTS}/t4-chat.png`, fullPage: true });
await noSideScroll('Chat tab');

// 4. Admin closes a vote through the server step.
await page.getByTestId('step-vote').getByRole('button').first().click();
await page.getByRole('button', { name: /Close now & pick the winner/ }).first().click();
writes.length = 0;
await page.getByRole('button', { name: 'Pick this winner' }).click();
await page.waitForTimeout(800);
check(writes.some((w) => w.method === 'RPC' && w.table === 'decide_poll' && w.body.p_poll === POLL1), 'closing a vote uses decide_poll');

// 5. Lock it in (deciding trip with dates).
await page.goto(`${BASE}#/plan/${PLAN}?tab=people`);
await page.getByRole('button', { name: /Lock it in/ }).first().waitFor({ timeout: 10000 });
await page.screenshot({ path: `${SHOTS}/t5-lock-in.png`, fullPage: true });
writes.length = 0;
await page.getByRole('button', { name: /Lock it in/ }).first().click();
await page.waitForTimeout(800);
check(writes.some((w) => w.method === 'PATCH' && w.table === 'plans' && w.body.status === 'confirmed'), 'lock it in sets the trip to Locked in');

// 6. Admin setting.
await page.goto(`${BASE}#/admin`);
await page.getByText('7. Trip votes').click();
await page.getByText('The admin or the trip’s organiser').waitFor();
writes.length = 0;
await page.getByText('The admin or the trip’s organiser').click();
await page.waitForTimeout(600);
check(writes.some((w) => w.method === 'RPC' && w.table === 'set_vote_decider' && w.body.p_value === 'admin_or_organiser'), 'admin can let organisers pick winners');
await page.screenshot({ path: `${SHOTS}/t6-admin.png` });

// 7. v8 fix (23 Oct 2026): live L.G.C's "March" — a trip being planned with no dates — must show on Trips,
// for the organiser and for members. Exactly the live shape: kind trip, status planning, proposed false, no dates,
// location_name "Blue mountains", organiser set, trip_id null; plus the past South Coast trip.
{
  const MARCH = '17f1ac42-4b37-43ff-96e5-d67890e2c663';
  db.plans = [
    { id: MARCH, kind: 'trip', name: 'March', status: 'planning', proposed: false, start_date: null, end_date: null, location_name: 'Blue mountains',
      organiser_id: P2, created_by: P1, trip_id: null, rsvp_locked: false, created_at: now },
    db.plans.find((p) => p.id === SC_PLAN),
  ];
  db.plan_polls = []; db.plan_options = [];
  for (const who of [{ admin: true, player: P1, label: 'organiser' }, { admin: false, player: P3, label: 'member' }]) {
    Object.assign(me, who);
    await page.goto(`${BASE}#/`);
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('lgc-cache-')) localStorage.removeItem(k); });
    await page.goto(`${BASE}#/plan`);
    await page.reload();
    await page.getByTestId('trips-section-done').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    const section = page.getByTestId('trips-being-planned');
    check(await section.isVisible() && /Being organised/i.test(await section.innerText()), `${who.label}: a "Being organised" section shows`);
    const txt = await section.innerText().catch(() => '');
    check(/March/.test(txt) && /Blue mountains/.test(txt) && /When: to be voted on/.test(txt), `${who.label}: March (no dates, Blue mountains) is listed under Being organised`);
    check(/organiser Mike/.test(txt), `${who.label}: its organiser is named`);
    check(!(await page.getByText('Nothing locked in yet').isVisible()), `${who.label}: no "Nothing locked in yet" while a trip is being planned`);
    check(await page.getByText('South Coast Trip 2026').isVisible(), `${who.label}: the past South Coast trip still shows`);
    if (who.admin) await page.screenshot({ path: `${SHOTS}/t7-being-planned.png`, fullPage: true });
  }
}

check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
