import { describe, it, expect } from 'vitest';
import {
  FORMULA, buildJobs, dueFor, addDays, jobStage, blockedBy, sortJobs, stagePatch, allocateOrder, callJobs,
  voteBatches, planPhase, nextStep,
} from './tripjobs.js';

const ORG = 'org';
const P2 = 'p2';
const P3 = 'p3';
const plan = { id: 'plan1', kind: 'trip', name: 'Autumn', status: 'confirmed', start_date: '2027-03-12', end_date: '2027-03-14', location_name: 'Nowra', created_by: ORG };
let n = 0;
const uuid = () => `id-${++n}`;
const TODAY = '2026-11-01';

describe('the job formula', () => {
  it('counts due dates back from the trip start', () => {
    n = 0;
    const rows = buildJobs(plan, [], { today: TODAY, organiserId: ORG, uuid });
    const by = Object.fromEntries(rows.map((r) => [r.formula_key, r]));
    expect(by.shortlist_stay.due).toBe('2027-01-15'); // 8 weeks out
    expect(by.reserve_stay.due).toBe('2027-01-22'); // 7 weeks out
    expect(by.pay_balance.due).toBe('2027-02-26'); // 2 weeks out
    expect(by.transport.due).toBe('2027-02-26');
    expect(by.teams_draw.due).toBe('2027-03-11'); // the day before
    expect(by.chase_deposits.due).toBe(null); // known once the deposit is asked for
    expect(by.book_tees.due).toBe('2027-01-29');
    expect(rows.every((r) => r.kind === 'job' && r.stage === 'todo' && r.done === false && r.plan_id === 'plan1')).toBe(true);
  });

  it('links each job to the one it waits for, in order', () => {
    n = 0;
    const rows = buildJobs(plan, [], { today: TODAY, organiserId: ORG, uuid });
    const by = Object.fromEntries(rows.map((r) => [r.formula_key, r]));
    expect(by.shortlist_stay.after_item).toBe(null);
    expect(by.reserve_stay.after_item).toBe(by.shortlist_stay.id);
    expect(by.deposit_ask.after_item).toBe(by.reserve_stay.id);
    expect(by.chase_deposits.after_item).toBe(by.deposit_ask.id);
    expect(by.pay_balance.after_item).toBe(by.reserve_stay.id);
    expect(by.transport.after_item).toBe(null);
    // Something an earlier row points at is always made before it.
    rows.forEach((r, i) => { if (r.after_item) expect(rows.findIndex((x) => x.id === r.after_item)).toBeLessThan(i); });
  });

  it('gives the organiser their jobs and leaves the rest to allocate', () => {
    const rows = buildJobs(plan, [], { today: TODAY, organiserId: ORG, uuid });
    const by = Object.fromEntries(rows.map((r) => [r.formula_key, r]));
    expect(by.shortlist_stay.owner_id).toBe(ORG);
    expect(by.transport.owner_id).toBe(null);
    expect(by.book_tees.owner_id).toBe(null);
  });

  it('is idempotent: running it twice adds nothing', () => {
    const first = buildJobs(plan, [], { today: TODAY, organiserId: ORG, uuid });
    expect(first.length).toBe(FORMULA.length);
    expect(buildJobs(plan, first, { today: TODAY, organiserId: ORG, uuid })).toEqual([]);
  });

  it('fills in only what is missing, linking to the jobs already there', () => {
    const first = buildJobs(plan, [], { today: TODAY, organiserId: ORG, uuid });
    const kept = first.filter((r) => r.formula_key !== 'reserve_stay');
    const again = buildJobs(plan, kept, { today: TODAY, organiserId: ORG, uuid });
    expect(again.map((r) => r.formula_key)).toEqual(['reserve_stay']);
    expect(again[0].after_item).toBe(first.find((r) => r.formula_key === 'shortlist_stay').id);
  });

  it('skips "Book tee times" when the trip builder made Call the course jobs', () => {
    const calls = [{ id: 'c1', kind: 'job', title: '📞 Call Shoalhaven Heads', done: false }];
    expect(callJobs(calls).length).toBe(1);
    const rows = buildJobs(plan, calls, { today: TODAY, organiserId: ORG, uuid });
    expect(rows.some((r) => r.formula_key === 'book_tees')).toBe(false);
    expect(rows.length).toBe(FORMULA.length - 1);
  });

  it('makes nothing until the dates are known, or for a one-day round', () => {
    expect(buildJobs({ ...plan, start_date: null }, [], { today: TODAY, uuid })).toEqual([]);
    expect(buildJobs({ ...plan, kind: 'round' }, [], { today: TODAY, uuid })).toEqual([]);
  });

  it('never makes a job due in the past or after the trip starts', () => {
    const soon = { ...plan, start_date: '2026-11-20', end_date: '2026-11-22' };
    const rows = buildJobs(soon, [], { today: TODAY, organiserId: ORG, uuid });
    for (const r of rows) if (r.due) { expect(r.due >= TODAY).toBe(true); expect(r.due <= soon.start_date).toBe(true); }
    expect(rows.find((r) => r.formula_key === 'shortlist_stay').due).toBe(TODAY);
    expect(rows.find((r) => r.formula_key === 'teams_draw').due).toBe('2026-11-19');
  });

  it('chase deposits is due a week after the deposit was asked for', () => {
    const chase = FORMULA.find((f) => f.key === 'chase_deposits');
    expect(dueFor(chase, { ...plan, deposit_asked_at: '2027-01-25T03:00:00Z' }, TODAY)).toBe('2027-02-01');
    expect(addDays('2027-02-27', 2)).toBe('2027-03-01');
  });
});

