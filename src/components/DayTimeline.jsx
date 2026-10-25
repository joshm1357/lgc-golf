// The day plan's timeline (ov40): a simple bar for one day, in colours — travel (blue), golf (green), free time (sand),
// dinner / evening (navy) — over a daylight band with dusk marked. Wishes from the group sit under it as markers.
// Every time is "about". Used on Plan the trip → Day plan, and on a one-day round call-out.
import React from 'react';
import { hm, DAY_FROM, DAY_TO, PREF_LABEL, anyClock } from '../lib/daytiming.js';
import './daytimeline.css';

const KIND_LABEL = { travel: 'Travel', golf: 'Golf', free: 'Free time', evening: 'Dinner / evening' };
const pct = (m, from, to) => `${Math.max(0, Math.min(100, ((m - from) / (to - from)) * 100))}%`;
// Where a wish sits on the day: morning free / later → 11:30, early → 7:30, midday → 12, home by → its time.
const PREF_AT = { morning_free: 11 * 60 + 30, early: 7 * 60 + 30, midday: 12 * 60, late: 13 * 60 };

export default function DayTimeline({ blocks = [], sun = null, prefs = [], from = DAY_FROM, to = DAY_TO, compact = false, slots = null, testid = 'day-timeline' }) {
  const ticks = [];
  for (let h = Math.ceil(from / 60); h * 60 <= to; h += compact ? 3 : 2) ticks.push(h * 60);
  const markers = groupPrefs(prefs);
  return (
    <div className={`dt${compact ? ' dt-compact' : ''}`} data-testid={testid}>
      <div className="dt-track" aria-hidden="true">
        {sun && <div className="dt-day" style={{ left: pct(sun.sunrise, from, to), right: `calc(100% - ${pct(sun.sunset, from, to)})` }} />}
        {blocks.map((b, i) => (
          <div key={i} className={`dt-b dt-${b.kind}`} style={{ left: pct(b.from, from, to), width: `calc(${pct(b.to, from, to)} - ${pct(b.from, from, to)})` }} title={`${hm(b.from)}–${hm(b.to)} ${b.label}`} data-kind={b.kind} />
        ))}
        {slots && slots.map((s, i) => (
          <div key={`s${i}`} className={`dt-slot${s.best ? ' best' : ''}`} style={{ left: pct(s.from, from, to), width: `calc(${pct(s.to, from, to)} - ${pct(s.from, from, to)})` }} />
        ))}
        {sun && <div className="dt-dusk" style={{ left: pct(sun.sunset, from, to) }}><span>dusk {hm(sun.sunset)}</span></div>}
        {markers.map((m) => (
          <div key={m.key} className="dt-wish" style={{ left: pct(m.at, from, to) }} title={m.label}><span>{m.icon}{m.n > 1 ? `×${m.n}` : ''}</span></div>
        ))}
      </div>
      <div className="dt-ticks" aria-hidden="true">
        {ticks.map((t) => <span key={t} style={{ left: pct(t, from, to) }}>{hm(t).replace(':00', '')}</span>)}
      </div>
      {!compact && blocks.length > 0 && (
        <ol className="dt-list" data-testid="day-blocks">
          {blocks.map((b, i) => (
            <li key={i} data-kind={b.kind}><span className={`dt-dot dt-${b.kind}`} aria-label={KIND_LABEL[b.kind]} /> <strong>{hm(b.from)}</strong>–{hm(b.to)} · {b.label}</li>
          ))}
          {sun && <li><span className="dt-dot dt-sun" aria-hidden="true" /> Sunrise about {hm(sun.sunrise)} · dusk (sunset) about {hm(sun.sunset)}</li>}
        </ol>
      )}
      {markers.length > 0 && !compact && (
        <div className="dt-wishes small" data-testid="day-wish-markers">{markers.map((m) => <span key={m.key} className="dt-wish-chip">{m.icon} {m.label}</span>)}</div>
      )}
    </div>
  );
}

function groupPrefs(prefs) {
  const by = new Map();
  for (const p of prefs) {
    const at = p.pref === 'home_by' ? anyClock(p.homeBy) : PREF_AT[p.pref];
    if (at == null) continue;
    const key = `${p.pref}:${p.pref === 'home_by' ? p.homeBy : ''}`;
    const cur = by.get(key) || { key, at, n: 0, pref: p.pref, icon: p.pref === 'home_by' ? '🏠' : p.pref === 'early' ? '🌅' : p.pref === 'morning_free' ? '☕' : '⛳' };
    cur.n += 1;
    by.set(key, cur);
  }
  return [...by.values()].map((m) => ({ ...m, label: `${m.n} × ${m.pref === 'home_by' ? `home by ${hm(anyClock(m.key.split(':').slice(1).join(':')))}` : (PREF_LABEL[m.pref] || m.pref).toLowerCase()}` }));
}
