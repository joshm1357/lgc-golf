// Trip ideas (108, ov39 — Josh 25 Oct 2026): someone proposes, the group adds, the organiser tidies, the group votes.
//   COLLECT — "Help plan <idea> — 4 quick taps" (plan_wishes, one row per person): weekends I can't do (or, with the
//             weekend fixed, In / Maybe / Can't), spend, getting there + max drive, golf per day + how I'd like each
//             day, and one wish. Shown back as one summary line.
//   SHAPE   — the idea's lists (dates, areas, courses; 👍 / 👎; ✨ from the Caddie) with a fit line on each.
//   DECIDE  — the organiser ticks what goes to the vote → the v10.6 When? / Where? votes (the trip builder's state).
//             The unticked ones can start another idea.
// "The definition" (Josh 19:22): the organiser can fix the weekend, the area or the length. Suggestions outside it go
// to the organiser's queue (the database marks them 'queued'); inside it, straight onto the lists.
// Pure functions only — screens/TripIdea.jsx and the tests use these.
import { addDays, dateOf, isoOf, weekendLabel, driveBetween, regionsFrom, matchRegions } from './tripbuilder.js';

// ------------------------------------------------------------------ the 4 quick taps

export const SPEND = [
  { value: 'lt500', label: 'Under $500', max: 500 },
  { value: '500_800', label: '$500–800', max: 800 },
  { value: '800_1200', label: '$800–1,200', max: 1200 },
  { value: 'any', label: 'Not fussed', max: Infinity },
];
export const TRAVEL = [
  { value: 'drive', label: 'Drive only' },
  { value: 'fly', label: 'Happy to fly' },
  { value: 'either', label: 'Either' },
];
export const MAX_DRIVE = [
  { value: 120, label: '2 h' },
  { value: 180, label: '3 h' },
  { value: 240, label: '4+ h' },
];
// How much golf (Josh 19:34) — a person's wish and the organiser's setting.
export const GOLF = [
  { value: 'max', label: 'As much as possible' },
  { value: 'daily', label: 'A round a day' },
  { value: 'spare_day', label: 'Leave a spare day' },
  { value: 'any', label: 'Not fussed' },
];
/** Trips are 1–6 days (nights 0–5). */
export const DAYS = [1, 2, 3, 4, 5, 6];
export const daysWord = (nights) => { const d = Number(nights) + 1; return d === 1 ? 'A day trip' : `${d} days`; };
/** The parts of "the definition" the organiser can set, and can mark "Set" (vs "Open to ideas"). */
export const DEF_PARTS = ['weekend', 'area', 'nights', 'travel', 'golf'];
export const DAY_PREF = [
  { value: 'early', label: 'Early' },
  { value: 'midday', label: 'Midday' },
  { value: 'late', label: 'Late' },
  { value: 'morning_free', label: 'Morning free' },
];
export const DAY_KEYS = ['thu', 'fri', 'sat', 'sun', 'mon'];
export const DAY_NAME = { thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday', mon: 'Monday' };
const KEY_OF_DOW = { 4: 'thu', 5: 'fri', 6: 'sat', 0: 'sun', 1: 'mon' };
/** Tagging people in comments inside organising — a named extension point only (Josh 19:22: "future"). */
export const IDEA_TAGS_LATER = 'idea_comment_tags';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso) => { const d = dateOf(iso); return d ? `${d.getDate()} ${MON[d.getMonth()]}` : ''; };

/** The Friday of the weekend a date belongs to (Thu → the next day; Sat/Sun/Mon → back to Friday). */
export function fridayOf(iso) {
  const d = dateOf(iso);
  if (!d) return null;
  const dow = d.getDay();
  const back = { 5: 0, 6: 1, 0: 2, 1: 3, 4: -1 }[dow];
  return addDays(iso, -(back ?? (dow - 5)));
}

/** The next `count` Fridays from today (today if it's a Friday): the small calendar of weekends. */
export function upcomingFridays(today, count = 16) {
  const d = dateOf(today);
  if (!d) return [];
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  const out = [];
  for (let i = 0; i < count; i++) { out.push(isoOf(d)); d.setDate(d.getDate() + 7); }
  return out;
}

/** "13 Mar" for a weekend's Friday, "Fri 13 – Sun 15 Mar" with nights. */
export const fridayLabel = (fri, nights = 2) => weekendLabel({ start: fri, end: addDays(fri, Math.max(1, nights)) });

