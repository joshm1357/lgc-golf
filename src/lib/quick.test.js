import { describe, it, expect } from 'vitest';
import { defaultComps, sourceFrom, resultsText, sameTimeNextYear, startOwnLink, rememberSource, rememberedSource, forgetSource } from './quick.js';

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: [3, 12].includes(i + 1) ? 3 : [5, 14].includes(i + 1) ? 5 : 4, si: i + 1 }));

describe('defaultComps', () => {
  it('closest to the pin on every par 3, longest drive on a par 5', () => {
    expect(defaultComps(holes)).toEqual({ ctp: [3, 12], ld: [5] });
  });
  it('picks the longest par 5 when the map knows', () => {
    const h = holes.map((x) => (x.n === 5 ? { ...x, tee: { lat: -34, lng: 150 }, green: { lat: -34.004, lng: 150 } } : x.n === 14 ? { ...x, tee: { lat: -34, lng: 150 }, green: { lat: -34.005, lng: 150 } } : x));
    expect(defaultComps(h).ld).toEqual([14]);
  });
  it('no par 5: no longest drive', () => {
    expect(defaultComps(holes.map((x) => ({ ...x, par: x.par === 5 ? 4 : x.par }))).ld).toEqual([]);
  });
});

describe('sourceFrom', () => {
  it('reads a club code and its placement, or another group’s card', () => {
    expect(sourceFrom('?ref=BOWRAL1&p=cart')).toEqual({ ref: 'BOWRAL1', placement: 'cart' });
    expect(sourceFrom('?from=the-mulligans')).toEqual({ from_group: 'the-mulligans', placement: 'card' });
    expect(sourceFrom('?ref=<script>')).toEqual({ ref: 'script' });
    expect(sourceFrom('')).toBe(null);
  });
});

describe('results', () => {
  it('a results card for the group chat, with the start-your-own link', () => {
    const text = resultsText({ roundName: 'Stableford — Bowral', courseName: 'Bowral', format: 'stableford', groupSlug: 'josh-at-bowral', base: 'https://x/',
      rows: [{ name: 'Josh', points: 36, thru: 18, finished: true }, { name: 'Mike', points: 30, thru: 17, finished: false }, { name: 'Sam', points: 0, thru: 0 }] });
    expect(text).toContain('1. Josh — 36 pts');
    expect(text).toContain('2. Mike — 30 pts (thru 17)');
    expect(text).not.toContain('Sam');
    expect(text).toContain('https://x/#/start?from=josh-at-bowral');
    expect(startOwnLink(null, 'https://x/')).toBe('https://x/#/start');
  });
  it('same time next year is the same day of the week', () => {
    expect(sameTimeNextYear('2026-10-17')).toBe('2027-10-16');
    expect(new Date('2027-10-16T00:00:00Z').getUTCDay()).toBe(new Date('2026-10-17T00:00:00Z').getUTCDay());
  });
});

describe('remembered source', () => {
  it('keeps the newest for 30 days, then forgets it', () => {
    const store = {};
    globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
    rememberSource({ ref: 'OLD1', placement: 'cart' }, 0);
    rememberSource({ from_group: 'g', placement: 'invite' }, 1000);
    expect(rememberedSource(2000)).toEqual({ from_group: 'g', placement: 'invite' });
    expect(rememberedSource(1000 + 31 * 864e5)).toBe(null);
    forgetSource();
    expect(rememberedSource(2000)).toBe(null);
    delete globalThis.localStorage;
  });
});
