// The tee-time window for a group (Stage 16.2, trip finder). Pure maths, no screens.
//
//   1. Groups: players ÷ 4, rounded up, as even as possible (13 → 4, 3, 3, 3; never a group of 5).
//   2. Start interval: 10 minutes, or the course's own if known.
//   3. Round length: 4 h 30 (18 holes) or 2 h 15 (9 holes), or the course's own if known.
//   4. Earliest first tee: the latest arrival (leave time + drive) + 30 minutes.
//   5. Latest first tee: the finish-by time − the round length − (groups − 1) × interval.
//   6. The window, or "doesn't fit" with the reason ("Newcastle players arrive 9:40, too late for a 2 pm finish").
//
// Times are minutes after midnight (6:00 am = 360). 'HH:MM' strings go through toMin / fromMin.

export const DEFAULT_INTERVAL = 10;
export const ROUND_MINUTES = { 18: 270, 9: 135 };
export const ARRIVE_BEFORE = 30;
export const DEFAULT_LEAVE = '06:00';
export const DEFAULT_FINISH = '17:00';

/** 'HH:MM' (or 'H:MM') → minutes after midnight; null if it isn't a time. */
export function toMin(t) {
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  const m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(String(t ?? ''));
  if (!m || Number(m[1]) > 23) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes → 'HH:MM' (for storing). */
export function fromMin(min) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes → '9:15' (12-hour clock, no am/pm — for windows like "9:15–11:40"). */
export function clock(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60) % 12 || 12;
  return `${h}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes → '2 pm' / '2:30 pm' / '9:40 am'. */
export function ampm(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

/** Group sizes for n players: as few groups of 4 as possible, as even as possible. 13 → [4, 3, 3, 3]. */
export function teeGroupSizes(players) {
  const n = Math.max(0, Math.floor(Number(players) || 0));
  if (!n) return [];
  const groups = Math.ceil(n / 4);
  const base = Math.floor(n / groups);
  const extra = n % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * The window for the first tee time.
 *   players      how many are playing
 *   holes        9 or 18 (default 18)
 *   interval     minutes between groups (default 10)
 *   roundMinutes how long a round takes (default by holes)
 *   starts       [{ label, leave: 'HH:MM', finish: 'HH:MM', driveMin }] — where people are coming from
 * Returns { fits, earliest, latest, text, sizes, groups, interval, roundMinutes, lastOff, arrival, finish, reason }.
 */
export function teeWindow({ players, holes = 18, interval, roundMinutes, starts = [] } = {}) {
  const sizes = teeGroupSizes(players);
  const iv = Number(interval) > 0 ? Number(interval) : DEFAULT_INTERVAL;
  const round = Number(roundMinutes) > 0 ? Number(roundMinutes) : ROUND_MINUTES[Number(holes) === 9 ? 9 : 18];
  const list = (starts.length ? starts : [{ label: 'Everyone' }]).map((s) => {
    const leave = toMin(s.leave ?? DEFAULT_LEAVE) ?? toMin(DEFAULT_LEAVE);
    const finish = toMin(s.finish ?? DEFAULT_FINISH) ?? toMin(DEFAULT_FINISH);
    const drive = Math.max(0, Math.round(Number(s.driveMin) || 0));
    return { label: s.label || 'Everyone', leave, finish, drive, arrive: leave + drive };
  });
  // The last to arrive, and the earliest anyone has to be finished.
  const last = list.reduce((a, b) => (b.arrive > a.arrive ? b : a));
  const first = list.reduce((a, b) => (b.finish < a.finish ? b : a));
  const groups = Math.max(1, sizes.length);
  const earliest = last.arrive + ARRIVE_BEFORE;
  const latest = first.finish - round - (groups - 1) * iv;
  const fits = sizes.length > 0 && earliest <= latest;
  const out = {
    fits, earliest, latest, sizes, groups: sizes.length, interval: iv, roundMinutes: round,
    lastOff: latest + (groups - 1) * iv,
    arrival: { label: last.label, at: last.arrive },
    finish: { label: first.label, at: first.finish },
    text: fits ? `${clock(earliest)}–${clock(latest)}` : null,
    reason: null,
  };
  if (!sizes.length) out.reason = 'Nobody’s playing yet';
  else if (!fits) {
    const who = list.length > 1 || last.label !== 'Everyone' ? `${last.label} players arrive` : 'Everyone arrives';
    out.reason = last.drive > 0 || list.length > 1
      ? `${who} ${clock(last.arrive)}, too late for a ${ampm(first.finish)} finish`
      : `Not enough time for ${groups} group${groups === 1 ? '' : 's'} to finish by ${ampm(first.finish)}`;
  }
  return out;
}
