// Trip builder browser check (077), 22 Oct 2026. Fake database only — nothing real is touched.
// Josh's order: area options + weekends → vote 1 "Where and when?" (one card, one notification) → organiser picks the
// area and weekend → stay areas Nowra + Jervis Bay (chip and pin) → day 1 on-the-way options → stay-day options with
// drive ranges → on the way home → call jobs with the exact dates → tee times on courses (12 people → 3 in a row; a
// course with only 2 is left out) → configurations → pick one → "Set it up in the app" → rounds created.
// Also: a course "Played 2023 · ★4.5", booking info saved, the read-only player view, 375 px and 1280 px.
// Usage: node trip-builder-test.mjs <base> <shotDir>   e.g. http://localhost:4389/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4389/lgc-golf/';
const SHOTS = process.argv[3] || './shots-trip-builder';
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
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */ localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());
const wait = (ms = 500) => page.waitForTimeout(ms);
const step = (k) => page.locator(`[data-testid="tb-step-${k}"]`);

// 1. The trip: "Build the trip" is the first card on a trip still being decided.
await page.goto(`${BASE}#/plan/${PLAN}`);
// ov26 (O2): the organiser's one gold Next step button is "Start: plan where and when" (the trip builder).
await page.getByTestId('primary').waitFor({ timeout: 15000 });
check(/plan where and when/i.test(await page.getByTestId('primary').innerText()), 'the trip’s one big button starts the trip builder');
check(!(await page.locator('[data-testid="tb-link"]').first().isVisible()), 'O2: the other ways (trip builder link, by hand, call a vote) are folded away');
await page.getByTestId('primary').click();
await step('area').waitFor({ timeout: 10000 });
const stepsText = await page.locator('.tb-steps').innerText();
check(/Areas & weekends[\s\S]*🔒 Courses & stays[\s\S]*🔒 Call the courses[\s\S]*🔒 Pick & lock in/.test(stepsText), 'steps in Josh’s order; later ones locked');
await step('courses').getByRole('button').first().click();
check((await step('courses').innerText()).includes('After: the area is chosen'), 'a locked step says what it comes after');
await step('area').getByRole('button').first().click();

// 2. Area options + weekends → vote 1 "Where and when?" (one card, one notification).
// ov23: areas go on through "The areas we're considering" (+ Add another area); every weekend in the window is a chip.
await page.getByLabel('Area').fill('South');
await page.locator('[data-testid="tb-region-hits"]').getByRole('button', { name: '+ South Coast NSW' }).click();
await wait();
await page.getByTestId('add-area').click();
await page.getByLabel('Area').fill('Hunter');
await page.locator('[data-testid="tb-region-hits"]').getByRole('button', { name: '+ Hunter Valley' }).click();
await wait();
await page.locator('[data-testid="area-chip"][data-area="South Coast NSW"]').getByRole('button').first().click(); await wait();
const wk = page.getByTestId('weekend-chip');
await wk.nth(3).click(); await wait(400);
await wk.nth(4).click(); await wait(400);
check(state().regionOptions?.length === 2 && state().weekends?.length === 2, `two areas and two weekends chosen (${JSON.stringify(state().regionOptions)})`);
check((await wk.nth(3).innerText()).match(/^Fri \d+/) != null, `weekends are Fri–Sun (${(await wk.nth(3).innerText()).split('\n')[0]})`);
// The area map (080): South Coast's courses on the table — several, never one.
await page.locator('[data-testid="area-courses"]').getByText('Gerringong GC').waitFor({ timeout: 8000 });
await page.locator('[data-testid="area-courses"]').getByLabel('Gerringong GC').check(); await wait(400);
await page.locator('[data-testid="area-courses"]').getByLabel('Kiama GC').check(); await wait(400);
check(state().areaCourses?.['South Coast NSW']?.length === 2, `South Coast has its own course set (${JSON.stringify(state().areaCourses)})`);
await page.screenshot({ path: `${SHOTS}/1-area.png`, fullPage: true });
// ov35: two cards (📅 When? / 📍 Where?) — "Call both" sends them in one message, as before.
check(await page.getByTestId('vote-card-when').isVisible() && await page.getByTestId('vote-card-where').isVisible(), 'ov35: the When? and Where? cards');
check((await page.getByTestId('vote-card-when').getByTestId('vote-status').innerText()).includes('Not called yet'), 'ov35: When? says "Not called yet"');
await page.getByTestId('call-both').click();
await page.getByTestId('call-vote').waitFor({ timeout: 5000 });
await page.getByTestId('call-the-vote').click();
await page.getByTestId('how-it-goes-out').waitFor({ timeout: 8000 });
await page.getByRole('button', { name: 'Done' }).click();
await wait(800);
const b1 = db.vote_batches[0];
const v1polls = db.plan_polls.filter((p) => p.vote_batch === b1?.id);
check(b1 && b1.title === 'Where and when?' && b1.keen === true, 'vote card "Where and when?" made, asking if you’re keen');
check(v1polls.map((p) => p.question).join('|') === 'Which area?|Which weekend?|South Coast NSW: which courses?', `sections: ${v1polls.map((p) => p.question).join(', ')}`);
check(v1polls[2]?.optional === true && v1polls[2]?.area === 'South Coast NSW', 'the area’s courses are the optional detail (ov23)');
check((db.plan_options.find((o) => o.poll_id === v1polls[0]?.id && o.label === 'South Coast NSW')?.notes || '').includes('Courses: Gerringong GC, Kiama GC'), 'the area on the ballot shows its course list');
check(notifyCalls.filter((n) => n.type === 'poll_open').length === 1, `one notification for the whole card (${notifyCalls.filter((n) => n.type === 'poll_open').length})`);

