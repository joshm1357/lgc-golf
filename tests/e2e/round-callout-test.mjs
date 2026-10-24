// ov34 — "Who's up for a hit?": put a round out, two players reply (phone + laptop), lock it in with a cap of 4 + a
// reserve, a pull-out moves the reserve up, and the round is in the app and opens for scoring. Fake database only.
// The fake does what 103's functions and triggers do, using the same maths (src/lib/callout.js): put_round_out,
// callout_lock, the reply-order stamps (first_in_at / first_yes_at) and the round following the In list.
// Usage: node tests/e2e/round-callout-test.mjs <base> [shotDir]   e.g. http://localhost:4361/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as CO from '../../src/lib/callout.js';

const BASE = process.argv[2] || 'http://localhost:4361/lgc-golf/';
const SHOTS = process.argv[3] || './shots-callout';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-000000000034';
const pid = (n) => `${String(n).padStart(8, '0')}-3434-4343-8343-343434343434`;
const BO = pid(1); const SAM = pid(2); const AL = pid(3); const KURT = pid(4); const DAN = pid(5); const JOSH = pid(6);
const COURSE = 'cccccccc-0000-4000-8000-000000000034';
const now = () => new Date().toISOString();
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: [4, 4, 3, 5][i % 4], si: ((i * 7) % 18) + 1 }));
const today = CO.sydneyToday();
const expected = CO.buildOptions({ days: ['fri'], part: 'arvo', range: 'next14' }, today).options;

const db = {
  players: [[BO, 'Bo Red', 'Bo', 12.4], [SAM, 'Sam Blue', 'Sam', 18], [AL, 'Al Green', 'Al', 20], [KURT, 'Kurt Dahl', 'Kurt', 3], [DAN, 'Dan Gold', 'Dan', 25], [JOSH, 'Josh M', 'Josh', 9]]
    .map(([id, name, nickname, handicap]) => ({ id, name, nickname, handicap, approved: true, group_id: GROUP, created_at: now() })),
  courses: [{ id: COURSE, group_id: GROUP, name: 'Moore Park', holes, created_at: now() }],
  trips: [], rounds: [], round_players: [], teams: [], team_players: [], trophies: [], quick_results: [], honour_board: [], scores: [],
  plans: [], plan_polls: [], plan_options: [], plan_votes: [], plan_rsvps: [], plan_invites: [], plan_items: [], plan_costs: [], plan_payments: [],
  plan_groups: [], plan_group_members: [], plan_transfers: [], plan_comments: [], posts: [], comments: [], reactions: [], tee_groups: [],
  group_features: ['planner', 'planner_tasks', 'feed', 'notifications', 'games', 'trophies'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true }))
    .concat(['weather', 'ai_helper'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: false }))),
};
let me = { player_id: BO, is_admin: false, role: 'player' };
const notifies = [];

