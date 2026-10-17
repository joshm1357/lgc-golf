// All scoring maths lives here, as plain functions with no screen code.
// Holes: [{ n, par, si }]. Scores: { [hole]: { strokes, picked_up, updated_at } }.

/** Strokes a handicap of `hcp` receives on a hole with stroke index `si`. */
export function strokesReceived(hcp, si) {
  const H = Math.round(Number(hcp) || 0);
  if (H >= 0) {
    return Math.floor(H / 18) + (si <= H % 18 ? 1 : 0);
  }
  // Plus handicap: gives strokes back on the easiest holes.
  const P = Math.abs(H);
  return 0 - (Math.floor(P / 18) + (si > 18 - (P % 18) ? 1 : 0)) || 0;
}

export function parTotal(holes) {
  return holes.reduce((s, h) => s + h.par, 0);
}

function playedHoles(holes, scores) {
  return holes.filter((h) => {
    const s = scores[h.n];
    return s && (s.strokes != null || s.picked_up);
  });
}

/** Net score vs par on one hole (Ambrose / stroke play). Negative = under par. */
export function holeNetVsPar(hole, strokes, hcp) {
  return strokes - hole.par - strokesReceived(hcp, hole.si);
}

/**
 * Ambrose team status. Teams are compared on net to par through the holes they've played,
 * so a team on 9 and a team on 14 compare fairly.
 */
export function ambroseStatus(holes, scores, hcp) {
  const played = playedHoles(holes, scores).filter((h) => scores[h.n].strokes != null);
  const gross = played.reduce((s, h) => s + scores[h.n].strokes, 0);
  const parThru = played.reduce((s, h) => s + h.par, 0);
  const recv = played.reduce((s, h) => s + strokesReceived(hcp, h.si), 0);
  const finished = played.length === holes.length;
  const netToParThru = gross - parThru - recv;
  const finalNet = finished ? gross - Number(hcp) : null;
  const finalNetToPar = finished ? finalNet - parTotal(holes) : null;
  const perHole = {};
  for (const h of played) perHole[h.n] = holeNetVsPar(h, scores[h.n].strokes, hcp);
  return {
    thru: played.length,
    gross,
    grossToPar: gross - parThru,
    netToPar: finished ? finalNetToPar : netToParThru,
    finished,
    finalNet,
    perHole,
  };
}

/** Countback on the last 9, 6, 3, 1 holes, handicap pro-rated. Lower is better. */
export function countbackKey(holes, scores, hcp) {
  const byN = Object.fromEntries(holes.map((h) => [h.n, h]));
  const last = (k) => {
    const ns = holes.map((h) => h.n).slice(-k);
    const g = ns.reduce((s, n) => s + (scores[n]?.strokes ?? 0), 0);
    return g - (Number(hcp) * k) / 18;
  };
  void byN;
  return [last(9), last(6), last(3), last(1)];
}

/** Rank rows by `key` (lower better unless higherBetter). Ties share a rank unless `tiebreak` separates them. */
export function rankRows(rows, { key, higherBetter = false, tiebreak } = {}) {
  const sign = higherBetter ? -1 : 1;
  const cmp = (a, b) => {
    const d = sign * (a[key] - b[key]);
    if (Math.abs(d) > 1e-9) return d;
    if (tiebreak) {
      const t = tiebreak(a, b);
      if (t !== 0) return t;
    }
    return 0;
  };
  const sorted = [...rows].sort((a, b) => {
    const c = cmp(a, b);
    return c !== 0 ? c : String(a.name).localeCompare(String(b.name));
  });
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || cmp(sorted[i - 1], r) !== 0) rank = i + 1;
    const tied = (i > 0 && cmp(sorted[i - 1], r) === 0) || (i < sorted.length - 1 && cmp(sorted[i + 1], r) === 0);
    return { ...r, rank, rankLabel: (tied ? 'T' : '') + rank };
  });
}

/** Compare two countback keys (arrays). Lower wins. */
export function compareCountback(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] - b[i];
  }
  return 0;
}

// ---------- Stableford ----------

export function stablefordPoints(hole, strokes, hcp, pickedUp = false) {
  if (pickedUp || strokes == null) return 0;
  return Math.max(0, 2 + hole.par + strokesReceived(hcp, hole.si) - strokes);
}

export function stablefordStatus(holes, scores, hcp) {
  const played = playedHoles(holes, scores);
  const perHole = {};
  let points = 0;
  for (const h of played) {
    const s = scores[h.n];
    const p = stablefordPoints(h, s.strokes, hcp, s.picked_up);
    perHole[h.n] = p;
    points += p;
  }
  return {
    thru: played.length,
    points,
    vsExpected: points - 2 * played.length,
    finished: played.length === holes.length,
    perHole,
  };
}

/** Stableford countback on the last 9, 6, 3, 1 holes. Higher is better. */
export function stablefordCountback(holes, perHole) {
  const last = (k) => holes.map((h) => h.n).slice(-k).reduce((s, n) => s + (perHole[n] ?? 0), 0);
  return [last(9), last(6), last(3), last(1)];
}

// ---------- Momentum (for headlines) ----------

/**
 * Net vs par over the last `k` holes this subject entered (by entry time, so shotgun starts work).
 * For Stableford pass `perHole` points and `expected` = 2 per hole.
 */
export function recentForm(perHole, scores, k = 3, expected = 0) {
  const entries = Object.keys(perHole)
    .map((n) => ({ n: Number(n), v: perHole[n], t: scores[n]?.updated_at ?? '' }))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.n - b.n));
  const lastK = entries.slice(-k);
  if (lastK.length < k) return null;
  return lastK.reduce((s, e) => s + e.v - expected, 0);
}

export function formatToPar(n, dp = 0) {
  if (n == null || Number.isNaN(n)) return '–';
  const v = Number(n.toFixed(dp));
  if (v === 0) return 'E';
  return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(dp);
}
