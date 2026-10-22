import { describe, it, expect } from 'vitest';
import {
  linesPerPerson, headcount, lineTotal, budgetSummary, roundUp10, suggestedDeposit, defaultMeals, defaultBudget,
  defaultGreenFees, depositStatus, stayLinks, cleanStay, tripDates,
} from './tripbudget.js';

const rs = (inN, maybeN = 0, outN = 0) => [
  ...Array.from({ length: inN }, (_, i) => ({ player_id: `in${i}`, status: 'in' })),
  ...Array.from({ length: maybeN }, (_, i) => ({ player_id: `m${i}`, status: 'maybe' })),
  ...Array.from({ length: outN }, (_, i) => ({ player_id: `o${i}`, status: 'out' })),
];

describe('headcount', () => {
  it('splits between confirmed, else everyone keen', () => {
    expect(headcount(rs(8, 4, 1))).toMatchObject({ heads: 8, basis: 'confirmed' });
    expect(headcount(rs(0, 6, 2))).toMatchObject({ heads: 6, basis: 'keen' });
    expect(headcount([]).heads).toBe(0);
  });
});

describe('budget maths', () => {
  const items = [
    { kind: 'accommodation', amount: null, ticked: true },
    { kind: 'green_fees', per_person: true, ticked: true, lines: [{ label: 'Sat', pp: 75 }, { label: 'Sun', pp: 60 }] },
    { kind: 'trophy', amount: 120, per_person: false, upfront: true, ticked: true },
    { kind: 'shirts', amount: 45, per_person: true, upfront: true, ticked: false },
    { kind: 'food', per_person: true, ticked: true, lines: [{ label: 'Fri dinner', pp: 25 }, { label: 'Sat breakfast', pp: 10 }, { label: 'Sat dinner', pp: '' }] },
    { kind: 'drinks', amount: 50, per_person: true, ticked: true },
  ];
  it('food plan: meals × people × $ per head', () => {
    expect(linesPerPerson(items[4].lines)).toBe(35);
    expect(lineTotal(items[4], 10)).toBe(350);
  });
  it('accommodation comes from the reserved total unless typed', () => {
    expect(lineTotal(items[0], 10, 2400)).toBe(2400);
    expect(lineTotal({ kind: 'accommodation', amount: 3000 }, 10, 2400)).toBe(3000);
    expect(lineTotal({ kind: 'trophy', amount: 120 }, 10)).toBe(120);
    expect(lineTotal({ kind: 'drinks', amount: 50, per_person: true }, 10)).toBe(500);
  });
  it('totals the ticked lines and works out per person', () => {
    const s = budgetSummary(items, { rsvps: rs(10, 2), accomTotal: 2400 });
    // 2400 + 1350 + 120 + 350 + 500 = 4720 (shirts unticked)
    expect(s.total).toBe(4720);
    expect(s.heads).toBe(10);
    expect(s.perPerson).toBe(472);
    expect(s.upfront).toBe(2520); // accommodation + trophy
  });
  it('per person "if everyone keen comes" when nobody has confirmed', () => {
    const s = budgetSummary(items, { rsvps: rs(0, 8), accomTotal: 2400 });
    expect(s.basis).toBe('keen');
    expect(s.heads).toBe(8);
  });
  it('suggested deposit: up-front share rounded up to $10', () => {
    expect(roundUp10(150)).toBe(150);
    expect(roundUp10(150.01)).toBe(160);
    expect(roundUp10(0)).toBe(0);
    expect(suggestedDeposit(items, { rsvps: rs(10), accomTotal: 2400 })).toBe(260); // 2520 / 10 = 252 → 260
    expect(suggestedDeposit(items, { rsvps: rs(12), accomTotal: 1800 })).toBe(160); // 1920 / 12 = 160
    expect(suggestedDeposit(items, { rsvps: [], accomTotal: 1800 })).toBe(0);
  });
  it('an empty plan is $0, not NaN', () => {
    expect(budgetSummary([], { rsvps: [] })).toMatchObject({ total: 0, perPerson: 0 });
  });
});

