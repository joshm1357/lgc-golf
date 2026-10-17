import { describe, it, expect } from 'vitest';
import { teamSizes, teamHandicap, makeDraw } from './draw.js';
import { mulberry32 } from './projection.js';

const field = [
  ['josh', 13], ['mike', 30], ['fred', 18], ['chris', 27], ['adam', 16],
  ['cam', 27], ['al', 30], ['mark', 16], ['hamish', 27], ['x', 20],
].map(([id, handicap]) => ({ id, handicap }));

describe('the draw', () => {
  it('splits the field as evenly as possible', () => {
    expect(teamSizes(10, 3)).toEqual([4, 3, 3]);
    expect(teamSizes(9, 3)).toEqual([3, 3, 3]);
  });
  it('works out team handicap as combined ÷ (2 × team size)', () => {
    expect(teamHandicap([13, 30, 18, 27])).toBe(11); // 88 ÷ 8
    expect(teamHandicap([16, 27, 30])).toBe(12.2); // 73 ÷ 6
    expect(teamHandicap([16, 27])).toBe(10.8); // 43 ÷ 4
  });
  it('puts every player in exactly one team, with a reveal for each, and the right team handicaps', () => {
    const d = makeDraw(field, 3, { rand: mulberry32(1) });
    expect(d.teams.flatMap((t) => t.players).sort()).toEqual(field.map((p) => p.id).sort());
    expect(d.picks.length).toBe(field.length);
    for (const t of d.teams) {
      expect(t.handicap).toBe(teamHandicap(t.players.map((id) => field.find((p) => p.id === id).handicap)));
    }
  });
  it('fully random gives lots of different line-ups', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      const d = makeDraw(field, 2, { rand: mulberry32(seed) });
      seen.add(JSON.stringify(d.teams.map((t) => [...t.players].sort()).sort()));
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
  it('"even it out" keeps team handicaps close, and still varies', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      const d = makeDraw(field, 2, { balance: true, rand: mulberry32(seed), tries: 1500 });
      expect(d.spread).toBeLessThanOrEqual(1.2);
      seen.add(JSON.stringify(d.teams.map((t) => [...t.players].sort()).sort()));
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});
