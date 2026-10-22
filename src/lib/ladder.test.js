import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POINTS, DEFAULT_BONUS, ladderSettings, seasonRange, inRange, seasonYears, placePoints, roundPoints,
  seasonLadder, parsePoints, pointsText, fmtPts, shortDate,
} from './ladder.js';

const today = new Date(2026, 9, 21);

describe('settings', () => {
  it('no row = the defaults: this calendar year, 10-8-6-5-4-3-2-1, 5 a trophy', () => {
    expect(ladderSettings(null)).toEqual({ name: null, mode: 'year', start_date: null, end_date: null, points: DEFAULT_POINTS, trophy_bonus: DEFAULT_BONUS });
  });
  it('a custom range only when both dates make sense', () => {
    expect(ladderSettings({ mode: 'range', start_date: '2026-03-01', end_date: '2027-02-28' }).mode).toBe('range');
    expect(ladderSettings({ mode: 'range', start_date: '2026-03-01', end_date: '2026-01-01' }).mode).toBe('year');
    expect(ladderSettings({ mode: 'range', start_date: null, end_date: '2026-01-01' }).mode).toBe('year');
  });
  it('tidies points and bonus', () => {
    const s = ladderSettings({ points: [12, '9', -3, 4.6], trophy_bonus: 0 });
    expect(s.points).toEqual([12, 9, 0, 5]);
    expect(s.trophy_bonus).toBe(0);
  });
});

describe('season dates', () => {
  it('a calendar year by default (this year)', () => {
    expect(seasonRange(null, undefined, today)).toMatchObject({ start: '2026-01-01', end: '2026-12-31', label: '2026', custom: false });
    expect(seasonRange(null, 2024, today)).toMatchObject({ start: '2024-01-01', end: '2024-12-31', label: '2024' });
  });
  it('the group’s own range, unless a year is picked to look back at', () => {
    const set = { mode: 'range', start_date: '2026-03-01', end_date: '2027-02-28' };
    expect(seasonRange(set, undefined, today)).toMatchObject({ start: '2026-03-01', end: '2027-02-28', label: '1 Mar 2026 – 28 Feb 2027', custom: true });
    expect(seasonRange(set, 2025, today)).toMatchObject({ start: '2025-01-01', custom: false });
  });
  it('in range, inclusive', () => {
    const r = seasonRange(null, 2026, today);
    expect(inRange('2026-01-01', r)).toBe(true);
    expect(inRange('2026-12-31', r)).toBe(true);
    expect(inRange('2027-01-01', r)).toBe(false);
    expect(inRange(null, r)).toBe(false);
  });
  it('the years to pick from', () => {
    expect(seasonYears(['2024-05-01', '2019-07-01', 'junk', null], today)).toEqual([2026, 2024, 2019]);
  });
  it('short dates', () => {
    expect(shortDate('2026-03-01')).toBe('1 Mar 2026');
    expect(shortDate('nope')).toBe('');
  });
});

describe('points for places', () => {
  it('straight places', () => {
    expect(placePoints(DEFAULT_POINTS, 1)).toBe(10);
    expect(placePoints(DEFAULT_POINTS, 8)).toBe(1);
    expect(placePoints(DEFAULT_POINTS, 9)).toBe(0);
  });
  it('ties share the points for the places they cover', () => {
    expect(placePoints(DEFAULT_POINTS, 2, 2)).toBe(7); // (8 + 6) / 2
    expect(placePoints(DEFAULT_POINTS, 1, 3)).toBe(8); // (10 + 8 + 6) / 3
    expect(placePoints(DEFAULT_POINTS, 8, 2)).toBe(0.5); // (1 + 0) / 2
  });
  it('a whole round', () => {
    const pts = roundPoints([{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: 2 }, { id: 'd', rank: 4 }], DEFAULT_POINTS);
    expect(pts).toEqual({ a: { place: 1, tied: 1, points: 10 }, b: { place: 2, tied: 2, points: 7 }, c: { place: 2, tied: 2, points: 7 }, d: { place: 4, tied: 1, points: 5 } });
  });
});

