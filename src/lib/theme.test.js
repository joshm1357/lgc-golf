import { describe, it, expect } from 'vitest';
import { contrast, lookProblems, themeVars, mix, DEFAULT_LOOK, LGC_LOOK, FONTS } from './theme.js';

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
