import { describe, it, expect } from 'vitest';
import { tallyPoll, nonVoters, kitty, settleUp, suggestions, icsFor, fmtRange, countdown, daysUntil, nudgeText } from './plan.js';
import { makeGroupDraw } from './draw.js';

describe('date / location votes', () => {
  const options = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const votes = [
    { option_id: 'a', player_id: 'p1', response: 'yes' }, { option_id: 'a', player_id: 'p2', response: 'no' },
    { option_id: 'b', player_id: 'p1', response: 'yes' }, { option_id: 'b', player_id: 'p2', response: 'maybe' },
    { option_id: 'c', player_id: 'p1', response: 'maybe' },
  ];
  it('scores 2 per ✓ and 1 per ? and puts the best first', () => {
    const rows = tallyPoll(options, votes);
    expect(rows.map((r) => r.option.id)).toEqual(['b', 'a', 'c']);
    expect(rows[0].score).toBe(3);
    expect(rows[0].leading).toBe(true);
    expect(rows[1].leading).toBe(false);
  });
  it('breaks a tie on fewer ✗', () => {
    const rows = tallyPoll(options, [
      { option_id: 'a', player_id: 'p1', response: 'yes' }, { option_id: 'a', player_id: 'p2', response: 'no' },
      { option_id: 'b', player_id: 'p1', response: 'yes' },
    ]);
    expect(rows[0].option.id).toBe('b');
  });
  it('has no leader when nobody has voted', () => {
    expect(tallyPoll(options, []).some((r) => r.leading)).toBe(false);
  });
  it('lists people who haven’t answered every option', () => {
    expect(nonVoters(options, votes, ['p1', 'p2', 'p3'])).toEqual(['p2', 'p3']);
  });
});

describe('kitty', () => {
  it('splits a total between those in, credits whoever fronted it', () => {
    const k = kitty(
      [{ amount: 1200, per_head: false, paid_by: 'josh' }, { amount: 50, per_head: true, paid_by: null }],
      [{ player_id: 'mark', paid: 350 }],
      ['josh', 'mark', 'al', 'cam']
    );
    expect(k.total).toBe(1400);
    const by = Object.fromEntries(k.people.map((p) => [p.player_id, p.balance]));
    expect(by.mark).toBe(0);
    expect(by.al).toBe(350);
    expect(by.josh).toBe(350 - 1200); // owed back 850
    expect(k.kitty).toBe(350 - 200); // paid in minus green fees paid from the kitty
  });
  it('splits a cost only between the people it was for', () => {
    const k = kitty([{ amount: 90, per_head: false, paid_by: 'fred', split_between: ['fred', 'paul', 'josh'] }], [], ['fred', 'paul', 'josh', 'mark']);
    const by = Object.fromEntries(k.people.map((p) => [p.player_id, p.balance]));
    expect(by.paul).toBe(30);
    expect(by.mark).toBe(0);
    expect(by.fred).toBe(-60);
  });
  it('counts person-to-person payments and works out who pays who', () => {
    const k = kitty([{ amount: 400, per_head: false, paid_by: 'josh' }], [], ['josh', 'hamish', 'al', 'cam'], [{ from_id: 'hamish', to_id: 'josh', amount: 100, confirmed: true }, { from_id: 'al', to_id: 'josh', amount: 100, confirmed: false }]);
    const by = Object.fromEntries(k.people.map((p) => [p.player_id, p.balance]));
    expect(by.hamish).toBe(0);
    expect(by.josh).toBe(-200);
    expect(k.settle).toEqual(expect.arrayContaining([{ from: 'al', to: 'josh', amount: 100 }, { from: 'cam', to: 'josh', amount: 100 }]));
    expect(k.settle).toHaveLength(2);
    expect(k.toCollect).toBe(200);
  });
  it('puts a cost on the payer when nobody is in, and ignores a name picked twice', () => {
    const k = kitty([{ amount: 300, per_head: false, paid_by: 'josh' }, { amount: 60, per_head: false, paid_by: 'al', split_between: ['al', 'cam', 'cam'] }], [], []);
    const by = Object.fromEntries(k.people.map((p) => [p.player_id, p.balance]));
    expect(by.josh).toBe(0);
    expect(by.cam).toBe(30);
    expect(k.total).toBe(360);
  });
  it('settles with the fewest payments', () => {
    const t = settleUp([{ id: 'a', balance: 50 }, { id: 'b', balance: 30 }, { id: 'c', balance: -80 }]);
    expect(t).toEqual([{ from: 'a', to: 'c', amount: 50 }, { from: 'b', to: 'c', amount: 30 }]);
  });
  it('handles nobody being in yet', () => {
    expect(kitty([{ amount: 100, per_head: false }], [], []).people).toEqual([]);
  });
});

