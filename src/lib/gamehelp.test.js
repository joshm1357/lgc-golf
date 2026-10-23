import { describe, it, expect } from 'vitest';
import { GAME_KINDS } from './games.js';
import { GAME_HELP, helpFor, helpHouseRules, helpWhoIn } from './gamehelp.js';

describe('side game help', () => {
  it('every side game has a plain "how it works": what, how you win, an example and the money', () => {
    for (const k of GAME_KINDS) {
      const h = GAME_HELP[k];
      expect(h, k).toBeTruthy();
      expect(h.what.length).toBeGreaterThan(20);
      expect(h.steps.length).toBeGreaterThan(0);
      expect(h.example.length).toBeGreaterThan(30);
      expect(h.money.length).toBeGreaterThan(10);
    }
    expect(helpFor('nope')).toBeNull();
  });
  it('shows house rules only when there are some, and says when a game is opt-in', () => {
    expect(helpHouseRules('')).toBeNull();
    expect(helpHouseRules('   ')).toBeNull();
    expect(helpHouseRules(null)).toBeNull();
    expect(helpHouseRules(' Birdie skins double ')).toBe('Birdie skins double');
    expect(helpWhoIn({ who_in: 'opt_in' })).toMatch(/I’m in/);
    expect(helpWhoIn({ who_in: 'everyone' })).toBeNull();
    expect(helpWhoIn({})).toBeNull();
  });
});
