// Trips — pure functions (no database, no React) so they can be tested.
//
// One trip moves through stages: an idea → deciding (votes on when and where) → locked in → on the trip → done.
// "Called off" sits beside them. A plan (the organising side) and its trip in the app (rounds, scores) are one trip.

import { daysUntil, fmtRange, todayISO } from './plan.js';

export const STAGES = ['idea', 'deciding', 'locked', 'on', 'done'];
export const STAGE_LABEL = {
  idea: '💡 Idea', deciding: '🗳️ Deciding', locked: '🔒 Locked in', on: '⛳ On now', done: '🏁 Done', cancelled: 'Called off',
};

const lastDay = (p) => p.end_date || p.start_date;

/** The last day of a plan and its trip in the app (whichever is later), or null if neither has dates. */
export function lastTripDay(plan, trip) {
  const a = lastDay(plan) || null;
  const b = trip ? (trip.end_date || trip.start_date || null) : null;
  return a && b ? (a > b ? a : b) : a || b;
}

/** Which stage a plan is at. `trip` is its trip in the app (or undefined). A trip whose last day has gone is done,
 *  even if nobody has closed its trip in the app yet (22 Oct: South Coast 16–18 Oct still said "On now" on the 22nd). */
export function tripStage(plan, trip, today = todayISO()) {
  if (plan.status === 'cancelled') return 'cancelled';
  if (plan.status === 'done') return 'done';
  if (plan.status === 'confirmed') {
    const last = lastTripDay(plan, trip);
    if (last && last < today) return 'done';
    if (trip?.status === 'active' && (!plan.start_date || plan.start_date <= today)) return 'on';
    if (plan.start_date && plan.start_date <= today && lastDay(plan) >= today) return 'on';
    if (lastDay(plan) && lastDay(plan) < today) return 'done';
    return 'locked';
  }
  if (lastDay(plan) && lastDay(plan) < today) return 'done';
  // ov39: a trip idea stays an idea until it's sent to the vote, whoever proposed it.
  return plan.proposed || (plan.idea && !plan.idea_sent_at) ? 'idea' : 'deciding';
}

/**
 * A past trip whose real dates aren't known (brought in from the group's history with just a year). It's saved
 * locked on 1 January of that year so it sorts by year and never becomes the current trip; this tells the screens
 * to show "2019 (date unknown)" rather than a made-up 1 January. (A real locked one-day trip on New Year's Day
 * would read the same — rare enough to accept rather than add a database column the night of a release.)
 */
export function isYearOnly(t) {
  if (!t?.start_date || t.status !== 'locked') return false;
  return /^\d{4}-01-01$/.test(t.start_date) && (!t.end_date || t.end_date === t.start_date);
}

/** A trip's dates in words: "Fri 16 – Sun 18 Oct 2026", or "2019 (date unknown)" for a year-only past trip. */
export function tripWhen(t, fallback = '') {
  if (!t?.start_date) return fallback;
  if (isYearOnly(t)) return `${t.start_date.slice(0, 4)} (date unknown)`;
  return fmtRange(t.start_date, t.end_date);
}

/**
 * Sort every plan into the three parts of the Trips tab.
 *   now   — the trip that's on, else the next locked-in one (the big card)
 *   later — other locked-in trips still to come
 *   ideas — ideas and trips still being decided (soonest / newest first)
 *   planning / suggested — `ideas` split: started by an organiser (status planning, not proposed) / suggestions
 *   past  — done and called off, newest first
 */