describe('job stages and locks', () => {
  const a = { id: 'a', kind: 'job', title: 'Shortlist accommodation', stage: 'todo', done: false };
  const b = { id: 'b', kind: 'job', title: 'Reserve accommodation', stage: 'todo', done: false, after_item: 'a' };
  it('reads old rows that only have done', () => {
    expect(jobStage({ done: true })).toBe('done');
    expect(jobStage({ done: false })).toBe('todo');
    expect(jobStage({ stage: 'asked', done: false })).toBe('asked');
    expect(jobStage({ stage: 'todo', done: true })).toBe('done'); // an old phone ticked it
  });
  it('keeps done in step', () => {
    expect(stagePatch('done')).toEqual({ stage: 'done', done: true });
    expect(stagePatch('asked')).toEqual({ stage: 'asked', done: false });
  });
  it('a job is locked until the one before it is done', () => {
    expect(blockedBy(b, [a, b])?.id).toBe('a');
    expect(blockedBy(b, [{ ...a, stage: 'done', done: true }, b])).toBe(null);
    expect(blockedBy(b, [b])).toBe(null); // the earlier job was removed
  });
  it('sorts open, then locked, then done', () => {
    const d = { id: 'd', kind: 'job', title: 'x', stage: 'done', done: true, due: '2026-01-01' };
    expect(sortJobs([d, b, a]).map((j) => j.id)).toEqual(['a', 'b', 'd']);
  });
  it('offers people who are in first, then keen, then the rest', () => {
    const ps = [{ id: 'x' }, { id: 'y' }, { id: 'z' }, { id: 'w' }];
    const rs = [{ player_id: 'z', status: 'in' }, { player_id: 'y', status: 'maybe' }, { player_id: 'w', status: 'out' }];
    expect(allocateOrder(ps, rs).map((p) => p.id)).toEqual(['z', 'y', 'x', 'w']);
  });
});

describe('combined votes', () => {
  const polls = [
    { id: 'q1', status: 'open', vote_batch: 'b1', question: 'Where?', closes_on: '2026-11-06' },
    { id: 'q2', status: 'open', vote_batch: 'b1', question: 'When?', closes_on: '2026-11-06' },
    { id: 'q3', status: 'closed', question: 'Old' },
  ];
  const options = [{ id: 'o1', poll_id: 'q1' }, { id: 'o2', poll_id: 'q2' }];
  it('counts polls in one batch as one vote', () => {
    const votes = [{ option_id: 'o1', player_id: ORG }, { option_id: 'o2', player_id: ORG }, { option_id: 'o1', player_id: P2 }];
    const b = voteBatches(polls, options, votes, [ORG, P2, P3], [{ id: 'b1', title: 'Where and when?' }]);
    expect(b.length).toBe(1);
    expect(b[0].label).toBe('Where and when?');
    expect(b[0].waiting).toEqual([P2, P3]);
  });
  it('a batch with no card title is "The vote"; older databases have no batches', () => {
    expect(voteBatches(polls, options, [], [ORG])[0].label).toBe('The vote');
  });
  it('a linked tee-time job counts as a call job', () => {
    expect(callJobs([{ id: 'j9', kind: 'job', title: 'Ring Nowra GC' }], ['j9']).length).toBe(1);
  });
  it('a poll with no batch stands alone', () => {
    const b = voteBatches([{ id: 's', status: 'open', question: 'Which place to stay?' }], [{ id: 'x', poll_id: 's' }], [], [ORG]);
    expect(b[0].label).toBe('Which place to stay?');
  });
});

