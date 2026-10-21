// Weather on the trip (feature 'weather', child of the planner). The phone asks Open-Meteo (free, no key) and keeps a
// copy for the hour, per place, so a group of phones opening the trip doesn't hammer it. All the working-out is in
// lib/weather.js; this file only fetches and draws.
//   <TripWeather plan rounds shapeCourseIds /> — the forecast for each trip day (on the trip page in the planner)
//   <WeatherChip round course />               — "Today at <course>" on the leaderboard during a live round
import React, { useEffect, useState } from 'react';
import { useFeature } from '../lib/store.jsx';
import { fmtRange, todayISO, daysUntil } from '../lib/plan.js';
import {
  tripDays, forecastWindow, tripPlace, courseSpot, pickPlace, forecastUrl, currentUrl, geocodeUrl, cacheKey, hourStamp,
  isFresh, parseDaily, parseCurrent, rowsForDays, packingHints, windLine, windWords, clubHint, weatherLook,
  showRoundWeather, CREDIT, CREDIT_URL,
} from '../lib/weather.js';

function readCache(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ hour: hourStamp(), data })); } catch { /* storage full or blocked — fine */ }
}

/** Fetch JSON with the phone's copy for the hour; with no signal, last time's copy (marked stale). */
async function cachedJson(key, url) {
  const saved = readCache(key);
  if (isFresh(saved)) return { data: saved.data, stale: false };
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const data = await res.json();
    writeCache(key, data);
    return { data, stale: false };
  } catch {
    return saved?.data ? { data: saved.data, stale: true } : null;
  }
}

/** Where to look: a course spot straight away, or a place name looked up (kept on the phone for a month). */
function useSpot(place) {
  const query = place?.query || '';
  const [found, setFound] = useState(null);
  useEffect(() => {
    if (!query) { setFound(null); return undefined; }
    let live = true;
    const key = `lgc-wx-place-${query.toLowerCase()}`;
    const saved = readCache(key);
    if (saved?.data && saved.data.at && Date.now() - saved.data.at < 30 * 86400e3) { setFound(saved.data.spot); return undefined; }
    fetch(geocodeUrl(query), { credentials: 'omit' }).then((r) => (r.ok ? r.json() : null)).then((json) => {
      const spot = pickPlace(json);
      if (spot) writeCache(key, { spot, at: Date.now() });
      if (live) setFound(spot || false);
    }, () => live && setFound(false));
    return () => { live = false; };
  }, [query]);
  if (place && place.lat != null) return place;
  return found;
}

function Credit() {
  return <a className="small muted" href={CREDIT_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>{CREDIT}</a>;
}

/** The trip's forecast: one line per trip day, what to pack, and the credit. */
export function TripWeather({ plan, rounds = [], coursesById = {}, shapeCourseIds = [] }) {
  const on = useFeature('weather');
  const today = todayISO();
  const days = tripDays(plan?.start_date, plan?.end_date);
  const win = forecastWindow(days, today);
  const place = on && (win.state === 'show' || win.state === 'soon') ? tripPlace({ plan, rounds, coursesById, shapeCourseIds }) : null;
  const spot = useSpot(win.state === 'show' ? place : null);
  const [res, setRes] = useState(null);
  const key = spot && spot.lat != null ? cacheKey('daily', spot.lat, spot.lng) : '';
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    cachedJson(key, forecastUrl(spot.lat, spot.lng)).then((r) => live && setRes(r || { failed: true }));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!on || !place) return null;
  if (win.state === 'soon') {
    if (daysUntil(days[0], today) > 30) return null;
    return <div className="small muted" data-testid="weather-soon">🌤️ The forecast for {place.name || place.query} shows here from {fmtRange(win.opensOn)}.</div>;
  }
  if (spot === false) return null; // couldn't find the place — say nothing rather than guess
  const rows = res?.data ? rowsForDays(parseDaily(res.data), win.show) : [];
  const hints = packingHints(rows);
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="trip-weather">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <strong>🌤️ Weather</strong>
        <span className="small muted" style={{ textAlign: 'right' }}>{spot?.name || place.name || place.query}</span>
      </div>
      {!res && <div className="small muted">Getting the forecast…</div>}
      {res?.failed && <div className="small muted">Couldn’t get the forecast — check your signal.</div>}
      {rows.map((d) => {
        const look = weatherLook(d.code);
        return (
          <div key={d.date} className="row" style={{ gap: 10, alignItems: 'center', borderTop: '1px solid var(--line-soft)', paddingTop: 8 }} data-testid="weather-day">
            <span style={{ fontSize: 26, width: 34, textAlign: 'center' }} aria-hidden>{look.icon}</span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 700 }}>{fmtRange(d.date).replace(/ \d{4}$/, '')}</span>
              <span className="small muted"> · {look.word}</span>
              <div className="small">💧 {d.rain ?? '–'}% · 🌬️ {windLine(d.wind, d.dir, d.gust)}{windWords(d.wind) ? ` (${windWords(d.wind).toLowerCase()})` : ''}</div>
            </span>
            <span style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{d.max != null ? Math.round(d.max) : '–'}°<span className="small muted" style={{ fontWeight: 600 }}> / {d.min != null ? Math.round(d.min) : '–'}°</span></span>
          </div>
        );
      })}
      {hints.length > 0 && <div className="stack" style={{ gap: 2 }} data-testid="weather-hints">{hints.map((h) => <span key={h} className="small" style={{ fontWeight: 600 }}>{h}</span>)}</div>}
      {(win.rough || res?.stale) && <span className="small muted">{res?.stale ? 'No signal — this is the last forecast saved on your phone. ' : ''}{win.rough ? 'More than a week out, so it’s a rough guide — check again closer to the day.' : ''}</span>}
      <Credit />
    </div>
  );
}

/** "Today at <course>": wind (what matters for golf), temperature and rain, during a live round. */
export function WeatherChip({ round, course }) {
  const on = useFeature('weather');
  const show = on && showRoundWeather(round, todayISO());
  const spot = show ? courseSpot(course) : null;
  const [now, setNow] = useState(null);
  const key = spot ? cacheKey('now', spot.lat, spot.lng) : '';
  useEffect(() => {
    if (!key) { setNow(null); return undefined; }
    let live = true;
    cachedJson(key, currentUrl(spot.lat, spot.lng)).then((r) => live && setNow(r?.data ? parseCurrent(r.data) : null));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show || !spot || !now) return null;
  const look = weatherLook(now.code);
  const club = clubHint(now.wind);
  return (
    <div className="section" data-testid="weather-chip">
      <div className="card pad row" style={{ gap: 10 }}>
        <span style={{ fontSize: 24 }} aria-hidden>{look.icon}</span>
        <span className="grow small" style={{ lineHeight: 1.4 }}>
          <strong>Today at {course?.name || 'the course'}:</strong> 🌬️ {windLine(now.wind, now.dir, now.gust)} — {windWords(now.wind).toLowerCase()}{club ? `, ${club}` : ''}
          {' · '}{now.temp != null ? `${Math.round(now.temp)}°` : ''}{now.rain != null ? ` · 💧 ${now.rain}%` : ''}
          <div><Credit /></div>
        </span>
      </div>
    </div>
  );
}
