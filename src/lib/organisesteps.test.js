import { describe, it, expect } from 'vitest';
import { organiseSteps, stepOfNext, stepOfJob, primaryFor, STEP_KEYS, TAB_STEP } from './organisesteps.js';
import * as STEPS_MODULE from './organisesteps.js';
import { nextStep } from './tripjobs.js';
import { tripStage } from './trips.js';

const TODAY = '2027-01-10';
const P1 = 'p1'; const P2 = 'p2'; const P3 = 'p3';
const players = [P1, P2, P3];
const base = { id: 'plan', kind: 'trip', name: 'March', status: 'planning', proposed: false, start_date: null, end_date: null, location_name: 'Hunter Valley', created_by: P1, organiser_id: P1 };

/** The steps an organiser sees, with the Next step worked out the same way the screen does. */
function stepsFor({ plan = base, items = [], polls = [], options = [], votes = [], rsvps = [], transfers = [], costs = [], builder = {}, stays = [], roundsSetUp = 0 } = {}) {
  const stage = tripStage(plan, null, TODAY);
  const b = { weekends: 0, areas: [], cards: [], callJobIds: [], ...builder };
  const next = nextStep({ plan, stage, items, polls, options, votes, rsvps, transfers, playerIds: players, me: P1, isOrganiser: true, today: TODAY, builder: b });
  const r = organiseSteps({ plan, stage, items, polls, options, votes, rsvps, transfers, costs, builder: b, stays, next, roundsSetUp });
  return { ...r, next, stage, state: Object.fromEntries(r.steps.map((s) => [s.key, s.state])), byKey: Object.fromEntries(r.steps.map((s) => [s.key, s])) };
}

const job = (formula_key, extra = {}) => ({ id: formula_key || extra.id, kind: 'job', title: formula_key || extra.title, formula_key, stage: 'todo', done: false, owner_id: P1, ...extra });

