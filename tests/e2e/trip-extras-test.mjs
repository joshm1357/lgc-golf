// Trip extras (064) browser check, 21 Oct 2026: weather (faked Open-Meteo), "Same as last time", fines and dinner
// awards, and both switches off. Fake database only.
// Usage: node trip-extras-test.mjs <base> <shotDir>   e.g. http://localhost:4326/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4326/lgc-golf/';
const SHOTS = process.argv[3] || './shots-trip-extras';
fs.mkdirSync(SHOTS, { recursive: true });

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const TODAY = day(0);

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000e';
const K = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const TNOW = 'aaaaaaaa-0000-4000-8000-000000000001';
const TPAST = 'aaaaaaaa-0000-4000-8000-000000000002';
const PNOW = 'bbbbbbbb-0000-4000-8000-000000000001';
const PPAST = 'bbbbbbbb-0000-4000-8000-000000000002';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const C2 = 'cccccccc-0000-4000-8000-000000000002';
const now = new Date().toISOString();
const holes = (lat, lng) => Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1, green: { lat: lat + i * 0.0005, lng: lng + i * 0.0005 } }));
const PAST_START = '2025-10-24'; // a Friday

const feats = ({ weather = true, dinner = true } = {}) => [
  ...['feed', 'side_comps', 'planner', 'planner_tasks', 'games', 'trophies'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
  { group_id: GROUP, feature_key: 'weather', enabled: weather },
  { group_id: GROUP, feature_key: 'dinner_awards', enabled: dinner },
];
const db = {
  players: [
    { id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 10, approved: true, created_at: now },
    { id: A, name: 'Al Blue', nickname: null, handicap: 12, approved: true, created_at: now },
    { id: B, name: 'Bo Red', nickname: null, handicap: 18, approved: true, created_at: now },
  ],
  trips: [
    { id: TNOW, name: 'Hunter Weekend', start_date: TODAY, end_date: day(2), status: 'active', created_at: now },
    { id: TPAST, name: 'Hunter 2025', start_date: PAST_START, end_date: '2025-10-26', status: 'locked', created_at: '2025-01-01T00:00:00Z' },
  ],
  trophies: [{ id: 'eeeeeeee-1000-4000-8000-000000000001', trip_id: TPAST, name: 'The BD Trophy', type: 'stableford_total', description: null, created_at: now }],
  teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [],
  round_players: [K, A, B].map((p) => ({ round_id: 'dddddddd-0000-4000-8000-000000000009', player_id: p, playing_handicap: 0 })),
  scores: [],
  courses: [
    { id: C1, name: 'Cypress Lakes', holes: holes(-32.8, 151.3), created_at: now },
    { id: C2, name: 'The Vintage', holes: holes(-32.79, 151.32), created_at: now },
  ],
  rounds: [
    { id: 'dddddddd-0000-4000-8000-000000000009', trip_id: TNOW, course_id: C1, name: 'Today — Cypress Lakes', play_date: TODAY, format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now },
    { id: 'dddddddd-0000-4000-8000-000000000001', trip_id: TPAST, course_id: C1, name: 'Friday Stableford', play_date: PAST_START, format: 'stableford', status: 'locked', ld_holes: [9], ctp_holes: [3, 12], comp_bonus: 0, own_comps: [], created_at: '2025-10-24T00:00:00Z' },
    { id: 'dddddddd-0000-4000-8000-000000000002', trip_id: TPAST, course_id: C2, name: 'Sunday Ambrose', play_date: '2025-10-26', format: 'ambrose', status: 'locked', ld_holes: [], ctp_holes: [5], comp_bonus: 0, own_comps: [], created_at: '2025-10-26T00:00:00Z' },
  ],
  round_games: [{ id: 'ffffffff-0000-4000-8000-000000000001', group_id: GROUP, round_id: 'dddddddd-0000-4000-8000-000000000001', kind: 'skins', stake: 5, options: { net: true }, retired: false, created_at: now }],
  plans: [
    { id: PNOW, kind: 'trip', name: 'Hunter Weekend', status: 'confirmed', start_date: TODAY, end_date: day(2), location_name: 'Hunter Valley, NSW', trip_id: TNOW, proposed: false, organiser_id: K, created_by: K, created_at: now },
    { id: PPAST, kind: 'trip', name: 'Hunter 2025', status: 'done', start_date: PAST_START, end_date: '2025-10-26', location_name: 'Hunter Valley', trip_id: TPAST, proposed: false, organiser_id: K, created_by: K, budget_pp: 600, created_at: '2025-01-01T00:00:00Z' },
  ],
  plan_rsvps: [
    { plan_id: PPAST, player_id: K, status: 'in' }, { plan_id: PPAST, player_id: A, status: 'in' }, { plan_id: PPAST, player_id: B, status: 'out' },
    { plan_id: PNOW, player_id: K, status: 'in' },
  ],
  plan_items: [
    { id: 'i1', plan_id: PPAST, kind: 'job', title: 'Book the house', owner_id: A, done: true, sort: 0, created_at: now },
    { id: 'i2', plan_id: PPAST, kind: 'bring', title: 'Esky', owner_id: K, done: true, sort: 1, created_at: now },
  ],
  plan_polls: [], plan_options: [], plan_votes: [], plan_costs: [], plan_payments: [], plan_groups: [], plan_group_members: [], plan_transfers: [], plan_comments: [],
  tribunal_cases: [], tribunal_votes: [], rules: [], cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
  posts: [{ id: 'abababab-0000-4000-8000-000000000001', trip_id: TNOW, kind: 'user', body: 'Al in the dam', player_id: B, photo_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', created_at: now }],
  comments: [], reactions: [],
  dinner_awards: [], dinner_award_nominations: [], dinner_award_votes: [],
  group_features: feats(),
};

function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.')) { if (String(r[k]) !== v.slice(3)) return false; }
      else if (v === 'not.is.null') { if (r[k] == null) return false; }
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
    }
    return true;
  });
}
const writes = [];
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: true, player_id: K, group_name: 'Hunter Crew', group_id: GROUP, role: 'organiser', legacy: false, groups: [{ id: GROUP, name: 'Hunter Crew', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/functions/')) return json({ sent: 0 });
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || (db[table] = []);
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (method === 'GET') { const r = filterRows(rows, url.searchParams); return json(single ? r[0] || null : r); }
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    writes.push({ method, table, body, query: url.search });
    if (method === 'POST') {
      const made = [];
      const conflict = url.searchParams.get('on_conflict');
      for (const b of Array.isArray(body) ? body : [body]) {
        if (conflict) {
          const keys = conflict.split(',');
          const had = rows.find((r) => keys.every((k) => String(r[k]) === String(b[k])));
          if (had) { Object.assign(had, b); made.push(had); continue; }
        }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...(table === 'dinner_awards' ? { status: 'nominating' } : {}), ...b };
        rows.push(row);
        made.push(row);
      }
      return json(single ? made[0] : made, 201);
    }
    if (method === 'PATCH') {
      const hit = filterRows(rows, url.searchParams);
      for (const r of hit) Object.assign(r, body);
      return json(single ? hit[0] || null : hit, 200);
    }
    if (method === 'DELETE') {
      const hit = new Set(filterRows(rows, url.searchParams));
      db[table] = rows.filter((r) => !hit.has(r));
      return json([], 200);
    }
  }
  return json({});
}

