// Player stats, head-to-heads, records and the season ladder's inputs — all worked out from what's already stored
// (rounds, scores, round_players, teams, quick_results, honour_board, trophies, trips). Pure functions, no screen code.
//
// How each format counts:
//   * Stableford and stroke play are "individual" rounds: they count for points, net to par, "plays to", form, best
//     round, head-to-heads and the season ladder.
//   * 4BBB (fourball): each player's own hole scores count for hole stats (birdies, par 3/4/5, best and worst holes);
//     the pair's finish counts as a team result. A pick-up in 4BBB (the partner had the hole) is left out.
//   * Ambrose: one team score, so it counts for team results only.
//   * A pick-up in Stableford or stroke play counts as a net double bogey (the World Handicap System's cap), so
//     averages never get a hole "for free".
import { roundBoard, courseHoles, stablefordTrophyBoard, isTeamFormat } from './board.js';
import { strokesReceived, stablefordPoints, rankRows, compareCountback } from './scoring.js';
import { winnerNames, yearOf } from './history.js';

export const SOLO_FORMATS = ['stableford', 'stroke'];
const isSolo = (f) => SOLO_FORMATS.includes(f);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const isoDay = (s) => (s ? String(s).slice(0, 10) : null);

/** The day a round was played: its date, else its trip's start, else when it was made. */
export function roundDate(round, tripsById = {}) {
  return isoDay(round.play_date) || isoDay(tripsById[round.trip_id]?.start_date) || isoDay(round.created_at);
}

/** A round's result is settled: it's locked, or everyone on its board has finished. */
export function isDecided(round, board) {
  if (round.status === 'locked') return true;
  if (round.status === 'setup' || !board?.rows?.length) return false;
  return board.rows.every((r) => r.finished);
}

/**
 * Everything the stats need, worked out once. `data` is the app's shared data (store.jsx useData) and `scoresIdx`
 * the scores index (round → subject → hole → score).
 */
export function buildHistory(data, scoresIdx = {}) {
  const trips = data.trips || [];
  const tripsById = Object.fromEntries(trips.map((t) => [t.id, t]));
  const ctx = {
    rounds: data.rounds || [],
    trips,
    tripsById,
    trophies: data.trophies || [],
    coursesById: data.coursesById || {},
    roundPlayers: data.roundPlayers || {},
    teamsByRound: data.teamsByRound || {},
    playersById: data.playersById || {},
    quickResults: data.quick_results || [],
    honourBoard: data.honour_board || [],
    scoresIdx,
    boards: {},
    dates: {},
  };
  for (const r of ctx.rounds) {
    ctx.dates[r.id] = roundDate(r, tripsById);
    ctx.boards[r.id] = roundBoard({
      round: r, course: ctx.coursesById[r.course_id], teams: ctx.teamsByRound[r.id] || [],
      roundPlayers: ctx.roundPlayers[r.id] || [], playersById: ctx.playersById, scoresIdx, quickResults: ctx.quickResults,
    });
  }
  return ctx;
}

// ------------------------------------------------------------------ one player's card for one round

/** One hole for one player. Pick-ups: a net double bogey (solo rounds) or left out (4BBB: null). */
export function holeRecord(hole, score, hcp, format) {
  if (!score || (score.strokes == null && !score.picked_up)) return null;
  const recv = strokesReceived(hcp, hole.si);
  if (score.picked_up || score.strokes == null) {
    if (format === 'fourball') return null;
    const gross = hole.par + 2 + recv;
    return { n: hole.n, par: hole.par, si: hole.si, gross, toPar: gross - hole.par, net: 2, points: 0, pickedUp: true };
  }
  const gross = score.strokes;
  return {
    n: hole.n, par: hole.par, si: hole.si, gross, toPar: gross - hole.par, net: gross - hole.par - recv,
    points: stablefordPoints(hole, gross, hcp, false), pickedUp: false,
  };
}

/**
 * A player's own card for a round (Stableford, stroke play or 4BBB; null for Ambrose or a round they weren't in).
 * { round, course, date, format, hcp, holes: [holeRecord], thru, finished, points, vsExpected, netToPar, quick, rank, of }
 */
