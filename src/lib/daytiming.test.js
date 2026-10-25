import { describe, it, expect } from 'vitest';
import {
  sunTimes, auOffset, auZone, auDst, windowsFor, phraseWindows, courseWindows, windowsText, golfLength, travelChain, leaveBy,
  duskFlag, suits, courseFit, slotLine, dayPlan, dayPrefs, prefsLine, hm, dur,
} from './daytiming.js';

const SYD = { lat: -33.87, lng: 151.21 };
const HUNTER = { lat: -32.83, lng: 151.36 }; // Cessnock
const HOBART = { lat: -42.88, lng: 147.33 };
const near = (a, b, tol = 5) => Math.abs(a - b) <= tol;
const at = (h, m = 0) => h * 60 + m;

describe('the clock', () => {
  it('formats times and durations', () => {
    expect(hm(at(19, 25))).toBe('7:25pm');
    expect(hm(at(7))).toBe('7am');
    expect(dur(40)).toBe('40 min');
    expect(dur(75)).toBe('1 h 15');
    expect(dur(120)).toBe('2 h');
  });
});

describe('time zones', () => {
  it('daylight saving runs from the first Sunday in October to the first Sunday in April', () => {
    expect(auDst('2026-10-03')).toBe(false); // Sat before
    expect(auDst('2026-10-04')).toBe(true);  // first Sunday in October 2026
    expect(auDst('2026-04-04')).toBe(true);
    expect(auDst('2026-04-05')).toBe(false); // first Sunday in April 2026
    expect(auDst('2026-07-01')).toBe(false);
    expect(auDst('2027-01-15')).toBe(true);
  });
  it('knows the states from a position', () => {
    expect(auZone(-31.95, 115.86)).toBe('WA');
    expect(auZone(-12.46, 130.84)).toBe('NT');
    expect(auZone(-34.93, 138.6)).toBe('SA');
    expect(auZone(-27.47, 153.03)).toBe('QLD');
    expect(auZone(-28.0, 153.4)).toBe('QLD'); // Gold Coast
    expect(auZone(-28.9, 153.5)).toBe('NSW'); // Byron
    expect(auZone(SYD.lat, SYD.lng)).toBe('NSW');
    expect(auZone(HOBART.lat, HOBART.lng)).toBe('NSW');
  });
  it('gives the right offset with daylight saving', () => {
    expect(auOffset('2026-06-21', SYD.lat, SYD.lng)).toBe(600);
    expect(auOffset('2026-12-21', SYD.lat, SYD.lng)).toBe(660);
    expect(auOffset('2026-12-21', -27.47, 153.03)).toBe(600); // Brisbane: no daylight saving
    expect(auOffset('2026-12-21', -34.93, 138.6)).toBe(630);
    expect(auOffset('2026-12-21', -31.95, 115.86)).toBe(480);
  });
});

describe('sunrise and sunset (against published times, within 5 min)', () => {
  it('Sydney, midwinter: about 7:00am / 4:54pm', () => {
    const s = sunTimes('2026-06-21', SYD.lat, SYD.lng);
    expect(near(s.sunrise, at(7, 0))).toBe(true);
    expect(near(s.sunset, at(16, 54))).toBe(true);
  });
  it('Sydney, midsummer: about 5:41am / 8:05pm (daylight saving)', () => {
    const s = sunTimes('2026-12-21', SYD.lat, SYD.lng);
    expect(near(s.sunrise, at(5, 41))).toBe(true);
    expect(near(s.sunset, at(20, 5))).toBe(true);
  });
  it('Hunter Valley, mid March: sunset about 7:15pm', () => {
    const s = sunTimes('2026-03-13', HUNTER.lat, HUNTER.lng);
    expect(near(s.sunset, at(19, 15))).toBe(true);
    expect(s.lastLight).toBeGreaterThan(s.sunset);
  });
  it('Hobart: about 4:43pm in June and 8:50pm in December', () => {
    expect(near(sunTimes('2026-06-21', HOBART.lat, HOBART.lng).sunset, at(16, 43))).toBe(true);
    expect(near(sunTimes('2026-12-21', HOBART.lat, HOBART.lng).sunset, at(20, 50))).toBe(true);
    expect(near(sunTimes('2026-06-21', HOBART.lat, HOBART.lng).sunrise, at(7, 41))).toBe(true);
  });
  it('Perth uses its own clock', () => {
    expect(near(sunTimes('2026-06-21', -31.95, 115.86).sunset, at(17, 20))).toBe(true);
  });
  it('nothing without a place', () => {
    expect(sunTimes('2026-06-21', null, null)).toBe(null);
  });
});