// Open-Meteo, faked: 16 days from today. Day 0 cold morning (8°), day 1 wet (70%), day 2 windy.
const meteo = { forecast: 0, current: 0, geocode: 0 };
async function fakeMeteo(route) {
  const url = new URL(route.request().url());
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  if (url.host.startsWith('geocoding')) { meteo.geocode += 1; return json({ results: [{ name: 'Hunter Valley', admin1: 'New South Wales', latitude: -32.8, longitude: 151.3, country_code: 'AU' }] }); }
  if (url.searchParams.get('current')) {
    meteo.current += 1;
    return json({ current: { temperature_2m: 21.4, apparent_temperature: 20, precipitation: 0, weather_code: 2, wind_speed_10m: 18, wind_gusts_10m: 31, wind_direction_10m: 225 }, daily: { precipitation_probability_max: [20] } });
  }
  meteo.forecast += 1;
  const time = Array.from({ length: 16 }, (_, i) => day(i));
  return json({ daily: {
    time,
    weather_code: time.map((_, i) => [1, 61, 3][i] ?? 0),
    temperature_2m_max: time.map((_, i) => [19.6, 17.2, 24][i] ?? 22),
    temperature_2m_min: time.map((_, i) => [8.1, 11, 13][i] ?? 12),
    precipitation_probability_max: time.map((_, i) => [5, 70, 10][i] ?? 10),
    precipitation_sum: time.map(() => 0),
    wind_speed_10m_max: time.map((_, i) => [12, 15, 34][i] ?? 10),
    wind_gusts_10m_max: time.map((_, i) => [20, 25, 55][i] ?? 15),
    wind_direction_10m_dominant: time.map(() => 225),
  } });
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.route('https://api.open-meteo.com/**', fakeMeteo);
await ctx.route('https://geocoding-api.open-meteo.com/**', fakeMeteo);
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());
const noSideScroll = async (label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};

