import { describe, it, expect } from 'vitest';
import {
  km, driveMinutes, fmtDrive, drivesFor, searchBox, startsFromHomes, startsText, pickFacts, parseTimes, parseClock, weekday,
  defaultDay, assessCourse, rankCourses, findCourses, optionNotes, voteOptions, decidedCourse, cleanStart, num, yesNo,
} from './tripfinder.js';

const INNER_WEST = { label: 'Inner West', lat: -33.88, lng: 151.16, count: 8, leave: '06:00', finish: '17:00' };
const NEWCASTLE = { label: 'Newcastle', lat: -32.93, lng: 151.78, count: 4, leave: '06:00', finish: '17:00' };
const NOW = new Date('2026-10-21T10:00:00');
const SAT = '2026-11-14';
const fact = (f, value, extra = {}) => ({ fact: f, value, status: 'confirmed', checked_at: '2026-09-01', source: 'organiser', ...extra });
const course = (id, name, lat, lng, facts = [], extra = {}) => ({ id, name, area: `${name} NSW`, lat, lng, facts, ...extra });
const ctx = (extra = {}) => ({ starts: [INNER_WEST, NEWCASTLE], players: 12, holes: 18, day: SAT, maxDriveMin: 240, now: NOW, ...extra });

describe('distance and drive times', () => {
  it('straight line × 1.3 at 80 km/h', () => {
    expect(driveMinutes(100)).toBe(Math.round((130 / 80) * 60)); // 98 min
    expect(driveMinutes(0)).toBe(0);
    expect(km({ lat: -33.88, lng: 151.16 }, { lat: -33.88, lng: 151.16 })).toBe(0);
    const d = km(INNER_WEST, NEWCASTLE);
    expect(d).toBeGreaterThan(115);
    expect(d).toBeLessThan(125);
  });
  it('prints drives simply', () => {
    expect(fmtDrive(160)).toBe('2 h 40');
    expect(fmtDrive(45)).toBe('45 min');
    expect(fmtDrive(120)).toBe('2 h');
    expect(fmtDrive(65)).toBe('1 h 05');
  });
  it('longest drive and the per-person average', () => {
    const c = { lat: -33.88, lng: 151.16 };
    const d = drivesFor(c, [INNER_WEST, NEWCASTLE]);
    expect(d.longest.label).toBe('Newcastle');
    expect(d.list[0].min).toBe(0);
    expect(d.average).toBe(Math.round((0 * 8 + d.longest.min * 4) / 12));
  });
  it('the search box covers every starting point’s reach', () => {
    const b = searchBox([INNER_WEST, NEWCASTLE], 120);
    expect(b.south).toBeLessThan(INNER_WEST.lat);
    expect(b.north).toBeGreaterThan(NEWCASTLE.lat);
    expect(b.west).toBeLessThan(INNER_WEST.lng);
    expect(b.east).toBeGreaterThan(NEWCASTLE.lng);
    expect(searchBox([], 120)).toBe(null);
  });
});

