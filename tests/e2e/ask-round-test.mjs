// ov43 v2.1 — "Anyone keen for a round?" end to end (claude/round-ask-v2-1-rethink.md), on a phone (375 px) and a laptop. Fake database only: it does what
// migrations 103 + 111 + 112 do, with the same maths (src/lib/ask.js, src/lib/callout.js). Ask (every day, any time, 4 weeks,
// no group size; "Send to myself") → five players answer (the Caddie box, taps on "your week", a date exception, a swipe,
// can't) → the board leads "Sat … arvo · 4 can → one tee time" → Choose →
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
const fills = [];
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
const canFor = (planId, date, from, to) => db.callout_answers.filter((a) => a.plan_id === planId && !a.cant && (a.slots || []).some((s) => !s.maybe && A.overlaps(s, { date, from, to })))
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
  if (p.startsWith('/functions/v1/ask-fill')) {
    const b = body(); fills.push(b);
    const d21 = A.askCells(db.plans.find((x) => x.ask_token === b.token).ask, CO.sydneyToday()).map((c) => c.date).find((d) => d.endsWith('-21')) || null;
    return json({ fill: { week: [{ day: 'any', part: 'arvo', status: 'yes' }, { day: 'sun', part: 'any', status: 'yes' }], dates: d21 ? [{ date: d21, part: 'any', status: 'no' }] : [],
      notes: [{ day: 'sun', part: 'morning', note: 'home by 12' }], where: { from: [{ place: 'Ryde', days: ['sat', 'sun'], max_drive_min: 45 }], avoid: ['Moore Park'], note: 'anywhere east' },
      said: 'Any arvo, Sundays (home by 12), not the 21st.' }, remaining: { you: 4, ask: 59 } });
  }
  if (p.startsWith('/auth/v1/user')) return json({ id: '99999999-9999-4999-8999-999999999934', aud: 'authenticated', role: 'authenticated', is_anonymous: false, email: 'bo@example.com' });
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.split('/').pop();
    if (fn === 'my_status') return json({ is_member: true, signed_in: true, ...me, group_name: 'Inner West Hackers', group_id: GROUP, legacy: false, groups: [{ id: GROUP, name: 'Inner West Hackers', slug: 'iwh', role: me.role }] });
    if (fn === 'my_saved_status') return json({ saved: true, limited: true });
    if (fn === 'put_round_out') return json(putRoundOut(body()));
    if (fn === 'callout_lock') { const r = calloutLock(body()); return r.error ? json({ message: r.error, code: 'P0001' }, 400) : json(r); }
    if (fn === 'find_courses') return json([]);
    if (fn === 'ask_places' || fn === 'trip_finder_places') return json([{ area: 'Leichhardt NSW', lat: -33.88, lng: 151.16, courses: 1 }]);
    if (fn === 'ask_courses_near') return json([{ id: 'l1', name: 'Marrickville', area: 'Marrickville', lat: -33.92, lng: 151.16, holes: 18, km: 4.6 }, { id: 'l2', name: 'Bonnie Doon', area: 'Pagewood', lat: -33.94, lng: 151.22, holes: 18, km: 9 }]);
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
const cells = A.askCells(A.DEFAULT_ASK, today2);
const sats = [...new Set(cells.filter((c) => CO.dowOf(c.date) === 6).map((c) => c.date))];
const [firstSat, secondSat] = sats;
const word = (d) => CO.dayLabel(d).split(' ').slice(0, 2).join(' '); // "Sat 14"
const wsq = (page, day, part) => page.getByTestId('ask-grid').getByRole('button', { name: new RegExp(`^${day}s ${part}:`) });
const dsq = (page, d, part) => page.getByTestId('ask-dates').getByRole('button', { name: new RegExp(`^${word(d)} ${part}:`) });
const stateOf = async (loc) => { const l = await loc.getAttribute('aria-label'); return /: can’t/.test(l) ? 'n' : /: can/.test(l) ? 'y' : '?'; };

