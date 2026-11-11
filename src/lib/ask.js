// "Anyone keen for a round?" v2 — ask the group when they can play (ov43, Josh 11–12 Nov 2026,
// claude/round-callout-v2-design.md). Pure functions, no database and no React, tested in ask.test.js (including a
// simulated group of ten). Migration 111 stores what these work out; the screens (components/AskSheet.jsx,
// components/AskReply.jsx, components/AskDecide.jsx) use them.
//
// ONE RULE UNDERNEATH: everything is a date + a time window (from–to, 'HH:MM'). "Arvo" is 12–4; "1:20pm" is a window
// of one tee time. The organiser offers windows (cells), players answer with windows (slots), and the app matches on
// overlap. Parts of the day and exact times are two views of the same answer.
//
// Plain words used here (and in the UI):
//   * a cell   — one date × one part of the day (or one exact time) the organiser offered: { key, date, part, from, to }
//   * a slot   — a window a player says they can play: { date, from, to, part?, note? }
//   * an answer — one player's reply: { player_id, slots, cant, first_at } (first_at: when they first answered —
//     reply order decides spots, as in 103)
//   * the leader — the cell with the most players who can, then the earliest.
import { addDays, dowOf, dayLabel, DAY_KEYS, clock, cleanTime } from './callout.js';
import { sunTimes, ROUND_LENGTH } from './daytiming.js';

const pad = (n) => String(n).padStart(2, '0');
export const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const toHm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const r5 = (m) => Math.round(m / 5) * 5;

// Sydney, for sunset (a call-out is a Sydney thing for now; a course's own lat/lng is used in the course check).
export const SYDNEY = { lat: -33.87, lng: 151.21 };
export const ROUND_MIN = ROUND_LENGTH.stableford; // 4½ hours for 18
export const NINE_MIN = ROUND_LENGTH.nine;

// ------------------------------------------------------------------ parts of the day (four columns — Josh's open call,
// settled 12 Nov: Early is the "done by 11" answer the constrained players need)
export const ASK_PARTS = {
  early: { label: 'Early', from: '06:00', to: '07:59' },
  morning: { label: 'Morning', from: '08:00', to: '11:29' },
  arvo: { label: 'Arvo', from: '11:30', to: '15:00' },
  twilight: { label: 'Twilight', from: null, to: null }, // from that day's sunset
};
export const ASK_PART_KEYS = Object.keys(ASK_PARTS);
export const ASK_DAYS = ['thu', 'fri', 'sat', 'sun'];
const WEEKDAY_WORD = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
export const dayWord = (k) => WEEKDAY_WORD[k] || k;

/** Sunset on a date, in minutes (Sydney unless a place is given). */
export function sunsetMin(date, place = SYDNEY) {
  return sunTimes(date, place.lat, place.lng)?.sunset ?? 19 * 60 + 30;
}

/** A part's window on a date. Twilight: from about 3 h 15 before sunset to 1 h 45 before (enough light for 9+). */
export function partWindow(date, part) {
  if (part === 'twilight') {
    const ss = sunsetMin(date);
    return { from: toHm(r5(ss - 195)), to: toHm(r5(ss - 105)) };
  }
  const p = ASK_PARTS[part];
  return p ? { from: p.from, to: p.to } : null;
}

/** The likely finish for a heading: "done 11" (18 holes from the window's start), or "till dark" for twilight. */
export function finishWords(date, part) {
  if (part === 'twilight') return `till dark ${clock(toHm(sunsetMin(date)))}`;
  const w = partWindow(date, part);
  return w ? `done ${clock(toHm(r5(toMin(w.from) + ROUND_MIN)))}` : '';
}

/** "Sat 21 arvo", "Sat 21 · 1:20pm" */
export function cellWords(cell) {
  if (!cell) return '';
  const d = dayLabel(cell.date).split(' ').slice(0, 2).join(' ');
  return cell.part ? `${d} ${ASK_PARTS[cell.part].label.toLowerCase()}` : `${d} · ${clock(cell.from)}`;
}

