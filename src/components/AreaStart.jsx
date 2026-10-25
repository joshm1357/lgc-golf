// The start of the trip builder (080, Josh 22 Oct): ONE map for the area — ⛳ pins for every viable course (within
// the drive of where you'd stay) and 🏠 pins for places to stay (towns, or spots the organiser drops: "beachside",
// "town centre"). Tap pins to put them on the table; the same things are a tick list underneath. Each area carries its
// own set of courses (several — never one) and places to stay, plus accommodation ideas with search links and shared
// lists. The app and the AI only suggest (✨); the organiser chooses. Then it all goes to "Call the vote".
// ov22 (Josh 23 Oct): hover a pin or a row for a quick summary (the pin grows and bounces, the row lights up, the map
// pans to it); click for everything (the course or place-to-stay sheet, with its "on the table" button). On a phone the
// first tap shows the summary, the second opens the details. The tick boxes still put things on the table.
// ov36 (Josh 23 Oct): every course on the map can be picked (its summary has "+ Put on the table", and the list always
// shows what's on the table); filters above the list (played / not played, ★, type, longest drive, sort — remembered
// on the trip); "Show more" / "Search wider" a step at a time; "🔍 Search this part of the map" lists the courses in
// view and can save them as an area of your own ("Custom: around Port Stephens"); and courses on the way up or back.
// The rules are pure, in lib/coursemap.js.
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
import OtherWays from './OtherWays.jsx';
import PinDropper, { tapToPin } from './PinDropper.jsx';
import * as CM from '../lib/coursemap.js';
import { addArea, MAX_AREAS } from '../lib/areavote.js';
import { fmtDrive } from '../lib/tripfinder.js';
import { pinNameFor } from '../lib/pinplace.js';
import './planux.css';

export const slimCourse = (c) => ({ id: c.id, name: c.name, area: c.area || null, lat: c.lat, lng: c.lng, mine_avg: c.mine_avg ?? null, others_avg: c.others_avg ?? null, others_n: c.others_n ?? null });

/** Library courses inside some boxes ({ south, west, north, east }), from the trip finder's library search, merged.
 *  → { rows: [course] | null (first load), loading }. While a new search runs the last rows stay (no flicker). */