// The card on the trip's Vote tab: sections, keen, still to answer.
await page.goto(`${BASE}#/plan/${PLAN}?tab=vote`);
await page.locator('[data-testid="vote-batch"]').waitFor({ timeout: 10000 });
const card = page.locator('[data-testid="vote-batch"]');
check(await card.locator('[data-testid="vote-batch-section"]').count() === 2 && await card.locator('[data-testid="vote-detail-area"]').count() === 1 && await card.locator('[data-testid="vote-batch-keen"]').count() === 1, 'ONE card: area, weekend, the optional detail, "Are you keen?"');
check(await page.locator('[data-testid="vote-batch"]').count() === 1 && !(await page.getByText('Which area?').count() > 1), 'the sections aren’t shown again as separate votes');
// The organiser sees the results; "See it as a voter" shows the ballot (areas: Prefer / Option / Don't like).
await card.getByTestId('see-as-voter').click(); await wait(300);
await card.locator('[data-testid="vote-batch-section"]').nth(0).getByRole('button', { name: '⭐ Keen' }).first().click(); await wait(600);
await card.locator('[data-testid="vote-batch-section"]').nth(1).getByRole('button', { name: '✓ Yes' }).first().click(); await wait(600);
await card.locator('[data-testid="vote-batch-keen"]').getByRole('button', { name: '✓ Yes' }).click(); await wait(600);
check(await card.getByTestId('voter-thanks').isVisible(), 'answered the main questions: "Thanks — here’s how it’s looking" (the detail is optional)');
await card.getByTestId('vote-detail-area').getByRole('button').first().click(); await wait(300);
await card.locator('[data-testid="vote-detail-section"]').nth(0).getByRole('button', { name: '👍 Happy with it' }).first().click(); await wait(600);
await card.getByTestId('see-as-voter').click(); await wait(300);
let waitingText = await card.locator('[data-testid="vote-batch-waiting"]').innerText();
check(/Still to answer \(11\)/.test(waitingText) && !waitingText.includes('Josh'), `answered every section → off the "still to answer" list (${waitingText.slice(0, 40)})`);
await page.screenshot({ path: `${SHOTS}/2-vote-card.png`, fullPage: true });

