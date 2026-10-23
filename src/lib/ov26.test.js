// Josh's walkthrough fixes (ov26, 23 Oct 2026): the votes and the organiser's planning flow. One file for the small
// pure pieces spread over the libs: V2 (weekends next to "How long?"), V3 (the ballot), V4 (the detail), I3 (last-day
// nudge), O1 (one step line), O3 (golf days, one form), O4 (the best way to do it), O7 (jobs follow the dates).
import { describe, it, expect } from 'vitest';
import { weekendBallotOptions, lengthCheck } from './weekends.js';
import { detailVerdict, votersOf, namesList, lastDayNudge, ballotHeader, hasAnsweredAll } from './callvote.js';
import { upToLine } from './tripsteps.js';
import { golfDates, datesByWeekend, formChanges, formFrom } from './teegrid.js';
import { pickSummary, costLine } from './tripbuilder.js';
import { redateJobs, dueWords } from './tripjobs.js';
import { organiseSteps } from './organisesteps.js';
import { nextStep } from './tripjobs.js';
import { PLACE_ANSWERS, ANSWERS, answersFor } from './emailvotes.js';

describe('V2: weekends on a ballot with "How long?"', () => {
  const shortlist = [{ start: '2027-01-22', end: '2027-01-24' }, { start: '2027-02-12', end: '2027-02-14' }];
  it('each weekend at the shortest length, with what the longer one adds', () => {
    const o = weekendBallotOptions(shortlist, { on: true, options: [2, 3] }, 'mon');
    expect(o[0]).toEqual({ key: 'weekend:2027-01-22', label: 'Fri 22 – Sun 24 Jan', start_date: '2027-01-22', end_date: '2027-01-24', notes: 'Plus Mon 25 if we go 3 nights' });
    const thu = weekendBallotOptions(shortlist, { on: true, options: [2, 3] }, 'thu');
    expect(thu[0].notes).toBe('Plus Thu 21 if we go 3 nights');
    const three = weekendBallotOptions(shortlist, { on: true, options: [1, 2, 3] }, 'mon');
    expect(three[0]).toMatchObject({ label: 'Sat 23 – Sun 24 Jan', notes: 'Plus Fri 22 if we go 2 nights; plus Fri 22 and Mon 25 if we go 3 nights' });
  });
  it('no length vote: the weekends as they are', () => {
    expect(weekendBallotOptions(shortlist, { on: false, options: [2, 3] })[0]).toMatchObject({ label: 'Fri 22 – Sun 24 Jan', notes: null });
  });
  it('after the vote: who only said yes to the shorter trip', () => {
    const polls = [{ id: 'len' }, { id: 'wk' }];
    const options = [{ id: 'n2', poll_id: 'len' }, { id: 'n3', poll_id: 'len' }, { id: 'w1', poll_id: 'wk' }];
    const optionKeys = { n2: 'nights:2', n3: 'nights:3', w1: 'weekend:2027-01-22' };
    const votes = [
      { poll_id: 'wk', option_id: 'w1', player_id: 'al', response: 'yes' }, { poll_id: 'len', option_id: 'n3', player_id: 'al', response: 'yes' },
      { poll_id: 'wk', option_id: 'w1', player_id: 'bo', response: 'yes' }, { poll_id: 'len', option_id: 'n2', player_id: 'bo', response: 'yes' }, { poll_id: 'len', option_id: 'n3', player_id: 'bo', response: 'no' },
      { poll_id: 'wk', option_id: 'w1', player_id: 'cy', response: 'maybe' }, // didn't answer "How long?" — not flagged
    ];
    const r = lengthCheck({ polls, options, votes, optionKeys, nights: 3, primary: { start: '2027-01-22', end: '2027-01-25' }, primaryKey: 'weekend:2027-01-22' });
    expect(r.check).toEqual(['bo']);
    expect(r.line).toBe('3 nights won, so it’s Fri 22 – Mon 25 Jan. 1 person only said yes to a shorter trip — check with them.');
    expect(lengthCheck({ polls: [{ id: 'wk' }], options: [options[2]], votes, optionKeys, nights: 3 })).toBeNull();
  });
});

describe('V3: one set of words, "Are you in?" first, the header line', () => {
  it('Yes / Maybe / No for dates; Keen / Happy with it / Not keen for places and extras', () => {
    expect(ANSWERS).toEqual({ yes: '✓ Yes', maybe: '? Maybe', no: '✗ No' });
    expect(PLACE_ANSWERS).toEqual({ yes: '⭐ Keen', maybe: '👍 Happy with it', no: '👎 Not keen' });
    expect(answersFor({ question: 'Would you do these?' })).toEqual(PLACE_ANSWERS);
  });
  it('the header: one area, several, and how many are in', () => {
    expect(ballotHeader({ areas: [{ area: 'South Coast NSW', costEach: 450, drive: '2 h' }], ins: 9 })).toBe('South Coast NSW · about $450 each · 2 h drive · 9 in so far');
    expect(ballotHeader({ areas: [{ area: 'Hunter Valley', costEach: 400 }, { area: 'South Coast NSW', costEach: 450 }], ins: 2 })).toBe('Hunter Valley or South Coast NSW · about $400–450 each · 2 in so far');
    expect(ballotHeader({ ins: 0 })).toBe('0 in so far');
  });
});

