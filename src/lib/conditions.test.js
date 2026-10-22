import { describe, it, expect } from 'vitest';
import { compSort, conditionsFor, cleanConditions, conditionsProblems, conditionsLine, takesConditions, CONDITION_KEYS } from './conditions.js';
import { LIBRARY } from './sidecomplib.js';

describe('side comp conditions', () => {
  it('offers the right standard conditions for each kind of measured comp', () => {
    expect(compSort('ld')).toBe('drive');
    expect(compSort('ctp')).toBe('pin');
    expect(compSort({ preset: 'ld_fairway', name: 'x' })).toBe('drive');
    expect(compSort({ preset: 'longest_putt' })).toBe('putt');
    expect(compSort({ preset: 'ntp_in_2' })).toBe('pin');
    expect(compSort({ name: 'Longest drive (par 5s)' })).toBe('drive');
    expect(compSort({ name: 'Best excuse' })).toBe('other');
    expect(conditionsFor('ld').map((c) => c.key)).toEqual(expect.arrayContaining(['fairway', 'first_shot', 'one_go']));
    expect(conditionsFor('ctp').map((c) => c.key)).toEqual(expect.arrayContaining(['green_only', 'first_shot', 'tee_shot']));
    for (const p of LIBRARY) for (const c of conditionsFor(p)) expect(CONDITION_KEYS).toContain(c.key);
    expect(takesConditions('ld')).toBe(true);
    expect(takesConditions({ scoring: 'count' })).toBe(false);
    expect(takesConditions({ scoring: 'auto' })).toBe(false);
    expect(takesConditions({ scoring: null, how: 'highest' })).toBe(true);
  });

  it('cleans and checks conditions like the database does', () => {
    expect(cleanConditions({ picks: ['first_shot', 'fairway', 'fairway', 'moon'], note: '  drop   zone ok ' })).toEqual({ picks: ['fairway', 'first_shot'], note: 'drop zone ok' });
    expect(cleanConditions({ picks: [], note: '' })).toBeNull();
    expect(cleanConditions(null)).toBeNull();
    expect(conditionsProblems({ picks: ['fairway', 'first_shot'] })).toEqual([]);
    expect(conditionsProblems(null)).toEqual([]);
    expect(conditionsProblems({ picks: ['moon'] })[0]).toMatch(/isn’t one of/);
    expect(conditionsProblems({ picks: 'fairway' })[0]).toMatch(/list/);
    expect(conditionsProblems({ picks: CONDITION_KEYS.slice(0, 7) })[0]).toMatch(/Up to 6/);
    expect(conditionsProblems({ note: 'x'.repeat(141) })[0]).toMatch(/140/);
    expect(conditionsProblems({ colour: 'red' })[0]).toMatch(/isn’t part/);
  });

  it('reads as a short line on the comp card', () => {
    expect(conditionsLine({ picks: ['first_shot', 'fairway'] })).toBe('Fairway only · first shot');
    expect(conditionsLine({ picks: ['green_only'], note: 'measured with the flagstick' })).toBe('On the green only · measured with the flagstick');
    expect(conditionsLine(null)).toBe('');
  });
});
