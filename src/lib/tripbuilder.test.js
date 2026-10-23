import { describe, it, expect } from 'vitest';
import {
  publicHolidays, easterSunday, weekendOptions, weekendLabel, tripDays, dayDate, regionsFrom, matchRegions, suggestStays,
  detourMin, legDrive, fitsLeg, rangeText, playedHistory, shortKnown, visitorsOn, rankCandidates, teeTimesNeeded,
  parseTeeTimes, teeBlock, bestBlock, earliestTee, callJobs, buildConfigurations, configText, usualFormats, shapeFromConfig,
  votePoints, dayVotes, batchNonVoters, builderSteps, newState, resizeDays, areaLine, boxAround,
} from './tripbuilder.js';

const SYD = { label: 'Inner West', lat: -33.87, lng: 151.21 };
const NOWRA = { key: 'nowra', name: 'Nowra', lat: -34.88, lng: 150.60 };
const JB = { key: 'jb', name: 'Jervis Bay', lat: -35.04, lng: 150.67 };
const C = {
  sh: { id: 'sh', name: 'Shoalhaven Heads', lat: -34.85, lng: 150.73 },
  ng: { id: 'ng', name: 'Nowra GC', lat: -34.87, lng: 150.61 },
  mh: { id: 'mh', name: 'Mollymook Hilltop', lat: -35.33, lng: 150.46 },
  ge: { id: 'ge', name: 'Gerringong', lat: -34.75, lng: 150.82 },
  bw: { id: 'bw', name: 'Bowral', lat: -34.48, lng: 150.42 },
};
const STAY_AREAS = [
  { name: 'Nowra', region: 'South Coast NSW', state: 'NSW', lat: -34.88, lng: 150.60, sort: 4 },
  { name: 'Jervis Bay (Huskisson)', region: 'South Coast NSW', state: 'NSW', lat: -35.04, lng: 150.67, sort: 5 },
  { name: 'Ulladulla', region: 'South Coast NSW', state: 'NSW', lat: -35.36, lng: 150.47, sort: 9 },
  { name: 'Mudgee', region: 'Central West NSW', state: 'NSW', lat: -32.59, lng: 149.59, sort: 70 },
];

describe('dates: public holidays and weekends', () => {
  it('knows Easter and the NSW holidays, moving weekend ones to the Monday', () => {
    expect(easterSunday(2027)).toBe('2027-03-28');
    const h = publicHolidays(2027);
    expect(h['2027-03-26']).toBe('Good Friday');
    expect(h['2027-06-14']).toBe('King’s Birthday');
    expect(h['2027-10-04']).toBe('Labour Day');
    expect(h['2027-12-27']).toBe('Christmas Day'); // 25th is a Saturday
    expect(h['2027-12-28']).toBe('Boxing Day');
  });
  it('offers the next Fri–Sun weekends, skipping long weekends unless asked', () => {
    const w = weekendOptions({ from: '2026-05-20', count: 4 });
    expect(w.map((x) => x.start)).toEqual(['2026-05-22', '2026-05-29', '2026-06-12', '2026-06-19']);
    expect(w[0]).toMatchObject({ end: '2026-05-24', nights: 2, long: false, label: 'Fri 22 – Sun 24 May' });
    const withLong = weekendOptions({ from: '2026-05-20', count: 4, includeLong: true });
    expect(withLong[2]).toMatchObject({ start: '2026-06-05', long: true, holiday: 'King’s Birthday' });
    expect(withLong[2].label).toContain('long weekend (King’s Birthday)');
  });
  it('3 nights: long weekends, Fri–Mon', () => {
    const w = weekendOptions({ from: '2026-05-20', count: 2, nights: 3 });
    expect(w[0]).toMatchObject({ start: '2026-06-05', end: '2026-06-08', long: true });
  });
  it('defaults to four weeks from today', () => {
    const w = weekendOptions({ today: new Date(2026, 9, 22), count: 1 });
    expect(w[0].start).toBe('2026-11-20');
  });
  it('labels across months', () => {
    expect(weekendLabel({ start: '2026-10-30', end: '2026-11-01' })).toBe('Fri 30 Oct – Sun 1 Nov');
  });
});

