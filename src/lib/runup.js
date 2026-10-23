// The run-up (ov25, 23 Oct 2026) and the look of each trip stage — pure functions (no database, no React) so they can
// be tested in runup.test.js. The screen is components/RunUp.jsx; the database side is migration 094.
//
// Josh: "Think about the lead-up component of the trip — tasks etc., but also the fun stuff (don't call it banter)
// like awards, new rules, side activities, organising cars… In the list under Trips: if it's organised it shows as
// Upcoming; Being organised is another one; Proposed; and also Previous — different labels, each looking different."
//
// Stages (lib/trips.js tripStage) → what people see:
//   on        ⛳ On now          gold
//   locked    🔒 Upcoming        navy, with a countdown ("16 days")
//   deciding  🧭 Being organised outline ("voting on dates", "calling courses")
//   idea      💡 Proposed        dashed ("3 keen")
//   done      🏁 Previous        muted ("Oct 2025", the winner)
//   cancelled ✖️ Called off      folded away, grey

import { daysUntil, fmtRange, todayISO } from './plan.js';
import { depositStatus } from './tripbudget.js';
import { lateInfo } from './latejobs.js';
import { playerCards } from './stats.js';
import { teeWords, dayBeforeLine, dayBeforeMessage, weekOutMessage, waitingLines, countdownPush } from '../../supabase/functions/_shared/runup.js';

export { teeWords, dayBeforeLine, dayBeforeMessage, weekOutMessage, waitingLines, countdownPush };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (iso) => fmtRange(iso).replace(/ \d{4}$/, ''); // "Fri 30 Oct"
const firstName = (p) => String(p?.nickname || p?.name || '').trim().split(/\s+/)[0] || 'Someone';
const pl = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ stage looks

/** The stage order on the Trips list, top to bottom. */
export const STAGE_ORDER = ['on', 'locked', 'deciding', 'idea', 'done', 'cancelled'];

export const STAGE_LOOK = {
  on: { key: 'on', label: 'On now', icon: '⛳', cls: 'stage-on' },
  locked: { key: 'locked', label: 'Upcoming', icon: '🔒', cls: 'stage-upcoming' },
  deciding: { key: 'deciding', label: 'Being organised', icon: '🧭', cls: 'stage-organising' },
  idea: { key: 'idea', label: 'Proposed', icon: '💡', cls: 'stage-proposed' },
  done: { key: 'done', label: 'Previous', icon: '🏁', cls: 'stage-previous' },
  cancelled: { key: 'cancelled', label: 'Called off', icon: '✖️', cls: 'stage-off' },
};

/** The look for a stage (unknown → Being organised). */
export function stageLook(stage) {
  return STAGE_LOOK[stage] || STAGE_LOOK.deciding;
}

/** "Oct 2025" from an ISO date. */
export function monthYear(iso) {
  const [y, m] = String(iso || '').split('-').map(Number);
  return y && m ? `${MON[m - 1]} ${y}` : '';
}

/** "16 days", "1 day", "Tomorrow", "Today", "6 weeks" — the Upcoming countdown. */
export function daysToGo(start, today = todayISO()) {
  const n = daysUntil(start, today);
  if (n == null) return '';
  if (n <= 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n >= 42) return `${Math.round(n / 7)} weeks`;
  return `${n} days`;
}

/**
 * What a Being organised trip is up to, in a few words: "voting on dates", "voting on where", "voting on dates and
 * where", "voting", "calling courses" (dates and place settled, not locked in yet), or "getting started".
 * polls: open polls (any plan; filtered here).
 */
export function organisingWords(plan, polls = []) {
  const open = (polls || []).filter((p) => p.plan_id === plan?.id && (p.status || 'open') === 'open');
  const dates = open.some((p) => p.kind === 'dates');
  const where = open.some((p) => p.kind === 'location');
  if (dates && where) return 'voting on dates and where';
  if (dates) return 'voting on dates';
  if (where) return 'voting on where';
  if (open.length) return 'voting';
  if (plan?.start_date && plan?.location_name) return 'calling courses';
  return 'getting started';
}

