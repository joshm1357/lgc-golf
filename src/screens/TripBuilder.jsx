// Trip builder (077): build a trip day by day on one map — /plan/:planId/build (behind 'trip_finder').
// Josh's order: 1 Area & weekends (→ vote 1 "Where and when?") → 2 Stay areas & course options each day → 3 Call the
// courses for tee times on the settled weekend(s) → 4 Pick the trip (or vote 2 "Which trip?") → it fills the trip.
// Organisers build; players see it read-only, vote, and put in tee times for a "Call the course" job they own.
// All the maths is in src/lib/tripbuilder.js. Drive times are "about" (straight line × 1.3 at 80 km/h).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession, useData, useFeature, useRealtime, playerName } from '../lib/store.jsx';
import { Header, Loading, Seg, toast } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify } from '../lib/push.js';
import { usePlanData } from './Planner.jsx';
import { TripSetupCard } from './TripSetup.jsx';
import BuilderMap from '../components/BuilderMap.jsx';
import { useVoteBatches } from '../components/VoteBatchCard.jsx';
import { startsFromHomes, centre, pickFacts, weekday } from '../lib/tripfinder.js';
import * as TB from '../lib/tripbuilder.js';
import { todayISO } from '../lib/plan.js';
import './tripbuilder.css';
import AreaStart from '../components/AreaStart.jsx';
import ExtrasPanel from '../components/ExtrasPanel.jsx';
import { CallVoteSheet, callBatch } from '../components/CallVote.jsx';
import { CallsWho, CourseCall, BestPerDay, TeeGridTable, useSocialTimes } from '../components/TeeCalls.jsx';
import { windowDates, slotsFor } from '../lib/teegrid.js';
import { extrasSection } from '../lib/extras.js';
import { useCourseResearch } from '../components/CourseResearch.jsx';
import { shortFacts } from '../lib/courseresearch.js';
import { CourseSheet, StaySheet } from '../components/PlaceSheets.jsx';
import { usePlaceInfo, RowTip } from '../components/PlanMapTools.jsx';
import { courseTip, stayTip } from '../lib/placeinfo.js';

const STAY_LIMITS = [20, 30, 40, 50, 60];
const FILTERS = [['notPlayed', 'Not played before'], ['favourites', 'Our favourites'], ['stayPlay', 'Stay & play']];
const LEG_ICON = { way: '🚗', stay: '⛳', home: '🏠' };
const slim = (c) => ({ id: c.id, name: c.name, area: c.area || null, lat: c.lat, lng: c.lng, mine_avg: c.mine_avg ?? null, others_avg: c.others_avg ?? null, others_n: c.others_n ?? null });

