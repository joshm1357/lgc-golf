// Trip finder (Stage 16): which courses suit the group, and why. Pure functions only — the screen, the connector and
// the tests all use these. No street addresses anywhere: starting points are areas (a suburb or town and a headcount).
//
//   * Drive times are an estimate: straight-line distance × 1.3, at 80 km/h, always labelled "about".
//   * Each course is "fits" (teal), "check" (amber — facts unknown) or "doesn't fit" (grey), with the reason.
//   * Ranking presets: Fair drive (default: the longest drive first, then the average), Cheapest, Best course.
//   * Course facts are shared by every group; a club's confirmation wins, then confirmed, then pending. Facts older
//     than 12 months say "check again". Who suggested a fact is never part of it.
import { teeWindow, clock, toMin, DEFAULT_LEAVE, DEFAULT_FINISH } from './teeWindow.js';

export const ROAD_FACTOR = 1.3;
export const SPEED_KMH = 80;
export const STALE_DAYS = 365;
export const MAX_STARTS = 3;
export const MAX_PICKS = 3;

/** The facts the app keeps about a course. kind: times (e.g. "Sat 7:00-12:00"), number, money, text, yesno. */
export const FACTS = [
  { key: 'visitor_times', label: 'Visitor times', kind: 'times', hint: 'e.g. Sat 7:00-12:00; Sun 9:00-13:00' },
  { key: 'member_times', label: 'Members only', kind: 'times', hint: 'e.g. Sat 6:30-9:00' },
  { key: 'max_group', label: 'Largest group taken', kind: 'number', unit: 'players' },
  { key: 'price_18', label: 'Price for 18 holes', kind: 'money', unit: 'each' },
  { key: 'price_9', label: 'Price for 9 holes', kind: 'money', unit: 'each' },
  { key: 'book_ahead', label: 'How far ahead to book', kind: 'text', hint: 'e.g. 6 weeks' },
  { key: 'start_interval', label: 'Start interval', kind: 'number', unit: 'minutes' },
  { key: 'round_length', label: 'Round length (18 holes)', kind: 'number', unit: 'minutes' },
  { key: 'carts', label: 'Carts', kind: 'text', hint: 'e.g. $40 each, book ahead' },
  { key: 'stay_play', label: 'Stay and play', kind: 'yesno', hint: 'e.g. Yes — lodge on site' },
];
export const FACT = Object.fromEntries(FACTS.map((f) => [f.key, f]));
export const SOURCES = { organiser: 'an organiser', club: 'the club', research: 'research', email: 'an email reply' };

// ------------------------------------------------------------------ distance and drive times

/** Straight-line distance in km between two { lat, lng } points. */
export function km(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** About how long a drive of this straight-line distance takes, in minutes. */
export function driveMinutes(straightKm) {
  if (straightKm == null) return null;
  return Math.round(((straightKm * ROAD_FACTOR) / SPEED_KMH) * 60);
}

/** The straight-line distance you can cover in this many minutes of driving. */
export function reachKm(minutes) {
  return ((Number(minutes) || 0) / 60) * SPEED_KMH / ROAD_FACTOR;
}

/** 160 → '2 h 40', 45 → '45 min', 120 → '2 h'. */
export function fmtDrive(min) {
  if (min == null) return '?';
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

/** Each starting point's drive to a course, the longest, and the average per person. */
export function drivesFor(course, starts) {
  const list = (starts || []).filter((s) => s.lat != null).map((s) => {
    const d = km(s, course);
    return { label: s.label, count: Math.max(1, Number(s.count) || 1), km: d, min: driveMinutes(d) };
  });
  if (!list.length) return { list, longest: null, average: null };
  const longest = list.reduce((a, b) => (b.min > a.min ? b : a));
  const people = list.reduce((n, s) => n + s.count, 0);
  const average = Math.round(list.reduce((n, s) => n + s.min * s.count, 0) / people);
  return { list, longest, average };
}

/** The box of map to search: every starting point's reach (capped), joined up. */
export function searchBox(starts, maxDriveMin = 180) {
  const pts = (starts || []).filter((s) => s.lat != null && s.lng != null);
  if (!pts.length) return null;
  const r = Math.min(reachKm(maxDriveMin), 400);
  let south = 90; let north = -90; let west = 180; let east = -180;
  for (const p of pts) {
    const dLat = r / 111;
    const dLng = r / (111 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)));
    south = Math.min(south, p.lat - dLat); north = Math.max(north, p.lat + dLat);
    west = Math.min(west, p.lng - dLng); east = Math.max(east, p.lng + dLng);
  }
  const c = centre(pts);
  return { south, west, north, east, lat: c.lat, lng: c.lng };
}