// 1. Leaderboard: "Today at Cypress Lakes" during the live round.
await page.goto(`${BASE}#/leaderboard`);
const chip = page.getByTestId('weather-chip');
await chip.waitFor({ timeout: 15000 });
const chipText = (await chip.innerText()).replace(/\s+/g, ' ');
check(chipText.includes('Today at Cypress Lakes') && chipText.includes('18 km/h SW, gusts 31') && chipText.includes('about a club into it'), `leaderboard weather chip: ${chipText}`);
check(chipText.includes('Weather data by Open-Meteo.com'), 'leaderboard chip credits Open-Meteo');
await page.screenshot({ path: `${SHOTS}/1-leaderboard.png`, fullPage: true });

// 2. The trip page: a forecast line per trip day, packing hints, credit; second visit uses the saved copy.
await page.goto(`${BASE}#/plan/${PNOW}?tab=details`);
await page.getByTestId('trip-weather').waitFor({ timeout: 15000 });
await page.getByTestId('weather-day').first().waitFor({ timeout: 10000 });
check(await page.getByTestId('weather-day').count() === 3, 'trip weather: one line for each of the 3 trip days');
const tw = (await page.getByTestId('trip-weather').innerText()).replace(/\s+/g, ' ');
check(tw.includes('Cypress Lakes') && tw.includes('20° / 8°') && tw.includes('70%'), `trip weather shows the course, max/min and rain (${tw.slice(0, 160)})`);
const hints = await page.getByTestId('weather-hints').innerText();
check(/jumper/.test(hints) && /wet-weather/.test(hints) && /knock-down/.test(hints), `packing hints: jumper, rain, wind (${hints.replace(/\n/g, ' | ')})`);
check(tw.includes('Weather data by Open-Meteo.com'), 'trip weather credits Open-Meteo');
await noSideScroll('trip page');
await page.screenshot({ path: `${SHOTS}/2-trip-weather.png`, fullPage: true });
const before = meteo.forecast;
await page.reload();
await page.getByTestId('weather-day').first().waitFor({ timeout: 15000 });
check(meteo.forecast === before && before === 1, `forecast fetched once, then the phone’s copy for the hour (fetches: ${meteo.forecast})`);

// 3. Same as last time on the past trip.
await page.goto(`${BASE}#/plan/${PPAST}`);
await page.getByRole('button', { name: /Same as last time/ }).click();
await page.getByTestId('repeat-sheet').waitFor({ timeout: 10000 });
await page.getByTestId('repeat-line').first().waitFor({ timeout: 10000 });
const lines = await page.getByTestId('repeat-line').allInnerTexts();
check(lines.some((l) => l.includes('Fri · Stableford at Cypress Lakes · CTP 3, 12 · LD 9 · Skins')), `confirm card: Friday’s round with its side comps and games (${lines.join(' / ')})`);
check(lines.some((l) => l.includes('Sun · Ambrose at The Vintage · CTP 5')), 'confirm card: Sunday’s Ambrose');
check(lines.some((l) => l.includes('Trophies: The BD Trophy')) && lines.some((l) => l.includes('1 job · 1 on the bring list')) && lines.some((l) => l.includes('Invited: Kurt, Al Blue')), 'confirm card: trophies, jobs and the crew who were in');
await page.screenshot({ path: `${SHOTS}/3-repeat-confirm.png`, fullPage: true });
await page.getByRole('button', { name: 'Make the trip idea' }).click();
await page.getByTestId('repeat-info').waitFor({ timeout: 15000 });
const made = db.plans.find((p) => p.repeat_of === PPAST);
check(made && made.start_date === '2026-10-23' && made.end_date === '2026-10-25' && made.status === 'planning' && made.proposed === false && made.location_name === 'Hunter Valley' && made.name === 'Hunter 2026',
  `new trip idea: Hunter 2026, Fri 23 – Sun 25 Oct 2026, Hunter Valley (${JSON.stringify(made && { n: made.name, s: made.start_date, e: made.end_date })})`);
