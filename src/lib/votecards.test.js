import { describe, it, expect } from 'vitest';
import { sectionPart, splitRange, pollPart, isCombined, cardPolls, cardStatus, closesWords, closeButton, settleWhen, winnerKeys, partResultPost, callChoices, mainPoll, yesCounts } from './votecards.js';

const range = [
  { key: 'area', kind: 'location', question: 'Which area?', options: [{ key: 'area:Hunter Valley' }, { key: 'area:South Coast' }] },
  { key: 'weekend', kind: 'dates', question: 'Which weekend?', options: [{ key: 'weekend:2027-03-12' }, { key: 'weekend:2027-03-19' }] },
  { key: 'length', kind: 'other', question: 'How long?', options: [{ key: 'nights:2' }, { key: 'nights:3' }] },
  { key: 'courses:Hunter Valley', kind: 'other', question: 'Hunter Valley: which courses?', options: [{ key: 'areacourse:Hunter Valley:c1' }] },
  { key: 'accom', kind: 'other', question: 'Where should we stay?', options: [{ key: 'accom:1', stayId: 1 }] },
];

describe('splitting the start vote into When? and Where?', () => {
  it('puts the weekends and How long? in When?, the rest in Where?', () => {
    const s = splitRange(range);
    expect(s.when.map((x) => x.key)).toEqual(['weekend', 'length']);
    expect(s.where.map((x) => x.key)).toEqual(['area', 'courses:Hunter Valley', 'accom']);
    expect(sectionPart({ key: 'x', options: [{ key: 'nights:2' }] })).toBe('when');
    expect(sectionPart({ key: 'day:1', options: [{ key: 'course:1:c1' }] })).toBe('where');
  });
  it('tells a saved vote’s part from its kind, question or option keys', () => {
    const options = [{ id: 'o1', poll_id: 'p3' }, { id: 'o2', poll_id: 'p4' }];
    const keys = { o1: 'nights:3', o2: 'area:Hunter Valley' };
    expect(pollPart({ id: 'p1', kind: 'dates' })).toBe('when');
    expect(pollPart({ id: 'p2', kind: 'other', question: 'How long?' })).toBe('when');
    expect(pollPart({ id: 'p3', kind: 'other', question: 'Length' }, options, keys)).toBe('when');
    expect(pollPart({ id: 'p4', kind: 'location' }, options, keys)).toBe('where');
    expect(pollPart({ id: 'p5', kind: 'other', question: 'Which courses?' }, options, keys)).toBe('where');
  });
  it('keeps old trips on the combined vote', () => {
    expect(isCombined({ votes: { v1: 'b1' } })).toBe(true);
    expect(isCombined({ votes: { v1: 'b1', when: 'b2' } })).toBe(false);
    expect(isCombined({ votes: {} })).toBe(false);
    expect(isCombined({})).toBe(false);
  });
});

describe('what each card offers to call', () => {
  it('both when both have something to vote on', () => {
    const c = callChoices({ votes: {}, weekends: [{}, {}] }, range);
    expect([c.when, c.where, c.both]).toEqual([true, true, true]);
  });
  it('only Where? once the weekend is settled, only When? once Where? is out', () => {
    expect(callChoices({ votes: {}, weekendsSettled: true }, range)).toMatchObject({ when: false, where: true, both: false });
    expect(callChoices({ votes: { where: 'b1' } }, range)).toMatchObject({ when: true, where: false, both: false });
  });
  it('nothing for When? when there is only one weekend and no length question', () => {
    const r = range.filter((s) => s.key !== 'weekend' && s.key !== 'length');
    expect(callChoices({ votes: {} }, r)).toMatchObject({ when: false, where: true });
  });
});

