import { describe, it, expect } from 'vitest';
import { loadChat, saveChat, clearChat, chatSize } from './planchat.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

describe('keeping the planning chat', () => {
  it('saves and loads a chat for the group', () => {
    const s = mem();
    saveChat('g1', { turns: [{ role: 'user', text: 'Hunter in March' }], draft: { name: 'March' } }, s, 1000);
    const c = loadChat('g1', s, 2000);
    expect(c.turns).toHaveLength(1);
    expect(c.draft.name).toBe('March');
    expect(chatSize(c)).toBe(1);
    expect(loadChat('g2', s, 2000)).toBeNull();
  });
  it('forgets a chat older than a week', () => {
    const s = mem();
    saveChat('g1', { turns: [{ role: 'user', text: 'x' }] }, s, 0);
    expect(loadChat('g1', s, 8 * 24 * 3600 * 1000)).toBeNull();
  });
  it('an empty chat clears what was saved; clearChat removes it', () => {
    const s = mem();
    saveChat('g1', { turns: [{ role: 'user', text: 'x' }] }, s);
    saveChat('g1', { turns: [], draft: null }, s);
    expect(loadChat('g1', s)).toBeNull();
    saveChat('g1', { turns: [{ role: 'user', text: 'x' }] }, s);
    clearChat('g1', s);
    expect(loadChat('g1', s)).toBeNull();
  });
});
