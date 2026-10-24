// "Who's up for a hit?" — putting a round out to the group (ov34, Josh 23 Oct 2026). Pure functions, no database and
// no React, tested in callout.test.js. The screens (screens/RoundCallout.jsx, components/CalloutSheet.jsx) and the
// end-to-end test's stand-in database use these; migration 103 does the same sums on the server.
//
// A call-out is a plan (kind 'round', callout = true) on the trip-planning engine: the time options are a 'dates'
// vote (plan_polls / plan_options / plan_votes), a fixed time is plain In / Maybe / Can't (plan_rsvps), and locking it
// in makes a trip with ONE round in the app (rounds + round_players), so scoring, history and side games work as usual.
//
// Plain words used everywhere:
//   * part of the day — morning, midday, arvo, twilight (each has a usual start time, used until the tee time is set);
//   * an option — one day + part of the day (or an exact tee time): "Fri 30 Oct · arvo";
//   * spots — a cap (with a reserve list) or no cap. The first people to say they can make it get the spots, in the
//     order they first said so; changing a note never moves you, but saying you can't (or maybe) and back again puts
//     you at the back.

// ------------------------------------------------------------------ Dates (ISO 'YYYY-MM-DD', no time zones)
const pad = (n) => String(n).padStart(2, '0');
const asDate = (ymd) => new Date(`${ymd}T12:00:00Z`);
const toYmd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDays = (ymd, n) => { const d = asDate(ymd); d.setUTCDate(d.getUTCDate() + n); return toYmd(d); };
/** 0 = Sunday … 6 = Saturday. */
export const dowOf = (ymd) => asDate(ymd).getUTCDay();
export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today in Sydney (the group's clock — the app's "today" elsewhere is the phone's; for a call-out Sydney is right). */
export function sydneyToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(now);
}

/** "Fri 30 Oct" */
export function dayLabel(ymd) {
  const d = asDate(ymd);
  return `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

// ------------------------------------------------------------------ Parts of the day and times
export const PARTS = {
  morning: { label: 'Morning', word: 'morning', start: '07:00' },
  midday: { label: 'Midday', word: 'midday', start: '11:00' },
  arvo: { label: 'Arvo', word: 'arvo', start: '13:00' },
  twilight: { label: 'Twilight', word: 'twilight', start: '16:00' },
};
export const PART_KEYS = Object.keys(PARTS);

/** '13:20' → '1:20pm'; '07:00' → '7am'; bad → ''. */
export function clock(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return '';
  const h = Number(m[1]);
  const min = m[2];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min === '00' ? '' : `:${min}`}${h < 12 ? 'am' : 'pm'}`;
}