describe('organising suggestions', () => {
  const base = { id: 'x', kind: 'trip', name: 'Autumn trip' };
  it('starts with date and location votes when nothing is set', () => {
    const s = suggestions(base, { today: '2026-10-18' });
    expect(s.map((x) => x.key)).toEqual(expect.arrayContaining(['dates', 'location', 'kitty', 'bring']));
  });
  it('flags locking the list and overdue jobs close to the trip', () => {
    const s = suggestions({ ...base, start_date: '2026-11-20', location_name: 'Gerringong' }, { today: '2026-10-18', items: [{ kind: 'job', title: 'Book the house' }] });
    const keys = s.map((x) => x.key);
    expect(keys).toContain('lock');
    expect(keys).not.toContain('job:Book the accommodation'); // already on the list
    expect(s.find((x) => x.key === 'job:Book tee times').when).toBe('Now');
    expect(s[0].when).toBe('Overdue');
  });
  it('skips trip-only jobs for a one-day round', () => {
    const s = suggestions({ ...base, kind: 'round' }, {});
    expect(s.some((x) => x.key === 'job:Order the trip shirts')).toBe(false);
    expect(s.some((x) => x.key === 'kitty')).toBe(false);
  });
});

describe('dates and calendar', () => {
  it('formats date ranges', () => {
    expect(fmtRange('2027-03-12', '2027-03-14')).toBe('Fri 12 – Sun 14 Mar 2027');
    expect(fmtRange('2027-04-30', '2027-05-02')).toBe('Fri 30 Apr – Sun 2 May 2027');
    expect(fmtRange('2027-03-13')).toBe('Sat 13 Mar 2027');
  });
  it('counts down', () => {
    expect(daysUntil('2026-10-25', '2026-10-18')).toBe(7);
    expect(countdown('2026-10-19', '2026-10-18')).toBe('tomorrow');
    expect(countdown('2027-01-17', '2026-10-18')).toBe('in 13 weeks');
  });
  it('makes an all-day calendar event ending the day after', () => {
    const ics = icsFor({ id: '1', name: 'Trip', start_date: '2027-03-12', end_date: '2027-03-14', location_name: 'Gerringong' });
    expect(ics).toContain('DTSTART;VALUE=DATE:20270312');
    expect(ics).toContain('DTEND;VALUE=DATE:20270315');
    expect(ics).toContain('LOCATION:Gerringong');
  });
  it('writes a nudge', () => {
    expect(nudgeText('votes', { plan: { name: 'Trip' }, names: ['Fred', 'Paul'], url: 'u' })).toContain('Fred, Paul');
  });
});

describe('rooms & cars draw', () => {
  const seq = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  it('fills rooms evenly and never over capacity', () => {
    const d = makeGroupDraw(['a', 'b', 'c', 'd', 'e', 'f'], [{ id: 'r1', name: 'Room 1', capacity: 2 }, { id: 'r2', name: 'Room 2', capacity: 2 }, { id: 'r3', name: 'Bunk room', capacity: 4 }], seq);
    expect(d.teams.map((t) => t.players.length)).toEqual([2, 2, 2]);
    expect(d.picks).toHaveLength(6);
    expect(d.leftOver).toEqual([]);
  });
  it('reports who misses out when there are not enough beds', () => {
    const d = makeGroupDraw(['a', 'b', 'c'], [{ id: 'c1', name: 'Ute', capacity: 2 }], seq);
    expect(d.leftOver).toHaveLength(1);
  });
});
