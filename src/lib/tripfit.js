// How well a choice fits the group (ov40, 25 Oct 2026). Pure functions only — no React, no database.
//
// Josh: "review strategically what I'm looking for and the inputs I want in order to organise the weekend… different
// courses, how to do it, get input." COLLECT (each person's wishes, ov39's plan_wishes) → SHAPE (the day plan, this)
// → DECIDE (the organiser picks). Never a black-box score: every option gets a short fit line, plus who it doesn't
// suit and why, by name.
//
//   plan_wishes (108, one row per person per plan): { plan_id, player_id, cant_dates: date[] (Fridays of weekends they
//   can't do), spend_band: 'lt500' | '500_800' | '800_1200' | 'any' | null, travel: 'drive' | 'fly' | 'either' | null,
//   max_drive_min: int | null, golf_per_day: 'max' | 'daily' | 'spare_day' | 'any' | null, day_prefs: jsonb keyed by the
//   day's place in the trip ('first', 'middle', 'last'; old rows by weekday 'fri', 'sat'…) → 'early' | 'midday' | 'late' |
//   'morning_free' | 'any', home_by: time (the last day), nights: int[] | null (the trip lengths they'd do, 1–6, 4 = "4+";
//   [] = not fussed, ov41), wish: text | null, updated_at }
//   Read defensively (cleanWishes): the table may not be there yet, rows may be partial.
import { suits, dur, hm, r5, PREF_LABEL, DAY_POS, DAY_POS_NAME } from './daytiming.js';
import { dateOf, isoOf } from './tripbuilder.js';

export const SPEND_MAX = { lt500: 500, '500_800': 800, '800_1200': 1200, any: Infinity };
export const SPEND_LABEL = { lt500: 'under $500', '500_800': '$500–800', '800_1200': '$800–1,200', any: 'any spend' };
const SPENDS = Object.keys(SPEND_MAX);
const TRAVELS = ['drive', 'fly', 'either'];
const GOLFS = ['max', 'daily', 'spare_day', 'any'];
const DAYPREFS = ['early', 'midday', 'late', 'morning_free', 'any'];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const FLY_SHARE = 0.5; // flying is on the table when at least half of those who said said fly or either

/** Rows from plan_wishes (or anything shaped like them) → tidy wishes, one per person (the newest wins). */
export function cleanWishes(rows) {
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.player_id) continue;
    const pick = (v, ok) => (ok.includes(v) ? v : null);
    const n = Number(r.max_drive_min);
    by.set(r.player_id, {
      player_id: r.player_id,
      cant_dates: (Array.isArray(r.cant_dates) ? r.cant_dates : []).map((d) => String(d).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      spend_band: pick(r.spend_band, SPENDS), travel: pick(r.travel, TRAVELS),
      max_drive_min: Number.isFinite(n) && n > 0 ? Math.round(n) : null,
      golf_per_day: pick(r.golf_per_day, GOLFS),
      day_prefs: cleanDayPrefs(r.day_prefs),
      home_by: /^([01]\d|2[0-3]):[0-5]\d/.test(String(r.home_by || '')) ? String(r.home_by).slice(0, 5) : null,
      nights: cleanNights(r.nights),
      wish: typeof r.wish === 'string' && r.wish.trim() ? r.wish.trim().slice(0, 500) : null,
    });
  }
  return [...by.values()];
}

/** { first: 'late', fri: 'late', sat: 'junk', xyz: 'early' } → { first: 'late', fri: 'late' } (a JSON string is read too). */
export function cleanDayPrefs(v) {
  let o = v;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  return Object.fromEntries(Object.entries(o).filter(([k, x]) => (DAY_POS.includes(k) || WEEKDAYS.includes(k)) && DAYPREFS.includes(x)));
}

// ------------------------------------------------------------------ nights (ov41, Josh 25 Oct 21:12)