check(made?.repeat_shape?.rounds?.length === 2 && made.repeat_shape.rounds[0].ctp_holes.join() === '3,12' && made.repeat_shape.rounds[0].games[0].kind === 'skins', 'the golf is kept as the shape (courses, formats, CTP holes, games)');
const items = db.plan_items.filter((i) => i.plan_id === made?.id);
check(items.length === 2 && items.every((i) => i.done === false && i.owner_id === null), 'jobs and bring list copied, not done, owners cleared');
check(db.posts.some((p) => p.link === `/plan/${made?.id}` && /Al Blue — you were in last time/.test(p.body)), 'feed post invites last time’s crew');
check((await page.getByTestId('repeat-info').innerText()).includes('Al Blue'), 'the new trip shows who from last time hasn’t replied');
await page.screenshot({ path: `${SHOTS}/4-repeat-made.png`, fullPage: true });

// 3b. "Set it up in the app" on the copied trip fills the rounds from last time, then puts the side comps and games back.
await page.getByRole('button', { name: /Set it up in the app/ }).click();
const selects = page.getByLabel('Course');
await selects.first().waitFor({ timeout: 10000 });
const picked = await selects.evaluateAll((els) => els.map((e) => e.value));
check(picked[0] === C1 && picked[1] === '' && picked[2] === C2, `set-up sheet: Friday Cypress Lakes, Saturday blank, Sunday The Vintage (${picked.join(', ')})`);
const formats = await page.getByLabel('Format').evaluateAll((els) => els.map((e) => e.value));
check(formats[0] === 'stableford' && formats[2] === 'ambrose', 'set-up sheet: formats from last time');
await page.screenshot({ path: `${SHOTS}/4b-setup.png`, fullPage: true });
await page.getByLabel(/Make it the current trip now/).uncheck(); // keep this weekend's trip current for the rest of the test
await page.getByRole('button', { name: /Set it up — 2 rounds/ }).click();
await page.waitForTimeout(1500);
const newTrip = db.plans.find((p) => p.id === made?.id)?.trip_id;
const newRounds = db.rounds.filter((r) => newTrip && r.trip_id === newTrip);
const fri = newRounds.find((r) => r.course_id === C1);
const sun = newRounds.find((r) => r.course_id === C2);
check(newRounds.length === 2 && fri?.ctp_holes?.join() === '3,12' && fri?.ld_holes?.join() === '9' && sun?.ctp_holes?.join() === '5', 'rounds made with last time’s CTP and LD holes');
check(db.round_games.some((g) => g.round_id === fri?.id && g.kind === 'skins' && Number(g.stake) === 5), 'Friday’s skins game copied');
check(db.trophies.some((t) => t.trip_id === newTrip && t.name === 'The BD Trophy'), 'plays for the same trophy');

