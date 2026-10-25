// The day plan screen's data (ov40). Pure functions only: the trip builder's saved state + what's known about each
// course → one day's inputs for lib/daytiming.js, the courses that suit that day's role, and the side-by-side
// comparison rows with their fit lines (lib/tripfit.js). The screen (screens/DayPlan.jsx) only draws these.
//
// Placing courses (Josh 25 Oct): each day's courses fit its role —
//   * day 1 "on the way": along the drive from the starting points, with a tee time that works after leaving home;
//   * stay days: near where we stay;
//   * the last day "on the way home": finishing so people are home by their home_by.
// using the course's visitor / social times for that weekday and the per-day wishes.
import * as TB from './tripbuilder.js';
import { weekday } from './tripfinder.js';
import { courseWindows, windowsText, golfLength, dayPlan, dayPrefs, slotLine, hm, dur, FLY_DEFAULTS, USUAL_GROUP } from './daytiming.js';
import { fitOption, notForLine, scheduleCheck } from './tripfit.js';
import { sunTimes, DEFAULT_LEAVE_STAY } from './daytiming.js';

export const MAX_COMPARE = 6;
export const BOOK_WORDS = { phone: 'Phone', online: 'Online', email: 'Email' };

/** Where people come from: the saved snapshot (the organiser's starting points), else the builder's origin. */
export function startPoints(st = {}, origin = null) {
  const snap = (st.dayPlan?.starts || []).filter((s) => s && s.lat != null);
  if (snap.length) return snap;
  const o = origin || st.origin;
  return o?.lat != null ? [{ label: String(o.label || 'home').split(/ ×|,/)[0].trim() || 'home', lat: o.lat, lng: o.lng, count: null }] : [];
}
/** The trip's starting points as kept in the plan (areas only, rounded — never an address). */
export function snapStarts(starts = []) {
  return (starts || []).filter((s) => s && s.lat != null).slice(0, 3).map((s) => ({
    label: String(s.label || 'home').slice(0, 40), lat: Math.round(s.lat * 100) / 100, lng: Math.round(s.lng * 100) / 100,
    count: s.count ?? s.headcount ?? null, leave: s.leave_after || s.leave || '06:00',
  }));
}
const centreOf = (pts) => {
  const p = (pts || []).filter((x) => x && x.lat != null);
  return p.length ? { lat: p.reduce((a, x) => a + x.lat, 0) / p.length, lng: p.reduce((a, x) => a + x.lng, 0) / p.length } : null;
};

/** The trip's days as the day plan shows them: [{ index, slot, leg, golf, rounds, name, role, date, dates, last }]. */
export function planDays(st = {}) {
  const weekends = st.weekends || [];
  const all = TB.tripDays(st.nights);
  return all.map((d) => {
    const saved = (st.days || []).find((x) => x.index === d.index && x.leg === d.leg) || {};
    const day = { ...d, ...saved, name: d.name };
    const leg = TB.dayLeg(day);
    return {
      index: d.index, slot: d.leg, leg, golf: TB.dayGolf(day), rounds: TB.dayRounds(day), options: saved.options || [],
      name: d.name.replace(/ —.*/, ''), role: TB.dayRoleLine(day), last: d.index === all.length - 1 && all.length > 1,
      date: weekends[0] ? TB.dayDate(weekends[0], d.index) : null, dates: weekends.map((w) => TB.dayDate(w, d.index)).filter(Boolean),
    };
  });
}

/** The day's format: what the organiser set on the day plan, else Stableford with an Ambrose on the last day. */
export function dayFormat(st = {}, day) {
  return st.dayPlan?.formats?.[day.index] || (day.last ? 'ambrose' : 'stableford');
}
/** The golf for a day: one round, 9 holes, or 36 (two rounds with about 45 min for lunch between). */
export function dayGolfLength(st, day, players) {
  const g = golfLength({ format: dayFormat(st, day), players: players || 4, holes: day.golf === '9' ? 9 : 18 });
  return day.golf === '36' ? { ...g, total: g.total * 2 + 45, two: true } : g;
}
/** How they travel: the builder's travel ('fly' from the trip ideas) and the day plan's own numbers. */
export function travelOf(st = {}) {
  const t = st.dayPlan?.travel || {};
  return { mode: t.mode || (st.travel === 'fly' ? 'fly' : 'drive'), fly: { ...FLY_DEFAULTS, ...(t.fly || {}) }, leave: t.leave || '06:00' };
}