describe('V4: the detail says when it’s not enough to go by', () => {
  it('under a third → "for info", you choose', () => {
    expect(detailVerdict(1, 10)).toEqual({ enough: false, forInfo: true, line: 'Only 1 of 10 picked courses and places — not enough to go by. You choose.' });
    expect(detailVerdict(0, 6).forInfo).toBe(true);
    expect(detailVerdict(4, 10)).toEqual({ enough: true, forInfo: false, line: '4 of 10 went into the detail' });
    expect(detailVerdict(0, 0).line).toBe('Nobody’s voted yet.');
  });
  it('voters: anyone who answered a main question', () => {
    expect(votersOf([{ id: 'a' }, { id: 'w' }], [{ poll_id: 'a', player_id: 'x' }, { poll_id: 'w', player_id: 'x' }, { poll_id: 'w', player_id: 'y' }, { poll_id: 'd', player_id: 'z' }])).toBe(2);
  });
});

describe('I3: the last day of a vote', () => {
  it('"Waiting on Lou, Mo and Pete" with a cheeky message — only on the last day (or the day before)', () => {
    const n = lastDayNudge({ closes: '2026-10-23', today: '2026-10-23', waiting: ['Lou', 'Mo', 'Pete'], planName: 'L.G.C', title: 'Where and when?', link: 'https://x' });
    expect(n.line).toBe('Waiting on Lou, Mo and Pete');
    expect(n.message).toBe('🗳️ L.G.C: “Where and when” closes today and we’re still waiting on Lou, Mo and Pete. Ten seconds, lads — or you get what you’re given 😂\nhttps://x');
    expect(lastDayNudge({ closes: '2026-10-24', today: '2026-10-23', waiting: ['Lou'] }).message).toMatch(/closes tomorrow/);
    expect(lastDayNudge({ closes: '2026-10-26', today: '2026-10-23', waiting: ['Lou'] })).toBeNull();
    expect(lastDayNudge({ closes: '2026-10-23', today: '2026-10-23', waiting: [] })).toBeNull();
    expect(namesList(['A', 'B'])).toBe('A and B');
  });
});

describe('O5: a late joiner never sees "You’ve voted ✓"', () => {
  it('a card with only optional questions left open: not answered until they answer one', () => {
    const polls = [{ id: 'd1', optional: true }];
    expect(hasAnsweredAll({ polls, votes: [], me: 'late' })).toBe(false);
    expect(hasAnsweredAll({ polls, votes: [{ poll_id: 'd1', player_id: 'late' }], me: 'late' })).toBe(true);
  });
});

describe('O1: one "where we’re up to" line', () => {
  it('the same words for Organise, the builder and the card', () => {
    expect(upToLine('lockin')).toBe('Up to step 4 of 6: Pick & lock in');
    expect(upToLine('calls')).toBe('Up to step 3 of 6: Call the courses'); // a builder key
    expect(upToLine(null)).toBe('All 6 steps done');
  });
  it('a locked-in trip with an open vote that isn’t about where and when doesn’t point back at step 1', () => {
    const plan = { id: 'p', kind: 'trip', name: 'T', status: 'confirmed', start_date: '2099-03-12', end_date: '2099-03-14', created_by: 'o' };
    const polls = [{ id: 'x', kind: 'other', question: 'Shirt colour?', status: 'open' }];
    const options = [{ id: 'o1', poll_id: 'x', label: 'Pink' }];
    const ctx = { plan, stage: 'locked', items: [], polls, options, votes: [], rsvps: [], transfers: [], playerIds: ['o', 'a'], me: 'o', isOrganiser: true };
    const next = nextStep(ctx);
    const r = organiseSteps({ ...ctx, next });
    expect(r.current).not.toBe('area');
  });
});