describe('starting points from home suburbs', () => {
  it('groups nearby homes into areas, biggest first, labelled by the most common suburb', () => {
    const homes = [
      ...Array.from({ length: 5 }, () => ({ label: 'Leichhardt', lat: -33.88, lng: 151.16 })),
      { label: 'Annandale', lat: -33.88, lng: 151.17 }, { label: 'Leichhardt', lat: -33.89, lng: 151.15 },
      { label: 'Newcastle', lat: -32.93, lng: 151.78 }, { label: 'Merewether', lat: -32.95, lng: 151.75 },
      { label: 'Canberra', lat: -35.28, lng: 149.13 },
    ];
    const s = startsFromHomes(homes);
    // Newcastle and Merewether tie on one each: the first alphabetically names the area.
    expect(s.map((x) => [x.label, x.count])).toEqual([['Leichhardt', 7], ['Merewether', 2], ['Canberra', 1]]);
    expect(startsText(s)).toBe('Leichhardt ×7, Merewether ×2, Canberra ×1');
  });
  it('never more than 3 areas: the rest join the nearest', () => {
    const homes = [
      { label: 'A', lat: -33.88, lng: 151.16 }, { label: 'A', lat: -33.88, lng: 151.16 },
      { label: 'B', lat: -32.93, lng: 151.78 }, { label: 'B', lat: -32.93, lng: 151.78 },
      { label: 'C', lat: -35.28, lng: 149.13 }, { label: 'C', lat: -35.28, lng: 149.13 },
      { label: 'D', lat: -34.42, lng: 150.89 },
    ];
    const s = startsFromHomes(homes);
    expect(s).toHaveLength(3);
    expect(s.reduce((n, x) => n + x.count, 0)).toBe(7);
  });
  it('keeps places to about 1 km (2 decimals)', () => {
    const [s] = startsFromHomes([{ label: 'X', lat: -33.87654, lng: 151.12345 }]);
    expect(s.lat).toBe(-33.88);
    expect(s.lng).toBe(151.12);
  });
  it('cleanStart keeps the form tidy', () => {
    expect(cleanStart({ label: '  Inner West ', lat: -33.8812, lng: 151.1598, count: '8', leave: 'x' })).toEqual({ label: 'Inner West', lat: -33.88, lng: 151.16, count: 8, leave: '06:00', finish: '17:00' });
  });
});

describe('course facts', () => {
  it('a club’s word wins, then confirmed, then pending; newest within each', () => {
    const f = pickFacts([
      fact('max_group', '12', { status: 'pending', checked_at: '2026-10-01' }),
      fact('max_group', '16', { checked_at: '2026-01-01' }),
      fact('max_group', '20', { checked_at: '2025-12-01', club: true }),
      fact('price_18', '90', { status: 'pending', checked_at: '2026-01-01' }),
      fact('price_18', '95', { status: 'pending', checked_at: '2026-06-01' }),
    ], NOW);
    expect(f.max_group.value).toBe('20');
    expect(f.price_18.value).toBe('95');
    expect(f.price_18.pending).toBe(true);
  });
  it('facts older than 12 months say check again', () => {
    const f = pickFacts([fact('carts', 'Yes', { checked_at: '2025-09-01' }), fact('book_ahead', '6 weeks')], NOW);
    expect(f.carts.stale).toBe(true);
    expect(f.book_ahead.stale).toBe(false);
  });
  it('unknown facts and rejected rows are ignored', () => {
    expect(pickFacts([{ fact: 'who', value: 'x' }, fact('carts', 'no', { status: 'rejected' })], NOW)).toEqual({});
  });
  it('reads times', () => {
    expect(parseClock('7am')).toBe(420);
    expect(parseClock('1:30pm')).toBe(810);
    expect(parseClock('12pm')).toBe(720);
    expect(parseClock('13:00')).toBe(780);
    const t = parseTimes('Sat 7:00-12:00; Sun 9am–1pm; Mon-Fri 6:30-10:00; Weekends 14:00-16:00; rubbish');
    expect(t).toHaveLength(4);
    expect(t[0]).toEqual({ days: [6], from: 420, to: 720 });
    expect(t[1]).toEqual({ days: [0], from: 540, to: 780 });
    expect(t[2].days).toEqual([1, 2, 3, 4, 5]);
    expect(t[3].days).toEqual([0, 6]);
    expect(t.unread).toBe(1);
  });
  it('numbers and yes/no', () => {
    expect(num('$95')).toBe(95);
    expect(num('1,200')).toBe(1200);
    expect(num('call them')).toBe(null);
    expect(yesNo('Yes — lodge on site')).toBe(true);
    expect(yesNo('No')).toBe(false);
    expect(yesNo('maybe')).toBe(null);
  });
  it('days', () => {
    expect(weekday('2026-11-14')).toBe(6);
    expect(defaultDay({ start_date: '2027-03-12' })).toBe('2027-03-12');
    expect(defaultDay({}, new Date('2026-10-21T10:00:00'))).toBe('2026-10-24'); // Wednesday → that Saturday
    expect(defaultDay({}, new Date('2026-10-24T10:00:00'))).toBe('2026-10-31'); // a Saturday → the next one
  });
});

