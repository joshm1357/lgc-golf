import { describe, it, expect } from 'vitest';
import { guideTrip, tripDays, dayLabel, roundName, setupSteps, nextAction } from './setupguide.js';

const trip = { id: 't1', name: '6th Ryder Cup', start_date: '2026-10-22', end_date: '2026-10-24', status: 'active' };

describe('guided setup', () => {
  it('picks the newest trip that isn’t locked', () => {
    expect(guideTrip([{ id: 'a', status: 'active' }, { id: 'b', status: 'locked' }]).id).toBe('a');
    expect(guideTrip([{ id: 'b', status: 'locked' }])).toBe(null);
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
    expect(steps.map((s) => s.done)).toEqual([false, false, false, false, false]);
    expect(nextAction(steps, [], '2026-10-21')).toMatchObject({ kind: 'step', key: 'trip' });
  });
  it('a set-up trip: done, and points at the next round', () => {
    const rounds = [
      { id: 'r1', trip_id: 't1', name: 'Friday — Cypress Lakes', play_date: '2026-10-23', status: 'setup', ctp_holes: [], ld_holes: [] },
      { id: 'r2', trip_id: 't1', name: 'Saturday — The Vintage', play_date: '2026-10-24', status: 'setup', ctp_holes: [3], ld_holes: [] },
    ];
    const steps = setupSteps({ trips: [trip], courses: [{ name: 'Cypress Lakes' }], rounds, players: [{ id: 1 }, { id: 2 }] });
    expect(steps.map((s) => s.done)).toEqual([true, true, true, true, true]);
    expect(steps[2].summary).toContain('nothing on Thursday');
    expect(nextAction(steps, rounds, '2026-10-21')).toMatchObject({ kind: 'start', round: { id: 'r1' } });
    expect(nextAction(steps, rounds, '2026-10-23').label).toContain('is today');
  });
  it('a Cup isn’t ready while anyone has no team', () => {
    const players = [{ id: 1, cup_side: 'a' }, { id: 2, cup_side: null }];
    const steps = setupSteps({ trips: [trip], courses: [{}], rounds: [{ trip_id: 't1' }], players }, { cup: true });
    expect(steps[3]).toMatchObject({ done: false, summary: '2 in · 1 not on a team yet' });
  });
  it('unapproved players don’t count', () => {
    const steps = setupSteps({ trips: [trip], courses: [], rounds: [], players: [{ id: 1 }, { id: 2, approved: false }] });
    expect(steps[3].done).toBe(false);
  });
});
