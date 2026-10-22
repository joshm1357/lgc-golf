import { describe, it, expect } from 'vitest';
import { pickActiveTrip, tripSpan, tripDayWords, focusRound, tripPath } from './activetrip.js';

const T = (id, start, end, extra = {}) => ({ id, name: id, start_date: start, end_date: end, status: 'active', created_at: '2026-01-01', ...extra });
const R = (id, trip_id, play_date, status = 'setup') => ({ id, trip_id, play_date, status, created_at: '2026-01-01' });

describe('tripSpan', () => {
  it('uses the trip’s own dates', () => {
    expect(tripSpan(T('a', '2026-12-04', '2026-12-06'))).toEqual({ start: '2026-12-04', end: '2026-12-06' });
  });
  it('falls back to its rounds’ days, and stretches to fit rounds outside its dates', () => {
    expect(tripSpan(T('a', null, null), [R('r1', 'a', '2026-12-05'), R('r2', 'a', '2026-12-04')])).toEqual({ start: '2026-12-04', end: '2026-12-05' });
    expect(tripSpan(T('a', '2026-12-04', null), [R('r1', 'a', '2026-12-05')])).toEqual({ start: '2026-12-04', end: '2026-12-05' });
  });
  it('no dates and no rounds: nothing', () => {
    expect(tripSpan(T('a', null, null), [])).toEqual({ start: null, end: null });
  });
});

describe('pickActiveTrip', () => {
  const today = '2026-12-05';
  it('a trip with a live round wins, even if another is on today', () => {
    const trips = [T('on', '2026-12-04', '2026-12-06'), T('old', '2026-11-01', '2026-11-02')];
    const rounds = [R('x', 'old', '2026-11-02', 'live')];
    expect(pickActiveTrip({ trips, rounds, today })).toEqual({ trip: trips[1], why: 'live' });
  });
  it('then a trip with a round today', () => {
    const trips = [T('a', '2026-12-10', '2026-12-12'), T('b', null, null)];
    const rounds = [R('x', 'b', today)];
    expect(pickActiveTrip({ trips, rounds, today }).trip.id).toBe('b');
    expect(pickActiveTrip({ trips, rounds, today }).why).toBe('today');
  });
  it('then a trip that’s on today (a rest day)', () => {
    const trips = [T('a', '2026-12-04', '2026-12-07'), T('b', '2026-12-20', '2026-12-21')];
    expect(pickActiveTrip({ trips, rounds: [R('x', 'a', '2026-12-04', 'locked')], today })).toEqual({ trip: trips[0], why: 'on' });
  });
  it('then the soonest upcoming', () => {
    const trips = [T('far', '2027-03-01', '2027-03-03'), T('soon', '2026-12-20', '2026-12-21'), T('past', '2026-10-01', '2026-10-02')];
    expect(pickActiveTrip({ trips, rounds: [], today })).toEqual({ trip: trips[1], why: 'upcoming' });
  });
  it('an open trip with no dates counts as upcoming, after dated ones', () => {
    const trips = [T('nodate', null, null), T('past', '2026-10-01', '2026-10-02')];
    expect(pickActiveTrip({ trips, rounds: [], today })).toEqual({ trip: trips[0], why: 'upcoming' });
    const both = [T('nodate', null, null), T('soon', '2026-12-20', null)];
    expect(pickActiveTrip({ trips: both, rounds: [], today }).trip.id).toBe('soon');
  });
  it('then the most recent finished within 7 days', () => {
    const trips = [T('lastwk', '2026-11-27', '2026-11-29', { status: 'locked' }), T('older', '2026-11-20', '2026-11-21', { status: 'locked' })];
    expect(pickActiveTrip({ trips, rounds: [], today })).toEqual({ trip: trips[0], why: 'recent' });
  });
  it('nothing on, nothing coming, nothing recent: null', () => {
    const trips = [T('old', '2026-11-01', '2026-11-03', { status: 'locked' })];
    expect(pickActiveTrip({ trips, rounds: [], today })).toBe(null);
    expect(pickActiveTrip({ trips: [], rounds: [], today })).toBe(null);
  });
  it('skips year-only history trips and called-off trips', () => {
    const trips = [T('y', '2026-01-01', null, { status: 'locked' }), T('c', '2026-12-20', null, { status: 'cancelled' })];
    expect(pickActiveTrip({ trips, rounds: [], today: '2026-01-03' })).toBe(null);
    expect(pickActiveTrip({ trips, rounds: [], today })).toBe(null);
  });
  it('a live round on a trip that isn’t the group’s is ignored', () => {
    expect(pickActiveTrip({ trips: [T('a', '2026-12-20', null)], rounds: [R('x', 'zzz', today, 'live')], today }).why).toBe('upcoming');
  });
});

