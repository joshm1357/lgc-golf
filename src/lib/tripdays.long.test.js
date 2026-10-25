// ov40 (Josh 25 Oct 19:34: "I just need it to have the golf on the right days and be working"): trips of 1–6 days,
// built the way the app builds them — the days, golf on each, the courses placed for each day's role, the trip's
// rounds — checked end to end on real-looking trips.
import { describe, it, expect } from 'vitest';
import * as TB from './tripbuilder.js';
import { planDays, applyGolfAmount, buildDay, startPoints, scheduleLine } from './dayplan.js';
import { setupRoundsFromShape } from './repeat.js';
import { cleanWishes } from './tripfit.js';

const innerWest = { label: 'Inner West', lat: -33.88, lng: 151.16, count: 8, leave: '06:00' };
const areas = {
  blueMtns: { stays: [{ key: 'Katoomba', name: 'Katoomba', lat: -33.71, lng: 150.31 }], courses: [
    { id: 'leura', name: 'Leura GC', lat: -33.72, lng: 150.33 }, { id: 'wentworth', name: 'Wentworth Falls CC', lat: -33.71, lng: 150.37 },
    { id: 'blackheath', name: 'Blackheath GC', lat: -33.63, lng: 150.28 }, { id: 'springwood', name: 'Springwood CC', lat: -33.70, lng: 150.56 }] },
  hunter: { stays: [{ key: 'Cessnock', name: 'Cessnock', lat: -32.83, lng: 151.36 }], courses: [
    { id: 'cess', name: 'Cessnock GC', lat: -32.84, lng: 151.35 }, { id: 'vint', name: 'The Vintage', lat: -32.76, lng: 151.33 },
    { id: 'kurri', name: 'Kurri Kurri GC', lat: -32.82, lng: 151.48 }, { id: 'hunterVal', name: 'Hunter Valley GC', lat: -32.70, lng: 151.37 },
    { id: 'maitland', name: 'Maitland GC', lat: -32.73, lng: 151.55 }] },
  melbourne: { stays: [{ key: 'Rosebud', name: 'Rosebud', lat: -38.36, lng: 144.9 }], courses: [
    { id: 'moonah', name: 'Moonah Links', lat: -38.41, lng: 144.84 }, { id: 'rosebud', name: 'Rosebud CC', lat: -38.38, lng: 144.92 },
    { id: 'portsea', name: 'Portsea GC', lat: -38.33, lng: 144.72 }, { id: 'nh', name: 'National Golf Club', lat: -38.40, lng: 144.87 }] },
};
// How the app builds a trip: newState → the weekend at that length → choose the area (prefill every day) → tee times.
function build(area, { start, nights, fly = false }) {
  const a = areas[area];
  const courseMap = Object.fromEntries(a.courses.map((c) => [c.id, c]));
  let st = { ...TB.newState(), nights, days: TB.resizeDays([], nights), weekends: [{ start, end: TB.addDays(start, nights) }], region: area, stays: a.stays,
    areaCourses: { [area]: a.courses.map((c) => c.id) }, courses: courseMap, dayPlan: { starts: fly ? [] : [innerWest] }, ...(fly ? { travel: 'fly' } : {}) };
  st = { ...st, days: TB.prefillStayDays(st.days, st.areaCourses[area], courseMap, { stays: a.stays, origin: innerWest, stayMax: 40, fly: TB.isFly(st) }) };
  return { st, courseMap };
}
function roundsOut(st, courseMap) {
  const days = planDays(st).filter((d) => d.golf !== 'none');
  // A tee time on every option, so the best configuration uses one course a day.
  const tees = days.flatMap((d) => d.options.map((id) => ({ play_date: d.date, course_id: id, times: ['11:00', '11:10'] })));
  const cfg = TB.buildConfigurations({ weekends: st.weekends, stays: st.stays, days: st.days, courses: courseMap, origin: innerWest, tees, needed: 2, stayMax: 40, detourMax: 25, fly: TB.isFly(st) })[0];
  const shape = TB.shapeFromConfig(cfg, { courseIds: Object.fromEntries(Object.keys(courseMap).map((k) => [k, k])), days: planDays(st) });
  const dates = Array.from({ length: st.nights + 1 }, (_, i) => TB.addDays(st.weekends[0].start, i));
  return { cfg, rows: setupRoundsFromShape(shape, dates.map((date) => ({ date, course_id: '', format: 'stableford' })), courseMap).filter((r) => r.course_id) };
}