describe('reading the usual social / visitor times', () => {
  it('reads golf talk: "after 2" is 2 pm, "after 11" is 11 am', () => {
    expect(phraseWindows('after 2')).toEqual([{ from: at(14), to: null }]);
    expect(phraseWindows('after 11')).toEqual([{ from: at(11), to: null }]);
    expect(phraseWindows('from 12pm')).toEqual([{ from: at(12), to: null }]);
    expect(phraseWindows('11am onwards')).toEqual([{ from: at(11), to: null }]);
    expect(phraseWindows('before 9')).toEqual([{ from: at(6, 30), to: at(9) }]);
    expect(phraseWindows('between 10 and 2')).toEqual([{ from: at(10), to: at(14) }]);
    expect(phraseWindows('7-8:30am')).toEqual([{ from: at(7), to: at(8, 30) }]);
    expect(phraseWindows('mornings')).toEqual([{ from: at(6, 30), to: at(12) }]);
    expect(phraseWindows('arvo')).toEqual([{ from: at(12), to: null }]);
    expect(phraseWindows('members only')).toEqual([]);
    expect(phraseWindows('ring the pro shop')).toBe(null);
  });
  it('splits by day: "Sat after 2, Sun after 11"', () => {
    expect(windowsFor('Sat after 2, Sun after 11', 6)).toEqual({ known: true, windows: [{ from: at(14), to: null }] });
    expect(windowsFor('Sat after 2, Sun after 11', 0)).toEqual({ known: true, windows: [{ from: at(11), to: null }] });
    expect(windowsFor('Sat after 2, Sun after 11', 3).known).toBe(false);
  });
  it('two windows in a day, and "no visitors" on one day', () => {
    expect(windowsFor('weekdays 7-8:30am and after 1pm', 3).windows).toEqual([{ from: at(7), to: at(8, 30) }, { from: at(13), to: null }]);
    expect(windowsFor('Sat: no visitors, Sun after 12', 6)).toEqual({ known: true, windows: [] });
    expect(windowsFor('Sat: no visitors, Sun after 12', 0).windows).toEqual([{ from: at(12), to: null }]);
  });
  it('the structured visitor times too ("Sat 7:00-12:00; Sun 9am-1pm")', () => {
    expect(windowsFor('Sat 7:00-12:00; Sun 9am-1pm', 6).windows).toEqual([{ from: at(7), to: at(12) }]);
    expect(windowsFor('Sat 7:00-12:00; Sun 9am-1pm', 0).windows).toEqual([{ from: at(9), to: at(13) }]);
  });
  it('unreadable → ring to check', () => {
    expect(windowsFor('', 6).known).toBe(false);
    expect(windowsFor('ask Dave', 6).known).toBe(false);
  });
  it('picks the best source: our notes, then the club, then research', () => {
    const social = { weekdays: 'after 11', weekends: 'Sat after 2' };
    expect(courseWindows(6, { social, booking: { visitor_times: 'Sat 7:00-12:00' } })).toMatchObject({ source: 'our notes', known: true, windows: [{ from: at(14), to: null }] });
    expect(courseWindows(6, { social: { weekdays: 'after 11' }, booking: { visitor_times: 'Sat 7:00-12:00' } })).toMatchObject({ source: 'the club’s visitor times' });
    expect(courseWindows(0, { research: { details: { visitor_times: 'Sat after 12pm; Sun after 11am' } } })).toMatchObject({ source: 'course research', windows: [{ from: at(11), to: null }] });
    expect(courseWindows(0, {}).known).toBe(false);
  });
  it('says the windows in words', () => {
    expect(windowsText([{ from: at(11), to: null }])).toBe('after 11am');
    expect(windowsText([{ from: at(7), to: at(8, 30) }, { from: at(13), to: null }])).toBe('7am–8:30am, after 1pm');
    expect(windowsText([])).toBe('no visitors');
  });
});

describe('the round', () => {
  it('Stableford about 4 h 30 a 4-ball, Ambrose about 4 h; the last group later', () => {
    expect(golfLength({ format: 'stableford', players: 4 }).total).toBe(270);
    expect(golfLength({ format: 'ambrose', players: 4 }).total).toBe(240);
    expect(golfLength({ format: 'stableford', players: 12 })).toMatchObject({ groups: 3, total: 290 });
    expect(golfLength({ format: 'stableford', players: 12, roundLength: 300, interval: 8 }).total).toBe(316);
    expect(golfLength({ holes: 9, players: 4 }).total).toBe(135);
  });
});

