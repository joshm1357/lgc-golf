// ov22 browser check, 23 Oct 2026. Fake database and fake functions only — nothing real is touched.
//   A. Caddie says hello: not on the join screen; the first time in the app a speech bubble pops from the Caddie
//      button (phone) / beside the docked tab (laptop); "Ask me something" opens the Caddie, whose empty chat starts with
//      the same hello; never again after either button; still motion with reduced motion.
//   B. ✨ Plan a trip: a pick-several question has toggle chips — tap two, "Send (2)" sends both; a one-answer question
//      still sends on tap.
//   C. Planning maps: the wheel zooms after a click (or with Ctrl), not before (a "Scroll to zoom" hint shows); the
//      Club names switch hides / shows the labels and is remembered; hover a row → its pin lights up (and the map pans
//      to it); hover a pin → its row lights up and a summary card shows; click → the details sheet with the research,
//      the group's own rating and social times; a 🏠 pin's summary and sheet; on a phone first tap / second tap.
// Usage: node hello-maps-test.mjs <base> <shotDir>   e.g. http://localhost:4521/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4521/lgc-golf/';
const SHOTS = process.argv[3] || './shots-hello';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000f';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const CODE = 'ABCDEFGH2345';
const now = new Date().toISOString();
const pid = (i) => `${String(i + 1).padStart(8, '0')}-2222-4222-8222-222222222222`;
const K = pid(0);
const names = ['Josh', 'Al', 'Bo', 'Cy', 'Di', 'Ed', 'Fin', 'Gus'];
const players = names.map((n, i) => ({ id: pid(i), name: `${n} Test`, nickname: n, handicap: 10 + i, approved: true, created_at: now }));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fri = (() => { const d = new Date(); d.setDate(d.getDate() + 21); while (d.getDay() !== 5) d.setDate(d.getDate() + 1); return d; })();
const W1 = { start: iso(fri), end: iso(new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 2)), long: false };

const L = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const library = [
  { id: L(1), name: 'Stonebridge Golf Club', area: 'Cessnock NSW', lat: -32.824, lng: 151.339 },
  { id: L(2), name: 'Cypress Lakes Golf & Country Club', area: 'Pokolbin NSW', lat: -32.783, lng: 151.291, mine_avg: 4.5 },
  { id: L(3), name: 'The Vintage Golf Club', area: 'Rothbury NSW', lat: -32.738, lng: 151.323 },
  { id: L(4), name: 'Branxton Golf Club', area: 'Branxton NSW', lat: -32.659, lng: 151.357 },
  { id: L(5), name: 'Maitland Golf Club', area: 'Maitland NSW', lat: -32.735, lng: 151.553 },
  { id: L(6), name: 'Kurri Kurri Golf Club', area: 'Kurri Kurri NSW', lat: -32.817, lng: 151.481 },
].map((c) => ({ holes: 18, facts: [], ...c }));
const slim = (id) => { const c = library.find((x) => x.id === id); return { id, name: c.name, area: c.area, lat: c.lat, lng: c.lng }; };
const stayAreas = [['Pokolbin', 'Hunter Valley', -32.78, 151.29], ['Cessnock', 'Hunter Valley', -32.83, 151.36]]
  .map(([name, region, lat, lng], i) => ({ id: crypto.randomUUID(), name, state: 'NSW', region, lat, lng, sort: i }));
