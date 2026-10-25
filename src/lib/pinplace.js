// Dropping a pin for a place to stay (v10.5, Josh 23 Oct: "locations are a bit hard to pin… the typing in should also
// have a pre-fill"). Pure helpers: the towns near a tapped spot (to pre-fill its name), and towns matching what's typed
// (to pin by name instead of tapping). areas: stay_areas rows { name, region, lat, lng }.
import { distanceM } from './geo.js';

/** The towns nearest a point, closest first, within maxKm: [{ name, region, lat, lng, km }]. */
export function nearTowns(p, areas = [], n = 3, maxKm = 25) {
  if (!p || p.lat == null) return [];
  return (areas || []).filter((a) => a && a.lat != null && a.name)
    .map((a) => ({ ...a, km: Math.round(distanceM(p, a) / 100) / 10 }))
    .filter((a) => a.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .filter((a, i, l) => l.findIndex((x) => x.name === a.name) === i)
    .slice(0, n);
}

/** A name to start with for a pin: the nearest town ("Pokolbin"), "Near Pokolbin" when it's a few km out, else ''. */
export function pinNameFor(p, areas = []) {
  const [t] = nearTowns(p, areas, 1);
  if (!t) return '';
  return t.km <= 2 ? t.name : `Near ${t.name}`;
}

/** Towns matching what's typed (starts-with first), up to n: [{ name, region, lat, lng }]. */
export function matchTowns(query, areas = [], n = 6) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  return (areas || []).filter((a) => a && a.lat != null && a.name)
    .map((a) => ({ a, s: a.name.toLowerCase().startsWith(q) ? 0 : a.name.toLowerCase().includes(q) ? 1 : String(a.region || '').toLowerCase().includes(q) ? 2 : 9 }))
    .filter((x) => x.s < 9)
    .sort((x, y) => x.s - y.s || x.a.name.localeCompare(y.a.name))
    .map((x) => x.a)
    .filter((a, i, l) => l.findIndex((x) => x.name === a.name) === i)
    .slice(0, n);
}