export default function TripBuilder() {
  const { planId } = useParams();
  const { status } = useSession();
  const data = useData();
  const pd = usePlanData(planId);
  const votesOn = useFeature('planner_tasks');
  const aiOn = useFeature('ai_helper');
  const org = !!status.is_admin && !status.viewing;
  const me = status.player_id;
  const [row, setRow] = useState(undefined);
  const [areas, setAreas] = useState([]);
  const [lib, setLib] = useState(null);
  const [tees, setTees] = useState([]);
  const [booking, setBooking] = useState({});
  const [starts, setStarts] = useState(null);
  const [step, setStep] = useState(null);
  const [focus, setFocus] = useState(0);
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({});
  const [longOn, setLongOn] = useState(false);
  const [addPin, setAddPin] = useState(null); // null | 'tap' | { lat, lng }
  const [pinName, setPinName] = useState('');
  const [busy, run] = useRun();
  const [batches] = useVoteBatches(planId);
  const [calling, setCalling] = useState(null);
  const [comparing, setComparing] = useState(false); // the Compare tab shows only the comparison (080 review) // { title, range, keen, slot, attach, state } — the Call the vote sheet
  const [accom, setAccom] = useState([]);
  // ov22: hover for a quick summary, click for everything (map pins and list rows).
  const [staySheet, setStaySheet] = useState(null);
  const pi = usePlaceInfo({ onOpen: (key) => (key.startsWith('c:') ? setOpen({ id: key.slice(2), day: null }) : setStaySheet(key.slice(2))) });
  const hotCourse = pi.hot.hot?.startsWith('c:') ? pi.hot.hot.slice(2) : null;
  const hotResearch = useCourseResearch(hotCourse ? [hotCourse] : []);
  const loadAccom = useCallback(async () => {
    const { data: a } = await supabase.from('plan_stays').select('*').eq('plan_id', planId).order('created_at');
    setAccom(a || []);
  }, [planId]);
  useEffect(() => { loadAccom(); }, [loadAccom]);
  useRealtime(['plan_stays'], loadAccom);

  // ------------------------------------------------------------------ loading
  const loadBuild = useCallback(async () => {
    const { data: b } = await supabase.from('trip_builds').select('*').eq('plan_id', planId).maybeSingle();
    setRow(b || null);
  }, [planId]);
  const loadTees = useCallback(async () => {
    const { data: t } = await supabase.from('trip_tee_options').select('*').eq('plan_id', planId);
    setTees(t || []);
  }, [planId]);
  useEffect(() => { loadBuild(); loadTees(); }, [loadBuild, loadTees]);
  useRealtime(['trip_builds', 'trip_tee_options'], () => { loadBuild(); loadTees(); });
  // The Caddie's ✨ Plan a trip writes the AI's draft here as you chat (ov16): reload straight away (realtime is slower).
  useEffect(() => {
    const f = (e) => { if (!e.detail?.planId || e.detail.planId === planId) loadBuild(); };
    window.addEventListener('tripbuild:changed', f);
    return () => window.removeEventListener('tripbuild:changed', f);
  }, [planId, loadBuild]);
  useEffect(() => {
    supabase.from('stay_areas').select('*').order('sort').then(({ data: a }) => setAreas(a || []), () => {});
  }, []);
  // Where people come from (organisers only): the trip's starting points, else players' shared home suburbs.
  useEffect(() => {
    if (!org) return;
    (async () => {
      const { data: sp } = await supabase.from('trip_start_points').select('*').eq('plan_id', planId);
      if (sp?.length) { setStarts(sp.map((r) => ({ label: r.label, lat: r.lat, lng: r.lng, count: r.headcount }))); return; }
      const { data: homes } = await supabase.from('player_home_areas').select('*');
      setStarts(startsFromHomes(homes || []));
    })().catch(() => setStarts([]));
  }, [org, planId]);

  const plan = pd?.plan;
  const st = useMemo(() => (plan ? { ...TB.newState(plan), ...(row?.state || {}) } : null), [plan, row]);

  const save = useCallback(async (next) => {
    setRow((r) => ({ ...(r || {}), state: next }));
    const { error } = await supabase.from('trip_builds').upsert({ plan_id: planId, state: next }, { onConflict: 'plan_id' });
    if (error) toast('Couldn’t save that — try again');
  }, [planId]);
  const patch = (p) => save({ ...st, ...p });

  const origin = useMemo(() => {
    if (st?.origin) return st.origin;
    const s = (starts || []).filter((x) => x.lat != null);
    if (!s.length) return null;
    const c = centre(s);
    return { lat: c.lat, lng: c.lng, label: s.map((x) => `${x.label} ×${x.count}`).join(', ') };
  }, [st?.origin, starts]);

  const regionTowns = useMemo(() => areas.filter((a) => a.region === st?.region), [areas, st?.region]);
  const pins = st?.pins || [];
  const stayChoices = useMemo(() => [
    ...regionTowns.map((a) => ({ key: a.name, name: a.name, lat: a.lat, lng: a.lng })),
    ...pins,
  ], [regionTowns, pins]);
  const stays = st?.stays || [];

  // Courses around the region (organisers; players see the saved options).
  useEffect(() => {
    if (!org || !st?.region || !regionTowns.length) return;
    const box = TB.boxAround([...regionTowns, ...pins, ...(origin ? [origin] : [])], 30);
    const mid = TB.boxAround(regionTowns, 0);
    supabase.rpc('trip_finder_courses', { p_south: box.south, p_west: box.west, p_north: box.north, p_east: box.east, p_lat: mid.lat, p_lng: mid.lng, p_limit: 400 })
      .then(({ data: rows, error }) => { if (error) { toast(error.message || 'Couldn’t load courses'); setLib([]); } else setLib(Array.isArray(rows) ? rows : []); }, () => setLib([]));
  }, [org, st?.region, regionTowns.length, pins.length, origin?.lat]); // eslint-disable-line react-hooks/exhaustive-deps

  const courseMap = useMemo(() => {
    const m = {};
    for (const c of Object.values(st?.courses || {})) m[c.id] = c;
    for (const c of lib || []) m[c.id] = { ...c, facts: pickFacts(c.facts) };
    return m;
  }, [st?.courses, lib]);
  const optionIds = useMemo(() => [...new Set((st?.days || []).flatMap((d) => d.options || []))], [st?.days]);
  const bookingKey = optionIds.join(',') + '|' + (open?.id || '');
  const loadBooking = useCallback(async () => {
    const ids = [...new Set([...optionIds, ...(open?.id ? [open.id] : [])])];
    if (!ids.length) return;
    const { data: b } = await supabase.from('course_booking_info')
      .select('course_id,visitor_times,member_times,booking_method,phone,booking_url,email,max_group,max_tee_times,features,notes,source,updated_at').in('course_id', ids);
    setBooking((cur) => ({ ...cur, ...Object.fromEntries((b || []).map((x) => [x.course_id, x])) }));
  }, [bookingKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadBooking(); }, [loadBooking]);
  // Josh's course research (088): facts on each course row, the "About this course for groups" block, the call card.
  const research = useCourseResearch([...optionIds, ...(open?.id ? [open.id] : [])]);
  const [social, loadSocial] = useSocialTimes(optionIds);

  const history = useCallback((id) => TB.playedHistory(id, { courses: data.courses, rounds: data.rounds, trips: data.trips, honour: data.honour_board }), [data]);
  const points = useMemo(() => TB.votePoints(st?.optionKeys || {}, pd?.votes || []), [st?.optionKeys, pd?.votes]);
  const need = TB.teeTimesNeeded({ rsvps: pd?.rsvps || [], override: st?.headcount });
  const jobs = (pd?.items || []).filter((i) => i.kind === 'job');
  const callJobIds = st?.callJobs || {};

  // Each day's candidates: within the drive for the leg, ranked.
  const dayCands = useCallback((d) => {
    if (!lib || !stays.length) return [];
    const w = st.weekends[0];
    const dow = w ? weekday(TB.dayDate(w, d.index)) : null;
    const cands = lib.filter((c) => c.lat != null).map((c) => {
      const drive = TB.legDrive(d.leg, c, { origin, stays });
      return { course: c, drive, booking: booking[c.id], history: history(c.id), facts: pickFacts(c.facts) };
    }).filter((c) => TB.fitsLeg(d.leg, c.drive, st) && (d.leg === 'stay' || origin));
    return TB.rankCandidates(cands, { leg: d.leg, dow, votes: TB.dayVotes(points, d.index), filters });
  }, [lib, stays, st, origin, booking, history, points, filters]);

  // Configurations (organisers work them out; everyone sees the saved ones).
  const configs = useMemo(() => {
    if (!org || !st) return st?.configs || [];
    return TB.buildConfigurations({ weekends: st.weekends, stays, days: st.days, courses: courseMap, origin, tees: tees.map((t) => ({ ...t, times: slotsFor(t) })), needed: need.needed || 1,
      stayMax: st.stayMax, detourMax: st.detourMax, votes: points, limit: 12 });
  }, [org, st, stays, courseMap, origin, tees, need.needed, points]);

  if (!pd || !st || row === undefined) return <div className="page"><Header back="Trip" title="Build the trip" /><Loading /></div>;
  if (!plan) return <div className="page"><Header back="Trip" title="Build the trip" /><div className="empty">This trip has been removed.</div></div>;
  if (!org && !row) return <div className="page"><Header back="Trip" title="Build the trip" sub={plan.name} /><div className="empty">The organiser hasn’t started building this trip yet.</div></div>;

  const steps = TB.builderSteps(st, { teeCount: tees.filter((t) => slotsFor(t).length).length });
  const current = step || (steps.find((s) => !s.done && !s.locked) || steps[steps.length - 1]).key;
  const days = TB.tripDays(st.nights).map((d) => ({ ...d, options: st.days.find((x) => x.index === d.index && x.leg === d.leg)?.options || [] }));
  const weekendDates = (index) => st.weekends.map((w) => TB.dayLabel(TB.dayDate(w, index))).join(' / ');
  const v1 = batches.find((b) => b.id === st.votes?.v1);
  // (the group's usual social golf times for the courses being called — see loadSocial above)
  const v2 = batches.find((b) => b.id === st.votes?.v2);

  // ------------------------------------------------------------------ actions
  const toggleOption = (d, c) => {
    const has = d.options.includes(c.id);
    if (!has && d.options.length >= TB.MAX_OPTIONS_PER_DAY) { toast(`Up to ${TB.MAX_OPTIONS_PER_DAY} options a day`); return; }
    save({
      ...st,
      courses: { ...st.courses, [c.id]: slim(c) },
      days: days.map((x) => ({ index: x.index, leg: x.leg, options: x.index === d.index ? (has ? x.options.filter((id) => id !== c.id) : [...x.options, c.id]) : x.options })),
      info: { ...(st.info || {}), [`${d.index}:${c.id}`]: TB.legDrive(d.leg, c, { origin, stays }).text },
    });
  };
  const toggleStay = (s) => {
    const has = stays.some((x) => x.key === s.key);
    if (!has && stays.length >= TB.MAX_STAYS) { toast(`Up to ${TB.MAX_STAYS} places to stay`); return; }
    patch({ stays: has ? stays.filter((x) => x.key !== s.key) : [...stays, { key: s.key, name: s.name, lat: s.lat, lng: s.lng }] });
  };
  const toggleWeekend = (w) => {
    const has = st.weekends.some((x) => x.start === w.start);
    if (!has && st.weekends.length >= TB.MAX_WEEKENDS) { toast(`Up to ${TB.MAX_WEEKENDS} weekends`); return; }
    patch({ weekends: has ? st.weekends.filter((x) => x.start !== w.start) : [...st.weekends, { start: w.start, end: w.end, long: w.long, holiday: w.holiday || null }].sort((a, b) => a.start.localeCompare(b.start)), weekendsSettled: false });
  };
  const toggleRegion = (r) => {
    const has = st.regionOptions.includes(r);
    if (!has && st.regionOptions.length >= 3) { toast('Up to 3 areas'); return; }
    patch({ regionOptions: has ? st.regionOptions.filter((x) => x !== r) : [...st.regionOptions, r] });
  };


  // Call the vote (080): everything on the table at the start — areas (each with its courses and places to stay),
  // weekends, towns, courses, accommodation ideas, extras — and each day's course options once the area's settled.
  const vote1 = () => {
    const range = TB.startRange(st, { courseMap, accom, extras: extrasSection(st.extras) });
    if (st.region) {
      for (const d of days) {
        if (d.options.length < 2) continue;
        range.push({ key: `day:${d.index}`, kind: 'other', question: `${d.name}${st.weekends.length ? ` (${weekendDates(d.index)})` : ''}: which course?`, options: d.options.map((id) => {
          const c = courseMap[id];
          return { key: `course:${d.index}:${id}`, label: c?.name || 'Course', notes: [st.info?.[`${d.index}:${id}`], TB.shortKnown(c, history(id))].filter(Boolean).join(' · ') };
        }) });
      }
    }
    if (!range.length) { toast('Nothing on the table yet — add a second option somewhere, or just pick'); return; }
    setCalling({ title: st.region ? 'Weekend, where to stay and courses' : 'Where and when?', range, keen: true, slot: 'v1' });
  };
  const called = async ({ batch: b, keys }) => {
    const c = calling;
    for (const id of c.attach || []) await supabase.from('plan_polls').update({ vote_batch: b.id }).eq('id', id);
    await save({ ...st, ...(c.state || {}), optionKeys: { ...(st.optionKeys || {}), ...keys }, votes: { ...(st.votes || {}), [c.slot]: b.id } });
    pd.reload(); loadAccom();
  };

  const makeCalls = () => run(async () => {
    const made = TB.callJobs({ days, weekends: st.weekends, courses: courseMap, needed: need.needed || 1, origin, stays, booking });
    const fresh = made.filter((j) => !callJobIds[j.course_id] || !jobs.some((x) => x.id === callJobIds[j.course_id]));
    if (!fresh.length) { toast('Every course already has its call job'); return; }
    const due = TB.addDays(todayISO(), 7);
    const rows = await must(supabase.from('plan_items').insert(fresh.map((j, i) => ({ plan_id: planId, kind: 'job', title: j.title, body: j.body, due, sort: 100 + i }))).select('id'));
    const ids = { ...callJobIds };
    fresh.forEach((j, i) => { ids[j.course_id] = rows[i].id; });
    await save({ ...st, callJobs: ids, callsMade: true });
    pd.reload();
  }, 'Call jobs made — hand them out with the owner picker');

  const vote2 = (list) => {
    const attach = pd.polls.filter((p) => p.status === 'open' && !p.vote_batch && /stay|accommodation/i.test(p.question)).map((p) => p.id);
    setCalling({ title: 'Which trip?', keen: false, slot: 'v2', attach, state: { configs: list },
      range: [{ key: 'config', kind: 'other', question: 'Which trip?', options: list.map((c) => ({ label: `${TB.weekendLabel(c.weekend)} · stay ${c.stay.name}`, notes: c.text, key: `config:${c.key}` })) }] });
  };

  const pick = (c) => run(async () => {
    const libIds = [...new Set(c.rounds.filter((r) => r.course_id).map((r) => r.course_id))];
    const courseIds = {};
    for (const id of libIds) courseIds[id] = await must(supabase.rpc('copy_library_course', { p_id: id }));
    const formats = TB.usualFormats(c.rounds.filter((r) => r.course_id).length, { trips: data.trips, rounds: data.rounds });
    const shape = TB.shapeFromConfig(c, { courseIds, formats, oldShape: plan.repeat_shape });
    const end = c.weekend.end || TB.addDays(c.weekend.start, st.nights);
    await must(supabase.from('plans').update({ start_date: c.weekend.start, end_date: end, location_name: c.stay.name, address: st.region || null, repeat_shape: shape }).eq('id', planId));
    await save({ ...st, picked: c.key, pickedText: c.text, weekends: [c.weekend], weekendsSettled: true, configs: st.configs?.length ? st.configs : configs.slice(0, 5) });
    await data.reload();
    pd.reload();
    setStep('configs');
  }, 'Picked — dates, place and the rounds are filled in. Check them under “Set it up in the app”.');

  // ------------------------------------------------------------------ the map
  const focusDay = days.find((d) => d.index === focus) || days[0];
  const cands = current === 'courses' || current === 'calls' ? dayCands(focusDay) : [];
  const mapCourses = (() => {
    const shown = new Map();
    for (const c of cands.slice(0, 25)) shown.set(c.course.id, { id: c.course.id, name: c.course.name, lat: c.course.lat, lng: c.course.lng, on: focusDay.options.includes(c.course.id), sub: c.drive.text });
    for (const id of focusDay.options) {
      const c = courseMap[id];
      if (c && !shown.has(id)) shown.set(id, { id, name: c.name, lat: c.lat, lng: c.lng, on: true, sub: st.info?.[`${focusDay.index}:${id}`] });
    }
    const dv = TB.dayVotes(points, focusDay.index);
    const top = Object.entries(dv).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 0 && shown.has(top[0])) shown.get(top[0]).top = true;
    return [...shown.values()];
  })();
  const mapStays = (st.region ? stayChoices : areas.filter((a) => st.regionOptions.includes(a.region)).map((a) => ({ key: a.name, name: a.name, lat: a.lat, lng: a.lng })))
    .map((s) => ({ ...s, on: stays.some((x) => x.key === s.key) }));
  const openCourse = (c) => setOpen({ id: c.id, day: focusDay });
  // The summary card for a course or a place to stay (ov22).
  const tipFor = (kind, item) => {
    if (kind === 'course') {
      const c = courseMap[item.id] || item;
      return courseTip({ course: c, research: research[item.id] || hotResearch[item.id], booking: booking[item.id], drive: item.sub || st.info?.[`${focusDay.index}:${item.id}`] || '', facts: c.facts });
    }
    return stayTip({ stay: item, courses: mapCourses, ideas: accom.filter((a) => !a.area || a.area === st.region), people: need.people || 0 });
  };
  const tipForKey = (key) => {
    if (!key) return null;
    if (key.startsWith('c:')) { const id = key.slice(2); const m = mapCourses.find((c) => c.id === id); return tipFor('course', m || courseMap[id] || { id }); }
    const k = key.slice(2);
    const sItem = [...mapStays, ...stayChoices].find((x) => (x.key || x.name) === k);
    return sItem ? tipFor('stay', sItem) : null;
  };
  const map = (
    <BuilderMap courses={mapCourses} stays={mapStays} origin={org ? origin : null}
      onCourse={openCourse} onStay={org && st.region ? toggleStay : undefined} info={pi} tipFor={tipFor}
      onTap={org && addPin === 'tap' ? (p) => { setAddPin(p); setPinName(''); } : undefined} />
  );

  const lockedNote = (s) => <div className="tb-locked">🔒 After: {s.after}</div>;
  const stepBox = (s, body, summary) => (
    <div className="card" key={s.key} data-testid={`tb-step-${s.key}`} style={{ overflow: 'hidden' }}>
      <button type="button" className="row between" onClick={() => setStep(s.key)} style={{ width: '100%', padding: '12px 14px', background: 'none', border: 0, textAlign: 'left', color: 'inherit', font: 'inherit' }}>
        <span><strong>{s.done ? '✅' : s.locked ? '🔒' : `${s.n}.`} {s.label}</strong>{summary && current !== s.key && <div className="small muted">{summary}</div>}</span>
        <span className="small muted">{current === s.key ? '' : 'Open'}</span>
      </button>
      {current === s.key && (s.locked ? lockedNote(s) : <div className="stack" style={{ padding: '0 14px 14px', gap: 10 }}>{body}</div>)}
    </div>
  );

  // ------------------------------------------------------------------ 1. area & weekends
  const regionHits = TB.matchRegions(query, areas);
  const wkOptions = TB.weekendOptions({ count: 6, nights: st.nights, includeLong: longOn });
  const ptsBadge = (k) => (points[k] ? <span className="tb-chip-pts">{points[k]}</span> : null);
  const stepArea = (
    <>
      <span className="label">Where, roughly?</span>
      {st.region ? (
        <div className="row between"><strong data-testid="tb-region">📍 {st.region}</strong>{org && <button type="button" className="btn ghost sm" onClick={() => patch({ region: null })}>Change</button>}</div>
      ) : (
        <>
          {org && <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. South Coast, Hunter, Mudgee" aria-label="Area" />}
          {regionHits.length > 0 && (
            <div className="tb-chips" data-testid="tb-region-hits">
              {regionHits.slice(0, 6).map((r) => (
                <button key={r.region} type="button" className="chip" aria-pressed={st.regionOptions.includes(r.region)} disabled={!org} onClick={() => toggleRegion(r.region)}>{r.region}</button>
              ))}
            </div>
          )}
          {st.regionOptions.length === 1 && org && <span className="small muted">Pick another area to put them to a vote, or go with this one below.</span>}
        </>
      )}
      {(st.region || st.regionOptions.length > 0) && (
        <AreaStart plan={plan} st={st} save={save} org={org} areas={areas} history={history} accom={accom} reloadAccom={loadAccom}
          people={need.people || data.players.filter((p) => p.approved !== false).length} origin={origin} tees={tees}
          onCallVote={org && votesOn && !v1 ? vote1 : null} onMode={(m) => setComparing(m === 'compare')} />
      )}
      {!(comparing && st.regionOptions.length > 1 && !st.region) && <>
      {org && (
        <div className="small muted">Coming from: <strong>{origin?.label || 'not set'}</strong>{!origin && ' — add starting points in “Find a course”, or people’s home suburbs.'}</div>
      )}
      <span className="label">How long?</span>
      <Seg light options={[{ value: 1, label: '1 night' }, { value: 2, label: '2 nights' }, { value: 3, label: '3 nights' }]} value={st.nights}
        onChange={(n) => org && patch({ nights: n, days: TB.resizeDays(st.days, n), weekends: [], weekendsSettled: false })} />
      <span className="label">Which weekends? (1–3)</span>
      {org && (
        <div className="tb-chips" data-testid="tb-weekend-options">
          {wkOptions.map((w) => (
            <button key={w.start} type="button" className="chip" aria-pressed={st.weekends.some((x) => x.start === w.start)} onClick={() => toggleWeekend(w)}>{w.label}{ptsBadge(`weekend:${w.start}`)}</button>
          ))}
          <button type="button" className="chip" aria-pressed={longOn} onClick={() => setLongOn(!longOn)}>{longOn ? 'Hide long weekends' : '+ Long weekends'}</button>
        </div>
      )}
      {st.weekends.length > 0 && (
        <div className="stack" style={{ gap: 4 }} data-testid="tb-weekends">
          {st.weekends.map((w) => (
            <div key={w.start} className="row between small"><span>📅 <strong>{TB.weekendLabel(w)}</strong>{ptsBadge(`weekend:${w.start}`)}</span>
              {org && st.weekends.length > 1 && <button type="button" className="btn ghost sm" onClick={() => patch({ weekends: [w], weekendsSettled: true })}>Go with this</button>}
            </div>
          ))}
        </div>
      )}
      {org && st.weekends.length > 0 && (
        st.weekendsSettled
          ? <span className="small" style={{ fontWeight: 700 }} data-testid="tb-weekends-settled">✓ Weekends settled — the courses get called about {st.weekends.length === 1 ? 'this one' : 'these'}.{' '}<button type="button" className="btn ghost sm" onClick={() => patch({ weekendsSettled: false })}>Change</button></span>
          : <button type="button" className="btn block" onClick={() => patch({ weekendsSettled: true })}>These are the weekends{st.weekends.length > 1 ? ' (a shortlist)' : ''}</button>
      )}
      <ExtrasPanel plan={plan} st={st} save={save} org={org} />
      {org && votesOn && !v1 && (st.regionOptions.length > 0 || st.region) && (
        <button type="button" className="btn gold block" disabled={busy} onClick={vote1} data-testid="tb-call-vote1">🗳️ Call the vote: “{st.region ? 'Weekend, where to stay and courses' : 'Where and when?'}”</button>
      )}
      </>}
      {v1 && <VoteLink planId={planId} title={v1.title} />}
    </>
  );

  // ------------------------------------------------------------------ 2. stay areas & course options
  const suggestions = st.region ? TB.suggestStays(st.region, areas, lib || Object.values(courseMap), 30).slice(0, 6) : [];
  const stepCourses = (
    <>
      <span className="label">Where we stay (tap pins or suggestions, 1–3)</span>
      {suggestions.length > 0 && (
        <div className="tb-chips" data-testid="tb-stay-chips">
          <span className="small muted" style={{ alignSelf: 'center' }}>Stay near:</span>
          {[...suggestions, ...pins].map((s) => {
            const k = s.key || s.name;
            return <button key={k} type="button" className={`chip${pi.isHot(`s:${k}`) ? ' pm-row-hot' : ''}`} {...pi.row(`s:${k}`)} aria-pressed={stays.some((x) => x.key === k)} disabled={!org} onClick={() => toggleStay({ key: k, name: s.name, lat: s.lat, lng: s.lng })}>{s.name}{ptsBadge(`stay:${k}`)}</button>;
          })}
        </div>
      )}
      {org && (addPin === null
        ? <button type="button" className="btn ghost sm" onClick={() => setAddPin('tap')}>+ Add your own place (tap the map)</button>
        : addPin === 'tap' ? <span className="small" style={{ fontWeight: 700 }}>Tap the map where you’d stay… <button type="button" className="btn ghost sm" onClick={() => setAddPin(null)}>Cancel</button></span>
          : (
            <div className="row" style={{ gap: 6 }}>
              <input className="input grow" value={pinName} maxLength={40} onChange={(e) => setPinName(e.target.value)} placeholder="Name it, e.g. Callala Beach" aria-label="Place name" />
              <button type="button" className="btn sm" disabled={pinName.trim().length < 2} onClick={() => {
                const p = { key: `pin:${Date.now()}`, name: pinName.trim(), lat: Math.round(addPin.lat * 100) / 100, lng: Math.round(addPin.lng * 100) / 100, custom: true };
                patch({ pins: [...pins, p], stays: stays.length < TB.MAX_STAYS ? [...stays, p] : stays });
                setAddPin(null);
              }}>Add</button>
            </div>
          ))}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="field grow"><span>Stay days: up to {st.stayMax} min from where we stay</span>
          <input type="range" min="0" max={STAY_LIMITS.length - 1} value={Math.max(0, STAY_LIMITS.indexOf(st.stayMax))} disabled={!org}
            onChange={(e) => patch({ stayMax: STAY_LIMITS[Number(e.target.value)] })} aria-label="Stay day drive" />
        </label>
      </div>
      <div className="tb-chips">{FILTERS.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={!!filters[k]} onClick={() => setFilters({ ...filters, [k]: !filters[k] })}>{l}</button>)}</div>
      {!stays.length && <span className="small muted">Pick where you’ll stay first — then each day’s courses show up.</span>}
      {stays.length > 0 && days.map((d) => (
        <DayCard key={d.index} d={d} active={focusDay.index === d.index} onFocus={() => setFocus(d.index)} dates={weekendDates(d.index)}
          cands={focusDay.index === d.index ? cands : []} courseMap={courseMap} info={st.info || {}} org={org} booking={booking} history={history} research={research}
          votes={TB.dayVotes(points, d.index)} onToggle={(c) => toggleOption(d, c)} onOpen={(id) => setOpen({ id, day: d })} pi={pi} />
      ))}
      {org && votesOn && st.region && !st.votes?.v1 && (
        <button type="button" className="btn gold block" disabled={busy} onClick={vote1} data-testid="tb-vote1">🗳️ Call the vote (one vote card)</button>
      )}
      {v1 && <VoteLink planId={planId} title={v1.title} />}
    </>
  );

  // ------------------------------------------------------------------ 3. call the courses
  const callList = TB.callJobs({ days, weekends: st.weekends, courses: courseMap, needed: need.needed || 1, origin, stays, booking });
  // Every day of every weekend still in play (080): the call covers them all, so the best day can be picked later.
  const callDates = windowDates(st.weekends);
  const stepCalls = (
    <>
      <div className="row between" style={{ gap: 8 }} data-testid="tb-needed">
        <span><strong>{need.needed} tee time{need.needed === 1 ? '' : 's'} in a row</strong> <span className="small muted">for {need.people || '?'} {need.source === 'in' ? 'in' : need.source === 'keen' ? 'keen' : need.source === 'set' ? '(set)' : ''}</span></span>
        {org && <input className="input" style={{ width: 90 }} type="number" min="1" max="200" inputMode="numeric" value={st.headcount ?? ''} placeholder={String(need.people || '')}
          onChange={(e) => patch({ headcount: e.target.value === '' ? null : Math.max(1, Math.min(200, Number(e.target.value))) })} aria-label="How many playing" />}
      </div>
      {org && <button type="button" className="btn gold block" disabled={busy || !callList.length} onClick={makeCalls} data-testid="tb-make-calls">📞 Make the “Call the course” jobs ({callList.length})</button>}
      {callList.length > 0 && <CallsWho items={pd.items} callJobIds={Object.values(callJobIds)} org={org} reload={pd.reload} />}
      {callList.length > 0 && <TeeGridTable courses={callList} dates={callDates} rows={tees} need={need.needed || 1} />}
      {callList.map((j) => {
        const job = jobs.find((x) => x.id === callJobIds[j.course_id]);
        const mine = job && job.owner_id && job.owner_id === me;
        return (
          <CourseCall key={j.course_id} planId={planId} courseId={j.course_id} name={j.name} job={job} dates={callDates} need={need.needed || 1}
            rows={tees.filter((t) => t.course_id === j.course_id)} social={social[j.course_id] || null} canEdit={org || mine} me={me}
            groupName={status.group_name || 'our golf group'} booking={booking[j.course_id]} research={research[j.course_id]} onSaved={() => { loadTees(); loadSocial(); pd.reload(); }}
            owner={job && <JobOwner job={job} org={org} reload={pd.reload} />} />
        );
      })}
      {org && tees.length > 0 && <BestPerDay rows={tees} dates={callDates} needed={need.needed || 1} courses={courseMap} />}
      {!org && !callList.length && <span className="small muted">No courses to call yet.</span>}
    </>
  );

  // ------------------------------------------------------------------ 4. pick the trip
  const v2poll = v2 && pd.polls.find((p) => p.vote_batch === v2.id && p.question === 'Which trip?');
  const v2win = v2poll?.winner_option_id && st.optionKeys?.[v2poll.winner_option_id];
  const shownConfigs = (st.picked && st.configs?.length ? st.configs : configs);
  const stepConfigs = (
    <>
      {st.picked && <div className="card pad" style={{ borderColor: 'var(--navy)', borderWidth: 2 }} data-testid="tb-picked"><strong>✅ Picked</strong><div className="small">{st.pickedText}</div></div>}
      {st.picked && org && <TripSetupCard plan={plan} reload={pd.reload} />}
      {!shownConfigs.length && <span className="small muted">No trip works yet — every day needs a course with {need.needed} tee times in a row that fits the drive. Add tee times, or more options.</span>}
      <div className="card" data-testid="tb-configs" style={{ overflow: 'hidden' }}>
        {shownConfigs.slice(0, 5).map((c, i) => (
          <div key={c.key} className="tb-config" data-testid="tb-config">
            <div className="row between" style={{ gap: 8 }}>
              <strong>{i + 1}. {TB.weekendLabel(c.weekend)}</strong>
              <span className="small muted">{points[`config:${c.key}`] ? `${points[`config:${c.key}`]} vote pts · ` : ''}{c.gaps ? `${c.gaps} day${c.gaps === 1 ? '' : 's'} without golf · ` : ''}about {c.totalDrive} min driving</span>
            </div>
            <div className="small" data-testid="tb-config-text">{c.text}</div>
            {org && st.picked !== c.key && <button type="button" className="btn sm" style={{ marginTop: 6 }} disabled={busy} onClick={() => pick(c)}>{v2win === `config:${c.key}` ? 'Use the winner' : 'Pick this one'}</button>}
          </div>
        ))}
      </div>
      {org && votesOn && !v2 && !st.picked && configs.length >= 2 && (
        <button type="button" className="btn gold block" disabled={busy} onClick={() => vote2(configs.slice(0, 5))}>🗳️ Call the vote: “Which trip?”</button>
      )}
      {v2 && <VoteLink planId={planId} title={v2.title} />}
    </>
  );

  const bodies = { area: stepArea, courses: stepCourses, calls: stepCalls, configs: stepConfigs };
  const summaries = {
    area: [st.region || (st.regionOptions.length ? `${st.regionOptions.join(' or ')}?` : null), st.weekends.map((w) => TB.weekendLabel(w)).join(' / ')].filter(Boolean).join(' · '),
    courses: stays.length ? `Stay ${stays.map((s) => s.name).join(' / ')} · ${days.filter((d) => d.options.length).length} of ${days.length} days with options` : null,
    calls: st.callsMade ? `${tees.filter((t) => slotsFor(t).length).length} sets of tee times in` : null,
    configs: st.pickedText || (configs.length ? `${configs.length} trip${configs.length === 1 ? '' : 's'} that work` : null),
  };

  return (
    <div className="page tb-wide">
      <Header back="Trip" title="Build the trip" sub={plan.name} />
      <div className="section stack">
        <div className="tb-steps" role="list" aria-label="Steps">
          {steps.map((s) => (
            <button key={s.key} type="button" role="listitem" className={`tb-step${s.done ? ' done' : ''}${s.locked ? ' locked' : ''}`} aria-current={current === s.key ? 'step' : undefined} onClick={() => setStep(s.key)}>
              {s.locked ? '🔒' : s.done ? '✓' : s.n} {s.label}
            </button>
          ))}
        </div>
        {!org && <div className="small muted">The organiser builds the trip here; you vote on the trip’s page{jobs.some((j) => j.owner_id === me && Object.values(callJobIds).includes(j.id)) ? ' — and put in the tee times for your call below' : ''}.</div>}
        <div className={`tb-layout${current === 'area' ? ' single' : ''}`}>
          <div className="tb-side">
            {current !== 'area' && map}
            {current !== 'area' && <div className="small muted" style={{ marginTop: 4 }}>🏠 = a place to stay. Dots are courses: green = on the list for {focusDay.name.replace(/ —.*/, '')}, red = most votes, yellow = others nearby. Drive times are rough.</div>}
          </div>
          <div className="stack">
            {steps.map((s) => stepBox(s, bodies[s.key], summaries[s.key]))}
          </div>
        </div>
      </div>
      {calling && (
        <CallVoteSheet plan={plan} title={calling.title} range={calling.range} keenDefault={calling.keen} keenOption={calling.keen}
          doCall={(ballot, { closes, keen }) => callBatch({ plan, me, title: calling.title, sections: ballot.sections, keen, closes })}
          onCalled={called} onClose={() => setCalling(null)} />
      )}
      {open && (() => {
        // From a day's row: that day. From the map or a summary card: the day being built.
        const oday = days.find((d) => d.index === (open.day || focusDay)?.index) || focusDay;
        const isOption = oday.options.includes(open.id);
        const dayName = oday.name.replace(/ —.*/, '');
        return (
          <CourseSheet id={open.id} course={courseMap[open.id]} booking={booking[open.id]} research={research[open.id] || hotResearch[open.id]} social={social[open.id]}
            history={history(open.id)} org={org} aiOn={aiOn}
            drive={courseMap[open.id] && stays.length ? TB.legDrive(oday.leg, courseMap[open.id], { origin, stays }).text : null}
            toggle={org && current !== 'area' ? { label: isOption ? `Remove from ${dayName}` : `Add to ${dayName}`, onClick: () => { toggleOption(oday, courseMap[open.id]); setOpen(null); } } : null}
            onClose={() => setOpen(null)} onSaved={loadBooking} />
        );
      })()}
      {staySheet && (() => {
        const s = [...mapStays, ...stayChoices].find((x) => (x.key || x.name) === staySheet);
        if (!s) return null;
        const on = stays.some((x) => x.key === s.key);
        return (
          <StaySheet stay={{ ...s, on }} courses={mapCourses} ideas={accom.filter((a) => !a.area || a.area === st.region)} people={need.people || 0} stayMax={st.stayMax}
            toggle={org && st.region ? { label: on ? `Don’t stay at ${s.name}` : `Stay at ${s.name}`, onClick: () => { toggleStay(s); setStaySheet(null); } } : null}
            onCourse={(id) => { setStaySheet(null); setOpen({ id, day: null }); }} onClose={() => setStaySheet(null)} />
        );
      })()}
      <RowTip anchor={pi.rowAnchor} tip={pi.rowAnchor ? tipForKey(pi.hot.hot) : null} passive={pi.hot.via === 'hover'} onMore={() => pi.open(pi.hot.hot)} onEnter={pi.hot.hold} onLeave={pi.hot.release} />
    </div>
  );
}

