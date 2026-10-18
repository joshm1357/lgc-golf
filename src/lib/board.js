// Turns raw scores into leaderboards (pure functions — no screen code).
import {
  ambroseStatus, stablefordStatus, countbackKey, compareCountback, stablefordCountback,
  rankRows, recentForm,
} from './scoring.js';
import { project, needToTie } from './projection.js';

export function courseHoles(course) {
  return [...(course?.holes || [])].sort((a, b) => a.n - b.n);
}

/**
 * Build a round leaderboard.
 * Ambrose: one row per team, ranked by net to par through holes played (lower better).
 * Stableford: one row per player, ranked by points vs expected (2 per hole) — higher better.
 */
/**
 * Side-comp bonus strokes for Ambrose: the leader of each closest-to-pin / longest-drive hole
 * takes `round.comp_bonus` strokes off their team's score. Returns { teamId: { strokes, wins: [label] } }.
 */
export function compBonuses(round, teams, sideEntries = []) {
  const bonus = Number(round?.comp_bonus || 0);
  const out = {};
  if (!bonus || round?.format !== 'ambrose') return out;
  const teamOf = {};
  for (const t of teams) for (const p of t.players || []) teamOf[p.id] = t.id;
  const comps = [
    ...(round.ctp_holes || []).map((h) => ({ kind: 'ctp', hole: h, label: `🎯 CTP ${h}` })),
    ...(round.ld_holes || []).map((h) => ({ kind: 'ld', hole: h, label: `💣 LD ${h}` })),
  ];
  for (const c of comps) {
    const here = sideEntries.filter((e) => e.kind === c.kind && e.hole === c.hole);
    // An admin-confirmed winner beats any measured distance.
    const confirmed = here.find((e) => e.confirmed);
    const measured = here.filter((e) => e.distance_m != null);
    if (!confirmed && !measured.length) continue;
    const best = confirmed || [...measured].sort((a, b) => (c.kind === 'ctp' ? a.distance_m - b.distance_m : b.distance_m - a.distance_m))[0];
    const tid = teamOf[best.player_id];
    if (!tid) continue;
    const o = (out[tid] ||= { strokes: 0, wins: [] });
    o.strokes += bonus;
    o.wins.push(c.label);
  }
  return out;
}

