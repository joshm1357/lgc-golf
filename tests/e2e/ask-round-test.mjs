// ov43 — "Anyone keen for a round?" v2 end to end, on a phone (375 px) and a laptop. Fake database only: it does what
// migrations 103 + 111 do, with the same maths (src/lib/ask.js, src/lib/callout.js). Ask (and "Send to myself") →
// five players answer (one-tap, type it, a note, a swipe, can't) → the board leads "Sat … arvo · 4 can" → Choose →
// locked through 103's lock-in → the booker taps Full (moves to the next best) → It's booked → "Was that easy?" →
// the usual week fills the next ask. Usage: node tests/e2e/ask-round-test.mjs <base> [shotDir]
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as CO from '../../src/lib/callout.js';
import * as A from '../../src/lib/ask.js';

const BASE = process.argv[2] || 'http://localhost:4361/lgc-golf/';
const SHOTS = process.argv[3] || './shots-ask';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-000000000043';
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
  callout_answers: [], callout_guests: [], callout_events: [], player_usual_weeks: [], beta_feedback: [], course_booking_info: [], course_research: [], plan_groups: [], plan_group_members: [], plan_transfers: [], plan_comments: [], posts: [], comments: [], reactions: [], tee_groups: [],
  group_features: ['planner', 'planner_tasks', 'feed', 'notifications', 'games', 'trophies'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true }))
    .concat(['weather', 'ai_helper'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: false }))),
};
let me = { player_id: BO, is_admin: false, role: 'player' };
const notifies = [];
const startCalls = [];

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


// ---------------------------------------------------------------- what 111 does
const ev = (plan, kind, player = me.player_id) => db.callout_events.push({ plan_plan: plan, plan_id: plan, group_id: GROUP, player_id: player, kind, at: now() });
const canFor = (planId, date, from, to) => db.callout_answers.filter((a) => a.plan_id === planId && !a.cant && (a.slots || []).some((s) => A.overlaps(s, { date, from, to })))
  .sort((a, b) => a.first_at.localeCompare(b.first_at)).map((a) => a.player_id);