// ---------------------------------------------------------------- what 103 does
function stampRsvp(row, old) {
  if (row.status === 'in') row.first_in_at = old && old.status === 'in' && old.first_in_at ? old.first_in_at : now();
  else row.first_in_at = null;
}
function stampVote(row, old) {
  if (row.response === 'yes') row.first_yes_at = old && old.response === 'yes' && old.first_yes_at ? old.first_yes_at : now();
  else row.first_yes_at = null;
}
function sync(planId) {
  const p = db.plans.find((x) => x.id === planId);
  if (!p?.callout || !p.round_id || p.status !== 'confirmed') return;
  const want = CO.rsvpSpots({ cap: p.spots, rsvps: db.plan_rsvps.filter((r) => r.plan_id === planId) }).in;
  db.round_players = db.round_players.filter((rp) => rp.round_id !== p.round_id || want.includes(rp.player_id));
  for (const id of want) {
    if (!db.round_players.some((rp) => rp.round_id === p.round_id && rp.player_id === id)) {
      db.round_players.push({ round_id: p.round_id, player_id: id, playing_handicap: Math.round(db.players.find((x) => x.id === id).handicap), group_id: GROUP });
    }
  }
}
function putRoundOut(a) {
  const id = crypto.randomUUID();
  const fixed = a.p_options.length === 1;
  const c = db.courses.find((x) => x.id === a.p_course);
  db.plans.push({
    id, group_id: GROUP, kind: 'round', callout: true, name: a.p_name, status: 'planning', proposed: false, created_by: me.player_id, organiser_id: me.player_id,
    start_date: fixed ? a.p_options[0].date : null, end_date: fixed ? a.p_options[0].date : null, tee_time: fixed ? a.p_options[0].tee_time : null,
    location_name: c?.name || a.p_course_name || null, course_id: a.p_course || null, spots: a.p_spots, closes_at: a.p_closes_at, brief: a.p_note,
    invite_all: !a.p_invite, extras: CO.cleanExtras(a.p_extras || {}), trip_id: null, round_id: null, created_at: now(),
  });
  if (a.p_invite) for (const p of new Set([...a.p_invite, me.player_id])) db.plan_invites.push({ plan_id: id, player_id: p, group_id: GROUP, created_at: now() });
  if (fixed) {
    const r = { plan_id: id, player_id: me.player_id, status: 'in', group_id: GROUP, updated_at: now() };
    stampRsvp(r, null); db.plan_rsvps.push(r);
  } else {
    const poll = { id: crypto.randomUUID(), plan_id: id, group_id: GROUP, kind: 'dates', question: 'When can you play?', status: 'open', created_by: me.player_id, created_at: now() };
    db.plan_polls.push(poll);
    for (const o of a.p_options) {
      const opt = { id: crypto.randomUUID(), poll_id: poll.id, group_id: GROUP, label: o.label, start_date: o.date, end_date: o.date, part: o.part, tee_time: o.tee_time, created_by: me.player_id, created_at: now() };
      db.plan_options.push(opt);
      const v = { option_id: opt.id, poll_id: poll.id, player_id: me.player_id, response: 'yes', group_id: GROUP, updated_at: now() };
      stampVote(v, null); db.plan_votes.push(v);
    }
  }
  if (!a.p_invite) db.posts.push({ id: crypto.randomUUID(), group_id: GROUP, kind: 'user', player_id: me.player_id, body: `⛳ Who’s up for a hit? ${a.p_name}. Say if you can.`, link: `/plan/${id}?c=1`, created_at: now() });
  return id;
}
function calloutLock(a) {
  const p = db.plans.find((x) => x.id === a.p_plan);
  if (!(me.is_admin || me.player_id === p.created_by)) return { error: 'Only whoever put it out (or an organiser) can lock it in' };
  const poll = db.plan_polls.find((x) => x.plan_id === p.id && x.kind === 'dates');
  let date = p.start_date; let tee = a.p_tee_time || p.tee_time;
  if (poll) {
    const o = db.plan_options.find((x) => x.id === a.p_option);
    date = o.start_date; tee = a.p_tee_time || o.tee_time;
    for (const v of db.plan_votes.filter((x) => x.option_id === o.id)) {
      const status = v.response === 'yes' ? 'in' : v.response === 'maybe' ? 'maybe' : 'out';
      const row = db.plan_rsvps.find((r) => r.plan_id === p.id && r.player_id === v.player_id);
      const next = { plan_id: p.id, player_id: v.player_id, status, first_in_at: status === 'in' ? v.first_yes_at : null, group_id: GROUP, updated_at: now() };
      if (row) Object.assign(row, next); else db.plan_rsvps.push(next);
    }
    poll.status = 'closed'; poll.winner_option_id = o.id;
  }
  const course = db.courses.find((c) => c.id === (a.p_course || p.course_id));
  const trip = { id: crypto.randomUUID(), group_id: GROUP, name: p.name, start_date: date, end_date: date, status: 'locked', made_by_lock_in: true, created_at: now() };
  db.trips.push(trip);
  const round = { id: crypto.randomUUID(), group_id: GROUP, trip_id: trip.id, course_id: course.id, name: `${p.name} — ${course.name}`, play_date: date, format: a.p_format || 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, own_comps: [], created_at: now() };
  db.rounds.push(round);
  Object.assign(p, { status: 'confirmed', start_date: date, end_date: date, tee_time: tee, booker_id: a.p_booker, course_id: course.id, location_name: course.name, trip_id: trip.id, round_id: round.id });
  sync(p.id);
  const s = CO.rsvpSpots({ cap: p.spots, rsvps: db.plan_rsvps.filter((r) => r.plan_id === p.id) });
  if (a.p_booker) db.plan_items.push({ id: crypto.randomUUID(), plan_id: p.id, group_id: GROUP, kind: 'job', title: `Book the tee time — ${course.name}`, owner_id: a.p_booker, done: false, stage: 'todo', created_at: now() });
  return { round_id: round.id, trip_id: trip.id, in: s.in, reserve: s.reserve };
}