describe('O3: call only about the golf days, one form per course', () => {
  const lines = [{ index: 1, dates: ['2027-01-23', '2027-02-13'] }, { index: 2, dates: ['2027-01-24', '2027-02-14'] }];
  const weekends = [{ start: '2027-01-22', end: '2027-01-25' }, { start: '2027-02-12', end: '2027-02-15' }];
  it('golf dates: the days the course is an option on — no Friday or Monday travel days', () => {
    expect(golfDates(lines)).toEqual(['2027-01-23', '2027-01-24', '2027-02-13', '2027-02-14']);
    expect(datesByWeekend(golfDates(lines), weekends).map((g) => [g.label, g.dates.length])).toEqual([['Fri 22 Jan – Mon 25 Jan', 2], ['Fri 12 Feb – Mon 15 Feb', 2]]);
  });
  it('one Save: only the days that changed; a yes needs times', () => {
    const rows = [{ play_date: '2027-01-23', available: 'no', ranges: [], capacity: null, price: null, notes: null }];
    const form = formFrom(rows, ['2027-01-23', '2027-01-24']);
    expect(form['2027-01-23'].available).toBe('no');
    form['2027-01-24'] = { available: 'yes', ranges: '7:30-8', capacity: '', price: '$85', notes: '' };
    const r = formChanges(form, rows, { planId: 'p', courseId: 'c', jobId: 'j', me: 'm' });
    expect(r.problem).toBe('');
    expect(r.upserts).toEqual([{ plan_id: 'p', play_date: '2027-01-24', course_id: 'c', job_id: 'j', entered_by: 'm', available: 'yes', ranges: ['07:30-08:00'], capacity: null, price: 85, notes: null, times: [] }]);
    expect(formChanges({ '2027-01-24': { available: 'yes', ranges: '' } }, [], {}).problem).toBe('Sun 24 Jan: put in the times they offered, e.g. 7:30–9:00');
  });
});

describe('O4: the best way to do it, as one card', () => {
  const cfg = (start, extra = {}) => ({ key: start, weekend: { start, end: start }, stay: { name: 'Pokolbin' }, gaps: 0, totalDrive: 14,
    rounds: [{ index: 0, date: start, course_id: 'c1', name: 'Cypress Lakes', block: { text: '8:10–8:30' } }], ...extra });
  it('courses, tee times, a rough cost each, and whether the backup works too', () => {
    const s = pickSummary([cfg('2027-01-23'), cfg('2027-01-23', { key: 'b' }), cfg('2027-02-13')], {
      tees: [{ play_date: '2027-01-23', course_id: 'c1', price: 85 }], accom: [{ total_cost: 2000 }, { total_cost: 3000 }], people: 10,
    });
    expect(s.rounds).toEqual([{ date: '2027-01-23', day: 'Sat 23 Jan', name: 'Cypress Lakes', time: '8:10–8:30', price: 85 }]);
    expect([s.golfEach, s.stayEach, s.costEach, s.drive]).toEqual([85, 200, 285, 14]);
    expect(costLine(s)).toBe('about $285 each (golf $85 + stay $200)');
    expect(s.alsoWorks).toEqual({ start: '2027-02-13', end: '2027-02-13' });
    expect(s.others).toHaveLength(2);
    expect(pickSummary([])).toBeNull();
    expect(costLine(pickSummary([cfg('2027-01-23')]))).toBeNull();
  });
});

describe('O7: the usual jobs follow the trip’s dates', () => {
  const job = (formula_key, due, extra = {}) => ({ id: formula_key, kind: 'job', formula_key, due, stage: 'todo', done: false, ...extra });
  it('jobs due after the trip are counted back again', () => {
    const plan = { id: 'p', kind: 'trip', start_date: '2026-10-30' };
    const items = [job('reserve_stay', '2026-12-04'), job('pay_balance', '2027-01-08'), job('transport', '2026-10-16'), job('teams_draw', '2026-10-29', { stage: 'done', done: true }), { id: 'own', kind: 'job', title: 'Mine', due: '2027-01-01' }];
    expect(redateJobs(plan, items, { today: '2026-10-23' })).toEqual([{ id: 'reserve_stay', due: '2026-10-23' }, { id: 'pay_balance', due: '2026-10-23' }]);
  });
  it('a date change moves them by the same number of days (never into the past, never after the start)', () => {
    const plan = { id: 'p', kind: 'trip', start_date: '2027-03-19' };
    const items = [job('reserve_stay', '2027-01-25'), job('transport', '2027-03-11'), job('chase_deposits', '2027-03-25')];
    expect(redateJobs(plan, items, { oldStart: '2027-03-12', today: '2026-10-23' })).toEqual([{ id: 'reserve_stay', due: '2027-02-01' }, { id: 'transport', due: '2027-03-18' }, { id: 'chase_deposits', due: '2027-03-19' }]);
    expect(redateJobs({ ...plan, start_date: '2026-11-01' }, items, { oldStart: '2027-03-12', today: '2026-10-23' }).map((m) => m.due)).toEqual(['2026-10-23', '2026-10-31', '2026-11-01']);
    expect(redateJobs({ ...plan, kind: 'round' }, items)).toEqual([]);
  });
  it('due dates in words: "Fri 30 Oct"', () => {
    expect(dueWords('2026-10-30')).toBe('Fri 30 Oct');
    expect(dueWords(null)).toBe('');
  });
});