export function roundBoard({ round, course, teams = [], roundPlayers = [], playersById = {}, scoresIdx = {}, quickResults = [], bonuses = {} }) {
  const holes = courseHoles(course);
  const nums = holes.map((h) => h.n);
  const scores = scoresIdx[round.id] || {};
  if (round.format === 'ambrose') {
    const rows = teams.map((t) => {
      const sc = scores[t.id] || {};
      const st = ambroseStatus(holes, sc, t.handicap);
      const b = bonuses[t.id] || { strokes: 0, wins: [] };
      if (b.strokes) {
        st.netToPar -= b.strokes;
        if (st.finalNet != null) st.finalNet -= b.strokes;
      }
      return {
        id: t.id, name: t.name, players: t.players || [], handicap: t.handicap, scores: sc, ...st,
        bonus: b.strokes, bonusWins: b.wins,
        sortValue: st.thru ? st.netToPar : 999, cb: st.finished ? countbackKey(holes, sc, t.handicap) : null,
        form3: recentForm(st.perHole, sc, 3, 0),
      };
    });
    const ranked = rankRows(rows, {
      key: 'sortValue',
      tiebreak: (a, b) => (a.cb && b.cb ? compareCountback(a.cb, b.cb) : 0),
    });
    const proj = holes.length
      ? project(rows.map((r) => ({ id: r.id, perHole: r.perHole, base: -(r.bonus || 0) })), nums, { higherBetter: false, defaultValue: 0 })
      : [];
    return { format: 'ambrose', holes, rows: ranked, projection: attachProjection(ranked, proj, false), higherBetter: false };
  }
  // Stableford
  const qrBy = Object.fromEntries(quickResults.filter((q) => q.round_id === round.id).map((q) => [q.player_id, q]));
  const rows = roundPlayers.map((rp) => {
    const p = playersById[rp.player_id];
    const sc = scores[rp.player_id] || {};
    const hasHoles = Object.keys(sc).length > 0;
    if (!hasHoles && qrBy[rp.player_id]) {
      const pts = qrBy[rp.player_id].points;
      return {
        id: rp.player_id, name: p ? p.nickname || p.name : '?', players: p ? [p] : [], handicap: rp.playing_handicap,
        scores: {}, thru: holes.length || 18, points: pts, vsExpected: pts - 2 * (holes.length || 18), finished: true,
        perHole: Object.fromEntries(nums.map((n) => [n, pts / (nums.length || 18)])), quick: true,
        sortValue: pts - 2 * (holes.length || 18), cb: null, form3: null,
      };
    }
    const st = stablefordStatus(holes, sc, rp.playing_handicap);
    return {
      id: rp.player_id, name: p ? p.nickname || p.name : '?', players: p ? [p] : [], handicap: rp.playing_handicap,
      scores: sc, ...st, sortValue: st.thru ? st.vsExpected : -999,
      cb: st.finished ? stablefordCountback(holes, st.perHole) : null,
      form3: recentForm(st.perHole, sc, 3, 2),
    };
  });
  const ranked = rankRows(rows, {
    key: 'sortValue', higherBetter: true,
    tiebreak: (a, b) => (a.cb && b.cb ? compareCountback(b.cb, a.cb) : 0),
  });
  const proj = holes.length
    ? project(rows.map((r) => ({ id: r.id, perHole: r.perHole })), nums, { higherBetter: true, defaultValue: 2 })
    : [];
  return { format: 'stableford', holes, rows: ranked, projection: attachProjection(ranked, proj, true), higherBetter: true };
}

function attachProjection(rows, proj, higherBetter) {
  const byId = Object.fromEntries(proj.map((p) => [p.id, p]));
  const merged = rows.map((r) => ({ ...r, proj: byId[r.id] }));
  const sorted = [...merged].sort((a, b) =>
    higherBetter ? (b.proj?.projected ?? 0) - (a.proj?.projected ?? 0) : (a.proj?.projected ?? 0) - (b.proj?.projected ?? 0)
  );
  const leader = sorted[0]?.proj?.projected;
  return sorted.map((r, i) => ({ ...r, projRank: i + 1, need: r.proj ? needToTie(r.proj, leader, higherBetter) : null }));
}

/** Plain-words headlines for the top of the leaderboard. */
export function headlines(board, prevRanks, { projected = false } = {}) {
  const out = [];
  if (!board.rows.length) return out;
  const isA = board.format === 'ambrose';
  if (projected) {
    const p = board.projection;
    const top = p[0];
    const anyPlayed = board.rows.some((r) => r.thru > 0);
    if (top && anyPlayed) out.push({ kind: 'up', label: 'Projected winner', text: `${top.name} — ${top.proj?.winPct ?? 0}% chance` });
    const chaser = p.find((r, i) => i > 0 && r.need && r.need.strokes > 0 && r.need.holesLeft > 0);
    if (chaser) {
      out.push({
        kind: 'target', label: 'What it takes',
        text: isA
          ? `${chaser.name} need ${chaser.need.strokes} under over the last ${chaser.need.holesLeft} to tie`
          : `${chaser.name} need ${chaser.need.strokes} extra points over the last ${chaser.need.holesLeft} to tie`,
      });
    }
    return out.slice(0, 2);
  }
  // Since you last looked
  if (prevRanks) {
    let best = null;
    for (const r of board.rows) {
      const prev = prevRanks[r.id];
      if (prev && prev - r.rank >= 2 && (!best || prev - r.rank > best.d)) best = { r, d: prev - r.rank };
    }
    if (best) out.push({ kind: 'up', label: 'Since you looked', text: `${best.r.name} up ${best.d} spots` });
    const leader = board.rows[0];
    if (leader && prevRanks[leader.id] && prevRanks[leader.id] !== 1 && leader.thru > 0) {
      out.push({ kind: 'up', label: 'New leader', text: `${leader.name} have hit the front` });
    }
  }
  // Running hot / gone cold
  const hot = [...board.rows].filter((r) => r.form3 != null).sort((a, b) => (isA ? a.form3 - b.form3 : b.form3 - a.form3))[0];
  if (hot && (isA ? hot.form3 <= -2 : hot.form3 >= 3)) {
    out.push({
      kind: 'hot', label: 'Running hot',
      text: isA ? `${hot.name} ${fmtSigned(hot.form3)} net, last 3 holes` : `${hot.name} ${fmtSigned(hot.form3)} on expected, last 3`,
    });
  }
  const cold = [...board.rows].filter((r) => r.form3 != null).sort((a, b) => (isA ? b.form3 - a.form3 : a.form3 - b.form3))[0];
  if (cold && cold !== hot && (isA ? cold.form3 >= 3 : cold.form3 <= -4)) {
    out.push({
      kind: 'cold', label: 'Gone cold',
      text: isA ? `${cold.name} ${fmtSigned(cold.form3)} net, last 3 holes` : `${cold.name} ${fmtSigned(cold.form3)} on expected, last 3`,
    });
  }
  if (!out.length && board.rows[0]?.thru > 0) {
    out.push({ kind: 'up', label: 'Leading', text: `${board.rows[0].name}` });
  }
  return out.slice(0, 2);
}

