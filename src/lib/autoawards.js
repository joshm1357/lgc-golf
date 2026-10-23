// Automatic awards and fines (migration 100, feature 'dinner_awards') — pure functions only.
//
// Plain words:
//   - An award or fine runs once a trip (as before), each day, or each night. One with a time proof and "latest /
//     earliest wins" runs each night unless the group says otherwise ("Latest out"). A night's claim window is
//     9pm–6am Sydney, a day's 6am–9pm (both changeable).
//   - A photo posted to the Feed in a claim window can be claimed in one tap: "Claim Latest out?" — for yourself or a
//     mate. The claim's time is the post's server time (posts.server_at).
//   - At 7am (or an hour before that day's first tee, if earlier) the server ranks the night's claims and posts the
//     proposed winner once. An organiser confirms (or picks another claim, or "No winner"); otherwise it confirms
//     itself at the first tee (noon with no round that day) unless someone disputes it — then the Tribunal decides.
//   - An award can instead be worked out from the scores (a side-comp library 'auto' key), proposed when the round is
//     finished.
//   - Points towards a cup: winner (fixed), per unit (e.g. 1 pt an hour after midnight, to 5am), or placings (3-2-1).
//     Fines take points off. They count once confirmed.
// The database (100) does the same sums (private.aa_line_points, aa_points_words, aa_times …); unit tests check the
// same examples as supabase/tests/100_auto_awards.sql.
import { rewardWords, timeWords } from './awardsfines.js';

export const RUNS = [
  { key: 'trip', label: 'Once a trip', short: 'Once' },
  { key: 'night', label: 'Each night', short: 'Nightly' },
  { key: 'day', label: 'Each day', short: 'Daily' },
];
export const POINT_MODES = [
  { key: 'none', label: 'No points' },
  { key: 'winner', label: 'Points to the winner' },
  { key: 'per_unit', label: 'Points per unit' },
  { key: 'placings', label: 'Placings (e.g. 3-2-1)' },
];
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const n = (v) => (v == null || v === '' ? null : Number(v));
const trim = (v) => {
  const x = Math.round(Number(v) * 100) / 100;
  return Number.isInteger(x) ? String(x) : String(x);
};
const plural = (v, w) => `${trim(v)} ${w}${Number(v) === 1 ? '' : 's'}`;

// ------------------------------------------------------------------ Sydney time
/** Minutes Sydney is ahead of UTC at an instant (600 or 660). */
export function sydneyOffset(at) {
  const d = new Date(at);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const v = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
  return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}
/** The Sydney date ("YYYY-MM-DD") of an instant. */
export function sydneyDate(at) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(at));
}
/** "YYYY-MM-DD" + days. */
export function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
/** A Sydney date + "HH:MM" → the moment (a Date). Same as private.aa_at. */
export function atSydney(ymd, hhmm) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const local = Date.UTC(y, m - 1, d, h, mi);
  let guess = local - 600 * 60000;
  guess = local - sydneyOffset(guess) * 60000;
  return new Date(local - sydneyOffset(guess) * 60000);
}
/** "2:47am", "8am" in Sydney (as private.aa_clock). */
export function clockAt(at) {
  return at ? timeWords(at).replace(':00', '') : '';
}
const mins = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** A window for a date: night = from that evening to the next morning when "to" is at or before "from". */
export function claimWindow(from, to, ymd) {
  return { opens: atSydney(ymd, from), closes: atSydney(mins(to) <= mins(from) ? addDays(ymd, 1) : ymd, to) };
}
/** Which window (by its date) a moment falls in, or null. Yesterday's first (a night runs past midnight). */
export function windowDateFor(from, to, at) {
  const t = new Date(at).getTime();
  const today = sydneyDate(at);
  for (const ymd of [addDays(today, -1), today]) {
    const w = claimWindow(from, to, ymd);
    if (t >= w.opens.getTime() && t < w.closes.getTime()) return ymd;
  }
  return null;
}
/** Is a date one of the trip's nights / days? A trip without dates: any. Same as private.aa_trip_has. */
export function tripHas(trip, kind, ymd) {
  if (!trip) return false;
  if (!trip.start_date) return true;
  const end = trip.end_date || trip.start_date;
  if (kind === 'night') {
    const last = addDays(end, -1) < trip.start_date ? trip.start_date : addDays(end, -1);
    return ymd >= trip.start_date && ymd <= last;
  }
  return ymd >= trip.start_date && ymd <= end;
}
/**
 * When a window's proposal goes up and when it confirms itself (the morning after the window's date): propose at
 * proposeTime (7am) or an hour before that morning's first tee if earlier (never before the window closes); confirm
 * at the first tee, or noon with no round. firstTee: "HH:MM" on the morning after, or null. Same as private.aa_times.
 */
