// The day plan (ov40, 25 Oct 2026): rough timing for each trip day. Pure functions only — no React, no database.
//
// Josh: "time to leave home for driving, or flying if flying, to then get a time at a course; does it fit with social
// timing; finish before dusk etc. Not definitive, but as part of an informed conversation."
//
//   * Travel: leave home → drive (the trip's starting points, lib/tripfinder.js drive estimate) → arrive; or fly: drive
//     to the airport + check-in + the flight (an estimate the organiser types) + bags / hire car + drive to the course.
//   * Each course's usual social / visitor tee windows for that weekday, read from the free text the group keeps
//     ("Sat after 2, Sun after 11", "weekdays 7–8:30am and after 1pm"). Can't read it → "ring to check".
//   * Round length: Stableford about 4 h 30 for a 4-ball, Ambrose about 4 h (configurable). The last group finishes
//     (groups − 1) × the tee interval later.
//   * Sunrise / sunset from the date and place (the standard NOAA formula, no API), in the place's own time
//     (Australian states, with daylight saving).
//   * Flags: "finishes about 40 min before dusk ✓", "tight — tee off by 1:10pm to finish before dusk", "too early to
//     make it from Inner West". Every number is "about" — it's for talking it through, not a booking.
//
// Times are minutes after midnight, local to the place (6:00 am = 360).
import { parseClock } from './tripfinder.js';
import { toMin, ampm, teeGroupSizes, DEFAULT_INTERVAL, ARRIVE_BEFORE } from './teeWindow.js';

export const ROUND_LENGTH = { stableford: 270, stroke: 270, ambrose: 240, fourball: 255, nine: 135 };
export const FLY_DEFAULTS = { toAirportMin: 40, checkInMin: 60, flightMin: 90, pickupMin: 30, fromAirportMin: 45 };
// Josh 25 Oct: no fare guesses — just the flight time and a rough first / last flight of the day.
export const FIRST_FLIGHT = 6 * 60;   // first flights out about 6 am
export const LAST_FLIGHT = 21 * 60;   // last flights back about 9 pm
// When we don't know a course's times (Josh: "guess, shown as unconfirmed"): what's usual at Australian clubs —
// members' comps on Saturday and midweek mornings, Sunday mornings busy, Monday and Friday mostly open.
export const USUAL_WINDOWS = {
  0: [{ from: 11 * 60, to: null }], 1: [{ from: 7 * 60, to: null }], 2: [{ from: 11 * 60, to: null }], 3: [{ from: 11 * 60, to: null }],
  4: [{ from: 11 * 60, to: null }], 5: [{ from: 7 * 60, to: null }], 6: [{ from: 12 * 60 + 30, to: null }],
};
export const USUAL_GROUP = 'most clubs take groups of 12–20';
export const DEFAULT_LEAVE_HOME = 6 * 60;      // leave home 6:00 am on the way there
export const DEFAULT_LEAVE_STAY = 7 * 60;      // up and away from where we stay by 7:00 am at the earliest
export const DINNER_FROM = 18 * 60 + 30;       // dinner / evening from 6:30 pm
export const DAY_FROM = 5 * 60;                // the timeline runs 5 am …
export const DAY_TO = 22 * 60;                 // … to 10 pm
export const TIGHT_MARGIN = 30;                // under 30 min before dusk = tight
export const LATEST_TEE = 16 * 60;             // nobody's teeing off after 4 pm for 18 holes, whatever the sign says
export const EARLIEST_TEE = 6 * 60 + 30;
export const PREFS = [
  { value: 'morning_free', label: 'Morning free', short: 'morning free' },
  { value: 'early', label: 'Play early', short: 'play early' },
  { value: 'midday', label: 'Play midday', short: 'play midday' },
  { value: 'late', label: 'Play later', short: 'play later' },
  { value: 'home_by', label: 'Home by…', short: 'home by' },
];
export const PREF_LABEL = Object.fromEntries(PREFS.map((p) => [p.value, p.label]));

const rad = Math.PI / 180;
const pad = (n) => String(n).padStart(2, '0');
const sinD = (x) => Math.sin(x * rad);
const cosD = (x) => Math.cos(x * rad);

// ------------------------------------------------------------------ the clock

/** Minutes → '7:25pm' (no space: compact for timelines). */
export function hm(min) {
  if (min == null || !Number.isFinite(min)) return '?';
  return ampm(Math.round(min)).replace(' ', '');
}
/** 75 → '1 h 15', 40 → '40 min'. */
export function dur(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${pad(m % 60)}` : ''}`;
}
/** Round to the nearest 5 minutes (everything here is "about"). */
export const r5 = (m) => Math.round(m / 5) * 5;
/** 'HH:MM', '1:30pm', '7am' or minutes → minutes (null if unreadable). */
export function anyClock(t) {
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  return toMin(t) ?? parseClock(t);
}

