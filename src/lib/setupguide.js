// "Set up your trip" (guided setup, 21 Oct 2026): which of the five steps are done, and what to do next.
// Pure functions so the screen (screens/SetupGuide.jsx) stays simple and this is tested (setupguide.test.js).

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The trip being set up: the newest one that isn't finished (locked). */
export function guideTrip(trips) {
  return (trips || []).find((t) => t.status !== 'locked') || null;
}

/** Every day of the trip, as 'YYYY-MM-DD' (at most 10). No start date: none. */
export function tripDays(trip) {
  const a = parse(trip?.start_date);
  if (!a) return [];
  const b = parse(trip.end_date) || a;
  const out = [];
  for (let d = new Date(a); d <= b && out.length < 10; d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
}

/** "Friday 23 Oct" */
export function dayLabel(day) {
  const d = parse(day);
  return d ? `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` : 'No date';
}

/** "Friday — Cypress Lakes" (the course's name without "Golf Club" and the like). */
export function roundName(day, courseName) {
  const d = parse(day);
  const short = String(courseName || '').replace(/\s+(golf\s*(&|and)?\s*(country\s+)?club|golf\s+course|golf\s+links|country\s+club|gc)\b.*$/i, '').trim() || courseName || 'Round';
  return d ? `${DOW[d.getDay()]} — ${short}` : short;
}

/**
 * The five steps, each { key, title, done, summary, optional }.
 * data: { trips, courses, rounds, players }; on: { cup, side_comps } (features switched on).
 */
export function setupSteps(data, on = {}) {
  const trip = guideTrip(data.trips);
  const days = tripDays(trip);
  const rounds = trip ? (data.rounds || []).filter((r) => r.trip_id === trip.id) : [];
  const courses = data.courses || [];
  const players = (data.players || []).filter((p) => p.approved !== false);
  const missingDays = days.filter((d) => !rounds.some((r) => r.play_date === d));
  const noTeam = on.cup ? players.filter((p) => !p.cup_side).length : 0;
  return [
    {
      key: 'trip', title: 'Your trip', done: !!trip && !!trip.start_date,
      summary: !trip ? 'Name it and set the dates.' : !trip.start_date ? `${trip.name} — add the dates.` : `${trip.name} · ${dayLabel(trip.start_date)}${days.length > 1 ? ` to ${dayLabel(days[days.length - 1])}` : ''}`,
    },
    {
      key: 'courses', title: 'Courses', done: courses.length > 0,
      summary: courses.length ? courses.map((c) => c.name).join(', ') : 'Find the courses you’re playing.',
    },
    {
      key: 'rounds', title: days.length > 1 ? 'Rounds — one a day' : 'Rounds', done: rounds.length > 0,
      summary: !rounds.length ? 'Pick a course and a format for each day.'
        : `${rounds.length} round${rounds.length === 1 ? '' : 's'}${missingDays.length ? ` · nothing on ${missingDays.map((d) => dayLabel(d).split(' ')[0]).join(', ')} (that’s fine for a rest day)` : ''}`,
    },
    {
      key: 'players', title: 'Players', done: players.length >= 2 && noTeam === 0,
      summary: players.length < 2 ? 'Share the join link in the group chat.'
        : `${players.length} in${noTeam ? ` · ${noTeam} not on a team yet` : ''}`,
    },
    {
      key: 'extras', title: 'Extras', optional: true, done: rounds.some((r) => (r.ctp_holes || []).length || (r.ld_holes || []).length || (r.own_comps || []).length),
      summary: 'Closest to the pin, longest drive and your own side comps' + (on.cup ? ', and the Cup' : '') + '. Optional.',
    },
  ];
}

/** What to do next: the first step not done (skipping the optional one), else the next round to start. */
export function nextAction(steps, rounds, todayIso) {
  const todo = steps.find((s) => !s.done && !s.optional);
  if (todo) return { kind: 'step', key: todo.key, label: todo.title };
  const live = (rounds || []).find((r) => r.status === 'live');
  if (live) return { kind: 'live', round: live, label: `${live.name} is live` };
  const upcoming = (rounds || []).filter((r) => r.status === 'setup')
    .sort((a, b) => String(a.play_date || '').localeCompare(String(b.play_date || '')));
  const next = upcoming.find((r) => !r.play_date || r.play_date >= todayIso) || upcoming[0];
  if (next) return { kind: 'start', round: next, label: next.play_date === todayIso ? `${next.name} is today — start it on the first tee` : `All set. Next up: ${next.name}` };
  return { kind: 'done', label: 'All set.' };
}