/**
 * The courses that could go on a day, best first: the day's options, then the area's other courses that fit the
 * day's role. Each: { course, onDay, drive }.
 */
export function dayCourses(day, { st = {}, courseMap = {}, starts = [], stays = [] } = {}) {
  const origin = centreOf(starts);
  const area = (st.areaCourses || {})[st.region] || [];
  const ids = [...new Set([...day.options, ...area, ...Object.keys(st.courses || {})])];
  return ids.map((id) => courseMap[id]).filter((c) => c && c.lat != null).map((c) => {
    const drive = stays.length ? TB.legDrive(day.leg, c, { origin, stays }) : { min: origin ? TB.driveBetween(origin, c) : null, text: '?' };
    return { course: c, onDay: day.options.includes(c.id), drive };
  }).filter((x) => x.onDay || !stays.length || TB.fitsLeg(day.leg, x.drive, st))
    .sort((a, b) => Number(b.onDay) - Number(a.onDay) || (a.drive.min ?? 999) - (b.drive.min ?? 999));
}

/**
 * Everything one day needs: the timeline and each course's fitting times, wishes marked, fit lines.
 * ctx: { st, courseMap, booking, social, research, history, starts, stays, comments, wishes, people, nameOf, players }
 * → { day, date, plan (daytiming.dayPlan), prefs, rows: [comparison rows], golf, travel }
 */
export function buildDay(day, ctx = {}) {
  const { st = {}, courseMap = {}, booking = {}, social = {}, research = {}, history = () => null, starts = [], stays = [], comments = [], wishes = [], people = [], nameOf, players = 4 } = ctx;
  const date = ctx.date || day.date;
  const dow = date ? weekday(date) : null;
  const travel = travelOf(st);
  const golf = dayGolfLength(st, day, players);
  const prefs = date ? dayPrefs(date, { comments, wishes, last: day.last }) : [];
  const stayAt = centreOf(stays);
  const cands = dayCourses(day, { st, courseMap, starts, stays }).slice(0, MAX_COMPARE + day.options.length);
  const courses = cands.map(({ course: c, onDay, drive }) => {
    const w = dow == null ? { windows: [], known: false } : courseWindows(dow, { social: social[c.id], booking: booking[c.id], research: research[c.id] });
    const fromHome = Object.fromEntries(starts.map((s) => [s.label, TB.driveBetween(s, c)]));
    return {
      id: c.id, name: c.name, onDay, driveText: drive.text,
      driveFromStay: stayAt ? Math.min(...stays.map((s) => TB.driveBetween(s, c))) : 0,
      driveFromHome: fromHome, driveHome: starts.length ? Math.max(...Object.values(fromHome)) : 0,
      windows: w.windows, known: w.known, guess: !!w.guess, source: w.source, text: w.text,
    };
  });
  // A pick, else (coordinator 25 Oct: "leave time follows the tee time") the suggested plan's time for this day.
  const pick = st.dayPlan?.picks?.[day.index] || ctx.suggest || null;
  const suggested = !st.dayPlan?.picks?.[day.index] && !!ctx.suggest;
  const plan = dayPlan({
    leg: day.leg, date, place: stayAt || courses[0] && courseMap[courses[0].id] || centreOf(starts),
    travel: { mode: travel.mode, fly: travel.fly, starts: starts.map((s) => ({ label: s.label, leave: s.leave || travel.leave, driveMin: stayAt ? TB.driveBetween(s, stayAt) : 0 })) },
    pick: pick ? { course: pick.course_id, tee: pick.tee } : null, courses, golf, prefs,
  });
  if (suggested) plan.blocks = plan.blocks.map((b) => (b.kind === 'golf' ? { ...b, label: `Suggested — ${b.label}` } : b));
  const rows = plan.courses.map((c) => compareRow(c, { day, date, golf, prefs, people, wishes, nameOf, booking: booking[c.id], research: research[c.id], course: courseMap[c.id], history: history(c.id), sunset: plan.sun?.sunset, travel }));
  return { day, date, plan, prefs, rows: rankRows(rows), golf, travel, suggested };
}