function fmtSigned(n) {
  return n === 0 ? 'level' : (n < 0 ? '−' : '+') + Math.abs(n);
}

/**
 * Stableford trophy: each player's raw Stableford points added across every Stableford round in the trip.
 * The live round (if any) adds a projection for the holes still to play.
 */
export function stablefordTrophyBoard({ trip, rounds, coursesById, roundPlayers, playersById, scoresIdx, quickResults }) {
  const sRounds = rounds.filter((r) => r.trip_id === trip.id && r.format === 'stableford');
  const totals = {};
  const boards = sRounds.map((r) =>
    roundBoard({ round: r, course: coursesById[r.course_id], roundPlayers: roundPlayers[r.id] || [], playersById, scoresIdx, quickResults })
  );
  boards.forEach((b, i) => {
    for (const row of b.rows) {
      const t = (totals[row.id] ||= { id: row.id, name: row.name, players: row.players, byRound: {}, total: 0, lastRoundPoints: 0, lastCb: null });
      t.byRound[sRounds[i].id] = row.points;
      t.total += row.points;
      t.lastRoundPoints = row.points;
      t.lastCb = row.cb;
      t.live = t.live || (sRounds[i].status === 'live' && !row.finished && row.thru > 0);
      t.thru = row.thru;
    }
  });
  const rows = rankRows(Object.values(totals), {
    key: 'total', higherBetter: true,
    tiebreak: (a, b) => (b.lastRoundPoints - a.lastRoundPoints) || (a.lastCb && b.lastCb ? compareCountback(b.lastCb, a.lastCb) : 0),
  });
  // Projection: base = points from finished rounds, plus the live round projected.
  const live = sRounds.find((r) => r.status === 'live');
  let projection = null;
  if (live) {
    const b = boards[sRounds.indexOf(live)];
    const holes = b.holes.map((h) => h.n);
    const subs = rows.map((r) => {
      const liveRow = b.rows.find((x) => x.id === r.id);
      return { id: r.id, base: r.total - (liveRow?.points ?? 0), perHole: liveRow?.perHole || Object.fromEntries(holes.map((n) => [n, 0])) };
    });
    const p = project(subs, holes, { higherBetter: true, defaultValue: 2 });
    const byId = Object.fromEntries(p.map((x) => [x.id, x]));
    projection = [...rows].map((r) => ({ ...r, proj: byId[r.id] })).sort((a, b2) => (b2.proj?.projected ?? 0) - (a.proj?.projected ?? 0));
  }
  return { rounds: sRounds, rows, projection };
}
