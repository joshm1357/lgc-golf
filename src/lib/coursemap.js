// The trip map's courses (ov36, Josh 23 Oct): "There are courses on the map that I can't select as not on the list",
// "Allow for filtering courses like not played or played or either, ranking? type. Could also ask for expanding the
// search", "Or include ones 'on the way'", "Should allow 'custom' area where you can filter and zoom around."
// Pure functions — the screen is components/AreaStart.jsx.
//   * Filters: played before / not played / either; our rating (★ min); type (from the course research's "style");
//     sort: suggested / rating / drive / top ranked. Courses already on the table always stay in the list.
//   * Search wider: the drive from where you'd stay goes up a step at a time (40 → 45 → 60 … 120 min).
//   * Your own part of the map: the courses inside a box (the map as you see it), saved as "Custom: around X".
//   * On the way: courses a short detour off the straight line from the starting point(s) to the area (no routing).
import { driveBetween, detourMin } from './tripbuilder.js';
import { fmtDrive, reachKm } from './tripfinder.js';
import { nearTowns } from './pinplace.js';

export const REACH_STEPS = [20, 30, 40, 45, 60, 75, 90, 120];
export const MAX_REACH = 120;
export const PAGE = 12;               // list rows shown at a time
export const DETOUR_STEPS = [10, 20, 30, 45];
export const MIN_FROM_START = 25;     // "on the way" skips courses this close to home (that's just a round at home)
export const DEFAULT_FILTERS = { played: 'any', minStars: 0, type: '', sort: 'suggested' };

// ------------------------------------------------------------------ what we know about a course

/** Our rating if we have one, else other groups'. */
export const ratingOf = (course) => (course?.mine_avg != null ? Number(course.mine_avg) : course?.others_avg != null ? Number(course.others_avg) : null);
/** Has the group played it? (the group's own rounds, else the library search's "played" flag). */
export const playedOf = (cand) => !!(cand?.history?.count || cand?.course?.played === true);

/** Course types, with the words in the research's "style" that mean them. Only the ones some course has are offered. */
export const TYPES = [
  ['links', 'Links', /\blinks\b/],
  ['parkland', 'Parkland', /park\s*land/],
  ['resort', 'Resort', /resort/],
  ['heathland', 'Heathland', /heath/],
  ['sandbelt', 'Sandbelt', /sand\s*belt/],
  ['coastal', 'Coastal', /coast|ocean|seaside|cliff|beach/],
  ['bush', 'Bush', /\bbush/],
  ['country', 'Country', /\bcountry\b|rural/],
  ['hills', 'Hills', /mountain|hill|alpine|valley views/],
  ['water', 'Lakes & water', /lake|river|water/],
];
export const TYPE_LABEL = Object.fromEntries(TYPES.map(([k, l]) => [k, l]));

/** A course's types from its research row (details.style): ['links', 'coastal']. */
export function typesOf(research) {
  const s = String(research?.details?.style || '').toLowerCase();
  if (!s) return [];
  return TYPES.filter(([, , re]) => re.test(s)).map(([k]) => k);
}

/** Its best ranking number from the research's "rankings" text ("#12 Golf Australia Top 100" → 12); 999 = ranked,
 *  no number; null = not ranked. */