// ------------------------------------------------------------------ the ask (what the organiser puts out)
/**
 * ask: {
 *   days:  ['thu','fri','sat','sun'] (any of the 7 keys; [] or 'any' = every day),
 *   parts: ['early','morning','arvo','twilight'] ([] or 'any' = all four),
 *   range: { kind: 'next', days: 14 } | { kind: 'dates', dates: ['2026-11-21', …] } | { kind: 'open' }  ("until we play"),
 *   times: [{ date, at: '13:20' }]  — exact times added on top (optional),
 * }
 */
export const OPEN_WEEKS = 8;          // "until we play" looks this far ahead
export const LONG_DAYS = 14;          // over 2 weeks → one row per weekday on the reply screen
export const RANGE_CHOICES = [
  { key: 'next7', label: 'This week', range: { kind: 'next', days: 7 } },
  { key: 'next14', label: 'Next 2 weeks', range: { kind: 'next', days: 14 } },
  { key: 'next28', label: 'Next 4 weeks', range: { kind: 'next', days: 28 } },
  { key: 'open', label: 'Until we play', range: { kind: 'open' } },
];

const allDays = (days) => !days || days === 'any' || !days.length;
const allParts = (parts) => !parts || parts === 'any' || !parts.length;
export const askPartKeys = (ask) => (allParts(ask?.parts) ? ASK_PART_KEYS : ASK_PART_KEYS.filter((p) => ask.parts.includes(p)));

/** The dates an ask covers (from tomorrow), filtered to its days. */
export function askDates(ask, today) {
  const r = ask?.range || { kind: 'next', days: 14 };
  let list;
  if (r.kind === 'dates') list = [...new Set(r.dates || [])].filter((d) => d > today).sort();
  else {
    const n = r.kind === 'open' ? OPEN_WEEKS * 7 : Math.max(1, Math.min(90, Number(r.days) || 14));
    list = Array.from({ length: n }, (_, i) => addDays(today, i + 1));
  }
  if (r.kind === 'dates' || allDays(ask?.days)) return list;
  const want = new Set(ask.days.map((d) => DAY_KEYS.indexOf(d)));
  return list.filter((d) => want.has(dowOf(d)));
}

/** Is it a long ask (one row per weekday on the reply screen)? */
export function isLong(ask, today) {
  const r = ask?.range || {};
  if (r.kind === 'open') return true;
  if (r.kind === 'next') return Number(r.days) > LONG_DAYS;
  const ds = askDates(ask, today);
  return ds.length > 1 && (new Date(ds[ds.length - 1]) - new Date(ds[0])) / 86400000 > LONG_DAYS;
}

const cellKey = (date, part, at = null) => (part ? `${date}|${part}` : `${date}|@${at}`);

/** Every cell the ask offers: each date × each part, plus the exact times. */
export function askCells(ask, today) {
  const parts = askPartKeys(ask);
  const out = [];
  for (const date of askDates(ask, today)) {
    for (const part of parts) out.push({ key: cellKey(date, part), date, part, ...partWindow(date, part) });
  }
  for (const t of ask?.times || []) {
    const at = cleanTime(t.at);
    if (!t.date || t.date <= today || !at) continue;
    out.push({ key: cellKey(t.date, null, at), date: t.date, part: null, from: at, to: at });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.from.localeCompare(b.from));
}

/** One line for the ask: "Thu–Sun · any time · next 2 weeks" */
export function askWords(ask) {
  const days = allDays(ask?.days) ? 'Any day' : ask.days.map(dayWord).join(', ');
  const parts = allParts(ask?.parts) ? 'any time' : ask.parts.map((p) => ASK_PARTS[p].label.toLowerCase()).join(', ');
  const r = ask?.range || {};
  const range = r.kind === 'open' ? 'until we play' : r.kind === 'dates' ? `${(r.dates || []).length} dates` : RANGE_CHOICES.find((c) => c.range.days === r.days)?.label.toLowerCase() || `next ${r.days} days`;
  const extra = (ask?.times || []).length ? ` · +${ask.times.length} exact time${ask.times.length === 1 ? '' : 's'}` : '';
  return `${days} · ${parts} · ${range}${extra}`;
}