describe('the ladder', () => {
  const results = [
    { roundId: 'r1', date: '2026-02-01', rows: [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: 3 }] },
    { roundId: 'r2', date: '2026-02-02', rows: [{ id: 'b', rank: 1 }, { id: 'a', rank: 2 }, { id: 'c', rank: 2 }] },
    { roundId: 'r3', date: '2025-12-30', rows: [{ id: 'c', rank: 1 }] },
  ];
  const names = { a: 'Al', b: 'Bo', c: 'Cy' };
  it('adds up the season’s rounds only', () => {
    const l = seasonLadder({ results, range: seasonRange(null, 2026, today), names });
    expect(l.rounds).toBe(2);
    // a: 10 + (8 + 6) / 2 = 17, b: 8 + 10 = 18, c: 6 + 7 = 13
    expect(l.rows.map((r) => [r.id, r.total, r.wins, r.rounds])).toEqual([['b', 18, 1, 2], ['a', 17, 1, 2], ['c', 13, 0, 2]]);
    expect(l.rows[0].byRound.r2).toEqual({ place: 1, tied: 1, points: 10 });
  });
  it('trophy bonus, and ties on total split by wins then podiums', () => {
    const l = seasonLadder({ results, trophies: [{ date: '2026-02-02', playerIds: ['a'], name: 'BD' }, { date: '2024-01-01', playerIds: ['c'], name: 'Old' }], range: seasonRange(null, 2026, today), bonus: 1, names });
    // a: 10 + 7 + 1 = 18, b: 8 + 10 = 18 — one win each, two podiums each: shared.
    expect(l.rows.map((r) => [r.id, r.total, r.rankLabel])).toEqual([['a', 18, 'T1'], ['b', 18, 'T1'], ['c', 13, '3']]);
    expect(l.rows[0].trophies).toEqual(['BD']);
    expect(l.rows[0].bonusPoints).toBe(1);
  });
  it('more wins breaks a tie on total', () => {
    const l = seasonLadder({ results: [
      { roundId: 'x', date: '2026-01-01', rows: [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }] },
      { roundId: 'y', date: '2026-01-02', rows: [{ id: 'b', rank: 2 }, { id: 'z', rank: 1 }] },
    ], points: [10, 5], bonus: 0, names: { ...names, z: 'Zed' } });
    // a 10 (1 win), z 10 (1 win), b 5 + 5 = 10 (no wins)
    expect(l.rows.map((r) => [r.id, r.rankLabel])).toEqual([['a', 'T1'], ['z', 'T1'], ['b', '3']]);
  });
  it('own points table', () => {
    const l = seasonLadder({ results: results.slice(0, 1), points: [3, 1], names });
    expect(l.rows.map((r) => [r.id, r.total])).toEqual([['a', 3], ['b', 1], ['c', 0]]);
  });
  it('nothing yet', () => {
    expect(seasonLadder({}).rows).toEqual([]);
  });
});

describe('typing the points', () => {
  it('reads dashes, commas or spaces', () => {
    expect(parsePoints('10-8-6-5-4-3-2-1')).toEqual(DEFAULT_POINTS);
    expect(parsePoints('12, 9, 7')).toEqual([12, 9, 7]);
    expect(parsePoints(' 5 3 1 ')).toEqual([5, 3, 1]);
  });
  it('refuses nonsense', () => {
    expect(parsePoints('')).toBeNull();
    expect(parsePoints('10-x')).toBeNull();
    expect(parsePoints('10-8.5')).toBeNull();
    expect(parsePoints('101')).toBeNull();
    expect(parsePoints(Array(31).fill(1).join('-'))).toBeNull();
  });
  it('shows them back', () => {
    expect(pointsText([10, 8])).toBe('10-8');
    expect(pointsText(null)).toBe('10-8-6-5-4-3-2-1');
    expect(fmtPts(7)).toBe('7');
    expect(fmtPts(7.5)).toBe('7.5');
  });
});
