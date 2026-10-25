import { describe, it, expect } from 'vitest';
import {
  ratingOf, playedOf, typesOf, rankOf, filterOptions, filterCourses, filtersOn, filterText, nextReach, fromText, showMore,
  inBox, boxTooBig, customAreaName, isCustomArea, onTheWay, onWayLine, corridorBoxes, searchMarginKm, roundBox,
} from './coursemap.js';

const cand = (id, o = {}) => ({ course: { id, name: `Course ${id}`, ...(o.course || {}) }, drive: { min: o.min ?? 20, text: `${o.min ?? 20} min` }, history: o.history || null, suggested: !!o.suggested });
const research = {
  a: { details: { style: 'Coastal links', rankings: '#45 Golf Australia Top 100; #12 Top 100 Public Access' } },
  b: { details: { style: 'Parkland', rankings: 'Not ranked' } },
  c: { details: { style: 'Resort parkland with lakes', rankings: 'Top 100 courses (honourable mention)' } },
};

describe('what we know about a course', () => {
  it('rating: ours first, else other groups', () => {
    expect(ratingOf({ mine_avg: 4.5, others_avg: 3 })).toBe(4.5);
    expect(ratingOf({ others_avg: '3.8' })).toBe(3.8);
    expect(ratingOf({})).toBe(null);
  });
  it('played: the group’s rounds or the library flag', () => {
    expect(playedOf(cand('x', { history: { count: 2 } }))).toBe(true);
    expect(playedOf({ course: { played: true } })).toBe(true);
    expect(playedOf(cand('x'))).toBe(false);
  });
  it('types come from the research style words', () => {
    expect(typesOf(research.a)).toEqual(['links', 'coastal']);
    expect(typesOf(research.c)).toEqual(['parkland', 'resort', 'water']);
    expect(typesOf(null)).toEqual([]);
  });
  it('ranking: the best number, 999 for ranked without one, null for not ranked', () => {
    expect(rankOf(research.a)).toBe(12);
    expect(rankOf(research.b)).toBe(null);
    expect(rankOf(research.c)).toBe(999);
    expect(rankOf({ details: { rankings: 'Ranked 3rd in NSW' } })).toBe(3);
    expect(rankOf({})).toBe(null);
  });
  it('filter options only offer what some course has', () => {
    const cs = [cand('a', { course: { mine_avg: 4 } }), cand('b'), cand('z')];
    expect(filterOptions(cs, research)).toEqual({ stars: true, types: ['links', 'parkland', 'coastal'], ranked: true });
    expect(filterOptions([cand('z')], {})).toEqual({ stars: false, types: [], ranked: false });
  });
});

describe('filterCourses', () => {
  const cs = [
    cand('a', { min: 30, course: { mine_avg: 4.5 }, history: { count: 1 } }),
    cand('b', { min: 10, course: { others_avg: 3.2 } }),
    cand('c', { min: 20 }),
  ];
  const ids = (l) => l.map((c) => c.course.id);
  it('either / not played / played before', () => {
    expect(ids(filterCourses(cs, {}, { research }))).toEqual(['a', 'b', 'c']);
    expect(ids(filterCourses(cs, { played: 'no' }, { research }))).toEqual(['b', 'c']);
    expect(ids(filterCourses(cs, { played: 'yes' }, { research }))).toEqual(['a']);
  });
  it('rating minimum and type', () => {
    expect(ids(filterCourses(cs, { minStars: 3 }, { research }))).toEqual(['a', 'b']);
    expect(ids(filterCourses(cs, { minStars: 4 }, { research }))).toEqual(['a']);
    expect(ids(filterCourses(cs, { type: 'parkland' }, { research }))).toEqual(['b', 'c']);
  });
  it('sorts: suggested keeps order; rating, drive, top ranked', () => {
    expect(ids(filterCourses(cs, { sort: 'rating' }, { research }))).toEqual(['a', 'b', 'c']);
    expect(ids(filterCourses(cs, { sort: 'drive' }, { research }))).toEqual(['b', 'c', 'a']);
    expect(ids(filterCourses(cs, { sort: 'ranked' }, { research }))).toEqual(['a', 'c', 'b']);
  });
  it('courses on the table stay in the list, flagged', () => {
    const l = filterCourses(cs, { played: 'yes' }, { research, keep: ['c'] });
    expect(ids(l)).toEqual(['a', 'c']);
    expect(l[1].kept).toBe(true);
    expect(l[0].kept).toBeUndefined();
  });
  it('says what is on', () => {
    expect(filtersOn({})).toBe(false);
    expect(filtersOn({ sort: 'drive' })).toBe(false);
    expect(filtersOn({ played: 'no' })).toBe(true);
    expect(filterText({ played: 'no', minStars: 4, type: 'links' })).toBe('Not played · ★4+ · Links');
  });
});

