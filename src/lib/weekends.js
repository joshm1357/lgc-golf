// Weekends, head counts and the primary / backup weekends (ov23, Josh 23 Oct). Pure functions, tested (weekends.test.js).
//
// Josh: "It's not showing me all the different weekend options I would like to have as a shortlist." So step 1 shows
// EVERY weekend in the window being looked at (default the next 6 months), grouped by month, each a chip
// ("Fri 6 – Sun 8 Mar") tagged long weekend (NSW public holiday) and school holidays (NSW, Eastern division). The
// organiser ticks any number into the shortlist; the shortlist goes to the vote. After the vote the top weekend is the
// PRIMARY weekend and the next the BACKUP weekend — the courses are called about both.
//
// "Make sure the links have the right number of people in the search": the trip's head count is the number the
// organiser (or the plan chat) set, else the people who've said they're in, else everyone in the group.
import { addDays, dateOf, isoOf, publicHolidays, weekendLabel } from './tripbuilder.js';
import { playing } from './headcount.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * NSW public school holidays (Eastern division), from education.nsw.gov.au and nsw.gov.au (checked 23 Oct 2026).
 * [first weekday off, last weekday off, name]. Add the next year's when the department publishes it.
 */
export const NSW_SCHOOL_HOLIDAYS = [
  ['2025-12-22', '2026-01-26', 'Summer school holidays'],
  ['2026-04-07', '2026-04-17', 'Autumn school holidays'],
  ['2026-07-06', '2026-07-17', 'Winter school holidays'],
  ['2026-09-28', '2026-10-09', 'Spring school holidays'],
  ['2026-12-18', '2027-01-27', 'Summer school holidays'],
  ['2027-04-12', '2027-04-23', 'Autumn school holidays'],
  ['2027-07-05', '2027-07-16', 'Winter school holidays'],
  ['2027-09-27', '2027-10-08', 'Spring school holidays'],
  ['2027-12-21', '2028-01-28', 'Summer school holidays'],
];
/** The last date the school holiday list knows about (after it, "school holidays" can't be shown). */
export const SCHOOL_KNOWN_TO = NSW_SCHOOL_HOLIDAYS[NSW_SCHOOL_HOLIDAYS.length - 1][1];

/**
 * The school holidays a span of days touches (the weekends either side of a holiday count — the kids are off), or
 * null. → 'Autumn school holidays' | null
 */
export function schoolHolidayFor(start, end = start, list = NSW_SCHOOL_HOLIDAYS) {
  for (const [a, b, name] of list) {
    if (start <= addDays(b, 2) && end >= addDays(a, -2)) return name;
  }
  return null;
}

/** NSW public holidays inside a span: [{ date, name }]. */
export function holidaysIn(start, end) {
  const out = [];
  for (let d = start; d && d <= end; d = addDays(d, 1)) {
    const h = publicHolidays(Number(d.slice(0, 4)))[d];
    if (h) out.push({ date: d, name: h });
  }
  return out;
}

