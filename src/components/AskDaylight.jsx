// ov44 — daylight and weather for a round ask (claude/round-door-addendum.md pieces 5 and 6; Josh 15 Nov 2026: "add
// value by knowing when rounds could be available (sunrise, sunset and so on)").
//   <SunLine dates place />      — "Sat 20 Jun · sunrise 7:00 · sunset 4:54 · last tee for 18 about 12:20" above the dates
//   <PlacePicker place onPick /> — "Daylight for Sydney · change" (a city, or any suburb or town)
//   useAskWeather(place, on)     — { '2026-11-21': { icon, max, rain } } for dates inside the forecast
//   <WxCredit />                 — the Open-Meteo credit (shown wherever a forecast is)
// All the sums are in lib/ask.js and lib/weather.js (tested). The forecast is one lookup per place, kept on the phone
// for 3 hours; if it fails or there's no signal, nothing is shown — it never holds up the grid.
import React, { useEffect, useState } from 'react';
import { CITIES, sunLines, placeName, cleanPlace, zonePlace } from '../lib/ask.js';
import { forecastUrl, askWxKey, askWxFresh, askWxDays, CREDIT, CREDIT_URL } from '../lib/weather.js';
import PlaceSearch from './PlaceSearch.jsx';

const PLACE_KEY = 'tgt-ask-place';
/** The phone's time zone ('Australia/Perth'), for a first guess at where the round is. */
export const phoneZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };
/** The place this phone last picked for an ask (so a second ask doesn't start from the guess again). */
export const savedPlace = () => { try { return cleanPlace(JSON.parse(localStorage.getItem(PLACE_KEY) || 'null')); } catch { return null; } };
export const savePlace = (p) => { try { if (p) localStorage.setItem(PLACE_KEY, JSON.stringify(p)); } catch { /* fine */ } };
/** Where a brand-new asker probably is: what they picked last time, else the city of the phone's clock. */
export const guessPlace = () => savedPlace() || cleanPlace(zonePlace(phoneZone()));

export function SunLine({ dates = [], place = null, style = null }) {
  const l = sunLines(dates, place);
  if (!l.line) return null;
  return (
    <div className="ask-sun" style={style || undefined} data-testid="ask-sun">
      <span>☀️ {l.line}</span>
      {l.later && <span className="muted">{l.later}</span>}
    </div>
  );
}

/** "Daylight for Sydney · change". search: an optional suburb lookup (the link's own); else the app's usual one. */
export function PlacePicker({ place, onPick, search = null, words = 'Daylight and weather for' }) {
  const [open, setOpen] = useState(false);
  const pick = (p) => { const c = cleanPlace({ ...p, src: 'picked' }); if (!c) return; savePlace(c); onPick(c); setOpen(false); };
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="ask-place">
      <span className="small muted">
        {words} <strong style={{ color: 'inherit' }} data-testid="ask-place-name">{placeName(place)}</strong>{' · '}
        <button type="button" className="linkish" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="ask-place-change">{open ? 'done' : 'change'}</button>
      </span>
      {open && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="co-chips" role="group" aria-label="City">
            {CITIES.map((c) => <button key={c.name} type="button" className="chip" aria-pressed={placeName(place) === c.name} onClick={() => pick(c)}>{c.name}</button>)}
          </div>
          <PlaceSearch search={search} placeholder="Or a suburb or town" onPick={(p) => pick({ lat: p.lat, lng: p.lng, name: p.label || p.where })} />
        </div>
      )}
    </div>
  );
}

const readWx = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };

/** The forecast per date at a place. {} until it arrives, and {} if it never does. */
export function useAskWeather(place, on = true) {
  const [days, setDays] = useState({});
  const lat = place?.lat; const lng = place?.lng;
  useEffect(() => {
    if (!on || lat == null || lng == null) { setDays({}); return undefined; }
    let live = true;
    const key = askWxKey({ lat, lng });
    const saved = readWx(key);
    if (askWxFresh(saved)) { setDays(saved.days); return undefined; }
    if (saved?.days) setDays(saved.days); // an older copy is better than nothing while the new one loads
    (async () => {
      try {
        const res = await fetch(forecastUrl(lat, lng), { credentials: 'omit' });
        if (!res.ok) return;
        const fresh = askWxDays(await res.json());
        if (!Object.keys(fresh).length) return;
        try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), days: fresh })); } catch { /* storage full — fine */ }
        if (live) setDays(fresh);
      } catch { /* no signal, or the service is down: show nothing */ }
    })();
    return () => { live = false; };
  }, [lat, lng, on]);
  return days;
}

export function WxCredit() {
  return <a className="small muted" href={CREDIT_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }} data-testid="ask-wx-credit">{CREDIT}</a>;
}
