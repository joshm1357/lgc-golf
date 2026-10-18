import { describe, it, expect } from 'vitest';
import { worthReporting } from './problems.js';

describe('worthReporting', () => {
  it('sends a real error once, and skips network noise', () => {
    const seen = new Set();
    expect(worthReporting('TypeError: x is undefined', seen)).toBe(true);
    seen.add('TypeError: x is undefined');
    expect(worthReporting('TypeError: x is undefined', seen)).toBe(false);
    expect(worthReporting('TypeError: Failed to fetch', seen)).toBe(false);
    expect(worthReporting('ResizeObserver loop completed with undelivered notifications.', seen)).toBe(false);
    expect(worthReporting('Script error.', seen)).toBe(false);
    expect(worthReporting('', seen)).toBe(false);
  });
  it('stops after 10 in one visit', () => {
    const seen = new Set(Array.from({ length: 10 }, (_, i) => `e${i}`));
    expect(worthReporting('another one', seen)).toBe(false);
  });
});
