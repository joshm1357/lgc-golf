// Locking a trip in closes its planning votes (V1, Josh's walkthrough 23 Oct, option A). All four reviewers found
// "VOTE NOW: Which weekend?" under "Locked in · Nowra" the most confusing thing in the app. Pure functions, tested
// (lockin.test.js), plus lockIn() which takes the database client so every lock-in path does the same thing.
//
// Plain words:
//   * A planning vote is one about where and when: dates, places, where to stay, anything on the trip builder's vote
//     cards (areas, weekends, how long, courses, "Which trip?"), and the optional detail under an area.
//   * Votes on other things (a vote the organiser called by hand on "Anything else", e.g. shirt colour) stay open.
//   * When the trip is locked in, every open planning vote closes. A vote closed that way has no winner of its own:
//     it shows as one line, "Decided: Fri 22 – Mon 25 Jan, Nowra".
//   * The database does the same thing (migration 095, a trigger on plans), so old phones and any other way of
//     locking in close the votes too. lockIn() closes them from the app as well, for a database without 095.
import { weekendLabel } from './tripbuilder.js';

/** Is this a vote about where and when (closed when the trip is locked in)? */
export function isPlanningPoll(p) {
  if (!p) return false;
  return p.kind === 'dates' || p.kind === 'location' || p.purpose === 'stay' || !!p.vote_batch || !!p.optional;
}

/** The planning votes still open. */
export const openPlanningPolls = (polls = []) => (polls || []).filter((p) => p.status === 'open' && isPlanningPoll(p));

const LOCKED = ['confirmed', 'done'];

/** Was this vote closed by the lock-in (a planning vote, closed, no winner, on a locked-in trip)? */
export function closedAtLockIn(poll, plan) {
  return !!poll && !!plan && LOCKED.includes(plan.status) && poll.status === 'closed' && !poll.winner_option_id && isPlanningPoll(poll);
}

/** "Decided: Fri 22 – Mon 25 Jan, Nowra" — what a vote closed by the lock-in shows. */
export function decidedLine(plan) {
  if (!plan) return 'Decided';
  const when = plan.start_date ? weekendLabel({ start: String(plan.start_date).slice(0, 10), end: String(plan.end_date || plan.start_date).slice(0, 10) }) : null;
  const what = [when, plan.location_name || null].filter(Boolean).join(', ');
  return what ? `Decided: ${what}` : 'Decided when the trip was locked in';
}

/** The words for the "Lock it in?" box: { title, body, yes }. */
export function lockInWords(plan, polls = []) {
  const n = openPlanningPolls(polls).length;
  const when = plan?.start_date ? weekendLabel({ start: String(plan.start_date).slice(0, 10), end: String(plan.end_date || plan.start_date).slice(0, 10) }) : 'the dates';
  return {
    title: `Lock in ${plan?.name || 'the trip'}?`,
    body: `${when}${plan?.location_name ? ` at ${plan.location_name}` : ''}. ${n ? `${n === 1 ? 'The open vote on where and when closes' : `The ${n} open votes on where and when close`} and show${n === 1 ? 's' : ''} as decided. ` : ''}Then the to-do list is made and everyone’s told.`,
    yes: 'Lock it in',
    tone: 'go', // not a red "remove" button
  };
}

/**
 * Lock the trip in and close its planning votes. db: the Supabase client. Safe to run twice.
 * → { closed: number of votes closed }
 */
export async function lockIn(db, plan, polls = []) {
  if (!plan?.id) return { closed: 0 };
  if (plan.status === 'planning') {
    const { error } = await db.from('plans').update({ status: 'confirmed' }).eq('id', plan.id);
    if (error) throw error;
  }
  return { closed: await closePlanningVotes(db, polls) };
}

/** Close the open planning votes (the database's 095 trigger does it too). → how many. */
export async function closePlanningVotes(db, polls = []) {
  const ids = openPlanningPolls(polls).map((p) => p.id);
  if (!ids.length) return 0;
  const { error } = await db.from('plan_polls').update({ status: 'closed' }).in('id', ids).eq('status', 'open');
  if (error) throw error;
  return ids.length;
}
