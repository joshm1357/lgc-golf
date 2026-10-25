// The day plan (ov40, Josh 25 Oct 2026): rough timing for each trip day, in colours, that people can comment on.
// COLLECT (each person's wishes: plan_wishes from the trip idea, and notes on a day) → SHAPE (this: when you'd leave,
// which course times fit, dusk) → DECIDE (the organiser picks a course and a time per day; it goes into the trip
// builder's days, still "about").
// Everyone on the trip sees it and can add a note to a day; organisers (and co-organisers) change the days and pick.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession, useData, useRealtime, playerName } from '../lib/store.jsx';
import { Header, Loading, Seg, toast, askConfirm, Avatar } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify } from '../lib/push.js';
import { usePlanData } from './Planner.jsx';
import { useSocialTimes } from '../components/TeeCalls.jsx';
import { useCourseResearch } from '../components/CourseResearch.jsx';
import DayTimeline from '../components/DayTimeline.jsx';
import * as TB from '../lib/tripbuilder.js';
import { pickFacts } from '../lib/tripfinder.js';
import { PREFS, hm, dur, FLY_DEFAULTS, prefsLine, duskFlag, anyClock } from '../lib/daytiming.js';
import { cleanWishes, peopleFor, wishesSummary } from '../lib/tripfit.js';
import { planDays, startPoints, snapStarts, buildDay, applyPick, setDay, pickLine, travelOf, dayFormat, applyGolfAmount, scheduleLine, suggestPlan, applySuggestion, cardLine } from '../lib/dayplan.js';

const GOLF_OPTS = TB.GOLF_CHOICES.map((g) => ({ value: g.value, label: g.value === 'none' ? 'None' : g.value === '36' ? '36' : g.value }));
const FORMAT_OPTS = [{ value: 'stableford', label: 'Stableford' }, { value: 'ambrose', label: 'Ambrose' }];

