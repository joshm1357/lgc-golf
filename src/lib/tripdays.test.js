// ov40: golf on each day (Josh 25 Oct: "the Blue Mountains one is only one round, but it should be each day").
import { describe, it, expect } from 'vitest';
import * as TB from './tripbuilder.js';
import { setupRoundsFromShape } from './repeat.js';

const stay = { key: 'Katoomba', name: 'Katoomba', lat: -33.71, lng: 150.31 };
const origin = { lat: -33.88, lng: 151.16, label: 'Inner West ×8' };
const courses = {
  leura: { id: 'leura', name: 'Leura GC', lat: -33.72, lng: 150.33 },
  wentworth: { id: 'wentworth', name: 'Wentworth Falls CC', lat: -33.71, lng: 150.37 },
  springwood: { id: 'springwood', name: 'Springwood CC', lat: -33.70, lng: 150.56 }, // on the way up
};

describe('golf on each day', () => {
  it('defaults: 18 holes, the first and last days are travel days', () => {
    const days = TB.tripDays(2);
    expect(days.map(TB.dayGolf)).toEqual(['18', '18', '18']);
    expect(days.map(TB.dayLeg)).toEqual(['way', 'stay', 'home']);
    expect(TB.dayRoleLine(days[0])).toBe('On the way there · 18 holes');
    expect(TB.dayRounds({ golf: '36' })).toBe(2);
    expect(TB.dayRounds({ golf: 'none' })).toBe(0);
    expect(TB.dayLeg({ leg: 'way', travel: false })).toBe('stay');
  });
  it('the Blue Mountains case: a 2-night trip fills all three days, not just Saturday', () => {
    // What live had (25 Oct): way [] · stay [3 courses] · home [] → only one round could ever come out.
    const days = TB.prefillStayDays(TB.newState().days, ['leura', 'wentworth', 'springwood'], courses, { stays: [stay], origin });
    expect(days.every((d) => d.options.length > 0)).toBe(true);
    expect(days[0].options).toContain('springwood'); // on the drive up
    expect(days[1].options[0]).toBe('leura'); // closest to where we stay
  });
  it('old saved trips with empty travel days are spotted', () => {
    expect(TB.daysNeedFilling([{ index: 0, leg: 'way', options: [] }, { index: 1, leg: 'stay', options: ['a'] }, { index: 2, leg: 'home', options: [] }])).toBe(true);
    expect(TB.daysNeedFilling([{ index: 0, leg: 'way', options: [], golf: 'none' }, { index: 1, leg: 'stay', options: ['a'] }])).toBe(false);
    expect(TB.daysNeedFilling([{ index: 0, leg: 'way', options: [] }])).toBe(false); // nothing chosen yet at all
  });
  it('resizing keeps each day’s golf', () => {
    const d = TB.resizeDays([{ index: 0, leg: 'way', options: ['a'], golf: 'none' }, { index: 1, leg: 'stay', options: [], golf: '36' }], 3);
    expect(d[0]).toMatchObject({ golf: 'none', options: ['a'] });
    expect(d[1]).toMatchObject({ golf: '36' });
    expect(d[3].golf).toBe(undefined);
  });
  it('configurations skip no-golf days (not a gap) and a 36-hole day makes two rounds', () => {
    const weekends = [{ start: '2027-03-12', end: '2027-03-14' }];
    const days = [{ index: 0, leg: 'way', options: ['springwood'], golf: 'none' }, { index: 1, leg: 'stay', options: ['leura'], golf: '36' }, { index: 2, leg: 'home', options: ['wentworth'] }];
    const tees = [{ play_date: '2027-03-13', course_id: 'leura', times: ['08:00'] }, { play_date: '2027-03-14', course_id: 'wentworth', times: ['09:00'] }];
    const configs = TB.buildConfigurations({ weekends, stays: [stay], days, courses, origin, tees, needed: 1 });
    expect(configs[0].gaps).toBe(0);
    expect(configs[0].rounds.map((r) => r.index)).toEqual([1, 2]);
    const shape = TB.shapeFromConfig(configs[0], { courseIds: { leura: 'L', wentworth: 'W' }, formats: ['stableford', 'stableford', 'ambrose'], days });
    expect(shape.rounds.map((r) => [r.day, r.course_id, !!r.second, r.format])).toEqual([[1, 'L', false, 'stableford'], [1, 'L', true, 'stableford'], [2, 'W', false, 'ambrose']]);
    const rows = setupRoundsFromShape(shape, ['2027-03-12', '2027-03-13', '2027-03-14'].map((date) => ({ date, course_id: '', format: 'stableford' })), { L: {}, W: {} });
    expect(rows.map((r) => [r.date, r.course_id, !!r.second])).toEqual([['2027-03-12', '', false], ['2027-03-13', 'L', false], ['2027-03-13', 'L', true], ['2027-03-14', 'W', false]]);
  });
  it('call jobs leave out no-golf days', () => {
    const jobs = TB.callJobs({ days: [{ index: 0, leg: 'way', options: ['springwood'], golf: 'none' }, { index: 1, leg: 'stay', options: ['leura'] }], weekends: [{ start: '2027-03-12' }], courses, stays: [stay] });
    expect(jobs.map((j) => j.course_id)).toEqual(['leura']);
  });
});
