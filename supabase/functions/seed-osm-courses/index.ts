// Stage 8b part 4 — list Australia's golf courses from OpenStreetMap. STAGING; STOP before running on live.
// Started from the database (pg_net) with the token kept in private.seed_secret, one state at a time:
//   POST /functions/v1/seed-osm-courses?state=NSW   header x-seed-token: <token>
// Reads golf courses (leisure=golf_course) and their mapped holes (golf=hole) for that state from the Overpass API,
// then hands them to public.seed_courses(), which adds new listings and never changes a course a club or group owns.
// Data © OpenStreetMap contributors, ODbL — the app credits it wherever it's shown.

const STATES: Record<string, string> = {
  NSW: 'AU-NSW', VIC: 'AU-VIC', QLD: 'AU-QLD', WA: 'AU-WA', SA: 'AU-SA', TAS: 'AU-TAS', ACT: 'AU-ACT', NT: 'AU-NT',
};
// Some state boundaries aren't tagged with their code, so the name is tried too.
const NAMES: Record<string, string> = {
  NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland', WA: 'Western Australia', SA: 'South Australia',
  TAS: 'Tasmania', ACT: 'Australian Capital Territory', NT: 'Northern Territory',
};
// Rough box around each state (south, west, north, east), for running a big state in slices: ?part=1&of=3.
const BOX: Record<string, [number, number, number, number]> = {
  NSW: [-37.6, 140.9, -28.1, 153.7], VIC: [-39.3, 140.9, -33.9, 150.1], QLD: [-29.3, 137.9, -9.0, 153.6],
  WA: [-35.2, 112.9, -13.6, 129.1], SA: [-38.1, 129.0, -25.9, 141.1], TAS: [-43.8, 143.7, -39.4, 148.6],
  ACT: [-35.95, 148.7, -35.1, 149.45], NT: [-26.1, 128.9, -10.9, 138.1],
};
// The main Overpass server first, then public mirrors if it's busy or refuses.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.osm.jp/api/interpreter'];
const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type El = { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string>; center?: { lat: number; lon: number };
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

    // A slice of the state (by latitude), if asked for: part 1 is the north.
    const sp = new URL(req.url).searchParams;
    const part = Number(sp.get('part')) || 0, of = Number(sp.get('of')) || 0;
    let box = '', placeBox = '';
    if (part >= 1 && of >= 2 && part <= of) {
      const [s0, w0, n0, e0] = BOX[state];
      const step = (n0 - s0) / of;
      const north = n0 - step * (part - 1), south = n0 - step * part;
      box = `(${south.toFixed(3)},${w0},${north.toFixed(3)},${e0})`;
      placeBox = `(${(south - 0.2).toFixed(3)},${w0},${(north + 0.2).toFixed(3)},${e0})`;
    }
    const query = (areaSel: string) => `[out:json][timeout:120];
${areaSel}->.s;
(way["leisure"="golf_course"](area.s)${box};relation["leisure"="golf_course"](area.s)${box};);
out center tags;
way["golf"="hole"](area.s)${box};
out tags geom;
node["place"~"^(city|town|village|suburb)$"]["name"](area.s)${placeBox};
out;`;
    const tried: string[] = [];
    const overpass = async (q: string): Promise<El[] | null> => {
      for (const url of OVERPASS) {
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json, */*', 'User-Agent': 'TheGolfTrip/1.0 (golf course list)' },
            body: `data=${encodeURIComponent(q)}`,
          });
          if (r.ok) {
            // A server that ran out of time or memory still says 200, with a remark — that's a failure, not "no courses".
            const j = await r.json();
            if (j.remark && /error|timed out|out of memory|runtime/i.test(j.remark)) { tried.push(`${new URL(url).host} remark: ${String(j.remark).slice(0, 120)}`); continue; }
            // A server without boundary data answers with nothing — try the next one.
            if (!(j.elements || []).some((e: El) => e.tags?.leisure === 'golf_course')) { tried.push(`${new URL(url).host} no courses`); continue; }
            return j.elements;
          }
          tried.push(`${new URL(url).host} ${r.status} ${(await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
        } catch (e) { tried.push(`${new URL(url).host} ${(e as Error).message.slice(0, 60)}`); }
      }
      return null;
    };
    // The state's boundary by its code; if that finds no courses, by its name.
    let els = await overpass(query(`area["ISO3166-2"="${STATES[state]}"]`));
    if (!els) els = await overpass(query(`area["boundary"="administrative"]["admin_level"="4"]["name"="${NAMES[state]}"]`));
    if (!els) return new Response(`OpenStreetMap servers said: ${tried.join('; ')}`, { status: 502 });
    if (!els.some((e) => e.tags?.leisure === 'golf_course')) return new Response(`No courses came back for ${state} — try again later. ${tried.join('; ')}`, { status: 502 });

    // Towns, for courses with no address: the nearest within 10 km (a suburb or village before a big city's centre).
    const places = els.filter((e) => e.type === 'node' && e.tags?.place && e.tags?.name && e.lat != null)
      .map((e) => ({ name: e.tags!.name!, lat: e.lat!, lng: e.lon!, rank: e.tags!.place === 'city' ? 1.5 : 1 }));
    const townNear = (p: { lat: number; lng: number }) => {
      let best: string | null = null, bestScore = 10;
      for (const t of places) { const d = km(p, t) * t.rank; if (d < bestScore) { bestScore = d; best = t.name; } }
      return best;
    };
    const courses = els.filter((e) => e.tags?.leisure === 'golf_course' && e.tags?.name && e.center)
      .filter((e) => !/^(disused|abandoned)/.test(e.tags?.['lifecycle'] || '') && !e.tags?.['disused:leisure'])
      .map((e) => ({
        ref: `${e.type === 'relation' ? 'r' : 'w'}${e.id}`,
        name: e.tags!.name!.trim(),
        lat: e.center!.lat, lng: e.center!.lon,
        area: [e.tags!['addr:suburb'] || e.tags!['addr:city'] || e.tags!['addr:town'] || e.tags!['addr:place']
          || townNear({ lat: e.center!.lat, lng: e.center!.lon }), state].filter(Boolean).join(' '),
        holes: [] as { n: number; par: number | null; si: number | null; tee?: { lat: number; lng: number }; green?: { lat: number; lng: number }; osm: boolean }[],
      }));

    // Each mapped hole goes to the nearest course centre within 2.5 km. Only a clean set (holes 1–18, once each, every
    // one with a par and a stroke index) is sent; the database checks it again.
    for (const h of els.filter((e) => e.tags?.golf === 'hole' && e.geometry?.length)) {
      const n = int(h.tags?.ref);
      if (!n || n > 18) continue;
      const g = h.geometry!;
      const tee = { lat: g[0].lat, lng: g[0].lon }, green = { lat: g[g.length - 1].lat, lng: g[g.length - 1].lon };
      // Next-door courses (36-hole clubs): if two course centres are both within 2.5 km, the hole isn't used.
      const near = courses.filter((c) => km(green, c) < 2.5);
      if (near.length === 1) near[0].holes.push({ n, par: int(h.tags?.par), si: int(h.tags?.handicap), tee, green, osm: true });
    }
    const rows = courses.map(({ holes, ...c }) => {
      const nums = new Set(holes.map((h) => h.n));
      const sis = new Set(holes.map((h) => h.si));
      const clean = holes.length === 18 && nums.size === 18 && sis.size === 18
        && holes.every((h) => h.par && h.par >= 3 && h.par <= 6 && h.si && h.si >= 1 && h.si <= 18);
      return clean ? { ...c, holes: holes.sort((a, b) => a.n - b.n) } : c;
    });

    const result = await rpc('seed_courses', { p_state: state, p_rows: rows });
    if (box) result.part = `${part} of ${of}`;
    return new Response(JSON.stringify({ state, found: courses.length, holes_mapped: els.filter((e) => e.tags?.golf === 'hole').length, ...result }),
      { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(`Seeding failed: ${(e as Error).message}`, { status: 500 });
  }
});
