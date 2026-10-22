// ai-helper — small shared helpers: making database text safe for the model, and dates on the Sydney calendar.
// Used by logic.ts, plan.ts and live.ts (and re-exported by logic.ts).

export const TZ = 'Australia/Sydney';
export const FORMATS = ['stableford', 'ambrose', 'stroke', 'fourball'];
export const FORMAT_NAMES: Record<string, string> = { stableford: 'Stableford', ambrose: 'Ambrose', stroke: 'Stroke play', fourball: '4BBB' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown) => typeof s === 'string' && UUID.test(s);

// ------------------------------------------------------------------ Text from the database is data, never orders

/** A name or label from the database, made safe to show the model: no angle brackets (so it can't open or close a
 *  tag), no control characters, one line, cut to `max`. */
export function clean(s: unknown, max = 80): string {
  return String(s ?? '')
    .replace(/[<>]/g, ' ')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Wrap a tool's result for the model: JSON inside clearly marked <data> tags. Any < or > left in the JSON is
 *  escaped too, so nothing inside can end the tag early. */
export function asData(source: string, value: unknown): string {
  const json = JSON.stringify(value ?? null).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `<data source="${clean(source, 40)}">${json}</data>`;
}

// ------------------------------------------------------------------ Dates and the Sydney calendar

const pad = (n: number) => String(n).padStart(2, '0');
/** Wall-clock parts of `at` in time zone `tz`. */
export function zoned(at: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}
const offsetAt = (at: number, tz: string) => {
  const z = zoned(at, tz);
  return Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s) - Math.floor(at / 1000) * 1000;
};
/** The moment (UTC ISO) the current day or month began in `tz`. */
export function zonedStart(now: Date, unit: 'day' | 'month', tz = TZ): string {
  const z = zoned(now.getTime(), tz);
  const local = Date.UTC(z.y, z.m - 1, unit === 'month' ? 1 : z.d);
  const guess = local - offsetAt(now.getTime(), tz);
  return new Date(local - offsetAt(guess, tz)).toISOString();
}
/** Today's date in `tz`, as YYYY-MM-DD. */
export function zonedToday(now: Date, tz = TZ): string {
  const z = zoned(now.getTime(), tz);
  return `${z.y}-${pad(z.m)}-${pad(z.d)}`;
}
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "Wednesday 21 October 2026" */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}
/** A real calendar date written YYYY-MM-DD, or null. */
export function isoDate(s: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : null;
}
export const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
/** `iso` plus `n` days. */
export function addDays(iso: string, n: number): string {
  return new Date((dayNumber(iso) + n) * 86400000).toISOString().slice(0, 10);
}
