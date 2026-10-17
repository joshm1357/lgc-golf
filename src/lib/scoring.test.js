import { describe, it, expect } from 'vitest';
import {
  strokesReceived, ambroseStatus, countbackKey, compareCountback, rankRows,
  stablefordPoints, stablefordStatus, recentForm, formatToPar,
} from './scoring.js';
import { project, mulberry32 } from './projection.js';

// A par-72 course: SI 1..18 spread over the holes.
const SI = [7, 15, 3, 11, 1, 17, 9, 13, 5, 8, 16, 4, 12, 2, 18, 10, 14, 6];
const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const holes = PAR.map((par, i) => ({ n: i + 1, par, si: SI[i] }));
const sc = (arr) => Object.fromEntries(arr.map((s, i) => [i + 1, { strokes: s }]));

describe('strokes received', () => {
  it('gives one stroke on SI 1..H for handicaps up to 18', () => {
    expect(strokesReceived(7, 7)).toBe(1);
    expect(strokesReceived(7, 8)).toBe(0);
    expect(strokesReceived(0, 1)).toBe(0);
    expect(strokesReceived(18, 18)).toBe(1);
  });
  it('handles handicaps above 18', () => {
    expect(strokesReceived(22, 4)).toBe(2);
    expect(strokesReceived(22, 5)).toBe(1);
    expect(strokesReceived(36, 18)).toBe(2);
  });
  it('rounds decimal handicaps for allocation', () => {
    expect(strokesReceived(6.5, 7)).toBe(1); // 6.5 -> 7
    expect(strokesReceived(6.4, 7)).toBe(0); // 6.4 -> 6
  });
  it('gives strokes back for plus handicaps on the easiest holes', () => {
    expect(strokesReceived(-2, 18)).toBe(-1);
    expect(strokesReceived(-2, 17)).toBe(-1);
    expect(strokesReceived(-2, 16)).toBe(0);
  });
});

describe('Ambrose', () => {
  it('compares a team mid-round on net to par through holes played', () => {
    // 9 holes, all pars, handicap 6.5 (rounded 7): strokes on SI 1..7 within front 9 = SI 7,3,1,5 -> 4 strokes
    const scores = sc(PAR.slice(0, 9));
    const st = ambroseStatus(holes, scores, 6.5);
    expect(st.thru).toBe(9);
    expect(st.netToPar).toBe(-4);
    expect(st.finished).toBe(false);
  });
  it('uses gross minus decimal team handicap once all 18 are done', () => {
    const scores = sc(PAR); // 72
    const st = ambroseStatus(holes, scores, 6.5);
    expect(st.finished).toBe(true);
    expect(st.finalNet).toBe(65.5);
    expect(st.netToPar).toBe(-6.5);
  });
  it('separates ties by countback on the last 9', () => {
    const a = PAR.map((p, i) => (i < 9 ? p - 1 : p)); // birdies on front 9
    const b = PAR.map((p, i) => (i >= 9 ? p - 1 : p)); // birdies on back 9
    const ka = countbackKey(holes, sc(a), 6);
    const kb = countbackKey(holes, sc(b), 6);
    expect(compareCountback(kb, ka)).toBeLessThan(0); // b wins
  });
  it('ranks with shared ranks for genuine ties', () => {
    const r = rankRows([{ name: 'A', v: -2 }, { name: 'B', v: -3 }, { name: 'C', v: -2 }], { key: 'v' });
    expect(r.map((x) => x.rankLabel)).toEqual(['1', 'T2', 'T2']);
  });
});

describe('Stableford', () => {
  it('scores points with strokes received, and 0 for a pick-up', () => {
    const h = { n: 1, par: 4, si: 3 };
    expect(stablefordPoints(h, 4, 10)).toBe(3); // net birdie
    expect(stablefordPoints(h, 5, 10)).toBe(2);
    expect(stablefordPoints(h, 9, 10)).toBe(0);
    expect(stablefordPoints(h, null, 10, true)).toBe(0);
    expect(stablefordPoints(h, 2, 10)).toBe(5); // net albatross... gross eagle with a shot
  });
  it('handles handicaps above 18 (two strokes on hardest holes)', () => {
    const h = { n: 1, par: 4, si: 2 };
    expect(stablefordPoints(h, 6, 24)).toBe(2);
  });
  it('compares a player mid-round on points vs expected', () => {
    const scores = { 1: { strokes: 4 }, 2: { strokes: 4 }, 3: { strokes: 3 } };
    const st = stablefordStatus(holes, scores, 0);
    expect(st.points).toBe(6);
    expect(st.vsExpected).toBe(0);
  });
});

describe('form and formatting', () => {
  it('measures the last 3 holes entered', () => {
    const scores = { 1: { updated_at: 'a' }, 2: { updated_at: 'b' }, 3: { updated_at: 'c' }, 4: { updated_at: 'd' } };
    expect(recentForm({ 1: 2, 2: -1, 3: -1, 4: -1 }, scores, 3)).toBe(-3);
  });
  it('formats to par', () => {
    expect(formatToPar(0)).toBe('E');
    expect(formatToPar(-3)).toBe('−3');
    expect(formatToPar(1.25, 1)).toBe('+1.3');
  });
});

describe('projection', () => {
  const nums = holes.map((h) => h.n);
  it('works when nobody has played a hole yet', () => {
    const rows = project([{ id: 'a', perHole: {} }, { id: 'b', perHole: {} }], nums, { sims: 200 });
    expect(rows[0].projected).toBe(0);
    expect(rows[0].winPct + rows[1].winPct).toBeGreaterThanOrEqual(99);
  });
  it('gives a finished winner 100% when everyone has finished', () => {
    const full = (v) => Object.fromEntries(nums.map((n) => [n, v]));
    const rows = project([{ id: 'a', perHole: full(-0.5) }, { id: 'b', perHole: full(0) }], nums, { sims: 100 });
    expect(rows.find((r) => r.id === 'a').winPct).toBe(100);
  });
  it('projects a finished team at its actual score, and a team still out using the field', () => {
    const full = Object.fromEntries(nums.map((n) => [n, n === 5 ? -1 : 0]));
    const half = Object.fromEntries(nums.slice(0, 9).map((n) => [n, 0]));
    const rows = project([{ id: 'done', perHole: full }, { id: 'out', perHole: half }], nums, { sims: 100 });
    expect(rows.find((r) => r.id === 'done').projected).toBe(-1);
    expect(rows.find((r) => r.id === 'out').finished).toBe(false);
  });
  it('gives the same result for the same seed', () => {
    const subs = [{ id: 'a', perHole: { 1: -1, 2: 0 } }, { id: 'b', perHole: { 1: 0 } }];
    const r1 = project(subs, nums, { seed: 7, sims: 300 });
    const r2 = project(subs, nums, { seed: 7, sims: 300 });
    expect(r1).toEqual(r2);
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });
  it('supports higher-is-better (Stableford) with carried-in points', () => {
    const rows = project(
      [{ id: 'a', perHole: { 1: 3 }, base: 36 }, { id: 'b', perHole: { 1: 1 }, base: 30 }],
      nums, { higherBetter: true, defaultValue: 2, sims: 300 }
    );
    expect(rows.find((r) => r.id === 'a').winPct).toBeGreaterThan(rows.find((r) => r.id === 'b').winPct);
  });
});
