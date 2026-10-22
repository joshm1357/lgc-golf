// The start of the trip builder (080, Josh 22 Oct): ONE map for the area — ⛳ pins for every viable course (within
// the drive of where you'd stay) and 🏠 pins for places to stay (towns, or spots the organiser drops: "beachside",
// "town centre"). Tap pins to put them on the table; the same things are a tick list underneath. Each area carries its
// own set of courses (several — never one) and places to stay, plus accommodation ideas with search links and shared
// lists. The app and the AI only suggest (✨); the organiser chooses. Then it all goes to "Call the vote".
// ov22 (Josh 23 Oct): hover a pin or a row for a quick summary (the pin grows and bounces, the row lights up, the map
// pans to it); click for everything (the course or place-to-stay sheet, with its "on the table" button). On a phone the
// first tap shows the summary, the second opens the details. The tick boxes still put things on the table.
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { toast } from './ui.jsx';
import * as TB from '../lib/tripbuilder.js';
import { pickFacts } from '../lib/tripfinder.js';
import BuilderMap from './BuilderMap.jsx';
import { useFeature } from '../lib/store.jsx';
import { useCourseResearch } from './CourseResearch.jsx';
import { CourseSheet, StaySheet } from './PlaceSheets.jsx';
import { usePlaceInfo, RowTip } from './PlanMapTools.jsx';
import { courseTip, stayTip } from '../lib/placeinfo.js';
import './planux.css';

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