/** The middle of some points, weighted by headcount. */
export function centre(pts) {
  const n = pts.reduce((a, p) => a + (Number(p.count) || 1), 0) || 1;
  return {
    lat: pts.reduce((a, p) => a + p.lat * (Number(p.count) || 1), 0) / n,
    lng: pts.reduce((a, p) => a + p.lng * (Number(p.count) || 1), 0) / n,
  };
}

// ------------------------------------------------------------------ starting points from players' home suburbs

/**
 * Players' shared home areas → up to 3 starting points ("Inner West ×8, Newcastle ×2, Canberra ×2").
 * Homes within `nearKm` of an area's middle join it; anything past the third area joins the nearest of the three.
 * homes: [{ label, lat, lng }]. Only approximate places — never addresses.
 */
export function startsFromHomes(homes, { nearKm = 25, max = MAX_STARTS } = {}) {
  const areas = [];
  for (const h of (homes || []).filter((x) => x && x.lat != null && x.lng != null)) {
    const near = areas
      .map((a) => ({ a, d: km(a, h) }))
      .filter((x) => x.d <= nearKm)
      .sort((x, y) => x.d - y.d)[0];
    const a = near?.a || (areas.push({ homes: [], lat: h.lat, lng: h.lng }), areas[areas.length - 1]);
    a.homes.push(h);
    a.lat = a.homes.reduce((s, x) => s + x.lat, 0) / a.homes.length;
    a.lng = a.homes.reduce((s, x) => s + x.lng, 0) / a.homes.length;
  }
  areas.sort((x, y) => y.homes.length - x.homes.length);
  const top = areas.slice(0, max);
  for (const extra of areas.slice(max)) {
    const to = top.map((a) => ({ a, d: km(a, extra) })).sort((x, y) => x.d - y.d)[0].a;
    to.homes.push(...extra.homes);
  }
  return top.map((a) => {
    const names = {};
    for (const h of a.homes) { const k = String(h.label || '').trim(); if (k) names[k] = (names[k] || 0) + 1; }
    const label = Object.entries(names).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] || 'Area';
    return { label, lat: round2(a.lat), lng: round2(a.lng), count: a.homes.length, leave: DEFAULT_LEAVE, finish: DEFAULT_FINISH };
  });
}

/** Two decimal places (about 1 km) — the most precise a home area is ever kept. */
export function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

/** "Inner West ×8, Newcastle ×2" */
export function startsText(starts) {
  return (starts || []).map((s) => `${s.label} ×${s.count}`).join(', ');
}

// ------------------------------------------------------------------ course facts

/** One best value per fact: a club's word first, then confirmed, then pending; newest first within each. */
export function pickFacts(rows, now = new Date()) {
  const rank = (r) => (r.club ? 0 : r.status === 'confirmed' ? 1 : 2);
  const out = {};
  for (const r of (rows || []).filter((x) => x && FACT[x.fact] && x.status !== 'rejected')) {
    const cur = out[r.fact];
    if (!cur || rank(r) < rank(cur) || (rank(r) === rank(cur) && String(r.checked_at || '') > String(cur.checked_at || ''))) out[r.fact] = r;
  }
  for (const k of Object.keys(out)) {
    const r = out[k];
    const age = r.checked_at ? (now - new Date(`${String(r.checked_at).slice(0, 10)}T00:00:00`)) / 86400000 : Infinity;
    out[k] = { ...r, stale: age > STALE_DAYS, pending: r.status !== 'confirmed' };
  }
  return out;
}

/** '$95' / '95' / '95.50' → 95.5; anything else → null. */
export function num(v) {
  if (v == null) return null;
  const m = /-?\d+(\.\d+)?/.exec(String(v).replace(/,/g, ''));
  return m ? Number(m[0]) : null;
}

/** 'Yes — lodge on site' → true, 'No' → false, anything else → null. */
export function yesNo(v) {
  if (v == null) return null;
  if (/^\s*(yes|y|true)\b/i.test(String(v))) return true;
  if (/^\s*(no|n|false)\b/i.test(String(v))) return false;
  return null;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** '7am' / '7:30' / '1:30pm' / '13:00' → minutes. */
export function parseClock(t) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(String(t ?? ''));
  if (!m) return null;
  let h = Number(m[1]);
  const mm = Number(m[2] || 0);
  if (mm > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3].toLowerCase() === 'pm' && h !== 12) h += 12;
    if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
  } else if (h > 23) return null;
  return h * 60 + mm;
}

