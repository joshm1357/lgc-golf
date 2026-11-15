// ov44 — daylight where the players are (claude/round-door-addendum.md piece 5).
import { describe, it, expect } from 'vitest';
import {
  dayLight, partWindow, sunLine, sunLines, askCells, cleanAsk, askPlace, cleanPlace, zonePlace, nearestCity, placeName,
  slotsFrom, stateFromAnswer, rankCells, overlaps, weekRows, cellWords, fillContext, CITIES, YES, ASK_PART_KEYS,
} from './ask.js';

const city = (n) => CITIES.find((c) => c.name === n);
const SYD = city('Sydney'); const MEL = city('Melbourne'); const PER = city('Perth');
const win = (d, p) => Object.fromEntries(ASK_PART_KEYS.map((k) => [k, partWindow(d, k, p)]));

describe('daylight per date at the ask’s place', () => {
  it('Sydney, 20 June: sunrise 7:00, sunset 4:54, last tee for 18 about 12:20', () => {
    expect(sunLine('2026-06-20', SYD)).toBe('Sat 20 Jun · sunrise 7:00 · sunset 4:54 · last tee for 18 about 12:20');
    const dl = dayLight('2026-06-20', SYD);
    expect(dl.earliest).toBe(6 * 60 + 50); // sunrise less 10 minutes
    expect(dl.last9).toBe(14 * 60 + 35);
    expect(win('2026-06-20', SYD)).toEqual({
      early: { from: '06:50', to: '07:59' }, morning: { from: '08:00', to: '11:29' },
      arvo: { from: '11:30', to: '12:20' }, twilight: { from: '13:40', to: '15:10' },
    });
  });
  it('Melbourne, 20 June: the sun’s up at 7:35, so Early starts 7:25', () => {
    expect(sunLine('2026-06-20', MEL)).toBe('Sat 20 Jun · sunrise 7:35 · sunset 5:08 · last tee for 18 about 12:35');
    expect(partWindow('2026-06-20', 'early', MEL)).toEqual({ from: '07:25', to: '07:59' });
    expect(partWindow('2026-06-20', 'arvo', MEL)).toEqual({ from: '11:30', to: '12:35' });
  });
  it('Perth, 20 December: its own clock and its own sunset (7:21, not Sydney’s 8:05)', () => {
    expect(sunLine('2026-12-20', PER)).toBe('Sun 20 Dec · sunrise 5:07 · sunset 7:21 · last tee for 18 about 2:50');
    expect(partWindow('2026-12-20', 'early', PER)).toEqual({ from: '06:00', to: '07:59' }); // never before 6:00
    expect(partWindow('2026-12-20', 'arvo', PER)).toEqual({ from: '11:30', to: '14:50' });
    expect(partWindow('2026-12-20', 'arvo', SYD)).toEqual({ from: '11:30', to: '15:00' });
    expect(partWindow('2026-12-20', 'twilight', PER).from).not.toBe(partWindow('2026-12-20', 'twilight', SYD).from);
  });
  it('Sydney, 28 November: summer — nothing is trimmed', () => {
    expect(win('2026-11-28', SYD)).toEqual({
      early: { from: '06:00', to: '07:59' }, morning: { from: '08:00', to: '11:29' },
      arvo: { from: '11:30', to: '15:00' }, twilight: { from: '16:35', to: '18:05' },
    });
  });
  it('the two daylight saving weekends: the clock moves an hour overnight', () => {
    const a = dayLight('2026-10-03', SYD); const b = dayLight('2026-10-04', SYD); // clocks forward
    expect(b.sunset - a.sunset).toBeGreaterThanOrEqual(60);
    expect(b.sunset - a.sunset).toBeLessThanOrEqual(62);
    expect(partWindow('2026-10-03', 'arvo', SYD).to).toBe('13:25');
    expect(partWindow('2026-10-04', 'arvo', SYD).to).toBe('14:30');
    expect(partWindow('2026-10-04', 'early', SYD).from).toBe('06:20');
    const c = dayLight('2027-04-03', SYD); const d = dayLight('2027-04-04', SYD); // clocks back
    expect(c.sunset - d.sunset).toBeGreaterThanOrEqual(60);
    expect(partWindow('2027-04-03', 'early', SYD).from).toBe('07:00');
    expect(partWindow('2027-04-04', 'early', SYD).from).toBe('06:00');
    // Brisbane has no daylight saving: no jump.
    const q = city('Brisbane');
    expect(Math.abs(dayLight('2026-10-04', q).sunset - dayLight('2026-10-03', q).sunset)).toBeLessThan(3);
  });
  it('9 holes when 18 won’t fit, and not offered when the sun isn’t up', () => {
    const south = { lat: -58, lng: 141.5 }; // far south, mid-winter: sunrise 9:22, sunset 3:49
    expect(dayLight('2026-06-20', south)).toMatchObject({ earliest: 9 * 60 + 15, last18: 11 * 60 + 15, last9: 13 * 60 + 30 });
    expect(partWindow('2026-06-20', 'early', south)).toBeNull(); // dark until after 8
    expect(partWindow('2026-06-20', 'morning', south)).toEqual({ from: '09:15', to: '11:15' }); // starts late, trimmed
    expect(partWindow('2026-06-20', 'arvo', south)).toEqual({ from: '11:30', to: '13:30', nine: true }); // 18 won't fit, 9 does
    const cells = askCells({ range: { kind: 'dates', dates: ['2026-06-20'] }, place: south }, '2026-06-01');
    expect(cells.map((c) => c.part)).toEqual(['morning', 'arvo', 'twilight']);
    expect(cellWords(cells.find((c) => c.part === 'arvo'))).toBe('Sat 20 arvo (9 holes)');
  });
  it('the line above the dates, and what changes by the end of a long ask', () => {
    const l = sunLines(['2026-11-16', '2026-12-13'], SYD);
    expect(l.line).toBe('Mon 16 Nov · sunrise 5:43 · sunset 7:37 · last tee for 18 about 3:05');
    expect(l.later).toBe('By Sun 13 Dec: sunset 8:01, last tee for 18 about 3:30');
    expect(sunLines(['2026-11-16', '2026-11-17'], SYD).later).toBe('');
    expect(sunLines([], SYD)).toEqual({ line: '', later: '' });
  });
});

