import { describe, it, expect } from 'vitest';
import { shiftDate, nextYearStart, nextName, dayIndex, buildRepeat, setupRoundsFromShape, extrasForRounds, describeRepeat, notReplied } from './repeat.js';

const PLAN = { id: 'p1', kind: 'trip', name: 'Hunter trip 2026', status: 'done', start_date: '2026-03-13', end_date: '2026-03-15', location_name: 'Hunter Valley', address: '1 Golf Rd', link: null, budget_pp: 650, trip_id: 't1', brief: 'Old booking ref 1234' };
const ROUNDS = [
  { id: 'r3', trip_id: 't1', course_id: 'c2', play_date: '2026-03-15', format: 'ambrose', ctp_holes: [5], ld_holes: [], own_comps: [], created_at: '3' },
  { id: 'r1', trip_id: 't1', course_id: 'c1', play_date: '2026-03-13', format: 'stableford', ctp_holes: [3, 12], ld_holes: [9], own_comps: [{ comp: 'oc1', holes: [] }, { comp: 'gone', holes: [7] }], created_at: '1' },
  { id: 'r2', trip_id: 't1', course_id: 'c1', play_date: '2026-03-14', format: 'stroke', ctp_holes: [], ld_holes: [], own_comps: [], created_at: '2' },
  { id: 'rx', trip_id: 'other', course_id: 'c1', play_date: '2026-03-14', format: 'stroke' },
];
const GAMES = [
  { id: 'g1', round_id: 'r1', kind: 'skins', stake: '5.00', options: { net: true, carry: true }, retired: false },
  { id: 'g2', round_id: 'r1', kind: 'nassau', stake: 10, options: {}, retired: true },
  { id: 'g3', round_id: 'r3', kind: 'skins', stake: 2, options: {}, retired: false },
  { id: 'g4', round_id: 'r3', kind: 'birdie_pool', stake: 2, options: {}, retired: false },
  // ov29 (098): someone's opt-in offer for that trip — not copied (day 0 below has only the skins).
  { id: 'g5', round_id: 'r1', kind: 'birdie_pool', stake: 3, options: {}, retired: false, who_in: 'opt_in' },
];
const ITEMS = [
  { id: 'i1', kind: 'job', title: 'Book the house', owner_id: 'pA', done: true, due: '2026-01-10', sort: 0 },
  { id: 'i2', kind: 'bring', title: 'Esky', owner_id: 'pB', done: true, sort: 1 },
  { id: 'i3', kind: 'day', title: 'Dinner at the pub', day: '2026-03-14', time: '7pm', sort: 0 },
  { id: 'i4', kind: 'info', title: 'Wifi password', body: 'secret' },
];
const RSVPS = [{ player_id: 'pA', status: 'in' }, { player_id: 'pB', status: 'in' }, { player_id: 'pC', status: 'out' }, { player_id: 'pD', status: 'maybe' }];
const TROPHIES = [{ id: 'tr1', trip_id: 't1', name: 'The BD Trophy', type: 'stableford_total', description: null }];

describe('dates and names', () => {
  it('a year on, same weekday', () => {
    expect(nextYearStart('2026-03-13')).toBe('2027-03-12'); // Fri → Fri
    expect(new Date(2027, 2, 12).getDay()).toBe(new Date(2026, 2, 13).getDay());
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate(null, 1)).toBeNull();
  });
  it('next year’s name', () => {
    expect(nextName('Hunter trip 2026', '2026-03-13', '2027-03-12')).toBe('Hunter trip 2027');
    expect(nextName('Xmas Ambrose', '2026-12-12', '2027-12-11')).toBe('Xmas Ambrose (again)');
    expect(nextName('Trip 2025 redux', '2026-01-01', '2027-01-01')).toBe('Trip 2027 redux');
  });
  it('day of the trip', () => {
    expect(dayIndex('2026-03-13', '2026-03-15')).toBe(2);
    expect(dayIndex('2026-03-13', null)).toBeNull();
  });
});