// 1. Bo asks: the defaults are every day, any time, next 4 weeks — and no group size.
await as(phone, BO_ME, '/plan');
await phone.getByTestId('put-round-out').waitFor({ timeout: 20000 });
await phone.getByTestId('put-round-out').click();
await phone.getByTestId('ask-form').waitFor();
check((await phone.getByTestId('co-kind-ask').getAttribute('aria-pressed')) === 'true', 'the sheet opens on “Ask when they can”');
const summary1 = await phone.getByTestId('ask-summary').innerText();
check(/Any day · any time · next 4 weeks/.test(summary1), `defaults: Any day · any time · next 4 weeks (got ${summary1})`);
check(!(await phone.getByText('Group size').isVisible().catch(() => false)), 'no group size asked up front');
check((await phone.getByTestId('ask-days').getByRole('button').count()) === 8, 'all 7 day chips (+ Every day)');
await phone.getByTestId('ask-more').locator('summary').first().click();
check(await phone.getByTestId('ask-max').isVisible(), 'max players is optional, under More');
await phone.getByTestId('ask-course').getByRole('button', { name: 'Moore Park' }).click();
await phone.screenshot({ path: `${SHOTS}/1-ask.png`, fullPage: true });
// "Send to myself": the WhatsApp message and the reply screen, nothing saved.
await phone.getByTestId('ask-preview').click();
await phone.getByTestId('ask-preview-sheet').waitFor();
check(/anyone keen for a round\?/i.test(await phone.getByTestId('ask-wa-preview').innerText()), 'Send to myself: the WhatsApp preview');
const pv = phone.getByTestId('ask-preview-sheet');
check(/Applies to every week/.test(await pv.getByTestId('ask-span').innerText()), 'the reply opens on “your week — applies to every week …”');
await pv.getByTestId('ask-caddie-text').fill('weekends only');
await pv.getByTestId('ask-caddie-go').click();
await pv.getByTestId('ask-filled').waitFor();
await phone.screenshot({ path: `${SHOTS}/2-send-to-myself.png`, fullPage: true });
await pv.getByTestId('ask-send').click();
check(db.callout_answers.length === 0 && db.plans.length === 0, 'the preview saves nothing');
await phone.getByTestId('ask-go').click();
await phone.getByTestId('ask-reply').waitFor({ timeout: 15000 });
const plan = db.plans[0];
check(plan?.ask?.range?.days === 28 && !plan.ask.days.length && !plan.ask.parts.length && plan.spots == null && plan.location_name === 'Moore Park', 'asked: every day, any time, 4 weeks, no max, Moore Park');
check(notifies.some((n) => n.plan_id === plan.id), 'the notify function is poked');

// 2. Bo answers with the Caddie box: "weekends only" (read on the phone, no AI).
await phone.getByTestId('ask-caddie-text').fill('weekends only');
await phone.getByTestId('ask-caddie-go').click();
await phone.getByTestId('ask-filled').waitFor();
check(fills.length === 0, 'an easy phrase fills on the phone (no AI)');
check(await stateOf(wsq(phone, 'Sat', 'Arvo')) === 'y' && await stateOf(wsq(phone, 'Wed', 'Arvo')) === 'n', '“weekends only”: Saturdays ✓, Wednesdays ✗');
await phone.screenshot({ path: `${SHOTS}/3-caddie-weekends.png`, fullPage: true });
await phone.getByTestId('ask-send').click();
await phone.getByTestId('ask-mine').waitFor();
const boA = db.callout_answers.find((a) => a.player_id === BO);
check(boA?.slots.length > 0 && boA.slots.every((s) => [0, 6].includes(CO.dowOf(s.date)) && !s.maybe), 'Bo: weekends only, all ✓');

