import { describe, it, expect } from 'vitest';
import {
  weekendsInWindow, byMonth, weekendTags, schoolHolidayFor, weekendSpan, toggleWeekend, customWeekend, tripHeadcount, headcountLine,
  rankWeekends, settlePrimaryBackup, openUpWeekend, rolesLine, makePrimary, resizeWeekend, fridayOf, lengthSection, leadingNights, lengthLabel,
} from './weekends.js';
import { stayLinks, bedroomsFor } from './tripbudget.js';

const TODAY = new Date(2026, 9, 23); // Fri 23 Oct 2026

describe('every weekend in the window (ov23)', () => {
  it('March–May 2027, 2 nights: all 13 weekends, Fri–Sun, grouped by month', () => {
    const w = weekendsInWindow({ from: '2027-03', months: 3, nights: 2, today: TODAY });
    expect(w.length).toBe(13);
    expect(w.every((x) => x.end > x.start)).toBe(true);
    expect(w[0]).toMatchObject({ start: '2027-03-05', end: '2027-03-07', label: 'Fri 5 – Sun 7 Mar', month: '2027-03' });
    const g = byMonth(w);
    expect(g.map((m) => [m.label, m.weekends.length])).toEqual([['March 2027', 4], ['April 2027', 5], ['May 2027', 4]]);
  });
  it('tags long weekends (NSW public holidays) and school holidays (NSW)', () => {
    const w = weekendsInWindow({ from: '2027-03', months: 3, nights: 2, today: TODAY });
    const easter = w.find((x) => x.start === '2027-03-26');
    expect(easter).toMatchObject({ long: true, holiday: 'Good Friday' });
    expect(weekendTags(easter)[0]).toBe('Long weekend (Good Friday)');
    const school = w.filter((x) => x.school).map((x) => x.start);
    expect(school).toEqual(['2027-04-09', '2027-04-16', '2027-04-23']); // autumn holidays 12–23 Apr and the weekends either side
    expect(w.find((x) => x.start === '2027-04-23').holiday).toBe('Anzac Day'); // a Sunday: not a long weekend
    expect(w.find((x) => x.start === '2027-04-23').long).toBe(false);
    const june = weekendsInWindow({ from: '2027-06', months: 1, nights: 2, today: TODAY });
    expect(june.find((x) => x.long)).toMatchObject({ start: '2027-06-11', holiday: 'King’s Birthday' });
  });
  it('nights change the span: 1 = Sat–Sun, 3 = Fri–Mon (or Thu–Sun), a day trip = Saturday', () => {
    expect(weekendsInWindow({ from: '2027-03', months: 1, nights: 1, today: TODAY })[0]).toMatchObject({ start: '2027-03-06', end: '2027-03-07' });
    expect(weekendsInWindow({ from: '2027-03', months: 1, nights: 3, today: TODAY })[0]).toMatchObject({ start: '2027-03-05', end: '2027-03-08' });
    expect(weekendsInWindow({ from: '2027-03', months: 1, nights: 3, side: 'thu', today: TODAY })[0]).toMatchObject({ start: '2027-03-04', end: '2027-03-07' });
    expect(weekendsInWindow({ from: '2027-03', months: 1, nights: 0, today: TODAY })[0]).toMatchObject({ start: '2027-03-06', end: '2027-03-06' });
    expect(weekendSpan('2027-03-26', 3)).toEqual({ start: '2027-03-26', end: '2027-03-29' }); // Easter: both sides are holidays
    expect(weekendSpan('2027-04-02', 3, 'thu')).toEqual({ start: '2027-04-01', end: '2027-04-04' });
  });
  it('the default window is the next 6 months, nothing in the next week', () => {
    const w = weekendsInWindow({ today: TODAY });
    expect(w[0].start).toBe('2026-10-30');
    expect(w[w.length - 1].start < '2027-04-01').toBe(true);
    expect(byMonth(w).map((m) => m.label)).toEqual(['October 2026', 'November 2026', 'December 2026', 'January 2027', 'February 2027', 'March 2027']);
    expect(w.length).toBe(22);
  });
  it('school holidays: the summer break, and unknown beyond the list', () => {
    expect(schoolHolidayFor('2027-01-08', '2027-01-10')).toBe('Summer school holidays');
    expect(schoolHolidayFor('2027-02-12', '2027-02-14')).toBe(null);
    const far = weekendsInWindow({ from: '2028-03', months: 1, today: TODAY });
    expect(far.every((x) => x.school === null)).toBe(true);
  });
  it('the shortlist: any number, ticks in and out, custom dates', () => {
    const w = weekendsInWindow({ from: '2027-03', months: 3, today: TODAY });
    let list = [];
    for (const x of w.slice(0, 8)) list = toggleWeekend(list, x);
    expect(list.length).toBe(8);
    list = toggleWeekend(list, w[2]);
    expect(list.length).toBe(7);
    expect(Object.keys(list[0]).sort()).toEqual(['end', 'holiday', 'long', 'school', 'start']);
    expect(customWeekend('2027-03-10', '2027-03-12', { today: TODAY })).toMatchObject({ start: '2027-03-10', end: '2027-03-12', custom: true });
    expect(customWeekend('2026-01-01', '2026-01-02', { today: TODAY })).toBe(null);
    expect(customWeekend('2027-03-01', '2027-03-20', { today: TODAY })).toBe(null);
  });
});