// tab / onTab (ov23): the areas bar at the top of step 1 (components/AreaBar.jsx) picks the area; then this shows no
// tabs of its own. Accommodation ideas and search links moved to step 2 (components/StayIdeas.jsx).
export default function AreaStart({ plan, st, save, org, areas, history, accom = [], people = 0, origin = null, tees = [], onCallVote = null, onMode = null, tab: ctlTab = null, onTab = null, onChoose = null }) {
  const options = st.region ? [st.region] : st.regionOptions;
  const [tabState, setTabState] = useState(options[0] || null);
  const tab = ctlTab ?? tabState;
  const setTab = onTab || setTabState;
  const comparing = tab === '__compare' && options.length > 1;
  useEffect(() => { onMode?.(comparing ? 'compare' : 'region'); }, [comparing]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = options.includes(tab) ? tab : options[0] || null;
  const [addPin, setAddPin] = useState(null);
  const [pinName, setPinName] = useState('');
  const aiOn = useFeature('ai_helper');
  const [sheet, setSheet] = useState(null); // 'c:<id>' | 's:<key>' — the details open
  const pi = usePlaceInfo({ onOpen: setSheet });
  const hotCourse = pi.hot.hot?.startsWith('c:') ? pi.hot.hot.slice(2) : null;
  const research = useCourseResearch(hotCourse ? [hotCourse] : []);
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
  const tabs = options.length > 1 && !onTab && (
    <div className="tb-chips" role="tablist" aria-label="Area" data-testid="area-tabs">
      {options.map((r) => <button key={r} type="button" role="tab" className="chip" aria-selected={!comparing && r === area} aria-pressed={!comparing && r === area} onClick={() => setTab(r)}>{r}</button>)}
      <button type="button" role="tab" className="chip" aria-selected={comparing} aria-pressed={comparing} onClick={() => setTab('__compare')} data-testid="area-compare-tab">📊 Compare</button>
    </div>
  );
  if (comparing) {
    return (
      <div className="stack" style={{ gap: 10 }} data-testid="area-start">
        {tabs}
        <AreaCompare st={st} areas={areas} accom={accom} people={people} origin={origin} tees={tees} org={org}
          onChoose={(r) => { setTab(r); chooseArea(r); }} onCallVote={onCallVote} />
      </div>
    );
  }

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
  function chooseArea(r) {
    if (onChoose) { onChoose(r, courseMap); return; } // ov23: the builder picks it with the vote's favourites ticked
    const stays = ((st.areaStays || {})[r] || []).slice(0, TB.MAX_STAYS);
    const days = TB.prefillStayDays(st.days, (st.areaCourses || {})[r] || [], { ...courseMap, ...(st.courses || {}) }, { stays, stayMax: st.stayMax });
    save({ ...st, region: r, regionOptions: [r], stays, days });
  }
  const goingHere = () => chooseArea(area);
  const dropPin = () => {
    const p = { key: `pin:${Date.now()}`, name: pinName.trim(), lat: Math.round(addPin.lat * 1000) / 1000, lng: Math.round(addPin.lng * 1000) / 1000, custom: true, area };
    const list = onTableStays.length < TB.MAX_AREA_STAYS ? [...onTableStays, p] : onTableStays;
    save({ ...st, pins: [...(st.pins || []), p], areaStays: { ...(st.areaStays || {}), [area]: list }, ...(area === st.region ? { stays: list.slice(0, TB.MAX_STAYS) } : {}) });
    setAddPin(null); setPinName('');
  };

  const mapCourses = cands.slice(0, 40).map((c) => ({ id: c.course.id, name: c.course.name, lat: c.course.lat, lng: c.course.lng, on: onTableCourses.includes(c.course.id), sub: c.drive.text, sug: c.suggested && !onTableCourses.includes(c.course.id) }));
  for (const id of onTableCourses) if (!mapCourses.some((m) => m.id === id) && courseMap[id]) mapCourses.push({ ...courseMap[id], on: true });
  const mapStays = stayPins.map((s) => ({ ...s, on: onTableStays.some((x) => (x.key || x.name) === s.key), sug: isSug(`stay:${area}:${s.key}`), count: TB.staySupport(s, onTableCourses, courseMap, st.stayMax) }));
  // The trip's accommodation ideas for this area (the stay sheet shows them; adding them is in step 2, ov23).
  const ideas = accom.filter((a) => a.area === area || (!a.area && area === st.region));
  // Hover for a quick summary, click for everything (ov22).
  const candOf = (id) => cands.find((c) => c.course.id === id);
  const tipFor = (kind, item) => (kind === 'course'
    ? courseTip({ course: courseMap[item.id] || item, research: research[item.id], drive: item.sub || candOf(item.id)?.drive?.text || '', facts: (courseMap[item.id] || item).facts })
    : stayTip({ stay: item, courses: mapCourses, ideas, people }));
  const tipForKey = (key) => {
    if (!key) return null;
    if (key.startsWith('c:')) { const id = key.slice(2); return tipFor('course', mapCourses.find((m) => m.id === id) || courseMap[id] || { id }); }
    const s = mapStays.find((x) => x.key === key.slice(2));
    return s ? tipFor('stay', s) : null;
  };
  const rowClass = (key) => `row${pi.isHot(key) ? ' pm-row-hot' : ''}`;
  const nameBtn = (key, text) => (
    <button type="button" className="as-name" onClick={(e) => pi.tapRow(key, e.currentTarget.closest('[data-place]'))}>{text}</button>
  );

  return (
    <div className="stack" style={{ gap: 10 }} data-testid="area-start">
      {tabs}
      <div className="as-grid">
      <div className="as-map">
      <BuilderMap className="tb-map tb-map-tall" courses={mapCourses} stays={mapStays} onCourse={(c) => toggleCourse(courseMap[c.id] || c)} onStay={toggleStay}
        info={pi} tipFor={tipFor} onTap={org && addPin === 'tap' ? (p) => { setAddPin(p); setPinName(''); } : undefined} />
      <span className="small muted">{pi.canHover ? 'Point at a course dot or 🏠 pin for a summary; click it for everything' : 'Tap a course dot or 🏠 pin for a summary, tap again for everything'} — tick them in the lists to put them on the table. ✨ = suggested — you choose.</span>
      </div>
      <div className="stack as-lists" style={{ gap: 10 }}>

      <div className="card pad stack" style={{ gap: 4 }} data-testid="area-courses">
        <div className="row between"><strong>⛳ Courses — {area}</strong><span className="small muted">{onTableCourses.length} on the table</span></div>
        <span className="small muted">Within {st.stayMax} min of {onTableStays.length ? 'where you’d stay' : 'the towns'}. Keep several — the group picks.</span>
        {lib === null && <span className="small muted">Finding courses…</span>}
        {lib && !cands.length && <span className="small muted">No courses in the library within {st.stayMax} min yet.</span>}
        {org && cands.some((c) => c.suggested && !onTableCourses.includes(c.course.id)) && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={tickSuggested} data-testid="tick-suggested">✨ Tick the suggested ones</button>}
        {cands.slice(0, 12).map((c) => (
          <div key={c.course.id} className={rowClass(`c:${c.course.id}`)} style={{ gap: 6, minHeight: 44, alignItems: 'center' }} data-testid="area-course" {...pi.row(`c:${c.course.id}`)}>
            <label className="as-tick"><input type="checkbox" checked={onTableCourses.includes(c.course.id)} disabled={!org} onChange={() => toggleCourse(c.course)} aria-label={c.course.name} /></label>
            <span className="grow">{nameBtn(`c:${c.course.id}`, c.course.name)}{c.suggested && !onTableCourses.includes(c.course.id) && <span className="small muted"> ✨ suggested</span>}
              <span className="small muted" style={{ display: 'block' }}>{c.drive.text} · {TB.shortKnown(c.course, c.history)}</span></span>
          </div>
        ))}
      </div>

      <div className="card pad stack" style={{ gap: 4 }} data-testid="area-stays">
        <div className="row between"><strong>🏠 Where to stay — {area}</strong><span className="small muted">{onTableStays.length} on the table</span></div>
        {stayPins.map((s) => (
          <div key={s.key} className={rowClass(`s:${s.key}`)} style={{ gap: 6, minHeight: 44, alignItems: 'center' }} data-testid="area-stay" {...pi.row(`s:${s.key}`)}>
            <label className="as-tick"><input type="checkbox" checked={onTableStays.some((x) => (x.key || x.name) === s.key)} disabled={!org} onChange={() => toggleStay(s)} aria-label={s.name} /></label>
            <span className="grow">{nameBtn(`s:${s.key}`, s.name)}{isSug(`stay:${area}:${s.key}`) && <span className="small muted"> ✨ suggested</span>}{s.custom && <span className="small muted"> · your pin</span>}
              <span className="small muted" style={{ display: 'block' }}>{TB.staySupport(s, onTableCourses, courseMap, st.stayMax)} of the courses on the table within {st.stayMax} min</span></span>
          </div>
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
        <span className="small muted">Accommodation searches come in the next step, once the area’s chosen.</span>
      </div>

      </div>
      </div>
      <RowTip anchor={pi.rowAnchor} tip={pi.rowAnchor ? tipForKey(pi.hot.hot) : null} passive={pi.hot.via === 'hover'} onMore={() => pi.open(pi.hot.hot)} onEnter={pi.hot.hold} onLeave={pi.hot.release} />
      {sheet?.startsWith('c:') && (() => {
        const id = sheet.slice(2);
        const c = courseMap[id] || candOf(id)?.course;
        const on = onTableCourses.includes(id);
        return (
          <CourseSheet id={id} course={c} history={history ? history(id) : null} org={org} aiOn={aiOn} drive={candOf(id)?.drive?.text || null}
            toggle={org && c ? { label: on ? `Take it off the table for ${area}` : `Put it on the table for ${area}`, onClick: () => { toggleCourse(c); setSheet(null); } } : null}
            onClose={() => setSheet(null)} />
        );
      })()}
      {sheet?.startsWith('s:') && (() => {
        const s = mapStays.find((x) => x.key === sheet.slice(2));
        if (!s) return null;
        return (
          <StaySheet stay={s} courses={mapCourses} ideas={ideas} people={people} stayMax={st.stayMax}
            toggle={org ? { label: s.on ? `Take ${s.name} off the table` : `Put ${s.name} on the table`, onClick: () => { toggleStay(s); setSheet(null); } } : null}
            onCourse={(id) => setSheet(`c:${id}`)} onClose={() => setSheet(null)} />
        );
      })()}
      {org && !st.region && options.length > 1 && <button type="button" className="btn block" onClick={goingHere} data-testid="going-here">We’re going to {area} (skip the area vote)</button>}
      {org && !st.region && options.length === 1 && <button type="button" className="btn block" onClick={goingHere} data-testid="going-here">✓ {area} it is</button>}
    </div>
  );
}

/** The regions side by side (080): courses, places to stay (with list links), rough cost each, the drive, tee times
 *  known. Then "Choose this one" (the organiser decides) or "Call the vote" with the ones to send out. */
function AreaCompare({ st, areas, accom, people, origin, tees, org, onChoose, onCallVote }) {
  const rows = TB.compareAreas(st, { areas, accom, people, origin, tees });
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="area-compare">
      <span className="small muted">Side by side. Choose one yourself, or call the vote and let the group say.</span>
      <table className="cmp-table" data-testid="compare-table">
        <thead><tr><th aria-label="What" />{rows.map((r) => <th key={r.area}>📍 {r.area}</th>)}</tr></thead>
        <tbody>
          <tr><th>⛳ Courses</th>{rows.map((r) => <td key={r.area}><strong>{r.courses.length}</strong>{r.courses.length ? `: ${r.courses.join(', ')}` : ' — none ticked yet'}</td>)}</tr>
          <tr><th>🏠 Stay</th>{rows.map((r) => <td key={r.area}>{r.stays.join(', ') || '—'}</td>)}</tr>
          <tr><th>🏡 Places</th>{rows.map((r) => <td key={r.area}>{r.ideas.length ? r.ideas.map((a) => <div key={a.id}>{a.link ? <a href={a.link} target="_blank" rel="noreferrer noopener">{a.name} ↗</a> : a.name}</div>) : '—'}</td>)}</tr>
          <tr><th>💰 Stay each</th>{rows.map((r) => <td key={r.area}>{r.costEach != null ? `about $${r.costEach}` : '—'}</td>)}</tr>
          <tr><th>🚗 Drive</th>{rows.map((r) => <td key={r.area}>{r.driveText ? `about ${r.driveText}` : '—'}</td>)}</tr>
          <tr><th>⏱️ Tee times</th>{rows.map((r) => <td key={r.area}>{r.teeDays ? `${r.teeDays} day${r.teeDays === 1 ? '' : 's'} in` : 'not asked yet'}</td>)}</tr>
          {org && <tr><th />{rows.map((r) => <td key={r.area}><button type="button" className="btn sm" onClick={() => onChoose(r.area)}>Choose this one</button></td>)}</tr>}
        </tbody>
      </table>
      <div className="tb-compare">
        {rows.map((r) => (
          <div key={r.area} className="card pad stack" style={{ gap: 4 }} data-testid="compare-area">
            <strong style={{ fontSize: 17 }}>📍 {r.area}</strong>
            <div className="small"><strong>⛳ {r.courses.length} course{r.courses.length === 1 ? '' : 's'}:</strong> {r.courses.join(', ') || <span className="muted">none ticked yet</span>}</div>
            <div className="small"><strong>🏠 Stay:</strong> {r.stays.join(', ') || <span className="muted">none ticked yet</span>}</div>
            {r.ideas.map((a) => <div key={a.id} className="small">{a.is_list ? '📋' : '🏡'} {a.link ? <a href={a.link} target="_blank" rel="noreferrer noopener">{a.name} ↗</a> : a.name}</div>)}
            <div className="small"><strong>💰</strong> {r.costEach != null ? `about $${r.costEach} each to stay` : <span className="muted">no accommodation costs yet</span>}</div>
            <div className="small"><strong>🚗</strong> {r.drive != null ? `about ${r.driveText} from ${origin?.label?.split(' ×')[0] || 'home'}` : <span className="muted">drive not known</span>}</div>
            <div className="small"><strong>⏱️</strong> {r.teeDays ? `${r.teeDays} day${r.teeDays === 1 ? '' : 's'} of tee times in` : <span className="muted">no tee times asked yet</span>}</div>
            {org && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => onChoose(r.area)} data-testid="choose-area">Choose this one</button>}
          </div>
        ))}
      </div>
      {org && onCallVote && <button type="button" className="btn gold block" onClick={onCallVote} data-testid="compare-call-vote">🗳️ Call the vote — tick what goes out</button>}
    </div>
  );
}