// 3. Sam (laptop): taps Sat arvo and Sun arvo on his week, then “Everything else ✗”.
await as(laptop, who(SAM), `/plan/${plan.id}`);
await wsq(laptop, 'Sat', 'Arvo').waitFor({ timeout: 15000 });
check(await stateOf(wsq(laptop, 'Mon', 'Early')) === '?', 'every square starts ?');
await wsq(laptop, 'Sat', 'Arvo').click();
await wsq(laptop, 'Sun', 'Arvo').click();
check(await stateOf(wsq(laptop, 'Sat', 'Arvo')) === 'y', 'one tap: ? → ✓');
await laptop.getByTestId('ask-else-no').click();
check(await stateOf(wsq(laptop, 'Mon', 'Early')) === 'n' && await stateOf(wsq(laptop, 'Sat', 'Arvo')) === 'y', '“Everything else ✗” leaves the ✓ alone');
await laptop.getByTestId('ask-send').click();
await laptop.getByTestId('ask-mine').waitFor();
const samA = db.callout_answers.find((a) => a.player_id === SAM);
check(samA.slots.every((s) => s.part === 'arvo' && [0, 6].includes(CO.dowOf(s.date)) && !s.maybe), 'Sam: Sat and Sun arvos only');
check(await laptop.getByTestId('ask-board').isVisible(), 'after sending, Sam sees who else is in');

// 4. Al (phone): all Saturdays (tap the row), then one date off — the first Saturday arvo.
await as(phone, who(AL), `/plan/${plan.id}`);
await phone.getByTestId('ask-grid').waitFor();
await phone.getByTestId('ask-grid').getByRole('button', { name: 'Sats', exact: true }).click();
check(await stateOf(wsq(phone, 'Sat', 'Early')) === 'y' && await stateOf(wsq(phone, 'Sat', 'Twilight')) === 'y', 'tap a day: the whole row ✓');
await phone.getByTestId('ask-show-dates').click();
await phone.getByTestId('ask-dates').waitFor();
check(await stateOf(dsq(phone, secondSat, 'Arvo')) === 'y', 'the dates are filled in from your week');
await dsq(phone, firstSat, 'Arvo').click(); // ✓ → ✗
check(await stateOf(dsq(phone, firstSat, 'Arvo')) === 'n' && /ex/.test(await dsq(phone, firstSat, 'Arvo').getAttribute('class')), 'a date changed from the week is an exception (marked)');
check(/1 changed/.test(await phone.getByTestId('ask-show-dates').innerText()), '“Show the dates” says how many are changed');
await phone.screenshot({ path: `${SHOTS}/4-dates-exception.png`, fullPage: true });
await phone.getByTestId('ask-send').click();
await phone.getByTestId('ask-mine').waitFor();
const alA = db.callout_answers.find((a) => a.player_id === AL);
check(!alA.slots.some((s) => s.date === firstSat && s.part === 'arvo') && alA.slots.some((s) => s.date === secondSat && s.part === 'arvo' && !s.maybe), 'Al: Saturdays except the first Saturday arvo');
check(alA.slots.some((s) => s.maybe) && alA.slots.filter((s) => s.maybe).every((s) => CO.dowOf(s.date) !== 6), 'Al: the rest went as “maybe” (?)');

// 5. Kurt (phone): swipes across Saturday, early → arvo.
await as(phone, who(KURT), `/plan/${plan.id}`);
await phone.getByTestId('ask-grid').waitFor();
await phone.waitForTimeout(1200); // let the screen settle (it re-renders once the answers load)
await wsq(phone, 'Sat', 'Early').scrollIntoViewIfNeeded();
const a1 = await wsq(phone, 'Sat', 'Early').boundingBox(); const a3 = await wsq(phone, 'Sat', 'Arvo').boundingBox();
await phone.mouse.move(a1.x + a1.width / 2, a1.y + a1.height / 2); await phone.mouse.down();
await phone.mouse.move(a1.x + a1.width * 1.5, a1.y + a1.height / 2, { steps: 4 });
await phone.mouse.move(a3.x + a3.width / 2, a3.y + a3.height / 2, { steps: 8 }); await phone.mouse.up();
const swiped = await Promise.all(['Early', 'Morning', 'Arvo'].map((p) => stateOf(wsq(phone, 'Sat', p))));
check(swiped.every((x) => x === 'y'), `swipe paints several (early, morning, arvo: ${swiped})`);
await phone.getByTestId('ask-send').click();
await phone.getByTestId('ask-mine').waitFor();