describe('days', () => {
  it('2 nights → on the way, stay day, on the way home', () => {
    expect(tripDays(2).map((d) => d.leg)).toEqual(['way', 'stay', 'home']);
    expect(tripDays(3).map((d) => d.leg)).toEqual(['way', 'stay', 'stay', 'home']);
    expect(tripDays(0)).toEqual([{ index: 0, leg: 'stay', name: 'The day' }]);
    expect(dayDate({ start: '2026-03-13' }, 2)).toBe('2026-03-15');
  });
  it('resizing keeps each day’s options when the leg stays the same', () => {
    const days = [{ index: 0, leg: 'way', options: ['sh'] }, { index: 1, leg: 'stay', options: ['ng'] }, { index: 2, leg: 'home', options: ['mh'] }];
    const r = resizeDays(days, 3);
    expect(r.map((d) => d.options)).toEqual([['sh'], ['ng'], [], []]);
  });
});

describe('areas', () => {
  it('groups towns into regions and finds them by region or town', () => {
    expect(regionsFrom(STAY_AREAS).map((r) => r.region)).toEqual(['South Coast NSW', 'Central West NSW']);
    expect(matchRegions('south', STAY_AREAS)[0].region).toBe('South Coast NSW');
    expect(matchRegions('mudgee', STAY_AREAS)[0].region).toBe('Central West NSW');
    expect(matchRegions('x', STAY_AREAS)).toEqual([]);
  });
  it('suggests the towns with most courses nearby first', () => {
    const s = suggestStays('South Coast NSW', STAY_AREAS, Object.values(C), 30);
    expect(s[0].name).toBe('Nowra');
    expect(s.find((x) => x.name === 'Ulladulla').courses).toBe(1);
  });
  it('one line for an area option, and a search box', () => {
    const r = regionsFrom(STAY_AREAS)[0];
    expect(areaLine(r, { courses: Object.values(C), origin: SYD })).toMatch(/^Nowra, Jervis Bay \(Huskisson\), Ulladulla · \d courses nearby · about \d h( \d\d)? drive$/);
    const b = boxAround([NOWRA, JB], 50);
    expect(b.south).toBeLessThan(-35.04);
    expect(b.north).toBeGreaterThan(-34.88);
  });
});

describe('drives: corridor and ranges', () => {
  it('a course on the way adds little; one behind you adds a lot', () => {
    expect(detourMin(SYD, C.sh, NOWRA)).toBeLessThanOrEqual(10);
    expect(detourMin(SYD, C.mh, NOWRA)).toBeGreaterThan(60);
  });
  it('stay days show a range across the stay areas', () => {
    const d = legDrive('stay', C.ge, { stays: [NOWRA, JB] });
    expect(d.min).toBeLessThan(d.max);
    expect(d.text).toBe(`${d.min}–${d.max} min`);
    expect(fitsLeg('stay', d, { stayMax: 40 })).toBe(true);
    expect(fitsLeg('stay', legDrive('stay', C.bw, { stays: [NOWRA, JB] }), { stayMax: 40 })).toBe(false);
  });
  it('the way there is a detour range, and fits within 25 min', () => {
    const d = legDrive('way', C.bw, { origin: SYD, stays: [NOWRA, JB] });
    expect(d.text).toMatch(/off the way$/);
    expect(fitsLeg('way', legDrive('way', C.sh, { origin: SYD, stays: [NOWRA] }))).toBe(true);
    expect(fitsLeg('way', legDrive('way', C.mh, { origin: SYD, stays: [NOWRA] }))).toBe(false);
  });
  it('range text', () => {
    expect(rangeText(15, 35)).toBe('15–35 min');
    expect(rangeText(20, 20)).toBe('20 min');
    expect(rangeText(70, 100)).toBe('1 h 10–1 h 40');
  });
});

