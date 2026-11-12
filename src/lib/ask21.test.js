// v2.1 (Josh 12 Nov, claude/round-ask-v2-1-rethink.md): ✓ / ✗ / ?, your week + date exceptions, tee times, leaving from,
// courses by drive, the Caddie box (phone phrases and the AI's fill, cleaned).
import { describe, it, expect } from 'vitest';
import {
  askCells, DEFAULT_ASK, weekFirst, weekRows, weeksOf, spanWords, statusOf, isException, setWeek, setDates, everythingElse,
  counts, slotsFrom, compress, stateFromAnswer, usualFrom2, stateFromUsual, nextStatus, teeWords, teeSplit, rankCells, decideReady,
  cleanFrom, fromFor, personDrive, rankCourses, fromDaysWords, cleanWhere2, quickFill, cleanFill, applyFill, fillContext, emptyState,
  YES, NO, MAYBE, rowKey, leaderLine, prefill,
} from './ask.js';

const TODAY = '2026-11-12'; // Thursday
const cells = askCells(DEFAULT_ASK, TODAY);

describe('the ask, v2.1 defaults', () => {
  it('every day, any time, next 4 weeks', () => {
    expect(cells.length).toBe(28 * 4);
    expect(weekRows(cells)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(weekFirst(DEFAULT_ASK, TODAY)).toBe(true);
    expect(spanWords(cells)).toBe('Fri 13 Nov – Thu 10 Dec');
  });
  it('short asks and picked dates go straight to the dates', () => {
    expect(weekFirst({ ...DEFAULT_ASK, range: { kind: 'next', days: 7 } }, TODAY)).toBe(false);
    expect(weekFirst({ ...DEFAULT_ASK, range: { kind: 'dates', dates: ['2026-11-21', '2026-12-05'] } }, TODAY)).toBe(false);
    expect(weekFirst({ ...DEFAULT_ASK, range: { kind: 'open' } }, TODAY)).toBe(true);
  });
  it('dates grouped by week (Monday first)', () => {
    const w = weeksOf(cells);
    expect(w[0]).toEqual({ monday: '2026-11-09', dates: ['2026-11-13', '2026-11-14', '2026-11-15'] });
    expect(w[1].monday).toBe('2026-11-16');
    expect(w[1].dates.length).toBe(7);
  });
});

describe('✓ / ✗ / ?', () => {
  it('every square starts ?; tap cycles ✓ → ✗ → ?', () => {
    expect(counts(cells, emptyState())).toEqual({ y: 0, n: 0, '?': 112 });
    expect([MAYBE, YES, NO].map(nextStatus)).toEqual([YES, NO, MAYBE]);
  });
  it('your week fills every date; a date can be an exception', () => {
    let st = setWeek(emptyState(), ['sat|arvo'], YES, cells);
    const sat21 = cells.find((c) => c.key === '2026-11-21|arvo');
    const sat28 = cells.find((c) => c.key === '2026-11-28|arvo');
    expect(statusOf(sat21, st)).toBe(YES);
    st = setDates(st, [sat28.key], NO, cells);
    expect(statusOf(sat28, st)).toBe(NO);
    expect(isException(sat28, st)).toBe(true);
    expect(isException(sat21, st)).toBe(false);
    // setting a date back to what the week says drops the exception
    st = setDates(st, [sat28.key], YES, cells);
    expect(st.dates[sat28.key]).toBeUndefined();
  });
  it('“Everything else ✗” only touches what’s still ?', () => {
    let st = setWeek(emptyState(), ['sat|arvo', 'sun|morning'], YES, cells);
    st = everythingElse(st, cells, NO);
    expect(counts(cells, st)).toEqual({ y: 8, n: 104, '?': 0 });
    expect(st.week['mon|early']).toBe(NO);
  });
  it('slots: ✓ as is, ? marked maybe, ✗ left out; notes narrow', () => {
    let st = setWeek(emptyState(), ['sat|arvo'], YES, cells);
    st = setWeek(st, ['sun|arvo'], NO, cells);
    const slots = slotsFrom(cells, st, { 'sat|morning': 'home by 12' });
    const sat = slots.filter((s) => s.date === '2026-11-21');
    expect(sat.find((s) => s.part === 'arvo')).toEqual({ date: '2026-11-21', from: '11:30', to: '15:00', part: 'arvo' });
    expect(sat.find((s) => s.part === 'early').maybe).toBe(true);
    expect(slots.some((s) => s.date === '2026-11-22' && s.part === 'arvo')).toBe(false);
    // "home by 12" on a ? morning rules it out (can't finish 18 by noon from 8)
    expect(sat.some((s) => s.part === 'morning')).toBe(false);
  });
  it('only ✓ counts toward a tee time; ? shows as maybe', () => {
    const yes = (id, t) => ({ player_id: id, first_at: `2026-11-12T0${t}:00:00Z`, slots: slotsFrom(cells, setWeek(emptyState(), ['sat|arvo'], YES, cells)) });
    const maybe = { player_id: 'm', first_at: '2026-11-12T09:00:00Z', slots: slotsFrom(cells, emptyState()) };
    const ranked = rankCells(cells, [yes('a', 1), yes('b', 2), yes('c', 3), maybe]);
    expect(ranked[0].can).toEqual(['a', 'b', 'c']);
    expect(ranked[0].maybe).toEqual(['m']);
    expect(leaderLine(ranked[0])).toBe('Sat 14 arvo · 3 can (+1 maybe)');
    expect(decideReady(ranked).ready).toBe(false);
    expect(decideReady(rankCells(cells, [yes('a', 1), yes('b', 2), yes('c', 3), yes('d', 4)])).ready).toBe(true);
  });
  it('a sent answer comes back as your week plus exceptions', () => {
    let st = setWeek(emptyState(), ['sat|arvo', 'fri|twilight'], YES, cells);
    st = setDates(st, ['2026-11-28|arvo'], NO, cells);
    const back = stateFromAnswer(cells, { slots: slotsFrom(cells, st) });
    expect(back.st.week['sat|arvo']).toBe(YES);
    expect(back.st.week['fri|twilight']).toBe(YES);
    expect(back.st.week['mon|early']).toBeUndefined(); // ?
    expect(back.st.dates).toEqual({ '2026-11-28|arvo': NO });
  });
  it('old ov43 answers (no maybe): anything not sent was can’t', () => {
    const back = stateFromAnswer(cells, { slots: [{ date: '2026-11-21', from: '11:30', to: '15:00', part: 'arvo' }] });
    expect(statusOf(cells.find((c) => c.key === '2026-11-21|arvo'), back.st)).toBe(YES);
    expect(back.st.week['mon|early']).toBe(NO);
  });
  it('the usual week is exactly the first view (and old ones still read)', () => {
    let st = setWeek(emptyState(), ['sat|arvo'], YES, cells);
    st = setWeek(st, ['mon|early'], NO, cells);
    const u = usualFrom2(cells, st, { 'sat|arvo': 'home by 5' });
    expect(u.week).toEqual({ 'sat|arvo': YES, 'mon|early': NO });
    expect(u.pattern).toEqual({ 'sat|arvo': true });
    expect(u.notes).toEqual({ 'sat|arvo': 'home by 5' });
    expect(stateFromUsual(u).st.week).toEqual({ 'sat|arvo': YES, 'mon|early': NO });
    expect(stateFromUsual({ pattern: { 'sun|morning': true } }).st.week).toEqual({ 'sun|morning': YES });
    // migration 111's "probably" reads pattern — still ✓ only
    expect(prefill(cells, u).picks.size).toBe(4);
  });
  it('compress keeps the odd date out as an exception', () => {
    const dates = Object.fromEntries(cells.filter((c) => c.part === 'arvo' && rowKey(c) === 'sat|arvo').map((c) => [c.key, YES]));
    dates['2026-11-28|arvo'] = NO;
    const st = compress(cells, { week: {}, dates });
    expect(st.week['sat|arvo']).toBe(YES);
    expect(st.dates).toEqual({ '2026-11-28|arvo': NO });
  });
});

describe('tee times (the group size is the answer)', () => {
  it('says it in tee times', () => {
    expect(teeWords(0)).toBe('Nobody yet');
    expect(teeWords(3)).toBe('3 can — 1 more for a 4-ball');
    expect(teeWords(4)).toBe('4 can → one tee time');
    expect(teeWords(6)).toBe('6 can → two tee times (3 + 3), or a 4 + 2 reserves');
    expect(teeWords(8)).toBe('8 can → two tee times');
    expect(teeWords(9)).toBe('9 can → three tee times (3 + 3 + 3), or 2 × 4 + 1 reserve');
    expect(teeWords(9, 8)).toBe('9 can → two tee times for 8 (the max) + 1 reserve');
    expect(teeSplit(7)).toEqual([4, 3]);
  });
});

describe('leaving from, and courses by drive', () => {
  const home = cleanFrom({ label: 'Leichhardt 2040', lat: -33.883, lng: 151.157, max_min: 30 });
  const work = cleanFrom({ label: 'North Sydney', lat: -33.839, lng: 151.207, max_min: 20, days: ['mon', 'tue', 'wed', 'thu', 'fri'] });
  const whereJ = { from: [home, work] };
  const moorePark = { id: 'mp', name: 'Moore Park', lat: -33.9, lng: 151.22 };
  const northRyde = { id: 'nr', name: 'North Ryde', lat: -33.79, lng: 151.13 };
  const wollongong = { id: 'w', name: 'Wollongong', lat: -34.43, lng: 150.9 };
  it('cleans a place (suburb only, no numbers) and says its days', () => {
    expect(home).toEqual({ label: 'Leichhardt', lat: -33.88, lng: 151.16, max_min: 30, days: [] });
    expect(fromDaysWords(work.days)).toBe('Weekdays');
    expect(fromDaysWords(['sat', 'sun'])).toBe('Weekends');
    expect(fromDaysWords(['mon', 'wed'])).toBe('Mon, Wed');
    expect(fromDaysWords([])).toBe('Any day');
    expect(cleanFrom({ label: '' })).toBeNull();
  });
  it('a place applies on its days only', () => {
    expect(fromFor(whereJ, '2026-11-21').map((f) => f.label)).toEqual(['Leichhardt']); // Saturday
    expect(fromFor(whereJ, '2026-11-18').map((f) => f.label)).toEqual(['Leichhardt', 'North Sydney']); // Wednesday
  });
  it('drive from the nearest place that day, flagged over the max', () => {
    const sat = personDrive(whereJ, northRyde, '2026-11-21');
    const wed = personDrive(whereJ, northRyde, '2026-11-18');
    expect(sat.label).toBe('Leichhardt');
    expect(wed.min).toBeLessThanOrEqual(sat.min);
    expect(personDrive(whereJ, wollongong, '2026-11-21').over).toBe(true);
    expect(personDrive({ from: [] }, northRyde)).toBeNull();
  });
  it('the organiser’s ranking: fewest over their max, then least total drive', () => {
    const people = [{ player_id: 'josh', where: whereJ }, { player_id: 'sam', where: { from: [cleanFrom({ label: 'Randwick', lat: -33.91, lng: 151.24, max_min: 20 })] } }];
    const r = rankCourses([wollongong, northRyde, moorePark], people, '2026-11-21');
    expect(r.map((x) => x.course.id)).toEqual(['mp', 'nr', 'w']);
    expect(r[2].over.sort()).toEqual(['josh', 'sam']);
    expect(r[0].known).toBe(2);
  });
  it('where keeps up to 3 places', () => {
    const w = cleanWhere2({ from: [home, work, home, work], avoid: ['Moore Park'] });
    expect(w.from.length).toBe(3);
    expect(w.any).toBe(true);
    expect(w.avoid).toEqual(['Moore Park']);
  });
});

describe('the Caddie box', () => {
  it('easy phrases fill on the phone', () => {
    const r = quickFill('fri arvos and any Sunday', cells, emptyState());
    expect(r.ok).toBe(true);
    expect(r.st.week['fri|arvo']).toBe(YES);
    expect(r.st.week['sun|early']).toBe(YES);
    expect(r.st.week['mon|arvo']).toBeUndefined();
  });
  it('“only” makes the rest ✗; “not” and “can’t” say ✗', () => {
    const r = quickFill('weekends only', cells, emptyState());
    expect(r.st.week['sat|early']).toBe(YES);
    expect(r.st.week['wed|arvo']).toBe(NO);
    const r2 = quickFill('any time except fridays', cells, emptyState());
    expect(r2.st.week['mon|early']).toBe(YES);
    expect(r2.st.week['fri|arvo']).toBe(NO);
    const r3 = quickFill('cant the 21st', cells, setWeek(emptyState(), ['sat|arvo'], YES, cells));
    expect(r3.ok).toBe(true);
    expect(statusOf(cells.find((c) => c.key === '2026-11-21|arvo'), r3.st)).toBe(NO);
    expect(statusOf(cells.find((c) => c.key === '2026-11-28|arvo'), r3.st)).toBe(YES);
  });
  it('anything messier goes to the AI', () => {
    expect(quickFill('any arvo except the 21st, Sundays home by 12, 9 holes fine', cells, emptyState()).ok).toBe(false);
    expect(quickFill('not Moore Park again', cells, emptyState()).ok).toBe(false);
    expect(quickFill('', cells, emptyState()).ok).toBe(false);
  });
  it('the AI’s fill is cleaned: only this ask’s dates and parts, short notes', () => {
    const ctx = fillContext(DEFAULT_ASK, TODAY);
    expect(ctx.dates[0]).toBe('2026-11-13 Fri');
    expect(ctx.parts.length).toBe(4);
    const dates = ctx.dates.map((d) => d.slice(0, 10));
    const f = cleanFill({
      week: [{ day: 'any', part: 'arvo', status: 'yes' }, { day: 'sunday', part: 'any', status: 'maybe' }, { day: 'blursday', part: 'arvo', status: 'yes' }],
      dates: [{ date: '2026-11-21', part: 'any', status: 'no' }, { date: '2027-01-01', part: 'arvo', status: 'yes' }],
      notes: [{ day: 'sun', part: 'any', note: 'home by 12 <script>' }],
      where: { from: [{ place: 'Leichhardt 2040', days: ['weekends'], max_drive_min: 45 }], avoid: ['Moore Park'], note: 'east' },
      said: 'Any arvo, not the 21st',
    }, { dates });
    expect(f.week.filter((w) => w.part === 'arvo' && w.status === YES).length).toBe(7);
    expect(f.week.filter((w) => w.day === 'sun' && w.status === MAYBE).length).toBe(4);
    expect(f.dates.length).toBe(4); // the 21st, all four parts; 2027 dropped
    expect(f.notes[0].note).toBe('home by 12 script');
    expect(f.where.from[0]).toEqual({ label: 'Leichhardt', days: ['sat', 'sun'], max_min: 45, lat: null, lng: null });
    expect(f.where.avoid).toEqual(['Moore Park']);
    const a = applyFill(f, cells, emptyState(), {});
    expect(statusOf(cells.find((c) => c.key === '2026-11-28|arvo'), a.st)).toBe(YES);
    expect(statusOf(cells.find((c) => c.key === '2026-11-21|arvo'), a.st)).toBe(NO);
    expect(isException(cells.find((c) => c.key === '2026-11-21|arvo'), a.st)).toBe(true);
    expect(a.notes['sun|early']).toBe('home by 12 script');
    expect(a.changed.length).toBeGreaterThan(20);
    expect(a.words[0]).toMatch(/^✓ \d+ squares$/);
    expect(cleanFill(null, { dates })).toEqual({ week: [], dates: [], notes: [], where: { from: [], avoid: [], like: [], note: '' }, said: '' });
  });
});
