import { describe, it, expect } from 'vitest';
import {
  buildHistory, playerStats, headToHead, records, seasonResults, seasonTrophies, tripWinners, holeRecord,
  roundDate, isDecided, courseHoleStats, signed, playerCards, teamResults,
} from './stats.js';
import { seasonLadder, seasonRange } from './ladder.js';

// A course: holes 1–4 par 3, 5–14 par 4, 15–18 par 5 (par 72); stroke index = hole number.
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: i < 4 ? 3 : i < 14 ? 4 : 5, si: i + 1 }));
const par = (n) => holes[n - 1].par;
/** Scores for every hole: par + delta, with overrides { hole: strokes | 'P' }. */
const card = (delta, over = {}) => Object.fromEntries(holes.map((h) => {
  const o = over[h.n];
  return [h.n, o === 'P' ? { strokes: null, picked_up: true } : { strokes: o ?? h.par + delta, picked_up: false }];
}));

const A = 'a', B = 'b', C = 'c', D = 'd';
const players = [
  { id: A, name: 'Alan Ace', nickname: 'Acey', handicap: 18 },
  { id: B, name: 'Bob Birdie', nickname: null, handicap: 0 },
  { id: C, name: 'Cam Chip', nickname: null, handicap: 10 },
  { id: D, name: 'Dan Duff', nickname: null, handicap: 0 },
];
const trips = [
  { id: 'T1', name: 'Bowral 2025', start_date: '2025-03-01', end_date: '2025-03-02', status: 'locked', created_at: '2025-01-01T00:00:00Z' },
  { id: 'T2', name: 'Hunter 2026', start_date: '2026-05-10', end_date: '2026-05-12', status: 'active', created_at: '2026-01-01T00:00:00Z' },
];
const rounds = [
  { id: 'R1', trip_id: 'T1', course_id: 'K', name: 'Sat Stableford', play_date: '2025-03-01', format: 'stableford', status: 'locked', created_at: '2025-01-01T00:00:00Z' },
  { id: 'R2', trip_id: 'T1', course_id: 'K', name: 'Sun Stroke', play_date: '2025-03-02', format: 'stroke', status: 'locked', created_at: '2025-01-01T00:00:01Z' },
  { id: 'R3', trip_id: 'T1', course_id: 'K', name: 'Sun Ambrose', play_date: '2025-03-02', format: 'ambrose', status: 'locked', created_at: '2025-01-01T00:00:02Z' },
  { id: 'R4', trip_id: 'T2', course_id: 'K', name: 'Fri 4BBB', play_date: '2026-05-10', format: 'fourball', status: 'locked', created_at: '2026-01-01T00:00:00Z' },
  { id: 'R5', trip_id: 'T2', course_id: 'K', name: 'Sat Stableford', play_date: '2026-05-11', format: 'stableford', status: 'locked', created_at: '2026-01-01T00:00:01Z' },
];
const team = (id, roundId, name, ids, handicap = 0) => ({ id, round_id: roundId, name, handicap, players: ids.map((x) => players.find((p) => p.id === x)) });
const rp = (roundId, list) => list.map(([player_id, playing_handicap]) => ({ round_id: roundId, player_id, playing_handicap }));
const scoresIdx = {
  R1: { [A]: card(1), [B]: card(0, { 18: 4 }) },
  R2: { [A]: card(1, { 1: 2 }), [B]: card(0, { 5: 6 }) },
  R3: { X: card(0), Y: card(0, { 1: 4 }) },
  R4: { [A]: card(0, { 2: 'P' }), [B]: card(0), [C]: card(2), [D]: card(2) },
  R5: { [A]: card(2), [B]: card(0) },
};
const data = {
  rounds, trips,
  trophies: [{ id: 'tr1', trip_id: 'T1', name: 'BD', type: 'stableford_total' }, { id: 'tr2', trip_id: 'T2', name: 'BD', type: 'stableford_total' }],
  coursesById: { K: { id: 'K', name: 'Wollongong GC', holes } },
  roundPlayers: {
    R1: rp('R1', [[A, 18], [B, 0]]), R2: rp('R2', [[A, 18], [B, 0]]),
    R4: rp('R4', [[A, 18], [B, 0], [C, 0], [D, 0]]), R5: rp('R5', [[A, 18], [B, 0], [C, 10]]),
  },
  teamsByRound: {
    R3: [team('X', 'R3', 'Aces', [A, C]), team('Y', 'R3', 'Birdies', [B, D])],
    R4: [team('P1', 'R4', 'Acey & Bob', [A, B]), team('P2', 'R4', 'Cam & Dan', [C, D])],
  },
  playersById: Object.fromEntries(players.map((p) => [p.id, p])),
  quick_results: [{ round_id: 'R5', player_id: C, points: 30 }],
  honour_board: [{ id: 'h1', trophy_name: 'BD', label: 'Hunter 2026', winner_names: 'Alan Ace', player_ids: [A], trip_id: 'T2', sort_key: 10, created_at: '2026-05-12T09:00:00Z' }],
};
const ctx = buildHistory(data, scoresIdx);