export default function DayPlan() {
  const { planId } = useParams();
  const [params, setParams] = useSearchParams();
  const { status } = useSession();
  const data = useData();
  const pd = usePlanData(planId);
  const org = !!status.is_admin && !status.viewing;
  const me = status.player_id;
  const [row, setRow] = useState(undefined);
  const [lib, setLib] = useState([]);
  const [booking, setBooking] = useState({});
  const [starts, setStarts] = useState(null);
  const [wishRows, setWishRows] = useState([]);
  const [busy, run] = useRun();

  const loadBuild = useCallback(async () => {
    const { data: b } = await supabase.from('trip_builds').select('*').eq('plan_id', planId).maybeSingle();
    setRow(b || null);
  }, [planId]);
  useEffect(() => { loadBuild(); }, [loadBuild]);
  useRealtime(['trip_builds'], loadBuild);
  // ov39's wishes (108). Read defensively: the table may not be there yet.
  const loadWishes = useCallback(async () => {
    try {
      const { data: w, error } = await supabase.from('plan_wishes').select('*').eq('plan_id', planId);
      setWishRows(error ? [] : w || []);
    } catch { setWishRows([]); }
  }, [planId]);
  useEffect(() => { loadWishes(); }, [loadWishes]);
  // Starting points are organisers-only (063); the organiser's view keeps a rounded snapshot in the plan for everyone.
  useEffect(() => {
    if (!org) { setStarts([]); return; }
    supabase.from('trip_start_points').select('*').eq('plan_id', planId).order('sort')
      .then(({ data: sp }) => setStarts((sp || []).map((r) => ({ label: r.label, lat: r.lat, lng: r.lng, headcount: r.headcount, leave_after: r.leave_after }))), () => setStarts([]));
  }, [org, planId]);

  const plan = pd?.plan;
  const st = useMemo(() => (plan ? { ...TB.newState(plan), ...(row?.state || {}) } : null), [plan, row]);
  const save = useCallback(async (next) => {
    setRow((r) => ({ ...(r || {}), state: next }));
    const { error } = await supabase.from('trip_builds').upsert({ plan_id: planId, state: next }, { onConflict: 'plan_id' });
    if (error) toast('Couldn’t save that — try again');
  }, [planId]);
  // Keep the starting points' snapshot up to date (organisers), so players see the same drive times.
  useEffect(() => {
    if (!org || !st || !row || !starts?.length) return;
    const snap = snapStarts(starts);
    if (JSON.stringify(snap) !== JSON.stringify(st.dayPlan?.starts || [])) save({ ...st, dayPlan: { ...(st.dayPlan || {}), starts: snap } });
  }, [org, starts, row, !!st]); // eslint-disable-line react-hooks/exhaustive-deps

  const stays = st?.stays || [];
  // The area's courses (organisers load the library around where we stay; players see the ones saved on the trip).
  useEffect(() => {
    if (!org || !stays.length) return;
    const box = TB.boxAround(stays, 60);
    supabase.rpc('trip_finder_courses', { p_south: box.south, p_west: box.west, p_north: box.north, p_east: box.east, p_lat: box.lat, p_lng: box.lng, p_limit: 200 })
      .then(({ data: rows }) => setLib(Array.isArray(rows) ? rows : []), () => setLib([]));
  }, [org, stays.map((s) => s.key).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const courseMap = useMemo(() => {
    const m = {};
    for (const c of Object.values(st?.courses || {})) m[c.id] = c;
    for (const c of lib) m[c.id] = { ...c, facts: pickFacts(c.facts) };
    return m;
  }, [st?.courses, lib]);
  const days = useMemo(() => (st ? planDays(st) : []), [st]);
  const ids = useMemo(() => [...new Set([...days.flatMap((d) => d.options), ...((st?.areaCourses || {})[st?.region] || [])])], [days, st?.areaCourses, st?.region]);
  const idKey = ids.join(',');
  useEffect(() => {
    if (!ids.length) return;
    supabase.from('course_booking_info').select('course_id,visitor_times,member_times,booking_method,phone,booking_url,email,max_group,features').in('course_id', ids)
      .then(({ data: b }) => setBooking(Object.fromEntries((b || []).map((x) => [x.course_id, x]))), () => {});
  }, [idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [social] = useSocialTimes(ids);
  const research = useCourseResearch(ids);
  const history = useCallback((id) => TB.playedHistory(id, { courses: data.courses, rounds: data.rounds, trips: data.trips, honour: data.honour_board }), [data]);

  if (!pd || !st || row === undefined) return <div className="page"><Header back="Plan the trip" title="Day plan" /><Loading /></div>;
  if (!plan) return <div className="page"><Header back="Trips" title="Day plan" /><div className="empty">This trip has been removed.</div></div>;

  const nameOf = (id) => (data.playersById[id] ? playerName(data.playersById[id]) : 'Someone');
  const wishes = cleanWishes(wishRows);
  const people = peopleFor({ rsvps: pd.rsvps, wishes, players: data.players, nameOf });
  const need = TB.teeTimesNeeded({ rsvps: pd.rsvps, override: st.headcount, overrideBy: st.headcountBy, players: data.players || [] });
  const sp = startPoints(st, null);
  const pickIndex = Math.max(0, Math.min(days.length - 1, Number(params.get('day')) || 0));
  const day = days[pickIndex];
  const dayComments = (pd.comments || []).filter((c) => c.day_date);
  const dayCtx = { st, courseMap, booking, social, research, history, starts: sp, stays, comments: dayComments, wishes, people, nameOf, players: need.people || people.length || 4 };
  // The suggested plan: every day's best-fitting course and time at once (the organiser's starting point).
  const suggestion = days.length && stays.length ? suggestPlan(days, dayCtx) : null;
  const sugDay = suggestion?.days.find((x) => x.index === day?.index && x.course_id);
  const built = day ? buildDay(day, { ...dayCtx, suggest: sugDay ? { course_id: sugDay.course_id, tee: sugDay.tee } : null }) : null;
  const travel = travelOf(st);
  const pick = st.dayPlan?.picks?.[day?.index];
  const noDates = !st.weekends?.length;

  const setTravel = (patch) => save({ ...st, dayPlan: { ...(st.dayPlan || {}), travel: { ...travel, ...patch } } });
  const setFly = (k, v) => setTravel({ fly: { ...travel.fly, [k]: v === '' ? null : Math.max(0, Math.min(1440, Math.round(Number(v) || 0))) } });
  const changeDay = (patch) => save(setDay(st, day, patch));
  const setFormat = (f) => save({ ...st, dayPlan: { ...(st.dayPlan || {}), formats: { ...(st.dayPlan?.formats || {}), [day.index]: f } } });
  const doPick = (rowC, slot) => run(async () => {
    const course = courseMap[rowC.id] || { id: rowC.id, name: rowC.name };
    const tee = slot ? `${String(Math.floor(slot.tee / 60)).padStart(2, '0')}:${String(slot.tee % 60).padStart(2, '0')}` : null;
    const r = applyPick(st, day, { course, tee });
    if (r.full) { toast(`${day.name} already has ${TB.MAX_OPTIONS_PER_DAY} courses — take one off in Plan the trip first`); return; }
    await save(r.state);
    return `Picked for ${day.name}: ${course.name}${tee ? `, about ${hm(slot.tee)}` : ''}`;
  }).then((m) => m && toast(m));
  const clearPick = () => run(async () => { await save(applyPick(st, day, { course: null }).state); });
  const useSuggestion = () => run(async () => {
    const r = applySuggestion(st, suggestion, { courseMap });
    await save(r.state);
    return r.full.length ? `Picked — but ${r.full.join(', ')} already had ${TB.MAX_OPTIONS_PER_DAY} courses; change those days by hand` : 'Picked for every day — still “about”. Change any day below.';
  }).then((m) => m && toast(m));
  const goDay = (i) => setParams((p) => { const n = new URLSearchParams(p); n.set('day', String(i)); return n; }, { replace: true });
  const allPicked = suggestion && suggestion.days.filter((x) => x.course_id).every((x) => { const p = st.dayPlan?.picks?.[x.index]; return p && p.course_id === x.course_id && p.tee === x.tee; });

  return (
    <div className="page dp-wide">
      <Header back="Plan the trip" title="Day plan" sub={plan.name} />
      <div className="section stack" style={{ gap: 12, paddingBottom: 40 }} data-testid="day-plan">
        <div className="small muted">Rough timing for each day — when you’d leave, which course times fit, and dusk. Every time is <strong>about</strong>: it’s for talking it through, not a booking.</div>
        {suggestion && (
          <div className="card pad stack" style={{ gap: 6, borderColor: 'var(--navy)', borderWidth: 2 }} data-testid="dp-suggested">
            <span className="small muted" style={{ fontWeight: 800 }}>SUGGESTED PLAN — ROUGHLY</span>
            {suggestion.days.map((x) => {
              const i = days.findIndex((d) => d.index === x.index);
              return (
                <div key={x.index} className="row between small" style={{ gap: 8, alignItems: 'flex-start' }} data-testid="dp-suggested-day">
                  <span>{x.line}</span>
                  <button type="button" className="small" style={{ border: 0, background: 'none', padding: 0, color: 'var(--navy)', textDecoration: 'underline', whiteSpace: 'nowrap' }} onClick={() => goDay(i)} data-testid="dp-change-day">Change {x.day}</button>
                </div>
              );
            })}
            {suggestion.notFor.length > 0 && <span className="small" data-testid="dp-suggested-notfor">{org ? `Doesn’t suit: ${suggestion.notFor.map((n) => `${n.name} (${n.why.join('; ')})`).join(', ')}` : `Doesn’t suit ${suggestion.notFor.length} of ${people.length}`}</span>}
            {suggestion.notFor.length === 0 && people.length > 0 && <span className="small">Suits everyone who’s said what they’d like.</span>}
            {org && (allPicked
              ? <span className="small" style={{ fontWeight: 700 }} data-testid="dp-plan-used">✅ This is the plan — still “about”. Change any day below.</span>
              : <button type="button" className="btn gold block" disabled={busy || !suggestion.days.some((x) => x.course_id)} onClick={useSuggestion} data-testid="dp-use-plan">Use this plan</button>)}
          </div>
        )}
        {wishes.length > 0 && <div className="card pad small" data-testid="dp-wishes"><strong>What the group said:</strong> {wishesSummary(wishes, people)}</div>}
        {noDates && <div className="card pad small">No dates yet — times use the first weekend on the shortlist once there is one. <Link to={`/plan/${planId}/build`}>Plan the trip</Link></div>}

        {/* ---------------- how much golf (the group's answer is the default) */}
        <div className="card pad stack" style={{ gap: 8 }} data-testid="dp-golf-amount">
          <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <strong>How much golf</strong>
            {!org && <span className="small">{TB.GOLF_AMOUNTS.find((g) => g.value === (st.golfAmount || TB.golfAmountFromWishes(wishes)))?.label}</span>}
          </div>
          {org && <Seg light options={TB.GOLF_AMOUNTS} value={st.golfAmount || TB.golfAmountFromWishes(wishes)} onChange={(v) => run(async () => { await save(applyGolfAmount(st, v, { players: need.people || 8 })); }, 'Each day’s golf is set — change any day below')} />}
          {org && !st.golfAmount && wishes.some((w) => w.golf_per_day) && <span className="small muted">The group mostly said “{TB.GOLF_AMOUNTS.find((g) => g.value === TB.golfAmountFromWishes(wishes))?.label.toLowerCase()}”. Tap one to set every day from it.</span>}
          <span className="small" data-testid="dp-schedule-line">{days.map((d) => `${d.date ? TB.dayLabel(d.date).split(' ')[0] : d.name} ${d.golf === 'none' ? 'no golf' : `${d.golf} holes`}`).join(' · ')}</span>
          <span className="small muted" data-testid="dp-schedule-fit">{scheduleLine(st, { people, wishes, nameOf, names: org })}</span>
        </div>

        {/* ---------------- how we get there */}
        <div className="card pad stack" style={{ gap: 8 }} data-testid="dp-travel">
          <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <strong>Getting there</strong>
            {org ? <Seg light options={[{ value: 'drive', label: '🚗 Drive' }, { value: 'fly', label: '✈️ Fly' }]} value={travel.mode} onChange={(m) => setTravel({ mode: m })} />
              : <span className="small">{travel.mode === 'fly' ? '✈️ Flying' : '🚗 Driving'}</span>}
          </div>
          <span className="small muted" data-testid="dp-starts">{sp.length ? `From ${sp.map((s) => `${s.label}${s.count ? ` ×${s.count}` : ''}`).join(', ')}` : 'Where people come from isn’t set yet (the organiser adds starting points in the trip finder).'}{sp.length && stays.length ? ` · about ${dur(Math.max(...sp.map((s) => TB.driveBetween(s, TB.boxAround(stays, 0)))))} drive to ${stays[0].name}` : ''}</span>
          {travel.mode === 'fly' && (
            <div className="dp-facts" data-testid="dp-fly">
              {[['toAirportMin', 'Drive to the airport'], ['checkInMin', 'Check in and wait'], ['flightMin', 'Flight (a guess)'], ['pickupMin', 'Bags and hire car'], ['fromAirportMin', 'Airport to where we stay']].map(([k, l]) => (
                <label key={k} className="field" style={{ margin: 0 }}><span className="small">{l} (min)</span>
                  <input className="input" type="number" inputMode="numeric" min="0" max="900" disabled={!org} value={travel.fly[k] ?? FLY_DEFAULTS[k]} onChange={(e) => setFly(k, e.target.value)} aria-label={l} data-testid={`fly-${k}`} />
                </label>
              ))}
            </div>
          )}
        </div>

        {/* ---------------- the days */}
        <div className="dp-days" role="tablist" aria-label="Days">
          {days.map((d, i) => (
            <button key={d.index} type="button" role="tab" className="chip" aria-pressed={i === pickIndex} aria-selected={i === pickIndex} data-testid="dp-day-tab"
              onClick={() => goDay(i)}>
              <span>{d.date ? TB.dayLabel(d.date) : d.name}</span><small>{d.role}</small>
            </button>
          ))}
        </div>

        {day && built && (
          <div className="dp-layout">
            <div className="stack" style={{ gap: 12 }}>
              <div className="card pad stack" style={{ gap: 10 }} data-testid="dp-day">
                <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <strong>{day.name}{day.date ? ` · ${TB.dayLabel(day.date)}` : ''}</strong>
                  <span className="small muted" data-testid="dp-role">{day.role}</span>
                </div>
                {org && (
                  <div className="stack" style={{ gap: 6 }} data-testid="dp-day-controls">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><span className="small" style={{ fontWeight: 700 }}>Golf</span>
                      <Seg light options={GOLF_OPTS} value={day.golf} onChange={(g) => changeDay({ golf: g })} /></div>
                    {day.slot !== 'stay' && (
                      <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={day.leg !== 'stay'} onChange={(e) => changeDay({ travel: e.target.checked ? true : false })} style={{ width: 20, height: 20 }} data-testid="dp-travel-day" />
                        {day.slot === 'way' ? 'Travel day — golf on the way there' : 'Travel day — golf on the way home'}</label>
                    )}
                    {day.golf !== 'none' && <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><span className="small" style={{ fontWeight: 700 }}>Format</span>
                      <Seg light options={FORMAT_OPTS} value={dayFormat(st, day)} onChange={setFormat} /></div>}
                  </div>
                )}
                <div className="dp-legend" aria-hidden="true"><span><i className="dt-dot dt-travel" /> travel</span><span><i className="dt-dot dt-golf" /> golf</span><span><i className="dt-dot dt-free" /> free</span><span><i className="dt-dot dt-evening" /> dinner / evening</span><span><i className="dt-dot dt-sun" /> daylight</span></div>
                <DayTimeline blocks={built.plan.blocks} sun={built.plan.sun} prefs={built.prefs} />
                {(() => {
                  // A picked time that runs past dusk, or a 36-hole day with no daylight for it, says so plainly.
                  const t = pick?.tee ? anyClock(pick.tee) : null;
                  const sunset = built.plan.sun?.sunset;
                  const f = t != null && sunset != null ? duskFlag(t + built.golf.total, sunset, { latestTee: sunset - built.golf.total }) : null;
                  const no36 = day.golf === '36' && built.rows.length > 0 && built.rows.every((r) => !r.slots.length);
                  return (
                    <>
                      {f && f.tone !== 'ok' && <div className="small" style={{ color: 'var(--down)', fontWeight: 700 }} data-testid="dp-pick-flag">⚠️ The picked time {f.text}.</div>}
                      {no36 && <div className="small" style={{ color: 'var(--down)', fontWeight: 700 }} data-testid="dp-36-flag">⚠️ 36 holes doesn’t fit the daylight on {TB.dayLabel(day.date)} — about {dur(built.golf.total)} of golf, and dusk is about {hm(sunset)}. Try 18 holes.</div>}
                    </>
                  );
                })()}
                {pick && <div className="small" data-testid="dp-picked">✅ <strong>Picked:</strong> {pickLine(pick, courseMap, built.golf.total)}{org && <> · <button type="button" className="small" style={{ border: 0, background: 'none', padding: 0, textDecoration: 'underline', color: 'var(--navy)' }} onClick={clearPick}>clear</button></>}</div>}
                {built.prefs.length > 0 && <div className="small" data-testid="dp-prefs-line">💬 {prefsLine(built.prefs)}</div>}
                <span className="small muted">{built.golf.two ? `36 holes: two rounds and about 45 min for lunch` : `${day.golf === '9' ? '9 holes' : dayFormat(st, day) === 'ambrose' ? 'Ambrose, about 4 h a group (the usual — unconfirmed)' : 'Stableford, about 4 h 30 a 4-ball (the usual — unconfirmed)'}`}{built.golf.groups > 1 ? `, ${built.golf.groups} groups ${built.golf.interval} min apart` : ''} — about {dur(built.golf.total)} from the first tee to the last group in.</span>
              </div>

              {built.suggested && sugDay && <div className="small muted" data-testid="dp-suggested-note">The timeline shows the suggested time ({sugDay.name}, about {hm(sugDay.teeMin)}) until one’s picked.</div>}
              {day.golf !== 'none' && <Compare key={day.index} built={built} day={day} org={org} busy={busy} pick={pick} onPick={doPick} planId={planId} of={people.length} />}
              {travel.mode === 'fly' && <span className="small muted">✈️ Flight times are about: first flights out about 6am, last back about 9pm — check the airline.</span>}
              {day.golf === 'none' && <div className="small muted">No golf this day.</div>}
            </div>
            <DayNotes pd={pd} day={day} me={me} org={org} nameOf={nameOf} />
          </div>
        )}
        {!days.length && <div className="empty">No days yet.</div>}
      </div>
    </div>
  );
}

/** The course comparison for a day: side by side on a laptop, one card each on a phone. */
function Compare({ built, day, org, busy, pick, onPick, planId, of = 0 }) {
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const allRows = built.rows;
  const rows = more ? allRows : allRows.slice(0, 3);
  const toggle = (id) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (!allRows.length) return <div className="card pad small muted" data-testid="dp-compare-empty">No courses for {day.name} yet. <Link to={`/plan/${planId}/build`}>Add some in Plan the trip</Link>.</div>;
  const slotChips = (r) => (
    <div className="dp-slots">
      {r.slots.slice(0, 8).map((s) => (
        <button key={s.tee} type="button" className={`chip${s.best ? ' best' : ''}`} disabled={!org || busy} aria-pressed={pick?.course_id === r.id && pick?.tee && Number(pick.tee.slice(0, 2)) * 60 + Number(pick.tee.slice(3)) === s.tee}
          onClick={() => onPick(r, s)} title={`Tee off ${hm(s.tee)} → finish about ${hm(s.finish)}`} data-testid="dp-slot" data-tee={s.tee}>
          {s.best ? '★ ' : ''}{hm(s.tee)}{s.flag?.tone === 'tight' ? ' ⚠️' : ''}
        </button>
      ))}
    </div>
  );
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="dp-compare">
      <div className="row between"><strong>Courses for {day.name}</strong><span className="small muted">★ = suits the most wishes</span></div>
      <div className="dp-cmp dp-cmp-cards">
        {rows.map((r) => (
          <div key={r.id} className={`dp-row${r.onDay ? ' on' : ''}${pick?.course_id === r.id ? ' picked' : ''}`} data-testid="dp-course" data-course={r.id} data-open={open.has(r.id) ? '1' : '0'}>
            <button type="button" className="dp-row-head" aria-expanded={open.has(r.id)} onClick={() => toggle(r.id)} data-testid="dp-course-line">
              <span className={r.best ? '' : 'dp-fit no'}>{cardLine(r, of)}{pick?.course_id === r.id ? ' · ✅ picked' : ''}</span>
              <span aria-hidden="true">{open.has(r.id) ? '▴' : '▾'}</span>
            </button>
            {open.has(r.id) && <>
            <div className="row between" style={{ gap: 8 }}><span className="small muted">{r.onDay ? 'on the list' : '✨ also fits'}</span></div>
            <dl className="dp-facts">
              <dt>Known</dt><dd>{r.known}</dd>
              {r.style && <><dt>Style</dt><dd>{r.style}</dd></>}
              <dt>Drive</dt><dd>{r.drive}</dd>
              {r.fee && <><dt>Green fee</dt><dd>{r.fee}</dd></>}
              <dt>Usual times</dt><dd data-testid="dp-times">{r.times}{r.guess && r.timesSource ? <span className="small muted"> ({r.timesSource})</span> : null}</dd>
              {r.maxGroup && <><dt>Group size</dt><dd>{r.maxGroup}</dd></>}
              {r.book && <><dt>Book</dt><dd>{r.bookUrl ? <a href={r.bookUrl} target="_blank" rel="noreferrer">{r.book}</a> : r.book}</dd></>}
            </dl>
            <div className={`dp-fit${r.best ? '' : ' no'}`} data-testid="dp-fit-line">{r.fitLine}</div>
            {r.bestLine && <div className="small" data-testid="dp-best-line">{r.bestLine}</div>}
            {r.notForCount > 0 && <div className="dp-notfor" data-testid="dp-notfor">{org ? r.notForLine : `Not for ${r.notForCount} of the group`}</div>}
            {r.slots.length > 0 && slotChips(r)}
            </>}
          </div>
        ))}
      </div>
      <table className="dp-table" data-testid="dp-table">
        <thead><tr><th scope="col" /> {rows.map((r) => <th key={r.id} scope="col">{r.name}{r.onDay ? '' : ' ✨'}</th>)}</tr></thead>
        <tbody>
          {[['Known', 'known'], ['Style', 'style'], ['Drive', 'drive'], ['Green fee', 'fee'], ['Usual times', 'times'], ['Group size', 'maxGroup'], ['Book', 'book']].map(([l, k]) => (
            rows.some((r) => r[k]) ? <tr key={k}><th scope="row">{l}</th>{rows.map((r) => <td key={r.id}>{r[k] || '—'}</td>)}</tr> : null
          ))}
          <tr><th scope="row">Fits</th>{rows.map((r) => <td key={r.id} className={`dp-fit${r.best ? '' : ' no'}`}>{r.fitLine}{r.notForCount > 0 ? <div className="dp-notfor">{org ? r.notForLine : `Not for ${r.notForCount} of the group`}</div> : null}</td>)}</tr>
          <tr><th scope="row">Tee times</th>{rows.map((r) => <td key={r.id}>{r.bestLine && <div className="small">{r.bestLine}</div>}{slotChips(r)}</td>)}</tr>
        </tbody>
      </table>
      {allRows.length > 3 && <button type="button" className="btn ghost sm" onClick={() => setMore(!more)} data-testid="dp-more-courses">{more ? 'Show fewer' : `Show ${allRows.length - 3} more`}</button>}

    </div>
  );
}

/** Notes on a day: anyone on the trip, with an optional simple wish the plan shows as a marker. */
function DayNotes({ pd, day, me, org, nameOf }) {
  const data = useData();
  const [text, setText] = useState('');
  const [pref, setPref] = useState(null);
  const [homeBy, setHomeBy] = useState('18:00');
  const [busy, run] = useRun();
  const date = day.date;
  const notes = (pd.comments || []).filter((c) => c.day_date && String(c.day_date).slice(0, 10) === date);
  const send = () => run(async () => {
    const body = text.trim() || (pref ? `${PREFS.find((p) => p.value === pref)?.label.replace('…', '')}${pref === 'home_by' ? ` ${hm(Number(homeBy.slice(0, 2)) * 60 + Number(homeBy.slice(3)))}` : ''} on ${TB.dayLabel(date)}` : '');
    if (!body) return;
    const c = await must(supabase.from('plan_comments').insert({ plan_id: pd.plan.id, body, day_date: date, ...(pref ? { day_pref: pref } : {}), ...(pref === 'home_by' ? { home_by: homeBy } : {}) }).select().single());
    setText(''); setPref(null);
    pd.reload();
    notify('comment_added', { comment_id: c.id }).catch(() => {});
  }, 'Added to the day');
  const when = (iso) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="dp-notes">
      <strong>Notes on {date ? TB.dayLabel(date) : day.name}</strong>
      {!date && <span className="small muted">Notes open once the trip has dates.</span>}
      {notes.length === 0 && date && <span className="small muted">Nothing yet. Say what you’d like this day — “keep the morning free, play midday”.</span>}
      {notes.map((c) => {
        const p = data.playersById[c.player_id];
        return (
          <div key={c.id} className="dp-note row" style={{ gap: 8, alignItems: 'flex-start' }} data-testid="dp-note">
            <Avatar player={p} size={28} />
            <div className="grow">
              <div className="row between small"><strong>{nameOf(c.player_id)}</strong><span className="muted">{when(c.created_at)}</span></div>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.body}</div>
              {c.day_pref && <span className="dt-wish-chip small" data-testid="dp-note-pref">{PREFS.find((x) => x.value === c.day_pref)?.label.replace('…', '')}{c.home_by ? ` ${c.home_by}` : ''}</span>}
              {(c.player_id === me || org) && (
                <button type="button" className="small" style={{ border: 0, background: 'none', padding: 0, color: 'var(--muted)', marginLeft: 8 }}
                  onClick={async () => { if (await askConfirm({ title: 'Delete this note?', yes: 'Delete it' })) run(async () => { await must(supabase.from('plan_comments').delete().eq('id', c.id)); pd.reload(); }); }}>Delete</button>
              )}
            </div>
          </div>
        );
      })}
      {me && date && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="dp-prefs" role="group" aria-label="A wish for this day">
            {PREFS.map((p) => <button key={p.value} type="button" className="chip" aria-pressed={pref === p.value} onClick={() => setPref(pref === p.value ? null : p.value)} data-testid={`dp-pref-${p.value}`}>{p.label}</button>)}
          </div>
          {pref === 'home_by' && <label className="row small" style={{ gap: 6 }}>Home by <input className="input" type="time" value={homeBy} onChange={(e) => setHomeBy(e.target.value)} style={{ width: 120 }} aria-label="Home by" /></label>}
          <textarea className="textarea" rows={2} maxLength={2000} style={{ padding: 12 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Anything about ${TB.dayLabel(date)}?`} aria-label="Note on this day" data-testid="dp-note-text" />
          <button type="button" className="btn gold" disabled={busy || (!text.trim() && !pref)} onClick={send} data-testid="dp-note-send">Add to {TB.dayLabel(date).split(' ')[0]}</button>
        </div>
      )}
    </div>
  );
}