/** The trip's days for "how I'd like the days": the fixed weekend's days, else Fri–Sun (Fri–Mon with 3 nights). */
export function tripDayKeys(fixed = {}) {
  const w = fixed?.weekend;
  if (w?.start) {
    const out = [];
    for (let i = 0, d = w.start; d && d <= (w.end || w.start) && i < 7; i++, d = addDays(d, 1)) {
      const k = KEY_OF_DOW[dateOf(d).getDay()];
      if (k && !out.includes(k)) out.push(k);
    }
    if (out.length) return out;
  }
  const n = fixed?.nights == null ? 2 : Number(fixed.nights);
  return n <= 0 ? ['sat'] : n === 1 ? ['sat', 'sun'] : n === 2 ? ['fri', 'sat', 'sun'] : n === 3 ? ['fri', 'sat', 'sun', 'mon'] : ['thu', 'fri', 'sat', 'sun', 'mon'];
}

/** Is this part of the definition "Set" (people say in / out; other suggestions queue) rather than open to ideas? */
export const isSet = (fixed, key) => Array.isArray(fixed?.set) && fixed.set.includes(key);

/** The definition as lines to show: [{ key, label, set }] — only the parts the organiser has said anything about. */
export function defLines(fixed = {}) {
  const f = fixed || {};
  const out = [];
  const when = f.weekend?.start ? weekendLabel({ start: f.weekend.start, end: f.weekend.end || f.weekend.start }) : f.when;
  if (when) out.push({ key: 'weekend', label: `📅 ${when}`, set: isSet(f, 'weekend') });
  const where = [f.area, f.within_min ? `within ${hours(f.within_min)}${f.from ? ` of ${f.from}` : ''}` : (f.from ? `from ${f.from}` : '')].filter(Boolean).join(', ');
  if (where) out.push({ key: 'area', label: `📍 ${where}`, set: isSet(f, 'area') && !!f.area });
  if (f.nights != null) out.push({ key: 'nights', label: `🛏️ ${daysWord(f.nights)}`, set: isSet(f, 'nights') });
  if (f.travel) out.push({ key: 'travel', label: f.travel === 'fly' ? '✈️ Flying' : f.travel === 'drive' ? '🚗 Driving' : '🚗✈️ Drive or fly', set: isSet(f, 'travel') });
  if (f.golf) out.push({ key: 'golf', label: `⛳ ${label(GOLF, f.golf)}`, set: isSet(f, 'golf') });
  return out;
}

/** What to send to idea_set_fixed from the organiser's form. */
export function defPayload(form = {}) {
  const out = {};
  if (form.weekendStart) {
    const n = form.nights == null || form.nights === '' ? 2 : Number(form.nights);
    out.weekend = { start: form.weekendStart, end: addDays(form.weekendStart, Math.max(0, n)) };
  }
  if (String(form.when || '').trim()) out.when = String(form.when).trim().slice(0, 60);
  if (String(form.area || '').trim()) out.area = String(form.area).trim().slice(0, 80);
  if (String(form.from || '').trim()) out.from = String(form.from).trim().slice(0, 60);
  if (Number(form.within_min) >= 30) out.within_min = Math.min(720, Math.round(Number(form.within_min)));
  if (['drive', 'fly', 'either'].includes(form.travel)) out.travel = form.travel;
  if (form.nights !== '' && form.nights != null && Number(form.nights) >= 0 && Number(form.nights) <= 5) out.nights = Number(form.nights);
  if (GOLF.some((g) => g.value === form.golf)) out.golf = form.golf;
  out.set = DEF_PARTS.filter((k) => form.set?.[k] && (k === 'weekend' ? (out.weekend || out.when) : out[k] != null));
  return out;
}

/** Toggle one Friday in the "can't do" list. */
export function toggleCant(list = [], fri) {
  return list.includes(fri) ? list.filter((x) => x !== fri) : [...list, fri].sort();
}

/** A clean row to save (only what the database takes). */
export function wishRow(planId, playerId, w = {}) {
  const pick = (v, list) => (list.some((o) => o.value === v) ? v : null);
  const prefs = {};
  for (const [k, v] of Object.entries(w.day_prefs || {})) if (DAY_KEYS.includes(k) && ['early', 'midday', 'late', 'morning_free', 'any'].includes(v)) prefs[k] = v;
  const md = Number(w.max_drive_min);
  return {
    plan_id: planId, player_id: playerId,
    cant_dates: [...new Set((w.cant_dates || []).filter((d) => fridayOf(d) === d))].sort(),
    spend_band: pick(w.spend_band, SPEND), travel: pick(w.travel, TRAVEL),
    max_drive_min: Number.isFinite(md) && md >= 30 && md <= 720 ? Math.round(md) : null,
    golf_per_day: pick(w.golf_per_day, GOLF), day_prefs: prefs,
    home_by: /^\d{2}:\d{2}/.test(String(w.home_by || '')) ? String(w.home_by).slice(0, 5) : null,
    wish: String(w.wish || '').trim().slice(0, 300) || null,
  };
}

