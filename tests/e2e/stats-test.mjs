// Player stats and the season ladder — browser check, 21 Oct 2026. Fake database only.
// A made-up history: two trips (2025 and 2026), Stableford, stroke play, Ambrose and 4BBB rounds, a paper result and
// an engraved trophy. The expected numbers are the same ones worked out by hand in src/lib/stats.test.js.
// Usage: node stats-test.mjs <base> <shotDir>   e.g. http://localhost:4324/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4324/lgc-golf/';
const SHOTS = process.argv[3] || './shots-stats';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const A = '11111111-1111-4111-8111-111111111111'; // me: Acey
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const K = 'cccccccc-0000-4000-8000-000000000001';
const R = (n) => `dddddddd-0000-4000-8000-00000000000${n}`;
const now = '2026-10-21T08:00:00.000Z';
// Holes 1–4 par 3, 5–14 par 4, 15–18 par 5; stroke index = hole number.
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: i < 4 ? 3 : i < 14 ? 4 : 5, si: i + 1 }));
const scores = [];
const card = (round, subject, type, delta, over = {}) => {
  for (const h of holes) {
    const o = over[h.n];
    scores.push({ round_id: round, subject_id: subject, subject_type: type, hole: h.n, strokes: o === 'P' ? null : o ?? h.par + delta, picked_up: o === 'P', updated_at: now });
  }
};
card(R(1), A, 'player', 1); card(R(1), B, 'player', 0, { 18: 4 });
card(R(2), A, 'player', 1, { 1: 2 }); card(R(2), B, 'player', 0, { 5: 6 });
card(R(3), 'tx', 'team', 0); card(R(3), 'ty', 'team', 0, { 1: 4 });
card(R(4), A, 'player', 0, { 2: 'P' }); card(R(4), B, 'player', 0); card(R(4), C, 'player', 2); card(R(4), D, 'player', 2);
card(R(5), A, 'player', 2); card(R(5), B, 'player', 0);
const rp = (round, list) => list.map(([player_id, playing_handicap]) => ({ round_id: round, player_id, playing_handicap }));
const round = (n, trip, name, date, format) => ({ id: R(n), trip_id: trip, course_id: K, name, play_date: date, format, status: 'locked', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: `${date}T00:00:0${n}Z` });

const db = {
  players: [
    { id: A, name: 'Alan Ace', nickname: 'Acey', handicap: 18, approved: true, created_at: now },
    { id: B, name: 'Bob Birdie', nickname: null, handicap: 0, approved: true, created_at: now },
    { id: C, name: 'Cam Chip', nickname: null, handicap: 10, approved: true, created_at: now },
    { id: D, name: 'Dan Duff', nickname: null, handicap: 0, approved: true, created_at: now },
  ],
  trips: [
    { id: T1, name: 'Bowral 2025', start_date: '2025-03-01', end_date: '2025-03-02', status: 'locked', created_at: '2025-01-01T00:00:00Z' },
    { id: T2, name: 'Hunter 2026', start_date: '2026-05-10', end_date: '2026-05-12', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  ],
  trophies: [{ id: 'tr1', trip_id: T1, name: 'BD', type: 'stableford_total', created_at: now }, { id: 'tr2', trip_id: T2, name: 'BD', type: 'stableford_total', created_at: now }],
  courses: [{ id: K, name: 'Wollongong GC', holes, created_at: now }],
  rounds: [
    round(1, T1, 'Sat Stableford', '2025-03-01', 'stableford'),
    round(2, T1, 'Sun Stroke', '2025-03-02', 'stroke'),
    round(3, T1, 'Sun Ambrose', '2025-03-02', 'ambrose'),
    round(4, T2, 'Fri 4BBB', '2026-05-10', 'fourball'),
    round(5, T2, 'Sat Stableford', '2026-05-11', 'stableford'),
  ],
  teams: [
    { id: 'tx', round_id: R(3), name: 'Aces', handicap: 0, created_at: now }, { id: 'ty', round_id: R(3), name: 'Birdies', handicap: 0, created_at: now },
    { id: 'p1', round_id: R(4), name: 'Acey & Bob', handicap: 0, created_at: now }, { id: 'p2', round_id: R(4), name: 'Cam & Dan', handicap: 0, created_at: now },
  ],
  team_players: [
    { team_id: 'tx', player_id: A }, { team_id: 'tx', player_id: C }, { team_id: 'ty', player_id: B }, { team_id: 'ty', player_id: D },
    { team_id: 'p1', player_id: A }, { team_id: 'p1', player_id: B }, { team_id: 'p2', player_id: C }, { team_id: 'p2', player_id: D },
  ],
  round_players: [
    ...rp(R(1), [[A, 18], [B, 0]]), ...rp(R(2), [[A, 18], [B, 0]]),
    ...rp(R(4), [[A, 18], [B, 0], [C, 0], [D, 0]]), ...rp(R(5), [[A, 18], [B, 0], [C, 10]]),
  ],
  quick_results: [{ round_id: R(5), player_id: C, points: 30 }],
  honour_board: [{ id: 'h1', trophy_name: 'BD', label: 'Hunter 2026', winner_names: 'Alan Ace', player_ids: [A], trip_id: T2, sort_key: 10, imported: false, created_at: '2026-05-12T09:00:00Z' }],
  scores,
  season_settings: [],
  handicap_history: [], tribunal_cases: [], side_entries: [], round_pins: [], posts: [], rules: [], plans: [], plan_rsvps: [],
  plan_groups: [], plan_group_members: [], tribunal_votes: [], cup_sides: [], cup_matches: [],
  group_features: [{ group_id: GROUP, feature_key: 'trophies', enabled: true }],
};
let organiser = true;
const eqOf = (params, k) => { const v = params.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
    }
    return true;
  });
}
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: organiser, player_id: A, group_name: 'Hunter Weekend', group_id: GROUP, role: organiser ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = (db[table] ||= []);
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const conflict = url.searchParams.get('on_conflict');
        const old = conflict && rows.find((r) => r[conflict] === (b[conflict] ?? GROUP));
        if (old) { Object.assign(old, b); made.push(old); continue; }
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...b };
        rows.push(row);
        made.push(row);
      }
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
    }
    if (method === 'PATCH') {
      const id = eqOf(url.searchParams, 'id');
      const body = JSON.parse(req.postData() || '{}');
      for (const r of rows) if (r.id === id) Object.assign(r, body);
      return json([], 200);
    }
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const flat = (t) => t.replace(/\s+/g, ' ').trim();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
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