export function rankOf(research) {
  const t = String(research?.details?.rankings || '').trim();
  if (!t || /^(n\/?a|none|nil|-|not ranked|unranked|no)\b/i.test(t)) return null;
  const nums = [
    ...[...t.matchAll(/(?:#|\bno\.?\s*|\bnumber\s+|\branked\s+)(\d{1,3})\b/gi)].map((m) => Number(m[1])),
    ...[...t.matchAll(/\b(\d{1,3})(?:st|nd|rd|th)\b/gi)].map((m) => Number(m[1])),
  ].filter((n) => n > 0);
  return nums.length ? Math.min(...nums) : 999;
}

/** Which filters have something to filter on. → { stars, types: [key], ranked } */
export function filterOptions(cands = [], research = {}) {
  const types = new Set();
  let stars = false; let ranked = false;
  for (const c of cands) {
    if (ratingOf(c.course) != null) stars = true;
    const r = research[c.course.id];
    for (const t of typesOf(r)) types.add(t);
    if (rankOf(r) != null) ranked = true;
  }
  return { stars, types: TYPES.map(([k]) => k).filter((k) => types.has(k)), ranked };
}

// ------------------------------------------------------------------ filter and sort

/**
 * cands: [{ course, drive: { min, text }, history, suggested }] in suggested order.
 * f: { played: 'any' | 'yes' | 'no', minStars, type, sort: 'suggested' | 'rating' | 'drive' | 'ranked' }.
 * keep: course ids always kept (on the table) — they're listed even when a filter would hide them (flag `kept`).
 * → the list, each with { hidden: false } or { kept: true } for the ones only there because they're on the table.
 */
export function filterCourses(cands = [], f = {}, { research = {}, keep = [] } = {}) {
  const ff = { ...DEFAULT_FILTERS, ...(f || {}) };
  const ok = (c) => {
    if (ff.played === 'yes' && !playedOf(c)) return false;
    if (ff.played === 'no' && playedOf(c)) return false;
    if (Number(ff.minStars) > 0 && !((ratingOf(c.course) ?? -1) >= Number(ff.minStars))) return false;
    if (ff.type && !typesOf(research[c.course.id]).includes(ff.type)) return false;
    return true;
  };
  const keepSet = new Set(keep);
  const list = cands.map((c, i) => ({ ...c, i, pass: ok(c) })).filter((c) => c.pass || keepSet.has(c.course.id));
  const drive = (c) => c.drive?.min ?? 999;
  const by = {
    suggested: (a, b) => a.i - b.i,
    rating: (a, b) => (ratingOf(b.course) ?? -1) - (ratingOf(a.course) ?? -1) || drive(a) - drive(b),
    drive: (a, b) => drive(a) - drive(b) || a.i - b.i,
    ranked: (a, b) => (rankOf(research[a.course.id]) ?? 10000) - (rankOf(research[b.course.id]) ?? 10000) || a.i - b.i,
  }[ff.sort] || ((a, b) => a.i - b.i);
  return list.sort(by).map(({ i, pass, ...c }) => (pass ? c : { ...c, kept: true }));
}

/** Is any filter away from "everything"? */
export const filtersOn = (f = {}) => {
  const ff = { ...DEFAULT_FILTERS, ...(f || {}) };
  return ff.played !== 'any' || Number(ff.minStars) > 0 || !!ff.type;
};

/** "Not played · ★4+ · Links" (or '' with no filters). */
export function filterText(f = {}) {
  const ff = { ...DEFAULT_FILTERS, ...(f || {}) };
  return [ff.played === 'no' ? 'Not played' : ff.played === 'yes' ? 'Played before' : null, Number(ff.minStars) > 0 ? `★${ff.minStars}+` : null,
    ff.type ? TYPE_LABEL[ff.type] || ff.type : null].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------ search wider

/** The next drive step after `cur` minutes (null at the most). */
export function nextReach(cur) {
  const n = REACH_STEPS.find((s) => s > Number(cur || 0));
  return n == null ? null : n;
}
/** "Pokolbin", "Pokolbin and Cessnock", "Pokolbin and 2 more". */
export function fromText(stays = []) {
  const n = (stays || []).map((s) => s?.name).filter(Boolean);
  if (!n.length) return 'where you’d stay';
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  return `${n[0]} and ${n.length - 1} more`;
}
/**
 * What "Show more courses" does next: show more rows of the list, or search a longer drive.
 * → { kind: 'rows', count, text } | { kind: 'wider', from, to, text } | null
 */
export function showMore({ total = 0, shown = PAGE, reach = 40, stays = [] } = {}) {
  if (total > shown) {
    const count = Math.min(PAGE, total - shown);
    return { kind: 'rows', count, text: `Show ${count} more (${total - shown} more within ${fmtDrive(reach)})` };
  }
  const to = nextReach(reach);
  if (to == null) return null;
  return { kind: 'wider', from: reach, to, text: `Search wider: within ${fmtDrive(reach)} of ${fromText(stays)} → ${fmtDrive(to)}` };
}
/** The km of map to search around the stay pins for a drive of `reach` minutes (with a little spare). */
export const searchMarginKm = (reach) => Math.ceil(reachKm(reach) + 5);

// ------------------------------------------------------------------ your own part of the map

/** Is a point inside a box { south, west, north, east }? */
export const inBox = (p, b) => !!(p && b && p.lat != null && p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east);
/** Too big to list sensibly (the library search refuses past 20° anyway). */
export const boxTooBig = (b) => !b || b.north - b.south > 3 || b.east - b.west > 4;
/** A box's centre. */
export const boxCentre = (b) => ({ lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 });
/** Round a box to 3 places (what's saved). */
export const roundBox = (b) => Object.fromEntries(['south', 'west', 'north', 'east'].map((k) => [k, Math.round(b[k] * 1000) / 1000]));

/** The name for a saved part of the map: "Custom: around Port Stephens" (the nearest town), else "Custom: my area". */
export function customAreaName(box, areas = [], taken = []) {
  const [t] = nearTowns(boxCentre(box), areas, 1, 60);
  const base = `Custom: around ${t ? t.name : 'my area'}`;
  let name = base; let n = 2;
  while (taken.includes(name)) name = `${base} ${n++}`;
  return name;
}
/** Is this area one of the trip's own (saved from the map)? */
export const isCustomArea = (st, area) => !!(st?.customAreas || {})[area];

// ------------------------------------------------------------------ on the way

/**
 * Courses a short detour off the drive from the starting point(s) to the area — a straight line, no routing.
 * starts: [{ label, lat, lng }]; to: { lat, lng } (where you'd stay); maxDetour: minutes off the drive.
 * skip: course ids already in the area's own list. Courses within minFromStart of a start are left out (home rounds),
 * and so are ones the far side of the area (past it).
 * → [{ course, detour, fromStart, start: label, drive: { min, text } }], smallest detour first.
 */
export function onTheWay(courses = [], { starts = [], to = null, maxDetour = 20, skip = [], minFromStart = MIN_FROM_START, limit = 40 } = {}) {
  const ss = (starts || []).filter((s) => s && s.lat != null);
  if (!to || to.lat == null || !ss.length) return [];
  const skipSet = new Set(skip);
  const out = [];
  for (const c of courses) {
    if (!c || c.lat == null || skipSet.has(c.id)) continue;
    let best = null;
    for (const s of ss) {
      const whole = driveBetween(s, to);
      if (whole < 45) continue; // a short trip has no "on the way"
      const fromStart = driveBetween(s, c);
      if (fromStart < minFromStart) continue;
      if (driveBetween(c, to) > whole) continue; // past the area or behind the start
      const d = detourMin(s, c, to);
      if (d == null || d > maxDetour) continue;
      if (!best || d < best.detour) best = { detour: d, fromStart, start: s.label || 'home' };
    }
    if (best) out.push({ course: c, ...best, drive: { min: best.detour, text: `${fmtDrive(best.detour)} off the drive` } });
  }
  return out.sort((a, b) => a.detour - b.detour || a.fromStart - b.fromStart).slice(0, limit);
}

/** "On the way up or back · about 10 min off the drive · 1 h 20 from Inner West". */
export function onWayLine(w) {
  if (!w) return '';
  return `On the way up or back · about ${fmtDrive(w.detour)} off the drive · ${fmtDrive(w.fromStart)} from ${w.start}`;
}

/** Boxes to search along the drive (one per ~100 km, so a long drive doesn't hit the library search's 400 cap). */
export function corridorBoxes(starts = [], to = null, maxDetour = 20) {
  const ss = (starts || []).filter((s) => s && s.lat != null);
  if (!to || to.lat == null) return [];
  const margin = reachKm(maxDetour / 2) + 5;
  const boxes = [];
  for (const s of ss) {
    const kmLong = Math.hypot((to.lat - s.lat) * 111, (to.lng - s.lng) * 111 * Math.cos((s.lat * Math.PI) / 180));
    const n = Math.max(1, Math.min(6, Math.ceil(kmLong / 100)));
    for (let i = 0; i < n; i++) {
      const a = { lat: s.lat + ((to.lat - s.lat) * i) / n, lng: s.lng + ((to.lng - s.lng) * i) / n };
      const b = { lat: s.lat + ((to.lat - s.lat) * (i + 1)) / n, lng: s.lng + ((to.lng - s.lng) * (i + 1)) / n };
      const dLat = margin / 111; const dLng = margin / (111 * Math.max(0.2, Math.cos((a.lat * Math.PI) / 180)));
      boxes.push({ south: Math.min(a.lat, b.lat) - dLat, north: Math.max(a.lat, b.lat) + dLat, west: Math.min(a.lng, b.lng) - dLng, east: Math.max(a.lng, b.lng) + dLng,
        lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
    }
  }
  return boxes;
}
