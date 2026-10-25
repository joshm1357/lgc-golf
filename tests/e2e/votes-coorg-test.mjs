// ov35 browser check (23 Oct 2026): two votes, either order (📅 When? / 📍 Where?); a co-organiser changes a trip
// and calls a vote; several draft trips, each with its own ✨ planning chat, switching between them. Fake database.
// Usage: node tests/e2e/votes-coorg-test.mjs <base> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4363/lgc-golf/';
const SHOTS = process.argv[3] || './shots-ov35';
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

const PLANB = 'eeeeeeee-0000-4000-8000-0000000000b2';
const AL = pid(1);
const fri = (weeks) => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7) + 7 * weeks); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }; // local date (toISOString is UTC: a Thursday before 11am in Sydney)
const plus = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const wk = (weeks) => ({ start: fri(weeks), end: plus(fri(weeks), 2), long: false });
db.trip_builds.push(
  { id: crypto.randomUUID(), group_id: GROUP, plan_id: PLAN, updated_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    state: { regionOptions: ['South Coast NSW', 'Hunter Valley'], region: null, weekends: [wk(8), wk(9)], nights: 2, areaCourses: { 'South Coast NSW': [L(3), L(5)] } } },
  { id: crypto.randomUUID(), group_id: GROUP, plan_id: PLANB, updated_at: new Date().toISOString(),
    state: { regionOptions: ['South Coast NSW', 'Hunter Valley'], region: null, weekends: [wk(12), wk(13)], nights: 2 } },
);
db.plans.push({ id: PLANB, kind: 'trip', name: 'Autumn trip', status: 'planning', start_date: null, end_date: null, proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, created_at: now });
db.plan_coorganisers = [];
const shot = async (name) => {
  for (const [w, h] of [[375, 812], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h }); await wait(400);
    await page.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 812 }); await wait(200);
};
const stateOf = (id) => db.trip_builds.find((b) => b.plan_id === id)?.state || {};
const card = (part) => page.getByTestId(`vote-card-${part}`);
const statusOf = async (part) => (await card(part).getByTestId('vote-status').innerText()).replace(/^(✓|🗳️) /, '');
const open = async (id) => { await page.goto(`${BASE}#/plan/${id}/build`); await page.reload(); await step('area').waitFor({ timeout: 15000 }); await wait(700); };