describe('one hole', () => {
  it('works out gross, net and points', () => {
    expect(holeRecord(holes[0], { strokes: 2 }, 18, 'stroke')).toMatchObject({ gross: 2, toPar: -1, net: -2, points: 4 });
    expect(holeRecord(holes[4], { strokes: 6 }, 0, 'stableford')).toMatchObject({ toPar: 2, net: 2, points: 0 });
  });
  it('a pick-up is a net double bogey in solo rounds and left out in 4BBB', () => {
    expect(holeRecord(holes[4], { picked_up: true }, 18, 'stableford')).toMatchObject({ gross: 7, toPar: 3, net: 2, points: 0, pickedUp: true });
    expect(holeRecord(holes[4], { picked_up: true }, 18, 'fourball')).toBeNull();
    expect(holeRecord(holes[4], undefined, 18, 'stableford')).toBeNull();
  });
});

describe('dates and settled rounds', () => {
  it('a round is dated by its play date, then its trip, then when it was made', () => {
    expect(roundDate({ play_date: '2026-01-02' }, {})).toBe('2026-01-02');
    expect(roundDate({ trip_id: 'T1' }, { T1: { start_date: '2025-03-01' } })).toBe('2025-03-01');
    expect(roundDate({ created_at: '2024-07-08T10:00:00Z' }, {})).toBe('2024-07-08');
  });
  it('settled = locked or everyone finished', () => {
    expect(isDecided({ status: 'locked' }, { rows: [] })).toBe(true);
    expect(isDecided({ status: 'live' }, { rows: [{ finished: true }, { finished: false }] })).toBe(false);
    expect(isDecided({ status: 'live' }, { rows: [{ finished: true }] })).toBe(true);
    expect(isDecided({ status: 'setup' }, { rows: [{ finished: true }] })).toBe(false);
  });
});