// 6. Dan: can't this round.
await as(phone, who(DAN), `/plan/${plan.id}`);
await phone.getByTestId('ask-cant').click();
await phone.getByTestId('ask-mine').waitFor();
check(db.callout_answers.find((a) => a.player_id === DAN)?.cant === true, 'Dan: can’t this round (once, no nagging)');

// 7. Bo's board: the second Saturday arvo is the first time a 4-ball can play; said in tee times.
await as(phone, BO_ME, `/plan/${plan.id}`);
await phone.getByTestId('ask-board').waitFor();
const lead = await phone.getByTestId('ask-leader').innerText();
check(new RegExp(`A 4-ball can play[\\s\\S]*${word(secondSat)} arvo · 4 can[\\s\\S]*4 can → one tee time`, 'i').test(lead), `leader: “${word(secondSat)} arvo · 4 can → one tee time” (got ${lead.replace(/\n/g, ' ')})`);
const top5 = A.rankCells(A.askCells(plan.ask, today2), db.callout_answers.filter((a) => a.plan_id === plan.id)).filter((r) => r.can.length || r.maybe.length).slice(0, 5);
check(top5.some((r) => r.maybe.length) === /maybe/.test(await phone.getByTestId('ask-board').innerText()) && top5[0].maybe.length === 0, 'the board shows maybes separately (never counted as can)');
check(/Not answered: Josh/.test(await phone.getByTestId('ask-noreply').innerText()), 'not answered: Josh; Dan can’t');
check(await phone.getByTestId('ask-funnel').isVisible(), 'the organiser sees the funnel');
await phone.screenshot({ path: `${SHOTS}/5-board.png`, fullPage: true });

// 8. Choose → lock in (103), Sam booking.
await phone.getByTestId('ask-choose').first().click();
await phone.getByTestId('ask-choose-tee').fill('13:20');
await phone.getByTestId('ask-booker').selectOption(SAM);
await phone.getByTestId('ask-choose-go').click();
await phone.getByTestId('ask-booking').waitFor({ timeout: 15000 });
const locked = db.plans[0];
const rp = db.round_players.filter((x) => x.round_id === locked.round_id).map((x) => x.player_id);
check(locked.status === 'confirmed' && locked.start_date === secondSat && locked.tee_time === '13:20', 'locked: the second Saturday at 1:20pm');
check([BO, SAM, AL, KURT].every((x) => rp.includes(x)) && rp.length === 4, 'the round’s players: Bo, Sam, Al, Kurt (the 4 who ✓)');
await phone.screenshot({ path: `${SHOTS}/6-locked.png`, fullPage: true });

// 9. Sam (booking): Full → next best, then It's booked.
await as(phone, who(SAM), `/plan/${plan.id}`);
await phone.getByTestId('ask-full').waitFor();
await phone.getByTestId('ask-full').click();
await phone.waitForTimeout(800);
check(db.plans[0].ask_full.length === 1 && (db.plans[0].start_date !== secondSat || db.plans[0].ask.chosen.part !== 'arvo'), 'Full moves it to the next best, and remembers the full time');
await phone.getByTestId('ask-booked').click();
await phone.waitForTimeout(800);
check(!!db.plans[0].booked_at, 'It’s booked');