describe('golf on the right days, every trip length', () => {
  it('1 day (a day trip): one round', () => {
    const { st, courseMap } = build('hunter', { start: '2027-03-13', nights: 0 });
    expect(planDays(st).map((d) => [d.leg, d.golf])).toEqual([['stay', '18']]);
    expect(roundsOut(st, courseMap).rows).toHaveLength(1);
  });
  it('2 days (Sat–Sun): golf both days — on the way up and on the way home', () => {
    const { st, courseMap } = build('blueMtns', { start: '2027-03-13', nights: 1 });
    expect(planDays(st).map((d) => [d.leg, d.golf, d.options.length > 0])).toEqual([['way', '18', true], ['home', '18', true]]);
    expect(roundsOut(st, courseMap).rows.map((r) => r.date)).toEqual(['2027-03-13', '2027-03-14']);
  });
  it('3 days (Fri–Sun, the Blue Mountains case): three rounds, not one', () => {
    const { st, courseMap } = build('blueMtns', { start: '2027-03-12', nights: 2 });
    expect(planDays(st).map((d) => d.role)).toEqual(['On the way there · 18 holes', 'Stay day · 18 holes', 'On the way home · 18 holes']);
    const { rows, cfg } = roundsOut(st, courseMap);
    expect(cfg.gaps).toBe(0);
    expect(rows.map((r) => r.date)).toEqual(['2027-03-12', '2027-03-13', '2027-03-14']);
    expect(new Set(rows.map((r) => r.course_id)).size).toBe(3); // a different course each day
  });
  it('4 days (the long weekend, fly to Melbourne): four rounds; flying → the stay courses on the travel days', () => {
    const { st, courseMap } = build('melbourne', { start: '2027-03-05', nights: 3, fly: true });
    const days = planDays(st);
    expect(days.map((d) => d.leg)).toEqual(['way', 'stay', 'stay', 'home']);
    expect(days.every((d) => d.golf === '18' && d.options.length)).toBe(true);
    expect(roundsOut(st, courseMap).rows).toHaveLength(4);
    // The day plan for the flying day: the flight, then golf near the stay, all in Melbourne's own clock.
    const b = buildDay(days[0], { st, courseMap, starts: startPoints(st), stays: st.stays, people: [], players: 8 });
    expect(b.plan.blocks.some((x) => /Flight/.test(x.label))).toBe(true);
    expect(b.plan.sun.offset).toBe(660);
  });
  it('6 days (Mon–Sat): six rounds; a spare day leaves the middle stay day free', () => {
    const { st, courseMap } = build('hunter', { start: '2027-03-08', nights: 5 });
    expect(planDays(st)).toHaveLength(6);
    const six = roundsOut(st, courseMap);
    expect(six.rows).toHaveLength(6);
    expect(six.cfg.repeats).toBeGreaterThan(0); // not enough courses in range for six — a repeat, and it says so
    const spare = applyGolfAmount(st, 'spare_day');
    expect(planDays(spare).map((d) => d.golf)).toEqual(['18', '18', 'none', '18', '18', '18']);
    expect(roundsOut(spare, courseMap).rows).toHaveLength(5);
    expect(spare.days[2].options.length).toBeGreaterThan(0); // the courses are kept for when it's switched back
  });
  it('as much golf as possible: 36 on stay days in summer daylight, 18 in winter', () => {
    const summer = applyGolfAmount(build('hunter', { start: '2027-01-15', nights: 2 }).st, 'max');
    expect(planDays(summer).map((d) => d.golf)).toEqual(['18', '36', '18']);
    const { courseMap } = build('hunter', { start: '2027-01-15', nights: 2 });
    expect(roundsOut(summer, courseMap).rows.map((r) => [r.date, !!r.second])).toEqual([['2027-01-15', false], ['2027-01-16', false], ['2027-01-16', true], ['2027-01-17', false]]);
    const winter = applyGolfAmount(build('hunter', { start: '2027-06-18', nights: 2 }).st, 'max');
    expect(planDays(winter).map((d) => d.golf)).toEqual(['18', '18', '18']);
  });
  it('a 2-day trip with a spare day: golf one day only', () => {
    const s = applyGolfAmount(build('blueMtns', { start: '2027-03-13', nights: 1 }).st, 'spare_day');
    expect(planDays(s).map((d) => d.golf)).toEqual(['18', 'none']);
  });
  it('the group’s answer sets the default, and the line names people only for the organiser', () => {
    const wishes = cleanWishes([{ player_id: 'a', golf_per_day: 'spare_day' }, { player_id: 'b', golf_per_day: 'spare_day' }, { player_id: 'c', golf_per_day: 'max' }, { player_id: 'd', golf_per_day: 'any' }]);
    expect(TB.golfAmountFromWishes(wishes)).toBe('spare_day');
    const { st } = build('hunter', { start: '2027-03-12', nights: 2 });
    const people = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));
    expect(scheduleLine(st, { people, wishes, nameOf: (id) => id.toUpperCase() })).toBe('3 rounds in 3 days — suits 2 · not for 2');
    expect(scheduleLine(st, { people, wishes, nameOf: (id) => id.toUpperCase(), names: true })).toBe('3 rounds in 3 days — suits 2 · Not for: A (wants a spare day), B (wants a spare day)');
  });
  it('changing the length keeps each day’s golf where the day is the same', () => {
    const { st } = build('hunter', { start: '2027-03-12', nights: 2 });
    const s = applyGolfAmount(st, 'spare_day'); // the stay day off
    const longer = TB.resizeDays(s.days, 3);
    expect(longer.map((d) => [d.leg, TB.dayGolf(d)])).toEqual([['way', '18'], ['stay', 'none'], ['stay', '18'], ['home', '18']]);
  });
});
