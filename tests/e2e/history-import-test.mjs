// "Import anything from past trips" browser check (22 Oct 2026). Fake database and a fake ai-helper whose reply has
// every kind: players, trips, winners, handicaps, rules, rounds (hole by hole and totals), a cup, awards and moments,
// a story and "other". Starts from a past trip's Overview ("Add history to this trip"), adds everything, checks
// what's written, runs it again (all "already in"), and looks at the trip's Overview and History afterwards.
// Usage: node history-import-test.mjs <base> <shotDir>   e.g. http://localhost:4381/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4381/lgc-golf/';
const SHOTS = process.argv[3] || './shots-history-import';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000d';
const DAVE = '11111111-1111-4111-8111-111111111111';
const KURT = '22222222-2222-4222-8222-222222222222';
const SAM = '33333333-3333-4333-8333-333333333333';
const KIAMA = '44444444-4444-4444-8444-444444444444';
const NOW = '55555555-5555-4555-8555-555555555555';
const C_KIAMA = '66666666-6666-4666-8666-666666666666';
const now = '2026-10-22T08:00:00.000Z';
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const SI = [7, 15, 3, 11, 1, 17, 9, 13, 5, 8, 16, 4, 12, 2, 18, 10, 14, 6];
const db = {
  players: [
    { id: DAVE, name: 'Dave Smith', nickname: 'Davo', handicap: 14, approved: true, created_at: now },
    { id: KURT, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 10, approved: true, created_at: now },
    { id: SAM, name: 'Sam Lee', nickname: null, handicap: 20, approved: true, created_at: now },
  ],
  trips: [
    { id: KIAMA, name: 'Kiama 2018', start_date: '2018-03-09', end_date: '2018-03-11', status: 'locked', created_at: now },
    { id: NOW, name: 'This weekend', start_date: '2026-10-21', end_date: '2026-10-25', status: 'active', created_at: now },
  ],
  courses: [{ id: C_KIAMA, name: 'Kiama Golf Club', holes: PARS.map((par, i) => ({ n: i + 1, par, si: SI[i] })), created_at: now }],
  trophies: [], honour_board: [], teams: [], team_players: [], quick_results: [], round_pins: [], round_players: [], scores: [], rounds: [],
  plans: [], plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [],
  rules: [], rule_votes: [], handicap_history: [], cup_sides: [], cup_matches: [], side_entries: [], side_comp_defs: [], side_comp_entries: [],
  history_notes: [], comps: [],
  group_features: ['feed', 'trophies', 'ai_helper'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
let organiser = true;
const rpcs = [];
const calls = [];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const normKey = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
      if (v.startsWith('in.(') && !v.slice(4, -1).split(',').includes(String(r[k]))) return false;
    }
    return true;
  });
}
// The two new functions, the way migration 081 does them (keys, "already in", strokes only on a real course).
function importRounds(rowsIn) {
  let added = 0; let already = 0; let skipped = 0; let made = 0;
  for (const r of rowsIn) {
    const trip = db.trips.find((t) => t.id === r.trip_id);
    if (!trip) throw new Error('A round on the list has no trip in this group');
    if (trip.status === 'active' && (trip.end_date || '9999') >= '2026-10-22') throw new Error(`${trip.name} is on now or coming up`);
    let course = db.courses.find((c) => c.id === r.course_id) || db.courses.find((c) => normKey(c.name) === normKey(r.course?.name));
    let real = true;
    if (!course) {
      real = !!r.course.holes;
      course = { id: crypto.randomUUID(), name: r.course.name, holes: r.course.holes || Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })), created_at: now };
      db.courses.push(course);
      made++;
    }
    const key = `${trip.id}|${normKey(course.name)}|${r.play_date || ''}|${normKey(r.name)}`;
    if (db.rounds.some((x) => x.import_key === key)) { already++; continue; }
    const round = { id: crypto.randomUUID(), trip_id: trip.id, course_id: course.id, name: r.name || course.name, play_date: r.play_date, format: r.format, status: 'locked', import_key: key, ld_holes: [], ctp_holes: [], own_comps: [], comp_bonus: 0, created_at: now };
    db.rounds.push(round);
    for (const p of r.players) {
      if (!db.players.some((x) => x.id === p.player_id)) { skipped++; continue; }
      db.round_players.push({ round_id: round.id, player_id: p.player_id, playing_handicap: Math.round(p.handicap ?? 18) });
      let wrote = false;
      if (real && p.strokes) p.strokes.forEach((s, i) => { if (s != null) { db.scores.push({ round_id: round.id, subject_id: p.player_id, subject_type: 'player', hole: i + 1, strokes: s, picked_up: false }); wrote = true; } });
      if (!wrote && r.format === 'stableford' && p.points != null) db.quick_results.push({ round_id: round.id, player_id: p.player_id, points: p.points });
    }
    if (r.summary) db.history_notes.push({ id: crypto.randomUUID(), group_id: GROUP, trip_id: trip.id, round_id: round.id, kind: 'scorecard', title: `Scorecard — ${round.name}`, body: r.summary, year: 2018, data: {}, import_key: `scorecard|${key}`, created_at: now });
    added++;
  }
  return { added, already, players_skipped: skipped, courses_made: made, round_ids: [] };
}
function importNotes(rowsIn) {
  let added = 0; let already = 0;
  for (const r of rowsIn) {
    const key = `${r.kind}|${r.trip_id || ''}|${normKey(r.title)}|${r.year || ''}|${normKey(r.body).slice(0, 60)}`;
    if (db.history_notes.some((x) => x.import_key === key)) { already++; continue; }
    db.history_notes.push({ id: crypto.randomUUID(), group_id: GROUP, ...r, import_key: key, created_at: now });
    added++;
  }
  return { added, already };
}

