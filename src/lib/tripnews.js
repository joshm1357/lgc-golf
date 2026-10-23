// Telling the group when the plan changes (Josh's walkthrough, 23 Oct): O5 (a weekend falls through), I4 (the vote's
// result), I5 (the courses are called), I6 (a one-tap "still good for you?"). Pure functions, tested (tripnews.test.js).
//
// Plain words:
//   * After the calls, each primary / backup weekend WORKS (every golf day has a course with enough tee times in a
//     row), is OUT (a golf day has every course answered and none can take us), or is still WAITING on answers.
//   * When the primary is out and a backup works: one banner, "Fri 8 – Sun 10 Jan is out. Fri 15 – Sun 17 Jan works at
//     both courses → Go with Fri 15 – Sun 17 Jan". "Open it up" (another weekend, or the area again) only shows when no
//     weekend works.
//   * Every real change posts ONE plain Feed message (never one per click). The words are here so they read the same
//     everywhere.
import { dayDate, weekendLabel, bestBlock } from './tripbuilder.js';
import { slotsFor, answered } from './teegrid.js';
import { namesList } from './callvote.js';
import { weekendRole, lengthLabel, fridayOf } from './weekends.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const wl = (w) => weekendLabel({ start: w.start, end: w.end || w.start });

/**
 * How each settled weekend is going from the tee times in.
 *   weekends: the builder's settled weekends (primary first); days: [{ index, options: [course ids] }];
 *   tees: trip_tee_options rows; needed: tee times in a row.
 * → [{ weekend, role, state: 'works' | 'out' | 'waiting', courses: n working, total: n courses, days: [{ date, state }] }]
 */
export function weekendStatus({ weekends = [], days = [], tees = [], needed = 1 } = {}) {
  const golf = (days || []).filter((d) => (d.options || []).length);
  const at = new Map((tees || []).map((t) => [`${String(t.play_date).slice(0, 10)}|${t.course_id}`, t]));
  const all = [...new Set(golf.flatMap((d) => d.options))];
  return (weekends || []).map((w, i) => {
    const working = new Set();
    const ds = golf.map((d) => {
      const date = dayDate(w, d.index);
      let works = false; let allAnswered = true;
      for (const id of d.options) {
        const row = at.get(`${date}|${id}`);
        if (!answered(row)) allAnswered = false;
        if (row && bestBlock(slotsFor(row), Math.max(1, needed), { earliest: 0 })) { works = true; working.add(id); }
      }
      return { date, state: works ? 'works' : allAnswered ? 'out' : 'waiting' };
    });
    const state = !ds.length ? 'waiting' : ds.every((d) => d.state === 'works') ? 'works' : ds.some((d) => d.state === 'out') ? 'out' : 'waiting';
    return { weekend: w, role: weekendRole(i), state, courses: working.size, total: all.length, days: ds };
  });
}

/** "both courses" / "all 3 courses" / "2 of 3 courses" / "Nowra GC" (one). */
export function coursesWords(n, total, names = []) {
  if (total === 1 && names[0]) return names[0];
  if (n === total) return total === 2 ? 'both courses' : total === 1 ? 'the course' : `all ${total} courses`;
  return `${n} of ${plural(total, 'course')}`;
}

/**
 * The banner when the primary weekend is out and a backup works. → { out, go, line, button } or null.
 * names: the course names (for "works at Nowra GC" when there's one).
 */
export function fallsThrough(statuses = [], names = []) {
  const primary = statuses[0];
  if (!primary || primary.state !== 'out') return null;
  const go = statuses.slice(1).find((s) => s.state === 'works');
  if (!go) return null;
  return {
    out: primary.weekend, go: go.weekend,
    line: `${wl(primary.weekend)} is out. ${wl(go.weekend)} works at ${coursesWords(go.courses, go.total, names)}.`,
    button: `Go with ${wl(go.weekend)}`,
  };
}

/** Show "It's not working? Open it up"? Only when no weekend works and at least one is out. */
export function showOpenItUp(statuses = []) {
  return statuses.length > 0 && !statuses.some((s) => s.state === 'works') && statuses.some((s) => s.state === 'out');
}

/**
 * "Go with the backup": the backup becomes the primary, the dead weekend comes off (kept in `dead` so it isn't
 * offered again). → { weekends, dead }
 */
export function goWithBackup(st = {}, go, out) {
  const keep = (st.weekends || []).filter((w) => w.start !== out?.start);
  const first = keep.find((w) => w.start === go?.start);
  const weekends = first ? [first, ...keep.filter((w) => w.start !== first.start)] : keep;
  return { weekends, dead: [...new Set([...(st.deadWeekends || []), out?.from || out?.start].filter(Boolean))] };
}

