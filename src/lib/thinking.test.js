import { describe, it, expect } from 'vitest';
import { thinkingLine, PLAN_STEPS } from './thinking.js';

describe('thinkingLine', () => {
  it('moves through the steps every 5 seconds', () => {
    expect(thinkingLine(0)).toBe(`${PLAN_STEPS[0]}…`);
    expect(thinkingLine(6)).toBe(`${PLAN_STEPS[1]}…`);
    expect(thinkingLine(24)).toBe(`${PLAN_STEPS[4]}…`);
  });
  it('says it is still working after 25 s and nearly there after a minute', () => {
    expect(thinkingLine(30)).toMatch(/up to a minute/);
    expect(thinkingLine(61)).toMatch(/nearly there/);
  });
  it('uses the steps it is given', () => {
    expect(thinkingLine(0, ['Reading the photos'])).toBe('Reading the photos…');
    expect(thinkingLine(12, ['A', 'B'])).toBe('B…');
  });
});