function putRoundAsk(a) {
  const id = crypto.randomUUID();
  const c = db.courses.find((x) => x.id === a.p_course);
  db.plans.push({ id, group_id: GROUP, kind: 'round', callout: true, name: 'Anyone keen for a round?', status: 'planning', proposed: false, created_by: me.player_id,
    organiser_id: me.player_id, start_date: null, end_date: null, tee_time: null, location_name: c?.name || null, course_id: a.p_course || null, spots: a.p_spots,
    closes_at: a.p_closes_at, brief: a.p_note, invite_all: !a.p_invite, extras: {}, ask: a.p_ask, ask_full: [], trip_id: null, round_id: null, created_at: now(),
    ask_token: Array.from({ length: 16 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[crypto.randomInt(31)]).join('') });
  for (const p of db.players) ev(id, 'asked', p.id);
  db.posts.push({ id: crypto.randomUUID(), group_id: GROUP, kind: 'user', player_id: me.player_id, body: '⛳ Anyone keen for a round? Tap the times you can play.', link: `/plan/${id}?c=1`, created_at: now() });
  return id;
}
function calloutAnswer(a) {
  const old = db.callout_answers.find((x) => x.plan_id === a.p_plan && x.player_id === me.player_id);
  const row = { plan_id: a.p_plan, player_id: me.player_id, group_id: GROUP, slots: a.p_cant ? [] : a.p_slots, cant: !!a.p_cant, where: a.p_where || {},
    first_at: a.p_cant ? null : old?.first_at || now(), updated_at: now() };
  if (old) Object.assign(old, row); else db.callout_answers.push(row);
  if (a.p_usual) { db.player_usual_weeks = db.player_usual_weeks.filter((u) => u.player_id !== me.player_id); db.player_usual_weeks.push({ player_id: me.player_id, group_id: GROUP, usual: a.p_usual, where: a.p_where || {} }); }
  ev(a.p_plan, 'opened'); ev(a.p_plan, 'replied');
  return { slots: row.slots.length, cant: row.cant };
}
function askChoose(a) {
  const p = db.plans.find((x) => x.id === a.p_plan);
  const poll = { id: crypto.randomUUID(), plan_id: p.id, group_id: GROUP, kind: 'dates', question: 'When can you play?', status: 'open', created_at: now() };
  db.plan_polls.push(poll);
  const opt = { id: crypto.randomUUID(), poll_id: poll.id, group_id: GROUP, label: 'chosen', start_date: a.p_date, end_date: a.p_date, part: a.p_part === 'early' ? 'morning' : a.p_part, tee_time: null, created_at: now() };
  db.plan_options.push(opt);
  for (const pid2 of canFor(p.id, a.p_date, a.p_from, a.p_to)) {
    const ans = db.callout_answers.find((x) => x.plan_id === p.id && x.player_id === pid2);
    db.plan_votes.push({ option_id: opt.id, poll_id: poll.id, player_id: pid2, response: 'yes', first_yes_at: ans.first_at, group_id: GROUP, updated_at: now() });
  }
  p.ask = { ...p.ask, chosen: { date: a.p_date, from: a.p_from, to: a.p_to, part: a.p_part } };
  const r = calloutLock({ p_plan: p.id, p_option: opt.id, p_tee_time: a.p_tee_time, p_course: a.p_course, p_booker: a.p_booker, p_format: a.p_format });
  ev(p.id, 'locked');
  return r;
}
function askMove(a) {
  const p = db.plans.find((x) => x.id === a.p_plan);
  const ch = p.ask.chosen;
  p.ask_full = [...(p.ask_full || []), `${ch.date}|${ch.part || `@${ch.from}`}`];
  const can = canFor(p.id, a.p_date, a.p_from, a.p_to);
  for (const r of db.plan_rsvps.filter((x) => x.plan_id === p.id)) if (!can.includes(r.player_id)) { r.status = 'out'; r.first_in_at = null; }
  for (const pid2 of can) {
    const ans = db.callout_answers.find((x) => x.plan_id === p.id && x.player_id === pid2);
    const r = db.plan_rsvps.find((x) => x.plan_id === p.id && x.player_id === pid2);
    if (r) Object.assign(r, { status: 'in', first_in_at: ans.first_at }); else db.plan_rsvps.push({ plan_id: p.id, player_id: pid2, status: 'in', first_in_at: ans.first_at, group_id: GROUP });
  }
  Object.assign(p, { start_date: a.p_date, end_date: a.p_date, tee_time: a.p_tee_time || a.p_from, ask: { ...p.ask, chosen: { date: a.p_date, from: a.p_from, to: a.p_to, part: a.p_part } } });
  const rd = db.rounds.find((x) => x.id === p.round_id); rd.play_date = a.p_date;
  sync(p.id);
  ev(p.id, 'moved');
  return {};
}


function askPublic(b, signedIn) {
  const p = db.plans.find((x) => x.ask_token === String(b.p_token).toUpperCase());
  if (!p) return { error: 'That link isn’t working — ask whoever sent it for a new one' };
  const g = b.p_key ? db.callout_guests.find((x) => x.plan_id === p.id && x.key === b.p_key) : null;
  const first = (id) => (db.players.find((x) => x.id === id)?.nickname || db.players.find((x) => x.id === id)?.name || '').split(' ')[0];
  const ans = db.callout_answers.filter((a) => a.plan_id === p.id);
  return { plan_id: p.id, group_id: GROUP, name: p.name, status: p.status, ask: p.ask, ask_full: p.ask_full || [], closes_at: p.closes_at, spots: p.spots,
    course: p.location_name, by: first(p.created_by), start_date: p.start_date, tee_time: p.tee_time, booked: !!p.booked_at, member: signedIn,
    voting: db.plan_polls.some((x) => x.plan_id === p.id && x.kind === 'dates'),
    answers: ans.map((a) => ({ player_id: a.player_id, name: first(a.player_id), slots: a.slots, cant: a.cant, first_at: a.first_at })),
    me: g ? { player_id: g.player_id, name: db.players.find((x) => x.id === g.player_id).name, claimed: false,
      answer: (() => { const a = ans.find((x) => x.player_id === g.player_id); return a ? { slots: a.slots, cant: a.cant, where: a.where } : null; })(), standing: null } : null };
}
function guestAnswer(b) {
  const p = db.plans.find((x) => x.ask_token === String(b.p_token).toUpperCase());
  let g = b.p_key ? db.callout_guests.find((x) => x.plan_id === p.id && x.key === b.p_key) : null;
  if (!g) {
    if (!b.p_name) return { error: 'Your name, please' };
    if (!b.p_email && !b.p_phone) return { error: 'Add an email or mobile so Bo can reach you' };
    const pl = { id: crypto.randomUUID(), group_id: GROUP, name: b.p_name, approved: false, created_at: now() };
    db.players.push(pl);
    g = { player_id: pl.id, plan_id: p.id, email: b.p_email, phone: b.p_phone, key: crypto.randomUUID() };
    db.callout_guests.push(g);
  }
  const old = db.callout_answers.find((x) => x.plan_id === p.id && x.player_id === g.player_id);
  const row = { plan_id: p.id, player_id: g.player_id, group_id: GROUP, slots: b.p_cant ? [] : b.p_slots, cant: !!b.p_cant, where: b.p_where || {}, first_at: old?.first_at || now(), updated_at: now() };
  if (old) Object.assign(old, row); else db.callout_answers.push(row);
  return { key: g.key, player_id: g.player_id, slots: row.slots.length };
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
    if (fn === 'put_round_ask') return json(putRoundAsk(body()));
    if (fn === 'ask_public') { const r = askPublic(body(), /Bearer [^ ]+\.[^ ]+\./.test(req.headers().authorization || '')); return r.error ? json({ message: r.error, code: 'P0001' }, 400) : json(r); }
    if (fn === 'ask_guest_answer') { const r = guestAnswer(body()); return r.error ? json({ message: r.error, code: 'P0001' }, 400) : json(r); }
    if (fn === 'ask_contacts') { const b = body(); return json(db.callout_guests.filter((g) => g.plan_id === b.p_plan).map((g) => ({ player_id: g.player_id, name: db.players.find((x) => x.id === g.player_id).name, email: g.email, phone: g.phone, signed_in: false }))); }
    if (fn === 'start_round_ask') { const b = body(); const id = putRoundAsk({ p_ask: b.p_ask, p_spots: b.p_spots, p_closes_at: b.p_closes_at }); startCalls.push(b); return json({ group_id: GROUP, plan_id: id, token: db.plans.find((x) => x.id === id).ask_token }); }
    if (fn === 'callout_answer') return json(calloutAnswer(body()));
    if (fn === 'callout_seen') { ev(body().p_plan, 'opened'); return json(null); }
    if (fn === 'callout_probably') { const b = body(); const answered = new Set(db.callout_answers.filter((x) => x.plan_id === b.p_plan).map((x) => x.player_id)); return json(db.player_usual_weeks.filter((u) => !answered.has(u.player_id)).map((u) => ({ player_id: u.player_id, pattern: u.usual.pattern }))); }
    if (fn === 'callout_ask_choose') return json(askChoose(body()));
    if (fn === 'callout_move') return json(askMove(body()));
    if (fn === 'callout_booked') { const p = db.plans.find((x) => x.id === body().p_plan); p.booked_at = now(); ev(p.id, 'booked'); return json(null); }
    if (fn === 'callout_easy') { const b = body(); ev(b.p_plan, b.p_easy ? 'easy_yes' : 'easy_no'); db.beta_feedback.push({ kind: b.p_easy ? 'like' : 'problem', message: `[Round ask] ${b.p_easy ? '👍' : '👎'} ${b.p_note || ''}` }); return json(null); }
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
const who = (id) => ({ player_id: id, is_admin: false, role: 'player' });
const today2 = CO.sydneyToday();
const cells = A.askCells({ days: ['thu', 'fri', 'sat', 'sun'], parts: [], range: { kind: 'next', days: 14 } }, today2);
const firstSat = cells.find((c) => CO.dowOf(c.date) === 6).date;
const satWord = CO.dayLabel(firstSat).split(' ').slice(0, 2).join(' '); // "Sat 14"
const cellBtn = (page, part) => page.getByTestId('ask-grid').getByRole('button', { name: new RegExp(`^${satWord} ${part}`) });

// 1. Bo asks: Thu–Sun, any time, next 2 weeks, Moore Park, 4.
await as(phone, BO_ME, '/plan');
await phone.getByTestId('put-round-out').waitFor({ timeout: 20000 });
await phone.getByTestId('put-round-out').click();
await phone.getByTestId('ask-form').waitFor();
check((await phone.getByTestId('co-kind-ask').getAttribute('aria-pressed')) === 'true', 'the sheet opens on “Ask when they can”');
await phone.getByTestId('ask-course').getByRole('button', { name: 'Moore Park' }).click();
check(/Thu, Fri, Sat, Sun · any time · next 2 weeks/.test(await phone.getByTestId('ask-summary').innerText()), 'the ask in one line: Thu, Fri, Sat, Sun · any time · next 2 weeks');
await phone.screenshot({ path: `${SHOTS}/1-ask.png`, fullPage: true });
// "Send to myself": the WhatsApp message and the grid, nothing saved.
await phone.getByTestId('ask-preview').click();
await phone.getByTestId('ask-preview-sheet').waitFor();
check(/anyone keen for a round\?/i.test(await phone.getByTestId('ask-wa-preview').innerText()), 'Send to myself: the WhatsApp preview');
await phone.getByTestId('ask-preview-sheet').getByTestId('ask-quick').getByRole('button', { name: 'Weekends only' }).click();
await phone.screenshot({ path: `${SHOTS}/2-send-to-myself.png`, fullPage: true });
await phone.getByTestId('ask-preview-sheet').getByTestId('ask-send').click();
check(db.callout_answers.length === 0 && db.plans.length === 0, 'the preview saves nothing');
check(!(await phone.getByTestId('ask-preview-sheet').isVisible().catch(() => false)), 'sending the preview closes it, back on the ask');
await phone.getByTestId('ask-go').click();
await phone.getByTestId('ask-reply').waitFor({ timeout: 15000 });
const plan = db.plans[0];
check(plan?.ask?.range?.kind === 'next' && plan.spots === 4 && plan.location_name === 'Moore Park', 'asked: the ask saved with 4 spots at Moore Park');
check(notifies.some((n) => n.plan_id === plan.id), 'the notify function is poked');

// 2. Bo answers: Weekends only.
await phone.getByTestId('ask-quick').getByRole('button', { name: 'Weekends only' }).click();
await phone.screenshot({ path: `${SHOTS}/3-grid-weekends.png`, fullPage: true });
await phone.getByTestId('ask-send').click();
await phone.getByTestId('ask-mine').waitFor();
check(db.callout_answers.find((a) => a.player_id === BO)?.slots.every((s) => [0, 6].includes(CO.dowOf(s.date))), 'Bo: weekends only');

// 3. Sam (laptop): types it.
await as(laptop, who(SAM), `/plan/${plan.id}`);
await laptop.getByTestId('ask-typed').fill('sat arvo, sun arvo');
await laptop.getByRole('button', { name: 'Fill' }).click();
check((await cellBtn(laptop, 'Arvo').getAttribute('aria-pressed')) === 'true' && (await cellBtn(laptop, 'Morning').getAttribute('aria-pressed')) === 'false', 'type it: “sat arvo, sun arvo” ticks the arvos only');
await laptop.getByTestId('ask-send').click();
await laptop.getByTestId('ask-mine').waitFor();
check(await laptop.getByTestId('ask-board').isVisible(), 'after sending, Sam sees who else is in');

// 4. Al (phone): all Saturdays, plus a note on the first Saturday arvo.
await as(phone, who(AL), `/plan/${plan.id}`);
await phone.getByTestId('ask-typed').fill('sat');
await phone.getByRole('button', { name: 'Fill' }).click();
await phone.getByTestId('ask-add-note').click();
await cellBtn(phone, 'Arvo').click();
await phone.getByTestId('ask-note-sheet').waitFor();
await phone.getByTestId('ask-note-input').fill('only after 1');
check(/tee off 1pm–3pm/.test(await phone.getByTestId('ask-note-read').innerText()), 'a note is read: “only after 1” → tee off 1pm–3pm');
await phone.screenshot({ path: `${SHOTS}/4-note.png`, fullPage: true });
await phone.getByTestId('ask-note-save').click();
await phone.getByTestId('ask-send').click();
await phone.getByTestId('ask-mine').waitFor();
const alSat = db.callout_answers.find((a) => a.player_id === AL).slots.find((s) => s.date === firstSat && s.part === 'arvo');
check(alSat?.from === '13:00' && alSat?.note === 'only after 1', 'Al’s Saturday arvo is narrowed to after 1pm, with the note');

// 5. Kurt (phone): swipes across the first Saturday, early → arvo.
await as(phone, who(KURT), `/plan/${plan.id}`);
await phone.getByTestId('ask-grid').waitFor();
const a1 = await cellBtn(phone, 'Early').boundingBox(); const a3 = await cellBtn(phone, 'Arvo').boundingBox();
await phone.mouse.move(a1.x + a1.width / 2, a1.y + a1.height / 2); await phone.mouse.down();
await phone.mouse.move(a1.x + a1.width * 1.5, a1.y + a1.height / 2, { steps: 4 });
await phone.mouse.move(a3.x + a3.width / 2, a3.y + a3.height / 2, { steps: 8 }); await phone.mouse.up();
const swiped = await Promise.all(['Early', 'Morning', 'Arvo'].map(async (p) => (await cellBtn(phone, p).getAttribute('aria-pressed')) === 'true'));
check(swiped.every(Boolean), `swipe ticks several (early, morning, arvo: ${swiped})`);
await phone.getByTestId('ask-send').click();
await phone.getByTestId('ask-mine').waitFor();

// 6. Dan: can't this round.
await as(phone, who(DAN), `/plan/${plan.id}`);
await phone.getByTestId('ask-cant').click();
await phone.getByTestId('ask-mine').waitFor();
check(db.callout_answers.find((a) => a.player_id === DAN)?.cant === true, 'Dan: can’t this round (once, no nagging)');

// 7. Bo's board: the leader and the course check.
await as(phone, BO_ME, `/plan/${plan.id}`);
await phone.getByTestId('ask-board').waitFor();
const lead = await phone.getByTestId('ask-leader').innerText();
check(new RegExp(`That’s a group[\\s\\S]*${satWord} arvo · 4 can`, 'i').test(lead), `leader: “${satWord} arvo · 4 can” and it’s a group (got ${lead.replace(/\n/g, ' ')})`);
check(/Not answered: Josh/.test(await phone.getByTestId('ask-noreply').innerText()), 'not answered: Josh; Dan can’t');
check(await phone.getByTestId('ask-funnel').isVisible(), 'the organiser sees the funnel');
await phone.screenshot({ path: `${SHOTS}/5-board.png`, fullPage: true });

// 8. Choose → lock in (103), Sam booking.
await phone.getByTestId('ask-choose').first().click();
await phone.getByTestId('ask-choose-tee').fill('13:20');
await phone.getByTestId('ask-booker').selectOption(SAM);
await phone.screenshot({ path: `${SHOTS}/6-choose.png`, fullPage: true });
await phone.getByTestId('ask-choose-go').click();
await phone.getByTestId('ask-booking').waitFor({ timeout: 15000 });
const locked = db.plans[0];
const rp = db.round_players.filter((x) => x.round_id === locked.round_id).map((x) => x.player_id);
check(locked.status === 'confirmed' && locked.start_date === firstSat && locked.tee_time === '13:20', 'locked: the first Saturday at 1:20pm');
check([BO, SAM, AL, KURT].every((x) => rp.includes(x)) && rp.length === 4, 'the round’s players: Bo, Sam, Al, Kurt (the 4 who could)');
await phone.screenshot({ path: `${SHOTS}/7-locked.png`, fullPage: true });

// 9. Sam (booking): Full → next best, then It's booked.
await as(phone, who(SAM), `/plan/${plan.id}`);
await phone.getByTestId('ask-full').waitFor();
const fullText = await phone.getByTestId('ask-full').innerText();
await phone.getByTestId('ask-full').click();
await phone.waitForTimeout(800);
check(db.plans[0].start_date !== firstSat || db.plans[0].ask.chosen.part !== 'arvo', `Full moves it to the next best (${fullText.replace(/\n/g, ' ')})`);
check(db.plans[0].ask_full.length === 1, 'the full time is remembered');
await phone.getByTestId('ask-booked').click();
await phone.waitForTimeout(800);
check(!!db.plans[0].booked_at, 'It’s booked');
await phone.screenshot({ path: `${SHOTS}/8-booked.png`, fullPage: true });

// 10. Bo: was that easy? 👍
await as(phone, BO_ME, `/plan/${plan.id}`);
await phone.getByTestId('ask-easy-yes').click();
await phone.getByRole('textbox', { name: '' }).last().fill('two minutes, start to finish').catch(() => {});
await phone.getByTestId('ask-easy-send').click();
await phone.waitForTimeout(600);
check(db.beta_feedback.some((f) => f.kind === 'like'), '“Was that easy?” 👍 goes to Caddie’s inbox');

// 11. The usual week fills the next ask (Sam).
me = BO_ME;
const id2 = putRoundAsk({ p_ask: { days: ['sat', 'sun'], parts: [], range: { kind: 'next', days: 14 }, times: [] }, p_spots: 4, p_closes_at: new Date(Date.now() + 86400000).toISOString() });
await as(phone, who(SAM), `/plan/${id2}`);
await phone.getByTestId('ask-prefilled').waitFor({ timeout: 10000 }).catch(() => {});
check(await phone.getByTestId('ask-prefilled').isVisible().catch(() => false), 'next time: “Filled in from your usual week”');
check((await cellBtn(phone, 'Arvo').getAttribute('aria-pressed')) === 'true', 'the usual week ticks Saturday arvo again');
await phone.screenshot({ path: `${SHOTS}/9-usual-week.png`, fullPage: true });

// 12. Feature switch: notes off for the group → no hint, no notes.
db.group_features.push({ group_id: GROUP, feature_key: 'ask_notes', enabled: false });
await as(phone, who(SAM), `/plan/${id2}`);
await phone.getByTestId('ask-grid').waitFor();
check(!(await phone.getByTestId('ask-hint').isVisible().catch(() => false)), 'switch: notes off hides the note hint');

// 13. The ask's own link on a phone that has never used the app: straight onto the grid — no "Who are you?", no sign-in.
me = BO_ME;
const id3 = putRoundAsk({ p_ask: { days: ['sat', 'sun'], parts: [], range: { kind: 'next', days: 14 }, times: [] }, p_spots: 4, p_course: COURSE, p_closes_at: new Date(Date.now() + 86400000).toISOString() });
const tok3 = db.plans.find((x) => x.id === id3).ask_token;
const fresh = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://*.supabase.co/**', fake);
  await ctx.addInitScript(() => { localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-first-open', JSON.stringify({ done: true })); });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => fails.push(`page error (guest): ${e}`)); return pg;
})();
await fresh.goto(`${BASE}#/a/${tok3}`);
await fresh.getByTestId('ask-public').waitFor({ timeout: 20000 });
check(/Bo: anyone keen for a round\?/.test(await fresh.getByTestId('ask-public').innerText()), 'link: opens on the ask (“Bo: anyone keen for a round?”), no group, no sign-in');
check(!(await fresh.getByText(/Who are you/i).isVisible().catch(() => false)), 'link: no “Who are you?”');
await fresh.getByTestId('ask-public-name').fill('Pete');
await fresh.getByTestId('ask-quick').getByRole('button', { name: 'Weekends only' }).click();
await fresh.getByTestId('ask-send').click();
await fresh.waitForTimeout(600);
check(!db.callout_answers.some((a) => a.plan_id === id3), 'link: no email or mobile → not sent (asks for one)');
await fresh.getByTestId('ask-public-contact').fill('pete@example.com');
await fresh.screenshot({ path: `${SHOTS}/10-link-answer.png`, fullPage: true });
await fresh.getByTestId('ask-send').click();
await fresh.getByTestId('ask-public-mine').waitFor({ timeout: 10000 });
const pete = db.callout_guests.find((g) => g.plan_id === id3);
check(pete?.email === 'pete@example.com' && db.callout_answers.some((a) => a.plan_id === id3 && a.player_id === pete.player_id && a.slots.length > 0), 'link: Pete answered with his email');
check(await fresh.getByTestId('ask-public-signin').isVisible(), 'link: then the nudge to sign in (buzz when it’s locked in)');
check(await fresh.getByTestId('ask-public-board').isVisible(), 'link: after answering he sees who can make what');
await fresh.screenshot({ path: `${SHOTS}/11-link-sent.png`, fullPage: true });
await fresh.reload();
await fresh.getByTestId('ask-public-mine').waitFor({ timeout: 10000 });
check(/Pete/.test(await fresh.getByTestId('ask-public-mine').innerText()), 'link: this phone remembers his answer (he can change it)');

// 14. Bo sees how to reach him.
await as(phone, BO_ME, `/plan/${id3}`);
await phone.getByTestId('ask-contacts').waitFor({ timeout: 10000 });
await phone.getByTestId('ask-contacts').locator('summary').click();
check(/pete@example\.com/.test(await phone.getByTestId('ask-contacts').innerText()), 'Bo: “Answered from the link” — Pete’s email');

// 15. No group needed: signed in, #/ask → make the link → straight to the ask with Share.
await as(laptop, who(JOSH), '/ask');
await laptop.goto(`${BASE}#/ask`);
await laptop.getByTestId('ask-start').waitFor({ timeout: 15000 });
await laptop.getByTestId('ask-start-name').fill('Josh');
await laptop.screenshot({ path: `${SHOTS}/12-ask-start.png`, fullPage: true });
await laptop.getByTestId('ask-start-go').click();
await laptop.waitForTimeout(1500);
check(startCalls.length === 1 && startCalls[0].p_my_name === 'Josh' && startCalls[0].p_ask?.range?.kind === 'next', 'no group: “Make the link” starts an ask as Josh');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
