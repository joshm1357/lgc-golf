import { describe, it, expect } from 'vitest';
import { nextKey, isTyping, findItems, SHORTCUTS } from './shortcuts.js';

describe('keyboard shortcuts', () => {
  it('g then t goes to Trips (the Trip desk folded in), g then l to the leaderboard', () => {
    let r = nextKey({}, 'g', {}, 1000);
    expect(r.action).toBeNull();
    expect(nextKey(r.state, 't', {}, 1500).action).toEqual({ type: 'go', to: '/plan' });
    expect(nextKey(r.state, 'l', {}, 1500).action).toEqual({ type: 'go', to: '/leaderboard' });
    expect(nextKey(r.state, 'h', {}, 1500).action).toEqual({ type: 'go', to: '/' }); // This trip (ov15)
    expect(nextKey(r.state, 'p', {}, 1500).action).toEqual({ type: 'go', to: '/group/players' });
    expect(nextKey(r.state, 'c', {}, 1500).action).toEqual({ type: 'go', to: '/cards' });
    r = nextKey({}, 'g', {}, 1000);
    // Too slow: the second key is just a key.
    expect(nextKey(r.state, 't', {}, 5000).action).toBeNull();
  });
  it('? / n and Esc', () => {
    expect(nextKey({}, '?').action).toEqual({ type: 'help' });
    expect(nextKey({}, '/').action).toEqual({ type: 'search' });
    expect(nextKey({}, 'n').action).toEqual({ type: 'new' });
    expect(nextKey({}, 'Escape', { typing: true }).action).toEqual({ type: 'close' });
  });
  it('stays out of the way while typing or with Ctrl / Cmd', () => {
    expect(nextKey({}, '/', { typing: true }).action).toBeNull();
    expect(nextKey({}, 'n', { meta: true }).action).toBeNull();
    expect(nextKey({}, 'x').action).toBeNull();
  });
  it('knows what typing is', () => {
    expect(isTyping({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTyping({ tagName: 'input' })).toBe(true);
    expect(isTyping({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTyping({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTyping({ tagName: 'BUTTON' })).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
  it('lists every shortcut with words', () => {
    expect(SHORTCUTS.every((s) => s.keys.length && s.does)).toBe(true);
  });
  it('no shortcut sends anyone to the old Trip desk', () => {
    expect(SHORTCUTS.some((s) => /desk/i.test(s.does))).toBe(false);
    for (const k of 'tlpc') expect(nextKey({ prefix: 'g', at: 0 }, k, {}, 100).action.to).not.toMatch(/^\/desk/);
  });
});

describe('the finder', () => {
  const items = [
    { label: 'Leaderboard', to: '/' },
    { label: 'Trip desk', to: '/desk', words: ['organise'] },
    { label: 'Al Test', to: '/player/a', words: ['Big Al'] },
    { label: 'Tribunal', to: '/tribunal' },
  ];
  it('starts-with first, then word starts, then anywhere', () => {
    expect(findItems(items, 'tr').map((i) => i.label)).toEqual(['Tribunal', 'Trip desk']);
    expect(findItems(items, 'desk').map((i) => i.label)).toEqual(['Trip desk']);
    expect(findItems(items, 'big').map((i) => i.label)).toEqual(['Al Test']);
    expect(findItems(items, 'ead').map((i) => i.label)).toEqual(['Leaderboard']);
  });
  it('nothing typed: the first few', () => {
    expect(findItems(items, '', 2)).toHaveLength(2);
  });
});
