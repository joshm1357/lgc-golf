import { describe, it, expect } from 'vitest';
import { compsForRound, sortOwnEntries, beats, parseHoles } from './sidecomps.js';

const defs = [{ id: 'd1', name: 'Longest putt', how: 'highest' }, { id: 'd2', name: 'Best shot', how: 'pick' }];

describe('own side comps', () => {
  it('a round lists its comps in order, with holes; unknown comps are dropped', () => {
    const r = { own_comps: [{ comp: 'd2', holes: [] }, { comp: 'zz', holes: [1] }, { comp: 'd1', holes: ['7', 12] }] };
    expect(compsForRound(r, defs).map((c) => [c.name, c.holes])).toEqual([['Best shot', []], ['Longest putt', [7, 12]]]);
    expect(compsForRound({}, defs)).toEqual([]);
  });
  it('sorts: confirmed first, then the number the right way', () => {
    const list = [{ id: 'a', value: 5 }, { id: 'b', value: 12 }, { id: 'c', value: null }, { id: 'd', value: 3, confirmed: true }];
    expect(sortOwnEntries('highest', list).map((x) => x.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(sortOwnEntries('lowest', list).map((x) => x.id)).toEqual(['d', 'a', 'b', 'c']);
  });
  it('pick comps list newest first', () => {
    const list = [{ id: 'a', created_at: '2026-10-21T01:00:00Z' }, { id: 'b', created_at: '2026-10-21T02:00:00Z' }];
    expect(sortOwnEntries('pick', list).map((x) => x.id)).toEqual(['b', 'a']);
  });
  it('knows a new leader', () => {
    expect(beats('highest', 9, { value: 7 })).toBe(true);
    expect(beats('lowest', 9, { value: 7 })).toBe(false);
    expect(beats('lowest', 2, null)).toBe(true);
    expect(beats('pick', 2, null)).toBe(false);
  });
  it('reads holes typed any way', () => {
    expect(parseHoles('3, 7 12 7 19 0')).toEqual([3, 7, 12]);
    expect(parseHoles('')).toEqual([]);
  });
});