function parseDays(spec) {
  const s = String(spec || '').trim().toLowerCase();
  if (!s || /^(daily|every ?day|any|all|everyday|7 days)$/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^weekdays?$/.test(s)) return [1, 2, 3, 4, 5];
  if (/^weekends?$/.test(s)) return [0, 6];
  const out = new Set();
  for (const part of s.split(/\s*(?:,|&|\/|\band\b)\s*/)) {
    const rng = /^([a-z]{3})[a-z]*\s*(?:-|–|to)\s*([a-z]{3})[a-z]*$/.exec(part);
    if (rng) {
      const a = DAY_NAMES.indexOf(rng[1]);
      const b = DAY_NAMES.indexOf(rng[2]);
      if (a < 0 || b < 0) return null;
      for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
      continue;
    }
    if (/^weekends?$/.test(part)) { out.add(0); out.add(6); continue; }
    if (/^weekdays?$/.test(part)) { [1, 2, 3, 4, 5].forEach((d) => out.add(d)); continue; }
    const d = DAY_NAMES.indexOf(part.slice(0, 3));
    if (d < 0) return null;
    out.add(d);
  }
  return [...out].sort();
}

/**
 * "Sat 7:00-12:00; Sun 9am-1pm, Mon-Fri 6:30-10:00" → [{ days: [6], from: 420, to: 720 }, …].
 * Parts it can't read are left out (and counted in .unread).
 */