async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: organiser, player_id: DAVE, group_name: 'Kiama Crew', group_id: GROUP, role: organiser ? 'organiser' : 'player', legacy: false, groups: [{ id: GROUP, name: 'Kiama Crew', slug: 'kiama', role: 'organiser' }] });
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.split('/').pop();
    const body = JSON.parse(req.postData() || '{}');
    rpcs.push({ name, body });
    try {
      if (name === 'import_rounds') return json(importRounds(body.p_rows));
      if (name === 'import_history_notes') return json(importNotes(body.p_rows));
    } catch (e) { return json({ message: e.message, code: 'P0001' }, 400); }
    if (name === 'find_courses' || name === 'search_courses') return json([]);
    if (name === 'admin_create_player') {
      const id = crypto.randomUUID();
      db.players.push({ id, name: body.p_name, nickname: body.p_nickname, handicap: body.p_handicap, approved: true, created_at: now });
      return json(id);
    }
    if (name === 'import_honours') {
      let n = 0;
      for (const r of body.p_rows) {
        if (db.honour_board.some((h) => h.trophy_name === r.trophy && h.label === r.label && h.winner_names === r.winners)) continue;
        db.honour_board.push({ id: crypto.randomUUID(), trophy_name: r.trophy, label: r.label, winner_names: r.winners, player_ids: r.player_ids, trip_id: r.trip_id, imported: true, sort_key: 0, created_at: now });
        n++;
      }
      return json(n);
    }
    if (name === 'import_handicaps') return json(body.p_rows.length);
    if (name === 'import_rules') return json({ added: body.p_rows.length, proposed: 0, skipped: 0 });
    return json(null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const rows = db[table] || [];
    if (method === 'GET') return json(filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b };
        rows.push(row);
        made.push(row);
      }
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(made[0], 201);
      return json(url.searchParams.has('select') ? made : [], 201);
    }
    if (method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      const hit = filterRows(rows, url.searchParams);
      for (const r of hit) Object.assign(r, body);
      return json(hit, 200);
    }
    if (method === 'DELETE') {
      const hit = filterRows(rows, url.searchParams);
      db[table] = rows.filter((r) => !hit.includes(r));
      return json([], 200);
    }
    return json([], 200);
  }
  return json({});
}

