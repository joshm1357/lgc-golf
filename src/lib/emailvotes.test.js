import { describe, it, expect } from 'vitest';
import {
  effectiveChoice, routeFor, usableEmail, planVoteSends, hasAnswered, reminderTargets, answeredByEmail, batchKeyOf,
  tokenExpiry, voteLink, parseVoteLink, buildVoteEmail, isEmail, maskEmail, firstName, VOTE_KINDS,
  emailAnswerLine, channelSummary, recordedLine,
} from './emailvotes.js';

const P = (n) => `20000000-0000-4000-8000-00000000000${n}`;
const U = (n) => `10000000-0000-4000-8000-00000000000${n}`;
const APP = 'https://app.thegolftrip.club/';

describe('channel choice', () => {
  it('a person’s own choice beats the group default; nothing set = the app', () => {
    expect(effectiveChoice(null, 'both')).toBe('both');
    expect(effectiveChoice('email', 'app')).toBe('email');
    expect(effectiveChoice('app', 'both')).toBe('app');
    expect(effectiveChoice(undefined, undefined)).toBe('app');
    expect(effectiveChoice('junk', 'nonsense')).toBe('app');
  });
  it('email needs an address; email-only without one falls back to the app', () => {
    expect(routeFor({ onApp: true, personal: 'email', groupDefault: 'app', hasEmail: true })).toEqual({ push: false, email: true });
    expect(routeFor({ onApp: true, personal: 'email', groupDefault: 'app', hasEmail: false })).toEqual({ push: true, email: false });
    expect(routeFor({ onApp: true, personal: null, groupDefault: 'both', hasEmail: true })).toEqual({ push: true, email: true });
    expect(routeFor({ onApp: true, personal: 'app', groupDefault: 'both', hasEmail: true })).toEqual({ push: true, email: false });
  });
  it('not on the app: email if an organiser added one, otherwise nothing', () => {
    expect(routeFor({ onApp: false, groupDefault: 'app', hasEmail: true })).toEqual({ push: false, email: true });
    expect(routeFor({ onApp: false, groupDefault: 'both', hasEmail: false })).toEqual({ push: false, email: false });
  });
  it('their own address only while they’re still the one on the app for that name', () => {
    expect(usableEmail({ email: 'a@b.co', source: 'own', user_id: U(1) }, U(1))).toBe('a@b.co');
    expect(usableEmail({ email: 'a@b.co', source: 'own', user_id: U(1) }, U(2))).toBe(null);
    expect(usableEmail({ email: 'a@b.co', source: 'own', user_id: U(1) }, null)).toBe(null);
    expect(usableEmail({ email: 'h@b.co', source: 'invited', user_id: null }, null)).toBe('h@b.co');
    expect(usableEmail({ email: null, source: 'own', user_id: U(1) }, U(1))).toBe(null);
  });
  it('vote kinds are the ones that can go by email', () => {
    expect([...VOTE_KINDS].sort()).toEqual(['nudge_votes', 'poll_closing', 'poll_open']);
  });
});

describe('who gets a vote how', () => {
  const players = [
    { id: P(1), name: 'Josh Moran' }, { id: P(2), name: 'Mike Morris', nickname: 'Mikey' }, { id: P(3), name: 'Adam H' },
    { id: P(4), name: 'Hamish C' }, { id: P(5), name: 'Not Approved', approved: false }, { id: P(6), name: 'Paul' },
  ];
  const members = [{ user_id: U(1), player_id: P(1) }, { user_id: U(2), player_id: P(2) }, { user_id: U(3), player_id: P(3) }];
  const emails = [
    { player_id: P(2), user_id: U(2), email: 'mike@example.com', source: 'own' },
    { player_id: P(3), user_id: U(3), email: 'adam@example.com', source: 'own' },
    { player_id: P(4), user_id: null, email: 'hamish@example.com', source: 'invited' },
    { player_id: P(5), user_id: null, email: 'x@example.com', source: 'invited' },
  ];
  it('group default Both, Mike switched to email only, Josh (no address) stays on the app', () => {
    const r = planVoteSends({ players, members, prefs: [{ user_id: U(2), vote_channel: 'email' }], groupDefault: 'both', emails });
    expect(r.push.sort()).toEqual([U(1), U(3)].sort());
    expect(r.email.map((e) => [e.player_id, e.email, e.first])).toEqual([
      [P(2), 'mike@example.com', 'Mikey'], [P(3), 'adam@example.com', 'Adam'], [P(4), 'hamish@example.com', 'Hamish'],
    ]);
    expect(r.emailOnlyUsers).toEqual([U(2)]);
  });
  it('group default app: only those who chose email (and the invited) get email', () => {
    const r = planVoteSends({ players, members, prefs: [{ user_id: U(3), vote_channel: 'both' }], groupDefault: 'app', emails });
    expect(r.push.sort()).toEqual([U(1), U(2), U(3)].sort());
    expect(r.email.map((e) => e.player_id)).toEqual([P(3), P(4)]);
  });
  it('the person who opened the vote is skipped, and a list of players can be given', () => {
    const r = planVoteSends({ players, members, groupDefault: 'both', emails, except: P(3), only: [P(1), P(3), P(4)] });
    expect(r.push).toEqual([U(1)]);
    expect(r.email.map((e) => e.player_id)).toEqual([P(4)]);
  });
});