/** How many of the 4 taps someone's done (dates · spend · getting there · golf); the wish is extra. */
export function tapsDone(w = {}, { weekendFixed = false, rsvp = null } = {}) {
  if (!w && !rsvp) return 0;
  return [weekendFixed ? !!rsvp : (w?.cant_dates || []).length > 0 || !!w?.dates_ok, !!w?.spend_band, !!w?.travel, !!w?.golf_per_day].filter(Boolean).length;
}

const mode = (vals) => {
  const n = new Map();
  for (const v of vals) if (v != null && v !== 'any') n.set(v, (n.get(v) || 0) + 1);
  let best = null; let c = 0;
  for (const [v, k] of n) if (k > c) { best = v; c = k; }
  return best == null ? null : { value: best, n: c };
};
const median = (nums) => {
  const s = nums.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const label = (list, v) => list.find((o) => o.value === v)?.label || '';
/** "2½ h" with no cap (flights). */
export const dur = (min) => `${Math.round((min / 60) * 2) / 2} h`.replace('.5 h', '½ h').replace(/^0½/, '½');
export const hours = (min) => (min >= 240 ? '4+ h' : `${Math.round((min / 60) * 2) / 2} h`.replace('.5 h', '½ h'));

/**
 * The group's answers as one summary: { answered, cant: [{ fri, n }], fly, driveOnly, maxDrive, spend, golf,
 * dayPrefs: { fri: { value, n } }, homeBy, wishes: [text], line }.
 * line: "9 answered · most can't do 12 Mar · 6 happy to fly · most want one round a day, play midday"
 */
export function summariseWishes(wishes = [], { rsvps = [], fixed = {} } = {}) {
  const rows = (wishes || []).filter(Boolean);
  const answered = rows.length;
  const cantN = new Map();
  for (const w of rows) for (const d of w.cant_dates || []) cantN.set(d, (cantN.get(d) || 0) + 1);
  const cant = [...cantN.entries()].map(([fri, n]) => ({ fri, n })).sort((a, b) => b.n - a.n || a.fri.localeCompare(b.fri));
  const fly = rows.filter((w) => w.travel === 'fly' || w.travel === 'either').length;
  const driveOnly = rows.filter((w) => w.travel === 'drive').length;
  const maxDrive = median(rows.map((w) => (w.max_drive_min == null ? NaN : Number(w.max_drive_min))));
  const spend = mode(rows.map((w) => w.spend_band));
  const golf = mode(rows.map((w) => w.golf_per_day));
  const dayPrefs = {};
  for (const k of DAY_KEYS) { const m = mode(rows.map((w) => w.day_prefs?.[k])); if (m) dayPrefs[k] = m; }
  const homeBy = rows.map((w) => w.home_by).filter(Boolean).map((t) => String(t).slice(0, 5)).sort()[0] || null;
  const wishList = rows.map((w) => w.wish).filter(Boolean);
  const parts = [];
  const weekendFixed = isSet(fixed, 'weekend') && !!fixed?.weekend?.start;
  if (weekendFixed) {
    const ins = (rsvps || []).filter((r) => r.status === 'in').length;
    const cants = (rsvps || []).filter((r) => r.status === 'out').length;
    if (ins || cants) parts.push(`${ins} can make ${short(fixed.weekend.start)}${cants ? `, ${cants} can’t` : ''}`);
  }
  parts.unshift(`${answered} answered`);
  if (!weekendFixed && cant[0] && cant[0].n >= Math.max(2, Math.ceil(answered / 2))) parts.push(`most can’t do ${short(cant[0].fri)}`);
  else if (!weekendFixed && cant[0]) parts.push(`${cant[0].n} can’t do ${short(cant[0].fri)}`);
  if (fly) parts.push(`${fly} happy to fly`);
  if (spend && spend.n * 2 >= answered) parts.push(`most ${spend.value === 'lt500' ? 'want under $500' : `say ${label(SPEND, spend.value)}`}`);
  const golfWords = golf && golf.n * 2 >= answered ? `most want ${label(GOLF, golf.value).toLowerCase()}` : '';
  const dayWords = Object.entries(dayPrefs).filter(([, m]) => m.n * 2 >= answered).map(([k, m]) => `${label(DAY_PREF, m.value).toLowerCase()} ${DAY_NAME[k].slice(0, 3)}`);
  if (golfWords || dayWords.length) parts.push([golfWords, dayWords.length ? `play ${dayWords.join(', ')}` : ''].filter(Boolean).join(', '));
  return { answered, cant, fly, driveOnly, maxDrive, spend, golf, dayPrefs, homeBy, wishes: wishList, line: answered ? parts.join(' · ') : 'Nobody’s answered yet' };
}

// ------------------------------------------------------------------ fit lines

/** A weekend: how many who answered can do it. → { can, of } */
export function dateFit(item, wishes = []) {
  const fri = fridayOf(item?.start_date);
  const rows = (wishes || []).filter(Boolean);
  const out = rows.filter((w) => (w.cant_dates || []).includes(fri)).length;
  return { can: rows.length - out, of: rows.length };
}

/** An area or idea: { driveMin } (by road) or { fly: true }. → { fits, of } — within their max drive / happy to fly. */
export function travelFit({ driveMin = null, fly = false } = {}, wishes = []) {
  const rows = (wishes || []).filter(Boolean);
  const ok = (w) => (fly ? w.travel !== 'drive' : (w.max_drive_min == null || driveMin == null || Number(w.max_drive_min) >= 240 || driveMin <= Number(w.max_drive_min)));
  return { fits: rows.filter(ok).length, of: rows.length };
}

/** A cost each: how many it's within budget for. → { fits, of } */
export function spendFit(costEach, wishes = []) {
  const rows = (wishes || []).filter(Boolean);
  if (!(costEach > 0)) return { fits: rows.length, of: rows.length };
  const max = (w) => SPEND.find((o) => o.value === w.spend_band)?.max ?? Infinity;
  return { fits: rows.filter((w) => costEach <= max(w)).length, of: rows.length };
}

/** "suits 9 of 11 · within 3 h · about $750 each" (only the parts known). Counts only — names are the organiser's. */
export function fitLine({ fit = null, driveMin = null, fly = null, costEach = null } = {}) {
  const parts = [];
  if (fit && fit.of) parts.push(`suits ${fit.can ?? fit.fits} of ${fit.of}`);
  if (fly) parts.push(fly.flightMin ? `${dur(fly.flightMin)} flight` : 'a flight');
  else if (driveMin != null) parts.push(`within ${hours(Math.ceil(driveMin / 30) * 30)}`);
  // Josh 19:34: no fare guesses — a cost line only for driving ideas (stay and golf).
  if (costEach > 0 && !fly) parts.push(`about $${Math.round(costEach / 10) * 10} each`);
  return parts.join(' · ');
}

/** Where people come from: the trip's starting points, else players' home areas, else null. → { lat, lng } */
export function homeBase(starts = [], homes = []) {
  const pts = (starts?.length ? starts : homes || []).filter((p) => p && p.lat != null && p.lng != null);
  if (!pts.length) return null;
  const w = (p) => Math.max(1, Number(p.headcount || p.count || 1));
  const tot = pts.reduce((s, p) => s + w(p), 0);
  return { lat: pts.reduce((s, p) => s + p.lat * w(p), 0) / tot, lng: pts.reduce((s, p) => s + p.lng * w(p), 0) / tot };
}

/** The drive to an area named in a list (matched to the app's stay areas), from the home base. Null if unknown. */
export function areaDrive(name, stayAreas = [], base = null) {
  if (!base || !name) return null;
  const r = matchRegions(name, stayAreas)[0] || regionsFrom(stayAreas).find((x) => x.towns.some((t) => t.toLowerCase() === String(name).toLowerCase()));
  return r ? driveBetween(base, r) : null;
}

/** The fit line for one list item. */
export function itemFit(item, { wishes = [], stayAreas = [], base = null } = {}) {
  if (item.fit) return item.fit; // the Caddie's own
  if (!(wishes || []).length) return '';
  if (item.kind === 'date') return fitLine({ fit: dateFit(item, wishes) });
  if (item.kind === 'area') {
    const fly = item.detail?.fly ? { flightMin: item.detail.fly.flight_min } : null;
    const driveMin = fly ? null : areaDrive(item.label, stayAreas, base);
    const tf = travelFit({ driveMin, fly: !!fly }, wishes);
    return fly || driveMin != null ? fitLine({ fit: tf, driveMin, fly, costEach: item.detail?.cost_each || null }) : '';
  }
  return '';
}

/** For the organiser only (Josh 19:34): who a weekend doesn't suit, by name. rows: plan_wishes with player_id. */
export function whoCant(item, rows = [], nameOf = (id) => id) {
  const fri = fridayOf(item?.start_date);
  return (rows || []).filter((w) => w.player_id && (w.cant_dates || []).includes(fri)).map((w) => nameOf(w.player_id)).filter(Boolean);
}

/** A flight's line: "about 3 h · first flights about 6am, last back about 9pm". */
export function flightLine(fly = {}) {
  if (!fly) return '';
  const t = fly.flight_min ? `about ${dur(fly.flight_min)} flight` : '';
  const times = [fly.first_out ? `first flights about ${fly.first_out}` : '', fly.last_back ? `last back about ${fly.last_back}` : ''].filter(Boolean).join(', ');
  return [fly.from && fly.to ? `${fly.from}–${fly.to}` : '', t, times].filter(Boolean).join(' · ');
}

/** A pre-filled flight search (Google Flights) — the app never books or prices flights. */
export function flightSearchLink({ from = 'SYD', to = '', depart = null, back = null } = {}) {
  const dest = String(to || '').trim();
  if (!dest) return null;
  const q = [`Flights from ${from || 'SYD'} to ${dest}`, depart ? `on ${depart}` : '', back ? `returning ${back}` : ''].filter(Boolean).join(' ');
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

// ------------------------------------------------------------------ the lists

/** 👍 / 👎 counts per item and mine. → { [itemId]: { up, down, mine } } */
export function tally(reactions = [], me = null) {
  const out = {};
  for (const r of reactions || []) {
    const t = (out[r.item_id] ||= { up: 0, down: 0, mine: 0 });
    if (r.value > 0) t.up++; else t.down++;
    if (r.player_id === me) t.mine = r.value;
  }
  return out;
}

/** Tap 👍 when you'd already 👍 → clear it (0); otherwise the new value. */
export const nextReaction = (mine, tapped) => (mine === tapped ? 0 : tapped);

/**
 * The lists, phone first: { date, area, course } each sorted (weekends by date; the rest by 👍 − 👎, then oldest),
 * plus queued (waiting for the organiser) and declined (with the organiser's note). Items carry `t` (their tally).
 */
export function lists(items = [], reactions = [], me = null) {
  const t = tally(reactions, me);
  const withT = (items || []).map((i) => ({ ...i, t: t[i.id] || { up: 0, down: 0, mine: 0 } }));
  const score = (i) => i.t.up - i.t.down;
  const on = withT.filter((i) => (i.status || 'in') === 'in');
  const byScore = (a, b) => score(b) - score(a) || String(a.created_at).localeCompare(String(b.created_at));
  return {
    date: on.filter((i) => i.kind === 'date').sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))),
    area: on.filter((i) => i.kind === 'area').sort(byScore),
    course: on.filter((i) => i.kind === 'course').sort(byScore),
    queued: withT.filter((i) => i.status === 'queued'),
    declined: withT.filter((i) => i.status === 'declined'),
  };
}