const strokes = [5, 5, 2, 6, 0, 4, 1, 5, 6, 5, 4, 5, 6, 5, 4, 3, 6, 5].map((s) => (s === 0 ? null : s));
const PROPOSAL = {
  players: [{ name: 'Davo' }, { name: 'Bluey Blue', nickname: 'Bluey' }],
  trips: [{ name: 'Kiama 2018', year: 2018, place: 'Kiama', courses: ['Kiama Golf Club'], start_date: null, end_date: null }],
  winners: [{ trophy: 'The Kiama Plate', year: 2018, trip: 'Kiama 2018', winners: 'Kurt', score: '38 pts' }],
  handicaps: [{ player: 'Sam', date: '2018-03-01', handicap: 21 }],
  rules: [{ title: 'Pick up after a triple', wording: '', category: 'etiquette', value: null }],
  rounds: [
    { trip: null, year: 2018, date: '2018-03-10', course: 'Kiama GC', name: 'Day 1', format: 'stableford', pars: PARS, si: SI,
      players: [{ name: 'Davo', handicap: 14, strokes, gross: null, net: null, points: null }, { name: 'Kurt', handicap: 10, strokes: null, gross: 88, net: null, points: 38 }, { name: 'Bluey', handicap: null, strokes: null, gross: null, net: null, points: 31 }] },
    { trip: null, year: 2018, date: '2018-03-11', course: 'Jamberoo', name: 'Day 2', format: 'stableford', pars: null, si: null,
      players: [{ name: 'Sam', handicap: 20, strokes: null, gross: null, net: null, points: 33 }], guess: true },
  ],
  cups: [{ name: 'The Kiama Cup', year: 2018, trip: null, winner: 'Blue',
    sides: [{ name: 'Blue', players: ['Kurt', 'Davo'], points: 4.5 }, { name: 'Gold', players: ['Sam', 'Bluey'], points: 3.5 }],
    matches: [{ format: 'singles', a: ['Kurt'], b: ['Sam'], result: '3&2', winner: 'a', points: 1 }, { format: 'singles', a: ['Davo'], b: ['Bluey'], result: null, winner: 'halved', points: 1 }] }],
  awards: [
    { kind: 'moment', title: 'Hole-in-one', year: 2018, trip: null, date: '2018-03-10', winners: 'Davo', detail: null, hole: 7, course: 'Kiama' },
    { kind: 'side_comp', title: 'Closest to the pin', year: 2018, trip: null, date: null, winners: 'Kurt', detail: '1.2 m', hole: 16, course: null },
    { kind: 'fine', title: 'Late to the bus', year: 2018, trip: null, date: null, winners: 'Sam', detail: '$10', hole: null, course: null },
    { kind: 'award', title: 'Hack of the weekend', year: 2018, trip: null, date: null, winners: 'Bluey', detail: null, hole: null, course: null },
  ],
  stories: [{ kind: 'report', title: 'Kiama wrap', year: 2018, trip: null, date: null, body: 'Wild weekend. Davo aced the 7th and shouted the bar.\nKurt won the Plate by a street.' }],
  other: [{ title: 'The party bus', text: 'We hired a party bus in 2014 and swore never again.', year: 2014, trip: null }],
  unsure: ['Day 2’s course is hard to read — guessed Jamberoo'],
  dropped: 0,
};
async function fakeHelper(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: 'ok' });
  const body = JSON.parse(req.postData() || '{}');
  calls.push(body);
  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
  if (body.mode === 'import') return json({ import: PROPOSAL, found: 17, remaining: { month: 58, today: 9 }, log_id: 31 });
  return json({ error: 'Unknown request.' });
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.route('**/functions/v1/ai-helper', fakeHelper);
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
  localStorage.setItem('tgt-notify-prompt', String(Date.now()));
  localStorage.setItem('tgt-whats-new', 'beta-1');
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
page.on('dialog', (d) => d.accept());

