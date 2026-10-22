// Tee times over the whole window (22 Oct, Josh): "update the availability for the trip over the full weekend, as the
// day shouldn't be confirmed yet early, so then the best times can be selected per day — and also the general times
// during the week for social golf. Prompt them so we get the full info, not just that one day."
// One trip_tee_options row = one course on one date: available yes / no / unknown, time ranges ("07:30-09:00"), slots
// (times), how many players they can hold, price each, a note. Pure functions, tested (teegrid.test.js).
import { bestBlock } from './tripbuilder.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const dateOf = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const dayShort = (iso) => { const d = dateOf(iso); return d ? `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` : ''; };

/** Every day of every weekend still in play (start to end), in order, no repeats. */
export function windowDates(weekends = []) {
  const out = new Set();
  for (const w of weekends || []) {
    const a = dateOf(w.start); const b = dateOf(w.end || w.start);
    if (!a || !b) continue;
    for (let d = new Date(a), i = 0; d <= b && i < 10; d.setDate(d.getDate() + 1), i++) out.add(isoOf(d));
  }
  return [...out].sort();
}

/** "7:30-9, 1pm–2:30pm" → ['07:30-09:00', '13:00-14:30'] (ranges that make sense only). */
export function parseRanges(text) {
  const out = [];
  const toMin = (s) => {
    const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(String(s).trim());
    if (!m) return null;
    let h = Number(m[1]); const mm = Number(m[2] || 0);
    if (m[3]) { const pm = /pm/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return h < 24 && mm < 60 ? h * 60 + mm : null;
  };
  for (const part of String(text || '').split(/[,;\n]+/)) {
    const m = /^\s*([0-9:.]+\s*(?:am|pm)?)\s*(?:-|–|to)\s*([0-9:.]+\s*(?:am|pm)?)\s*$/i.exec(part);
    if (!m) continue;
    const a = toMin(m[1]); let b = toMin(m[2]);
    if (a == null || b == null) continue;
    if (b <= a && b < 12 * 60) b += 12 * 60; // "1-3" after lunch
    if (b <= a || b >= 24 * 60) continue;
    const r = `${hm(a)}-${hm(b)}`;
    if (!out.includes(r)) out.push(r);
  }
  return out.slice(0, 8);
}

/** The tee times a row offers: its slots plus its ranges every `gap` minutes. None if they said no. */
export function slotsFor(row, gap = 10) {
  if (!row || row.available === 'no') return [];
  const set = new Set(row.times || []);
  for (const r of row.ranges || []) {
    const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(r);
    if (!m) continue;
    for (let t = Number(m[1]) * 60 + Number(m[2]), end = Number(m[3]) * 60 + Number(m[4]); t <= end; t += gap) set.add(hm(t));
  }
  return [...set].sort();
}

/** Has this day got an answer? (unknown counts — but it's worth asking again.) */
export const answered = (row) => !!row && (['yes', 'no', 'unknown'].includes(row.available) || (row.times || []).length > 0 || (row.ranges || []).length > 0);

/**
 * How complete one course's call is: { filled, total, missing: [dates], unknown: [dates], social, line }.
 * rows: that course's trip_tee_options; dates: the window; social: its usual social times row (or null).
 */
export function callProgress(rows = [], dates = [], social = null) {
  const at = new Map((rows || []).map((r) => [String(r.play_date).slice(0, 10), r]));
  const missing = dates.filter((d) => !answered(at.get(d)));
  const unknown = dates.filter((d) => at.get(d)?.available === 'unknown');
  const hasSocial = !!(social && (social.weekdays || social.weekends || social.price || social.group_size));
  const filled = dates.length - missing.length;
  return { filled, total: dates.length, missing, unknown, social: hasSocial, line: `${filled} of ${dates.length} day${dates.length === 1 ? '' : 's'} filled${hasSocial ? ' · social times in' : ''}` };
}

/** Can the call job be ticked off? Every day needs an answer. → { ok, message, nudge } */
export function canFinishCall(progress) {
  if (!progress) return { ok: false, message: 'Nothing in yet.', nudge: '' };
  if (progress.missing.length) return { ok: false, message: `Still to ask about: ${progress.missing.map(dayShort).join(', ')}.`, nudge: '' };
  const nudge = [progress.unknown.length ? `They weren’t sure about ${progress.unknown.map(dayShort).join(', ')} — ask again closer to the day?` : '', !progress.social ? 'Add their usual social golf times too, so it’s there next trip.' : ''].filter(Boolean).join(' ');
  return { ok: true, message: '', nudge };
}

/** The caller's checklist: what to ask about. */
export function callChecklist(dates = [], { need = 1 } = {}) {
  const days = [...new Set(dates.map((d) => DOW[dateOf(d).getDay()]))];
  return [
    `Every day: ${days.join(', ')}${dates.length > days.length ? ' — each weekend' : ''}`,
    `${need} tee time${need === 1 ? '' : 's'} in a row (${need * 4} players) — what times?`,
    'Their usual social golf times (weekdays and weekends)',
    'Biggest group they take',
    'Price each (and any deal for a group)',
  ];
}

/** A short script to read on the phone. */
export function callScript({ course = 'the course', group = 'our golf group', need = 1, dates = [] } = {}) {
  const when = dates.length ? dates.map(dayShort).join(', ') : 'a weekend coming up';
  return `Hi, I’m ringing for ${group}. We’re planning a golf weekend and looking at ${course}. We’d need ${need} tee time${need === 1 ? '' : 's'} in a row — ${need * 4} players. Could you tell me what you’d have on ${when}? Nothing to book yet — we’re working out which days suit. And what are your usual social times during the week and on weekends, the biggest group you take, and the price each?`;
}

/**
 * The best times each day across every course called: per date, the courses with `needed` tee times in a row, best
 * first (earliest sensible block, then cheaper). → [{ date, label, best: [{ course_id, name, block, price, capacity }] }]
 */
export function bestPerDay(rows = [], { needed = 1, dates = [], courses = {}, earliest = 7 * 60 } = {}) {
  const ds = dates.length ? dates : [...new Set(rows.map((r) => String(r.play_date).slice(0, 10)))].sort();
  return ds.map((date) => {
    const best = rows.filter((r) => String(r.play_date).slice(0, 10) === date).map((r) => {
      const block = bestBlock(slotsFor(r), needed, { earliest });
      return block ? { course_id: r.course_id, name: courses[r.course_id]?.name || 'Course', block, price: r.price != null ? Number(r.price) : null, capacity: r.capacity ?? null } : null;
    }).filter(Boolean).filter((b) => b.capacity == null || b.capacity >= needed * 4 - 3)
      .sort((a, b) => a.block.from - b.block.from || (a.price ?? 9999) - (b.price ?? 9999));
    return { date, label: dayShort(date), best };
  });
}

/** "Weekdays after 11 · Sat after 2 · $65 · groups of 4" */
export function socialLine(s) {
  if (!s) return '';
  return [s.weekdays && `Weekdays ${s.weekdays}`, s.weekends && `Weekends ${s.weekends}`, s.price, s.group_size, s.notes].filter(Boolean).join(' · ');
}