// 3. The organiser picks: South Coast; the weekends become primary and backup (ov23) — drop the backup here.
await page.goto(`${BASE}#/plan/${PLAN}/build`);
await step('area').waitFor({ timeout: 10000 });
// ov26 (O2): picking it yourself (skipping the vote) is one of the "Other ways to do this".
await page.locator('[data-testid="area-start"] [data-testid="other-ways"] summary').click(); await wait(300);
await page.getByTestId('going-here').click(); await wait(500);
// ov35: the Where? vote is out, so going with an area says it closes that vote (and posts) — and asks first.
check(/closes the Where\? vote/.test(await page.getByTestId('confirm-sheet').innerText()), 'ov35: choosing the area while the vote is out says it closes the Where? vote');
await page.getByTestId('confirm-yes').click(); await wait(1200);
check(state().region === 'South Coast NSW' && !state().weekendsSettled, 'ov35: area decided — the weekend isn’t (dates don’t depend on the place)');
check(/^Closed — South Coast NSW/.test((await page.getByTestId('vote-card-where').getByTestId('vote-status').innerText()).replace(/^✓ /, '')), `ov35: Where? says Closed (${await page.getByTestId('vote-card-where').getByTestId('vote-status').innerText()})`);
check(/^Out now — 1 of \d+ voted, closes /.test((await page.getByTestId('vote-card-when').getByTestId('vote-status').innerText()).replace(/^🗳️ /, '')), `ov35: When? is still out (${await page.getByTestId('vote-card-when').getByTestId('vote-status').innerText()})`);
check(/^Close the vote and go with Fri /.test(await page.getByTestId('close-when').innerText()), `ov35: the button says it closes the vote (${await page.getByTestId('close-when').innerText()})`);
await page.getByTestId('close-when').click(); await wait(1200);
check(state().region === 'South Coast NSW' && state().weekends.length === 2 && state().weekendsSettled === true, 'area decided; primary and backup weekends set');
check(db.plan_polls.filter((p) => p.vote_batch === b1.id && !p.optional).every((p) => p.status === 'closed'), 'ov35: both cards’ votes closed');
await step('area').getByRole('button').first().click(); await wait(300);
await page.getByTestId('settled-weekend').nth(1).getByRole('button', { name: /^Drop/ }).click(); await wait();
check(state().weekends.length === 1 && state().weekendsSettled === true, 'just the primary weekend now');
check(state().days?.[1]?.options?.length === 2, `the stay day starts pre-filled from the area’s course set (${JSON.stringify(state().days?.[1]?.options)})`);
const W = state().weekends[0];

// 4. Stay areas: Nowra from the chips, Jervis Bay from its pin on the map.
await step('courses').getByRole('button').first().click();
await page.locator('[data-testid="tb-stay-chips"]').waitFor({ timeout: 8000 });
const chipsText = await page.locator('[data-testid="tb-stay-chips"]').innerText();
check(/Stay near:/.test(chipsText) && chipsText.includes('Nowra') && chipsText.includes('Jervis Bay'), `stay suggestions as chips (${chipsText.replace(/\s+/g, ' ').slice(0, 80)})`);
await page.locator('[data-testid="tb-stay-chips"]').getByRole('button', { name: 'Nowra', exact: true }).click(); await wait();
await page.locator('[data-testid="tb-map"]').scrollIntoViewIfNeeded();
// ov22: on a phone the first tap on a pin shows its summary, the second its details — "Stay at …" is in there.
await page.locator('.tb-stay', { hasText: 'Jervis Bay' }).tap(); await wait(300);
check(await page.getByTestId('place-tip').isVisible() && !(await page.getByTestId('stay-sheet').count()), 'ov22: first tap on a 🏠 pin → its summary card (not the details yet)');
await page.locator('.tb-stay', { hasText: 'Jervis Bay' }).tap(); await wait(300);
await page.getByTestId('stay-sheet').waitFor({ timeout: 5000 });
await page.getByTestId('sheet-toggle').click(); await wait();
check(state().stays?.map((s) => s.name).join(',') === 'Nowra,Jervis Bay (Huskisson)', `stay areas: ${state().stays?.map((s) => s.name).join(', ')}`);