// ---------------------------------------------------------------- Next step at every stage
const names = { [ORG]: 'Josh', [P2]: 'Mike', [P3]: 'Adam' };
const base = { names, playerIds: [ORG, P2, P3], today: TODAY };
const formulaJobs = () => { n = 0; return buildJobs(plan, [], { today: TODAY, organiserId: ORG, uuid }); };
const done = (jobs, ...keys) => jobs.map((j) => (keys.includes(j.formula_key) ? { ...j, stage: 'done', done: true } : j));

describe('nextStep', () => {
  it('idea: the organiser approves; a player says if they’re keen', () => {
    const idea = { ...plan, status: 'planning', proposed: true, start_date: null, created_by: P2 };
    expect(nextStep({ ...base, plan: idea, stage: 'idea', me: ORG, isOrganiser: true }).title).toBe('Approve or pass on this idea');
    const s = nextStep({ ...base, plan: idea, stage: 'idea', me: P3 });
    expect(s.title).toBe('Would you be in?');
    expect(s.action).toEqual({ type: 'tab', tab: 'people' });
  });

  it('deciding: weekends first, then the vote, then calls, then lock in', () => {
    const p = { ...plan, status: 'planning', start_date: null };
    const org = { ...base, plan: p, stage: 'deciding', me: ORG, isOrganiser: true };
    expect(nextStep(org).title).toBe('Pick 1–3 weekends');
    expect(nextStep(org).action.type).toBe('builder');

    const polls = [{ id: 'q1', status: 'open', vote_batch: 'b1', closes_on: '2026-11-06' }];
    org.builder = { cards: [{ id: 'b1', title: 'Where and when?' }] };
    const options = [{ id: 'o1', poll_id: 'q1' }];
    const votes = [{ option_id: 'o1', player_id: ORG }];
    const v = nextStep({ ...org, polls, options, votes });
    expect(v.title).toBe('Where and when? vote closes Fri');
    expect(v.detail).toBe('2 haven’t answered.');
    const mine = nextStep({ ...org, polls, options, votes, me: P2, isOrganiser: false });
    expect(mine.title).toBe('Have your say: Where and when?');

    const calls = [{ id: 'c1', kind: 'job', title: '📞 Call Shoalhaven Heads', done: false }];
    const a = nextStep({ ...org, plan: { ...p }, items: calls, builder: { weekends: 2 } });
    expect(a.title).toBe('Allocate: 📞 Call Shoalhaven Heads');
    expect(a.action).toEqual({ type: 'allocate', id: 'c1' });
    const w = nextStep({ ...org, items: [{ ...calls[0], owner_id: P2 }], builder: { weekends: 2 } });
    expect(w.title).toBe('Waiting on 1 call for tee times');
    expect(w.who).toBe(P2);
    expect(nextStep({ ...org, items: [{ ...calls[0], owner_id: P2 }], builder: { weekends: 2 }, me: P2, isOrganiser: false, rsvps: [{ player_id: P2, status: 'in' }] }).action).toEqual({ type: 'job', id: 'c1' });
    expect(nextStep({ ...org, builder: { weekends: 2, teeOptions: 4 } }).title).toBe('Pick a trip or put it to a vote');
    expect(nextStep({ ...org, plan: { ...p, start_date: '2027-03-12' } }).action).toEqual({ type: 'lock' });
  });

  it('locked: make the to-do list', () => {
    const s = nextStep({ ...base, plan, stage: 'locked', me: ORG, isOrganiser: true });
    expect(s.phase).toBe('locked');
    expect(s.action).toEqual({ type: 'make_jobs' });
  });

  it('booking: shortlist, allocate, reserve — in order', () => {
    const jobs = formulaJobs();
    const org = { ...base, plan, stage: 'locked', me: ORG, isOrganiser: true, items: jobs };
    const s1 = nextStep(org);
    expect(s1.phase).toBe('booking');
    expect(s1.title).toBe('Shortlist accommodation');
    expect(s1.action).toEqual({ type: 'tab', tab: 'stay' });
    // Handed to Mike: the organiser sees who it's on.
    const handed = jobs.map((j) => (j.formula_key === 'shortlist_stay' ? { ...j, owner_id: P2, stage: 'asked' } : j));
    const s2 = nextStep({ ...org, items: handed });
    expect(s2.title).toBe('Shortlist accommodation');
    expect(s2.who).toBe(P2);
    expect(s2.detail).toMatch(/Mike is on it/);
    // Mike sees his job.
    expect(nextStep({ ...org, items: handed, me: P2, isOrganiser: false }).title).toBe('Your job: Shortlist accommodation');
    // Shortlist done → reserve.
    expect(nextStep({ ...org, items: done(jobs, 'shortlist_stay') }).title).toBe('Reserve accommodation');
    // Reserved → set the deposit.
    const s4 = nextStep({ ...org, items: done(jobs, 'shortlist_stay', 'reserve_stay') });
    expect(s4.title).toBe('Set the deposit and ask everyone');
    expect(s4.action).toEqual({ type: 'trip_plan' });
    // An unowned job that's next: Allocate.
    const s5 = nextStep({ ...org, items: done(jobs, 'shortlist_stay', 'reserve_stay', 'deposit_ask', 'chase_deposits', 'book_tees') });
    expect(s5.title).toBe('Pay the balance / final numbers');
    expect(s5.action.type).toBe('job');
  });

  it('booking: an unowned job comes up as Allocate', () => {
    const jobs = done(formulaJobs(), 'shortlist_stay', 'reserve_stay', 'deposit_ask', 'chase_deposits', 'pay_balance');
    const s = nextStep({ ...base, plan, stage: 'locked', me: ORG, isOrganiser: true, items: jobs });
    expect(s.title).toBe('Allocate: Book tee times');
    expect(s.action.type).toBe('allocate');
  });

  it('booking: an overdue job jumps the queue', () => {
    const jobs = formulaJobs().map((j) => (j.formula_key === 'transport' ? { ...j, due: '2026-10-30' } : j));
    expect(nextStep({ ...base, plan, stage: 'locked', me: ORG, isOrganiser: true, items: jobs }).title).toBe('Allocate: Transport / who’s driving');
  });

  it('paying: players confirm and pay; the organiser ticks off and chases', () => {
    const jobs = done(formulaJobs(), 'shortlist_stay', 'reserve_stay', 'deposit_ask');
    const p = { ...plan, deposit_pp: 150, deposit_asked_at: '2026-11-01T00:00:00Z' };
    const rsvps = [{ player_id: ORG, status: 'in' }, { player_id: P2, status: 'maybe' }, { player_id: P3, status: 'in' }];
    const ctx = { ...base, plan: p, stage: 'locked', items: jobs, rsvps, transfers: [{ from_id: ORG, to_id: null, amount: 150, confirmed: true }] };
    const mike = nextStep({ ...ctx, me: P2 });
    expect(mike.phase).toBe('paying');
    expect(mike.title).toBe('Confirm you’re in and pay your $150 deposit');
    expect(mike.action).toEqual({ type: 'pay' });
    const org = nextStep({ ...ctx, me: ORG, isOrganiser: true });
    // Nothing overdue → deposits to collect comes before the next job.
    expect(org.title).toBe('2 deposits to collect');
    // Adam says he's paid → the organiser ticks it off first.
    const t2 = [...ctx.transfers, { id: 't2', from_id: P3, to_id: null, amount: 150, confirmed: false }];
    expect(nextStep({ ...ctx, transfers: t2, me: ORG, isOrganiser: true }).title).toBe('Tick off 1 deposit');
    expect(nextStep({ ...ctx, transfers: t2, me: P3 }).title).toBe('Deposit sent');
    // Paid up → booking again.
    const all = [{ from_id: ORG, amount: 150, confirmed: true }, { from_id: P2, amount: 150, confirmed: true }, { from_id: P3, amount: 150, confirmed: true }];
    expect(planPhase({ plan: p, stage: 'locked', items: jobs, rsvps, transfers: all })).toBe('booking');
  });

  it('all sorted when every job is done', () => {
    const jobs = formulaJobs().map((j) => ({ ...j, stage: 'done', done: true }));
    const s = nextStep({ ...base, plan, stage: 'locked', me: ORG, isOrganiser: true, items: jobs });
    expect(s.title).toBe('All sorted');
    expect(s.detail).toMatch(/days to go/);
  });

  it('on: the leaderboard (after the draw)', () => {
    const jobs = formulaJobs();
    expect(nextStep({ ...base, plan, stage: 'on', me: ORG, isOrganiser: true, items: jobs }).title).toBe('Teams, draw and side comps');
    const s = nextStep({ ...base, plan, stage: 'on', me: P2, items: jobs });
    expect(s.title).toBe('It’s on!');
    expect(s.action).toEqual({ type: 'go', to: '/' });
  });

  it('done: plan the next one; cancelled: nothing', () => {
    expect(nextStep({ ...base, plan, stage: 'done', me: P2 }).action).toEqual({ type: 'go', to: '/plan' });
    expect(nextStep({ ...base, plan, stage: 'cancelled', me: P2 })).toBe(null);
  });
});