// ---------------------------------------------------------------- the fake Supabase
const eqOf = (params, k) => { const v = params.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
function matches(r, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'group_id' && r.group_id === undefined) continue;
    if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
    if (v.startsWith('neq.') && String(r[k]) === v.slice(4)) return false;
    if (v === 'is.null' && r[k] != null) return false;
    if (v.startsWith('in.(')) { const ids = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!ids.includes(String(r[k]))) return false; }
  }
  return true;
}
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const single = (req.headers().accept || '').includes('vnd.pgrst.object');
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const p = url.pathname;
  const body = () => JSON.parse(req.postData() || '{}');
  if (p.startsWith('/functions/v1/notify')) { notifies.push(body()); return json({ sent: 3 }); }
  if (p.startsWith('/auth/v1/user')) return json({ id: '99999999-9999-4999-8999-999999999934', aud: 'authenticated', role: 'authenticated', is_anonymous: false, email: 'bo@example.com' });
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.split('/').pop();
    if (fn === 'my_status') return json({ is_member: true, signed_in: true, ...me, group_name: 'Inner West Hackers', group_id: GROUP, legacy: false, groups: [{ id: GROUP, name: 'Inner West Hackers', slug: 'iwh', role: me.role }] });
    if (fn === 'my_saved_status') return json({ saved: true, limited: true });
    if (fn === 'put_round_out') return json(putRoundOut(body()));
    if (fn === 'callout_lock') { const r = calloutLock(body()); return r.error ? json({ message: r.error, code: 'P0001' }, 400) : json(r); }
    if (fn === 'find_courses') return json([]);
    return json(null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    db[table] ||= [];
    if (method === 'GET') { const rows = db[table].filter((r) => matches(r, url.searchParams)); return json(single ? rows[0] || null : rows); }
    if (method === 'POST') {
      const conflict = url.searchParams.get('on_conflict');
      const out = [];
      for (const b of [].concat(body())) {
        const keys = conflict ? conflict.split(',') : null;
        const old = keys ? db[table].find((r) => keys.every((k) => String(r[k]) === String(b[k]))) : null;
        const row = old ? { ...old, ...b, updated_at: now() } : { id: crypto.randomUUID(), group_id: GROUP, created_at: now(), updated_at: now(), ...b };
        if (table === 'plan_rsvps') stampRsvp(row, old);
        if (table === 'plan_votes') stampVote(row, old);
        if (old) Object.assign(old, row); else db[table].push(row);
        out.push(old || row);
        if (table === 'plan_rsvps') sync(row.plan_id);
      }
      return json(single ? out[0] : out, 201);
    }
    if (method === 'PATCH') {
      const b = body();
      const rows = db[table].filter((r) => matches(r, url.searchParams));
      for (const r of rows) Object.assign(r, b);
      return json(single ? rows[0] || null : rows);
    }
    if (method === 'DELETE') { db[table] = db[table].filter((r) => !matches(r, url.searchParams)); return json([]); }
  }
  return json({});
}

// ---------------------------------------------------------------- the run
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
async function context(viewport, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.route('https://*.supabase.co/**', fake);
  await ctx.addInitScript(([uid]) => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated', is_anonymous: false })}.x`;
    if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
    localStorage.setItem('tgt-first-open', JSON.stringify({ done: true }));
  }, ['99999999-9999-4999-8999-999999999934']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e}`));
  return page;
}
const phone = await context({ width: 375, height: 812 }, true);
const laptop = await context({ width: 1280, height: 860 }, false);
const as = async (page, who, path) => { me = who; await page.goto(`${BASE}#${path}`); await page.reload(); };
const BO_ME = { player_id: BO, is_admin: false, role: 'player' };