// 1. The ways in: History, and a past trip's Overview.
await page.goto(`${BASE}#/history`);
await page.getByRole('link', { name: '📥 Add past trips, scorecards, cups…' }).waitFor({ timeout: 15000 });
check(true, 'History has "📥 Add past trips, scorecards, cups…"');
await page.goto(`${BASE}#/trip/${KIAMA}`);
const addHere = page.getByRole('link', { name: '📥 Add history to this trip' });
await addHere.waitFor({ timeout: 15000 });
check(true, 'a past trip’s Overview has "Add history to this trip"');
await addHere.click();
await page.getByText('Adding to Kiama 2018').waitFor({ timeout: 10000 });
check(page.url().includes(`trip=${KIAMA}`), 'it opens the import with the trip picked');

// 2. Read it.
await page.getByLabel('Paste your history').fill('Kiama 2018 scorecards, the cup, the awards and the wrap-up');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await page.getByLabel('Add photos').setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `card${i}.png`, mimeType: 'image/png', buffer: png })));
await page.getByAltText('Photo 6').waitFor({ timeout: 10000 });
check(true, 'six photos can be added (more than the old 4)');
await page.getByRole('button', { name: 'Read it' }).click();
await page.getByLabel('Not sure about').waitFor({ timeout: 15000 });
const sent = calls.at(-1);
check(sent.trip?.name === 'Kiama 2018' && sent.trip?.year === 2018 && sent.images.length === 6, 'sent: the trip it’s about and all six photos');

// 3. The review: grouped by kind, each new item on Kiama 2018, guesses flagged.
const titles = await page.locator('section[aria-label] strong').first().evaluateAll(() => [...document.querySelectorAll('section[aria-label]')].map((s) => s.getAttribute('aria-label')));
check(JSON.stringify(titles) === JSON.stringify(['Players', 'Past trips', 'Rounds & scorecards', 'Cups', 'Trophies & winners', 'Awards & moments', 'Stories', 'Rules', 'Past handicaps', 'Other']), `sections in order: ${titles.join(' · ')}`);
const txt = await page.locator('.page').innerText();
check(/Kiama GC · Day 1 · 2018-03-10 · 3 players, hole by hole/.test(txt) && /course: Kiama Golf Club/.test(txt), 'a hole-by-hole round, on the group’s Kiama Golf Club');
check(/Jamberoo · Day 2 · 2018-03-11 · 1 player/.test(txt) && /course from the library, or totals only/.test(txt), 'a totals-only round on a course that isn’t in the group');
check(/The Kiama Cup 2018 — Blue 4½ v Gold 3½ \(Blue won\)/.test(txt) && /Blue goes on the honour board/.test(txt), 'the cup, with its winner going on the honour board');
check(/Moment: Hole-in-one — Davo \(hole 7\)/.test(txt) && /Side comp: Closest to the pin — Kurt \(hole 16\)/.test(txt) && /Fine: Late to the bus — Sam/.test(txt) && /Award: Hack of the weekend — Bluey/.test(txt), 'awards, moments, fines and side comps');
check(/Kiama wrap · 2018/.test(txt) && /Davo aced the 7th/.test(txt), 'the story, with its text');
check(/The party bus · 2014/.test(txt), 'other');
const tripPick = page.getByLabel(/^Trip for Kiama GC · Day 1/);
check(await tripPick.inputValue() === KIAMA, 'the round is on Kiama 2018 (the trip it started from)');
check(await page.getByLabel(/^Trip for The party bus/).inputValue() === KIAMA, '…and so is everything else');
check(/⚠️ a guess/.test(txt) && !(await page.getByLabel(/^Add Jamberoo · Day 2/).isChecked()), 'the guessed round starts unticked with ⚠️ a guess');
check(await page.getByLabel(/^Add Kiama GC · Day 1/).isChecked(), 'the hole-by-hole round is ticked');
// The party bus was 2014: put it in the group's history (no trip).
await page.getByLabel(/^Trip for The party bus/).selectOption('');
check(await page.getByLabel(/^Trip for The party bus/).inputValue() === '', 'the organiser moves "other" off the trip');
// A round can't go on a trip that's on now.
await tripPick.selectOption(NOW);
check(await page.getByText('That trip is on now or coming up — pick a past one').isVisible(), 'a round on this weekend’s trip is refused before it’s sent');
check(await page.getByRole('button', { name: /^Add these/ }).isDisabled(), '…and Add these waits');
await tripPick.selectOption(KIAMA);
// Tick the guessed round after checking it.
await page.getByLabel(/^Add Jamberoo · Day 2/).check();
await page.screenshot({ path: `${SHOTS}/1-review.png`, fullPage: true });

