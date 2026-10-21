import { describe, it, expect } from 'vitest';
import { sideHandicap, shots, shotsOnHole, matchState, matchPoints, matchText, cupTotals, toWin, pts, nextHole } from './cup.js';

const res = (list) => Object.fromEntries(list.map((r, i) => [String(i + 1), r]).filter(([, r]) => r));
const N = { a: 'Blue', b: 'Gold' };

describe('handicaps and shots', () => {
  it('singles uses the player handicap; Ambrose pairs is combined ÷ 4', () => {
    expect(sideHandicap('singles', [13.6])).toBe(14);
    expect(sideHandicap('ambrose', [10, 20])).toBe(7.5);
    expect(sideHandicap('ambrose', [])).toBe(0);
  });
  it('the higher handicap side gets the difference, on the lowest stroke indexes', () => {
    const m = { a_hcp: 12, b_hcp: 20 };
    expect(shots(m)).toEqual({ side: 'b', diff: 8 });
    expect(shotsOnHole(m, { si: 8 })).toEqual({ side: 'b', n: 1 });
    expect(shotsOnHole(m, { si: 9 })).toEqual({ side: null, n: 0 });
    expect(shotsOnHole({ a_hcp: 30, b_hcp: 5 }, { si: 3 })).toEqual({ side: 'a', n: 2 });
    expect(shots({ a_hcp: 10, b_hcp: 10 }).side).toBe(null);
  });
  it('Ambrose team handicaps round the difference', () => {
    expect(shots({ a_hcp: 7.5, b_hcp: 4.25 })).toEqual({ side: 'a', diff: 3 });
  });
});

describe('match state', () => {
  it('not started', () => {
    expect(matchText({ holes: {} }, N)).toBe('Not started');
    expect(matchPoints({ holes: {}, points: 2 }, { projected: true })).toEqual({ a: 0, b: 0 });
  });
  it('up, all square and dormie', () => {
    expect(matchText({ holes: res(['a', 'h', 'a']) }, N)).toBe('Blue 2 UP thru 3');
    expect(matchText({ holes: res(['a', 'b']) }, N)).toBe('All square thru 2');
    const d = res([...Array(16).fill('h').map((x, i) => (i < 2 ? 'b' : 'h'))]);
    expect(matchState({ holes: d }).dormie).toBe(true);
    expect(matchText({ holes: d }, N)).toBe('Gold dormie 2');
  });
  it('won early: 3&2', () => {
    const h = res([...Array(13).fill('h'), 'a', 'a', 'a']);
    expect(matchState({ holes: h })).toMatchObject({ decided: true, winner: 'a', lead: 3, remaining: 2 });
    expect(matchText({ holes: h }, N)).toBe('Blue won 3&2');
  });
  it('won on 18: 1 UP; halved after 18', () => {
    expect(matchText({ holes: res([...Array(17).fill('h'), 'b']) }, N)).toBe('Gold won 1 UP');
    expect(matchText({ holes: res(Array(18).fill('h')) }, N)).toBe('Halved');
  });
  it('holes typed out of order still count', () => {
    expect(matchState({ holes: { 3: 'a', 1: 'h' } })).toMatchObject({ played: 2, up: 1 });
    expect(nextHole({ holes: { 3: 'a', 1: 'h' } })).toBe(4);
    expect(nextHole({ holes: {} })).toBe(1);
    expect(nextHole({ holes: res(Array(18).fill('h')) })).toBe(18);
  });
});

describe('points', () => {
  const m1 = { points: 2, holes: res([...Array(13).fill('h'), 'a', 'a', 'a']) };     // Blue won
  const m2 = { points: 2, holes: res(Array(18).fill('h')) };                          // halved
  const m3 = { points: 1, holes: res(['b']) };                                        // Gold 1 up, going
  const m4 = { points: 1, holes: {} };                                                // not started
  it('won, halved, in progress and not started', () => {
    expect(matchPoints(m1)).toEqual({ a: 2, b: 0 });
    expect(matchPoints(m2)).toEqual({ a: 1, b: 1 });
    expect(matchPoints(m3)).toEqual({ a: 0, b: 0 });
    expect(matchPoints(m3, { projected: true })).toEqual({ a: 0, b: 1 });
  });
  it('totals and what wins it', () => {
    expect(cupTotals([m1, m2, m3, m4])).toEqual({ won: { a: 3, b: 1 }, projected: { a: 3, b: 2 }, total: 6 });
    expect(toWin(28)).toBe(14.5);
    expect(pts(14.5)).toBe('14½');
    expect(pts(0.5)).toBe('½');
    expect(pts(3)).toBe('3');
  });
});