// 10. Bo: was that easy? 👍
await as(phone, BO_ME, `/plan/${plan.id}`);
await phone.getByTestId('ask-easy-yes').click();
await phone.getByTestId('ask-easy-send').click();
await phone.waitForTimeout(600);
check(db.beta_feedback.some((f) => f.kind === 'like'), '“Was that easy?” 👍 goes to Caddie’s inbox');

// 11. The usual week fills the next ask (Sam) — exactly his first view.
me = BO_ME;
const id2 = putRoundAsk({ p_ask: { days: ['sat', 'sun'], parts: [], range: { kind: 'next', days: 14 }, times: [] }, p_spots: null, p_closes_at: new Date(Date.now() + 86400000).toISOString() });
await as(phone, who(SAM), `/plan/${id2}`);
await phone.getByTestId('ask-prefilled').waitFor({ timeout: 10000 }).catch(() => {});
check(await phone.getByTestId('ask-prefilled').isVisible().catch(() => false), 'next time: “Filled in from your usual week”');
check(await stateOf(wsq(phone, 'Sat', 'Arvo')) === 'y' && await stateOf(wsq(phone, 'Sat', 'Early')) === 'n', 'the usual week: Sat arvo ✓, Sat early ✗ (as he left it)');
await phone.screenshot({ path: `${SHOTS}/7-usual-week.png`, fullPage: true });

// 12. Feature switch: Where off for the group → no Where box.
db.group_features.push({ group_id: GROUP, feature_key: 'ask_where', enabled: false });
await as(phone, who(SAM), `/plan/${id2}`);
await phone.getByTestId('ask-grid').waitFor();
check(!(await phone.getByTestId('ask-where').isVisible().catch(() => false)), 'switch: Where off hides the Where box');
db.group_features = db.group_features.filter((f) => f.feature_key !== 'ask_where');