// 4. Fines and dinner awards: add, nominate two, open voting, vote, close → winner and a feed post.
await page.goto(`${BASE}#/feed`);
await page.getByTestId('feed-dinner-link').click();
await page.getByTestId('add-award').waitFor({ timeout: 15000 });
await page.getByRole('button', { name: 'Hack of the day' }).click();
await page.getByRole('button', { name: 'Add the award' }).click();
await page.getByTestId('award-card').waitFor({ timeout: 10000 });
check(db.dinner_awards.length === 1 && db.dinner_awards[0].trip_id === TNOW && db.dinner_awards[0].title === 'Hack of the day', 'award added to the current trip');
for (const [who, why] of [['Al Blue', 'Three balls in the dam on 7'], ['Bo Red', '']]) {
  await page.getByRole('button', { name: '+ Nominate someone' }).click();
  await page.getByTestId('nominate-sheet').waitFor();
  await page.getByLabel('Who').selectOption({ label: who });
  if (why) await page.getByPlaceholder(/Three balls/).fill(why);
  if (who === 'Al Blue') await page.getByTestId('nominate-sheet').locator('select').nth(1).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Nominate', exact: true }).click();
  await page.getByTestId('nominate-sheet').waitFor({ state: 'detached', timeout: 10000 });
}
check(db.dinner_award_nominations.length === 2 && db.dinner_award_nominations[0].post_id === 'abababab-0000-4000-8000-000000000001', 'two nominations, one with a feed photo as evidence');
await page.getByRole('button', { name: 'Open the voting' }).click();
await page.getByRole('button', { name: 'Vote' }).first().waitFor({ timeout: 10000 });
check(db.dinner_awards[0].status === 'voting', 'organiser opens the voting');
// Bo votes for Al (another phone), then Kurt votes for Bo and changes to Al.
const [nAl, nBo] = db.dinner_award_nominations;
db.dinner_award_votes.push({ award_id: nAl.award_id, nomination_id: nAl.id, voter_id: B, group_id: GROUP, created_at: now, updated_at: now });
await page.getByTestId('nominee').filter({ hasText: 'Bo Red' }).getByRole('button', { name: 'Vote' }).click();
await page.getByRole('button', { name: '✓ Your vote' }).waitFor({ timeout: 10000 });
await page.getByTestId('nominee').filter({ hasText: 'Al Blue' }).getByRole('button', { name: 'Vote' }).click();
await page.getByTestId('nominee').filter({ hasText: 'Al Blue' }).getByRole('button', { name: '✓ Your vote' }).waitFor({ timeout: 10000 });
const kurtVotes = db.dinner_award_votes.filter((v) => v.voter_id === K);
check(kurtVotes.length === 1 && kurtVotes[0].nomination_id === nAl.id, 'one vote per person — changing it replaces it');
await page.screenshot({ path: `${SHOTS}/5-voting.png`, fullPage: true });
await page.getByRole('button', { name: 'Close the voting' }).click();
await page.getByTestId('award-result').waitFor({ timeout: 10000 });
const res = await page.getByTestId('award-result').innerText();
check(res.includes('Al Blue (2 votes)'), `winner shown: ${res}`);
check(db.posts.some((p) => p.link === `/dinner/${TNOW}` && p.body.includes('Hack of the day: Al Blue (2 votes)')), 'result posted to the Feed');
check(await page.getByRole('button', { name: /Share the results/ }).isVisible(), 'results picture button shown');
await noSideScroll('dinner awards');
await page.screenshot({ path: `${SHOTS}/6-decided.png`, fullPage: true });
// A tie shows as a tie.
db.dinner_awards.push({ id: 'aw-tie', trip_id: TNOW, title: 'Best excuse', kind: 'fine', penalty: 'buys the first round', status: 'closed', created_by: K, group_id: GROUP, created_at: now });
db.dinner_award_nominations.push({ id: 'nt1', award_id: 'aw-tie', player_id: A, nominated_by: K, created_at: '1' }, { id: 'nt2', award_id: 'aw-tie', player_id: B, nominated_by: K, created_at: '2' });
db.dinner_award_votes.push({ award_id: 'aw-tie', nomination_id: 'nt1', voter_id: K, updated_at: now }, { award_id: 'aw-tie', nomination_id: 'nt2', voter_id: A, updated_at: now });
await page.reload();
await page.getByText(/Tie — Al Blue & Bo Red \(1 vote each\) — fine: buys the first round/).waitFor({ timeout: 10000 }).then(() => check(true, 'a tie is shown as a tie'), () => check(false, 'a tie is shown as a tie'));

// 5. Switches off: hidden everywhere.
db.group_features = feats({ weather: false, dinner: false });
await page.goto(`${BASE}#/leaderboard`);
await page.reload();
await page.locator('.lb').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1200);
check(!(await page.getByTestId('weather-chip').isVisible().catch(() => false)), 'weather off: no chip on the leaderboard');
await page.goto(`${BASE}#/plan/${PNOW}?tab=details`);
await page.getByText('When').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
check(!(await page.getByTestId('trip-weather').isVisible().catch(() => false)), 'weather off: no forecast on the trip');
check(!(await page.getByTestId('dinner-link').isVisible().catch(() => false)), 'dinner awards off: no line on the trip page');
await page.goto(`${BASE}#/feed`);
await page.getByText('The Feed').first().waitFor({ timeout: 10000 });
await page.waitForTimeout(800);
check(!(await page.getByTestId('feed-dinner-link').isVisible().catch(() => false)), 'dinner awards off: no line on the Feed');
await page.goto(`${BASE}#/dinner/${TNOW}`);
check(await page.getByText(/switched off/).waitFor({ timeout: 10000 }).then(() => true, () => false), 'dinner awards off: /dinner says it’s switched off');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
