import { describe, it, expect } from 'vitest';
import { myMoney, moneyWords, youLabel, theyLabel, whoOwes, seatsLine, collectorOf, peopleIn, remindText } from './money.js';

const JOSH = 'j';
const GUS = 'g';
const LOU = 'l';
const playersById = { j: { id: 'j', name: 'Josh Carter', nickname: 'Josh', pay_details: 'PayID 0400 000 000' }, g: { id: 'g', name: 'Gus Brennan' }, l: { id: 'l', name: 'Lou Hughes' } };
const plan = { id: 'p', name: 'L.G.C long weekend', organiser_id: JOSH, kitty_note: 'PayID 0400 000 000 — Josh', deposit_pp: 200 };
const rsvps = [JOSH, GUS, LOU].map((player_id) => ({ player_id, status: 'in' }));
// Josh paid the $1,605 house; split three ways = $535 each.
const costs = [{ id: 'c1', title: 'House', amount: 1605, per_head: false, paid_by: JOSH, split_between: null }];

describe('myMoney — one line per person (M1)', () => {
  it('owes the lot, to Josh', () => {
    const m = myMoney({ costs, rsvps, plan, me: GUS, playersById });
    expect(m.state).toBe('owe');
    expect(m.share).toBe(535);
    expect(m.toPay).toBe(535);
    expect(m.payees[0].name).toBe('Josh');
    expect(moneyWords(m)).toBe('Your share $535 · still to pay $535 to Josh');
  });

  it('a confirmed $200 deposit counts: paid $200, still to pay $335', () => {
    const transfers = [{ id: 't', from_id: GUS, to_id: null, amount: 200, confirmed: true }];
    const m = myMoney({ costs, rsvps, plan, me: GUS, transfers, playersById });
    expect(m.paid).toBe(200);
    expect(m.toPay).toBe(335);
    expect(moneyWords(m)).toBe('Your share $535 · paid $200 · still to pay $335 to Josh');
  });

  it('a deposit sent but not ticked off: shown as waiting, and only the rest is still to pay', () => {
    const transfers = [{ id: 't', from_id: GUS, to_id: null, amount: 200, confirmed: false }];
    const m = myMoney({ costs, rsvps, plan, me: GUS, transfers, playersById });
    expect(m.state).toBe('owe');
    expect(m.waiting).toBe(200);
    expect(m.toPay).toBe(335);
    expect(moneyWords(m)).toContain('$200 waiting for a tick');
  });

  it('said they paid the lot: waiting for Josh to confirm, nothing left to pay (no Pay button)', () => {
    const transfers = [{ id: 't', from_id: GUS, to_id: null, amount: 535, confirmed: false }];
    const m = myMoney({ costs, rsvps, plan, me: GUS, transfers, playersById });
    expect(m.state).toBe('waiting');
    expect(m.toPay).toBe(0);
    expect(moneyWords(m)).toBe('Your share $535 · $535 waiting for Josh to confirm');
  });

  it('confirmed in full: all paid', () => {
    const transfers = [{ id: 't', from_id: GUS, to_id: null, amount: 535, confirmed: true }];
    expect(moneyWords(myMoney({ costs, rsvps, plan, me: GUS, transfers, playersById }))).toBe('Your share $535 · all paid ✓');
  });

  it('the person who fronted the house is owed money back', () => {
    const m = myMoney({ costs, rsvps, plan, me: JOSH, playersById });
    expect(m.state).toBe('owed');
    expect(m.owed).toBe(1070);
    expect(moneyWords(m)).toMatch(/^You’re owed \$1,070/);
  });

  it('no costs yet: the deposit is what is asked, paid to the organiser', () => {
    const m = myMoney({ rsvps, plan, me: GUS, playersById });
    expect(m.depositOnly).toBe(true);
    expect(m.toPay).toBe(200);
    expect(m.payees[0]).toMatchObject({ id: 'kitty', name: 'Josh', details: 'PayID 0400 000 000 — Josh' });
    expect(moneyWords(m)).toBe('Deposit $200 · still to pay $200 to Josh');
    const sent = myMoney({ rsvps, plan, me: GUS, playersById, transfers: [{ from_id: GUS, to_id: null, amount: 200, confirmed: false }] });
    expect(sent.state).toBe('waiting');
    expect(moneyWords(sent)).toBe('Deposit $200 · $200 waiting for Josh to confirm');
  });

  it('nothing to say when not in and no money involved', () => {
    expect(myMoney({ rsvps: [], plan: { ...plan, deposit_pp: null }, me: GUS, playersById })).toBeNull();
    expect(myMoney({ rsvps, plan, me: null })).toBeNull();
  });

  it('pays a person (not the kitty) when the settle-up says so', () => {
    const c2 = [{ id: 'c', title: 'Dinner', amount: 90, per_head: false, paid_by: LOU, split_between: [GUS, LOU, JOSH] }];
    const m = myMoney({ costs: c2, rsvps, plan: { ...plan, deposit_pp: null }, me: GUS, playersById });
    expect(m.payees.map((p) => p.name)).toEqual(['Lou']);
    expect(moneyWords(m)).toBe('Your share $30 · still to pay $30 to Lou');
  });
});