// 13. The ask's own link on a fresh phone: straight onto the reply — the Caddie (AI) fills it, Where with a suburb.
me = BO_ME;
const id3 = putRoundAsk({ p_ask: A.DEFAULT_ASK, p_spots: null, p_course: COURSE, p_closes_at: new Date(Date.now() + 86400000).toISOString() });
const tok3 = db.plans.find((x) => x.id === id3).ask_token;
const fresh = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://*.supabase.co/**', fake);
  await ctx.addInitScript(() => { localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-first-open', JSON.stringify({ done: true })); });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => fails.push(`page error (guest): ${e}`)); return pg;
})();
await fresh.goto(`${BASE}#/a/${tok3}`);
await fresh.getByTestId('ask-public').waitFor({ timeout: 20000 });
check(/Bo: anyone keen for a round\?/.test(await fresh.getByTestId('ask-public').innerText()), 'link: opens on the ask, no group, no sign-in');
check(await fresh.getByTestId('ask-caddie').isVisible(), 'link: the Caddie box is there too');
await fresh.getByTestId('ask-caddie-text').fill('any arvo except the 21st, Sundays home by 12, from Ryde on weekends, not Moore Park again');
await fresh.getByTestId('ask-caddie-go').click();
await fresh.getByTestId('ask-filled').waitFor({ timeout: 10000 });
check(fills.length === 1 && fills[0].token === tok3 && /^[a-z0-9]{18}$/.test(fills[0].device || ''), 'link: messy words go to the AI, with the link token and this phone’s id');
check(/Any arvo, Sundays/.test(await fresh.getByTestId('ask-filled').innerText()), 'link: the Caddie says what it filled in');
check(await stateOf(wsq(fresh, 'Wed', 'Arvo')) === 'y' && await stateOf(wsq(fresh, 'Wed', 'Early')) === '?', 'AI fill: every arvo ✓, the rest left ?');
check(/Ryde/.test(await fresh.getByTestId('ask-where').innerText()) && /Not Moore Park/.test(await fresh.getByTestId('ask-where').innerText()), 'AI fill: leaving from Ryde (weekends), not Moore Park');
await fresh.screenshot({ path: `${SHOTS}/8-link-caddie.png`, fullPage: true });
await fresh.getByTestId('ask-filled-undo').click();
check(await stateOf(wsq(fresh, 'Wed', 'Arvo')) === '?' && !(await fresh.getByTestId('ask-from').count()), 'Undo puts it all back');
await fresh.getByTestId('ask-caddie-go').click();
await fresh.getByTestId('ask-filled').waitFor({ timeout: 10000 });
// A second place: Leichhardt, weekdays, 30 min.
await fresh.getByTestId('ask-add-from').click();
const addPlace = fresh.getByTestId('ask-add-place');
await addPlace.getByRole('textbox', { name: 'Suburb or town' }).fill('Leich');
await addPlace.getByRole('button', { name: /Leichhardt NSW/ }).click();
const froms = fresh.getByTestId('ask-from');
check((await froms.count()) === 2, 'two places to leave from');
await froms.nth(1).getByRole('button', { name: 'Weekdays' }).click();
await froms.nth(1).getByRole('button', { name: '30 min' }).click();
await fresh.getByTestId('ask-courses').getByRole('button', { name: /Marrickville · \d+ min/ }).waitFor({ timeout: 8000 });
check(true, 'courses near your place, with your drive');
await fresh.getByTestId('ask-public-name').fill('Pete');
await fresh.getByTestId('ask-public-contact').fill('pete@example.com');
await fresh.screenshot({ path: `${SHOTS}/9-link-where.png`, fullPage: true });
await fresh.getByTestId('ask-send').click();
await fresh.getByTestId('ask-public-mine').waitFor({ timeout: 10000 });
const pete = db.callout_guests.find((g) => g.plan_id === id3);
const peteA = db.callout_answers.find((a) => a.plan_id === id3 && a.player_id === pete?.player_id);
check(pete?.email === 'pete@example.com' && peteA?.slots.some((s) => !s.maybe) && peteA.slots.some((s) => s.maybe), 'link: Pete answered (✓ and ? squares)');
const lf = peteA?.where?.from || [];
check(lf.length === 2 && lf[1].label === 'Leichhardt' && lf[1].days.join() === 'mon,tue,wed,thu,fri' && lf[1].max_min === 30 && lf[1].lat === -33.88, 'link: leaving from Ryde (weekends) and Leichhardt (weekdays, 30 min) saved');
check(await fresh.getByTestId('ask-public-signin').isVisible(), 'link: then the nudge to sign in');
await fresh.reload();
await fresh.getByTestId('ask-public-mine').waitFor({ timeout: 10000 });
check(/Pete/.test(await fresh.getByTestId('ask-public-mine').innerText()), 'link: this phone remembers his answer');

// 14. Bo sees how to reach him.
await as(phone, BO_ME, `/plan/${id3}`);
await phone.getByTestId('ask-contacts').waitFor({ timeout: 10000 });
await phone.getByTestId('ask-contacts').locator('summary').click();
check(/pete@example\.com/.test(await phone.getByTestId('ask-contacts').innerText()), 'Bo: “Answered from the link” — Pete’s email');

// 15. No group needed: #/ask → make the link (no group size).
await as(laptop, who(JOSH), '/ask');
await laptop.goto(`${BASE}#/ask`);
await laptop.getByTestId('ask-start').waitFor({ timeout: 15000 });
await laptop.getByTestId('ask-start-name').fill('Josh');
check(!(await laptop.getByText('Group size').isVisible().catch(() => false)), 'no group: no group size either');
await laptop.screenshot({ path: `${SHOTS}/10-ask-start.png`, fullPage: true });
await laptop.getByTestId('ask-start-go').click();
await laptop.waitForTimeout(1500);
check(startCalls.length === 1 && startCalls[0].p_my_name === 'Josh' && startCalls[0].p_ask?.range?.days === 28 && startCalls[0].p_spots == null, 'no group: “Make the link” — every day, 4 weeks, no max');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