describe('a player’s stats', () => {
  const s = playerStats(ctx, A);
  it('counts every round played, individual and team', () => {
    expect(s.roundsPlayed).toBe(5);
    expect(s.individualRounds).toBe(3);
  });
  it('averages Stableford points and net to par over finished Stableford and stroke rounds', () => {
    // R1 36, R2 38, R5 18
    expect(s.avgPoints).toBe(30.7);
    // R1 level, R2 −2, R5 +18
    expect(s.avgNet).toBe(5.3);
  });
  it('says what they play to against the handicap they played off', () => {
    expect(s.playsTo).toBe(23.3);
    expect(s.playedOff).toBe(18);
    expect(s.vsHandicap).toBe(5.3);
  });
  it('finds the best round and the form', () => {
    expect(s.best.roundId).toBe('R2');
    expect(s.best.points).toBe(38);
    expect(s.form.map((f) => f.points)).toEqual([36, 38, 18]);
  });
  it('counts birdies, pars and doubles from every hole they scored themselves (4BBB pick-ups left out)', () => {
    expect(s.counts).toEqual({ holes: 71, eagles: 0, birdies: 1, pars: 17, bogeys: 35, doubles: 18 });
  });
  it('averages par 3s, 4s and 5s', () => {
    expect(s.parTypes[3].n).toBe(15);
    expect(s.parTypes[3].avg).toBeCloseTo(14 / 15, 5);
    expect(s.parTypes[5].avg).toBeCloseTo((4 + 4 + 8 + 0) / 16, 5);
  });
  it('finds best and worst holes on each course', () => {
    expect(s.courses).toHaveLength(1);
    const c = s.courses[0];
    expect(c.rounds).toBe(4);
    expect(c.best.map((h) => h.n)).toEqual([1, 3, 4]);
    expect(c.best[0].avg).toBeCloseTo(0.5, 5);
    expect(c.worst.map((h) => h.n)).toEqual([2, 5, 6]);
    expect(c.worst[0].avg).toBeCloseTo(4 / 3, 5);
  });
  it('Ambrose and 4BBB count as team results', () => {
    expect(s.team.played).toBe(2);
    expect(s.team.wins).toBe(2);
    expect(s.team.avgFinish).toBe(1);
  });
  it('counts trips and trophies won', () => {
    expect(s.tripsWon).toBe(1);
    expect(s.tripsWonList[0].id).toBe('T2');
    expect(s.trophies).toBe(1);
  });
  it('a paper (quick) result counts for points but not net or holes', () => {
    const c = playerStats(ctx, C);
    expect(c.avgPoints).toBe(30);
    expect(c.avgNet).toBeNull();
    expect(c.playsTo).toBe(16); // 10 + 6 shots worse
    expect(c.best.points).toBe(30);
    expect(c.team.played).toBe(2);
    expect(c.team.wins).toBe(1); // won the Ambrose with Acey, lost the 4BBB
  });
  it('a player with nothing yet', () => {
    const e = playerStats(buildHistory({ ...data, rounds: [] }, {}), A);
    expect(e).toMatchObject({ roundsPlayed: 0, avgPoints: null, avgNet: null, playsTo: null, best: null, form: [], tripsWon: 0 });
    expect(e.counts.holes).toBe(0);
  });
  it('a 9-hole round is scaled to 18 holes for averages', () => {
    const nine = holes.slice(0, 9);
    const c2 = buildHistory({
      ...data, rounds: [{ ...rounds[0], id: 'N', course_id: 'N9' }], coursesById: { N9: { id: 'N9', name: 'Nine', holes: nine } },
      roundPlayers: { N: rp('N', [[B, 0]]) }, quick_results: [],
    }, { N: { [B]: Object.fromEntries(nine.map((h) => [h.n, { strokes: h.par }])) } });
    const s9 = playerStats(c2, B);
    expect(s9.avgPoints).toBe(36);
    expect(s9.playsTo).toBe(0);
  });
});

describe('trips won', () => {
  it('the engraved winner counts first, then the Stableford trophy board', () => {
    const w = tripWinners(ctx);
    expect(w.T1).toMatchObject({ ids: [B], from: 'scores' });
    expect(w.T2).toMatchObject({ ids: [A], from: 'honour' });
  });
  it('a trip still going has no winner', () => {
    const c2 = buildHistory({ ...data, rounds: rounds.map((r) => (r.id === 'R5' ? { ...r, status: 'live' } : r)), quick_results: [] }, { ...scoresIdx, R5: { [A]: card(2), [B]: { 1: { strokes: 3 } } } });
    expect(tripWinners(c2).T2).toBeUndefined();
  });
  it('an honour board entry with only names matches players by name or nickname', () => {
    const c2 = buildHistory({ ...data, honour_board: [{ ...data.honour_board[0], player_ids: [], winner_names: 'Acey & Bob Birdie' }] }, scoresIdx);
    expect(tripWinners(c2).T2.ids.sort()).toEqual([A, B]);
  });
});

describe('head-to-head', () => {
  const h = headToHead(ctx, A, B);
  it('compares the individual rounds both finished', () => {
    expect(h.rounds.map((x) => [x.round.id, x.winner, x.margin, x.unit])).toEqual([
      ['R1', 'b', -1, 'pts'],
      ['R2', 'a', 4, 'shots'],
      ['R5', 'b', -18, 'pts'],
    ]);
    expect([h.a, h.b, h.halves]).toEqual([1, 2, 0]);
    expect(h.avgMargin).toBe(-5);
  });
  it('team rounds: opposite teams count, partners are counted apart', () => {
    expect(h.team.rounds.map((x) => [x.round.id, x.winner])).toEqual([['R3', 'a']]);
    expect(h.partners).toBe(1);
    expect(h.partnerWins).toBe(1);
  });
  it('the other way round flips it', () => {
    const r = headToHead(ctx, B, A);
    expect([r.a, r.b]).toEqual([2, 1]);
    expect(r.avgMargin).toBe(5);
  });
  it('a tie is halved; nobody plays themselves', () => {
    const c2 = buildHistory(data, { ...scoresIdx, R1: { [A]: card(1), [B]: card(0) } });
    expect(headToHead(c2, A, B).rounds[0].winner).toBe('half');
    expect(headToHead(ctx, A, A).rounds).toEqual([]);
  });
});