/**
 * The tag on a trip's card for its stage:
 *   on → "Day 2 of 3" (dayWords) · locked → "16 days" · deciding → "voting on dates" · idea → "3 keen"
 *   done → "Oct 2025" · cancelled → "Called off"
 */
export function stageTag({ stage, plan, polls = [], rsvps = [], today = todayISO(), dayWords = null }) {
  if (stage === 'on') return dayWords || 'On now';
  if (stage === 'locked') return plan?.start_date ? daysToGo(plan.start_date, today) : 'Dates to come';
  if (stage === 'deciding') return organisingWords(plan, polls);
  if (stage === 'idea') {
    const keen = (rsvps || []).filter((r) => r.plan_id === plan?.id && r.status === 'in').length;
    return keen ? `${keen} keen` : 'Nobody keen yet';
  }
  if (stage === 'done') return monthYear(plan?.end_date || plan?.start_date) || 'Done';
  return 'Called off';
}

/** "🏆 BD Trophy: Mike" — the winner line on a Previous trip (the main trophy, see mainTrophy). */
export function winnerLine(honours = []) {
  const h = mainTrophy(honours);
  return h ? `🏆 ${h.trophy_name}: ${h.winner_names}` : '';
}

/** The trip's main trophy from its honour board rows: a Stableford / BD trophy if there is one, else the first. */
export function mainTrophy(honours = []) {
  const list = [...(honours || [])].sort((a, b) => String(a.sort_key || a.trophy_name || '').localeCompare(String(b.sort_key || b.trophy_name || '')));
  return list.find((h) => /stableford|\bbd\b|main|champion/i.test(h.trophy_name || '')) || list[0] || null;
}

/**
 * The Trips list in its stage sections (top to bottom: On now, Upcoming, Being organised, Proposed, Previous, Called
 * off). sorted: lib/trips.js sortTrips output. → [{ stage, look, items: [{ plan, stage }] }] (empty sections left out).
 */
export function stageSections(sorted) {
  if (!sorted) return [];
  const all = [sorted.now, ...(sorted.later || []), ...(sorted.ideas || []), ...(sorted.past || [])].filter(Boolean);
  return STAGE_ORDER.map((stage) => ({ stage, look: stageLook(stage), items: all.filter((x) => x.stage === stage) }))
    .filter((s) => s.items.length);
}

// ------------------------------------------------------------------ the sidebar's Trips sub-items

/**
 * Up to three sub-items under Trips, by stage: On now, Upcoming (one or two), Being organised, Previous — most
 * pressing first. menu: lib/activetrip.js tripsMenu output; organising: the soonest Being organised plan (or null).
 * → [{ kind: 'on'|'upcoming'|'organising'|'previous', trip?, plan?, label }]
 *   "On now: Hunter", "Upcoming: Hunter · 16 days", "Being organised: March", "Previous: South Coast"
 */
export function sideItems({ menu = null, organising = null, today = todayISO(), max = 3 } = {}) {
  const out = [];
  const startOf = (t) => t?.start_date || null;
  if (menu?.now) {
    out.push(menu.now.on
      ? { kind: 'on', trip: menu.now.trip, label: `On now: ${menu.now.trip.name}` }
      : { kind: 'upcoming', trip: menu.now.trip, label: upcomingLabel(menu.now.trip, today) });
  }
  if (menu?.next) out.push({ kind: 'upcoming', trip: menu.next, label: upcomingLabel(menu.next, today) });
  if (organising) out.push({ kind: 'organising', plan: organising, label: `Being organised: ${organising.name}` });
  if (menu?.last) out.push({ kind: 'previous', trip: menu.last, label: `Previous: ${menu.last.name}` });
  // Keep the most pressing three: never drop On now; drop a second Upcoming before Being organised / Previous.
  if (out.length > max && out.filter((x) => x.kind === 'upcoming').length > 1) {
    const i = out.map((x) => x.kind).lastIndexOf('upcoming');
    out.splice(i, 1);
  }
  return out.slice(0, max).map((x) => ({ ...x, start: startOf(x.trip) }));
}

