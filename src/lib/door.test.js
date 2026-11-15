import { describe, it, expect } from 'vitest';
import { cleanSource, doorParams, ownAskLink, doorRows, doorSources, DOOR_STEPS, count } from './door.js';

describe('counting the round door', () => {
  it('source tags are plain words, else "direct"', () => {
    expect(cleanSource('Web-Home')).toBe('web-home');
    expect(cleanSource('a tag with spaces')).toBe('direct');
    expect(cleanSource('<script>')).toBe('direct');
    expect(cleanSource(null)).toBe('direct');
    expect(cleanSource('x'.repeat(30))).toBe('x'.repeat(24));
  });
  it('reads what a link into #/ask carries', () => {
    expect(doorParams('?src=web-players')).toEqual({ source: 'web-players', from: null });
    expect(doorParams('?from=abcdefgh23456789')).toEqual({ source: 'reply', from: 'ABCDEFGH23456789' });
    expect(doorParams('?from=ABCDEFGH23456789&src=locked')).toEqual({ source: 'locked', from: 'ABCDEFGH23456789' });
    expect(doorParams('?from=not-a-token')).toEqual({ source: 'direct', from: null });
    expect(doorParams('')).toEqual({ source: 'direct', from: null });
  });
  it('“Ask your own mates” carries where it was tapped', () => {
    expect(ownAskLink('abcdefgh23456789')).toBe('#/ask?from=ABCDEFGH23456789&src=reply');
    expect(ownAskLink('ABCDEFGH23456789', 'locked')).toBe('#/ask?from=ABCDEFGH23456789&src=locked');
    expect(doorParams(ownAskLink('ABCDEFGH23456789', 'locked').split('?')[1])).toEqual({ source: 'locked', from: 'ABCDEFGH23456789' });
  });
  it('Josh’s funnel: each step and its share of the one before', () => {
    const rows = doorRows({ counts: { opened: 200, built: 80, signed_in: 60, link_made: 50, shared: 40, own_started: 3 }, asks: { asks: 52, first_reply: 26, fourball: 13, locked: 10 } });
    expect(rows.map((r) => r.step)).toEqual(DOOR_STEPS);
    expect(rows.map((r) => r.n)).toEqual([200, 80, 60, 52, 40, 26, 13, 10, 3]);
    expect(rows.map((r) => r.of)).toEqual([null, 40, 75, 87, 77, 65, 50, 77, 12]);
    expect(rows.find((r) => r.step === 'own_started').of).toBe(12); // 3 of the 26 that got a reply
    expect(doorRows(null).every((r) => r.n === 0)).toBe(true);
  });
  it('where people came from, most first', () => {
    expect(doorSources({ sources: { direct: { opened: 5 }, 'web-home': { opened: 40, link_made: 9 }, reply: { opened: 5, link_made: 2 } } })).toEqual([
      { source: 'web-home', opened: 40, link_made: 9 }, { source: 'reply', opened: 5, link_made: 2 }, { source: 'direct', opened: 5, link_made: 0 },
    ]);
  });
  it('counting never throws and ignores steps the app doesn’t count', () => {
    const calls = [];
    const db = { rpc: (name, args) => { calls.push([name, args]); return Promise.reject(new Error('down')); } };
    expect(() => count(db, 'opened')).not.toThrow();
    expect(() => count(db, 'first_reply')).not.toThrow(); // read from the asks, not counted by the app
    expect(() => count(null, 'opened')).not.toThrow();
    expect(calls).toEqual([['door_count', { p_step: 'opened', p_source: 'direct' }]]);
  });
});
