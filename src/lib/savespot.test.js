import { describe, it, expect } from 'vitest';
import {
  signInModes, canSaveSpot, shouldAskOnce, shouldShowBanner, asked, closedBanner, saved, goingToGoogle, backFromGoogle,
  passwordProblem, authProblem, signInReminder, organiserAction, readSaveState, writeSaveState, BANNER_GAP_MS, quietPath,
} from './savespot.js';
import { rememberReturn, takeReturn } from './home.js';

const member = { is_member: true, player_id: 'p1', signed_in: false };
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

describe('signInModes', () => {
  it('google,password: Google and email + password', () => {
    expect(signInModes(['google', 'password'])).toMatchObject({ google: true, password: true, emailCode: false, any: true });
  });
  it('google,email (staging before 22 Oct): an emailed code each time', () => {
    expect(signInModes(['google', 'email'])).toMatchObject({ google: true, password: false, emailCode: true });
  });
  it('password wins over email if both are listed', () => {
    expect(signInModes(['email', 'password'])).toMatchObject({ password: true, emailCode: false });
  });
  it('F2: joining from a link asks for a code only whenever email is listed', () => {
    expect(signInModes(['google', 'password']).joinCode).toBe(false); // live today: email + password on the join screen
    expect(signInModes(['google', 'password', 'email'])).toMatchObject({ password: true, emailCode: false, joinCode: true });
    expect(signInModes(['google', 'email'])).toMatchObject({ emailCode: true, joinCode: true });
  });
  it('nothing listed: nothing on', () => {
    expect(signInModes([])).toMatchObject({ any: false, google: false, password: false, emailCode: false });
  });
});

describe('canSaveSpot (who gets asked)', () => {
  it('a phone-only player in a group, on a sign-in build', () => {
    expect(canSaveSpot({ signInOn: true, status: member })).toBe(true);
  });
  it('not when the build has no sign-in (live until Josh sets it up)', () => {
    expect(canSaveSpot({ signInOn: false, status: member })).toBe(false);
  });
  it('not once signed in, before picking a name, while viewing as someone, or in a quick round', () => {
    expect(canSaveSpot({ signInOn: true, status: { ...member, signed_in: true } })).toBe(false);
    expect(canSaveSpot({ signInOn: true, status: { ...member, player_id: null } })).toBe(false);
    expect(canSaveSpot({ signInOn: true, status: { ...member, viewing: { name: 'Mike' } } })).toBe(false);
    expect(canSaveSpot({ signInOn: true, status: { ...member, quick: true } })).toBe(false);
    expect(canSaveSpot({ signInOn: true, status: { is_member: false } })).toBe(false);
  });
});

describe('when to ask', () => {
  it('asks once, on a normal screen', () => {
    expect(shouldAskOnce({ eligible: true, state: {}, path: '/plan/abc' })).toBe(true);
    expect(shouldAskOnce({ eligible: true, state: asked({}, 1) })).toBe(false);
    expect(shouldAskOnce({ eligible: true, state: saved({}) })).toBe(false);
  });
  it('not while entering scores, joining, on the notifications screen, or with no signal', () => {
    for (const p of ['/score/r1', '/join/ABC', '/notifications', '/me/X']) expect(quietPath(p)).toBe(true);
    expect(shouldAskOnce({ eligible: true, state: {}, path: '/score/r1' })).toBe(false);
    expect(shouldAskOnce({ eligible: true, state: {}, offline: true })).toBe(false);
    expect(shouldAskOnce({ eligible: false, state: {} })).toBe(false);
  });
});

describe('the banner on Home and More', () => {
  const now = 1_000_000_000_000;
  it('not before the pop-up has had its turn', () => {
    expect(shouldShowBanner({ eligible: true, state: {}, now })).toBe(false);
  });
  it('after "Not now" on the pop-up', () => {
    expect(shouldShowBanner({ eligible: true, state: asked({}, now - 1000), now })).toBe(true);
  });
  it('closed once: back three days later; closed twice: gone', () => {
    const once = closedBanner(asked({}, now), now);
    expect(once.closed).toBe(1);
    expect(shouldShowBanner({ eligible: true, state: once, now: now + 1000 })).toBe(false);
    expect(shouldShowBanner({ eligible: true, state: once, now: now + BANNER_GAP_MS })).toBe(true);
    const twice = closedBanner(once, now + BANNER_GAP_MS);
    expect(shouldShowBanner({ eligible: true, state: twice, now: now + 10 * BANNER_GAP_MS })).toBe(false);
  });
  it('gone once saved, or once signed in', () => {
    expect(shouldShowBanner({ eligible: true, state: saved(asked({}, now)), now })).toBe(false);
    expect(shouldShowBanner({ eligible: false, state: asked({}, now), now })).toBe(false);
  });
});

