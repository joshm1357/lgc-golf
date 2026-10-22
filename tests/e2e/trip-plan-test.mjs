// The trip plan (Josh, 22 Oct): lock in → the usual jobs with due dates and locks → Allocate → shortlist and vote on
// where to stay → reserve with a total → the trip plan with a food plan → per person and a suggested deposit →
// set the deposit → players "Confirm and pay" → "I've paid" → the organiser ticks it off. The Next step card changes
// at every step. No real database: every request to Supabase is answered here, and writes change the fake rows.
// Usage: node tests/e2e/trip-plan-test.mjs <baseUrl> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4390/lgc-golf/';
const SHOTS = process.argv[3] || './shots';
fs.mkdirSync(SHOTS, { recursive: true });

const P1 = '11111111-1111-4111-8111-111111111111'; // Josh, organiser
const P2 = '22222222-2222-4222-8222-222222222222'; // Mike, keen
const P3 = '33333333-3333-4333-8333-333333333333'; // Adam, in
const P4 = '44444444-4444-4444-8444-444444444444'; // Sam, in
const PLAN = 'eeeeeeee-0000-4000-8000-000000000078';
const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000a';
const now = new Date().toISOString();
const later = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const START = later(120);
const END = new Date(Date.parse(START) + 2 * 864e5).toISOString().slice(0, 10);

const db = {
  players: [
    { id: P1, name: 'Josh M', nickname: 'Josh', handicap: 14, approved: true, created_at: now },
    { id: P2, name: 'Mike Morris', nickname: 'Mike', handicap: 18, approved: true, created_at: now },
    { id: P3, name: 'Adam H', nickname: 'Adam', handicap: 22, approved: true, created_at: now },
    { id: P4, name: 'Sam T', nickname: 'Sam', handicap: 9, approved: true, created_at: now },
  ],
  trips: [], trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], courses: [], rounds: [],
  round_players: [], scores: [], tribunal_cases: [], tribunal_votes: [], rules: [], comps: [], group_features: [], posts: [],
  plans: [{ id: PLAN, kind: 'trip', name: 'Autumn Trip', status: 'planning', start_date: START, end_date: END, location_name: 'Nowra', proposed: false, rsvp_locked: false, created_by: P1, organiser_id: P1, created_at: now }],
  plan_polls: [], plan_options: [], plan_votes: [], plan_comments: [], plan_items: [], plan_costs: [], plan_payments: [],
  plan_transfers: [], plan_groups: [], plan_group_members: [], notify_prefs: [], plan_stays: [], plan_budget_items: [],
  groups: [{ id: GROUP, vote_decider: 'admin' }],
  plan_rsvps: [[P1, 'in'], [P2, 'maybe'], [P3, 'in'], [P4, 'in']].map(([p, s]) => ({ plan_id: PLAN, player_id: p, status: s, updated_at: now })),
};

let who = P1; // who's signed in
const notes = []; // notifications asked for
let seq = 0;
const uid = () => `9${String(++seq).padStart(7, '0')}-0000-4000-8000-000000000000`;

function match(r, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'group_id' && r.group_id === undefined) continue;
    if (v.startsWith('eq.')) { if (String(r[k]) !== v.slice(3)) return false; }
    else if (v.startsWith('neq.')) { if (String(r[k]) === v.slice(4)) return false; }
    else if (v === 'is.null') { if (r[k] != null) return false; }
    else if (v === 'not.is.null') { if (r[k] == null) return false; }
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
  }
  return true;
}
const KEYS = { plan_rsvps: ['plan_id', 'player_id'], plan_votes: ['option_id', 'player_id'] };
function insertRow(table, b) {
  db[table] = db[table] || [];
  const keys = KEYS[table];
  const found = keys && db[table].find((r) => keys.every((k) => r[k] === b[k]));
  if (found) { Object.assign(found, b); return found; }
  const row = { id: b.id || uid(), created_at: new Date().toISOString(), ...b };
  if (table === 'plan_items') { row.stage = row.stage || (row.done ? 'done' : 'todo'); row.done = row.stage === 'done'; row.created_by = row.created_by || who; }
  if (table === 'plan_transfers') { row.confirmed = !!row.confirmed; row.created_by = who; }
  if (table === 'plan_stays') { row.created_by = who; row.chosen = false; row.option_id = null; }
  db[table].push(row);
  return row;
}
function updateRow(table, r, b) {
  Object.assign(r, b);
  if (table === 'plan_items' && 'stage' in b) r.done = r.stage === 'done';
}

