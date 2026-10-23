import { describe, it, expect } from 'vitest';
import {
  weekendStatus, fallsThrough, showOpenItUp, goWithBackup, deadOptions, coursesWords, goWithPost, addedBackupPost, reopenedPost,
  checkQuestion, resultPost, topTwoYes, callsHeroPost,
} from './tripnews.js';

// Two weekends (8–10 Jan primary, 15–17 Jan backup), golf on the Saturday and Sunday at Nowra GC or Shoalhaven Heads.
const W1 = { start: '2027-01-08', end: '2027-01-10' };
const W2 = { start: '2027-01-15', end: '2027-01-17' };
const days = [{ index: 0, options: [] }, { index: 1, options: ['n', 's'] }, { index: 2, options: ['n', 's'] }];
const yes = (date, course) => ({ play_date: date, course_id: course, available: 'yes', ranges: ['07:30-07:50'] });
const no = (date, course) => ({ play_date: date, course_id: course, available: 'no', ranges: [] });

describe('a weekend falls through (O5)', () => {
  const tees = [no('2027-01-09', 'n'), no('2027-01-09', 's'), yes('2027-01-10', 'n'), no('2027-01-10', 's'),
    yes('2027-01-16', 'n'), yes('2027-01-16', 's'), yes('2027-01-17', 'n'), yes('2027-01-17', 's')];
  const st = weekendStatus({ weekends: [W1, W2], days, tees, needed: 3 });
  it('each weekend works, is out, or is still waiting — golf days only (the Friday has no golf)', () => {
    expect(st.map((x) => [x.role, x.state, x.courses, x.total])).toEqual([['Primary', 'out', 1, 2], ['Backup', 'works', 2, 2]]);
    expect(st[0].days.map((d) => d.date)).toEqual(['2027-01-09', '2027-01-10']);
    expect(weekendStatus({ weekends: [W1], days, tees: [], needed: 3 })[0].state).toBe('waiting');
  });
  it('one banner: the primary is out, the backup works at both courses → go with it', () => {
    const f = fallsThrough(st);
    expect(f.line).toBe('Fri 8 – Sun 10 Jan is out. Fri 15 – Sun 17 Jan works at both courses.');
    expect(f.button).toBe('Go with Fri 15 – Sun 17 Jan');
    expect(fallsThrough([st[1], st[0]])).toBeNull(); // the primary works: nothing to say
  });
  it('"Open it up" only when no weekend works', () => {
    expect(showOpenItUp(st)).toBe(false);
    expect(showOpenItUp([st[0]])).toBe(true);
    expect(showOpenItUp([])).toBe(false);
  });
  it('going with the backup: it becomes the primary, the dead one comes off (and is remembered)', () => {
    expect(goWithBackup({ weekends: [W1, W2] }, W2, W1)).toEqual({ weekends: [W2], dead: ['2027-01-08'] });
  });
  it('dead weekends come off OPEN dates votes — never the last option, never a closed vote', () => {
    const polls = [{ id: 'a', status: 'open', kind: 'dates' }, { id: 'b', status: 'closed', kind: 'dates' }, { id: 'c', status: 'open', kind: 'dates' }];
    const options = [{ id: 'a1', poll_id: 'a', start_date: '2027-01-08' }, { id: 'a2', poll_id: 'a', start_date: '2027-01-15' },
      { id: 'b1', poll_id: 'b', start_date: '2027-01-08' }, { id: 'b2', poll_id: 'b', start_date: '2027-01-15' }, { id: 'c1', poll_id: 'c', start_date: '2027-01-09' }];
    expect(deadOptions(polls, options, [W1])).toEqual(['a1']);
  });
  it('the words', () => {
    expect(coursesWords(2, 2)).toBe('both courses');
    expect(coursesWords(3, 3)).toBe('all 3 courses');
    expect(coursesWords(1, 3)).toBe('1 of 3 courses');
    expect(coursesWords(1, 1, ['Nowra GC'])).toBe('Nowra GC');
    expect(goWithPost({ planName: 'Spring away', out: W1, go: W2, courses: 'both courses' })).toBe('📅 Spring away: Fri 8 – Sun 10 Jan is out — no tee times. We’re going with Fri 15 – Sun 17 Jan, it works at both courses. Still good for you? Answer on the trip.');
    expect(addedBackupPost({ planName: 'Spring away', added: W2, callers: ['Al'] })).toBe('📅 Spring away: no workable tee times yet — asking the courses about Fri 15 – Sun 17 Jan too. Al has the new calls.');
    expect(reopenedPost({ planName: 'Spring away', area: 'Hunter Valley', runnerUp: 'South Coast NSW' })).toMatch(/Hunter Valley didn’t work out.*South Coast NSW came next/);
    expect(checkQuestion(W2)).toBe('Still good for Fri 15 – Sun 17 Jan?');
  });
});

describe('the vote’s result (I4) and the caller’s moment (I5)', () => {
  it('result: "it’s the Hunter, 22–25 Jan. 10 votes to 6"', () => {
    expect(resultPost({ planName: 'L.G.C', area: 'Hunter Valley', weekend: { start: '2027-01-22', end: '2027-01-25' }, votes: [10, 6] }))
      .toBe('🗳️ L.G.C: it’s Hunter Valley, Fri 22 – Mon 25 Jan. 10 votes to 6. Next: ringing the courses for tee times.');
    expect(resultPost({ planName: 'L.G.C', area: 'Hunter Valley', nights: 3, votes: [1, 0], caller: 'Al' })).toBe('🗳️ L.G.C: it’s Hunter Valley. 3 nights. 1 vote to 0. Al’s ringing the courses this week.');
  });
  it('the top two ✓ counts', () => {
    const votes = [{ option_id: 'h', response: 'yes' }, { option_id: 'h', response: 'yes' }, { option_id: 's', response: 'yes' }, { option_id: 's', response: 'maybe' }];
    expect(topTwoYes(['h', 's'], votes, 'h')).toEqual([2, 1]);
    expect(topTwoYes(['h', 's'], votes, 's')).toEqual([1, 2]);
    expect(topTwoYes([], votes)).toBeNull();
  });
  it('calls done: "Al rang 3 courses and got tee times every day ⛳"', () => {
    const good = [{ days: [{ state: 'works' }, { state: 'works' }] }];
    expect(callsHeroPost({ planName: 'L.G.C', callers: ['Al'], courses: 3, statuses: good })).toBe('📞 L.G.C: Al rang 3 courses and got tee times every day ⛳. Thanks Al!');
    expect(callsHeroPost({ planName: 'L.G.C', callers: ['Al', 'Bo'], courses: 2, statuses: [{ days: [{ state: 'works' }, { state: 'out' }] }] })).toBe('📞 L.G.C: Al and Bo rang 2 courses — tee times on 1 of 2 days. Thanks!');
  });
});
