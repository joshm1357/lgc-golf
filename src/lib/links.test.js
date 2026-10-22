import { describe, it, expect } from 'vitest';
import { safeTarget, shareLink, linkTarget, targetQuery, readLink, inviteNext, pageToKeep } from './links.js';
import { rememberReturn, takeReturn, frontDoor } from './home.js';
import { voteShareLink } from './callvote.js';
import { phoneLine, phoneScreen, phoneMessage } from './personal.js';

const CODE = 'ABCDEFGH2345';
const R = '0b9a2f4e-1111-4222-8333-444455556666';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const BASE = 'https://app.example/lgc-golf/';
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

describe('safeTarget: only in-app pages', () => {
  it('keeps app pages, with or without a #', () => {
    expect(safeTarget(`/?r=${R}`)).toBe(`/?r=${R}`);
    expect(safeTarget(`#/plan/${PLAN}?view=overview`)).toBe(`/plan/${PLAN}?view=overview`);
    expect(safeTarget('/replay/abc-123')).toBe('/replay/abc-123');
  });
  it('refuses anything that could leave the app or loop', () => {
    for (const bad of ['https://evil.example', '//evil.example', 'evil.example/x', '/\\evil', 'javascript:alert(1)', '/a/../../x',
      '/join/ABCDEFGH2345', '/join', '/me/ABCDEFGH2345', '/plan/<script>', '/x?y="z"', '', null, 42, `/${'a'.repeat(400)}`]) {
      expect(safeTarget(bad)).toBe(null);
    }
  });
});

describe('shareLink: one scheme', () => {
  it('a page with the join code goes through the join link, the page URL-encoded', () => {
    const link = shareLink({ base: BASE, code: CODE, to: `/plan/${PLAN}?view=overview` });
    expect(link).toBe(`${BASE}#/join/${CODE}?to=%2Fplan%2F${PLAN}%3Fview%3Doverview`);
  });
  it('no code: straight to the page; no page: the plain join link', () => {
    expect(shareLink({ base: BASE, to: `/?r=${R}` })).toBe(`${BASE}#/?r=${R}`);
    expect(shareLink({ base: BASE, code: CODE, to: '/' })).toBe(`${BASE}#/join/${CODE}`);
    expect(shareLink({ base: BASE, code: 'not-a-code', to: '/feed' })).toBe(`${BASE}#/feed`);
  });
  it('an unsafe target falls back to the home page', () => {
    expect(shareLink({ base: BASE, code: CODE, to: 'https://evil.example' })).toBe(`${BASE}#/join/${CODE}`);
    expect(shareLink({ base: BASE, code: CODE, to: `/join/${CODE}` })).toBe(`${BASE}#/join/${CODE}`);
  });
  it('the vote link uses the same scheme', () => {
    expect(voteShareLink({ base: BASE, code: CODE, planId: PLAN })).toBe(`${BASE}#/join/${CODE}?to=%2Fplan%2F${PLAN}%3Ftab%3Dvote`);
  });
});

describe('linkTarget: where to land after joining', () => {
  it('reads ?to= back to the same page', () => {
    const link = shareLink({ base: BASE, code: CODE, to: `/?r=${R}` });
    expect(linkTarget(link.slice(link.indexOf('#')))).toBe(`#/?r=${R}`);
    expect(linkTarget(`#/join/${CODE}?to=%2Fplan%2F${PLAN}%3Fview%3Doverview`)).toBe(`#/plan/${PLAN}?view=overview`);
  });
  it('old vote links still land on the vote', () => {
    expect(linkTarget(`#/join/${CODE}?vote=${PLAN}`)).toBe(`#/plan/${PLAN}?tab=vote`);
  });
  it('refuses redirects out of the app, and back into /join', () => {
    expect(linkTarget(`#/join/${CODE}?to=https%3A%2F%2Fevil.example`)).toBe(null);
    expect(linkTarget(`#/join/${CODE}?to=%2F%2Fevil.example`)).toBe(null);
    expect(linkTarget(`#/join/${CODE}?to=%2Fjoin%2FZZZZZZZZZZZZ`)).toBe(null);
    expect(linkTarget(`#/join/${CODE}?to=%2Fme%2FZZZZZZZZZZZZ`)).toBe(null);
    expect(linkTarget(`#/join/${CODE}`)).toBe(null);
  });
  it('the target survives signing in (kept on the phone)', () => {
    const s = store();
    const back = `#/join/${CODE}${targetQuery(`#/join/${CODE}?to=%2Fplan%2F${PLAN}%3Fview%3Doverview`)}`;
    rememberReturn(back, s, 1000);
    const got = takeReturn(s, 2000);
    expect(got).toBe(back);
    expect(linkTarget(got)).toBe(`#/plan/${PLAN}?view=overview`);
    // nothing outside the app is ever kept
    rememberReturn('#//evil.example', s, 1000);
    expect(takeReturn(s, 2000)).toBe(null);
  });
});