describe('defaults', () => {
  it('a basic food plan for Fri–Sun', () => {
    expect(tripDates('2027-03-12', '2027-03-14').map((d) => d.dow)).toEqual(['Fri', 'Sat', 'Sun']);
    expect(defaultMeals('2027-03-12', '2027-03-14').map((m) => m.label)).toEqual([
      'Fri dinner — BBQ at the house', 'Sat breakfast — at the house', 'Sat dinner — at the club', 'Sun breakfast — at the house',
    ]);
    expect(defaultMeals('2027-03-13', '2027-03-13').length).toBe(1);
  });
  it('green fees: one line per round', () => {
    const lines = defaultGreenFees([{ play_date: '2027-03-14', course_id: 'b' }, { play_date: '2027-03-13', course_id: 'a' }], { a: { name: 'Shoalhaven Heads' }, b: { name: 'Nowra' } });
    expect(lines.map((l) => l.label)).toEqual(['Sat — Shoalhaven Heads', 'Sun — Nowra']);
  });
  it('the starting plan has every kind once', () => {
    const b = defaultBudget({ id: 'p', start_date: '2027-03-12', end_date: '2027-03-14' });
    expect(b.map((x) => x.kind)).toEqual(['accommodation', 'green_fees', 'trophy', 'shirts', 'food', 'drinks', 'transport', 'other']);
    expect(b.find((x) => x.kind === 'food').lines.length).toBe(4);
  });
});

describe('deposits', () => {
  const rsvps = [{ player_id: 'a', status: 'in' }, { player_id: 'b', status: 'in' }, { player_id: 'c', status: 'maybe' }, { player_id: 'd', status: 'out' }];
  it('sorts people into paid, waiting and not yet', () => {
    const t = [
      { from_id: 'a', to_id: null, amount: 150, confirmed: true },
      { from_id: 'b', to_id: null, amount: 150, confirmed: false },
      { from_id: 'c', to_id: 'a', amount: 150, confirmed: true }, // paid a mate back, not the deposit
    ];
    const d = depositStatus({ deposit: 150, rsvps, transfers: t });
    expect(d.people.map((p) => [p.player_id, p.state])).toEqual([['a', 'paid'], ['b', 'pending'], ['c', 'unpaid']]);
    expect(d.confirmedPaid.map((p) => p.player_id)).toEqual(['a']);
    expect(d.confirmedNotPaid.map((p) => p.player_id)).toEqual(['b']);
    expect(d.notConfirmed.map((p) => p.player_id)).toEqual(['c']);
    expect(d.pending.length).toBe(1);
  });
  it('two part payments add up', () => {
    const d = depositStatus({ deposit: 150, rsvps: [rsvps[0]], transfers: [{ from_id: 'a', amount: 100, confirmed: true }, { from_id: 'a', amount: 50, confirmed: true }] });
    expect(d.people[0].state).toBe('paid');
  });
});

describe('accommodation search links', () => {
  it('fills in the town, dates and headcount', () => {
    const l = stayLinks({ town: 'Nowra NSW', start: '2027-03-12', end: '2027-03-14', people: 12 });
    expect(l.map((x) => x.name)).toEqual(['Booking.com', 'Airbnb', 'Stayz']);
    expect(l[0].url).toContain('ss=Nowra%20NSW');
    expect(l[0].url).toContain('checkin=2027-03-12&checkout=2027-03-14&group_adults=12&no_rooms=6');
    expect(l[1].url).toBe('https://www.airbnb.com.au/s/Nowra%20NSW/homes?checkin=2027-03-12&checkout=2027-03-14&adults=12');
    expect(l[2].url).toContain('destination=Nowra%20NSW&startDate=2027-03-12&endDate=2027-03-14&adults=12');
  });
  it('one night for a one-day trip; nothing without a town or date', () => {
    expect(stayLinks({ town: 'Nowra', start: '2027-02-28', people: 4 })[1].url).toContain('checkout=2027-03-01');
    expect(stayLinks({ town: '', start: '2027-03-12' })).toEqual([]);
    expect(stayLinks({ town: 'Nowra' })).toEqual([]);
  });
  it('cleans a pasted place', () => {
    expect(cleanStay({ name: '  Beach House ', link: 'airbnb.com.au/rooms/1', total_cost: '$2,400', sleeps: '12 people', distance_note: '10 min to the course' }))
      .toEqual({ name: 'Beach House', link: 'https://airbnb.com.au/rooms/1', total_cost: 2400, sleeps: 12, distance_note: '10 min to the course' });
    expect(cleanStay({ name: '' })).toBe(null);
    expect(cleanStay({ name: 'X', total_cost: 'call' }).total_cost).toBe(null);
  });
});
