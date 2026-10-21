// Round recap — the "what happened" lines at the bottom of a finished round's leaderboard (Josh, 22 Oct: "I still
// don't see any of the things like recap of a round. That should be on this screen. At the bottom.")
// Pure: works from the round's board (lib/board.js roundBoard), so it's there for every finished round, old ones too,
// with or without AI. The AI round report (live commentary, 071) is shown above it when there is one.

import { formatToPar } from './scoring.js';

const ORD = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const isNetBoard = (b) => b.format === 'ambrose' || b.format === 'stroke';

/** A row's score in words: "38 pts", "−9 net". */
export function scoreWords(board, row) {
  if (!row) return '';
  if (isNetBoard(board)) return `${formatToPar(row.netToPar, row.netToPar % 1 ? 1 : 0)} net`;
  return `${row.points} pts`;
}

/** Gap between two rows in plain words ("2 shots", "3 points", "a countback"). */
function gapWords(board, a, b) {
  if (!a || !b) return null;
  const d = isNetBoard(board) ? Math.abs(b.netToPar - a.netToPar) : Math.abs(a.points - b.points);
  const r = Math.round(d * 10) / 10;
  if (r === 0) return 'a countback';
  if (isNetBoard(board)) return `${r} shot${r === 1 ? '' : 's'}`;
  return `${r} point${r === 1 ? '' : 's'}`;
}

/** Gross birdies (or better) per row, from the raw strokes against par. */
function birdies(board, row) {
  const par = Object.fromEntries((board.holes || []).map((h) => [h.n, h.par]));
  let b = 0;
  let best = null;
  for (const [n, s] of Object.entries(row.scores || {})) {
    if (!s || s.picked_up || s.strokes == null || par[n] == null) continue;
    const d = s.strokes - par[n];
    if (d <= -1) b += 1;
    if (d <= -2 && (!best || d < best.d)) best = { d, hole: Number(n), strokes: s.strokes };
  }
  return { count: b, best };
}

function backNine(board, row) {
  const back = (board.holes || []).filter((h) => h.n >= 10).map((h) => h.n);
  if (back.length < 9) return null;
  if (!back.every((n) => row.perHole?.[n] != null)) return null;
  return back.reduce((a, n) => a + row.perHole[n], 0);
}

/**
 * The recap: a list of short lines, in order. Empty until the round is done and someone has a score.
 * `courseName` is optional (for the headline).
 */
export function roundRecap(board, { done = false, courseName = '' } = {}) {
  const rows = (board?.rows || []).filter((r) => r.thru > 0 || r.quick);
  if (!done || !rows.length) return [];
  const lines = [];
  const top = rows[0];
  const tied = rows.filter((r) => r.rank === top.rank);
  const at = courseName ? ` at ${courseName}` : '';
  if (tied.length > 1) {
    lines.push({ icon: '🏆', text: `${tied.map((r) => r.name).join(' and ')} finished level on ${scoreWords(board, top)}${at}.` });
  } else {
    const second = rows[1];
    const gap = gapWords(board, top, second);
    lines.push({ icon: '🏆', text: `${top.name} won${at} with ${scoreWords(board, top)}${second ? `, ${gap === 'a countback' ? 'on a countback' : `by ${gap}`}` : ''}.` });
  }
  const podium = rows.filter((r) => !tied.includes(r)).slice(0, 2);
  if (podium.length) lines.push({ icon: '🥈', text: podium.map((r) => `${r.name} ${ORD(r.rank)} (${scoreWords(board, r)})`).join(', ') + '.' });

  // Birdies and the shot of the day (gross).
  const bs = rows.map((r) => ({ r, ...birdies(board, r) }));
  const eagle = bs.filter((x) => x.best).sort((a, b) => a.best.d - b.best.d)[0];
  if (eagle) {
    const what = eagle.best.strokes === 1 ? 'a hole-in-one' : eagle.best.d <= -3 ? 'an albatross' : 'an eagle';
    lines.push({ icon: '🦅', text: `Shot of the day: ${eagle.r.name} with ${what} on the ${ORD(eagle.best.hole)}.` });
  }
  const total = bs.reduce((a, x) => a + x.count, 0);
  const most = [...bs].sort((a, b) => b.count - a.count)[0];
  if (total > 0) {
    lines.push({ icon: '🐦', text: `${total} birdie${total === 1 ? '' : 's'} or better on the day${most.count > 1 ? ` — ${most.r.name} had ${most.count}` : ''}.` });
  }

  // Strongest finish (back nine).
  const finishes = rows.map((r) => ({ r, v: backNine(board, r) })).filter((x) => x.v != null);
  if (finishes.length > 1) {
    const net = isNetBoard(board);
    const best = [...finishes].sort((a, b) => (net ? a.v - b.v : b.v - a.v))[0];
    if (best.r !== top) {
      lines.push({ icon: '🚀', text: `Best back nine: ${best.r.name} (${net ? `${formatToPar(best.v, best.v % 1 ? 1 : 0)} net` : `${best.v} pts`}).` });
    }
  }

  // Side comp wins (Ambrose bonus strokes).
  const wins = rows.flatMap((r) => (r.bonusWins || []).map((w) => `${w} to ${r.name}`));
  if (wins.length) lines.push({ icon: '🎯', text: `Side comps: ${wins.join(', ')}.` });

  // Wooden spoon (only with 4 or more on the board).
  if (rows.length >= 4) {
    const last = rows[rows.length - 1];
    if (last.rank !== top.rank) lines.push({ icon: '🥄', text: `Wooden spoon: ${last.name} (${scoreWords(board, last)}).` });
  }
  return lines;
}

/** The recap as text to share in the group chat. */
export function recapText(lines, title) {
  return [`📝 ${title}`, ...lines.map((l) => `${l.icon} ${l.text}`)].join('\n');
}