export function playerCard(ctx, round, playerId) {
  if (!round || round.format === 'ambrose') return null;
  const course = ctx.coursesById[round.course_id];
  const holes = courseHoles(course);
  const rp = (ctx.roundPlayers[round.id] || []).find((x) => x.player_id === playerId);
  const base = { round, course, date: ctx.dates[round.id] ?? roundDate(round, ctx.tripsById), format: round.format };
  if (round.format === 'fourball') {
    const team = (ctx.teamsByRound[round.id] || []).find((t) => (t.players || []).some((p) => p.id === playerId));
    if (!team) return null;
    const hcp = rp?.playing_handicap ?? Number(ctx.playersById[playerId]?.handicap ?? 0);
    const sc = ctx.scoresIdx[round.id]?.[playerId] || {};
    const recs = holes.map((h) => holeRecord(h, sc[h.n], hcp, 'fourball')).filter(Boolean);
    return { ...base, hcp, holes: recs, thru: recs.length, finished: false, points: null, vsExpected: null, netToPar: null, quick: false, team };
  }
  if (!rp) return null;
  const board = ctx.boards[round.id];
  const row = board?.rows.find((x) => x.id === playerId);
  if (!row) return null;
  const sc = ctx.scoresIdx[round.id]?.[playerId] || {};
  const recs = row.quick ? [] : holes.map((h) => holeRecord(h, sc[h.n], rp.playing_handicap, round.format)).filter(Boolean);
  const points = row.quick ? row.points : recs.reduce((a, x) => a + x.points, 0);
  const n = row.quick ? (holes.length || 18) : recs.length;
  const netToPar = row.quick ? null : recs.reduce((a, x) => a + x.net, 0);
  return {
    ...base, hcp: rp.playing_handicap, holes: recs, thru: n, finished: !!row.finished && n > 0, points,
    vsExpected: points - 2 * n, netToPar, quick: !!row.quick, rank: row.rankLabel, of: board.rows.length,
  };
}

