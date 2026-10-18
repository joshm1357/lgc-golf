import { describe, it, expect } from 'vitest';
import { tripStage, sortTrips, stillToDecide, closesLabel, canDecide, suggestionOptions, defaultCloses } from './trips.js';

const T = '2026-10-18'; // a Sunday

describe('tripStage', () => {
  it('idea, deciding, locked, on, done, called off', () => {
    expect(tripStage({ status: 'planning', proposed: true }, null, T)).toBe('idea');
    expect(tripStage({ status: 'planning', proposed: false }, null, T)).toBe('deciding');
    expect(tripStage({ status: 'confirmed', start_date: '2026-11-01' }, null, T)).toBe('locked');
    expect(tripStage({ status: 'confirmed', start_date: '2026-10-17', end_date: '2026-10-19' }, null, T)).toBe('on');
    expect(tripStage({ status: 'confirmed', start_date: '2026-10-01', end_date: '2026-10-03' }, null, T)).toBe('done');
    expect(tripStage({ status: 'done' }, null, T)).toBe('done');
    expect(tripStage({ status: 'cancelled', proposed: true }, null, T)).toBe('cancelled');
  });
  it('the current trip with no dates (old data) counts as on', () => {
    expect(tripStage({ status: 'confirmed', start_date: null }, { status: 'active' }, T)).toBe('on');
  });
  it('a planning trip whose dates have passed drops into the past', () => {
    expect(tripStage({ status: 'planning', start_date: '2026-09-01' }, null, T)).toBe('done');
  });
});

describe('sortTrips', () => {
  const plans = [
    { id: 'a', status: 'confirmed', start_date: '2027-03-12', end_date: '2027-03-15' },
    { id: 'b', status: 'confirmed', start_date: '2026-11-20' },
    { id: 'c', status: 'planning', proposed: true, created_at: '2026-10-01' },
    { id: 'd', status: 'planning', proposed: false, created_at: '2026-10-05' },
    { id: 'e', status: 'done', start_date: '2026-03-01', end_date: '2026-03-03' },
    { id: 'f', status: 'cancelled', created_at: '2026-05-01' },
    { id: 'g', status: 'done', start_date: '2025-10-01' },
  ];
  it('next locked-in trip is "now", the rest follow; ideas newest first; past newest first', () => {
    const s = sortTrips(plans, [], T);
    expect(s.now.plan.id).toBe('b');
    expect(s.later.map((x) => x.plan.id)).toEqual(['a']);
    expect(s.ideas.map((x) => x.plan.id)).toEqual(['d', 'c']);
    expect(s.past.map((x) => x.plan.id)).toEqual(['f', 'e', 'g']);
  });
  it('a trip that is on beats the next one', () => {
    const s = sortTrips([...plans, { id: 'on', status: 'confirmed', start_date: '2026-10-17', end_date: '2026-10-19' }], [], T);
    expect(s.now.plan.id).toBe('on');
    expect(s.later.map((x) => x.plan.id)).toEqual(['b', 'a']);
  });
  it('nothing locked in → no big card', () => {
    expect(sortTrips([plans[2]], [], T).now).toBeNull();
  });
});

describe('stillToDecide', () => {
  const plan = { id: 'p' };
  it('counts options on open votes and says when they close', () => {
    const polls = [{ id: 'v1', plan_id: 'p', kind: 'dates', status: 'open', closes_on: '2026-10-23' }, { id: 'v2', plan_id: 'p', kind: 'location', status: 'open' }];
    const options = [{ poll_id: 'v1' }, { poll_id: 'v1' }, { poll_id: 'v1' }, { poll_id: 'v2' }];
    expect(stillToDecide(plan, polls, options, T)).toEqual(['Dates: 3 options, closes Fri', 'Place: 1 option']);
  });
  it('says what is still to sort when there is no vote', () => {
    expect(stillToDecide({ id: 'p', start_date: '2027-01-01' }, [], [], T)).toEqual(['Place to sort']);
    expect(stillToDecide({ id: 'p', start_date: '2027-01-01', location_name: 'Mudgee' }, [], [], T)).toEqual([]);
  });
});

describe('closesLabel', () => {
  it('reads naturally', () => {
    expect(closesLabel('2026-10-18', T)).toBe('closes today');
    expect(closesLabel('2026-10-19', T)).toBe('closes tomorrow');
    expect(closesLabel('2026-10-21', T)).toBe('closes Wed');
    expect(closesLabel('2026-10-17', T)).toBe('closed');
  });
});

describe('canDecide', () => {
  const plan = { organiser_id: 'me' };
  it('admin always; organiser only when the group allows it', () => {
    expect(canDecide({ isAdmin: true, me: 'x', plan, voteDecider: 'admin' })).toBe(true);
    expect(canDecide({ isAdmin: false, me: 'me', plan, voteDecider: 'admin' })).toBe(false);
    expect(canDecide({ isAdmin: false, me: 'me', plan, voteDecider: 'admin_or_organiser' })).toBe(true);
    expect(canDecide({ isAdmin: false, me: 'other', plan, voteDecider: 'admin_or_organiser' })).toBe(false);
  });
});

describe('suggestionOptions', () => {
  it('drops blanks and duplicates, fixes back-to-front dates, adds rough timing', () => {
    const r = suggestionOptions({
      dates: [{ start_date: '2027-03-12', end_date: '2027-03-10' }, {}, { start_date: '2027-03-19', end_date: '2027-03-21' }],
      rough: ' Sometime in April ',
      places: [{ label: 'Mudgee', cost_pp: '$450' }, { label: ' mudgee ' }, { label: '' }, { label: 'Orange' }],
    });
    expect(r.dates).toEqual([
      { start_date: '2027-03-12', end_date: '2027-03-12' },
      { start_date: '2027-03-19', end_date: '2027-03-21' },
      { label: 'Sometime in April' },
    ]);
    expect(r.places).toEqual([{ label: 'Mudgee', cost_pp: 450 }, { label: 'Orange', cost_pp: null }]);
  });
});

describe('defaultCloses', () => {
  it('ten days out', () => { expect(defaultCloses(T)).toBe('2026-10-28'); });
});
