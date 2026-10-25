import { describe, it, expect } from 'vitest';
import { planDays, startPoints, snapStarts, buildDay, applyPick, setDay, bestSlot, feeFor, pickLine, dayGolfLength, travelOf, dayCourses } from './dayplan.js';
import { cleanWishes } from './tripfit.js';

const stay = { key: 'Cessnock', name: 'Cessnock', lat: -32.83, lng: 151.36 };
const courseMap = {
  cess: { id: 'cess', name: 'Cessnock GC', lat: -32.84, lng: 151.35 },
  vint: { id: 'vint', name: 'The Vintage', lat: -32.76, lng: 151.33, mine_avg: 4.5 },
  kurri: { id: 'kurri', name: 'Kurri Kurri GC', lat: -32.82, lng: 151.48 },
  far: { id: 'far', name: 'Port Macquarie GC', lat: -31.43, lng: 152.9 },
};
const st = {
  nights: 2, weekends: [{ start: '2027-03-12', end: '2027-03-14' }], region: 'Hunter Valley', stays: [stay],
  areaCourses: { 'Hunter Valley': ['cess', 'vint', 'kurri', 'far'] }, stayMax: 40, detourMax: 25,
  days: [{ index: 0, leg: 'way', options: ['kurri'] }, { index: 1, leg: 'stay', options: ['vint', 'cess'] }, { index: 2, leg: 'home', options: [], golf: 'none' }],
  dayPlan: { starts: [{ label: 'Inner West', lat: -33.88, lng: 151.16, count: 8, leave: '06:00' }] },
};
const players = { a: 'Al', b: 'Bo', c: 'Cy', d: 'Di' };
const people = Object.entries(players).map(([id, name]) => ({ id, name }));
const nameOf = (id) => players[id];

describe('the days', () => {
  it('each day with its date, role and golf', () => {
    const d = planDays(st);
    expect(d.map((x) => [x.date, x.leg, x.golf, x.last])).toEqual([['2027-03-12', 'way', '18', false], ['2027-03-13', 'stay', '18', false], ['2027-03-14', 'home', 'none', true]]);
    expect(d[0].role).toBe('On the way there · 18 holes');
  });
  it('starting points: the snapshot, else the origin', () => {
    expect(startPoints(st)[0].label).toBe('Inner West');
    expect(startPoints({ origin: { lat: 1, lng: 2, label: 'Inner West ×8, Newcastle ×2' } })).toEqual([{ label: 'Inner West', lat: 1, lng: 2, count: null }]);
    expect(snapStarts([{ label: 'Inner West', lat: -33.8812, lng: 151.1634, headcount: 8, leave_after: '05:30' }])).toEqual([{ label: 'Inner West', lat: -33.88, lng: 151.16, count: 8, leave: '05:30' }]);
  });
  it('golf length per day: 36 = two rounds and lunch; 9 holes half', () => {
    const [d0, d1] = planDays(st);
    expect(dayGolfLength(st, d0, 8).total).toBe(280);
    expect(dayGolfLength(st, { ...d1, golf: '36' }, 8)).toMatchObject({ total: 280 * 2 + 45, two: true });
    expect(dayGolfLength(st, { ...d1, golf: '9' }, 4).total).toBe(135);
    expect(dayGolfLength(st, { ...d1, last: true }, 4).total).toBe(240); // Ambrose on the last day
  });
  it('travel: flying from the trip idea', () => {
    expect(travelOf({ travel: 'fly' }).mode).toBe('fly');
    expect(travelOf({}).mode).toBe('drive');
  });
});

describe('placing courses for a day', () => {
  it('the day’s own courses first, then others that fit its role; far ones are left out', () => {
    const d1 = planDays(st)[1];
    const list = dayCourses(d1, { st, courseMap, starts: startPoints(st), stays: [stay] });
    expect(list.slice(0, 2).every((x) => x.onDay)).toBe(true);
    expect(list.map((x) => x.course.id)).toContain('kurri');
    expect(list.map((x) => x.course.id)).not.toContain('far');
  });
});