describe('search wider', () => {
  it('steps the drive up to two hours', () => {
    expect(nextReach(40)).toBe(45);
    expect(nextReach(45)).toBe(60);
    expect(nextReach(50)).toBe(60);
    expect(nextReach(120)).toBe(null);
  });
  it('names where from', () => {
    expect(fromText([])).toBe('where you’d stay');
    expect(fromText([{ name: 'Pokolbin' }, { name: 'Cessnock' }])).toBe('Pokolbin and Cessnock');
    expect(fromText([{ name: 'A' }, { name: 'B' }, { name: 'C' }])).toBe('A and 2 more');
  });
  it('shows more rows first, then a longer drive, saying how far', () => {
    expect(showMore({ total: 30, shown: 12, reach: 40 })).toMatchObject({ kind: 'rows', count: 12 });
    expect(showMore({ total: 15, shown: 12, reach: 40 }).text).toBe('Show 3 more (3 more within 40 min)');
    const w = showMore({ total: 10, shown: 12, reach: 45, stays: [{ name: 'Pokolbin' }] });
    expect(w).toMatchObject({ kind: 'wider', from: 45, to: 60 });
    expect(w.text).toBe('Search wider: within 45 min of Pokolbin → 1 h');
    expect(showMore({ total: 3, shown: 12, reach: 120 })).toBe(null);
  });
  it('searches a margin that covers the drive', () => {
    expect(searchMarginKm(40)).toBeGreaterThan(40);
    expect(searchMarginKm(90)).toBeGreaterThan(searchMarginKm(60));
  });
});

describe('your own part of the map', () => {
  const box = { south: -32.9, west: 151.9, north: -32.6, east: 152.3 };
  it('in the box, too big, rounded', () => {
    expect(inBox({ lat: -32.7, lng: 152 }, box)).toBe(true);
    expect(inBox({ lat: -33.7, lng: 152 }, box)).toBe(false);
    expect(boxTooBig(box)).toBe(false);
    expect(boxTooBig({ south: -38, west: 145, north: -32, east: 152 })).toBe(true);
    expect(roundBox({ south: -32.91234, west: 151.9, north: -32.6, east: 152.31 })).toEqual({ south: -32.912, west: 151.9, north: -32.6, east: 152.31 });
  });
  it('named after the nearest town, never twice', () => {
    const areas = [{ name: 'Nelson Bay', lat: -32.72, lng: 152.14 }, { name: 'Pokolbin', lat: -32.78, lng: 151.29 }];
    expect(customAreaName(box, areas)).toBe('Custom: around Nelson Bay');
    expect(customAreaName(box, areas, ['Custom: around Nelson Bay'])).toBe('Custom: around Nelson Bay 2');
    expect(customAreaName({ south: -20, west: 130, north: -19.8, east: 130.2 }, areas)).toBe('Custom: around my area');
    expect(isCustomArea({ customAreas: { X: box } }, 'X')).toBe(true);
    expect(isCustomArea({}, 'X')).toBe(false);
  });
});

describe('on the way', () => {
  const home = { label: 'Inner West', lat: -33.88, lng: 151.16 };
  const to = { lat: -32.78, lng: 151.29 }; // Pokolbin, about 2 h
  const courses = [
    { id: 'gosford', name: 'Gosford', lat: -33.42, lng: 151.34 },   // near the line
    { id: 'kiama', name: 'Kiama', lat: -34.67, lng: 150.85 },       // the other way
    { id: 'strathfield', name: 'Strathfield', lat: -33.87, lng: 151.09 }, // at home
    { id: 'newcastle', name: 'Newcastle', lat: -32.93, lng: 151.75 }, // well off the line
    { id: 'cessnock', name: 'Cessnock', lat: -32.82, lng: 151.34 },  // in the area (skipped)
  ];
  it('finds courses a short detour off the drive, not home rounds or the other way', () => {
    const w = onTheWay(courses, { starts: [home], to, maxDetour: 20, skip: ['cessnock'] });
    expect(w.map((x) => x.course.id)).toEqual(['gosford']);
    expect(w[0].start).toBe('Inner West');
    expect(w[0].detour).toBeLessThanOrEqual(20);
    expect(onWayLine(w[0])).toMatch(/^On the way up or back · about \d+ min off the drive · .+ from Inner West$/);
  });
  it('a bigger detour takes in more; several starts take the best', () => {
    const wide = onTheWay(courses, { starts: [home], to, maxDetour: 200, skip: ['cessnock'] });
    expect(wide.map((x) => x.course.id)).toContain('newcastle');
    const two = onTheWay(courses, { starts: [home, { label: 'Central Coast', lat: -33.43, lng: 151.34 }], to, maxDetour: 20, skip: ['cessnock'] });
    expect(two.find((x) => x.course.id === 'gosford').start).toBe('Inner West');
  });
  it('nothing without a start, or for a short trip', () => {
    expect(onTheWay(courses, { starts: [], to })).toEqual([]);
    expect(onTheWay(courses, { starts: [{ label: 'x', lat: -32.8, lng: 151.3 }], to })).toEqual([]);
  });
  it('searches the drive in pieces', () => {
    const b = corridorBoxes([home], to, 20);
    expect(b.length).toBe(2);
    expect(b[0].south).toBeLessThan(home.lat);
    expect(b[1].north).toBeGreaterThan(to.lat);
    expect(corridorBoxes([home], null)).toEqual([]);
  });
});