// 5. Day 1 — on the way: suggestions along the drive.
const days = page.locator('[data-testid="tb-day"]');
// ov40: choosing the area now fills EVERY day from the area's courses (it used to leave the first and last days empty —
// the Blue Mountains "only one round" bug). Clear the travel days so this walk-through can add its own.
check((state().days || []).filter((d) => d.leg !== 'stay').every((d) => (d.options || []).length > 0), `ov40: the travel days start filled too (${(state().days || []).map((d) => (d.options || []).length).join('/')})`);
for (const i of [0, 2]) {
  for (let n = 0; n < 6 && (await days.nth(i).locator('[data-testid="tb-option"]').count()); n++) {
    await days.nth(i).locator('[data-testid="tb-option"]').first().getByRole('button', { name: /^Remove / }).click(); await wait(300);
  }
}
await days.nth(0).getByRole('button').first().click(); await wait();
const sug1 = await days.nth(0).locator('[data-testid="tb-suggestions"]').innerText();
check(sug1.includes('Shoalhaven Heads GC') && sug1.includes('off the way') && !sug1.includes('Mollymook'), `day 1 suggestions are on the way (${sug1.replace(/\s+/g, ' ').slice(0, 90)})`);
await days.nth(0).getByRole('button', { name: /\+ Shoalhaven Heads GC/ }).click(); await wait();
await days.nth(0).getByRole('button', { name: /\+ Gerringong GC/ }).click(); await wait();

// 6. Stay day: ranges across the stay areas; "Played 2023 · ★4.5".
await days.nth(1).getByRole('button').first().click(); await wait();
const sug2 = await days.nth(1).locator('[data-testid="tb-suggestions"]').innerText();
check(/Worrigee Links · \d+–\d+ min/.test(sug2), `stay-day drive shown as a range (${(sug2.match(/Worrigee Links · [^\n+]*/) || [''])[0]})`);
check(sug2.indexOf('Nowra GC') > -1 && sug2.indexOf('Nowra GC') < sug2.indexOf('Worrigee'), 'the favourite (★4.5) ranks above a course not played before');
await days.nth(1).getByRole('button', { name: /\+ Nowra GC/ }).click(); await wait();
await days.nth(1).getByRole('button', { name: /\+ Worrigee Links/ }).click(); await wait();
const known = await days.nth(1).locator('[data-testid="tb-option"]', { hasText: 'Nowra GC' }).first().locator('[data-testid="tb-known"]').innerText();
check(known.startsWith('Played 2023 · ★4.5'), `course card: "${known}"`);
const range = await days.nth(1).locator('[data-testid="tb-option"]', { hasText: 'Worrigee' }).first().locator('[data-testid="tb-option-drive"]').innerText();
check(/^1\d–3\d min$/.test(range), `Worrigee: "${range}" from where we stay`);
check((await days.nth(1).locator('[data-testid="tb-option"]', { hasText: 'Nowra GC' }).first().locator('[data-testid="tb-facts"]').innerText()) === 'Public · $45–50 · groups ★★★★☆ · stay & play',
  'ov17: the course row carries its researched facts');
check((await days.nth(1).locator('[data-testid="tb-option"]', { hasText: 'Worrigee' }).first().locator('[data-testid="tb-facts"]').innerText()) === 'Public · $44 · groups ★★★☆☆', 'ov17: Worrigee’s facts');
check(await days.nth(0).locator('[data-testid="tb-facts"]').count() === 0, 'ov17: no research → no facts line (nothing made up)');
await page.screenshot({ path: `${SHOTS}/3-stay-day.png`, fullPage: true });
await page.screenshot({ path: `${RSHOTS}/trip-builder-rows-375.png`, fullPage: true });

// The course sheet: history, booking info, "✨ Look it up" as a draft.
// ov22: on a phone, the first tap on a course row's name shows its summary; the second opens everything.
await days.nth(1).getByRole('button', { name: 'Nowra GC', exact: true }).tap(); await wait(300);
const rowTip = await page.getByTestId('place-tip').innerText();
check(rowTip.includes('Nowra GC') && rowTip.includes('★★★★☆ for groups') && !(await page.locator('[data-testid="tb-course"]').count()), `ov22: first tap on a course row → its summary card (${rowTip.replace(/\s+/g, ' ').slice(0, 90)})`);
await page.screenshot({ path: `${SHOTS}/ov22-row-tip-375.png` });
await days.nth(1).getByRole('button', { name: 'Nowra GC', exact: true }).tap();
const sheet = page.locator('[data-testid="tb-course"]');
await sheet.waitFor({ timeout: 5000 });
const sheetText = await sheet.innerText();
check(sheetText.includes('Played 2023 South Coast trip') && sheetText.includes('BD won by Kurt') && sheetText.includes('Your group: ★4.5'), 'course sheet: played when, who won, the group’s rating');
const about = sheet.locator('[data-testid="about-groups"]');
const aboutText = await about.innerText();
check(aboutText.includes('About this course for groups') && aboutText.includes('Members have: Wed and Sat mornings are member comps') && !aboutText.includes('club site, Oct 2026')
  && aboutText.includes('Good for groups: ★★★★☆ cheap, close to Jervis Bay') && aboutText.includes('Researched Oct 2026 — check with the club'), `ov17: the course sheet has "About this course for groups" (${aboutText.replace(/\s+/g, ' ').slice(0, 120)})`);
