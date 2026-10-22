// Trip overview — pure functions for the trip page's "Overview" (Josh, 21 Oct: a past or coming trip should open on
// its summary — results, courses, who's in — with organising one tap away). No database, no React.

import { formatName } from './board.js';
import { formatToPar } from './scoring.js';
import { todayISO } from './plan.js';

/** Which view a trip page opens on: the overview once dates are locked in (coming, on, done), organise while deciding. */
export function defaultView(stage) {
  return ['locked', 'on', 'done'].includes(stage) ? 'overview' : 'organise';
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri 22 Oct" from an ISO date (no time zone shifts). */
export function dayLabel(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return 'Date TBC';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]} ${d} ${MON[m - 1]}`;
}

/** The trip's rounds grouped by day, in order: [{ date, label, rounds: [{ round, course }] }]. */
export function tripDays(rounds = [], coursesById = {}, tripId = null) {
  const mine = rounds.filter((r) => !tripId || r.trip_id === tripId)
    .sort((a, b) => String(a.play_date || '9999').localeCompare(String(b.play_date || '9999')) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const days = [];
  for (const r of mine) {
    const date = r.play_date || null;
    let day = days.find((d) => d.date === date);
    if (!day) days.push(day = { date, label: dayLabel(date), rounds: [] });
    day.rounds.push({ round: r, course: coursesById[r.course_id] || null });
  }
  return days;
}

/** The trip's courses, once each, in the order they're played. */
export function tripCourses(days) {
  const seen = new Set();
  const out = [];
  for (const d of days) for (const { course } of d.rounds) if (course && !seen.has(course.id)) { seen.add(course.id); out.push(course); }
  return out;
}

/** Plain words for a round's format, e.g. "Stableford" or "Ambrose · Cup day". */
export function roundFormat(round) {
  return formatName(round?.format) || '';
}

/**
 * A finished round's winner line from its board (lib/board.js roundBoard), or null while it isn't decided.
 * `done` is whether the round is over (locked, or everyone through every hole).
 */
export function roundWinner(board, done) {
  if (!done || !board?.rows?.length) return null;
  const top = board.rows[0];
  if (!top || !(top.thru > 0 || top.quick)) return null;
  const tied = board.rows.filter((r) => r.rank === top.rank && top.rank != null);
  const names = (tied.length > 1 ? tied : [top]).map((r) => r.name).join(' & ');
  let score = '';
  if (board.format === 'stableford' || board.format === 'fourball') score = top.points != null ? `${top.points} pts` : '';
  else if (top.finalNet != null || top.netToPar != null) score = top.netToPar != null ? `${formatToPar(top.netToPar)} net` : '';
  return { name: names, score, tie: tied.length > 1 };
}

/** Countdown words for a coming trip: "Tomorrow", "In 12 days", "On now", or null once it's over. */
export function countdownWords(start, end, today = todayISO()) {
  if (!start) return null;
  const last = end || start;
  if (start <= today && last >= today) return 'On now';
  if (last < today) return null;
  const days = Math.round((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

/** Who's in: plan RSVPs marked in; for a trip with no RSVPs (older trips), everyone who played a round. */
export function whosIn({ rsvps = [], rounds = [], roundPlayers = {}, teamsByRound = {}, playersById = {} }) {
  const ids = new Set(rsvps.filter((r) => r.status === 'in').map((r) => r.player_id));
  if (!ids.size) {
    for (const r of rounds) {
      for (const rp of roundPlayers[r.id] || []) ids.add(rp.player_id);
      for (const t of teamsByRound[r.id] || []) for (const p of t.players || []) ids.add(p.id);
    }
  }
  return [...ids].map((id) => playersById[id]).filter(Boolean);
}

/** The trip's honours (one line per trophy), from the honour board. */
export function tripHonours(honourBoard = [], tripId) {
  if (!tripId) return [];
  return honourBoard.filter((h) => h.trip_id === tripId)
    .sort((a, b) => String(a.trophy_name).localeCompare(String(b.trophy_name)));
}