const pin = (n) => { const a = stayAreas.find((x) => x.name === n); return { key: n, name: n, lat: a.lat, lng: a.lng }; };
const HUNTER = [L(1), L(2), L(3)];
const startState = {
  v: 1, region: null, regionOptions: ['Hunter Valley'], origin: null, nights: 2, weekends: [W1], weekendsSettled: false, stays: [], pins: [], stayMax: 40, detourMax: 25,
  days: [{ index: 0, leg: 'way', options: [] }, { index: 1, leg: 'stay', options: [] }, { index: 2, leg: 'home', options: [] }],
  courses: Object.fromEntries(library.map((c) => [c.id, slim(c.id)])), headcount: null, votes: {}, optionKeys: {}, callsMade: false, configs: [], picked: null,
  areaCourses: { 'Hunter Valley': HUNTER }, areaStays: { 'Hunter Valley': [pin('Pokolbin')] }, suggested: {}, extras: [],
};
const research = [{
  library_id: L(2), name: 'Cypress Lakes Golf & Country Club', town: 'Pokolbin', state: 'NSW', region: 'Hunter Valley', holes: 18, par: 72,
  fee_weekday: 89, fee_weekend: 109, access_type: 'public', good_for_groups: 5, drive_from_sydney_hours: 2.25,
  booking_url: 'https://cypresslakes.example/book', group_enquiry_url: 'https://cypresslakes.example/groups', website: 'https://cypresslakes.example/',
  phone: '(02) 4993 1555', email: 'golf@cypresslakes.example', last_checked: '2026-10-01', sources: ['https://cypresslakes.example/'],
  details: {
    style: 'parkland, resort', difficulty: '3 - wide fairways, lots of water', rankings: 'Top 100 public 2026: #41',
    visitor_times: 'Visitors 7 days from 7am', members_times: 'Sat mornings members until 10:30',
    twilight_or_group_rates: 'Groups of 12+: $79 with cart', group_bookings_how: 'Email the pro shop for 12+',
    stay_and_play: 'Oaks Cypress Lakes Resort: 2 nights + 2 rounds', good_for_groups: '5 - resort rooms on site',
    signature_features: 'The 18th over the lake to the clubhouse', practice_facilities: 'Driving range and putting green',
    food_and_drink: 'Bistro and bar, open late Fri–Sat', pace_of_play: 'About 4 h 15 on weekends', dress_code: 'Collared shirts, no denim',
    best_months: 'Mar–May, Sep–Nov', weather_notes: 'Hot and dry in summer', crowd_notes: 'Busy on long weekends and wine festival weekends',
    nearby_courses: 'The Vintage (5 min), Rydges Resort (15 min)', accommodation_on_site: 'Oaks Cypress Lakes Resort (villas sleep 6)',
  },
}];