/** A clean ask to save (only known keys; at most 12 exact times, 40 dates). */
export function cleanAsk(ask = {}) {
  const days = allDays(ask.days) ? [] : [...new Set(ask.days)].filter((d) => DAY_KEYS.includes(d));
  const parts = allParts(ask.parts) ? [] : [...new Set(ask.parts)].filter((p) => ASK_PART_KEYS.includes(p));
  const r = ask.range || {};
  const range = r.kind === 'open' ? { kind: 'open' }
    : r.kind === 'dates' ? { kind: 'dates', dates: [...new Set(r.dates || [])].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(0, 40) }
      : { kind: 'next', days: Math.max(1, Math.min(90, Number(r.days) || 14)) };
  const times = (ask.times || []).map((t) => ({ date: t.date, at: cleanTime(t.at) })).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') && t.at).slice(0, 12);
  return { days, parts, range, times };
}

/** When replies close by default: 2 days (3 for "until we play"), but by 6pm the day before the first date — and never
 *  sooner than 12 hours from now, so people get a fair go at answering. Rounded down to the quarter hour. */
export function askCloses(ask, today, now = new Date()) {
  const first = askDates(ask, today)[0];
  let t = now.getTime() + (ask?.range?.kind === 'open' ? 3 : 2) * 86400000;
  if (first) t = Math.min(t, new Date(`${addDays(first, -1)}T18:00:00+11:00`).getTime());
  t = Math.max(t, now.getTime() + 12 * 3600000);
  return new Date(Math.floor(t / 900000) * 900000);
}

// ------------------------------------------------------------------ notes on a square ("hold a square for a note")
/**
 * A note → { after, finishBy, nine, text }. Reads "only after 9", "after 10:30", "must finish by 12", "home by 1",
 * "done by 2", "9 holes only", "nine". Anything else is kept as text (and shown to the organiser).
 */
