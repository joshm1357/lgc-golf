// Distance to the green — pure functions (no React, no network) so they can be tested.
//
// Plain words:
//   - Each hole can store its tee and the green's front, middle and back as map points.
//   - Your phone's GPS gives where you are (good to about 5–10 m); the distance is a straight
//     line from you to each point, in metres — the same idea every golf GPS app uses.
//   - OpenStreetMap (free, volunteer-made) often has golf courses drawn in: each hole as a line
//     from tee to green (tagged with the hole number) and each green as an outline. From those we
//     can fill in every hole at once: the tee is the start of the line, the middle is the centre of
//     the green, and front/back are where the green starts and ends along the line of play.
import { distanceM } from './geo.js';

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Flat metres (x east, y north) around an origin — accurate enough within a golf hole. */
function toXY(o, p) {
  return { x: rad(p.lng - o.lng) * R * Math.cos(rad(o.lat)), y: rad(p.lat - o.lat) * R };
}
function fromXY(o, v) {
  return { lat: o.lat + deg(v.y / R), lng: o.lng + deg(v.x / (R * Math.cos(rad(o.lat)))) };
}
const round6 = (p) => p && { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };

/** Distances in whole metres from `me` to the hole's front / middle / back and today's pin. */
export function greenDistances(hole, me, pin) {
  if (!hole || !me) return null;
  const d = (p) => (p ? Math.round(distanceM(me, p)) : null);
  return { front: d(hole.front), middle: d(hole.green), back: d(hole.back), pin: d(pin) };
}

/** How many holes have a green middle mapped. */
export const greensMapped = (holes = []) => holes.filter((h) => h.green).length;

function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/**
 * Turn an OpenStreetMap (Overpass "out geom") answer into hole points.
 * Returns { [holeNumber]: { tee, green, front, back } } for the holes it could read.
 */
export function holesFromOsm(osm, anchor = null) {
  const els = osm?.elements || [];
  const geom = (e) => (e.geometry || []).map((g) => ({ lat: g.lat, lng: g.lon }));
  const lines = els.filter((e) => e.type === 'way' && e.tags?.golf === 'hole' && e.geometry?.length >= 2);
  const greens = els.filter((e) => e.type === 'way' && e.tags?.golf === 'green' && e.geometry?.length >= 3).map(geom);
  const out = {};
  const closeness = {};
  // The green a point sits on: the one it's inside, else the closest within 60 m.
  const greenAt = (end) => {
    let best = null;
    for (const g of greens) {
      const xy = g.map((p) => toXY(end, p));
      const centre = { x: xy.reduce((s, p) => s + p.x, 0) / xy.length, y: xy.reduce((s, p) => s + p.y, 0) / xy.length };
      const dist = Math.hypot(centre.x, centre.y);
      const isIn = inside({ x: 0, y: 0 }, xy);
      if (isIn || dist < 60) {
        const score = isIn ? -1 : dist;
        if (!best || score < best.score) best = { g, xy, centre, score };
      }
    }
    return best;
  };
  for (const ln of lines) {
    const n = parseInt(String(ln.tags.ref || '').trim(), 10);
    if (!n || n < 1 || n > 27) continue;
    let pts = geom(ln);
    // Holes are usually drawn tee → green; if the green is at the other end, flip it.
    let best = greenAt(pts[pts.length - 1]);
    if (!best && greenAt(pts[0])) { pts = [...pts].reverse(); best = greenAt(pts[pts.length - 1]); }
    // Two courses in range (a 36-hole club) can both have a hole 7: keep the one nearest where we are.
    if (anchor) {
      const mid = pts[Math.floor(pts.length / 2)];
      const d = distanceM(anchor, mid);
      if (closeness[n] != null && closeness[n] <= d) continue;
      closeness[n] = d;
    } else if (out[n]) continue;
    const tee = pts[0];
    const end = pts[pts.length - 1];
    const before = pts[pts.length - 2];
    if (!best) {
      out[n] = { tee: round6(tee), green: round6(end) };
      continue;
    }
    const middle = fromXY(end, best.centre);
    // Line of play into the green: from the second-last point of the hole line to the middle.
    const a = toXY(middle, before);
    const len = Math.hypot(a.x, a.y) || 1;
    const dir = { x: -a.x / len, y: -a.y / len }; // pointing from the approach into the green
    const proj = best.g.map((p) => { const v = toXY(middle, p); return v.x * dir.x + v.y * dir.y; });
    const front = fromXY(middle, { x: dir.x * Math.min(...proj), y: dir.y * Math.min(...proj) });
    const back = fromXY(middle, { x: dir.x * Math.max(...proj), y: dir.y * Math.max(...proj) });
    out[n] = { tee: round6(tee), green: round6(middle), front: round6(front), back: round6(back) };
  }
  return out;
}

/** The Overpass query for golf holes and greens within `radius` metres of a point. */
export function osmQuery({ lat, lng }, radius = 2500) {
  return `[out:json][timeout:25];(way["golf"="hole"](around:${radius},${lat},${lng});way["golf"="green"](around:${radius},${lat},${lng}););out geom;`;
}

/** Merge OSM points into a course's holes. `overwrite` false = only fill holes that have nothing yet. */
export function mergeGreens(holes, found, overwrite = false) {
  let changed = 0;
  const next = holes.map((h) => {
    const f = found[h.n];
    if (!f) return h;
    if (!overwrite && h.green) return h;
    changed++;
    return { ...h, tee: f.tee || h.tee, green: f.green || h.green, front: f.front || (overwrite ? undefined : h.front), back: f.back || (overwrite ? undefined : h.back) };
  });
  return { holes: next, changed };
}

/** Map tile numbers (Web Mercator x/y at zoom z) covering every mapped point of a course, plus a margin. */
export function courseTiles(holes, { zooms = [15, 16, 17, 18], marginM = 150 } = {}) {
  const pts = holes.flatMap((h) => ['tee', 'front', 'green', 'back'].map((k) => h[k]).filter(Boolean));
  if (!pts.length) return [];
  const dLat = marginM / 111195;
  const minLat = Math.min(...pts.map((p) => p.lat)) - dLat;
  const maxLat = Math.max(...pts.map((p) => p.lat)) + dLat;
  const midLat = (minLat + maxLat) / 2;
  const dLng = marginM / (111195 * Math.cos(rad(midLat)));
  const minLng = Math.min(...pts.map((p) => p.lng)) - dLng;
  const maxLng = Math.max(...pts.map((p) => p.lng)) + dLng;
  const tx = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
  const ty = (lat, z) => Math.floor(((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2) * 2 ** z);
  const out = [];
  for (const z of zooms) {
    for (let x = tx(minLng, z); x <= tx(maxLng, z); x++) {
      for (let y = ty(maxLat, z); y <= ty(minLat, z); y++) out.push({ z, x, y });
    }
  }
  return out;
}

/**
 * Shot planning: the legs from where you start, through each target you tapped, to where you finish
 * (today's pin, else the middle of the green). Returns { legs: [{ from, to, m }], total }.
 */
export function planLegs(start, targets = [], finish = null) {
  const pts = [start, ...targets, finish].filter(Boolean);
  const legs = [];
  for (let i = 1; i < pts.length; i++) legs.push({ from: pts[i - 1], to: pts[i], m: Math.round(distanceM(pts[i - 1], pts[i])) });
  return { legs, total: legs.reduce((s, l) => s + l.m, 0) };
}