export function parseTimes(text) {
  const out = [];
  let unread = 0;
  for (const raw of String(text || '').split(/\s*;\s*|\n/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(.*?)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i.exec(part);
    const days = m ? parseDays(m[1]) : null;
    const from = m ? parseClock(m[2]) : null;
    const to = m ? parseClock(m[3]) : null;
    if (!days || !days.length || from == null || to == null || to <= from) { unread += 1; continue; }
    out.push({ days, from, to });
  }
  out.unread = unread;
  return out;
}

/** The day of the week (0 = Sunday) of an ISO date, read as a local date. */
export function weekday(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getDay();
}

/** The trip's first day, or else the next Saturday. */
export function defaultDay(plan, today = new Date()) {
  if (plan?.start_date) return String(plan.start_date).slice(0, 10);
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() + (((6 - d.getDay()) + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Where a tee window [a, b] meets times on a day; null if it doesn't. */
function overlap(slots, day, a, b) {
  let best = null;
  for (const s of slots.filter((x) => x.days.includes(day))) {
    const from = Math.max(a, s.from);
    const to = Math.min(b, s.to);
    if (from <= to && (!best || to - from > best.to - best.from)) best = { from, to };
  }
  return best;
}

const slotText = (slots, day) => slots.filter((s) => s.days.includes(day)).map((s) => `${clock(s.from)}–${clock(s.to)}`).join(', ');

// ------------------------------------------------------------------ one course: fits, check or doesn't fit, and why

/**
 * course: { id, name, area, lat, lng, facts: [...], mine_avg, mine_n, others_avg, others_n, played }
 * ctx:    { starts: [{ label, lat, lng, count, leave, finish }], players, holes, day: 'YYYY-MM-DD', maxDriveMin, now }
 */
export function assessCourse(course, ctx) {
  const holes = Number(ctx.holes) === 9 ? 9 : 18;
  const facts = pickFacts(course.facts, ctx.now || new Date());
  const drives = drivesFor(course, ctx.starts);
  const interval = num(facts.start_interval?.value);
  const len18 = num(facts.round_length?.value);
  const roundMinutes = len18 ? (holes === 9 ? Math.round(len18 / 2) : len18) : null;
  const w = teeWindow({
    players: ctx.players, holes, interval, roundMinutes,
    starts: (ctx.starts || []).map((s, i) => ({ label: s.label, leave: s.leave, finish: s.finish, driveMin: drives.list[i]?.min ?? 0 })),
  });
  const no = [];
  const unknown = [];
  if (ctx.maxDriveMin && drives.longest && drives.longest.min > ctx.maxDriveMin) {
    no.push(`longest drive about ${fmtDrive(drives.longest.min)} (${drives.longest.label}) — over your ${fmtDrive(ctx.maxDriveMin)} limit`);
  }
  if (!w.fits) no.push(w.reason);

  // Visitors in the window, on that day.
  const day = weekday(ctx.day);
  let window = w.fits ? { from: w.earliest, to: w.latest } : null;
  let visitors = null; // true / false / null (unknown)
  const vt = facts.visitor_times ? parseTimes(facts.visitor_times.value) : null;
  if (vt && vt.length && day != null) {
    if (!vt.some((s) => s.days.includes(day))) { visitors = false; no.push(`no visitor times on ${DAY_LONG[day]}`); }
    else if (w.fits) {
      const o = overlap(vt, day, w.earliest, w.latest);
      if (o) { visitors = true; window = o; }
      else { visitors = false; no.push(`visitors ${slotText(vt, day)} — outside ${w.text}`); }
    } else visitors = true;
  } else if (facts.member_times && day != null && w.fits) {
    // Only member times known: if they cover the whole window, visitors can't get on.
    const mt = parseTimes(facts.member_times.value).filter((s) => s.days.includes(day));
    if (mt.some((s) => s.from <= w.earliest && s.to >= w.latest)) { visitors = false; no.push('members only for the whole window'); }
  }
  if (visitors == null && !no.length) unknown.push('visitor times');

  // Takes the group's size.
  const maxGroup = num(facts.max_group?.value);
  let takesGroup = null;
  if (maxGroup != null) {
    takesGroup = Number(ctx.players) <= maxGroup;
    if (!takesGroup) no.push(`takes groups up to ${maxGroup}`);
  } else if (!no.length) unknown.push('group size');

  const price = num((holes === 9 ? facts.price_9 : facts.price_18)?.value);
  const stayPlay = yesNo(facts.stay_play?.value);
  const mine = course.mine_avg != null ? Number(course.mine_avg) : null;
  const others = course.others_avg != null ? Number(course.others_avg) : null;
  const rating = mine ?? others;
  const ratingText = mine != null ? `your group rated ${mine.toFixed(1)}`
    : others != null ? `rated ${others.toFixed(1)} by ${course.others_n} other group${Number(course.others_n) === 1 ? '' : 's'}` : null;

  const status = no.length ? 'no' : unknown.length ? 'check' : 'fits';
  const winText = window ? `${clock(window.from)}–${clock(window.to)}` : null;
  const driveText = drives.longest ? `longest drive about ${fmtDrive(drives.longest.min)}` : null;
  const priceText = price != null ? `$${Math.round(price)}` : null;
  let why;
  if (status === 'fits') why = [`Fits ${winText}`, driveText, priceText, ratingText];
  else if (status === 'check') why = [`Check ${unknown.join(' and ')}`, winText && `tee off ${winText}`, driveText, priceText, ratingText];
  else why = [`Doesn’t fit: ${no[0]}`];
  const stale = Object.values(facts).some((f) => f.stale);

  return {
    course, status, why: why.filter(Boolean).join(' · '), reasons: no, unknown, window, windowText: winText, teeWindow: w,
    drives, longest: drives.longest?.min ?? null, average: drives.average, price, rating, ratingText, mine, others,
    stayPlay, takesGroup, visitors, played: !!course.played, facts, stale,
  };
}

// ------------------------------------------------------------------ ranking

export const PRESETS = [
  { value: 'fair', label: 'Fair drive' },
  { value: 'cheap', label: 'Cheapest' },
  { value: 'best', label: 'Best course' },
];
const STATUS_ORDER = { fits: 0, check: 1, no: 2 };
const last = (v, dir = 1) => (v == null ? Infinity : v * dir);

/**
 * Filter and rank assessed courses. preset: 'fair' (default) | 'cheap' | 'best'.
 * filters: { fitsOnly, takesGroup, stayPlay, notPlayed, favourites, maxPrice }
 */
export function rankCourses(assessed, preset = 'fair', filters = {}) {
  const keep = (a) => {
    if (filters.fitsOnly && a.status !== 'fits') return false;
    if (filters.takesGroup && a.takesGroup !== true) return false;
    if (filters.stayPlay && a.stayPlay !== true) return false;
    if (filters.notPlayed && a.played) return false;
    if (filters.favourites && !(a.mine != null && a.mine >= 4)) return false;
    if (filters.maxPrice != null && filters.maxPrice !== '' && a.price != null && a.price > Number(filters.maxPrice)) return false;
    return true;
  };
  const byDrive = (a, b) => last(a.longest) - last(b.longest) || last(a.average) - last(b.average);
  const cmp = {
    fair: byDrive,
    cheap: (a, b) => last(a.price) - last(b.price) || byDrive(a, b),
    best: (a, b) => last(a.rating, -1) - last(b.rating, -1) || byDrive(a, b),
  }[preset] || byDrive;
  return assessed
    .filter(keep)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || cmp(a, b) || String(a.course.name).localeCompare(String(b.course.name)));
}

/** Everything in one go: assess every course, then rank. */
export function findCourses(courses, ctx, preset = 'fair', filters = {}) {
  return rankCourses((courses || []).filter((c) => c.lat != null).map((c) => assessCourse(c, ctx)), preset, filters);
}

// ------------------------------------------------------------------ putting options to the group

/** The facts that go with an option in the place vote (plain text, one line). */
export function optionNotes(a) {
  const f = a.facts || {};
  const bits = [
    a.status === 'fits' ? `Fits ${a.windowText}` : a.windowText ? `Tee off ${a.windowText} (to check)` : null,
    a.longest != null ? `longest drive about ${fmtDrive(a.longest)}` : null,
    a.average != null ? `average about ${fmtDrive(a.average)}` : null,
    f.visitor_times ? `visitors ${f.visitor_times.value}` : null,
    f.max_group ? `groups up to ${num(f.max_group.value)}` : null,
    f.book_ahead ? `book ${f.book_ahead.value} ahead` : null,
    a.stayPlay ? 'stay and play' : null,
    a.ratingText,
  ].filter(Boolean);
  return bits.join(' · ').slice(0, 480);
}

/** What "Put to the group" sends: one option per ticked course. */
export function voteOptions(picked, { day } = {}) {
  return picked.slice(0, MAX_PICKS).map((a) => ({
    course_id: a.course.id,
    label: a.course.name,
    address: a.course.area || null,
    notes: optionNotes(a),
    cost_pp: a.price,
    start_date: day || null,
  }));
}

/** After the trip: which course the group played, from "Just decide" or the place vote's winner. */
export function decidedCourse(find, polls) {
  if (!find) return null;
  if (find.decided_course_id) return find.decided_course_id;
  const picks = Array.isArray(find.picks) ? find.picks : [];
  for (const p of polls || []) {
    if (p.kind !== 'location' || !p.winner_option_id) continue;
    const hit = picks.find((x) => x.option_id === p.winner_option_id);
    if (hit) return hit.course_id;
  }
  return null;
}

/** Leave/finish as 'HH:MM' with defaults — what the starting-points form saves. */
export function cleanStart(s) {
  const leave = toMin(s.leave) != null ? s.leave : DEFAULT_LEAVE;
  const finish = toMin(s.finish) != null ? s.finish : DEFAULT_FINISH;
  return {
    label: String(s.label || '').trim().slice(0, 60),
    lat: round2(s.lat), lng: round2(s.lng),
    count: Math.max(1, Math.min(60, Math.round(Number(s.count) || 1))),
    leave, finish,
  };
}

// ------------------------------------------------------------------ finding a place by name (OpenStreetMap search)

/** The free OpenStreetMap search, for towns and suburbs only (never streets or houses). One request per search. */
export function nominatimUrl(q, country = 'au') {
  const p = new URLSearchParams({ q: String(q || '').trim().slice(0, 80), format: 'jsonv2', limit: '6', addressdetails: '1', featureType: 'settlement' });
  if (country) p.set('countrycodes', country);
  return `https://nominatim.openstreetmap.org/search?${p}`;
}

/** One OpenStreetMap result → { label, where, postcode, lat, lng } kept to about 1 km; null if it isn't a usable place. */
export function placeFromNominatim(r) {
  if (!r || r.lat == null || r.lon == null) return null;
  const a = r.address || {};
  const name = a.suburb || a.town || a.city || a.village || a.hamlet || a.municipality || a.city_district || r.name
    || String(r.display_name || '').split(',')[0];
  const label = String(name || '').replace(/[0-9]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (label.length < 2) return null;
  const state = a.state_code || String(a['ISO3166-2-lvl4'] || '').split('-')[1] || '';
  return {
    label, where: [label, state].filter(Boolean).join(' '),
    postcode: /^[0-9]{4}$/.test(a.postcode || '') ? a.postcode : null,
    lat: round2(Number(r.lat)), lng: round2(Number(r.lon)),
  };
}

/** How a fact reads on a course: "$95 · from the club · checked Oct 2026", plus "not confirmed yet" / "check again". */
export function factLine(f, now = new Date()) {
  if (!f) return '';
  const d = f.checked_at ? new Date(`${String(f.checked_at).slice(0, 10)}T00:00:00`) : null;
  const when = d ? d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' }) : null;
  const def = FACT[f.fact];
  const shown = def?.kind === 'money' ? `$${num(f.value)}` : def?.kind === 'number' && def.unit ? `${f.value} ${def.unit}` : f.value;
  const stale = f.stale ?? (d ? (now - d) / 86400000 > STALE_DAYS : false);
  return [shown, f.club ? 'from the club' : `from ${SOURCES[f.source] || 'an organiser'}`, when && `checked ${when}`,
    f.status !== 'confirmed' ? 'not confirmed yet' : null, stale ? 'check again' : null].filter(Boolean).join(' · ');
}
