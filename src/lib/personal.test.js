import { describe, it, expect } from 'vitest';
import { personalCode, personalLink, personalMessage, signInLine, linkScreen } from './personal.js';
import { inviteCode } from './invite.js';

describe('personalCode', () => {
  it('reads the code from a link, a hash or the router path', () => {
    expect(personalCode('https://staging.thegolftrip.club/#/me/abcdefgh2345')).toBe('ABCDEFGH2345');
    expect(personalCode('#/me/ABCDEFGH2345')).toBe('ABCDEFGH2345');
    expect(personalCode('/me/ABCDEFGH2345')).toBe('ABCDEFGH2345');
  });
  it('ignores anything else', () => {
    expect(personalCode('#/join/ABCDEFGH2345')).toBe(null);
    expect(personalCode('#/me/SHORT')).toBe(null);
    expect(personalCode('#/me/ABCDEFGH234O')).toBe(null); // O isn't used
    expect(personalCode(null)).toBe(null);
  });
  it('a personal link is never mistaken for a group invite', () => {
    expect(inviteCode('https://x/#/me/ABCDEFGH2345')).toBe(null);
  });
});

describe('personalLink and personalMessage', () => {
  it('builds the link', () => {
    expect(personalLink('ABCDEFGH2345', 'https://app.thegolftrip.club/')).toBe('https://app.thegolftrip.club/#/me/ABCDEFGH2345');
  });
  it('writes a message with the name, group and link', () => {
    const m = personalMessage('Mike', 'L.G.C', 'https://x/#/me/ABC');
    expect(m).toContain("G'day Mike");
    expect(m).toContain('L.G.C');
    expect(m).toContain('https://x/#/me/ABC');
    expect(m).toContain("don't share it");
    expect(personalMessage('', '', 'L')).toContain("G'day mate");
  });
});

describe('signInLine', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  it('signed in', () => {
    expect(signInLine({ signed_in: true, email: 'm…@gmail.com' }, now)).toEqual({ word: 'Signed in as m…@gmail.com', done: true });
    expect(signInLine({ signed_in: true }, now).word).toBe('Signed in');
  });
  it('link waiting, with days left', () => {
    expect(signInLine({ link_waiting: true, link_expires: '2026-11-03T00:00:00Z' }, now).word).toBe('Link sent · works for 14 more days');
    expect(signInLine({ link_waiting: true, link_expires: '2026-10-20T12:00:00Z' }, now).word).toBe('Link sent · works for 1 more day');
  });
  it('not signed in yet', () => {
    expect(signInLine({ phones: 1 }, now).word).toBe('Not signed in yet (phone only)');
    expect(signInLine({ phones: 0 }, now).word).toBe('Not signed in yet');
    expect(signInLine(null, now).done).toBe(false);
  });
});

describe('linkScreen', () => {
  it('picks the right screen', () => {
    expect(linkScreen(null, false)).toBe('bad');
    expect(linkScreen({ mine: true, state: 'used' }, true)).toBe('done');
    expect(linkScreen({ state: 'used' }, true)).toBe('used');
    expect(linkScreen({ state: 'expired' }, false)).toBe('expired');
    expect(linkScreen({ state: 'replaced' }, false)).toBe('replaced');
    expect(linkScreen({ state: 'ok' }, false)).toBe('sign-in');
    expect(linkScreen({ state: 'ok' }, true)).toBe('confirm');
  });
});

import { googleButtonHere, makeNonce } from './google.js';
import { webcrypto } from 'node:crypto';
import { createHash } from 'node:crypto';

describe('Google’s own button', () => {
  const id = '1234-abc.apps.googleusercontent.com';
  const hosts = ['staging.thegolftrip.club', 'app.thegolftrip.club', 'sign-in-home.thegolftrip-app.pages.dev'];
  it('only on the addresses Google knows about, and only with a real client ID', () => {
    expect(googleButtonHere('staging.thegolftrip.club', id, hosts)).toBe(true);
    expect(googleButtonHere('APP.thegolftrip.club', id, hosts)).toBe(true);
    expect(googleButtonHere('sign-in-home.thegolftrip-app.pages.dev', id, hosts)).toBe(true);
    expect(googleButtonHere('other-branch.thegolftrip-app.pages.dev', id, hosts)).toBe(false);
    expect(googleButtonHere('localhost', id, hosts)).toBe(false);
    expect(googleButtonHere('evil.example', id, hosts)).toBe(false);
    expect(googleButtonHere('staging.thegolftrip.club', '', hosts)).toBe(false);
    expect(googleButtonHere('staging.thegolftrip.club', 'not-a-client-id', hosts)).toBe(false);
    expect(googleButtonHere('staging.thegolftrip.club', id, [])).toBe(false);
  });
  it('the nonce Google gets is the SHA-256 of the one Supabase gets', async () => {
    const { raw, hashed } = await makeNonce(webcrypto);
    expect(raw).toMatch(/^[0-9a-f]{48}$/);
    expect(hashed).toBe(createHash('sha256').update(raw).digest('hex'));
    const again = await makeNonce(webcrypto);
    expect(again.raw).not.toBe(raw);
  });
});
