import { describe, it, expect } from 'vitest';
import { isPlanningPoll, openPlanningPolls, closedAtLockIn, decidedLine, lockInWords, lockIn, closePlanningVotes } from './lockin.js';

const polls = [
  { id: 'd', kind: 'dates', question: 'Which weekend?', status: 'open' },
  { id: 'l', kind: 'location', question: 'Where?', status: 'open' },
  { id: 's', kind: 'other', purpose: 'stay', question: 'Where should we stay?', status: 'open' },
  { id: 'b', kind: 'other', question: 'How long?', vote_batch: 'B', status: 'open' },
  { id: 'o', kind: 'other', question: 'Hunter Valley: which courses?', optional: true, status: 'open' },
  { id: 'x', kind: 'other', question: 'Shirt colour?', status: 'open' },
  { id: 'c', kind: 'dates', question: 'Old', status: 'closed' },
];
const plan = { id: 'p', name: 'L.G.C long weekend', status: 'planning', start_date: '2027-01-22', end_date: '2027-01-25', location_name: 'Nowra' };

/** A tiny fake of the database client: records updates and the filters they used. */
function fakeDb() {
  const calls = [];
  const q = (table) => {
    const c = { table, update: null, filters: [] };
    calls.push(c);
    const api = {
      update(v) { c.update = v; return api; },
      eq(k, v) { c.filters.push(['eq', k, v]); return api; },
      in(k, v) { c.filters.push(['in', k, v]); return api; },
      then(res) { return Promise.resolve({ error: null }).then(res); },
    };
    return api;
  };
  return { from: q, calls };
}

describe('lock-in closes the planning votes (V1)', () => {
  it('planning votes are where-and-when votes; anything else stays open', () => {
    expect(polls.filter(isPlanningPoll).map((p) => p.id)).toEqual(['d', 'l', 's', 'b', 'o', 'c']);
    expect(openPlanningPolls(polls).map((p) => p.id)).toEqual(['d', 'l', 's', 'b', 'o']);
  });
  it('a vote closed by the lock-in shows as one line', () => {
    const locked = { ...plan, status: 'confirmed' };
    expect(closedAtLockIn({ ...polls[0], status: 'closed' }, locked)).toBe(true);
    expect(closedAtLockIn({ ...polls[0], status: 'closed', winner_option_id: 'w' }, locked)).toBe(false); // decided by a pick
    expect(closedAtLockIn({ ...polls[5], status: 'closed' }, locked)).toBe(false); // not a planning vote
    expect(closedAtLockIn({ ...polls[0], status: 'closed' }, plan)).toBe(false); // not locked in
    expect(decidedLine(locked)).toBe('Decided: Fri 22 – Mon 25 Jan, Nowra');
    expect(decidedLine({ status: 'confirmed' })).toBe('Decided when the trip was locked in');
  });
  it('one box, saying the votes close', () => {
    const w = lockInWords(plan, polls);
    expect(w.title).toBe('Lock in L.G.C long weekend?');
    expect(w.body).toMatch(/^Fri 22 – Mon 25 Jan at Nowra\. The 5 open votes on where and when close and show as decided\./);
    expect(lockInWords(plan, []).body).not.toMatch(/votes/);
    expect(w.tone).toBe('go');
  });
  it('lockIn: locks the trip and closes only the open planning votes', async () => {
    const db = fakeDb();
    const r = await lockIn(db, plan, polls);
    expect(r.closed).toBe(5);
    expect(db.calls[0]).toMatchObject({ table: 'plans', update: { status: 'confirmed' } });
    expect(db.calls[1].table).toBe('plan_polls');
    expect(db.calls[1].update).toEqual({ status: 'closed' });
    expect(db.calls[1].filters).toContainEqual(['in', 'id', ['d', 'l', 's', 'b', 'o']]);
  });
  it('already locked in: no second status change; nothing open: no poll update', async () => {
    const db = fakeDb();
    await lockIn(db, { ...plan, status: 'confirmed' }, []);
    expect(db.calls).toHaveLength(0);
    expect(await closePlanningVotes(fakeDb(), [polls[5]])).toBe(0);
  });
});
