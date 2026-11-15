import { describe, it, expect } from 'vitest';
import { contrast, lookProblems, themeVars, mix, mutedOn, appTitle, appIcon, TEXT, DEFAULT_LOOK, LGC_LOOK, FONTS } from './theme.js';

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(Math.round(contrast('#000000', '#FFFFFF'))).toBe(21);
    expect(contrast('#777777', '#777777')).toBe(1);
  });
});

describe('lookProblems', () => {
  it('L.G.C and the default look are readable', () => {
    expect(lookProblems(LGC_LOOK)).toEqual([]);
    expect(lookProblems(DEFAULT_LOOK)).toEqual([]);
  });
  it('a pale main colour is refused (white writing on it)', () => {
    expect(lookProblems({ primary: '#9FD3FF', accent: '#1C2B3F' })[0]).toMatch(/too light/);
  });
  it('two similar colours are refused', () => {
    expect(lookProblems({ primary: '#1C2B3F', accent: '#2E4561' }).some((p) => /too alike/.test(p))).toBe(true);
  });
  it('a dark accent is refused (button writing is dark)', () => {
    expect(lookProblems({ primary: '#767676', accent: '#000000' }).some((p) => /accent colour is too dark/.test(p))).toBe(true);
  });
  it('every look that passes has readable buttons, muted header text and badges', () => {
    const cols = ['#000000', '#1C2B3F', '#1F4B33', '#5A2D82', '#8B1E1E', '#2F6F9F', '#555555', '#666666', '#D9A521', '#E0B84A', '#FFFFFF', '#F5E6A8', '#9FD3FF', '#C0C0C0'];
    let passed = 0;
    for (const primary of cols) for (const accent of cols) {
      if (lookProblems({ primary, accent }).length) continue;
      passed++;
      const v = themeVars({ primary, accent });
      expect(contrast(TEXT, v['--gold'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['--on-navy-muted'], v['--navy'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#FFFFFF', v['--navy-3'])).toBeGreaterThanOrEqual(3);
    }
    expect(passed).toBeGreaterThan(5);
  });
  it('asks for both colours', () => {
    expect(lookProblems({ primary: 'red', accent: '#FFFFFF' })).toEqual(['Pick both colours.']);
  });
});

describe('themeVars', () => {
  it('L.G.C gets exactly today’s colours', () => {
    const v = themeVars(LGC_LOOK);
    expect(v['--navy']).toBe('#1C2B3F');
    expect(v['--gold']).toBe('#D9A521');
    expect(v['--display']).toBe(FONTS.condensed.css);
    expect(v['--navy-2']).toBe('#2E4561');
    expect(v['--gold-soft']).toBe('#FFF6DC');
    expect(v['--on-navy-muted']).toBe('#C3CCD8');
  });
  it('falls back to the default look for bad values', () => {
    expect(themeVars({ primary: 'nope', accent: null })['--navy']).toBe(DEFAULT_LOOK.primary);
  });
  it('mixes colours', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});

describe('mutedOn', () => {
  it('is readable on the main colour', () => {
    for (const c of ['#1F4B33', '#555555', '#2F6F9F']) expect(contrast(mutedOn(c), c)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('app name and icon', () => {
  // ov44 (Josh 15 Nov 2026): "needs to be The Golf Trip, not the app of the group".
  it('is The Golf Trip for every group, L.G.C included', () => {
    for (const [look, name] of [[LGC_LOOK, 'L.G.C'], [{ short_name: 'MULL', crest_url: 'https://x/crest.png' }, 'The Mulligans'], [DEFAULT_LOOK, 'A very long group name here'], [null, null]]) {
      expect(appTitle(look, name)).toEqual({ title: 'The Golf Trip', short: 'Golf Trip' });
      expect(appIcon(look)).toMatch(/brand\/trip-192\.png$/);
    }
  });
  it('the group’s own colours are untouched (its look stays inside the app)', () => {
    expect(themeVars(LGC_LOOK)['--navy']).toBe('#1C2B3F');
    expect(themeVars({ ...DEFAULT_LOOK, primary: '#2F6F9F' })['--navy']).toBe('#2F6F9F');
  });
});