describe('how many are coming (ov23)', () => {
  const players = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, approved: true }));
  it('the number set first, then who’s in, then the group — never a made-up default', () => {
    expect(tripHeadcount({ set: 9, players, rsvps: [{ status: 'in' }] })).toMatchObject({ people: 9, source: 'set' });
    expect(tripHeadcount({ set: 9, setBy: 'ai', players })).toMatchObject({ people: 9, source: 'ai', words: 'from the plan chat' });
    expect(tripHeadcount({ players, rsvps: [{ status: 'in' }, { status: 'in' }, { status: 'maybe' }] })).toMatchObject({ people: 2, source: 'in' });
    expect(tripHeadcount({ players: [...players, { id: 'g', approved: true, role: 'guest' }, { id: 'x', approved: false }] })).toMatchObject({ people: 14, source: 'group' });
    expect(tripHeadcount({})).toMatchObject({ people: 0, source: 'none' });
  });
  it('the line on the search links', () => {
    expect(headcountLine(9)).toBe('for 9 people · 5+ bedrooms');
    expect(headcountLine(1)).toBe('for 1 person · 1+ bedroom');
    expect(headcountLine(0)).toBe('for ? people');
  });
});

describe('search links use the real head count (ov23)', () => {
  const q = (people) => ({ town: 'Kiama', start: '2027-03-12', end: '2027-03-14', people, bedrooms: bedroomsFor(people) });
  for (const [n, rooms] of [[1, 1], [4, 2], [9, 5], [12, 6], [23, 12]]) {
    it(`${n} people → ${rooms} bedrooms on every site`, () => {
      const [b, a, s] = stayLinks(q(n));
      expect(b.url).toContain(`group_adults=${n}&no_rooms=${rooms}`);
      expect(a.url).toContain(`adults=${n}&min_bedrooms=${rooms}`);
      expect(s.url).toContain(`adults=${n}&minBedrooms=${rooms}`);
      if (n !== 12) for (const l of [b, a, s]) expect(l.url).not.toMatch(/adults=12&/); // never a default 12
    });
  }
});

describe('primary and backup weekends (ov23)', () => {
  const pool = [{ start: '2027-03-05', end: '2027-03-07' }, { start: '2027-03-12', end: '2027-03-14' }, { start: '2027-03-19', end: '2027-03-21' }];
  const points = { 'weekend:2027-03-12': 9, 'weekend:2027-03-19': 6, 'weekend:2027-03-05': 2 };
  it('ranks by the vote: the top is the primary, the next the backup', () => {
    expect(rankWeekends(pool, points).map((w) => w.start)).toEqual(['2027-03-12', '2027-03-19', '2027-03-05']);
    const s = settlePrimaryBackup({ weekends: pool, nights: 2 }, points);
    expect(s.weekends.map((w) => w.start)).toEqual(['2027-03-12', '2027-03-19']);
    expect(s.weekendPool).toBe(pool);
    expect(rolesLine(s.weekends)).toBe('Primary: Fri 12 – Sun 14 Mar; Backup: Fri 19 – Sun 21 Mar');
    expect(makePrimary(s.weekends, '2027-03-19').map((w) => w.start)).toEqual(['2027-03-19', '2027-03-12']);
  });
  it('the winning length resizes them (3 nights: the night on the Monday, or the Thursday)', () => {
    const s = settlePrimaryBackup({ weekends: pool, nights: 2 }, points, { nights: 3 });
    expect(s.weekends[0]).toMatchObject({ start: '2027-03-12', end: '2027-03-15', from: '2027-03-12' });
    const t = settlePrimaryBackup({ weekends: pool, nights: 2, extraNight: 'thu' }, points, { nights: 3 });
    expect(t.weekends[0]).toMatchObject({ start: '2027-03-11', end: '2027-03-14' });
    expect(fridayOf('2027-03-13')).toBe('2027-03-12');
    expect(resizeWeekend({ start: '2027-03-13', end: '2027-03-14' }, 2)).toMatchObject({ start: '2027-03-12', end: '2027-03-14' });
  });
  it('open it up: the next weekend from the vote as another backup', () => {
    const st = { weekendPool: pool, weekends: [pool[1], pool[2]], nights: 2 };
    const o = openUpWeekend(st, points);
    expect(o.added.start).toBe('2027-03-05');
    expect(o.weekends.length).toBe(3);
    expect(openUpWeekend({ ...st, weekends: pool }, points).added).toBe(null);
  });
  it('how long: a "How long?" question, and the leader', () => {
    expect(lengthSection({ on: true, options: [3, 1, 2] }).options.map((o) => [o.key, o.label])).toEqual([['nights:1', '1 night'], ['nights:2', '2 nights'], ['nights:3', '3 nights']]);
    expect(lengthSection({ on: true, options: [2] })).toBe(null);
    expect(lengthSection({ on: false, options: [1, 2] })).toBe(null);
    expect(leadingNights({ 'nights:2': 5, 'nights:3': 5 }, 2)).toBe(3);
    expect(leadingNights({}, 2)).toBe(2);
    expect(lengthLabel(0)).toBe('Day trip');
  });
});