// ================================================================ 1. two votes, either order
await open(PLAN);
check(await statusOf('when') === 'Not called yet' && await statusOf('where') === 'Not called yet', 'both cards say "Not called yet"');
check(await page.getByTestId('call-both').isVisible(), '"Call both votes — one message to the group" is offered');
await shot('01-two-cards-not-called');
// Where? first.
await card('where').getByTestId('call-where').click();
await page.getByTestId('call-vote').waitFor({ timeout: 5000 });
const whereQs = await page.getByTestId('ballot-section').locator('strong').allInnerTexts();
check(whereQs.includes('Which area?') && !whereQs.includes('Which weekend?'), `the Where? ballot has no dates (${whereQs.join(' / ')})`);
await page.getByTestId('call-the-vote').click();
await page.getByTestId('how-it-goes-out').waitFor({ timeout: 8000 });
await page.getByRole('button', { name: 'Done' }).click(); await wait(800);
const bWhere = db.vote_batches.find((b) => b.plan_id === PLAN);
check(bWhere?.title === 'Where are we going?' && bWhere.keen === true, `the Where? vote is out ("${bWhere?.title}", asks "Are you in?")`);
check(db.plan_polls.filter((p) => p.vote_batch === bWhere.id).every((p) => p.kind !== 'dates'), 'no weekend question on the Where? vote');
check(/^Out now — 0 of 12 voted, closes /.test(await statusOf('where')), `Where? says it's out (${await statusOf('where')})`);
check(await statusOf('when') === 'Not called yet' && await page.getByTestId('call-both').count() === 0, 'When? still "Not called yet"; no "Call both" now');
await shot('02-where-out-when-not-called');
// Then When?.
await card('when').getByTestId('call-when').click();
await page.getByTestId('call-vote').waitFor({ timeout: 5000 });
const whenQs = await page.getByTestId('ballot-section').locator('strong').allInnerTexts();
check(JSON.stringify(whenQs) === JSON.stringify(['Which weekend?']), `the When? ballot is just the weekends (${whenQs.join(' / ')})`);
await page.getByTestId('call-the-vote').click();
await page.getByTestId('how-it-goes-out').waitFor({ timeout: 8000 });
await page.getByRole('button', { name: 'Done' }).click(); await wait(800);
const bWhen = db.vote_batches.filter((b) => b.plan_id === PLAN).find((b) => b.id !== bWhere.id);
check(bWhen?.title === 'When are we going?' && bWhen.keen === false, `the When? vote is its own card, and doesn't ask "Are you in?" again (${bWhen?.title}, keen ${bWhen?.keen})`);
check(stateOf(PLAN).votes?.when === bWhen.id && stateOf(PLAN).votes?.where === bWhere.id, 'the trip remembers both cards');
// People vote: weekends (Al, Bo, Cy) and areas (Al, Bo → Hunter Valley; Cy → South Coast).
const pollOf = (b, kind) => db.plan_polls.find((p) => p.vote_batch === b.id && p.kind === kind);
const optOf = (poll, label) => db.plan_options.find((o) => o.poll_id === poll.id && (label instanceof RegExp ? label.test(o.label) : o.label === label));
const wkPoll = pollOf(bWhen, 'dates'); const areaPoll = pollOf(bWhere, 'location');
const wkOpts = db.plan_options.filter((o) => o.poll_id === wkPoll.id);
for (const who of [pid(1), pid(2), pid(3)]) db.plan_votes.push({ id: crypto.randomUUID(), poll_id: wkPoll.id, option_id: wkOpts[1].id, player_id: who, response: 'yes', created_at: now });
for (const [who, a] of [[pid(1), 'Hunter Valley'], [pid(2), 'Hunter Valley'], [pid(3), 'South Coast NSW']]) db.plan_votes.push({ id: crypto.randomUUID(), poll_id: areaPoll.id, option_id: optOf(areaPoll, a).id, player_id: who, response: 'yes', created_at: now });
await open(PLAN);
check(/^Out now — 3 of 12 voted, closes /.test(await statusOf('when')) && /^Out now — 3 of 12 voted/.test(await statusOf('where')), `both out, with who's voted (${await statusOf('when')} | ${await statusOf('where')})`);
const closeWhenText = await page.getByTestId('close-when').innerText();
check(closeWhenText === `Close the vote and go with ${wkOpts[1].label.replace(/^Sat /, 'Fri ')}` || /^Close the vote and go with Fri \d+/.test(closeWhenText), `the When? button says it closes the vote (${closeWhenText})`);
check(/posts the result in the Feed/.test(await card('when').innerText()), 'and says it posts the result');
await shot('03-both-out');
// Close When? first (either order): the weekend's set, the area isn't.
await page.getByTestId('close-when').click(); await wait(1000);
check(stateOf(PLAN).weekendsSettled === true && stateOf(PLAN).weekends[0].start === wk(9).start && stateOf(PLAN).region == null, 'closing When? sets the weekend (the leader) — the area is still open');
check(wkPoll.status === 'closed' && areaPoll.status === 'open', 'only the When? vote closed');
check(/^Closed — .+ won 3–0$/.test(await statusOf('when')), `When? says Closed (${await statusOf('when')})`);
const pWhen = (db.posts || []).filter((p) => /^📅 Spring trip — the weekend’s decided/.test(p.body || ''));
check(pWhen.length === 1 && /Still to decide: where\.$/.test(pWhen[0].body), `one Feed post for the weekend (${pWhen[0]?.body})`);
// Then Where?.
check((await page.getByTestId('close-where').innerText()) === 'Close the vote and go with Hunter Valley', 'Where?: "Close the vote and go with Hunter Valley"');
await page.getByTestId('close-where').click(); await wait(1000);
check(stateOf(PLAN).region === 'Hunter Valley' && stateOf(PLAN).weekends[0].start === wk(9).start, 'closing Where? sets the area — the weekend stays as voted');
await step('area').getByRole('button').first().click(); await wait(400); // step 1 is done, so the builder moved on: open it again
check(/^Closed — Hunter Valley won 2–1$/.test(await statusOf('where')), `Where? says Closed (${await statusOf('where')})`);
const pWhere = (db.posts || []).filter((p) => /^📍 Spring trip — we’re going to Hunter Valley/.test(p.body || ''));
check(pWhere.length === 1 && /Next: ringing the courses/.test(pWhere[0].body), `one Feed post for the area (${pWhere[0]?.body})`);
check(!/🔒/.test(await step('courses').innerText()), 'with both decided, the next steps open up');
await shot('04-both-closed');