function useLibBoxes(boxes) {
  const key = boxes.map((b) => ['south', 'west', 'north', 'east'].map((k) => Number(b[k]).toFixed(3)).join(',')).join('|');
  const [state, setState] = useState({ key: null, rows: null });
  useEffect(() => {
    if (!boxes.length) { setState({ key, rows: [] }); return undefined; }
    let live = true;
    setState((cur) => ({ key: null, rows: cur.rows }));
    Promise.all(boxes.map((b) => supabase.rpc('trip_finder_courses', { p_south: b.south, p_west: b.west, p_north: b.north, p_east: b.east, p_lat: (b.south + b.north) / 2, p_lng: (b.west + b.east) / 2, p_limit: 400 })
      .then(({ data, error }) => (error || !Array.isArray(data) ? [] : data), () => [])))
      .then((lists) => {
        if (!live) return;
        const m = new Map();
        for (const l of lists) for (const c of l) if (c && !m.has(c.id)) m.set(c.id, { ...c, facts: pickFacts(c.facts) });
        setState({ key, rows: [...m.values()] });
      });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows: state.rows, loading: state.key !== key };
}

const PLAYED = [['any', 'Either'], ['no', 'Not played'], ['yes', 'Played before']];
const STARS = [[0, '★ Any rating'], [3, '★ 3+'], [3.5, '★ 3.5+'], [4, '★ 4+'], [4.5, '★ 4.5+']];

/** The filters above the course list (ov36). Filters with nothing to filter on are left out. */
function CourseFilters({ f, setF, opts, reach = null, setReach = null }) {
  const steps = reach == null ? [] : [...new Set([...CM.REACH_STEPS, reach])].sort((a, b) => a - b);
  return (
    <div className="stack cm-filters" style={{ gap: 6 }} data-testid="course-filters">
      <div className="tb-chips" role="group" aria-label="Played before">
        {PLAYED.map(([v, l]) => <button key={v} type="button" className="chip" aria-pressed={f.played === v} onClick={() => setF({ played: v })} data-testid={`cf-played-${v}`}>{l}</button>)}
      </div>
      <div className="cm-selects">
        {opts.stars && (
          <select className="input" value={String(f.minStars || 0)} onChange={(e) => setF({ minStars: Number(e.target.value) })} aria-label="Our rating" data-testid="cf-stars">
            {STARS.map(([v, l]) => <option key={v} value={String(v)}>{l}</option>)}
          </select>
        )}
        {opts.types.length > 0 && (
          <select className="input" value={f.type || ''} onChange={(e) => setF({ type: e.target.value })} aria-label="Type of course" data-testid="cf-type">
            <option value="">Any type</option>
            {opts.types.map((t) => <option key={t} value={t}>{CM.TYPE_LABEL[t]}</option>)}
          </select>
        )}
        {setReach && (
          <select className="input" value={String(reach)} onChange={(e) => setReach(Number(e.target.value))} aria-label="Longest drive from where you’d stay" data-testid="cf-reach">
            {steps.map((m) => <option key={m} value={String(m)}>🚗 Up to {fmtDrive(m)}</option>)}
          </select>
        )}
        <select className="input" value={f.sort || 'suggested'} onChange={(e) => setF({ sort: e.target.value })} aria-label="Sort" data-testid="cf-sort">
          <option value="suggested">Suggested first</option>
          {opts.stars && <option value="rating">Best rated first</option>}
          <option value="drive">Closest first</option>
          {opts.ranked && <option value="ranked">Top ranked first</option>}
        </select>
      </div>
    </div>
  );
}

// tab / onTab (ov23): the areas bar at the top of step 1 (components/AreaBar.jsx) picks the area; then this shows no
// tabs of its own. Accommodation ideas and search links moved to step 2 (components/StayIdeas.jsx).
// starts (ov36): the trip's starting points [{ label, lat, lng }] — for courses on the way (else `origin`).
export default function AreaStart({ plan, st, save, org, areas, history, accom = [], people = 0, origin = null, starts = null, tees = [], onCallVote = null, onMode = null, tab: ctlTab = null, onTab = null, onChoose = null }) {
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
  const towns = useMemo(() => areas.filter((a) => a.region === area).map((a) => ({ key: a.name, name: a.name, lat: a.lat, lng: a.lng })), [areas, area]);
  const pins = (st.pins || []).filter((p) => p.area === area || (!p.area && area === st.region));
  const stayPins = [...towns, ...pins];
  const onTableStays = (st.areaStays || {})[area] || (area === st.region ? st.stays || [] : []);
  const onTableCourses = (st.areaCourses || {})[area] || [];
  const suggested = st.suggested || {};
  const driveFrom = onTableStays.length ? onTableStays : stayPins;

  // ov36: the filters and how far to look — saved on the trip by the organiser (the players' view keeps its own).
  const [mine, setMine] = useState({ f: {}, reach: {}, detour: null });
  const f = { ...CM.DEFAULT_FILTERS, ...((org ? st.courseFilters : mine.f) || {}) };
  const custom = (st.customAreas || {})[area] || null;
  const reach = Number((org ? st.courseReach || {} : mine.reach)[area]) || st.stayMax || TB.DEFAULT_STAY_MAX;
  const detour = Number(org ? st.onWayDetour : mine.detour) || 20;
  const [shown, setShown] = useState(CM.PAGE);
  const [view, setView] = useState(null);     // { box } — "Search this part of the map"
  const [wayOpen, setWayOpen] = useState(false);
  useEffect(() => { setShown(CM.PAGE); }, [area, view, f.played, f.minStars, f.type, f.sort]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setView(null); }, [area]);

  const libBox = custom || (stayPins.length ? TB.boxAround(stayPins, CM.searchMarginKm(reach)) : null);
  const lib = useLibBoxes(libBox ? [libBox] : []);
  const cands = useMemo(() => {
    const all = TB.areaCourseCandidates(lib.rows || [], driveFrom, { stayMax: custom ? 100000 : reach, history, limit: 400 });
    return custom ? all.filter((c) => CM.inBox(c.course, custom)) : all;
  }, [lib.rows, driveFrom, reach, history, custom]); // eslint-disable-line react-hooks/exhaustive-deps

  // On the way: from the starting points to the middle of where you'd stay.
  const startList = useMemo(() => {
    const s = (starts || []).filter((x) => x && x.lat != null);
    if (s.length) return s;
    return origin?.lat != null ? [{ label: String(origin.label || 'home').split(' ×')[0], lat: origin.lat, lng: origin.lng }] : [];
  }, [starts, origin]);
  const mid = driveFrom.length ? TB.boxAround(driveFrom, 0) : null;
  const to = mid ? { lat: mid.lat, lng: mid.lng } : null;
  const wayLib = useLibBoxes(wayOpen && to ? CM.corridorBoxes(startList, to, detour) : []);
  const candIds = useMemo(() => cands.map((c) => c.course.id), [cands]);
  const way = useMemo(() => (wayOpen ? CM.onTheWay(wayLib.rows || [], { starts: startList, to, maxDetour: detour, skip: candIds }) : []), [wayOpen, wayLib.rows, startList, to?.lat, to?.lng, detour, candIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const wayOf = (id) => way.find((w) => w.course.id === id) || null;

  // Your own part of the map.
  const viewLib = useLibBoxes(view ? [view.box] : []);
  const viewCands = useMemo(() => {
    if (!view) return [];
    const rows = (viewLib.rows || []).filter((c) => c.lat != null && CM.inBox(c, view.box)).map((c) => ({
      course: c, drive: driveFrom.length ? TB.legDrive('stay', c, { stays: driveFrom }) : { min: null, text: '' }, history: history ? history(c.id) : null, booking: null, facts: c.facts || {},
    }));
    return TB.rankCandidates(rows, { leg: 'stay' });
  }, [view, viewLib.rows, driveFrom, history]); // eslint-disable-line react-hooks/exhaustive-deps

  const researchIds = useMemo(() => [...new Set([...(view ? viewCands : cands).slice(0, 150).map((c) => c.course.id), ...onTableCourses])], [view, viewCands, cands, onTableCourses]);
  const researchAll = useCourseResearch(researchIds);
  const researchHot = useCourseResearch(hotCourse ? [hotCourse] : []);
  const research = useMemo(() => ({ ...researchAll, ...researchHot }), [researchAll, researchHot]);

  const courseMap = useMemo(() => {
    const m = { ...(st.courses || {}) };
    for (const c of [...(lib.rows || []), ...(wayLib.rows || []), ...(viewLib.rows || [])]) m[c.id] = c;
    return m;
  }, [st.courses, lib.rows, wayLib.rows, viewLib.rows]);
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
    if (!org || !c) return;
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
    const days = TB.prefillStayDays(st.days, (st.areaCourses || {})[r] || [], { ...courseMap, ...(st.courses || {}) }, { stays, stayMax: st.stayMax, origin, detourMax: st.detourMax, fly: TB.isFly(st) });
    save({ ...st, region: r, regionOptions: [r], stays, days });
  }
  const goingHere = () => chooseArea(area);
  const dropPin = (at, name) => {
    const p = { key: `pin:${Date.now()}`, name, lat: Math.round(at.lat * 1000) / 1000, lng: Math.round(at.lng * 1000) / 1000, custom: true, area };
    const list = onTableStays.length < TB.MAX_AREA_STAYS ? [...onTableStays, p] : onTableStays;
    save({ ...st, pins: [...(st.pins || []), p], areaStays: { ...(st.areaStays || {}), [area]: list }, ...(area === st.region ? { stays: list.slice(0, TB.MAX_STAYS) } : {}) });
  };

  // ov36: filters, how far, on the way, your own part of the map.
  const setF = (p) => (org ? save({ ...st, courseFilters: { ...f, ...p } }) : setMine((m) => ({ ...m, f: { ...f, ...p } })));
  const setReach = (m) => (org ? save({ ...st, courseReach: { ...(st.courseReach || {}), [area]: m } }) : setMine((x) => ({ ...x, reach: { ...x.reach, [area]: m } })));
  const setDetour = (m) => (org ? save({ ...st, onWayDetour: m }) : setMine((x) => ({ ...x, detour: m })));
  const searchHere = (box) => {
    if (CM.boxTooBig(box)) { toast('Zoom in a bit first — that’s a lot of map'); return; }
    setView({ box: CM.roundBox(box) });
  };
  const saveCustom = () => {
    if (!view) return;
    const taken = [...options, ...Object.keys(st.customAreas || {})];
    const name = CM.customAreaName(view.box, areas, taken);
    const centre = { lat: Math.round(((view.box.south + view.box.north) / 2) * 1000) / 1000, lng: Math.round(((view.box.west + view.box.east) / 2) * 1000) / 1000 };
    const pin = { key: `pin:${Date.now()}`, name: pinNameFor(centre, areas) || 'Middle of the map', ...centre, custom: true, area: name };
    const base = { ...st, customAreas: { ...(st.customAreas || {}), [name]: view.box }, pins: [...(st.pins || []), pin], areaStays: { ...(st.areaStays || {}), [name]: [pin] } };
    // With an area already chosen, adding another goes back to the list of options (as "+ Add another area" does).
    const opts = st.region ? { region: null, regionOptions: [...new Set([st.region, ...(st.areaPool || []), name])].slice(0, MAX_AREAS) } : addArea(st, name);
    if (!opts || !opts.regionOptions.includes(name)) { toast(`Up to ${MAX_AREAS} areas — take one off first`); return; }
    save({ ...base, ...opts });
    setView(null);
    setTab(name);
    toast(`Saved “${name}”`);
  };
  const reshapeCustom = () => { if (view && custom) { save({ ...st, customAreas: { ...(st.customAreas || {}), [area]: view.box } }); setView(null); } };

  const fOpts = CM.filterOptions(view ? viewCands : cands, research);
  // The list: the filtered courses (always with the ones on the table), a page at a time; the map shows them all.
  const baseList = CM.filterCourses(view ? viewCands : cands, f, { research, keep: onTableCourses });
  const listed = new Set(baseList.map((c) => c.course.id));
  const extras = view ? [] : onTableCourses.filter((id) => !listed.has(id) && courseMap[id]).map((id) => {
    const c = courseMap[id];
    return { course: c, drive: TB.legDrive('stay', c, { stays: driveFrom }), history: history ? history(id) : null, kept: true, away: true };
  });
  const list = [...baseList, ...extras];
  const total = baseList.filter((c) => !c.kept).length;
  const rows = [...list.slice(0, shown), ...list.slice(shown).filter((c) => onTableCourses.includes(c.course.id))];
  const more = view ? (total > shown ? CM.showMore({ total, shown, reach: 0 }) : null) : CM.showMore({ total, shown, reach, stays: driveFrom });
  const moreBtn = more && !(custom && more.kind === 'wider') ? more : null;
  const onMore = () => { if (moreBtn.kind === 'rows') setShown((n) => n + CM.PAGE); else { setReach(moreBtn.to); toast(`Looking within ${fmtDrive(moreBtn.to)} now`); } };

  const dot = (c, extra = {}) => ({ id: c.course.id, name: c.course.name, lat: c.course.lat, lng: c.course.lng, on: onTableCourses.includes(c.course.id), sub: c.drive?.text || '', sug: !view && c.suggested && !onTableCourses.includes(c.course.id), ...extra });
  const mapCourses = list.slice(0, 160).map((c) => dot(c));
  for (const w of way) if (!mapCourses.some((m) => m.id === w.course.id)) mapCourses.push(dot(w, { way: true, sub: `${fmtDrive(w.detour)} off the drive` }));
  for (const id of onTableCourses) if (!mapCourses.some((m) => m.id === id) && courseMap[id]) mapCourses.push({ ...courseMap[id], on: true });
  const mapStays = stayPins.map((s) => ({ ...s, on: onTableStays.some((x) => (x.key || x.name) === s.key), sug: isSug(`stay:${area}:${s.key}`), count: TB.staySupport(s, onTableCourses, courseMap, st.stayMax) }));
  // The trip's accommodation ideas for this area (the stay sheet shows them; adding them is in step 2, ov23).
  const ideas = accom.filter((a) => a.area === area || (!a.area && area === st.region));
  // Hover for a quick summary, click for everything (ov22).
  const candOf = (id) => cands.find((c) => c.course.id === id) || viewCands.find((c) => c.course.id === id);
  const tipFor = (kind, item) => (kind === 'course'
    ? courseTip({ course: courseMap[item.id] || item, research: research[item.id], drive: item.sub || candOf(item.id)?.drive?.text || '', facts: (courseMap[item.id] || item).facts })
    : stayTip({ stay: item, courses: mapCourses, ideas, people }));
  // ov36: any course dot can go on the table from its summary.
  const tipAction = org ? (kind, item) => {
    if (kind !== 'course') return null;
    const on = onTableCourses.includes(item.id);
    return { on, label: on ? '✓ On the table — take off' : '+ Put on the table', onClick: () => toggleCourse(courseMap[item.id] || item) };
  } : null;
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
  const tags = (id) => {
    const r = research[id];
    const t = CM.typesOf(r).slice(0, 2).map((k) => CM.TYPE_LABEL[k]);
    const rank = CM.rankOf(r);
    return [...t, rank != null ? (rank < 999 ? `Ranked #${rank}` : 'Ranked') : null].filter(Boolean).join(' · ');
  };
  const courseRow = (c, testid = 'area-course', line = null) => {
    const id = c.course.id;
    const tg = tags(id);
    const w = c.away ? wayOf(id) : null;
    return (
      <div key={id} className={rowClass(`c:${id}`)} style={{ gap: 6, minHeight: 44, alignItems: 'center' }} data-testid={testid} {...pi.row(`c:${id}`)}>
        <label className="as-tick"><input type="checkbox" checked={onTableCourses.includes(id)} disabled={!org} onChange={() => toggleCourse(c.course)} aria-label={c.course.name} /></label>
        <span className="grow">{nameBtn(`c:${id}`, c.course.name)}{!view && c.suggested && !onTableCourses.includes(id) && <span className="small muted"> ✨ suggested</span>}
          <span className="small muted" style={{ display: 'block' }}>
            {line || (w ? CM.onWayLine(w) : [c.drive?.text && c.drive.min != null && c.drive.min <= 180 ? c.drive.text : c.course.area, TB.shortKnown(c.course, c.history), tg].filter(Boolean).join(' · '))}
            {c.kept && <span> · {c.away ? 'on the table (further out)' : 'on the table (outside the filters)'}</span>}
          </span></span>
      </div>
    );
  };
  const fromWhere = CM.fromText(driveFrom);

  return (
    <div className="stack" style={{ gap: 10 }} data-testid="area-start">
      {tabs}
      <div className="as-grid">
      <div className="as-map">
      <BuilderMap className="tb-map tb-map-tall" courses={mapCourses} stays={mapStays} onCourse={(c) => toggleCourse(courseMap[c.id] || c)} onStay={toggleStay}
        origin={wayOpen ? (startList[0] || null) : null}
        info={pi} tipFor={tipFor} tipAction={tipAction} onTap={org && addPin === 'tap' ? tapToPin(areas, setAddPin, setPinName) : undefined}
        searchHere={addPin === 'tap' ? null : { label: '🔍 Search this part of the map', busy: !!view && viewLib.loading, onSearch: searchHere }} />
      <span className="small muted">{pi.canHover ? 'Point at a course dot or 🏠 pin for a summary; click it for everything' : 'Tap a course dot or 🏠 pin for a summary, tap again for everything'} — {org ? 'put any course on the table from its summary, or tick it in the list' : 'the ticked ones are on the table'}. ✨ = suggested — you choose. Move the map anywhere and 🔍 Search this part of the map.</span>
      </div>
      <div className="stack as-lists" style={{ gap: 10 }}>

      {view ? (
        <div className="card pad stack" style={{ gap: 4 }} data-testid="area-view">
          <div className="row between"><strong>🔍 This part of the map</strong><span className="small muted">{viewLib.loading ? 'Searching…' : `${total} course${total === 1 ? '' : 's'}`}</span></div>
          <span className="small muted">The courses in view, with your filters. Tick one to put it on the table for {area}{org ? ', or save this part of the map as an area of its own' : ''}.</span>
          <CourseFilters f={f} setF={setF} opts={fOpts} />
          {!viewLib.loading && !total && <span className="small muted">No courses in the library in view{CM.filtersOn(f) ? ` with ${CM.filterText(f)}` : ''} — move the map, or zoom out a little.</span>}
          {rows.map((c) => courseRow(c, 'view-course'))}
          {moreBtn && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onMore} data-testid="show-more">{moreBtn.text}</button>}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {org && <button type="button" className="btn sm" onClick={saveCustom} data-testid="save-custom-area">📍 Save as an area: {CM.customAreaName(view.box, areas, [...options, ...Object.keys(st.customAreas || {})])}</button>}
            {org && custom && <button type="button" className="btn ghost sm" onClick={reshapeCustom} data-testid="reshape-custom-area">Make {area} this part of the map</button>}
            <button type="button" className="btn ghost sm" onClick={() => setView(null)} data-testid="view-back">← Back to {area}</button>
          </div>
        </div>
      ) : (
      <div className="card pad stack" style={{ gap: 4 }} data-testid="area-courses">
        <div className="row between"><strong>⛳ Courses — {area}</strong><span className="small muted">{onTableCourses.length} on the table</span></div>
        <span className="small muted" data-testid="area-reach">{custom ? 'Your own part of the map' : `Within ${fmtDrive(reach)} of ${onTableStays.length ? fromWhere : 'the towns'}`}{lib.rows ? ` · ${total} course${total === 1 ? '' : 's'}${CM.filtersOn(f) ? ` (${CM.filterText(f)})` : ''}` : ''}. Keep several — the group picks.</span>
        <CourseFilters f={f} setF={setF} opts={fOpts} reach={custom ? null : reach} setReach={custom ? null : setReach} />
        {lib.rows === null && <span className="small muted">Finding courses…</span>}
        {lib.rows && !lib.loading && !total && <span className="small muted">No courses in the library {custom ? 'in this part of the map' : `within ${fmtDrive(reach)}`}{CM.filtersOn(f) ? ` with ${CM.filterText(f)}` : ''} yet.</span>}
        {org && cands.some((c) => c.suggested && !onTableCourses.includes(c.course.id)) && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={tickSuggested} data-testid="tick-suggested">✨ Tick the suggested ones</button>}
        {rows.map((c) => courseRow(c))}
        {moreBtn && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onMore} disabled={lib.loading} data-testid={moreBtn.kind === 'rows' ? 'show-more' : 'search-wider'}>{moreBtn.text}</button>}
        {total > shown && <span className="small muted">All {total} are on the map — tap any dot for its summary.</span>}
      </div>
      )}

      {startList.length > 0 && driveFrom.length > 0 && !view && (
        <div className="card pad stack" style={{ gap: 4 }} data-testid="area-onway">
          <div className="row between" style={{ gap: 8 }}>
            <strong>🚗 On the way up or back</strong>
            <button type="button" className="btn ghost sm" onClick={() => setWayOpen((o) => !o)} aria-expanded={wayOpen} data-testid="onway-toggle">{wayOpen ? 'Hide' : 'Show'}</button>
          </div>
          {!wayOpen && <span className="small muted">Courses just off the drive from {startList.map((s) => s.label).slice(0, 2).join(' and ')} — say for a Friday-morning round on the way up.</span>}
          {wayOpen && (
            <>
              <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="small muted">From {startList.map((s) => s.label).slice(0, 3).join(', ')} to {fromWhere}, up to</span>
                <select className="input" style={{ width: 'auto' }} value={String(detour)} onChange={(e) => setDetour(Number(e.target.value))} aria-label="Minutes off the drive" data-testid="onway-detour">
                  {CM.DETOUR_STEPS.map((m) => <option key={m} value={String(m)}>{m} min off the drive</option>)}
                </select>
              </div>
              {wayLib.loading && <span className="small muted">Finding courses on the way…</span>}
              {!wayLib.loading && !way.length && <span className="small muted">Nothing within {detour} min of the drive — try a bigger detour.</span>}
              {way.slice(0, 8).map((w) => courseRow({ ...w, history: history ? history(w.course.id) : null }, 'onway-course', CM.onWayLine(w)))}
              {way.length > 8 && <span className="small muted">{way.length - 8} more on the map (🚗).</span>}
            </>
          )}
        </div>
      )}

      <div className="card pad stack" style={{ gap: 4 }} data-testid="area-stays">
        <div className="row between"><strong>🏠 Where to stay — {area}</strong><span className="small muted">{onTableStays.length} on the table</span></div>
        {stayPins.map((s) => (
          <div key={s.key} className={rowClass(`s:${s.key}`)} style={{ gap: 6, minHeight: 44, alignItems: 'center' }} data-testid="area-stay" {...pi.row(`s:${s.key}`)}>
            <label className="as-tick"><input type="checkbox" checked={onTableStays.some((x) => (x.key || x.name) === s.key)} disabled={!org} onChange={() => toggleStay(s)} aria-label={s.name} /></label>
            <span className="grow">{nameBtn(`s:${s.key}`, s.name)}{isSug(`stay:${area}:${s.key}`) && <span className="small muted"> ✨ suggested</span>}{s.custom && <span className="small muted"> · your pin</span>}
              <span className="small muted" style={{ display: 'block' }}>{TB.staySupport(s, onTableCourses, courseMap, st.stayMax)} of the courses on the table within {st.stayMax} min</span></span>
          </div>
        ))}
        {org && <PinDropper areas={areas} addPin={addPin} setAddPin={setAddPin} pinName={pinName} setPinName={setPinName} onAdd={dropPin} />}
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
          <CourseSheet id={id} course={c} history={history ? history(id) : null} org={org} aiOn={aiOn} drive={candOf(id)?.drive?.text || (wayOf(id) ? `${fmtDrive(wayOf(id).detour)} off the drive` : null)}
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
      {/* O2 (walkthrough): no big "We're going to X" bar before anyone has voted — the one gold button is the Next
          step (Call the vote, or Go with the leader once it's in). Picking it yourself is one of the other ways. */}
      {org && !st.region && (
        <OtherWays>
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={goingHere} data-testid="going-here">
            {options.length > 1 ? `We’re going to ${area} (skip the area vote)` : `✓ ${area} it is (skip the vote)`}
          </button>
        </OtherWays>
      )}
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
          {org && <tr><th />{rows.map((r) => <td key={r.area}><button type="button" className="btn ghost sm" onClick={() => onChoose(r.area)}>Choose this one</button></td>)}</tr>}
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
            {org && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => onChoose(r.area)} data-testid="choose-area">Choose this one</button>}
          </div>
        ))}
      </div>
      {org && onCallVote && <button type="button" className="btn gold block" onClick={onCallVote} data-testid="compare-call-vote">🗳️ Call the vote — tick what goes out</button>}
    </div>
  );
}
