import { describe, it, expect } from 'vitest';
import {
  parseWhen, buildOptions, optionLabel, clock, cleanTime, makeOption, tidyOptions, defaultCloses, sydneyToUtc, spotList,
  rsvpSpots, optionTally, suggestOption, lockPreview, promotedBy, myStanding, spotsWords, askedIds, calloutIntent,
  extrasOn, cleanExtras, defaultName, partOfTime, dayLabel, MAX_OPTIONS, REPEAT_LATER, closesWords,
} from './callout.js';

const FRI = '2026-10-23'; // a Friday
const labels = (r) => r.options.map((o) => o.label);

describe('words and times', () => {
  it('labels an option the human way', () => {
    expect(dayLabel('2026-10-30')).toBe('Fri 30 Oct');
    expect(optionLabel({ date: '2026-10-30', part: 'arvo' })).toBe('Fri 30 Oct · arvo');
    expect(optionLabel({ date: '2026-10-30', part: 'arvo', tee_time: '13:20' })).toBe('Fri 30 Oct · 1:20pm');
    expect(optionLabel({ date: '2026-10-30' })).toBe('Fri 30 Oct');
  });
  it('reads clock times', () => {
    expect(clock('13:20')).toBe('1:20pm');
    expect(clock('07:00')).toBe('7am');
    expect(clock('12:05')).toBe('12:05pm');
    expect(clock('00:30')).toBe('12:30am');
    expect(cleanTime('1:20pm')).toBe('13:20');
    expect(cleanTime('7.30')).toBe('07:30');
    expect(cleanTime('7am')).toBe('07:00');
    expect(cleanTime('2')).toBe('14:00');
    expect(cleanTime('12pm')).toBe('12:00');
    expect(cleanTime('12am')).toBe('00:00');
    expect(cleanTime('25:00')).toBeNull();
    expect(cleanTime('13pm')).toBeNull();
    expect(cleanTime('soon')).toBeNull();
  });
  it('knows the part of the day for a tee time', () => {
    expect(partOfTime('07:30')).toBe('morning');
    expect(partOfTime('11:40')).toBe('midday');
    expect(partOfTime('13:20')).toBe('arvo');
    expect(partOfTime('16:10')).toBe('twilight');
    expect(makeOption('2026-10-30', null, '1:20pm')).toEqual({ date: '2026-10-30', part: 'arvo', tee_time: '13:20', label: 'Fri 30 Oct · 1:20pm' });
  });
});

describe('the quick builder', () => {
  it('Fri arvo, next 2 weeks → the next two Fridays', () => {
    expect(labels(buildOptions({ days: ['fri'], part: 'arvo', range: 'next14' }, FRI))).toEqual(['Fri 30 Oct · arvo', 'Fri 6 Nov · arvo']);
  });
  it('Thu + Fri arvo, next 2 weeks, in date order', () => {
    expect(labels(buildOptions({ days: ['thu', 'fri'], part: 'arvo', range: 'next14' }, FRI)))
      .toEqual(['Thu 29 Oct · arvo', 'Fri 30 Oct · arvo', 'Thu 5 Nov · arvo', 'Fri 6 Nov · arvo']);
  });
  it('next 7 days never includes today; week after is the 8th–14th day', () => {
    expect(labels(buildOptions({ days: ['fri', 'sat'], part: 'morning', range: 'next7' }, FRI))).toEqual(['Sat 24 Oct · morning', 'Fri 30 Oct · morning']);
    expect(labels(buildOptions({ days: ['sat'], part: 'morning', range: 'week2' }, FRI))).toEqual(['Sat 31 Oct · morning']);
  });
  it('an exact time instead of a part', () => {
    expect(labels(buildOptions({ days: ['sat'], time: '7:30', range: 'next14' }, FRI))).toEqual(['Sat 24 Oct · 7:30am', 'Sat 31 Oct · 7:30am']);
  });
  it('caps at 8 and says how many were cut', () => {
    const r = buildOptions({ days: ['thu', 'fri', 'sat', 'sun'], part: 'arvo', range: 'next28' }, FRI);
    expect(r.options).toHaveLength(MAX_OPTIONS);
    expect(r.cut).toBe(8);
  });
  it('no days → nothing', () => {
    expect(buildOptions({ days: [], part: 'arvo' }, FRI).options).toEqual([]);
  });
});

