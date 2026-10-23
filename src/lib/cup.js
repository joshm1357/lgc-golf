// Team match play, Ryder Cup style (migration 050). All the maths here, as plain functions with tests (cup.test.js).
// A match: { format: 'singles' | 'ambrose', a_players, b_players, a_hcp, b_hcp, points, holes: { "1": "a"|"b"|"h" } }.
// Course holes: [{ n, par, si }] (the round's course).
import { strokesReceived } from './scoring.js';

const HOLES = 18;

/** The match handicap for one side: singles = the player's handicap; Ambrose = combined ÷ (2 × players). */
export function sideHandicap(format, handicaps) {
  const hs = (handicaps || []).map((h) => Number(h) || 0);
  if (!hs.length) return 0;
  if (format === 'ambrose') return Math.round((hs.reduce((s, h) => s + h, 0) / (2 * hs.length)) * 10) / 10;
  return Math.round(hs.reduce((s, h) => s + h, 0) / hs.length);
}

/** Shots in the match: the higher handicap side gets the difference, on the holes by stroke index. */
export function shots(match) {
  const diff = Math.round(Math.abs((Number(match.a_hcp) || 0) - (Number(match.b_hcp) || 0)));
  const side = diff === 0 ? null : Number(match.a_hcp) > Number(match.b_hcp) ? 'a' : 'b';
  return { side, diff };
}

/** How many shots a side gets on a hole (0 if none). */
export function shotsOnHole(match, hole) {
  const { side, diff } = shots(match);
  if (!side || !hole) return { side: null, n: 0 };
  const n = strokesReceived(diff, hole.si);
  return n > 0 ? { side, n } : { side: null, n: 0 };
}

/**
 * Where a match stands. up > 0 means side A is ahead.
 * ov28 (walkthrough: "Won 10&2 can't happen in match play"): holes count in order and the match stops the moment it's
 * decided — 6 UP with 5 to play is "won 6&5", whatever was typed in for the holes after. `extra` = holes scored after
 * the match ended (they don't count).
 */
export function matchState(match) {
  const holes = match?.holes || {};
  let a = 0; let b = 0; let played = 0; let extra = 0; let over = false;
  for (let n = 1; n <= HOLES; n++) {
    const r = holes[String(n)];
    if (!r) continue;
    if (over) { extra++; continue; }
    played++;
    if (r === 'a') a++;
    else if (r === 'b') b++;
    if (Math.abs(a - b) > HOLES - played) over = true;
  }
  const up = a - b;
  const remaining = HOLES - played;
  const lead = Math.abs(up);
  const leader = up > 0 ? 'a' : up < 0 ? 'b' : null;
  const decided = lead > remaining || remaining === 0;
  const winner = decided ? (leader || 'h') : null;
  const dormie = !decided && lead > 0 && lead === remaining;
  return { up, lead, leader, played, remaining, decided, winner, dormie, started: played > 0, extra };
}

/** Points each side has from this match: final once decided; `projected` counts it as if it ended now. */
export function matchPoints(match, { projected = false } = {}) {
  const s = matchState(match);
  const p = Number(match.points) || 0;
  const res = s.decided ? s.winner : projected && s.started ? (s.leader || 'h') : null;
  if (res === 'a') return { a: p, b: 0 };
  if (res === 'b') return { a: 0, b: p };
  if (res === 'h') return { a: p / 2, b: p / 2 };
  return { a: 0, b: 0 };
}

/** Words for where a match stands, e.g. "Blue 2 UP thru 7", "Gold won 3&2", "Halved". names = { a, b }. */
export function matchText(match, names = { a: 'A', b: 'B' }) {
  const s = matchState(match);
  if (!s.started) return 'Not started';
  if (s.decided) {
    if (s.winner === 'h') return 'Halved';
    const who = names[s.winner];
    return s.remaining > 0 ? `${who} won ${s.lead}&${s.remaining}` : `${who} won ${s.lead} UP`;
  }
  if (!s.leader) return `All square thru ${s.played}`;
  return s.dormie ? `${names[s.leader]} dormie ${s.lead}` : `${names[s.leader]} ${s.lead} UP thru ${s.played}`;
}

/** Points for a set of matches: what's won, and the projection (in-progress matches as they stand). */
export function cupTotals(matches) {
  const won = { a: 0, b: 0 }; const proj = { a: 0, b: 0 }; let total = 0;
  for (const m of matches || []) {
    total += Number(m.points) || 0;
    const w = matchPoints(m); const p = matchPoints(m, { projected: true });
    won.a += w.a; won.b += w.b; proj.a += p.a; proj.b += p.b;
  }
  return { won, projected: proj, total };
}

/** Points needed to win the cup outright: more than half of everything on offer. */
export function toWin(total) {
  return total > 0 ? Math.floor(total / 2) + 0.5 : 0;
}

/** "14½" style. */
export function pts(n) {
  const whole = Math.floor(n);
  return n - whole >= 0.5 ? `${whole || ''}½` || '½' : String(whole);
}

/** The next hole to score: the first hole after the last one with a result (1 if none), capped at 18. */
export function nextHole(match) {
  const holes = match?.holes || {};
  let last = 0;
  for (let n = 1; n <= HOLES; n++) if (holes[String(n)]) last = n;
  return Math.min(HOLES, last + 1);
}

/**
 * The Cup's verdict in words (ov28, walkthrough W1: no "6½ to win" on a finished Cup, and say so when it isn't done).
 *   matches: every match in the Cup; total: points in the whole Cup (0 = the matches' own points);
 *   names: { a, b }; finished: the trip (or the Cup's rounds) is over.
 * Returns { status, text, a, b, played, total, winner }:
 *   'won'        "Team Blue win 7–5"          (a side has more than half the points)
 *   'halved'     "All square 6–6"             (every point played, level)
 *   'unfinished' "Not finished: 6 of 12 points played · Blue 4–2"   (finished trip, points left unplayed)
 *   'live'       "Blue 4 – 2 Red"             (still going)
 *   'none'       ""                           (no matches)
 */
export function cupVerdict({ matches = [], total = 0, names = { a: 'A', b: 'B' }, finished = false } = {}) {
  const t = cupTotals(matches);
  const all = Number(total) || t.total;
  const a = t.won.a;
  const b = t.won.b;
  const played = (matches || []).filter((m) => matchState(m).decided).reduce((s, m) => s + (Number(m.points) || 0), 0);
  const base = { a, b, played, total: all, winner: null };
  if (!(matches || []).length) return { ...base, status: 'none', text: '' };
  const need = toWin(all);
  if (need && (a >= need || b >= need)) {
    const w = a >= need ? 'a' : 'b';
    return { ...base, status: 'won', winner: w, text: `${names[w]} win ${pts(Math.max(a, b))}–${pts(Math.min(a, b))}` };
  }
  if (played >= all && all > 0) {
    if (a === b) return { ...base, status: 'halved', text: `All square ${pts(a)}–${pts(b)}` };
    const w = a > b ? 'a' : 'b';
    return { ...base, status: 'won', winner: w, text: `${names[w]} win ${pts(Math.max(a, b))}–${pts(Math.min(a, b))}` };
  }
  if (finished) return { ...base, status: 'unfinished', text: `Not finished: ${pts(played)} of ${pts(all)} points played · ${names.a} ${pts(a)}–${pts(b)} ${names.b}` };
  return { ...base, status: 'live', text: `${names.a} ${pts(a)} – ${pts(b)} ${names.b}` };
}
