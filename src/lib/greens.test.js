import { describe, it, expect } from 'vitest';
import { greenDistances, holesFromOsm, mergeGreens, greensMapped, osmQuery } from './greens.js';
import { distanceM } from './geo.js';

// A made-up hole near Shoalhaven Heads: tee in the south, green ~300 m north, a 30 m long green.
const o = { lat: -34.85, lng: 150.75 };
const north = (m, east = 0) => ({ lat: o.lat + m / 111195, lon: o.lng + east / (111195 * Math.cos((o.lat * Math.PI) / 180)) });
const greenOutline = [north(285, -10), north(285, 10), north(315, 10), north(315, -10)];
const osm = {
  elements: [
    { type: 'way', tags: { golf: 'hole', ref: '3', par: '4' }, geometry: [north(0), north(150, 5), north(300)] },
    { type: 'way', tags: { golf: 'green' }, geometry: greenOutline },
    { type: 'way', tags: { golf: 'hole', ref: '4' }, geometry: [north(400), north(700)] }, // no green drawn
    { type: 'way', tags: { golf: 'fairway' }, geometry: [north(10), north(20), north(30)] },
  ],
};

describe('distance to the green', () => {
  it('reads holes and greens from OpenStreetMap', () => {
    const h = holesFromOsm(osm);
    expect(Object.keys(h).sort()).toEqual(['3', '4']);
    const tee = { lat: h[3].tee.lat, lng: h[3].tee.lng };
    expect(Math.round(distanceM(tee, h[3].green))).toBeGreaterThanOrEqual(298);
    expect(Math.round(distanceM(tee, h[3].green))).toBeLessThanOrEqual(302);
    // front is nearer the tee than the back, 30 m apart (±1 m)
    const f = distanceM(tee, h[3].front);
    const b = distanceM(tee, h[3].back);
    expect(f).toBeLessThan(b);
    expect(Math.abs(b - f - 30)).toBeLessThan(1.5);
    // a hole with no green outline still gets its end as the middle
    expect(h[4].green).toBeTruthy();
    expect(h[4].front).toBeUndefined();
  });
  it('measures from where you are', () => {
    const h = holesFromOsm(osm)[3];
    const me = { lat: north(150).lat, lng: north(150).lon };
    const d = greenDistances(h, me, null);
    expect(d.middle).toBeGreaterThanOrEqual(148);
    expect(d.middle).toBeLessThanOrEqual(152);
    expect(d.front).toBeLessThan(d.middle);
    expect(d.back).toBeGreaterThan(d.middle);
    expect(d.pin).toBeNull();
  });
  it('flips a hole drawn green-to-tee, and keeps the nearer of two holes with the same number', () => {
    const flipped = { elements: [
      { type: 'way', tags: { golf: 'hole', ref: '3' }, geometry: [north(300), north(150, 5), north(0)] },
      { type: 'way', tags: { golf: 'green' }, geometry: greenOutline },
      { type: 'way', tags: { golf: 'hole', ref: '3' }, geometry: [north(3000), north(3300)] },
    ] };
    const h = holesFromOsm(flipped, { lat: north(100).lat, lng: north(100).lon });
    const tee = { lat: north(0).lat, lng: north(0).lon };
    expect(Math.round(distanceM(tee, h[3].tee))).toBeLessThan(2);
    expect(h[3].front).toBeTruthy();
  });
  it('fills only empty holes unless told to overwrite', () => {
    const holes = [{ n: 3, par: 4, si: 6, green: { lat: 1, lng: 1 } }, { n: 4, par: 4, si: 2 }];
    const found = holesFromOsm(osm);
    const keep = mergeGreens(holes, found);
    expect(keep.changed).toBe(1);
    expect(keep.holes[0].green).toEqual({ lat: 1, lng: 1 });
    const all = mergeGreens(holes, found, true);
    expect(all.changed).toBe(2);
    expect(greensMapped(all.holes)).toBe(2);
    expect(all.holes[0].par).toBe(4); // par and SI untouched
  });
  it('builds the map query', () => {
    expect(osmQuery({ lat: -34.8, lng: 150.7 })).toContain('around:2500,-34.8,150.7');
  });
});

import { courseTiles } from './greens.js';
describe('saving the course map for offline', () => {
  it('covers the course at each zoom with a sensible number of tiles', () => {
    const holes = [{ n: 1, tee: { lat: -34.85, lng: 150.75 }, green: { lat: -34.847, lng: 150.75 } }, { n: 2, tee: { lat: -34.846, lng: 150.752 }, green: { lat: -34.844, lng: 150.755 } }];
    const t = courseTiles(holes);
    const z18 = t.filter((x) => x.z === 18);
    expect(z18.length).toBeGreaterThan(4);
    expect(t.length).toBeLessThan(400);
    expect(new Set(t.map((x) => `${x.z}/${x.x}/${x.y}`)).size).toBe(t.length);
    expect(courseTiles([{ n: 1 }])).toEqual([]);
  });
});

import { planLegs } from './greens.js';
describe('shot planning', () => {
  const p = (m) => ({ lat: -34.85 + m / 111195, lng: 150.75 });
  it('measures each shot from you, through the targets, to the green', () => {
    const r = planLegs(p(0), [p(210), p(330)], p(400));
    expect(r.legs.map((l) => l.m)).toEqual([210, 120, 70]);
    expect(r.total).toBe(400);
  });
  it('works with no finish point and with no start (planning from the first target)', () => {
    expect(planLegs(p(0), [p(150)]).legs.map((l) => l.m)).toEqual([150]);
    expect(planLegs(null, [p(100), p(250)], p(300)).legs.map((l) => l.m)).toEqual([150, 50]);
  });
});
