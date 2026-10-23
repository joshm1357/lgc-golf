// "Same as last time" — pure functions (no database, no React) for copying a past trip's shape into a new trip idea.
//
// Plain words:
//   - The organiser taps "Same as last time" on a past trip and picks new dates (default: the same weekday, a year
//     on). A new trip idea is made with the same place, jobs and bring list (not done, nobody's name on them), the
//     day-by-day plan moved to the new dates, and everyone who was in last time invited.
//   - The golf (which course and format each day, side comp holes, the group's own side comps, games, trophies) is
//     kept on the idea as its "shape" (plans.repeat_shape). Nothing is set up in the app until the organiser taps
//     "Set it up in the app" — then the rounds are filled in from the shape (TripSetup.jsx), on whatever the dates
//     are by then. So a dates vote can still move the trip.

import { daysUntil, parseDate } from './plan.js';
import { formatName } from './board.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Move "2026-03-13" by n days. */
export function shiftDate(date, n) {
  const d = parseDate(date);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** The default new start: the same weekday a year on (52 weeks), so a Friday-to-Sunday trip stays one. */
export function nextYearStart(start) {
  return shiftDate(start, 364);
}

/** Next year's name: "Autumn trip 2026" → "Autumn trip 2027"; no year in it → "… (again)". */
export function nextName(name, oldStart, newStart) {
  const n = String(name || 'Trip').trim();
  const oldY = parseDate(oldStart)?.getFullYear();
  const newY = parseDate(newStart)?.getFullYear();
  if (oldY && newY && n.includes(String(oldY))) return n.replace(String(oldY), String(newY)).slice(0, 60);
  if (/(?:19|20)\d\d/.test(n) && newY) return n.replace(/(?:19|20)\d\d/, String(newY)).slice(0, 60);
  return `${n} (again)`.slice(0, 60);
}

/** Which day of the trip a date is (0 = the first day). Rounds with no date count from their order. */
export function dayIndex(start, date) {
  if (!start || !date) return null;
  const n = daysUntil(date, start);
  return n == null ? null : n;
}

const clean = (holes) => (Array.isArray(holes) ? holes.map(Number).filter((h) => h >= 1 && h <= 18) : []);

/**
 * Build everything for the new trip idea.
 *   plan:     the past plan          rounds: its trip's rounds    games: round_games (any rounds; filtered here)
 *   items:    its plan_items         rsvps:  its plan_rsvps        trophies: its trip's trophies
 *   start/end: the new dates          name: the new name            me: the organiser's player id
 * Returns { plan: row to insert, items: rows to insert (plan_id added later), invited: [player ids], shape }.
 */
export function buildRepeat({ plan, rounds = [], games = [], items = [], rsvps = [], trophies = [], start, end, name, me = null }) {
  const offset = plan?.start_date && start ? daysUntil(start, plan.start_date) : 0;
  const length = plan?.start_date ? Math.max(0, daysUntil(plan.end_date || plan.start_date, plan.start_date) || 0) : 0;
  const newEnd = end && start && end >= start ? end : (start ? shiftDate(start, length) : null);
  const mine = [...rounds].filter((r) => !plan?.trip_id || r.trip_id === plan.trip_id)
    .sort((a, b) => String(a.play_date || '').localeCompare(String(b.play_date || '')) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const shapeRounds = mine.map((r, i) => ({
    day: dayIndex(plan?.start_date, r.play_date) ?? i,
    course_id: r.course_id,
    format: r.format,
    ctp_holes: clean(r.ctp_holes),
    ld_holes: clean(r.ld_holes),
    own_comps: Array.isArray(r.own_comps) ? r.own_comps.filter((c) => c && c.comp).map((c) => ({ comp: c.comp, holes: clean(c.holes) })) : [],
    // 098: an opt-in side game was someone's offer for that trip, so it isn't copied.
    games: games.filter((g) => g.round_id === r.id && !g.retired && g.who_in !== 'opt_in').map((g) => ({ kind: g.kind, stake: Number(g.stake) || 0, options: g.options || {} })),
  })).filter((r) => r.day >= 0 && r.day < 10);
  const invited = [...new Set(rsvps.filter((r) => r.status === 'in').map((r) => r.player_id))];
  const shape = {
    v: 1,
    from: plan?.id || null,
    from_name: plan?.name || '',
    rounds: shapeRounds,
    trophies: trophies.map((t) => ({ name: t.name, type: t.type, description: t.description ?? null })),
    invited,
  };
  const newPlan = {
    kind: plan?.kind || 'trip',
    name: String(name || '').trim().slice(0, 60) || nextName(plan?.name, plan?.start_date, start),
    status: 'planning',
    proposed: false,
    start_date: start || null,
    end_date: newEnd,
    location_name: plan?.location_name || null,
    address: plan?.address || null,
    link: plan?.link || null,
    ...(plan?.budget_pp ? { budget_pp: plan.budget_pp } : {}),
    ...(me ? { organiser_id: me } : {}),
    repeat_of: plan?.id || null,
    repeat_shape: shape,
  };
  const keep = items.filter((i) => ['job', 'bring', 'day'].includes(i.kind));
  const newItems = keep.map((i) => ({
    kind: i.kind,
    title: i.title,
    body: i.body ?? null,
    time: i.time ?? null,
    address: i.address ?? null,
    link: i.link ?? null,
    day: i.kind === 'day' && i.day ? shiftDate(i.day, offset) : null,
    due: i.due && i.kind === 'job' ? shiftDate(i.due, offset) : null,
    sort: i.sort ?? 0,
    done: false,
    owner_id: null,
  }));
  return { plan: newPlan, items: newItems, invited, shape };
}

/**
 * The rounds to offer in "Set it up in the app": the usual one-per-day rows, with the course and format from the
 * shape on each day it has one (only courses the group still has).
 */
export function setupRoundsFromShape(shape, rows, coursesById = {}) {
  if (!shape?.rounds?.length) return rows;
  return rows.map((row, i) => {
    const s = shape.rounds.find((r) => r.day === i);
    if (!s) return row;
    return { ...row, course_id: coursesById[s.course_id] ? s.course_id : row.course_id, format: s.format || row.format };
  });
}

/**
 * After the rounds are made: what to copy onto each new round from the shape — side comp holes, the group's own
 * side comps and games — matched by day and course (a different course on that day gets nothing, as the holes
 * wouldn't fit). `made`: [{ id, play_date, course_id, format }]. `ownCompIds`: the group's side comps that still exist.
 * Returns [{ round_id, patch: { ctp_holes, ld_holes, own_comps }, games: [{ round_id, kind, stake, options }] }].
 */
export function extrasForRounds(shape, made = [], start, { ownCompIds = null, gamesOn = true } = {}) {
  if (!shape?.rounds?.length) return [];
  const out = [];
  for (const r of made) {
    const day = dayIndex(start, r.play_date);
    const s = shape.rounds.find((x) => x.day === day && x.course_id === r.course_id);
    if (!s) continue;
    const own = (s.own_comps || []).filter((c) => !ownCompIds || ownCompIds.includes(c.comp)).slice(0, 10);
    const patch = {};
    if (s.ctp_holes?.length) patch.ctp_holes = s.ctp_holes;
    if (s.ld_holes?.length) patch.ld_holes = s.ld_holes;
    if (own.length) patch.own_comps = own;
    // Ambrose only takes skins and Nassau (team v team) — the database says the same.
    const games = !gamesOn ? [] : (s.games || [])
      .filter((g) => (r.format || s.format) !== 'ambrose' || ['skins', 'nassau'].includes(g.kind))
      .map((g) => ({ round_id: r.id, kind: g.kind, stake: g.stake, options: g.options || {} }));
    if (Object.keys(patch).length || games.length) out.push({ round_id: r.id, patch, games });
  }
  return out;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GAME_NAME = { skins: 'Skins', nassau: 'Nassau', stableford_pot: 'Stableford pot', birdie_pool: 'Birdie pool', eclectic: 'Eclectic' };

/**
 * The confirm card's list: one line per round, then the extras.
 *   ["Fri · Stableford at Cypress Lakes · CTP 3, 12 · LD 9 · Skins", "Trophies: The BD Trophy", "6 jobs · 8 on the bring list", …]
 */
export function describeRepeat(built, { coursesById = {}, compsById = {}, playersById = {}, nameOf = (p) => p?.name || '' } = {}) {
  const lines = [];
  const start = built?.plan?.start_date;
  for (const r of built?.shape?.rounds || []) {
    const date = start ? parseDate(shiftDate(start, r.day)) : null;
    const bits = [`${date ? DOW[date.getDay()] : `Day ${r.day + 1}`} · ${formatName(r.format)} at ${coursesById[r.course_id]?.name || 'a course'}`];
    if (r.ctp_holes?.length) bits.push(`CTP ${r.ctp_holes.join(', ')}`);
    if (r.ld_holes?.length) bits.push(`LD ${r.ld_holes.join(', ')}`);
    const own = (r.own_comps || []).map((c) => compsById[c.comp]?.name).filter(Boolean);
    if (own.length) bits.push(own.join(', '));
    const g = [...new Set((r.games || []).map((x) => GAME_NAME[x.kind] || x.kind))];
    if (g.length) bits.push(g.join(', '));
    lines.push(bits.join(' · '));
  }
  const tro = built?.shape?.trophies || [];
  if (tro.length) lines.push(`Trophies: ${tro.map((t) => t.name).join(', ')}`);
  const jobs = (built?.items || []).filter((i) => i.kind === 'job').length;
  const bring = (built?.items || []).filter((i) => i.kind === 'bring').length;
  const days = (built?.items || []).filter((i) => i.kind === 'day').length;
  const parts = [jobs && `${jobs} job${jobs === 1 ? '' : 's'}`, bring && `${bring} on the bring list`, days && `${days} in the day-by-day plan`].filter(Boolean);
  if (parts.length) lines.push(parts.join(' · '));
  const names = (built?.invited || []).map((id) => nameOf(playersById[id])).filter(Boolean);
  if (names.length) lines.push(`Invited: ${names.join(', ')}`);
  return lines;
}

/** Of those invited from last time, who hasn't said yet. */
export function notReplied(invited = [], rsvps = []) {
  const said = new Set(rsvps.map((r) => r.player_id));
  return invited.filter((id) => !said.has(id));
}