describe('tripDayWords', () => {
  const trip = T('a', '2026-12-04', '2026-12-06');
  it('during the trip: Day n of m', () => {
    expect(tripDayWords(trip, [], '2026-12-04')).toBe('Day 1 of 3');
    expect(tripDayWords(trip, [], '2026-12-05')).toBe('Day 2 of 3');
    expect(tripDayWords(trip, [], '2026-12-06')).toBe('Day 3 of 3');
  });
  it('a one-day trip: Today', () => {
    expect(tripDayWords(T('a', '2026-12-05', null), [], '2026-12-05')).toBe('Today');
  });
  it('before: tomorrow, days, then weeks', () => {
    expect(tripDayWords(trip, [], '2026-12-03')).toBe('Starts tomorrow');
    expect(tripDayWords(trip, [], '2026-11-24')).toBe('In 10 days');
    expect(tripDayWords(trip, [], '2026-10-21')).toBe('In 6 weeks');
  });
  it('after: yesterday, n days ago', () => {
    expect(tripDayWords(trip, [], '2026-12-07')).toBe('Finished yesterday');
    expect(tripDayWords(trip, [], '2026-12-09')).toBe('Finished 3 days ago');
  });
  it('no dates', () => {
    expect(tripDayWords(T('a', null, null), [], '2026-12-05')).toBe('Dates to come');
  });
});

describe('focusRound', () => {
  const trip = T('a', '2026-12-04', '2026-12-06');
  const fri = R('fri', 'a', '2026-12-04', 'locked');
  const sat = R('sat', 'a', '2026-12-05', 'setup');
  const sun = R('sun', 'a', '2026-12-06', 'setup');
  it('the live round', () => {
    expect(focusRound(trip, [fri, { ...sat, status: 'live' }, sun], '2026-12-05')).toEqual({ round: { ...sat, status: 'live' }, when: 'live' });
  });
  it('today’s round before it goes live', () => {
    expect(focusRound(trip, [fri, sat, sun], '2026-12-05').round.id).toBe('sat');
    expect(focusRound(trip, [fri, sat, sun], '2026-12-05').when).toBe('today');
  });
  it('before the trip: the first round', () => {
    expect(focusRound(trip, [{ ...fri, status: 'setup' }, sat, sun], '2026-11-01')).toEqual({ round: { ...fri, status: 'setup' }, when: 'next' });
  });
  it('after the trip: the last round', () => {
    const done = [fri, { ...sat, status: 'locked' }, { ...sun, status: 'locked' }];
    expect(focusRound(trip, done, '2026-12-09')).toEqual({ round: done[2], when: 'last' });
  });
  it('only this trip’s rounds; none: null', () => {
    expect(focusRound(trip, [R('x', 'b', '2026-12-05', 'live')], '2026-12-05')).toBe(null);
  });
});

describe('tripPath', () => {
  it('the plan’s overview when there is one, else the trip overview', () => {
    expect(tripPath({ id: 't' }, [{ id: 'p', trip_id: 't', status: 'confirmed' }])).toBe('/plan/p?view=overview');
    expect(tripPath({ id: 't' }, [{ id: 'p', trip_id: 't', status: 'cancelled' }])).toBe('/trip/t');
    expect(tripPath(null)).toBe('/plan');
  });
});