/** The best time to suggest at a course: the one that suits the most wishes, then the first that's clear of dusk. */
export function bestSlot(slots = []) {
  if (!slots.length) return null;
  const top = Math.max(...slots.map((s) => s.suitsN || 0));
  const pool = top > 0 ? slots.filter((s) => s.suitsN === top) : slots;
  return pool.find((s) => s.flag?.tone === 'ok') || pool[0];
}
/** "Sat green fee about $50" from the course research. */
export function feeFor(r, dow) {
  if (!r) return null;
  const weekend = dow === 0 || dow === 6;
  const f = weekend ? (r.fee_weekend ?? r.fee_weekday) : (r.fee_weekday ?? r.fee_weekend);
  return f != null ? Number(f) : null;
}
function compareRow(c, { day, date, golf, prefs, people, wishes, nameOf, booking, research, course, history, sunset, travel }) {
  const dow = date ? weekday(date) : null;
  const best = bestSlot(c.fit.slots);
  const fee = feeFor(research, dow);
  const fit = best ? fitOption({
    tee: best.tee, finish: best.finish, duskMargin: sunset != null ? sunset - best.finish : undefined,
    ...(day.leg === 'way' && travel.mode !== 'fly' ? { drive: c.driveHome } : {}), ...(day.leg === 'home' ? { driveHome: c.driveHome } : {}),
    ...(day.rounds === 2 ? { rounds: 2 } : {}),
  }, { people, wishes, prefs, nameOf }) : null;
  const book = booking?.booking_method ? BOOK_WORDS[booking.booking_method] : booking?.booking_url || research?.booking_url ? 'Online' : booking?.phone || research?.phone ? 'Phone' : null;
  return {
    id: c.id, name: c.name, onDay: c.onDay,
    known: TB.shortKnown(course || {}, history),
    style: research?.details?.style || null,
    fee: fee != null ? `about $${fee}` : null,
    drive: c.driveText,
    // Josh: "guess, shown as unconfirmed" — never blank, never shown as fact.
    times: c.known ? windowsText(c.windows) : c.guess && c.windows.length ? `about ${windowsText(c.windows)} — unconfirmed` : 'ring to check',
    timesSource: c.source,
    guess: !c.known,
    fits: c.fit.fits.map((w) => `${hm(Math.ceil(w.from / 5) * 5)}–${hm(Math.floor(w.to / 5) * 5)}`).join(", ") || null,
    reason: c.fit.reason,
    maxGroup: booking?.max_group ? `up to ${booking.max_group}` : `${USUAL_GROUP} — unconfirmed`,
    book: [book, booking?.phone || research?.phone || null].filter(Boolean).join(' · ') || null,
    bookUrl: booking?.booking_url || research?.booking_url || null,
    best, bestLine: best ? slotLine(best) : null,
    slots: c.fit.slots,
    fitLine: [fit?.line || (c.fit.reason ? `Doesn’t fit: ${c.fit.reason}` : ''), !c.known && fit ? 'times unconfirmed' : null].filter(Boolean).join(' · '),
    notForCount: fit?.notFor.length || 0,
    notFor: fit?.notFor || [], notForLine: fit ? notForLine(fit.notFor) : '',
    canArrive: c.canArrive, golfTotal: golf.total,
  };
}
/** Courses with a fitting time first (most people suited), then the rest; the day's own options before others on ties. */
export function rankRows(rows = []) {
  return [...rows].sort((a, b) => Number(!!b.best) - Number(!!a.best)
    || ((b.best?.suitsN || 0) - (a.best?.suitsN || 0))
    || (a.notFor.length - b.notFor.length)
    || Number(b.onDay) - Number(a.onDay));
}

