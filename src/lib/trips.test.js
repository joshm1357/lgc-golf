import { describe, it, expect } from 'vitest';
import { tripStage, sortTrips, stillToDecide, closesLabel, canDecide, suggestionOptions, defaultCloses, lastTripDay, isYearOnly, tripWhen, planIsEmpty, canCallOff } from './trips.js';

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
  it('splits trips being planned from ideas', () => {
    const s = sortTrips(plans, [], T);
    expect(s.planning.map((x) => x.plan.id)).toEqual(['d']);
    expect(s.suggested.map((x) => x.plan.id)).toEqual(['c']);
  });
  it('v8: the live "March" shape (planning, not proposed, no dates, organiser set, no trip) is being planned', () => {
    const march = { id: '17f1ac42', kind: 'trip', name: 'March', status: 'planning', proposed: false, start_date: null, end_date: null,
      location_name: 'Blue mountains', organiser_id: 'p1', trip_id: null, created_at: '2026-10-18' };
    const past = { id: 'sc', status: 'done', start_date: '2026-10-16', end_date: '2026-10-18', trip_id: 't1' };
    const s = sortTrips([march, past], [{ id: 't1', status: 'active', start_date: '2026-10-16', end_date: '2026-10-18' }], '2026-10-23');
    expect(s.planning.map((x) => x.plan.id)).toEqual(['17f1ac42']);
    expect(s.now).toBeNull();
    expect(s.past.map((x) => x.plan.id)).toEqual(['sc']);
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

// 22 Oct: South Coast Trip 2026 (16–18 Oct) still said "On now" on the 22nd because its trip was still 'active'.
describe('a finished trip is done even if its trip in the app is still active', () => {
  const plan = { status: 'confirmed', start_date: '2026-10-16', end_date: '2026-10-18' };
  const trip = { id: 't', status: 'active', start_date: '2026-10-16', end_date: '2026-10-18' };
  it('on during the trip, done the day after the last day', () => {
    expect(tripStage(plan, trip, '2026-10-16')).toBe('on');
    expect(tripStage(plan, trip, '2026-10-18')).toBe('on');
    expect(tripStage(plan, trip, '2026-10-19')).toBe('done');
    expect(tripStage(plan, trip, '2026-10-22')).toBe('done');
  });
  it('uses the later of the plan’s and the trip’s last day; an undated active trip is still on', () => {
    expect(lastTripDay({ end_date: '2026-10-18' }, { end_date: '2026-10-20' })).toBe('2026-10-20');
    expect(tripStage(plan, { ...trip, end_date: '2026-10-23' }, '2026-10-22')).toBe('on');
    expect(tripStage({ status: 'confirmed' }, { status: 'active', start_date: '2026-10-16', end_date: '2026-10-18' }, '2026-10-22')).toBe('done');
    expect(tripStage({ status: 'confirmed' }, { status: 'active' }, '2026-10-22')).toBe('on');
  });
  it('the Trips tab puts it with the past trips, not in the big "on now" card', () => {
    const s = sortTrips([{ id: 'p', trip_id: 't', ...plan }], [trip], '2026-10-22');
    expect(s.now).toBe(null);
    expect(s.past.map((x) => [x.plan.id, x.stage])).toEqual([['p', 'done']]);
  });
});

describe('year-only past trips (brought in from history)', () => {
  it('show the year, not a made-up 1 January', () => {
    const t = { status: 'locked', start_date: '2019-01-01', end_date: '2019-01-01' };
    expect(isYearOnly(t)).toBe(true);
    expect(isYearOnly({ ...t, end_date: null })).toBe(true);
    expect(tripWhen(t)).toBe('2019 (date unknown)');
    expect(isYearOnly({ ...t, status: 'active' })).toBe(false);
    expect(isYearOnly({ ...t, end_date: '2019-01-03' })).toBe(false);
    expect(isYearOnly({ status: 'locked', start_date: '2019-06-01', end_date: '2019-06-01' })).toBe(false);
    expect(tripWhen({ status: 'locked', start_date: '2026-10-16', end_date: '2026-10-18' })).toBe('Fri 16 – Sun 18 Oct 2026');
    expect(tripWhen({}, 'Dates TBC')).toBe('Dates TBC');
  });
});

describe('planIsEmpty (ov21: only an empty plan can be deleted)', () => {
  const plan = { id: 'p', created_by: 'me', trip_id: null };
  const pd = (extra = {}) => ({ plan, rsvps: [], votes: [], items: [], costs: [], payments: [], transfers: [], comments: [], ...extra });
  it('a fresh plan with only its creator’s own "I’m in" is empty', () => {
    expect(planIsEmpty(pd({ rsvps: [{ player_id: 'me', status: 'in' }] }))).toBe(true);
  });
  it('anyone else’s reply, a vote, a job, a cost, a payment, chat or a round makes it not empty', () => {
    expect(planIsEmpty(pd({ rsvps: [{ player_id: 'mate', status: 'maybe' }] }))).toBe(false);
    expect(planIsEmpty(pd({ votes: [{ id: 'v' }] }))).toBe(false);
    expect(planIsEmpty(pd({ items: [{ id: 'i' }] }))).toBe(false);
    expect(planIsEmpty(pd({ costs: [{ id: 'c' }] }))).toBe(false);
    expect(planIsEmpty(pd({ payments: [{ id: 'x' }] }))).toBe(false);
    expect(planIsEmpty(pd({ transfers: [{ id: 'x' }] }))).toBe(false);
    expect(planIsEmpty(pd({ comments: [{ id: 'x' }] }))).toBe(false);
    expect(planIsEmpty({ ...pd(), plan: { ...plan, trip_id: 't' } }, [{ id: 'r', trip_id: 't' }])).toBe(false);
    expect(planIsEmpty({ ...pd(), plan: { ...plan, trip_id: 't' } }, [{ id: 'r', trip_id: 'other' }])).toBe(true);
  });
  it('no plan: never', () => { expect(planIsEmpty(null)).toBe(false); });
});

describe('canCallOff', () => {
  it('organisers, the trip’s organiser, or the suggester of an unapproved idea', () => {
    expect(canCallOff({ isAdmin: true, me: 'x', plan: {} })).toBe(true);
    expect(canCallOff({ isAdmin: false, me: 'o', plan: { organiser_id: 'o' } })).toBe(true);
    expect(canCallOff({ isAdmin: false, me: 's', plan: { proposed: true, created_by: 's' } })).toBe(true);
    expect(canCallOff({ isAdmin: false, me: 's', plan: { proposed: false, created_by: 's' } })).toBe(false);
    expect(canCallOff({ isAdmin: false, me: 'z', plan: { organiser_id: 'o' } })).toBe(false);
    expect(canCallOff({ isAdmin: false, me: null, plan: { organiser_id: null } })).toBe(false);
  });
});
