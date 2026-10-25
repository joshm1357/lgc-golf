// Trip builder (077): build a trip day by day on one map. Pure functions only — the screen and the tests use these.
//
// Josh's order (22 Oct): 1 Area options & weekends (→ vote 1) → 2 Stay areas & course options per day → 3 Call the
// courses for tee times on the settled weekend(s) → 4 Configurations (→ vote 2 "Which trip?") → lock it in.
//
//   * Days come from the trip's nights: day 1 is "on the way" (courses near the drive from home to where we stay),
//     the middle days are "stay days" (courses within X minutes of the stay areas, shown as a range across them) and
//     the last day is "on the way home".
//   * Drives are always "about": straight line × 1.3 at 80 km/h (lib/tripfinder.js). A later step adds road times.
//   * Tee times needed = players ÷ 4, rounded up. A course counts for a day only if it has that many tee times in a
//     row ("consecutive": no more than 12 minutes apart) on that DATE.
//   * A configuration = a weekend + a stay area + one course and tee-time block each day. Ranked by fewest days with
//     no golf, then the drive (less is better) and the group's votes (more is better).
import { km, driveMinutes, fmtDrive, parseTimes, parseClock, yesNo } from './tripfinder.js';
import { clock, toMin } from './teeWindow.js';
import { fromBuilder } from './tripsteps.js';
import { playing } from './headcount.js';

export const MAX_STAYS = 3;
export const MAX_OPTIONS_PER_DAY = 4;
export const MAX_WEEKENDS = 26; // ov23: the shortlist can be any of the weekends in the window (half a year of them)
export const DEFAULT_STAY_MAX = 40;    // minutes from where we stay, on stay days
export const DEFAULT_DETOUR_MAX = 25;  // extra minutes off the straight drive, on the way there / home
export const CONSECUTIVE_GAP = 12;     // tee times this close (minutes) count as "in a row"
export const FEATURES = ['links', 'parkland', 'water views', 'resort', 'stay & play', 'carts', 'driving range', 'restaurant', 'bar', 'good value', 'tough', 'easy walk'];
export const BOOKING_METHODS = [{ value: 'phone', label: 'Phone' }, { value: 'online', label: 'Online' }, { value: 'email', label: 'Email' }];

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ------------------------------------------------------------------ dates