// ------------------------------------------------------------------ time zone (Australia) and the sun

const dateParts = (iso) => String(iso || '').slice(0, 10).split('-').map(Number);
/** The first Sunday of a month (1–12) → day of month. */
function firstSunday(y, m) {
  const d = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((7 - d) % 7);
}
/** Is daylight saving on (south-east Australia: first Sunday in October to first Sunday in April)? */
export function auDst(iso) {
  const [y, m, d] = dateParts(iso);
  if (!y) return false;
  if (m > 10 || m < 4) return true;
  if (m === 10) return d >= firstSunday(y, 10);
  if (m === 4) return d < firstSunday(y, 4);
  return false;
}
/**
 * Which state a place is in, roughly, from its position (good enough for the time zone).
 * → 'WA' | 'NT' | 'SA' | 'QLD' | 'NSW' (NSW stands for NSW / ACT / VIC / TAS — same clock).
 */
export function auZone(lat, lng) {
  if (lng < 129) return 'WA';
  if (lng < 138) return lat > -26 ? 'NT' : 'SA';
  if (lng < 141 && lat < -26) return 'SA';
  if (lat > -28.2 && lng >= 138) return 'QLD';
  if (lat > -29 && lng < 141) return 'QLD';
  return 'NSW';
}
/** Minutes ahead of UTC for a place on a date (+600 Sydney in winter, +660 in summer). Outside Australia: Sydney's. */
export function auOffset(iso, lat, lng) {
  const z = lat != null && lng != null ? auZone(Number(lat), Number(lng)) : 'NSW';
  if (z === 'WA') return 480;
  if (z === 'NT') return 570;
  if (z === 'QLD') return 600;
  const dst = auDst(iso);
  if (z === 'SA') return dst ? 630 : 570;
  return dst ? 660 : 600;
}

function solar(jd) {
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = sinD(M) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sinD(2 * M) * (0.019993 - 0.000101 * t) + sinD(3 * M) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = L0 + C - 0.00569 - 0.00478 * sinD(omega);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cosD(omega);
  const decl = Math.asin(sinD(eps) * sinD(lambda)) / rad;
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eq = 4 / rad * (y * sinD(2 * L0) - 2 * e * sinD(M) + 4 * e * y * sinD(M) * cosD(2 * L0) - 0.5 * y * y * sinD(4 * L0) - 1.25 * e * e * sinD(2 * M));
  return { decl, eq };
}
function sunEvent(iso, lat, lng, zenith, rising) {
  const [y, m, d] = dateParts(iso);
  const jd0 = Date.UTC(y, m - 1, d) / 86400000 + 2440587.5;
  let utc = 720 - 4 * lng; // first guess: solar noon (minutes UTC)
  for (let i = 0; i < 2; i++) {
    const { decl, eq } = solar(jd0 + utc / 1440);
    const cosH = cosD(zenith) / (cosD(lat) * cosD(decl)) - Math.tan(lat * rad) * Math.tan(decl * rad);
    if (cosH > 1 || cosH < -1) return null; // no sunrise / sunset that day (not in Australia)
    const H = Math.acos(cosH) / rad;
    utc = 720 - 4 * lng - eq + (rising ? -4 * H : 4 * H);
  }
  return utc;
}
/**
 * Sunrise, sunset and the end of civil twilight ("last light") for a date and place, in local minutes.
 * offsetMin: minutes ahead of UTC (default: the Australian clock there on that date).
 * → { sunrise, sunset, lastLight, offset }
 */
export function sunTimes(iso, lat, lng, offsetMin = null) {
  if (!iso || lat == null || lng == null) return null;
  const off = offsetMin ?? auOffset(iso, lat, lng);
  const rise = sunEvent(iso, Number(lat), Number(lng), 90.833, true);
  const set = sunEvent(iso, Number(lat), Number(lng), 90.833, false);
  const last = sunEvent(iso, Number(lat), Number(lng), 96, false);
  if (rise == null || set == null) return null;
  return { sunrise: Math.round(rise + off), sunset: Math.round(set + off), lastLight: last == null ? null : Math.round(last + off), offset: off };
}

// ------------------------------------------------------------------ the course's usual social / visitor times

