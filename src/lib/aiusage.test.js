import { describe, it, expect } from 'vitest';
import { areaName, errorLabel, upShare, tokens, weekLabel, weekRows } from './aiusage.js';

describe('AI usage words', () => {
  it('names areas and error codes in plain words', () => {
    expect(areaName('plan')).toBe('Plan it with AI');
    expect(areaName('ask')).toBe('Questions (Ask)');
    expect(areaName('weird')).toBe('weird');
    expect(errorLabel('bad_json')).toBe('Muddled reply (bad JSON)');
    expect(errorLabel('capped')).toBe('Hit the limit');
    expect(errorLabel(null)).toBe('Other');
  });
  it('👍 share', () => {
    expect(upShare(3, 1)).toBe(75);
    expect(upShare(0, 0)).toBe(null);
    expect(upShare('2', null)).toBe(100);
  });
  it('tokens, short', () => {
    expect(tokens(950)).toBe('950');
    expect(tokens(1234)).toBe('1.2k');
    expect(tokens(12400)).toBe('12k');
    expect(tokens(2500000)).toBe('2.5M');
    expect(tokens(null)).toBe('0');
  });
  it('weeks: one row a week, newest first, counts per area', () => {
    expect(weekLabel('2026-10-19')).toBe('19 Oct');
    expect(weekLabel('')).toBe('—');
    const t = weekRows([
      { week: '2026-10-12', area: 'ask', requests: 4 },
      { week: '2026-10-19', area: 'plan', requests: 2 },
      { week: '2026-10-19', area: 'ask', requests: 5 },
      { week: null, area: 'ask', requests: 9 },
    ]);
    expect(t.rows.map((r) => [r.label, r.total, r.byArea.ask || 0, r.byArea.plan || 0])).toEqual([['19 Oct', 7, 5, 2], ['12 Oct', 4, 4, 0]]);
    expect(t.areas).toEqual(['ask', 'plan']);
    expect(weekRows().rows).toEqual([]);
  });
});
