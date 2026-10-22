// The planning maps' extras (ov22, Josh 23 Oct). Pure bits, tested in placeinfo.test.js; the map and list parts are in
// components/PlanMapTools.jsx and components/PlaceSheets.jsx.
//   * Club names on the map: a short name next to each course pin (on by default, remembered on this device), with
//     labels that would sit on top of each other hidden — the more important pin keeps its label.
//   * Hover for a quick summary, click for everything: one line or two about a course or a place to stay.
//   * First tap / second tap on a phone: the first tap shows the summary, the second opens the details.

import { feesText, stars, tidy, ACCESS } from './courseresearch.js';
import { driveBetween } from './tripbuilder.js';

const str = (v) => (v == null ? '' : String(v).trim());

// ------------------------------------------------------------------ club names on the map

export const NAMES_KEY = 'tgt-map-names';
/** Club names on? On unless this device switched them off. */
export function readNames(store) {
  try { return (store ?? localStorage)?.getItem(NAMES_KEY) !== 'off'; } catch { return true; }
}
export function saveNames(on, store) {
  try { (store ?? localStorage)?.setItem(NAMES_KEY, on ? 'on' : 'off'); } catch { /* fine: on again next time */ }
}

/** "Kiama Golf Club" → "Kiama"; "The Vintage Golf Club" → "The Vintage"; long names cut to `max` with "…". */
export function shortName(name, max = 18) {
  let s = str(name)
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\b(golf\s*(&|and)\s*country\s+club|golf\s+(club|course|links|resort)|country\s+club|golf\s*&\s*bowls?\s+club|sports?\s+club|golf|g\.?c\.?|c\.?c\.?)\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
  if (!s) s = str(name);
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * Labels that collide, to hide. boxes: [{ id, x, y, w, h, p }] (screen px; p = priority, higher keeps its label).
 * fixed: boxes that always show (the 🏠 stay labels) — course labels on top of them hide. → Set of ids to hide.
 * Greedy: the most important first; a label that overlaps one already kept (or a fixed one) is hidden.
 */
export function declutter(boxes = [], fixed = [], gap = 2) {
  const hit = (a, b) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
  const kept = [...fixed];
  const hidden = new Set();
  [...boxes].sort((a, b) => (b.p || 0) - (a.p || 0)).forEach((b) => {
    if (kept.some((k) => hit(b, k))) hidden.add(b.id);
    else kept.push(b);
  });
  return hidden;
}
/** A course pin's label priority: the hovered one, then most voted, then on the table, then suggested, then the rest. */
export const labelPriority = (c, hot = false) => (hot ? 9 : c?.top ? 4 : c?.on ? 3 : c?.sug ? 2 : 1);

// ------------------------------------------------------------------ hover for a quick summary

/** Money as "$55". */
const dollars = (n) => (n == null || Number.isNaN(Number(n)) ? '' : `$${Math.round(Number(n))}`);

/**
 * A course's quick summary: { name, lines: [..] } — name, style, ★ good for groups, weekday/weekend fee, drive time and
 * visitor times, only what we have. research: a course_research row; booking: course_booking_info; drive: "35 min".
 */
export function courseTip({ course = {}, research = null, booking = null, drive = '', facts = {} } = {}) {
  const d = research?.details || {};
  const style = [str(d.style), research?.access_type ? (ACCESS[research.access_type] || '').split(' — ')[0] : ''].filter(Boolean).join(' · ');
  const groups = research?.good_for_groups ? `${stars(research.good_for_groups)} for groups` : '';
  const fees = research ? feesText(research) : '';
  const visitors = tidy(d.visitor_times) || str(booking?.visitor_times) || str(facts?.visitor_times?.value);
  const lines = [
    [style, groups].filter(Boolean).join(' · '),
    [fees, drive ? `🚗 ${/^0(–0)? min$/.test(drive) ? 'under 5 min' : drive}` : ''].filter(Boolean).join(' · '),
    visitors ? `Visitors: ${visitors.length > 70 ? `${visitors.slice(0, 69)}…` : visitors}` : '',
  ].filter(Boolean);
  if (!lines.length) lines.push(course.area ? str(course.area) : 'No details yet — open it for more');
  return { name: str(course.name), lines };
}

/** Courses nearest a place to stay: [{ id, name, min }] (drive minutes), nearest first. */
export function nearestCourses(stay, courses = [], n = 3) {
  if (stay?.lat == null) return [];
  return (courses || []).filter((c) => c?.lat != null)
    .map((c) => ({ id: c.id, name: c.name, min: Math.round(driveBetween(stay, c)), on: !!c.on }))
    .sort((a, b) => a.min - b.min).slice(0, n);
}

/** The cheapest idea each, and the most it sleeps: from the area's accommodation ideas (plan_stays rows). */
export function stayIdeasSummary(ideas = [], people = 0) {
  const costs = ideas.filter((a) => a.total_cost != null).map((a) => Number(a.total_cost));
  const sleeps = ideas.filter((a) => a.sleeps != null).map((a) => Number(a.sleeps));
  const each = costs.length && people > 0 ? Math.round(Math.min(...costs) / people) : null;
  return {
    count: ideas.length,
    from: costs.length ? Math.min(...costs) : null,
    each,
    sleeps: sleeps.length ? Math.max(...sleeps) : null,
  };
}

/** A place to stay's quick summary: { name, lines } — type, sleeps, price, distance to the nearest courses. */
export function stayTip({ stay = {}, courses = [], ideas = [], people = 0 } = {}) {
  const type = stay.custom ? 'Your pin' : stay.type || 'Town';
  const s = stayIdeasSummary(ideas, people);
  const near = nearestCourses(stay, courses, 3);
  const lines = [
    [type, s.count ? `${s.count} place${s.count === 1 ? '' : 's'} saved` : '', s.sleeps ? `sleeps up to ${s.sleeps}` : ''].filter(Boolean).join(' · '),
    s.from != null ? `From ${dollars(s.from)}${s.each != null ? ` (about ${dollars(s.each)} each)` : ''}` : '',
    near.length ? `⛳ ${near.map((c) => `${shortName(c.name, 16)} ${c.min < 5 ? 'under 5' : c.min} min`).join(' · ')}` : '',
  ].filter(Boolean);
  return { name: str(stay.name), lines };
}

// ------------------------------------------------------------------ click for everything

/** Labels for the research words that aboutLines() doesn't already show. Anything else gets its key tidied. */
const EXTRA_LABELS = {
  signature_features: 'Signature', practice_facilities: 'Practice', practice: 'Practice', food_and_drink: 'Food & drink',
  food_drink: 'Food & drink', food: 'Food & drink', pace_of_play: 'Pace', pace: 'Pace', dress_code: 'Dress code',
  best_months: 'Best months', weather_notes: 'Weather', weather: 'Weather', crowd_notes: 'Crowds', crowds: 'Crowds',
  nearby_courses: 'Nearby courses', nearby: 'Nearby courses', accommodation_on_site: 'Accommodation', accommodation: 'Accommodation',
  accommodation_partners: 'Accommodation partners', on_deal_sites: 'Deals', booking_platform: 'Booking system',
  green_fee_weekday_aud: 'Weekday fee', green_fee_weekend_aud: 'Weekend fee', cart: 'Carts', carts: 'Carts', notes: 'Notes',
};
/** Already in the "About this course for groups" block (aboutLines) — not repeated. */
const SHOWN = new Set(['style', 'difficulty', 'rankings', 'access_route', 'twilight_or_group_rates', 'visitor_times', 'members_times',
  'group_bookings_how', 'stay_and_play', 'good_for_groups', 'drive_from_sydney_cbd']);
const labelOf = (k) => EXTRA_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_aud$/, '').replace(/_/g, ' ');

