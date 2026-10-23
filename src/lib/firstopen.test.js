import { describe, it, expect } from 'vitest';
import {
  noteVisit, visitCount, popupFree, takePopup, popupThisVisit, helloReady, notifyAskReady, notifyNotNow, notifyCardHidden,
  starterSteps, showStarter, starterState, setStarterState, inviteMessage, joinedWords, showWelcome, hideWelcome, welcomeHidden,
  nextTripWords,
} from './firstopen.js';

const fakeStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

describe('visits and one pop-up a visit', () => {
  it('counts a visit once per session', () => {
    const local = fakeStore();
    let sess = fakeStore();
    expect(noteVisit(local, sess)).toBe(1);
    expect(noteVisit(local, sess)).toBe(1);
    sess = fakeStore(); // the app opened again
    expect(noteVisit(local, sess)).toBe(2);
    expect(visitCount(local)).toBe(2);
  });
  it('only one pop-up a visit', () => {
    const sess = fakeStore();
    expect(popupFree('notify', sess)).toBe(true);
    takePopup('notify', sess);
    expect(popupThisVisit(sess)).toBe('notify');
    expect(popupFree('notify', sess)).toBe(true);
    expect(popupFree('caddie-hello', sess)).toBe(false);
  });
  it('Caddie says hello from the second visit, never on top of another pop-up', () => {
    expect(helloReady({ visits: 1 })).toBe(false);
    expect(helloReady({ visits: 2 })).toBe(true);
    expect(helloReady({ visits: 2, had: 'notify' })).toBe(false);
    expect(helloReady({ visits: 3, had: 'caddie-hello' })).toBe(true);
  });
  it('the notifications ask waits for the second visit', () => {
    expect(notifyAskReady({ visits: 1 })).toBe(false);
    expect(notifyAskReady({ visits: 2 })).toBe(true);
    expect(notifyAskReady({ visits: 2, had: 'save-spot' })).toBe(false);
  });
  it('"Not now" hides the Home notifications card for 30 days', () => {
    const s = fakeStore();
    expect(notifyCardHidden(1000, s)).toBe(false);
    notifyNotNow(1000, s);
    expect(notifyCardHidden(1000 + 29 * 864e5, s)).toBe(true);
    expect(notifyCardHidden(1000 + 31 * 864e5, s)).toBe(false);
  });
});

describe('the organiser’s three-step start', () => {
  it('ticks each step off', () => {
    expect(starterSteps({}).map((s) => s.done)).toEqual([false, false, false]);
    expect(starterSteps({ joined: 2, plans: 1, pushOn: true }).map((s) => s.done)).toEqual([true, true, true]);
    expect(starterSteps({ joined: 1, invited: true })[0].done).toBe(true);
    expect(starterSteps({ joined: 1 })[0].done).toBe(false);
  });
  it('shows for organisers of a new group until done or hidden', () => {
    const steps = starterSteps({});
    expect(showStarter({ isOrganiser: true, joined: 0, plans: 0, steps })).toBe(true);
    expect(showStarter({ isOrganiser: false, steps })).toBe(false);
    expect(showStarter({ isOrganiser: true, hidden: true, steps })).toBe(false);
    expect(showStarter({ isOrganiser: true, joined: 9, plans: 3, steps })).toBe(false); // an established group
    expect(showStarter({ isOrganiser: true, joined: 1, plans: 0, steps: starterSteps({ joined: 3, plans: 1, pushOn: true }) })).toBe(false);
  });
  it('remembers per group', () => {
    const s = fakeStore();
    setStarterState('g1', { invited: true }, s);
    expect(starterState('g1', s)).toEqual({ invited: true });
    expect(starterState('g2', s)).toEqual({});
  });
  it('a ready-made group-chat message with the link', () => {
    const m = inviteMessage({ groupName: 'L.G.C', link: 'https://app.thegolftrip.club/#/join/abc', from: 'Josh' });
    expect(m).toContain('L.G.C');
    expect(m).toContain('https://app.thegolftrip.club/#/join/abc');
    expect(m).toMatch(/pick your name/);
  });
  it('who has joined, in words (I1)', () => {
    expect(joinedWords([])).toMatch(/^Nobody’s joined yet/);
    expect(joinedWords(['Bo'])).toBe('Bo has joined');
    expect(joinedWords(['Bo', 'Cy'])).toBe('Bo and Cy have joined');
    expect(joinedWords(['Bo', 'Cy', 'Di', 'Ed', 'Fin'])).toBe('Bo, Cy and 3 more have joined');
  });
});

describe('the welcome card', () => {
  const now = Date.parse('2026-10-23T10:00:00Z');
  it('new players and guests, not organisers, for a fortnight', () => {
    expect(showWelcome({ joinedAt: '2026-10-22T10:00:00Z', now })).toBe(true);
    expect(showWelcome({ joinedAt: '2026-09-01T10:00:00Z', now })).toBe(false);
    expect(showWelcome({ isOrganiser: true, joinedAt: '2026-10-22T10:00:00Z', now })).toBe(false);
    expect(showWelcome({ joinedAt: null, now })).toBe(false);
  });
  it('put away for good, per group', () => {
    const s = fakeStore();
    expect(welcomeHidden('g', s)).toBe(false);
    hideWelcome('g', s);
    expect(welcomeHidden('g', s)).toBe(true);
    expect(showWelcome({ joinedAt: '2026-10-22T10:00:00Z', now, hidden: welcomeHidden('g', s) })).toBe(false);
  });
  it('the next trip, or nothing planned yet', () => {
    expect(nextTripWords(null)).toMatch(/^Nothing planned yet/);
    expect(nextTripWords({ name: 'Hunter', start_date: '2026-11-13', end_date: '2026-11-16' })).toBe('Next up: Hunter · 2026-11-13 – 2026-11-16');
    expect(nextTripWords({ name: 'Autumn', status: 'planning' })).toBe('Next up: Autumn · being organised');
  });
});
