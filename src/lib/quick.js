// Stage 7b: the quick round — pure helpers (tested in quick.test.js).
import { distanceM } from './geo.js';

/** Closest to the pin on every par 3; longest drive on the longest par 5 (by the map if it knows, else the first). */
export function defaultComps(holes = []) {
  const ctp = holes.filter((h) => Number(h.par) === 3).map((h) => h.n);
  const fives = holes.filter((h) => Number(h.par) === 5);
  let ld = fives[0]?.n;
  const measured = fives.filter((h) => h.tee && h.green);
  if (measured.length) ld = measured.reduce((a, b) => (distanceM(b.tee, b.green) > distanceM(a.tee, a.green) ? b : a)).n;
  return { ctp, ld: ld ? [ld] : [] };
}

/** Where someone came from: a club's code (?ref=…&p=cart) or another group's card (?from=<group>). */
export function sourceFrom(search = '') {
  const q = new URLSearchParams(search);
  const src = {};
  if (q.get('ref')) src.ref = q.get('ref').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (q.get('p')) src.placement = q.get('p');
  if (q.get('from')) { src.from_group = q.get('from').replace(/[^a-z0-9-]/g, '').slice(0, 60); src.placement = src.placement || 'card'; }
  return Object.keys(src).length ? src : null;
}

const SOURCE_KEY = 'lgc-source';
const SOURCE_DAYS = 30;
/** Remember where this phone last came from (for 30 days), so a group started from it can say so. */
export function rememberSource(src, now = Date.now()) {
  if (!src) return;
  try { localStorage.setItem(SOURCE_KEY, JSON.stringify({ ...src, at: now })); } catch { /* fine */ }
}
export function rememberedSource(now = Date.now()) {
  try {
    const s = JSON.parse(localStorage.getItem(SOURCE_KEY) || 'null');
    if (!s || !s.at || now - s.at > SOURCE_DAYS * 864e5) return null;
    const { at, ...src } = s; // eslint-disable-line no-unused-vars
    return src;
  } catch { return null; }
}
/** Used once (a group was started from it): forget it. */
export function forgetSource() {
  try { localStorage.removeItem(SOURCE_KEY); } catch { /* fine */ }
}

/** The link on every results card and invite: start your own group, counted as coming from this one. */
export function startOwnLink(groupSlug, base = typeof window !== 'undefined' ? `${window.location.origin}${import.meta.env.BASE_URL}` : '') {
  return `${base}#/start${groupSlug ? `?from=${encodeURIComponent(groupSlug)}` : ''}`;
}

/** The results, as text for the group chat. */
export function resultsText({ roundName, courseName, rows, format, groupSlug, base }) {
  const lines = rows.filter((r) => r.thru > 0).slice(0, 12).map((r, i) => {
    const score = format === 'ambrose' ? `${r.netToPar > 0 ? '+' : ''}${r.netToPar} net` : `${r.points} pts`;
    return `${i + 1}. ${r.name} — ${score}${r.finished ? '' : ` (thru ${r.thru})`}`;
  });
  return [`⛳ ${roundName}${courseName && !roundName.includes(courseName) ? ` at ${courseName}` : ''}`, ...lines, '',
    `Start your own group: ${startOwnLink(groupSlug, base)}`].join('\n');
}

/** Same date next year, on the same day of the week (52 weeks on). */
export function sameTimeNextYear(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 364);
  return d.toISOString().slice(0, 10);
}
