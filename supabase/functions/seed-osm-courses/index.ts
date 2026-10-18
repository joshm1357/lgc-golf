// Stage 8b part 4 — list Australia's golf courses from OpenStreetMap. STAGING; STOP before running on live.
// Started from the database (pg_net) with the token kept in private.seed_secret, one state at a time:
//   POST /functions/v1/seed-osm-courses?state=NSW   header x-seed-token: <token>
// Reads golf courses (leisure=golf_course) and their mapped holes (golf=hole) for that state from the Overpass API,
// then hands them to public.seed_courses(), which adds new listings and never changes a course a club or group owns.
// Data © OpenStreetMap contributors, ODbL — the app credits it wherever it's shown.

const STATES: Record<string, string> = {
  NSW: 'AU-NSW', VIC: 'AU-VIC', QLD: 'AU-QLD', WA: 'AU-WA', SA: 'AU-SA', TAS: 'AU-TAS', ACT: 'AU-ACT', NT: 'AU-NT',
};
// The main Overpass server first, then two public mirrors if it's busy or refuses.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type El = { type: string; id: number; tags?: Record<string, string>; center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[] };

async function rpc(name: string, body: unknown) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name}: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, t = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * t) / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(((b.lng - a.lng) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const int = (v?: string) => (v && /^\d{1,2}$/.test(v.trim()) ? Number(v.trim()) : null);

Deno.serve(async (req) => {
  try {
    const token = req.headers.get('x-seed-token') || '';
    if (!token || !(await rpc('seed_token_ok', { p_token: token }))) return new Response('Not allowed', { status: 403 });
    const state = (new URL(req.url).searchParams.get('state') || '').toUpperCase();
    if (!STATES[state]) return new Response('Pick a state: ' + Object.keys(STATES).join(', '), { status: 400 });

    const q = `[out:json][timeout:170];
area["ISO3166-2"="${STATES[state]}"]->.s;
(way["leisure"="golf_course"](area.s);relation["leisure"="golf_course"](area.s););
out center tags;
way["golf"="hole"](area.s);
out tags geom;`;
    let els: El[] | null = null;
    const tried: string[] = [];
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json, */*', 'User-Agent': 'TheGolfTrip/1.0 (golf course list)' },
          body: `data=${encodeURIComponent(q)}`,
        });
        if (r.ok) { els = (await r.json()).elements || []; break; }
        tried.push(`${new URL(url).host} ${r.status}`);
      } catch (e) { tried.push(`${new URL(url).host} ${(e as Error).message.slice(0, 60)}`); }
    }
    if (!els) return new Response(`OpenStreetMap servers said: ${tried.join('; ')}`, { status: 502 });

    const courses = els.filter((e) => e.tags?.leisure === 'golf_course' && e.tags?.name && e.center)
      .filter((e) => !/^(disused|abandoned)/.test(e.tags?.['lifecycle'] || '') && !e.tags?.['disused:leisure'])
      .map((e) => ({
        ref: `${e.type === 'relation' ? 'r' : 'w'}${e.id}`,
        name: e.tags!.name!.trim(),
        lat: e.center!.lat, lng: e.center!.lon,
        area: [e.tags!['addr:suburb'] || e.tags!['addr:city'] || e.tags!['addr:town'] || e.tags!['addr:place'], state].filter(Boolean).join(' '),
        holes: [] as { n: number; par: number | null; si: number | null; tee?: { lat: number; lng: number }; green?: { lat: number; lng: number }; osm: boolean }[],
      }));

    // Each mapped hole goes to the nearest course centre within 2.5 km. Only a clean set (holes 1–18, once each, every
    // one with a par and a stroke index) is sent; the database checks it again.
    for (const h of els.filter((e) => e.tags?.golf === 'hole' && e.geometry?.length)) {
      const n = int(h.tags?.ref);
      if (!n || n > 18) continue;
      const g = h.geometry!;
      const tee = { lat: g[0].lat, lng: g[0].lon }, green = { lat: g[g.length - 1].lat, lng: g[g.length - 1].lon };
      let best = null as null | (typeof courses)[number], bestKm = 2.5;
      for (const c of courses) { const d = km(green, c); if (d < bestKm) { bestKm = d; best = c; } }
      if (best) best.holes.push({ n, par: int(h.tags?.par), si: int(h.tags?.handicap), tee, green, osm: true });
    }
    const rows = courses.map(({ holes, ...c }) => {
      const nums = new Set(holes.map((h) => h.n));
      const sis = new Set(holes.map((h) => h.si));
      const clean = holes.length === 18 && nums.size === 18 && sis.size === 18
        && holes.every((h) => h.par && h.par >= 3 && h.par <= 6 && h.si && h.si >= 1 && h.si <= 18);
      return clean ? { ...c, holes: holes.sort((a, b) => a.n - b.n) } : c;
    });

    const result = await rpc('seed_courses', { p_state: state, p_rows: rows });
    return new Response(JSON.stringify({ state, found: courses.length, holes_mapped: els.filter((e) => e.tags?.golf === 'hole').length, ...result }),
      { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(`Seeding failed: ${(e as Error).message}`, { status: 500 });
  }
});