function upcomingLabel(trip, today) {
  const n = trip?.start_date ? daysToGo(trip.start_date, today) : '';
  return `Upcoming: ${trip?.name || 'Trip'}${n ? ` · ${n.toLowerCase() === 'today' ? 'today' : n}` : ''}`;
}

/** The soonest plan that's Being organised (deciding), for the sidebar. stages: [{ plan, stage }]. */
export function soonestOrganising(stages = []) {
  const list = (stages || []).filter((x) => x.stage === 'deciding').map((x) => x.plan);
  return list.sort((a, b) => String(a.start_date || '9999').localeCompare(String(b.start_date || '9999'))
    || String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
}

// ------------------------------------------------------------------ the run-up page

/** The run-up shows on an Upcoming trip: locked in and not started (between lock-in and the first tee). */
export function showRunUp(stage) {
  return stage === 'locked';
}

/** "16 days to go · Hunter Valley · Fri 6 – Sun 8 Mar 2027". */
export function countdownHeader(plan, today = todayISO()) {
  const n = plan?.start_date ? daysUntil(plan.start_date, today) : null;
  const when = n == null ? 'Dates to come' : n <= 0 ? 'Today’s the day' : n === 1 ? 'Tomorrow' : `${n} days to go`;
  return [when, plan?.location_name || null, plan?.start_date ? fmtRange(plan.start_date, plan.end_date) : null].filter(Boolean).join(' · ');
}

/**
 * Which run-up sections show, in order. feature: (key) → on?; tippingOff: plans.tipping_off.
 * 'todos' 'getting_there' 'votes' 'up_for_grabs' 'rules' 'activities' 'bring' 'form' 'tipping' 'chat'
 */
export function runUpSections({ feature = () => true, tippingOff = false, hasRounds = true, guest = false } = {}) {
  const out = ['todos'];
  if (feature('planner_rooms')) out.push('getting_there');
  // R2 (ov27): a guest gets no votes, no group rules and no tipping (they can't vote or tip).
  if (!guest) out.push('votes');
  out.push('up_for_grabs');
  if (!guest) out.push('rules');
  out.push('activities');
  if (feature('planner_tasks')) out.push('bring');
  if (feature('stats') && hasRounds) out.push('form');
  if (!tippingOff && !guest) out.push('tipping');
  out.push('chat');
  return out;
}

// ---------------------------------------------------------------- your to-dos

/**
 * Your own to-dos for the run-up, most pressing first:
 *   reply (not said if you're in) · deposit (owed) · jobs (yours, not done, with late warnings) · bring (things you
 *   said you'd bring) · handicap (not checked for this trip) · tip (tipping open and you haven't picked)
 * → [{ key, icon, title, detail?, late?, action }]  action: 'rsvp' | 'deposit' | 'job' | 'bring' | 'handicap' | 'tip'
 */
export function myTodos({ me, plan, rsvps = [], items = [], transfers = [], mine = null, player = null, lateRuleV = null,
  late = {}, tipping = null, myTip = null, today = todayISO(), payTo = null } = {}) {
  if (!me || !plan) return [];
  const out = [];
  const rsvp = rsvps.find((r) => r.player_id === me);
  if (!rsvp || rsvp.status === 'maybe') {
    out.push({ key: 'reply', icon: '🙋', title: rsvp ? 'You’re a maybe — in or out?' : 'Say if you’re in', action: 'rsvp' });
  }
  if (Number(plan.deposit_pp) > 0 && rsvp && rsvp.status !== 'out') {
    const d = depositStatus({ deposit: plan.deposit_pp, rsvps, transfers }).people.find((p) => p.player_id === me);
    // Sent but not ticked off yet: nothing to do (the money line says "waiting for Josh to confirm"), so no to-do and
    // never a Pay button next to "waiting" (ov27, M1).
    if (d && d.state === 'unpaid') {
      out.push({ key: 'deposit', icon: '💳', title: `Pay ${payTo ? `${payTo} ` : ''}your $${Number(plan.deposit_pp)} deposit`, action: 'deposit', late: false });
    }
  }
  for (const j of items.filter((i) => i.kind === 'job' && i.owner_id === me && !(i.done || i.stage === 'done'))) {
    const info = lateRuleV ? lateInfo(j, lateRuleV, { today, ...late }) : null;
    const overdue = !info && j.due && j.due < today;
    out.push({
      key: `job-${j.id}`, icon: '📋', title: j.title, action: 'job', id: j.id,
      detail: info ? `⚠️ ${pl(info.daysLate, 'day')} late${info.strokes ? ` — ${pl(info.strokes, 'penalty stroke')} if it’s not done before the next round` : ''}`
        : overdue ? `⚠️ Was due ${shortDay(j.due)}` : j.due ? `Due ${shortDay(j.due)}` : null,
      late: !!(info || overdue),
    });
  }
  const bring = items.filter((i) => i.kind === 'bring' && i.owner_id === me && i.bring_shared);
  if (bring.length) out.push({ key: 'bring', icon: '🎒', title: `You’re bringing: ${bring.map((b) => b.title).join(', ')}`, action: 'bring' });
  if (!mine?.handicap_checked_at) {
    out.push({ key: 'handicap', icon: '⛳', title: `Check your handicap${player?.handicap != null ? ` (${player.handicap})` : ''}`, detail: 'Still right? Tap to confirm or fix it.', action: 'handicap' });
  }
  if (tipping?.open && !myTip) out.push({ key: 'tip', icon: '🔮', title: 'Pick your winner', detail: `Tipping closes ${tipping.closesWords}`, action: 'tip' });
  // Late first, then the rest as listed.
  return [...out.filter((x) => x.late), ...out.filter((x) => !x.late)];
}

/** What the week-out reminder counts for one person (same as myTodos, in the reminder's shape). */
export function todoForReminder(todos = []) {
  return {
    reply: todos.some((t) => t.key === 'reply'),
    deposit: todos.some((t) => t.key === 'deposit') ? 'deposit' : null,
    jobs: todos.filter((t) => t.action === 'job').map((t) => t.title),
    handicap: todos.some((t) => t.key === 'handicap'),
    tip: todos.some((t) => t.key === 'tip'),
  };
}

// ---------------------------------------------------------------- getting there: cars and rooms

/**
 * The cars and who's in them.
 *   groups / members: plan_groups (kind 'car') / plan_group_members; people: trip_runup_people rows; rsvps.
 * → { cars: [{ id, name, driverId, capacity, taken, free, people: [ids], pickup }], needLift: [ids], unsorted: [ids],
 *     myCar, iDrive, iNeedLift, seatsSpare, seatsShort }
 *   unsorted — in, not in a car and haven't said they need a lift.
 */
export function carsView({ groups = [], members = [], people = [], rsvps = [], me = null } = {}) {
  const cars = groups.filter((g) => g.kind === 'car').map((g) => {
    const ids = members.filter((m) => m.group_id === g.id).map((m) => m.player_id);
    // The driver first.
    ids.sort((a, b) => (a === g.driver_id ? -1 : b === g.driver_id ? 1 : 0));
    const taken = ids.length;
    return { id: g.id, name: g.name, driverId: g.driver_id || null, capacity: g.capacity, taken, free: Math.max(0, g.capacity - taken), people: ids,
      pickup: [g.pickup_place, g.pickup_time].filter(Boolean).join(' ') || null, note: g.note || null };
  });
  const inCar = new Set(cars.flatMap((c) => c.people));
  const ins = rsvps.filter((r) => r.status === 'in').map((r) => r.player_id);
  const needLift = people.filter((p) => p.needs_lift && !inCar.has(p.player_id)).map((p) => p.player_id);
  const asked = new Set(needLift);
  const unsorted = ins.filter((id) => !inCar.has(id) && !asked.has(id));
  const myCar = cars.find((c) => c.people.includes(me)) || null;
  const seatsSpare = cars.reduce((s, c) => s + c.free, 0);
  return {
    cars, needLift, unsorted, myCar, iDrive: !!myCar && myCar.driverId === me, iNeedLift: asked.has(me),
    seatsSpare, seatsShort: Math.max(0, needLift.length - seatsSpare),
  };
}

/** Can this person hop into this car? → '' (yes) or the reason not. */
export function joinProblem(car, me, view) {
  if (!car || !me) return 'Sign in first';
  if (car.people.includes(me)) return 'You’re in this car';
  if (view?.iDrive) return 'You’re driving your own car';
  if (car.free <= 0) return `${car.name} is full`;
  return '';
}

/** Rooms and who's sharing. → [{ id, name, people: [ids] }] and mine ({ name, with: [ids] } or null). */
export function roomsView({ groups = [], members = [], me = null } = {}) {
  const rooms = groups.filter((g) => g.kind === 'room').map((g) => ({ id: g.id, name: g.name, capacity: g.capacity, people: members.filter((m) => m.group_id === g.id).map((m) => m.player_id) }));
  const r = rooms.find((x) => x.people.includes(me));
  return { rooms, mine: r ? { name: r.name, with: r.people.filter((id) => id !== me) } : null };
}

// ---------------------------------------------------------------- side activities

/**
 * One activity's money: cost each, how many are in, the total, and my share.
 * → { each, count, total, mine, line } — line: "$40 each · 3 in · $120 into the kitty" (or "Free · 3 in").
 */
export function activityMoney(activity, people = [], me = null) {
  const ids = people.filter((p) => p.activity_id === activity?.id).map((p) => p.player_id);
  const each = Math.max(0, Number(activity?.cost_pp) || 0);
  const count = ids.length;
  const total = Math.round(each * count * 100) / 100;
  const mine = ids.includes(me) ? each : 0;
  const money = (x) => `$${Number(x).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;
  const line = each > 0 ? `${money(each)} each · ${count} in${count ? ` · ${money(total)} into the kitty` : ''}` : `Free · ${count} in`;
  return { each, count, total, mine, ids, line };
}

/** "Sat 7 Mar · 4pm · Hunter Valley Karting" — an activity's when and where. */
export function activityWhen(a) {
  return [a?.day ? fmtRange(a.day).replace(/ \d{4}$/, '') : null, a?.time || null, a?.place || null].filter(Boolean).join(' · ');
}

/** Clean what was typed into "Propose an activity" → the row to save, or { error }. */
export function cleanActivity(v = {}) {
  const title = String(v.title || '').trim().slice(0, 80);
  if (!title) return { error: 'Give it a name' };
  const typed = v.cost_pp == null ? '' : String(v.cost_pp).trim();
  const digits = typed.replace(/[$,\s]/g, '');
  const cost = typed === '' ? null : /^\d+(\.\d{1,2})?$/.test(digits) ? Number(digits) : NaN;
  if (cost != null && (!Number.isFinite(cost) || cost > 10000)) return { error: 'Cost each: a dollar amount, e.g. 40' };
  const link = String(v.link || '').trim();
  return {
    title, day: v.day || null, time: String(v.time || '').trim().slice(0, 40) || null, place: String(v.place || '').trim().slice(0, 120) || null,
    cost_pp: cost || null, link: link ? (/^https?:\/\//i.test(link) ? link : `https://${link}`).slice(0, 500) : null,
  };
}