// 4. Add these.
const addBtn = page.getByRole('button', { name: /^Add these \(\d+\)$/ });
await addBtn.click();
await page.getByText(/^✅ Added /).waitFor({ timeout: 15000 });
const done = await page.getByText(/^✅ Added /).innerText();
check(/2 rounds, 1 cup, 4 awards & moments, 1 story and 1 other/.test(done), `summary: ${done}`);
const rr = rpcs.find((r) => r.name === 'import_rounds').body.p_rows;
check(rr.length === 2 && rr[0].trip_id === KIAMA && rr[0].course_id === C_KIAMA && rr[0].players[0].player_id === DAVE && rr[0].players[0].strokes[6] === 1, 'round 1: on Kiama 2018, the group’s course, Davo’s card hole by hole');
check(rr[0].players[1].player_id === KURT && rr[0].players[1].points === 38 && /Kurt \(10\): 88 gross/.test(rr[0].summary), 'Kurt’s points kept; his gross goes in the scorecard note');
const bluey = db.players.find((x) => x.name === 'Bluey Blue');
check(bluey && rr[0].players.some((x) => x.player_id === bluey.id && x.points === 31), 'Bluey (a new player from the same import) gets his points');
check(rr[1].course?.name === 'Jamberoo' && rr[1].course.holes === null && rr[1].players[0].points === 33, 'round 2: a totals-only course (no card pars)');
check(rpcs.some((r) => r.name === 'find_courses' && r.body.p_query === 'Jamberoo'), 'the course library was asked about Jamberoo first');
const notesCalls = rpcs.filter((r) => r.name === 'import_history_notes').map((r) => r.body.p_rows);
const all = notesCalls.flat();
check(notesCalls.length === 4 && all.length === 7, `notes: 4 calls (cups, awards, stories, other), 7 notes (${all.length})`);
const cup = all.find((x) => x.kind === 'cup');
check(cup.trip_id === KIAMA && cup.data.sides.length === 2 && cup.data.matches.length === 2 && cup.player_ids.join() === [KURT, DAVE].join(), 'the cup: a note with sides, matches and the winners');
check(all.find((x) => x.kind === 'side_comp').data.hole === 16 && all.find((x) => x.kind === 'moment').happened_on === '2018-03-10', 'side comp hole and the moment’s date kept');
check(all.find((x) => x.kind === 'other').trip_id === null, '"other" went in the group’s history (no trip)');
const hon = rpcs.filter((r) => r.name === 'import_honours').flatMap((r) => r.body.p_rows);
check(hon.some((h) => h.trophy === 'The Kiama Cup' && h.label === 'Kiama 2018' && h.winners === 'Blue — Kurt & Davo'), 'the cup’s winners on the honour board');
check(!rpcs.some((r) => /cup_(sides|matches)/.test(r.name)) && db.cup_sides.length === 0 && db.cup_matches.length === 0, 'the live Cup tables aren’t touched');
check(db.trips.length === 2, 'no new trip made (Kiama 2018 was already there)');
await page.screenshot({ path: `${SHOTS}/2-done.png`, fullPage: true });

