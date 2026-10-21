import { describe, it, expect } from 'vitest';
import { pickDeskPlan, deskHeader, deskPanels, sortRows, nextSort, filterRows, csvCell, toCsv, costsCsv, csvName } from './desk.js';

const today = '2026-10-21';

describe('which trip the desk opens on', () => {
  const plans = [
    { id: 'old', status: 'done', start_date: '2025-10-01', end_date: '2025-10-03' },
    { id: 'idea', status: 'planning', proposed: false, start_date: null, created_at: '2026-09-01' },
    { id: 'next', status: 'confirmed', start_date: '2026-12-04', end_date: '2026-12-06' },
    { id: 'gone', status: 'cancelled', start_date: '2026-11-01' },
  ];
  it('the locked-in trip first, then one being decided, then the latest past one', () => {
    expect(pickDeskPlan(plans, [], today).id).toBe('next');
    expect(pickDeskPlan(plans.filter((p) => p.id !== 'next'), [], today).id).toBe('idea');
    expect(pickDeskPlan([plans[0]], [], today).id).toBe('old');
    expect(pickDeskPlan([], [], today)).toBeNull();
  });
  it('the header: stage, dates and countdown', () => {
    expect(deskHeader(plans[2], null, today)).toMatchObject({ stage: 'locked', count: 'in 6 weeks', where: 'Place to decide' });
    expect(deskHeader({ status: 'confirmed', start_date: '2026-10-20', end_date: '2026-10-22' }, null, today).count).toBe('On now');
    expect(deskHeader(plans[1], null, today)).toMatchObject({ when: 'Dates to decide', count: '' });
  });
});

const pd = {
  plan: { id: 'p', kind: 'trip', name: 'Hunter', status: 'planning', rsvp_locked: false, start_date: null },
  rsvps: [{ player_id: 'a', status: 'in' }, { player_id: 'b', status: 'in' }, { player_id: 'c', status: 'out' }],
  polls: [{ id: 'q', status: 'open', kind: 'dates', question: 'When?' }],
  options: [{ id: 'o1', poll_id: 'q' }, { id: 'o2', poll_id: 'q' }],
  votes: [{ poll_id: 'q', option_id: 'o1', player_id: 'a', response: 'yes' }, { poll_id: 'q', option_id: 'o2', player_id: 'a', response: 'no' }],
  items: [{ id: 'j1', kind: 'job', title: 'Book', done: false, owner_id: null }, { id: 'j2', kind: 'job', title: 'Shirts', done: true, owner_id: 'a' }],
  costs: [{ id: 'c1', title: 'House', amount: 900, per_head: false, paid_by: 'a', split_between: null }],
  payments: [], transfers: [],
  groups: [{ id: 'g1', kind: 'room', capacity: 2 }], members: [{ group_id: 'g1', player_id: 'a' }],
  voteDecider: 'admin',
};

describe('the panels', () => {
  const d = deskPanels(pd, { playerIds: ['a', 'b', 'c', 'd'], me: 'a', isAdmin: true, today });
  it('who’s in, and nudging the ones who haven’t said', () => {
    expect(d.people).toMatchObject({ in: ['a', 'b'], out: ['c'], noReply: ['d'] });
    expect(d.people.next).toMatchObject({ kind: 'nudge-rsvp', label: 'Nudge 1 who haven’t said' });
  });
  it('votes: leading option, who hasn’t voted, close it', () => {
    expect(d.votes.open[0].leading.option.id).toBe('o1');
    expect(d.votes.open[0].waiting).toEqual(['b', 'c', 'd']);
    expect(d.votes.next.kind).toBe('close-vote');
    const player = deskPanels(pd, { playerIds: ['a', 'b'], me: 'b', isAdmin: false, today });
    expect(player.votes.canDecide).toBe(false);
    expect(player.votes.next.kind).toBe('nudge-votes');
  });
  it('jobs without an owner', () => {
    expect(d.jobs.open).toHaveLength(1);
    expect(d.jobs.done).toBe(1);
    expect(d.jobs.next.label).toBe('Give 1 job an owner');
  });
  it('costs: total, who owes, and chase them', () => {
    expect(d.costs.total).toBe(900);
    expect(d.costs.owing.map((p) => p.player_id)).toEqual(['b']);
    expect(d.costs.settle).toEqual([{ from: 'b', to: 'a', amount: 450 }]);
    expect(d.costs.next.kind).toBe('nudge-kitty');
    expect(deskPanels({ ...pd, costs: [] }, { playerIds: [], today }).costs.next.kind).toBe('add-cost');
  });
  it('rooms: beds, placed and still to place', () => {
    expect(d.rooms.room).toMatchObject({ count: 1, spaces: 2, placed: 1, unplaced: ['b'] });
    expect(d.rooms.next.label).toBe('Place 1 more');
  });
  it('once everyone has answered: lock the list', () => {
    const all = deskPanels(pd, { playerIds: ['a', 'b', 'c'], isAdmin: true, today });
    expect(all.people.next.kind).toBe('lock');
  });
});

describe('tables', () => {
  const rows = [{ n: 'bo', h: 12 }, { n: 'Al', h: 4.5 }, { n: 'cy', h: null }, { n: 'Di', h: 30 }];
  it('sorts numbers as numbers, words without case, blanks last', () => {
    expect(sortRows(rows, 'h').map((r) => r.n)).toEqual(['Al', 'bo', 'Di', 'cy']);
    expect(sortRows(rows, 'h', 'desc').map((r) => r.n)).toEqual(['Di', 'bo', 'Al', 'cy']);
    expect(sortRows(rows, 'n').map((r) => r.n)).toEqual(['Al', 'bo', 'cy', 'Di']);
    expect(sortRows(rows, (r) => r.n.length).map((r) => r.n)).toEqual(['bo', 'Al', 'cy', 'Di']);
  });
  it('clicking a heading flips the order', () => {
    expect(nextSort(null, 'n')).toEqual({ key: 'n', dir: 'asc' });
    expect(nextSort({ key: 'n', dir: 'asc' }, 'n')).toEqual({ key: 'n', dir: 'desc' });
    expect(nextSort({ key: 'n', dir: 'desc' }, 'h')).toEqual({ key: 'h', dir: 'asc' });
  });
  it('filters on every word', () => {
    expect(filterRows(rows, 'a', ['n']).map((r) => r.n)).toEqual(['Al']);
    expect(filterRows(rows, '  ', ['n'])).toHaveLength(4);
    expect(filterRows([{ a: 'Big Al', b: 'Smith' }], 'al smi', ['a', 'b'])).toHaveLength(1);
  });
});

describe('CSV', () => {
  it('quotes what needs quoting and defuses formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell(null)).toBe('');
    expect(toCsv([['a', 1], ['b']])).toBe('a,1\r\nb');
  });
  it('the costs export has every cost, balances and who pays whom', () => {
    const csv = costsCsv({ plan: pd.plan, costs: pd.costs, inIds: ['a', 'b'], nameOf: (id) => ({ a: 'Al', b: 'Bo' }[id]) });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Hunter — costs');
    expect(lines[2]).toBe('House,900.00,Total,Al,Everyone in,2,450.00,900.00,');
    expect(csv).toContain('Bo,450.00,0.00,0.00,450.00');
    expect(csv).toContain('Bo,Al,450.00');
  });
  it('file names', () => {
    expect(csvName('Hunter Weekend 2026!')).toBe('hunter-weekend-2026-costs.csv');
    expect(csvName('')).toBe('trip-costs.csv');
  });
});