/** Everything else in the research: [{ label, value }], in a sensible order (known ones first). */
export function extraResearchLines(r) {
  const d = r?.details && typeof r.details === 'object' ? r.details : {};
  const order = Object.keys(EXTRA_LABELS);
  const keys = Object.keys(d).filter((k) => !SHOWN.has(k) && str(d[k]) && !/^(no|none|n\/a|nil|not found|-)$/i.test(str(d[k])))
    .sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
  const seen = new Set();
  const out = [];
  for (const k of keys) {
    const label = labelOf(k);
    const value = tidy(str(d[k]));
    if (!value || seen.has(`${label}|${value}`)) continue;
    seen.add(`${label}|${value}`);
    out.push({ key: k, label, value: value.length > 400 ? `${value.slice(0, 399)}…` : value });
  }
  return out;
}

/** A link to see the spot on a map (no key needed). */
export const mapLink = (p) => (p?.lat != null && p?.lng != null ? `https://www.openstreetmap.org/?mlat=${Number(p.lat).toFixed(5)}&mlon=${Number(p.lng).toFixed(5)}#map=14/${Number(p.lat).toFixed(4)}/${Number(p.lng).toFixed(4)}` : null);

// ------------------------------------------------------------------ hover / first tap / second tap

/**
 * What a tap or click on a pin or a row does. With a mouse (canHover): click opens the details (hover already showed
 * the summary). On a phone: the first tap shows the summary, a second tap on the same one opens the details.
 * → 'tip' | 'open'
 */
export function tapAction({ key, hotKey = null, canHover = true } = {}) {
  if (canHover) return 'open';
  return hotKey === key ? 'open' : 'tip';
}
