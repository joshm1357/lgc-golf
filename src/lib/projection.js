// Projected finish and win chance for subjects (teams or players) still on the course.
//
// Plain-words version:
//   - Hole difficulty = how the field has actually scored on each hole so far.
//   - Form = how this subject is going compared with the field on the holes they've played
//     (shrunk towards zero early on, so one lucky hole doesn't dominate).
//   - Projected = score so far + (difficulty + form) for every hole left.
//   - Win % = run lots of quick simulations of the holes left, drawing realistic
//     scatter from what the field has actually done, and count who wins.

/** Small, seedable random number generator so results are repeatable. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * subjects: [{ id, perHole: { [hole]: value }, base?: number }]
 *   value = net vs par (Ambrose, lower better) or Stableford points (higher better).
 *   base  = points/score carried in from earlier rounds (trophy totals), default 0.
 * holeNumbers: [1..18]
 * opts: { higherBetter, defaultValue (par-ish value when nobody has played a hole), sims, seed }
 */
export function project(subjects, holeNumbers, opts = {}) {
  const { higherBetter = false, defaultValue = 0, sims = 2000, seed = 42 } = opts;

  // Hole difficulty from everyone who has played each hole.
  const difficulty = {};
  for (const n of holeNumbers) {
    const vals = subjects.map((s) => s.perHole[n]).filter((v) => v != null);
    difficulty[n] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : defaultValue;
  }

  // Residual pool: how far individual hole results sit from the hole average.
  const residuals = [];
  for (const s of subjects) {
    for (const n of holeNumbers) {
      const v = s.perHole[n];
      if (v != null) {
        const playedBy = subjects.filter((x) => x.perHole[n] != null).length;
        if (playedBy > 1) residuals.push(v - difficulty[n]);
      }
    }
  }
  if (residuals.length < 4) residuals.push(-1, 0, 0, 1); // sensible scatter before data arrives

  const rows = subjects.map((s) => {
    const played = holeNumbers.filter((n) => s.perHole[n] != null);
    const remaining = holeNumbers.filter((n) => s.perHole[n] == null);
    const current = (s.base ?? 0) + played.reduce((a, n) => a + s.perHole[n], 0);
    const rawForm = played.length ? played.reduce((a, n) => a + (s.perHole[n] - difficulty[n]), 0) / played.length : 0;
    const form = rawForm * (played.length / (played.length + 3));
    const projected = current + remaining.reduce((a, n) => a + difficulty[n] + form, 0);
    return { id: s.id, current, form, remaining, projected, finished: remaining.length === 0 };
  });

  // Simulations for win chance.
  const rand = mulberry32(seed);
  const wins = Object.fromEntries(rows.map((r) => [r.id, 0]));
  for (let i = 0; i < sims; i++) {
    let best = null;
    let leaders = [];
    for (const r of rows) {
      let total = r.current;
      for (const n of r.remaining) {
        const res = residuals[Math.floor(rand() * residuals.length)];
        total += difficulty[n] + r.form + res;
      }
      const better = best == null || (higherBetter ? total > best + 1e-9 : total < best - 1e-9);
      const equal = best != null && Math.abs(total - best) <= 1e-9;
      if (better) {
        best = total;
        leaders = [r.id];
      } else if (equal) {
        leaders.push(r.id);
      }
    }
    for (const id of leaders) wins[id] += 1 / leaders.length;
  }

  return rows.map((r) => ({
    ...r,
    winPct: Math.round((wins[r.id] / sims) * 100),
  }));
}

/** What a subject needs over its remaining holes to tie the projected leader (Ambrose: net strokes). */
export function needToTie(row, leaderProjected, higherBetter = false) {
  if (row.finished || !row.remaining.length) return null;
  const diff = higherBetter ? leaderProjected - row.projected : row.projected - leaderProjected;
  return { strokes: Math.max(0, Math.round(diff)), holesLeft: row.remaining.length };
}