/**
 * Open votes with a dead weekend on them (O5: "dead weekends come off open votes"): the option ids to take off.
 * polls/options: the planner's; dead: [{ start }] or ISO starts. Only OPEN dates votes, and never the last option.
 */
export function deadOptions(polls = [], options = [], dead = []) {
  const fris = new Set((dead || []).map((d) => fridayOf(typeof d === 'string' ? d : d?.start)).filter(Boolean));
  const out = [];
  for (const p of (polls || []).filter((x) => x.status === 'open' && x.kind === 'dates')) {
    const mine = (options || []).filter((o) => o.poll_id === p.id);
    const gone = mine.filter((o) => o.start_date && fris.has(fridayOf(String(o.start_date).slice(0, 10))));
    if (gone.length && gone.length < mine.length) out.push(...gone.map((o) => o.id));
  }
  return out;
}

// ------------------------------------------------------------------ the Feed messages (one per real change)

/** O5: the primary's out and we're going with the backup. */
export function goWithPost({ planName, out, go, courses = '' }) {
  return `📅 ${planName}: ${wl(out)} is out — no tee times. We’re going with ${wl(go)}${courses ? `, it works at ${courses}` : ''}. Still good for you? Answer on the trip.`;
}

/** O5: another weekend added as a backup. */
export function addedBackupPost({ planName, added, callers = [] }) {
  return `📅 ${planName}: no workable tee times yet — asking the courses about ${wl(added)} too.${callers.length ? ` ${namesList(callers)} ${callers.length === 1 ? 'has' : 'have'} the new calls.` : ''}`;
}

/** O5: the area's open again. */
export function reopenedPost({ planName, area, runnerUp = null }) {
  return `📍 ${planName}: ${area || 'that area'} didn’t work out, so where we go is open again${runnerUp ? ` (${runnerUp} came next in the vote)` : ''}. A fresh vote’s coming.`;
}

/** I6: the one-tap check question. */
export function checkQuestion(go) {
  return `Still good for ${wl(go)}?`;
}

/**
 * I4: the vote's result, for the Feed and the group chat. "🗳️ Spring away: it's Hunter Valley, Fri 22 – Mon 25 Jan.
 * 10 votes to 6. Next: ringing the courses."
 * area: the winning area (or null); weekend: the primary; nights: the length (when it was voted on);
 * votes: [winner's ✓ count, runner-up's ✓ count]; caller: who's ringing the courses (name) or null.
 */
export function resultPost({ planName, area = null, weekend = null, nights = null, votes = null, caller = null }) {
  const what = [area, weekend ? wl(weekend) : null].filter(Boolean).join(', ');
  const score = votes && votes[0] > 0 ? ` ${votes[0]} ${votes[0] === 1 ? 'vote' : 'votes'} to ${votes[1] || 0}.` : '';
  const len = nights != null ? ` ${lengthLabel(nights)}.` : '';
  const next = caller ? ` ${caller}’s ringing the courses this week.` : ' Next: ringing the courses for tee times.';
  return `🗳️ ${planName}: it’s ${what || 'decided'}.${len}${score}${next}`;
}

/** The winner's and runner-up's ✓ counts on a vote's options (for "10 votes to 6"). options: [option ids] in order. */
export function topTwoYes(optionIds = [], votes = [], winnerId = null) {
  const yes = (id) => (votes || []).filter((v) => v.option_id === id && v.response === 'yes').length;
  const counts = (optionIds || []).map((id) => ({ id, n: yes(id) }));
  const win = counts.find((c) => c.id === winnerId) || counts.sort((a, b) => b.n - a.n)[0];
  const rest = counts.filter((c) => c.id !== win?.id).sort((a, b) => b.n - a.n);
  return win ? [win.n, rest[0]?.n || 0] : null;
}

/**
 * I5: the caller's moment, once every call is done. calls: [{ owner }] (names), statuses: weekendStatus() rows.
 * "⛳ Al rang 3 courses and got tee times every day" / "… — tee times on 4 of 6 days".
 */
export function callsHeroPost({ planName, callers = [], courses = 0, statuses = [] }) {
  const days = statuses.flatMap((s) => s.days);
  const good = days.filter((d) => d.state === 'works').length;
  const who = callers.length ? namesList(callers) : 'The lads';
  const result = !days.length ? '' : good === days.length ? ' and got tee times every day ⛳' : ` — tee times on ${good} of ${plural(days.length, 'day')}`;
  return `📞 ${planName}: ${who} rang ${plural(courses, 'course')}${result}. Thanks${callers.length === 1 ? ` ${callers[0]}` : ''}!`;
}
