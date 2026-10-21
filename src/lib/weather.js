// Weather on the trip (feature 'weather', a child of the planner). Pure functions only — no network here.
// The forecast comes from Open-Meteo (free, no key, called from the phone; credit "Weather data by Open-Meteo.com").
// components/Weather.jsx does the fetching and the saved copy on the phone (one per place per hour).
//
// Plain words:
//   - Where: the trip's course (the middle of its mapped greens or tees). No course with a map yet → the trip's
//     place name, looked up with Open-Meteo's place search.
//   - When: Open-Meteo forecasts 16 days ahead (today + 15). Trip days in that window are shown; the further out,
//     the rougher the guide (more than a week out says so).
//   - Wind is what matters for golf: km/h, where it's coming from, and roughly how many clubs it's worth.

import { daysUntil, parseDate } from './plan.js';

export const HORIZON_DAYS = 16; // Open-Meteo's longest forecast
export const ROUGH_AFTER = 7; // further out than this is "a rough guide"
export const CREDIT = 'Weather data by Open-Meteo.com';
export const CREDIT_URL = 'https://open-meteo.com/';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (x) => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x));

/** Every day of a trip, first to last (at most 10). */
export function tripDays(start, end) {
  const a = parseDate(start);
  if (!a) return [];
  const b = parseDate(end) || a;
  const out = [];
  for (let d = new Date(a); d <= b && out.length < 10; d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
}

/** Add whole days to "2026-10-21". */
export function addDays(date, n) {
  const d = parseDate(date);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return iso(d);
}

/**
 * Which trip days to show a forecast for.
 *   { show: [days in the forecast window], rough: bool (any shown day more than a week out),
 *     state: 'show' | 'soon' (not in the window yet) | 'past' | 'none' (no dates), opensOn: first day it shows up }
 */
export function forecastWindow(days, today, horizon = HORIZON_DAYS) {
  if (!days?.length) return { state: 'none', show: [], rough: false, opensOn: null };
  const last = days[days.length - 1];
  if (daysUntil(last, today) < 0) return { state: 'past', show: [], rough: false, opensOn: null };
  const show = days.filter((d) => { const n = daysUntil(d, today); return n >= 0 && n < horizon; });
  if (!show.length) return { state: 'soon', show: [], rough: false, opensOn: addDays(days[0], -(horizon - 1)) };
  return { state: 'show', show, rough: show.some((d) => daysUntil(d, today) > ROUGH_AFTER), opensOn: null };
}

/** The middle of a course's mapped greens (or tees if no greens). null when nothing's mapped. */
export function courseSpot(course) {
  const holes = Array.isArray(course?.holes) ? course.holes : [];
  for (const key of ['green', 'tee']) {
    const pts = holes.map((h) => h?.[key]).filter((p) => p && num(p.lat) != null && num(p.lng) != null);
    if (pts.length) {
      const lat = pts.reduce((s, p) => s + Number(p.lat), 0) / pts.length;
      const lng = pts.reduce((s, p) => s + Number(p.lng), 0) / pts.length;
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, name: course.name || '' };
    }
  }
  return null;
}

/**
 * Where to get a trip's weather: its rounds' courses first (soonest round first), then the courses copied from last
 * time ("Same as last time"), then the place name to look up. Returns { lat, lng, name } or { query } or null.
 */
export function tripPlace({ plan, rounds = [], coursesById = {}, shapeCourseIds = [] }) {
  const mine = plan?.trip_id ? rounds.filter((r) => r.trip_id === plan.trip_id) : [];
  const ids = [...[...mine].sort((a, b) => String(a.play_date || '').localeCompare(String(b.play_date || ''))).map((r) => r.course_id), ...shapeCourseIds];
  for (const id of ids) {
    const spot = courseSpot(coursesById[id]);
    if (spot) return spot;
  }
  const query = placeQuery(plan?.location_name || plan?.address);
  return query ? { query } : null;
}

