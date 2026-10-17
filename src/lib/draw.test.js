import { describe, it, expect } from 'vitest';
import { salary, teamSizes, teamHandicap, makeDraw } from './draw.js';
import { mulberry32 } from './projection.js';

const field = [
  ['josh', 13, 34.5], ['mike', 30, 37], ['fred', 18, 35], ['chris', 27, 34], ['adam', 16, 28],
  ['cam', 27, 28], ['al', 30, 27], ['mark', 16, 14], ['hamish', 27, null], ['x', 20, null],
].map(([id, h, avg]) => ({ id, handicap: h, salary: salary(h, avg) }));

describe('the draw', () => {
  it('prices better golfers higher and nudges for form', () => {
    expect(salary(13)).toBeGreaterThan(salary(30));
    expect(salary(16, 40)).toBeGreaterThan(salary(16, 30));
  });
  it('splits the field as evenly as possible', () => {
    expect(teamSizes(10, 3)).toEqual([4, 3, 3]);
    expect(teamSizes(9, 3)).toEqual([3, 3, 3]);
  });
  it('uses combined handicaps ÷ (2 × team size)', () => {
    expect(teamHandicap([13, 30, 18, 27])).toBe(11);
    expect(teamHandicap([16, 27])).toBe(10.8);
  });
  it('puts every player in exactly one team, with a reveal for each', () => {
    const d = makeDraw(field, 3, { rand: mulberry32(1), tries: 500 });
    const all = d.teams.flatMap((t) => t.players).sort();
    expect(all).toEqual(field.map((p) => p.id).sort());
    expect(d.picks.length).toBe(field.length);
    expect(new Set(d.teams.map((t) => t.name)).size).toBe(3);
  });
  it('keeps teams fair — salary per player close together', () => {
    const d = makeDraw(field, 2, { rand: mulberry32(7), tries: 2000 });
    const per = d.teams.map((t) => t.salary / t.players.length);
    expect(Math.max(...per) - Math.min(...per)).toBeLessThan(0.6);
  });
  it('gives plenty of different (still fair) teams across draws', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      const d = makeDraw(field, 2, { rand: mulberry32(seed), tries: 1500 });
      seen.add(JSON.stringify(d.teams.map((t) => [...t.players].sort()).sort()));
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});
