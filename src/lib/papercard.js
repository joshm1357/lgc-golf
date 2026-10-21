// Paper card entry (Stage 11c, full desktop): type a pile of paper scorecards in at a laptop, one row per player
// (or team), Tab along the holes. Pure functions, tested in papercard.test.js; the screen is screens/PaperCard.jsx.
//
// Plain words:
//   - Who has a row: Ambrose → each team (one team score per hole); 4BBB → each player in each pair (their own
//     score, off their own handicap); Stableford and stroke play → each player in the round. Same as score entry.
//   - What you can type in a box: the strokes (1–20), or P (also - or X) for a pick-up. Ambrose has no pick-ups —
//     the team always has a score. An empty box means "not entered", never a zero.
//   - Paste a whole row of the card (e.g. "5 4 3 6 …", with or without the Out / In / Total) into the first box and
//     it fills the row.
//   - Only boxes that differ from what's saved are sent, so going back over a card never re-saves it.
import { stablefordStatus, strokeStatus, ambroseStatus } from './scoring.js';
import { dropTotals } from './paste.js';

const nameOf = (p) => (p ? p.nickname || p.name : '?');

/** The rows of the card: [{ id, type: 'player'|'team', name, hcp }] in the order a card would list them. */
export function cardSubjects({ round, teamsByRound = {}, roundPlayers = {}, playersById = {} }) {
  if (!round) return [];
  const teams = teamsByRound[round.id] || [];
  if (round.format === 'ambrose') return teams.map((t) => ({ id: t.id, type: 'team', name: t.name, hcp: Number(t.handicap) || 0 }));
  if (round.format === 'fourball') {
    const hcpOf = Object.fromEntries((roundPlayers[round.id] || []).map((rp) => [rp.player_id, rp.playing_handicap]));
    return teams.flatMap((t) => (t.players || []).filter(Boolean).map((p) => ({
      id: p.id, type: 'player', name: `${nameOf(p)} (${t.name})`, hcp: Number(hcpOf[p.id] ?? p.handicap ?? 0),
    })));
  }
  return (roundPlayers[round.id] || []).map((rp) => ({
    id: rp.player_id, type: 'player', name: nameOf(playersById[rp.player_id]), hcp: Number(rp.playing_handicap ?? playersById[rp.player_id]?.handicap ?? 0),
  }));
}

/**
 * What someone typed in one box.
 * Returns { empty: true } | { strokes, picked_up: false } | { strokes: null, picked_up: true } | { error }.
 */
export function readCell(text, format) {
  const t = String(text ?? '').trim();
  if (!t) return { empty: true };
  if (/^[pPxX-]$/.test(t)) {
    if (format === 'ambrose') return { error: 'No pick-ups in Ambrose — put the team’s score' };
    return { strokes: null, picked_up: true };
  }
  if (!/^\d{1,2}$/.test(t)) return { error: `“${t}” isn’t a score — type the strokes, or P for a pick-up` };
  const n = Number(t);
  if (n < 1 || n > 20) return { error: `${n} isn’t a score — 1 to 20` };
  return { strokes: n, picked_up: false };
}

/** How a saved score shows in a box: '5', 'P' or ''. */
export function cellText(score) {
  if (!score) return '';
  if (score.picked_up) return 'P';
  return score.strokes == null ? '' : String(score.strokes);
}

/** A whole row pasted into one box: the scores across, Out / In / Total dropped. Returns null if it isn't a row. */
export function parseCardLine(text, holeCount) {
  const cells = String(text || '').trim().split(/[\t,; ]+/).filter(Boolean);
  if (cells.length < 2) return null;
  if (!cells.every((c) => /^(\d{1,2}|[pPxX-])$/.test(c))) return null;
  const nums = cells.map((c) => (/^\d+$/.test(c) ? Number(c) : c));
  // Totals only ever come as numbers; drop them by position like a printed card.
  const across = nums.length > holeCount ? dropTotals(nums) : nums;
  return across.slice(0, holeCount).map(String);
}

/** The draft for one row from what's saved: { [hole]: text }. */
export function rowDraft(holes, saved = {}) {
  return Object.fromEntries(holes.map((h) => [h.n, cellText(saved[h.n])]));
}

/**
 * Totals for one row (from the boxes as typed, so they change as you go).
 * Returns { played, gross, out, in: inn, points?, netToPar?, errors }.
 */
export function rowTotals(holes, draft, hcp, format) {
  const scores = {};
  let errors = 0;
  for (const h of holes) {
    const c = readCell(draft[h.n], format);
    if (c.error) errors += 1;
    else if (!c.empty) scores[h.n] = { strokes: c.strokes, picked_up: c.picked_up };
  }
  const grossOf = (list) => list.reduce((s, h) => s + (scores[h.n]?.strokes || 0), 0);
  const front = holes.filter((h) => h.n <= 9);
  const back = holes.filter((h) => h.n > 9);
  const out = { played: Object.keys(scores).length, gross: grossOf(holes), out: grossOf(front), in: grossOf(back), errors };
  if (format === 'stableford' || format === 'fourball') out.points = stablefordStatus(holes, scores, hcp).points;
  else if (format === 'stroke') out.netToPar = strokeStatus(holes, scores, hcp).netToPar;
  else if (format === 'ambrose') out.netToPar = ambroseStatus(holes, scores, hcp).netToPar;
  return out;
}

/**
 * The boxes that need saving: typed, valid, and different from what's saved. Empty boxes are never sent (the app
 * doesn't delete a score from here — that's done on the score screen).
 * Returns rows ready for the scores table (without entered_by): { round_id, subject_id, subject_type, hole, strokes, picked_up }.
 */
export function changedCells({ round, subject, holes, draft, saved = {} }) {
  const out = [];
  for (const h of holes) {
    const c = readCell(draft[h.n], round.format);
    if (c.empty || c.error) continue;
    const s = saved[h.n];
    if (s && !!s.picked_up === c.picked_up && (c.picked_up || Number(s.strokes) === c.strokes)) continue;
    out.push({ round_id: round.id, subject_id: subject.id, subject_type: subject.type, hole: h.n, strokes: c.strokes, picked_up: c.picked_up });
  }
  return out;
}

/** Where Tab / Enter / arrows go from a box: { row, col } (null = off the card). */
export function moveFrom({ row, col }, key, rows, cols) {
  if (key === 'next') return col + 1 < cols ? { row, col: col + 1 } : row + 1 < rows ? { row: row + 1, col: 0 } : null;
  if (key === 'prev') return col > 0 ? { row, col: col - 1 } : row > 0 ? { row: row - 1, col: cols - 1 } : null;
  if (key === 'down') return row + 1 < rows ? { row: row + 1, col } : null;
  if (key === 'up') return row > 0 ? { row: row - 1, col } : null;
  if (key === 'nextRow') return row + 1 < rows ? { row: row + 1, col: 0 } : null;
  return { row, col };
}