check(await about.getByRole('link', { name: 'Group enquiry ↗' }).getAttribute('href') === 'https://nowragolf.example/groups', 'ov17: the group enquiry link');
await about.getByTestId('about-sources-btn').click();
check((await about.getByTestId('about-sources').innerText()).includes('golfnsw.org.au'), 'ov17: the sources list');
await about.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${RSHOTS}/trip-builder-course-sheet-375.png` });
await sheet.getByRole('button', { name: '✨ Look it up' }).click();
await page.locator('[data-testid="tb-booking-form"]').waitFor({ timeout: 5000 });
check(aiCalls[0]?.mode === 'course_lookup' && aiCalls[0]?.course_id === L(2), 'Look it up asks the AI helper for this course');
check((await page.locator('[data-testid="tb-ai-warning"]').innerText()).includes('couldn’t check the web'), 'the AI says it couldn’t check the web — a draft to check');
check(db.course_booking_info.length === 0, 'nothing saved until the organiser saves');
check((await page.getByLabel('Phone').inputValue()) === '02 4421 0000', 'the draft fills the form');
await page.getByRole('button', { name: 'Save (shared with every group)' }).click(); await wait(800);
check(db.course_booking_info[0]?.course_id === L(2) && db.course_booking_info[0]?.phone === '02 4421 0000' && db.course_booking_info[0]?.source === 'ai', 'booking info saved for every group, marked as from the AI');
await page.screenshot({ path: `${SHOTS}/4-course.png`, fullPage: true });
await page.getByRole('button', { name: 'Close' }).click(); await wait();

// 7. Day 3 — on the way home.
await days.nth(2).getByRole('button').first().click(); await wait();
await days.nth(2).getByRole('button', { name: /\+ Kiama GC/ }).click(); await wait();
check(state().days?.map((d) => d.options.length).join(',') === '2,4,1', `options per day: ${state().days?.map((d) => d.options.length).join(',')}`);

// 8. Call the courses: one job per course with the exact date and 3 tee times (12 in).
await step('calls').getByRole('button').first().click(); await wait();
check((await page.locator('[data-testid="tb-needed"]').innerText()).startsWith('3 tee times in a row'), '12 people → 3 tee times in a row');
await page.locator('[data-testid="tb-make-calls"]').click(); await wait(1200);
const callJobs = db.plan_items.filter((i) => i.kind === 'job' && i.title.startsWith('📞 Call'));
const d0 = (n) => { const d = new Date(`${W.start}T00:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', ''); };
check(callJobs.length === 5 && callJobs.every((j) => j.owner_id == null && j.due), `5 call jobs, unassigned, with a due date (${callJobs.length})`);
const shJob = callJobs.find((j) => j.title.includes('Shoalhaven'));
check(shJob && /ask for 3 tee times in a row on Fri \d+ \w+ from \d+:\d0$/.test(shJob.title), `job says the exact date: "${shJob?.title}"`);
const ngJob = callJobs.find((j) => j.title.includes('Nowra GC'));
check(ngJob?.body.includes('Phone 02 4421 0000'), 'the job carries the booking phone');