/** 'YYYY-MM' → 'March 2027'. */
export function monthLabel(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  return y && m ? `${MONTH[m - 1]} ${y}` : '';
}
/** 'YYYY-MM' + n months → 'YYYY-MM'. */
export function addMonths(ym, n) {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The span for one weekend (Friday `fri`) and the trip's nights:
 *   0 → Saturday only · 1 → Sat–Sun · 2 → Fri–Sun · 3 → Fri–Mon (Thu–Sun when the Friday is a holiday and the
 *   Monday isn't, e.g. Good Friday) · 4+ → Thu–Mon.
 */
export function weekendSpan(fri, nights = 2, side = null) {
  const n = Math.max(0, Math.min(4, Math.round(Number(nights) || 0)));
  const hol = (d) => !!publicHolidays(Number(d.slice(0, 4)))[d];
  if (n === 0) { const s = addDays(fri, 1); return { start: s, end: s }; }
  if (n === 1) return { start: addDays(fri, 1), end: addDays(fri, 2) };
  if (n === 2) return { start: fri, end: addDays(fri, 2) };
  if (n === 3) {
    // side (ov23): the organiser picks where the third night goes — 'thu' (Thu–Sun) or 'mon' (Fri–Mon).
    const thu = side === 'thu' || (side !== 'mon' && hol(fri) && !hol(addDays(fri, 3)));
    return thu ? { start: addDays(fri, -1), end: addDays(fri, 2) } : { start: fri, end: addDays(fri, 3) };
  }
  return { start: addDays(fri, -1), end: addDays(fri, 3) };
}

/** The Friday of the weekend a date belongs to (Thu → the next day, Sat/Sun → back to the Friday). */
export function fridayOf(iso) {
  const d = dateOf(iso);
  if (!d) return null;
  const back = { 4: -1, 5: 0, 6: 1, 0: 2, 1: 3 }[d.getDay()];
  return addDays(iso, -(back ?? 0));
}

/** A shortlist weekend at another length (the vote's winning nights): same weekend, new dates. Tags kept. */
export function resizeWeekend(w, nights, side = null) {
  const fri = fridayOf(w?.start);
  if (!fri || w.custom) return w;
  const { start, end } = weekendSpan(fri, nights, side);
  const school = start <= SCHOOL_KNOWN_TO ? schoolHolidayFor(start, end) : null;
  return { ...w, start, end, school, from: w.from || w.start };
}

// ------------------------------------------------------------------ how long (ov23: "vote on the length of the trip")

export const LENGTHS = [0, 1, 2, 3];
/** "Day trip" / "1 night" / "2 nights". */
export const lengthLabel = (n) => (Number(n) === 0 ? 'Day trip' : `${n} night${Number(n) === 1 ? '' : 's'}`);

/** The ballot section "How long?" from the organiser's ticked lengths (2+ to be a vote), or null. */
export function lengthSection(lengthVote = null) {
  const opts = [...new Set((lengthVote?.options || []).map(Number).filter((n) => LENGTHS.includes(n)))].sort((a, b) => a - b);
  if (!lengthVote?.on || opts.length < 2) return null;
  return { key: 'length', kind: 'other', question: 'How long?', options: opts.map((n) => ({ key: `nights:${n}`, label: lengthLabel(n), notes: null })) };
}

/** The leading length from the vote points ('nights:<n>'), else `fallback`. Ties go to the longer trip. */
export function leadingNights(points = {}, fallback = 2, options = LENGTHS) {
  let best = null;
  for (const n of options) {
    const p = Number(points[`nights:${n}`]) || 0;
    if (p > 0 && (!best || p > best.p || (p === best.p && n > best.n))) best = { n, p };
  }
  return best ? best.n : fallback;
}

/**
 * Every weekend in the window: from the start of `from` ('YYYY-MM', default this month) for `months` months (default
 * 6), never before `today` + 7 days (a weekend this soon can't be organised). Each one:
 *   { start, end, nights, month: 'YYYY-MM', label: 'Fri 6 – Sun 8 Mar', long, holiday, holidays: [names], school }
 * long = a public holiday on the Friday or Monday (a long weekend); school = the NSW school holidays it touches.
 */
export function weekendsInWindow({ from = null, months = 6, nights = 2, today = new Date(), side = null } = {}) {
  const t = today instanceof Date ? isoOf(today) : String(today).slice(0, 10);
  const startYm = from || t.slice(0, 7);
  const first = `${startYm}-01`;
  const last = addDays(`${addMonths(startYm, Math.max(1, Math.min(18, Number(months) || 6)))}-01`, -1);
  const earliest = addDays(t, 7);
  const d = dateOf(addDays(first, -3)); // a Friday in the last days of the month before can still start in this one
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  const out = [];
  for (let fri = isoOf(d); fri <= addDays(last, 1); fri = addDays(fri, 7)) {
    const { start, end } = weekendSpan(fri, nights, side);
    if (start < first || start > last || start < earliest) continue;
    const pubs = holidaysIn(addDays(fri, -1), addDays(fri, 3)); // Thu–Mon: what makes it a long weekend
    const longDays = pubs.filter((h) => h.date === fri || h.date === addDays(fri, 3) || (h.date === addDays(fri, -1) && start <= h.date));
    const inside = holidaysIn(start, end);
    const names = [...new Set([...longDays, ...inside].map((h) => h.name))];
    const long = longDays.length > 0;
    out.push({
      start, end, nights: Math.max(0, Math.round(Number(nights) || 0)), month: start.slice(0, 7),
      label: weekendLabel({ start, end }), long, holiday: names[0] || null, holidays: names,
      school: start <= SCHOOL_KNOWN_TO ? schoolHolidayFor(start, end) : null,
    });
  }
  return out;
}

/** Weekends grouped by month, in order: [{ month: 'YYYY-MM', label: 'March 2027', weekends }]. */
export function byMonth(weekends = []) {
  const out = [];
  for (const w of weekends) {
    const m = w.month || String(w.start).slice(0, 7);
    let g = out.find((x) => x.month === m);
    if (!g) { g = { month: m, label: monthLabel(m), weekends: [] }; out.push(g); }
    g.weekends.push(w);
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/** The tags on a weekend chip: ['Long weekend (King’s Birthday)', 'School holidays']. */
export function weekendTags(w) {
  return [w.long ? `Long weekend${w.holiday ? ` (${w.holiday})` : ''}` : (w.holiday ? w.holiday : null), w.school ? 'School holidays' : null].filter(Boolean);
}

/**
 * A weekend for the shortlist (what the builder saves): the dates and the tags, nothing else.
 */
export function shortlistEntry(w) {
  return { start: w.start, end: w.end, long: !!w.long, holiday: w.holiday || null, school: w.school || null, ...(w.custom ? { custom: true } : {}) };
}

/** Tick a weekend in or out of the shortlist (sorted by date). */
export function toggleWeekend(list = [], w, max = 26) {
  const has = list.some((x) => x.start === w.start);
  if (has) return list.filter((x) => x.start !== w.start);
  if (list.length >= max) return list;
  return [...list, shortlistEntry(w)].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Custom dates (the organiser's own, e.g. a Wednesday to Friday): a usable span or null. At most 10 days, not
 * before `today`.
 */
export function customWeekend(start, end, { today = new Date() } = {}) {
  const t = today instanceof Date ? isoOf(today) : String(today).slice(0, 10);
  if (!dateOf(start)) return null;
  const e = dateOf(end) ? end : start;
  if (e < start || start < t) return null;
  const days = Math.round((dateOf(e) - dateOf(start)) / 86400000);
  if (days > 10) return null;
  const hol = holidaysIn(start, e);
  return { start, end: e, long: false, holiday: hol[0]?.name || null, school: start <= SCHOOL_KNOWN_TO ? schoolHolidayFor(start, e) : null, custom: true, label: weekendLabel({ start, end: e }) };
}

// ------------------------------------------------------------------ the head count

/**
 * How many are coming, for the accommodation searches (and anything else that needs a number):
 *   1. the number set for this trip — by the organiser, or from the plan chat ("about 9 of us");
 *   2. else the people who've said they're in;
 *   3. else everyone in the group (approved players).
 * Never a made-up default. → { people, source: 'set' | 'ai' | 'in' | 'group' | 'none', words }
 */
export function tripHeadcount({ set = null, setBy = null, rsvps = [], players = [] } = {}) {
  // O6: the one rule lives in lib/headcount.js (target → in → in or maybe → the group); this keeps the old shape.
  const p = playing({ target: set, targetBy: setBy, rsvps, players });
  const source = { target: 'set', ai: 'ai' }[p.source] || p.source;
  const words = { set: 'target', ai: 'from the plan chat', in: 'said they’re in', keen: 'in or maybe', group: 'everyone in the group', none: 'not known yet' }[source];
  return { people: p.people, source, words, label: p.label };
}

/** "for 9 people · 5+ bedrooms" */
export function headcountLine(people, bedrooms = null) {
  const n = Math.round(Number(people)) || 0;
  if (!n) return 'for ? people';
  const b = bedrooms ?? Math.ceil(n / 2);
  return `for ${n} ${n === 1 ? 'person' : 'people'}${b ? ` · ${b}+ bedroom${b === 1 ? '' : 's'}` : ''}`;
}

// ------------------------------------------------------------------ primary and backup weekends

/**
 * The shortlist ranked by the vote (points 'weekend:<start>': ✓ = 2, ? = 1), ties to the earlier weekend.
 * → [{ ...weekend, points }]
 */
export function rankWeekends(weekends = [], points = {}) {
  return (weekends || []).map((w) => ({ ...w, points: Number(points[`weekend:${w.from || w.start}`]) || 0 }))
    .sort((a, b) => b.points - a.points || a.start.localeCompare(b.start));
}
const noPoints = ({ points: _p, ...w }) => w;

/**
 * After the vote: the primary weekend (top) and the backup (next), as the builder's settled weekends, in that order,
 * at the trip's length (nights — the "How long?" winner when it was voted on; side: where a third night goes). The
 * full shortlist is kept (weekendPool) so "open it up" can add the next one. → partial state
 */
export function settlePrimaryBackup(st = {}, points = {}, { backups = 1, nights = null, side = null } = {}) {
  const pool = st.weekendPool?.length ? st.weekendPool : (st.weekends || []);
  const n = nights ?? st.nights ?? 2;
  const ranked = rankWeekends(pool, points);
  const chosen = ranked.slice(0, 1 + Math.max(0, backups)).map(noPoints).map((w) => resizeWeekend(w, n, side ?? st.extraNight ?? null));
  return { weekends: chosen, weekendPool: pool, weekendsSettled: chosen.length > 0, nights: n };
}

/** The role of each settled weekend: 'Primary' then 'Backup' ('Backup 2'…). */
export function weekendRole(i) {
  return i === 0 ? 'Primary' : i === 1 ? 'Backup' : `Backup ${i}`;
}

/** "Primary: Fri 6 – Sun 8 Mar; Backup: Fri 13 – Sun 15 Mar" */
export function rolesLine(weekends = []) {
  return (weekends || []).map((w, i) => `${weekendRole(i)}: ${weekendLabel({ start: w.start, end: w.end })}`).join('; ');
}

/** Make one of the settled weekends the primary (the rest keep their order). */
export function makePrimary(weekends = [], start) {
  const w = weekends.find((x) => x.start === start);
  return w ? [w, ...weekends.filter((x) => x.start !== start)] : weekends;
}

/**
 * "It's not working — open it up": the next weekend from the vote that isn't in yet, added as another backup.
 * → { weekends, added } (added = null when the shortlist has nothing left).
 */
export function openUpWeekend(st = {}, points = {}) {
  // O5: a weekend that fell through (deadWeekends) is never offered again.
  const dead = new Set(st.deadWeekends || []);
  const pool = (st.weekendPool?.length ? st.weekendPool : (st.weekends || [])).filter((w) => !dead.has(w.from || w.start));
  const inNow = new Set((st.weekends || []).map((w) => w.from || w.start));
  const next = rankWeekends(pool, points).find((w) => !inNow.has(w.from || w.start));
  if (!next) return { weekends: st.weekends || [], added: null };
  const w = resizeWeekend(noPoints(next), st.nights ?? 2, st.extraNight ?? null);
  return { weekends: [...(st.weekends || []), w], added: w };
}

// ------------------------------------------------------------------ V2: weekends voted next to "How long?"
// Josh's walkthrough (23 Oct): with "How long?" on the same ballot, the weekends showed 2-night dates, then 3 nights
// won and every weekend quietly became Fri–Mon. Now each weekend says what it would be at each length, and after the
// vote the organiser is told who only said yes to the shorter trip.

const dayWord = (iso) => { const d = dateOf(iso); return d ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()}` : ''; };

/**
 * The weekends as ballot options when the length is voted on too: each at the SHORTEST length on the ballot, with
 * a note for the longer ones — "Plus Mon 25 if we go 3 nights". Without a length vote: as they are.
 * weekends: the shortlist; lengthVote: { on, options }; side: where a third night goes ('thu' | 'mon').
 * → [{ key: 'weekend:<shortlist start>', label, start_date, end_date, notes }]
 */
export function weekendBallotOptions(weekends = [], lengthVote = null, side = null) {
  const opts = [...new Set((lengthVote?.options || []).map(Number).filter((n) => LENGTHS.includes(n)))].sort((a, b) => a - b);
  const voted = !!lengthVote?.on && opts.length >= 2;
  return (weekends || []).map((w) => {
    const key = `weekend:${w.start}`;
    if (!voted || w.custom) return { key, label: weekendLabel(w), start_date: w.start, end_date: w.end, notes: null };
    const base = resizeWeekend(w, opts[0], side);
    const longer = opts.slice(1).map((n) => {
      const s = resizeWeekend(w, n, side);
      const extra = [];
      for (let d = s.start; d && d <= s.end; d = addDays(d, 1)) if (d < base.start || d > base.end) extra.push(dayWord(d));
      return extra.length ? `${extra.join(' and ')} if we go ${lengthLabel(n).toLowerCase()}` : null;
    }).filter(Boolean);
    return {
      key, label: weekendLabel({ start: base.start, end: base.end }), start_date: base.start, end_date: base.end,
      notes: longer.length ? `Plus ${longer.join('; plus ')}` : null,
    };
  });
}

/**
 * After the vote (V2): "3 nights won, so it's Fri 22 – Mon 25 Jan. 2 people only said yes to a shorter trip — check
 * with them." Who: people who said yes or maybe to the primary weekend but didn't say yes or maybe to the winning
 * length (and did answer "How long?").
 * polls: the vote card's polls; options + votes: the planner's; optionKeys: { option_id: key } (the builder's);
 * nights: the winning length; primary: the primary weekend { start, end } (at the winning length);
 * primaryKey: its shortlist key ('weekend:<start>').
 * → { won: '3 nights', line, check: [player ids] } or null when the length wasn't voted on.
 */
export function lengthCheck({ polls = [], options = [], votes = [], optionKeys = {}, nights = null, primary = null, primaryKey = null } = {}) {
  const keyOf = (o) => optionKeys[o.id] || null;
  const lengthPoll = (polls || []).find((p) => (options || []).some((o) => o.poll_id === p.id && /^nights:/.test(keyOf(o) || '')));
  if (!lengthPoll || nights == null) return null;
  const won = (options || []).find((o) => o.poll_id === lengthPoll.id && keyOf(o) === `nights:${nights}`);
  const wk = primaryKey ? (options || []).find((o) => keyOf(o) === primaryKey) : null;
  const ok = (v) => v.response === 'yes' || v.response === 'maybe';
  const answeredLength = new Set((votes || []).filter((v) => v.poll_id === lengthPoll.id).map((v) => v.player_id));
  const okLength = new Set((votes || []).filter((v) => won && v.option_id === won.id && ok(v)).map((v) => v.player_id));
  const okWeekend = wk ? [...new Set((votes || []).filter((v) => v.option_id === wk.id && ok(v)).map((v) => v.player_id))] : [];
  const check = okWeekend.filter((id) => answeredLength.has(id) && !okLength.has(id));
  const when = primary?.start ? weekendLabel({ start: primary.start, end: primary.end }) : null;
  const line = `${lengthLabel(nights)} won${when ? `, so it’s ${when}` : ''}.${check.length ? ` ${check.length} ${check.length === 1 ? 'person' : 'people'} only said yes to a shorter trip — check with them.` : ''}`;
  return { won: lengthLabel(nights), line, check };
}

/** "Mar" — the short month of a weekend (for the month heading on a phone). */
export const shortMonth = (iso) => MON[(dateOf(iso)?.getMonth() ?? 0)];