// ================================================================ 2. co-organisers
// The organiser names Al on the Autumn trip.
await page.goto(`${BASE}#/plan/${PLANB}?view=organise`); await page.reload();
await page.getByTestId('coorganisers').waitFor({ timeout: 15000 }); await wait(500);
await page.getByTestId('coorganisers').locator('summary').click(); await wait(300);
check(/Name up to 3 mates/.test(await page.getByTestId('coorganisers').innerText()), 'the organiser sees "👥 Co-organisers" on the trip');
await page.getByTestId('coorg-add').click();
await page.getByTestId('coorg-pick').selectOption(AL);
await page.getByTestId('coorg-add-save').click(); await wait(800);
check(db.plan_coorganisers.length === 1 && db.plan_coorganisers[0].player_id === AL && db.plan_coorganisers[0].plan_id === PLANB, 'the organiser adds Al as a co-organiser');
check(notifyCalls.some((n) => n.type === 'coorganiser_added' && n.player_id === AL), 'Al is told (coorganiser_added)');
check(await page.getByTestId('coorg-row').count() === 1 && await page.getByTestId('coorg-share').isVisible(), 'Al shows on the card with "Help me plan this"');
await shot('05-coorganisers-card');
// Al opens it: he gets the organiser's tools on the Autumn trip, not on the Spring trip.
asPlayer = true;
await page.goto(`${BASE}#/plan/${PLANB}/build`); await page.reload(); await step('area').waitFor({ timeout: 15000 }); await wait(800);
check(await page.getByTestId('you-coorg').isVisible(), 'Al sees "You’re a co-organiser"');
check(await page.getByTestId('call-both').isVisible() && await page.getByTestId('add-area').isVisible(), 'Al gets the organiser’s tools on this trip (Call the votes, + Add another area)');
await card('when').getByTestId('call-when').click();
await page.getByTestId('call-vote').waitFor({ timeout: 5000 });
await page.getByTestId('call-the-vote').click();
await page.getByTestId('how-it-goes-out').waitFor({ timeout: 8000 });
await page.getByRole('button', { name: 'Done' }).click(); await wait(800);
check(db.vote_batches.some((b) => b.plan_id === PLANB && b.title === 'When are we going?') && stateOf(PLANB).votes?.when, 'Al calls the When? vote on the Autumn trip');
check(/^Out now/.test(await statusOf('when')), 'and it says "Out now"');
await shot('06-coorganiser-calls-a-vote');
await page.goto(`${BASE}#/plan/${PLAN}/build`); await page.reload(); await step('area').waitFor({ timeout: 15000 }); await wait(800);
check(await page.getByTestId('call-both').count() === 0 && await page.getByTestId('close-when').count() === 0 && await page.getByTestId('you-coorg').count() === 0, 'on the Spring trip Al is just a player');
asPlayer = false;