describe('organise steps — which step is current', () => {
  it('a brand-new trip (a place, no dates): Areas & weekends, with "Start: plan where and when"', () => {
    const r = stepsFor();
    expect(r.current).toBe('area');
    expect(r.state).toEqual({ area: 'current', courses: 'later', book: 'later', lockin: 'later', money: 'later', day: 'later' });
    expect(r.byKey.area.summary).toBe('Hunter Valley');
    expect(r.byKey.lockin.started).toBe(false); // greyed steps say what they're for until something happens
    const p = primaryFor(r.next, { current: r.current, builderOn: true });
    expect(p.label).toBe('Start: plan where and when');
    expect(p.action).toEqual({ type: 'plan_builder' });
    expect(primaryFor(r.next, { current: r.current, builderOn: true, builderStarted: true }).label).toBe('Carry on: plan where and when');
    expect(primaryFor(r.next, { current: r.current, builderOn: false }).action).toEqual({ type: 'edit' });
  });

  it('an idea: Areas & weekends, and no big button (Approve / Pass are on the idea itself)', () => {
    const r = stepsFor({ plan: { ...base, proposed: true, created_by: P2 } });
    expect(r.current).toBe('area');
    expect(primaryFor(r.next, { current: r.current }).label).toBeNull();
  });

  it('a vote open: it’s part of Areas & weekends, with "Pick the winner"', () => {
    const polls = [{ id: 'w', kind: 'location', question: 'Where?', status: 'open', vote_batch: 'b1' }, { id: 'd', kind: 'dates', question: 'When?', status: 'open', vote_batch: 'b1' }];
    const options = [{ id: 'o1', poll_id: 'w', label: 'Hunter' }, { id: 'o2', poll_id: 'd', label: 'Mar', start_date: '2027-03-12', end_date: '2027-03-14' }];
    const r = stepsFor({ polls, options, builder: { weekends: 2, areas: ['Hunter Valley', 'South Coast'], cards: [{ id: 'b1', title: 'Where and when?' }] } });
    expect(r.current).toBe('area');
    expect(r.state.area).toBe('current');
    expect(r.byKey.area.summary).toBe('🗳️ 2 votes open · Hunter Valley · 2 weekends on the shortlist');
    const p = primaryFor(r.next, { current: r.current, polls });
    expect(p.label).toBe('Pick the winner');
    expect(p.action).toEqual({ type: 'pick_winner', pollIds: ['w', 'd'] });
  });

  it('ov23: the steps in Josh’s order, and where the builder’s next steps belong', () => {
    const { ORGANISE_STEPS } = STEPS_MODULE;
    // One list for Organise AND the trip builder's tabs (lib/tripsteps.js) — no separate Plan or Vote step.
    expect(ORGANISE_STEPS.map((s) => s.title)).toEqual(['Areas & weekends', 'Courses & stays', 'Call the courses', 'Pick & lock in', 'Jobs & money', 'Comps & on the day']);
    expect(STEP_KEYS).toEqual(['area', 'courses', 'book', 'lockin', 'money', 'day']);
    expect(STEPS_MODULE.STEP_ALIAS).toEqual({ plan: 'area', vote: 'area' }); // old ?step= links still open
    expect(stepOfNext({ key: 'area-pick' })).toBe('area');
    expect(stepOfNext({ key: 'stay-list:Hunter' })).toBe('courses');
    expect(stepOfNext({ key: 'configs' })).toBe('lockin');
    expect(stepOfNext({ key: 'calls-wait' })).toBe('book');
  });

  it('a vote on where to stay belongs to Courses & stays', () => {
    const plan = { ...base, status: 'confirmed', start_date: '2027-03-12', end_date: '2027-03-14' };
    const polls = [{ id: 's', kind: 'other', purpose: 'stay', question: 'Where should we stay?', status: 'open' }];
    expect(stepOfNext({ key: 'vote:s' }, { polls })).toBe('courses');
    const r = stepsFor({ plan, polls, options: [{ id: 'o', poll_id: 's', label: 'House' }], items: [job('shortlist_stay', { stage: 'done', done: true }), job('reserve_stay')] });
    expect(r.current).toBe('courses');
    expect(r.state.area).toBe('done');
  });

  it('vote decided, dates set: the tee-time calls are Book ("Allocate the calls")', () => {
    const plan = { ...base, start_date: '2027-03-12', end_date: '2027-03-14' };
    const polls = [{ id: 'd', kind: 'dates', status: 'closed', winner_option_id: 'o' }];
    const items = [{ id: 'c1', kind: 'job', title: '📞 Call Kiama Golf Club', owner_id: null, stage: 'todo' }];
    const r = stepsFor({ plan, polls, items });
    expect(r.state.area).toBe('done');
    expect(r.byKey.area.summary).toMatch(/^Hunter Valley · Fri 12 – Sun 14 Mar/);
    expect(r.current).toBe('book');
    expect(primaryFor(r.next, { current: r.current }).label).toBe('Allocate the calls');
    expect(r.byKey.book.summary).toContain('0 of 1 call done');
  });

  it('dates and place set, calls done: Lock in is current with "Lock it in"', () => {
    const plan = { ...base, start_date: '2027-03-12', end_date: '2027-03-14' };
    const r = stepsFor({ plan, items: [{ id: 'c1', kind: 'job', title: '📞 Call Kiama Golf Club', owner_id: P2, stage: 'done', done: true }] });
    expect(r.current).toBe('lockin');
    expect(r.next.label).toBe('Lock it in');
    expect(r.state.book).toBe('done');
    expect(r.state.courses).toBe('todo'); // accommodation not picked yet, but it's before the current step, so not grey
  });

  it('locked in with jobs: accommodation jobs are Courses & stays; deposits are Lock in; transport is Jobs & money', () => {
    const plan = { ...base, status: 'confirmed', start_date: '2027-03-12', end_date: '2027-03-14' };
    const items = [job('shortlist_stay'), job('reserve_stay', { after_item: 'shortlist_stay' }), job('deposit_ask'), job('transport', { owner_id: null }), job('teams_draw')];
    expect(stepOfJob(items[0], items)).toBe('courses');
    expect(stepOfJob(job('book_tees'), items)).toBe('book');
    expect(stepOfJob(items[2], items)).toBe('lockin');
    expect(stepOfJob(items[3], items)).toBe('money');
    expect(stepOfJob(items[4], items)).toBe('day');
    const r = stepsFor({ plan, items });
    expect(r.current).toBe('courses');
    expect(r.state.lockin).toBe('later');
    expect(r.byKey.lockin.started).toBe(true);
    expect(r.byKey.lockin.summary).toMatch(/^🔒 Locked in/);
    expect(r.state.area).toBe('done');
  });

  it('deposits being collected: Lock in, with the deposit count in the summary', () => {
    const plan = { ...base, status: 'confirmed', start_date: '2027-03-12', end_date: '2027-03-14', deposit_pp: 300, deposit_asked_at: '2027-01-01T00:00:00Z' };
    const items = [job('shortlist_stay', { stage: 'done', done: true }), job('reserve_stay', { stage: 'done', done: true }), job('deposit_ask', { stage: 'done', done: true }), job('transport')];
    const rsvps = players.map((p) => ({ player_id: p, status: 'in' }));
    const transfers = [{ from_id: P2, to_id: null, amount: 300, confirmed: false }];
    const r = stepsFor({ plan, items, rsvps, transfers, stays: [{ id: 's', name: 'Beach house', chosen: true }] });
    expect(r.state.courses).toBe('done');
    expect(r.byKey.courses.summary).toBe('🏠 Beach house');
    expect(r.current).toBe('lockin');
    expect(r.next.key).toBe('confirm-deposits');
    expect(r.byKey.lockin.summary).toBe('🔒 Locked in · 3 in · deposits 0 of 3 paid');
  });

  it('everything paid: Jobs & money is current; then On the day', () => {
    const plan = { ...base, status: 'confirmed', start_date: '2027-03-12', end_date: '2027-03-14', deposit_pp: 300, deposit_asked_at: '2027-01-01T00:00:00Z' };
    const done = (k) => job(k, { stage: 'done', done: true });
    const rsvps = [{ player_id: P2, status: 'in' }];
    const transfers = [{ from_id: P2, to_id: null, amount: 300, confirmed: true }];
    const stays = [{ id: 's', name: 'Beach house', chosen: true }];
    const items = [done('shortlist_stay'), done('reserve_stay'), done('deposit_ask'), done('chase_deposits'), job('transport', { due: '2027-02-26' }), job('teams_draw', { due: '2027-03-11' })];
    const r = stepsFor({ plan, items, rsvps, transfers, stays, costs: [{ amount: 100, per_head: false }] });
    expect(r.state.lockin).toBe('done');
    expect(r.current).toBe('money');
    expect(r.byKey.money.summary).toBe('4 of 5 jobs done · $100 in the kitty'); // O1: the draw is step 6's
    const r2 = stepsFor({ plan, items: items.map((j) => (j.formula_key === 'transport' ? { ...j, stage: 'done', done: true } : j)), rsvps, transfers, stays, roundsSetUp: 2 });
    expect(r2.state.money).toBe('done');
    expect(r2.current).toBe('day');
    expect(r2.byKey.day.summary).toBe('2 rounds set up');
  });

  it('a finished trip: every step done, nothing current', () => {
    const plan = { ...base, status: 'confirmed', start_date: '2026-12-01', end_date: '2026-12-03' };
    const r = stepsFor({ plan });
    expect(r.stage).toBe('done');
    expect(r.current).toBeNull();
    expect(r.state.day).toBe('done');
    expect(r.byKey.day.summary).toBe('That’s a wrap');
  });

  it('a player: no Next step passed, so the first step not done is shown as current', () => {
    const r = organiseSteps({ plan: base, stage: 'deciding', next: null });
    expect(r.current).toBe('area');
  });
});