const tee = (course, date) => page.locator('[data-testid="tb-call"]', { hasText: course }).locator(`[data-testid="tee-day"][data-date="${date}"]`);
const dateOf = (n) => { const d = new Date(`${W.start}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// Each course's call covers the whole weekend (080): available, the times on offer, then Save.
// ov26 (O3): one form per course — only its golf days — and one Save.
const enter = async (course, n, text) => {
  const call = page.locator('[data-testid="tb-call"]', { hasText: course });
  await call.getByTestId('call-fill').click();
  const t = tee(course, dateOf(n));
  await t.getByTestId('tee-avail-yes').click();
  await t.getByLabel(`Times on offer ${dateOf(n)}`).fill(text);
  await call.getByTestId('call-save').click(); await wait(700);
};
check((await page.locator('[data-testid="tb-call"]', { hasText: 'Shoalhaven Heads GC' }).locator('[data-testid="tee-day"]').count()) === 1, 'O3: Shoalhaven (a Friday option) is only asked about the Friday');
check((await tee('Kiama GC', dateOf(0)).count()) === 0 && (await tee('Kiama GC', dateOf(2)).count()) === 1, 'O3: Kiama isn’t asked about the Friday (it’s not an option that day)');
await enter('Shoalhaven Heads GC', 0, '10:20-10:40');
await enter('Gerringong GC', 0, '9:00-9:10');
await enter('Nowra GC', 1, '8:00-8:30');
await enter('Worrigee Links', 1, '9:00-9:10');
await enter('Kiama GC', 2, '9:10-9:30');
check(db.trip_tee_options.length === 5 && db.trip_tee_options.every((t) => /^\d{4}-\d\d-\d\d$/.test(t.play_date) && t.job_id), 'tee times stored per course per DATE, linked to the job');
check((await tee('Worrigee Links', dateOf(1)).locator('[data-testid="tee-day-status"]').innerText()).includes('not enough in a row'), 'a course with only 2 times says so');
check((await tee('Nowra GC', dateOf(1)).locator('[data-testid="tee-day-status"]').innerText()) === '✓ 3 in a row 8:00–8:20', 'a course with enough says the block');
const ngCall = page.locator('[data-testid="tb-call"]', { hasText: 'Nowra GC' });
const warn = await ngCall.getByTestId('call-member-warning').innerText();
check(/Members have: Wed and Sat mornings are member comps — that touches your Sat: ask for times outside it\./.test(warn), `ov17: the call warns about members’ times on the trip’s Saturday (${warn})`);
check(await ngCall.getByTestId('call-enquiry').getAttribute('href') === 'https://nowragolf.example/groups' && (await ngCall.getByTestId('call-phone').count()) === 1, 'ov17: the call has the group enquiry link and the phone');
await ngCall.locator('summary', { hasText: 'Ask about' }).click();
check((await ngCall.getByTestId('call-checklist').innerText()).includes('Times outside members’ Sat comps'), 'ov17: the checklist asks for times outside the members’ Saturday');
await ngCall.getByRole('button', { name: '📜 What to say' }).click();
check((await ngCall.getByTestId('call-script').innerText()).includes('members have the course on Sat'), 'ov17: the script asks around the members’ day');
check((await ngCall.getByTestId('call-script').innerText()).includes('3 tee times in a row — 12 players'), 'O6: the script says the same number as the screen (12 in)');
await ngCall.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${RSHOTS}/trip-builder-call-375.png` });
await page.screenshot({ path: `${SHOTS}/5-calls.png`, fullPage: true });

// 9. Configurations: only workable ones (Worrigee and Gerringong left out), ranked; pick one.
await step('configs').getByRole('button').first().click(); await wait(800);
// ov26 (O4): the best way to do it as one card, one big "Lock this in"; the rest under "Other ways to do it".
const bestText = await page.getByTestId('tb-best').innerText();
check(!bestText.includes('Worrigee') && !bestText.includes('Gerringong'), 'the best way leaves out courses without 3 times in a row');
const rounds = await page.getByTestId('tb-best-round').allInnerTexts();
check(rounds.length === 3 && /Shoalhaven Heads GC[\s\S]*10:20–10:40/.test(rounds[0]) && /Nowra GC[\s\S]*8:00–8:20/.test(rounds[1]) && /Kiama GC[\s\S]*9:10–9:30/.test(rounds[2]), `the best: ${rounds.map((r) => r.replace(/\s+/g, ' ')).join(' | ')}`);
check(/about \d+ min driving from where we stay/.test(await page.getByTestId('tb-best-cost').innerText()), 'the drive from where we stay');
await page.screenshot({ path: `${SHOTS}/6-configs.png`, fullPage: true });
const openV1 = () => db.plan_polls.filter((p) => p.plan_id === PLAN && p.status === 'open' && p.vote_batch).length;
await page.getByTestId('lock-this-in').click();
await page.getByTestId('confirm-sheet').waitFor({ timeout: 5000 });
check(/Lock in/.test(await page.locator('.sheet').last().innerText()), 'V1: one box before locking in');
await page.getByTestId('confirm-yes').click(); await wait(2000);
const plan = db.plans.find((p) => p.id === PLAN);
check(plan.start_date === W.start && plan.end_date === dateOf(2) && /Nowra|Jervis/.test(plan.location_name), `the trip’s dates and place filled (${plan.start_date}–${plan.end_date}, ${plan.location_name})`);
check(plan.repeat_shape?.rounds?.length === 3 && plan.repeat_shape.rounds.map((r) => r.format).join(',') === 'stableford,stableford,ambrose', `rounds per day with the usual formats (${plan.repeat_shape?.rounds?.map((r) => r.format).join(',')})`);
check(db.courses.filter((c) => c.library_id).length === 3, 'the library courses are copied into the group (Nowra already there)');
await page.locator('[data-testid="tb-picked"]').waitFor({ timeout: 5000 });
check(plan.status === 'confirmed', 'V1: "Lock this in" locks the trip in');
check(openV1() === 0, 'V1: the trip builder’s vote is closed at lock-in');
check(db.plan_items.filter((i) => i.plan_id === PLAN && i.formula_key).length > 0, 'and the to-do list is made');