// ================================================================ 3. several drafts, a chat each
// This phone has the old one-chat-per-group copy (it was filling in the Spring trip) and a chat for the Autumn trip.
await page.evaluate(([g, a, b]) => {
  localStorage.setItem(`tgt-planchat:${g}`, JSON.stringify({ turns: [{ role: 'user', text: 'Spring: Hunter or the coast?' }, { role: 'assistant', text: 'Here are a few ideas for spring.', questions: [] }], draft: null, savedAt: Date.now(), planId: a }));
  localStorage.setItem(`tgt-planchat:${g}:plan:${b}`, JSON.stringify({ turns: [{ role: 'user', text: 'Autumn: somewhere warm' }, { role: 'assistant', text: 'Autumn ideas coming up.', questions: [] }, { role: 'user', text: '10 of us' }], draft: null, savedAt: Date.now(), planId: b }));
  localStorage.removeItem(`tgt-planchat:${g}:active`);
}, [GROUP, PLAN, PLANB]);
await page.goto(`${BASE}#/`); await page.reload();
await page.getByTestId('my-drafts').waitFor({ timeout: 15000 }); await wait(600);
const draftRows = await page.getByTestId('draft-row').allInnerTexts();
check(draftRows.length === 2 && /Autumn trip/.test(draftRows[0]) && /changed today/.test(draftRows[0]) && /Spring trip/.test(draftRows[1]), `My draft trips: both, newest change first (${draftRows.map((t) => t.split('\n')[0]).join(', ')})`);
await shot('07-my-draft-trips');
// The Autumn trip's chat.
await page.locator(`[data-testid="draft-row"][data-plan="${PLANB}"]`).getByTestId('draft-chat').click();
await page.getByTestId('caddie-plan').waitFor({ timeout: 10000 }); await wait(800);
const picker = page.getByTestId('plan-picker').locator('select');
check(await picker.inputValue() === PLANB, 'the Caddie opens on the Autumn trip');
check((await page.getByTestId('caddie-plan').innerText()).includes('10 of us') && !(await page.getByTestId('caddie-plan').innerText()).includes('Hunter or the coast'), 'with the Autumn chat, not the Spring one');
await shot('08-caddie-autumn-chat');
// Switch to the Spring trip: the old per-group chat moved to it.
await picker.selectOption(PLAN); await wait(600);
check((await page.getByTestId('caddie-plan').innerText()).includes('Hunter or the coast'), 'switching to the Spring trip shows its chat (moved from the old per-group copy)');
const ls = await page.evaluate((g) => Object.keys(localStorage).filter((k) => k.startsWith(`tgt-planchat:${g}`)).sort(), GROUP);
check(ls.includes(`tgt-planchat:${GROUP}:plan:${PLAN}`) && ls.includes(`tgt-planchat:${GROUP}:plan:${PLANB}`) && !ls.includes(`tgt-planchat:${GROUP}`), `each trip has its own saved chat (${ls.join(', ')})`);
// A new plan: an empty chat, the others kept.
await page.getByTestId('new-plan').click(); await wait(600);
check(await picker.inputValue() === '' && !(await page.getByTestId('caddie-plan').innerText()).includes('Hunter or the coast'), '"Start a new plan" opens an empty chat');
const ls2 = await page.evaluate((g) => Object.keys(localStorage).filter((k) => k.includes(':plan:')).length, GROUP);
check(ls2 === 2, 'and both trips’ chats are still there');
await shot('09-caddie-new-plan');
await page.goto(`${BASE}#/`); await page.reload(); await page.getByTestId('my-drafts').waitFor({ timeout: 15000 }); await wait(500);
const carry = await page.getByTestId('plan-with-ai').innerText().catch(() => '');
check(/Carry on a plan \(2 on the go\)/.test(carry), `Trips: "${carry.trim()}"`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n${fails.map((f) => `- ${f}`).join('\n')}` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