describe('readLink: the paste box takes any app link', () => {
  it('an invite, with or without a page', () => {
    expect(readLink(`https://app/lgc-golf/#/join/${CODE.toLowerCase()}`)).toEqual({ kind: 'invite', code: CODE, hash: `#/join/${CODE}` });
    expect(readLink(`${BASE}#/join/${CODE}?to=%2F%3Fr%3D${R}`).hash).toBe(`#/join/${CODE}?to=${encodeURIComponent(`/?r=${R}`)}`);
    expect(readLink(` ${CODE} `).kind).toBe('invite');
  });
  it('a personal link', () => {
    expect(readLink(`${BASE}#/me/${CODE}`)).toEqual({ kind: 'personal', hash: `#/me/${CODE}` });
  });
  it('a page with no join code is a page (remembered, but it can’t let you in)', () => {
    expect(readLink(`${BASE}#/?r=${R}`)).toEqual({ kind: 'page', hash: `#/?r=${R}` });
  });
  it('not a link (an old PIN, rubbish)', () => {
    expect(readLink('7851')).toBe(null);
    expect(readLink('hello there')).toBe(null);
    expect(readLink('https://evil.example/#//x')).toBe(null);
  });
  it('a page opened with no session is kept for after joining', () => {
    expect(pageToKeep(`#/?r=${R}`)).toBe(`#/?r=${R}`);
    expect(pageToKeep('#/')).toBe(null);
    expect(pageToKeep('')).toBe(null);
  });
});

describe('Gate decisions for an opened link', () => {
  const G = 'g-1';
  it('no session at all: the link-first screen, then the invite', () => {
    expect(frontDoor({ signInOn: false, status: null })).toBe('join');
    expect(frontDoor({ signInOn: false, status: { is_member: false } , hasInvite: true })).toBe('join');
  });
  it('in that group and it’s open: straight to the page', () => {
    expect(inviteNext({ info: { group_id: G, already_in: true }, inside: true, currentGroupId: G, hasTarget: true })).toBe('go');
    expect(inviteNext({ info: { group_id: G, already_in: true }, inside: true, currentGroupId: G })).toBe('go');
  });
  it('in that group but another one is open on this phone: switch, then the page', () => {
    expect(inviteNext({ info: { group_id: G, already_in: true }, inside: true, currentGroupId: 'other', hasTarget: true })).toBe('switch');
    expect(inviteNext({ info: { group_id: G, already_in: true }, inside: true, currentGroupId: 'other' })).toBe('open');
  });
  it('not in it: join (pick a name), then the page', () => {
    expect(inviteNext({ info: { group_id: G, already_in: false }, hasTarget: true })).toBe('join');
    expect(inviteNext({ info: { group_id: G, already_in: false }, inside: true, currentGroupId: 'other', hasTarget: true })).toBe('join');
  });
  it('a team link for someone not on a team yet still asks; a bad link says so', () => {
    expect(inviteNext({ info: { group_id: G, already_in: true, team: 'Blues', my_team: null }, inside: true, currentGroupId: G, hasTarget: true })).toBe('join');
    expect(inviteNext({ info: { bad: true } })).toBe('bad');
    expect(inviteNext({ info: null })).toBe('bad');
  });
});

describe('personal links on a phone with sign-in off', () => {
  it('what the screen does', () => {
    expect(phoneScreen({ state: 'ok' }, false)).toBe('use');
    expect(phoneScreen({ state: 'ok' }, true)).toBe('use');
    expect(phoneScreen({ state: 'used' }, true)).toBe('in');
    expect(phoneScreen({ state: 'used' }, false)).toBe('used');
    expect(phoneScreen({ state: 'expired' }, false)).toBe('expired');
    expect(phoneScreen(null)).toBe('bad');
  });
  it('the organiser card line', () => {
    expect(phoneLine(null).word).toBe('Not on the app yet');
    expect(phoneLine({ phones: 2 }).word).toBe('On the app (2 phones)');
    const now = Date.parse('2026-10-22T00:00:00Z');
    expect(phoneLine({ link_waiting: true, link_expires: '2026-10-25T00:00:00Z' }, now)).toMatchObject({ waiting: true, word: 'Link sent · works for 3 more days' });
  });
  it('the message says no name to pick, and warns an organiser', () => {
    expect(phoneMessage('Mike', 'L.G.C', 'L')).toMatch(/no name to pick.*L$/);
    expect(phoneMessage('Josh', 'L.G.C', 'L', 'organiser')).toMatch(/organiser of L\.G\.C/);
  });
});