export function sortTrips(plans, trips = [], today = todayISO()) {
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const withStage = plans.map((p) => ({ plan: p, stage: tripStage(p, tripById.get(p.trip_id), today) }));
  const on = withStage.filter((x) => x.stage === 'on')
    .sort((a, b) => String(a.plan.start_date || '').localeCompare(String(b.plan.start_date || '')));
  const locked = withStage.filter((x) => x.stage === 'locked')
    .sort((a, b) => String(a.plan.start_date || '9999').localeCompare(String(b.plan.start_date || '9999')));
  const now = on[0] || locked[0] || null;
  const later = [...on.slice(1), ...locked].filter((x) => x !== now);
  const ideas = withStage.filter((x) => x.stage === 'idea' || x.stage === 'deciding').sort((a, b) => {
    const da = a.plan.start_date || '9999';
    const db = b.plan.start_date || '9999';
    if (da !== db) return da.localeCompare(db);
    return String(b.plan.created_at || '').localeCompare(String(a.plan.created_at || ''));
  });
  const past = withStage.filter((x) => x.stage === 'done' || x.stage === 'cancelled')
    .sort((a, b) => String(lastDay(b.plan) || b.plan.created_at || '').localeCompare(String(lastDay(a.plan) || a.plan.created_at || '')));
  // v8 fix: the Trips tab shows trips an organiser has started ("Being planned", dates or not) apart from
  // suggestions still waiting on the group ("Ideas"). `ideas` keeps both, for older callers.
  const planning = ideas.filter((x) => x.stage === 'deciding');
  const suggested = ideas.filter((x) => x.stage === 'idea');
  return { now, later, ideas, planning, suggested, past };
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "closes Fri", "closes today", "closes 12 Mar" — short, for a card. */
export function closesLabel(date, today = todayISO()) {
  if (!date) return '';
  const n = daysUntil(date, today);
  if (n < 0) return 'closed';
  if (n === 0) return 'closes today';
  if (n === 1) return 'closes tomorrow';
  if (n < 7) {
    const [y, m, d] = date.split('-').map(Number);
    return `closes ${DOW[new Date(y, m - 1, d).getDay()]}`;
  }
  return `closes ${fmtRange(date)}`;
}

/**
 * What's still to decide on a trip, one short line each, e.g.
 *   ["Dates: 3 options, closes Fri", "Place: 2 options"]
 * Falls back to "Dates to sort" / "Place to sort" when nothing is set and no vote is open.
 */
export function stillToDecide(plan, polls = [], options = [], today = todayISO()) {
  const out = [];
  for (const [kind, word] of [['dates', 'Dates'], ['location', 'Place']]) {
    const open = polls.filter((p) => p.plan_id === plan.id && p.kind === kind && p.status === 'open');
    if (open.length) {
      for (const p of open) {
        const n = options.filter((o) => o.poll_id === p.id).length;
        out.push(`${word}: ${n} option${n === 1 ? '' : 's'}${p.closes_on ? `, ${closesLabel(p.closes_on, today)}` : ''}`);
      }
    } else if (kind === 'dates' ? !plan.start_date : !plan.location_name) {
      out.push(`${word} to sort`);
    }
  }
  const other = polls.filter((p) => p.plan_id === plan.id && p.kind === 'other' && p.status === 'open');
  for (const p of other) out.push(`Vote: ${p.question}`);
  return out;
}

/**
 * ov21 (23 Oct): can this plan really be deleted? Only when nothing's been put into it: nobody but its creator has
 * replied, and there are no votes, jobs, costs, payments, chat or rounds (vote options with no votes don't count).
 * Anything else gets "Call it off" (keeps everything). The database checks the same (091 plan_is_empty).
 * pd: the plan's data (Planner.jsx usePlanData); rounds: every round (data.rounds).
 */
export function planIsEmpty(pd, rounds = []) {
  const plan = pd?.plan;
  if (!plan) return false;
  const others = (pd.rsvps || []).filter((r) => r.player_id !== plan.created_by);
  const played = plan.trip_id ? (rounds || []).filter((r) => r.trip_id === plan.trip_id) : [];
  return !others.length && !(pd.votes || []).length && !(pd.items || []).length && !(pd.costs || []).length
    && !(pd.payments || []).length && !(pd.transfers || []).length && !(pd.comments || []).length && !played.length;
}

/** Who can call a trip off or bring it back: an organiser of the group, the trip's own organiser, or whoever
 *  suggested an idea that hasn't been approved yet (091 call_off_plan checks the same). */
export function canCallOff({ isAdmin, me, plan }) {
  if (!plan) return false;
  if (isAdmin) return true;
  if (!me) return false;
  return plan.organiser_id === me || (!!plan.proposed && plan.created_by === me);
}

/** Who can pick the winner of this trip's votes: the admin, or its organiser if the group allows it. */
export function canDecide({ isAdmin, me, plan, voteDecider }) {
  if (isAdmin) return true;
  return voteDecider === 'admin_or_organiser' && !!me && plan?.organiser_id === me;
}

/**
 * Clean up what someone typed into the "suggest a trip" form into the two lists the database wants.
 * dates:  [{ start_date, end_date }] — blank rows dropped, end never before start
 * rough:  "Sometime in March" → one more dates option with just a label
 * places: [{ label, cost_pp }]
 */
export function suggestionOptions({ dates = [], rough = '', places = [] }) {
  const d = dates
    .filter((x) => x && x.start_date)
    .map((x) => ({ start_date: x.start_date, end_date: x.end_date && x.end_date >= x.start_date ? x.end_date : x.start_date }));
  if (String(rough).trim()) d.push({ label: String(rough).trim().slice(0, 120) });
  const seen = new Set();
  const p = places
    .map((x) => ({ label: String(x?.label || '').trim().slice(0, 120), cost_pp: x?.cost_pp === '' || x?.cost_pp == null ? null : Number(String(x.cost_pp).replace(/[^0-9.]/g, '')) || null }))
    .filter((x) => x.label && !seen.has(x.label.toLowerCase()) && seen.add(x.label.toLowerCase()));
  return { dates: d.slice(0, 6), places: p.slice(0, 6) };
}

/** When the votes on a new suggestion close by default: ten days out (a Sunday if that's close). */
export function defaultCloses(today = todayISO()) {
  const [y, m, d] = today.split('-').map(Number);
  const t = new Date(y, m - 1, d + 10);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
