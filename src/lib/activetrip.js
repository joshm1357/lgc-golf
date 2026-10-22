// This trip (ov15, 22 Oct 2026): which trip the first tab is about, and the words on its card. Pure functions (no
// database, no React) so they can be tested in activetrip.test.js. The screen is screens/TripNow.jsx; the trip's
// status (leaderboard, comps, feed) is components/TripStatus.jsx.
//
// Josh: "maybe have an 'active or upcoming' trip that is listed up the top, separate, above Feed."
// The pick, in order:
//   1. a trip with a round in progress (live), or a round today;
//   2. a trip that's on today (between its first and last day — e.g. a rest day);
//   3. the soonest trip still to come;
//   4. the most recent trip that finished in the last 7 days (so Monday's banter still has its leaderboard).
// Otherwise nothing: the card says "No trip on — plan one".
// ov21 (23 Oct): "This trip" is no longer a tab of its own. Trips has sub-items — On now / Next trip, Last trip, or
// ✨ Plan a trip (tripsMenu below) — and each opens that trip's status page (#/trip-now/<trip>).

import { todayISO, daysUntil } from './plan.js';
import { isYearOnly } from './trips.js';

const ISO = /^\d{4}-\d{2}-\d{2}/;
const day = (s) => (s && ISO.test(String(s)) ? String(s).slice(0, 10) : null);

/** A trip's first and last day: its own dates, else the days its rounds are played. { start, end } (either may be null). */
export function tripSpan(trip, rounds = []) {
  const mine = (rounds || []).filter((r) => r.trip_id === trip?.id).map((r) => day(r.play_date)).filter(Boolean).sort();
  const start = day(trip?.start_date) || mine[0] || null;
  const end = day(trip?.end_date) || (trip?.start_date ? day(trip.start_date) : null) || mine[mine.length - 1] || start;
  // Rounds outside the trip's own dates still count (a trip saved with one day but played over two).
  const s = [start, mine[0]].filter(Boolean).sort()[0] || null;
  const e = [end, mine[mine.length - 1]].filter(Boolean).sort().pop() || null;
  return { start: s, end: e };
}

/**
 * The trip for the first tab. Returns { trip, why } — why: 'live' | 'today' | 'on' | 'upcoming' | 'recent' — or null.
 * trips: the group's trips; rounds: every round (with trip_id, play_date, status).
 */