function VoteLink({ planId, title }) {
  return <Link to={`/plan/${planId}?tab=vote`} className="btn ghost block" data-testid="tb-vote-link">🗳️ “{title}” is up — see the votes</Link>;
}

// ---------------------------------------------------------------- one day: its options and suggestions
function DayCard({ d, active, onFocus, dates, cands, courseMap, info, org, booking, history, votes, onToggle, onOpen, research = {}, pi }) {
  return (
    <div className="card" data-testid="tb-day" data-leg={d.leg} style={{ overflow: 'hidden', borderColor: active ? 'var(--navy)' : undefined }}>
      <button type="button" onClick={onFocus} className="row between" style={{ width: '100%', padding: '10px 12px', background: active ? 'var(--gold-soft)' : 'none', border: 0, textAlign: 'left', color: 'inherit', font: 'inherit' }}>
        <span><strong>{LEG_ICON[d.leg]} {d.name}</strong>{dates && <div className="small muted">{dates}</div>}</span>
        <span className="small muted">{d.options.length ? `${d.options.length} option${d.options.length === 1 ? '' : 's'}` : 'No golf yet'}</span>
      </button>
      {d.options.map((id) => {
        const c = courseMap[id];
        if (!c) return null;
        const b = booking[id];
        return (
          <div key={id} className={`tb-course${pi?.isHot(`c:${id}`) ? ' pm-row-hot' : ''}`} data-testid="tb-option" {...(pi ? pi.row(`c:${id}`) : {})}>
            <div style={{ minWidth: 0 }}>
              <button type="button" className="name" onClick={(e) => (pi ? pi.tapRow(`c:${id}`, e.currentTarget.closest('[data-place]'), () => onOpen(id)) : onOpen(id))}>{c.name}</button>
              {votes[id] > 0 && <span className="tb-chip-pts">{votes[id]} pts</span>}
              <div className="small" data-testid="tb-option-drive">{info[`${d.index}:${id}`] || ''}</div>
              <div className="small muted" data-testid="tb-known">{TB.shortKnown(c, history(id))}{b?.phone ? ` · 📞 ${b.phone}` : b?.booking_url ? ' · books online' : ''}{b?.features?.length ? ` · ${b.features.slice(0, 3).join(', ')}` : ''}</div>
              {research[id] && shortFacts(research[id]) && <div className="small" data-testid="tb-facts">{shortFacts(research[id])}</div>}
            </div>
            {org && <button type="button" className="btn ghost sm" aria-label={`Remove ${c.name}`} onClick={() => onToggle(c)}>✕</button>}
          </div>
        );
      })}
      {active && org && (
        <div style={{ padding: '8px 12px' }}>
          <div className="small muted" style={{ marginBottom: 6 }}>{d.leg === 'stay' ? 'Suggestions near where you stay' : d.leg === 'way' ? 'Suggestions on the way there' : 'Suggestions on the way home'} — tap to add (or tap a pin):</div>
          <div className="tb-chips" data-testid="tb-suggestions">
            {cands.filter((c) => !d.options.includes(c.course.id)).slice(0, 6).map((c) => (
              <button key={c.course.id} type="button" className={`chip${pi?.isHot(`c:${c.course.id}`) ? ' pm-row-hot' : ''}`} {...(pi ? pi.row(`c:${c.course.id}`) : {})} onClick={() => { pi?.hot.clear(); onToggle(c.course); }} title={c.why.join(', ')}>
                + {c.course.name} <span className="small muted">· {c.drive.text}</span>
              </button>
            ))}
            {!cands.length && <span className="small muted">Nothing in range — try a longer drive or another place to stay.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- who's making the call
function JobOwner({ job, org, reload }) {
  const data = useData();
  const [busy, run] = useRun();
  const owner = data.playersById[job.owner_id];
  if (!org) return <span className="small muted">On it: {owner ? playerName(owner) : 'nobody yet'}</span>;
  return (
    <label className="row small" style={{ gap: 6 }}>On it:
      <select className="select" style={{ maxWidth: 200 }} value={job.owner_id || ''} disabled={busy} aria-label="Who calls"
        onChange={(e) => run(async () => {
          await must(supabase.from('plan_items').update({ owner_id: e.target.value || null }).eq('id', job.id));
          if (e.target.value) notify('job_assigned', { item_id: job.id }).catch(() => {});
          reload();
        }, 'Handed out')}>
        <option value="">Nobody yet</option>
        {data.players.filter((p) => p.approved !== false).map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
      </select>
    </label>
  );
}
