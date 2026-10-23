import { describe, it, expect } from 'vitest';
import {
  joinDoor, afterSignInTry, deadLinkWords, takenHelp, noGroupWords, welcomeName,
  markJoinAfterSignIn, joinAfterSignIn, clearJoinAfterSignIn, markWelcome, takeWelcome,
} from './joinfirst.js';
import { inviteNext } from './links.js';
import { authProblem } from './savespot.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

describe('joinDoor: what a join link shows first', () => {
  it('sign-in build, nobody signed in: the sign-in screen first', () => {
    expect(joinDoor({ signInOn: true, signedIn: false })).toBe('sign-in');
  });
  it('already signed in: straight to joining (as that account)', () => {
    expect(joinDoor({ signInOn: true, signedIn: true })).toBe('join');
  });
  it('"Just this phone: scoring and voting only": the old phone-only join', () => {
    expect(joinDoor({ signInOn: true, signedIn: false, phoneOnly: true })).toBe('join');
  });
  it('sign-in off in this build (live L.G.C before sign-in): unchanged', () => {
    expect(joinDoor({ signInOn: false, signedIn: false })).toBe('join');
  });
});

describe('afterSignInTry: one email form that works out sign in or create', () => {
  it('no account with that email and password → offer to make one', () => {
    expect(afterSignInTry(authProblem({ code: 'invalid_credentials', message: 'Invalid login credentials' }))).toBe('no-match');
  });
  it('made but not confirmed → the 6-digit code', () => {
    expect(afterSignInTry(authProblem({ code: 'email_not_confirmed', message: 'Email not confirmed' }))).toBe('code');
  });
  it('anything else → just say it', () => {
    expect(afterSignInTry(authProblem({ message: 'Failed to fetch' }))).toBe('problem');
    expect(afterSignInTry(null)).toBe('problem');
  });
});

describe('deadLinkWords: a link that will not work, on the sign-in screen', () => {
  it('used: "If that was you, sign in below" — not "ask for a new one"', () => {
    const w = deadLinkWords('used');
    expect(w.title).toBe('This link’s already been used');
    expect(w.body).toBe('If that was you, sign in below.');
    expect(w.body).not.toMatch(/ask for a new one/i);
    expect(w.signIn).toBe(true);
  });
  it('run out and unknown links still offer sign-in', () => {
    expect(deadLinkWords('expired').title).toMatch(/run out/);
    expect(deadLinkWords(null).title).toMatch(/isn’t working/);
    expect(deadLinkWords(null).signIn).toBe(true);
  });
});

describe('takenHelp: a name someone else already has', () => {
  it('sign-in builds: sign in there, connect, then sign in here', () => {
    expect(takenHelp(true)).toBe('That’s you on another phone? Sign in there and connect Google or email, then sign in here.');
  });
  it('sign-in off: the personal link instead', () => {
    expect(takenHelp(false)).toMatch(/Copy my link/);
  });
});

describe('noGroupWords: signed in, in no group', () => {
  it('names the account and says to open the link', () => {
    const w = noGroupWords('josh@example.com');
    expect(w.body).toBe('You’re signed in as josh@example.com but not in a group yet. Open your group’s link (paste it here) and you’ll join as this account.');
  });
  it('no email (e.g. a Google account with none shown): still says what to do', () => {
    expect(noGroupWords('').body).toMatch(/^You’re signed in but not in a group yet/);
  });
});

describe('welcomeName', () => {
  it('nickname first, else first name', () => {
    expect(welcomeName({ name: 'Joshua M', nickname: 'Josh' })).toBe('Welcome back, Josh');
    expect(welcomeName({ name: 'Joshua M' })).toBe('Welcome back, Joshua');
    expect(welcomeName(null)).toBe('Welcome back');
  });
});

describe('inviteNext for a signed-in account (ov13)', () => {
  const info = { group_id: 'g1', already_in: true };
  it('signed in and already in that group: straight there, no button', () => {
    expect(inviteNext({ info, signedIn: true })).toBe('switch');
    expect(inviteNext({ info, inside: true, currentGroupId: 'g1', signedIn: true })).toBe('go');
  });
  it('phone-only and already in, no page: the Open button as before', () => {
    expect(inviteNext({ info, signedIn: false })).toBe('open');
  });
  it('not in it yet: join', () => {
    expect(inviteNext({ info: { group_id: 'g1', already_in: false }, signedIn: true })).toBe('join');
  });
  it('a team link for someone in the group but on no team: join (puts them on it)', () => {
    expect(inviteNext({ info: { group_id: 'g1', already_in: true, team: 'Blues', my_team: null }, signedIn: true })).toBe('join');
  });
});

describe('notes on the phone', () => {
  it('join after sign-in: only for that code, and only for 15 minutes', () => {
    const s = memStore();
    markJoinAfterSignIn('abcdefgh2345', s, 1000);
    expect(joinAfterSignIn('ABCDEFGH2345', s, 2000)).toBe(true);
    expect(joinAfterSignIn('ZZZZZZZZ2345', s, 2000)).toBe(false);
    expect(joinAfterSignIn('ABCDEFGH2345', s, 1000 + 16 * 60 * 1000)).toBe(false);
    clearJoinAfterSignIn(s);
    expect(joinAfterSignIn('ABCDEFGH2345', s, 2000)).toBe(false);
  });
  it('welcome back: once, in that group only', () => {
    const s = memStore();
    markWelcome('g1', s, 1000);
    expect(takeWelcome('g2', s, 2000)).toBe(false);
    expect(takeWelcome('g1', s, 2000)).toBe(true);
    expect(takeWelcome('g1', s, 2000)).toBe(false);
  });
  it('never throws with no storage', () => {
    expect(() => markJoinAfterSignIn('X', null)).not.toThrow();
    expect(joinAfterSignIn('X', null)).toBe(false);
    expect(takeWelcome('g', null)).toBe(false);
  });
});