describe('reminders', () => {
  const polls = [{ id: 'q1' }, { id: 'q2', choice: 'single' }];
  const options = [{ id: 'a', poll_id: 'q1' }, { id: 'b', poll_id: 'q1' }, { id: 'c', poll_id: 'q2' }, { id: 'd', poll_id: 'q2' }];
  it('answered = any one option on every question — a partial vote counts (27 Oct)', () => {
    const votes = [{ poll_id: 'q1', option_id: 'a', player_id: 'x' }, { poll_id: 'q1', option_id: 'b', player_id: 'x' }, { poll_id: 'q2', option_id: 'd', player_id: 'x' }];
    expect(hasAnswered({ polls, options, votes, playerId: 'x' })).toBe(true);
    expect(hasAnswered({ polls, options, votes: votes.slice(0, 2), playerId: 'x' })).toBe(false);
    expect(hasAnswered({ polls, options, votes: votes.slice(1), playerId: 'x' })).toBe(true);
  });
  it('only people on email who haven’t answered and haven’t had a reminder', () => {
    const emailPeople = [{ player_id: 'x' }, { player_id: 'y' }, { player_id: 'z' }];
    const votes = ['a', 'b', 'c'].map((o) => ({ poll_id: o === 'c' ? 'q2' : 'q1', option_id: o, player_id: 'x' }));
    expect(reminderTargets({ emailPeople, polls, options, votes, reminded: ['z'] }).map((p) => p.player_id)).toEqual(['y']);
  });
  it('answered by email counts people, not votes', () => {
    const votes = [
      { poll_id: 'q1', option_id: 'a', player_id: 'x', via: 'email' }, { poll_id: 'q1', option_id: 'b', player_id: 'x', via: 'email' },
      { poll_id: 'q1', option_id: 'a', player_id: 'y', via: 'app' }, { poll_id: 'q2', option_id: 'c', player_id: 'z', via: 'email' },
    ];
    expect(answeredByEmail(votes, 'q1')).toBe(1);
    expect(answeredByEmail(votes, ['q1', 'q2'])).toBe(2);
    expect(answeredByEmail(votes)).toBe(2);
    expect(emailAnswerLine(3)).toBe('📧 3 people answered by email');
    expect(emailAnswerLine(1)).toBe('📧 1 person answered by email');
    expect(emailAnswerLine(0)).toBe('');
  });
});

describe('batches, links and expiry', () => {
  it('a combined vote card is one batch; a lone poll is its own', () => {
    expect(batchKeyOf({ id: 'q1', vote_batch: 'B' })).toBe('B');
    expect(batchKeyOf({ id: 'q1' })).toBe('q1');
  });
  it('links expire at the end of the last closing day, or in 45 days', () => {
    expect(tokenExpiry([{ closes_on: '2027-03-01' }, { closes_on: '2027-03-05' }])).toBe('2027-03-05T13:59:59.000Z');
    const now = Date.parse('2026-10-22T00:00:00Z');
    expect(tokenExpiry([{ closes_on: '2027-03-01' }, { closes_on: null }], now)).toBe('2026-12-06T00:00:00.000Z');
  });
  it('answer links round-trip', () => {
    const l = voteLink(APP, 'id.sec', { o: 'opt-1', r: 'maybe' });
    expect(l).toBe('https://app.thegolftrip.club/#/v/id.sec?o=opt-1&r=maybe');
    expect(parseVoteLink('id.sec', '?o=opt-1&r=maybe')).toEqual({ t: 'id.sec', o: 'opt-1', r: 'maybe', rsvp: null, stop: false });
    expect(parseVoteLink('t', 'rsvp=in')).toMatchObject({ rsvp: 'in', o: null });
    expect(parseVoteLink('t', '?stop=1').stop).toBe(true);
    expect(parseVoteLink('t', '?o=x&r=hack').r).toBe(null);
  });
  it('email checks', () => {
    expect(isEmail(' Mike@Example.com ')).toBe(true);
    expect(isEmail('mike@example')).toBe(false);
    expect(isEmail('a b@c.com')).toBe(false);
    expect(maskEmail('hamish@example.com')).toBe('h…@example.com');
    expect(firstName({ name: 'Josh Moran' })).toBe('Josh');
    expect(firstName(null)).toBe('there');
  });
});

