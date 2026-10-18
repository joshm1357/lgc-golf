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

const yearOrCreated = (h) => yearOf(h.label) ?? (h.created_at ? new Date(h.created_at).getFullYear() : null);
const byKey = (a, b) => (b.sort_key || 0) - (a.sort_key || 0);

/**
 * An honour board list, newest first. Entries made in the app keep exactly the order they always had (the order
 * they were added), so nothing moves for a group that has no history. Each history entry slots in just before the
 * first app entry from an earlier year; history without a year goes at the end.
 */
export function honourOrder(list) {
  const app = list.filter((h) => !h.imported).sort(byKey);
  const imp = list.filter((h) => h.imported).sort((a, b) => {
    const ya = yearOf(a.label) ?? -Infinity, yb = yearOf(b.label) ?? -Infinity;
    if (ya !== yb) return yb - ya;
    const ma = monthOf(a.label), mb = monthOf(b.label);
    if (ma !== mb) return mb - ma;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
  const out = [];
  let i = 0, j = 0;
  while (i < app.length || j < imp.length) {
    const yi = j < imp.length ? (yearOf(imp[j].label) ?? -Infinity) : null;
    const ya = i < app.length ? (yearOrCreated(app[i]) ?? Infinity) : null;
    if (j < imp.length && (i >= app.length || ya < yi)) out.push(imp[j++]);
    else out.push(app[i++]);
  }
  return out;
}

/** Split one pasted line into fields: tabs (from a spreadsheet), commas, semicolons or " - ". */
function fields(raw) {
  const line = raw.replace(/[\u00a0\u2007\u202f]/g, ' '); // non-breaking spaces from WhatsApp, Word and the like
  const sep = line.includes('\t') ? /\t+/ : line.includes(',') ? /\s*,\s*/ : line.includes(';') ? /\s*;\s*/ : /\s+[-–—]\s+/;
  return line.split(sep).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const HEADER = /^(year|years|when|label|date|season|name|player|players|trophy|trophies|winner|winners|winner\(s\)|handicap|hcp)$/i;
const looksLikeHeader = (f) => f.length > 0 && f.every((x) => HEADER.test(x));
/** The non-blank lines of a paste with their line numbers, without a header line at the top. */
function lines(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => { if (raw.trim()) out.push({ n: i + 1, raw: raw.trim() }); });
  if (out.length && looksLikeHeader(fields(out[0].raw))) out.shift();
  return out;
}

/** The names in a winners line ("Josh & Mike", "Josh M and Mike M"). */
export function winnerNames(text) {
  return String(text).replace(/\s+/g, ' ').split(/\s*(?:&|\+|\/|\band\b|,)\s*/i).map((x) => x.trim()).filter(Boolean);
}
/** Find players named in a winners line. Matches full name or nickname. */
export function matchPlayers(text, players) {
  const ids = [];
  for (const part of winnerNames(text).map((x) => x.toLowerCase())) {
    const hit = players.filter((p) => [p.name, p.nickname].filter(Boolean).some((n) => n.toLowerCase() === part));
    if (hit.length === 1 && !ids.includes(hit[0].id)) ids.push(hit[0].id);
  }
  return ids;
}

/** The past trip a label belongs to: only when the label is exactly a trip's name (a year alone could be any trip). */
export function matchTrip(label, trips) {
  const l = String(label || '').trim().toLowerCase();
  const byName = trips.filter((t) => (t.name || '').trim().toLowerCase() === l);
  return byName.length === 1 ? byName[0].id : null;
}

/** Is this winner already on the board (same trophy, label and winners)? */
export function sameHonour(a, b) {
  const k = (x) => [x.trophy ?? x.trophy_name, x.label, x.winners ?? x.winner_names].map((v) => String(v || '').trim().toLowerCase()).join('|');
  return k(a) === k(b);
}

/**
 * Past winners. Each line: year, trophy, winner(s) — or, when a trophy is picked for the whole list, year, winner(s).
 * Returns { rows, problems } — rows ready for import_honours, problems as plain words with the line number.
 */
export function parseHonours(text, { trophy = null, players = [], trips = [], board = [] } = {}) {
  const rows = [];
  const problems = [];
  lines(text).forEach(({ n, raw: line }) => {
    const f = fields(line);
    const label = f[0];
    const name = trophy || f[1];
    const winners = f.slice(trophy ? 1 : 2).join(' & ');
    if (!label || !name || !winners) { problems.push(`Line ${n}: needs ${trophy ? 'a year and the winner(s)' : 'a year, a trophy and the winner(s)'} — “${line}”`); return; }
    if (label.length > 30) { problems.push(`Line ${n}: “${label}” is too long for the year (30 letters max)`); return; }
    if (!yearOf(label)) { problems.push(`Line ${n}: put the year first, e.g. 2019 or “Hunter 2019” — “${line}”`); return; }
    const row = { label, trophy: name.slice(0, 60), winners: winners.slice(0, 200), player_ids: matchPlayers(winners, players), trip_id: matchTrip(label, trips) };
    row.unmatched = winnerNames(row.winners).length - row.player_ids.length;
    row.already = board.some((h) => sameHonour(row, h)) || rows.some((r) => sameHonour(row, r));
    rows.push(row);
  });
  return { rows, problems };
}

/** A date written the Australian way (1/6/2023), ISO (2023-06-01), "Jun 2023" or just "2023" → YYYY-MM-DD. */
export function parseDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/);
  if (m) return iso(m[3].length === 2 ? twoDigitYear(+m[3]) : +m[3], +m[2], +m[1]);
  m = t.toLowerCase().match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m && MONTHS.includes(m[1])) return iso(+m[2], MONTHS.indexOf(m[1]) + 1, 1);
  m = t.match(/^(19[5-9]\d|20\d\d)$/);
  if (m) return iso(+m[1], 1, 1);
  return null;
}
function twoDigitYear(yy) {
  const now = new Date().getFullYear() % 100;
  return yy > now ? 1900 + yy : 2000 + yy; // "99" is 1999, not 2099
}
/** A handicap as golfers write it: "+2" is a plus handicap (stored as −2). Null if it isn't one. */
export function readHandicap(s) {
  const t = String(s ?? '').trim();
  if (!/^[+-]?\d{1,2}(\.\d)?$/.test(t)) return null;
  const h = t.startsWith('+') ? -Number(t.slice(1)) : Number(t);
  return h < -10 || h > 54 ? null : h;
}
/** Today on this phone (not in UTC — early morning in Australia is still yesterday in UTC). */
export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function iso(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Past handicaps. Each line: player, date, handicap (any order of date and handicap is fine). */
export function parseHandicaps(text, { players = [], today = localToday(), existing = [] } = {}) {
  const rows = [];
  const problems = [];
  lines(text).forEach(({ n, raw: line }) => {
    const f = fields(line);
    if (f.length < 3) { problems.push(`Line ${n}: needs a player, a date and a handicap — “${line}”`); return; }
    const [who, a, b] = f;
    const hits = players.filter((p) => [p.name, p.nickname].filter(Boolean).some((x) => x.toLowerCase() === who.toLowerCase()));
    if (hits.length !== 1) { problems.push(`Line ${n}: ${hits.length ? `more than one player is called “${who}”` : `no player called “${who}” — add them first, or check the spelling`}`); return; }
    const isNum = (x) => /^[+-]?\d{1,2}(\.\d)?$/.test(x);
    const [d, h] = parseDate(a) && isNum(b) ? [a, b] : parseDate(b) && isNum(a) ? [b, a] : [null, null];
    const date = d && parseDate(d);
    if (!date) { problems.push(`Line ${n}: couldn’t read the date or handicap — “${line}” (try 1/6/2023, 14.2)`); return; }
    const handicap = readHandicap(h); // golfers write a plus handicap as +2
    if (date > today) { problems.push(`Line ${n}: ${date} is in the future`); return; }
    if (handicap == null) { problems.push(`Line ${n}: a handicap of ${h} doesn’t look right`); return; }
    const row = { player_id: hits[0].id, name: hits[0].name, date, handicap };
    const same = (x) => x.player_id === row.player_id && x.date === row.date && Number(x.handicap) === row.handicap;
    row.already = existing.some(same) || rows.some(same);
    rows.push(row);
  });
  return { rows, problems };
}