describe('assessCourse', () => {
  // Between Sydney and Newcastle: a fair middle.
  const central = course('c1', 'Central Coast', -33.3, 151.4, [
    fact('visitor_times', 'Sat 8:00-12:00'), fact('max_group', '16'), fact('price_18', '95'),
  ]);
  it('fits: says the window, the longest drive and the price', () => {
    const a = assessCourse(central, ctx());
    expect(a.status).toBe('fits');
    expect(a.why).toMatch(/^Fits \d{1,2}:\d{2}–\d{1,2}:\d{2} · longest drive about .+ · \$95$/);
    expect(a.takesGroup).toBe(true);
    expect(a.visitors).toBe(true);
    // The window is cut down to visitor times.
    expect(a.window.to).toBeLessThanOrEqual(12 * 60);
  });
  it('check: facts unknown (amber)', () => {
    const a = assessCourse(course('c2', 'Unknown GC', -33.3, 151.4), ctx());
    expect(a.status).toBe('check');
    expect(a.why).toMatch(/^Check visitor times and group size · tee off /);
  });
  it('doesn’t fit: too small for the group', () => {
    const a = assessCourse(course('c3', 'Small GC', -33.3, 151.4, [fact('max_group', '8')]), ctx());
    expect(a.status).toBe('no');
    expect(a.why).toBe('Doesn’t fit: takes groups up to 8');
  });
  it('doesn’t fit: no visitors that day, or outside the window', () => {
    expect(assessCourse(course('c4', 'X', -33.3, 151.4, [fact('visitor_times', 'Mon-Fri 7:00-15:00')]), ctx()).why).toBe('Doesn’t fit: no visitor times on Saturdays');
    expect(assessCourse(course('c5', 'Y', -33.3, 151.4, [fact('visitor_times', 'Sat 14:00-16:00')]), ctx()).why).toMatch(/^Doesn’t fit: visitors 2:00–4:00 — outside /);
  });
  it('doesn’t fit: members only for the whole window', () => {
    const a = assessCourse(course('c6', 'Z', -33.3, 151.4, [fact('member_times', 'Sat 6:00-14:00')]), ctx());
    expect(a.why).toBe('Doesn’t fit: members only for the whole window');
  });
  it('doesn’t fit: too far, or arrives too late', () => {
    const far = course('c7', 'Far', -36.5, 148.3);
    expect(assessCourse(far, ctx({ maxDriveMin: 180 })).why).toMatch(/^Doesn’t fit: longest drive about .+ \(Newcastle\) — over your 3 h limit$/);
    const late = assessCourse(course('c8', 'Late', -33.3, 151.4), ctx({ maxDriveMin: 0, starts: [INNER_WEST, { ...NEWCASTLE, leave: '11:00', finish: '14:00' }] }));
    expect(late.status).toBe('no');
    expect(late.why).toMatch(/^Doesn’t fit: Newcastle players arrive .+, too late for a 2 pm finish$/);
  });
  it('the course’s own interval and round length are used', () => {
    const a = assessCourse(course('c9', 'Q', -33.3, 151.4, [fact('start_interval', '8'), fact('round_length', '240')]), ctx());
    expect(a.teeWindow.interval).toBe(8);
    expect(a.teeWindow.roundMinutes).toBe(240);
    const nine = assessCourse(course('c9', 'Q', -33.3, 151.4, [fact('round_length', '240')]), ctx({ holes: 9 }));
    expect(nine.teeWindow.roundMinutes).toBe(120);
  });
  it('ratings: the group’s own first, then other groups (counts only)', () => {
    expect(assessCourse(course('r1', 'R', -33.3, 151.4, [], { mine_avg: 4.5, others_avg: 3, others_n: 4 }), ctx()).ratingText).toBe('your group rated 4.5');
    expect(assessCourse(course('r2', 'R', -33.3, 151.4, [], { others_avg: 3.25, others_n: 1 }), ctx()).ratingText).toBe('rated 3.3 by 1 other group');
  });
});

