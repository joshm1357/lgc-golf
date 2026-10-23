// ONE list of a trip's steps (ov23, Josh 23 Oct: "the step bar on the Organise page doesn't match Build the trip").
// The Organise step cards and the trip builder's tabs both read this list, and the same summary lines.
//
//   1 Areas & weekends   the areas, the weekends shortlist, how long, the vote, then the area and the primary /
//                        backup weekends (voting is part of this step — there's no separate "Plan" or "Vote")
//   2 Courses & stays    each day's course options and where to stay (the accommodation ideas and search)
//   3 Call the courses   tee times on the primary and backup weekends
//   4 Pick & lock in     the best combination from the tee times, then lock it in, who's in, deposits
//   5 Jobs & money       the to-do list, the kitty, rooms and cars
//   6 Comps & on the day the run-up: what's up for grabs, rules, handicaps, teams and the draw, the rounds
//
// key: the Organise step (?step=…); builder: the trip builder's own step (null = it lives in Organise only).
import { weekendLabel } from './tripbuilder.js';

export const TRIP_STEPS = [
  { key: 'area', builder: 'area', title: 'Areas & weekends', blurb: 'Areas, weekends, how long — and the vote' },
  { key: 'courses', builder: 'courses', title: 'Courses & stays', blurb: 'Course options each day, where to stay' },
  { key: 'book', builder: 'calls', title: 'Call the courses', blurb: 'Tee times on the primary and backup weekends' },
  { key: 'lockin', builder: 'configs', title: 'Pick & lock in', blurb: 'Best combination, who’s in, deposits' },
  { key: 'money', builder: null, title: 'Jobs & money', blurb: 'Jobs, kitty, rooms and cars' },
  { key: 'day', builder: null, title: 'Comps & on the day', blurb: 'What’s up for grabs, rules, handicaps, teams' },
].map((s, i) => ({ ...s, n: i + 1 }));

/** Old step addresses (links, notifications) → today's step. */
export const STEP_ALIAS = { plan: 'area', vote: 'area' };
export const stepKey = (k) => STEP_ALIAS[k] || k;
/** The builder's step key → the shared step. */
export const fromBuilder = (b) => TRIP_STEPS.find((s) => s.builder === b) || null;

/**
 * O1 (Josh's walkthrough): ONE "where we're up to" line, the same on a phone and a laptop, on Organise, the trip
 * builder and the Overview's builder card. key: the step the trip is up to (null = every step done).
 * → "Up to step 4 of 6: Pick & lock in" | "All 6 steps done"
 */
export function upToLine(key) {
  const s = key ? TRIP_STEPS.find((x) => x.key === key || x.builder === key) : null;
  return s ? `Up to step ${s.n} of ${TRIP_STEPS.length}: ${s.title}` : `All ${TRIP_STEPS.length} steps done`;
}

/** "Primary Fri 13 – Mon 16 Nov · Backup Fri 20 – Mon 23 Nov" (settled) or "5 weekends on the shortlist". */
export function weekendsLine(state = {}) {
  const w = state.weekends || [];
  if (!w.length) return null;
  if (state.weekendsSettled) {
    return w.slice(0, 3).map((x, i) => `${i === 0 ? 'Primary' : i === 1 ? 'Backup' : `Backup ${i}`} ${weekendLabel({ start: x.start, end: x.end })}`).join(' · ');
  }
  return `${w.length} weekend${w.length === 1 ? '' : 's'} on the shortlist`;
}

/** Step 1's line, the same on both screens: "Hunter Valley · Primary Fri 13 – Mon 16 Nov · Backup …". */
export function areaLine(state = {}) {
  if (!state) return null;
  const where = state.region || ((state.regionOptions || []).length ? `${state.regionOptions.join(' or ')}?` : null);
  return [where, weekendsLine(state)].filter(Boolean).join(' · ') || null;
}

/** Step 2's line: "Stay Pokolbin · 2 of 4 days with options". */
export function coursesLine(state = {}) {
  const stays = state?.stays || [];
  const days = state?.days || [];
  if (!stays.length) return null;
  return `Stay ${stays.map((s) => s.name).join(' / ')} · ${days.filter((d) => (d.options || []).length).length} of ${days.length} days with options`;
}

/** Is step 2 done in the builder (somewhere to stay and at least one day with course options)? */
export const coursesDone = (state = {}) => (state?.stays || []).length > 0 && (state?.days || []).some((d) => (d.options || []).length);
