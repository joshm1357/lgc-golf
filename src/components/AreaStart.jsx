// The start of the trip builder (080, Josh 22 Oct): ONE map for the area — ⛳ pins for every viable course (within
// the drive of where you'd stay) and 🏠 pins for places to stay (towns, or spots the organiser drops: "beachside",
// "town centre"). Tap pins to put them on the table; the same things are a tick list underneath. Each area carries its
// own set of courses (several — never one) and places to stay, plus accommodation ideas with search links and shared
// lists. The app and the AI only suggest (✨); the organiser chooses. Then it all goes to "Call the vote".
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Icon, toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import * as TB from '../lib/tripbuilder.js';
import { pickFacts } from '../lib/tripfinder.js';
import BuilderMap from './BuilderMap.jsx';
import StaySearch from './StaySearch.jsx';

export const slimCourse = (c) => ({ id: c.id, name: c.name, area: c.area || null, lat: c.lat, lng: c.lng, mine_avg: c.mine_avg ?? null, others_avg: c.others_avg ?? null, others_n: c.others_n ?? null });

/** Courses around an area's stay pins, from the trip finder's library search. */
function useAreaLib(pins) {
  const key = pins.map((p) => `${p.lat?.toFixed?.(2)},${p.lng?.toFixed?.(2)}`).join('|');
  const [lib, setLib] = useState(null);
  useEffect(() => {
    if (!pins.length) { setLib([]); return undefined; }
    let live = true;
    setLib(null);
    const box = TB.boxAround(pins, 50);
    const mid = TB.boxAround(pins, 0);
    supabase.rpc('trip_finder_courses', { p_south: box.south, p_west: box.west, p_north: box.north, p_east: box.east, p_lat: mid.lat, p_lng: mid.lng, p_limit: 300 })
      .then(({ data, error }) => { if (live) setLib(error || !Array.isArray(data) ? [] : data.map((c) => ({ ...c, facts: pickFacts(c.facts) }))); }, () => live && setLib([]));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return lib;
}

export default function AreaStart({ plan, st, save, org, areas, history, accom = [], reloadAccom, people = 0 }) {
  const [busy, run] = useRun();
  const options = st.region ? [st.region] : st.regionOptions;
  const [tab, setTab] = useState(options[0] || null);
  const area = options.includes(tab) ? tab : options[0] || null;
  const [addPin, setAddPin] = useState(null);
  const [pinName, setPinName] = useState('');
  const towns = useMemo(() => areas.filter((a) => a.region === area).map((a) => ({ key: a.name, name: a.name, lat: a.lat, lng: a.lng })), [areas, area]);
  const pins = (st.pins || []).filter((p) => p.area === area || (!p.area && area === st.region));
  const stayPins = [...towns, ...pins];
  const onTableStays = (st.areaStays || {})[area] || (area === st.region ? st.stays || [] : []);
  const onTableCourses = (st.areaCourses || {})[area] || [];
  const suggested = st.suggested || {};
  const lib = useAreaLib(stayPins);
  const driveFrom = onTableStays.length ? onTableStays : stayPins;
  const cands = useMemo(() => TB.areaCourseCandidates(lib || [], driveFrom, { stayMax: st.stayMax, history }), [lib, driveFrom, st.stayMax, history]); // eslint-disable-line react-hooks/exhaustive-deps
  const courseMap = useMemo(() => {
    const m = { ...(st.courses || {}) };
    for (const c of lib || []) m[c.id] = c;
    return m;
  }, [st.courses, lib]);
  if (!area) return null;

  const isSug = (k) => !!suggested[k];
  const keep = (k) => { const n = { ...suggested }; delete n[k]; return n; };
  const toggleCourse = (c) => {
    if (!org) return;
    const list = TB.toggleId(onTableCourses, c.id);
    if (list.length === onTableCourses.length) { toast(`Up to ${TB.MAX_AREA_COURSES} courses an area`); return; }
    save({ ...st, areaCourses: { ...(st.areaCourses || {}), [area]: list }, courses: { ...(st.courses || {}), [c.id]: slimCourse(c) }, suggested: keep(`course:${area}:${c.id}`) });
  };
  const tickSuggested = () => {
    const ids = cands.filter((c) => c.suggested).map((c) => c.course.id);
    const list = [...new Set([...onTableCourses, ...ids])].slice(0, TB.MAX_AREA_COURSES);
    const courses = { ...(st.courses || {}) };
    for (const c of cands) if (list.includes(c.course.id)) courses[c.course.id] = slimCourse(c.course);
    save({ ...st, areaCourses: { ...(st.areaCourses || {}), [area]: list }, courses });
  };
  const toggleStay = (s) => {
    if (!org) return;
    const k = s.key || s.name;
    const has = onTableStays.some((x) => (x.key || x.name) === k);
    if (!has && onTableStays.length >= TB.MAX_AREA_STAYS) { toast(`Up to ${TB.MAX_AREA_STAYS} places to stay an area`); return; }
    const list = has ? onTableStays.filter((x) => (x.key || x.name) !== k) : [...onTableStays, { key: k, name: s.name, lat: s.lat, lng: s.lng }];
    save({ ...st, areaStays: { ...(st.areaStays || {}), [area]: list }, ...(area === st.region ? { stays: list.slice(0, TB.MAX_STAYS) } : {}), suggested: keep(`stay:${area}:${k}`) });
  };
  const goingHere = () => {
    const stays = onTableStays.slice(0, TB.MAX_STAYS);
    const days = TB.prefillStayDays(st.days, onTableCourses, courseMap, { stays, stayMax: st.stayMax });
    save({ ...st, region: area, regionOptions: [area], stays, days });
  };
  const dropPin = () => {
    const p = { key: `pin:${Date.now()}`, name: pinName.trim(), lat: Math.round(addPin.lat * 1000) / 1000, lng: Math.round(addPin.lng * 1000) / 1000, custom: true, area };
    const list = onTableStays.length < TB.MAX_AREA_STAYS ? [...onTableStays, p] : onTableStays;
    save({ ...st, pins: [...(st.pins || []), p], areaStays: { ...(st.areaStays || {}), [area]: list }, ...(area === st.region ? { stays: list.slice(0, TB.MAX_STAYS) } : {}) });
    setAddPin(null); setPinName('');
  };
  const ideas = accom.filter((a) => a.area === area || (!a.area && area === st.region));
  const removeIdea = (a) => run(async () => { await must(supabase.from('plan_stays').delete().eq('id', a.id)); reloadAccom?.(); });
  const addIdea = (row) => run(async () => {
    await must(supabase.from('plan_stays').insert({ plan_id: plan.id, ...row, area }));
    reloadAccom?.();
  }, row.is_list ? 'List added — it goes on the vote with a View places link' : 'Added');

  const mapCourses = cands.slice(0, 40).map((c) => ({ id: c.course.id, name: c.course.name, lat: c.course.lat, lng: c.course.lng, on: onTableCourses.includes(c.course.id), sub: c.drive.text, sug: c.suggested && !onTableCourses.includes(c.course.id) }));
  for (const id of onTableCourses) if (!mapCourses.some((m) => m.id === id) && courseMap[id]) mapCourses.push({ ...courseMap[id], on: true });
  const mapStays = stayPins.map((s) => ({ ...s, on: onTableStays.some((x) => (x.key || x.name) === s.key), sug: isSug(`stay:${area}:${s.key}`), count: TB.staySupport(s, onTableCourses, courseMap, st.stayMax) }));

  return (
    <div className="stack" style={{ gap: 10 }} data-testid="area-start">
      {options.length > 1 && (
        <div className="tb-chips" role="tablist" aria-label="Area">
          {options.map((r) => <button key={r} type="button" role="tab" className="chip" aria-selected={r === area} aria-pressed={r === area} onClick={() => setTab(r)}>{r}</button>)}
        </div>
      )}
      <BuilderMap className="tb-map" courses={mapCourses} stays={mapStays} onCourse={(c) => toggleCourse(courseMap[c.id] || c)} onStay={toggleStay}
        onTap={org && addPin === 'tap' ? (p) => { setAddPin(p); setPinName(''); } : undefined} />
      <span className="small muted">Tap ⛳ pins and 🏠 pins to put them on the table (or tick them below). ✨ = suggested — you choose.</span>

      <div className="card pad stack" style={{ gap: 4 }} data-testid="area-courses">
        <div className="row between"><strong>⛳ Courses — {area}</strong><span className="small muted">{onTableCourses.length} on the table</span></div>
        <span className="small muted">Within {st.stayMax} min of {onTableStays.length ? 'where you’d stay' : 'the towns'}. Keep several — the group picks.</span>
        {lib === null && <span className="small muted">Finding courses…</span>}
        {lib && !cands.length && <span className="small muted">No courses in the library within {st.stayMax} min yet.</span>}
        {org && cands.some((c) => c.suggested && !onTableCourses.includes(c.course.id)) && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={tickSuggested} data-testid="tick-suggested">✨ Tick the suggested ones</button>}
        {cands.slice(0, 12).map((c) => (
          <label key={c.course.id} className="row" style={{ gap: 10, minHeight: 44, alignItems: 'center' }} data-testid="area-course">
            <input type="checkbox" checked={onTableCourses.includes(c.course.id)} disabled={!org} onChange={() => toggleCourse(c.course)} style={{ width: 22, height: 22, flex: 'none' }} aria-label={c.course.name} />
            <span className="grow"><span style={{ fontWeight: 600 }}>{c.course.name}</span>{c.suggested && !onTableCourses.includes(c.course.id) && <span className="small muted"> ✨ suggested</span>}
              <span className="small muted" style={{ display: 'block' }}>{c.drive.text} · {TB.shortKnown(c.course, c.history)}</span></span>
          </label>
        ))}
      </div>

      <div className="card pad stack" style={{ gap: 4 }} data-testid="area-stays">
        <div className="row between"><strong>🏠 Where to stay — {area}</strong><span className="small muted">{onTableStays.length} on the table</span></div>
        {stayPins.map((s) => (
          <label key={s.key} className="row" style={{ gap: 10, minHeight: 44, alignItems: 'center' }} data-testid="area-stay">
            <input type="checkbox" checked={onTableStays.some((x) => (x.key || x.name) === s.key)} disabled={!org} onChange={() => toggleStay(s)} style={{ width: 22, height: 22, flex: 'none' }} aria-label={s.name} />
            <span className="grow"><span style={{ fontWeight: 600 }}>{s.name}</span>{isSug(`stay:${area}:${s.key}`) && <span className="small muted"> ✨ suggested</span>}{s.custom && <span className="small muted"> · your pin</span>}
              <span className="small muted" style={{ display: 'block' }}>{TB.staySupport(s, onTableCourses, courseMap, st.stayMax)} of the courses on the table within {st.stayMax} min</span></span>
          </label>
        ))}
        {org && (addPin === null
          ? <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAddPin('tap')} data-testid="drop-pin">📍 Drop a pin (a part of town, beachside…)</button>
          : addPin === 'tap' ? <span className="small" style={{ fontWeight: 700 }}>Tap the map where you’d stay… <button type="button" className="btn ghost sm" onClick={() => setAddPin(null)}>Cancel</button></span>
            : (
              <div className="row" style={{ gap: 6 }}>
                <input className="input grow" value={pinName} maxLength={40} onChange={(e) => setPinName(e.target.value)} placeholder="Name it, e.g. Kiama beachside" aria-label="Place name" />
                <button type="button" className="btn sm" disabled={pinName.trim().length < 2} onClick={dropPin}>Add</button>
              </div>
            ))}
        <span className="label" style={{ marginTop: 6 }}>Accommodation ideas</span>
        {ideas.length === 0 && <span className="small muted">None yet — search below, save a list on the site and paste its link, or paste a place.</span>}
        {ideas.map((a) => (
          <div key={a.id} className="row between small" style={{ gap: 6 }} data-testid="accom-idea">
            <span className="grow"><strong>{a.is_list ? '📋 ' : '🏡 '}{a.name}</strong>{a.link && <> · <a href={a.link} target="_blank" rel="noreferrer noopener">{a.is_list ? 'View places ↗' : 'Have a look ↗'}</a></>}{a.option_id ? ' · on the vote' : ''}</span>
            {org && !a.option_id && <button type="button" className="btn ghost sm" aria-label={`Remove ${a.name}`} disabled={busy} onClick={() => removeIdea(a)}>{Icon.x(14)}</button>}
          </div>
        ))}
        <StaySearch places={(onTableStays.length ? onTableStays.map((s) => s.name) : [area]).slice(0, 3)} weekends={st.weekends || []} people={people} busy={busy} onSave={org ? addIdea : null} />
      </div>

      {org && !st.region && options.length > 1 && <button type="button" className="btn block" onClick={goingHere} data-testid="going-here">We’re going to {area} (skip the area vote)</button>}
      {org && !st.region && options.length === 1 && <button type="button" className="btn block" onClick={goingHere} data-testid="going-here">✓ {area} it is</button>}
    </div>
  );
}
