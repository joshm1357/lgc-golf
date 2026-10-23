// Turns raw scores into leaderboards (pure functions — no screen code).
import {
  ambroseStatus, stablefordStatus, countbackKey, compareCountback, stablefordCountback,
  rankRows, recentForm, strokeStatus, strokeCountback, fourballStatus, penaltyFor, applyPenalty,
} from './scoring.js';
import { project, needToTie } from './projection.js';

/** A format's name for people. */
export const FORMAT_NAMES = { stableford: 'Stableford', ambrose: 'Ambrose', stroke: 'Stroke play', fourball: '4BBB' };
export const formatName = (format) => FORMAT_NAMES[format] || format;

/** Formats scored as net to par (lower better); the rest are Stableford points (higher better). */
export const isNetFormat = (format) => format === 'ambrose' || format === 'stroke';
/** Formats played in teams (Ambrose teams, 4BBB pairs). */
export const isTeamFormat = (format) => format === 'ambrose' || format === 'fourball';

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
/** Does this round's board depend on side comp entries (Ambrose with bonus strokes and at least one CTP/LD hole)? */
export function needsSideEntries(round) {
  return !!round && round.format === 'ambrose' && Number(round.comp_bonus || 0) > 0
    && ((round.ctp_holes || []).length + (round.ld_holes || []).length) > 0;
}

/**
 * A round board, or null while an input it needs is still loading (v8 fix): with side-comp bonus strokes the board
 * waits for the side entries, so it never shows a total without its bonus. `args` as for roundBoard, plus
 * `sideEntries` and `sideLoaded`.
 */
export function readyBoard({ sideEntries = [], sideLoaded = true, ...args }) {
  if (!args.round) return null;
  if (needsSideEntries(args.round) && !sideLoaded) return null;
  return roundBoard({ ...args, bonuses: compBonuses(args.round, args.teams || [], sideEntries) });
}

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

/**
 * adjustments: the round's penalty strokes (score_adjustments, 085) — added to the player's (or their team's) score.
 * Each row gets penalty (strokes counted) and penaltyLines (all, waived ones too).
 */
