import { describe, it, expect } from 'vitest';
import { frontDoor, markFreshSignIn, isFreshSignIn, clearFreshSignIn, cleanEmailCode, looksLikeEmail, groupRows, groupLook, rememberReturn, takeReturn, choosesItsOwnWay } from './home.js';

const G1 = { id: 'g1', name: 'L.G.C', role: 'organiser', legacy: true };
const G2 = { id: 'g2', name: 'Test Group B', role: 'player' };

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe('frontDoor', () => {
  it('sign-in switched off: the link-first screen, or straight in', () => {
    expect(frontDoor({ signInOn: false, status: null })).toBe('join');
    expect(frontDoor({ signInOn: false, status: { is_member: false, signed_in: true, groups: [] } })).toBe('join');
    expect(frontDoor({ signInOn: false, status: { is_member: true, signed_in: true, groups: [G1, G2] }, fresh: true })).toBe('inside');
  });
  it('nobody signed in yet: the new home screen', () => {
    expect(frontDoor({ signInOn: true, status: null })).toBe('home');
    expect(frontDoor({ signInOn: true, status: { is_member: false, signed_in: false, groups: [] } })).toBe('home');
  });
  it('phone-only guest in a group: straight in (never pushed to sign in)', () => {
    expect(frontDoor({ signInOn: true, status: { is_member: true, signed_in: false, groups: [G1] }, fresh: true })).toBe('inside');
  });
  it('signed in, in no group: Your groups empty state', () => {
    expect(frontDoor({ signInOn: true, status: { is_member: false, signed_in: true, groups: [] } })).toBe('your-groups');
  });
  it('just signed in with one group: straight in', () => {
    expect(frontDoor({ signInOn: true, status: { is_member: true, signed_in: true, groups: [G1] }, fresh: true })).toBe('inside');
  });
  it('just signed in with several groups: pick one', () => {
    expect(frontDoor({ signInOn: true, status: { is_member: true, signed_in: true, groups: [G1, G2] }, fresh: true })).toBe('your-groups');
  });
  it('signed in, several groups, not just now: straight into the last one', () => {
    expect(frontDoor({ signInOn: true, status: { is_member: true, signed_in: true, groups: [G1, G2] }, fresh: false })).toBe('inside');
  });
  it('an invite link always wins', () => {
    expect(frontDoor({ signInOn: true, status: { is_member: false, signed_in: true, groups: [] }, hasInvite: true })).toBe('home');
    expect(frontDoor({ signInOn: true, status: { is_member: true, signed_in: true, groups: [G1, G2] }, fresh: true, hasInvite: true })).toBe('inside');
  });
});

describe('fresh sign-in flag', () => {
  it('lasts 15 minutes and clears', () => {
    const s = memStore();
    expect(isFreshSignIn(s, 1000)).toBe(false);
    markFreshSignIn(s, 1000);
    expect(isFreshSignIn(s, 1000 + 60_000)).toBe(true);
    expect(isFreshSignIn(s, 1000 + 15 * 60_000)).toBe(false);
    clearFreshSignIn(s);
    expect(isFreshSignIn(s, 2000)).toBe(false);
  });
  it('copes with junk and a phone that blocks storage', () => {
    const s = memStore();
    s.setItem('tgt-fresh-sign-in', 'rubbish');
    expect(isFreshSignIn(s)).toBe(false);
    const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); }, removeItem: () => { throw new Error('no'); } };
    expect(() => markFreshSignIn(broken)).not.toThrow();
    expect(isFreshSignIn(broken)).toBe(false);
    expect(() => clearFreshSignIn(broken)).not.toThrow();
  });
  it('a clock that went backwards does not count', () => {
    const s = memStore();
    markFreshSignIn(s, 10_000);
    expect(isFreshSignIn(s, 5_000)).toBe(false);
  });
});

describe('email helpers', () => {
  it('reads a 6-digit code with spaces', () => {
    expect(cleanEmailCode('123456')).toBe('123456');
    expect(cleanEmailCode(' 123 456 ')).toBe('123456');
    expect(cleanEmailCode('12345')).toBe('');
    expect(cleanEmailCode('12345a')).toBe('');
    expect(cleanEmailCode(null)).toBe('');
  });
  it('spots an email address', () => {
    expect(looksLikeEmail('josh@thegolftrip.club')).toBe(true);
    expect(looksLikeEmail(' josh@x.com ')).toBe(true);
    expect(looksLikeEmail('josh@')).toBe(false);
    expect(looksLikeEmail('josh x@y.com')).toBe(false);
  });
});

describe('groupRows and groupLook', () => {
  it('puts the current group first, keeps join order, labels roles', () => {
    const rows = groupRows([G1, G2, { id: 'g3', name: 'C', role: 'guest' }], 'g2');
    expect(rows.map((r) => r.id)).toEqual(['g2', 'g1', 'g3']);
    expect(rows.map((r) => r.roleWord)).toEqual(['Player', 'Organiser', 'Guest']);
    expect(rows[0].current).toBe(true);
  });
  it('ignores rubbish', () => {
    expect(groupRows(null, 'x')).toEqual([]);
    expect(groupRows([null, { name: 'no id' }], 'x')).toEqual([]);
  });
  it('crests: uploaded, L.G.C built-in, or the plain one', () => {
    expect(groupLook({ crest_url: 'https://x/c.png' })).toEqual({ crest_url: 'https://x/c.png' });
    expect(groupLook({ legacy: true })).toEqual({ crest_url: 'builtin:lgc' });
    expect(groupLook({ legacy: false })).toBe(null);
    expect(groupLook(null)).toBe(null);
  });
});

describe('coming back from Google', () => {
  it('keeps an app address once, for 15 minutes', () => {
    const s = memStore();
    rememberReturn('#/join/ABCDEFGH2345', s, 1000);
    expect(takeReturn(s, 2000)).toBe('#/join/ABCDEFGH2345');
    expect(takeReturn(s, 3000)).toBe(null); // used once
    rememberReturn('#/start/new', s, 1000);
    expect(takeReturn(s, 1000 + 15 * 60_000)).toBe(null); // too old
  });
  it('never keeps anything that isn’t an app address', () => {
    const s = memStore();
    rememberReturn('https://evil.example/', s);
    rememberReturn('#/join/x?y=<script>', s);
    expect(takeReturn(s)).toBe(null);
    s.setItem('tgt-return-to', JSON.stringify({ hash: 'javascript:alert(1)', at: Date.now() }));
    expect(takeReturn(s)).toBe(null);
  });
  it('knows which screens are a choice of where to go', () => {
    expect(choosesItsOwnWay('/join/ABCDEFGH2345')).toBe(true);
    expect(choosesItsOwnWay('/start')).toBe(true);
    expect(choosesItsOwnWay('/me/ABCDEFGH2345')).toBe(true);
    expect(choosesItsOwnWay('/start/new')).toBe(true);
    expect(choosesItsOwnWay('/c/bowral')).toBe(true);
    expect(choosesItsOwnWay('/')).toBe(false);
    expect(choosesItsOwnWay('/club')).toBe(false);
    expect(choosesItsOwnWay('/courses')).toBe(false);
  });
});

describe('groupLook on a database without 045', () => {
  it('uses the current group’s own look', () => {
    expect(groupLook({ id: 'g1', current: true }, { legacy: true })).toEqual({ crest_url: 'builtin:lgc' });
    expect(groupLook({ id: 'g1', current: true }, { look: { crest_url: 'https://x/c.png' } })).toEqual({ crest_url: 'https://x/c.png' });
    expect(groupLook({ id: 'g2', current: false }, { legacy: true })).toBe(null);
  });
});