// 1. Bo (a saved player, not an organiser) puts a round out from Trips: Moore Park, Fri arvo, next 2 weeks, 4 spots.
await as(phone, BO_ME, '/plan');
await phone.getByTestId('put-round-out').waitFor({ timeout: 20000 });
await phone.screenshot({ path: `${SHOTS}/1-trips-button.png`, fullPage: true });
await phone.getByTestId('put-round-out').click();
await phone.getByTestId('callout-sheet').waitFor();
await phone.getByTestId('co-courses').getByRole('button', { name: 'Moore Park' }).click();
await phone.getByTestId('co-days').getByRole('button', { name: 'Fri' }).click();
const optTexts = (await phone.getByTestId('co-option').allInnerTexts()).map((t) => t.replace('✕', '').trim());
check(JSON.stringify(optTexts) === JSON.stringify(expected.map((o) => o.label)), `the chips make the next two Friday arvos (got ${JSON.stringify(optTexts)}, want ${JSON.stringify(expected.map((o) => o.label))})`);
check((await phone.getByTestId('co-spots').getByRole('button', { name: '4' }).getAttribute('aria-pressed')) === 'true', 'spots: 4 by default, with a reserve list');
// The type-it box understands words too (then back to the chips).
await phone.getByTestId('co-typed').fill('sat or sun morning');
const typedOpts = (await phone.getByTestId('co-option').allInnerTexts()).map((t) => t.replace('✕', '').trim());
check(typedOpts.length === 2 && /Sat .* · morning/.test(typedOpts[0]) && /Sun .* · morning/.test(typedOpts[1]), `typed "sat or sun morning" → two mornings (got ${JSON.stringify(typedOpts)})`);
await phone.screenshot({ path: `${SHOTS}/2-sheet-typed.png`, fullPage: true });
await phone.getByTestId('co-typed').fill('');
await phone.getByTestId('co-note').fill('$65 green fee, carts optional');
await phone.screenshot({ path: `${SHOTS}/3-sheet.png`, fullPage: true });
await phone.getByTestId('co-send').click();
await phone.getByTestId('round-callout').waitFor({ timeout: 15000 });
const plan = db.plans[0];
check(plan && plan.callout && plan.spots === 4 && plan.course_id === COURSE && plan.invite_all && plan.brief === '$65 green fee, carts optional', 'put out: a call-out with 4 spots at Moore Park, whole group, the note');
check(db.plan_options.length === 2 && db.plan_votes.filter((v) => v.player_id === BO && v.response === 'yes').length === 2, 'two times to tick; Bo is ✓ on both');
check(notifies.some((n) => n.type === 'callout_send'), 'the notify function is poked to send the buzzes the database queued');
check(db.posts.some((x) => x.link === `/plan/${plan.id}?c=1`), 'a Feed post for the whole group');
check(await phone.getByTestId('co-tick').count() === 2, 'the round screen: two times to tick');
await phone.screenshot({ path: `${SHOTS}/4-round-screen-open.png`, fullPage: true });

// 2. Sam replies on the laptop: ✓ the first Friday.
await as(laptop, { player_id: SAM, is_admin: false, role: 'player' }, `/plan/${plan.id}`);
await laptop.getByTestId('co-tick').first().waitFor({ timeout: 20000 });
await laptop.getByTestId('co-tick').first().getByRole('button', { name: 'Can', exact: true }).click();
await laptop.waitForTimeout(600);
check(db.plan_votes.some((v) => v.player_id === SAM && v.option_id === db.plan_options[0].id && v.response === 'yes' && v.first_yes_at), 'laptop: Sam ✓ the first Friday (time stamped)');
await laptop.screenshot({ path: `${SHOTS}/5-laptop-sam-ticks.png`, fullPage: true });

// 3. Al replies from the Feed post on his phone.
await as(phone, { player_id: AL, is_admin: false, role: 'player' }, '/feed');
const feedCard = phone.getByTestId('callout-card').first();
await feedCard.waitFor({ timeout: 20000 });
await feedCard.getByTestId('co-tick').first().getByRole('button', { name: 'Can', exact: true }).click();
await phone.waitForTimeout(600);
check(db.plan_votes.some((v) => v.player_id === AL && v.option_id === db.plan_options[0].id && v.response === 'yes'), 'phone: Al ✓ from the Feed post');
await phone.screenshot({ path: `${SHOTS}/6-feed-reply.png`, fullPage: true });
// Kurt and Dan tick after them (straight into the database here).
for (const who of [KURT, DAN]) {
  await new Promise((r) => setTimeout(r, 15));
  const v = { option_id: db.plan_options[0].id, poll_id: db.plan_options[0].poll_id, player_id: who, response: 'yes', group_id: GROUP, updated_at: now() };
  stampVote(v, null); db.plan_votes.push(v);
}

