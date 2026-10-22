import { describe, it, expect } from 'vitest';
import { guideTrip, upcomingTrips, tripDays, dayLabel, roundName, setupSteps, nextAction } from './setupguide.js';

const trip = { id: 't1', name: '6th Ryder Cup', start_date: '2026-10-22', end_date: '2026-10-24', status: 'active' };

describe('guided setup', () => {
  it('picks the nearest trip that isn’t over, whatever its status; never a past one', () => {
    const trips = [
      { id: 'past', status: 'active', start_date: '2026-04-10', end_date: '2026-04-12' },
      { id: 'planned', status: 'locked', start_date: '2026-11-20', end_date: '2026-11-22' }, // locked in from the planner
      { id: 'soon', status: 'active', start_date: '2026-10-22', end_date: '2026-10-24' },
    ];
    expect(guideTrip(trips, '2026-10-21').id).toBe('soon');
    expect(upcomingTrips(trips, '2026-10-21').map((t) => t.id)).toEqual(['soon', 'planned']);
    expect(guideTrip(trips, '2026-10-23').id).toBe('soon'); // mid-trip still counts
    expect(guideTrip([trips[0]], '2026-10-21')).toBe(null); // only a past trip: make a new one
    expect(guideTrip([{ id: 'nodate', status: 'active' }], '2026-10-21').id).toBe('nodate');
  });
  it('lists the days of a trip and names them', () => {
    expect(tripDays(trip)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24']);
    expect(tripDays({ start_date: '2026-10-22' })).toEqual(['2026-10-22']);
    expect(tripDays({})).toEqual([]);
    expect(dayLabel('2026-10-23')).toBe('Friday 23 Oct');
  });
  it('names a round from the day and a tidied course name', () => {
    expect(roundName('2026-10-23', 'Cypress Lakes Golf & Country Club')).toBe('Friday — Cypress Lakes');
    expect(roundName('2026-10-24', 'The Vintage Golf Club')).toBe('Saturday — The Vintage');
    expect(roundName(null, 'Kurri Kurri Golf Club')).toBe('Kurri Kurri');
  });
  it('an empty group has everything to do, starting with the trip', () => {
    const steps = setupSteps({ trips: [], courses: [], rounds: [], players: [] });
    expect(steps.map((s) => s.done)).toEqual([false, false, false, false, false, false]);
    expect(steps.map((s) => s.key)).toEqual(['trip', 'courses', 'rounds', 'comps', 'players', 'extras']);
    expect(nextAction(steps, [], '2026-10-21')).toMatchObject({ kind: 'step', key: 'trip' });
  });
  it('a set-up trip: done, and points at the next round', () => {
    const rounds = [
      { id: 'r1', trip_id: 't1', name: 'Friday — Cypress Lakes', play_date: '2026-10-23', status: 'setup', ctp_holes: [], ld_holes: [] },
      { id: 'r2', trip_id: 't1', name: 'Saturday — The Vintage', play_date: '2026-10-24', status: 'setup', ctp_holes: [3], ld_holes: [] },
    ];
    const steps = setupSteps({ trips: [trip], courses: [{ name: 'Cypress Lakes' }], rounds, players: [{ id: 1 }, { id: 2 }] }, {}, trip);
    expect(steps.map((s) => s.done)).toEqual([true, true, true, false, true, true]);
    expect(steps[2].summary).toContain('nothing on Thursday');
    expect(nextAction(steps, rounds, '2026-10-21')).toMatchObject({ kind: 'ready', round: { id: 'r1' } });
    expect(nextAction(steps, rounds, '2026-10-21').label).toContain('start it on the day');
    expect(nextAction(steps, rounds, '2026-10-23')).toMatchObject({ kind: 'start', round: { id: 'r1' } });
    expect(nextAction(steps, rounds, '2026-10-23', () => false)).toMatchObject({ kind: 'players', round: { id: 'r1' } });
    // A round with no date doesn't jump ahead of a dated one.
    expect(nextAction(steps, [{ id: 'x', status: 'setup', name: 'X' }, ...rounds], '2026-10-23').round.id).toBe('r1');
  });
  it('a Cup isn’t ready while anyone has no team', () => {
    const players = [{ id: 1, cup_side: 'a' }, { id: 2, cup_side: null }];
    const steps = setupSteps({ trips: [trip], courses: [{}], rounds: [{ trip_id: 't1' }], players }, { cup: true }, trip);
    expect(steps[4]).toMatchObject({ done: false, summary: '2 in · 1 not on a team yet' });
  });
  it('unapproved players don’t count', () => {
    const steps = setupSteps({ trips: [trip], courses: [], rounds: [], players: [{ id: 1 }, { id: 2, approved: false }] }, {}, trip);
    expect(steps[4].done).toBe(false);
  });
  it('what you’re playing for: optional, done once the trip has a comp', () => {
    const comps = [{ trip_id: 't1', name: 'BD Trophy' }, { trip_id: 't1', name: 'Old', retired: true }, { trip_id: 'other', name: 'Elsewhere' }];
    const steps = setupSteps({ trips: [trip], courses: [], rounds: [], players: [], comps }, {}, trip);
    expect(steps[3]).toMatchObject({ key: 'comps', optional: true, done: true, summary: 'BD Trophy' });
    expect(setupSteps({ trips: [trip], courses: [], rounds: [], players: [] }, {}, trip)[3].done).toBe(false);
  });
});