// "Set it up in the app" (the existing trip setup) → the rounds.
await page.getByRole('button', { name: /Set it up in the app/ }).click();
await page.getByRole('button', { name: /^Set it up — 3 rounds/ }).waitFor({ timeout: 5000 });
const selects = await page.locator('select[aria-label="Course"]').evaluateAll((els) => els.map((e) => e.selectedOptions[0]?.textContent));
check(selects.join('|') === 'Shoalhaven Heads GC|Nowra GC|Kiama GC', `setup is pre-filled with the picked courses (${selects.join(', ')})`);
await page.getByRole('button', { name: /^Set it up — 3 rounds/ }).click(); await wait(1500);
const made = db.rounds.filter((r) => r.trip_id && r.trip_id !== T23);
check(made.length === 3 && made.map((r) => r.format).join(',') === 'stableford,stableford,ambrose' && made[0].play_date === W.start, `3 rounds created (${made.map((r) => `${r.play_date} ${r.format}`).join('; ')})`);
await page.screenshot({ path: `${SHOTS}/7-picked.png`, fullPage: true });

// 10. Desktop: map beside the steps.
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}#/plan/${PLAN}/build`);
await step('area').waitFor({ timeout: 10000 });
await step('courses').getByRole('button').first().click(); await wait(800);
const box = await page.locator('[data-testid="tb-map"]').boundingBox();
check(box && box.width > 450 && box.height > 500, `desktop: a wide, tall map (${Math.round(box?.width)}×${Math.round(box?.height)})`);
await page.screenshot({ path: `${SHOTS}/8-desktop.png`, fullPage: false });
await page.setViewportSize({ width: 375, height: 812 });

// 11. A player: read-only, no building buttons.
asPlayer = true;
db.plans.find((p) => p.id === PLAN).status = 'planning';
await page.goto(`${BASE}#/plan/${PLAN}/build`);
await page.reload();
await step('area').waitFor({ timeout: 10000 });
await step('calls').getByRole('button').first().click(); await wait(600);
check(!(await page.locator('[data-testid="tb-make-calls"]').count()) && !(await page.getByLabel('Area').count()), 'a player sees it read-only');
check((await page.locator('[data-testid="tb-call"]').count()) === 5 && !(await page.locator('[data-testid="call-fill"]').count()), 'a player without a call job can’t enter tee times');
await page.screenshot({ path: `${SHOTS}/9-player.png`, fullPage: true });

// 12. Switched off: hidden.
asPlayer = false;
db.group_features.find((x) => x.feature_key === 'trip_finder').enabled = false;
db.plans.find((p) => p.id === PLAN).trip_id = null;
await page.goto(`${BASE}#/plan/${PLAN}`);
await page.reload();
await page.getByText('Spring trip').first().waitFor({ timeout: 15000 });
await wait(800);
check(!(await page.locator('[data-testid="tb-link"]').count()), 'feature off: no "Build the trip"');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