// ---------------------------------------------------------------- what to bring (shared things)

const BRING_EMOJI = [
  [/speaker|music|boom/i, '🔊'], [/esky|ice|cooler/i, '🧊'], [/card/i, '🃏'], [/ball/i, '⛳'], [/beer|drink|grog|wine/i, '🍺'],
  [/bbq|barbie|tongs|grill/i, '🍖'], [/umbrella/i, '☂️'], [/first aid|panadol|sunscreen/i, '🩹'], [/charger|cable|power/i, '🔌'],
  [/game|dice|darts/i, '🎲'], [/rangefinder|gps/i, '🔭'], [/trophy|cup/i, '🏆'], [/chair/i, '🪑'], [/coffee/i, '☕'],
];
/** A friendly emoji for a thing to bring. */
export function bringEmoji(title) {
  return (BRING_EMOJI.find(([re]) => re.test(String(title || ''))) || [null, '🎒'])[1];
}

/** The shared things to bring (not the personal list): claimed and "Nobody yet". */
export function bringView(items = []) {
  const shared = items.filter((i) => i.kind === 'bring' && i.bring_shared);
  return { shared, open: shared.filter((i) => !i.owner_id), claimed: shared.filter((i) => i.owner_id), personal: items.filter((i) => i.kind === 'bring' && !i.bring_shared) };
}

