import { describe, it, expect } from 'vitest';
import { GAME_KINDS } from './games.js';
import { GAME_HELP, helpFor } from './gamehelp.js';

describe('side game help', () => {
  it('every side game has a plain "how it works": what, how you win, an example and the money', () => {
    for (const k of GAME_KINDS) {
      const h = GAME_HELP[k];
      expect(h, k).toBeTruthy();
      expect(h.what.length).toBeGreaterThan(20);
      expect(h.steps.length).toBeGreaterThan(0);
      expect(h.example).toMatch(/\$/);
      expect(h.money.length).toBeGreaterThan(10);
    }
    expect(helpFor('nope')).toBeNull();
  });
});
