// The course guide — pure functions (no React, no network) so they can be tested.
//
// Plain words:
//   - A hole can store its tee and the green's front, middle and back as map points (see greens.js).
//   - The hole's length here is a straight line from the tee to the middle of the green, in metres.
//     Real scorecard lengths follow the fairway (doglegs), so we always call ours "approx".
//   - "Front" and "back" are stored as seen from the tee. If you're behind the green (on the next tee,
//     or you've gone long), the near edge is the stored back — so we swap them to match what you see.
//   - Framing: the satellite map shows the whole hole, tee to green, plus a small margin.
import { distanceM } from './geo.js';
import { greenDistances } from './greens.js';

const POINTS = ['tee', 'front', 'green', 'back'];

/** Straight-line length of the hole from the tee to the middle of the green, whole metres (null if not mapped). */
export function holeLength(hole) {
  if (!hole?.tee || !hole?.green) return null;
  return Math.round(distanceM(hole.tee, hole.green));
}

/** The mapped points of a hole, in play order (tee, front, middle, back), plus today's pin if given. */
export function holePoints(hole, pin = null) {
  if (!hole) return [];
  return [...POINTS.map((k) => hole[k]), pin].filter((p) => p && p.lat != null && p.lng != null);
}

/**
 * The box to show on the map for a hole: every mapped point plus `marginM` metres all round.
 * Returns two corner points [south-west, north-east] (ready for CourseMap's `fit`), or [] if nothing is mapped.
 * A hole with only one point (e.g. just the green) gets a box `marginM` around it, so the map isn't zoomed to the max.
 */
export function frameHole(hole, { pin = null, marginM = 35 } = {}) {
  const pts = holePoints(hole, pin);
  if (!pts.length) return [];
  const minLat = Math.min(...pts.map((p) => p.lat));
  const maxLat = Math.max(...pts.map((p) => p.lat));
  const minLng = Math.min(...pts.map((p) => p.lng));
  const maxLng = Math.max(...pts.map((p) => p.lng));
  const midLat = (minLat + maxLat) / 2;
  const dLat = marginM / 111195;
  const dLng = marginM / (111195 * Math.cos((midLat * Math.PI) / 180));
  return [{ lat: minLat - dLat, lng: minLng - dLng }, { lat: maxLat + dLat, lng: maxLng + dLng }];
}

/** Roughly where a course is: the average of every mapped point (null if none). */
export function courseCentre(holes = []) {
  const pts = holes.flatMap((h) => holePoints(h));
  if (!pts.length) return null;
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
}

/**
 * Front and back as the player sees them. Stored front/back are from the tee; if the player is nearer
 * the stored back, they're behind the green, so swap. Returns { front, back, flipped }.
 */
export function greenEdgesFor(hole, me) {
  const front = hole?.front || null;
  const back = hole?.back || null;
  if (!me || !front || !back) return { front, back, flipped: false };
  const flipped = distanceM(me, back) < distanceM(me, front);
  return flipped ? { front: back, back: front, flipped } : { front, back, flipped };
}

/** Distances in whole metres from `me` to the front / middle / back (as the player sees them) and today's pin. */
export function guideDistances(hole, me, pin = null) {
  if (!hole || !me) return null;
  const { front, back, flipped } = greenEdgesFor(hole, me);
  return { ...greenDistances({ ...hole, front, back }, me, pin), flipped };
}

/** How the green mapping is going: { mapped, total, done }. A hole counts once its green middle is placed. */
export function mappingProgress(holes = []) {
  const mapped = holes.filter((h) => h.green).length;
  return { mapped, total: holes.length, done: holes.length > 0 && mapped === holes.length };
}

/** The next hole after `after` with no green mapped, going round from 18 to 1. Null if all are mapped. */
export function nextUnmapped(holes = [], after = 0) {
  const sorted = [...holes].sort((a, b) => a.n - b.n);
  const later = sorted.find((h) => h.n > after && !h.green);
  return (later || sorted.find((h) => !h.green))?.n ?? null;
}

/** The hole number one step forward (dir 1) or back (dir -1), going round from the last hole to the first. */
export function stepHole(holes = [], n, dir) {
  const nums = holes.map((h) => h.n).sort((a, b) => a - b);
  if (!nums.length) return null;
  const i = nums.indexOf(n);
  if (i < 0) return nums[0];
  return nums[(i + dir + nums.length) % nums.length];
}

/** The hole asked for in the address (e.g. "/guide/abc/7"), or the first hole if it's missing or not on the course. */
export function holeFromParam(holes = [], param) {
  const n = parseInt(String(param ?? ''), 10);
  if (holes.some((h) => h.n === n)) return n;
  return holes.length ? Math.min(...holes.map((h) => h.n)) : null;
}

/**
 * A finger swipe across the screen: -1 = back a hole (swiped right), 1 = forward (swiped left), 0 = not a swipe.
 * Needs at least `min` px sideways and to be mostly sideways (so scrolling up and down isn't mistaken for it).
 */
export function swipeStep(dx, dy, min = 60) {
  if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * Where the shot planner measures from. `want` is 'me' or 'tee'. "Me" only works with a GPS fix that's
 * near the hole (within `nearM` of the green); otherwise fall back to the tee. Returns { from, start }.
 */
export function plannerStart({ want = 'me', pos = null, hole = null, finish = null, nearM = 800 } = {}) {
  const me = pos ? { lat: pos.lat, lng: pos.lng } : null;
  const near = !!me && (!finish || distanceM(me, finish) < nearM);
  if (want === 'me' && near) return { from: 'me', start: me };
  if (hole?.tee) return { from: 'tee', start: hole.tee };
  if (me) return { from: 'me', start: me };
  return { from: null, start: null };
}

/** A live round on this course (today's pins come from it), preferring the one asked for. */
export function liveRoundOn(rounds = [], courseId, preferId = null) {
  const live = rounds.filter((r) => r.course_id === courseId && r.status === 'live');
  return live.find((r) => r.id === preferId) || live[0] || null;
}