/** [3, 2, 2, 9, 'x'] → [2, 3]; [] stays [] (not fussed); anything else → null (not answered). 4 means "4+". */
export function cleanNights(v) {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 6).map((n) => Math.min(4, n)))].sort((a, b) => a - b);
}
/** "2", "4+" */
export const nightLabel = (n) => (Number(n) >= 4 ? '4+' : String(n));
/** [2, 3] → "2 or 3 nights"; [1] → "1 night"; [4] → "4+ nights". */
export function nightsWords(list = []) {
  const l = cleanNights(list) || [];
  if (!l.length) return '';
  const w = l.map(nightLabel);
  const words = w.length === 1 ? w[0] : `${w.slice(0, -1).join(', ')} or ${w[w.length - 1]}`;
  return `${words} night${l.length === 1 && l[0] === 1 ? '' : 's'}`;
}
/** Would a trip of `nights` suit someone who said `picks`? Not answered / not fussed → yes. 4 = "4 or more". */
export function nightsSuit(nights, picks) {
  const l = cleanNights(picks);
  if (!l || !l.length || nights == null) return true;
  const n = Number(nights);
  return l.includes(n) || (n >= 4 && l.includes(4));
}
/** "2 want 3 nights, 1 wants 4+ nights" from the picks of those it doesn't suit. */
export function nightsWant(picksList = []) {
  const c = new Map();
  for (const p of picksList) { const k = nightsWords(p); if (k) c.set(k, (c.get(k) || 0) + 1); }
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${n} want${n === 1 ? 's' : ''} ${k}`).join(', ');
}
/** The trip's length against what people said. → { ok, no, line: 'suits 7 of 9 · 2 want 3 nights', want: '2 want 3 nights' } */
export function nightsCheck(nights, { people = [], wishes = [] } = {}) {
  const w = byId(wishes);
  if (nights == null) return { ok: people.map((p) => p.id), no: [], line: null, want: '' };
  const no = people.filter((p) => !nightsSuit(nights, w[p.id]?.nights)).map((p) => ({ id: p.id, why: `wants ${nightsWords(w[p.id].nights)}` }));
  const want = nightsWant(no.map((n) => w[n.id].nights));
  if (!people.some((p) => (w[p.id]?.nights || []).length)) return { ok: people.map((p) => p.id), no: [], line: null, want: '' };
  return { ...finish(people, no, (ok) => `suits ${ok} of ${people.length}${want ? ` · ${want}` : ''}`), want };
}
/** "most say 2 nights" / "3 say 2 nights" (null when nobody said). */
export function nightsSummary(wishes = []) {
  const said = (wishes || []).map((w) => cleanNights(w?.nights)).filter((l) => l && l.length);
  if (!said.length) return null;
  const c = new Map();
  for (const l of said) for (const n of l) c.set(n, (c.get(n) || 0) + 1);
  const [top, k] = [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return `${k * 2 >= said.length ? 'most say' : `${k} say${k === 1 ? 's' : ''}`} ${nightsWords([top])}`;
}

/** The Friday of a weekend (how cant_dates are kept): Thu → the next day, Sat → the day before, Sun → two before. */
export function fridayOf(iso) {
  const d = dateOf(iso);
  if (!d) return null;
  const shift = { 4: 1, 5: 0, 6: -1, 0: -2, 1: -3 }[d.getDay()];
  if (shift == null) return isoOf(d);
  d.setDate(d.getDate() + shift);
  return isoOf(d);
}

/**
 * Who we're fitting: everyone who's in or maybe, else everyone with wishes, else the group.
 * → [{ id, name }]
 */
export function peopleFor({ rsvps = [], wishes = [], players = [], nameOf = (id) => id } = {}) {
  const going = rsvps.filter((r) => r.status === 'in' || r.status === 'maybe').map((r) => r.player_id);
  // v10.7: with no replies yet, everyone in the group counts (answered or not), so "8 of 11" isn't shown as "8 of 8";
  // anyone who answered but isn't on the list still counts.
  const group = players.filter((p) => p.approved !== false && p.role !== 'guest').map((p) => p.id);
  const ids = going.length ? going : group.length ? [...group, ...wishes.map((w) => w.player_id)] : wishes.map((w) => w.player_id);
  return [...new Set(ids)].map((id) => ({ id, name: nameOf(id) || 'Someone' }));
}

// ------------------------------------------------------------------ the checks (each → { ok: [ids], no: [{ id, why }], line })

/** Can they make the weekend? (cant_dates hold the Friday; an RSVP of "out" on this trip is a no too.) */
export function datesCheck(weekendStart, { people = [], wishes = [], rsvps = [] } = {}) {
  const fri = fridayOf(weekendStart);
  const w = byId(wishes);
  const no = [];
  for (const p of people) {
    if ((w[p.id]?.cant_dates || []).includes(fri)) no.push({ id: p.id, why: 'can’t do that weekend' });
    else if (rsvps.some((r) => r.player_id === p.id && r.status === 'out')) no.push({ id: p.id, why: 'said they’re out' });
  }
  return finish(people, no, (ok) => `fits ${ok} of ${people.length}`);
}
/** Is the drive within each person's longest drive? driveMin: one number, or { player_id: minutes } (from their start). */
export function driveCheck(driveMin, { people = [], wishes = [] } = {}) {
  const w = byId(wishes);
  const no = [];
  let said = 0;
  for (const p of people) {
    const max = w[p.id]?.max_drive_min;
    if (!max) continue;
    said += 1;
    const d = typeof driveMin === 'object' && driveMin ? driveMin[p.id] : driveMin;
    if (d != null && d > max) no.push({ id: p.id, why: `more than ${dur(max)} drive` });
  }
  if (!said || driveMin == null) return { ok: people.map((p) => p.id), no: [], line: null };
  const top = typeof driveMin === 'object' ? Math.max(...Object.values(driveMin).filter((x) => x != null)) : driveMin;
  return finish(people, no, (ok) => `within ${dur(roundDrive(top))} for ${ok}`);
}
/** Flying: on the table only if enough said fly or either. → { ok, no, line, allowed } */
export function flyCheck({ people = [], wishes = [] } = {}) {
  const w = byId(wishes);
  const said = people.filter((p) => w[p.id]?.travel);
  const keen = said.filter((p) => ['fly', 'either'].includes(w[p.id].travel));
  const no = said.filter((p) => w[p.id].travel === 'drive').map((p) => ({ id: p.id, why: 'would rather drive' }));
  const allowed = !said.length || keen.length / said.length >= FLY_SHARE;
  return { ...finish(people, no, () => `${keen.length} of ${said.length || people.length} happy to fly`), allowed };
}
/** 36 holes in a day: not for the "a round a day" people. rounds: rounds that day. */
export function golfCheck(rounds, { people = [], wishes = [] } = {}) {
  const w = byId(wishes);
  if ((Number(rounds) || 0) < 2) return { ok: people.map((p) => p.id), no: [], line: null };
  const no = people.filter((p) => w[p.id]?.golf_per_day === 'daily').map((p) => ({ id: p.id, why: 'a round a day' }));
  return finish(people, no, (ok) => `36 holes OK for ${ok}`);
}
/** The whole trip's golf: no spare day → not for "leave a spare day"; a day off → not for "as much as possible".
 *  golfDays: each day's rounds (0, 1, 2). */
export function scheduleCheck(golfDays = [], { people = [], wishes = [] } = {}) {
  const w = byId(wishes);
  const spare = golfDays.some((r) => !r);
  const double = golfDays.some((r) => Number(r) >= 2); // v10.7: a 36-hole day isn't "a round a day"
  const why = (g) => (g === 'max' ? 'wants as much golf as possible' : g === 'daily' ? 'wants a round a day, not 36' : 'wants a spare day');
  const no = people.filter((p) => (w[p.id]?.golf_per_day === 'spare_day' && !spare && golfDays.length > 1) || (w[p.id]?.golf_per_day === 'max' && spare)
      || (w[p.id]?.golf_per_day === 'daily' && double))
    .map((p) => ({ id: p.id, why: why(w[p.id].golf_per_day) }));
  const rounds = golfDays.reduce((a, r) => a + (Number(r) || 0), 0);
  return finish(people, no, (ok) => `${rounds} round${rounds === 1 ? '' : 's'} in ${golfDays.length} day${golfDays.length === 1 ? '' : 's'} — suits ${ok}`);
}

/** A tee time against people's day wishes. prefs: [{ who, pref, homeBy }] (daytiming.dayPrefs). */
export function teeCheck(tee, { people = [], prefs = [], finish: fin = null, driveHome = 0 } = {}) {
  const ids = new Set(people.map((p) => p.id));
  const mine = prefs.filter((p) => ids.has(p.who) && p.pref && p.pref !== 'any');
  const no = mine.filter((p) => !suits(p.pref, tee, { finish: fin, homeBy: p.homeBy, driveHome })).map((p) => ({ id: p.who, why: `wanted “${(PREF_LABEL[p.pref] || p.pref).toLowerCase()}${p.pref === 'home_by' && p.homeBy ? ` ${p.homeBy}` : ''}”` }));
  if (!mine.length) return { ok: people.map((p) => p.id), no: [], line: null };
  const happy = mine.filter((p) => !no.some((x) => x.id === p.who));
  const counts = {};
  for (const p of happy) counts[p.pref] = (counts[p.pref] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const line = top ? `tee ${hm(tee)} suits “${(PREF_LABEL[top[0]] || top[0]).toLowerCase()}”${top[1] > 1 ? ` (${top[1]})` : ''}` : `tee ${hm(tee)} suits none of the wishes`;
  return { ok: people.map((p) => p.id).filter((id) => !no.some((x) => x.id === id)), no, line };
}
/** Daylight: "2 h before dusk" / "tight" / "after dusk". margin: minutes from the finish to sunset. */
export function duskCheck(margin) {
  if (margin == null) return { ok: [], no: [], line: null };
  if (margin < 0) return { ok: [], no: [], line: `about ${dur(r5(-margin))} after dusk ✗` };
  if (margin < 30) return { ok: [], no: [], line: 'tight before dusk' };
  return { ok: [], no: [], line: `${dur(r5(margin))} before dusk` };
}
/** A rough cost per head against spend bands (only when a cost is known). */
export function costCheck(perHead, { people = [], wishes = [] } = {}) {
  if (perHead == null || !Number.isFinite(Number(perHead))) return { ok: people.map((p) => p.id), no: [], line: null };
  const w = byId(wishes);
  const no = people.filter((p) => w[p.id]?.spend_band && Number(perHead) > SPEND_MAX[w[p.id].spend_band])
    .map((p) => ({ id: p.id, why: `budget ${SPEND_LABEL[w[p.id].spend_band]}` }));
  return finish(people, no, (ok) => `about $${Math.round(Number(perHead))} a head — in budget for ${ok}`);
}

// ------------------------------------------------------------------ putting it together

/**
 * The fit of one option. Any of: weekend (ISO start), drive (minutes or per-person), fly (true), rounds (that day),
 * tee + finish (minutes), duskMargin, perHead (dollars). ctx: { people, wishes, rsvps, prefs, nameOf }.
 * → { line: 'fits 9 of 11 · within 3 h for 10 · tee 12:30pm suits “play midday” · 2 h before dusk',
 *     notFor: [{ id, name, why: ['can’t do that weekend', …] }], fits: n, of: N }
 */
export function fitOption(opt = {}, ctx = {}) {
  const people = ctx.people || [];
  const parts = [];
  if (opt.weekend) parts.push(datesCheck(opt.weekend, ctx));
  if (opt.fly) { const f = flyCheck(ctx); parts.push(f.allowed ? f : { ...f, line: `${f.line} — not enough for flying` }); } else if (opt.drive != null) parts.push(driveCheck(opt.drive, ctx));
  if (opt.nights != null) { const n = nightsCheck(opt.nights, ctx); parts.push({ ...n, line: n.want || null }); }
  if (opt.rounds != null) parts.push(golfCheck(opt.rounds, ctx));
  if (opt.tee != null) parts.push(teeCheck(opt.tee, { ...ctx, finish: opt.finish ?? null, driveHome: opt.driveHome || 0 }));
  if (opt.duskMargin !== undefined) parts.push(duskCheck(opt.duskMargin));
  if (opt.perHead != null) parts.push(costCheck(opt.perHead, ctx));
  const why = new Map();
  for (const p of parts) for (const n of p.no || []) why.set(n.id, [...(why.get(n.id) || []), n.why]);
  const nameOf = ctx.nameOf || ((id) => people.find((p) => p.id === id)?.name || 'Someone');
  const notFor = [...why.entries()].map(([id, w]) => ({ id, name: nameOf(id), why: w }));
  const fits = people.filter((p) => !why.has(p.id)).length;
  const lines = parts.map((p) => p.line).filter(Boolean);
  if (!opt.weekend && people.length && notFor.length) lines.unshift(`suits ${fits} of ${people.length}`);
  return { line: lines.join(' · '), notFor, fits, of: people.length };
}
/** "Not for: Al (can’t do that weekend), Bo (wanted “morning free”)" */
export function notForLine(notFor = [], max = 4) {
  if (!notFor.length) return '';
  const shown = notFor.slice(0, max).map((n) => `${n.name} (${n.why.join(', ')})`);
  return `Not for: ${shown.join(', ')}${notFor.length > max ? ` and ${notFor.length - max} more` : ''}`;
}
/** Rank options by how many it fits (then by the order given). Never hides the line. */
export function rankByFit(options = []) {
  return options.map((o, i) => ({ ...o, i })).sort((a, b) => (b.fit?.fits ?? 0) - (a.fit?.fits ?? 0) || a.i - b.i).map(({ i, ...o }) => o);
}

/** What the group said, in one short paragraph for the organiser (the COLLECT summary). */
export function wishesSummary(wishes = [], people = []) {
  if (!wishes.length) return 'Nobody’s said what they’d like yet.';
  const n = (f) => wishes.filter(f).length;
  const bits = [
    `${wishes.length} of ${people.length || wishes.length} have said what they’d like`,
    n((w) => w.travel === 'fly' || w.travel === 'either') ? `${n((w) => w.travel === 'fly' || w.travel === 'either')} happy to fly` : null,
    n((w) => w.max_drive_min) ? `longest drive mostly about ${dur(roundDrive(median(wishes.map((w) => w.max_drive_min).filter(Boolean))))}` : null,
    n((w) => w.golf_per_day === 'max') ? `${n((w) => w.golf_per_day === 'max')} want as much golf as possible` : null,
    n((w) => w.golf_per_day === 'daily') ? `${n((w) => w.golf_per_day === 'daily')} want a round a day` : null,
    n((w) => w.golf_per_day === 'spare_day') ? `${n((w) => w.golf_per_day === 'spare_day')} want a spare day` : null,
    nightsSummary(wishes),
    ...[...DAY_POS, 'thu', 'fri', 'sat', 'sun', 'mon'].map((d) => dayWishLine(d, wishes)),
    n((w) => w.home_by) ? `${n((w) => w.home_by)} want to be home by about ${hm(Math.min(...wishes.filter((w) => w.home_by).map((w) => toMinutes(w.home_by))))} on the last day` : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

const DAY_NAME = { ...DAY_POS_NAME, thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday', mon: 'Monday' };
const PREF_WORDS = { early: 'early', midday: 'midday', late: 'later', morning_free: 'with the morning free' };
/** "First day: 3 later, 1 early" — what people said for that day (old rows: that weekday). */
function dayWishLine(d, wishes) {
  const c = {};
  for (const w of wishes) { const p = w.day_prefs?.[d]; if (p && p !== 'any') c[p] = (c[p] || 0) + 1; }
  const e = Object.entries(c).sort((a, b) => b[1] - a[1]);
  return e.length ? `${DAY_NAME[d]}: ${e.map(([p, k]) => `${k} ${PREF_WORDS[p]}`).join(', ')}` : null;
}
const toMinutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const byId = (wishes) => Object.fromEntries((wishes || []).map((w) => [w.player_id, w]));
function finish(people, no, line) {
  const bad = new Set(no.map((n) => n.id));
  const ok = people.map((p) => p.id).filter((id) => !bad.has(id));
  return { ok, no, line: line(ok.length) };
}
const roundDrive = (m) => (m >= 90 ? Math.round(m / 30) * 30 : Math.round(m / 5) * 5);
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
}
