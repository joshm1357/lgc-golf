import { describe, it, expect } from 'vitest';
import { teeGroupSizes, teeWindow, toMin, fromMin, clock, ampm } from './teeWindow.js';

describe('teeGroupSizes', () => {
  it('8 players → two groups of 4', () => expect(teeGroupSizes(8)).toEqual([4, 4]));
  it('12 players → three groups of 4', () => expect(teeGroupSizes(12)).toEqual([4, 4, 4]));
  it('13 players → 4, 3, 3, 3 (never a group of 5)', () => expect(teeGroupSizes(13)).toEqual([4, 3, 3, 3]));
  it('16 players → four groups of 4', () => expect(teeGroupSizes(16)).toEqual([4, 4, 4, 4]));
  it('as even as possible, and never more than 4', () => {
    for (let n = 1; n <= 60; n++) {
      const s = teeGroupSizes(n);
      expect(s.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.max(...s)).toBeLessThanOrEqual(4);
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
      expect(s.length).toBe(Math.ceil(n / 4));
    }
  });
  it('nobody → no groups', () => expect(teeGroupSizes(0)).toEqual([]));
});

describe('time helpers', () => {
  it('reads and writes HH:MM', () => {
    expect(toMin('06:00')).toBe(360);
    expect(toMin('9:15')).toBe(555);
    expect(toMin('25:00')).toBe(null);
    expect(toMin('nope')).toBe(null);
    expect(fromMin(555)).toBe('09:15');
  });
  it('prints friendly times', () => {
    expect(clock(555)).toBe('9:15');
    expect(clock(700)).toBe('11:40');
    expect(clock(13 * 60 + 5)).toBe('1:05');
    expect(ampm(14 * 60)).toBe('2 pm');
    expect(ampm(9 * 60 + 40)).toBe('9:40 am');
    expect(ampm(12 * 60 + 30)).toBe('12:30 pm');
  });
});

describe('teeWindow', () => {
  // The worked example: 12 players (3 fourballs), last arrival 8:45, dinner at 4:30 → first tee 9:15 to 11:40.
  it('12 players, 18 holes: the worked example', () => {
    const w = teeWindow({ players: 12, starts: [{ label: 'Inner West', leave: '07:00', finish: '16:30', driveMin: 105 }] });
    expect(w.fits).toBe(true);
    expect(w.groups).toBe(3);
    expect(w.earliest).toBe(toMin('09:15'));
    expect(w.latest).toBe(toMin('11:40'));
    expect(w.text).toBe('9:15–11:40');
    expect(w.lastOff).toBe(toMin('12:00'));
  });

  it('8 players, 18 holes: two groups, one interval', () => {
    const w = teeWindow({ players: 8, starts: [{ label: 'A', leave: '06:00', finish: '17:00', driveMin: 60 }] });
    expect(w.earliest).toBe(toMin('07:30'));
    expect(w.latest).toBe(17 * 60 - 270 - 10);
    expect(w.text).toBe('7:30–12:20');
  });

  it('13 players: four groups, three intervals', () => {
    const w = teeWindow({ players: 13, starts: [{ label: 'A', leave: '06:00', finish: '17:00', driveMin: 60 }] });
    expect(w.sizes).toEqual([4, 3, 3, 3]);
    expect(w.latest).toBe(17 * 60 - 270 - 30);
  });

  it('16 players with the course’s own 8-minute interval', () => {
    const w = teeWindow({ players: 16, interval: 8, starts: [{ label: 'A', driveMin: 0 }] });
    expect(w.groups).toBe(4);
    expect(w.latest).toBe(17 * 60 - 270 - 24);
    expect(w.earliest).toBe(6 * 60 + 30);
  });

  it('9 holes takes 2 h 15', () => {
    const w18 = teeWindow({ players: 12, holes: 18, starts: [{ label: 'A', finish: '14:00', driveMin: 120 }] });
    const w9 = teeWindow({ players: 12, holes: 9, starts: [{ label: 'A', finish: '14:00', driveMin: 120 }] });
    expect(w9.roundMinutes).toBe(135);
    expect(w9.latest - w18.latest).toBe(135);
    expect(w9.fits).toBe(true);
  });

  it('a course’s own round length wins', () => {
    const w = teeWindow({ players: 4, roundMinutes: 240, starts: [{ label: 'A', driveMin: 0 }] });
    expect(w.latest).toBe(17 * 60 - 240);
  });

  it('doesn’t fit: says who arrives too late for which finish', () => {
    const w = teeWindow({
      players: 12,
      starts: [
        { label: 'Inner West', leave: '06:00', finish: '17:00', driveMin: 60 },
        { label: 'Newcastle', leave: '07:00', finish: '14:00', driveMin: 160 },
      ],
    });
    expect(w.fits).toBe(false);
    expect(w.text).toBe(null);
    expect(w.reason).toBe('Newcastle players arrive 9:40, too late for a 2 pm finish');
  });

  it('just fits: earliest and latest are the same minute', () => {
    // 8 players: latest = 17:00 − 4:30 − 0:10 = 12:20. Arrive 11:50 → earliest 12:20.
    const w = teeWindow({ players: 8, starts: [{ label: 'A', leave: '09:50', finish: '17:00', driveMin: 120 }] });
    expect(w.earliest).toBe(w.latest);
    expect(w.fits).toBe(true);
    expect(w.text).toBe('12:20–12:20');
    // One minute later and it doesn't.
    const late = teeWindow({ players: 8, starts: [{ label: 'A', leave: '09:51', finish: '17:00', driveMin: 120 }] });
    expect(late.fits).toBe(false);
  });

  it('the earliest finish of all the starting points counts', () => {
    const w = teeWindow({ players: 8, starts: [{ label: 'A', finish: '17:00' }, { label: 'B', finish: '15:00' }] });
    expect(w.finish).toEqual({ label: 'B', at: 15 * 60 });
  });

  it('nobody playing doesn’t fit', () => {
    expect(teeWindow({ players: 0 }).fits).toBe(false);
  });
});
