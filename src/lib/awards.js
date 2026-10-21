// Award moments (migration 054, feature 'awards'): the moment something is decided — a round, a closest-to-the-pin
// or longest-drive hole, a trophy, a Cup match — the app records it once (award_moments) and shows a winner card.
// All the "is it decided yet, and who won" logic is here, as plain functions with tests (awards.test.js).
//
// No spoilers: nothing is announced until it can't change —
//   * a round: every team/player has a score (or a pick-up) on every hole, or the round is locked;
//   * a side comp hole: everyone has played that hole, or the round is locked (same rule as the Side comps screen);
//   * a trophy: its last counting round in the trip is decided (and no other counting round is still being played);
//   * a Cup match: one side can't be caught (lib/cup.js matchState).
// Only "fresh" things count (a live round, or one played today or yesterday), so switching the feature on doesn't
// dig up every old round at once.
import { roundBoard, stablefordTrophyBoard, compBonuses, isTeamFormat, courseHoles } from './board.js';
import { formatToPar } from './scoring.js';
import { matchState } from './cup.js';

/** Cards on the leaderboard show moments from the last few hours. */
export const RECENT_HOURS = 6;

const pName = (p) => (p ? p.nickname || p.name : 'Someone');

/** "Mike", "Mike and Al", "Mike, Al and Bo". */
export function nameList(names) {
  const n = (names || []).filter(Boolean);
  if (n.length <= 1) return n[0] || '';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n) {
  const k = n % 100;
  if (k >= 11 && k <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

/** The day before an ISO date (YYYY-MM-DD). */
export function dayBefore(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return t.toISOString().slice(0, 10);
}

/** A round worth announcing: being played now, or played today or yesterday. */
export function isFresh(round, today) {
  if (!round) return false;
  if (round.status === 'live') return true;
  if (round.status !== 'locked' || !round.play_date || !today) return false;
  return round.play_date <= today && round.play_date >= dayBefore(today);
}

/** Who has to have played: Ambrose teams; 4BBB players (both in each pair); everyone else, the round's players. */
export function roundSubjects(round, teamsByRound = {}, roundPlayers = {}) {
  if (!round) return [];
  if (round.format === 'ambrose') return (teamsByRound[round.id] || []).map((t) => t.id);
  if (round.format === 'fourball') return (teamsByRound[round.id] || []).flatMap((t) => (t.players || []).map((p) => p.id));
  return (roundPlayers[round.id] || []).map((rp) => rp.player_id);
}

const hasScore = (scoresIdx, roundId, subjectId, hole) => !!scoresIdx?.[roundId]?.[subjectId]?.[hole];

/** A side comp hole is decided once everyone has played it (or the round is locked). */
export function holeDecided({ round, hole, teamsByRound, roundPlayers, scoresIdx }) {
  if (!round) return false;
  if (round.status === 'locked') return true;
  if (round.status !== 'live') return false;
  const subjects = roundSubjects(round, teamsByRound, roundPlayers);
  return subjects.length > 0 && subjects.every((id) => hasScore(scoresIdx, round.id, id, hole));
}

/** A round is decided once everyone has a score (or pick-up) on every hole, or it's locked. A Stableford player
 *  typed in from a paper card (quick result, no hole scores) counts as finished. */
export function roundComplete({ round, course, teamsByRound, roundPlayers, scoresIdx, quickResults = [] }) {
  if (!round) return false;
  if (round.status === 'locked') return true;
  if (round.status !== 'live') return false;
  const holes = courseHoles(course).map((h) => h.n);
  const subjects = roundSubjects(round, teamsByRound, roundPlayers);
  if (!holes.length || !subjects.length) return false;
  return subjects.every((id) => {
    const card = scoresIdx?.[round.id]?.[id];
    if (round.format === 'stableford' && !(card && Object.keys(card).length)
      && quickResults.some((q) => q.round_id === round.id && q.player_id === id)) return true;
    return holes.every((n) => hasScore(scoresIdx, round.id, id, n));
  });
}

/** The winning closest-to-the-pin / longest-drive entry: a confirmed winner, else the best distance. */
export function bestEntry(kind, entries = []) {
  const confirmed = entries.find((e) => e.confirmed);
  if (confirmed) return confirmed;
  const measured = entries.filter((e) => e.distance_m != null);
  if (!measured.length) return null;
  return [...measured].sort((a, b) => (kind === 'ctp' ? Number(a.distance_m) - Number(b.distance_m) : Number(b.distance_m) - Number(a.distance_m)))[0];
}

/** A row's score in words, by format. */
export function scoreText(format, row) {
  if (!row) return '';
  if (format === 'ambrose') return `${formatToPar(row.netToPar, row.netToPar % 1 ? 1 : 0)} net`;
  if (format === 'stroke') return `${formatToPar(row.netToPar)} net`;
  return `${row.points} pts`;
}

const played = (r) => r.thru > 0 || r.quick;
const uniq = (a) => [...new Set(a.filter(Boolean))];

/** "2nd Al 36 pts · 3rd Kurt 35 pts" — the places after the winner(s), up to 3rd. */
function placings(rows, text) {
  return rows
    .filter((r) => r.rank > 1 && r.rank <= 3 && played(r))
    .slice(0, 3)
    .map((r) => `${ordinal(r.rank)}${r.rankLabel?.startsWith('T') ? '=' : ''} ${r.name} ${text(r)}`)
    .join(' · ');
}

function buildBoard(ctx, round) {
  const teams = ctx.teamsByRound?.[round.id] || [];
  const side = (ctx.sideEntries || []).filter((e) => e.round_id === round.id);
  return roundBoard({
    round, course: ctx.coursesById?.[round.course_id], teams,
    roundPlayers: ctx.roundPlayers?.[round.id] || [], playersById: ctx.playersById || {},
    scoresIdx: ctx.scoresIdx || {}, quickResults: ctx.quickResults || [],
    bonuses: compBonuses(round, teams, side),
  });
}

/** The round's winner (and the top 3), once the round is decided. */
export function roundMoment(ctx, round) {
  if (!roundComplete({ round, course: ctx.coursesById?.[round.course_id], teamsByRound: ctx.teamsByRound, roundPlayers: ctx.roundPlayers, scoresIdx: ctx.scoresIdx, quickResults: ctx.quickResults })) return null;
  const board = buildBoard(ctx, round);
  const winners = board.rows.filter((r) => r.rank === 1 && played(r));
  if (!winners.length) return null;
  const text = (r) => scoreText(board.format, r);
  const team = isTeamFormat(board.format);
  const who = nameList(winners.map((w) => w.name));
  const title = winners.length > 1
    ? `🏆 ${who} tie for ${round.name} — ${text(winners[0])}`
    : `🏆 ${who} ${team ? 'win' : 'wins'} ${round.name} — ${text(winners[0])}`;
  const teamNames = team && winners.length === 1 ? nameList((winners[0].players || []).map(pName)) : '';
  const detail = [teamNames, placings(board.rows, text)].filter(Boolean).join(' · ');
  return {
    key: `round:${round.id}`, kind: 'round', round_id: round.id, title, detail: detail || null,
    winner_player_ids: uniq(winners.flatMap((w) => (w.players || []).map((p) => p.id))),
  };
}

/** Closest to the pin and longest drive: one moment per decided hole that has a winner. */
export function compMoments(ctx, round) {
  const out = [];
  for (const kind of ['ctp', 'ld']) {
    for (const hole of (kind === 'ctp' ? round.ctp_holes : round.ld_holes) || []) {
      if (!holeDecided({ round, hole, teamsByRound: ctx.teamsByRound, roundPlayers: ctx.roundPlayers, scoresIdx: ctx.scoresIdx })) continue;
      const here = (ctx.sideEntries || []).filter((e) => e.round_id === round.id && e.kind === kind && e.hole === hole);
      const best = bestEntry(kind, here);
      if (!best) continue;
      const name = pName(ctx.playersById?.[best.player_id]);
      const dist = best.distance_m != null ? ` — ${Number(best.distance_m)} m` : '';
      out.push({
        key: `${kind}:${round.id}:${hole}`, kind, round_id: round.id,
        title: kind === 'ctp' ? `🎯 ${name} wins closest to the pin on ${hole}${dist}` : `💣 ${name} wins longest drive on ${hole}${dist}`,
        detail: round.name, winner_player_ids: [best.player_id],
      });
    }
  }
  return out;
}

const theName = (name) => (/^the\s/i.test(name) ? name : `the ${name}`);

/** A Stableford-total or Ambrose trophy, once its last counting round in the trip is decided. */
export function trophyMoment(ctx, trophy) {
  if (trophy.type !== 'stableford_total' && trophy.type !== 'ambrose') return null;
  const format = trophy.type === 'ambrose' ? 'ambrose' : 'stableford';
  const counting = (ctx.rounds || []).filter((r) => r.trip_id === trophy.trip_id && r.format === format);
  const last = counting[counting.length - 1];
  if (!last || !isFresh(last, ctx.today)) return null;
  const done = (r) => roundComplete({ round: r, course: ctx.coursesById?.[r.course_id], teamsByRound: ctx.teamsByRound, roundPlayers: ctx.roundPlayers, scoresIdx: ctx.scoresIdx, quickResults: ctx.quickResults });
  if (!done(last)) return null;
  // Another counting round still being played: the total isn't final yet.
  if (counting.some((r) => r.status === 'live' && !done(r))) return null;
  if (format === 'ambrose') {
    const board = buildBoard(ctx, last);
    const winners = board.rows.filter((r) => r.rank === 1 && played(r));
    if (!winners.length) return null;
    const who = nameList(winners.map((w) => w.name));
    const text = (r) => scoreText('ambrose', r);
    return {
      key: `trophy:${trophy.id}`, kind: 'trophy', round_id: last.id,
      title: `🏆 ${who} ${winners.length > 1 ? 'share' : 'win'} ${theName(trophy.name)} — ${text(winners[0])}`,
      detail: [winners.length === 1 ? nameList((winners[0].players || []).map(pName)) : '', placings(board.rows, text)].filter(Boolean).join(' · ') || null,
      winner_player_ids: uniq(winners.flatMap((w) => (w.players || []).map((p) => p.id))),
    };
  }
  const board = stablefordTrophyBoard({
    trip: { id: trophy.trip_id }, rounds: ctx.rounds || [], coursesById: ctx.coursesById || {}, roundPlayers: ctx.roundPlayers || {},
    playersById: ctx.playersById || {}, scoresIdx: ctx.scoresIdx || {}, quickResults: ctx.quickResults || [],
  });
  const winners = board.rows.filter((r) => r.rank === 1 && r.total > 0);
  if (!winners.length) return null;
  const text = (r) => `${r.total} pts`;
  return {
    key: `trophy:${trophy.id}`, kind: 'trophy', round_id: last.id,
    title: `🏆 ${nameList(winners.map((w) => w.name))} ${winners.length > 1 ? 'share' : 'wins'} ${theName(trophy.name)} — ${text(winners[0])}`,
    detail: placings(board.rows.filter((r) => r.total > 0), text) || null,
    winner_player_ids: uniq(winners.map((w) => w.id)),
  };
}

/** A decided Cup match: "Team Blue win match 3: Kurt & Al 3&2". */
export function cupMoment(ctx, match) {
  const s = matchState(match);
  if (!s.started || !s.decided) return null;
  const side = (n) => (ctx.cupSides || []).find((x) => Number(x.sort) === n);
  const names = { a: side(1)?.name || 'Team A', b: side(2)?.name || 'Team B' };
  const players = (ids) => nameList((ids || []).map((id) => pName(ctx.playersById?.[id])).filter(Boolean)).replace(/ and /g, ' & ');
  const num = match.sort ? ` ${match.sort}` : '';
  const round = (ctx.rounds || []).find((r) => r.id === match.round_id);
  if (s.winner === 'h') {
    return {
      key: `cup:${match.id}`, kind: 'cup', round_id: match.round_id,
      title: `🤝 Match${num} halved: ${players(match.a_players)} v ${players(match.b_players)}`,
      detail: [round?.name, `½ point each`].filter(Boolean).join(' · '),
      winner_player_ids: uniq([...(match.a_players || []), ...(match.b_players || [])]),
    };
  }
  const by = s.remaining > 0 ? `${s.lead}&${s.remaining}` : `${s.lead} UP`;
  const ids = s.winner === 'a' ? match.a_players : match.b_players;
  const losers = s.winner === 'a' ? match.b_players : match.a_players;
  return {
    key: `cup:${match.id}`, kind: 'cup', round_id: match.round_id,
    title: `🏆 ${names[s.winner]} win match${num}: ${players(ids)} ${by}`,
    detail: [`beat ${players(losers)}`, round?.name].filter(Boolean).join(' · '),
    winner_player_ids: uniq(ids || []),
  };
}

/**
 * Everything that's decided right now and worth announcing. `features` = { side_comps, trophies, cup } (on/off).
 * ctx: { today, rounds (in play order), coursesById, teamsByRound, roundPlayers, playersById, scoresIdx, quickResults,
 *        sideEntries, trophies, cupMatches, cupSides, features }.
 */
export function decidedMoments(ctx) {
  const f = ctx.features || {};
  const fresh = (ctx.rounds || []).filter((r) => isFresh(r, ctx.today));
  const out = [];
  for (const r of fresh) {
    const m = roundMoment(ctx, r);
    if (m) out.push(m);
    if (f.side_comps) out.push(...compMoments(ctx, r));
  }
  if (f.trophies) for (const t of ctx.trophies || []) { const m = trophyMoment(ctx, t); if (m) out.push(m); }
  if (f.cup) {
    const freshIds = new Set(fresh.map((r) => r.id));
    for (const m of ctx.cupMatches || []) { if (freshIds.has(m.round_id)) { const x = cupMoment(ctx, m); if (x) out.push(x); } }
  }
  return out;
}

/** Has a recorded moment drifted from what the scores now say (e.g. a score fixed after it was recorded)? */
export function momentChanged(saved, now) {
  if (!saved || !now) return false;
  const ids = (a) => [...(a || [])].sort().join(',');
  return saved.title !== now.title || (saved.detail || null) !== (now.detail || null) || ids(saved.winner_player_ids) !== ids(now.winner_player_ids);
}

/** Moments for the leaderboard card: the last few hours, newest first, not hidden on this phone. */
export function recentMoments(list, { now = Date.now(), hours = RECENT_HOURS, hidden = [] } = {}) {
  const since = now - hours * 3600000;
  return (list || [])
    .filter((m) => new Date(m.created_at).getTime() >= since && !hidden.includes(m.id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

/** Who may change a moment's photo: anyone while there's none; then whoever took it, or an organiser. */
export function canChangePhoto(moment, { playerId, isOrganiser }) {
  if (!moment) return false;
  if (isOrganiser) return true;
  if (!moment.photo_url) return !!playerId;
  return !!playerId && moment.photo_by === playerId;
}
