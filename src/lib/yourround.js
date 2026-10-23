// "Your round" (ov28, walkthrough C1/C2/I8/I11) — the app's side. The rules and words live in
// supabase/functions/_shared/yourround.js (shared with the notify function's draw-out and night-before buzzes);
// this file re-exports them and adds what only the app needs: who's still a maybe or hasn't paid (for the team and
// group pickers), the tee time the courses gave (to prefill tee groups), and which rounds still need groups.
import { replyOf } from './headcount.js';

export { yourRound, teeWhen, offLine, matchLine, dayAndTime, drawOutMessage, teeTomorrowMessage, teeClock, andList } from '../../supabase/functions/_shared/yourround.js';

/**
 * Who's still a maybe, out, hasn't replied or hasn't paid the deposit — so the organiser sees it in the team and group
 * pickers, and the player gets a nudge ("You're in Kurt's draw for Team Blue. Are you coming?").
 * Same test as the run-up's reminders (notify → runUpFor): paid = what they've sent the organiser (to_id empty)
 * covers the deposit, less 50c.
 * Who's in / maybe / out / not replied comes from src/lib/headcount.js (replyOf) — the ONE headcount rule (O6).
 *   plan: { deposit_pp }; rsvps: [{ player_id, status: 'in' | 'maybe' | 'out' }]; transfers: [{ from_id, to_id, amount }]
 * Returns (player id) → { rsvp, paid, flag } — flag: 'out' | 'maybe' | 'no reply' | 'not paid' | null (all good).
 * No plan (a trip without the planner): nobody is flagged.
 */
export function peopleStatus({ plan = null, rsvps = [], transfers = [] } = {}) {
  const deposit = Number(plan?.deposit_pp) || 0;
  const replyFor = replyOf({ rsvps });
  return (pid) => {
    if (!plan || !pid) return { rsvp: null, paid: null, flag: null };
    const rsvp = replyFor(pid);
    const sent = (transfers || []).filter((t) => t.from_id === pid && !t.to_id).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const paid = deposit > 0 ? sent >= deposit - 0.5 : null;
    const flag = rsvp === 'out' ? 'out' : rsvp === 'maybe' ? 'maybe' : !rsvp ? 'no reply' : paid === false ? 'not paid' : null;
    return { rsvp, paid, flag };
  };
}

/** The little mark after a name in a picker: "maybe", "out", "no reply", "not paid" — or ''. */
export const flagMark = (flag) => (flag ? ` · ${flag}` : '');

/**
 * The nudge a flagged player sees on their round card:
 *   "You're in Kurt's draw for Team Blue. Are you coming?" / "…Pay your deposit so it's locked in."
 * organiser: the organiser's first name (or ''), y: from yourRound(). null when there's nothing to say.
 */
export function drawNudge({ flag, organiser = '', y = null } = {}) {
  if (!flag || !y || flag === 'out') return null;
  const whose = organiser ? `${organiser}’s draw` : 'the draw';
  const where = y.team ? ` for ${y.team.name}` : y.group?.length ? ' for a playing group' : '';
  if (flag === 'not paid') return `You’re in ${whose}${where}. Pay your deposit so your spot’s locked in.`;
  return `You’re in ${whose}${where}. Are you coming?`;
}

/**
 * The earliest tee time the courses gave for a round (call the courses, 080: trip_tee_options) — to prefill the first
 * group's time. options: [{ play_date, course_id, available, ranges: ['07:30-09:00'], times: ['07:52'] }].
 * Returns 'HH:MM' or null.
 */
export function calledTeeTime(options = [], round = null) {
  if (!round?.play_date) return null;
  const day = String(round.play_date).slice(0, 10);
  const hits = (options || []).filter((o) => String(o.play_date || '').slice(0, 10) === day && o.available !== 'no'
    && (!round.course_id || !o.course_id || o.course_id === round.course_id));
  const times = [];
  for (const o of hits) {
    for (const t of o.times || []) times.push(String(t));
    for (const r of o.ranges || []) times.push(String(r).split(/[-–]/)[0]);
  }
  const ok = times.map((t) => /^(\d{1,2})[:.]?(\d{2})$/.exec(t.trim())).filter(Boolean)
    .map((m) => `${m[1].padStart(2, '0')}:${m[2]}`).filter((t) => t <= '23:59').sort();
  return ok[0] || null;
}

/**
 * C2 — rounds coming up in the next `days` days (Sydney "today") that still have no playing groups and no Cup tee
 * times: the run-up nudges the organiser to set them. rounds: the trip's rounds; teeRounds: Set of round ids with saved
 * tee groups; cupTimed: Set of round ids whose Cup matches all have a tee time.
 */
export function roundsNeedingGroups({ rounds = [], teeRounds = new Set(), cupTimed = new Set(), today, days = 5 } = {}) {
  if (!today) return [];
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  return (rounds || [])
    .filter((r) => r.status !== 'locked' && r.play_date && String(r.play_date).slice(0, 10) >= today && String(r.play_date).slice(0, 10) <= end)
    .filter((r) => !teeRounds.has(r.id) && !cupTimed.has(r.id))
    .sort((a, b) => String(a.play_date).localeCompare(String(b.play_date)));
}
