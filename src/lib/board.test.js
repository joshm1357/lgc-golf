// v8 fix (23 Oct 2026): Sunday Ambrose showed −7, then −9 — the board was drawn before the side entries had loaded.
import { describe, it, expect } from 'vitest';
import { readyBoard, needsSideEntries } from './board.js';

const SI = [7, 15, 3, 11, 1, 17, 9, 13, 5, 8, 16, 4, 12, 2, 18, 10, 14, 6];
const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const holes = PAR.map((par, i) => ({ n: i + 1, par, si: SI[i] }));
const sc = (arr) => Object.fromEntries(arr.map((s, i) => [i + 1, { strokes: s }]));

describe('a board with side comp bonus strokes never shows the total without its bonus', () => {
  const round = { id: 'r', format: 'ambrose', comp_bonus: 2, ctp_holes: [6], ld_holes: [9] };
  const teams = [{ id: 'A', name: 'A', handicap: 10, players: [{ id: 'a1' }, { id: 'a2' }] }, { id: 'B', name: 'B', handicap: 10, players: [{ id: 'b1' }] }];
  const entries = [{ kind: 'ld', hole: 9, player_id: 'a1', distance_m: 240 }];
  const course = { holes };
  const scoresIdx = { r: { A: sc(PAR), B: sc(PAR) } };

  it('knows which rounds need side entries', () => {
    expect(needsSideEntries(round)).toBe(true);
    expect(needsSideEntries({ ...round, comp_bonus: 0 })).toBe(false);
    expect(needsSideEntries({ ...round, format: 'stableford' })).toBe(false);
    expect(needsSideEntries({ ...round, ctp_holes: [], ld_holes: [] })).toBe(false);
    expect(needsSideEntries(null)).toBe(false);
  });
  it('gives no board (a loading state) until the side entries are known', () => {
    expect(readyBoard({ round, course, teams, scoresIdx, sideEntries: [], sideLoaded: false })).toBeNull();
  });
  it('across load states, only the bonused total is ever produced', () => {
    const unbonused = readyBoard({ round: { ...round, comp_bonus: 0 }, course, teams, scoresIdx }).rows.find((r) => r.id === 'A').netToPar;
    const seen = [false, true]
      .map((sideLoaded) => readyBoard({ round, course, teams, scoresIdx, sideEntries: sideLoaded ? entries : [], sideLoaded }))
      .filter(Boolean)
      .map((b) => b.rows.find((r) => r.id === 'A').netToPar);
    expect(seen).toEqual([unbonused - 2]);
  });
  it('rounds without bonus strokes don’t wait', () => {
    expect(readyBoard({ round: { ...round, comp_bonus: 0 }, course, teams, scoresIdx, sideLoaded: false })).not.toBeNull();
  });
});