export function pickActiveTrip({ trips = [], rounds = [], today = todayISO(), recentDays = 7 } = {}) {
  const list = (trips || []).filter((t) => t && t.id && t.status !== 'cancelled' && !isYearOnly(t));
  if (!list.length) return null;
  const byId = new Map(list.map((t) => [t.id, t]));
  const ofTrip = (rs) => rs.filter((r) => byId.has(r.trip_id));
  const latest = (rs) => [...rs].sort((a, b) => String(b.play_date || '').localeCompare(String(a.play_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];

  // 1. A round in progress, else a round today.
  // A round left 'live' from an earlier day (nobody locked it) doesn't make its trip "on now".
  const live = latest(ofTrip((rounds || []).filter((r) => r.status === 'live' && (!r.play_date || day(r.play_date) >= today))));
  if (live) return { trip: byId.get(live.trip_id), why: 'live' };
  const todays = latest(ofTrip((rounds || []).filter((r) => day(r.play_date) === today)));
  if (todays) return { trip: byId.get(todays.trip_id), why: 'today' };

  const spans = list.map((t) => ({ t, ...tripSpan(t, rounds) }));
  // 2. On today (between its first and last day).
  const on = spans.filter((x) => x.start && x.start <= today && x.end >= today).sort((a, b) => b.start.localeCompare(a.start))[0];
  if (on) return { trip: on.t, why: 'on' };
  // 3. The soonest still to come. A trip with no dates and no rounds yet that's still open counts too, after dated ones.
  const ahead = spans.filter((x) => x.start && x.start > today).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (ahead) return { trip: ahead.t, why: 'upcoming' };
  const undated = spans.filter((x) => !x.start && x.t.status === 'active')
    .sort((a, b) => String(b.t.created_at || '').localeCompare(String(a.t.created_at || '')))[0];
  if (undated) return { trip: undated.t, why: 'upcoming' };
  // 4. Finished in the last week.
  const recent = spans.filter((x) => x.end && x.end < today && daysUntil(x.end, today) >= -recentDays)
    .sort((a, b) => b.end.localeCompare(a.end))[0];
  if (recent) return { trip: recent.t, why: 'recent' };
  return null;
}

/**
 * The line under the trip's name: "Day 2 of 3", "Today", "Starts tomorrow", "In 12 days", "In 6 weeks",
 * "Finished yesterday", "Finished 3 days ago", or "Dates to come".
 */
export function tripDayWords(trip, rounds = [], today = todayISO()) {
  const { start, end } = tripSpan(trip, rounds);
  if (!start) return 'Dates to come';
  if (start <= today && end >= today) {
    const total = daysUntil(end, start) + 1;
    if (total <= 1) return 'Today';
    return `Day ${daysUntil(today, start) + 1} of ${total}`;
  }
  if (start > today) {
    const n = daysUntil(start, today);
    if (n === 1) return 'Starts tomorrow';
    if (n < 21) return `In ${n} days`;
    return `In ${Math.round(n / 7)} weeks`;
  }
  const ago = -daysUntil(end, today);
  if (ago === 1) return 'Finished yesterday';
  if (ago < 21) return `Finished ${ago} days ago`;
  if (ago < 60) return `Finished ${Math.round(ago / 7)} weeks ago`;
  // Older: the month and year it finished, e.g. "Oct 2025".
  const [y, m] = String(end).split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(m || 1) - 1]} ${y}`;
}

/**
 * The round the trip's status leads with: the live one, else today's, else the next to come, else the last played.
 * Returns { round, when } — when: 'live' | 'today' | 'next' | 'last' — or null if the trip has no rounds.
 */
export function focusRound(trip, rounds = [], today = todayISO()) {
  const mine = (rounds || []).filter((r) => r.trip_id === trip?.id)
    .sort((a, b) => String(a.play_date || '').localeCompare(String(b.play_date || '')) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  if (!mine.length) return null;
  const live = [...mine].reverse().find((r) => r.status === 'live');
  if (live) return { round: live, when: 'live' };
  const todays = mine.find((r) => day(r.play_date) === today);
  if (todays) return { round: todays, when: 'today' };
  // Before the trip or on a rest day: the next round still to play. After it: the last one played.
  const next = mine.find((r) => r.status !== 'locked' && (!day(r.play_date) || day(r.play_date) > today));
  if (next) return { round: next, when: 'next' };
  return { round: mine[mine.length - 1], when: 'last' };
}

/** Where a trip's own page is: its plan's overview if it has one, else the trip overview (trips from history). */
export function tripPath(trip, plans = []) {
  if (!trip) return '/plan';
  const plan = (plans || []).find((p) => p.trip_id === trip.id && p.status !== 'cancelled');
  return plan ? `/plan/${plan.id}?view=overview` : `/trip/${trip.id}`;
}

/** Trips whose plan has been called off don't count as the next or last trip. */
export function liveTrips(trips = [], plans = []) {
  const off = new Set((plans || []).filter((p) => p.status === 'cancelled' && p.trip_id).map((p) => p.trip_id));
  return (trips || []).filter((t) => t && t.id && t.status !== 'cancelled' && !off.has(t.id));
}

/**
 * ov21 (23 Oct 2026) — the Trips menu. Josh: "Under Trips, looking like a submenu, it can have Last trip and Next
 * trip; if no next trip then have Plan it." Used by the sidebar's sub-items, the top of the Trips screen and the home
 * route.
 *   now    — { trip, on }: the trip that's on right now (on: true — a round live or today, or between its first and
 *            last day), else the soonest still to come (on: false); null if neither.
 *   last   — the most recent trip that's finished (never the one in `now`); null if none.
 *   planIt — true when there's no next trip: offer "✨ Plan a trip" instead.
 */
export function tripsMenu({ trips = [], rounds = [], plans = [], today = todayISO() } = {}) {
  const list = liveTrips(trips, plans);
  // recentDays -1: never fall back to a finished trip here — that's `last`.
  const pick = pickActiveTrip({ trips: list, rounds, today, recentDays: -1 });
  const now = pick ? { trip: pick.trip, on: pick.why !== 'upcoming' } : null;
  // While a trip is on, the next one still gets its own line.
  let next = null;
  if (now?.on) {
    const ahead = pickActiveTrip({ trips: list.filter((t) => t.id !== now.trip.id), rounds: [], today, recentDays: -1 });
    if (ahead && ahead.why === 'upcoming') next = ahead.trip;
  }
  const done = list.filter((t) => t.id !== now?.trip.id && t.id !== next?.id)
    .map((t) => ({ t, end: tripSpan(t, rounds).end }))
    .filter((x) => x.end && x.end < today)
    .sort((a, b) => b.end.localeCompare(a.end) || String(b.t.created_at || '').localeCompare(String(a.t.created_at || '')));
  return { now, next, last: done[0]?.t || null, planIt: !now };
}

/** The words on a Trips sub-item: "On now: March", "Next: March", "Last: South Coast 2026". */
export function menuLabel(kind, trip) {
  const name = trip?.name || 'Trip';
  if (kind === 'on') return `On now: ${name}`;
  if (kind === 'next') return `Next: ${name}`;
  return `Last: ${name}`;
}

/** Where a Trips sub-item goes: that trip's status page (its leaderboards, comps and feed). */
export const tripNowPath = (trip) => (trip ? `/trip-now/${trip.id}` : '/plan');