describe('the type-it box', () => {
  it('"this fri arvo" on a Friday is today', () => {
    expect(labels(parseWhen('this fri arvo', FRI))).toEqual(['Fri 23 Oct · arvo']);
  });
  it('"next thu" is Thursday next week', () => {
    expect(labels(parseWhen('next thu', FRI))).toEqual(['Thu 29 Oct']);
    expect(labels(parseWhen('next thursday', '2026-10-19'))).toEqual(['Thu 29 Oct']); // from a Monday too
  });
  it('"this thu" when Thursday has gone → the coming one', () => {
    expect(labels(parseWhen('this thu arvo', FRI))).toEqual(['Thu 29 Oct · arvo']);
  });
  it('a bare day is the coming one', () => {
    expect(labels(parseWhen('sat 7:30', FRI))).toEqual(['Sat 24 Oct · 7:30am']);
    expect(labels(parseWhen('wed twilight', FRI))).toEqual(['Wed 28 Oct · twilight']);
  });
  it('"any fri arvo in nov" → every Friday in November', () => {
    expect(labels(parseWhen('any fri arvo in nov', FRI))).toEqual(['Fri 6 Nov · arvo', 'Fri 13 Nov · arvo', 'Fri 20 Nov · arvo', 'Fri 27 Nov · arvo']);
  });
  it('"sat or sun morning" → both mornings', () => {
    expect(labels(parseWhen('sat or sun morning', FRI))).toEqual(['Sat 24 Oct · morning', 'Sun 25 Oct · morning']);
    expect(labels(parseWhen('sat morning or sun', FRI))).toEqual(['Sat 24 Oct · morning', 'Sun 25 Oct · morning']);
    expect(labels(parseWhen('morning, sat or sun', FRI))).toEqual(['Sat 24 Oct · morning', 'Sun 25 Oct · morning']);
  });
  it('each day keeps its own part', () => {
    expect(labels(parseWhen('fri arvo or sat morning', FRI))).toEqual(['Fri 23 Oct · arvo', 'Sat 24 Oct · morning']);
  });
  it('"fri arvo next 2 weeks"', () => {
    expect(labels(parseWhen('fri arvo next 2 weeks', FRI))).toEqual(['Fri 30 Oct · arvo', 'Fri 6 Nov · arvo']);
    expect(labels(parseWhen('fri arvo for the next two weeks', FRI))).toEqual(['Fri 30 Oct · arvo', 'Fri 6 Nov · arvo']);
    expect(labels(parseWhen('thu or fri arvo over the next fortnight', FRI))).toEqual(['Thu 29 Oct · arvo', 'Fri 30 Oct · arvo', 'Thu 5 Nov · arvo', 'Fri 6 Nov · arvo']);
  });
  it('"next 3 fridays twilight"', () => {
    expect(labels(parseWhen('next 3 fridays twilight', FRI))).toEqual(['Fri 30 Oct · twilight', 'Fri 6 Nov · twilight', 'Fri 13 Nov · twilight']);
  });
  it('"fri next week" and "next week thu or fri"', () => {
    expect(labels(parseWhen('fri next week', FRI))).toEqual(['Fri 30 Oct']);
    expect(labels(parseWhen('next week thu or fri arvo', FRI))).toEqual(['Thu 29 Oct · arvo', 'Fri 30 Oct · arvo']);
  });
  it('tomorrow, today, tonight', () => {
    expect(labels(parseWhen('tomorrow 7:30', FRI))).toEqual(['Sat 24 Oct · 7:30am']);
    expect(labels(parseWhen('tmrw arvo', FRI))).toEqual(['Sat 24 Oct · arvo']);
    expect(labels(parseWhen('today at 2', FRI))).toEqual(['Fri 23 Oct · 2pm']);
    expect(labels(parseWhen('tonight', FRI))).toEqual(['Fri 23 Oct · twilight']);
  });
  it('dates written out', () => {
    expect(labels(parseWhen('sat 31 oct 1:20pm', FRI))).toEqual(['Sat 31 Oct · 1:20pm']);
    expect(labels(parseWhen('oct 31 morning', FRI))).toEqual(['Sat 31 Oct · morning']);
    expect(labels(parseWhen('7/11 arvo', FRI))).toEqual(['Sat 7 Nov · arvo']);
    expect(labels(parseWhen('1st jan', FRI))).toEqual(['Fri 1 Jan']);
  });
  it('a date already gone this year is next year', () => {
    expect(parseWhen('3 feb', FRI).options[0].date).toBe('2027-02-03');
  });
  it('this weekend / next weekend', () => {
    expect(labels(parseWhen('this weekend morning', FRI))).toEqual(['Sat 24 Oct · morning', 'Sun 25 Oct · morning']);
    expect(labels(parseWhen('next weekend', FRI))).toEqual(['Sat 31 Oct', 'Sun 1 Nov']);
  });
  it('"every sat 7:30" puts out the next four and says repeating is coming', () => {
    const r = parseWhen('every sat 7:30', FRI);
    expect(labels(r)).toEqual(['Sat 24 Oct · 7:30am', 'Sat 31 Oct · 7:30am', 'Sat 7 Nov · 7:30am', 'Sat 14 Nov · 7:30am']);
    expect(r.repeat).toBe(true);
    expect(r.hint).toBe(REPEAT_LATER);
  });
  it('more than 8 → the first 8 and a hint', () => {
    const r = parseWhen('thu fri sat sun arvo next 4 weeks', FRI);
    expect(r.options).toHaveLength(8);
    expect(r.cut).toBeGreaterThan(0);
    expect(r.hint).toMatch(/only the first 8/);
  });
  it('nothing it understands → a hint, no options', () => {
    const r = parseWhen('whenever suits', FRI);
    expect(r.understood).toBe(false);
    expect(r.hint).toMatch(/Add a day/);
    expect(parseWhen('', FRI).hint).toBeNull();
    expect(parseWhen('arvo', FRI).understood).toBe(false);
  });
  it('ignores the chat around it ("anyone up for a hit fri arvo?")', () => {
    expect(labels(parseWhen('anyone up for a hit fri arvo?', FRI))).toEqual(['Fri 23 Oct · arvo']);
    expect(labels(parseWhen('ask the guys for a hit next fri arvo at moore park', FRI))).toEqual(['Fri 30 Oct · arvo']);
  });
  it('"may" the word is not May the month', () => {
    expect(labels(parseWhen('may be sat morning', FRI))).toEqual(['Sat 24 Oct · morning']);
    expect(labels(parseWhen('any sat in may', FRI))[0]).toBe('Sat 1 May');
  });
  it('tidy drops duplicates and past days', () => {
    const r = tidyOptions([makeOption('2026-10-30', 'arvo'), makeOption('2026-10-30', 'arvo'), makeOption('2026-10-20', 'arvo'), makeOption('2026-10-30', 'morning')], FRI);
    expect(labels(r)).toEqual(['Fri 30 Oct · morning', 'Fri 30 Oct · arvo']);
  });
});