describe('labels', () => {
  it('"You owe", never "YOU owes"', () => {
    expect(youLabel(535)).toBe('You owe $535');
    expect(youLabel(-80)).toBe('You’re owed $80');
    expect(youLabel(0.2)).toBe('All square ✓');
    expect(theyLabel('Gus', 335)).toBe('Gus owes $335');
    expect(theyLabel('Al', -10)).toBe('Al is owed $10');
  });
  it('the collector is the trip organiser by first name', () => {
    expect(collectorOf(plan, playersById)).toEqual({ id: JOSH, name: 'Josh' });
    expect(collectorOf({}, {}).name).toBe('the organiser');
  });
});

describe('whoOwes — the organiser’s short list', () => {
  it('lists who still has to pay, most first, and counts payments waiting', () => {
    const transfers = [{ id: 't', from_id: GUS, to_id: null, amount: 200, confirmed: false }];
    const w = whoOwes({ costs, rsvps, plan, transfers, playersById });
    expect(w.owing.map((o) => [o.name, o.toPay])).toEqual([['Lou', 535], ['Gus', 335]]);
    expect(w.total).toBe(870);
    expect(w.waitingCount).toBe(1);
    expect(remindText({ plan, owing: w.owing, collector: collectorOf(plan, playersById) })).toBe('💰 L.G.C long weekend: still to pay Josh — Lou $535, Gus $335. PayID 0400 000 000 — Josh');
  });
});

describe('seatsLine — I7', () => {
  it('"Seats confirmed: N of M (paid)" from confirmed deposits', () => {
    const transfers = [{ from_id: GUS, to_id: null, amount: 200, confirmed: true }, { from_id: LOU, to_id: null, amount: 200, confirmed: false }];
    const s = seatsLine({ plan, rsvps, transfers });
    expect(s.paid).toEqual([GUS]);
    expect(s.line).toBe('Seats confirmed: 1 of 3 (paid)');
    expect(seatsLine({ plan: { ...plan, deposit_pp: 0 }, rsvps })).toBeNull();
  });
  it('peopleIn counts each person once', () => {
    expect(peopleIn([...rsvps, { player_id: GUS, status: 'in' }, { player_id: 'x', status: 'maybe' }])).toEqual([JOSH, GUS, LOU]);
  });
});

describe('a keen "maybe" and the deposit', () => {
  it('is asked for the deposit too (paying it takes the seat)', () => {
    const m = myMoney({ rsvps: [{ player_id: GUS, status: 'maybe' }], plan, me: GUS, playersById });
    expect(m.depositOnly).toBe(true);
    expect(m.toPay).toBe(200);
  });
});

describe('the organiser who collects', () => {
  it('isn’t owed what’s already been paid in to them', () => {
    const transfers = [{ from_id: GUS, to_id: null, amount: 535, confirmed: true }];
    expect(myMoney({ costs, rsvps, plan, me: JOSH, transfers, playersById }).owed).toBe(535);
    const all = [...transfers, { from_id: LOU, to_id: null, amount: 535, confirmed: true }];
    expect(myMoney({ costs, rsvps, plan, me: JOSH, transfers: all, playersById }).state).toBe('square');
  });
  it('paying Josh direct and paying in are the same: PayID shown, waiting counted', () => {
    const c2 = [{ id: 'c', title: 'House', amount: 1605, per_head: false, paid_by: JOSH, split_between: null }];
    const m = myMoney({ costs: c2, rsvps, plan, me: GUS, playersById, transfers: [{ from_id: GUS, to_id: null, amount: 100, confirmed: false }] });
    expect(m.payees[0]).toMatchObject({ id: JOSH, details: 'PayID 0400 000 000 — Josh', waiting: 100, toPay: 435 });
  });
});
