// The day plan browser check (ov40), 25 Oct 2026. Fake database only — nothing real is touched.
// A Hunter Valley trip, Fri 12 – Sun 14 Mar 2027, 8 coming from the Inner West:
//   * golf on each day (the Blue Mountains fix): an old trip with empty travel days gets them filled when the organiser
//     opens Plan the trip; the day plan shows "On the way there · 18 holes" etc.; How much golf → spare day.
//   * a driving day (Fri): leave home → drive → golf → dinner; a course whose times close early is "too early to make it";
//     unknown times show the usual ones as "unconfirmed".
//   * a flying day: Fly → the flight blocks and a later arrival, so fewer times fit.
//   * a player's note on Saturday with "Morning free" changes which times are starred; the player sees counts, the
//     organiser sees names.
//   * the organiser picks a time → it goes on the day (the builder's state) and shows on the timeline.
//   * phone 375 px and laptop 1280 px screenshots.
// Usage: node day-plan-test.mjs <base> <shotDir>   e.g. http://localhost:4373/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4373/lgc-golf/';
const SHOTS = process.argv[3] || './shots-ov40';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000004f';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000040';
const now = new Date().toISOString();
const pid = (i) => `${String(i + 1).padStart(8, '0')}-4040-4040-8040-404040404040`;
const K = pid(0);
const names = ['Josh', 'Al', 'Bo', 'Cy', 'Di', 'Ed', 'Fin', 'Gus'];
const players = names.map((n, i) => ({ id: pid(i), name: `${n} Test`, nickname: n, handicap: 10 + i, approved: true, created_at: now }));
const L = (n) => `40404040-0000-4000-8000-${String(n).padStart(12, '0')}`;
const library = [
  { id: L(1), name: 'Cessnock GC', area: 'Cessnock NSW', lat: -32.84, lng: 151.35, holes: 18, facts: [] },
  { id: L(2), name: 'The Vintage', area: 'Rothbury NSW', lat: -32.76, lng: 151.33, holes: 18, facts: [], mine_avg: 4.5 },
  { id: L(3), name: 'Kurri Kurri GC', area: 'Kurri Kurri NSW', lat: -32.82, lng: 151.48, holes: 18, facts: [] },
  { id: L(4), name: 'Hunter Valley GC', area: 'Lochinvar NSW', lat: -32.70, lng: 151.45, holes: 18, facts: [] },
];
const slimC = (c) => ({ id: c.id, name: c.name, area: c.area, lat: c.lat, lng: c.lng, mine_avg: c.mine_avg ?? null, others_avg: null });
const stay = { key: 'Cessnock', name: 'Cessnock', lat: -32.83, lng: 151.36 };
// The trip as saved before ov40: only the stay day has courses (what live had for the Blue Mountains idea).
const oldState = {
  v: 1, region: 'Hunter Valley', regionOptions: ['Hunter Valley'], nights: 2, weekends: [{ start: '2027-03-12', end: '2027-03-14', long: false }], weekendsSettled: true,
  stays: [stay], pins: [], stayMax: 40, detourMax: 25,
  days: [{ index: 0, leg: 'way', options: [] }, { index: 1, leg: 'stay', options: [L(2), L(1)] }, { index: 2, leg: 'home', options: [] }],
  courses: Object.fromEntries(library.map((c) => [c.id, slimC(c)])), areaCourses: { 'Hunter Valley': library.map((c) => c.id) }, areaStays: { 'Hunter Valley': [stay] },
  headcount: 8, headcountBy: 'organiser', votes: {}, optionKeys: {}, callsMade: false, configs: [], picked: null, suggested: {}, extras: null, travel: 'drive',
};
const stayAreas = [['Cessnock', 'Hunter Valley', -32.83, 151.36], ['Pokolbin', 'Hunter Valley', -32.78, 151.29]]
  .map(([name, region, lat, lng], i) => ({ id: crypto.randomUUID(), name, state: 'NSW', region, lat, lng, sort: i }));