describe('when replies close', () => {
  it('Sydney wall time to UTC, both sides of daylight saving', () => {
    expect(sydneyToUtc('2026-10-30', '13:00').toISOString()).toBe('2026-10-30T02:00:00.000Z'); // AEDT +11
    expect(sydneyToUtc('2026-06-12', '13:00').toISOString()).toBe('2026-06-12T03:00:00.000Z'); // AEST +10
  });
  it('24 hours before the earliest option', () => {
    const now = new Date('2026-10-23T00:00:00Z');
    const c = defaultCloses([makeOption('2026-11-06', 'arvo'), makeOption('2026-10-30', 'arvo')], now);
    expect(c.toISOString()).toBe('2026-10-29T02:00:00.000Z');
    expect(closesWords(c)).toBe('Thu 29 Oct, 1pm');
  });
  it('never sooner than an hour away, never after the start', () => {
    const now = new Date('2026-10-23T00:10:00Z'); // 11:10am Sydney
    const c = defaultCloses([makeOption('2026-10-23', 'arvo')], now); // 1pm today
    expect(c.toISOString()).toBe('2026-10-23T01:00:00.000Z'); // 12:10 → rounded down to 12:00
    const late = defaultCloses([makeOption('2026-10-23', null, '11:30')], now);
    expect(late.getTime()).toBeLessThanOrEqual(sydneyToUtc('2026-10-23', '11:30').getTime());
  });
});