describe('the email', () => {
  const polls = [
    { id: 'q1', question: 'Which weekend?', options: [{ id: 'o1', label: '13–15 Mar' }, { id: 'o2', label: '20–22 Mar' }] },
    { id: 'q2', question: 'Shirt colour?', choice: 'single', options: [{ id: 'o3', label: 'Pink' }, { id: 'o4', label: 'Navy' }] },
  ];
  const m = buildVoteEmail({ app: APP, token: 'tok.SECRET', first: 'Mike', planName: 'Hunter 2027', planId: 'plan-1', polls, rsvp: true, closes: 'Fri 30 Oct' });
  it('one email with every question, ✓ ? ✗ for each date, one button per single choice, and keen/maybe/out', () => {
    expect(m.subject).toBe('🗳️ Hunter 2027: 3 quick questions');
    for (const r of ['yes', 'maybe', 'no']) for (const o of ['o1', 'o2']) expect(m.html).toContain(`#/v/tok.SECRET?o=${o}&amp;r=${r}`);
    expect(m.html).toContain('#/v/tok.SECRET?o=o3&amp;r=yes');
    expect(m.html).not.toContain('o=o3&amp;r=no');
    for (const s of ['in', 'maybe', 'out']) expect(m.html).toContain(`?rsvp=${s}`);
    expect(m.html).toContain('✓ Yes');
    expect(m.html).toContain('? Maybe');
    expect(m.text).toContain(`✓ Yes: ${APP}#/v/tok.SECRET?o=o1&r=yes`);
    expect(m.text).toContain('Closes Fri 30 Oct');
  });
  it('a stop link, an open-in-app link, and nothing else about the group', () => {
    expect(m.unsubscribe).toBe(`${APP}#/v/tok.SECRET?stop=1`);
    expect(m.html).toContain('Stop vote emails');
    expect(m.html).toContain(`${APP}#/plan/plan-1?tab=vote`);
    expect(m.html).toContain('Hi Mike');
  });
  it('one poll: its question is the subject; a reminder says so', () => {
    const r = buildVoteEmail({ app: APP, token: 't', first: 'Jo', planName: 'Trip', planId: 'p', polls: polls.slice(0, 1), reminder: true });
    expect(r.subject).toBe('⏰ Reminder — Trip: Which weekend?');
    expect(r.html).toContain('closes soon');
  });
});

describe('the organiser’s view and the answer page', () => {
  it('sorts people into email / app / both / none', () => {
    const s = channelSummary([
      { player_id: 'a', on_app: true, choice: 'email', has_email: true },
      { player_id: 'b', on_app: true, choice: 'email', has_email: false },
      { player_id: 'c', on_app: true, choice: 'both', has_email: true },
      { player_id: 'd', on_app: false, has_email: true },
      { player_id: 'e', on_app: false, has_email: false },
      { player_id: 'f', on_app: true, choice: 'app', has_email: true },
    ]);
    expect(s).toEqual({ email: ['a', 'd'], app: ['b', 'f'], both: ['c'], none: ['e'] });
  });
  it('says what was recorded', () => {
    expect(recordedLine('Josh', { kind: 'vote', label: '13–15 Mar', response: 'yes' })).toBe('Thanks Josh — you’re a ✓ for 13–15 Mar.');
    expect(recordedLine('Josh', { kind: 'rsvp', response: 'in' })).toBe('Thanks Josh — you’re keen.');
    expect(recordedLine('there', { kind: 'vote', label: 'Pink', response: 'no' })).toBe('Thanks — you’re a ✗ for Pink.');
    expect(recordedLine('Josh', null)).toBe('');
  });
});
