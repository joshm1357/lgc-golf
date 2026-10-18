// Stage 6: history from before the app — past winners and past handicaps, typed in or pasted as a list
// (from a spreadsheet, a note or the group chat). Pure functions, so they can be tested.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The year in a label like "2019", "Nov 2024" or "Bowral 2023" (null if none). */
export function yearOf(label) {
  const m = String(label || '').match(/\b(19[5-9]\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
}
function monthOf(label) {
  const m = String(label || '').toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  return m ? MONTHS.indexOf(m[1]) + 1 : 0;
}

/** Newest first, mixing history and app-made entries: by the year (and month) in the label, then the order added. */
export function honourSort(a, b) {
  const ya = yearOf(a.label) ?? new Date(a.created_at || 0).getFullYear();
  const yb = yearOf(b.label) ?? new Date(b.created_at || 0).getFullYear();
  if (ya !== yb) return yb - ya;
  const ma = monthOf(a.label), mb = monthOf(b.label);
  if (ma !== mb) return mb - ma;
  if ((a.sort_key || 0) !== (b.sort_key || 0)) return (b.sort_key || 0) - (a.sort_key || 0);
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
}

/** Split one pasted line into fields: tabs (from a spreadsheet), commas, semicolons or " - ". */
function fields(line) {
  const sep = line.includes('\t') ? /\t+/ : line.includes(',') ? /\s*,\s*/ : line.includes(';') ? /\s*;\s*/ : /\s+[-–—]\s+/;
  return line.split(sep).map((x) => x.trim()).filter(Boolean);
}
const looksLikeHeader = (f) => /^(year|when|label|date|season)$/i.test(f[0] || '') || /^(name|player)$/i.test(f[0] || '');

/** Find players named in a winners line ("Josh & Mike", "Josh M and Mike M"). Matches full name or nickname. */
export function matchPlayers(text, players) {
  const parts = String(text).split(/\s*(?:&|\+|\/|\band\b|,)\s*/i).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ids = [];
  for (const part of parts) {
    const hit = players.filter((p) => [p.name, p.nickname].filter(Boolean).some((n) => n.toLowerCase() === part));
    if (hit.length === 1 && !ids.includes(hit[0].id)) ids.push(hit[0].id);
  }
  return ids;
}

/** The past trip a label belongs to: same name, or the only trip that started that year. */
export function matchTrip(label, trips) {
  const l = String(label || '').trim().toLowerCase();
  const byName = trips.filter((t) => (t.name || '').trim().toLowerCase() === l);
  if (byName.length === 1) return byName[0].id;
  const y = yearOf(label);
  if (!y || String(label).trim() !== String(y)) return null; // "Nov 2024" could be one of two trips — leave it
  const inYear = trips.filter((t) => t.start_date && Number(t.start_date.slice(0, 4)) === y);
  return inYear.length === 1 ? inYear[0].id : null;
}

/**
 * Past winners. Each line: year, trophy, winner(s) — or, when a trophy is picked for the whole list, year, winner(s).
 * Returns { rows, problems } — rows ready for import_honours, problems as plain words with the line number.
 */
export function parseHonours(text, { trophy = null, players = [], trips = [] } = {}) {
  const rows = [];
  const problems = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const f = fields(line);
    if (i === 0 && looksLikeHeader(f)) return;
    const n = i + 1;
    const label = f[0];
    const name = trophy || f[1];
    const winners = f.slice(trophy ? 1 : 2).join(' & ');
    if (!label || !name || !winners) { problems.push(`Line ${n}: needs ${trophy ? 'a year and the winner(s)' : 'a year, a trophy and the winner(s)'} — “${line}”`); return; }
    if (label.length > 30) { problems.push(`Line ${n}: “${label}” is too long for the year (30 letters max)`); return; }
    rows.push({ label, trophy: name.slice(0, 60), winners: winners.slice(0, 200), player_ids: matchPlayers(winners, players), trip_id: matchTrip(label, trips) });
  });
  return { rows, problems };
}

/** A date written the Australian way (1/6/2023), ISO (2023-06-01), "Jun 2023" or just "2023" → YYYY-MM-DD. */
export function parseDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = t.toLowerCase().match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m && MONTHS.includes(m[1])) return iso(+m[2], MONTHS.indexOf(m[1]) + 1, 1);
  m = t.match(/^(19[5-9]\d|20\d\d)$/);
  if (m) return iso(+m[1], 1, 1);
  return null;
}
function iso(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Past handicaps. Each line: player, date, handicap (any order of date and handicap is fine). */
export function parseHandicaps(text, { players = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const rows = [];
  const problems = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const f = fields(line);
    if (i === 0 && looksLikeHeader(f)) return;
    const n = i + 1;
    if (f.length < 3) { problems.push(`Line ${n}: needs a player, a date and a handicap — “${line}”`); return; }
    const [who, a, b] = f;
    const hits = players.filter((p) => [p.name, p.nickname].filter(Boolean).some((x) => x.toLowerCase() === who.toLowerCase()));
    if (hits.length !== 1) { problems.push(`Line ${n}: ${hits.length ? `more than one player is called “${who}”` : `no player called “${who}” — add them first, or check the spelling`}`); return; }
    const isNum = (x) => /^[+-]?\d{1,2}(\.\d)?$/.test(x);
    const [d, h] = parseDate(a) && isNum(b) ? [a, b] : parseDate(b) && isNum(a) ? [b, a] : [null, null];
    const date = d && parseDate(d);
    if (!date) { problems.push(`Line ${n}: couldn’t read the date or handicap — “${line}” (try 1/6/2023, 14.2)`); return; }
    const handicap = Number(h.replace('+', '-')); // golfers write a plus handicap as +2
    if (date > today) { problems.push(`Line ${n}: ${date} is in the future`); return; }
    if (handicap < -10 || handicap > 54) { problems.push(`Line ${n}: a handicap of ${h} doesn’t look right`); return; }
    rows.push({ player_id: hits[0].id, name: hits[0].name, date, handicap });
  });
  return { rows, problems };
}