/** What the organiser picked for a day, in words: "Leura GC, about 12:30pm (finish about 5:00pm)". */
export function pickLine(pick, courseMap = {}, golfTotal = 270) {
  if (!pick?.course_id) return null;
  const t = pick.tee ? Number(pick.tee.slice(0, 2)) * 60 + Number(pick.tee.slice(3, 5)) : null;
  return `${courseMap[pick.course_id]?.name || 'A course'}${t != null ? `, about ${hm(t)} (finish about ${hm(Math.round((t + golfTotal) / 5) * 5)})` : ''}`;
}
/**
 * The organiser picks a course and time for a day → the builder's state: the pick in st.dayPlan.picks, and the course
 * on that day's options (the same state "Courses & stays" uses). Still "about" — no tee times are booked or saved as
 * real ones. → { state, full: true when the day already had 4 options }
 */
export function applyPick(st = {}, day, { course, tee }) {
  const days = (st.days || []).map((d) => ({ ...d }));
  let row = days.find((d) => d.index === day.index && d.leg === day.slot);
  if (!row) { row = { index: day.index, leg: day.slot, options: [] }; days.push(row); }
  let full = false;
  if (course?.id && !(row.options || []).includes(course.id)) {
    if ((row.options || []).length >= TB.MAX_OPTIONS_PER_DAY) full = true;
    else row.options = [...(row.options || []), course.id];
  }
  const dp = st.dayPlan || {};
  const picks = { ...(dp.picks || {}) };
  if (course?.id) picks[day.index] = { course_id: course.id, tee: tee || null };
  else delete picks[day.index];
  const courses = course?.id && !st.courses?.[course.id] ? { ...(st.courses || {}), [course.id]: slimCourse(course) } : st.courses;
  return { state: { ...st, days: days.sort((a, b) => a.index - b.index), courses, dayPlan: { ...dp, picks } }, full };
}
const slimCourse = (c) => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng, area: c.area || null, mine_avg: c.mine_avg ?? null, others_avg: c.others_avg ?? null });

/** A day's golf/travel changed → the builder's days (golf none / 9 / 18 / 36, travel day or not). */
export function setDay(st = {}, day, patch = {}) {
  const has = (st.days || []).some((d) => d.index === day.index && d.leg === day.slot);
  const days = has ? st.days.map((d) => (d.index === day.index && d.leg === day.slot ? { ...d, ...patch } : d))
    : [...(st.days || []), { index: day.index, leg: day.slot, options: [], ...patch }];
  const clean = days.map((d) => {
    const x = { ...d };
    if (x.travel !== false) delete x.travel;
    return x;
  });
  return { ...st, days: clean.sort((a, b) => a.index - b.index) };
}
/**
 * "How much golf" for the trip → each day's golf (tripbuilder.golfForAmount). For 'max', 36 goes on a stay day only
 * when two rounds and lunch fit between leaving where we stay (7 am + 30 min) and dusk on that date.
 * → the new state (st.golfAmount kept too).
 */
export function applyGolfAmount(st = {}, amount = 'daily', { players = 8 } = {}) {
  const days = planDays(st);
  const at = centreOf(st.stays || []);
  const twoFits = (row) => {
    const d = days.find((x) => x.index === row.index);
    if (!d?.date || !at) return false;
    const sun = sunTimes(d.date, at.lat, at.lng);
    const two = dayGolfLength(st, { ...d, golf: '36' }, players).total;
    return !!sun && DEFAULT_LEAVE_STAY + 30 + two <= sun.sunset;
  };
  const rows = days.map((d) => ({ ...(st.days || []).find((x) => x.index === d.index && x.leg === d.slot), index: d.index, leg: d.slot, options: d.options }));
  const next = TB.golfForAmount(rows, amount, { twoFits });
  return { ...st, golfAmount: amount, days: next.map((d) => { const x = { ...d }; if (x.travel !== false) delete x.travel; return x; }) };
}
/** The trip's golf in one line, with who it doesn't suit (names for the organiser; counts for everyone else). */
export function scheduleLine(st = {}, { people = [], wishes = [], nameOf = (id) => id, names = false } = {}) {
  const days = planDays(st);
  const r = scheduleCheck(days.map((d) => d.rounds), { people, wishes });
  const no = r.no.map((n) => ({ ...n, name: nameOf(n.id) }));
  const tail = !no.length ? '' : names ? ` · Not for: ${no.map((n) => `${n.name} (${n.why})`).join(', ')}` : ` · not for ${no.length}`;
  return `${r.line}${tail}`;
}
// ------------------------------------------------------------------ the suggested plan (one line per day)