describe('records', () => {
  const r = records(ctx);
  it('best rounds by shots against handicap', () => {
    expect(r.bestRounds.map((x) => [x.playerId, x.round.id, x.points])).toEqual([
      [A, 'R2', 38], [B, 'R1', 37], [B, 'R5', 36], [A, 'R1', 36], [B, 'R2', 34],
    ]);
  });
  it('most birdies and most trip wins', () => {
    expect(r.mostBirdies.map((x) => [x.playerId, x.total]).sort()).toEqual([[A, 1], [B, 1]]);
    expect(r.mostTripWins.map((x) => [x.playerId, x.wins]).sort()).toEqual([[A, 1], [B, 1]]);
  });
});

describe('the season ladder from the history', () => {
  it('ranks each settled individual round’s finishers', () => {
    const res = seasonResults(ctx);
    expect(res.map((x) => x.roundId)).toEqual(['R1', 'R2', 'R5']);
    expect(res[2].rows).toEqual([{ id: B, rank: 1 }, { id: C, rank: 2 }, { id: A, rank: 3 }]);
  });
  it('dates trophies by their trip, the app, or the year in the label', () => {
    const c2 = buildHistory({ ...data, honour_board: [
      ...data.honour_board,
      { id: 'h2', trophy_name: 'Noodle Cup', label: '2019', winner_names: 'Bob Birdie', player_ids: [B], imported: true, created_at: '2026-10-01T00:00:00Z' },
      { id: 'h3', trophy_name: 'Old', label: 'Long ago', winner_names: 'Bob Birdie', player_ids: [B], imported: true },
      { id: 'h4', trophy_name: 'Spoon', label: 'Oct', winner_names: 'Cam Chip', player_ids: [C], created_at: '2026-10-20T00:00:00Z' },
    ] }, scoresIdx);
    expect(seasonTrophies(c2).map((t) => [t.name, t.date])).toEqual([['BD', '2026-05-12'], ['Noodle Cup', '2019-07-01'], ['Spoon', '2026-10-20']]);
  });
  it('2026: Acey’s trophy bonus puts him top', () => {
    const lad = seasonLadder({ results: seasonResults(ctx), trophies: seasonTrophies(ctx), range: seasonRange(null, 2026) });
    expect(lad.rows.map((r) => [r.id, r.total, r.rankLabel])).toEqual([[A, 11, '1'], [B, 10, '2'], [C, 8, '3']]);
    expect(lad.rounds).toBe(1);
  });
  it('2025: level on points, wins and podiums — they share first', () => {
    const lad = seasonLadder({ results: seasonResults(ctx), trophies: seasonTrophies(ctx), range: seasonRange(null, 2025), names: { a: 'Acey', b: 'Bob' } });
    expect(lad.rows.map((r) => [r.id, r.total, r.rankLabel])).toEqual([[A, 18, 'T1'], [B, 18, 'T1']]);
  });
  it('a live round with someone still out doesn’t count yet', () => {
    const c2 = buildHistory({ ...data, rounds: rounds.map((r) => (r.id === 'R5' ? { ...r, status: 'live' } : r)) }, { ...scoresIdx, R5: { [A]: { 1: { strokes: 3 } }, [B]: card(0) } });
    expect(seasonResults(c2).map((x) => x.roundId)).toEqual(['R1', 'R2']);
  });
});

describe('bits and pieces', () => {
  it('cards are oldest first; team results skip rounds not played', () => {
    expect(playerCards(ctx, A).map((c) => c.round.id)).toEqual(['R1', 'R2', 'R4', 'R5']);
    expect(teamResults(ctx, D).map((t) => [t.round.id, t.won])).toEqual([['R3', false], ['R4', false]]);
  });
  it('courseHoleStats ignores cards without holes', () => {
    expect(courseHoleStats([{ course: null, holes: [] }])).toEqual([]);
  });
  it('signed numbers', () => {
    expect(signed(-2.54)).toBe('−2.5');
    expect(signed(1)).toBe('+1');
    expect(signed(0)).toBe('level');
    expect(signed(null)).toBe('–');
  });
});