const DOWS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** A bare hour in golf talk: 'after 2' means 2 pm, 'after 11' means 11 am. 1–6 → pm; 7–12 as said. */
function golfClock(t) {
  const s = String(t || '').trim().toLowerCase().replace(/\./g, ':').replace(/\s+/g, '');
  if (/^noon|midday$/.test(s)) return 720;
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = Number(m[2] || 0);
  if (mm > 59 || h > 23) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === 'pm' && h !== 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
  } else if (h >= 1 && h <= 6) h += 12;
  return h * 60 + mm;
}
/** The days a phrase names ('sat', 'saturdays', 'sat & sun', 'mon-fri', 'weekends'), or null if it names none. */
function daysIn(text) {
  const s = String(text || '').toLowerCase();
  const out = new Set();
  if (/\bweekdays?\b|\bmon(day)?s?\s*(-|–|to)\s*fri/.test(s)) [1, 2, 3, 4, 5].forEach((d) => out.add(d));
  if (/\bweekends?\b/.test(s)) [0, 6].forEach((d) => out.add(d));
  const rng = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*(?:-|–|to)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(s);
  if (rng) { for (let d = DOWS.indexOf(rng[1]); ; d = (d + 1) % 7) { out.add(d); if (d === DOWS.indexOf(rng[2])) break; } }
  for (const m of s.matchAll(/\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|days|s|\.)?\b/g)) out.add(DOWS.indexOf(m[1].slice(0, 3)));
  return out.size ? [...out].sort() : null;
}
const T = '(\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm)?|noon|midday)';
/**
 * One phrase → tee windows [{ from, to }] (to = null when open-ended), [] when it says no visitors, or null when it
 * can't be read. 'after 11', 'from 12pm', '11am onwards', '7-8:30am', 'between 10 and 2', 'before 9', 'mornings',
 * 'arvo', 'any time', 'members only', 'no'.
 */