// 1. Acey's profile: the Stats card.
await page.goto(`${BASE}#/player/${A}`);
const statsCard = page.getByTestId('player-stats');
await statsCard.waitFor({ timeout: 15000 });
await page.getByTestId('plays-to').waitFor({ timeout: 15000 });
const pt = flat(await page.getByTestId('plays-to').innerText());
check(/Plays to 23\.3 vs handicap 18/.test(pt), `plays to 23.3 vs handicap 18 (${pt})`);
check(/5\.3 shots worse a round/.test(pt) && /averages 30\.7 pts/.test(pt), `5.3 worse, averages 30.7 pts (${pt})`);
const cardTxt = flat(await statsCard.innerText());
check(/\+5\.3 Avg net/.test(cardTxt), `avg net +5.3 (${cardTxt.slice(0, 120)})`);
check(/1 Trips won/.test(cardTxt), 'trips won 1');
check(/Best round: 38 pts \(net −2\) — Sun Stroke/.test(flat(await page.getByTestId('best-round').innerText())), 'best round: 38 pts, Sun Stroke');
check(/\+0\.9 Par 3s 15 played/.test(flat(await page.getByTestId('par-types').innerText())), 'par 3s +0.9 over 15');
check(/1 birdie /.test(cardTxt) && /17 pars/.test(cardTxt) && /18 doubles or worse/.test(cardTxt), 'birdies 1, pars 17, doubles 18');
check(/Best: 1 \(\+0\.5\) · 3 \(\+1\) · 4 \(\+1\)/.test(cardTxt) && /Worst: 2 \(\+1\.3\)/.test(cardTxt), 'best holes 1, 3, 4; worst 2');
check(/2 played · 2 won/.test(flat(await page.getByTestId('team-results').innerText())), 'team rounds: 2 played, 2 won');
await statsCard.screenshot({ path: `${SHOTS}/1-profile-stats.png` });
await page.screenshot({ path: `${SHOTS}/1b-profile-full.png`, fullPage: true });

// 2. The Stats screen: the 2026 ladder.
await page.goto(`${BASE}#/stats`);
await page.getByTestId('ladder').waitFor({ timeout: 15000 });
let rows = (await page.getByTestId('ladder-row').allInnerTexts()).map(flat);
check(rows.length === 3 && /^1 .*Acey .*11$/.test(rows[0]) && /^2 .*Bob Birdie .*10$/.test(rows[1]) && /^3 .*Cam Chip .*8$/.test(rows[2]), `2026: Acey 11 (trophy bonus), Bob 10, Cam 8 (${rows.join(' | ')})`);
check(/\+5 trophy/.test(rows[0]), 'Acey shows the trophy bonus');
await page.screenshot({ path: `${SHOTS}/2-ladder.png`, fullPage: true });
await page.getByRole('button', { name: '2025', exact: true }).click();
rows = (await page.getByTestId('ladder-row').allInnerTexts()).map(flat);
check(rows.length === 2 && /^T1 .*Acey .*18$/.test(rows[0]) && /^T1 .*Bob Birdie .*18$/.test(rows[1]), `2025: Acey and Bob share first on 18 (${rows.join(' | ')})`);