describe('one step list (ov23)', () => {
  it('the builder and Organise use the same steps, numbers and lines', async () => {
    const { TRIP_STEPS, areaLine, coursesLine } = await import('./tripsteps.js');
    const { builderSteps, newState } = await import('./tripbuilder.js');
    const b = builderSteps(newState({}));
    expect(b.map((s) => [s.n, s.label])).toEqual(TRIP_STEPS.filter((t) => t.builder).map((t) => [t.n, t.title]));
    const st = { region: 'Hunter Valley', weekendsSettled: true, weekends: [{ start: '2026-11-13', end: '2026-11-16' }, { start: '2026-11-20', end: '2026-11-23' }],
      stays: [{ name: 'Pokolbin' }], days: [{ options: ['a'] }, { options: [] }] };
    expect(areaLine(st)).toBe('Hunter Valley · Primary Fri 13 – Mon 16 Nov · Backup Fri 20 – Mon 23 Nov');
    expect(coursesLine(st)).toBe('Stay Pokolbin · 1 of 2 days with options');
    const r = stepsFor({ builder: { started: true, state: st, weekends: 2, region: 'Hunter Valley', weekendsSettled: true, coursesDone: true } });
    expect(r.byKey.area.summary).toBe(areaLine(st));
    expect(r.byKey.courses.summary).toBe(coursesLine(st));
    expect(r.byKey.area.done && r.byKey.courses.done).toBe(true);
    expect(r.current).toBe('book'); // area and weekends picked, stays sorted: next is calling the courses
  });
});

describe('organise steps — addresses', () => {
  it('old ?tab= links map to their step', () => {
    expect(TAB_STEP).toEqual({ vote: 'area', people: 'lockin', jobs: 'money', kitty: 'money', groups: 'money' });
    expect(STEP_KEYS).toEqual(['area', 'courses', 'book', 'lockin', 'money', 'day']);
  });
  it('unknown Next steps map to nothing', () => {
    expect(stepOfNext(null)).toBeNull();
    expect(stepOfNext({ key: 'mystery' })).toBeNull();
  });
});