describe('travel', () => {
  it('drive: leave 6 → arrive after the drive', () => {
    const c = travelChain({ mode: 'drive', leave: '06:00', driveMin: 150, from: 'Inner West' });
    expect(c.arrive).toBe(at(8, 30));
    expect(c.legs).toHaveLength(1);
    expect(c.legs[0].label).toMatch(/Inner West/);
  });
  it('fly: airport drive + check-in + flight + bags + drive', () => {
    const c = travelChain({ mode: 'fly', leave: at(5, 30), fly: { toAirportMin: 30, checkInMin: 60, flightMin: 115, pickupMin: 30, fromAirportMin: 25 } });
    expect(c.arrive).toBe(at(5, 30) + 30 + 60 + 115 + 30 + 25);
    expect(c.legs.map((l) => l.kind)).toEqual(['drive', 'wait', 'fly', 'wait', 'drive']);
    expect(c.legs[2].label).toMatch(/a guess/);
  });
  it('works back from an arrival time', () => {
    expect(leaveBy(at(9), { mode: 'drive', driveMin: 150 }).leave).toBe(at(6, 30));
    expect(leaveBy(at(12), { mode: 'fly' }).leave).toBe(at(12) - (40 + 60 + 90 + 30 + 45));
  });
});

describe('fitting a tee time', () => {
  it('flags dusk: plenty, tight, after dark', () => {
    expect(duskFlag(at(17), at(19)).text).toBe('finishes about 2 h before dusk ✓');
    expect(duskFlag(at(18, 20), at(18, 40)).tone).toBe('ok' === 'x' ? 'x' : 'tight');
    expect(duskFlag(at(18, 20), at(18, 40), { latestTee: at(13, 10) }).text).toBe('tight — tee off by 1:10pm to finish before dusk');
    expect(duskFlag(at(19), at(18, 40), { latestTee: at(13, 10) }).tone).toBe('dark');
  });
  it('wishes: early, midday, morning free, home by', () => {
    expect(suits('early', at(8))).toBe(true);
    expect(suits('early', at(10))).toBe(false);
    expect(suits('midday', at(12, 30))).toBe(true);
    expect(suits('midday', at(8))).toBe(false);
    expect(suits('morning_free', at(12))).toBe(true);
    expect(suits('morning_free', at(9))).toBe(false);
    expect(suits('home_by', at(9), { finish: at(13, 30), homeBy: '18:00', driveHome: 150 })).toBe(true);
    expect(suits('home_by', at(12), { finish: at(16, 30), homeBy: '18:00', driveHome: 150 })).toBe(false);
    expect(suits('any', at(5))).toBe(true);
  });
  it('a winter Saturday in Sydney: after 2pm doesn’t leave enough daylight', () => {
    const f = courseFit({ date: '2026-06-20', place: SYD, canArrive: at(9), windows: [{ from: at(14), to: null }], golf: golfLength({ players: 12 }) });
    expect(f.fits).toEqual([]);
    expect(f.reason).toBe('not enough daylight left');
  });
  it('too early to make it from home: the morning window closes before you can get there', () => {
    const f = courseFit({ date: '2026-03-13', place: HUNTER, canArrive: at(8, 40), windows: [{ from: at(7), to: at(8, 30) }], golf: golfLength({ players: 8 }) });
    expect(f.reason).toBe('too early to make it');
  });
  it('a summer arvo: the latest tee finishes before dusk and the slots carry their flags', () => {
    const golf = golfLength({ players: 8 });
    const f = courseFit({ date: '2026-12-12', place: SYD, canArrive: at(9), windows: [{ from: at(11), to: null }], golf, step: 60 });
    expect(f.fits[0].from).toBe(at(11));
    expect(f.latestTee).toBe(f.sun.sunset - golf.total);
    const last = f.slots[f.slots.length - 1];
    expect(last.finish).toBeLessThanOrEqual(f.sun.sunset);
    expect(f.slots[0].flag.tone).toBe('ok');
    expect(slotLine(f.slots[0])).toMatch(/^Tee off 11am → finish about 3:\d\dpm, \d h( \d\d)? before dusk$/);
  });
  it('no visitors that day', () => {
    expect(courseFit({ date: '2026-12-12', place: SYD, windows: [], known: true }).reason).toBe('no visitors that day');
  });
  it('unknown times are treated as open (ring to check) but kept as unknown', () => {
    const f = courseFit({ date: '2026-12-12', place: SYD, canArrive: at(8), windows: [], known: false });
    expect(f.fits.length).toBe(1);
    expect(f.known).toBe(false);
  });
});