// 5. Safe to run twice.
await page.getByRole('button', { name: 'Bring in more' }).click();
await page.getByLabel('Paste your history').fill('Kiama 2018 again');
await page.getByRole('button', { name: 'Read it' }).click();
await page.getByLabel('Not sure about').waitFor({ timeout: 15000 });
await page.getByLabel(/^Trip for The party bus/).selectOption('');
const txt2 = await page.locator('.page').innerText();
const alreadyCount = (txt2.match(/already in/g) || []).length;
check(alreadyCount >= 8, `second time: rounds, cup, awards and story say "already in" (${alreadyCount})`);
check(!(await page.getByLabel(/^Add Kiama GC · Day 1/).isChecked()) && !(await page.getByLabel(/^Add The Kiama Cup/).isChecked()), 'second time: they start unticked');
const nRounds = db.rounds.length;
const nNotes = db.history_notes.length;
// Even ticked again on purpose, nothing doubles (the database's keys).
await page.getByLabel(/^Add Kiama GC · Day 1/).check();
await page.getByLabel(/^Add Moment: Hole-in-one/).check();
await page.getByRole('button', { name: /^Add these \(\d+\)$/ }).click();
await page.getByText(/^✅ /).waitFor({ timeout: 15000 });
check(db.rounds.length === nRounds && db.history_notes.length === nNotes, 'nothing added twice');
check(await page.getByText(/were already in — nothing added twice\./).isVisible(), 'and it says they were already in');

// 6. The trip's Overview and History afterwards.
await page.goto(`${BASE}#/trip/${KIAMA}`);
await page.getByLabel('From the history').waitFor({ timeout: 15000 });
const ov = await page.locator('.page').innerText();
check(/The Kiama Cup/.test(ov) && /Blue 4½/.test(ov) && /Kurt v Sam · 3&2/.test(ov), 'Overview: the cup with its score and matches');
check(/Hole-in-one — Davo/.test(ov) && /Kiama wrap/.test(ov) && /Scorecard — Day 1/.test(ov), 'Overview: moments, the story, and the scorecard note');
check(/Day 1/.test(ov) && /Day 2/.test(ov), 'Overview: the two rounds are on the trip');
check(!/The party bus/.test(ov), 'Overview: the group-history note isn’t on the trip');
await page.screenshot({ path: `${SHOTS}/3-trip-overview.png`, fullPage: true });
await page.goto(`${BASE}#/history`);
await page.getByLabel('Stories, cups and awards').waitFor({ timeout: 15000 });
const hist = await page.getByLabel('Stories, cups and awards').innerText();
check(/Kiama 2018/i.test(hist) && /The group/i.test(hist) && /The party bus/.test(hist), 'History: notes by trip, and the group’s own');
await page.screenshot({ path: `${SHOTS}/4-history.png`, fullPage: true });
// Remove one.
const before = db.history_notes.length;
await page.getByRole('button', { name: 'Remove The party bus' }).click();
await page.waitForTimeout(800);
check(db.history_notes.length === before - 1, 'an organiser can remove a note');

// 7. A player: sees the trip's history, no way to add.
organiser = false;
await page.goto(`${BASE}#/trip/${KIAMA}`);
await page.reload();
await page.getByLabel('From the history').waitFor({ timeout: 15000 });
await page.waitForTimeout(300);
check(!(await page.getByRole('link', { name: '📥 Add history to this trip' }).isVisible().catch(() => false)), 'a player sees the history but no "Add history"');
await page.screenshot({ path: `${SHOTS}/5-trip-overview-player.png`, fullPage: true });

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
