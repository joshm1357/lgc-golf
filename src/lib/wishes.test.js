import { describe, it, expect } from 'vitest';
import { wishKey, groupWishes, failRate, topTools, toolName, errorName } from './wishes.js';

describe('wishKey — similar wishes get the same key', () => {
  it('ignores case, punctuation, filler words and contractions', () => {
    expect(wishKey('Chase who hasn’t paid')).toBe(wishKey('chase who has not paid!'));
    expect(wishKey('Can you please chase who hasn\'t paid?')).toBe(wishKey('Chase who has not paid'));
  });
  it('ignores word order and plurals', () => {
    expect(wishKey('Send reminders to players')).toBe(wishKey('player reminder send'));
    expect(wishKey('Book tee times')).toBe('book tee time');
  });
  it('keeps different jobs apart', () => {
    expect(wishKey('Book a tee time')).not.toBe(wishKey('Book accommodation'));
  });
  it('copes with nothing useful', () => {
    expect(wishKey('')).toBe('');
    expect(wishKey(null)).toBe('');
    expect(wishKey('please can you')).toBe('');
  });
  it('trims -ies and -s but not -ss', () => {
    expect(wishKey('Summaries')).toBe('summary');
    expect(wishKey('Address')).toBe('address');
  });
});

describe('groupWishes — most asked-for first', () => {
  const rows = [
    { job: 'Book a tee time', group_id: 'g1', group_name: 'L.G.C', created_at: '2026-10-01T10:00:00Z' },
    { job: 'Chase who hasn’t paid', group_id: 'g1', group_name: 'L.G.C', created_at: '2026-10-02T10:00:00Z' },
    { job: 'chase who has not paid', group_id: 'g2', group_name: 'Hunter', created_at: '2026-10-05T10:00:00Z' },
    { job: 'Chase who hasn’t paid', group_id: 'g3', group_name: 'Bowral', created_at: '2026-10-03T10:00:00Z' },
    { job: 'Weather for the weekend', group_id: 'g2', group_name: 'Hunter', created_at: '2026-10-06T10:00:00Z' },
    { job: '   ', group_id: 'g2', group_name: 'Hunter', created_at: '2026-10-06T10:00:00Z' },
  ];
  const out = groupWishes(rows);
  it('puts the same job together and counts times and groups', () => {
    expect(out[0]).toMatchObject({ job: 'Chase who hasn’t paid', times: 3, groups: 3, last: '2026-10-05T10:00:00Z' });
    expect(out[0].groupNames.sort()).toEqual(['Bowral', 'Hunter', 'L.G.C']);
    expect(out[0].wordings).toEqual(['chase who has not paid', 'Chase who hasn’t paid']);
  });
  it('then ties are broken by the newest', () => {
    expect(out.map((w) => w.job)).toEqual(['Chase who hasn’t paid', 'Weather for the weekend', 'Book a tee time']);
  });
  it('skips blank wishes and copes with no rows', () => {
    expect(out.reduce((t, w) => t + w.times, 0)).toBe(5);
    expect(groupWishes([])).toEqual([]);
    expect(groupWishes(null)).toEqual([]);
  });
  it('counts a group once however often it asked', () => {
    const g = groupWishes([
      { job: 'Group photo', group_id: 'g1', created_at: '2026-10-01' },
      { job: 'group photos', group_id: 'g1', created_at: '2026-10-02' },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ times: 2, groups: 1, groupNames: ['A group'] });
  });
  it('a wish of only filler words still shows (grouped by its own text)', () => {
    const g = groupWishes([{ job: 'Please can you', group_id: 'g1', created_at: '2026-10-01' }, { job: 'please can you', group_id: 'g2', created_at: '2026-10-02' }]);
    expect(g).toHaveLength(1);
    expect(g[0].times).toBe(2);
  });
});

describe('connector numbers', () => {
  it('failRate is a whole percentage, 0 with no calls', () => {
    expect(failRate(8, 2)).toBe(25);
    expect(failRate(3, 1)).toBe(33);
    expect(failRate(0, 0)).toBe(0);
    expect(failRate(null, 5)).toBe(0);
  });
  it('topTools gives the most-used, top 3 by default', () => {
    const t = [{ tool: 'a', calls: 1 }, { tool: 'b', calls: 9 }, { tool: 'c', calls: 4 }, { tool: 'd', calls: 4 }];
    expect(topTools(t).map((x) => x.tool)).toEqual(['b', 'c', 'd']);
    expect(topTools(t, 1).map((x) => x.tool)).toEqual(['b']);
    expect(topTools(null)).toEqual([]);
  });
  it('plain names for tools and error kinds', () => {
    expect(toolName('get_leaderboard')).toBe('Leaderboard');
    expect(toolName('brand_new_tool')).toBe('brand_new_tool');
    expect(errorName('not_found')).toBe('couldn’t find it');
    expect(errorName(null)).toBe('something else');
  });
});