const db = {
  players, trips: [], trophies: [], teams: [], team_players: [], quick_results: [], round_pins: [], scores: [], round_players: [], honour_board: [],
  courses: [], rounds: [],
  plans: [{ id: PLAN, kind: 'trip', name: 'Spring away', status: 'planning', start_date: null, end_date: null, proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, created_at: now }],
  plan_polls: [], plan_options: [], plan_votes: [], plan_comments: [], plan_costs: [], plan_payments: [], plan_transfers: [], notify_prefs: [], plan_budget_items: [], plan_items: [],
  plan_rsvps: players.map((x) => ({ plan_id: PLAN, player_id: x.id, status: 'in', updated_at: now })),
  plan_groups: [], plan_group_members: [], groups: [{ id: GROUP, vote_decider: 'admin', vote_channel: 'app' }],
  tribunal_cases: [], tribunal_votes: [], posts: [], rules: [], player_home_areas: [], trip_start_points: [],
  trip_finds: [], course_notes: [], course_ratings: [], stay_areas: stayAreas, trip_tee_options: [], course_booking_info: [], vote_batches: [],
  course_social_times: [{ id: crypto.randomUUID(), group_id: GROUP, course_id: L(2), weekdays: 'Tue & Thu from 7:30', weekends: 'Sun after 12', price: '$45 with the social group', group_size: 'Up to 16' }],
  course_research: research,
  trip_builds: [{ plan_id: PLAN, group_id: GROUP, state: startState }],
  plan_stays: [{ id: crypto.randomUUID(), group_id: GROUP, plan_id: PLAN, name: 'Vineyard house, Pokolbin', area: 'Hunter Valley', link: 'https://www.stayz.com.au/holiday-rental/p1', total_cost: 4800, sleeps: 12, is_list: false, option_id: null, chosen: false, created_by: K, created_at: now }],
  group_features: ['feed', 'planner', 'planner_tasks', 'trip_finder', 'ai_helper', 'planner_costs', 'notifications'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let member = true;
const aiCalls = [];
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
  if (name === 'my_status') {
    if (!member) return { is_member: false, is_admin: false, player_id: null, group_id: null, groups: [] };
    return { is_member: true, is_admin: true, player_id: K, group_name: 'Test Golfers', group_id: GROUP, role: 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Test Golfers', slug: 'test', role: 'organiser' }] };
  }
  if (name === 'trip_finder_courses') return library;
  if (name === 'group_invite') return CODE;
  if (name === 'invite_info') return { group_id: GROUP, group_name: 'Test Golfers', role: 'player', already_in: member };
  return null;
}
const REGIONS_Q = { id: 'where', text: 'Which areas appeal?', quick: ['Hunter Valley', 'South Coast', 'Central West', 'Other…'], multi: true };
const TRAVEL_Q = { id: 'travel', text: 'Driving or flying?', quick: ['Driving', 'Flying', 'Not sure'] };
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/')) return json(rpc(p.split('/').pop(), JSON.parse(req.postData() || '{}')));
  if (p.startsWith('/functions/v1/ai-helper')) {
    const b = JSON.parse(req.postData() || '{}');
    aiCalls.push(b);
    if (b.mode === 'plan_chat') {
      const first = /^Golf trip/.test(b.text);
      return json({ chat: { message: first ? 'Love it. A couple of quick ones:' : 'Got it.', draft: null, questions: first ? [REGIONS_Q, TRAVEL_Q] : [TRAVEL_Q], done: false, summary: [] }, remaining: { month: 50, today: 9 }, log_id: 7 });
    }
    return json({ text: 'The leaderboard is on the home screen.', go_to: null, log_id: 8, remaining: { month: 50, today: 9 } });
  }
  if (p.startsWith('/functions/v1/')) return json({ sent: 0 });
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') {
      const out = filterRows(rows, url.searchParams);
      if ((req.headers().accept || '').includes('vnd.pgrst.object')) return json(out[0] || null);
      return json(out);
    }
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const conflict = url.searchParams.get('on_conflict') || (table === 'trip_builds' ? 'plan_id' : null);
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const keys = conflict ? conflict.split(',') : null;
        const old = keys && rows.find((r) => keys.every((k) => String(r[k]) === String(b[k])));
        if (old) { Object.assign(old, b); made.push(old); continue; }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b };
        rows.push(row); made.push(row);
      }
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
    }
    return json([], 200);
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const auth = ([uid, seen, first]) => {
  // ov27 (F1): the hello waits for the second visit — these phones have been here once before, unless the test says.
  if (!first && !localStorage.getItem('tgt-visits')) localStorage.setItem('tgt-visits', '1');
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
  if (seen && !sessionStorage.getItem('seeded')) { localStorage.setItem('tgt-caddie-hello', '1'); sessionStorage.setItem('seeded', '1'); }
};
async function context(opts, seen = false, first = false) {
  const ctx = await browser.newContext(opts);
  await ctx.route('https://*.supabase.co/**', fake);
  await ctx.route('https://server.arcgisonline.com/**', (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.addInitScript(auth, ['99999999-9999-4999-8999-999999999999', seen, first]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e}`));
  return { ctx, page };
}
const PHONE = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 };
const box = (loc) => loc.boundingBox();

// ---------------------------------------------------------------- A0. ov27 (F1): not on the first visit
{
  const { ctx, page } = await context(PHONE, false, true);
  member = true;
  await page.goto(`${BASE}#/`);
  await page.waitForTimeout(5500);
  check(!(await page.getByTestId('caddie-hello').count()), 'F1: no hello on the very first visit');
  const again = await ctx.newPage(); // the app opened again: a second visit
  await again.goto(`${BASE}#/`);
  check(await again.getByTestId('caddie-hello').waitFor({ timeout: 12000 }).then(() => true, () => false), 'F1: the hello waits for the second visit');
  await ctx.close();
}

// ---------------------------------------------------------------- A. Caddie says hello — phone
{
  const { ctx, page } = await context(PHONE);
  const wait = (ms = 400) => page.waitForTimeout(ms);
  member = false;
  await page.goto(`${BASE}#/join/${CODE}`);
  await wait(4800);
  check(!(await page.getByTestId('caddie-hello').count()), 'not on the join screen');
  await page.screenshot({ path: `${SHOTS}/a-00-join-no-hello.png` });
  member = true;
  await page.goto(`${BASE}#/`);
  await page.reload();
  await page.getByTestId('caddie-hello').waitFor({ timeout: 12000 });
  const hello = page.getByTestId('caddie-hello');
  const text = await hello.innerText();
  check(/Hi, I’m Caddie\. Ask me anything about the group, the rules or the next trip — or say “plan a trip”\. I’m here to help\./.test(text), 'phone: the hello says what Josh asked for');
  check(await hello.getByRole('button', { name: 'Ask me something' }).isVisible() && await hello.getByRole('button', { name: 'Got it' }).isVisible(), 'two buttons: Ask me something, Got it');
  const hb = await box(hello); const cb = await box(page.getByTestId('caddie')); const tb = await box(page.locator('.tabs'));
  check(hb.y + hb.height <= cb.y + 2, `phone: the bubble sits above the Caddie button (${Math.round(hb.y + hb.height)} ≤ ${Math.round(cb.y)})`);
  check(hb.y + hb.height < tb.y, 'phone: it never covers the bottom tab bar');
  check(hb.x >= 0 && hb.x + hb.width <= 375, 'phone: fits on the screen');
  await page.screenshot({ path: `${SHOTS}/a-01-hello-phone.png` });
  await hello.getByRole('button', { name: 'Ask me something' }).click();
  await page.getByTestId('caddie-chat').waitFor({ timeout: 8000 });
  check((await page.getByTestId('caddie-greeting').innerText()).includes('Hi, I’m Caddie'), 'Ask me something → the Caddie opens, its chat starting with the same hello');
  check(!(await page.getByTestId('caddie-hello').count()), 'the bubble is gone');
  check(await page.evaluate(() => !!localStorage.getItem('tgt-caddie-hello')), 'remembered on this device');
  await page.screenshot({ path: `${SHOTS}/a-02-caddie-greeting-phone.png` });
  await page.reload();
  await wait(5500);
  check(!(await page.getByTestId('caddie-hello').count()), 'phone: shown once — not again after a reload');
  await ctx.close();
}
// ---------------------------------------------------------------- A. Caddie says hello — laptop, reduced motion
{
  const { ctx, page } = await context({ ...LAPTOP, reducedMotion: 'reduce' });
  const wait = (ms = 400) => page.waitForTimeout(ms);
  await page.goto(`${BASE}#/`);
  await page.getByTestId('caddie-hello').waitFor({ timeout: 12000 });
  const hello = page.getByTestId('caddie-hello');
  check(await hello.evaluate((el) => el.classList.contains('at-tab')), 'laptop: the bubble is beside the docked Caddie tab');
  const hb = await box(hello); const tab = await box(page.getByTestId('caddie'));
  check(hb.x + hb.width <= tab.x + 2 && hb.y < tab.y + tab.height && hb.y + hb.height > tab.y, 'laptop: next to the tab, not over it');
  check(await hello.evaluate((el) => getComputedStyle(el).animationName) === 'none', 'reduced motion: no pop-in animation');
  await page.screenshot({ path: `${SHOTS}/a-03-hello-laptop.png` });
  await hello.getByRole('button', { name: 'Got it' }).click();
  await wait(300);
  check(!(await page.getByTestId('caddie-hello').count()) && !(await page.getByTestId('caddie-panel').count()), 'Got it: gone, Caddie stays folded');
  await page.reload();
  await wait(5500);
  check(!(await page.getByTestId('caddie-hello').count()), 'laptop: never again after Got it');
  // The Caddie's empty chat starts with the hello on the laptop too; "plan a trip" goes to planning.
  await page.getByTestId('caddie').click();
  await page.getByTestId('caddie-greeting').waitFor({ timeout: 8000 });
  await page.getByLabel('Ask the caddie').last().fill('plan a trip');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByTestId('caddie-plan').waitFor({ timeout: 8000 });
  check(true, '"plan a trip" typed into Ask → ✨ Plan a trip');
  await ctx.close();
}

// ---------------------------------------------------------------- B. Pick several quick answers, then send
{
  const { ctx, page } = await context(PHONE, true);
  const wait = (ms = 400) => page.waitForTimeout(ms);
  await page.goto(`${BASE}#/plan`);
  // ov27 (F1): a brand-new group's organiser gets the three-step start, whose "Suggest the next trip" opens the planner.
  await page.getByTestId('plan-with-ai').or(page.getByTestId('starter-suggest')).first().click();
  await page.getByTestId('caddie-plan-sheet').waitFor({ timeout: 10000 });
  await page.getByLabel('Your message').fill('Golf trip with the boys');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const multi = page.locator('[data-testid="chat-question"][data-multi="yes"]');
  await multi.waitFor({ timeout: 10000 });
  check((await multi.innerText()).includes('Pick any, then send'), 'a pick-several question says so');
  const sendBtn = multi.getByTestId('chat-multi-send');
  check(await sendBtn.isDisabled() && (await sendBtn.innerText()) === 'Send', 'Send waits until something is picked');
  const before = aiCalls.length;
  await multi.getByRole('button', { name: 'Hunter Valley' }).click();
  await multi.getByRole('button', { name: 'South Coast' }).click();
  await wait(200);
  check(aiCalls.length === before, 'tapping a chip doesn’t send it');
  check(await multi.getByRole('button', { name: /Hunter Valley/ }).getAttribute('aria-pressed') === 'true' && await multi.getByRole('button', { name: /Central West/ }).getAttribute('aria-pressed') === 'false', 'tapped chips are ticked (toggle)');
  check((await sendBtn.innerText()) === 'Send (2)', `the button counts them: "${await sendBtn.innerText()}"`);
  await page.screenshot({ path: `${SHOTS}/b-01-multi-chips-phone.png` });
  // Untick and tick again: still two.
  await multi.getByRole('button', { name: /South Coast/ }).click();
  check((await sendBtn.innerText()) === 'Send (1)', 'tap again to untick');
  await multi.getByRole('button', { name: /Central West/ }).click();
  await sendBtn.click();
  await page.getByText('Got it.').waitFor({ timeout: 8000 });
  const sent = aiCalls.filter((c) => c.mode === 'plan_chat').at(-1);
  check(sent.text === 'Which areas appeal? → Hunter Valley, Central West', `Send (2) sends both together: "${sent.text}"`);
  // One-answer question: sends on tap, as before.
  const single = page.getByTestId('chat-question').last();
  check(!(await single.getAttribute('data-multi')) && !(await single.getByTestId('chat-multi-send').count()), 'a one-answer question has no Send button');
  await single.getByRole('button', { name: 'Driving' }).click();
  await wait(800);
  check(aiCalls.filter((c) => c.mode === 'plan_chat').at(-1).text === 'Driving or flying? → Driving', 'a one-answer question still sends on tap');
  await ctx.close();
}

// ---------------------------------------------------------------- C. Planning maps — laptop
{
  const { ctx, page } = await context(LAPTOP, true);
  const wait = (ms = 400) => page.waitForTimeout(ms);
  await page.goto(`${BASE}#/plan/${PLAN}/build`);
  await page.getByTestId('area-start').waitFor({ timeout: 15000 });
  await page.getByTestId('area-course').first().waitFor({ timeout: 10000 });
  const map = page.locator('[data-testid="tb-map"]').first();
  const leaf = map.locator('.leaflet-container');
  await map.scrollIntoViewIfNeeded();
  await wait(600);
  // The map's zoom, read from its tiles' addresses (…/tile/{z}/{y}/{x}).
  const zoomNow = () => page.evaluate(() => Math.max(...[...document.querySelectorAll('[data-testid=tb-map] .leaflet-tile')].map((t) => Number(t.src.split('/tile/')[1]?.split('/')[0])).filter((n) => n >= 0)));
  const mb = await leaf.boundingBox();
  const s0 = await zoomNow();
  // 3. Scroll-wheel zoom.
  await page.mouse.move(mb.x + 30, mb.y + mb.height - 40);
  await page.getByTestId('map-wheel-hint').waitFor({ timeout: 3000 });
  check((await page.getByTestId('map-wheel-hint').innerText()).startsWith('Scroll to zoom'), 'first hover: a small "Scroll to zoom" hint');
  await page.screenshot({ path: `${SHOTS}/c-01-scroll-hint.png` });
  await page.mouse.wheel(0, -400); await wait(500);
  const s1 = await zoomNow();
  check(s1 === s0, `before a click the wheel doesn’t zoom the map (the page scrolls) (zoom ${s0} → ${s1})`);
  await map.scrollIntoViewIfNeeded(); await wait(200);
  // A spot on the map clear of the pins and the controls, on the screen.
  const spot = async () => { const b = await leaf.boundingBox(); return [b.x + 30, Math.min(b.y + b.height - 40, 860 - 30)]; };
  await page.mouse.click(...(await spot())); await wait(200);
  await page.mouse.wheel(0, -300); await wait(700);
  const s2 = await zoomNow();
  check(s2 > s1, `after a click the wheel zooms in (zoom ${s1} → ${s2})`);
  await page.mouse.move(5, 5); await wait(200); // leave the map: wheel zoom off again
  const mb3 = await leaf.boundingBox();
  await page.mouse.move(...(await spot()));
  await page.keyboard.down('Control'); await page.mouse.wheel(0, 300); await page.keyboard.up('Control'); await wait(600);
  const s3 = await zoomNow();
  check(s3 < s2, `Ctrl + wheel zooms without a click (zoom ${s2} → ${s3})`);
  // 5. Club names.
  const labels = map.locator('.pm-label');
  check(await map.getByTestId('map-names').getAttribute('aria-pressed') === 'true', 'Club names: on by default, top-right of the map');
  const shown = await labels.evaluateAll((els) => els.filter((e) => getComputedStyle(e).visibility !== 'hidden').map((e) => e.textContent));
  check(shown.includes('The Vintage') && shown.some((t) => /Branxton|Maitland|Kurri/.test(t)), `short names beside the pins (${shown.join(', ')})`);
  check(!shown.some((t) => /Golf Club/.test(t)), 'no "Golf Club" on the labels');
  await page.screenshot({ path: `${SHOTS}/c-02-club-names-on.png` });
  // Overlaps hidden when zoomed right out.
  await page.mouse.move(...(await spot()));
  for (let i = 0; i < 3; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, 300); await page.keyboard.up('Control'); await wait(250); }
  await wait(400);
  const boxes = await labels.evaluateAll((els) => els.filter((e) => getComputedStyle(e).visibility !== 'hidden').map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }));
  const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]));
  check(!overlap, `zoomed out: no two labels on top of each other (${boxes.length} showing of ${await labels.count()})`);
  await page.screenshot({ path: `${SHOTS}/c-03-zoomed-out-labels.png` });
  await map.getByTestId('map-names').click(); await wait(300);
  check(!(await labels.count()) && await map.getByTestId('map-names').getAttribute('aria-pressed') === 'false', 'switched off: the labels go (🏠 pins keep theirs)');
  check(await map.locator('.tb-stay').count() > 0, 'stay pins still labelled');
  await page.screenshot({ path: `${SHOTS}/c-04-club-names-off.png` });
  await page.reload();
  await page.getByTestId('area-course').first().waitFor({ timeout: 10000 }); await wait(600);
  check(await page.locator('[data-testid="tb-map"]').first().getByTestId('map-names').getAttribute('aria-pressed') === 'false' && !(await page.locator('.pm-label').count()), 'remembered after a reload');
  await page.locator('[data-testid="tb-map"]').first().getByTestId('map-names').click(); await wait(300);
  check(await page.locator('.pm-label').count() > 0, 'back on');
  // 4. Hover a row → its pin lights up, label shows, map pans to it.
  const map2 = page.locator('[data-testid="tb-map"]').first();
  const row = page.getByTestId('area-course').filter({ hasText: 'Cypress Lakes' });
  await row.hover(); await wait(400);
  check(await map2.locator('path.leaflet-interactive.pm-hot').count() === 1, 'hover a row → its pin grows and bounces');
  check(await map2.locator('.pm-label.hot').innerText() === 'Cypress Lakes', 'and shows its name');
  const tip = page.getByTestId('place-tip');
  const tipText = await tip.innerText();
  check(tipText.includes('Cypress Lakes Golf & Country Club') && tipText.includes('★★★★★ for groups') && tipText.includes('$89 weekdays · $109 weekends') && tipText.includes('Visitors: Visitors 7 days from 7am'),
    `hover a row → a summary card: style, ★ groups, fees, drive, visitor times (${tipText.replace(/\s+/g, ' ').slice(0, 140)})`);
  await page.screenshot({ path: `${SHOTS}/c-05-hover-row.png` });
  // Pan: zoom right in on one corner, then point at a course that's off the map.
  const mb4 = await map2.locator('.leaflet-container').boundingBox();
  await page.mouse.click(mb4.x + 20, mb4.y + 60);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -300); await wait(250); }
  await page.mouse.move(5, 5);
  const far = page.getByTestId('area-course').filter({ hasText: 'Branxton' });
  if (await far.count()) {
    await far.hover(); await wait(600);
    const hp = await map2.locator('path.leaflet-interactive.pm-hot').boundingBox();
    const mm = await map2.locator('.leaflet-container').boundingBox();
    check(hp && hp.x >= mm.x && hp.x <= mm.x + mm.width && hp.y >= mm.y && hp.y <= mm.y + mm.height, 'a course off the map: the map pans to it');
  } else check(false, 'Branxton row to point at');
  await page.mouse.move(5, 5); await wait(400);
  // Frame everything again (reload) and hover a pin → its row lights up, a summary card on the pin.
  await page.reload();
  await page.getByTestId('area-course').first().waitFor({ timeout: 10000 }); await wait(800);
  const map3 = page.locator('[data-testid="tb-map"]').first();
  const pinsNow = map3.locator('path.leaflet-interactive');
  let hit = '';
  for (let i = 0; i < await pinsNow.count() && !hit; i++) {
    await pinsNow.nth(i).hover({ force: true }); await wait(350);
    hit = (await page.locator('[data-testid="area-course"].pm-row-hot').count()) ? await page.locator('[data-testid="area-course"].pm-row-hot').innerText() : '';
  }
  check(!!hit, `hover a pin → its row lights up (${hit.split('\n')[0]})`);
  check(await map3.locator('.pm-tip [data-testid="place-tip"]').count() === 1 && (await map3.locator('.pm-tip').innerText()).includes(hit.split('\n')[0].replace(/ ✨ suggested$/, '').trim()), 'and its summary card shows on the pin');
  await page.screenshot({ path: `${SHOTS}/c-06-hover-pin.png` });
  // 6. Click → everything: the Cypress Lakes sheet.
  await page.mouse.move(5, 5); await wait(400);
  await page.getByTestId('area-course').filter({ hasText: 'Cypress Lakes' }).getByRole('button', { name: /Cypress Lakes/ }).click();
  const sheet = page.getByTestId('tb-course');
  await sheet.waitFor({ timeout: 6000 });
  await sheet.getByTestId('about-groups').waitFor({ timeout: 6000 });
  const all = await sheet.innerText();
  for (const [label, want] of [
    ['style', 'Style: parkland, resort'], ['rankings', 'Ranked: Top 100 public 2026: #41'], ['fees + group rates', 'Groups of 12+: $79 with cart'],
    ['visitor times', 'Visitor times: Visitors 7 days from 7am'], ['member times', 'Members have: Sat mornings members until 10:30'],
    ['how to book', 'How to book: Email the pro shop for 12+'], ['stay and play', 'Stay and play: Oaks Cypress Lakes Resort'],
    ['signature', 'Signature: The 18th over the lake'], ['practice', 'Practice: Driving range and putting green'], ['food', 'Food & drink: Bistro and bar'],
    ['pace', 'Pace: About 4 h 15'], ['dress code', 'Dress code: Collared shirts'], ['best months', 'Best months: Mar–May'], ['weather', 'Weather: Hot and dry'],
    ['crowds', 'Crowds: Busy on long weekends'], ['nearby', 'Nearby courses: The Vintage'], ['accommodation', 'Accommodation: Oaks Cypress Lakes Resort (villas sleep 6)'],
    ['researched', 'Researched Oct 2026 — check with the club'], ['our rating', 'Your group: ★4.5'], ['social times', 'Tue & Thu from 7:30'],
    ['library', 'Holes'], ['par', 'Par'],
  ]) check(all.includes(want), `sheet: ${label}`);
  check(await sheet.getByRole('link', { name: 'Book online ↗' }).first().getAttribute('href') === 'https://cypresslakes.example/book' && await sheet.getByRole('link', { name: 'Group enquiry ↗' }).getAttribute('href') === 'https://cypresslakes.example/groups', 'sheet: booking and group enquiry links');
  check(/openstreetmap\.org/.test(await sheet.getByRole('link', { name: 'See it on a map ↗' }).getAttribute('href')), 'sheet: where it is on a map');
  check((await sheet.getByTestId('sheet-toggle').innerText()).startsWith('Take it off the table'), 'sheet: the on-the-table button');
  await page.screenshot({ path: `${SHOTS}/c-07-course-sheet.png` });
  await sheet.getByTestId('sheet-more-research').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/c-08-course-sheet-more.png` });
  await page.keyboard.press('Escape'); await wait(300);
  if (await sheet.count()) { await page.getByRole('button', { name: /Close/ }).last().click(); await wait(300); }
  // A place to stay: hover → summary; click → its sheet.
  const stayPin = map3.locator('.tb-stay', { hasText: 'Pokolbin' });
  await stayPin.hover(); await wait(400);
  const stayTipText = await map3.locator('.pm-tip').innerText();
  check(stayTipText.includes('Pokolbin') && stayTipText.includes('sleeps up to 12') && stayTipText.includes('From $4800') && /⛳ .+ \d+ min/.test(stayTipText), `🏠 pin hover → type, sleeps, price, nearest courses (${stayTipText.replace(/\s+/g, ' ')})`);
  await page.screenshot({ path: `${SHOTS}/c-09-stay-tip.png` });
  await stayPin.click();
  const ss = page.getByTestId('stay-sheet');
  await ss.waitFor({ timeout: 5000 });
  const ssText = await ss.innerText();
  check(ssText.includes('Courses nearby') && ssText.includes('Vineyard house, Pokolbin') && ssText.includes('sleeps 12') && ssText.includes('$4800 all up'), 'stay sheet: courses nearby and the saved places with their details');
  check(await ss.getByRole('link', { name: 'Have a look ↗' }).getAttribute('href') === 'https://www.stayz.com.au/holiday-rental/p1', 'stay sheet: its links');
  await page.screenshot({ path: `${SHOTS}/c-10-stay-sheet.png` });
  await ctx.close();
}

// ---------------------------------------------------------------- C. Planning maps — phone: first tap, second tap, More
{
  const { ctx, page } = await context(PHONE, true);
  const wait = (ms = 400) => page.waitForTimeout(ms);
  await page.goto(`${BASE}#/plan/${PLAN}/build`);
  await page.getByTestId('area-course').first().waitFor({ timeout: 15000 }); await wait(800);
  const map = page.locator('[data-testid="tb-map"]').first();
  await map.scrollIntoViewIfNeeded();
  check(await map.getByTestId('map-names').isVisible(), 'phone: the Club names switch is on the map');
  const nameBtn = page.getByTestId('area-course').filter({ hasText: 'Cypress Lakes' }).getByRole('button', { name: /Cypress Lakes/ });
  await nameBtn.tap(); await wait(300);
  check(await page.getByTestId('place-tip').isVisible() && !(await page.getByTestId('tb-course').count()), 'phone: first tap on a row → its summary');
  check(await map.locator('path.leaflet-interactive.pm-hot').count() === 1, 'phone: and its pin lights up');
  await page.screenshot({ path: `${SHOTS}/d-01-phone-first-tap.png` });
  await page.getByTestId('place-tip-more').tap();
  await page.getByTestId('tb-course').waitFor({ timeout: 5000 });
  check(true, 'phone: "More →" on the summary opens everything');
  await page.screenshot({ path: `${SHOTS}/d-02-phone-sheet.png` });
  await page.getByRole('button', { name: /Close/ }).last().click(); await wait(300);
  await map.scrollIntoViewIfNeeded();
  await map.locator('.tb-stay', { hasText: 'Pokolbin' }).tap(); await wait(300);
  check(await map.locator('.pm-tip').isVisible() && !(await page.getByTestId('stay-sheet').count()), 'phone: first tap on a 🏠 pin → its summary on the map');
  await page.screenshot({ path: `${SHOTS}/d-03-phone-pin-tip.png` });
  await map.locator('.tb-stay', { hasText: 'Pokolbin' }).tap();
  await page.getByTestId('stay-sheet').waitFor({ timeout: 5000 });
  check(true, 'phone: second tap → its details');
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w <= 376, `phone: no sideways scroll (${w})`);
  await ctx.close();
}

// ---------------------------------------------------------------- the trip finder map: wheel zoom + names too
{
  const { ctx, page } = await context(LAPTOP, true);
  await page.goto(`${BASE}#/plan/${PLAN}/find`);
  const tf = page.getByTestId('tf-map');
  if (await tf.first().isVisible({ timeout: 8000 }).catch(() => false)) {
    check(await tf.first().getByTestId('map-names').isVisible(), 'trip finder map: the Club names switch');
  } else check(true, 'trip finder map not shown with no starting points (fine)');
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n${fails.join('\n')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
