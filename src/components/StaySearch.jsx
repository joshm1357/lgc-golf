// Accommodation search from the real requests (080, Josh): one set of Booking.com / Airbnb / Stayz links per place
// being looked at and per weekend still in play, with the head count, bedrooms and a price cap a night. A one-line
// summary says what each searches for, and can be tweaked before opening. After a search: "Found a few you like? Save
// them to a list, tap Share and paste the list link here" — the list goes on the shortlist (and on the ballot with a
// "View places" link). Links only: nothing is fetched from those sites.
import React, { useEffect, useState } from 'react';
import { stayLinks, bedroomsFor, staySearchLine, LIST_HOWTO, isListLink, cleanStay } from '../lib/tripbudget.js';
import { headcountLine, weekendRole } from '../lib/weekends.js';
import { fmtRange } from '../lib/plan.js';

/**
 * places: ['Kiama', …]; weekends: [{ start, end }]; people: head count.
 * onSave({ area, name, link, is_list }) — when someone pastes a list (or a single listing) link. Optional.
 */
// ov23 (Josh: "Make sure the links have the right number of people in the search"): `people` is the trip's real head
// count (lib/weekends.js tripHeadcount) and the links follow it when it changes. Changing it here calls onPeople(n)
// so the trip keeps the number (everything else uses it too); bedrooms follow the people unless set by hand.
export default function StaySearch({ places = [], weekends = [], people = 0, peopleWords = null, maxPerNight = null, onSave = null, onPeople = null, busy = false, roles = null }) {
  const [own, setOwn] = useState(null); // the number typed here, until the trip's number catches up
  const [ownBeds, setOwnBeds] = useState(null);
  const n = own ?? (people || 0);
  const beds = ownBeds ?? (bedroomsFor(n) || '');
  const setN = (v) => { setOwn(v); onPeople?.(v); };
  const setBeds = (v) => setOwnBeds(v === '' ? null : v);
  useEffect(() => { if (own != null && own === people) setOwn(null); }, [people]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cap, setCap] = useState(maxPerNight || '');
  const [opened, setOpened] = useState(null); // { area, site }
  const [paste, setPaste] = useState('');
  const [tweak, setTweak] = useState(false);
  const [wk, setWk] = useState(0);
  if (!places.length) return null;
  if (!weekends.length) return <div className="small muted">Search links show up once there are weekends to look at.</div>;
  const save = () => {
    const row = cleanStay({ name: isListLink(paste) ? `${opened?.site ? `${opened.site} list` : 'Shared list'} — ${opened?.area || places[0]}` : `${opened?.area || places[0]} — a place`, link: paste });
    if (!row?.link) return;
    onSave?.({ area: opened?.area || places[0], name: row.name, link: row.link, is_list: isListLink(row.link) });
    setPaste('');
  };
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="stay-search">
      <div className="row between" style={{ gap: 6 }}>
        <span className="small" style={{ fontWeight: 700 }} data-testid="stay-headcount">🔎 Search {headcountLine(n, beds || null)}{cap ? ` · under $${cap}/night` : ''}
          {peopleWords && own == null && <span className="muted" style={{ fontWeight: 400 }}> ({peopleWords})</span>}</span>
        <button type="button" className="btn ghost sm" onClick={() => setTweak(!tweak)}>{tweak ? 'Done' : 'Change'}</button>
      </div>
      {tweak && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <label className="field"><span>People</span><input className="input" inputMode="numeric" value={n} aria-label="People for the search" onChange={(e) => setN(Number(e.target.value.replace(/\D/g, '')) || 0)} /></label>
          <label className="field"><span>Bedrooms</span><input className="input" inputMode="numeric" value={beds} aria-label="Bedrooms for the search" onChange={(e) => setBeds(e.target.value.replace(/\D/g, ''))} /></label>
          <label className="field"><span>Max $/night</span><input className="input" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} /></label>
        </div>
      )}
      {weekends.length > 1 && (
        <div className="tb-chips" role="group" aria-label="Which weekend to search">
          {weekends.slice(0, 4).map((w, i) => <button key={w.start} type="button" className="chip" aria-pressed={i === wk} onClick={() => setWk(i)}>{roles ? `${weekendRole(i)}: ` : ''}{fmtRange(w.start, w.end)}</button>)}
        </div>
      )}
      {places.slice(0, 4).map((area) => [weekends[Math.min(wk, weekends.length - 1)]].map((w) => {
        const q = { town: area, start: w.start, end: w.end, people: n, bedrooms: beds || null, maxPerNight: cap || null };
        return (
          <div key={`${area}|${w.start}`} className="stack" style={{ gap: 4 }} data-testid="stay-search-set">
            <span className="small muted">{staySearchLine({ ...q, fmt: (a, b) => fmtRange(a, b) })}</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {stayLinks(q).map((l) => (
                <a key={l.name} className="btn ghost sm" href={l.url} target="_blank" rel="noreferrer noopener" onClick={() => setOpened({ area, site: l.name })}>{l.name} ↗</a>
              ))}
            </div>
          </div>
        );
      }))}
      {onSave && (
        <div className="card pad stack" style={{ gap: 6, background: 'var(--ground)' }} data-testid="list-prompt">
          <strong className="small">{opened ? `Found a few you like in ${opened.area}?` : 'Found a few you like?'}</strong>
          <span className="small">Save them to a list on the site, tap Share and paste the list link here — it goes on the vote so everyone can look.</span>
          {opened && LIST_HOWTO[opened.site] && <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{LIST_HOWTO[opened.site].map((s) => <li key={s}>{s}</li>)}</ol>}
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow" type="url" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste a list or a listing link" aria-label="List link" />
            <button type="button" className="btn sm" disabled={busy || !/^(https?:\/\/)?[^\s]+\.[^\s]+/.test(paste.trim())} onClick={save}>Add</button>
          </div>
          {places.length > 1 && (
            <label className="field"><span>For</span>
              <select className="select" value={opened?.area || places[0]} onChange={(e) => setOpened({ area: e.target.value, site: opened?.site || null })}>
                {places.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <span className="small muted">Just links with your dates and numbers filled in — nothing is booked or fetched by the app.</span>
    </div>
  );
}