const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function dateOf(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}
export function addDays(iso, n) {
  const d = dateOf(iso);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
/** '2026-03-13' → 'Fri 13 Mar' */
export function dayLabel(iso) {
  const d = dateOf(iso);
  return d ? `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` : '';
}

/** Easter Sunday (Gregorian), as an ISO date. */
export function easterSunday(y) {
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100; const d = Math.floor(b / 4); const e = b % 4;
  const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(month)}-${pad(day)}`;
}
function nthMonday(y, month, n) {
  const d = new Date(y, month - 1, 1);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 7 * (n - 1));
  return isoOf(d);
}
/** A fixed-date holiday on a weekend moves to the Monday (Christmas/Boxing Day: Mon and Tue). */
function observed(iso, taken) {
  let d = dateOf(iso);
  while (d.getDay() === 0 || d.getDay() === 6 || taken.has(isoOf(d))) d.setDate(d.getDate() + 1);
  return isoOf(d);
}

/** NSW public holidays for a year (national + NSW Labour Day): { 'YYYY-MM-DD': 'Name' }. Weekday holidays only matter. */
export function publicHolidays(y) {
  const out = {};
  const taken = new Set();
  const add = (iso, name) => { out[iso] = name; taken.add(iso); };
  add(observed(`${y}-01-01`, taken), 'New Year’s Day');
  add(observed(`${y}-01-26`, taken), 'Australia Day');
  const easter = easterSunday(y);
  add(addDays(easter, -2), 'Good Friday');
  add(addDays(easter, 1), 'Easter Monday');
  add(`${y}-04-25`, 'Anzac Day');
  add(nthMonday(y, 6, 2), 'King’s Birthday');
  add(nthMonday(y, 10, 1), 'Labour Day');
  const xmas = observed(`${y}-12-25`, taken); add(xmas, 'Christmas Day');
  add(observed(`${y}-12-26`, taken), 'Boxing Day');
  return out;
}
const holidayOn = (iso) => publicHolidays(Number(String(iso).slice(0, 4)))[iso] || null;

/**
 * The next weekends to offer, from `from` (default 4 weeks from today). nights 1 = Sat–Sun, 2 = Fri–Sun (default),
 * 3 = Fri–Mon or Thu–Sun. A weekend next to a public holiday is a "long weekend": left out unless includeLong (and for
 * a 3-night trip, long weekends are what's offered first). Returns [{ start, end, nights, long, holiday, label }].
 */
export function weekendOptions({ from, today = new Date(), count = 6, nights = 2, includeLong = false } = {}) {
  const start = dateOf(from) || (() => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate()); d.setDate(d.getDate() + 28); return d; })();
  const fri = new Date(start);
  while (fri.getDay() !== 5) fri.setDate(fri.getDate() + 1);
  const n = Math.max(1, Math.min(4, Number(nights) || 2));
  const out = [];
  for (let i = 0; i < 52 && out.length < count; i++) {
    const f = isoOf(fri);
    fri.setDate(fri.getDate() + 7);
    const thu = addDays(f, -1); const mon = addDays(f, 3);
    const hol = holidayOn(f) || holidayOn(mon) || holidayOn(thu) || holidayOn(addDays(f, 1)) || holidayOn(addDays(f, 2));
    const long = !!(holidayOn(f) || holidayOn(mon));
    if (long && !includeLong && n < 3) continue;
    let s; let e;
    if (n === 1) { s = addDays(f, 1); e = addDays(f, 2); } else if (n === 2) { s = f; e = addDays(f, 2); } else if (n === 3) {
      if (holidayOn(f) && !holidayOn(mon)) { s = thu; e = addDays(f, 2); } else { s = f; e = mon; }
      if (!long && !includeLong) continue; // a 3-night trip: long weekends only, unless asked
    } else { s = thu; e = mon; }
    out.push({ start: s, end: e, nights: n, long, holiday: long ? hol : null, label: weekendLabel({ start: s, end: e, long, holiday: hol }) });
  }
  return out;
}
/** 'Fri 13 – Sun 15 Mar' (+ ' · long weekend (King’s Birthday)') */
export function weekendLabel(w) {
  if (!w?.start) return '';
  const a = dateOf(w.start); const b = dateOf(w.end || w.start);
  const left = a.getMonth() === b.getMonth() ? `${DOW[a.getDay()]} ${a.getDate()}` : dayLabel(w.start);
  return `${left} – ${dayLabel(w.end || w.start)}${w.long ? ` · long weekend${w.holiday ? ` (${w.holiday})` : ''}` : ''}`;
}
export function nightsOf(w) {
  const a = dateOf(w?.start); const b = dateOf(w?.end);
  return a && b ? Math.round((b - a) / 86400000) : 0;
}

// ------------------------------------------------------------------ days

/** nights → the days: [{ index, leg: 'way' | 'stay' | 'home', name }]. 0 nights = one stay day. */
export function tripDays(nights) {
  const n = Math.max(0, Math.min(6, Math.round(Number(nights) || 0)));
  if (n === 0) return [{ index: 0, leg: 'stay', name: 'The day' }];
  return Array.from({ length: n + 1 }, (_, i) => ({
    index: i,
    leg: i === 0 ? 'way' : i === n ? 'home' : 'stay',
    name: i === 0 ? 'Day 1 — on the way' : i === n ? `Day ${i + 1} — on the way home` : `Day ${i + 1} — stay day`,
  }));
}
export const dayDate = (w, index) => (w?.start ? addDays(w.start, index) : null);

// ov40 (Josh 25 Oct: "there's no way to select which rounds to play golf … it should be each day"): every day says
// how much golf — none / 9 / 18 / 36 (two rounds) — and whether it's a travel day. Default: 18 holes every day, day 1
// a round on the way there, the last day a round on the way home. Old saved days have no `golf` → 18.
export const GOLF_CHOICES = [
  { value: 'none', label: 'No golf' }, { value: '9', label: '9 holes' }, { value: '18', label: '18 holes' }, { value: '36', label: '36 (two rounds)' },
];
/** A day's golf: 'none' | '9' | '18' | '36' (default '18'). */
export const dayGolf = (d) => (['none', '9', '18', '36'].includes(String(d?.golf)) ? String(d.golf) : '18');
/** Rounds that day: 0, 1 or 2. */
export const dayRounds = (d) => ({ none: 0, 9: 1, 18: 1, 36: 2 }[dayGolf(d)]);
/** The day's role: its slot ('way' / 'home' on the first and last day) unless the organiser said it isn't a travel
 *  day (d.travel === false → a stay day, e.g. they drive up the night before). */
export const dayLeg = (d) => (d?.leg !== 'stay' && d?.travel === false ? 'stay' : d?.leg || 'stay');
// How much golf (Josh 25 Oct; the same words as plan_wishes.golf_per_day): 'max' (as much as possible) | 'daily' (a
// round a day) | 'spare_day' (leave a spare day) | 'any' (not fussed).
export const GOLF_AMOUNTS = [
  { value: 'daily', label: 'A round a day' }, { value: 'max', label: 'As much as possible' },
  { value: 'spare_day', label: 'Leave a spare day' }, { value: 'any', label: 'Not fussed' },
];
/**
 * Each day's golf from how much golf the group wants. 'max': 36 on stay days where daylight allows (twoFits(day) says
 * so), else 18; 'spare_day': one day with no golf — the middle stay day (a 2-day trip: the last day); otherwise 18 a
 * day. Days are the builder's st.days rows; their courses are kept.
 */
export function golfForAmount(days = [], amount = 'daily', { twoFits = () => false } = {}) {
  const sorted = [...days].sort((a, b) => a.index - b.index);
  const stayDays = sorted.filter((d) => dayLeg(d) === 'stay');
  let spare = null;
  if (amount === 'spare_day' && sorted.length >= 2) spare = (stayDays.length ? stayDays[Math.floor((stayDays.length - 1) / 2)] : sorted[sorted.length - 1]).index;
  return sorted.map((d) => {
    let golf = '18';
    if (d.index === spare) golf = 'none';
    else if (amount === 'max' && dayLeg(d) === 'stay' && twoFits(d)) golf = '36';
    return { ...d, golf };
  });
}
/** The group's most common answer (leaving out "not fussed"), else 'daily'. */
export function golfAmountFromWishes(wishes = []) {
  const c = {};
  for (const w of wishes) if (w?.golf_per_day && w.golf_per_day !== 'any') c[w.golf_per_day] = (c[w.golf_per_day] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1] || (a[0] === 'daily' ? -1 : 1))[0]?.[0] || 'daily';
}
/** Are they flying? (the trip idea's travel, or the day plan's own setting) */
export const isFly = (st = {}) => (st.dayPlan?.travel?.mode || st.travel) === 'fly';
/** "On the way there · 18 holes" */
export function dayRoleLine(d) {
  const leg = dayLeg(d);
  const role = leg === 'way' ? 'On the way there' : leg === 'home' ? 'On the way home' : 'Stay day';
  return `${role} · ${GOLF_CHOICES.find((g) => g.value === dayGolf(d)).label}`;
}

// ------------------------------------------------------------------ areas

/** Stay areas → regions: [{ region, state, lat, lng, towns: [names] }]. */
export function regionsFrom(stayAreas = []) {
  const by = new Map();
  for (const a of stayAreas) {
    const r = by.get(a.region) || { region: a.region, state: a.state, towns: [], lat: 0, lng: 0 };
    r.towns.push(a.name); r.lat += a.lat; r.lng += a.lng;
    by.set(a.region, r);
  }
  return [...by.values()].map((r) => ({ ...r, lat: r.lat / r.towns.length, lng: r.lng / r.towns.length }));
}
/** "south coast" / "nowra" → regions whose name or a town matches. Best (name starts with it) first. */
export function matchRegions(query, stayAreas = []) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  return regionsFrom(stayAreas)
    .map((r) => ({ r, s: r.region.toLowerCase().startsWith(q) ? 0 : r.region.toLowerCase().includes(q) ? 1 : r.towns.some((t) => t.toLowerCase().includes(q)) ? 2 : 9 }))
    .filter((x) => x.s < 9).sort((a, b) => a.s - b.s || a.r.region.localeCompare(b.r.region)).map((x) => x.r);
}
/** A region's towns, the ones with most courses within `withinMin` first: [{ ...stayArea, courses }]. */
export function suggestStays(region, stayAreas = [], courses = [], withinMin = 30) {
  return stayAreas.filter((a) => a.region === region)
    .map((a) => ({ ...a, courses: courses.filter((c) => c.lat != null && driveMinutes(km(a, c)) <= withinMin).length }))
    .sort((x, y) => y.courses - x.courses || (x.sort ?? 0) - (y.sort ?? 0));
}
/** One line for an area option: "Nowra, Jervis Bay, Ulladulla · 12 courses nearby · about 2 h 30 drive". */
export function areaLine(region, { courses = [], origin = null } = {}) {
  const near = courses.filter((c) => c.lat != null && driveMinutes(km(region, c)) <= 60).length;
  const drive = origin ? driveMinutes(km(origin, region)) : null;
  return [region.towns.slice(0, 3).join(', '), near ? `${near} course${near === 1 ? '' : 's'} nearby` : null, drive != null ? `about ${fmtDrive(drive)} drive` : null].filter(Boolean).join(' · ');
}
/** The box to search for courses around some points (km of margin). */
export function boxAround(points, marginKm = 60) {
  const p = (points || []).filter((x) => x && x.lat != null);
  if (!p.length) return null;
  const dLat = marginKm / 111;
  const lat = p.reduce((a, x) => a + x.lat, 0) / p.length;
  const dLng = marginKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    south: Math.min(...p.map((x) => x.lat)) - dLat, north: Math.max(...p.map((x) => x.lat)) + dLat,
    west: Math.min(...p.map((x) => x.lng)) - dLng, east: Math.max(...p.map((x) => x.lng)) + dLng,
    lat, lng: p.reduce((a, x) => a + x.lng, 0) / p.length,
  };
}

// ------------------------------------------------------------------ drives

export const driveBetween = (a, b) => driveMinutes(km(a, b));
/** Extra minutes a course adds to the drive from `from` to `to` (never below 0). */
export function detourMin(from, course, to) {
  if (!from || !course || !to) return null;
  return Math.max(0, driveBetween(from, course) + driveBetween(course, to) - driveBetween(from, to));
}
/** '15–35 min' (or '20 min' when they're the same). */
export function rangeText(min, max) {
  if (min == null) return '?';
  if (min === max || max == null) return fmtDrive(min);
  return max < 60 ? `${Math.round(min)}–${fmtDrive(max)}` : `${fmtDrive(min)}–${fmtDrive(max)}`;
}
/** A course's drive across the selected stay areas, for one leg: { min, max, text, per: { key: minutes } }. */
export function legDrive(leg, course, { origin, stays = [] } = {}) {
  const per = {};
  for (const s of stays) per[s.key || s.name] = leg === 'stay' ? driveBetween(s, course) : detourMin(origin, course, s);
  const vals = Object.values(per).filter((v) => v != null);
  if (!vals.length) return { min: null, max: null, text: '?', per };
  const min = Math.min(...vals); const max = Math.max(...vals);
  const text = leg === 'stay' ? rangeText(min, max) : `${rangeText(min, max)} off the way`;
  return { min, max, text, per };
}
/** Does a course fit this leg (from at least one stay area)? */
export function fitsLeg(leg, drive, { stayMax = DEFAULT_STAY_MAX, detourMax = DEFAULT_DETOUR_MAX } = {}) {
  if (drive?.min == null) return false;
  return drive.min <= (leg === 'stay' ? stayMax : detourMax);
}

// ------------------------------------------------------------------ what we know about a course

/**
 * The group's history on a library course: rounds on the group's copies of it, by trip, newest first.
 * → { count, trips: [{ name, year, date, trophies: ['BD won by Kurt'] }], last, recentYears, text }
 */
export function playedHistory(libraryId, { courses = [], rounds = [], trips = [], honour = [], today = isoOf(new Date()) } = {}) {
  const mine = new Set(courses.filter((c) => c.library_id === libraryId).map((c) => c.id));
  // Only rounds actually played: before today, and not still being set up (a trip just built isn't "played").
  const played = rounds.filter((r) => mine.has(r.course_id) && r.status !== 'setup' && String(r.play_date || '9999') < today);
  const byTrip = new Map();
  for (const r of played) {
    const t = trips.find((x) => x.id === r.trip_id);
    const k = t?.id || `round:${r.id}`;
    const date = String(r.play_date || t?.start_date || '').slice(0, 10) || null;
    const cur = byTrip.get(k) || { id: t?.id || null, name: t?.name || 'A round', date: null };
    if (date && (!cur.date || date > cur.date)) cur.date = date;
    byTrip.set(k, cur);
  }
  const list = [...byTrip.values()].map((t) => ({
    ...t, year: t.date ? Number(t.date.slice(0, 4)) : null,
    trophies: honour.filter((h) => t.id && h.trip_id === t.id).slice(0, 2).map((h) => `${h.trophy_name} won by ${h.winner_names}`),
  })).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const last = list[0] || null;
  const text = !last ? null : [`Played ${last.year || ''} ${last.name}`.replace(/\s+/g, ' ').trim(), list.length > 1 ? `${list.length} trips` : null, last.trophies[0] || null].filter(Boolean).join(' · ');
  return { count: played.length, trips: list, last, text };
}
/** "Played 2023 · ★4.5" — the short line on a pin. */
export function shortKnown(c, history) {
  const stars = c?.mine_avg != null ? `★${Number(c.mine_avg).toFixed(1)}` : c?.others_avg != null ? `★${Number(c.others_avg).toFixed(1)} (other groups)` : null;
  return [history?.last?.year ? `Played ${history.last.year}` : history?.count ? 'Played before' : 'Not played before', stars].filter(Boolean).join(' · ');
}

/** Visitors that day? true / false / null (don't know), from booking info, else the shared facts. */
export function visitorsOn(dayIndexOfWeek, { booking = null, facts = {} } = {}) {
  const vt = booking?.visitor_times || facts.visitor_times?.value;
  if (vt) {
    const slots = parseTimes(vt);
    if (slots.length) return slots.some((s) => s.days.includes(dayIndexOfWeek));
  }
  const mt = booking?.member_times || facts.member_times?.value;
  if (mt) {
    const slots = parseTimes(mt).filter((s) => s.days.includes(dayIndexOfWeek));
    if (slots.some((s) => s.from <= 7 * 60 && s.to >= 15 * 60)) return false;
  }
  return null;
}
export function isStayPlay(booking, facts = {}) {
  return (booking?.features || []).includes('stay & play') || yesNo(facts.stay_play?.value) === true;
}

/**
 * Rank a day's course candidates. cand: { course, drive: { min, max, text }, booking, history, facts }.
 * opts: { leg, dow (0–6 or null), votes: { course_id: score }, filters: { notPlayed, favourites, stayPlay }, today }.
 * Score (higher first): closer is better; our favourites (★4+) up; other groups' ★4+ a little up; played in the last
 * two years a little down unless a favourite; visitors that day up, members-only down; votes from vote 1 up.
 */
export function rankCandidates(cands, { leg = 'stay', dow = null, votes = {}, filters = {}, today = new Date() } = {}) {
  const year = today.getFullYear();
  const keep = (c) => {
    if (filters.notPlayed && c.history?.count) return false;
    if (filters.favourites && !(Number(c.course.mine_avg) >= 4)) return false;
    if (filters.stayPlay && !isStayPlay(c.booking, c.facts)) return false;
    return true;
  };
  return cands.filter(keep).map((c) => {
    const why = [];
    let score = 100 - (c.drive?.min ?? 60) * (leg === 'stay' ? 0.8 : 1);
    const mine = c.course.mine_avg != null ? Number(c.course.mine_avg) : null;
    const others = c.course.others_avg != null ? Number(c.course.others_avg) : null;
    const fav = mine != null && mine >= 4;
    if (fav) { score += 25; why.push('our favourite'); } else if (mine != null && mine < 3) { score -= 10; } else if (others != null && others >= 4) { score += 8; why.push('rated well by other groups'); }
    const lastYear = c.history?.last?.year;
    if (lastYear && year - lastYear <= 2 && !fav) { score -= 12; why.push('played recently'); }
    if (!c.history?.count) why.push('not played before');
    const v = dow == null ? null : visitorsOn(dow, { booking: c.booking, facts: c.facts || {} });
    if (v === true) { score += 10; why.push('visitors welcome'); } else if (v === false) { score -= 40; why.push('members only that day'); }
    const vote = Number(votes[c.course.id]) || 0;
    if (vote) { score += vote * 5; why.push(`${vote} vote point${vote === 1 ? '' : 's'}`); }
    return { ...c, score: Math.round(score * 10) / 10, why };
  }).sort((a, b) => b.score - a.score || String(a.course.name).localeCompare(String(b.course.name)));
}

// ------------------------------------------------------------------ tee times

/** How many tee times: players ÷ 4, rounded up. People: the one headcount rule (lib/headcount.js) — the target set,
 *  else those "in", else in + maybe, else the group (when players are passed). */
export function teeTimesNeeded({ rsvps = [], override = null, players = [], overrideBy = null } = {}) {
  const p = playing({ target: override, targetBy: overrideBy, rsvps, players });
  const source = p.source === 'target' || p.source === 'ai' ? 'set' : p.source;
  return { people: p.people, needed: p.needed, source, label: p.label };
}
/** '10:20, 10:30 10:40' / '7am 7:10am' → ['07:00', …] sorted, no repeats. Anything unreadable is left out. */
export function parseTeeTimes(text) {
  const out = new Set();
  for (const bit of String(text || '').split(/[\s,;/]+/)) {
    const m = parseClock(bit);
    if (m != null && m >= 5 * 60 && m <= 19 * 60) out.add(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return [...out].sort();
}
/** First time + how many + the gap → the times ('10:20', 3, 10 → ['10:20', '10:30', '10:40']). */
export function teeBlock(first, count, gap = 10) {
  const a = toMin(first) ?? parseClock(first);
  const n = Math.max(0, Math.min(20, Math.round(Number(count) || 0)));
  if (a == null || !n) return [];
  return Array.from({ length: n }, (_, i) => { const m = a + i * (Number(gap) || 10); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; });
}
/** The first run of `needed` times in a row (each within CONSECUTIVE_GAP of the last) starting at or after `earliest`. */
export function bestBlock(times, needed, { earliest = 0, gap = CONSECUTIVE_GAP } = {}) {
  const t = [...new Set((times || []).map((x) => toMin(x)).filter((x) => x != null))].sort((a, b) => a - b);
  if (!needed || !t.length) return null;
  for (let i = 0; i + needed <= t.length; i++) {
    if (t[i] < earliest) continue;
    let ok = true;
    for (let j = i + 1; j < i + needed; j++) if (t[j] - t[j - 1] > gap) { ok = false; break; }
    if (ok) return { from: t[i], to: t[i + needed - 1], times: t.slice(i, i + needed).map(clockText), text: needed === 1 ? clock(t[i]) : `${clock(t[i])}–${clock(t[i + needed - 1])}` };
  }
  return null;
}
const clockText = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/**
 * The earliest sensible first tee: on the way, leave home at 6:00 (or the starting point's time) + the drive + 30 min;
 * other days, leave where we stay at 6:30 + the drive + 30 min. Minutes after midnight.
 */
export function earliestTee(leg, driveMin, { leave = '06:00', stayLeave = '06:30' } = {}) {
  const from = toMin(leg === 'way' ? leave : stayLeave) ?? 360;
  return from + Math.max(0, Math.round(Number(driveMin) || 0)) + 30;
}
/** Round a time up to the next 10 minutes: tee sheets go in 10s. */
const up10 = (m) => Math.ceil(m / 10) * 10;

// ------------------------------------------------------------------ "Call the course" jobs

/**
 * One job per course: the dates to ask about (each day it's an option, on every settled weekend) and the earliest
 * time. → [{ course_id, name, title, body, lines: [{ index, dates, from }] }]
 *   days: [{ index, leg, options: [course_id] }]   weekends: [{ start, end }]   courses: { id: { name, lat, lng } }
 */
export function callJobs({ days = [], weekends = [], courses = {}, needed = 1, origin = null, stays = [], booking = {}, note = null }) {
  const by = new Map();
  for (const d0 of days) {
    if (dayGolf(d0) === 'none') continue;
    const d = { ...d0, leg: dayLeg(d0) };
    for (const id of d.options || []) {
      const c = courses[id];
      if (!c) continue;
      const drive = d.leg === 'way' ? (origin ? driveBetween(origin, c) : 0)
        : Math.min(...(stays.length ? stays.map((s) => driveBetween(s, c)) : [0]));
      const from = up10(earliestTee(d.leg, drive));
      const dates = weekends.map((w) => dayDate(w, d.index)).filter(Boolean);
      if (!dates.length) continue;
      const cur = by.get(id) || { course_id: id, name: c.name, lines: [] };
      cur.lines.push({ index: d.index, dates, from });
      by.set(id, cur);
    }
  }
  return [...by.values()].map((j) => {
    const n = Math.max(1, needed);
    const ask = j.lines.map((l) => `${l.dates.map(dayLabel).join(' or ')} from ${clock(l.from)}`).join('; ');
    const b = booking[j.course_id] || {};
    const how = [b.phone ? `Phone ${b.phone}` : null, b.booking_url ? `Book online: ${b.booking_url}` : null, b.email ? `Email ${b.email}` : null,
      b.visitor_times ? `Visitor times: ${b.visitor_times}` : null, b.max_group ? `Largest group: ${b.max_group}` : null].filter(Boolean);
    return {
      ...j,
      title: `📞 Call ${j.name} — ask for ${n} tee time${n === 1 ? '' : 's'} in a row on ${ask}`.slice(0, 300),
      // note (ov23): "Primary: Fri 6 – Sun 8 Mar; Backup: Fri 13 – Sun 15 Mar" — ask about both.
      body: [...(note ? [note] : []), `Ask what they have — ${n} tee time${n === 1 ? '' : 's'} in a row (we’re ${n * 4 - 3}–${n * 4}).`, ...how,
        'Then put the times in on the trip (Trip → Plan the trip → Call the courses). Nothing is booked yet.'].join('\n'),
    };
  });
}

// ------------------------------------------------------------------ configurations

/**
 * Every workable trip: (weekend, stay area, one course + tee-time block per day).
 *   weekends: [{ start, end }]        stays: [{ key, name, lat, lng }]
 *   days: [{ index, leg, options: [course_id] }]   (a day with no options = no golf that day)
 *   courses: { id: { id, name, lat, lng } }        origin: { lat, lng } (where people come from)
 *   tees: [{ play_date, course_id, times: ['10:20', …] }]
 *   needed: tee times needed         stayMax / detourMax: minutes
 *   votes: { 'weekend:<start>': n, 'stay:<key>': n, 'course:<index>:<id>': n }
 * A course counts on a day only if it fits the drive for THAT stay area and has `needed` tee times in a row on THAT
 * date (on the way: after the earliest you could get there). A day with options but none workable is a gap.
 * Ranked: fewest gaps, then (total drive − 10 × votes), then the earliest weekend.
 */
export function buildConfigurations({ weekends = [], stays = [], days = [], courses = {}, origin = null, tees = [], needed = 1,
  stayMax = DEFAULT_STAY_MAX, detourMax = DEFAULT_DETOUR_MAX, votes = {}, limit = 30, fly = false } = {}) {
  const teeAt = new Map(tees.map((t) => [`${String(t.play_date).slice(0, 10)}|${t.course_id}`, t.times || []]));
  const out = [];
  for (const w of weekends) {
    for (const s of stays) {
      const perDay = days.filter((d) => dayGolf(d) !== 'none').map((d0) => {
        // ov40: flying, the first and last days are played near where we stay (the airport end), not off a drive.
        const d = { ...d0, leg: fly ? 'stay' : dayLeg(d0) };
        const date = dayDate(w, d.index);
        const choices = [];
        for (const id of d.options || []) {
          const c = courses[id];
          if (!c || c.lat == null) continue;
          const drive = d.leg === 'stay' ? driveBetween(s, c) : detourMin(origin || s, c, s);
          if (drive == null || drive > (d.leg === 'stay' ? stayMax : detourMax)) continue;
          const earliest = d.leg === 'way' && origin ? earliestTee('way', driveBetween(origin, c)) : 0;
          const block = bestBlock(teeAt.get(`${date}|${id}`), needed, { earliest });
          if (!block) continue;
          choices.push({ index: d.index, leg: d.leg, date, course_id: id, name: c.name, block, drive });
        }
        return choices.length ? choices : [{ index: d.index, leg: d.leg, date, course_id: null, name: null, block: null, drive: 0, gap: (d.options || []).length > 0 }];
      });
      // Every combination (capped by the options per day).
      let combos = [[]];
      for (const ch of perDay) {
        const next = [];
        for (const c of combos) for (const x of ch) next.push([...c, x]);
        combos = next.slice(0, 5000);
      }
      for (const rounds of combos) {
        const golf = rounds.filter((r) => r.course_id);
        if (!golf.length) continue;
        // ov40: the same course twice is allowed only when there aren't enough courses to go round (a 6-day trip with 5
        // courses) — and ranked after every way that doesn't repeat.
        const repeats = golf.length - new Set(golf.map((r) => r.course_id)).size;
        const distinct = new Set(perDay.flatMap((ch) => ch.map((x) => x.course_id).filter(Boolean))).size;
        if (repeats && distinct >= golf.length) continue;
        const gaps = rounds.filter((r) => !r.course_id && r.gap).length;
        const totalDrive = golf.reduce((n, r) => n + (r.drive || 0), 0);
        const v = (Number(votes[`weekend:${w.start}`]) || 0) + (Number(votes[`stay:${s.key || s.name}`]) || 0)
          + golf.reduce((n, r) => n + (Number(votes[`course:${r.index}:${r.course_id}`]) || 0), 0);
        const c = { key: `${w.start}|${s.key || s.name}|${rounds.map((r) => r.course_id || '-').join(',')}`, weekend: w, stay: s, rounds, gaps, repeats, totalDrive, votes: v };
        out.push({ ...c, text: configText(c) });
      }
    }
  }
  return out.sort((a, b) => a.gaps - b.gaps || a.repeats - b.repeats || (a.totalDrive - 10 * a.votes) - (b.totalDrive - 10 * b.votes)
    || String(a.weekend.start).localeCompare(String(b.weekend.start)) || a.key.localeCompare(b.key)).slice(0, limit);
}
/**
 * O4 (Josh's walkthrough): Pick & lock in shows the BEST way to do it as one summary card — each day's course and
 * tee times, a rough cost each, the driving from where we stay — with one "Lock this in". The rest are "other ways".
 *   configs: buildConfigurations() (best first); tees: trip_tee_options rows (their price each);
 *   accom: the accommodation ideas (plan_stays: the cheapest total ÷ people); people: the one headcount number.
 * → null, or { best, rounds: [{ date, day, name, time, price }], golfEach, stayEach, costEach, drive, others,
 *   alsoWorks: a different weekend that works too (or null) }
 */
export function pickSummary(configs = [], { tees = [], accom = [], people = 0 } = {}) {
  const best = (configs || [])[0];
  if (!best) return null;
  const price = new Map((tees || []).map((t) => [`${String(t.play_date).slice(0, 10)}|${t.course_id}`, t.price != null ? Number(t.price) : null]));
  const rounds = best.rounds.map((r) => {
    const d = dateOf(r.date);
    return { date: r.date, day: d ? `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` : `Day ${r.index + 1}`, name: r.name || null, time: r.block?.text || null, price: r.course_id ? price.get(`${r.date}|${r.course_id}`) ?? null : null };
  });
  const golf = rounds.filter((r) => r.name);
  const golfEach = golf.length && golf.every((r) => r.price != null) ? golf.reduce((n, r) => n + r.price, 0) : null;
  const totals = (accom || []).map((a) => Number(a.total_cost)).filter((n) => Number.isFinite(n) && n > 0);
  const stayEach = totals.length && people > 0 ? Math.round(Math.min(...totals) / people) : null;
  const costEach = golfEach != null || stayEach != null ? Math.round((golfEach || 0) + (stayEach || 0)) : null;
  const also = (configs || []).find((c) => c.weekend.start !== best.weekend.start && !c.gaps);
  return {
    best, rounds, golfEach, stayEach, costEach, drive: best.totalDrive, others: (configs || []).slice(1),
    alsoWorks: also ? also.weekend : null,
  };
}

/** "about $450 each (golf $230 + stay $220)" / "golf about $230 each" / null. */
export function costLine(s) {
  if (!s || s.costEach == null) return null;
  if (s.golfEach != null && s.stayEach != null) return `about $${s.costEach} each (golf $${Math.round(s.golfEach)} + stay $${s.stayEach})`;
  return s.golfEach != null ? `golf about $${Math.round(s.golfEach)} each` : `stay about $${s.stayEach} each`;
}

/** "Stay Nowra · Fri Shoalhaven Heads 10:20–10:40 · Sat Nowra GC 8:00–8:20 · Sun Mollymook 9:10–9:30 on the way home" */
export function configText(c) {
  const bits = [`Stay ${c.stay.name}`];
  for (const r of c.rounds) {
    const d = dateOf(r.date);
    const day = d ? DOW[d.getDay()] : `Day ${r.index + 1}`;
    if (!r.course_id) { bits.push(`${day} no golf`); continue; }
    bits.push(`${day} ${r.name} ${r.block.text}${r.leg === 'home' ? ' on the way home' : r.leg === 'way' ? ' on the way' : ''}`);
  }
  return bits.join(' · ');
}

// ------------------------------------------------------------------ formats and filling the trip

/**
 * The group's usual formats for n golf days, from history: if their trips usually end with an Ambrose, the last day is
 * Ambrose and the rest are the group's most common other format (Stableford if unsure).
 */
export function usualFormats(n, { trips = [], rounds = [] } = {}) {
  const count = Math.max(0, Number(n) || 0);
  if (!count) return [];
  const multi = trips.map((t) => rounds.filter((r) => r.trip_id === t.id).sort((a, b) => String(a.play_date || '').localeCompare(String(b.play_date || ''))))
    .filter((rs) => rs.length >= 2);
  let lastAmbrose = count >= 2;
  let main = 'stableford';
  if (multi.length) {
    lastAmbrose = count >= 2 && multi.filter((rs) => rs[rs.length - 1].format === 'ambrose').length * 2 >= multi.length;
    const tally = {};
    for (const rs of multi) for (const r of rs.slice(0, -1)) tally[r.format] = (tally[r.format] || 0) + 1;
    main = Object.entries(tally).filter(([f]) => f !== 'ambrose').sort((a, b) => b[1] - a[1])[0]?.[0] || 'stableford';
  }
  return Array.from({ length: count }, (_, i) => (lastAmbrose && i === count - 1 ? 'ambrose' : main));
}

/**
 * The trip's "shape" from a configuration (plans.repeat_shape — what "Set it up in the app" fills the rounds from).
 * courseIds: { libraryId: the group's own course id }. Keeps side comps / games from an old shape on the same day and
 * course ("Same as last time"). Days with no golf are left out.
 */
export function shapeFromConfig(config, { courseIds = {}, formats = [], oldShape = null, days = [] } = {}) {
  // ov40: a 36-hole day is two rounds on that day (the second on the same course, its tee times to come); 9 holes
  // says so (holes: 9).
  const golf = config.rounds.filter((r) => r.course_id).flatMap((r) => {
    const g = dayGolf(days.find((d) => d.index === r.index) || {});
    return g === '36' ? [r, { ...r, second: true, block: null }] : [{ ...r, ...(g === '9' ? { holes: 9 } : {}) }];
  });
  const rounds = golf.map((r, i) => {
    const course = courseIds[r.course_id] || null;
    const old = (oldShape?.rounds || []).find((x) => x.day === r.index && x.course_id === course && !!x.second === !!r.second);
    return { ...(old || {}), day: r.index, course_id: course, format: formats[i] || old?.format || 'stableford', tee_times: r.block?.times || [], ...(r.second ? { second: true } : {}), ...(r.holes ? { holes: r.holes } : {}) };
  }).filter((r) => r.course_id);
  return { ...(oldShape || {}), v: 1, from_builder: config.key, rounds };
}

// ------------------------------------------------------------------ votes

/** Vote points per key: ✓ = 2, ? = 1. optionKeys: { option_id: key }. */
export function votePoints(optionKeys = {}, votes = []) {
  const out = {};
  for (const v of votes) {
    const k = optionKeys[v.option_id];
    if (!k) continue;
    out[k] = (out[k] || 0) + (v.response === 'yes' ? 2 : v.response === 'maybe' ? 1 : 0);
  }
  return out;
}
/** Points by course id for one day ('course:<index>:<id>' → { id: n }). */
export function dayVotes(points, index) {
  const out = {};
  for (const [k, n] of Object.entries(points)) {
    const m = /^course:(\d+):(.+)$/.exec(k);
    if (m && Number(m[1]) === index) out[m[2]] = n;
  }
  return out;
}
/**
 * Who still hasn't answered a vote card: everyone who hasn't voted on at least one option in EVERY section (poll),
 * and — if the card asks "Are you keen?" — hasn't said In / Maybe / Out.
 */
export function batchNonVoters({ polls = [], votes = [], rsvps = [], keen = false, playerIds = [] } = {}) {
  // The detail (ov23: an area's courses and places to stay) is optional — skipping it isn't "still to answer".
  const pollIds = polls.filter((p) => !p.optional).map((p) => p.id);
  return playerIds.filter((pid) => {
    const mine = new Set(votes.filter((v) => v.player_id === pid).map((v) => v.poll_id));
    if (pollIds.some((id) => !mine.has(id))) return true;
    if (keen && !rsvps.some((r) => r.player_id === pid)) return true;
    return false;
  });
}

// ------------------------------------------------------------------ the steps

/**
 * Where the builder is up to. state: the builder's saved state; ctx: { teeCount, configCount, picked, v1Open, v2Open }.
 * → [{ key, n, label, done, locked, after }]
 */
export function builderSteps(state = {}, ctx = {}) {
  const areaDone = !!state.region;
  const weekendsDone = !!state.weekendsSettled && (state.weekends || []).length > 0;
  const coursesDone = (state.stays || []).length > 0 && (state.days || []).some((d) => (d.options || []).length);
  const callsDone = !!state.callsMade && (ctx.teeCount || 0) > 0;
  const configsDone = !!state.picked;
  // ov23 (Josh, 23 Oct): decide the area and the weekends (primary and backup) first, THEN call the courses.
  const steps = [
    { key: 'area', label: 'Areas & weekends', done: areaDone && weekendsDone, locked: false, after: null },
    { key: 'courses', label: 'Courses & stays', done: coursesDone, locked: !areaDone, after: 'the area is chosen (Areas & weekends)' },
    { key: 'calls', label: 'Call the courses', done: callsDone, locked: !(areaDone && weekendsDone && coursesDone),
      after: !areaDone ? 'the area is chosen (Areas & weekends)' : !weekendsDone ? 'the primary and backup weekends are set (Areas & weekends)' : 'Courses & stays' },
    { key: 'configs', label: 'Pick & lock in', done: configsDone, locked: !callsDone, after: 'Call the courses' },
  ];
  // The labels and numbers come from the one shared step list (lib/tripsteps.js), so they match Organise exactly.
  return steps.map((s) => { const t = fromBuilder(s.key); return { ...s, label: t.title, n: t.n, organise: t.key }; });
}

// ------------------------------------------------------------------ the saved state

/** A fresh state with the defaults. */
export function newState(plan = {}) {
  const nights = plan.start_date && plan.end_date ? Math.max(0, Math.min(6, nightsOf({ start: plan.start_date, end: plan.end_date }))) : 2;
  return {
    v: 1, region: null, regionOptions: [], origin: null, nights,
    weekends: plan.start_date ? [{ start: String(plan.start_date).slice(0, 10), end: String(plan.end_date || plan.start_date).slice(0, 10), long: false }] : [],
    weekendsSettled: false, stays: [], pins: [], stayMax: DEFAULT_STAY_MAX, detourMax: DEFAULT_DETOUR_MAX,
    days: tripDays(nights).map((d) => ({ index: d.index, leg: d.leg, options: [] })), courses: {}, headcount: null,
    votes: {}, optionKeys: {}, callsMade: false, configs: [], picked: null,
    // The start (080): each area's courses and places to stay on the table, ✨ suggestions not yet kept, extras.
    areaCourses: {}, areaStays: {}, suggested: {}, extras: null,
  };
}
/** Days follow the nights: keep each day's options where the leg is the same. */
export function resizeDays(days = [], nights) {
  return tripDays(nights).map((d) => {
    const old = days.find((x) => x.index === d.index && x.leg === d.leg);
    return { index: d.index, leg: d.leg, options: old?.options || [], ...(old?.golf ? { golf: old.golf } : {}), ...(old?.travel === false ? { travel: false } : {}) };
  });
}

// ------------------------------------------------------------------ the start: one map for the area (22 Oct, Josh)
// "A map with pins for viable courses for a general region and pins for potential locations/towns or parts of town.
// Then they can be voted on as well." Each area option carries its own set of courses and places to stay, chosen by
// the organiser (the app and the AI only suggest — ✨ — the organiser ticks them in). Never one course per area here.

export const AREA_SUGGEST = 6;   // courses the app suggests for an area (the organiser ticks them in)
export const MAX_AREA_COURSES = 10;
export const MAX_AREA_STAYS = 6;

/**
 * Every viable course for an area: within `stayMax` minutes of at least one of its stay pins (towns, or spots the
 * organiser dropped). Ranked like a stay day; the top AREA_SUGGEST are marked suggested.
 * → [{ course, drive: { min, max, text }, history, why, score, suggested }]
 */
export function areaCourseCandidates(courses = [], stayPins = [], { stayMax = DEFAULT_STAY_MAX, history = () => null, today = new Date(), limit = 40 } = {}) {
  if (!stayPins.length) return [];
  const cands = courses.filter((c) => c && c.lat != null && c.lng != null).map((c) => ({
    course: c, drive: legDrive('stay', c, { stays: stayPins }), history: history(c.id) || null, booking: null, facts: c.facts || {},
  })).filter((c) => fitsLeg('stay', c.drive, { stayMax }));
  return rankCandidates(cands, { leg: 'stay', today }).slice(0, limit).map((c, i) => ({ ...c, suggested: i < AREA_SUGGEST }));
}

/** The app's suggestion for an area's course set (ids only — the organiser decides which go on the table). */
export function proposeAreaCourses(courses, stayPins, opts = {}) {
  return areaCourseCandidates(courses, stayPins, opts).filter((c) => c.suggested).map((c) => c.course.id);
}

/** How many of the courses on the table are within `withinMin` of a stay pin. */
export function staySupport(stay, courseIds = [], courseMap = {}, withinMin = DEFAULT_STAY_MAX) {
  return courseIds.map((id) => courseMap[id]).filter((c) => c && c.lat != null && driveBetween(stay, c) <= withinMin).length;
}

/** Tick something in or out of a list (capped). Returns the new list. */
export function toggleId(list = [], id, max = MAX_AREA_COURSES) {
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length >= max ? list : [...list, id];
}

/**
 * Days start pre-filled from the area's course set: every day with golf and no options yet gets the area's courses
 * that fit its role (up to MAX_OPTIONS_PER_DAY): stay days the closest to where we stay; the way there / home (ov40)
 * the ones least out of the way from the starting point (origin), else — no origin known — the closest to where we
 * stay (you arrive and play nearby). Several per day — never just one.
 * ov40: before this, the way there / home days were left empty, so a 2-night trip (Blue Mountains, March 2027) only
 * ever had golf on the Saturday — one round.
 */
export function prefillStayDays(days = [], courseIds = [], courseMap = {}, { stays = [], stayMax = DEFAULT_STAY_MAX, origin = null, detourMax = DEFAULT_DETOUR_MAX, fly = false } = {}) {
  if (fly) origin = null; // flying: every day's courses are near where we stay
  const list = courseIds.map((id) => courseMap[id]).filter(Boolean);
  const ranked = (leg) => list
    .map((c) => {
      if (!stays.length) return { id: c.id, d: { min: 0 } };
      if (leg !== 'stay' && origin) return { id: c.id, d: legDrive(leg, c, { origin, stays }), leg };
      return { id: c.id, d: legDrive('stay', c, { stays }), leg: 'stay' };
    })
    .filter((x) => !stays.length || fitsLeg(x.leg || 'stay', x.d, { stayMax, detourMax }))
    .sort((a, b) => (a.d.min ?? 999) - (b.d.min ?? 999)).map((x) => x.id);
  const by = { stay: ranked('stay'), way: ranked('way'), home: ranked('home') };
  return days.map((d) => (dayGolf(d) !== 'none' && !(d.options || []).length ? { ...d, options: by[dayLeg(d)].slice(0, MAX_OPTIONS_PER_DAY) } : d));
}
/** Old saved trips (before ov40) with travel days left empty: do they need filling? */
export function daysNeedFilling(days = []) {
  return days.some((d) => d.leg !== 'stay' && dayGolf(d) !== 'none' && !(d.options || []).length) && days.some((d) => (d.options || []).length);
}

/** The line under an area on the ballot: "Courses: A, B, C, D · Stay: Nowra, Huskisson". */
export function areaBallotNote(courseIds = [], courseMap = {}, stayPins = []) {
  const names = courseIds.map((id) => courseMap[id]?.name).filter(Boolean);
  return [names.length ? `Courses: ${names.join(', ')}` : null, stayPins.length ? `Stay: ${stayPins.map((s) => s.name).join(', ')}` : null].filter(Boolean).join(' · ').slice(0, 480);
}

/**
 * Everything on the table at the start, as the sections "Call the vote" shows (each option ticked = on the ballot).
 * st: the builder state; ctx: { courseMap, accom: plan_stays rows, extras: a ballot section or null, depth }.
 * depth (ov23, Josh): 'areas' = just "Which area?" (+ the weekends shortlist and extras); 'full' (default) = also a
 * question per area for its courses and its places to stay. With 2+ areas those per-area questions are the DETAIL:
 * optional for voters (optional: true, area: <name>) — answering the area and the weekends is enough.
 * Sections: which area (2+ areas), which weekend (2+), places to stay and courses (per area), accommodation ideas, and
 * "Would you do these?" (extras).
 * → [{ key, kind, question, options: [{ key, label, notes, start_date?, end_date?, stayId? }], area?, optional? }]
 */
export function startRange(st = {}, { courseMap = {}, accom = [], extras = null, depth = 'full', length = null, notes = {} } = {}) {
  const out = [];
  const areas = st.region ? [st.region] : (st.regionOptions || []);
  const areaStays = st.areaStays || {};
  const areaCourses = st.areaCourses || {};
  const multi = !st.region && areas.length >= 2;
  const detail = depth !== 'areas';
  if (multi) {
    out.push({ key: 'area', kind: 'location', question: 'Which area?', options: areas.map((r) => ({ key: `area:${r}`, label: r, notes: areaBallotNote(areaCourses[r] || [], courseMap, areaStays[r] || []) || null })) });
  }
  if ((st.weekends || []).length >= 2 && !st.weekendsSettled) {
    out.push({ key: 'weekend', kind: 'dates', question: 'Which weekend?', options: st.weekends.map((w) => ({ key: `weekend:${w.start}`, label: weekendLabel(w), start_date: w.start, end_date: w.end })) });
  }
  if (length) out.push(length); // "How long?" (ov23) — a main question, next to the area and the weekends
  const courseOpts = (r, ids) => ids.map((id) => ({ key: `areacourse:${r}:${id}`, label: courseMap[id]?.name || 'Course', notes: courseMap[id]?.area || null, area: r }));
  const stayOpts = (r, pins) => pins.map((s) => ({ key: `stay:${s.key || s.name}`, label: s.name, notes: null, area: r }));
  if (multi && detail) {
    // The detail, grouped under each area ("Hunter Valley: which courses?", "Hunter Valley: where to stay?").
    for (const r of areas) {
      const ids = areaCourses[r] || [];
      if (ids.length) out.push({ key: `courses:${r}`, kind: 'other', area: r, optional: true, question: `${r}: which courses?`, options: courseOpts(r, ids) });
      const pins = areaStays[r] || [];
      if (pins.length) out.push({ key: `stays:${r}`, kind: 'other', area: r, optional: true, question: `${r}: where to stay?`, options: stayOpts(r, pins) });
    }
  } else if (detail) {
    for (const r of areas) {
      const pins = st.region && st.stays?.length ? st.stays : areaStays[r] || [];
      if (pins.length) out.push({ key: 'stay', kind: 'other', question: 'Which town to stay in?', options: stayOpts(r, pins) });
      const ids = areaCourses[r] || [];
      if (ids.length) out.push({ key: `courses:${r}`, kind: 'other', question: 'Which courses?', options: courseOpts(r, ids) });
    }
  }
  const ideas = detail ? (accom || []).filter((a) => !a.option_id) : [];
  if (ideas.length) {
    out.push({ key: 'accom', kind: 'other', question: 'Where should we stay?', options: ideas.map((a) => ({ key: `accom:${a.id}`, label: a.name, notes: [a.area, a.total_cost != null ? `$${Number(a.total_cost)} total` : null, a.sleeps ? `sleeps ${a.sleeps}` : null].filter(Boolean).join(' · ') || null, stayId: a.id, area: a.area || undefined })) });
  }
  if (extras) out.push(extras);
  // The one-line summary on each option (ov23: course details on the vote card), when the screen worked them out.
  for (const s of out) for (const o of s.options || []) if (notes[o.key]) o.notes = String(notes[o.key]).slice(0, 480);
  return out;
}

/**
 * The regions side by side (080): for each area option — its courses and places to stay on the table, accommodation
 * ideas (with list links), rough cost each to stay (the cheapest idea's total ÷ people), the drive from where people
 * come from (to the area's middle), and how many days of tee times are in for its courses.
 * → [{ area, courses: [names], stays: [names], ideas, costEach, drive, driveText, teeDays }]
 */
export function compareAreas(st = {}, { areas = [], accom = [], people = 0, origin = null, tees = [] } = {}) {
  const list = st.region ? [st.region] : (st.regionOptions || []);
  const regs = regionsFrom(areas);
  return list.map((area) => {
    const ids = (st.areaCourses || {})[area] || [];
    const stays = (st.areaStays || {})[area] || [];
    const ideas = (accom || []).filter((a) => a.area === area);
    const totals = ideas.map((a) => Number(a.total_cost)).filter((n) => Number.isFinite(n) && n > 0);
    const reg = regs.find((r) => r.region === area);
    const drive = origin && reg ? driveBetween(origin, reg) : null;
    const days = new Set((tees || []).filter((t) => ids.includes(t.course_id) && (t.available === 'yes' || (t.times || []).length || (t.ranges || []).length)).map((t) => String(t.play_date).slice(0, 10)));
    return {
      area, courses: ids.map((id) => (st.courses || {})[id]?.name).filter(Boolean), stays: stays.map((s) => s.name), ideas,
      costEach: totals.length && people > 0 ? Math.round(Math.min(...totals) / people) : null,
      drive, driveText: drive != null ? fmtDrive(drive) : null, teeDays: days.size,
    };
  });
}

/** Points per course id for an area from the start vote ('areacourse:<area>:<id>'). */
export function areaCourseVotes(points, area) {
  const out = {};
  for (const [k, n] of Object.entries(points || {})) {
    const pre = `areacourse:${area}:`;
    if (k.startsWith(pre)) out[k.slice(pre.length)] = n;
  }
  return out;
}

