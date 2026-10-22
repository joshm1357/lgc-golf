import { describe, it, expect } from 'vitest';
import {
  holeLength, holePoints, frameHole, courseCentre, greenEdgesFor, guideDistances, mappingProgress,
  nextUnmapped, stepHole, holeFromParam, swipeStep, plannerStart, liveRoundOn,
} from './courseguide.js';
import { distanceM } from './geo.js';

// A made-up hole: tee in the south, green 350 m north, 30 m deep (front at 335, back at 365).
const o = { lat: -34.85, lng: 150.75 };
const at = (northM, eastM = 0) => ({ lat: o.lat + northM / 111195, lng: o.lng + eastM / (111195 * Math.cos((o.lat * Math.PI) / 180)) });
const hole = { n: 1, par: 4, si: 7, tee: at(0), front: at(335), green: at(350), back: at(365) };
const bare = { n: 2, par: 3, si: 15 };

describe('hole length', () => {
  it('is the straight line from the tee to the middle of the green, whole metres', () => {
    expect(holeLength(hole)).toBe(350);
  });
  it('is null without a tee or a green', () => {
    expect(holeLength(bare)).toBeNull();
    expect(holeLength({ ...hole, tee: undefined })).toBeNull();
    expect(holeLength(null)).toBeNull();
  });
});

describe('framing the hole on the map', () => {
  it('covers the tee to the back of the green, plus the margin', () => {
    const [sw, ne] = frameHole(hole, { marginM: 30 });
    expect(Math.round(distanceM(sw, { lat: sw.lat, lng: ne.lng }))).toBe(60); // 0 m wide + 30 m each side
    expect(Math.round(distanceM(sw, { lat: ne.lat, lng: sw.lng }))).toBe(425); // 365 m + 30 m each end
    expect(sw.lat).toBeLessThan(hole.tee.lat);
    expect(ne.lat).toBeGreaterThan(hole.back.lat);
  });
  it('includes today’s pin when it sits off the mapped points', () => {
    const pin = at(360, 25);
    const [, ne] = frameHole(hole, { pin, marginM: 10 });
    expect(ne.lng).toBeGreaterThan(pin.lng);
  });
  it('a hole with nothing mapped has no frame', () => {
    expect(frameHole(bare)).toEqual([]);
    expect(holePoints(bare)).toEqual([]);
  });
  it('a hole with only a green still gets a box (not zoomed to the max)', () => {
    const [sw, ne] = frameHole({ n: 3, green: at(100) }, { marginM: 40 });
    expect(Math.round(distanceM(sw, { lat: ne.lat, lng: sw.lng }))).toBe(80);
  });
});

describe('where the course is', () => {
  it('is the middle of every mapped point', () => {
    const c = courseCentre([hole, bare]);
    expect(Math.round(distanceM(c, at(262.5)))).toBe(0); // (0 + 335 + 350 + 365) / 4
  });
  it('is null when nothing is mapped', () => {
    expect(courseCentre([bare])).toBeNull();
    expect(courseCentre()).toBeNull();
  });
});

describe('front and back as the player sees them', () => {
  it('from the fairway: front is the near edge', () => {
    const d = guideDistances(hole, at(200));
    expect(d).toMatchObject({ front: 135, middle: 150, back: 165, pin: null, flipped: false });
  });
  it('from behind the green: the stored back is now the front', () => {
    const d = guideDistances(hole, at(420));
    expect(d).toMatchObject({ front: 55, middle: 70, back: 85, flipped: true });
    expect(greenEdgesFor(hole, at(420)).front).toBe(hole.back);
  });
  it('with today’s pin', () => {
    expect(guideDistances(hole, at(200), at(358)).pin).toBe(158);
  });
  it('a green with only a middle still gives the middle', () => {
    expect(guideDistances({ n: 4, green: at(100) }, at(0))).toMatchObject({ front: null, middle: 100, back: null, flipped: false });
  });
  it('no fix, no distances', () => {
    expect(guideDistances(hole, null)).toBeNull();
  });
});

describe('mapping progress', () => {
  const holes = [hole, bare, { n: 3, par: 4, si: 1, green: at(10) }, { n: 4, par: 5, si: 3 }];
  it('counts greens mapped', () => {
    expect(mappingProgress(holes)).toEqual({ mapped: 2, total: 4, done: false });
    expect(mappingProgress([hole])).toEqual({ mapped: 1, total: 1, done: true });
    expect(mappingProgress([])).toEqual({ mapped: 0, total: 0, done: false });
  });
  it('finds the next hole to map, going round', () => {
    expect(nextUnmapped(holes, 0)).toBe(2);
    expect(nextUnmapped(holes, 2)).toBe(4);
    expect(nextUnmapped(holes, 4)).toBe(2);
    expect(nextUnmapped([hole])).toBeNull();
  });
});

describe('moving between holes', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1 }));
  it('steps forward and back, going round', () => {
    expect(stepHole(holes, 1, 1)).toBe(2);
    expect(stepHole(holes, 18, 1)).toBe(1);
    expect(stepHole(holes, 1, -1)).toBe(18);
    expect(stepHole(holes, 99, 1)).toBe(1);
    expect(stepHole([], 1, 1)).toBeNull();
  });
  it('reads the hole from the address', () => {
    expect(holeFromParam(holes, '7')).toBe(7);
    expect(holeFromParam(holes, undefined)).toBe(1);
    expect(holeFromParam(holes, '27')).toBe(1);
    expect(holeFromParam(holes, 'abc')).toBe(1);
    expect(holeFromParam([], '3')).toBeNull();
  });
  it('a sideways swipe changes hole; a scroll does not', () => {
    expect(swipeStep(-120, 10)).toBe(1);
    expect(swipeStep(120, -5)).toBe(-1);
    expect(swipeStep(30, 0)).toBe(0);
    expect(swipeStep(-100, 90)).toBe(0);
  });
});

describe('shot planner start', () => {
  it('starts from me when I’m near the hole', () => {
    expect(plannerStart({ want: 'me', pos: { ...at(100), accuracy: 5 }, hole, finish: hole.green })).toEqual({ from: 'me', start: at(100) });
  });
  it('falls back to the tee when I’m far away (at home) or asked for the tee', () => {
    expect(plannerStart({ want: 'me', pos: at(5000), hole, finish: hole.green })).toEqual({ from: 'tee', start: hole.tee });
    expect(plannerStart({ want: 'tee', pos: at(100), hole, finish: hole.green }).from).toBe('tee');
    expect(plannerStart({ want: 'me', pos: null, hole, finish: hole.green }).from).toBe('tee');
  });
  it('no tee and no fix: nowhere to start', () => {
    expect(plannerStart({ want: 'tee', hole: bare })).toEqual({ from: null, start: null });
  });
});

describe('the live round on a course', () => {
  const rounds = [
    { id: 'a', course_id: 'c1', status: 'locked' },
    { id: 'b', course_id: 'c1', status: 'live' },
    { id: 'c', course_id: 'c1', status: 'live' },
    { id: 'd', course_id: 'c2', status: 'live' },
  ];
  it('picks the one asked for if it’s live there, else the first live one', () => {
    expect(liveRoundOn(rounds, 'c1', 'c').id).toBe('c');
    expect(liveRoundOn(rounds, 'c1', 'a').id).toBe('b');
    expect(liveRoundOn(rounds, 'c1', 'd').id).toBe('b');
    expect(liveRoundOn(rounds, 'c3')).toBeNull();
  });
});