describe('buildRepeat — the new trip idea', () => {
  const built = buildRepeat({ plan: PLAN, rounds: ROUNDS, games: GAMES, items: ITEMS, rsvps: RSVPS, trophies: TROPHIES, start: '2027-03-12', name: '', me: 'pA' });
  it('same place, new dates (same length), an idea that isn’t a suggestion', () => {
    expect(built.plan).toMatchObject({
      kind: 'trip', name: 'Hunter trip 2027', status: 'planning', proposed: false, start_date: '2027-03-12', end_date: '2027-03-14',
      location_name: 'Hunter Valley', address: '1 Golf Rd', budget_pp: 650, organiser_id: 'pA', repeat_of: 'p1',
    });
    expect(built.plan).not.toHaveProperty('brief'); // old booking details aren't copied
    expect(built.plan).not.toHaveProperty('trip_id');
  });
  it('keeps the golf as a shape: course and format per day, side comps and live games, in day order', () => {
    expect(built.shape.rounds).toEqual([
      { day: 0, course_id: 'c1', format: 'stableford', ctp_holes: [3, 12], ld_holes: [9], own_comps: [{ comp: 'oc1', holes: [] }, { comp: 'gone', holes: [7] }], games: [{ kind: 'skins', stake: 5, options: { net: true, carry: true } }] },
      { day: 1, course_id: 'c1', format: 'stroke', ctp_holes: [], ld_holes: [], own_comps: [], games: [] },
      { day: 2, course_id: 'c2', format: 'ambrose', ctp_holes: [5], ld_holes: [], own_comps: [], games: [{ kind: 'skins', stake: 2, options: {} }, { kind: 'birdie_pool', stake: 2, options: {} }] },
    ]);
    expect(built.shape.trophies).toEqual([{ name: 'The BD Trophy', type: 'stableford_total', description: null }]);
    expect(built.shape.from).toBe('p1');
  });
  it('invites whoever was in (not maybes or outs)', () => {
    expect(built.invited).toEqual(['pA', 'pB']);
    expect(built.shape.invited).toEqual(['pA', 'pB']);
  });
  it('jobs and bring list: not done, nobody on them; day plan moved; info left behind', () => {
    expect(built.items).toEqual([
      { kind: 'job', title: 'Book the house', body: null, time: null, address: null, link: null, day: null, due: '2027-01-09', sort: 0, done: false, owner_id: null },
      { kind: 'bring', title: 'Esky', body: null, time: null, address: null, link: null, day: null, due: null, sort: 1, done: false, owner_id: null },
      { kind: 'day', title: 'Dinner at the pub', body: null, time: '7pm', address: null, link: null, day: '2027-03-13', due: null, sort: 0, done: false, owner_id: null },
    ]);
  });
  it('a chosen name and end date win', () => {
    const b = buildRepeat({ plan: PLAN, start: '2027-04-01', end: '2027-04-04', name: '  Hunter: the sequel  ' });
    expect(b.plan).toMatchObject({ name: 'Hunter: the sequel', start_date: '2027-04-01', end_date: '2027-04-04' });
    expect(b.shape.rounds).toEqual([]);
  });
  it('an end before the start is ignored (same length kept)', () => {
    expect(buildRepeat({ plan: PLAN, start: '2027-04-01', end: '2027-03-01' }).plan.end_date).toBe('2027-04-03');
  });
  it('a one-day round', () => {
    const b = buildRepeat({ plan: { ...PLAN, kind: 'round', start_date: '2026-12-12', end_date: null }, rounds: [], start: '2027-12-11' });
    expect(b.plan).toMatchObject({ kind: 'round', start_date: '2027-12-11', end_date: '2027-12-11' });
  });
});