/** Every card a player has (oldest first). */
export function playerCards(ctx, playerId) {
  const out = [];
  for (const r of ctx.rounds) {
    const c = playerCard(ctx, r, playerId);
    if (c && c.thru > 0) out.push(c);
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** Stableford points scaled to 18 holes (a 9-hole round's 18 → 36). */
export const points18 = (c) => (c.thru ? (c.points * 18) / c.thru : 0);
/** Shots better (+) or worse (−) than handicap over 18 holes, from Stableford points (36 = played to handicap). */
export const shotsVsHandicap = (c) => (c.thru ? (c.vsExpected * 18) / c.thru : 0);

// ------------------------------------------------------------------ team results (Ambrose and 4BBB)

/** The team results a player has: [{ round, date, format, team, rank, rankLabel, of, won, decided }]. */
export function teamResults(ctx, playerId) {
  const out = [];
  for (const r of ctx.rounds) {
    if (!isTeamFormat(r.format)) continue;
    const team = (ctx.teamsByRound[r.id] || []).find((t) => (t.players || []).some((p) => p.id === playerId));
    if (!team) continue;
    const board = ctx.boards[r.id];
    const row = board?.rows.find((x) => x.id === team.id);
    if (!row || !row.thru) continue;
    const decided = isDecided(r, board);
    out.push({ round: r, date: ctx.dates[r.id], format: r.format, team, rank: row.rank, rankLabel: row.rankLabel, of: board.rows.length, won: decided && row.rank === 1, decided, row });
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// ------------------------------------------------------------------ trips won

/** Is a trip over? Locked, or every round in it settled. */
export function tripDone(ctx, trip) {
  if (trip.status === 'locked') return true;
  const rs = ctx.rounds.filter((r) => r.trip_id === trip.id);
  return rs.length > 0 && rs.every((r) => isDecided(r, ctx.boards[r.id]));
}

const nameMatches = (p, names) => !!p && names.some((w) => [p.name, p.nickname].filter(Boolean).some((n) => n.toLowerCase() === w.toLowerCase()));

/** The players on an honour board entry: its player links, else names that match a player. */
export function honourPlayerIds(ctx, h) {
  if (h.player_ids?.length) return h.player_ids;
  const names = winnerNames(h.winner_names);
  return Object.values(ctx.playersById).filter((p) => nameMatches(p, names)).map((p) => p.id);
}

/**
 * Who won each finished trip: { [tripId]: { trip, ids, from } }. The winner engraved on the trip's Stableford trophy
 * (the honour board) counts first; otherwise the top of the Stableford trophy board (ties all count as winners).
 */
export function tripWinners(ctx) {
  const out = {};
  for (const trip of ctx.trips) {
    if (!tripDone(ctx, trip)) continue;
    const sNames = ctx.trophies.filter((t) => t.trip_id === trip.id && t.type === 'stableford_total').map((t) => t.name.toLowerCase());
    const engraved = ctx.honourBoard.find((h) => h.trip_id === trip.id && sNames.includes(String(h.trophy_name).toLowerCase()));
    if (engraved) {
      const ids = honourPlayerIds(ctx, engraved);
      if (ids.length) { out[trip.id] = { trip, ids, from: 'honour' }; continue; }
    }
    const b = stablefordTrophyBoard({
      trip, rounds: ctx.rounds, coursesById: ctx.coursesById, roundPlayers: ctx.roundPlayers,
      playersById: ctx.playersById, scoresIdx: ctx.scoresIdx, quickResults: ctx.quickResults,
    });
    const ids = b.rows.filter((r) => r.rank === 1 && r.total > 0).map((r) => r.id);
    if (ids.length) out[trip.id] = { trip, ids, from: 'scores' };
  }
  return out;
}

// ------------------------------------------------------------------ hole stats

/** Counts and averages over a list of hole records. */
export function holeSummary(recs) {
  const counts = { holes: recs.length, eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0 };
  for (const h of recs) {
    if (h.toPar <= -2) counts.eagles++;
    else if (h.toPar === -1) counts.birdies++;
    else if (h.toPar === 0) counts.pars++;
    else if (h.toPar === 1) counts.bogeys++;
    else counts.doubles++;
  }
  const parTypes = {};
  for (const par of [3, 4, 5]) {
    const xs = recs.filter((h) => h.par === par).map((h) => h.toPar);
    parTypes[par] = { avg: xs.length ? mean(xs) : null, n: xs.length };
  }
  return { counts, parTypes };
}

/** Best and worst holes on each course a player has played (average strokes vs par). */
export function courseHoleStats(cards, { top = 3 } = {}) {
  const byCourse = {};
  for (const c of cards) {
    if (!c.course || !c.holes.length) continue;
    const e = (byCourse[c.course.id] ||= { course: c.course, rounds: new Set(), holes: {} });
    e.rounds.add(c.round.id);
    for (const h of c.holes) {
      const x = (e.holes[h.n] ||= { n: h.n, par: h.par, sum: 0, plays: 0 });
      x.sum += h.toPar;
      x.plays += 1;
    }
  }
  return Object.values(byCourse).map((e) => {
    const holes = Object.values(e.holes).map((x) => ({ n: x.n, par: x.par, avg: x.sum / x.plays, plays: x.plays })).sort((a, b) => a.n - b.n);
    const best = [...holes].sort((a, b) => a.avg - b.avg || b.plays - a.plays || a.n - b.n).slice(0, top);
    const bestNs = new Set(best.map((h) => h.n));
    const worst = [...holes].filter((h) => !bestNs.has(h.n)).sort((a, b) => b.avg - a.avg || b.plays - a.plays || a.n - b.n).slice(0, top);
    return { course: e.course, rounds: e.rounds.size, holes, best, worst };
  }).sort((a, b) => b.rounds - a.rounds || String(a.course.name).localeCompare(String(b.course.name)));
}

// ------------------------------------------------------------------ a player's stats

/**
 * Everything on a player's Stats card.
 *   roundsPlayed — every round they've played (individual and team)
 *   avgPoints — average Stableford points (18 holes) in finished Stableford and stroke rounds
 *   avgNet — average net to par in finished rounds with hole scores
 *   playsTo / playedOff — "plays to 14.2 off an average handicap of 16" (36 points = played to handicap)
 *   best — best individual round; form — the last 5 (oldest first)
 *   counts, parTypes, courses — from every hole they've scored themselves
 *   team — Ambrose and 4BBB results; tripsWon; trophies (honour board)
 */
export function playerStats(ctx, playerId, { winners } = {}) {
  const cards = playerCards(ctx, playerId);
  const solo = cards.filter((c) => isSolo(c.format));
  const done = solo.filter((c) => c.finished);
  const team = teamResults(ctx, playerId);
  const holeCards = cards.filter((c) => c.holes.length);
  const allHoles = holeCards.flatMap((c) => c.holes);
  const { counts, parTypes } = holeSummary(allHoles);
  const withNet = done.filter((c) => c.netToPar != null);
  const played = done.map((c) => c.hcp - shotsVsHandicap(c));
  const playedOff = mean(done.map((c) => Number(c.hcp)));
  const best = done.length
    ? [...done].sort((a, b) => shotsVsHandicap(b) - shotsVsHandicap(a) || String(b.date).localeCompare(String(a.date)))[0]
    : null;
  const w = winners || tripWinners(ctx);
  const tripsWon = Object.values(w).filter((x) => x.ids.includes(playerId)).map((x) => x.trip);
  const trophies = ctx.honourBoard.filter((h) => honourPlayerIds(ctx, h).includes(playerId));
  const decidedTeam = team.filter((t) => t.decided);
  return {
    playerId,
    roundsPlayed: new Set([...cards.map((c) => c.round.id), ...team.map((t) => t.round.id)]).size,
    individualRounds: done.length,
    avgPoints: r1(mean(done.map(points18))),
    avgNet: r1(mean(withNet.map((c) => c.netToPar))),
    playsTo: r1(mean(played)),
    playedOff: r1(playedOff),
    vsHandicap: played.length ? r1(mean(played) - playedOff) : null,
    best: best && { roundId: best.round.id, round: best.round, course: best.course, date: best.date, points: best.points, format: best.format, netToPar: best.netToPar, thru: best.thru },
    form: done.slice(-5).map((c) => ({ roundId: c.round.id, name: c.round.name, date: c.date, points: c.points, vsExpected: c.vsExpected, format: c.format, netToPar: c.netToPar })),
    counts,
    parTypes,
    courses: courseHoleStats(holeCards),
    team: {
      played: team.length,
      wins: decidedTeam.filter((t) => t.won).length,
      avgFinish: r1(mean(decidedTeam.map((t) => t.rank))),
      results: team,
    },
    tripsWon: tripsWon.length,
    tripsWonList: tripsWon,
    trophies: trophies.length,
  };
}

// ------------------------------------------------------------------ head-to-head

/**
 * Two players over the rounds they've both played.
 *   rounds — individual rounds they both finished: { round, date, format, a, b, winner: 'a'|'b'|'half', margin, unit }
 *     Stableford: points (higher wins); stroke play: net to par (lower wins). margin > 0 favours A.
 *   team — Ambrose / 4BBB rounds on opposite teams (higher finish wins); partners — rounds on the same team.
 */
export function headToHead(ctx, aId, bId) {
  const rounds = [];
  if (aId && bId && aId !== bId) {
    for (const r of ctx.rounds) {
      if (!isSolo(r.format)) continue;
      const a = playerCard(ctx, r, aId);
      const b = playerCard(ctx, r, bId);
      if (!a?.finished || !b?.finished) continue;
      let margin;
      let unit;
      if (r.format === 'stroke' && a.netToPar != null && b.netToPar != null) {
        margin = b.netToPar - a.netToPar;
        unit = 'shots';
      } else {
        margin = a.points - b.points;
        unit = 'pts';
      }
      rounds.push({ round: r, date: a.date, format: r.format, a, b, margin, unit, winner: margin > 0 ? 'a' : margin < 0 ? 'b' : 'half' });
    }
  }
  rounds.sort((x, y) => String(x.date).localeCompare(String(y.date)));
  const team = [];
  let partners = 0;
  let partnerWins = 0;
  if (aId && bId && aId !== bId) {
    const ta = teamResults(ctx, aId);
    const tb = Object.fromEntries(teamResults(ctx, bId).map((t) => [t.round.id, t]));
    for (const x of ta) {
      const y = tb[x.round.id];
      if (!y || !x.decided) continue;
      if (x.team.id === y.team.id) {
        partners++;
        if (x.won) partnerWins++;
        continue;
      }
      team.push({ round: x.round, date: x.date, format: x.format, a: x, b: y, winner: x.rank < y.rank ? 'a' : x.rank > y.rank ? 'b' : 'half' });
    }
  }
  const tally = (list) => ({ a: list.filter((x) => x.winner === 'a').length, b: list.filter((x) => x.winner === 'b').length, halves: list.filter((x) => x.winner === 'half').length });
  return {
    rounds,
    ...tally(rounds),
    avgMargin: r1(mean(rounds.map((x) => x.margin))),
    team: { rounds: team, ...tally(team) },
    partners,
    partnerWins,
  };
}

// ------------------------------------------------------------------ records

/** The group's records: best rounds, most birdies, most trip wins (top `top` of each). */
export function records(ctx, { top = 5, winners } = {}) {
  const players = Object.values(ctx.playersById).filter((p) => p.approved !== false);
  const bestRounds = [];
  const birdies = [];
  for (const p of players) {
    const cards = playerCards(ctx, p.id);
    for (const c of cards) if (isSolo(c.format) && c.finished) bestRounds.push({ playerId: p.id, round: c.round, course: c.course, date: c.date, points: c.points, thru: c.thru, format: c.format, netToPar: c.netToPar, score: shotsVsHandicap(c) });
    const { counts } = holeSummary(cards.flatMap((c) => c.holes));
    const n = counts.birdies + counts.eagles;
    if (n > 0) birdies.push({ playerId: p.id, birdies: counts.birdies, eagles: counts.eagles, total: n, holes: counts.holes });
  }
  const w = winners || tripWinners(ctx);
  const tw = {};
  for (const x of Object.values(w)) for (const id of x.ids) tw[id] = (tw[id] || 0) + 1;
  return {
    bestRounds: bestRounds.sort((a, b) => b.score - a.score || b.points - a.points || String(b.date).localeCompare(String(a.date))).slice(0, top),
    mostBirdies: birdies.sort((a, b) => b.total - a.total || b.eagles - a.eagles).slice(0, top),
    mostTripWins: Object.entries(tw).filter(([id]) => ctx.playersById[id]).map(([playerId, wins]) => ({ playerId, wins })).sort((a, b) => b.wins - a.wins).slice(0, top),
  };
}

// ------------------------------------------------------------------ the season ladder's inputs

/**
 * Each settled individual round's finishers, re-ranked among themselves with the round's own countback.
 * [{ roundId, date, name, format, rows: [{ id, rank }] }]
 */
export function seasonResults(ctx) {
  const out = [];
  for (const r of ctx.rounds) {
    if (!isSolo(r.format)) continue;
    const board = ctx.boards[r.id];
    if (!isDecided(r, board)) continue;
    const fin = board.rows.filter((x) => x.finished);
    if (!fin.length) continue;
    const higher = r.format === 'stableford';
    const ranked = rankRows(fin, {
      key: 'sortValue', higherBetter: higher,
      tiebreak: (a, b) => (a.cb && b.cb ? (higher ? compareCountback(b.cb, a.cb) : compareCountback(a.cb, b.cb)) : 0),
    });
    out.push({ roundId: r.id, date: ctx.dates[r.id], name: r.name, format: r.format, rows: ranked.map((x) => ({ id: x.id, rank: x.rank })) });
  }
  return out;
}

/**
 * Trophies won, dated for the ladder: the trip's start (when linked to a trip), else when it was engraved in the
 * app; history from before the app with only a year ("2019") counts in that year (dated 1 July).
 */
export function seasonTrophies(ctx) {
  const out = [];
  for (const h of ctx.honourBoard) {
    const trip = h.trip_id ? ctx.tripsById[h.trip_id] : null;
    let date = trip ? isoDay(trip.end_date) || isoDay(trip.start_date) || isoDay(trip.created_at) : null;
    if (!date && h.imported) {
      const y = yearOf(h.label);
      date = y ? `${y}-07-01` : null;
    }
    if (!date && !h.imported) date = isoDay(h.created_at);
    if (!date) continue;
    const ids = honourPlayerIds(ctx, h);
    if (ids.length) out.push({ date, playerIds: ids, name: h.trophy_name });
  }
  return out;
}

/** Every date with something in it (for the season picker). */
export const historyDates = (ctx) => [...Object.values(ctx.dates), ...seasonTrophies(ctx).map((t) => t.date)];

/** Signed net / vs-handicap number for people: −2.5, +1, level. */
export function signed(n, { level = 'level', dp = 1 } = {}) {
  if (n == null || Number.isNaN(n)) return '–';
  const v = Number(n.toFixed(dp));
  if (v === 0) return level;
  return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(dp).replace(/\.0$/, '');
}