/** Would this go to the organiser's queue (outside the definition)? The database decides; this says so first. */
export function outsideDefinition(item, fixed = {}) {
  if (item.kind === 'date') return isSet(fixed, 'weekend');
  const a = String(fixed?.area || '').trim().toLowerCase();
  if (!a || !isSet(fixed, 'area')) return false;
  if (item.kind === 'area') return String(item.label || '').trim().toLowerCase() !== a;
  if (item.kind === 'course') return !!item.area && String(item.area).trim().toLowerCase() !== a;
  return false;
}

/** A new list item from what someone typed. → row (without plan_id) or { error } */
export function newItem(kind, { label = '', start = null, nights = 2, area = null, note = null, libraryCourseId = null } = {}) {
  if (kind === 'date') {
    const fri = fridayOf(start);
    if (!fri) return { error: 'Pick a weekend' };
    const n = Math.max(1, Math.min(4, Number(nights) || 2));
    const s = n === 1 ? addDays(fri, 1) : fri;
    const e = addDays(fri, n === 1 ? 2 : n);
    return { kind, label: weekendLabel({ start: s, end: e }), start_date: s, end_date: e, note: note || null };
  }
  const l = String(label || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (l.length < 2) return { error: kind === 'area' ? 'Type an area or town' : 'Type a course' };
  return { kind, label: l, ...(kind === 'course' && area ? { area: String(area).slice(0, 80) } : {}), ...(libraryCourseId ? { library_course_id: libraryCourseId } : {}), note: note || null };
}

/** A Caddie idea card → list items (an area, its courses, a weekend), marked ✨. */
export function itemsFromIdea(card = {}) {
  const out = [];
  const fly = card.fly && typeof card.fly === 'object' ? card.fly : null;
  const detail = {
    ...(fly ? { fly: { from: fly.from || null, to: fly.to || null, flight_min: Number(fly.flight_min) || null, first_out: fly.first_out || null, last_back: fly.last_back || null } } : {}),
    ...(card.cost_each ? { cost_each: Number(card.cost_each) } : {}),
    ...(card.why ? { why: String(card.why).slice(0, 160) } : {}),
  };
  if (card.area) out.push({ kind: 'area', label: String(card.area).slice(0, 80), by_ai: true, fit: card.fit ? String(card.fit).slice(0, 120) : null, note: card.why ? String(card.why).slice(0, 200) : null, detail });
  for (const c of (card.courses || []).slice(0, 4)) {
    const name = typeof c === 'string' ? c : c?.name;
    if (name) out.push({ kind: 'course', label: String(name).slice(0, 80), area: card.area ? String(card.area).slice(0, 80) : null, by_ai: true, ...(c?.library_id ? { library_course_id: c.library_id } : {}) });
  }
  if (card.weekend) { const d = newItem('date', { start: card.weekend, nights: card.nights || 2 }); if (!d.error) out.push({ ...d, by_ai: true, fit: card.fit && !card.area ? card.fit : null }); }
  return out;
}

// ------------------------------------------------------------------ tidy → vote, and the leftovers

/**
 * The trip builder's state from what's ticked (v10.6's When? / Where? votes read it): the ticked weekends (the
 * shortlist), the ticked areas (matched to the app's regions where they can be), each area's ticked courses that are
 * in the course library, the length, and a fit line per option for the vote card (fitNotes).
 */
export function builderFromPicks(state = {}, items = [], { stayAreas = [], fits = {}, fixed = {} } = {}) {
  const picked = (items || []).filter((i) => i.picked && (i.status || 'in') === 'in');
  const dates = picked.filter((i) => i.kind === 'date').sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  const regionName = (label) => matchRegions(label, stayAreas)[0]?.region || label;
  const areas = [...new Set(picked.filter((i) => i.kind === 'area').map((i) => regionName(i.label)))];
  if (fixed?.area && !areas.length) areas.push(regionName(fixed.area));
  const weekends = dates.map((d) => ({ start: d.start_date, end: d.end_date, long: false }));
  if (fixed?.weekend?.start && !weekends.length) weekends.push({ start: fixed.weekend.start, end: fixed.weekend.end || fixed.weekend.start, long: false });
  const areaCourses = { ...(state.areaCourses || {}) };
  for (const c of picked.filter((i) => i.kind === 'course' && i.library_course_id)) {
    const r = c.area ? regionName(c.area) : areas[0];
    const key = areas.includes(r) ? r : areas[0];
    if (!key) continue;
    areaCourses[key] = [...new Set([...(areaCourses[key] || []), c.library_course_id])];
  }
  const nights = fixed?.nights != null ? Number(fixed.nights) : (dates[0] ? Math.max(1, Math.round((dateOf(dates[0].end_date) - dateOf(dates[0].start_date)) / 86400000)) : state.nights || 2);
  const fitNotes = {};
  for (const d of dates) if (fits[d.id]) fitNotes[`weekend:${d.start_date}`] = fits[d.id];
  for (const a of picked.filter((i) => i.kind === 'area')) if (fits[a.id]) fitNotes[`area:${regionName(a.label)}`] = fits[a.id];
  return {
    ...state,
    weekends, weekendsSettled: weekends.length === 1, weekendPool: weekends,
    regionOptions: areas.length === 1 ? [] : areas, region: areas.length === 1 ? areas[0] : null,
    areaCourses, nights, fitNotes, fromIdea: true,
  };
}

/** Which vote to call once the builder has the picks: 'both', 'when', 'where' or null (nothing to vote on). */
export function voteToCall(st = {}) {
  const when = (st.weekends || []).length >= 2 && !st.weekendsSettled;
  const where = !st.region && (st.regionOptions || []).length >= 2;
  return when && where ? 'both' : when ? 'when' : where ? 'where' : null;
}

/** The ones not ticked (on the list, not queued or declined): what "Start another trip idea from these" copies. */
export function leftovers(items = []) {
  return (items || []).filter((i) => !i.picked && (i.status || 'in') === 'in');
}

// ------------------------------------------------------------------ sharing

/** "March · somewhere we fly to · flying" — the idea's rough shape so far. */
export function ideaShape(plan = {}) {
  const f = plan.idea_fixed || {};
  const when = f.weekend?.start ? weekendLabel({ start: f.weekend.start, end: f.weekend.end }) : (f.when || plan.idea_when);
  const where = f.area || (f.within_min ? `within ${hours(f.within_min)}${f.from ? ` of ${f.from}` : ''}` : '') || plan.idea_where;
  const tr = f.travel || plan.idea_travel;
  const how = tr === 'fly' ? 'flying' : tr === 'drive' ? 'driving' : tr === 'either' ? 'drive or fly' : '';
  return [when, where, how && !(where && /fly/i.test(where) && how === 'flying') ? how : ''].filter(Boolean).join(' · ');
}

/** The Feed post and buzz line: "💡 Chris has a trip idea: March, somewhere we fly to. Add your ideas". */
export function feedLine(plan = {}, by = 'Someone') {
  const f = plan.idea_fixed || {};
  const shape = [f.weekend?.start ? weekendLabel({ start: f.weekend.start, end: f.weekend.end }) : (f.when || plan.idea_when), f.area || plan.idea_where].filter(Boolean).join(', ');
  return `💡 ${by} has a trip idea: ${shape || plan.name}. Add your ideas — 4 quick taps.`;
}

/** The message for the group chat, with the link. */
export function shareMessage(plan = {}, by = 'Someone', link = '') {
  const shape = ideaShape(plan);
  return `💡 ${plan.name}${shape ? ` (${shape})` : ''} — ${by}'s trip idea. Help plan it: 4 quick taps — your dates, budget, how you'd get there and what golf you're after. ${link}`.trim();
}

/** What goes on the share card (shareCard.js 'idea'). */
export function ideaCard(plan = {}, by = '') {
  return {
    eyebrow: '💡 TRIP IDEA', title: String(plan.name || 'Trip idea').slice(0, 40),
    line: ideaShape(plan).slice(0, 60) || 'When and where: up to you lot',
    sub: by ? `from ${String(by).slice(0, 30)}` : '',
    cta: 'Add your dates, areas and courses',
  };
}

/** The share link: on Cloudflare (base '/') the /i/<token> page with a proper preview, carrying the in-app link after
 *  the # (the page sends people on); elsewhere (GitHub Pages) the plain in-app link. */
export function ideaLink({ origin = '', base = '/', token = null, appLink = '' } = {}) {
  if (!token || base !== '/') return appLink;
  const hash = appLink.includes('#') ? appLink.slice(appLink.indexOf('#')) : '';
  return `${origin}/i/${encodeURIComponent(token)}${hash}`;
}

/** The context the fast Caddie gets up front (sent with each idea chat question; the server cleans it again). */
export function caddieContext({ plan = {}, lists: l = null, summary = null, base = null, baseName = null } = {}) {
  const names = (xs) => (xs || []).slice(0, 12).map((i) => i.label);
  return {
    idea: { name: plan.name || '', when: plan.idea_when || null, where: plan.idea_where || null, travel: plan.idea_travel || null, fixed: plan.idea_fixed || {} },
    lists: l ? { dates: names(l.date), areas: names(l.area), courses: names(l.course) } : null,
    wishes: summary ? {
      answered: summary.answered, line: summary.line, happy_to_fly: summary.fly, drive_only: summary.driveOnly,
      max_drive_min: summary.maxDrive, spend: summary.spend?.value || null, golf: summary.golf?.value || null,
      cant: (summary.cant || []).slice(0, 6), day_prefs: Object.fromEntries(Object.entries(summary.dayPrefs || {}).map(([k, m]) => [k, m.value])),
      home_by: summary.homeBy, wishes: (summary.wishes || []).slice(0, 8),
    } : null,
    home: base ? { lat: Math.round(base.lat * 100) / 100, lng: Math.round(base.lng * 100) / 100, name: baseName || null } : null,
  };
}

/** The message "✨ Pull it together" sends to the planning chat (the strong model), from the lists and the answers. */
export function pullTogetherText({ plan = {}, lists: l = { date: [], area: [], course: [] }, summary = null } = {}) {
  const top = (xs, n = 6) => xs.slice(0, n).map((i) => `${i.label}${i.t?.up || i.t?.down ? ` (👍${i.t.up} 👎${i.t.down})` : ''}`).join('; ');
  const f = plan.idea_fixed || {};
  return [
    `Pull together a draft for our trip idea "${plan.name}" from what the group's added.`,
    f.weekend?.start ? `The weekend${isSet(f, 'weekend') ? ' is set' : ' we’re thinking of'}: ${weekendLabel({ start: f.weekend.start, end: f.weekend.end })}.` : f.when ? `When: ${f.when}.` : (l.date.length ? `Weekends: ${top(l.date)}.` : plan.idea_when ? `Roughly: ${plan.idea_when}.` : ''),
    f.area ? `The area${isSet(f, 'area') ? ' is set' : ' we’re thinking of'}: ${f.area}.` : f.within_min ? `Within ${hours(f.within_min)}${f.from ? ` of ${f.from}` : ''}.` : (l.area.length ? `Areas: ${top(l.area)}.` : plan.idea_where ? `Where: ${plan.idea_where}.` : ''),
    l.course.length ? `Courses: ${top(l.course, 8)}.` : '',
    f.nights != null ? `${daysWord(f.nights)}${f.nights ? ` (${f.nights} night${f.nights === 1 ? '' : 's'})` : ''}.` : '',
    f.golf ? `Golf: ${label(GOLF, f.golf).toLowerCase()}.` : '',
    (f.travel || plan.idea_travel) === 'fly' ? 'We’d fly to one place.' : '',
    summary?.answered ? `The group's answers: ${summary.line}.` : '',
    'Plan it now.',
  ].filter(Boolean).join(' ').slice(0, 590);
}

// ------------------------------------------------------------------ parked ideas (Josh 19:41)

/**
 * Without the Caddie: group the leftovers into up to 3 future-trip ideas — each area with its courses (and the
 * weekends if there's only one area), then any other weekends together. → [{ name, why, items: [id] }]
 */
export function parkGroups(items = []) {
  const left = (items || []).filter((i) => !i.picked && ['in', 'declined'].includes(i.status || 'in') && !i.leftover);
  const areas = left.filter((i) => i.kind === 'area');
  const courses = left.filter((i) => i.kind === 'course');
  const dates = left.filter((i) => i.kind === 'date');
  const out = [];
  for (const a of areas.slice(0, 3)) {
    const mine = courses.filter((c) => c.area && c.area.toLowerCase() === a.label.toLowerCase());
    out.push({ name: `${a.label}${mine[0] ? ` — ${mine[0].label}` : ''}`, why: null, items: [a.id, ...mine.map((c) => c.id)] });
  }
  const used = new Set(out.flatMap((g) => g.items));
  const loose = courses.filter((c) => !used.has(c.id));
  if (out.length === 1) out[0].items.push(...dates.map((d) => d.id), ...loose.map((c) => c.id));
  else if (out.length < 3 && (dates.length || loose.length)) {
    out.push({ name: dates.length ? (dates.length === 1 ? dates[0].label : 'Other weekends') : 'Other courses', why: null, items: [...dates.map((d) => d.id), ...loose.map((c) => c.id)] });
  }
  return out.filter((g) => g.items.length);
}

/** A parked idea's claim state for me. → { state: 'mine' | 'theirs' | 'open', until, owner } */
export function claimState(plan = {}, me = null, now = new Date()) {
  const until = plan.claim_until ? new Date(plan.claim_until) : null;
  if (!plan.claim_owner || !until || until <= now) return { state: 'open', until, owner: plan.claim_owner || null };
  return { state: plan.claim_owner === me ? 'mine' : 'theirs', until, owner: plan.claim_owner };
}

// ------------------------------------------------------------------ v10.7 (the March test)

const MONTH_WORDS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** The month an idea is roughly in (0–11), from what's set, its rough when, or its name ("March away"). Null if none. */
export function ideaMonth(plan = {}) {
  const f = plan.idea_fixed || {};
  if (f.weekend?.start) return TBmonth(f.weekend.start);
  for (const t of [f.when, plan.idea_when, plan.name]) {
    const m = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.exec(String(t || ''));
    if (m) return MONTH_WORDS.indexOf(m[1].slice(0, 3).toLowerCase());
  }
  return null;
}
const TBmonth = (iso) => (dateOf(iso) ? dateOf(iso).getMonth() : null);

/**
 * The weekends to offer for "Weekends you can't do": from the idea's month (the next one coming; a weekend that
 * starts a few days before the 1st counts), ~8 of them; nothing known → the next 3 months (13). Never before next week.
 * → { fridays, more: (n) => the next n Fridays after these }
 */
export function weekendsToOffer(plan = {}, today = isoOf(new Date())) {
  const soonest = addDays(today, 7);
  const m = ideaMonth(plan);
  let start = soonest;
  if (m != null) {
    const t = dateOf(today);
    let y = t.getFullYear();
    if (m < t.getMonth()) y += 1;
    const first = isoOf(new Date(y, m, 1));
    start = addDays(first, -3) > soonest ? addDays(first, -3) : soonest;
  }
  const n = m != null ? 8 : 13;
  return upcomingFridays(start, n);
}

/** A weekend row's words from the answers: who can't (names for the organiser, a count for others). '' if nobody's answered. */
export function dateWords(item, { answers = [], rows = [], nameOf = null } = {}) {
  if (!(answers || []).length) return '';
  const f = dateFit(item, answers);
  const out = f.of - f.can;
  if (!out) return f.of === 1 ? 'The one who’s answered can do it' : `All ${f.of} who’ve answered can do it`;
  if (nameOf) {
    const names = whoCant(item, rows, nameOf);
    if (names.length) return `${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`} can’t do this one`;
  }
  return `${out} can’t do it`;
}