const db = {
  players, trips: [], trophies: [], teams: [], team_players: [], quick_results: [], round_pins: [], scores: [], round_players: [], honour_board: [],
  courses: [], rounds: [],
  plans: [{ id: PLAN, kind: 'trip', name: 'Hunter March 2027', status: 'planning', start_date: null, end_date: null, proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, created_at: now }],
  plan_polls: [], plan_options: [], plan_votes: [], plan_comments: [], plan_items: [], plan_costs: [], plan_payments: [], plan_transfers: [], notify_prefs: [],
  plan_rsvps: players.map((p) => ({ plan_id: PLAN, player_id: p.id, status: 'in', updated_at: now })),
  plan_groups: [], plan_group_members: [], groups: [{ id: GROUP, vote_decider: 'admin' }],
  tribunal_cases: [], tribunal_votes: [], posts: [], rules: [], player_home_areas: [],
  trip_start_points: [{ id: crypto.randomUUID(), group_id: GROUP, plan_id: PLAN, label: 'Inner West', lat: -33.88, lng: 151.16, headcount: 8, leave_after: '06:00', finish_by: '17:00', sort: 0 }],
  trip_finds: [], course_notes: [], course_ratings: [], stay_areas: stayAreas,
  trip_builds: [{ id: crypto.randomUUID(), group_id: GROUP, plan_id: PLAN, state: oldState, created_at: now, updated_at: now }],
  trip_tee_options: [], course_booking_info: [{ course_id: L(2), booking_method: 'online', booking_url: 'https://vintage.example/book', max_group: 24, features: [] }], vote_batches: [],
  // The group's notes: Cessnock only early on a Friday (comps after); The Vintage after 11 on a Saturday.
  course_social_times: [
    { group_id: GROUP, course_id: L(1), weekdays: '7-8am', weekends: 'Sat after 1' },
    { group_id: GROUP, course_id: L(2), weekdays: 'after 10', weekends: 'Sat after 11' },
  ],
  course_research: [{ library_id: L(2), name: 'The Vintage', fee_weekday: 99, fee_weekend: 129, details: { style: 'parkland' } }],
  // ov39's wishes (108): Cy wants to play early on the middle days (ov41: by the day's place, and 3 nights); Di's older
  // row says early by weekday (Saturday) — still read.
  plan_wishes: [{ plan_id: PLAN, player_id: pid(3), day_prefs: { middle: 'early' }, nights: [3], golf_per_day: 'daily', updated_at: now },
    { plan_id: PLAN, player_id: pid(4), day_prefs: { sat: 'early' }, updated_at: now }],
  group_features: ['feed', 'planner', 'planner_tasks', 'trip_finder'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let asPlayer = false;
const notifyCalls = [];
const match = (r, k, v) => {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(r[k]));
  if (v.startsWith('is.')) return v === 'is.null' ? r[k] == null : true;
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
function rpc(name) {
  if (name === 'my_status') return { is_member: true, is_admin: !asPlayer, player_id: asPlayer ? pid(1) : K, group_name: 'Test Golfers', group_id: GROUP, role: asPlayer ? 'player' : 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Test Golfers', slug: 'test', role: asPlayer ? 'player' : 'organiser' }] };
  if (name === 'trip_finder_courses') return library;
  // 108: a player gets the group's answers without names (the organiser reads plan_wishes directly).
  if (name === 'idea_wish_answers') return (db.plan_wishes || []).map(({ player_id: _p, plan_id: _q, ...w }) => w);
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
  if (p.startsWith('/functions/v1/')) return json({ sent: 0 });
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const conflict = url.searchParams.get('on_conflict') || (table === 'plan_rsvps' ? 'plan_id,player_id' : null);
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const keys = conflict ? conflict.split(',') : null;
        const old = keys && rows.find((r) => keys.every((k) => String(r[k]) === String(b[k])));
        if (old) { Object.assign(old, b); made.push(old); continue; }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b };
        if (table === 'plan_comments') row.player_id ??= asPlayer ? pid(1) : K;
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
}, ['99999999-9999-4999-8999-999999999940']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
const wait = (ms = 500) => page.waitForTimeout(ms);
const tab = (i) => page.getByTestId('dp-day-tab').nth(i);
const course = (name) => page.locator('.dp-cmp-cards [data-testid="dp-course"]').filter({ hasText: name });
// Course cards are one line until tapped (coordinator review); the best 3 show, "Show N more" for the rest.
async function openCourse(name) {
  if (!(await course(name).count()) && await page.getByTestId('dp-more-courses').count()) { await page.getByTestId('dp-more-courses').click(); await wait(200); }
  if ((await course(name).getAttribute('data-open')) !== '1') { await course(name).getByTestId('dp-course-line').click(); await wait(200); }
  return course(name);
}

// 1. Golf on each day: the old trip's empty Friday and Sunday get courses when the organiser opens Plan the trip.
await page.goto(`${BASE}#/plan/${PLAN}/build`);
await page.locator('.tb-steps').waitFor({ timeout: 15000 });
for (let i = 0; i < 30 && !state().daysFilled; i++) await wait(300);
const filled = state().days || [];
check(state().daysFilled === 1 && filled.every((d) => (d.options || []).length > 0), `the empty travel days are filled (${filled.map((d) => d.options.length).join('/')})`);
check(filled[1].options.join() === [L(2), L(1)].join(), 'the stay day keeps its own courses');
await page.locator('[data-testid="tb-step-courses"]').getByRole('button').first().click(); await wait(600);
check((await page.getByTestId('tb-day-role').allInnerTexts()).join(' | ') === 'On the way there · 18 holes | Stay day · 18 holes | On the way home · 18 holes', 'each day says its role and 18 holes');
check(await page.getByTestId('tb-day-plan').isVisible(), 'a "Day plan" button in Courses & stays');

// 2. The day plan: Friday, driving from the Inner West.
await page.getByTestId('tb-day-plan').click();
await page.getByTestId('day-plan').waitFor({ timeout: 10000 });
await wait(800);
check(await page.getByTestId('dp-day-tab').count() === 3, 'three days');
check((await tab(0).innerText()).includes('Fri 12 Mar') && (await tab(0).innerText()).includes('On the way there'), `Friday is the way there (${(await tab(0).innerText()).replace(/\n/g, ' ')})`);
check((await page.getByTestId('dp-starts').innerText()).includes('Inner West'), 'from the Inner West');
check(JSON.stringify(state().dayPlan?.starts || []).includes('Inner West'), 'the starting point is kept in the plan (rounded) for everyone');
const blocks = page.getByTestId('day-blocks');
// The suggested plan comes first: one line a day, each with "Change".
const sugg = page.getByTestId('dp-suggested');
check(await sugg.isVisible() && (await page.getByTestId('dp-suggested-day').count()) === 3, 'a suggested plan at the top, one line per day');
const sugLines = await page.getByTestId('dp-suggested-day').allInnerTexts();
check(/^Fri: .+ \d{1,2}(:\d\d)?[ap]m \(on the way, done ~/.test(sugLines[0]) && /home by ~/.test(sugLines[2]), `the lines read right (${sugLines.map((l) => l.replace(/\s*Change \w+$/, '')).join(' | ')})`);
const sugCourses = sugLines.map((l) => l.split(':')[1].trim().replace(/ \d.*$/, ''));
check(new Set(sugCourses).size === 3, `a different course each day (${sugCourses.join(', ')})`);
// Leave time follows the tee time: Friday's drive isn't at 6am for a late-morning tee.
const firstBlock = (await blocks.locator('li').first().innerText());
check(/Drive from Inner West/.test(firstBlock) && !/^6am/.test(firstBlock), `Friday’s drive follows the suggested tee (${firstBlock})`);
check(await page.getByTestId('dp-suggested-note').isVisible(), 'the timeline says it shows the suggested time');
// Course cards: one line each, the best 3, "Show N more".
check((await page.locator('.dp-cmp-cards [data-testid="dp-course"]').count()) === 3 && (await page.locator('.dp-cmp-cards [data-testid="dp-course"][data-open="1"]').count()) === 0, 'three course cards, folded to one line');
check(/suits \d+ of 8/.test((await page.getByTestId('dp-course-line').first().innerText())), `a card’s one line (${await page.getByTestId('dp-course-line').first().innerText()})`);
check(/Drive from Inner West/.test(await blocks.innerText()), 'Friday starts with the drive from home');
check(/dusk \(sunset\) about 7:1\dpm/.test(await blocks.innerText()), `dusk is about 7:1x pm (${(await blocks.innerText()).split('\n').pop()})`);
check((await (await openCourse('Cessnock GC')).getByTestId('dp-fit-line').innerText()).includes('too early to make it'), 'Cessnock on a Friday (7–8am only): too early to make it from Sydney');
check(/^after 10am$/.test(await (await openCourse('The Vintage')).getByTestId('dp-times').innerText()), 'The Vintage: our notes say after 10 on weekdays');
check(/unconfirmed/.test(await (await openCourse('Kurri Kurri GC')).getByTestId('dp-times').innerText()), `no times known → the usual, unconfirmed (${await (await openCourse('Kurri Kurri GC')).getByTestId('dp-times').innerText()})`);
const friSlots = await (await openCourse('The Vintage')).getByTestId('dp-slot').count();
check(friSlots > 3, `The Vintage has several Friday times (${friSlots})`);
await page.screenshot({ path: `${SHOTS}/1-friday-drive.png`, fullPage: true });

// 3. Flying: the flight comes in, the arrival is later, fewer Friday times fit.
await page.getByTestId('dp-travel').getByRole('button', { name: '✈️ Fly' }).click(); await wait(600);
await page.getByTestId('fly-flightMin').fill('180'); await wait(800);
check(state().dayPlan?.travel?.mode === 'fly' && state().dayPlan.travel.fly.flightMin === 180, 'flying, with the flight time typed in');
check(/Flight \(about 3 h; first flights about 6am\)/.test(await blocks.innerText()), 'the flight is on the timeline (no fare)');
const flySlots = await (await openCourse('The Vintage')).getByTestId('dp-slot').count();
check(flySlots < friSlots, `flying, fewer Friday times fit (${flySlots} < ${friSlots})`);
await page.screenshot({ path: `${SHOTS}/2-friday-fly.png`, fullPage: true });
await page.getByTestId('dp-travel').getByRole('button', { name: '🚗 Drive' }).click(); await wait(600);

// 4. Saturday: Cy wants to play early (wishes). Then Al (a player) says "morning free".
await tab(1).click(); await wait(600);
check(/Show 1 more/.test(await page.getByTestId('dp-more-courses').innerText()) && (await page.locator('.dp-cmp-cards [data-testid="dp-course"]').count()) === 3, 'Saturday: the best 3 courses, "Show 1 more" for the rest');
check((await page.getByTestId('dp-prefs-line').innerText()).includes('2 want to play early'), `Cy’s “middle days: early” and Di’s old “Saturday: early” both show for Saturday (${await page.getByTestId('dp-prefs-line').innerText()})`);
check(/1 wants 3 nights/.test(await page.getByTestId('dp-schedule-fit').innerText()), `the trip’s line says Cy wants 3 nights (${await page.getByTestId('dp-schedule-fit').innerText()})`);
const vintageBest0 = await (await openCourse('The Vintage')).locator('[data-testid="dp-slot"].best').count();
check(vintageBest0 === 0, 'The Vintage (after 11 on Saturdays) has no time that suits "play early"');
asPlayer = true;
await page.reload();
await page.getByTestId('day-plan').waitFor({ timeout: 10000 }); await wait(800);
check(!(await page.getByTestId('dp-day-controls').count()), 'a player can’t change the days');
await page.getByTestId('dp-pref-morning_free').click();
await page.getByTestId('dp-note-text').fill('Keep Saturday morning free, play midday');
await page.getByTestId('dp-note-send').click(); await wait(900);
const note = db.plan_comments.find((c) => c.day_date === '2027-03-13');
check(note && note.day_pref === 'morning_free' && note.body.includes('morning free'), 'the note is saved on Saturday with "morning free"');
check(notifyCalls.some((n) => n.type === 'comment_added'), 'the trip’s people are told (comment_added)');
check(await page.getByTestId('dp-note').count() === 1 && (await page.getByTestId('dp-note-pref').innerText()).includes('Morning free'), 'the note shows with its wish');
await wait(400);
const best = await (await openCourse('The Vintage')).locator('[data-testid="dp-slot"].best').evaluateAll((els) => els.map((e) => Number(e.dataset.tee)));
check(best.length > 0 && best.every((t) => t >= 11 * 60 + 30), `now the starred Saturday times suit "morning free" (from 11:30: ${best.map((t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`).join(', ')})`);
check(/Not for 2 of the group/.test(await (await openCourse('The Vintage')).getByTestId('dp-notfor').innerText()), 'a player sees counts, not names (Cy and Di)');
check(await page.locator('[data-testid="day-wish-markers"]').isVisible(), 'the wishes sit on the timeline as markers');
await page.screenshot({ path: `${SHOTS}/3-saturday-player-note.png`, fullPage: true });

// 5. The organiser picks a time; names shown to the organiser only.
asPlayer = false;
await page.reload();
await page.getByTestId('day-plan').waitFor({ timeout: 10000 }); await wait(800);
check(/Not for: Cy \(wanted “play early”\)/.test(await (await openCourse('The Vintage')).getByTestId('dp-notfor').innerText()), 'the organiser sees who it doesn’t suit, by name');
await (await openCourse('The Vintage')).locator('[data-testid="dp-slot"].best').first().click(); await wait(800);
const pick = state().dayPlan?.picks?.[1];
check(pick && pick.course_id === L(2) && /^1[12]:\d0$/.test(pick.tee || ''), `picked The Vintage about ${pick?.tee}`);
check(state().days.find((d) => d.index === 1).options.includes(L(2)), 'it’s on Saturday’s courses (the builder’s days)');
check((await page.getByTestId('dp-picked').innerText()).includes('The Vintage, about'), 'the pick shows, "about"');
check(/The Vintage: tee off/.test(await blocks.innerText()), 'and the golf is on Saturday’s timeline');
await page.screenshot({ path: `${SHOTS}/4-saturday-picked.png`, fullPage: true });

// 6. How much golf: a spare day → Saturday off (its courses kept); back to a round a day.
await page.getByTestId('dp-golf-amount').getByRole('button', { name: 'Leave a spare day' }).click(); await wait(800);
check(state().golfAmount === 'spare_day' && state().days.map((d) => d.golf || '18').join() === '18,none,18', `a spare day: Saturday off (${state().days.map((d) => d.golf || '18').join()})`);
check(state().days[1].options.length > 0, 'Saturday’s courses are kept');
check((await page.getByTestId('dp-schedule-line').innerText()) === 'Fri 18 holes · Sat no golf · Sun 18 holes', 'the line says Saturday has no golf');
await page.getByTestId('dp-golf-amount').getByRole('button', { name: 'A round a day' }).click(); await wait(800);
check(state().days.every((d) => (d.golf || '18') === '18'), 'back to a round a day');
// "Use this plan": every day picked at once.
await page.getByTestId('dp-use-plan').click(); await wait(900);
const picks = state().dayPlan?.picks || {};
check(['0', '1', '2'].every((k) => picks[k]?.course_id && picks[k]?.tee), `"Use this plan" picks every day (${Object.entries(picks).map(([k, v]) => `${k}:${v.tee}`).join(', ')})`);
check(await page.getByTestId('dp-plan-used').isVisible(), 'and says it’s the plan');
// A single day's golf: 36 on Saturday.
await page.getByTestId('dp-day-controls').getByRole('button', { name: '36' }).click(); await wait(600);
check(state().days[1].golf === '36' && /two rounds/.test(await page.getByTestId('dp-day').innerText()), 'Saturday set to 36 (two rounds)');
check(await page.getByTestId('dp-36-flag').isVisible(), 'March daylight: "36 holes doesn’t fit the daylight" is said plainly');
check(/finishes after dusk — tee off by/.test(await page.getByTestId('dp-pick-flag').innerText()), 'and the 11:30 pick is flagged as finishing after dusk');

// 7. Laptop: the side-by-side table.
await page.setViewportSize({ width: 1280, height: 900 }); await wait(600);
check(await page.getByTestId('dp-table').isVisible(), 'laptop: the courses side by side');
await page.screenshot({ path: `${SHOTS}/5-laptop.png`, fullPage: true });
await page.setViewportSize({ width: 375, height: 812 }); await wait(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 1, `phone: no sideways scroll (${overflow})`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