describe('setting it up in the app from the shape', () => {
  const built = buildRepeat({ plan: PLAN, rounds: ROUNDS, games: GAMES, start: '2027-03-12' });
  const coursesById = { c1: { id: 'c1' }, c2: { id: 'c2' } };
  const rows = [{ date: '2027-03-12', course_id: '', format: 'stableford' }, { date: '2027-03-13', course_id: '', format: 'stableford' }, { date: '2027-03-14', course_id: '', format: 'ambrose' }];
  it('fills the course and format per day', () => {
    expect(setupRoundsFromShape(built.shape, rows, coursesById)).toEqual([
      { date: '2027-03-12', course_id: 'c1', format: 'stableford' },
      { date: '2027-03-13', course_id: 'c1', format: 'stroke' },
      { date: '2027-03-14', course_id: 'c2', format: 'ambrose' },
    ]);
  });
  it('a course the group no longer has is left blank; no shape = unchanged', () => {
    expect(setupRoundsFromShape(built.shape, rows, { c1: {} })[2].course_id).toBe('');
    expect(setupRoundsFromShape(null, rows)).toBe(rows);
  });
  it('copies side comp holes, own comps that still exist and games onto the matching rounds', () => {
    const made = [
      { id: 'n1', play_date: '2027-03-12', course_id: 'c1', format: 'stableford' },
      { id: 'n2', play_date: '2027-03-13', course_id: 'c1', format: 'stroke' },
      { id: 'n3', play_date: '2027-03-14', course_id: 'c2', format: 'ambrose' },
    ];
    const ex = extrasForRounds(built.shape, made, '2027-03-12', { ownCompIds: ['oc1'] });
    expect(ex).toEqual([
      { round_id: 'n1', patch: { ctp_holes: [3, 12], ld_holes: [9], own_comps: [{ comp: 'oc1', holes: [] }] }, games: [{ round_id: 'n1', kind: 'skins', stake: 5, options: { net: true, carry: true } }] },
      // Ambrose: the birdie pool is left off (skins and Nassau only).
      { round_id: 'n3', patch: { ctp_holes: [5] }, games: [{ round_id: 'n3', kind: 'skins', stake: 2, options: {} }] },
    ]);
  });
  it('a different course that day gets nothing; games off gets no games', () => {
    expect(extrasForRounds(built.shape, [{ id: 'n1', play_date: '2027-03-12', course_id: 'c9' }], '2027-03-12')).toEqual([]);
    expect(extrasForRounds(built.shape, [{ id: 'n1', play_date: '2027-03-12', course_id: 'c1' }], '2027-03-12', { gamesOn: false })[0].games).toEqual([]);
    expect(extrasForRounds(null, [], '2027-03-12')).toEqual([]);
  });
  it('dates moved by a vote still match by day of the trip', () => {
    const ex = extrasForRounds(built.shape, [{ id: 'n1', play_date: '2027-05-07', course_id: 'c1', format: 'stableford' }], '2027-05-07');
    expect(ex[0].patch.ctp_holes).toEqual([3, 12]);
  });
});

describe('the confirm card', () => {
  it('one line per round, then trophies, jobs and who’s invited', () => {
    const built = buildRepeat({ plan: PLAN, rounds: ROUNDS, games: GAMES, items: ITEMS, rsvps: RSVPS, trophies: TROPHIES, start: '2027-03-12' });
    const lines = describeRepeat(built, {
      coursesById: { c1: { name: 'Cypress Lakes' }, c2: { name: 'The Vintage' } },
      compsById: { oc1: { name: 'Longest putt' } },
      playersById: { pA: { name: 'Al' }, pB: { name: 'Bo' } },
    });
    expect(lines).toEqual([
      'Fri · Stableford at Cypress Lakes · CTP 3, 12 · LD 9 · Longest putt · Skins',
      'Sat · Stroke play at Cypress Lakes',
      'Sun · Ambrose at The Vintage · CTP 5 · Skins, Birdie pool',
      'Trophies: The BD Trophy',
      '1 job · 1 on the bring list · 1 in the day-by-day plan',
      'Invited: Al, Bo',
    ]);
  });
  it('who hasn’t replied', () => {
    expect(notReplied(['pA', 'pB', 'pC'], [{ player_id: 'pB', status: 'in' }])).toEqual(['pA', 'pC']);
  });
});
