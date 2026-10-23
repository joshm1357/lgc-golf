// Swing alerts (ov28, walkthrough I13) — the WORDS and the "did anything change?" check, shared by the notify
// function (Deno) and the app's tests. Plain JavaScript, no imports.
//
// Josh: "Be careful not to flood. Also should be for all comps." So:
//   * A Cup match buzzes only when its lead changes hands or goes back to all square — never every hole, and never the
//     result (that's an award moment, 054). "Red win the 11th — all square after 11".
//   * Stroke-based comps (Stableford, 4BBB players, stroke play) buzz the player who just moved past someone:
//     "You've just passed Mo — 19 pts thru 9". Only them; the new-leader line is already live commentary (071).
//   * The notify function adds the limits: people on "straight away" only, never into a digest, the group's commentary
//     buzz level (often 10 min / sometimes 30 min / feed only = none), and once per match state / per mover per hole.

const HOLES = 18;

/** Where a Cup match stands after these hole results ({ "1": "a"|"b"|"h" }), counting holes in order and stopping
 *  once it's decided (holes typed in after that don't count). */
export function cupState(holes = {}) {
  let up = 0;
  let played = 0;
  for (let n = 1; n <= HOLES; n++) {
    const r = holes?.[String(n)];
    if (!r) continue;
    played++;
    if (r === 'a') up++;
    else if (r === 'b') up--;
    if (Math.abs(up) > HOLES - played) break;
  }
  const remaining = HOLES - played;
  const lead = Math.abs(up);
  return { up, lead, leader: up > 0 ? 'a' : up < 0 ? 'b' : null, played, remaining, decided: lead > remaining || remaining === 0 };
}

const ORD = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/**
 * A Cup match's swing after hole `hole` was just scored, or null when it isn't one.
 *   holes: the match's results now; names: { a, b } (side names).
 * Swing = the leader changed (A ahead → B ahead, someone ahead → all square, all square → someone ahead from the 10th
 * on). Decided matches never swing (the result has its own buzz).
 */
export function cupSwing({ holes = {}, hole, names = { a: 'A', b: 'B' } } = {}) {
  const h = Number(hole);
  const r = holes?.[String(h)];
  if (!r || !(h >= 1 && h <= HOLES)) return null;
  const before = { ...holes };
  delete before[String(h)];
  const was = cupState(before);
  const now = cupState(holes);
  if (now.decided || was.decided) return null;
  if (was.leader === now.leader) return null;
  // Before the 10th, only the lead changing hands outright is news (not "1 UP" or back to level early on).
  if (now.played < 10 && !(was.leader && now.leader && was.leader !== now.leader)) return null;
  const won = r === 'h' ? `${ORD(h)} halved` : `${names[r]} win the ${ORD(h)}`;
  const stand = now.leader ? `${names[now.leader]} now ${now.lead} UP` : `all square after ${now.played}`;
  return { key: `${now.leader || 'as'}:${now.played}`, text: `${won} — ${stand}`, leader: now.leader };
}

/** Shots a player gets on a hole (the app's scoring.js strokesReceived, kept in step by a test). */
export function shotsOn(hcp, si) {
  const H = Math.round(Number(hcp) || 0);
  if (H >= 0) return Math.floor(H / 18) + (si <= H % 18 ? 1 : 0);
  const P = Math.abs(H);
  return 0 - (Math.floor(P / 18) + (si > 18 - (P % 18) ? 1 : 0)) || 0;
}

/** Stableford points for one hole (the app's stablefordPoints). */
export function holePoints(hole, strokes, hcp, pickedUp = false) {
  if (pickedUp || strokes == null) return 0;
  return Math.max(0, 2 + hole.par + shotsOn(hcp, hole.si) - strokes);
}

/**
 * Who `mover` just passed on Stableford points by scoring hole `hole`.
 *   holes: the course [{ n, par, si }]; scores: [{ player_id, hole, strokes, picked_up }];
 *   hcps: { player_id: playing handicap }. Only players in `hcps` count.
 * Returns { passed: [ids], points, thru } — passed is empty when nobody was passed.
 */
export function passedOnPoints({ holes = [], scores = [], hcps = {}, mover, hole } = {}) {
  const byN = Object.fromEntries((holes || []).map((x) => [Number(x.n), x]));
  const tot = (pid, skip) => {
    let pts = 0;
    let thru = 0;
    for (const s of scores) {
      if (s.player_id !== pid || !byN[s.hole]) continue;
      if (skip && Number(s.hole) === Number(hole)) continue;
      thru++;
      pts += holePoints(byN[s.hole], s.strokes, hcps[pid], s.picked_up);
    }
    return { pts, thru };
  };
  const me = tot(mover, false);
  const was = tot(mover, true);
  if (!(mover in hcps) || me.thru === was.thru) return { passed: [], points: me.pts, thru: me.thru };
  const passed = Object.keys(hcps).filter((pid) => pid !== mover).filter((pid) => {
    const o = tot(pid, false).pts;
    return o > was.pts && o < me.pts;
  });
  return { passed, points: me.pts, thru: me.thru };
}

/** "You've just passed Mo — 19 pts thru 9" / "You've just passed Mo and Bo — …". */
export function passedText(names = [], points, thru) {
  const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `You’ve just passed ${list} — ${points} pts thru ${thru}`;
}

/** The limit between buzzes for one person, from the group's commentary buzz level: often 10, sometimes 30, feed = none. */
export function swingGapMinutes(buzz) {
  return buzz === 'feed' ? null : buzz === 'often' ? 10 : 30;
}