export function roundBoard({ round, course, teams = [], roundPlayers = [], playersById = {}, scoresIdx = {}, quickResults = [], bonuses = {}, adjustments = [] }) {
  const holes = courseHoles(course);
  const adj = (adjustments || []).filter((a) => !a.round_id || a.round_id === round.id);
  const pen = (ids) => penaltyFor(adj, ids);
  const nums = holes.map((h) => h.n);
  const scores = scoresIdx[round.id] || {};
  if (round.format === 'ambrose') {
    const rows = teams.map((t) => {
      const sc = scores[t.id] || {};
      const p = pen((t.players || []).map((x) => x.id));
      const st = applyPenalty('ambrose', ambroseStatus(holes, sc, t.handicap), p.strokes);
      const b = bonuses[t.id] || { strokes: 0, wins: [] };
      if (b.strokes) {
        st.netToPar -= b.strokes;
        if (st.finalNet != null) st.finalNet -= b.strokes;
      }
      return {
        id: t.id, name: t.name, players: t.players || [], handicap: t.handicap, scores: sc, ...st,
        bonus: b.strokes, bonusWins: b.wins, penaltyLines: p.lines,
        sortValue: st.thru ? st.netToPar : 999, cb: st.finished ? countbackKey(holes, sc, t.handicap) : null,
        form3: recentForm(st.perHole, sc, 3, 0),
      };
    });
    const ranked = rankRows(rows, {
      key: 'sortValue',
      tiebreak: (a, b) => (a.cb && b.cb ? compareCountback(a.cb, b.cb) : 0),
    });
    const proj = holes.length
      ? project(rows.map((r) => ({ id: r.id, perHole: r.perHole, base: (r.penalty || 0) - (r.bonus || 0) })), nums, { higherBetter: false, defaultValue: 0 })
      : [];
    return { format: 'ambrose', holes, rows: ranked, projection: attachProjection(ranked, proj, false), higherBetter: false };
  }
  if (round.format === 'fourball') {
    // 4BBB: one row per pair; each player plays off their own handicap (the round's playing handicap if set).
    const hcpOf = Object.fromEntries(roundPlayers.map((rp) => [rp.player_id, rp.playing_handicap]));
    const rows = teams.map((t) => {
      const members = (t.players || []).map((p) => ({ id: p.id, hcp: hcpOf[p.id] ?? Number(p.handicap ?? 0), scores: scores[p.id] || {} }));
      const p = pen(members.map((x) => x.id));
      const st = applyPenalty('fourball', fourballStatus(holes, members), p.strokes);
      const sc = {};
      for (const n of Object.keys(st.perHole)) sc[n] = { updated_at: members.map((m) => m.scores[n]?.updated_at || '').sort().pop() };
      return {
        id: t.id, name: t.name, players: t.players || [], members, handicap: null, scores: sc, ...st, penaltyLines: p.lines,
        sortValue: st.thru ? st.vsExpected : -999,
        cb: st.finished ? stablefordCountback(holes, st.perHole) : null,
        form3: recentForm(st.perHole, sc, 3, 2),
      };
    });
    const ranked = rankRows(rows, {
      key: 'sortValue', higherBetter: true,
      tiebreak: (a, b) => (a.cb && b.cb ? compareCountback(b.cb, a.cb) : 0),
    });
    const proj = holes.length
      ? project(rows.map((r) => ({ id: r.id, perHole: r.perHole, base: -(r.penalty || 0) })), nums, { higherBetter: true, defaultValue: 2 })
      : [];
    return { format: 'fourball', holes, rows: ranked, projection: attachProjection(ranked, proj, true), higherBetter: true };
  }
  if (round.format === 'stroke') {
    // Stroke play: one row per player, net to par through the holes played (lower better).
    const rows = roundPlayers.map((rp) => {
      const p = playersById[rp.player_id];
      const sc = scores[rp.player_id] || {};
      const pn = pen([rp.player_id]);
      const st = applyPenalty('stroke', strokeStatus(holes, sc, rp.playing_handicap), pn.strokes);
      return {
        id: rp.player_id, name: p ? p.nickname || p.name : '?', players: p ? [p] : [], handicap: rp.playing_handicap,
        scores: sc, ...st, penaltyLines: pn.lines, sortValue: st.thru ? st.netToPar : 999,
        cb: st.finished ? strokeCountback(holes, st.perHole) : null,
        form3: recentForm(st.perHole, sc, 3, 0),
      };
    });
    const ranked = rankRows(rows, {
      key: 'sortValue',
      tiebreak: (a, b) => (a.cb && b.cb ? compareCountback(a.cb, b.cb) : 0),
    });
    const proj = holes.length
      ? project(rows.map((r) => ({ id: r.id, perHole: r.perHole, base: r.penalty || 0 })), nums, { higherBetter: false, defaultValue: 0 })
      : [];
    return { format: 'stroke', holes, rows: ranked, projection: attachProjection(ranked, proj, false), higherBetter: false };
  }
  // Stableford
  const qrBy = Object.fromEntries(quickResults.filter((q) => q.round_id === round.id).map((q) => [q.player_id, q]));
  const rows = roundPlayers.map((rp) => {
    const p = playersById[rp.player_id];
    const sc = scores[rp.player_id] || {};
    const hasHoles = Object.keys(sc).length > 0;
    const pn = pen([rp.player_id]);
    if (!hasHoles && qrBy[rp.player_id]) {
      const raw = qrBy[rp.player_id].points;
      const pts = raw - pn.strokes;
      return {
        id: rp.player_id, name: p ? p.nickname || p.name : '?', players: p ? [p] : [], handicap: rp.playing_handicap,
        scores: {}, thru: holes.length || 18, points: pts, vsExpected: pts - 2 * (holes.length || 18), finished: true,
        perHole: Object.fromEntries(nums.map((n) => [n, raw / (nums.length || 18)])), quick: true,
        penalty: pn.strokes, penaltyLines: pn.lines,
        sortValue: pts - 2 * (holes.length || 18), cb: null, form3: null,
      };
    }
    const st = applyPenalty('stableford', stablefordStatus(holes, sc, rp.playing_handicap), pn.strokes);
    return {
      id: rp.player_id, name: p ? p.nickname || p.name : '?', players: p ? [p] : [], handicap: rp.playing_handicap,
      scores: sc, ...st, penaltyLines: pn.lines, sortValue: st.thru ? st.vsExpected : -999,
      cb: st.finished ? stablefordCountback(holes, st.perHole) : null,
      form3: recentForm(st.perHole, sc, 3, 2),
    };
  });
  const ranked = rankRows(rows, {
    key: 'sortValue', higherBetter: true,
    tiebreak: (a, b) => (a.cb && b.cb ? compareCountback(b.cb, a.cb) : 0),
  });
  const proj = holes.length
    ? project(rows.map((r) => ({ id: r.id, perHole: r.perHole, base: -(r.penalty || 0) })), nums, { higherBetter: true, defaultValue: 2 })
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
  // Ambrose and stroke play are net to par (lower better); Stableford is points (higher better).
  const isA = isNetFormat(board.format);
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
    // ov28 (D2): "Lou and Mo joint lead" when they're level — never "Leading: Lou" beside "Mo leads".
    const w = leaderWords(board.rows);
    out.push({ kind: 'up', label: w.joint ? 'Joint lead' : 'Leading', text: w.joint ? w.names : `${board.rows[0].name}` });
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
export function stablefordTrophyBoard({ trip, rounds, coursesById, roundPlayers, playersById, scoresIdx, quickResults, adjustments = [] }) {
  const sRounds = rounds.filter((r) => r.trip_id === trip.id && r.format === 'stableford');
  const totals = {};
  const boards = sRounds.map((r) =>
    roundBoard({ round: r, course: coursesById[r.course_id], roundPlayers: roundPlayers[r.id] || [], playersById, scoresIdx, quickResults, adjustments })
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
      // Base = everything but the live round's hole points (its penalty stays in the base).
      return { id: r.id, base: r.total - (liveRow ? liveRow.points + (liveRow.penalty || 0) : 0), perHole: liveRow?.perHole || Object.fromEntries(holes.map((n) => [n, 0])) };
    });
    const p = project(subs, holes, { higherBetter: true, defaultValue: 2 });
    const byId = Object.fromEntries(p.map((x) => [x.id, x]));
    projection = [...rows].map((r) => ({ ...r, proj: byId[r.id] })).sort((a, b2) => (b2.proj?.projected ?? 0) - (a.proj?.projected ?? 0));
  }
  return { rounds: sRounds, rows, projection };
}