const STATES = /\b(nsw|vic|qld|sa|wa|tas|nt|act|new south wales|victoria|queensland|south australia|western australia|tasmania|northern territory|australia|nz|new zealand)\b\.?/gi;
/** A place name the place search will understand: "Port Macquarie, NSW" → "Port Macquarie". '' if nothing usable. */
export function placeQuery(name) {
  const first = String(name || '').split(/[,(\n]/)[0];
  const q = first.replace(STATES, ' ').replace(/\d{4}/g, ' ').replace(/\s+/g, ' ').trim();
  return q.length >= 2 ? q.slice(0, 60) : '';
}

/** From a place search answer, the best match: Australian first (it's an Australian app), else the first. */
export function pickPlace(json) {
  const list = Array.isArray(json?.results) ? json.results.filter((r) => num(r.latitude) != null && num(r.longitude) != null) : [];
  const best = list.find((r) => r.country_code === 'AU') || list[0];
  return best ? { lat: Number(best.latitude), lng: Number(best.longitude), name: [best.name, best.admin1].filter(Boolean).join(', ') } : null;
}

const r2 = (x) => Math.round(x * 100) / 100;
/** Open-Meteo addresses. Coordinates are rounded (about 1 km) so nearby courses share a saved copy. */
export function forecastUrl(lat, lng) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${r2(lat)}&longitude=${r2(lng)}`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant'
    + `&timezone=auto&forecast_days=${HORIZON_DAYS}`;
}
export function currentUrl(lat, lng) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${r2(lat)}&longitude=${r2(lng)}`
    + '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m'
    + '&daily=precipitation_probability_max&forecast_days=1&timezone=auto';
}
export function geocodeUrl(query) {
  return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
}

/** The phone's saved copy: key per kind and place, good for the hour it was fetched in. */
export function cacheKey(kind, lat, lng) {
  return `lgc-wx-${kind}-${r2(lat)},${r2(lng)}`;
}
export function hourStamp(now = new Date()) {
  return `${iso(now)}T${String(now.getHours()).padStart(2, '0')}`;
}
export function isFresh(entry, now = new Date()) {
  return !!entry && entry.hour === hourStamp(now) && entry.data != null;
}

/** Open-Meteo's daily answer → one row per day. */
export function parseDaily(json) {
  const d = json?.daily;
  if (!d || !Array.isArray(d.time)) return [];
  return d.time.map((date, i) => ({
    date,
    code: num(d.weather_code?.[i]),
    max: num(d.temperature_2m_max?.[i]),
    min: num(d.temperature_2m_min?.[i]),
    rain: num(d.precipitation_probability_max?.[i]),
    rainMm: num(d.precipitation_sum?.[i]),
    wind: num(d.wind_speed_10m_max?.[i]),
    gust: num(d.wind_gusts_10m_max?.[i]),
    dir: num(d.wind_direction_10m_dominant?.[i]),
  }));
}