function putStaysToVote() {
  const stays = db.plan_stays.filter((s) => s.plan_id === PLAN && !s.option_id);
  const poll = insertRow('plan_polls', { plan_id: PLAN, kind: 'other', purpose: 'stay', question: 'Where should we stay?', status: 'open', closes_on: later(5), created_by: who });
  for (const s of stays) s.option_id = insertRow('plan_options', { poll_id: poll.id, label: s.name, link: s.link, notes: `$${s.total_cost} total` }).id;
  for (const j of db.plan_items) if (j.formula_key === 'shortlist_stay') { j.stage = 'done'; j.done = true; }
  return { poll_id: poll.id, joined: false };
}

async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  if (url.pathname.startsWith('/functions/v1/notify')) { notes.push(body); return json({ sent: 1 }); }
  if (url.pathname.startsWith('/functions/')) return json({});
  if (url.pathname.startsWith('/rest/v1/rpc/my_status')) {
    const admin = who === P1;
    return json({ is_member: true, is_admin: admin, player_id: who, group_name: 'L.G.C', group_id: GROUP, role: admin ? 'organiser' : 'player', groups: [{ id: GROUP, name: 'L.G.C', slug: 'lgc', role: admin ? 'organiser' : 'player' }] });
  }
  if (url.pathname.endsWith('/rpc/put_stays_to_vote')) return json(putStaysToVote());
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(null);
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.split('/')[3];
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const rows = (db[table] || []).filter((r) => match(r, url.searchParams));
    if (method === 'GET' || method === 'HEAD') return json(single ? rows[0] || null : rows);
    if (method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]).map((b) => insertRow(table, b));
      return json(single ? list[0] : list, 201);
    }
    if (method === 'PATCH') { rows.forEach((r) => updateRow(table, r, body)); return json(single ? rows[0] || null : rows); }
    if (method === 'DELETE') { db[table] = (db[table] || []).filter((r) => !rows.includes(r)); return json(rows); }
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://luogyzvrbedmicjejilr.supabase.co/**', fake);
await ctx.addInitScript(([u]) => {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: u, aud: 'authenticated', role: 'authenticated', is_anonymous: true } }));
  try { localStorage.setItem('tgt-notify-prompt', String(Date.now())); localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */ } catch { /* fine */ }
}, ['99999999-9999-4999-8999-999999999999']);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const card = () => page.getByTestId('next-step');
const nextTitle = async () => (await card().innerText()).split('\n').filter(Boolean)[2] || '';
const waitNext = async (re, label) => {
  try { await card().getByText(re).first().waitFor({ timeout: 8000 }); check(true, `Next step: ${label}`); } catch { check(false, `Next step: ${label} (saw "${await nextTitle()}")`); }
};
const noSideScroll = async (label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const open = async (view = 'organise', tab = '') => {
  await page.goto(`${BASE}#/plan/${PLAN}?view=${view}${tab ? `&tab=${tab}` : ''}`);
  await page.reload(); // a hash-only change doesn't reload; start fresh like a phone opening the app
  await card().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
};
const sheet = () => page.locator('.sheet');

// 1. Deciding with dates: lock it in.
await open();
await waitNext(/Lock it in/, 'lock it in (dates are set)');
await shot('tp1-lock');
await card().getByRole('button', { name: 'Lock it in' }).click();
await waitNext(/Shortlist accommodation/, 'shortlist accommodation once locked in');
const jobs = db.plan_items.filter((j) => j.kind === 'job');
check(jobs.length === 8 && jobs.every((j) => j.formula_key && j.due !== undefined), `the formula made 8 jobs (${jobs.length})`);
const by = Object.fromEntries(jobs.map((j) => [j.formula_key, j]));
check(by.reserve_stay?.after_item === by.shortlist_stay?.id && by.chase_deposits?.after_item === by.deposit_ask?.id, 'jobs wait for the one before');
check(by.shortlist_stay?.due && by.shortlist_stay.due < START && by.teams_draw?.due < START, 'due dates counted back from the trip');

// 2. The Jobs tab: due dates, locks, Allocate.
await open('organise', 'jobs');
await page.getByTestId('job-row').first().waitFor({ timeout: 8000 });
check(await page.getByTestId('job-row').count() === 8, 'jobs tab lists the 8 jobs');
check(await page.getByText('after: Shortlist accommodation').first().isVisible(), 'locked jobs say what they wait for');
check(await page.getByText(/due \w{3} \d+/).first().isVisible(), 'jobs show due dates');
await shot('tp2-jobs');
await noSideScroll('jobs');
// Shortlist is the organiser's; hand it to Mike.
await page.getByTestId('job-row').filter({ hasText: 'Shortlist accommodation' }).first().getByRole('button').last().click();
await sheet().getByText('Allocate: Shortlist accommodation').waitFor({ timeout: 5000 });
await shot('tp3-allocate');
await sheet().getByRole('button', { name: /Mike/ }).click();
await page.waitForTimeout(600);
check(db.plan_items.find((j) => j.formula_key === 'shortlist_stay').owner_id === P2, 'allocated to Mike');
check(notes.some((n) => n.type === 'job_assigned' && n.item_id === by.shortlist_stay.id), 'Mike is notified (job_assigned)');
await waitNext(/Mike is on it/, 'organiser sees who it’s on');

// 3. Where to stay: search links, shortlist two places, put it to the group.
await open('organise');
await page.getByRole('button', { name: /Where to stay/ }).click();
await sheet().getByText('The shortlist', { exact: true }).waitFor({ timeout: 5000 });
const airbnb = await sheet().getByRole('link', { name: /Airbnb/ }).getAttribute('href');
check(airbnb.includes('Nowra') && airbnb.includes(`checkin=${START}`) && airbnb.includes('adults=3'), 'search links have the town, dates and headcount (ov23: the 3 who said they’re in, not the maybe)');
for (const [name, cost, sleeps] of [['Beach House', '2400', '12'], ['Farm Stay', '1800', '10']]) {
  await sheet().getByLabel('Name').fill(name);
  await sheet().getByLabel('Rough total $').fill(cost);
  await sheet().getByLabel('Sleeps').fill(sleeps);
  await sheet().getByRole('button', { name: 'Add to the shortlist' }).click();
  await sheet().getByText(name, { exact: true }).waitFor({ timeout: 5000 });
}
await shot('tp4-shortlist');
// Call the vote (080): the shortlist with tick boxes, then How it goes out.
await sheet().first().getByTestId('stays-call-vote').click();
await page.getByTestId('call-vote').waitFor({ timeout: 5000 });
check((await page.getByTestId('call-vote').locator('input[type=checkbox]').count()) === 2, 'Call the vote lists both places, ticked');
await page.getByTestId('call-the-vote').click();
await page.getByTestId('how-it-goes-out').waitFor({ timeout: 5000 });
check(true, 'after calling: How it goes out');
await page.getByRole('button', { name: 'Done', exact: true }).click();
await page.waitForTimeout(400);
const stayPoll = db.plan_polls.find((p) => p.purpose === 'stay');
check(!!stayPoll && db.plan_options.filter((o) => o.poll_id === stayPoll.id).length === 2, 'a vote with the two places');
check(notes.filter((n) => n.type === 'poll_open').length === 1, 'one vote notification');
await page.keyboard.press('Escape');
await waitNext(/Where should we stay\? vote/, 'the stay vote: the organiser sees the results step (080), not "Have your say"');

// The vote closes: Beach House wins.
stayPoll.status = 'closed';
stayPoll.winner_option_id = db.plan_options.find((o) => o.label === 'Beach House').id;
await open('organise');
await page.getByRole('button', { name: /Where to stay/ }).click();
await sheet().getByRole('button', { name: /Winner: Beach House/ }).click();
await page.waitForTimeout(700);
check(db.plan_stays.find((s) => s.name === 'Beach House').chosen, 'the winner is chosen');
check(Number(db.plan_items.find((j) => j.formula_key === 'reserve_stay').amount) === 2400, 'Reserve accommodation is pre-filled with the total');
await page.keyboard.press('Escape');
await waitNext(/Reserve accommodation/, 'reserve accommodation');

// 4. Reserve it with the total.
await card().getByRole('button', { name: 'Reserve it' }).click();
await sheet().getByLabel('Total cost of the accommodation $').waitFor({ timeout: 5000 });
check(await sheet().getByLabel('Total cost of the accommodation $').inputValue() === '2400', 'the total is filled in');
await shot('tp5-reserve');
await sheet().getByRole('button', { name: 'Done ✓' }).click();
await waitNext(/Set the deposit and ask everyone/, 'set the deposit');

// 5. The trip plan: food plan, per person, suggested deposit; set it and ask.
await card().getByRole('button', { name: 'Open the trip plan' }).click();
await sheet().getByRole('button', { name: 'Start the trip plan' }).click();
await sheet().getByText('Fri dinner — BBQ at the house').or(sheet().locator('input[value*="BBQ at the house"]')).first().waitFor({ timeout: 5000 }).catch(() => {});
check(await sheet().locator('input[value*="BBQ at the house"]').count() === 1, 'a basic food plan is filled in');
// 3 confirmed: accommodation 2400 + food (25+10+50+10) × 3 = 2685 → $895 each; deposit 2400 / 3 = $800.
check((await page.getByTestId('per-person').innerText()).includes('$895'), `cost per person ($895): ${(await page.getByTestId('per-person').innerText()).replace(/\n/g, ' ')}`);
check((await page.getByTestId('suggested-deposit').innerText()) === '$800', 'suggested deposit $800');
await shot('tp6-trip-plan');
await noSideScroll('trip plan');
await sheet().getByLabel('Deposit per person $').fill('150');
await sheet().getByLabel(/How to pay you/).fill('PayID 0400 000 000 — Josh');
await sheet().getByRole('button', { name: 'Ask everyone to confirm and pay' }).click();
await page.waitForTimeout(700);
const plan = db.plans[0];
check(Number(plan.deposit_pp) === 150 && !!plan.deposit_asked_at && plan.kitty_note.includes('PayID'), 'deposit set and asked');
check(notes.some((n) => n.type === 'deposit_ask'), 'everyone keen is notified');
check(db.plan_items.find((j) => j.formula_key === 'deposit_ask').stage === 'done' && !!db.plan_items.find((j) => j.formula_key === 'chase_deposits').due, 'ask job done; chase deposits due in a week');
await waitNext(/4 deposits to collect/, '4 deposits to collect');

// 6. Mike (keen): confirm and pay.
who = P2;
await open('overview');
await waitNext(/Confirm you’re in and pay your \$150 deposit/, 'Mike: confirm and pay');
await shot('tp7-player-pay');
await card().getByRole('button', { name: 'Confirm and pay' }).click();
check(await sheet().getByText('PayID 0400 000 000 — Josh').isVisible(), 'the organiser’s payment details are shown');
await shot('tp8-pay-sheet');
await sheet().getByRole('button', { name: 'I’ve paid $150' }).click();
await page.waitForTimeout(600);
check(db.plan_rsvps.find((r) => r.player_id === P2).status === 'in', 'Mike is now in');
check(db.plan_transfers.some((t) => t.from_id === P2 && !t.to_id && Number(t.amount) === 150 && !t.confirmed), 'his payment waits to be ticked off');
await waitNext(/Deposit sent/, 'Mike: waiting for the tick');

// 7. The organiser ticks it off — on Organise (ov14: organiser-only things never show on the Overview).
who = P1;
await page.goto(`${BASE}#/plan/${PLAN}?view=overview`);
await page.reload();
await page.getByTestId('overview-glance').waitFor({ timeout: 15000 });
check(!(await card().count()), 'the organiser’s Overview has no organiser Next step on it');
await open('organise');
check(await page.getByTestId('step-lockin').getAttribute('data-state') === 'current', 'deposits: the Lock in step is current');
await waitNext(/Tick off 1 deposit/, 'organiser: tick off 1 deposit');
await card().getByRole('button', { name: 'Check deposits' }).click();
await sheet().getByText('Confirmed, not paid yet').waitFor({ timeout: 5000 });
await shot('tp9-deposits');
await sheet().getByRole('button', { name: /Got \$150/ }).click();
await page.waitForTimeout(600);
check(db.plan_transfers.find((t) => t.from_id === P2).confirmed, 'payment confirmed');
await page.keyboard.press('Escape');
await waitNext(/3 deposits to collect/, '3 deposits left to collect');
await shot('tp10-after');
await noSideScroll('overview');

check(!errors.length, `no page errors (${errors.join(' | ')})`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