describe('the card’s status line', () => {
  const st = { votes: { when: 'b1', where: 'b1' }, optionKeys: { w1: 'weekend:2027-03-12', w2: 'weekend:2027-03-19', a1: 'area:Hunter Valley', a2: 'area:South Coast' } };
  const polls = [
    { id: 'pw', vote_batch: 'b1', kind: 'dates', status: 'open', closes_on: '2026-10-29' },
    { id: 'pa', vote_batch: 'b1', kind: 'location', status: 'closed', winner_option_id: 'a1', closes_on: '2026-10-29' },
    { id: 'px', vote_batch: 'b9', kind: 'dates', status: 'open' },
  ];
  const options = [
    { id: 'w1', poll_id: 'pw', label: 'Fri 12 – Sun 14 Mar' }, { id: 'w2', poll_id: 'pw', label: 'Fri 19 – Sun 21 Mar' },
    { id: 'a1', poll_id: 'pa', label: 'Hunter Valley' }, { id: 'a2', poll_id: 'pa', label: 'South Coast' },
  ];
  const votes = [
    { poll_id: 'pw', option_id: 'w1', player_id: 'x', response: 'yes' },
    { poll_id: 'pw', option_id: 'w2', player_id: 'y', response: 'maybe' },
    ...['p1', 'p2', 'p3', 'p4', 'p5'].map((p) => ({ poll_id: 'pa', option_id: 'a1', player_id: p, response: 'yes' })),
    ...['p6', 'p7'].map((p) => ({ poll_id: 'pa', option_id: 'a2', player_id: p, response: 'yes' })),
  ];
  it('finds the card’s own polls in a shared batch ("Call both")', () => {
    expect(cardPolls('when', { st, polls, options }).map((p) => p.id)).toEqual(['pw']);
    expect(cardPolls('where', { st, polls, options }).map((p) => p.id)).toEqual(['pa']);
    expect(cardPolls('when', { st: { votes: {} }, polls, options })).toEqual([]);
  });
  it('says Not called yet / Out now / Closed / Decided', () => {
    expect(cardStatus('when', { st: { votes: {} }, polls, options }).line).toBe('Not called yet');
    expect(cardStatus('when', { st, polls, options, votes, of: 9, today: '2026-10-23' })).toMatchObject({ state: 'out', line: 'Out now — 2 of 9 voted, closes Thu' });
    expect(cardStatus('where', { st, polls, options, votes, of: 9 })).toMatchObject({ state: 'closed', line: 'Closed — Hunter Valley won 5–2' });
    expect(cardStatus('when', { st: { votes: {} }, decided: 'Fri 12 – Sun 14 Mar' }).line).toBe('Decided — Fri 12 – Sun 14 Mar (no vote)');
  });
  it('picks the main poll and counts ✓ votes', () => {
    expect(mainPoll('where', [polls[1]], options, st.optionKeys).id).toBe('pa');
    expect(yesCounts(polls[1], options, votes).map((c) => c.yes)).toEqual([5, 2]);
  });
});

describe('words', () => {
  it('closing dates', () => {
    expect(closesWords('2026-10-23', '2026-10-23')).toBe('closes tonight');
    expect(closesWords('2026-10-24', '2026-10-23')).toBe('closes tomorrow');
    expect(closesWords('2026-11-12', '2026-10-23')).toBe('closes Thu 12 Nov');
    expect(closesWords('2026-10-20', '2026-10-23')).toBe('closing date was Tue 20 Oct');
    expect(closesWords(null)).toBe('no closing date');
  });
  it('the button says it closes the vote', () => {
    expect(closeButton('when', 'Fri 12 – Sun 14 Mar', { open: true })).toBe('Close the vote and go with Fri 12 – Sun 14 Mar');
    expect(closeButton('where', 'Hunter Valley')).toBe('Go with Hunter Valley');
    expect(closeButton('where', null)).toBeNull();
  });
  it('the Feed posts', () => {
    expect(partResultPost({ planName: 'March trip', part: 'when', label: 'Fri 12 – Sun 14 Mar', nights: 2, votes: [5, 2] }))
      .toBe('📅 March trip — the weekend’s decided: Fri 12 – Sun 14 Mar (2 nights). 5 votes to 2. Still to decide: where.');
    expect(partResultPost({ planName: 'March trip', part: 'where', label: 'Hunter Valley', votes: [1, 0], otherDone: true }))
      .toBe('📍 March trip — we’re going to Hunter Valley. 1 vote to 0. Next: ringing the courses for tee times.');
  });
  it('winner keys', () => {
    expect(winnerKeys('when', { weekendKey: '2027-03-12', nights: 3 })).toEqual(['weekend:2027-03-12', 'nights:3']);
    expect(winnerKeys('where', { area: 'Hunter Valley' })).toEqual(['area:Hunter Valley']);
  });
});

describe('settling the weekend from the When? vote alone', () => {
  const st = { nights: 2, weekends: [{ start: '2027-03-12', end: '2027-03-14' }, { start: '2027-03-19', end: '2027-03-21' }, { start: '2027-03-26', end: '2027-03-28' }] };
  const ranked = [{ ...st.weekends[1], points: 6 }, { ...st.weekends[0], points: 3 }, { ...st.weekends[2], points: 0 }];
  it('takes the leader and the next as the fallback, keeping the shortlist', () => {
    const s = settleWhen(st, ranked);
    expect(s.weekends.map((w) => w.start)).toEqual(['2027-03-19', '2027-03-12']);
    expect(s.weekends[0].points).toBeUndefined();
    expect(s.weekendPool).toHaveLength(3);
    expect(s.weekendsSettled).toBe(true);
  });
  it('or the one the organiser picks', () => {
    expect(settleWhen(st, ranked, { start: '2027-03-26' }).weekends.map((w) => w.start)).toEqual(['2027-03-26', '2027-03-19']);
  });
  it('resizes to the voted length and never touches the area', () => {
    const s = settleWhen({ ...st, region: null }, ranked, { nights: 3, resize: (w, n) => ({ ...w, nights: n }) });
    expect(s.nights).toBe(3);
    expect(s.weekends[0].nights).toBe(3);
    expect('region' in s).toBe(false);
  });
});