export function phraseWindows(text) {
  const s = String(text || '').toLowerCase().replace(/[’']/g, '').trim();
  if (!s) return null;
  if (/\b(no visitors|members only|members' only|closed|comp day|competition|not available|none)\b|^no\b|^n\/a$/.test(s) && !/after|from|before|until|\d/.test(s)) return [];
  const out = [];
  let rest = s;
  const take = (re, fn) => {
    rest = rest.replace(re, (...m) => { const w = fn(m); if (w) out.push(w); return ' '; });
  };
  take(new RegExp(`between\\s+${T}\\s+(?:and|&)\\s+${T}`, 'g'), (m) => pair(m[1], m[2]));
  take(new RegExp(`${T}\\s*(?:-|–|to|till|until)\\s*${T}`, 'g'), (m) => pair(m[1], m[2]));
  take(new RegExp(`(?:after|from|not before|>)\\s*${T}`, 'g'), (m) => { const a = golfClock(m[1]); return a == null ? null : { from: a, to: null }; });
  take(new RegExp(`${T}\\s*(?:onwards|on|\\+|or later)`, 'g'), (m) => { const a = golfClock(m[1]); return a == null ? null : { from: a, to: null }; });
  take(new RegExp(`(?:before|until|till|up to|by|<)\\s*${T}`, 'g'), (m) => { const b = golfClock(m[1]); return b == null ? null : { from: EARLIEST_TEE, to: b }; });
  if (/\b(any ?time|all day|open|daily|every ?day|yes|ok|fine)\b/.test(rest) && !out.length) out.push({ from: EARLIEST_TEE, to: null });
  if (/\bmornings?\b|\bam\b|early/.test(rest) && !/\d/.test(rest)) out.push({ from: EARLIEST_TEE, to: 12 * 60 });
  if (/\b(afternoons?|arvo|pm|twilight)\b/.test(rest) && !/\d/.test(rest)) out.push({ from: /twilight/.test(rest) ? 15 * 60 : 12 * 60, to: null });
  return out.length ? out : null;
}
function pair(a, b) {
  let x = golfClock(a); let y = golfClock(b);
  if (x == null || y == null) return null;
  // '7-8:30am': the am/pm on the end goes for both; '11-2' → 11 am to 2 pm.
  if (/am|pm/.test(b) && !/am|pm/.test(a)) { const ax = golfClock(`${String(a).trim()}${/pm/.test(b) ? 'pm' : 'am'}`); if (ax != null && ax < y) x = ax; }
  if (y <= x && y + 720 > x && y < 720) y += 720;
  return y > x ? { from: x, to: y } : null;
}
/**
 * The tee windows a course's text gives for one weekday. The text can name days ("Sat after 2, Sun after 11"); a part
 * naming no day goes for every day the text is about. → { windows: [{ from, to }], known: true } | { known: false }
 * (windows [] + known = "no visitors that day").
 */
export function windowsFor(text, dow) {
  const parts = String(text || '').split(/\s*[;,\n]\s*|\s+(?=(?:sat|sun|mon|tue|wed|thu|fri)[a-z]*\b)|\.\s+/i).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { known: false };
  let any = false;
  let named = false;
  const out = [];
  let lastDays = null;
  for (const p of parts) {
    const days = daysIn(p);
    const w = phraseWindows(p.replace(/\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|days|s)?\b|weekends?|weekdays?/gi, ' ').trim() || 'any time');
    if (w == null) { lastDays = days || lastDays; continue; }
    const forDays = days || lastDays;
    if (days) named = true;
    lastDays = forDays;
    if (forDays && !forDays.includes(dow)) { any = true; continue; }
    any = true;
    out.push(...w);
  }
  if (!any) return { known: false };
  if (!out.length && named && !parts.some((p) => (daysIn(p) || []).includes(dow))) return { known: false };
  return { known: true, windows: merge(out) };
}
function merge(ws) {
  const s = ws.map((w) => ({ from: w.from, to: w.to ?? null })).sort((a, b) => a.from - b.from);
  const out = [];
  for (const w of s) {
    const last = out[out.length - 1];
    if (last && (last.to == null || w.from <= last.to)) { last.to = last.to == null || w.to == null ? null : Math.max(last.to, w.to); continue; }
    out.push({ ...w });
  }
  return out;
}
/**
 * The course's usual times for a day of the week, from what's known, best source first: the group's own social times
 * (course_social_times: weekdays / weekends text), the booking info's visitor times, the course research's visitor
 * times. → { windows, source, text, known, guess }  (known false = a guess from what's usual: "unconfirmed — about")
 */
export function courseWindows(dow, { social = null, booking = null, research = null } = {}) {
  const weekend = dow === 0 || dow === 6;
  const tries = [
    social && [weekend ? social.weekends : social.weekdays, 'our notes'],
    booking?.visitor_times && [booking.visitor_times, 'the club’s visitor times'],
    research?.details?.visitor_times && [research.details.visitor_times, 'course research'],
  ].filter((x) => x && x[0]);
  for (const [text, source] of tries) {
    const w = windowsFor(text, dow);
    if (w.known) return { windows: w.windows, source, text, known: true };
  }
  // Nothing readable: what's usual for clubs that day — a guess, shown as unconfirmed (it updates when real times come in).
  return { windows: dow == null ? [] : USUAL_WINDOWS[dow].map((w) => ({ ...w })), source: 'usual for clubs', text: tries[0]?.[0] || null, known: false, guess: true };
}
/** "after 11am", "7–8:30am", "no visitors" — one line for the windows. */
export function windowsText(ws = []) {
  if (!ws.length) return 'no visitors';
  return ws.map((w) => (w.to == null ? `after ${hm(w.from)}` : w.from <= EARLIEST_TEE ? `before ${hm(w.to)}` : `${hm(w.from)}–${hm(w.to)}`)).join(', ');
}

// ------------------------------------------------------------------ the round

/**
 * How long the golf takes for the whole group: { each, groups, interval, total } — total = first tee to the last group
 * in. format: 'stableford' | 'ambrose' | … ; roundLength overrides (minutes per group).
 */
export function golfLength({ format = 'stableford', players = 4, holes = 18, interval = DEFAULT_INTERVAL, roundLength = null } = {}) {
  const base = Number(roundLength) > 0 ? Number(roundLength) : ROUND_LENGTH[format] || ROUND_LENGTH.stableford;
  const each = Number(holes) === 9 ? Math.round(base / 2) : base;
  const groups = Math.max(1, teeGroupSizes(players).length);
  const iv = Number(interval) > 0 ? Number(interval) : DEFAULT_INTERVAL;
  return { each, groups, interval: iv, total: each + (groups - 1) * iv };
}

// ------------------------------------------------------------------ travel

/**
 * Getting there: a list of legs and when you arrive.
 *   mode 'drive': { leave, driveMin, from }                         leave home → drive → arrive
 *   mode 'fly':   { leave, fly: { toAirportMin, checkInMin, flightMin, pickupMin, fromAirportMin } }
 * leave: minutes (or 'HH:MM'). → { legs: [{ kind: 'drive' | 'wait' | 'fly', from, to, label }], leave, arrive, minutes }
 */
export function travelChain({ mode = 'drive', leave = DEFAULT_LEAVE_HOME, driveMin = 0, from = 'home', fly = {}, back = false } = {}) {
  let start = anyClock(leave) ?? DEFAULT_LEAVE_HOME;
  const legs = [];
  let t = start;
  const add = (kind, min, label) => { const m = Math.max(0, Math.round(Number(min) || 0)); if (!m) return; legs.push({ kind, from: t, to: t + m, label }); t += m; };
  if (mode === 'fly') {
    const f = { ...FLY_DEFAULTS, ...Object.fromEntries(Object.entries(fly || {}).filter(([, v]) => v != null && v !== '')) };
    // No flight before the first of the day (about 6 am): leave later rather than wait at the airport.
    if (!back && t + (Number(f.toAirportMin) || 0) + (Number(f.checkInMin) || 0) < FIRST_FLIGHT) t = FIRST_FLIGHT - (Number(f.toAirportMin) || 0) - (Number(f.checkInMin) || 0);
    add('drive', f.toAirportMin, `Drive to the airport (about ${dur(f.toAirportMin)})`);
    add('wait', f.checkInMin, `Check in and wait (about ${dur(f.checkInMin)})`);
    add('fly', f.flightMin, `Flight (about ${dur(f.flightMin)}${back ? '' : '; first flights about 6am'})`);
    add('wait', f.pickupMin, `Bags and the hire car (about ${dur(f.pickupMin)})`);
    add('drive', f.fromAirportMin, `Drive from the airport (about ${dur(f.fromAirportMin)})`);
  } else add('drive', driveMin, `Drive from ${from} (about ${dur(driveMin)})`);
  start = legs.length ? legs[0].from : t;
  return { legs, leave: start, arrive: t, minutes: t - start };
}
/** The same chain, worked back from when you need to be there: { leave, ...chain }. */
export function leaveBy(arriveBy, opts = {}) {
  const there = anyClock(arriveBy);
  const c = travelChain({ ...opts, leave: 12 * 60 });
  return travelChain({ ...opts, leave: there - c.minutes });
}

// ------------------------------------------------------------------ fitting a tee time

/** How a finish sits against dusk (sunset): { tone: 'ok' | 'tight' | 'dark', margin, text }. */
export function duskFlag(finish, sunset, { latestTee = null } = {}) {
  if (sunset == null || finish == null) return { tone: 'unknown', margin: null, text: 'dusk unknown' };
  const margin = sunset - finish;
  if (margin >= TIGHT_MARGIN) return { tone: 'ok', margin, text: `finishes about ${dur(r5(margin))} before dusk ✓` };
  const by = latestTee != null ? ` — tee off by ${hm(latestTee)} to finish before dusk` : '';
  if (margin >= 0) return { tone: 'tight', margin, text: `tight${by || ' — finishes just before dusk'}` };
  return { tone: 'dark', margin, text: `finishes after dusk${by}` };
}
/** Does a tee time suit a wish? pref: 'early' (by 9) | 'midday' (10:30–1:30) | 'late' (from 12:30) | 'morning_free'
 *  (from 11:30) | 'home_by' (with homeBy: finish + the drive home by then) | 'any'. */
export function suits(pref, tee, { finish = null, homeBy = null, driveHome = 0 } = {}) {
  if (!pref || pref === 'any') return true;
  if (pref === 'early') return tee <= 9 * 60;
  if (pref === 'midday') return tee >= 10 * 60 + 30 && tee <= 13 * 60 + 30;
  if (pref === 'late') return tee >= 12 * 60 + 30;
  if (pref === 'morning_free') return tee >= 11 * 60 + 30;
  if (pref === 'home_by') {
    const by = anyClock(homeBy);
    if (by == null || finish == null) return true;
    return finish + (Number(driveHome) || 0) <= by;
  }
  return true;
}

/**
 * The tee times that work at one course on one day.
 *   date, dow, place: { lat, lng } (for the sun), canArrive: earliest you can be at the course (minutes),
 *   windows / known: from courseWindows, golf: from golfLength, step: minutes between suggestions (default 30)
 * → { sun, earliestTee, latestTee, fits: [{ from, to }], slots: [{ tee, finish, flag }], reason, known }
 */
export function courseFit({ date, place, canArrive = null, windows = [], known = true, golf = golfLength(), step = 30, sun = null, latestFinish = null } = {}) {
  const s = sun || (place ? sunTimes(date, place.lat, place.lng) : null);
  const earliest = Math.max(EARLIEST_TEE, canArrive == null ? 0 : canArrive + ARRIVE_BEFORE, s ? s.sunrise - 10 : 0);
  // latestFinish: e.g. the last flight home (about 9 pm) less getting to the airport.
  const latest = Math.min(LATEST_TEE, s ? s.sunset - golf.total : LATEST_TEE, latestFinish != null ? latestFinish - golf.total : Infinity);
  // Unknown times: the usual ones for clubs that day (a guess) if given, else open.
  const ws = known || windows.length ? windows : [{ from: EARLIEST_TEE, to: null }];
  const fits = ws.map((w) => ({ from: Math.max(w.from, earliest), to: Math.min(w.to ?? latest, latest) })).filter((w) => w.to >= w.from);
  let reason = null;
  if (known && !windows.length) reason = 'no visitors that day';
  else if (!fits.length) {
    const maxTo = Math.max(...ws.map((w) => w.to ?? latest));
    if (maxTo < earliest) reason = 'too early to make it';
    else if (latestFinish != null && s && latestFinish < s.sunset && latestFinish - golf.total < earliest) reason = 'no time before the last flight home';
    else reason = 'not enough daylight left';
  }
  const slots = [];
  for (const w of fits) {
    const first = Math.ceil(w.from / 10) * 10;
    for (let t = first; t <= w.to && slots.length < 24; t += step) slots.push(slotAt(t, golf, s, latest));
    const lastSlot = Math.floor(w.to / 10) * 10;
    if (lastSlot >= first && !slots.some((x) => x.tee === lastSlot)) slots.push(slotAt(lastSlot, golf, s, latest));
  }
  slots.sort((a, b) => a.tee - b.tee);
  return { sun: s, earliestTee: earliest, latestTee: latest, fits, slots, reason, known, guess: !known };
}
function slotAt(tee, golf, s, latest) {
  const finish = tee + golf.total;
  return { tee, finish, flag: duskFlag(finish, s?.sunset ?? null, { latestTee: s ? s.sunset - golf.total : latest }) };
}
/** "Tee off 12:30pm → finish about 5:00pm, 2 h before dusk" */
export function slotLine(slot) {
  if (!slot) return '';
  const m = slot.flag?.margin;
  const dusk = m == null ? '' : m >= 0 ? `, ${dur(r5(m))} before dusk` : `, ${dur(r5(-m))} after dusk`;
  return `Tee off ${hm(slot.tee)} → finish about ${hm(r5(slot.finish))}${dusk}`;
}

// ------------------------------------------------------------------ one day, put together

/**
 * One day's plan as coloured blocks (for the timeline) and the courses' fitting times.
 *   leg: 'way' | 'stay' | 'home'; date (ISO); place: { lat, lng } where we are that day (for the sun)
 *   travel: { mode, starts: [{ label, lat?, lng?, driveMin, leave? }], fly }   — the way there (leg 'way')
 *   pick: { course, tee } the chosen course and tee time, or null
 *   courses: [{ id, name, driveFromStay, driveFromHome (way: from the start), windows, known }]
 *   golf: golfLength(); prefs: [{ who, pref, homeBy }]
 * → { sun, blocks: [{ kind: 'travel' | 'golf' | 'free' | 'evening', from, to, label }], courses: [{ …, fit }], arrive }
 */
export function dayPlan({ leg = 'stay', date, place = null, travel = {}, pick = null, courses = [], golf = golfLength(), prefs = [], leaveStay = DEFAULT_LEAVE_STAY } = {}) {
  const sun = place ? sunTimes(date, place.lat, place.lng) : null;
  const starts = (travel.starts || []).length ? travel.starts : [{ label: 'home', driveMin: 0 }];
  // The way there: the last to arrive sets the pace (each start leaves at its own time, 6 am unless said).
  // Driving: each start's own drive to the course (c.driveFromHome: { label: minutes } or one number).
  // Flying: the chain gets you to the area (the airport drive is to where we stay); then the stay → course drive.
  const flyArrive = travel.mode === 'fly' ? Math.max(...starts.map((s) => travelChain({ mode: 'fly', leave: s.leave ?? DEFAULT_LEAVE_HOME, fly: travel.fly }).arrive)) : null;
  const homeDrive = (c, s) => Number(typeof c.driveFromHome === 'object' && c.driveFromHome ? c.driveFromHome[s.label] : c.driveFromHome) || Number(s.driveMin) || 0;
  const fits = courses.map((c) => {
    let canArrive;
    if (leg === 'way') {
      canArrive = travel.mode === 'fly' ? flyArrive + (Number(c.driveFromStay) || 0)
        : Math.max(...starts.map((s) => (anyClock(s.leave) ?? DEFAULT_LEAVE_HOME) + homeDrive(c, s)));
    } else canArrive = leaveStay + (Number(c.driveFromStay) || 0);
    const f = { ...FLY_DEFAULTS, ...(travel.fly || {}) };
    const latestFinish = leg === 'home' && travel.mode === 'fly' ? LAST_FLIGHT - f.checkInMin - 20 - f.fromAirportMin : null;
    const fit = courseFit({ date, sun, canArrive, windows: c.windows || [], known: c.known !== false, golf, latestFinish });
    const slots = fit.slots.map((sl) => ({ ...sl, suitsN: prefs.filter((p) => suits(p.pref, sl.tee, { finish: sl.finish, homeBy: p.homeBy, driveHome: leg === 'home' ? c.driveHome : 0 })).length }));
    const top = Math.max(0, ...slots.map((x) => x.suitsN));
    return { ...c, canArrive, fit: { ...fit, slots: slots.map((x) => ({ ...x, best: prefs.length > 0 && x.suitsN === top && top > 0 })) } };
  });
  const blocks = [];
  const add = (kind, from, to, label) => { if (to > from) blocks.push({ kind, from: Math.max(DAY_FROM, from), to: Math.min(DAY_TO, to), label }); };
  const chosen = pick?.course ? fits.find((c) => c.id === pick.course) : null;
  const tee = chosen ? anyClock(pick.tee) : null;
  if (leg === 'way') {
    const main = starts.reduce((x, y) => (homeDrive(chosen || {}, y) > homeDrive(chosen || {}, x) ? y : x));
    if (chosen && tee != null) {
      // Leave so you're there 30 min before the tee (never before the start's own leave time).
      const fly = travel.mode === 'fly';
      const extra = fly ? (Number(chosen.driveFromStay) || 0) : 0;
      const driveMin = fly ? 0 : homeDrive(chosen, main);
      const back = leaveBy(tee - ARRIVE_BEFORE - extra, { mode: travel.mode, driveMin, from: main.label, fly: travel.fly });
      const leaveAt = Math.max(anyClock(main.leave) ?? 0, back.leave);
      const chain = travelChain({ mode: travel.mode, leave: leaveAt, driveMin, from: main.label, fly: travel.fly });
      for (const l of chain.legs) add('travel', l.from, l.to, l.label);
      if (extra) add('travel', chain.arrive, chain.arrive + extra, `Drive to ${chosen.name} (about ${dur(extra)})`);
      const at = chain.arrive + extra;
      if (tee - at > 0) add('free', at, tee, 'Warm up, a bite');
      golfBlocks(add, chosen, tee, golf);
      const after = tee + golf.total;
      add('travel', after, after + (Number(chosen.driveFromStay) || 0), `Drive to where we stay (about ${dur(chosen.driveFromStay)})`);
      add('free', after + (Number(chosen.driveFromStay) || 0), DINNER_FROM, 'Check in, a beer');
    } else {
      const chain = travelChain({ mode: travel.mode, leave: main.leave ?? DEFAULT_LEAVE_HOME, driveMin: Number(main.driveMin) || 0, from: main.label, fly: travel.fly });
      for (const l of chain.legs) add('travel', l.from, l.to, l.label);
      add('free', chain.arrive, DINNER_FROM, 'Free — no golf picked yet');
    }
    add('evening', DINNER_FROM, DAY_TO, 'Dinner / evening');
  } else if (leg === 'stay') {
    if (chosen && tee != null) {
      const go = tee - ARRIVE_BEFORE - (Number(chosen.driveFromStay) || 0);
      add('free', DAY_FROM + 120, go, go - (DAY_FROM + 120) >= 180 ? 'Morning free' : 'Breakfast');
      add('travel', go, go + (Number(chosen.driveFromStay) || 0), `Drive to ${chosen.name} (about ${dur(chosen.driveFromStay)})`);
      add('free', tee - ARRIVE_BEFORE, tee, 'Warm up');
      golfBlocks(add, chosen, tee, golf);
      const back = tee + golf.total;
      add('travel', back, back + (Number(chosen.driveFromStay) || 0), 'Drive back');
      add('free', back + (Number(chosen.driveFromStay) || 0), DINNER_FROM, 'Free');
    } else add('free', DAY_FROM + 120, DINNER_FROM, 'Free — no golf picked yet');
    add('evening', DINNER_FROM, DAY_TO, 'Dinner / evening');
  } else {
    // Home: pack up, golf on the way, drive home.
    if (chosen && tee != null) {
      const go = tee - ARRIVE_BEFORE - (Number(chosen.driveFromStay) || 0);
      add('free', DAY_FROM + 120, go, 'Pack up, check out');
      add('travel', go, go + (Number(chosen.driveFromStay) || 0), `Drive to ${chosen.name} (about ${dur(chosen.driveFromStay)})`);
      golfBlocks(add, chosen, tee, golf);
      const done = tee + golf.total;
      const home = travel.mode === 'fly' ? travelChainBack(done, travel) : { legs: [{ from: done, to: done + (Number(chosen.driveHome) || 0), label: `Drive home (about ${dur(chosen.driveHome)})` }] };
      for (const l of home.legs) add('travel', l.from, l.to, l.label);
    } else add('free', DAY_FROM + 120, 12 * 60, 'Pack up — no golf picked yet');
  }
  const arrive = blocks.filter((b) => b.kind === 'travel').reduce((a, b) => Math.max(a, b.to), 0) || null;
  return { sun, blocks, courses: fits, arrive };
}
function golfBlocks(add, course, tee, golf) {
  add('golf', tee, tee + golf.total, `${course.name}: tee off ${hm(tee)}, ${golf.groups} group${golf.groups === 1 ? '' : 's'}, in about ${hm(r5(tee + golf.total))}`);
}
function travelChainBack(from, travel) {
  const f = { ...FLY_DEFAULTS, ...(travel.fly || {}) };
  const c = travelChain({ mode: 'fly', back: true, leave: from, fly: { toAirportMin: f.fromAirportMin, checkInMin: f.checkInMin + 20, flightMin: f.flightMin, pickupMin: 20, fromAirportMin: f.toAirportMin } });
  const takeoff = c.legs.find((l) => l.kind === 'fly')?.from ?? null;
  const late = takeoff != null && takeoff > LAST_FLIGHT;
  return { late, legs: c.legs.map((l, i) => ({ ...l, label: [`Drive to the airport (about ${dur(f.fromAirportMin)})`, 'Return the car, check in', late ? `Flight home — after the last flights (about ${hm(LAST_FLIGHT)}): tee off earlier` : `Flight home (about ${dur(f.flightMin)})`, 'Bags', `Drive home (about ${dur(f.toAirportMin)})`][i] || l.label })) };
}

// ------------------------------------------------------------------ wishes for a day (comments + plan_wishes)

const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** '2027-03-12' → 'fri' (the key plan_wishes.day_prefs uses). */
export function weekdayKey(iso) {
  const [y, m, d] = dateParts(iso);
  return y ? WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] : null;
}
/**
 * Each person's wish for one day. Their latest note on that day with a preference wins; else plan_wishes: the
 * day_prefs entry for that weekday ({ fri: 'late', sun: 'early' }), and on the last day their home_by.
 * → [{ who: player_id, pref, homeBy, source: 'note' | 'wishes' }]
 */
export function dayPrefs(date, { comments = [], wishes = [], last = false } = {}) {
  const key = weekdayKey(date);
  const by = new Map();
  for (const w of wishes) {
    if (!w?.player_id) continue;
    const p = (w.day_prefs && typeof w.day_prefs === 'object' ? w.day_prefs[key] : null) || null;
    if (p && p !== 'any') by.set(w.player_id, { who: w.player_id, pref: p, homeBy: null, source: 'wishes' });
    else if (last && w.home_by) by.set(w.player_id, { who: w.player_id, pref: 'home_by', homeBy: String(w.home_by).slice(0, 5), source: 'wishes' });
  }
  const notes = comments.filter((c) => c.day_date && String(c.day_date).slice(0, 10) === date && c.day_pref)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const c of notes) by.set(c.player_id, { who: c.player_id, pref: c.day_pref, homeBy: c.home_by ? String(c.home_by).slice(0, 5) : null, source: 'note' });
  return [...by.values()];
}
/** "3 want the morning free · 1 home by 6pm" */
export function prefsLine(prefs = []) {
  const n = (k) => prefs.filter((p) => p.pref === k).length;
  const homes = prefs.filter((p) => p.pref === 'home_by' && p.homeBy).map((p) => anyClock(p.homeBy)).filter((x) => x != null);
  const bits = [
    n('morning_free') && `${n('morning_free')} want the morning free`,
    n('early') && `${n('early')} want to play early`,
    n('midday') && `${n('midday')} want to play midday`,
    n('late') && `${n('late')} want to play later`,
    n('home_by') && `${n('home_by')} want to be home by ${homes.length ? hm(Math.min(...homes)) : 'a time'}`,
  ].filter(Boolean);
  return bits.join(' · ');
}