/** A clean 'HH:MM' from what someone typed ('1:20pm', '13:20', '7.30', '7am'), or null. Bare 1–6 means pm. */
export function cleanTime(s) {
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*$/i.exec(String(s || ''));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = (m[3] || '').toLowerCase();
  if (min > 59 || h > 23) return null;
  if (ap === 'pm' && h < 12) h += 12;
  else if (ap === 'am' && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 6) h += 12; // "at 2" on a golf course is 2pm
  if (ap && Number(m[1]) > 12) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** The part of the day a tee time falls in. */
export function partOfTime(t) {
  const h = Number(String(t || '').slice(0, 2));
  if (!Number.isFinite(h)) return null;
  if (h < 11) return 'morning';
  if (h < 13) return 'midday';
  if (h < 16) return 'arvo';
  return 'twilight';
}

/** When an option starts: its tee time, else its part of the day's usual start, else 7am. */
export function startOf(o) {
  return (o?.tee_time && cleanTime(o.tee_time)) || PARTS[o?.part]?.start || '07:00';
}

/** "Fri 30 Oct · arvo", "Fri 30 Oct · 1:20pm", "Fri 30 Oct". */
export function optionLabel(o) {
  if (!o?.date) return o?.label || '';
  const when = o.tee_time ? clock(o.tee_time) : PARTS[o.part]?.word || '';
  return [dayLabel(o.date), when].filter(Boolean).join(' · ');
}

/** An option the database stores: { label, date, part, tee_time }. */
export function makeOption(date, part = null, teeTime = null) {
  const tee_time = teeTime ? cleanTime(teeTime) : null;
  const p = PARTS[part] ? part : tee_time ? partOfTime(tee_time) : null;
  const o = { date, part: p, tee_time };
  return { ...o, label: optionLabel(o) };
}

export const MAX_OPTIONS = 8;
const keyOf = (o) => `${o.date}|${o.tee_time || ''}|${o.part || ''}`;
const partRank = (p) => (p ? PART_KEYS.indexOf(p) : -1);
/** Sorted by date, then time of day; duplicates out; past dates out; at most 8. → { options, cut } */
export function tidyOptions(list, today) {
  const seen = new Set();
  const all = (list || []).filter((o) => o?.date && (!today || o.date >= today)).filter((o) => {
    const k = keyOf(o);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date) || startOf(a).localeCompare(startOf(b)) || partRank(a.part) - partRank(b.part));
  return { options: all.slice(0, MAX_OPTIONS), cut: Math.max(0, all.length - MAX_OPTIONS) };
}

// ------------------------------------------------------------------ The quick builder (chips)
/** Rolling windows from tomorrow, so "Next 7 days" is never empty on a Sunday. */
export const RANGES = {
  next7: { label: 'Next 7 days', from: 1, to: 7 },
  week2: { label: 'Week after', from: 8, to: 14 },
  next14: { label: 'Next 2 weeks', from: 1, to: 14 },
  next28: { label: 'Next 4 weeks', from: 1, to: 28 },
};
export const BUILDER_DAYS = ['thu', 'fri', 'sat', 'sun'];

/**
 * The chips: days × part of the day (or an exact time) × how far ahead → the options.
 *   buildOptions({ days: ['fri'], part: 'arvo', range: 'next14' }, '2026-10-23')
 *     → Fri 30 Oct · arvo, Fri 6 Nov · arvo
 * → { options, cut }
 */
export function buildOptions({ days = [], part = null, time = null, range = 'next14' } = {}, today) {
  const r = RANGES[range] || RANGES.next14;
  const want = new Set((days || []).map((d) => DAY_KEYS.indexOf(d)).filter((i) => i >= 0));
  const out = [];
  for (let i = r.from; i <= r.to; i++) {
    const d = addDays(today, i);
    if (want.has(dowOf(d))) out.push(makeOption(d, part, time));
  }
  return tidyOptions(out, today);
}

// ------------------------------------------------------------------ The type-it box
const DAY_WORDS = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const PART_WORDS = {
  morning: 'morning', morn: 'morning', mornings: 'morning', am: 'morning', early: 'morning', brekky: 'morning', dawn: 'morning',
  midday: 'midday', lunch: 'midday', lunchtime: 'midday', noon: 'midday', middle: 'midday',
  arvo: 'arvo', arvos: 'arvo', afternoon: 'arvo', afternoons: 'arvo', pm: 'arvo',
  twilight: 'twilight', twi: 'twilight', twilights: 'twilight', twilighter: 'twilight', evening: 'twilight', evenings: 'twilight', sunset: 'twilight', late: 'twilight',
};
const NUM_WORDS = { one: 1, a: 1, two: 2, couple: 2, three: 3, few: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const MOD_WORDS = { this: 'this', coming: 'this', upcoming: 'this', next: 'next', every: 'every', each: 'every', all: 'every', any: 'every' };

function dayWord(w) {
  if (w in DAY_WORDS) return DAY_WORDS[w];
  if (w.endsWith('s') && w.slice(0, -1) in DAY_WORDS) return DAY_WORDS[w.slice(0, -1)]; // "fridays", "sats"
  return null;
}
const MONTH_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** 'nov' / 'november' / 'sept' → 10 / 10 / 8; anything else → -1. */
function monthOf(w) {
  const s = String(w || '');
  if (s === 'sept') return 8;
  if (s.length === 3 && MONTHS.includes(s)) return MONTHS.indexOf(s);
  return MONTH_FULL.indexOf(s);
}

function tokens(text) {
  const s = String(text || '').toLowerCase().replace(/[’']/g, '').replace(/after\s+work/g, ' twilight ').replace(/after\s+lunch/g, ' arvo ')
    .replace(/w\/e/g, ' weekend ').replace(/[;&+!?()]/g, ' , ');
  const rx = /(\d{1,2})[:.](\d{2})\s*(am|pm)?|(\d{1,2})\s*(am|pm)\b|(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b|(\d{1,2})\/(\d{1,2})|[a-z]+|\d+|,/g;
  const out = [];
  for (const m of s.matchAll(rx)) {
    if (m[1] != null) out.push({ t: 'time', v: cleanTime(`${m[1]}:${m[2]}${m[3] || ''}`) });
    else if (m[4] != null) out.push({ t: 'time', v: cleanTime(`${m[4]}${m[5]}`) });
    else if (m[6] != null) out.push({ t: 'dm', d: Number(m[6]), m: MONTHS.indexOf(m[7]) });
    else if (m[8] != null) out.push({ t: 'dm', d: Number(m[9]), m: MONTHS.indexOf(m[8]) });
    else if (m[10] != null) out.push({ t: 'dm', d: Number(m[10]), m: Number(m[11]) - 1 });
    else if (m[0] === ',') out.push({ t: 'sep' });
    else if (/^\d+$/.test(m[0])) out.push({ t: 'num', v: Number(m[0]) });
    else out.push({ t: 'word', v: m[0] });
  }
  return out.filter((x) => x.t !== 'time' || x.v);
}

/** The year for a day and month: this year, or next year if it's already gone. */
function dateFor(d, m, today) {
  if (!(m >= 0 && m <= 11) || !(d >= 1 && d <= 31)) return null;
  const y = Number(today.slice(0, 4));
  let ymd = `${y}-${pad(m + 1)}-${pad(d)}`;
  if (toYmd(asDate(ymd)) !== ymd) return null; // 31 Nov
  if (ymd < today) ymd = `${y + 1}-${pad(m + 1)}-${pad(d)}`;
  return ymd;
}
/** The Monday of the week a date is in. */
const mondayOf = (ymd) => addDays(ymd, -((dowOf(ymd) + 6) % 7));

/**
 * Words → options, worked out on the phone (no AI). Understands, e.g.:
 *   "this fri arvo", "next thu", "any fri arvo in nov", "sat or sun morning", "fri arvo next 2 weeks",
 *   "tomorrow 7:30", "sat 30 oct 1:20pm", "this weekend", "next 3 fridays twilight", "every sat 7:30".
 * "this fri" = Friday this week (or the coming one if it's gone); "next fri" = Friday next week (Mon–Sun weeks);
 * a bare "fri" = the coming Friday (today if it's Friday). "every …" puts out the next 4 (repeat = true — repeating
 * call-outs are a later extension, see REPEAT_LATER).
 * → { options, cut, repeat, understood, hint }
 */
export function parseWhen(text, today) {
  const toks = tokens(text);
  const items = []; // { kind: 'dow'|'date', dow?, date?, mod, part, time, count }
  let mod = null; let weeks = null; let month = null; let lastPart = null; let lastTime = null; let pendingPart = null; let pendingTime = null;
  let repeat = false;
  const pending = () => items.filter((x) => !x.part && !x.time);
  const giveTime = (t) => { const p = items.filter((x) => !x.time && !x.ownPart); if (p.length) p.forEach((x) => { x.time = t; }); else pendingTime = t; lastTime = t; };
  const givePart = (p) => { const list = pending(); if (list.length) list.forEach((x) => { x.part = p; x.ownPart = true; }); else pendingPart = p; lastPart = p; };
  const addItem = (it) => { items.push({ part: pendingPart, time: pendingTime, ownPart: !!pendingPart, ...it }); };
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i];
    const next = toks[i + 1];
    const after = toks[i + 2];
    if (k.t === 'time') { giveTime(k.v); continue; }
    if (k.t === 'dm') {
      // "sat 31 oct": the day word just before a date is that date's weekday, not another option.
      const prev = toks[i - 1];
      if (prev?.t === 'word' && dayWord(prev.v) != null && items.length && items[items.length - 1].tok === i - 1) items.pop();
      const d = dateFor(k.d, k.m, today);
      if (d) addItem({ kind: 'date', date: d, mod });
      continue;
    }
    if (k.t === 'sep') continue;
    const numOf = (x) => (x?.t === 'num' ? x.v : x?.t === 'word' ? NUM_WORDS[x.v] : null);
    if (k.t === 'num' || (k.t === 'word' && k.v in NUM_WORDS && k.v !== 'a')) {
      const n = numOf(k);
      if (next?.t === 'word' && /^(weeks?|wks?)$/.test(next.v)) { weeks = n; i++; continue; }
      if (next?.t === 'word' && dayWord(next.v) != null) { addItem({ kind: 'dow', dow: dayWord(next.v), mod: 'count', count: n }); i++; continue; }
      if (k.t === 'num' && next?.t === 'word' && monthOf(next.v) >= 0) continue; // handled by 'dm'
      continue;
    }
    const w = k.v;
    if (w === 'at' && next?.t === 'num') { const t = cleanTime(String(next.v)); if (t) giveTime(t); i++; continue; }
    if (w === 'fortnight') { weeks = 2; continue; }
    if ((w === 'in' || w === 'of' || w === 'during' || w === 'thru' || w === 'through') && next?.t === 'word' && monthOf(next.v) >= 0) { month = monthOf(next.v); i++; continue; }
    if (w === 'for' && numOf(next) && after?.t === 'word' && /^(weeks?|wks?)$/.test(after.v)) { weeks = numOf(next); i += 2; continue; }
    if (w === 'next' && numOf(next) && after?.t === 'word' && /^(weeks?|wks?)$/.test(after.v)) { weeks = numOf(next); i += 2; continue; }
    if (w === 'next' && numOf(next) && after?.t === 'word' && dayWord(after.v) != null) { addItem({ kind: 'dow', dow: dayWord(after.v), mod: 'count', count: numOf(next) }); i += 2; continue; }
    if (w === 'next' && next?.t === 'word' && /^(weeks?|wk)$/.test(next.v)) {
      // "fri next week" → next week's Friday; "next week" before the days → the same.
      const bare = items.filter((x) => x.kind === 'dow' && !x.mod);
      if (bare.length) bare.forEach((x) => { x.mod = 'next'; }); else mod = 'next';
      i++; continue;
    }
    if (w === 'this' && next?.t === 'word' && /^(weeks?|wk)$/.test(next.v)) {
      const bare = items.filter((x) => x.kind === 'dow' && !x.mod);
      if (bare.length) bare.forEach((x) => { x.mod = 'this'; }); else mod = 'this';
      i++; continue;
    }
    if (w in MOD_WORDS) { mod = MOD_WORDS[w]; if (mod === 'every' && (w === 'every' || w === 'each')) repeat = true; continue; }
    if (w === 'today' || w === 'tonight') { addItem({ kind: 'date', date: today, mod }); if (w === 'tonight') givePart('twilight'); continue; }
    if (w === 'tomorrow' || w === 'tmrw' || w === 'tomoz' || w === 'tomorow' || w === 'tmr') { addItem({ kind: 'date', date: addDays(today, 1), mod }); continue; }
    if (w === 'weekend' || w === 'weekends' || w === 'wkend') { addItem({ kind: 'dow', dow: 6, mod }); addItem({ kind: 'dow', dow: 0, mod }); continue; }
    if (dayWord(w) != null) { addItem({ kind: 'dow', tok: i, dow: dayWord(w), mod: mod || (/(day)?s$/.test(w) && w.length > 3 && w.endsWith('s') && !(w in DAY_WORDS) ? 'every' : null) }); continue; }
    if (w in PART_WORDS) { givePart(PART_WORDS[w]); continue; }
    if (monthOf(w) >= 0 && w !== 'may' && w !== 'mar' && w.length >= 3 && (w.length > 3 || items.length)) { month = monthOf(w); continue; }
  }
  // A part or time said before any day ("morning, sat or sun") or after all of them already landed; anything left
  // without one takes the last one said ("sat morning or sun" → both mornings).
  for (const x of items) {
    if (!x.part && !x.time && lastTime) x.time = lastTime;
    if (!x.part && lastPart && !x.time) x.part = lastPart;
  }

  const dates = [];
  const tomorrow = addDays(today, 1);
  for (const x of items) {
    const add = (d) => dates.push(makeOption(d, x.part || (x.time ? null : null), x.time));
    if (x.kind === 'date') { if (x.date >= today) add(x.date); continue; }
    const ahead = (from) => { let d = from; while (dowOf(d) !== x.dow) d = addDays(d, 1); return d; };
    if (month != null) {
      const y = Number(today.slice(0, 4));
      let start = `${y}-${pad(month + 1)}-01`;
      if (month < Number(today.slice(5, 7)) - 1) start = `${y + 1}-${pad(month + 1)}-01`;
      for (let d = ahead(start); d.slice(5, 7) === start.slice(5, 7); d = addDays(d, 7)) if (d >= today) add(d);
      continue;
    }
    if (x.mod === 'count') { let d = ahead(tomorrow); for (let n = 0; n < Math.min(8, x.count || 1); n++, d = addDays(d, 7)) add(d); continue; }
    if (weeks) { const end = addDays(today, 7 * weeks); for (let d = ahead(tomorrow); d <= end; d = addDays(d, 7)) add(d); continue; }
    if (x.mod === 'every') { let d = ahead(tomorrow); for (let n = 0; n < 4; n++, d = addDays(d, 7)) add(d); continue; }
    if (x.mod === 'next') { add(ahead(addDays(mondayOf(today), 7))); continue; }
    if (x.mod === 'this') { const d = ahead(mondayOf(today)); add(d >= today ? d : ahead(today)); continue; }
    add(ahead(today));
  }
  const { options, cut } = tidyOptions(dates, today);
  const understood = options.length > 0;
  let hint = null;
  if (!understood) hint = toks.length ? 'Add a day — e.g. “fri arvo”, “next thu”, “sat or sun morning”.' : null;
  else if (cut) hint = `That’s ${options.length + cut} — only the first ${MAX_OPTIONS} go out. Fewer options get quicker answers.`;
  else if (repeat) hint = REPEAT_LATER;
  return { options, cut, repeat, understood, hint };
}

/** Extension point (not built): repeating call-outs — "every Saturday 7:30 at Moore Park". For now "every …" puts out
 *  the next four; a repeating one would put the next one out by itself each week. */
export const REPEAT_LATER = 'Repeating call-outs are coming — for now this puts out the next four.';

// ------------------------------------------------------------------ When replies close
/** Sydney wall time → a UTC Date (handles daylight saving). */
export function sydneyToUtc(ymd, hhmm = '07:00') {
  const [y, mo, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi) - 10 * 3600000;
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(f.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess + (Date.UTC(y, mo - 1, d, h, mi) - shown));
}

/**
 * Replies close 24 hours before the earliest option starts — but never sooner than an hour from now, and never after
 * the round starts. Rounded down to the quarter hour. → Date
 */
export function defaultCloses(options, now = new Date()) {
  const starts = (options || []).filter((o) => o?.date).map((o) => sydneyToUtc(o.date, startOf(o)).getTime());
  if (!starts.length) return new Date(now.getTime() + 24 * 3600000);
  const first = Math.min(...starts);
  let t = Math.max(first - 24 * 3600000, now.getTime() + 3600000);
  if (t > first) t = first;
  return new Date(Math.floor(t / 900000) * 900000);
}

/** "Fri 30 Oct, 1pm" (Sydney) for a closes-at time. */
export function closesWords(at) {
  if (!at) return '';
  const d = new Date(at);
  const ymd = sydneyToday(d);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${dayLabel(ymd)}, ${clock(hm)}`;
}

// ------------------------------------------------------------------ Spots and the reserve list
const byTime = (a, b) => String(a.at || '9999').localeCompare(String(b.at || '9999')) || String(a.player_id).localeCompare(String(b.player_id));

/**
 * Who has a spot. entries: the people who said they can make it, with when they FIRST said so ({ player_id, at }).
 * cap null = no cap. → { in: [ids], reserve: [ids] } — the first `cap` in that order are in, the rest reserves.
 */
export function spotList({ cap = null, entries = [] } = {}) {
  const order = [...(entries || [])].filter((e) => e?.player_id).sort(byTime).map((e) => e.player_id);
  const n = Number(cap) > 0 ? Number(cap) : Infinity;
  return { in: order.slice(0, n), reserve: order.slice(n) };
}

/** A fixed time (or after lock-in): spots from the In replies, by first_in_at. → { in, reserve, maybe, out } */
export function rsvpSpots({ cap = null, rsvps = [] } = {}) {
  const s = spotList({ cap, entries: (rsvps || []).filter((r) => r?.status === 'in').map((r) => ({ player_id: r.player_id, at: r.first_in_at || r.updated_at })) });
  return {
    ...s,
    maybe: (rsvps || []).filter((r) => r?.status === 'maybe').map((r) => r.player_id),
    out: (rsvps || []).filter((r) => r?.status === 'out').map((r) => r.player_id),
  };
}

/** Per option: ✓ / ? / ✗ counts and the ✓ people in the order they first ticked. → { [optionId]: { yes, maybe, no, yesIds, maybeIds, noIds } } */
export function optionTally(options = [], votes = []) {
  const out = {};
  for (const o of options || []) {
    const vs = (votes || []).filter((v) => v.option_id === o.id);
    const yes = vs.filter((v) => v.response === 'yes').map((v) => ({ player_id: v.player_id, at: v.first_yes_at || v.updated_at })).sort(byTime);
    out[o.id] = {
      yes: yes.length, maybe: vs.filter((v) => v.response === 'maybe').length, no: vs.filter((v) => v.response === 'no').length,
      yesIds: yes.map((v) => v.player_id), maybeIds: vs.filter((v) => v.response === 'maybe').map((v) => v.player_id), noIds: vs.filter((v) => v.response === 'no').map((v) => v.player_id),
    };
  }
  return out;
}

/** The option the app suggests locking in: the most ✓, then the most ?, then the earliest. → option or null */
export function suggestOption(options = [], votes = []) {
  const t = optionTally(options, votes);
  const ranked = [...(options || [])].sort((a, b) => (t[b.id].yes - t[a.id].yes) || (t[b.id].maybe - t[a.id].maybe)
    || String(a.start_date || a.date || '').localeCompare(String(b.start_date || b.date || '')));
  return ranked[0] || null;
}

/**
 * What locking in this option would do. → { in, reserve, maybe, out } (player ids, in order).
 * Options: the ✓ people in the order they first ticked it. A fixed time: the In replies.
 */
export function lockPreview({ cap = null, optionId = null, votes = [], rsvps = [] } = {}) {
  if (!optionId) return rsvpSpots({ cap, rsvps });
  const vs = (votes || []).filter((v) => v.option_id === optionId);
  const s = spotList({ cap, entries: vs.filter((v) => v.response === 'yes').map((v) => ({ player_id: v.player_id, at: v.first_yes_at || v.updated_at })) });
  return { ...s, maybe: vs.filter((v) => v.response === 'maybe').map((v) => v.player_id), out: vs.filter((v) => v.response === 'no').map((v) => v.player_id) };
}

/** If this person pulls out, who moves up from the reserves (or null). */
export function promotedBy({ cap = null, rsvps = [] } = {}, pid) {
  const before = rsvpSpots({ cap, rsvps });
  if (!before.in.includes(pid)) return null;
  const after = rsvpSpots({ cap, rsvps: rsvps.map((r) => (r.player_id === pid ? { ...r, status: 'out' } : r)) });
  return after.in.find((id) => !before.in.includes(id)) || null;
}

/** Where I stand: 'in' | 'reserve' (with my place) | 'maybe' | 'out' | null (not replied). */
export function myStanding({ cap = null, rsvps = [] } = {}, pid) {
  const s = rsvpSpots({ cap, rsvps });
  if (s.in.includes(pid)) return { status: 'in' };
  const r = s.reserve.indexOf(pid);
  if (r >= 0) return { status: 'reserve', place: r + 1 };
  if (s.maybe.includes(pid)) return { status: 'maybe' };
  if (s.out.includes(pid)) return { status: 'out' };
  return { status: null };
}

/** "3 of 4 spots" / "Full — 2 on reserve" / "No cap · 5 in". */
export function spotsWords(cap, nIn, nReserve = 0) {
  if (!(Number(cap) > 0)) return `No cap · ${nIn} in`;
  if (nIn >= cap) return `Full${nReserve ? ` — ${nReserve} on reserve` : ''}`;
  return `${nIn} of ${cap} spots`;
}

// ------------------------------------------------------------------ Who's asked
/** The people a call-out can ask: approved, not guests. */
export function askable(players = []) {
  return (players || []).filter((p) => p && p.approved !== false && p.role !== 'guest');
}
/** Who's asked: everyone askable (invite_all) or the invite list — always with the creator. → [ids] */
export function askedIds({ plan, players = [], invites = [] } = {}) {
  const all = askable(players).map((p) => p.id);
  if (!plan || plan.invite_all !== false) return all;
  const ids = new Set((invites || []).map((i) => i.player_id));
  if (plan.created_by) ids.add(plan.created_by);
  return [...ids];
}

// ------------------------------------------------------------------ The Caddie: "ask the guys for a hit fri arvo"
/** Does this sound like putting a round out? (Then the Caddie opens the sheet, filled in from the words.) */
export function calloutIntent(text) {
  const s = String(text || '').toLowerCase();
  const golf = /\b(hit|round|game|nine|9 holes|18 holes|eighteen|tee ?time|golf|hitout|hit-out|nine holes)\b/.test(s);
  const ask = /\b(ask|anyone|who(s|'s| is)?|put|keen|up for|organise|organize|callout|call-out|call out|get a|book|line up|round up)\b/.test(s);
  return golf && ask;
}

// ------------------------------------------------------------------ Extras (Josh 23 Oct, 9:39pm: hidden as standard)
/**
 * "➕ Add to this round" — each switched on per round, reusing what the trip planner already has. Stored on the plan
 * (plans.extras, jsonb). The default round screen shows none of them.
 *   course_vote — let them vote on the course (the plan's 'location' vote)
 *   games       — side games and bets (the Games screen, once the round's made)
 *   fines       — fines & awards (the trip's Fines & awards, once the round's made)
 *   cars        — cars and lifts (the plan's 'car' rooms-and-cars list)
 *   kitty       — who owes what (the plan's kitty)
 *   after       — drinks or lunch after (a line of words)
 */
export const EXTRAS = [
  { key: 'course_vote', icon: '🗳️', label: 'Vote on the course', help: 'List a few courses and let them tick where they’d play.' },
  { key: 'games', icon: '🎲', label: 'Side games & bets', help: 'Skins, Nassau and the like — set up once the round’s locked in.', feature: 'games' },
  { key: 'fines', icon: '🏷️', label: 'Fines & awards', help: 'Fines and awards for the day, once it’s locked in.', feature: 'dinner_awards' },
  { key: 'cars', icon: '🚗', label: 'Cars & lifts', help: 'Who’s driving and who’s with who.', feature: 'planner_rooms' },
  { key: 'kitty', icon: '💰', label: 'Kitty', help: 'Who owes what (carts, the bar tab).', feature: 'planner_costs' },
  { key: 'after', icon: '🍺', label: 'Drinks or lunch after', help: 'One line, e.g. “Beers at the Bowlo after”.' },
];
/** The extras switched on for a plan, in catalogue order (only those whose feature is on). on(feature) → boolean */
export function extrasOn(plan, on = () => true) {
  const x = plan?.extras && typeof plan.extras === 'object' ? plan.extras : {};
  return EXTRAS.filter((e) => (e.key === 'after' ? !!String(x.after || '').trim() : x[e.key] === true) && (!e.feature || on(e.feature)));
}
/** A clean extras object to save: true/false switches and the after line (max 120). */
export function cleanExtras(x = {}) {
  const out = {};
  for (const e of EXTRAS) {
    if (e.key === 'after') { const t = String(x.after || '').trim().slice(0, 120); if (t) out.after = t; } else if (x[e.key] === true) out[e.key] = true;
  }
  return out;
}

// ------------------------------------------------------------------ Words for the feed and the buzzes
/** "Fri arvo at Moore Park" style summary of what's going out. */
export function calloutSummary({ options = [], courseName = '' } = {}) {
  const when = options.length === 1 ? optionLabel(options[0]) : options.length ? `${options.length} times to pick from` : 'Time TBC';
  return [when, courseName ? `at ${courseName}` : 'course TBC'].join(' ');
}

/** The name for a new call-out when none is typed: "Fri arvo hit" / "Hit at Moore Park". */
export function defaultName({ options = [], courseName = '' } = {}) {
  const days = [...new Set(options.map((o) => DAY_SHORT[dowOf(o.date)]))];
  const parts = [...new Set(options.map((o) => (o.tee_time ? null : o.part)).filter(Boolean))];
  if (days.length === 1) return `${days[0]}${parts.length === 1 ? ` ${PARTS[parts[0]].word}` : ''} hit`;
  return courseName ? `Hit at ${courseName}`.slice(0, 60) : 'A hit with the boys';
}