describe('the ask’s place', () => {
  it('course, else leaving from, else home, else the phone’s clock, else Sydney', () => {
    const course = { lat: -33.9, lng: 151.22, name: 'Moore Park' };
    const from = [{ label: 'Ryde', lat: -33.81, lng: 151.1 }];
    const home = { lat: -33.88, lng: 151.15 };
    expect(askPlace({ course, from, home, zone: 'Australia/Perth' })).toEqual({ lat: -33.9, lng: 151.2, name: 'Moore Park', src: 'course' });
    expect(askPlace({ from, home, zone: 'Australia/Perth' })).toEqual({ lat: -33.8, lng: 151.1, name: 'Ryde', src: 'from' });
    expect(askPlace({ from: [{ label: 'No spot yet' }], home, zone: 'Australia/Perth' }).src).toBe('home');
    expect(askPlace({ zone: 'Australia/Perth' })).toEqual({ lat: -31.9, lng: 115.9, name: 'Perth', src: 'zone' }); // -31.95 → the nearest 0.1°
    expect(askPlace({ zone: 'Europe/London' })).toEqual({ lat: -33.9, lng: 151.2, name: 'Sydney', src: 'default' });
    expect(askPlace({ picked: { lat: -37.81, lng: 144.96, name: 'Melbourne' }, course }).src).toBe('picked');
  });
  it('a home area is named by its city, never the suburb (it may not be shared), and kept to about 10 km', () => {
    const p = askPlace({ home: { lat: -33.8812, lng: 151.1567, label: 'Leichhardt' } });
    expect(p).toEqual({ lat: -33.9, lng: 151.2, name: 'Sydney', src: 'home' });
    expect(askPlace({ home: { lat: -30.3, lng: 153.1 } }).name).toBe('your area'); // Coffs Harbour: no city within 150 km
    expect(nearestCity({ lat: -37.9, lng: 145.1 })).toBe('Melbourne');
  });
  it('time zones → cities', () => {
    expect(zonePlace('Australia/Melbourne').name).toBe('Melbourne');
    expect(zonePlace('Australia/Hobart').name).toBe('Hobart');
    expect(zonePlace('Australia/Lindeman').name).toBe('Brisbane');
    expect(zonePlace('Pacific/Auckland')).toBeNull();
    expect(zonePlace(null)).toBeNull();
  });
  it('is kept inside the ask (no column), cleaned', () => {
    const a = cleanAsk({ range: { kind: 'next', days: 14 }, place: { lat: -31.953, lng: 115.857, name: ' Perth <b> ', src: 'zone', extra: 1 } });
    expect(a.place).toEqual({ lat: -32, lng: 115.9, name: 'Perth  b', src: 'zone' });
    expect(cleanAsk({ range: { kind: 'next', days: 14 } })).toEqual({ days: [], parts: [], range: { kind: 'next', days: 14 }, times: [] }); // older asks: no place
    expect(cleanPlace({ lat: 'x', lng: 1 })).toBeNull();
    expect(cleanPlace({ lat: null, lng: null })).toBeNull();
    expect(placeName(a.place)).toBe('Perth  b');
    expect(placeName(null)).toBe('Sydney');
  });
  it('an ask with a place uses it for every square; the AI is told the same windows', () => {
    const ask = cleanAsk({ range: { kind: 'dates', dates: ['2026-06-20'] }, place: { ...MEL, name: 'Melbourne' } });
    const cells = askCells(ask, '2026-06-01');
    expect(cells.find((c) => c.part === 'early')).toMatchObject({ key: '2026-06-20|early', from: '07:25', to: '07:59' });
    expect(cells.find((c) => c.part === 'arvo')).toMatchObject({ from: '11:30', to: '12:35' });
    expect(fillContext(ask, '2026-06-01').parts).toContain('early 07:25–07:59');
  });
});