describe('one day put together', () => {
  const courses = [
    { id: 'a', name: 'Cessnock GC', driveFromHome: 140, driveFromStay: 15, windows: [{ from: at(11), to: null }], known: true },
    { id: 'b', name: 'Early Links', driveFromHome: 150, driveFromStay: 20, windows: [{ from: at(7), to: at(8, 30) }], known: true },
  ];
  it('a driving day: leave home, drive, golf, then dinner', () => {
    const p = dayPlan({ leg: 'way', date: '2026-03-13', place: HUNTER, travel: { mode: 'drive', starts: [{ label: 'Inner West', driveMin: 140, leave: '06:00' }] },
      courses, golf: golfLength({ players: 8 }), pick: { course: 'a', tee: '12:30' } });
    const kinds = p.blocks.map((b) => b.kind);
    expect(kinds[0]).toBe('travel');
    expect(kinds).toContain('golf');
    expect(kinds[kinds.length - 1]).toBe('evening');
    // Leave so you're there 30 min before the 12:30 tee: 12:00 − 2 h 20 = 9:40.
    expect(p.blocks[0].from).toBe(at(9, 40));
    expect(p.courses.find((c) => c.id === 'b').fit.reason).toBe('too early to make it');
    expect(p.courses.find((c) => c.id === 'a').fit.fits.length).toBe(1);
  });
  it('a flying day: the chain gets you there later, so fewer times fit', () => {
    const p = dayPlan({ leg: 'way', date: '2026-03-13', place: HOBART, travel: { mode: 'fly', starts: [{ label: 'Sydney', leave: '06:00' }], fly: { flightMin: 115 } }, courses, golf: golfLength({ players: 8 }) });
    const a = p.courses.find((c) => c.id === 'a');
    expect(a.canArrive).toBe(at(6) + 40 + 60 + 115 + 30 + 45 + 15);
    expect(p.blocks.some((b) => /Flight/.test(b.label))).toBe(true);
  });
  it('a stay day with a morning-free wish marks the times that suit', () => {
    const prefs = [{ who: 'p1', pref: 'morning_free' }, { who: 'p2', pref: 'morning_free' }, { who: 'p3', pref: 'early' }];
    const p = dayPlan({ leg: 'stay', date: '2026-03-14', place: HUNTER, courses: [{ ...courses[0], windows: [{ from: at(7), to: null }] }], golf: golfLength({ players: 8 }), prefs });
    const slots = p.courses[0].fit.slots;
    const best = slots.filter((s) => s.best);
    expect(best.length).toBeGreaterThan(0);
    expect(best.every((s) => s.tee >= at(11, 30))).toBe(true);
    expect(slots[0].tee).toBe(at(7, 50)); // up at 7, 15 min drive, 30 min before the tee
    expect(slots[0].suitsN).toBe(1);
  });
  it('a stay day with a pick: morning free, drive, golf, back, dinner', () => {
    const p = dayPlan({ leg: 'stay', date: '2026-03-14', place: HUNTER, courses, golf: golfLength({ players: 8 }), pick: { course: 'a', tee: '12:30' } });
    expect(p.blocks.map((b) => b.kind)).toEqual(['free', 'travel', 'free', 'golf', 'travel', 'free', 'evening']);
    expect(p.blocks[0].label).toBe('Morning free');
  });
  it('the home day ends with the drive home', () => {
    const p = dayPlan({ leg: 'home', date: '2026-03-15', place: HUNTER, courses: [{ ...courses[0], driveHome: 140 }], golf: golfLength({ players: 8 }), pick: { course: 'a', tee: '09:00' } });
    const last = p.blocks[p.blocks.length - 1];
    expect(last.label).toMatch(/Drive home/);
    expect(last.to).toBe(at(9) + golfLength({ players: 8 }).total + 140);
  });
});

describe('wishes for a day', () => {
  it('a day note beats the trip-wide wish; the latest note wins', () => {
    const prefs = dayPrefs('2026-03-14', {
      wishes: [{ player_id: 'p1', day_pref: 'early' }, { player_id: 'p2', day_pref: 'midday' }, { player_id: 'p3', day_pref: 'any' }],
      comments: [
        { player_id: 'p1', day_date: '2026-03-14', day_pref: 'midday', created_at: '2026-10-25T01:00:00Z' },
        { player_id: 'p1', day_date: '2026-03-14', day_pref: 'morning_free', created_at: '2026-10-25T02:00:00Z' },
        { player_id: 'p2', day_date: '2026-03-15', day_pref: 'early', created_at: '2026-10-25T02:00:00Z' },
      ],
    });
    expect(prefs.find((p) => p.who === 'p1')).toMatchObject({ pref: 'morning_free', source: 'note' });
    expect(prefs.find((p) => p.who === 'p2')).toMatchObject({ pref: 'midday', source: 'wishes' });
    expect(prefs.find((p) => p.who === 'p3')).toBe(undefined);
    expect(prefsLine(prefs)).toBe('1 want the morning free · 1 want to play midday');
  });
});