const shortDay = (d) => (d.date ? TB.dayLabel(d.date).split(' ')[0] : d.name);
const ROLE_WORD = { way: 'on the way', stay: 'near the stay', home: 'on the way home' };
/**
 * The weekend in one go: for each golf day the best-fitting course and time — suits the most wishes, clear of dusk,
 * the day's own courses first, never the same course twice unless there's nothing else. Days with the fewest choices
 * are filled first. ctx: as buildDay (all days share it).
 * → { days: [{ index, day, course_id, name, tee, finish, margin, homeAt, line, repeat, notFor }], line, notFor, none: [day names] }
 */
export function suggestPlan(days = [], ctx = {}) {
  const golfDays = days.filter((d) => d.golf !== 'none');
  const per = golfDays.map((d) => {
    const b = buildDay(d, ctx);
    const cands = b.rows.filter((r) => r.best).map((r) => {
      const s = r.best;
      const homeAt = d.leg === 'home' ? s.finish + (b.plan.courses.find((c) => c.id === r.id)?.driveHome || 0) : null;
      const score = (s.suitsN || 0) * 10 + (s.flag?.tone === 'ok' ? 6 : 0) + (r.onDay ? 3 : 0) - r.notForCount * 3 - (r.guess ? 1 : 0)
        - (d.leg === 'home' ? s.finish / 120 : 0);
      return { r, s, homeAt, score, sunset: b.plan.sun?.sunset ?? null };
    }).sort((a, c) => c.score - a.score);
    return { d, b, cands };
  });
  const used = new Set();
  const chosen = new Map();
  for (const x of [...per].sort((a, b) => a.cands.length - b.cands.length || a.d.index - b.d.index)) {
    const fresh = x.cands.find((c) => !used.has(c.r.id));
    const c = fresh || x.cands[0];
    if (!c) continue;
    used.add(c.r.id);
    chosen.set(x.d.index, { ...c, repeat: !fresh });
  }
  const notFor = new Map();
  const out = per.map(({ d }) => {
    const c = chosen.get(d.index);
    if (!c) return { index: d.index, day: shortDay(d), course_id: null, line: `${shortDay(d)}: nothing fits — see the day` };
    for (const n of c.r.notFor) notFor.set(n.id, { ...n, why: [...new Set([...(notFor.get(n.id)?.why || []), ...n.why.map((w) => `${w} (${shortDay(d)})`)])] });
    const margin = c.sunset != null ? c.sunset - c.s.finish : null;
    const bits = [ROLE_WORD[d.leg], `done ~${hm(Math.round(c.s.finish / 5) * 5)}`, margin != null ? (margin >= 0 ? `${dur(Math.round(margin / 5) * 5)} before dusk` : 'after dusk!') : null,
      c.repeat ? 'played twice' : null, c.r.guess ? 'times unconfirmed' : null].filter(Boolean);
    const tee = `${String(Math.floor(c.s.tee / 60)).padStart(2, '0')}:${String(c.s.tee % 60).padStart(2, '0')}`;
    return {
      index: d.index, day: shortDay(d), course_id: c.r.id, name: c.r.name, tee, teeMin: c.s.tee, finish: c.s.finish, margin, homeAt: c.homeAt, repeat: c.repeat,
      notFor: c.r.notFor, line: `${shortDay(d)}: ${c.r.name} ${hm(c.s.tee)} (${bits.join(', ')})${c.homeAt != null ? ` · home by ~${hm(Math.round(c.homeAt / 15) * 15)}` : ''}`,
    };
  });
  // A day with no golf still says so, in its place.
  const all = days.map((d) => out.find((x) => x.index === d.index) || { index: d.index, day: shortDay(d), course_id: null, line: `${shortDay(d)}: no golf`, off: true });
  return { days: all, line: all.map((x) => x.line).join(' · '), notFor: [...notFor.values()], none: all.filter((x) => !x.course_id && !x.off).map((x) => x.day) };
}
/** "Use this plan": every suggested day picked at once (still "about"). → { state, full: [day names that were full] } */
export function applySuggestion(st = {}, suggestion, { courseMap = {} } = {}) {
  let next = st;
  const full = [];
  for (const x of suggestion?.days || []) {
    if (!x.course_id) continue;
    const day = planDays(next).find((d) => d.index === x.index);
    const r = applyPick(next, day, { course: courseMap[x.course_id] || { id: x.course_id, name: x.name }, tee: x.tee });
    if (r.full) full.push(x.day); else next = r.state;
  }
  return { state: next, full };
}
/** One line for a collapsed course card: "The Vintage · 15 min off the way · 10am–1:30pm fit · suits 7 of 8 ★" */
export function cardLine(r, of = 0) {
  return [r.name, r.drive, r.fits ? `${r.fits} fit` : r.reason || 'no times fit', r.best ? `suits ${Math.max(0, of - r.notForCount)} of ${of}` : null].filter(Boolean).join(' · ') + (r.best?.best ? ' ★' : '');
}
export { dur };

