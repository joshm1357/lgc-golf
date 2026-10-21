// "Set up your trip" (guided setup, 21 Oct 2026): which of the steps are done, and what to do next.
// Pure functions so the screen (screens/SetupGuide.jsx) stays simple and this is tested (setupguide.test.js).

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const todayStr = () => iso(new Date());

/**
 * The trips that could be the one being set up: anything not over yet (its last day is today or later), nearest
 * first, whatever its status ("locked" also means "locked in, not started" for a trip from the planner); then any
 * open trip with no dates yet. Past trips are never offered, so they can't be renamed by mistake.
 */
export function upcomingTrips(trips, today = todayStr()) {
  const list = trips || [];
  const dated = list.filter((t) => (t.end_date || t.start_date) && (t.end_date || t.start_date) >= today)
    .sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')));
  const undated = list.filter((t) => !t.start_date && !t.end_date && t.status === 'active');
  return [...dated, ...undated];
}

/** The trip being set up: the nearest one that isn't over (see upcomingTrips), or null. */
export function guideTrip(trips, today = todayStr()) {
  return upcomingTrips(trips, today)[0] || null;
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
 * The steps, each { key, title, done, summary, optional }.
 * data: { trips, courses, rounds, players, comps? (the trip's comps, migration 067) }; on: { cup, side_comps } (features switched on); trip: the trip being set
 * up (default: guideTrip).
 */
export function setupSteps(data, on = {}, trip = guideTrip(data.trips)) {
  const days = tripDays(trip);
  const rounds = trip ? (data.rounds || []).filter((r) => r.trip_id === trip.id) : [];
  const courses = data.courses || [];
  const players = (data.players || []).filter((p) => p.approved !== false);
  const missingDays = days.filter((d) => !rounds.some((r) => r.play_date === d));
  const noTeam = on.cup ? players.filter((p) => !p.cup_side).length : 0;
  const comps = (data.comps || []).filter((c) => !c.retired && (!trip || c.trip_id === trip.id));
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
      key: 'comps', title: 'What are you playing for?', optional: true, done: comps.length > 0,
      summary: comps.length ? comps.map((c) => c.name).join(', ') : 'A trophy over the weekend, Ambrose teams, a Cup… Optional.',
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

/**
 * What to do next: the first step not done (skipping the optional one); then the next round — who's playing it if
 * nobody is yet, "start it" only on its day, otherwise "all set". hasPlayers(round) says if a round has its
 * players / teams / pairs.
 */
export function nextAction(steps, rounds, todayIso, hasPlayers = () => true) {
  const todo = steps.find((s) => !s.done && !s.optional);
  if (todo) return { kind: 'step', key: todo.key, label: todo.title };
  const live = (rounds || []).find((r) => r.status === 'live');
  if (live) return { kind: 'live', round: live, label: `${live.name} is live` };
  // Dated rounds in date order, rounds with no date last.
  const upcoming = (rounds || []).filter((r) => r.status === 'setup')
    .sort((a, b) => (a.play_date ? 0 : 1) - (b.play_date ? 0 : 1) || String(a.play_date || '').localeCompare(String(b.play_date || '')));
  const next = upcoming.find((r) => !r.play_date || r.play_date >= todayIso) || upcoming[0];
  if (!next) return { kind: 'done', label: 'All set.' };
  if (!hasPlayers(next)) return { kind: 'players', round: next, label: `${next.name}: pick who’s playing` };
  if (next.play_date === todayIso) return { kind: 'start', round: next, label: `${next.name} is today — start it on the first tee` };
  return { kind: 'ready', round: next, label: `All set. Next up: ${next.name}${next.play_date ? ` on ${dayLabel(next.play_date)}` : ''} — start it on the day.` };
}