// 4. Bo locks it in: the app suggests the first Friday; 1:20pm; Sam's booking. Cap 4 → Dan is reserve #1.
await as(phone, BO_ME, `/plan/${plan.id}`);
await phone.getByTestId('co-lock').waitFor({ timeout: 20000 });
check((await phone.getByTestId('co-lock').innerText()).includes(expected[0].label), `"Lock it in — ${expected[0].label}" (the most ✓)`);
await phone.getByTestId('co-lock').click();
await phone.getByTestId('co-lock-sheet').waitFor();
await phone.getByTestId('co-lock-tee').fill('13:20');
await phone.getByTestId('co-booker').selectOption(SAM);
const prev = (await phone.getByTestId('co-lock-preview').innerText()).replace(/\s+/g, ' ');
check(/In \(4 of 4\): Bo, Sam, Al, Kurt/.test(prev) && /#1 Dan/.test(prev), `preview: Bo, Sam, Al, Kurt in; Dan reserve #1 (got ${prev})`);
await phone.screenshot({ path: `${SHOTS}/7-lock-sheet.png`, fullPage: true });
await phone.getByTestId('co-lock-go').click();
await phone.getByTestId('co-locked').waitFor({ timeout: 15000 });
const round = db.rounds[0];
check(plan.status === 'confirmed' && plan.tee_time === '13:20' && plan.booker_id === SAM && round && round.course_id === COURSE && round.play_date === expected[0].date, 'locked: one round at Moore Park on the day, 1:20pm, Sam booking');
const rp = db.round_players.filter((x) => x.round_id === round.id).map((x) => x.player_id).sort();
check(JSON.stringify(rp) === JSON.stringify([BO, SAM, AL, KURT].sort()), 'the round’s players: the first 4 who could make it');
await phone.getByTestId('co-reserve').first().waitFor({ timeout: 10000 });
check((await phone.getByTestId('co-people').innerText()).includes('Dan') && (await phone.getByTestId('co-reserve').first().innerText()) === 'Reserve #1', 'the screen: Dan is Reserve #1');
await phone.screenshot({ path: `${SHOTS}/8-locked.png`, fullPage: true });

// 5. Al pulls out → Dan moves up.
await as(phone, { player_id: AL, is_admin: false, role: 'player' }, `/plan/${plan.id}`);
await phone.getByTestId('co-pull-out').waitFor({ timeout: 20000 });
await phone.getByTestId('co-pull-out').click();
await phone.getByTestId('confirm-sheet').waitFor();
check((await phone.getByTestId('confirm-sheet').innerText()).includes('Dan is first on the reserve list'), 'pull-out: "Dan is first on the reserve list and gets your spot"');
await phone.getByTestId('confirm-yes').click();
await phone.waitForTimeout(800);
const rp2 = db.round_players.filter((x) => x.round_id === round.id).map((x) => x.player_id).sort();
check(JSON.stringify(rp2) === JSON.stringify([BO, SAM, KURT, DAN].sort()), 'after the pull-out: Dan is in the round, Al is out');
check(notifies.filter((n) => n.type === 'callout_send').length >= 3, 'the pull-out pokes the notify function (Dan and Bo are told)');
check((await phone.getByTestId('co-standing').first().innerText()).includes('can’t make it'), 'Al sees he’s out');
await phone.screenshot({ path: `${SHOTS}/9-pulled-out.png`, fullPage: true });

// 6. The round is in the app and opens for scoring (Dan, now in, on his phone).
await as(phone, { player_id: DAN, is_admin: false, role: 'player' }, `/plan/${plan.id}`);
await phone.getByTestId('co-open-round').waitFor({ timeout: 20000 });
check((await phone.getByTestId('co-standing').first().innerText()).includes('You’re in'), 'Dan: “You’re in”');
await phone.getByTestId('co-open-round').click();
await phone.waitForURL(/#\/\?r=/, { timeout: 10000 });
check(phone.url().includes(`?r=${round.id}`), 'Open the round → its leaderboard');
await phone.screenshot({ path: `${SHOTS}/10-leaderboard.png`, fullPage: true });
await phone.goto(`${BASE}#/score/${round.id}`);
const dots = phone.locator('.holes');
check(await dots.waitFor({ timeout: 15000 }).then(() => true, () => false), 'score entry opens for the round');
check(/of 18/.test(await dots.getAttribute('aria-label') || ''), 'score entry: 18 holes at Moore Park');
await phone.screenshot({ path: `${SHOTS}/11-score.png` });

// 7. The laptop view of the locked round, and Home's coming-up card.
await as(laptop, BO_ME, `/plan/${plan.id}`);
await laptop.getByTestId('co-locked').waitFor({ timeout: 20000 });
await laptop.screenshot({ path: `${SHOTS}/12-laptop-locked.png`, fullPage: true });
await as(phone, BO_ME, '/plan');
await phone.getByTestId('callout-card').first().waitFor({ timeout: 20000 });
check(/locked in/i.test(await phone.getByTestId('callout-card').first().innerText()), 'Trips: the call-out card says Locked in');
await phone.screenshot({ path: `${SHOTS}/13-trips-card.png`, fullPage: true });

// 8. The old "⛳ One-day round" choice opens the new sheet.
await phone.getByRole('button', { name: /Suggest a trip or round/ }).first().click();
await phone.getByTestId('suggest-one-day-round').click();
check(await phone.getByTestId('callout-sheet').waitFor({ timeout: 10000 }).then(() => true, () => false), '“⛳ One-day round” in Suggest opens ⛳ Put a round out');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