describe('rankCourses', () => {
  const near = course('near', 'Near GC', -33.6, 151.3, [fact('visitor_times', 'Sat 7:00-13:00'), fact('max_group', '20'), fact('price_18', '120')], { others_avg: 3, others_n: 2 });
  const middle = course('mid', 'Middle GC', -33.3, 151.4, [fact('visitor_times', 'Sat 7:00-13:00'), fact('max_group', '20'), fact('price_18', '80')], { mine_avg: 4.8 });
  const unknown = course('unk', 'Unknown GC', -33.4, 151.35);
  const tooSmall = course('small', 'Small GC', -33.35, 151.4, [fact('max_group', '4')]);
  const list = [unknown, tooSmall, near, middle];

  it('Fair drive (default): fits first, then the shortest longest-drive', () => {
    const r = findCourses(list, ctx());
    expect(r.map((a) => a.course.id)).toEqual(['mid', 'near', 'unk', 'small']);
    expect(r.map((a) => a.status)).toEqual(['fits', 'fits', 'check', 'no']);
  });
  it('Cheapest: price first (unknown last)', () => {
    expect(findCourses(list, ctx(), 'cheap').slice(0, 2).map((a) => a.course.id)).toEqual(['mid', 'near']);
  });
  it('Best course: rating first', () => {
    expect(findCourses(list, ctx(), 'best').slice(0, 2).map((a) => a.course.id)).toEqual(['mid', 'near']);
    expect(findCourses([near, course('mid2', 'M2', -33.3, 151.4, near.facts, { others_avg: 4 })], ctx(), 'best')[0].course.id).toBe('mid2');
  });
  it('filters', () => {
    const all = list.map((c) => assessCourse(c, ctx()));
    expect(rankCourses(all, 'fair', { fitsOnly: true }).map((a) => a.course.id)).toEqual(['mid', 'near']);
    expect(rankCourses(all, 'fair', { maxPrice: 100 }).map((a) => a.course.id)).toEqual(['mid', 'unk', 'small']);
    expect(rankCourses(all, 'fair', { favourites: true }).map((a) => a.course.id)).toEqual(['mid']);
    expect(rankCourses(all, 'fair', { takesGroup: true }).map((a) => a.course.id)).toEqual(['mid', 'near']);
    const played = rankCourses([assessCourse({ ...near, played: true }, ctx()), assessCourse(middle, ctx())], 'fair', { notPlayed: true });
    expect(played.map((a) => a.course.id)).toEqual(['mid']);
  });
  it('courses with no location are left out', () => {
    expect(findCourses([{ id: 'x', name: 'Nowhere', lat: null, lng: null }], ctx())).toEqual([]);
  });
});

describe('options to the group', () => {
  const a = assessCourse(course('c1', 'Central Coast', -33.3, 151.4, [fact('visitor_times', 'Sat 8:00-12:00'), fact('max_group', '16'), fact('price_18', '95'), fact('book_ahead', '6 weeks')]), ctx());
  it('notes carry the facts', () => {
    const n = optionNotes(a);
    expect(n).toMatch(/^Fits .+ · longest drive about .+ · average about .+ · visitors Sat 8:00-12:00 · groups up to 16 · book 6 weeks ahead$/);
  });
  it('one option per ticked course, at most 3', () => {
    const o = voteOptions([a, a, a, a], { day: SAT });
    expect(o).toHaveLength(3);
    expect(o[0]).toMatchObject({ course_id: 'c1', label: 'Central Coast', address: 'Central Coast NSW', cost_pp: 95, start_date: SAT });
  });
  it('the decided course: just decided, or the place vote’s winner', () => {
    expect(decidedCourse({ decided_course_id: 'c9', picks: [] }, [])).toBe('c9');
    const find = { picks: [{ course_id: 'c1', option_id: 'o1' }, { course_id: 'c2', option_id: 'o2' }] };
    expect(decidedCourse(find, [{ kind: 'location', winner_option_id: 'o2' }])).toBe('c2');
    expect(decidedCourse(find, [{ kind: 'location', winner_option_id: null }])).toBe(null);
    expect(decidedCourse(null, [])).toBe(null);
  });
});