export function proposeTimes({ windowDate, proposeTime = '07:00', firstTee = null, closes = null }) {
  const m = addDays(windowDate, 1);
  let propose = atSydney(m, proposeTime || '07:00').getTime();
  if (firstTee) propose = Math.min(propose, atSydney(m, firstTee).getTime() - 3600000);
  if (closes) propose = Math.max(propose, new Date(closes).getTime());
  let confirm = firstTee ? atSydney(m, firstTee).getTime() : atSydney(m, '12:00').getTime();
  confirm = Math.max(confirm, propose + 15 * 60000);
  return { propose_at: new Date(propose), confirm_by: new Date(confirm) };
}

// ------------------------------------------------------------------ an award's automatic terms
/**
 * The automatic terms of a trip's award (its Rulebook rule's when it has one). Same as private.auto_terms:
 * runs is 'round' for from-the-scores; else as set; else 'night' for a time proof decided by latest / earliest;
 * else 'trip'.
 */
export function autoTerms(award = {}, rule = null) {
  const s = rule || award || {};
  const proof = s.proof || 'none';
  const best = s.best || null;
  const from_scores = s.from_scores || null;
  const runs = from_scores ? 'round'
    : s.runs || (['latest', 'earliest'].includes(best) && ['time', 'photo_time'].includes(proof) ? 'night' : 'trip');
  return {
    kind: award.kind || rule?.award_kind || 'award', title: award.title || rule?.title || '',
    reward_type: s.reward_type || null, reward_amount: s.reward_amount ?? null, reward_note: s.reward_note || null,
    proof, best, number_unit: s.number_unit || null, rule_id: rule?.id || award.rule_id || null,
    runs, from_scores,
    window_from: s.window_from || (runs === 'day' ? '06:00' : '21:00'),
    window_to: s.window_to || (runs === 'day' ? '21:00' : '06:00'),
    propose_time: s.propose_time || '07:00',
    points: s.points || null,
    comp_id: award.comp_id || rule?.comp_id || null,
  };
}
/** "Each night, 9pm–6am · proposed 7am" etc. '' for once a trip. */
export function runsWords(t) {
  if (!t) return '';
  if (t.runs === 'round') return 'From the scores · proposed when the round’s finished';
  if (t.runs !== 'night' && t.runs !== 'day') return '';
  return `${t.runs === 'night' ? 'Each night' : 'Each day'}, ${clock(t.window_from)}–${clock(t.window_to)} · proposed ${clock(t.propose_time)}`;
}
/** "21:00" → "9pm", "07:30" → "7:30am". */
export function clock(hhmm) {
  if (!hhmm || !HHMM.test(hhmm)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

// ------------------------------------------------------------------ points
/** Check a points setting: '' = fine, else a plain reason. Same as private.aa_points_check. */
export function checkPoints(p, best, fromScores) {
  if (!p) return '';
  const m = p.mode;
  if (m === 'winner') {
    const v = n(p.points);
    return v == null || !(v > 0) || v > 100 ? 'Points to the winner: a number from 0.5 to 100' : '';
  }
  if (m === 'placings') {
    if (!Array.isArray(p.places) || p.places.length < 1 || p.places.length > 10) return 'Placings: 1 to 10 places';
    return p.places.some((x) => typeof x !== 'number' || x < 0 || x > 100) ? 'Placings: each from 0 to 100 points' : '';
  }
  if (m === 'per_unit') {
    if (fromScores) return 'Per-unit points are for claims, not scores';
    if (!best) return 'Per-unit points need “latest / earliest” or “biggest / smallest” wins';
    const per = p.per == null ? 1 : n(p.per);
    if (per == null || !(per > 0) || per > 100) return 'Points per unit: from 0.1 to 100';
    const size = p.size == null ? 1 : n(p.size);
    if (size == null || !(size > 0) || size > 1000) return 'Unit size: more than 0';
    if (best === 'latest' || best === 'earliest') {
      if (!HHMM.test(p.from || '')) return 'Say when the points start (a time)';
      if (p.to != null && p.to !== '' && !HHMM.test(p.to)) return 'The cut-off is a time';
    } else {
      if (n(p.from) == null || Number.isNaN(n(p.from))) return 'Say where the points start (a number)';
      if (p.to != null && p.to !== '' && Number.isNaN(n(p.to))) return 'The cut-off is a number';
    }
    if (!['whole', 'part', undefined, null].includes(p.round)) return 'Whole or part units';
    if (p.max != null && p.max !== '' && !(n(p.max) > 0 && n(p.max) <= 1000)) return 'The most points: more than 0';
    return '';
  }
  return 'Points: winner, per unit or placings';
}

/** A time threshold for a window: a time earlier than the window's start is the next morning (night windows). */
function unitAt(hhmm, wfrom, runs, ymd) {
  return atSydney(runs === 'night' && mins(hhmm) < mins(wfrom) ? addDays(ymd, 1) : ymd, hhmm);
}

/**
 * One claim's points (unsigned; a fine's are taken off by the caller). Same as private.aa_line_points.
 *   winner: the winner's points. placings: by rank. per_unit: units beyond "from", not past "to", whole (rounded
 *   down) or part (2 decimals), × per, at most max.
 */
export function linePoints(p, { best = null, runs = 'night', windowFrom = '21:00', windowDate = null, at = null, number = null, rank = null, winner = false } = {}) {
  if (!p) return 0;
  if (p.mode === 'winner') return winner ? Number(p.points) : 0;
  if (p.mode === 'placings') return rank >= 1 && rank <= p.places.length ? Number(p.places[rank - 1]) : 0;
  if (p.mode !== 'per_unit') return 0;
  let v;
  if (best === 'latest' || best === 'earliest') {
    if (!at || !windowDate) return 0;
    const t = new Date(at).getTime();
    const base = unitAt(p.from, windowFrom, runs, windowDate).getTime();
    const lim = p.to ? unitAt(p.to, windowFrom, runs, windowDate).getTime() : null;
    v = (best === 'latest' ? (lim == null ? t : Math.min(t, lim)) - base : base - (lim == null ? t : Math.max(t, lim))) / 3600000;
  } else {
    if (number == null) return 0;
    const to = p.to == null || p.to === '' ? null : Number(p.to);
    v = best === 'highest' ? (to == null ? number : Math.min(number, to)) - Number(p.from) : Number(p.from) - (to == null ? number : Math.max(number, to));
  }
  let units = v / (p.size == null ? 1 : Number(p.size));
  if (units <= 0) return 0;
  units = p.round === 'part' ? Math.round(units * 100) / 100 : Math.floor(units + 1e-9);
  let pts = Math.round(units * (p.per == null ? 1 : Number(p.per)) * 100) / 100;
  if (p.max != null && p.max !== '') pts = Math.min(pts, Number(p.max));
  return pts;
}

/** "1 pt an hour after 12am, to 5am" — the points setting in words. Same as private.aa_points_words. */
export function pointsWords(p, kind = 'award', best = null, unit = null) {
  if (!p) return '';
  const sign = kind === 'fine' ? '−' : '';
  if (p.mode === 'winner') return `${sign}${trim(p.points)} pt${Number(p.points) === 1 ? '' : 's'} ${kind === 'fine' ? 'to whoever cops it' : 'to the winner'}`;
  if (p.mode === 'placings') return `${sign}${p.places.map(trim).join('-')} pts`;
  if (p.mode !== 'per_unit') return '';
  const per = p.per == null ? 1 : Number(p.per);
  const size = p.size == null ? 1 : Number(p.size);
  let w = `${sign}${trim(per)} pt${per === 1 ? '' : 's'}`;
  if (best === 'latest' || best === 'earliest') {
    w += size === 1 ? ' an hour' : ` per ${trim(size)} hours`;
    w += `${best === 'latest' ? ' after ' : ' before '}${clock(p.from)}`;
    if (p.to) w += `${best === 'latest' ? ', to ' : ', from '}${clock(p.to)}`;
  } else {
    w += ` per ${size === 1 ? '' : `${trim(size)} `}${String(unit || '').trim() || 'unit'}${best === 'highest' ? ' over ' : ' under '}${trim(p.from)}`;
    if (p.to != null && p.to !== '') w += `${best === 'highest' ? ', up to ' : ', down to '}${trim(p.to)}`;
  }
  if (p.round === 'part') w += ` (part ${best === 'latest' || best === 'earliest' ? 'hours' : 'units'} count)`;
  if (p.max != null && p.max !== '') w += `, at most ${trim(p.max)}`;
  return w;
}

/**
 * Rank a window's claims: best first, ties share a rank; with no "best", the first claim first. Each line gets its
 * points (signed: a fine's are negative). Same as private.aa_rank.
 *   noms: the window's nominations; terms: autoTerms(); run: { kind, window_date, player_id? } (player_id: the
 *   proposed / chosen winner — defaults to the top claim).
 */
export function rankRun(noms = [], terms = {}, run = {}) {
  const best = terms.best;
  const key = (x) => {
    if (best === 'latest') return x.claim_at ? -Date.parse(x.claim_at) : Infinity;
    if (best === 'earliest') return x.claim_at ? Date.parse(x.claim_at) : Infinity;
    if (best === 'highest') return x.claim_number == null ? Infinity : -Number(x.claim_number);
    if (best === 'lowest') return x.claim_number == null ? Infinity : Number(x.claim_number);
    return Date.parse(x.created_at || 0);
  };
  const sorted = [...noms].sort((a, b) => key(a) - key(b) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  let rank = 0;
  let prev;
  const sign = terms.kind === 'fine' ? -1 : 1;
  const win = run.player_id || sorted[0]?.player_id || null;
  return sorted.map((x, i) => {
    const k = key(x);
    if (i === 0 || k !== prev) rank = i + 1;
    prev = k;
    const pts = sign * linePoints(terms.points, { best, runs: run.kind || terms.runs, windowFrom: terms.window_from, windowDate: run.window_date, at: x.claim_at, number: x.claim_number == null ? null : Number(x.claim_number), rank, winner: x.player_id === win });
    return { player_id: x.player_id, nomination_id: x.id, at: x.claim_at || null, number: x.claim_number ?? null, rank, points: pts || 0, photo: !!(x.photo_url || x.post_id), display: claimDisplay(x, terms) };
  });
}
function claimDisplay(x, terms) {
  return [x.claim_at ? clockAt(x.claim_at) : '', x.claim_number != null ? `${trim(x.claim_number)}${terms.number_unit ? ` ${terms.number_unit}` : ''}` : ''].filter(Boolean).join(', ');
}

/**
 * The proposal post's words. Same as private.aa_proposal_text.
 *   "🌙 Proposed — Latest out, last night: Hamish 2:47am 📷 (+2), Bo 1:15am 📷 (+1) · −1 stroke. Confirm or dispute by the first tee (8am)."
 * lines: rankRun() / the run's results; nameOf(id); byTee: true when the deadline is the first tee; confirmBy: Date.
 */
export function proposalText({ terms, run, lines = [], nameOf = (id) => id, worth = '', byTee = false, confirmBy = null, roundName = 'the round' }) {
  const per = ['per_unit', 'placings'].includes(terms?.points?.mode);
  const when = run.kind === 'night' ? 'last night' : run.kind === 'day' ? 'yesterday' : roundName;
  const shown = lines.filter((l, i) => i === 0 || (per && l.points && i < 8));
  const words = shown.map((l) => `${nameOf(l.player_id)}${l.display ? ` ${l.display}` : ''}${l.photo ? ' 📷' : ''}${l.points ? ` (${l.points > 0 ? '+' : '−'}${trim(Math.abs(l.points))})` : ''}`).join(', ');
  const by = confirmBy ? (byTee ? `the first tee (${clockAt(confirmBy)})` : clockAt(confirmBy)) : 'the first tee';
  const icon = run.kind === 'night' ? '🌙 ' : terms.kind === 'fine' ? '🍺 ' : '🏅 ';
  return `${icon}Proposed — ${terms.title}, ${when}: ${words}${worth ? ` · ${worth}` : ''}. Confirm or dispute by ${by}.`.slice(0, 600);
}

// ------------------------------------------------------------------ claiming from a post
/**
 * Which automatic awards a Feed post can be claimed for, now. post: { trip_id, photo_url, server_at | created_at };
 * items: [{ key, terms, award, rule }] (the trip's awards with autoTerms); runs: award_runs rows; trip.
 * Returns [{ item, windowDate }] — only night / day awards whose window the post falls in, on the trip, not
 * proposed yet, and whose proof the post gives (a photo when needed; numbers can't come from a post).
 */
export function claimableFor(post, items = [], runs = [], trip = null) {
  if (!post || !trip) return [];
  if (post.trip_id && post.trip_id !== trip.id) return [];
  const at = post.server_at || post.created_at;
  if (!at) return [];
  const out = [];
  for (const it of items) {
    const t = it.terms;
    if (t.runs !== 'night' && t.runs !== 'day') continue;
    if (['number', 'photo_number'].includes(t.proof)) continue;
    if (t.proof.startsWith('photo') && !post.photo_url) continue;
    const ymd = windowDateFor(t.window_from, t.window_to, at);
    if (!ymd || !tripHas(trip, t.runs, ymd)) continue;
    const sourceId = it.award?.id || null;
    const run = runs.find((r) => sourceId && r.source_id === sourceId && r.kind === t.runs && r.window_date === ymd && !r.round_id);
    if (run && run.status !== 'open') continue;
    out.push({ item: it, windowDate: ymd });
  }
  return out;
}

// ------------------------------------------------------------------ status words
export const RUN_STATUS = {
  open: 'Claims open',
  proposed: 'Proposed — confirm or dispute',
  disputed: 'Disputed — the Tribunal decides',
  overturned: 'Dispute upheld — the organiser picks again',
  confirmed: 'Confirmed',
  no_winner: 'No winner',
  empty: 'No claims',
};
/** "Latest out · Mon night" / "Most birdies · Day 2". */
export function runLabel(run, title, roundName = 'the round') {
  if (run.kind === 'round') return `${title} · ${roundName}`;
  const d = new Date(`${run.window_date}T12:00:00Z`);
  const dy = d.toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'UTC' });
  return `${title} · ${run.kind === 'night' ? `${dy} night` : `${dy} ${d.getUTCDate()}`}`;
}

// ------------------------------------------------------------------ the results page
/**
 * The trip's automatic awards and fines, for the results page and the presentation: one line per decided run.
 * runs: award_runs rows; titles: { [source_id]: title }; kinds: { [source_id]: 'award' | 'fine' }.
 * Returns [{ id, title, kind, player_id, worth, reward_type, strokes, decided }] — confirmed runs only, oldest first.
 */
export function resultLines(runs = [], { titles = {}, kinds = {}, roundNames = {} } = {}) {
  return (runs || [])
    .filter((r) => r.status === 'confirmed' && r.player_id)
    .sort((a, b) => String(a.window_date).localeCompare(String(b.window_date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .map((r) => ({
      id: r.id, title: runLabel(r, titles[r.source_id] || 'Award', roundNames[r.round_id] || 'the round'), kind: kinds[r.source_id] || 'award',
      player_id: r.player_id, worth: r.worth || rewardWords(r.reward_type, r.reward_amount, null), reward_type: r.reward_type || null,
      strokes: r.reward_type === 'strokes' ? Number(r.reward_amount) || 0 : 0, decided: r.decided_how || null,
    }));
}
/**
 * Points that count (confirmed, not struck out), per player: [{ player_id, points, lines }], most first.
 * rows: cup_points; compId: only that cup (undefined = all).
 */
export function pointsTally(rows = [], compId) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r.confirmed_at || r.waived_at) continue;
    if (compId !== undefined && r.comp_id !== compId) continue;
    const cur = by.get(r.player_id) || { player_id: r.player_id, points: 0, lines: [] };
    cur.points = Math.round((cur.points + Number(r.points)) * 100) / 100;
    cur.lines.push(r);
    by.set(r.player_id, cur);
  }
  return [...by.values()].sort((a, b) => b.points - a.points);
}
/** "+2" / "−1" / "+2.78". */
export function signedPoints(v) {
  const x = Number(v) || 0;
  return `${x < 0 ? '−' : '+'}${trim(Math.abs(x))}`;
}
export { plural };
