import { describe, it, expect } from 'vitest';
import { stayAddress, toGoWords, weekendDays, teeLine, teeTime, carWords, guestHeading, guestTodos } from './yourweekend.js';
import { runUpSections, myTodos, countdownPush, dayBeforeMessage } from './runup.js';

const playersById = { me: { id: 'me', name: 'Mo Fraser' }, bo: { id: 'bo', name: 'Bo Walsh' }, cy: { id: 'cy', name: 'Cy Ryan' }, josh: { id: 'josh', name: 'Josh Carter', nickname: 'Josh' } };

describe('Your weekend (R1)', () => {
  it('the house address beats the town; tap for maps', () => {
    expect(stayAddress({ address: '12 Beach Rd, Nowra', location_name: 'Nowra' })).toMatchObject({ text: '12 Beach Rd, Nowra', isAddress: true });
    const fromCard = stayAddress({ location_name: 'Nowra' }, [{ kind: 'info', title: 'The house', address: '3 Hill St, Nowra' }]);
    expect(fromCard.text).toBe('3 Hill St, Nowra');
    expect(fromCard.maps).toMatch(/google\.com\/maps/);
    expect(stayAddress({ location_name: 'Nowra' })).toMatchObject({ text: 'Nowra', isAddress: false });
    expect(stayAddress({})).toBeNull();
  });

  it('countdown words', () => {
    expect(toGoWords('2026-10-30', '2026-10-23')).toBe('7 days to go');
    expect(toGoWords('2026-10-24', '2026-10-23')).toBe('Tomorrow');
    expect(toGoWords('2026-10-23', '2026-10-23')).toBe('Today’s the day');
    expect(toGoWords(null)).toBe('');
  });

  it('each day: the course, my tee time and my group', () => {
    const rounds = [
      { id: 'r2', play_date: '2026-10-31', course_id: 'c2', format: 'ambrose' },
      { id: 'r1', play_date: '2026-10-30', course_id: 'c1', format: 'stableford', name: 'Friday' },
    ];
    const coursesById = { c1: { id: 'c1', name: 'Nowra GC' }, c2: { id: 'c2', name: 'Shoalhaven Heads' } };
    const tees = [{ round_id: 'r1', tee_time: '07:52', player_ids: ['bo', 'me', 'cy'] }, { round_id: 'r1', tee_time: '08:00', player_ids: ['josh'] }];
    const days = weekendDays({ rounds, coursesById, tees, me: 'me', playersById });
    expect(days.map((d) => d.label)).toEqual(['Fri 30 Oct', 'Sat 31 Oct']);
    expect(days[0].rounds[0]).toMatchObject({ courseName: 'Nowra GC', tee: '7:52am', group: ['Bo', 'Cy'] });
    expect(teeLine(days[0].rounds[0])).toBe('7:52am with Bo and Cy');
    expect(days[1].rounds[0].tee).toBeNull();
    expect(teeLine(days[1].rounds[0])).toBe('');
    expect(teeTime('13:05')).toBe('1:05pm');
  });

  it('your car in a few words', () => {
    const car = { name: 'Josh’s car', driverId: 'josh', free: 2, pickup: 'Leichhardt 6:30am', people: ['josh', 'me'] };
    expect(carWords({ myCar: car }, 'me', playersById)).toBe('Josh’s car · pick-up Leichhardt 6:30am');
    expect(carWords({ myCar: car }, 'josh', playersById)).toBe('You’re driving · 2 seats free · pick-up Leichhardt 6:30am');
    expect(carWords({ myCar: null, iNeedLift: true }, 'me', playersById)).toBe('You’ve asked for a lift');
    expect(carWords({ myCar: null }, 'me', playersById)).toBeNull();
  });
});

describe('the guest view (R2)', () => {
  it('"You’re Josh’s guest for the L.G.C long weekend"', () => {
    expect(guestHeading({ name: 'L.G.C long weekend' }, playersById.josh)).toBe('You’re Josh’s guest for the L.G.C long weekend');
    expect(guestHeading({ name: 'The Hunter trip' }, null)).toBe('You’re a guest for the Hunter trip');
  });
  it('never a to-do without a button', () => {
    const todos = [{ action: 'rsvp' }, { action: 'deposit' }, { action: 'handicap' }, { action: 'tip' }, { action: 'job' }, { action: 'bring' }];
    expect(guestTodos(todos).map((t) => t.action)).toEqual(['deposit']);
  });
  it('no votes, no group rules and no tipping', () => {
    const s = runUpSections({ guest: true });
    expect(s).not.toContain('votes');
    expect(s).not.toContain('rules');
    expect(s).not.toContain('tipping');
    expect(s).toContain('getting_there');
    expect(runUpSections({})).toEqual(expect.arrayContaining(['votes', 'rules', 'tipping']));
  });
});

describe('to-dos and money (M1 small fixes)', () => {
  const plan = { id: 'p', deposit_pp: 200, start_date: '2026-10-30' };
  const rsvps = [{ player_id: 'me', status: 'in' }];
  it('a deposit sent but not ticked off is not a to-do (no Pay next to "waiting")', () => {
    const t = myTodos({ me: 'me', plan, rsvps, transfers: [{ from_id: 'me', to_id: null, amount: 200, confirmed: false }], mine: { handicap_checked_at: 'x' } });
    expect(t.find((x) => x.key === 'deposit')).toBeUndefined();
  });
  it('the deposit to-do names who to pay', () => {
    const t = myTodos({ me: 'me', plan, rsvps, mine: { handicap_checked_at: 'x' }, payTo: 'Josh' });
    expect(t.find((x) => x.key === 'deposit').title).toBe('Pay Josh your $200 deposit');
  });
});

describe('countdown pushes (I10): one thing each, nothing when nothing to do', () => {
  it('a month out: pay, else are you in', () => {
    expect(countdownPush(30, 'Hunter', { owes: 335, payTo: 'Josh', reply: true })).toMatchObject({ about: 'pay', title: '⛳ Hunter is a month away' });
    expect(countdownPush(30, 'Hunter', { owes: 335, payTo: 'Josh' }).body).toMatch(/^Pay Josh your \$335/);
    expect(countdownPush(30, 'Hunter', { reply: true }).about).toBe('reply');
    expect(countdownPush(30, 'Hunter', { handicap: true, lift: 'none' })).toBeNull();
  });
  it('a week out: handicap, else pay, else lift', () => {
    expect(countdownPush(7, 'Hunter', { handicap: true, hcp: 18, owes: 100 })).toMatchObject({ about: 'handicap' });
    expect(countdownPush(7, 'Hunter', { handicap: true, hcp: 18 }).body).toMatch(/\(18\)/);
    expect(countdownPush(7, 'Hunter', { owes: 100 }).about).toBe('pay');
    expect(countdownPush(7, 'Hunter', { lift: 'none' }).about).toBe('lift');
    expect(countdownPush(7, 'Hunter', { lift: 'car' })).toBeNull();
  });
  it('the day before with no lift: that is the one thing', () => {
    expect(dayBeforeMessage('Hunter', 'Pokolbin', { lift: 'none' }).body).toMatch(/^No lift sorted yet/);
    expect(dayBeforeMessage('Hunter', 'Pokolbin', { tee: '09:12' }).body).toBe('tee time 9:12');
  });
});
