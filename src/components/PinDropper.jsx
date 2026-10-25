// "📍 Drop a pin" for a place to stay (v10.5, Josh 23 Oct: "locations are a bit hard to pin as you try click near a
// course and it selects the course. The typing in should also have a pre-fill").
//  - While dropping, the map's course dots and 🏠 pins are paused (BuilderMap: onTap set → markers don't take clicks).
//  - Or type a town instead of tapping: suggestions from the stay areas, pick one and it's pinned there.
//  - After a tap the name starts filled in from the nearest town, with the nearby towns as one-tap names.
import React, { useState } from 'react';
import { matchTowns, nearTowns, pinNameFor } from '../lib/pinplace.js';

/** The tap handler for BuilderMap's onTap: pins the spot and pre-fills its name. */
export const tapToPin = (areas, setAddPin, setPinName) => (p) => { setAddPin(p); setPinName(pinNameFor(p, areas)); };

export default function PinDropper({ areas = [], addPin, setAddPin, pinName, setPinName, onAdd, startLabel = '📍 Drop a pin (a part of town, beachside…)', placeholder = 'Name it, e.g. Kiama beachside' }) {
  const [q, setQ] = useState('');
  const hits = matchTowns(q, areas);
  const near = addPin && addPin !== 'tap' ? nearTowns(addPin, areas, 3) : [];
  const done = () => { setAddPin(null); setPinName(''); setQ(''); };
  if (addPin === null) {
    return <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAddPin('tap')} data-testid="drop-pin">{startLabel}</button>;
  }
  if (addPin === 'tap') {
    return (
      <div className="stack" style={{ gap: 6 }} data-testid="pin-tap">
        <span className="small" style={{ fontWeight: 700 }}>Tap the map where you’d stay (the course dots are paused), or type a town:</span>
        <div className="row" style={{ gap: 6 }}>
          <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Pokolbin, Kiama, Mudgee" aria-label="Town to pin" data-testid="pin-town" />
          <button type="button" className="btn ghost sm" onClick={done}>Cancel</button>
        </div>
        {hits.length > 0 && (
          <div className="tb-chips" data-testid="pin-town-hits">
            {hits.map((t) => (
              <button key={t.name} type="button" className="chip" onClick={() => { setAddPin({ lat: t.lat, lng: t.lng }); setPinName(t.name); setQ(''); }}>
                📍 {t.name}{t.region ? <span className="muted"> · {t.region}</span> : null}
              </button>
            ))}
          </div>
        )}
        {q.trim().length >= 2 && !hits.length && <span className="small muted">No town matches “{q.trim()}” — tap the map instead.</span>}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="pin-name">
      <div className="row" style={{ gap: 6 }}>
        <input className="input grow" value={pinName} maxLength={40} onChange={(e) => setPinName(e.target.value)} placeholder={placeholder} aria-label="Place name" autoFocus />
        <button type="button" className="btn sm" disabled={pinName.trim().length < 2} onClick={() => { onAdd(addPin, pinName.trim()); done(); }}>Add</button>
        <button type="button" className="btn ghost sm" onClick={done}>Cancel</button>
      </div>
      {near.length > 1 && (
        <div className="tb-chips">
          {near.map((t) => <button key={t.name} type="button" className="chip" aria-pressed={pinName === t.name} onClick={() => setPinName(t.name)}>{t.name} · {t.km} km</button>)}
        </div>
      )}
    </div>
  );
}