/** The "📣 Ask the group" feed post: "Can anyone help with these? 🔊 Speaker · 🧊 Esky — tap to say you'll bring it". */
export function bringAskText(open = []) {
  if (!open.length) return '';
  return `Can anyone help with these? ${open.map((i) => `${bringEmoji(i.title)} ${i.title}`).join(' · ')} — tap to say you’ll bring it`;
}

/** The link on that post (the Feed shows "I'll bring it" buttons on it). */
export const bringAskLink = (planId) => `/plan/${planId}?view=overview&bring=ask`;
/** The plan id from a feed post's link if it's a "what to bring" ask, else null. */
export function bringAskPlan(link) {
  const m = /^\/plan\/([0-9a-f-]{36})\?view=overview&bring=ask$/i.exec(String(link || ''));
  return m ? m[1] : null;
}

/** "🔊 Hamish is bringing the speaker" — the optional "Tell the group" line when claiming. */
export function claimPostText(player, item) {
  return `${bringEmoji(item?.title)} ${firstName(player)} is bringing the ${String(item?.title || 'thing').toLowerCase()}`;
}

// ---------------------------------------------------------------- tipping

/** The date and time now in Sydney as "YYYY-MM-DD HH:MM" (what the database's lock uses). */
export function sydneyNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const v = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${v('year')}-${v('month')}-${v('day')} ${v('hour')}:${v('minute')}`;
}

const pad5 = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

/**
 * When tipping closes and whether it's open. Same rule as the database (094 tips_close_at / tips_guard): the first
 * tee — the earliest tee time of the trip's first round, else 7am that day; no rounds → 7am on the trip's first day —
 * or as soon as any round of the trip is under way. Times are Sydney time.
 *   rounds: the trip's rounds; teeGroups: their tee_groups. → { open, closesAt: "YYYY-MM-DD HH:MM", closesWords, off }
 */
export function tippingState({ plan, rounds = [], teeGroups = [], now = new Date() } = {}) {
  if (!plan) return { open: false, closesAt: null, closesWords: '', off: false };
  if (plan.tipping_off) return { open: false, closesAt: null, closesWords: '', off: true };
  const dated = rounds.filter((r) => r.play_date).sort((a, b) => String(a.play_date).localeCompare(String(b.play_date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const firstRound = dated[0] || null;
  const day = firstRound?.play_date?.slice(0, 10) || plan.start_date || null;
  const tees = firstRound ? teeGroups.filter((t) => t.round_id === firstRound.id).map((t) => pad5(t.tee_time)).filter(Boolean).sort() : [];
  const tee = tees[0] || '07:00';
  const closesAt = day ? `${day} ${tee}` : null;
  const started = rounds.some((r) => r.status === 'live' || r.status === 'locked');
  const open = plan.status === 'confirmed' && !started && (!closesAt || sydneyNow(now) < closesAt);
  return { open, closesAt, closesWords: closesAt ? `at the first tee (${teeWords(tee)}${tee < '12:00' ? 'am' : ''} ${fmtRange(day).replace(/ \d{4}$/, '')})` : 'at the first tee', off: false, tee };
}

/**
 * After the trip: who tipped the main trophy's winner(s).
 *   tips: trip_tips rows; winnerIds: the main trophy's player ids. → { best: [ids], line }
 *   line: "Best tipster: Mike" / "Best tipsters: Mike and Al" / "Nobody tipped Josh" / '' (no winner yet).
 */
export function tipResult({ tips = [], winnerIds = [], playersById = {} } = {}) {
  if (!winnerIds.length) return { best: [], line: '' };
  const best = tips.filter((t) => winnerIds.includes(t.pick_id)).map((t) => t.player_id);
  const names = best.map((id) => firstName(playersById[id]));
  const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  if (!best.length) return { best, line: `Nobody tipped ${winnerIds.map((id) => firstName(playersById[id])).join(' and ')}` };
  return { best, line: `Best tipster${best.length === 1 ? '' : 's'}: ${list}` };
}

/** How the picks look so far: [{ id, n }] most picked first (shown once tipping's closed). */
export function tipTally(tips = []) {
  const n = new Map();
  for (const t of tips) n.set(t.pick_id, (n.get(t.pick_id) || 0) + 1);
  return [...n.entries()].map(([id, c]) => ({ id, n: c })).sort((a, b) => b.n - a.n);
}

// ---------------------------------------------------------------- form guide

/**
 * Each player's form: last rounds (newest first), handicap trend and best result at this trip's courses.
 *   ctx: lib/stats.js buildHistory output; ids: the players; courseIds: the trip's courses; last: how many rounds.
 * → [{ id, last: [{ points, date, course }], trend: { from, to, dir } | null, best: { points, course, date } | null }]
 */
export function formGuide(ctx, ids = [], courseIds = [], { last = 3 } = {}) {
  const courses = new Set(courseIds.filter(Boolean));
  return ids.map((id) => {
    const cards = playerCards(ctx, id).filter((c) => c.finished && c.points != null && (c.format === 'stableford' || c.format === 'stroke'));
    const recent = cards.slice(-last).reverse().map((c) => ({ points: c.points, date: c.date, course: c.course?.name || c.round?.name || '' }));
    const hcps = cards.map((c) => Number(c.hcp)).filter(Number.isFinite);
    const trend = hcps.length >= 2 ? { from: hcps[Math.max(0, hcps.length - 5)], to: hcps[hcps.length - 1] } : null;
    if (trend) trend.dir = trend.to < trend.from ? 'down' : trend.to > trend.from ? 'up' : 'same';
    const here = cards.filter((c) => courses.has(c.round?.course_id)).sort((a, b) => b.points - a.points || String(b.date).localeCompare(String(a.date)))[0];
    return { id, last: recent, trend, best: here ? { points: here.points, course: here.course?.name || '', date: here.date } : null };
  });
}

/** "36 · 31 · 29" from form rows' points. */
export const formLine = (rows = []) => rows.map((r) => r.points).join(' · ');
/** "↓ 18 → 16" / "↑ 14 → 15" / "→ 12" */
export function trendWords(t) {
  if (!t) return '';
  if (t.dir === 'same') return `→ ${t.to}`;
  return `${t.dir === 'down' ? '↓' : '↑'} ${t.from} → ${t.to}`;
}

// ---------------------------------------------------------------- reminders

/** The day-before line for one person, from the app's own data (the notify function builds the same). */
export function myDayBefore({ me, carView = null, rooms = null, teeTime = null, items = [], playersById = {} }) {
  const car = carView?.myCar ? {
    name: carView.myCar.name, pickup_place: null, pickup_time: null, ...splitPickup(carView.myCar),
    driver: playersById[carView.myCar.driverId] || null, driving: carView.myCar.driverId === me,
  } : null;
  const room = rooms?.mine ? { name: rooms.mine.name, with: rooms.mine.with.map((id) => playersById[id]).filter(Boolean) } : null;
  const bring = items.filter((i) => i.kind === 'bring' && i.bring_shared && i.owner_id === me).map((i) => i.title);
  return dayBeforeLine({ car, room, tee: teeTime, bring });
}
function splitPickup(car) {
  return { pickup_place: car.pickup || null, pickup_time: null };
}