describe('answers saved before the daylight change still match', () => {
  const ask = { range: { kind: 'dates', dates: ['2026-06-20', '2026-06-21'] } }; // an older ask: no place → Sydney
  const cells = askCells(ask, '2026-06-01');
  // What the app saved before ov44: the fixed windows.
  const old = { player_id: 'old', first_at: '2026-06-01T00:00:00Z', cant: false, slots: [
    { date: '2026-06-20', from: '06:00', to: '07:59', part: 'early' },
    { date: '2026-06-20', from: '11:30', to: '15:00', part: 'arvo' },
    { date: '2026-06-21', from: '08:00', to: '11:29', part: 'morning', maybe: true },
  ] };
  it('the saved key is still date + part', () => {
    expect(cells.map((c) => c.key)).toContain('2026-06-20|arvo');
    expect(weekRows(cells)).toEqual(['sat', 'sun']);
  });
  it('an old answer comes back onto the same squares', () => {
    const { st } = stateFromAnswer(cells, old, { weekView: false });
    expect(st.dates['2026-06-20|early']).toBe(YES);
    expect(st.dates['2026-06-20|arvo']).toBe(YES);
    expect(st.dates['2026-06-21|morning']).toBe('?');
    expect(st.dates['2026-06-20|morning']).toBe('n');
  });
  it('an old answer and a new one match on the trimmed square (the database matches the same way: overlap)', () => {
    const arvo = cells.find((c) => c.key === '2026-06-20|arvo');
    expect(arvo).toMatchObject({ from: '11:30', to: '12:20' });
    const { st } = stateFromAnswer(cells, { slots: [] }, { weekView: false });
    st.dates['2026-06-20|arvo'] = YES;
    const fresh = { player_id: 'new', first_at: '2026-06-02T00:00:00Z', cant: false, slots: slotsFrom(cells, st) };
    expect(fresh.slots).toEqual([{ date: '2026-06-20', from: '11:30', to: '12:20', part: 'arvo' }]);
    expect(overlaps(old.slots[1], fresh.slots[0])).toBe(true);
    const top = rankCells(cells, [old, fresh])[0];
    expect(top.cell.key).toBe('2026-06-20|arvo');
    expect(top.can).toEqual(['old', 'new']);
    // Early moved from 6:00 to 6:50: the old 6:00–7:59 answer still counts for it.
    expect(rankCells(cells, [old]).find((r) => r.cell.key === '2026-06-20|early').can).toEqual(['old']);
  });
  it('a 9-hole square is saved as 9 holes', () => {
    const c = [{ key: '2026-06-20|arvo', date: '2026-06-20', part: 'arvo', from: '11:30', to: '13:00', nine: true }];
    expect(slotsFrom(c, { week: {}, dates: { '2026-06-20|arvo': YES } })).toEqual([{ date: '2026-06-20', from: '11:30', to: '13:00', part: 'arvo', nine: true }]);
  });
});
