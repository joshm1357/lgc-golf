import { describe, it, expect } from 'vitest';
import { parsePlayers, STEPS } from './Start.jsx';

describe('parsePlayers', () => {
  it('reads names with or without a handicap', () => {
    const { players, problems } = parsePlayers('Josh M, 14\nMike 18\nSam 9.4\nAdam Hill\n\nBen\t+2');
    expect(problems).toEqual([]);
    expect(players).toEqual([
      { name: 'Josh M', handicap: 14 }, { name: 'Mike', handicap: 18 }, { name: 'Sam', handicap: 9.4 },
      { name: 'Adam Hill', handicap: 18 }, { name: 'Ben', handicap: -2 },
    ]);
  });
  it('flags doubles and odd handicaps', () => {
    const { players, problems } = parsePlayers('Josh, 14\njosh 12\nMike, 99');
    expect(players).toHaveLength(1);
    expect(problems).toHaveLength(2);
  });
});

describe('wizard steps', () => {
  it('are the brief’s steps and add up to under 10 minutes', () => {
    expect(STEPS.map((s) => s.key)).toEqual(['signin', 'name', 'look', 'rules', 'features', 'players', 'invite']);
    expect(STEPS.reduce((a, s) => a + s.mins, 0)).toBeLessThan(10);
  });
});
