// "Your weekend" (R1, Josh 23 Oct 2026 — walkthrough review option A) and the guest view (R2 option A).
// The card at the top of a locked-in trip's page, for every player: dates and the house address (tap for maps); each
// day's course, tee time and your group; your car; paid and owed. Then "Your to-dos". Everything else folds under
// "More about this trip". Pure functions here (tested in yourweekend.test.js); the card is components/YourWeekend.jsx.
import { fmtRange, mapsLink, daysUntil, todayISO } from './plan.js';
import { teeWords } from '../../supabase/functions/_shared/runup.js';
import { formatName } from './board.js';

const firstName = (p) => String(p?.nickname || p?.name || '').trim().split(/\s+/)[0] || '';
const nameList = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const shortDay = (iso) => fmtRange(iso).replace(/ \d{4}$/, ''); // "Fri 30 Oct"

const STAY_WORDS = /house|stay|accom|airbnb|motel|hotel|villa|cabin|cottage|lodge|resort|apartment|where we.?re staying/i;

/**
 * Where we're staying, for the maps link: the plan's address, else an info card that looks like the stay and has an
 * address, else the town. → { text, maps, isAddress } or null.
 */
export function stayAddress(plan, items = []) {
  if (plan?.address) return { text: plan.address, maps: mapsLink(plan.address), isAddress: true };
  const card = (items || []).find((i) => (i.kind === 'info' || i.kind === 'day') && i.address && STAY_WORDS.test(`${i.title || ''} ${i.body || ''}`))
    || (items || []).find((i) => i.kind === 'info' && i.address);
  if (card) return { text: card.address, maps: mapsLink(card.address), isAddress: true, title: card.title || null };
  if (plan?.location_name) return { text: plan.location_name, maps: mapsLink(plan.location_name), isAddress: false };
  return null;
}

/** "7 days to go" / "Tomorrow" / "Today’s the day" / "" */
export function toGoWords(start, today = todayISO()) {
  const n = start ? daysUntil(start, today) : null;
  if (n == null) return '';
  if (n <= 0) return 'Today’s the day';
  if (n === 1) return 'Tomorrow';
  return `${n} days to go`;
}

/**
 * Each day of the trip with my tee time and group.
 *   rounds: the trip's rounds; tees: tee_groups rows ({ round_id, tee_time, player_ids }); me: my player id.
 * → [{ date, label: "Fri 30 Oct", rounds: [{ round, course, courseName, format, tee: "7:52am" | null,
 *       group: ["Bo", "Cy"] (the others in my group), teeGroup }] }]
 */
export function weekendDays({ rounds = [], coursesById = {}, tees = [], me = null, playersById = {} } = {}) {
  const sorted = [...(rounds || [])].sort((a, b) => String(a.play_date || '9999').localeCompare(String(b.play_date || '9999'))
    || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const days = [];
  for (const r of sorted) {
    const date = r.play_date ? String(r.play_date).slice(0, 10) : null;
    let day = days.find((d) => d.date === date);
    if (!day) days.push(day = { date, label: date ? shortDay(date) : 'Date to come', rounds: [] });
    const mine = (tees || []).filter((t) => t.round_id === r.id && (t.player_ids || []).includes(me))
      .sort((a, b) => String(a.tee_time || '').localeCompare(String(b.tee_time || '')))[0] || null;
    const course = coursesById[r.course_id] || null;
    day.rounds.push({
      round: r, course, courseName: course?.name || r.name || 'Course to come', format: formatName(r.format) || '',
      tee: mine?.tee_time ? teeTime(mine.tee_time) : null,
      group: mine ? (mine.player_ids || []).filter((id) => id !== me).map((id) => firstName(playersById[id])).filter(Boolean) : [],
      teeGroup: mine,
    });
  }
  return days;
}

/** "07:52" → "7:52am", "13:05" → "1:05pm". */
export function teeTime(hhmm) {
  const w = teeWords(hhmm);
  return /^\d{1,2}:\d{2}$/.test(w) ? `${w}am` : w;
}

/** "7:52am with Bo and Cy" / "7:52am" / "with Bo and Cy" / "" */
export function teeLine(r) {
  if (!r) return '';
  const g = r.group?.length ? `with ${nameList(r.group)}` : '';
  return [r.tee, g].filter(Boolean).join(' ');
}

/**
 * Your car in a few words, from lib/runup.js carsView.
 *   "You're driving · 2 seats free · pick-up Leichhardt 6:30am" / "Josh's car · pick-up Leichhardt 6:30am Fri" /
 *   "You've asked for a lift" / null (nothing sorted).
 */
export function carWords(cars, me, playersById = {}) {
  if (!cars) return null;
  const c = cars.myCar;
  if (c) {
    const pick = c.pickup ? ` · pick-up ${c.pickup}` : '';
    if (c.driverId === me) return `You’re driving${c.free ? ` · ${c.free} seat${c.free === 1 ? '' : 's'} free` : ''}${pick}`;
    const d = firstName(playersById[c.driverId]);
    return `${d ? `${d}’s car` : c.name}${pick}`;
  }
  if (cars.iNeedLift) return 'You’ve asked for a lift';
  return null;
}

/** R2: the guest's heading — "You're Josh's guest for the L.G.C long weekend". */
export function guestHeading(plan, organiser) {
  const who = firstName(organiser);
  return `You’re ${who ? `${who}’s` : 'a'} guest for ${plan?.name ? `the ${String(plan.name).replace(/^the\s+/i, '')}` : 'the trip'}`;
}

/**
 * The to-dos a guest sees (R2): never one without a button. Guests don't reply to votes, check handicaps for the
 * group's records, tip or open Organise for jobs — so only the money (its Pay button goes to "I've paid").
 */
export function guestTodos(todos = []) {
  return (todos || []).filter((t) => t.action === 'deposit');
}
