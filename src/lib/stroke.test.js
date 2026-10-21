import { describe, it, expect } from 'vitest';
import { strokeStatus, strokeHoleNet } from './scoring.js';
import { roundBoard, headlines } from './board.js';

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const sc = (arr) => Object.fromEntries(arr.map((v, i) => [i + 1, v === 'P' ? { picked_up: true } : { strokes: v }]));

describe('stroke play', () => {
  it('net to par uses shots on the hardest holes', () => {
    // Off 2: a shot on SI 1 and 2. Bogey, bogey, par = +2 gross, net 0 thru 3.
    const st = strokeStatus(holes, sc([5, 5, 4]), 2);
    expect(st).toMatchObject({ thru: 3, gross: 14, grossToPar: 2, netToPar: 0, finished: false, pickups: 0 });
  });
  it('a pick-up counts as net double bogey', () => {
    expect(strokeHoleNet(holes[0], { picked_up: true }, 18)).toBe(2);
    const st = strokeStatus(holes, sc([4, 'P']), 18); // off 18: a shot every hole
    expect(st.netToPar).toBe(-1 + 2);
    expect(st.gross).toBe(4 + 4 + 2 + 1); // pick-up gross = par + 2 + shot
    expect(st.pickups).toBe(1);
  });
  it('ranks lowest net first, with gross on the row and countback on ties', () => {
    const round = { id: 'r', format: 'stroke' };
    const course = { holes };
    const all = (v) => Array(18).fill(v);
    const scoresIdx = { r: {
      a: sc(all(5)),                                // off 18: gross 90, net 72 = E
      b: sc([...all(4).slice(0, 17), 6]),           // off 0: gross 74, +2
      c: sc([...all(5).slice(0, 9)]),               // off 18: thru 9, E
    } };
    const roundPlayers = [{ player_id: 'a', playing_handicap: 18 }, { player_id: 'b', playing_handicap: 0 }, { player_id: 'c', playing_handicap: 18 }];
    const playersById = { a: { name: 'Al' }, b: { name: 'Bo' }, c: { name: 'Cy' } };
    const board = roundBoard({ round, course, roundPlayers, playersById, scoresIdx });
    expect(board.format).toBe('stroke');
    expect(board.higherBetter).toBe(false);
    expect(board.rows.map((r) => [r.name, r.netToPar, r.gross])).toEqual([['Al', 0, 90], ['Cy', 0, 45], ['Bo', 2, 74]]);
    expect(board.rows[0].rankLabel).toBe('T1');
    expect(headlines(board, null)[0]).toMatchObject({ label: 'Leading' });
  });
});
