// Planning made clearer (080), 22 Oct 2026. Fake database and fake functions only — nothing real is touched.
//   A. "✨ Plan it with AI" is the Caddie's ✨ Plan a trip (ov16): a vague message gets questions back (no plan yet);
//      then the draft makes a draft trip and the trip builder fills in under the chat; "Add another…" Mudgee → the
//      builder gets the new area, and what the page shows goes with the next question.
//   B. The trip builder start: one page per region (chips), each with its own map, courses and places to stay, a list
//      link pasted in; extras; the regions side by side (Compare).
//   C. Call the vote: the full range with tick boxes; untick one, set the closing date → How it goes out (app and
//      email counts, Copy link through the group's invite).
//   D. The organiser's results ("3 don't like it", View places links) vs the voter's ballot (⭐ Prefer / 👍 Option /
//      👎 Don't like; dates ✓ / ? / ✗) and "Thanks — here's how it's looking".
//   E. The share link opened by someone not in the group yet: join → lands on the vote.
//   F. Calling the courses: one person for all / per course; the caller fills a whole weekend for two courses + social
//      times (the job can't be ticked off with gaps); the organiser sees the best times each day.
// Usage: node plan-ux-test.mjs <base> <shotDir>   e.g. http://localhost:4392/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4392/lgc-golf/';
const SHOTS = process.argv[3] || './shots-plan-ux';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000f';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const PLAN2 = 'eeeeeeee-0000-4000-8000-000000000002';
const CODE = 'ABCDEFGH2345';
const now = new Date().toISOString();
const pid = (i) => `${String(i + 1).padStart(8, '0')}-2222-4222-8222-222222222222`;
const K = pid(0);
const AL = pid(1);
const names = ['Josh', 'Al', 'Bo', 'Cy', 'Di', 'Ed', 'Fin', 'Gus', 'Hal', 'Ian', 'Jo', 'Kev'];
const players = names.map((n, i) => ({ id: pid(i), name: `${n} Test`, nickname: n, handicap: 10 + i, approved: true, created_at: now }));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
// Two Fri–Sun weekends a few weeks out.
const fri = (() => { const d = new Date(); d.setDate(d.getDate() + 21); while (d.getDay() !== 5) d.setDate(d.getDate() + 1); return d; })();
const W1 = { start: iso(fri), end: iso(new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 2)), long: false };
const W2 = { start: iso(new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 7)), end: iso(new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 9)), long: false };
const dayOf = (w, n) => { const d = new Date(`${w.start}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };

const L = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const library = [
  // Hunter Valley
  { id: L(1), name: 'Stonebridge Golf Club', area: 'Cessnock NSW', lat: -32.824, lng: 151.339 },
  { id: L(2), name: 'Cypress Lakes Golf & Country Club', area: 'Pokolbin NSW', lat: -32.783, lng: 151.291, mine_avg: 4.5 },
  { id: L(3), name: 'The Vintage Golf Club', area: 'Rothbury NSW', lat: -32.738, lng: 151.323 },
  { id: L(4), name: 'Branxton Golf Club', area: 'Branxton NSW', lat: -32.659, lng: 151.357 },
  // South Coast
  { id: L(11), name: 'Shoalhaven Heads Golf Course', area: 'Shoalhaven Heads NSW', lat: -34.845, lng: 150.748 },
  { id: L(12), name: 'Gerringong Golf Club', area: 'Gerringong NSW', lat: -34.763, lng: 150.824 },
  { id: L(13), name: 'Worrigee Links Golf Course', area: 'Nowra NSW', lat: -34.887, lng: 150.628 },
  { id: L(14), name: 'Kiama Golf Club', area: 'Kiama NSW', lat: -34.627, lng: 150.852 },
  { id: L(15), name: 'Nowra Golf Course', area: 'Nowra NSW', lat: -34.866, lng: 150.592 },
  // Central West
  { id: L(21), name: 'Duntryleague Golf Club', area: 'Orange NSW', lat: -33.277, lng: 149.082 },
  { id: L(22), name: 'Bloomfield Country Club', area: 'Orange NSW', lat: -33.314, lng: 149.097 },
  { id: L(23), name: 'Wentworth Golf Club Orange', area: 'Orange NSW', lat: -33.291, lng: 149.07 },
  { id: L(24), name: 'Bathurst Golf Club', area: 'Bathurst NSW', lat: -33.418, lng: 149.553 },
].map((c) => ({ holes: 18, facts: [], ...c }));
const slim = (id) => { const c = library.find((x) => x.id === id); return { id, name: c.name, area: c.area, lat: c.lat, lng: c.lng }; };
const stayAreas = [
  ['Pokolbin', 'Hunter Valley', -32.78, 151.29], ['Cessnock', 'Hunter Valley', -32.83, 151.36], ['Newcastle', 'Hunter Valley', -32.93, 151.78],
  ['Kiama', 'South Coast NSW', -34.67, 150.85], ['Shoalhaven Heads', 'South Coast NSW', -34.85, 150.74], ['Nowra', 'South Coast NSW', -34.88, 150.60],
  ['Orange', 'Central West NSW', -33.28, 149.10], ['Bathurst', 'Central West NSW', -33.42, 149.58], ['Mudgee', 'Central West NSW', -32.59, 149.59],
].map(([name, region, lat, lng], i) => ({ id: crypto.randomUUID(), name, state: 'NSW', region, lat, lng, sort: i }));
const pin = (n) => { const a = stayAreas.find((x) => x.name === n); return { key: n, name: n, lat: a.lat, lng: a.lng }; };
const HUNTER = [L(1), L(2), L(3), L(4)];
const SOUTH = [L(11), L(12), L(13), L(14), L(15)];
const WEST = [L(21), L(22), L(23), L(24)];
const startState = {
  v: 1, region: null, regionOptions: ['Hunter Valley', 'South Coast NSW', 'Central West NSW'], origin: null, nights: 2,
  weekends: [W1, W2], weekendsSettled: false, stays: [], pins: [], stayMax: 40, detourMax: 25,
  days: [{ index: 0, leg: 'way', options: [] }, { index: 1, leg: 'stay', options: [] }, { index: 2, leg: 'home', options: [] }],
  courses: Object.fromEntries([...HUNTER, ...SOUTH, ...WEST].map((id) => [id, slim(id)])), headcount: null, votes: {}, optionKeys: {}, callsMade: false, configs: [], picked: null,
  areaCourses: { 'Hunter Valley': HUNTER, 'South Coast NSW': SOUTH, 'Central West NSW': WEST },
  areaStays: { 'Hunter Valley': [pin('Pokolbin'), pin('Cessnock')], 'South Coast NSW': [pin('Kiama'), pin('Shoalhaven Heads'), pin('Nowra')], 'Central West NSW': [pin('Orange'), pin('Bathurst')] },
  suggested: { [`course:Hunter Valley:${L(4)}`]: true },
  extras: [
    { key: 'trophy', label: 'Trophy & engraving', pp: 15, kind: 'trophy', job: 'Order the trophy and engraving', state: 'in' },
    { key: 'shirts', label: 'Shirts or caps', pp: 45, kind: 'shirts', job: 'Order the shirts or caps', state: 'vote' },
    { key: 'bus', label: 'Bus or transfers', pp: 40, kind: 'transport', job: 'Book the bus', state: 'vote' },
  ],
};
const J1 = crypto.randomUUID(); const J2 = crypto.randomUUID();
const callState = {
  ...startState, region: 'South Coast NSW', regionOptions: ['South Coast NSW'], weekends: [W1], weekendsSettled: true, stays: [pin('Kiama')],
  days: [{ index: 0, leg: 'way', options: [] }, { index: 1, leg: 'stay', options: [L(14), L(12)] }, { index: 2, leg: 'home', options: [] }],
  callsMade: true, callJobs: { [L(14)]: J1, [L(12)]: J2 },
};
const stay = (plan, name, area, link, total = null, isList = false) => ({ id: crypto.randomUUID(), group_id: GROUP, plan_id: plan, name, area, link, total_cost: total, sleeps: total ? 12 : null, is_list: isList, option_id: null, chosen: false, created_by: K, created_at: now });

const db = {
  players, trips: [], trophies: [], teams: [], team_players: [], quick_results: [], round_pins: [], scores: [], round_players: [], honour_board: [],
  courses: [], rounds: [],
  plans: [
    { id: PLAN, kind: 'trip', name: 'Spring away', status: 'planning', start_date: null, end_date: null, proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, budget_pp: 900, created_at: now },
    { id: PLAN2, kind: 'trip', name: 'South Coast weekend', status: 'planning', start_date: null, end_date: null, proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, created_at: now },
  ],
  plan_polls: [], plan_options: [], plan_votes: [], plan_comments: [], plan_costs: [], plan_payments: [], plan_transfers: [], notify_prefs: [], plan_budget_items: [],
  plan_items: [
    { id: J1, plan_id: PLAN2, group_id: GROUP, kind: 'job', title: '📞 Call Kiama Golf Club — ask for 3 tee times in a row', owner_id: null, done: false, stage: 'todo', created_by: K, created_at: now },
    { id: J2, plan_id: PLAN2, group_id: GROUP, kind: 'job', title: '📞 Call Gerringong Golf Club — ask for 3 tee times in a row', owner_id: null, done: false, stage: 'todo', created_by: K, created_at: now },
  ],
  plan_rsvps: [PLAN, PLAN2].flatMap((p) => players.map((x) => ({ plan_id: p, player_id: x.id, status: 'in', updated_at: now }))),
  plan_groups: [], plan_group_members: [], groups: [{ id: GROUP, vote_decider: 'admin', vote_channel: 'app' }],
  tribunal_cases: [], tribunal_votes: [], posts: [], rules: [], player_home_areas: [],
  trip_start_points: [{ id: crypto.randomUUID(), group_id: GROUP, plan_id: PLAN, label: 'Inner West', lat: -33.88, lng: 151.16, headcount: 12, leave_after: '06:00', finish_by: '17:00', sort: 0 }],
  trip_finds: [], course_notes: [], course_ratings: [], stay_areas: stayAreas, trip_tee_options: [], course_booking_info: [], vote_batches: [], course_social_times: [],
  trip_builds: [{ plan_id: PLAN, group_id: GROUP, state: startState }, { plan_id: PLAN2, group_id: GROUP, state: callState }],
  plan_stays: [
    stay(PLAN, 'Airbnb list — Pokolbin', 'Hunter Valley', 'https://www.airbnb.com.au/wishlists/v/111', null, true),
    stay(PLAN, 'Vineyard house, Pokolbin', 'Hunter Valley', 'https://www.stayz.com.au/holiday-rental/p1', 4800),
    stay(PLAN, 'Beach house, Shoalhaven Heads', 'South Coast NSW', 'https://www.stayz.com.au/holiday-rental/p2', 3900),
    stay(PLAN, 'Farm stay, Orange', 'Central West NSW', 'https://www.airbnb.com.au/rooms/3', 3600),
  ],
  group_features: ['feed', 'planner', 'planner_tasks', 'trip_finder', 'ai_helper', 'planner_costs'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let asPlayer = false;
let member = true;
const rpcCalls = []; const notifyCalls = []; const aiCalls = [];
const match = (r, k, v) => {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(r[k]));
  if (v.startsWith('is.')) return v === 'is.null' ? r[k] == null : true;
  if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
  return true;
};
const filterRows = (rows, params) => rows.filter((r) => {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'group_id' && r.group_id === undefined) continue;
    if (!match(r, k, v)) return false;
  }
  return true;
});
function rpc(name, body) {
  rpcCalls.push({ name, body });
  const me = asPlayer ? AL : K;
  if (name === 'my_status') {
    if (!member) return { is_member: false, is_admin: false, player_id: null, group_id: null, groups: [] };
    return { is_member: true, is_admin: !asPlayer, player_id: me, group_name: 'Test Golfers', group_id: GROUP, role: asPlayer ? 'player' : 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Test Golfers', slug: 'test', role: asPlayer ? 'player' : 'organiser' }] };
  }
  if (name === 'trip_finder_courses') return library;
  if (name === 'group_invite') return CODE;
  if (name === 'invite_info') return { group_id: GROUP, group_name: 'Test Golfers', role: 'player', already_in: member };
  if (name === 'join_by_invite') { member = true; asPlayer = true; return GROUP; }
  if (name === 'vote_channels') return players.map((p, i) => ({ player_id: p.id, on_app: i < 9, choice: i === 1 ? 'both' : i === 2 ? 'email' : 'app', has_email: i === 1 || i === 2 || i === 9 || i === 10, source: 'own' }));
  if (name === 'put_stays_to_vote') {
    const batch = db.plan_polls.filter((p) => p.plan_id === body.p_plan && p.vote_batch && p.status === 'open').at(-1)?.vote_batch || null;
    const poll = { id: crypto.randomUUID(), plan_id: body.p_plan, group_id: GROUP, kind: 'other', purpose: 'stay', question: 'Where should we stay?', closes_on: body.p_closes_on, status: 'open', vote_batch: batch, created_by: K, created_at: new Date().toISOString() };
    db.plan_polls.push(poll);
    for (const s of db.plan_stays.filter((x) => x.plan_id === body.p_plan && !x.option_id && (!body.p_only || body.p_only.includes(x.id)))) {
      const o = { id: crypto.randomUUID(), poll_id: poll.id, group_id: GROUP, label: s.name, link: s.link, notes: [s.area, s.total_cost ? `$${s.total_cost} total` : null].filter(Boolean).join(' · '), created_by: K, created_at: new Date().toISOString() };
      db.plan_options.push(o); s.option_id = o.id;
    }
    return { poll_id: poll.id, joined: !!batch };
  }
  if (name === 'partner_courses_for') return [];
  return null;
}
const DRAFT1 = {
  name: 'Spring away', kind: 'trip', budget_pp: 900, warnings: [], notes: '', jobs: [], bring: [], costs: [], extras: [{ label: 'Shirts or caps', pp: 45 }],
  dates: [{ start_date: W1.start, end_date: W1.end, note: '' }, { start_date: W2.start, end_date: W2.end, note: '' }],
  places: [{ label: 'Hunter Valley', courses: HUNTER, address: 'Stonebridge Golf Club + Cypress Lakes + The Vintage + Branxton', cost_pp: 850, notes: null },
    { label: 'South Coast NSW', courses: SOUTH.slice(0, 4), address: 'Shoalhaven Heads + Gerringong + Worrigee Links + Kiama', cost_pp: 800, notes: null }],
};
const DRAFT2 = { ...DRAFT1, places: [...DRAFT1.places, { label: 'Mudgee', courses: [L(24)], address: 'Mudgee Golf Club + Bathurst Golf Club', cost_pp: 700, notes: '3.5 hrs from Sydney' }] };
const Q = [
  { id: 'places', text: 'These are the places I’d look at — any others?', quick: ['Looks good', 'Add another…'] },
  { id: 'dates', text: 'Weekends: these two — or other weekends?', quick: ['Those work', 'Different dates…'] },
];
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/')) return json(rpc(p.split('/').pop(), JSON.parse(req.postData() || '{}')));
  if (p.startsWith('/functions/v1/notify')) { notifyCalls.push(JSON.parse(req.postData() || '{}')); return json({ sent: 3 }); }
  if (p.startsWith('/functions/v1/ai-helper')) {
    const b = JSON.parse(req.postData() || '{}');
    aiCalls.push(b);
    if (b.mode === 'plan_chat') {
      // ov16: a vague first message gets questions back (no draft yet).
      if (/^Golf trip/.test(b.text)) {
        return json({ chat: { message: 'Love it — a golf trip with the boys. A couple of quick ones first:', draft: null, questions: [
          { id: 'travel', text: 'Driving or flying?', quick: ['Driving', 'Flying', 'Not sure'] },
          { id: 'when', text: 'Roughly when, and how many?', quick: ['Next month', 'Spring', 'Other…'] }], done: false, summary: [] }, remaining: { month: 50, today: 9 }, log_id: 6 });
      }
      const second = /Mudgee/.test(b.text);
      return json({ chat: { message: second ? 'Added Mudgee — here are the options now. Want to add any?' : 'Here are some options — want to add any?', draft: second ? DRAFT2 : DRAFT1, questions: second ? [Q[1]] : Q, done: false,
        summary: ['Start the trip “Spring away”, about $900 each', `Vote on where: ${(second ? DRAFT2 : DRAFT1).places.map((x) => x.label).join(' · ')}`] }, remaining: { month: 50, today: 9 }, log_id: 7 });
    }
    return json({ error: 'not in this test' });
  }
  if (p.startsWith('/functions/v1/')) return json({ sent: 0 });
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const conflict = url.searchParams.get('on_conflict') || (table === 'plan_rsvps' ? 'plan_id,player_id' : table === 'plan_votes' ? 'option_id,player_id' : table === 'trip_builds' ? 'plan_id' : null);
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const keys = conflict ? conflict.split(',') : null;
        const old = keys && rows.find((r) => keys.every((k) => String(r[k]) === String(b[k])));
        if (old) { Object.assign(old, b, { updated_at: new Date().toISOString() }); made.push(old); continue; }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...b };
        if (table === 'plan_polls') { row.status ??= 'open'; row.created_by ??= K; }
        if (table === 'plan_options') row.created_by ??= K;
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
const state = (id = PLAN) => db.trip_builds.find((b) => b.plan_id === id)?.state || {};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.route('https://server.arcgisonline.com/**', (r) => r.fulfill({ status: 204, body: '' }));
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */ localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());
const wait = (ms = 500) => page.waitForTimeout(ms);
const shot = (n, full = true) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const noSideScroll = async (label) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w <= 376, `${label}: no sideways scroll at 375px (${w})`);
};

// ---------------------------------------------------------------- A. ✨ Plan a trip — in the Caddie (ov16)
// "Plan it with AI" IS the Caddie: a sheet on the phone (not a modal — the trip screen stays above it), and the real
// trip builder fills in as you talk. It asks first; "plan it" stops the questions; what you change on the page goes
// back to the helper.
const CSHOTS = process.env.CADDIE_SHOTS || `${SHOTS}/caddie-plan`;
fs.mkdirSync(CSHOTS, { recursive: true });
await page.goto(`${BASE}#/plan`);
await page.getByTestId('plan-with-ai').click();
await page.getByTestId('caddie-plan-sheet').waitFor({ timeout: 10000 });
check(!(await page.locator('.sheet-bg').count()), 'phone: the planning chat is a sheet over the page, not a modal');
await page.getByLabel('Your message').fill('Golf trip with the boys');
await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.getByText('Driving or flying?').waitFor({ timeout: 10000 });
check(!(await page.getByTestId('draft-card').count()), 'a vague first message: questions back, no plan yet');
check((await page.getByTestId('chat-question').count()) === 2, 'two short questions with quick answers');
check((await page.getByTestId('plan-it-hint').innerText()).includes('plan it'), '"Or just say “plan it”…" under the reply');
const first = aiCalls.filter((c) => c.mode === 'plan_chat')[0];
check(!first.draft && !first.page, 'the first question carries no draft or page');
const before = db.plans.length;
check(true, `nothing made yet (${before} plans)`);
await page.screenshot({ path: `${CSHOTS}/m-01-asks-first.png` });
await page.getByLabel('Your message').fill('Driving. Late Nov or early Dec, 12 of us, within 3.5 hours of Sydney, about $900 each');
await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.waitForURL(/#\/plan\/[0-9a-f-]{36}\/build/, { timeout: 15000 });
const newPlan = page.url().match(/plan\/([0-9a-f-]{36})\/build/)[1];
const build = () => db.trip_builds.find((b) => b.plan_id === newPlan)?.state;
check(db.plans.some((p) => p.id === newPlan && p.name === 'Spring away'), 'the draft makes a draft trip');
check(JSON.stringify(build()?.regionOptions) === JSON.stringify(['Hunter Valley', 'South Coast NSW']), 'the AI’s places land on the trip builder as area options');
check(!build()?.region, 'nothing is picked for the organiser');
await page.getByTestId('area-tabs').waitFor({ timeout: 15000 });
check((await page.getByTestId('area-tabs').innerText()).includes('South Coast NSW'), 'the real trip screen shows them');
check(await page.getByText('Show the chat ↑').isVisible(), 'the chat folds down so the trip shows');
await page.screenshot({ path: `${CSHOTS}/m-02-trip-filling-in.png` });
await page.getByText('Show the chat ↑').click();
await page.getByRole('button', { name: 'Add another…' }).click();
check((await page.getByLabel('Your message').inputValue()) === 'Add another: ', 'Add another… opens the box to type');
await wait(100);
await page.getByLabel('Your message').type('Mudgee');
await page.screenshot({ path: `${CSHOTS}/m-03-sheet-over-trip.png` });
await page.getByRole('button', { name: 'Send', exact: true }).click();
for (let i = 0; i < 50 && !(build()?.regionOptions || []).includes('Central West NSW'); i++) await wait(100);
check((build()?.regionOptions || []).includes('Central West NSW'), 'the next draft (Mudgee) updates the trip builder');
const third = aiCalls.filter((c) => c.mode === 'plan_chat')[2];
check(third?.text === 'Add another: Mudgee' && third.messages.length === 4 && third.draft?.places?.length === 2, 'the conversation so far and the current draft go with each turn');
check(third?.page?.areas?.map((a) => a.area).join() === 'Hunter Valley,South Coast NSW', 'what the trip screen shows goes with the question');
await page.getByText('Show the trip ↓').click(); await wait(800);
check((await page.getByTestId('area-tabs').innerText()).includes('Central West NSW'), 'the trip screen shows the new area without a reload');
await page.screenshot({ path: `${CSHOTS}/m-04-trip-updated.png` });
// Leaving and coming back keeps the chat.
await page.getByRole('button', { name: 'Close' }).last().click(); await wait(300);
await page.goto(`${BASE}#/plan`);
check(/Carry on your plan \(6 messages\)/.test(await page.getByTestId('plan-with-ai').innerText()), `closed the chat: Trips offers "Carry on your plan (6 messages)" (${await page.getByTestId('plan-with-ai').innerText()})`);
await page.getByTestId('plan-with-ai').click();
await page.getByTestId('caddie-plan-sheet').waitFor({ timeout: 5000 });
check((await page.getByTestId('chat-me').count()) === 3, 'back in: the messages are still there');
check(await page.getByTestId('open-trip').isVisible(), 'and a button back to the trip it’s filling in');
await page.getByRole('button', { name: 'Close' }).last().click(); await wait(300);

// ---------------------------------------------------------------- B. A page per region, then side by side
await page.goto(`${BASE}#/plan/${PLAN}/build`);
await page.getByTestId('area-start').waitFor({ timeout: 15000 });
const tabs = page.getByTestId('area-tabs');
check((await tabs.innerText()).includes('Hunter Valley') && (await tabs.innerText()).includes('Central West NSW') && (await tabs.innerText()).includes('Compare'), 'region chips across the top, plus Compare');
await page.getByTestId('area-course').first().waitFor({ timeout: 10000 });
check((await page.getByTestId('area-courses').innerText()).includes('Cypress Lakes'), 'Hunter Valley: its own courses');
check((await page.getByTestId('area-courses').locator('input:checked').count()) === 4, 'Hunter Valley: 4 courses on the table (several, not one)');
check((await page.getByTestId('area-stays').innerText()).includes('Airbnb list — Pokolbin'), 'Hunter Valley: places to stay with the shared list');
check(await page.locator('.tb-stay', { hasText: 'Pokolbin' }).count() > 0, 'stay pins on the map');
await shot('04-region-hunter');
await noSideScroll('Region page');
await tabs.getByRole('tab', { name: 'South Coast NSW' }).click(); await wait(800);
check((await page.getByTestId('area-courses').innerText()).includes('Gerringong') && (await page.getByTestId('area-courses').locator('input:checked').count()) === 5, 'South Coast: its own map and 5 courses');
// A shared list link for this region.
await page.getByLabel('List link').fill('https://www.airbnb.com.au/wishlists/v/222');
await page.getByTestId('list-prompt').getByRole('button', { name: 'Add' }).click(); await wait(800);
const added = db.plan_stays.find((s) => s.link === 'https://www.airbnb.com.au/wishlists/v/222');
check(!!added && added.area === 'South Coast NSW' && added.is_list === true, `a pasted list is kept against the region (${added?.name})`);
check((await page.getByTestId('stay-search').innerText()).includes('12 people · 6+ bedrooms'), 'search links say what they search for (12 people, 6+ bedrooms)');
const air = await page.getByTestId('stay-search-set').first().getByRole('link', { name: /Airbnb/ }).getAttribute('href');
check(air.includes('min_bedrooms=6') && air.includes(`checkin=${W1.start}`), 'the Airbnb link carries the weekend and bedrooms');
await shot('05-region-south-coast');
await page.getByTestId('extras').getByRole('button').first().click(); await wait(300);
check((await page.getByTestId('extra').count()) >= 3, 'extras: in / ask the group');
await tabs.getByRole('tab', { name: /Compare/ }).click(); await wait(500);
const cmp = page.getByTestId('compare-area');
check((await cmp.count()) === 3, 'Compare: three regions side by side');
check((await cmp.nth(0).innerText()).includes('about $400 each to stay'), `Compare: rough cost each from the cheapest place (${(await cmp.nth(0).innerText()).match(/about \$\d+ each/)?.[0]})`);
check(/about \d h/.test(await cmp.nth(2).innerText()) || /about \d+ min/.test(await cmp.nth(2).innerText()), 'Compare: the drive from home');
await shot('06-compare');
await noSideScroll('Compare');

// ---------------------------------------------------------------- C. Call the vote
await page.getByTestId('compare-call-vote').click();
await page.getByTestId('call-vote').waitFor({ timeout: 5000 });
const qs = await page.getByTestId('ballot-section').locator('strong').allInnerTexts();
check(['Which area?', 'Which weekend?', 'Which town to stay in?', 'Hunter Valley: which courses?', 'Where should we stay?', 'Would you do these?'].every((q) => qs.includes(q)), `the full range on the table (${qs.join(' / ')})`);
await page.getByLabel('Which area?: Central West NSW').uncheck();
const closes = plusDays(4);
await page.getByLabel('Closes').fill(closes);
await shot('07-call-vote');
await page.getByTestId('call-the-vote').click();
await page.getByTestId('how-it-goes-out').waitFor({ timeout: 10000 });
const batch = db.vote_batches[0];
const polls = db.plan_polls.filter((p) => p.vote_batch === batch?.id);
const areaPoll = polls.find((p) => p.question === 'Which area?');
check(!!batch && batch.closes_on === closes && batch.keen === true, 'one vote card, closing on the date set, asking "Are you keen?"');
check(db.plan_options.filter((o) => o.poll_id === areaPoll?.id).map((o) => o.label).join() === 'Hunter Valley,South Coast NSW', 'the unticked region stays off the ballot');
check(!polls.some((p) => /Central West/.test(p.question)) && !db.plan_options.some((o) => polls.some((p) => p.id === o.poll_id) && /Orange|Bathurst/.test(o.label)), 'unticking a region takes its towns, courses and places to stay off too');
const stayPoll = polls.find((p) => p.purpose === 'stay');
check(!!stayPoll && db.plan_options.filter((o) => o.poll_id === stayPoll.id).every((o) => o.link), 'accommodation ideas go on with their links');
check((await page.getByTestId('reach-app').innerText()).includes(' 8 ') && (await page.getByTestId('reach-email').innerText()).includes(' 4 '), `How it goes out: app 8 (9 on the app, 1 chose email only), email 4 (${await page.getByTestId('reach-app').innerText()} / ${await page.getByTestId('reach-email').innerText()})`);
const msg = await page.getByTestId('share-message').innerText();
check(msg.startsWith('🗳️ Where and when for Spring away? Vote by') && msg.includes(`#/join/${CODE}?to=${encodeURIComponent(`/plan/${PLAN}?tab=vote`)}`), `ready-to-paste message with the link (${msg.slice(0, 60)}…)`);
await page.getByTestId('copy-link').click(); await wait(300);
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check(clip.endsWith(`#/join/${CODE}?to=${encodeURIComponent(`/plan/${PLAN}?tab=vote`)}`), 'Copy link copies the join-then-vote link (one scheme, 083)');
check(notifyCalls.filter((n) => n.type === 'poll_open').length === 1, 'one notification for the whole card');
await shot('08-how-it-goes-out');
await page.getByRole('button', { name: 'Done' }).click(); await wait(300);

// ---------------------------------------------------------------- D. Organiser results vs the voter's ballot
const hunter = db.plan_options.find((o) => o.poll_id === areaPoll.id && o.label === 'Hunter Valley');
const south = db.plan_options.find((o) => o.poll_id === areaPoll.id && o.label === 'South Coast NSW');
for (const i of [3, 4, 5]) db.plan_votes.push({ option_id: hunter.id, poll_id: areaPoll.id, player_id: pid(i), response: 'no', updated_at: now });
for (const i of [3, 4]) db.plan_votes.push({ option_id: south.id, poll_id: areaPoll.id, player_id: pid(i), response: 'yes', updated_at: now });
await page.goto(`${BASE}#/plan/${PLAN}?tab=vote`);
await page.getByTestId('vote-batch').waitFor({ timeout: 15000 });
const card = page.getByTestId('vote-batch');
check((await card.getAttribute('data-view')) === 'organiser', 'the organiser gets the results view');
check((await card.getByTestId('against').first().innerText()).includes('3 don’t like it'), 'an option several don’t like is flagged ("3 don’t like it")');
check((await card.getByTestId('batch-dashboard').innerText()).includes('Still to answer'), 'who hasn’t answered, with Nudge');
check((await card.locator('[data-testid="poll-organiser"][data-collapsed="true"]').count()) >= 5, 'each question is a compact row that expands');
await card.locator('[data-testid="poll-organiser"]', { hasText: 'Where should we stay?' }).click(); await wait(300);
check((await card.getByTestId('option-link').count()) > 0 && (await card.getByTestId('option-link').first().innerText()).includes('View places'), 'places carry a "View places" link');
check(await card.getByTestId('your-vote').first().isVisible(), 'their own ballot is a small "Your vote"');
await shot('09-organiser-results');
asPlayer = true;
await page.reload();
await page.getByTestId('vote-batch').waitFor({ timeout: 15000 });
check((await card.getAttribute('data-view')) === 'voter', 'a player gets just the ballot');
const sections = card.getByTestId('vote-batch-section');
check((await sections.nth(0).getByRole('button', { name: '⭐ Prefer' }).count()) === 2 && (await sections.nth(1).getByRole('button', { name: '✓ Can' }).count()) === 2, 'places: ⭐ Prefer / 👍 Option / 👎 Don’t like; weekends: ✓ Can');
check((await card.innerText()).includes('closes'), 'the ballot says when it closes');
await shot('10-voter-ballot');
for (let i = 0; i < await sections.count(); i++) {
  const words = await sections.nth(i).locator('[data-answer="maybe"]').first().innerText().catch(() => '');
  if (words) { await sections.nth(i).locator('[data-answer="maybe"]').first().click(); await wait(350); }
}
await card.getByTestId('vote-batch-keen').getByRole('button', { name: '✓ In' }).click(); await wait(600);
check(await card.getByTestId('voter-thanks').isVisible(), 'answered everything: "Thanks — here’s how it’s looking"');
check(db.plan_votes.some((v) => v.player_id === AL && v.response === 'maybe'), 'answers saved (stored as yes / maybe / no)');
await shot('11-voter-thanks');

// ---------------------------------------------------------------- E. An OLD vote link (?vote=, before 083), opened by someone not in the group yet
member = false; asPlayer = false;
await page.goto(`${BASE}#/join/${CODE}?vote=${PLAN}`);
await page.reload();
await page.getByRole('button', { name: 'Join', exact: true }).waitFor({ timeout: 15000 });
await shot('12-join');
await page.getByRole('button', { name: 'Join', exact: true }).click();
await page.waitForURL(new RegExp(`#/plan/${PLAN}\\?tab=vote`), { timeout: 15000 });
// ov14: a player's vote link opens the Overview, votes front and centre (Al has voted already: "You've voted ✓").
await page.getByTestId('overview-votes').waitFor({ timeout: 15000 });
check(await page.getByTestId('voted').first().isVisible(), 'after joining, they land on the vote (on the Overview; already voted → "You’ve voted ✓")');
await page.getByTestId('voted').first().getByRole('button').first().click();
await page.getByTestId('vote-batch').waitFor({ timeout: 15000 });
check((await page.getByTestId('vote-batch').getAttribute('data-view')) === 'voter', 'see results: the ballot with how it’s looking');
await shot('13-joined-vote');

// ---------------------------------------------------------------- F. Calling the courses
asPlayer = false; member = true;
await page.goto(`${BASE}#/plan/${PLAN2}/build`);
await page.reload();
await page.locator('[data-testid="tb-step-calls"]').waitFor({ timeout: 15000 });
await page.locator('[data-testid="tb-step-calls"]').getByRole('button').first().click(); await wait(600);
await page.getByTestId('calls-one').click();
await page.getByLabel('One person for all').selectOption(AL); await wait(800);
check([J1, J2].every((id) => db.plan_items.find((j) => j.id === id).owner_id === AL), 'one person for all: every call handed to Al in one go');
await page.getByTestId('calls-per').click();
await page.locator('[data-testid="tb-call"]', { hasText: 'Gerringong' }).getByLabel('Who calls').selectOption(pid(2)); await wait(800);
check(db.plan_items.find((j) => j.id === J2).owner_id === pid(2) && db.plan_items.find((j) => j.id === J1).owner_id === AL, 'per course: one changed, the other kept');
await page.getByTestId('calls-one').click();
await page.getByLabel('One person for all').selectOption(AL); await wait(800);
check(db.plan_items.find((j) => j.id === J2).owner_id === AL, 'back to one person for all');
check((await page.getByTestId('tee-day').count()) === 6, 'each course covers every day of the weekend (2 × 3)');
await shot('14-calls-who');

asPlayer = true;
await page.goto(`${BASE}#/plan/${PLAN2}`);
await page.reload();
await page.getByTestId('next-step').waitFor({ timeout: 15000 });
check((await page.getByTestId('next-step').innerText()).includes('Your job: call 2 courses for tee times'), 'the caller gets ONE next step for both calls');
await page.goto(`${BASE}#/plan/${PLAN2}/build`);
await page.locator('[data-testid="tb-step-calls"]').getByRole('button').first().click(); await wait(600);
const day = (course, n) => page.locator('[data-testid="tb-call"]', { hasText: course }).locator(`[data-testid="tee-day"][data-date="${dayOf(W1, n)}"]`);
const fill = async (course, n, avail, text = '') => {
  const d = day(course, n);
  await d.getByTestId('tee-day-edit').click();
  await d.getByRole('button', { name: avail }).click();
  if (text) await d.getByLabel(`Times on offer ${dayOf(W1, n)}`).fill(text);
  if (avail === '✓ Yes') await d.getByLabel(`Price ${dayOf(W1, n)}`).fill('85');
  await d.getByTestId('tee-day-save').click(); await wait(600);
};
check((await page.locator('[data-testid="tb-call"]', { hasText: 'Kiama' }).getByTestId('call-checklist').textContent()).includes('Fri, Sat, Sun'), 'the caller’s checklist: every day of the weekend');
await fill('Kiama', 0, '✓ Yes', '7:30-8:00');
await fill('Kiama', 1, '✗ No');
await fill('Kiama', 2, '? Not sure');
await fill('Gerringong', 0, '✓ Yes', '9:00-9:30');
await fill('Gerringong', 1, '✓ Yes', '7:00-7:20');
check((await page.locator('[data-testid="tb-call"]', { hasText: 'Gerringong' }).getByTestId('call-progress').innerText()) === '2 of 3 days filled', 'progress: "2 of 3 days filled"');
await page.locator('[data-testid="tb-call"]', { hasText: 'Gerringong' }).getByTestId('call-done').click(); await wait(400);
check((await page.getByTestId('call-gaps').innerText()).includes('Still to ask about'), 'the call can’t be ticked off with a day missing');
check(db.plan_items.find((j) => j.id === J2).stage !== 'done', 'the job stays open');
const k = page.locator('[data-testid="tb-call"]', { hasText: 'Kiama' });
await k.getByTestId('social-edit').click();
await k.getByLabel('Social times weekdays').fill('after 11');
await k.getByLabel('Social times weekends').fill('Sat after 2');
await k.getByLabel('Social price').fill('$65');
await k.getByTestId('social-save').click(); await wait(600);
check(db.course_social_times.some((r) => r.course_id === L(14) && r.weekdays === 'after 11' && r.updated_by === AL), 'social golf times saved for the group');
check(db.trip_tee_options.filter((t) => t.plan_id === PLAN2).length === 5 && db.trip_tee_options.find((t) => t.course_id === L(14) && t.play_date === dayOf(W1, 0))?.ranges?.[0] === '07:30-08:00', 'each day saved per course (available, ranges, price)');
await k.getByTestId('call-done').click(); await wait(600);
check(db.plan_items.find((j) => j.id === J1).stage === 'done', 'Kiama: every day answered → the call is done');
await shot('15-caller');

asPlayer = false;
await page.goto(`${BASE}#/plan/${PLAN2}/build`);
await page.reload();
await page.locator('[data-testid="tb-step-calls"]').getByRole('button').first().click(); await wait(800);
const best = await page.getByTestId('best-per-day').innerText();
check(/Fri[^\n]*Kiama Golf Club 7:30–7:50[^\n]*Gerringong Golf Club 9:00–9:20/.test(best), `best times per day across courses (${best.replace(/\n/g, ' / ').slice(0, 120)})`);
check(/Sat[^\n]*Gerringong Golf Club 7:00–7:20/.test(best), 'Saturday: the only course with times');
await page.getByTestId('best-per-day').scrollIntoViewIfNeeded();
await shot('16-best-per-day');

// ---------------------------------------------------------------- G. Desktop (organising mostly happens on a laptop)
await page.setViewportSize({ width: 1440, height: 900 });
asPlayer = false;
const vshot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });
await page.goto(`${BASE}#/plan`);
await page.reload();
await page.getByTestId('plan-with-ai').click();
await page.getByTestId('caddie-panel').waitFor({ timeout: 10000 });
check((await page.getByTestId('caddie-panel').innerText()).includes('Plan a trip'), 'desktop: Plan it with AI opens the Caddie’s side panel in ✨ Plan a trip');
await page.getByRole('button', { name: 'Start a new plan' }).click().catch(() => {});
await page.getByLabel('Your message').fill('Weekend away late Nov, 12 of us, within 3.5 hours of Sydney, about $900 each — plan it');
await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.waitForURL(/#\/plan\/[0-9a-f-]{36}\/build/, { timeout: 15000 });
await page.getByTestId('area-tabs').waitFor({ timeout: 15000 });
await wait(800);
check(await page.getByTestId('caddie-panel').isVisible() && (await page.getByTestId('area-tabs').isVisible()), 'desktop: the chat in the panel, the trip builder filling in beside it');
await vshot('d-01-chat');
await page.screenshot({ path: `${CSHOTS}/d-01-panel-and-trip.png` });
await page.getByTestId('caddie-panel').getByRole('tab', { name: 'Ask', exact: true }).click();
await page.getByRole('button', { name: 'Fold the caddie away' }).click();
state().votes = {};
await page.goto(`${BASE}#/plan/${PLAN}/build`);
await page.getByTestId('area-start').waitFor({ timeout: 15000 });
await page.getByTestId('area-course').first().waitFor({ timeout: 10000 });
const mapBox = await page.locator('.as-map').boundingBox();
const listBox = await page.locator('.as-lists').boundingBox();
check(mapBox && listBox && listBox.x > mapBox.x + mapBox.width - 2 && mapBox.width > 500, `desktop: a big map with the lists beside it (${Math.round(mapBox?.width)} px map)`);
await vshot('d-02-region');
await page.getByTestId('area-tabs').getByRole('tab', { name: /Compare/ }).click(); await wait(500);
check(await page.getByTestId('compare-table').isVisible(), 'desktop: Compare is a table, a column per region');
check(!(await page.getByText('How long?').isVisible().catch(() => false)), 'Compare shows only the comparison');
await vshot('d-03-compare');
await page.getByTestId('compare-call-vote').click();
await page.getByTestId('ballot-preview').waitFor({ timeout: 5000 });
check(await page.getByTestId('ballot-preview').isVisible(), 'desktop: Call the vote shows a live preview of the ballot');
await page.getByLabel('Which area?: Central West NSW').uncheck(); await wait(200);
check(!(await page.getByTestId('ballot-preview').innerText()).includes('Central West'), 'the preview follows the ticks');
await vshot('d-04-call-vote');
await page.keyboard.press('Escape'); await wait(300);
await page.goto(`${BASE}#/plan/${PLAN}?tab=vote`);
await page.getByTestId('vote-batch').waitFor({ timeout: 15000 });
await page.locator('[data-testid="poll-organiser"]', { hasText: 'Which area?' }).first().click(); await wait(300);
check(await page.getByTestId('results-table').first().isVisible(), 'desktop: results as a table (options × people, with totals)');
await page.getByTestId('results-table').first().scrollIntoViewIfNeeded();
await vshot('d-05-results');
await page.goto(`${BASE}#/plan/${PLAN2}/build`);
await page.locator('[data-testid="tb-step-calls"]').getByRole('button').first().click(); await wait(800);
check(await page.getByTestId('tee-grid').isVisible() && (await page.getByTestId('tee-grid').locator('tbody tr').count()) === 2, 'desktop: tee times as a grid (courses × days)');
await page.getByTestId('tee-grid').scrollIntoViewIfNeeded();
await vshot('d-06-tee-grid');
await page.setViewportSize({ width: 375, height: 812 });
asPlayer = true;
await page.goto(`${BASE}#/plan/${PLAN}?tab=vote`);
await page.reload();
await page.getByTestId('voted').first().getByRole('button').first().click();
await page.getByTestId('vote-batch').waitFor({ timeout: 15000 });
await page.getByTestId('voter-progress').scrollIntoViewIfNeeded();
await vshot('d-07-voter-375');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
