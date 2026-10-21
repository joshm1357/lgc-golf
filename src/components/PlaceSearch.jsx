import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { getFix } from '../lib/geo.js';
import { nominatimUrl, placeFromNominatim, round2 } from '../lib/tripfinder.js';

// Find a suburb or town (trip finder, Stage 16.1). Never a street address.
//   * As you type: towns and areas from our own course library (free, ours).
//   * "Search more widely": the free OpenStreetMap search (Nominatim) — one request per tap, never while typing
//     (their rules), at most one a second, towns and suburbs only, with the credit shown.
//   * "Where I am": this phone's location, kept to about 1 km.
// onPick({ label, postcode, lat, lng })

const OSM = () => <>Search © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</>;

export default function PlaceSearch({ onPick, placeholder = 'Suburb or town', allowHere = false, initial = '' }) {
  const [q, setQ] = useState(initial);
  const [lib, setLib] = useState([]);
  const [osm, setOsm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const last = useRef(0);
  const ticket = useRef(0);

  useEffect(() => {
    setOsm(null);
    const term = q.trim();
    if (term.length < 2) { setLib([]); return undefined; }
    const t = setTimeout(async () => {
      const mine = ++ticket.current;
      const { data } = await supabase.rpc('trip_finder_places', { p_query: term });
      if (mine === ticket.current) setLib(Array.isArray(data) ? data : []);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const wider = async () => {
    const term = q.trim();
    if (term.length < 2) return;
    const wait = 1100 - (Date.now() - last.current);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last.current = Date.now();
    setBusy(true); setMsg('');
    try {
      const res = await fetch(nominatimUrl(term), { headers: { Accept: 'application/json', 'Accept-Language': 'en-AU' } });
      const rows = res.ok ? await res.json() : [];
      const seen = new Set();
      const out = (Array.isArray(rows) ? rows : []).map(placeFromNominatim).filter((p) => p && !seen.has(p.where) && seen.add(p.where));
      setOsm(out);
      if (!out.length) setMsg('Nothing found — try a nearby town, or tap the map.');
    } catch {
      setMsg('Couldn’t search just now — try again, or tap the map.');
    } finally {
      setBusy(false);
    }
  };

  const here = async () => {
    setBusy(true); setMsg('');
    try {
      const f = await getFix();
      onPick({ label: q.trim().replace(/[0-9]/g, '').trim(), postcode: null, lat: round2(f.lat), lng: round2(f.lng), here: true });
    } catch {
      setMsg('Couldn’t get this phone’s location.');
    } finally {
      setBusy(false);
    }
  };

  const pick = (p) => { setQ(p.label); setLib([]); setOsm(null); onPick(p); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="input grow" style={{ minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value.replace(/[0-9]/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); wider(); } }} placeholder={placeholder} aria-label="Suburb or town" />
        <button type="button" className="btn ghost sm" disabled={busy || q.trim().length < 2} onClick={wider}>{busy ? '…' : 'Search'}</button>
      </div>
      {lib.map((p) => (
        <button key={`l-${p.area}`} type="button" className="btn ghost sm" style={{ justifyContent: 'flex-start' }}
          onClick={() => pick({ label: String(p.area).replace(/\s+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)$/i, ''), postcode: null, lat: round2(p.lat), lng: round2(p.lng) })}>
          ⛳ {p.area} <span className="small muted">· {p.courses} course{p.courses === 1 ? '' : 's'}</span>
        </button>
      ))}
      {osm?.map((p) => (
        <button key={`o-${p.where}-${p.lat}`} type="button" className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => pick(p)}>
          📍 {p.where}{p.postcode ? ` ${p.postcode}` : ''}
        </button>
      ))}
      {osm && <span className="small muted"><OSM /></span>}
      {allowHere && <button type="button" className="btn ghost sm" disabled={busy} onClick={here}>📍 Where I am (to about 1 km)</button>}
      {msg && <span className="small muted">{msg}</span>}
    </div>
  );
}