describe('spots and the reserve list', () => {
  const r = (player_id, status, at) => ({ player_id, status, first_in_at: at, updated_at: '2026-10-25T00:00:00Z' });
  it('the first N to say in get the spots; the rest are reserves in order', () => {
    const rsvps = [r('e', 'in', '05'), r('a', 'in', '01'), r('c', 'in', '03'), r('b', 'in', '02'), r('d', 'in', '04'), r('m', 'maybe', null), r('o', 'out', null)];
    const s = rsvpSpots({ cap: 4, rsvps });
    expect(s.in).toEqual(['a', 'b', 'c', 'd']);
    expect(s.reserve).toEqual(['e']);
    expect(s.maybe).toEqual(['m']);
    expect(s.out).toEqual(['o']);
    expect(rsvpSpots({ cap: null, rsvps }).in).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('a pull-out moves the first reserve up', () => {
    const rsvps = [r('a', 'in', '01'), r('b', 'in', '02'), r('c', 'in', '03'), r('d', 'in', '04'), r('e', 'in', '05'), r('f', 'in', '06')];
    expect(promotedBy({ cap: 4, rsvps }, 'b')).toBe('e');
    expect(promotedBy({ cap: 4, rsvps }, 'f')).toBeNull(); // a reserve pulling out moves nobody up
    expect(promotedBy({ cap: null, rsvps }, 'a')).toBeNull();
  });
  it('where I stand', () => {
    const rsvps = [r('a', 'in', '01'), r('b', 'in', '02'), r('c', 'in', '03'), r('m', 'maybe', null)];
    expect(myStanding({ cap: 2, rsvps }, 'a')).toEqual({ status: 'in' });
    expect(myStanding({ cap: 2, rsvps }, 'c')).toEqual({ status: 'reserve', place: 1 });
    expect(myStanding({ cap: 2, rsvps }, 'm')).toEqual({ status: 'maybe' });
    expect(myStanding({ cap: 2, rsvps }, 'z')).toEqual({ status: null });
  });
  it('ties on time go by id, so everyone sees the same order', () => {
    expect(spotList({ cap: 1, entries: [{ player_id: 'b', at: '01' }, { player_id: 'a', at: '01' }] })).toEqual({ in: ['a'], reserve: ['b'] });
  });
  it('spots in words', () => {
    expect(spotsWords(4, 3)).toBe('3 of 4 spots');
    expect(spotsWords(4, 4, 2)).toBe('Full — 2 on reserve');
    expect(spotsWords(null, 5)).toBe('No cap · 5 in');
  });
});

describe('ticking options and locking in', () => {
  const options = [{ id: 'o1', start_date: '2026-10-29' }, { id: 'o2', start_date: '2026-10-30' }, { id: 'o3', start_date: '2026-11-06' }];
  const v = (option_id, player_id, response, at) => ({ option_id, player_id, response, first_yes_at: response === 'yes' ? at : null, updated_at: '2026-10-25' });
  const votes = [
    v('o1', 'a', 'yes', '01'), v('o1', 'b', 'no'),
    v('o2', 'c', 'yes', '03'), v('o2', 'a', 'yes', '05'), v('o2', 'b', 'yes', '02'), v('o2', 'd', 'yes', '04'), v('o2', 'e', 'yes', '06'), v('o2', 'f', 'maybe'),
    v('o3', 'a', 'maybe'), v('o3', 'b', 'yes', '01'),
  ];
  it('tallies each option, ✓ people in the order they ticked', () => {
    const t = optionTally(options, votes);
    expect(t.o2).toMatchObject({ yes: 5, maybe: 1, no: 0, yesIds: ['b', 'c', 'd', 'a', 'e'] });
    expect(t.o1).toMatchObject({ yes: 1, no: 1 });
  });
  it('suggests the most ✓, then ?, then the earliest', () => {
    expect(suggestOption(options, votes).id).toBe('o2');
    expect(suggestOption(options.slice(0, 1).concat(options[2]), [v('o1', 'a', 'yes', '1'), v('o3', 'b', 'yes', '2'), v('o3', 'c', 'maybe')]).id).toBe('o3');
    expect(suggestOption(options, []).id).toBe('o1');
    expect(suggestOption([], [])).toBeNull();
  });
  it('lock preview: cap 4 + a reserve, in tick order', () => {
    expect(lockPreview({ cap: 4, optionId: 'o2', votes })).toEqual({ in: ['b', 'c', 'd', 'a'], reserve: ['e'], maybe: ['f'], out: [] });
  });
  it('lock preview for a fixed time uses the In replies', () => {
    const rsvps = [{ player_id: 'a', status: 'in', first_in_at: '02' }, { player_id: 'b', status: 'in', first_in_at: '01' }];
    expect(lockPreview({ cap: 1, rsvps })).toEqual({ in: ['b'], reserve: ['a'], maybe: [], out: [] });
  });
});

describe('who is asked', () => {
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'g', role: 'guest' }, { id: 'x', approved: false }, { id: 'c' }];
  it('whole group: approved, not guests', () => {
    expect(askedIds({ plan: { invite_all: true }, players })).toEqual(['a', 'b', 'c']);
  });
  it('a list: those ticked, plus whoever put it out', () => {
    expect(askedIds({ plan: { invite_all: false, created_by: 'c' }, players, invites: [{ player_id: 'a' }] }).sort()).toEqual(['a', 'c']);
  });
});