export function parseNote(text) {
  const s = String(text || '').toLowerCase();
  const time = (x) => {
    if (!x) return null;
    const t = cleanTime(x.replace(/\s+/g, ''));
    return t;
  };
  const after = /(?:only\s+)?(?:after|from)\s+(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/.exec(s);
  const by = /(?:finish(?:ed)?|home|done|back|out|away)\s+(?:by|before)\s+(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/.exec(s) || /\bby\s+(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/.exec(s);
  // "by 12" / "home by 1" are almost always midday/after: bare 7–12 as said (cleanTime treats 1–6 as pm).
  return {
    after: after ? time(after[1]) : null,
    finishBy: by ? time(by[1]) : null,
    nine: /\b(9|nine)[\s-]*holes?\b|\bnine\b|\bjust 9\b|\b9 only\b/.test(s),
    text: String(text || '').trim().slice(0, 120),
  };
}

/** The note chips (one tap fills the note). */
export const NOTE_CHIPS = [
  { key: 'after', label: 'Only after…', fill: 'only after 9' },
  { key: 'by', label: 'Must finish by…', fill: 'must finish by 12' },
  { key: 'nine', label: '9 holes only', fill: '9 holes only' },
];

/** A window narrowed by a note: start no earlier than "after", tee off early enough to finish by "finishBy". → { from, to } | null */
export function narrow(from, to, note) {
  if (!note) return { from, to };
  const n = typeof note === 'string' ? parseNote(note) : note;
  let a = toMin(from); let b = toMin(to);
  if (n.after) a = Math.max(a, toMin(n.after));
  if (n.finishBy) b = Math.min(b, toMin(n.finishBy) - (n.nine ? NINE_MIN : ROUND_MIN));
  if (a > b) return null;
  return { from: toHm(a), to: toHm(b) };
}

// ------------------------------------------------------------------ the reply (what a player sends)
/**
 * The ticks → the slots to save. picks: Set of cell keys ("2026-11-21|arvo"); notes: { [cellKey]: noteText }.
 * Long asks tick weekday rows instead ("sat|arvo") and mark whole dates can't (cantDates). → [{ date, from, to, part, note? }]
 */
export function answerSlots(cells, picks, { notes = {}, weekly = false, cantDates = [] } = {}) {
  const cant = new Set(cantDates);
  const out = [];
  for (const c of cells) {
    if (cant.has(c.date)) continue;
    const k = weekly ? rowKey(c) : c.key;
    if (!picks.has(k)) continue;
    const note = notes[k] || null;
    const w = narrow(c.from, c.to, note);
    if (!w) continue; // the note rules this square out ("must finish by 9" on an arvo)
    const n = note ? parseNote(note) : null;
    out.push({ date: c.date, from: w.from, to: w.to, part: c.part, ...(n ? { note: n.text, nine: n.nine || undefined } : {}) });
  }
  return out.slice(0, 400);
}

/** The weekday row a cell sits on (long asks): "sat|arvo", or "sat|@13:20" for an exact time. */
export const rowKey = (c) => (c.part ? `${DAY_KEYS[dowOf(c.date)]}|${c.part}` : `${DAY_KEYS[dowOf(c.date)]}|@${c.from}`);

/** One-tap answers → the picks. */
export const QUICK = [
  { key: 'any', label: 'Any time' },
  { key: 'weekends', label: 'Weekends only' },
  { key: 'afterwork', label: 'After work only' },
];
export function quickPicks(key, cells, { weekly = false } = {}) {
  const k = (c) => (weekly ? rowKey(c) : c.key);
  const dow = (c) => dowOf(c.date);
  const pick = {
    any: () => true,
    weekends: (c) => dow(c) === 0 || dow(c) === 6,
    afterwork: (c) => dow(c) >= 1 && dow(c) <= 5 && (c.part === 'twilight' || (!c.part && toMin(c.from) >= 16 * 60)),
  }[key] || (() => false);
  return new Set(cells.filter(pick).map(k));
}

const TYPE_DAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const TYPE_PARTS = {
  early: 'early', dawn: 'early', crack: 'early', first: 'early',
  morning: 'morning', mornings: 'morning', morn: 'morning', am: 'morning',
  arvo: 'arvo', arvos: 'arvo', afternoon: 'arvo', afternoons: 'arvo', lunch: 'arvo', midday: 'arvo', pm: 'arvo',
  twilight: 'twilight', twilights: 'twilight', twi: 'twilight', evening: 'twilight', evenings: 'twilight', sunset: 'twilight',
};
/**
 * Type it: "fri arvos and any Sunday", "weekends", "after work", "sat morning, sun any time" → the picks.
 * Each chunk (split on "and", commas, "or") names days and/or parts; a chunk with days but no part means any time
 * those days, parts with no days means those parts every day. Same words as the call-out parser (lib/callout.js).
 * → { picks: Set, understood }
 */
export function typedPicks(text, cells, { weekly = false } = {}) {
  const s = String(text || '').toLowerCase().replace(/[’']/g, '').replace(/after\s+work/g, ' twilight weekday ').replace(/after\s+lunch/g, ' arvo ');
  const chunks = s.split(/\s*(?:,|;|\band\b|\bor\b|\bplus\b|&|\+)\s*/).filter((x) => x.trim());
  const picks = new Set();
  let understood = false;
  for (const ch of chunks) {
    const days = new Set(); const parts = new Set();
    for (const w of ch.split(/[^a-z]+/).filter(Boolean)) {
      const bare = w.endsWith('s') && !(w in TYPE_DAYS) && w.slice(0, -1) in TYPE_DAYS ? w.slice(0, -1) : w;
      if (bare in TYPE_DAYS) days.add(TYPE_DAYS[bare]);
      else if (w === 'weekend' || w === 'weekends') { days.add(0); days.add(6); }
      else if (w === 'weekday' || w === 'weekdays') [1, 2, 3, 4, 5].forEach((d) => days.add(d));
      else if (w in TYPE_PARTS) parts.add(TYPE_PARTS[w]);
      else if (w === 'anytime' || w === 'whenever' || w === 'all') { /* any part */ }
    }
    if (!days.size && !parts.size) continue;
    understood = true;
    for (const c of cells) {
      if (days.size && !days.has(dowOf(c.date))) continue;
      if (parts.size && !(c.part && parts.has(c.part))) continue;
      picks.add(weekly ? rowKey(c) : c.key);
    }
  }
  return { picks, understood };
}

// ------------------------------------------------------------------ the usual week (saved, prefills next time)
/** The usual week from what was ticked: { 'sat|arvo': true, … } — each weekday × part offered is set yes/no; what
 *  wasn't offered this time is kept from before. notes too: { 'sat|arvo': '…' }. */
export function usualFrom(cells, picks, { weekly = false, notes = {}, before = null } = {}) {
  const pattern = { ...(before?.pattern || {}) };
  const keepNotes = { ...(before?.notes || {}) };
  const seen = new Map();
  for (const c of cells) {
    if (!c.part) continue;
    const rk = rowKey(c);
    const yes = picks.has(weekly ? rk : c.key);
    seen.set(rk, (seen.get(rk) || false) || yes);
    const n = notes[weekly ? rk : c.key];
    if (n) keepNotes[rk] = n;
  }
  for (const [rk, yes] of seen) { if (yes) pattern[rk] = true; else { delete pattern[rk]; delete keepNotes[rk]; } }
  return { pattern, notes: keepNotes };
}

/** The usual week → the picks (and notes) for this ask. → { picks: Set, notes } */
export function prefill(cells, usual, { weekly = false } = {}) {
  const picks = new Set(); const notes = {};
  if (!usual?.pattern) return { picks, notes };
  for (const c of cells) {
    const rk = rowKey(c);
    if (!usual.pattern[rk]) continue;
    const k = weekly ? rk : c.key;
    picks.add(k);
    if (usual.notes?.[rk]) notes[k] = usual.notes[rk];
  }
  return { picks, notes };
}

// ------------------------------------------------------------------ matching (the app converges)
export const overlaps = (a, b) => a.date === b.date && a.from <= b.to && b.from <= a.to;

const byFirst = (a, b) => String(a.first_at || '9999').localeCompare(String(b.first_at || '9999')) || String(a.player_id).localeCompare(String(b.player_id));

/**
 * Every cell with who can play it, best first. answers: [{ player_id, slots, cant, first_at }].
 * probably: [{ player_id, slots }] — people who haven't replied, from their saved usual week (shown, marked
 * unconfirmed, never counted toward a full group and never locked in — Josh's open call, settled 12 Nov).
 * full: [cell keys] the booker marked full. → [{ cell, can: [ids, reply order], nine: [ids], notes: [{player_id, note}], probably: [ids] }]
 */
export function rankCells(cells, answers = [], { probably = [], full = [] } = {}) {
  const fullSet = new Set(full);
  const sorted = [...answers].filter((a) => !a.cant).sort(byFirst);
  return cells.filter((c) => !fullSet.has(c.key)).map((cell) => {
    const can = []; const nine = []; const notes = [];
    for (const a of sorted) {
      const s = (a.slots || []).find((x) => overlaps(x, cell));
      if (!s) continue;
      can.push(a.player_id);
      if (s.nine) nine.push(a.player_id);
      if (s.note) notes.push({ player_id: a.player_id, note: s.note });
    }
    const prob = probably.filter((p) => (p.slots || []).some((x) => overlaps(x, cell))).map((p) => p.player_id);
    return { cell, can, nine, notes, probably: prob };
  }).sort((a, b) => (b.can.length - a.can.length) || (b.probably.length - a.probably.length)
    || a.cell.date.localeCompare(b.cell.date) || a.cell.from.localeCompare(b.cell.from));
}

/** The group size a slot needs: the spots, else a four. */
export const groupSize = (spots) => (Number(spots) >= 2 ? Number(spots) : 4);

/** "Sat 21 arvo · 5 can" */
export function leaderLine(top) {
  if (!top || !top.can.length) return 'Nobody’s matched yet';
  return `${cellWords(top.cell)} · ${top.can.length} can${top.probably.length ? ` (+${top.probably.length} probably)` : ''}`;
}

/** Is it time for the organiser's card? A slot fills a group, or replies have closed. → { ready, why } */
export function decideReady(ranked, { spots = null, closesAt = null, now = new Date() } = {}) {
  const top = ranked[0];
  if (top && top.can.length >= groupSize(spots)) return { ready: true, why: 'full' };
  if (closesAt && new Date(closesAt) <= now) return { ready: true, why: 'closed' };
  return { ready: false, why: null };
}

/** The 2–3 slots worth putting to a vote: the best few with at least 2 who can, at most one per date-and-part. */
export function voteChoices(ranked, n = 3) {
  return ranked.filter((r) => r.can.length >= 2).slice(0, n);
}

/** The next-best slot when the booker says "Full", skipping the full ones. */
export function nextBest(ranked, full = []) {
  const f = new Set(full);
  return ranked.find((r) => !f.has(r.cell.key) && r.can.length > 0) || null;
}

/** Who's in for a cell, with spots: { in, reserve } — the people who can, in reply order (103's spot rule). */
export function cellSpots(r, spots = null) {
  const n = Number(spots) >= 2 ? Number(spots) : Infinity;
  return { in: r.can.slice(0, n), reserve: r.can.slice(n) };
}

/** A tee time inside a cell (the organiser can set an exact one at lock-in). Default: the window's start. */
export function teeFor(cell, wanted = null) {
  const t = wanted ? cleanTime(wanted) : null;
  if (t && t >= cell.from && t <= cell.to) return t;
  return cell.from;
}

/** How many tee times (of 4) a number of players needs. */
export const teeTimes = (n) => Math.max(1, Math.ceil(Number(n || 0) / 4));

// ------------------------------------------------------------------ the course check (organiser's summary)
/**
 * Per course, for the leading slot: visitor times (known or guessed), daylight, booking link.
 * windows: from daytiming.courseWindows(dow, …) — { windows: [{ from, to }] (minutes), known, source }.
 * → { visitors: 'ok'|'no'|'unknown', known, daylight: 'ok'|'tight'|'dark', booking: url|phone|null, words }
 */
export function courseCheck({ cell, windows = null, sunset = null, booking = null, nine = false } = {}) {
  const tee = toMin(cell.from); const last = toMin(cell.to);
  let visitors = 'unknown';
  if (windows && Array.isArray(windows.windows)) {
    const ok = windows.windows.some((w) => (w.to == null || w.to >= tee) && w.from <= last);
    visitors = ok ? 'ok' : 'no';
  }
  const ss = sunset ?? sunsetMin(cell.date);
  const finish = tee + (nine ? NINE_MIN : ROUND_MIN);
  const daylight = finish <= ss - 30 ? 'ok' : finish <= ss ? 'tight' : cell.part === 'twilight' ? 'ok' : 'dark';
  const words = [
    visitors === 'ok' ? `Visitors ${windows?.known ? 'OK' : 'probably OK (unconfirmed)'}` : visitors === 'no' ? `Members only then${windows?.known ? '' : ' (unconfirmed)'}` : 'Visitor times unknown',
    cell.part === 'twilight' ? 'twilight — 9 or play till dark' : daylight === 'ok' ? 'daylight ✓' : daylight === 'tight' ? 'tight on light' : 'finishes after dark',
    booking ? 'booking link ✓' : 'no booking link yet',
  ];
  return { visitors, known: !!windows?.known, daylight, booking: booking || null, words: words.join(' · ') };
}

// ------------------------------------------------------------------ "Where?" (one line under the grid)
export const WHERE_WISHES = [
  { key: 'near_home', label: 'Close to home' },
  { key: 'near_work', label: 'Close to work' },
  { key: 'nine_ok', label: '9 holes is fine' },
];
/** A clean "where" to save: { any, courses: [{ id, kind, name }], wishes: [keys], note }. */
export function cleanWhere(w = {}) {
  const courses = (w.courses || []).filter((c) => c && c.id && (c.kind === 'group' || c.kind === 'library')).slice(0, 6)
    .map((c) => ({ id: c.id, kind: c.kind, name: String(c.name || '').slice(0, 80) }));
  const wishes = [...new Set(w.wishes || [])].filter((k) => WHERE_WISHES.some((x) => x.key === k));
  const note = String(w.note || '').trim().slice(0, 120);
  return { any: !courses.length, courses, wishes, ...(note ? { note } : {}) };
}
/** What the group asked for, per course: [{ id, kind, name, n }] most first, plus wish counts. */
export function whereSummary(answers = []) {
  const courses = new Map(); const wishes = {};
  for (const a of answers) {
    if (a.cant) continue;
    for (const c of a.where?.courses || []) {
      const k = `${c.kind}:${c.id}`;
      courses.set(k, { ...c, n: (courses.get(k)?.n || 0) + 1 });
    }
    for (const w of a.where?.wishes || []) wishes[w] = (wishes[w] || 0) + 1;
  }
  return { courses: [...courses.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)), wishes };
}

// ------------------------------------------------------------------ the test plan's funnel
export const FUNNEL = ['asked', 'opened', 'replied', 'locked', 'booked', 'played'];
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/**
 * events: [{ plan_id, player_id, kind, at }] → per step: { step, n (people or call-outs), hours (median from the
 * previous step) }, plus the two numbers to judge it by: replyRate and hoursToLock (per call-out, median).
 */
export function funnel(events = [], { asked = null } = {}) {
  const firstAt = (kind) => {
    const m = new Map();
    for (const e of events.filter((x) => x.kind === kind)) {
      const k = ['opened', 'replied', 'asked'].includes(kind) ? `${e.plan_id}|${e.player_id}` : e.plan_id;
      if (!m.has(k) || e.at < m.get(k)) m.set(k, e.at);
    }
    return m;
  };
  const askT = new Map();
  for (const e of events.filter((x) => x.kind === 'asked')) if (!askT.has(e.plan_id) || e.at < askT.get(e.plan_id)) askT.set(e.plan_id, e.at);
  const steps = FUNNEL.map((step, i) => {
    const m = firstAt(step);
    let hours = null;
    if (i > 0) {
      const prev = firstAt(FUNNEL[i - 1]);
      const gaps = [];
      for (const [k, at] of m) {
        const pk = prev.has(k) ? k : k.split('|')[0];
        const p = prev.get(pk) || askT.get(k.split('|')[0]);
        if (p) gaps.push((new Date(at) - new Date(p)) / 3600000);
      }
      hours = median(gaps);
    }
    return { step, n: m.size, hours };
  });
  const askedN = asked ?? steps[0].n;
  const replied = steps.find((s) => s.step === 'replied').n;
  const lockGaps = [...firstAt('locked')].map(([plan, at]) => (askT.has(plan) ? (new Date(at) - new Date(askT.get(plan))) / 3600000 : null)).filter((x) => x != null);
  return { steps, replyRate: askedN ? replied / askedN : null, hoursToLock: median(lockGaps) };
}

/** Where it's stuck, in plain words (the design's "Reading it"). */
export function funnelReading(f) {
  const n = Object.fromEntries(f.steps.map((s) => [s.step, s.n]));
  if (!n.asked) return 'Nothing asked yet.';
  if (n.opened && n.replied / n.opened < 0.6) return 'People open it but don’t reply — the reply screen is too much work.';
  if (n.replied && !n.locked) return 'Replies come in but nothing gets locked — the organiser step is the gap.';
  if (n.locked && n.booked < n.locked) return 'Locked but not booked — booking is the gap.';
  return 'Flowing — keep an eye on reply rate and hours to lock.';
}

/** "Go again in 2 weeks?" → the same ask moved on (Same as last time). */
export function againAsk(ask) {
  const a = cleanAsk(ask || {});
  if (a.range.kind === 'dates') return { ...a, range: { kind: 'next', days: 14 }, times: [] };
  return { ...a, times: [] };
}

// ------------------------------------------------------------------ sharing to the group chat
/** The WhatsApp message: one line and the link (the link opens straight on the grid). */
export function askShareText({ who = '', ask = null, courseName = '', link = '' } = {}) {
  const head = `⛳ ${who ? `${who}: a` : 'A'}nyone keen for a round?`;
  const when = ask ? askWords(ask) : '';
  return [head, [when, courseName].filter(Boolean).join(' · '), `Tap the times you can play (10 seconds): ${link}`.trim()].filter(Boolean).join('\n');
}

// ------------------------------------------------------------------ answering from the link (no sign-in)
/** "Email or mobile" in one box → { email } | { phone } | null (not readable yet). */
export function contactOf(text) {
  const s = String(text || '').trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return { email: s.toLowerCase() };
  const digits = s.replace(/[^0-9+]/g, '');
  if (/^[0-9 +()-]{8,20}$/.test(s) && digits.replace(/\D/g, '').length >= 8) return { phone: s };
  return null;
}
/** Where this phone keeps the key for an answer it sent from a link (so it can change it, or claim it after signing in). */
export const guestKeyName = (token) => `tgt-ask-key:${String(token || '').toUpperCase()}`;
/** The ask's own link. */
export const askLink = (token, base = '') => `${base}#/a/${token}`;