describe('what we know about a course', () => {
  const history = {
    courses: [{ id: 'own-ng', library_id: 'ng' }, { id: 'own-x', library_id: 'x' }],
    trips: [{ id: 't1', name: 'Hunter trip', start_date: '2023-03-10' }, { id: 't2', name: 'South Coast trip', start_date: '2025-03-14' }],
    rounds: [{ id: 'r1', trip_id: 't1', course_id: 'own-ng', play_date: '2023-03-11' }, { id: 'r2', trip_id: 't2', course_id: 'own-ng', play_date: '2025-03-15' }],
    honour: [{ trip_id: 't2', trophy_name: 'BD', winner_names: 'Kurt' }],
  };
  it('played before: when, how often, who won', () => {
    const h = playedHistory('ng', history);
    expect(h.count).toBe(2);
    expect(h.last).toMatchObject({ name: 'South Coast trip', year: 2025, trophies: ['BD won by Kurt'] });
    expect(h.text).toBe('Played 2025 South Coast trip · 2 trips · BD won by Kurt');
    expect(playedHistory('sh', history)).toMatchObject({ count: 0, text: null });
    // A round just set up for a coming trip isn't "played".
    const coming = { ...history, rounds: [...history.rounds, { id: 'r3', trip_id: 't3', course_id: 'own-ng', play_date: '2099-03-14', status: 'setup' }] };
    expect(playedHistory('ng', coming).count).toBe(2);
  });
  it('short line on a pin', () => {
    expect(shortKnown({ mine_avg: 4.5 }, { count: 1, last: { year: 2023 } })).toBe('Played 2023 · ★4.5');
    expect(shortKnown({ others_avg: 4.2 }, { count: 0 })).toBe('Not played before · ★4.2 (other groups)');
  });
  it('visitors that day, from booking info then facts', () => {
    expect(visitorsOn(6, { booking: { visitor_times: 'Sat 7:00-12:00' } })).toBe(true);
    expect(visitorsOn(0, { booking: { visitor_times: 'Sat 7:00-12:00' } })).toBe(false);
    expect(visitorsOn(6, { facts: { member_times: { value: 'Sat 6:00-16:00' } } })).toBe(false);
    expect(visitorsOn(6, {})).toBe(null);
  });
  it('ranking: favourites up, played recently down (unless a favourite), members-only way down, votes up', () => {
    const today = new Date(2026, 9, 22);
    const cands = [
      { course: { id: 'a', name: 'A', mine_avg: 4.6 }, drive: { min: 30 }, history: { count: 2, last: { year: 2025 } } },
      { course: { id: 'b', name: 'B' }, drive: { min: 25 }, history: { count: 1, last: { year: 2025 } } },
      { course: { id: 'c', name: 'C' }, drive: { min: 25 }, history: { count: 0 } },
      { course: { id: 'd', name: 'D' }, drive: { min: 10 }, history: { count: 0 }, booking: { member_times: 'Sat 6:00-16:00' } },
    ];
    const r = rankCandidates(cands, { leg: 'stay', dow: 6, today });
    expect(r.map((x) => x.course.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(r[0].why).toContain('our favourite');
    expect(r[2].why).toContain('played recently');
    expect(r[3].why).toContain('members only that day');
    const voted = rankCandidates(cands, { leg: 'stay', dow: 6, today, votes: { b: 4 } });
    expect(voted[1].course.id).toBe('b');
  });
  it('filters: not played, our favourites, stay & play', () => {
    const cands = [
      { course: { id: 'a', name: 'A', mine_avg: 4.6 }, drive: { min: 30 }, history: { count: 2 } },
      { course: { id: 'b', name: 'B' }, drive: { min: 25 }, history: { count: 0 }, booking: { features: ['stay & play'] } },
    ];
    expect(rankCandidates(cands, { filters: { notPlayed: true } }).map((x) => x.course.id)).toEqual(['b']);
    expect(rankCandidates(cands, { filters: { favourites: true } }).map((x) => x.course.id)).toEqual(['a']);
    expect(rankCandidates(cands, { filters: { stayPlay: true } }).map((x) => x.course.id)).toEqual(['b']);
  });
});

describe('tee times', () => {
  it('needed: 12 in → 3; maybes count if nobody is in yet; override wins', () => {
    const rs = (n, status) => Array.from({ length: n }, (_, i) => ({ player_id: `${status}${i}`, status }));
    expect(teeTimesNeeded({ rsvps: [...rs(12, 'in'), ...rs(3, 'maybe')] })).toMatchObject({ people: 12, needed: 3, source: 'in' });
    expect(teeTimesNeeded({ rsvps: rs(5, 'maybe') })).toMatchObject({ people: 5, needed: 2, source: 'keen' });
    expect(teeTimesNeeded({ rsvps: rs(5, 'in'), override: 16 })).toMatchObject({ people: 16, needed: 4, source: 'set' });
    expect(teeTimesNeeded({})).toMatchObject({ people: 0, needed: 0, source: 'none' });
  });
  it('reads typed times and makes a block', () => {
    expect(parseTeeTimes('10:30, 10:20 10:20 7am 1:10pm junk 3:00')).toEqual(['07:00', '10:20', '10:30', '13:10']);
    expect(teeBlock('10:20', 3, 10)).toEqual(['10:20', '10:30', '10:40']);
    expect(teeBlock('x', 3)).toEqual([]);
  });
  it('finds N in a row, after the earliest', () => {
    expect(bestBlock(['08:00', '08:10', '09:30', '09:40', '09:50'], 3).text).toBe('9:30–9:50');
    expect(bestBlock(['08:00', '08:10', '08:20'], 3, { earliest: 8 * 60 + 5 })).toBe(null);
    expect(bestBlock(['10:20', '10:40'], 2)).toBe(null); // 20 minutes apart: not in a row
    expect(bestBlock(['10:20'], 1).text).toBe('10:20');
  });
  it('earliest tee: home 6:00 + drive + 30; stay 6:30 + drive + 30', () => {
    expect(earliestTee('way', 150)).toBe(360 + 150 + 30);
    expect(earliestTee('stay', 20)).toBe(390 + 20 + 30);
  });
});

describe('"Call the course" jobs', () => {
  it('one job per course, with the exact dates for each weekend and the time to ask from', () => {
    const jobs = callJobs({
      days: [{ index: 0, leg: 'way', options: ['sh'] }, { index: 1, leg: 'stay', options: ['ng', 'sh'] }, { index: 2, leg: 'home', options: [] }],
      weekends: [{ start: '2026-03-13', end: '2026-03-15' }, { start: '2026-03-20', end: '2026-03-22' }],
      courses: C, needed: 3, origin: SYD, stays: [NOWRA], booking: { ng: { phone: '02 4421 0000', visitor_times: 'Sat 7:00-12:00' } },
    });
    expect(jobs.map((j) => j.course_id)).toEqual(['sh', 'ng']);
    expect(jobs[0].title).toMatch(/^📞 Call Shoalhaven Heads — ask for 3 tee times in a row on Fri 13 Mar or Fri 20 Mar from \d+:\d0; Sat 14 Mar or Sat 21 Mar from \d+:\d0$/);
    expect(jobs[1].body).toContain('Phone 02 4421 0000');
    expect(jobs[1].body).toContain('Visitor times: Sat 7:00-12:00');
  });
});

describe('configurations', () => {
  const days = [{ index: 0, leg: 'way', options: ['sh', 'ge'] }, { index: 1, leg: 'stay', options: ['ng', 'mh'] }, { index: 2, leg: 'home', options: ['ge'] }];
  const tees = [
    { play_date: '2026-03-13', course_id: 'sh', times: ['10:20', '10:30', '10:40'] },
    { play_date: '2026-03-13', course_id: 'ge', times: ['10:00', '10:10'] }, // only 2: not enough for 12
    { play_date: '2026-03-14', course_id: 'ng', times: ['08:00', '08:10', '08:20', '08:30'] },
    { play_date: '2026-03-14', course_id: 'mh', times: ['09:00', '09:10', '09:20'] },
    { play_date: '2026-03-15', course_id: 'ge', times: ['09:10', '09:20', '09:30'] },
  ];
  const base = { weekends: [{ start: '2026-03-13', end: '2026-03-15' }], stays: [NOWRA, JB], days, courses: C, origin: SYD, tees, needed: 3, stayMax: 40, detourMax: 25 };
  it('only courses with enough tee times in a row, and drives that fit', () => {
    const cs = buildConfigurations(base);
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.every((c) => c.rounds[0].course_id === 'sh')).toBe(true); // Gerringong had only 2 times on the Friday
    expect(cs.every((c) => c.gaps === 0)).toBe(true);
    // Mollymook is over 40 min from Nowra but within 40 of Jervis Bay
    expect(cs.some((c) => c.stay.key === 'nowra' && c.rounds[1].course_id === 'mh')).toBe(false);
    expect(cs.some((c) => c.stay.key === 'jb' && c.rounds[1].course_id === 'mh')).toBe(true);
    expect(cs[0].text).toMatch(/^Stay (Nowra|Jervis Bay) · Fri Shoalhaven Heads 10:20–10:40 on the way · Sat .+ · Sun Gerringong 9:10–9:30 on the way home$/);
  });
  it('more people → more tee times needed → fewer trips', () => {
    expect(buildConfigurations({ ...base, needed: 4 }).every((c) => c.gaps > 0 || c.rounds.some((r) => !r.course_id))).toBe(true);
    const noSunday = days.map((d) => (d.leg === 'home' ? { ...d, options: [] } : d));
    expect(buildConfigurations({ ...base, days: noSunday, needed: 3 }).some((c) => c.rounds[0].course_id === 'ge')).toBe(false);
    expect(buildConfigurations({ ...base, days: noSunday, needed: 2 }).some((c) => c.rounds[0].course_id === 'ge')).toBe(true);
  });
  it('fewest gaps first, then less driving, then votes', () => {
    const cs = buildConfigurations(base);
    for (let i = 1; i < cs.length; i++) expect(cs[i - 1].gaps).toBeLessThanOrEqual(cs[i].gaps);
    const plain = buildConfigurations(base)[0];
    const voted = buildConfigurations({ ...base, votes: { 'course:1:mh': 10, 'stay:jb': 4 } })[0];
    expect(plain.rounds[1].course_id).toBe('ng');
    expect(voted.rounds[1].course_id).toBe('mh');
    expect(voted.stay.key).toBe('jb');
  });
  it('a missing day is a gap; the same course twice is not a trip; two weekends', () => {
    const cs = buildConfigurations({ ...base, tees: tees.filter((t) => t.course_id !== 'ge'), weekends: [{ start: '2026-03-13' }, { start: '2026-03-20' }] });
    expect(cs.every((c) => c.weekend.start === '2026-03-13')).toBe(true); // no tee times on the 20th
    expect(cs[0].gaps).toBe(1);
    expect(cs[0].text).toContain('Sun no golf');
    const twice = buildConfigurations({ ...base, days: [{ index: 0, leg: 'stay', options: ['ng'] }, { index: 1, leg: 'stay', options: ['ng'] }],
      tees: [{ play_date: '2026-03-13', course_id: 'ng', times: ['08:00', '08:10', '08:20'] }, { play_date: '2026-03-14', course_id: 'ng', times: ['08:00', '08:10', '08:20'] }] });
    expect(twice.every((c) => c.rounds.filter((r) => r.course_id === 'ng').length === 1)).toBe(true);
  });
  it('configText for a one-time block', () => {
    expect(configText({ stay: { name: 'Nowra' }, rounds: [{ index: 1, leg: 'stay', date: '2026-03-14', course_id: 'ng', name: 'Nowra GC', block: { text: '8:00' } }] })).toBe('Stay Nowra · Sat Nowra GC 8:00');
  });
});

describe('formats and filling the trip', () => {
  it('the usual: last day Ambrose if the group’s trips usually end that way', () => {
    expect(usualFormats(3)).toEqual(['stableford', 'stableford', 'ambrose']);
    expect(usualFormats(1)).toEqual(['stableford']);
    const trips = [{ id: 't1' }, { id: 't2' }];
    const rounds = [
      { trip_id: 't1', play_date: '1', format: 'stroke' }, { trip_id: 't1', play_date: '2', format: 'stroke' },
      { trip_id: 't2', play_date: '1', format: 'stroke' }, { trip_id: 't2', play_date: '2', format: 'stableford' },
    ];
    expect(usualFormats(2, { trips, rounds })).toEqual(['stroke', 'stroke']);
  });
  it('shape from a configuration keeps last time’s extras on the same day and course', () => {
    const config = { key: 'k', rounds: [
      { index: 0, course_id: 'sh', block: { times: ['10:20', '10:30'] } }, { index: 1, course_id: null }, { index: 2, course_id: 'ge', block: { times: ['09:10'] } }] };
    const old = { v: 1, trophies: [{ name: 'BD' }], rounds: [{ day: 2, course_id: 'own-ge', format: 'ambrose', ctp_holes: [3] }] };
    const s = shapeFromConfig(config, { courseIds: { sh: 'own-sh', ge: 'own-ge' }, formats: ['stableford', 'ambrose'], oldShape: old });
    expect(s.trophies).toEqual([{ name: 'BD' }]);
    expect(s.from_builder).toBe('k');
    expect(s.rounds).toEqual([
      { day: 0, course_id: 'own-sh', format: 'stableford', tee_times: ['10:20', '10:30'] },
      { day: 2, course_id: 'own-ge', format: 'ambrose', ctp_holes: [3], tee_times: ['09:10'] },
    ]);
  });
});

describe('votes', () => {
  it('points per key and per day', () => {
    const p = votePoints({ o1: 'course:1:ng', o2: 'course:1:mh', o3: 'stay:jb' }, [
      { option_id: 'o1', response: 'yes' }, { option_id: 'o1', response: 'maybe' }, { option_id: 'o2', response: 'no' }, { option_id: 'o3', response: 'yes' }, { option_id: 'zz', response: 'yes' },
    ]);
    expect(p).toEqual({ 'course:1:ng': 3, 'course:1:mh': 0, 'stay:jb': 2 });
    expect(dayVotes(p, 1)).toEqual({ ng: 3, mh: 0 });
  });
  it('the reminder skips people who answered every section (and said if they’re keen)', () => {
    const polls = [{ id: 'p1' }, { id: 'p2' }];
    const votes = [
      { poll_id: 'p1', player_id: 'a' }, { poll_id: 'p2', player_id: 'a' },
      { poll_id: 'p1', player_id: 'b' },
      { poll_id: 'p1', player_id: 'c' }, { poll_id: 'p2', player_id: 'c' },
    ];
    const rsvps = [{ player_id: 'a', status: 'in' }];
    expect(batchNonVoters({ polls, votes, rsvps, keen: true, playerIds: ['a', 'b', 'c', 'd'] })).toEqual(['b', 'c', 'd']);
    expect(batchNonVoters({ polls, votes, rsvps, keen: false, playerIds: ['a', 'b', 'c', 'd'] })).toEqual(['b', 'd']);
  });
});

describe('steps, in Josh’s order', () => {
  it('courses need the area; calls need weekends AND courses; configurations need tee times', () => {
    const s0 = builderSteps(newState({}));
    expect(s0.map((s) => [s.key, s.locked])).toEqual([['area', false], ['courses', true], ['calls', true], ['configs', true]]);
    expect(s0[1].after).toBe('the area is chosen (Areas & weekends)');
    expect(s0.map((s) => s.label)).toEqual(['Areas & weekends', 'Courses & stays', 'Call the courses', 'Pick & lock in']);
    const st = { ...newState({}), region: 'South Coast NSW', stays: [NOWRA], days: [{ index: 0, leg: 'way', options: ['sh'] }] };
    const s1 = builderSteps(st);
    expect(s1[1].locked).toBe(false);
    expect(s1[2]).toMatchObject({ locked: true, after: 'the primary and backup weekends are set (Areas & weekends)' }); // weekends not settled yet
    expect(builderSteps({ ...st, region: null, weekends: [{ start: '2026-03-13' }], weekendsSettled: true })[2]).toMatchObject({ locked: true, after: 'the area is chosen (Areas & weekends)' });
    const s2 = builderSteps({ ...st, weekends: [{ start: '2026-03-13' }], weekendsSettled: true });
    expect(s2[2].locked).toBe(false);
    expect(s2[3].locked).toBe(true);
    const s3 = builderSteps({ ...st, weekends: [{ start: '2026-03-13' }], weekendsSettled: true, callsMade: true }, { teeCount: 2 });
    expect(s3[3].locked).toBe(false);
  });
  it('a new state takes the plan’s dates as the one weekend', () => {
    const s = newState({ start_date: '2026-03-13', end_date: '2026-03-15' });
    expect(s.nights).toBe(2);
    expect(s.weekends).toEqual([{ start: '2026-03-13', end: '2026-03-15', long: false }]);
    expect(s.days.map((d) => d.leg)).toEqual(['way', 'stay', 'home']);
  });
});
