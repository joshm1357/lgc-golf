// The season ladder (order of merit across trips): pure maths, no screen code.
// A season is a calendar year (the default) or a custom date range. Each individual round hands out points for
// finishing places (default 10-8-6-5-4-3-2-1); players tied on a place share the points for the places they cover;
// each trophy won in the season adds a bonus. The rounds' results come from stats.js (seasonInputs).
import { rankRows } from './scoring.js';

export const DEFAULT_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
export const DEFAULT_BONUS = 5;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** "1 Mar 2026" from "2026-03-01". */
export function shortDate(iso) {
  if (!isIso(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The settings with defaults filled in (no stored row = the defaults). */
export function ladderSettings(row) {
  const pts = Array.isArray(row?.points) && row.points.length ? row.points.map((p) => Math.max(0, Math.round(Number(p) || 0))) : DEFAULT_POINTS;
  const range = row?.mode === 'range' && isIso(row.start_date) && isIso(row.end_date) && row.end_date >= row.start_date;
  return {
    name: row?.name || null,
    mode: range ? 'range' : 'year',
    start_date: range ? row.start_date : null,
    end_date: range ? row.end_date : null,
    points: pts,
    trophy_bonus: row?.trophy_bonus != null ? Math.max(0, Math.round(Number(row.trophy_bonus) || 0)) : DEFAULT_BONUS,
  };
}

/**
 * The season's dates. A custom range when the group set one (and no year was picked to look back at), otherwise the
 * calendar year `year` (default: this year).
 */
export function seasonRange(settings, year, today = new Date()) {
  const s = ladderSettings(settings);
  if (s.mode === 'range' && year == null) {
    return { start: s.start_date, end: s.end_date, label: `${shortDate(s.start_date)} – ${shortDate(s.end_date)}`, custom: true };
  }
  const y = Number(year) || today.getFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y), custom: false, year: y };
}

export const inRange = (date, range) => isIso(date) && date >= range.start && date <= range.end;

/** The years that have something in them (newest first), always including this year. */
export function seasonYears(dates, today = new Date()) {
  const ys = new Set([today.getFullYear()]);
  for (const d of dates) if (isIso(d)) ys.add(Number(d.slice(0, 4)));
  return [...ys].sort((a, b) => b - a);
}

/** Points for finishing `place`, shared between `tied` players: the average of the places they cover. */
export function placePoints(points, place, tied = 1) {
  let sum = 0;
  for (let i = 0; i < tied; i++) sum += points[place - 1 + i] ?? 0;
  return Math.round((sum / tied) * 100) / 100;
}

/**
 * Points for one round. rows: [{ id, rank }] — ranks from the round's own result (ties share a rank).
 * Returns { [id]: { place, tied, points } }.
 */
export function roundPoints(rows, points) {
  const byRank = {};
  for (const r of rows) (byRank[r.rank] ||= []).push(r.id);
  const out = {};
  for (const [rank, ids] of Object.entries(byRank)) {
    const pts = placePoints(points, Number(rank), ids.length);
    for (const id of ids) out[id] = { place: Number(rank), tied: ids.length, points: pts };
  }
  return out;
}

/**
 * The ladder.
 *   results: [{ roundId, date, name, rows: [{ id, rank }] }] — finishers of each individual round
 *   trophies: [{ date, playerIds, name }] — trophies won (honour board)
 *   names: { [id]: name } — for sorting ties alphabetically
 * Rows: { id, total, roundPoints, bonusPoints, rounds, wins, podiums, trophies, byRound }, ranked by total; ties
 * on total are split by more wins, then more podiums, and otherwise share the place.
 */
export function seasonLadder({ results = [], trophies = [], range, points = DEFAULT_POINTS, bonus = DEFAULT_BONUS, names = {} }) {
  const rows = {};
  const row = (id) => (rows[id] ||= { id, name: names[id] || '', total: 0, roundPoints: 0, bonusPoints: 0, rounds: 0, wins: 0, podiums: 0, trophies: [], byRound: {} });
  const counted = results.filter((r) => !range || inRange(r.date, range));
  for (const res of counted) {
    const pts = roundPoints(res.rows, points);
    for (const [id, p] of Object.entries(pts)) {
      const x = row(id);
      x.byRound[res.roundId] = p;
      x.roundPoints += p.points;
      x.rounds += 1;
      if (p.place === 1) x.wins += 1;
      if (p.place <= 3) x.podiums += 1;
    }
  }
  for (const t of trophies) {
    if (range && !inRange(t.date, range)) continue;
    for (const id of t.playerIds || []) {
      const x = row(id);
      x.bonusPoints += bonus;
      x.trophies.push(t.name);
    }
  }
  const list = Object.values(rows).map((x) => ({
    ...x,
    roundPoints: Math.round(x.roundPoints * 100) / 100,
    total: Math.round((x.roundPoints + x.bonusPoints) * 100) / 100,
  }));
  return {
    rounds: counted.length,
    rows: rankRows(list, { key: 'total', higherBetter: true, tiebreak: (a, b) => (b.wins - a.wins) || (b.podiums - a.podiums) }),
  };
}

/** "10-8-6-5-4-3-2-1" → [10, 8, 6, 5, 4, 3, 2, 1]; null if it doesn't make sense. */
export function parsePoints(text) {
  const parts = String(text || '').split(/[\s,;\-–/]+/).filter(Boolean);
  if (!parts.length || parts.length > 30) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 100)) return null;
  return nums;
}

export const pointsText = (pts) => (pts || DEFAULT_POINTS).join('-');

/** Points to show: whole numbers plainly, shared points to one decimal place. */
export const fmtPts = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