// ------------------------------------------------------------------ a one-day round (call-out, 103)

export const PART_TEE = { morning: 7 * 60 + 30, midday: 11 * 60 + 30, arvo: 13 * 60, twilight: 15 * 60 + 30 };
/**
 * A one-day round's times, roughly: for each time on offer (or the locked one) — leave home, tee off, finish, dusk.
 *   plan: { status, start_date, tee_time }; options: plan_options rows ({ start_date, tee_time, part, label })
 *   place: the course { lat, lng } (for the sun); players: how many; homeDrive: minutes from my home area (or null)
 * → [{ key, label, date, tee, finish, leave, sun, flag, line, blocks }]
 */
export function calloutTimes({ plan = {}, options = [], place = null, players = 4, homeDrive = null, format = 'stableford' } = {}) {
  const locked = plan.status === 'confirmed' || plan.status === 'done';
  const list = locked || !options.length
    ? (plan.start_date ? [{ key: 'locked', date: String(plan.start_date).slice(0, 10), tee_time: plan.tee_time, part: null, label: null }] : [])
    : options.map((o) => ({ key: o.id, date: String(o.start_date || '').slice(0, 10), tee_time: o.tee_time, part: o.part, label: o.label }));
  const golf = golfLength({ format, players: Math.max(1, players) });
  return list.filter((o) => o.date).map((o) => {
    const tee = o.tee_time ? anyClockLocal(o.tee_time) : PART_TEE[o.part] ?? null;
    const sun = place ? sunTimes(o.date, place.lat, place.lng) : null;
    if (tee == null) return { ...o, tee: null, sun, line: 'Pick a time to see the day' };
    const finish = tee + golf.total;
    const flag = sun ? duskFlagLocal(finish, sun.sunset, sun.sunset - golf.total) : null;
    const leave = homeDrive != null ? tee - 30 - homeDrive : null;
    const blocks = [
      ...(leave != null ? [{ kind: 'travel', from: leave, to: leave + homeDrive, label: `Drive (about ${dur(homeDrive)})` }] : []),
      { kind: 'golf', from: tee, to: finish, label: `Golf: tee off ${hm(tee)}${o.tee_time ? '' : ' (roughly)'}` },
      ...(homeDrive != null ? [{ kind: 'travel', from: finish, to: finish + homeDrive, label: 'Drive home' }] : []),
    ];
    const line = [o.tee_time ? `Tee off ${hm(tee)}` : `${o.part ? `${o.part[0].toUpperCase()}${o.part.slice(1)}` : 'Tee off'}: about ${hm(tee)}`,
      `in about ${hm(Math.round(finish / 5) * 5)}`, leave != null ? `leave home about ${hm(Math.round(leave / 5) * 5)}` : null, flag?.text].filter(Boolean).join(' · ');
    return { ...o, tee, finish, leave, sun, flag, line, blocks };
  });
}
const anyClockLocal = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function duskFlagLocal(finish, sunset, latestTee) {
  const margin = sunset - finish;
  if (margin >= 30) return { tone: 'ok', margin, text: `about ${dur(Math.round(margin / 5) * 5)} before dusk ✓` };
  return { tone: margin >= 0 ? 'tight' : 'dark', margin, text: `${margin >= 0 ? 'tight' : 'finishes after dusk'} — tee off by ${hm(latestTee)} to finish before dusk` };
}