describe('Google trip and the way back', () => {
  const now = 2_000_000_000_000;
  it('remembers it went to Google and where it was', () => {
    const s = goingToGoogle({}, '#/plan/abc?tab=vote', now);
    expect(s.pending).toMatchObject({ provider: 'google', to: '#/plan/abc?tab=vote' });
    expect(s.asked).toBe(now); // counts as asked: no second pop-up
  });
  it('back signed in: done; back still phone-only: failed; stale or no trip: nothing', () => {
    const s = goingToGoogle({}, '#/', now);
    expect(backFromGoogle({ state: s, signedIn: true, now: now + 60_000 })).toBe('done');
    expect(backFromGoogle({ state: s, signedIn: false, now: now + 60_000 })).toBe('failed');
    expect(backFromGoogle({ state: s, signedIn: true, now: now + 60 * 60_000 })).toBe(null);
    expect(backFromGoogle({ state: {}, signedIn: true, now })).toBe(null);
  });
  it('the page they were going to (the ?to target) is kept for the way back', () => {
    const store = memStore();
    rememberReturn('#/plan/0b6c2d1e-aaaa-4bbb-8ccc-123456789abc?tab=vote', store, now);
    expect(takeReturn(store, now + 30_000)).toBe('#/plan/0b6c2d1e-aaaa-4bbb-8ccc-123456789abc?tab=vote');
    expect(takeReturn(store, now + 31_000)).toBe(null); // used once
  });
  it('saved clears the trip', () => {
    expect(saved(goingToGoogle({}, '#/', now)).pending).toBe(null);
  });
});

describe('passwords', () => {
  it('at least 8 characters, said as they type', () => {
    expect(passwordProblem('')).toMatch(/at least 8/i);
    expect(passwordProblem('abc')).toBe('5 more characters — at least 8.');
    expect(passwordProblem('abcdefg')).toBe('1 more character — at least 8.');
    expect(passwordProblem('abcdefgh')).toBe('');
    expect(passwordProblem('x'.repeat(73))).toMatch(/too long/);
  });
});

describe('errors in plain words', () => {
  it('Google account already used by someone else', () => {
    const p = authProblem({ code: 'identity_already_exists', message: 'Identity is already linked to another user' });
    expect(p.message).toBe('That Google account is already signed in as someone else — use Sign in instead.');
    expect(p.action).toBe('sign-in');
  });
  it('email already has an account → sign in instead', () => {
    expect(authProblem({ code: 'email_exists', message: 'A user with this email address has already been registered' }).action).toBe('sign-in');
    expect(authProblem({ message: 'User already registered' }).action).toBe('sign-in');
  });
  it('wrong password → forgot password', () => {
    const p = authProblem({ code: 'invalid_credentials', message: 'Invalid login credentials' });
    expect(p.message).toMatch(/don’t match/);
    expect(p.action).toBe('forgot');
  });
  it('not confirmed yet → enter the code', () => {
    expect(authProblem({ code: 'email_not_confirmed', message: 'Email not confirmed' }).action).toBe('code');
  });
  it('weak, leaked, expired code, too many tries, manual linking off', () => {
    expect(authProblem({ code: 'weak_password', message: 'Password should be at least 8 characters.' }).message).toMatch(/at least 8/);
    expect(authProblem({ code: 'weak_password', message: 'Password is known to be weak and easy to guess' }).message).toMatch(/leak/);
    expect(authProblem({ code: 'otp_expired', message: 'Token has expired or is invalid' }).message).toMatch(/expired/);
    expect(authProblem({ message: 'email rate limit exceeded' }).message).toMatch(/wait a minute/);
    expect(authProblem({ code: 'manual_linking_disabled', message: 'Manual linking is disabled' }).message).toMatch(/isn’t switched on/);
  });
  it('anything else: the message as it came', () => {
    expect(authProblem(new Error('Something odd')).message).toBe('Something odd');
  });
});

describe('organiser: Remind', () => {
  it('Remind for someone on the app on a phone; a link for someone who isn’t; nothing once signed in', () => {
    expect(organiserAction({ signed_in: false, phones: 1 })).toBe('remind');
    expect(organiserAction({ signed_in: false, phones: 0 })).toBe('link');
    expect(organiserAction({ signed_in: true, phones: 1 })).toBe(null);
  });
  it('the chat message says what to tap', () => {
    const m = signInReminder('Mike', 'L.G.C', 'https://app.thegolftrip.club/');
    expect(m).toMatch(/^G'day Mike/);
    expect(m).toMatch(/Save your spot/);
    expect(m).toMatch(/https:\/\/app\.thegolftrip\.club\/$/);
  });
});

describe('state on the phone', () => {
  it('reads back what was written; bad data reads as nothing', () => {
    const store = memStore();
    writeSaveState({ asked: 5 }, store);
    expect(readSaveState(store)).toEqual({ asked: 5 });
    store.setItem('tgt-save-spot', '{nope');
    expect(readSaveState(store)).toEqual({});
  });
});