// ------------------------------------------------------------------ ov28 (walkthrough D2): the board's order
/** Formats where "points" and "on pace" can differ (players on different holes): Stableford and 4BBB. */
export const hasPace = (format) => format === 'stableford' || format === 'fourball';

/**
 * The board in the order people expect. order 'points' (the default): most points first, so 19 sits above 15.
 * order 'pace': points against the expected 2 a hole (the old order), for players on different holes.
 * Net formats (Ambrose, stroke play) are already fair across holes: unchanged. Ranks and "T" labels are redone.
 */
export function orderBoard(board, order = 'points') {
  if (!board || !hasPace(board.format)) return board;
  if (order === 'pace') return board;
  const rows = rankRows(board.rows.map((r) => ({ ...r, ptsSort: r.thru || r.quick ? r.points : -999 })), {
    key: 'ptsSort', higherBetter: true,
    tiebreak: (a, b) => (a.cb && b.cb ? compareCountback(b.cb, a.cb) : 0),
  });
  return { ...board, rows, order: 'points' };
}

/**
 * Who leads, in words: { names: "Lou and Mo", joint: true, text: "Lou and Mo joint lead" } or
 * { names: "Lou", joint: false, text: "Lou leads" }. rows: ranked rows (rank 1 first). Nobody played → null text.
 * finished: true → "Lou won" / "Lou and Mo tie for first".
 */
export function leaderWords(rows = [], { finished = false } = {}) {
  const top = (rows || []).filter((r) => r.rank === 1 && (r.thru > 0 || r.quick || r.played > 0 || r.value > 0 || r.total > 0));
  if (!top.length) return { names: '', joint: false, text: null, ids: [] };
  const names = top.length === 1 ? top[0].name : `${top.slice(0, -1).map((r) => r.name).join(', ')} and ${top[top.length - 1].name}`;
  const joint = top.length > 1;
  const text = finished ? (joint ? `${names} tie for first` : `${names} won`) : joint ? `${names} joint lead` : `${names} leads`;
  return { names, joint, text, ids: top.map((r) => r.id) };
}

/** Is this board row "me" — my own row, or my team / pair? (D2: your row highlighted and pinned.) */
export const isMine = (row, me) => !!me && !!row && (row.id === me || (row.players || []).some((p) => p?.id === me));