// 3. The organiser changes the points.
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByLabel('Points for 1st, 2nd, 3rd…').fill('12-9-7');
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(800);
check(JSON.stringify(db.season_settings[0]?.points) === '[12,9,7]' && db.season_settings[0]?.trophy_bonus === 5, `saved: points 12-9-7, bonus 5 (${JSON.stringify(db.season_settings)})`);
await page.getByTestId('ladder').waitFor();
rows = (await page.getByTestId('ladder-row').allInnerTexts()).map(flat);
check(/^1 .*Bob Birdie .*1 win 12$/.test(rows[0]) && /^2 .*Acey .*12$/.test(rows[1]) && /^3 .*Cam Chip .*9$/.test(rows[2]), `2026 with 12-9-7: Bob 12 (a win) ahead of Acey 12, Cam 9 (${rows.join(' | ')})`);

// 4. Records.
await page.getByRole('button', { name: 'Records' }).click();
await page.getByTestId('rec-best').waitFor({ timeout: 10000 });
const best = (await page.getByTestId('rec-best').locator('.lb-row').allInnerTexts()).map(flat);
check(/^1 .*Acey 2 Mar 2025 · Sun Stroke .*38 pts$/.test(best[0]) && /^2 .*Bob Birdie 1 Mar 2025 · Sat Stableford .*37 pts$/.test(best[1]) && /^T3 .*Bob Birdie/.test(best[2]) && /^T3 .*Acey/.test(best[3]), `best rounds: Acey 38, Bob 37 (${best.slice(0, 2).join(' | ')})`);
const trips = flat(await page.getByTestId('rec-trips').innerText());
check(/T1 .*Acey 1/.test(trips) && /T1 .*Bob Birdie 1/.test(trips), `trip wins: Acey 1, Bob 1 (${trips})`);
await page.screenshot({ path: `${SHOTS}/3-records.png`, fullPage: true });

// 5. Head-to-head: Acey v Bob.
await page.getByRole('button', { name: 'Head-to-head' }).click();
await page.getByLabel('Against').selectOption(B);
await page.getByTestId('h2h-score').waitFor();
check(flat(await page.getByTestId('h2h-score').innerText()) === '1 – 2', 'Acey 1 – 2 Bob');
const sum = flat(await page.getByTestId('h2h-summary').innerText());
check(/Bob Birdie leads/.test(sum) && /Bob Birdie by 5 a round/.test(sum), `Bob leads, by 5 a round (${sum})`);
const h2hRounds = (await page.getByTestId('h2h-rounds').locator('.lb-row').allInnerTexts()).map(flat);
check(/Sun Stroke .*net −2 v \+2 Acey by 4$/.test(h2hRounds[1]) && /Sat Stableford .*36 v 37 pts Bob Birdie by 1 pt$/.test(h2hRounds[2]), `round by round (${h2hRounds.join(' | ')})`);
const team = flat(await page.getByTestId('h2h-team').innerText());
check(/Acey 1 – 0 Bob Birdie/.test(team) && /As partners: 1 round, 1 won/.test(team), `team rounds and partners (${team})`);
await page.waitForTimeout(2500); // let the 'saved' toast go
await page.screenshot({ path: `${SHOTS}/4-h2h.png`, fullPage: true });

// 6. Linked from More and the Trophy Room.
await page.goto(`${BASE}#/more`);
await page.getByText('Stats & season ladder').waitFor({ timeout: 10000 });
check(true, 'More links to Stats');
await page.goto(`${BASE}#/trophies`);
check(await page.getByText('Season ladder, records & head-to-heads').waitFor({ timeout: 10000 }).then(() => true, () => false), 'the Trophy Room links to Stats');
await page.screenshot({ path: `${SHOTS}/5-trophy-room.png` });

// 7. Switched off: hidden everywhere.
db.group_features.push({ group_id: GROUP, feature_key: 'stats', enabled: false });
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('lgc-cache-features')) localStorage.removeItem(k); });
await page.goto(`${BASE}#/more`);
await page.reload();
await page.getByText('My profile').waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
check(!(await page.getByText('Stats & season ladder').isVisible().catch(() => false)), 'off: no Stats in More');
await page.goto(`${BASE}#/player/${A}`);
await page.getByText('Handicap history').waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
check(!(await page.getByTestId('player-stats').count()), 'off: no Stats card on the profile');
await page.goto(`${BASE}#/stats`);
check(await page.getByText('Player stats is switched off for this group.').waitFor({ timeout: 10000 }).then(() => true, () => false), 'off: /stats says it’s switched off');
await page.goto(`${BASE}#/trophies`);
await page.waitForTimeout(800);
check(!(await page.getByText('Season ladder, records & head-to-heads').isVisible().catch(() => false)), 'off: no link in the Trophy Room');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
