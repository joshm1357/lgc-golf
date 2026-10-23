import { describe, it, expect } from 'vitest';
import { pickActiveTrip, tripSpan, tripDayWords, focusRound, tripPath, tripsMenu, menuLabel, liveTrips, tripNowPath } from './activetrip.js';

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
  it('a trip with a live round today wins, even if another is on today', () => {
    const trips = [T('on', '2026-12-04', '2026-12-06'), T('old', '2026-11-01', '2026-11-02')];
    const rounds = [R('x', 'old', today, 'live')];
    expect(pickActiveTrip({ trips, rounds, today })).toEqual({ trip: trips[1], why: 'live' });
  });
  it('a round left live from an earlier day does not win', () => {
    const trips = [T('on', '2026-12-04', '2026-12-06'), T('old', '2026-11-01', '2026-11-02')];
    const rounds = [R('x', 'old', '2026-11-02', 'live')];
    expect(pickActiveTrip({ trips, rounds, today }).trip.id).toBe('on');
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

describe('tripsMenu (ov21: the sub-items under Trips)', () => {
  const today = '2026-12-05';
  const past = T('South Coast 2026', '2026-10-16', '2026-10-18', { status: 'locked' });
  const older = T('Autumn 2026', '2026-04-10', '2026-04-12', { status: 'locked' });
  it('a trip on right now: On now, plus the last finished one', () => {
    const on = T('March', '2026-12-04', '2026-12-06');
    const m = tripsMenu({ trips: [older, on, past], rounds: [], today });
    expect(m.now).toEqual({ trip: on, on: true });
    expect(m.last).toBe(past);
    expect(m.planIt).toBe(false);
    expect(menuLabel('on', m.now.trip)).toBe('On now: March');
  });
  it('a live round makes it On now even outside its dates', () => {
    const t = T('Ambrose day', '2026-12-20', '2026-12-20');
    expect(tripsMenu({ trips: [t, past], rounds: [R('r', t.id, '2026-12-20', 'live')], today }).now).toEqual({ trip: t, on: true });
  });
  it('nothing on: Next is the soonest still to come', () => {
    const soon = T('March', '2027-03-19', '2027-03-21');
    const far = T('Spring', '2027-09-01', '2027-09-03');
    const m = tripsMenu({ trips: [far, past, soon], rounds: [], today });
    expect(m.now).toEqual({ trip: soon, on: false });
    expect(m.last).toBe(past);
    expect(menuLabel('next', soon)).toBe('Next: March');
    expect(menuLabel('last', past)).toBe('Last: South Coast 2026');
  });
  it('only past trips: no next — Plan a trip — and the last one (never the 7-day "recent" fallback as next)', () => {
    const lastWeek = T('Last week', '2026-11-30', '2026-12-01', { status: 'locked' });
    const m = tripsMenu({ trips: [past, lastWeek], rounds: [], today });
    expect(m.now).toBe(null);
    expect(m.planIt).toBe(true);
    expect(m.last).toBe(lastWeek);
  });
  it('no trips at all: Plan a trip and no last', () => {
    expect(tripsMenu({ trips: [], rounds: [], today })).toEqual({ now: null, next: null, last: null, planIt: true });
  });
  it('a called-off plan’s trip is neither next nor last', () => {
    const off = T('March', '2027-03-19', '2027-03-21');
    const m = tripsMenu({ trips: [off, past], rounds: [], plans: [{ id: 'p', trip_id: off.id, status: 'cancelled' }], today });
    expect(m.now).toBe(null);
    expect(m.planIt).toBe(true);
    expect(m.last).toBe(past);
    expect(liveTrips([off, past], [{ id: 'p', trip_id: off.id, status: 'cancelled' }])).toEqual([past]);
  });
  it('a past trip known only by its rounds still counts as last', () => {
    const t = T('Round only', null, null, { status: 'locked' });
    expect(tripsMenu({ trips: [t], rounds: [R('r', t.id, '2026-11-01', 'locked')], today }).last).toBe(t);
  });
  it('sub-items open the trip’s status page', () => {
    expect(tripNowPath({ id: 'x' })).toBe('/trip-now/x');
    expect(tripNowPath(null)).toBe('/plan');
  });
});

describe('tripDayWords for older trips', () => {
  it('weeks, then month and year', async () => {
    const { tripDayWords } = await import('./activetrip.js');
    expect(tripDayWords({ start_date: '2026-09-01', end_date: '2026-09-03' }, [], '2026-10-01')).toBe('Finished 4 weeks ago');
    expect(tripDayWords({ start_date: '2025-10-16', end_date: '2025-10-18' }, [], '2026-10-23')).toBe('Oct 2025');
  });
});

describe('trips menu: stale live round and next while on', () => {
  it('a round left live from yesterday does not make a finished trip on now', async () => {
    const { tripsMenu } = await import('./activetrip.js');
    const trips = [{ id: 'a', name: 'Test', start_date: '2026-10-22', end_date: '2026-10-22', status: 'active' }, { id: 'b', name: 'Summer', start_date: '2026-12-05', end_date: '2026-12-07', status: 'active' }];
    const rounds = [{ id: 'r1', trip_id: 'a', play_date: '2026-10-22', status: 'live' }];
    const m = tripsMenu({ trips, rounds, today: '2026-10-23' });
    expect(m.now.trip.id).toBe('b'); expect(m.now.on).toBe(false); expect(m.last.id).toBe('a');
  });
  it('while a trip is on, the next one gets its own line', async () => {
    const { tripsMenu } = await import('./activetrip.js');
    const trips = [{ id: 'a', name: 'On', start_date: '2026-10-22', end_date: '2026-10-24', status: 'active' }, { id: 'b', name: 'Summer', start_date: '2026-12-05', end_date: '2026-12-07', status: 'active' }];
    const m = tripsMenu({ trips, rounds: [], today: '2026-10-23' });
    expect(m.now.trip.id).toBe('a'); expect(m.now.on).toBe(true); expect(m.next.id).toBe('b');
  });
});
