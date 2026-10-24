import { describe, it, expect } from 'vitest';
import { loadChat, saveChat, chatKey, loadPlanChat, savePlanChat, clearPlanChat, listPlanChats, migrateGroupChat, activeChat, setActiveChat, carryOnWords, changedWords } from './planchat.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
};
const turn = (text) => ({ role: 'user', text });

describe('one planning chat per trip (ov35)', () => {
  it('keeps each trip’s chat apart from the others and from the new-plan chat', () => {
    const s = mem();
    savePlanChat('g1', 'pA', { turns: [turn('Hunter in March')] }, s, 1000);
    savePlanChat('g1', 'pB', { turns: [turn('Coast in spring'), turn('8 of us')] }, s, 2000);
    savePlanChat('g1', null, { turns: [turn('something new')] }, s, 3000);
    expect(loadPlanChat('g1', 'pA', s, 4000).turns[0].text).toBe('Hunter in March');
    expect(loadPlanChat('g1', 'pB', s, 4000).turns).toHaveLength(2);
    expect(loadPlanChat('g1', null, s, 4000).turns[0].text).toBe('something new');
    expect(loadChat('g1', s, 4000).turns[0].text).toBe('something new'); // the new-plan chat is the old key
    expect(chatKey('g1', 'pA')).toBe('tgt-planchat:g1:plan:pA');
    expect(listPlanChats('g1', s, 4000)).toEqual([{ planId: 'pB', size: 2, savedAt: 2000 }, { planId: 'pA', size: 1, savedAt: 1000 }]);
    expect(listPlanChats('g2', s, 4000)).toEqual([]);
  });
  it('starting a new plan never loses a trip’s chat; clearing one leaves the rest', () => {
    const s = mem();
    savePlanChat('g1', 'pA', { turns: [turn('a')] }, s);
    savePlanChat('g1', null, { turns: [] }, s);
    expect(loadPlanChat('g1', 'pA', s)).not.toBeNull();
    clearPlanChat('g1', 'pA', s);
    expect(loadPlanChat('g1', 'pA', s)).toBeNull();
  });
  it('keeps a trip’s chat for 90 days (the new-plan chat a week)', () => {
    const s = mem();
    savePlanChat('g1', 'pA', { turns: [turn('a')] }, s, 0);
    saveChat('g1', { turns: [turn('b')] }, s, 0);
    const day = 24 * 3600 * 1000;
    expect(loadPlanChat('g1', 'pA', s, 30 * day)).not.toBeNull();
    expect(loadPlanChat('g1', null, s, 30 * day)).toBeNull();
    expect(loadPlanChat('g1', 'pA', s, 91 * day)).toBeNull();
  });
  it('moves the old one-chat-per-group copy to its trip', () => {
    const s = mem();
    saveChat('g1', { turns: [turn('old chat')], draft: { name: 'March' }, planId: 'pA' }, s, 1000);
    expect(migrateGroupChat('g1', s, 2000)).toBe('pA');
    expect(loadPlanChat('g1', 'pA', s, 2000).draft.name).toBe('March');
    expect(loadChat('g1', s, 2000)).toBeNull();
    // A new-plan chat with no trip yet stays where it is.
    saveChat('g1', { turns: [turn('new')] }, s, 3000);
    expect(migrateGroupChat('g1', s, 3000)).toBeNull();
    expect(loadChat('g1', s, 3000).turns[0].text).toBe('new');
  });
  it('doesn’t overwrite a trip that already has its own chat', () => {
    const s = mem();
    savePlanChat('g1', 'pA', { turns: [turn('newer')] }, s, 5000);
    saveChat('g1', { turns: [turn('older')], planId: 'pA' }, s, 1000);
    migrateGroupChat('g1', s, 6000);
    expect(loadPlanChat('g1', 'pA', s, 6000).turns[0].text).toBe('newer');
  });
  it('remembers which chat is open', () => {
    const s = mem();
    expect(activeChat('g1', s)).toBeNull();
    setActiveChat('g1', 'pB', s);
    expect(activeChat('g1', s)).toBe('pB');
    setActiveChat('g1', null, s);
    expect(activeChat('g1', s)).toBeNull();
  });
  it('words', () => {
    expect(carryOnWords([])).toBeNull();
    expect(carryOnWords([{ planId: 'a', size: 12 }])).toBe('Carry on your plan (12 messages)');
    expect(carryOnWords([], 3)).toBe('Carry on your plan (3 messages)');
    expect(carryOnWords([{ size: 2 }, { size: 4 }], 1)).toBe('Carry on a plan (3 on the go)');
    const now = Date.parse('2026-10-23T10:00:00Z');
    expect(changedWords('2026-10-23T08:00:00Z', now)).toBe('changed today');
    expect(changedWords('2026-10-22T08:00:00Z', now)).toBe('changed yesterday');
    expect(changedWords('2026-10-18T08:00:00Z', now)).toBe('changed 5 days ago');
    expect(changedWords('2026-09-25T08:00:00Z', now)).toBe('changed 4 weeks ago');
    expect(changedWords(null, now)).toBe('');
  });
});