describe('the Caddie', () => {
  it('spots a call-out', () => {
    expect(calloutIntent('ask the guys for a hit fri arvo')).toBe(true);
    expect(calloutIntent('Anyone up for a round Saturday?')).toBe(true);
    expect(calloutIntent('who’s keen for 9 holes thursday')).toBe(true);
    expect(calloutIntent('what is my handicap')).toBe(false);
    expect(calloutIntent('plan a trip to Port Macquarie')).toBe(false);
  });
});

describe('extras', () => {
  it('hidden as standard; only what is switched on (and whose feature is on)', () => {
    expect(extrasOn({ extras: {} })).toEqual([]);
    expect(extrasOn(null)).toEqual([]);
    const on = extrasOn({ extras: { games: true, kitty: true, after: 'Beers at the Bowlo' } }, (f) => f !== 'planner_costs').map((e) => e.key);
    expect(on).toEqual(['games', 'after']);
  });
  it('cleans what gets saved', () => {
    expect(cleanExtras({ games: true, cars: false, after: '  Lunch  ', junk: true, kitty: 'yes' })).toEqual({ games: true, after: 'Lunch' });
  });
});

describe('a name when none is typed', () => {
  it('names it from the options', () => {
    expect(defaultName({ options: [makeOption('2026-10-30', 'arvo'), makeOption('2026-11-06', 'arvo')] })).toBe('Fri arvo hit');
    expect(defaultName({ options: [makeOption('2026-10-30', 'arvo'), makeOption('2026-10-31', 'arvo')], courseName: 'Moore Park' })).toBe('Hit at Moore Park');
    expect(defaultName({ options: [makeOption('2026-10-31', null, '07:30')] })).toBe('Sat hit');
  });
});

describe('v10.7: a part of today that has already gone rolls to next week', () => {
  it('"sat or sun morning" on a Sunday evening → this Saturday and NEXT Sunday', async () => {
    const { parseWhen } = await import('./callout.js');
    const sundayEvening = new Date('2026-10-25T09:00:00Z'); // 8pm Sydney, Sun 25 Oct
    const r = parseWhen('sat or sun morning', '2026-10-25', sundayEvening);
    expect(r.options.map((o) => o.date)).toEqual(['2026-10-31', '2026-11-01']);
  });
  it('"sun arvo" on a Sunday morning still means today', async () => {
    const { parseWhen } = await import('./callout.js');
    const sundayMorning = new Date('2026-10-24T22:00:00Z'); // 9am Sydney, Sun 25 Oct
    expect(parseWhen('sun arvo', '2026-10-25', sundayMorning).options[0].date).toBe('2026-10-25');
  });
  it('without "now" it behaves as before', async () => {
    const { parseWhen } = await import('./callout.js');
    expect(parseWhen('sun morning', '2026-10-25').options[0].date).toBe('2026-10-25');
  });
});