describe('one day built', () => {
  const social = { vint: { weekends: 'Sat after 11' }, cess: { weekends: 'Sat 7-8:30am' }, kurri: { weekdays: 'after 11' } };
  const research = { vint: { fee_weekend: 129, fee_weekday: 99, details: { style: 'parkland' } } };
  const booking = { vint: { booking_method: 'online', booking_url: 'https://vintage.example', max_group: 24 } };
  it('Saturday: the course times that fit, fit lines and who it doesn’t suit', () => {
    const wishes = cleanWishes([{ player_id: 'a', day_prefs: { sat: 'morning_free' } }, { player_id: 'b', day_prefs: { sat: 'morning_free' } }, { player_id: 'c', day_prefs: { sat: 'early' } }]);
    const b = buildDay(planDays(st)[1], { st, courseMap, booking, social, research, starts: startPoints(st), stays: [stay], wishes, people, nameOf, players: 8 });
    expect(b.prefs).toHaveLength(3);
    const vint = b.rows.find((r) => r.id === 'vint');
    expect(vint.times).toBe('after 11am');
    expect(vint.fee).toBe('about $129');
    expect(vint.style).toBe('parkland');
    expect(vint.maxGroup).toBe('up to 24');
    expect(vint.book).toBe('Online');
    expect(vint.best.tee).toBeGreaterThanOrEqual(11 * 60 + 30); // suits "morning free" (2 people)
    expect(vint.fitLine).toMatch(/^suits 3 of 4 · tee 1[12]:\d\d[ap]m suits “morning free” \(2\) · \d h( \d\d)? before dusk$/);
    expect(vint.notForLine).toBe('Not for: Cy (wanted “play early”)');
    const cess = b.rows.find((r) => r.id === 'cess');
    expect(cess.times).toBe('7am–8:30am');
    expect(cess.best.suitsN).toBe(1); // the early one
    expect(b.rows[0].id).toBe('vint'); // suits the most wishes → first
  });
  it('Friday on the way: too early to make it from home when the window closes early', () => {
    const s2 = { ...st, days: [{ index: 0, leg: 'way', options: ['cess'] }, ...st.days.slice(1)] };
    const b = buildDay(planDays(s2)[0], { st: s2, courseMap, social: { cess: { weekdays: '7-8am' } }, starts: startPoints(s2), stays: [stay], people, nameOf, players: 8 });
    const cess = b.rows.find((r) => r.id === 'cess');
    expect(cess.reason).toBe('too early to make it');
    expect(cess.fitLine).toBe('Doesn’t fit: too early to make it');
    expect(b.plan.blocks[0].kind).toBe('travel');
  });
  it('unknown times say "ring to check"', () => {
    const b = buildDay(planDays(st)[0], { st, courseMap, starts: startPoints(st), stays: [stay], people, nameOf });
    expect(b.rows.find((r) => r.id === 'kurri').times).toBe('ring to check');
  });
  it('a pick shows on the timeline', () => {
    const s2 = { ...st, dayPlan: { ...st.dayPlan, picks: { 1: { course_id: 'vint', tee: '12:30' } } } };
    const b = buildDay(planDays(s2)[1], { st: s2, courseMap, social, starts: startPoints(s2), stays: [stay], people, nameOf, players: 8 });
    expect(b.plan.blocks.some((x) => x.kind === 'golf' && x.from === 12 * 60 + 30)).toBe(true);
    expect(pickLine(s2.dayPlan.picks[1], courseMap, 280)).toBe('The Vintage, about 12:30pm (finish about 5:10pm)');
  });
});

describe('the organiser picks', () => {
  it('puts the course on the day and keeps the pick', () => {
    const d0 = planDays(st)[0];
    const { state, full } = applyPick(st, d0, { course: courseMap.cess, tee: '11:30' });
    expect(full).toBe(false);
    expect(state.days[0].options).toEqual(['kurri', 'cess']);
    expect(state.dayPlan.picks[0]).toEqual({ course_id: 'cess', tee: '11:30' });
    expect(state.courses.cess.name).toBe('Cessnock GC');
    expect(state.dayPlan.starts).toEqual(st.dayPlan.starts);
    expect(applyPick(state, d0, { course: null }).state.dayPlan.picks[0]).toBe(undefined);
  });
  it('a full day says so', () => {
    const s2 = { ...st, days: [{ index: 0, leg: 'way', options: ['a', 'b', 'c', 'd'] }] };
    expect(applyPick(s2, planDays(s2)[0], { course: courseMap.cess, tee: '11:30' }).full).toBe(true);
  });
  it('changes a day’s golf and travel', () => {
    const d0 = planDays(st)[0];
    const a = setDay(st, d0, { golf: '36' });
    expect(a.days[0]).toMatchObject({ golf: '36', options: ['kurri'] });
    const b = setDay(a, d0, { travel: false });
    expect(planDays(b)[0].leg).toBe('stay');
    expect(planDays(setDay(b, d0, { travel: true }))[0].leg).toBe('way');
  });
});

describe('small helpers', () => {
  it('best slot: most wishes, then clear of dusk', () => {
    expect(bestSlot([{ tee: 1, suitsN: 0, flag: { tone: 'tight' } }, { tee: 2, suitsN: 0, flag: { tone: 'ok' } }]).tee).toBe(2);
    expect(bestSlot([{ tee: 1, suitsN: 2, flag: { tone: 'tight' } }, { tee: 2, suitsN: 1, flag: { tone: 'ok' } }]).tee).toBe(1);
    expect(bestSlot([])).toBe(null);
  });
  it('green fee by weekday or weekend', () => {
    expect(feeFor({ fee_weekday: 45, fee_weekend: 50 }, 6)).toBe(50);
    expect(feeFor({ fee_weekday: 45, fee_weekend: 50 }, 3)).toBe(45);
    expect(feeFor({ fee_weekday: 45 }, 0)).toBe(45);
    expect(feeFor(null, 0)).toBe(null);
  });
});