/** Open-Meteo's "current" answer → { temp, feels, rainMm, code, wind, gust, dir, rain (today's chance) }. */
export function parseCurrent(json) {
  const c = json?.current;
  if (!c) return null;
  return {
    temp: num(c.temperature_2m), feels: num(c.apparent_temperature), rainMm: num(c.precipitation), code: num(c.weather_code),
    wind: num(c.wind_speed_10m), gust: num(c.wind_gusts_10m), dir: num(c.wind_direction_10m),
    rain: num(json?.daily?.precipitation_probability_max?.[0]),
  };
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Degrees the wind comes FROM → "SW". */
export function compass(deg) {
  if (num(deg) == null) return '';
  return POINTS[Math.round((((Number(deg) % 360) + 360) % 360) / 45) % 8];
}

/** Wind in words, for golfers. km/h. */
export function windWords(kmh) {
  const w = num(kmh);
  if (w == null) return '';
  if (w < 6) return 'Calm';
  if (w < 12) return 'Light breeze';
  if (w < 20) return 'Gentle breeze';
  if (w < 29) return 'Breezy';
  if (w < 39) return 'Windy';
  if (w < 50) return 'Very windy';
  return 'Blowing a gale';
}

/** Roughly how much to club up into it (a rule of thumb, not science). '' when it barely matters. */
export function clubHint(kmh) {
  const w = num(kmh);
  if (w == null || w < 12) return '';
  if (w < 22) return 'about a club into it';
  if (w < 35) return 'two clubs into it';
  return 'three-plus clubs — keep it low';
}

/** "18 km/h SW, gusts 30" */
export function windLine(wind, dir, gust) {
  if (num(wind) == null) return '';
  const g = num(gust) != null && Number(gust) >= Number(wind) + 8 ? `, gusts ${Math.round(gust)}` : '';
  return `${Math.round(wind)} km/h${compass(dir) ? ` ${compass(dir)}` : ''}${g}`;
}

// WMO weather codes (what Open-Meteo sends) → a picture and a word.
const CODES = [
  [[0], '☀️', 'Sunny'], [[1], '🌤️', 'Mostly sunny'], [[2], '⛅', 'Partly cloudy'], [[3], '☁️', 'Cloudy'],
  [[45, 48], '🌫️', 'Fog'], [[51, 53, 55, 56, 57], '🌦️', 'Drizzle'], [[61, 63, 66, 80, 81], '🌧️', 'Showers'],
  [[65, 67, 82], '🌧️', 'Heavy rain'], [[71, 73, 75, 77, 85, 86], '🌨️', 'Snow'], [[95, 96, 99], '⛈️', 'Storms'],
];
export function weatherLook(code) {
  const c = num(code);
  const hit = CODES.find(([list]) => list.includes(c));
  return hit ? { icon: hit[1], word: hit[2] } : { icon: '🌡️', word: '' };
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (date) => { const d = parseDate(date); return d ? DOW[d.getDay()] : ''; };

/**
 * What to pack, from the trip's forecast days. Short, friendly, most useful first; at most 4.
 *   cold mornings → a jumper; rain likely → wet-weather gear; hot → sunscreen and water; wind → keep it low; storms.
 */
export function packingHints(days = []) {
  const out = [];
  const valid = days.filter(Boolean);
  const coldest = valid.filter((d) => d.min != null).sort((a, b) => a.min - b.min)[0];
  if (coldest && coldest.min <= 10) out.push(`🧥 Bring a jumper — ${Math.round(coldest.min)}° first thing ${dayName(coldest.date)}`);
  const storm = valid.find((d) => [95, 96, 99].includes(d.code));
  if (storm) out.push(`⛈️ Storms possible ${dayName(storm.date)} — know where the shelter is`);
  const wettest = valid.filter((d) => d.rain != null).sort((a, b) => b.rain - a.rain)[0];
  if (wettest && wettest.rain >= 50) out.push(`☔ Pack the wet-weather gear — ${Math.round(wettest.rain)}% chance of rain ${dayName(wettest.date)}`);
  const hottest = valid.filter((d) => d.max != null).sort((a, b) => b.max - a.max)[0];
  if (hottest && hottest.max >= 30) out.push(`🧴 Sunscreen and plenty of water — ${Math.round(hottest.max)}° ${dayName(hottest.date)}`);
  const windiest = valid.filter((d) => d.wind != null || d.gust != null).sort((a, b) => Math.max(b.wind || 0, (b.gust || 0) * 0.7) - Math.max(a.wind || 0, (a.gust || 0) * 0.7))[0];
  if (windiest && ((windiest.wind || 0) >= 25 || (windiest.gust || 0) >= 45)) out.push(`🌬️ ${windWords(windiest.wind)} ${dayName(windiest.date)} — practise the knock-down`);
  if (!out.length && valid.length) out.push('👌 Looks like golfing weather — nothing special to pack');
  return out.slice(0, 4);
}

/** The forecast rows for the trip days that are shown, in trip order (days the answer doesn't cover are left out). */
export function rowsForDays(daily, show) {
  const by = new Map((daily || []).map((d) => [d.date, d]));
  return (show || []).map((d) => by.get(d)).filter(Boolean);
}

/** Should the leaderboard show "Today at <course>"? Only while the round is live and played today (or undated). */
export function showRoundWeather(round, today) {
  if (!round || round.status !== 'live') return false;
  return !round.play_date || round.play_date === today;
}
