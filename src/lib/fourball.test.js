import { describe, it, expect } from 'vitest';
import { fourballStatus } from './scoring.js';
import { roundBoard, isNetFormat, isTeamFormat } from './board.js';

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const sc = (arr) => Object.fromEntries(arr.map((v, i) => [i + 1, v === 'P' ? { picked_up: true } : { strokes: v }]));

describe('4BBB', () => {
  it('takes the better points on each hole, once both have scored', () => {
    // A off 0, B off 18 (a shot every hole). Hole 1: A par (2), B bogey net par (2). Hole 2: A birdie (3), B picks up (0).
    // Hole 3: only A has scored — not counted yet.
    const st = fourballStatus(holes, [{ id: 'A', hcp: 0, scores: sc([4, 3, 4]) }, { id: 'B', hcp: 18, scores: sc([5, 'P']) }]);
    expect(st).toMatchObject({ thru: 2, points: 5, vsExpected: 1, finished: false });
    expect(st.perHole).toEqual({ 1: 2, 2: 3 });
    expect(st.counted).toEqual({ 1: ['A', 'B'], 2: ['A'] });
  });
  it('ranks pairs on points, each player off their own handicap', () => {
    const p = (id, h) => ({ id, name: id, handicap: h });
    const teams = [
      { id: 't1', name: 'Kurt & Al', players: [p('K', 12), p('Al', 20)] },
      { id: 't2', name: 'Bo & Cy', players: [p('Bo', 8), p('Cy', 16)] },
    ];
    const scoresIdx = { r: { K: sc([4, 4]), Al: sc([6, 6]), Bo: sc([5, 5]), Cy: sc([5, 4]) } };
    // Round handicap for Cy overrides his 16 with 0.
    const roundPlayers = [{ player_id: 'Cy', playing_handicap: 0 }];
    const board = roundBoard({ round: { id: 'r', format: 'fourball' }, course: { holes }, teams, roundPlayers, scoresIdx });
    expect(board.format).toBe('fourball');
    expect(board.higherBetter).toBe(true);
    // K off 12: shots on SI 1,2 → 3 pts each hole = 6. Bo off 8: net par → 2+2; Cy off 0: 1 + 2 → best 2,2 = 4.
    expect(board.rows.map((r) => [r.name, r.points])).toEqual([['Kurt & Al', 6], ['Bo & Cy', 4]]);
  });
  it('knows which formats are net and which are teams', () => {
    expect([isNetFormat('ambrose'), isNetFormat('stroke'), isNetFormat('stableford'), isNetFormat('fourball')]).toEqual([true, true, false, false]);
    expect([isTeamFormat('ambrose'), isTeamFormat('fourball'), isTeamFormat('stroke')]).toEqual([true, true, false]);
  });
});
