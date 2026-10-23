// Trip builder (077): build a trip day by day on one map — /plan/:planId/build (behind 'trip_finder').
// Josh's order: 1 Area & weekends (→ vote 1 "Where and when?") → 2 Stay areas & course options each day → 3 Call the
// courses for tee times on the settled weekend(s) → 4 Pick the trip (or vote 2 "Which trip?") → it fills the trip.
// Organisers build; players see it read-only, vote, and put in tee times for a "Call the course" job they own.
// All the maths is in src/lib/tripbuilder.js. Drive times are "about" (straight line × 1.3 at 80 km/h).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession, useData, useFeature, useRealtime, playerName } from '../lib/store.jsx';
import { Header, Loading, Seg, toast, askConfirm } from '../components/ui.jsx';
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
import { golfDates } from '../lib/teegrid.js';
import { windowDates, slotsFor } from '../lib/teegrid.js';
import { extrasSection } from '../lib/extras.js';
import { useCourseResearch } from '../components/CourseResearch.jsx';
import { shortFacts } from '../lib/courseresearch.js';
// ov23: areas bar, every weekend in the window, how long, stays in step 2, the vote's results, primary / backup.
import PinDropper, { tapToPin } from '../components/PinDropper.jsx';
import AreaBar, { useRegionGuides } from '../components/AreaBar.jsx';
import WeekendPicker, { LengthPicker } from '../components/WeekendPicker.jsx';
import StayIdeas from '../components/StayIdeas.jsx';
import AreaVoteResults from '../components/AreaVoteResults.jsx';
import { chooseAreaFromVotes, reopenArea, courseSummary, staySummary, areaSummary, regionNote } from '../lib/areavote.js';
import { tripHeadcount, settlePrimaryBackup, openUpWeekend, makePrimary, weekendRole, rolesLine, lengthSection, leadingNights, resizeWeekend, rankWeekends, weekendBallotOptions, lengthCheck } from '../lib/weekends.js';
import { detailCounts, groupBallot, votersOf } from '../lib/callvote.js';
// Walkthrough fixes (ov26, 23 Oct): telling the group (O5, I4, I5, I6), the best way to do it (O4), one step line (O1).
import { weekendStatus, fallsThrough, goWithBackup, deadOptions, goWithPost, addedBackupPost, reopenedPost, checkQuestion, resultPost, topTwoYes, callsHeroPost, coursesWords } from '../lib/tripnews.js';
import { lockInWords } from '../lib/lockin.js';
import { lockInTrip, redateTripJobs } from './TripPlan.jsx';
import OtherWays from '../components/OtherWays.jsx';
import { stagePatch, jobStage, dueWords } from '../lib/tripjobs.js';
import { icsFor } from '../lib/plan.js';
import { shareText, downloadFile, appLink } from '../lib/push.js';
import { TRIP_STEPS, areaLine, coursesLine, upToLine } from '../lib/tripsteps.js';
import { CourseSheet, StaySheet } from '../components/PlaceSheets.jsx';
import { usePlaceInfo, RowTip } from '../components/PlanMapTools.jsx';
// ov35: two votes, either order — 📅 When? and 📍 Where? (old trips with one combined vote keep the old screen).
import WhenWhere from '../components/WhenWhere.jsx';
import { CoOrganisersCard } from '../components/CoOrganisers.jsx';
import { PART_LOOK, BOTH_TITLE, isCombined, cardPolls, callChoices, splitRange, settleWhen, winnerKeys, partResultPost, whenLabel } from '../lib/votecards.js';
import { courseTip, stayTip } from '../lib/placeinfo.js';

const STAY_LIMITS = [20, 30, 40, 50, 60];
const PARTS_SHOWN = ['when', 'where'];
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
  const [areaTab, setAreaTab] = useState(null); // the area open under the areas bar ('__compare' = side by side)
  const guides = useRegionGuides();
  const [filters, setFilters] = useState({});
  const [addPin, setAddPin] = useState(null); // null | 'tap' | { lat, lng }
  const [pinName, setPinName] = useState('');
  const [busy, run] = useRun();
  const [batches] = useVoteBatches(planId);
  const [calling, setCalling] = useState(null);
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
  // O6: one headcount rule everywhere (lib/headcount.js): the target set, else who's in, else in + maybe, else the group.
  const need = TB.teeTimesNeeded({ rsvps: pd?.rsvps || [], override: st?.headcount, overrideBy: st?.headcountBy, players: data.players || [] });
  // ov23: how many are coming — the number set (organiser / plan chat), else who's in, else the group. Never made up.
  const head = tripHeadcount({ set: st?.headcount, setBy: st?.headcountBy, rsvps: pd?.rsvps || [], players: data.players || [] });
  // The courses on the table in every area (for the one-line summaries on the vote card).
  const areaResearch = useCourseResearch(Object.values(st?.areaCourses || {}).flat());
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

  if (!pd || !st || row === undefined) return <div className="page"><Header back="Trip" title="Plan the trip" /><Loading /></div>;
  if (!plan) return <div className="page"><Header back="Trip" title="Plan the trip" /><div className="empty">This trip has been removed.</div></div>;
  if (!org && !row) return <div className="page"><Header back="Trip" title="Plan the trip" sub={plan.name} /><div className="empty">The organiser hasn’t started building this trip yet.</div></div>;

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
  // ------------------------------------------------------------------ ov23: the area, the length, primary / backup
  const v1polls = (pd?.polls || []).filter((p) => p.vote_batch && p.vote_batch === st.votes?.v1);
  // ov35: new trips have two cards (When? / Where?); old ones the combined vote (v1).
  const combined = isCombined(st);
  const whenPolls = combined ? v1polls : cardPolls('when', { st, polls: pd?.polls || [], options: pd?.options || [] });
  const wherePolls = combined ? v1polls : cardPolls('where', { st, polls: pd?.polls || [], options: pd?.options || [] });
  const detail = detailCounts(wherePolls, pd?.votes || []);
  const votedNights = st.lengthVote?.on ? leadingNights(points, st.nights) : st.nights;
  // ------------------------------------------------------------------ walkthrough fixes (23 Oct): telling the group
  // One Feed post per real change (never one per click): the vote's result (I4), the calls done (I5), a weekend
  // falling through (O5). `st.posted` remembers what's been posted so a second tap doesn't post again.
  const post = (body) => supabase.from('posts').insert({ kind: 'user', player_id: me, body, link: `/plan/${planId}` }).then(() => {}, () => {});
  const nameOf = (id) => (id ? playerName(data.playersById[id]) : null);
  const mainV1 = groupBallot(wherePolls).main;
  const voters = votersOf(mainV1, pd?.votes || []);
  // V2: "3 nights won, so it's Fri 22 – Mon 25 Jan. 2 people only said yes to a shorter trip — check with them."
  const lengthNote = (() => {
    if (!st.lengthVote?.on || (combined ? !v1 : !st.votes?.when)) return null;
    const top = rankWeekends(st.weekendPool?.length ? st.weekendPool : st.weekends, points)[0];
    const lc = lengthCheck({ polls: whenPolls, options: pd.options, votes: pd.votes, optionKeys: st.optionKeys || {}, nights: votedNights,
      primary: top ? resizeWeekend(top, votedNights, st.extraNight || null) : null, primaryKey: top ? `weekend:${top.from || top.start}` : null });
    return lc && pd.votes.some((v) => whenPolls.some((p) => p.id === v.poll_id)) ? lc : null;
  })();
  // The vote's over once the area and the weekends are set from it: close it, with the winners ticked.
  const closeV1 = async (next) => {
    const open = v1polls.filter((p) => p.status === 'open');
    if (!open.length || !next.region || (next.weekends?.length && !next.weekendsSettled)) return false;
    const primary = next.weekends?.[0];
    const want = new Set([`area:${next.region}`, primary ? `weekend:${primary.from || primary.start}` : null, `nights:${next.nights}`].filter(Boolean));
    for (const p of open) {
      const w = pd.options.find((o) => o.poll_id === p.id && want.has(st.optionKeys?.[o.id]));
      await supabase.from('plan_polls').update({ status: 'closed', winner_option_id: w?.id || null }).eq('id', p.id);
    }
    return true;
  };
  // I4: the result, for the Feed and the group chat — once per vote.
  const announce = async (next) => {
    if (!st.votes?.v1 || st.posted?.result === st.votes.v1) return next;
    const keyed = (re) => v1polls.find((p) => pd.options.some((o) => o.poll_id === p.id && re.test(st.optionKeys?.[o.id] || '')));
    const areaPoll = keyed(/^area:/); const wkPoll = keyed(/^weekend:/);
    const poll = areaPoll || wkPoll;
    const primary = next.weekends?.[0] || null;
    const opts = poll ? pd.options.filter((o) => o.poll_id === poll.id) : [];
    const winKey = poll === areaPoll ? `area:${next.region}` : primary ? `weekend:${primary.from || primary.start}` : null;
    const win = opts.find((o) => st.optionKeys?.[o.id] === winKey);
    const text = resultPost({ planName: plan.name, area: next.region, weekend: primary, nights: st.lengthVote?.on ? next.nights : null, votes: poll ? topTwoYes(opts.map((o) => o.id), pd.votes, win?.id) : null });
    await post(text);
    return { ...next, posted: { ...(next.posted || {}), result: st.votes.v1 }, resultText: text, resultAt: todayISO() };
  };
  // "Go with <the leader>" (O2: the one gold button once the vote's in): the area with the vote's favourite courses and
  // places ticked, and (once there's a vote) the primary and backup weekends at the winning length. Closes the vote and
  // tells the group (I4).
  const chooseArea = (area, nights = null) => {
    if (!combined) {
      // ov35: choosing the area never settles the weekend. With the Where? vote out, say it closes it (and posts).
      if (wherePolls.some((p) => p.status === 'open')) {
        askConfirm({ title: `Go with ${area}?`, body: 'That closes the Where? vote now and posts the result in the Feed. The weekend isn’t touched.', yes: `Close the vote and go with ${area}`, tone: 'go' })
          .then((yes) => yes && closeWhere(area));
        return;
      }
      closeWhere(area);
      return;
    }
    chooseAreaOld(area, nights);
  };
  const chooseAreaOld = (area, nights = null) => run(async () => {
    const n = nights ?? votedNights;
    const base = n !== st.nights ? { ...st, nights: n, days: TB.resizeDays(st.days, n) } : st;
    let next = chooseAreaFromVotes(base, area, points, courseMap);
    next = { ...next, areaPool: st.areaPool?.length ? st.areaPool : st.regionOptions };
    if (!st.weekendsSettled && st.votes?.v1 && (st.weekends || []).length) next = { ...next, ...settlePrimaryBackup(base, points, { nights: n }) };
    if (await closeV1(next)) next = await announce(next);
    await save(next);
    setAreaTab(area);
    pd.reload();
  });
  const settleWeekends = (nights = null) => run(async () => {
    const n = nights ?? votedNights;
    const s = settlePrimaryBackup(st, points, { nights: n });
    let next = { ...st, ...s, ...(n !== st.nights ? { days: TB.resizeDays(st.days, n) } : {}) };
    if (await closeV1(next)) next = await announce(next);
    await save(next);
    pd.reload();
  });
  // ------------------------------------------------------------------ ov35: the two cards' actions
  // Close one card's open votes, ticking the winners (by option key).
  const closePart = async (part, keys) => {
    const want = new Set(keys);
    const list = part === 'when' ? whenPolls : wherePolls;
    let closed = 0;
    for (const p of list.filter((x) => x.status === 'open')) {
      const w = pd.options.find((o) => o.poll_id === p.id && want.has(st.optionKeys?.[o.id]));
      await supabase.from('plan_polls').update({ status: 'closed', winner_option_id: w?.id || null }).eq('id', p.id);
      closed += 1;
    }
    return closed;
  };
  // The card's result in the Feed — once per vote, and only when there was a vote.
  const announcePart = async (part, next, label, winKey) => {
    const batch = st.votes?.[part];
    const list = part === 'when' ? whenPolls : wherePolls;
    if (!batch || !list.length || st.posted?.[part] === batch) return next;
    const poll = list.find((p) => pd.options.some((o) => o.poll_id === p.id && st.optionKeys?.[o.id] === winKey)) || null;
    const opts = poll ? pd.options.filter((o) => o.poll_id === poll.id) : [];
    const win = opts.find((o) => st.optionKeys?.[o.id] === winKey);
    const otherDone = part === 'when' ? !!next.region : !!next.weekendsSettled;
    const text = partResultPost({ planName: plan.name, part, label, nights: part === 'when' && st.lengthVote?.on ? next.nights : null,
      votes: poll ? topTwoYes(opts.map((o) => o.id), pd.votes, win?.id) : null, otherDone });
    await post(text);
    return { ...next, posted: { ...(next.posted || {}), [part]: batch }, results: { ...(next.results || {}), [part]: text } };
  };
  // 📅 "Close the vote and go with <weekend>" (or "Go with" when it's closed / no vote): settles the weekend and its
  // fallback at the voted length. Never touches the area.
  const closeWhen = (start = null, nights = null) => run(async () => {
    const n = nights ?? votedNights;
    const pool = st.weekendPool?.length ? st.weekendPool : st.weekends;
    const ranked = rankWeekends(pool, points);
    const chosen = start ? ranked.find((w) => (w.from || w.start) === start) : ranked[0];
    const s = settleWhen(st, ranked, { start, nights: n, resize: (w, k) => resizeWeekend(w, k, st.extraNight || null) });
    if (!s || !chosen) return;
    let next = { ...st, ...s, ...(n !== st.nights ? { days: TB.resizeDays(st.days, n) } : {}) };
    const winKey = `weekend:${chosen.from || chosen.start}`;
    await closePart('when', winnerKeys('when', { weekendKey: chosen.from || chosen.start, nights: st.lengthVote?.on ? n : null }));
    next = await announcePart('when', next, whenLabel(s.weekends[0]), winKey);
    await save(next);
    pd.reload();
  }, 'The weekend’s set');
  // 📍 "Close the vote and go with <area>": the area with the vote's favourite courses and places ticked. The weekend
  // isn't touched.
  const closeWhere = (area) => run(async () => {
    let next = chooseAreaFromVotes(st, area, points, courseMap);
    next = { ...next, areaPool: st.areaPool?.length ? st.areaPool : st.regionOptions };
    await closePart('where', winnerKeys('where', { area }));
    next = await announcePart('where', next, area, `area:${area}`);
    await save(next);
    setAreaTab(area);
    pd.reload();
  });
  const setHead = (v) => patch({ headcount: v === '' ? null : Math.max(1, Math.min(200, Number(v))), headcountBy: v === '' ? null : 'organiser' });

  // The one-line summary on each option of the vote card (Josh 08:37): courses, places to stay, areas.
  const voteNotes = (s0 = st) => {
    const out = {};
    const regs = TB.regionsFrom(areas);
    for (const r of s0.region ? [s0.region] : s0.regionOptions) {
      const ids = s0.areaCourses?.[r] || [];
      const pins = s0.areaStays?.[r] || [];
      const reg = regs.find((x) => x.region === r);
      const list = ids.map((id) => courseMap[id]).filter(Boolean);
      const sum = areaSummary({ region: reg, courses: list, research: areaResearch, origin, note: regionNote(guides, r) });
      out[`area:${r}`] = [sum, TB.areaBallotNote(ids, courseMap, pins)].filter(Boolean).join(' · ');
      for (const id of ids) out[`areacourse:${r}:${id}`] = courseSummary({ course: courseMap[id] || {}, research: areaResearch[id] || null, from: pins[0] || reg || null });
      for (const s of pins) out[`stay:${s.key || s.name}`] = staySummary({ stay: s, courseIds: ids, courseMap });
    }
    return out;
  };

  // Call the vote (080; ov23): the organiser picks how deep — areas only, or areas and what's in them (each area's
  // courses and places to stay, optional for voters) — plus the weekends shortlist and "How long?" when it's asked.
  // V3: the ballot's header line for each area — rough cost each (the cheapest stay idea ÷ people + about a round a
  // night at the area's average green fee) and the drive — saved with the vote (st.voteHeader) so voters see it too.
  const headerAreas = (s0 = st) => TB.compareAreas(s0, { areas, accom, people: head.people, origin, tees }).map((r) => {
    const fees = (s0.areaCourses?.[r.area] || []).map((id) => Number(areaResearch[id]?.fee_weekend ?? areaResearch[id]?.fee_weekday)).filter((n) => n > 0);
    const golf = fees.length ? Math.round(fees.reduce((a, b) => a + b, 0) / fees.length) * Math.max(1, Number(s0.nights) || 1) : 0;
    return { area: r.area, costEach: (r.costEach || 0) + golf || null, drive: r.driveText || null };
  });
  const ballotRange = (depth = 'full', s0 = st) => {
    const range = TB.startRange(s0, { courseMap, accom, extras: extrasSection(s0.extras), depth, length: lengthSection(s0.lengthVote), notes: voteNotes(s0) });
    // V2: with "How long?" on the ballot, each weekend shows what it would be at each length ("Plus Mon 25 if we go
    // 3 nights"), so nobody says yes to Fri–Sun and gets Fri–Mon.
    const wk = range.find((s) => s.key === 'weekend');
    if (wk && lengthSection(s0.lengthVote)) wk.options = weekendBallotOptions(s0.weekends, s0.lengthVote, s0.extraNight || null);
    const st = s0; // eslint-disable-line no-shadow
    if (st.region) {
      for (const d of days) {
        if (d.options.length < 2) continue;
        range.push({ key: `day:${d.index}`, kind: 'other', question: `${d.name}${st.weekends.length ? ` (${weekendDates(d.index)})` : ''}: which course?`, options: d.options.map((id) => {
          const c = courseMap[id];
          return { key: `course:${d.index}:${id}`, label: c?.name || 'Course', notes: [st.info?.[`${d.index}:${id}`], TB.shortKnown(c, history(id))].filter(Boolean).join(' · ') };
        }) });
      }
    }
    return range;
  };
  const vote1 = (depth = 'full', s0 = st) => {
    const range = ballotRange(depth, s0);
    if (!range.length) { toast('Nothing on the table yet — add a second option somewhere, or just pick'); return; }
    // The vote keeps the shortlist and the areas (weekendPool / areaPool) so "open it up" can go back to them later.
    setCalling({ title: st.region ? 'Weekend, where to stay and courses' : 'Where and when?', range, keen: true, slot: 'v1', depth,
      multi: !st.region && st.regionOptions.length > 1, state: { weekendPool: st.weekends, areaPool: st.region ? [st.region] : st.regionOptions },
      header: headerAreas(st) });
  };
  // ov35: call the When? vote, the Where? vote, or both in one message (one batch; each card closes on its own).
  const callPart = (part, depth = 'full', s0 = st) => {
    const range = ballotRange(depth, s0);
    const r = part === 'both' ? range : splitRange(range)[part];
    if (!r.length) { toast(part === 'when' ? 'Add a second weekend (or How long?) to vote on' : 'Add a second area, or courses and places, to vote on'); return; }
    const where = part !== 'when';
    setCalling({ title: part === 'both' ? BOTH_TITLE : PART_LOOK[part].batch, range: r, part, depth,
      keen: !(s0.votes?.when || s0.votes?.where || s0.votes?.v1), slot: part === 'both' ? ['when', 'where'] : [part],
      multi: where && !s0.region && (s0.regionOptions || []).length > 1,
      state: { ...(part !== 'where' ? { weekendPool: s0.weekends } : {}), ...(where ? { areaPool: s0.region ? [s0.region] : s0.regionOptions } : {}) },
      header: where ? headerAreas(s0) : null });
  };
  // ov35: what each card can call now (nothing with votes switched off), and how many could vote.
  const choices = votesOn && !combined ? callChoices(st, ballotRange('full', st)) : { when: false, where: false, both: false };
  const eligible = (data.players || []).filter((p) => p.approved !== false).length;
  const called = async ({ batch: b, keys }) => {
    const c = calling;
    for (const id of c.attach || []) await supabase.from('plan_polls').update({ vote_batch: b.id }).eq('id', id);
    await save({ ...st, ...(c.state || {}), optionKeys: { ...(st.optionKeys || {}), ...keys }, votes: { ...(st.votes || {}), ...Object.fromEntries([].concat(c.slot).map((k) => [k, b.id])) }, ...(c.depth ? { voteDepth: c.depth } : {}),
      ...(c.header ? { voteHeader: { ...(st.voteHeader || {}), [b.id]: { areas: c.header } } } : {}) });
    pd.reload(); loadAccom();
  };

  const makeCalls = () => run(async () => {
    const made = TB.callJobs({ days, weekends: st.weekends, courses: courseMap, needed: need.needed || 1, origin, stays, booking, note: st.weekendsSettled ? rolesLine(st.weekends) : null });
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

  const doPick = async (c) => {
    const libIds = [...new Set(c.rounds.filter((r) => r.course_id).map((r) => r.course_id))];
    const courseIds = {};
    for (const id of libIds) courseIds[id] = await must(supabase.rpc('copy_library_course', { p_id: id }));
    const formats = TB.usualFormats(c.rounds.filter((r) => r.course_id).length, { trips: data.trips, rounds: data.rounds });
    const shape = TB.shapeFromConfig(c, { courseIds, formats, oldShape: plan.repeat_shape });
    const end = c.weekend.end || TB.addDays(c.weekend.start, st.nights);
    await must(supabase.from('plans').update({ start_date: c.weekend.start, end_date: end, location_name: c.stay.name, address: st.region || null, repeat_shape: shape }).eq('id', planId));
    await save({ ...st, picked: c.key, pickedText: c.text, weekends: [c.weekend], weekendsSettled: true, configs: st.configs?.length ? st.configs : configs.slice(0, 5) });
    // O7: the usual jobs (if the trip had them) move with the new dates.
    if (plan.start_date && String(plan.start_date).slice(0, 10) !== c.weekend.start) await redateTripJobs({ ...plan, start_date: c.weekend.start, end_date: end }, pd.items, plan.start_date).catch(() => 0);
    await data.reload();
    pd.reload();
  };
  const pick = (c) => run(async () => { await doPick(c); setStep('configs'); }, 'Picked — dates, place and the rounds are filled in. Lock it in when you’re ready.');

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
    return stayTip({ stay: item, courses: mapCourses, ideas: accom.filter((a) => !a.area || a.area === st.region), people: head.people || 0 });
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
      onTap={org && addPin === 'tap' ? tapToPin(areas, setAddPin, setPinName) : undefined} />
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

  // ------------------------------------------------------------------ 1. areas & weekends (ov23)
  // Just: where roughly (the areas we're considering) + when (the weekends shortlist) + how long + who's coming.
  // Accommodation ideas and search links are in step 2.
  const areaOptions = st.region ? [st.region] : st.regionOptions;
  const tabNow = areaTab === '__compare' && areaOptions.length > 1 ? '__compare' : areaOptions.includes(areaTab) ? areaTab : areaOptions[0] || null;
  const comparing = tabNow === '__compare';
  const ptsBadge = (k) => (points[k] ? <span className="tb-chip-pts">{points[k]}</span> : null);
  // v10.5: plain words — "The weekend" and "If the courses can't fit you" (the course calls still say Primary / Backup).
  const primaryBackup = st.weekendsSettled && st.weekends.length > 0 && (
    <div className="card pad stack" style={{ gap: 4 }} data-testid="tb-weekends-settled">
      {st.weekends.map((w, i) => (
        <div key={w.start} className="row between small" style={{ gap: 6 }} data-testid="settled-weekend">
          <span>{i === 0 ? <strong>📅 The weekend: {TB.weekendLabel({ start: w.start, end: w.end })}</strong>
            : <>{i === 1 ? 'If the courses can’t fit you: ' : 'Then: '}{TB.weekendLabel({ start: w.start, end: w.end })}</>}</span>
          {org && i > 0 && <span className="row" style={{ gap: 4 }}>
            <button type="button" className="btn ghost sm" onClick={() => patch({ weekends: makePrimary(st.weekends, w.start) })}>Go with this one</button>
            <button type="button" className="btn ghost sm" aria-label={`Drop ${w.start}`} onClick={() => patch({ weekends: st.weekends.filter((x) => x.start !== w.start) })}>✕</button>
          </span>}
        </div>
      ))}
      {org && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {openUpWeekend(st, points).added && <button type="button" className="btn ghost sm" onClick={() => patch({ weekends: openUpWeekend(st, points).weekends })} data-testid="add-backup">+ Another fallback weekend</button>}
        <button type="button" className="btn ghost sm" onClick={() => patch({ weekendsSettled: false, weekends: st.weekendPool?.length ? st.weekendPool : st.weekends })}>Change</button>
      </div>}
    </div>
  );
  const stepArea = (
    <>
      <AreaBar st={st} save={save} org={org} areas={areas} tab={tabNow} onTab={setAreaTab} guides={guides} />
      {areaOptions.length > 0 && (
        <AreaStart plan={plan} st={st} save={save} org={org} areas={areas} history={history} accom={accom}
          people={head.people} origin={origin} tees={tees} tab={tabNow} onTab={setAreaTab} onChoose={(r) => chooseArea(r)}
          onCallVote={org && votesOn && !combined && choices.where ? () => callPart(choices.both ? 'both' : 'where') : null} />
      )}
      {combined && v1 && !st.region && <AreaVoteResults st={st} points={points} detail={detail} courseMap={courseMap} org={org} onChoose={chooseArea} onSettle={settleWeekends} voters={voters} lengthNote={lengthNote?.line || null} checkNames={(lengthNote?.check || []).map(nameOf)} />}
      {!comparing && <>
      {org && (
        <div className="small muted">Coming from: <strong>{origin?.label || 'not set'}</strong>{!origin && ' — add starting points in “Find a course”, or people’s home suburbs.'}</div>
      )}
      <LengthPicker st={st} save={save} org={org} leading={st.lengthVote?.on && v1 ? votedNights : null} />
      {st.weekendsSettled ? primaryBackup : <WeekendPicker st={st} save={save} org={org} points={points} nights={st.lengthVote?.on && v1 ? votedNights : st.nights} />}
      {combined && v1 && st.region && !st.weekendsSettled && <AreaVoteResults st={st} points={points} detail={detail} courseMap={courseMap} org={org} onChoose={chooseArea} onSettle={settleWeekends} voters={voters} lengthNote={lengthNote?.line || null} checkNames={(lengthNote?.check || []).map(nameOf)} />}
      {combined && org && !v1 && st.region && st.weekends.length > 0 && !st.weekendsSettled && (
        // O2: one gold button (Call the vote); skipping the vote is one of the other ways.
        <OtherWays open={!votesOn}>
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => settleWeekends(st.nights)} data-testid="settle-weekends">
            {st.weekends.length > 1 ? 'Skip the vote: go with the first weekend (the next is the fallback)' : 'This is the weekend'}
          </button>
        </OtherWays>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-testid="tb-headcount">
        <span className="label" style={{ margin: 0 }}>Who’s coming?</span>
        {org
          ? <input className="input" style={{ width: 90 }} type="number" min="1" max="200" inputMode="numeric" value={st.headcount ?? ''} placeholder={String(head.people || '')} onChange={(e) => setHead(e.target.value)} aria-label="How many coming" />
          : <strong>{head.people || '?'}</strong>}
        <span className="small muted">{head.people ? `${head.people} — ${head.words}` : 'not known yet'}</span>
      </div>
      <ExtrasPanel plan={plan} st={st} save={save} org={org} />
      {combined && org && votesOn && !v1 && (st.regionOptions.length > 0 || st.region) && (
        <div className="stack" style={{ gap: 6 }}>
          <button type="button" className="btn gold block" disabled={busy} onClick={() => vote1('full')} data-testid="tb-call-vote1">🗳️ Call the vote: “{st.region ? 'Weekend, where to stay and courses' : 'Where and when?'}”</button>
          {!st.region && st.regionOptions.length > 1 && <span className="small muted">You choose how deep on the next screen: just the areas, or the areas and what’s in them.</span>}
        </div>
      )}
      </>}
      {/* ov35: 📅 When? and 📍 Where? — two cards, call either first or both at once. */}
      {!combined && (
        <WhenWhere st={st} pd={pd} points={points} org={org} busy={busy} of={eligible} today={todayISO()} courseMap={courseMap}
          detail={detail} voters={voters} choices={choices} votedNights={votedNights} lengthNote={lengthNote?.line || null}
          checkNames={(lengthNote?.check || []).map(nameOf)} planId={planId}
          onCall={callPart} onCloseWhen={closeWhen} onCloseWhere={(a) => (wherePolls.some((p) => p.status === 'open') ? closeWhere(a) : chooseArea(a))}
          onSkipWhen={() => settleWeekends(st.nights)} />
      )}
      {v1 && <VoteLink planId={planId} title={v1.title} />}
      {st.resultText && <ResultCard text={st.resultText} plan={plan} st={st} />}
      {PARTS_SHOWN.map((k) => st.results?.[k] && <ResultCard key={k} text={st.results[k]} plan={plan} st={st} part={k} />)}
      {(st.before || []).length > 0 && <BeforeReopened before={st.before} />}
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
      {org && (
        <PinDropper areas={areas} addPin={addPin} setAddPin={setAddPin} pinName={pinName} setPinName={setPinName}
          startLabel="+ Add your own place (tap the map or type a town)" placeholder="Name it, e.g. Callala Beach"
          onAdd={(at, name) => {
            const p = { key: `pin:${Date.now()}`, name, lat: Math.round(at.lat * 100) / 100, lng: Math.round(at.lng * 100) / 100, custom: true };
            patch({ pins: [...pins, p], stays: stays.length < TB.MAX_STAYS ? [...stays, p] : stays });
          }} />
      )}
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
      {/* ov23: where to stay — ideas and search links with the real head count — live here now, not in step 1. */}
      <StayIdeas plan={plan} st={st} save={save} org={org} accom={accom} reloadAccom={loadAccom} head={head} />
      {combined && org && votesOn && st.region && !st.votes?.v1 && (
        <button type="button" className="btn gold block" disabled={busy} onClick={() => vote1('full')} data-testid="tb-vote1">🗳️ Call the vote (one vote card)</button>
      )}
      {!combined && org && choices.where && st.region && (
        <button type="button" className="btn ghost block" disabled={busy} onClick={() => callPart('where')} data-testid="tb-vote-detail">🗳️ Ask the group: courses and where to stay</button>
      )}
      {v1 && <VoteLink planId={planId} title={v1.title} />}
    </>
  );

  // ------------------------------------------------------------------ 3. call the courses
  const callList = TB.callJobs({ days, weekends: st.weekends, courses: courseMap, needed: need.needed || 1, origin, stays, booking, note: st.weekendsSettled ? rolesLine(st.weekends) : null });
  // O3 (walkthrough): only the GOLF days — each course is asked about the days it's an option on, every weekend still
  // in play. A travel day with no golf isn't asked about (unless the organiser put a course on it).
  const golfDays = [...new Set(callList.flatMap((j) => golfDates(j.lines)))].sort();
  const callDates = golfDays.length ? golfDays : windowDates(st.weekends);
  // O5: how each weekend is going — works / out / waiting — from the times in.
  const statuses = st.weekendsSettled ? weekendStatus({ weekends: st.weekends, days, tees, needed: need.needed || 1 }) : [];
  const ft = fallsThrough(statuses, callList.map((j) => j.name));
  const noneWorks = statuses.length > 0 && !statuses.some((x) => x.state === 'works');
  const callJobRows = jobs.filter((x) => Object.values(callJobIds).includes(x.id));
  const nextWeekend = openUpWeekend(st, points);
  // "It's not working — open it up" (ov23; O5): only when no weekend works. Add the next weekend from the vote as
  // another backup (the call jobs ask about it too, whoever has them is told, one Feed post), or go back to the area
  // choice (asks first, keeps the old work under "Before you reopened", closes the old vote and sends a fresh one).
  const openUp = (how) => {
    if (how === 'weekend' && nextWeekend.added) {
      run(async () => {
        const next = { ...st, weekends: nextWeekend.weekends };
        const made = TB.callJobs({ days, weekends: next.weekends, courses: courseMap, needed: need.needed || 1, origin, stays, booking, note: rolesLine(next.weekends) });
        const callers = [];
        for (const j of made) {
          const job = jobs.find((x) => x.id === callJobIds[j.course_id]);
          if (!job) continue;
          await supabase.from('plan_items').update({ title: j.title, body: j.body, ...stagePatch('todo') }).eq('id', job.id);
          if (job.owner_id) { notify('job_assigned', { item_id: job.id }).catch(() => {}); callers.push(nameOf(job.owner_id)); }
        }
        await post(addedBackupPost({ planName: plan.name, added: nextWeekend.added, callers: [...new Set(callers)] }));
        await save(next);
        pd.reload();
        return `Added a backup: ${TB.weekendLabel(nextWeekend.added)} — the calls ask about it too`;
      }).then((m) => m && toast(m));
      return;
    }
    if (how === 'area') {
      askConfirm({
        title: 'Re-open where we’re going?',
        body: `${st.region || 'The area'} and its weekends move to “Before you reopened” — nothing’s deleted. The old vote closes, the open calls stop, and a fresh vote goes out with only what’s still in play.`,
        yes: 'Re-open it', tone: 'go',
      }).then((yes) => yes && run(async () => {
        const r = reopenArea(st, points);
        const failed = st.region;
        for (const job of callJobRows) if (jobStage(job) !== 'done') await supabase.from('plan_items').update(stagePatch('done')).eq('id', job.id);
        for (const p of (combined ? v1polls : wherePolls).filter((x) => x.status === 'open')) await supabase.from('plan_polls').update({ status: 'closed' }).eq('id', p.id);
        const dead = new Set(st.deadWeekends || []);
        const pool = (st.weekendPool?.length ? st.weekendPool : st.weekends).filter((w) => !dead.has(w.from || w.start));
        const live = (r.state.regionOptions || []).filter((a) => a !== failed);
        const before = [...(st.before || []), { at: todayISO(), region: failed, stays: stays.map((x) => x.name), weekends: st.weekends.map((w) => ({ start: w.start, end: w.end })), pickedText: st.pickedText || null, calls: callJobRows.length }].slice(-3);
        const next = {
          ...r.state, regionOptions: live.length ? live : r.state.regionOptions, weekends: pool, weekendsSettled: false, stays: [], picked: null, pickedText: null,
          callsMade: false, callJobs: {}, configs: [], before, votes: { ...(st.votes || {}), v1: null, v2: null, ...(combined ? {} : { where: null }) }, resultText: null,
          ...(combined ? {} : { results: { ...(st.results || {}), where: null } }),
        };
        await post(reopenedPost({ planName: plan.name, area: failed, runnerUp: r.runnerUp }));
        await save(next);
        setAreaTab(r.runnerUp); setStep('area');
        pd.reload();
        if (org && votesOn) { if (combined) vote1('full', next); else callPart('where', 'full', next); } // the fresh vote, with only the options still in play
        return r.runnerUp ? `The area’s open again — ${r.runnerUp} came next in the vote` : 'The area’s open again';
      }).then((m) => m && toast(m)));
    }
  };
  // O5 + I6: the primary's out and a backup works → go with it: the dead weekend comes off (and off open votes), one
  // Feed post, and a one-tap "Still good for you?" to everyone.
  const goWith = () => run(async () => {
    const g = goWithBackup(st, ft.go, ft.out);
    const dead = deadOptions(pd.polls, pd.options, [ft.out]);
    if (dead.length) await supabase.from('plan_options').delete().in('id', dead);
    const check = await must(supabase.from('plan_polls').insert({ plan_id: planId, kind: 'dates', question: checkQuestion(ft.go), closes_on: TB.addDays(todayISO(), 2) }).select().single());
    await must(supabase.from('plan_options').insert({ poll_id: check.id, label: TB.weekendLabel(ft.go), start_date: ft.go.start, end_date: ft.go.end }));
    notify('poll_open', { poll_id: check.id }).catch(() => {});
    const go = statuses.find((x) => x.weekend.start === ft.go.start);
    await post(goWithPost({ planName: plan.name, out: ft.out, go: ft.go, courses: go ? coursesWords(go.courses, go.total, callList.map((j) => j.name)) : '' }));
    await save({ ...st, weekends: g.weekends, deadWeekends: g.dead, picked: null, pickedText: null });
    pd.reload();
    return `Going with ${TB.weekendLabel(ft.go)} — everyone’s been asked if it still suits`;
  }).then((m) => m && toast(m));
  // I5: when the last call's done, the caller gets their moment in the Feed — once.
  const onCallDone = async (job) => {
    const others = callJobRows.filter((x) => x.id !== job.id);
    if (others.some((x) => jobStage(x) !== 'done')) return;
    const key = callJobRows.map((x) => x.id).sort().join(',');
    if (!key || st.posted?.calls === key) return;
    const callers = [...new Set(callJobRows.map((x) => x.owner_id).filter(Boolean))].map(nameOf);
    await post(callsHeroPost({ planName: plan.name, callers, courses: callJobRows.length, statuses }));
    await save({ ...st, posted: { ...(st.posted || {}), calls: key } });
  };
  const stepCalls = (
    <>
      {st.weekendsSettled && <div className="card pad small" data-testid="tb-call-weekends"><strong>Ask about:</strong> {rolesLine(st.weekends)}{st.nights != null ? ` · ${st.nights === 0 ? 'a day trip' : `${st.nights} night${st.nights === 1 ? '' : 's'}`}` : ''}</div>}
      {ft && (
        <div className="card pad stack" style={{ gap: 6, borderColor: 'var(--gold)', borderWidth: 2, background: 'var(--gold-soft)' }} data-testid="falls-through">
          <strong>📅 {ft.line}</strong>
          {org && <button type="button" className="btn gold block" disabled={busy} onClick={goWith} data-testid="go-with-backup">{ft.button}</button>}
          {org && <span className="small muted">Everyone gets one message, and a one-tap “Still good for you?”.</span>}
        </div>
      )}
      <div className="row between" style={{ gap: 8 }} data-testid="tb-needed">
        <span><strong>{need.needed} tee time{need.needed === 1 ? '' : 's'} in a row</strong> <span className="small muted">{need.label}</span></span>
        {org && <input className="input" style={{ width: 90 }} type="number" min="1" max="200" inputMode="numeric" value={st.headcount ?? ''} placeholder={String(need.people || '')}
          onChange={(e) => setHead(e.target.value)} aria-label="How many playing" />}
      </div>
      {org && <button type="button" className={`btn ${st.callsMade ? 'ghost' : 'gold'} block`} disabled={busy || !callList.length} onClick={makeCalls} data-testid="tb-make-calls">📞 Make the “Call the course” jobs ({callList.length})</button>}
      {callList.length > 0 && <CallsWho items={pd.items} callJobIds={Object.values(callJobIds)} org={org} reload={pd.reload} />}
      {callList.length > 0 && <TeeGridTable courses={callList} dates={callDates} rows={tees} need={need.needed || 1} />}
      {callList.map((j) => {
        const job = jobs.find((x) => x.id === callJobIds[j.course_id]);
        const mine = job && job.owner_id && job.owner_id === me;
        return (
          <CourseCall key={j.course_id} planId={planId} courseId={j.course_id} name={j.name} job={job} dates={golfDates(j.lines)} weekends={st.weekends} need={need.needed || 1} people={need.people}
            rows={tees.filter((t) => t.course_id === j.course_id)} social={social[j.course_id] || null} canEdit={org || mine} me={me}
            groupName={status.group_name || 'our golf group'} booking={booking[j.course_id]} research={research[j.course_id]} onSaved={() => { loadTees(); loadSocial(); pd.reload(); }}
            onFinished={onCallDone} owner={job && <JobOwner job={job} org={org} reload={pd.reload} />} />
        );
      })}
      {org && tees.length > 0 && <BestPerDay rows={tees} dates={callDates} needed={need.needed || 1} courses={courseMap} />}
      {!org && !callList.length && <span className="small muted">No courses to call yet.</span>}
      {org && st.callsMade && noneWorks && (
        <div className="card pad stack" style={{ gap: 6 }} data-testid="open-it-up">
          <strong className="small">It’s not working? Open it up</strong>
          <span className="small muted">No weekend works yet. Add the next weekend from the vote, or go back to the area choice. Nothing you’ve done is lost.</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn ghost sm" disabled={!nextWeekend.added || busy} onClick={() => openUp('weekend')} data-testid="open-up-weekend">
              {nextWeekend.added ? `+ Backup: ${TB.weekendLabel(nextWeekend.added)}` : 'No more weekends on the shortlist'}</button>
            {(st.areaPool || []).length > 1 && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => openUp('area')} data-testid="open-up-area">↩︎ Re-open the area choice</button>}
          </div>
        </div>
      )}
    </>
  );

  // ------------------------------------------------------------------ 4. pick the trip (O4: the best one, then other ways)
  const v2poll = v2 && pd.polls.find((p) => p.vote_batch === v2.id && p.question === 'Which trip?');
  const v2win = v2poll?.winner_option_id && st.optionKeys?.[v2poll.winner_option_id];
  const shownConfigs = (st.picked && st.configs?.length ? st.configs : configs);
  const best = TB.pickSummary(shownConfigs, { tees, accom: accom.filter((a) => !a.area || a.area === st.region), people: need.people });
  const roleOf = (w) => { const i = st.weekendsSettled ? st.weekends.findIndex((x) => x.start === w.start) : -1; return i >= 0 ? weekendRole(i) : null; };
  // "Lock this in": pick it (dates, place and the rounds filled in) and lock the trip in — one tap, one question.
  const lockThis = (c) => {
    const end = c.weekend.end || TB.addDays(c.weekend.start, st.nights);
    askConfirm(lockInWords({ ...plan, start_date: c.weekend.start, end_date: end, location_name: c.stay.name }, pd.polls)).then((yes) => yes && run(async () => {
      await doPick(c);
      const { data: fresh } = await supabase.from('plans').select('*').eq('id', planId).maybeSingle();
      await lockInTrip({ ...pd, plan: fresh || { ...plan, start_date: c.weekend.start, end_date: end, location_name: c.stay.name } }, status);
      await data.reload();
      pd.reload();
      setStep('configs');
    }, 'Locked in — the votes are closed and the jobs are ready. Set the rounds up below.'));
  };
  const configRow = (c, i) => (
    <div key={c.key} className="tb-config" data-testid="tb-config">
      <div className="row between" style={{ gap: 8 }}>
        <strong>{i + 1}. {roleOf(c.weekend) ? `${roleOf(c.weekend)} · ` : ''}{TB.weekendLabel(c.weekend)}</strong>
        <span className="small muted">{points[`config:${c.key}`] ? `${points[`config:${c.key}`]} vote pts · ` : ''}{c.gaps ? `${c.gaps} day${c.gaps === 1 ? '' : 's'} without golf · ` : ''}about {c.totalDrive} min driving</span>
      </div>
      <div className="small" data-testid="tb-config-text">{c.text}</div>
      {org && st.picked !== c.key && <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} disabled={busy} onClick={() => pick(c)}>{v2win === `config:${c.key}` ? 'Use the winner' : 'Pick this one'}</button>}
    </div>
  );
  const stepConfigs = (
    <>
      {st.picked && <div className="card pad" style={{ borderColor: 'var(--navy)', borderWidth: 2 }} data-testid="tb-picked"><strong>✅ {plan.status === 'planning' ? 'Picked' : 'Locked in'}</strong><div className="small">{st.pickedText}</div></div>}
      {st.picked && org && plan.status === 'planning' && <button type="button" className="btn gold block" disabled={busy} onClick={() => lockThis(shownConfigs.find((c) => c.key === st.picked) || shownConfigs[0])} data-testid="lock-picked">🔒 Lock it in</button>}
      {st.picked && org && <TripSetupCard plan={plan} reload={pd.reload} />}
      {!shownConfigs.length && <span className="small muted">No trip works yet — every day needs a course with {need.needed} tee times in a row that fits the drive. Add tee times, or more options.</span>}
      {best && !st.picked && (
        <div className="card pad stack" style={{ gap: 6, borderColor: 'var(--navy)', borderWidth: 2 }} data-testid="tb-best">
          <span className="small muted" style={{ fontWeight: 800 }}>THE BEST WAY TO DO IT</span>
          <strong style={{ fontSize: 18 }}>{roleOf(best.best.weekend) ? `${roleOf(best.best.weekend)} · ` : ''}{TB.weekendLabel(best.best.weekend)} · stay {best.best.stay.name}</strong>
          {best.rounds.map((r) => (
            <div key={r.date} className="row between small" style={{ gap: 8 }} data-testid="tb-best-round">
              <span><strong>{r.day}</strong> · {r.name || 'no golf'}</span>
              <span>{r.time || ''}{r.price != null ? ` · $${r.price}` : ''}</span>
            </div>
          ))}
          <div className="small" data-testid="tb-best-cost">{[TB.costLine(best), `about ${best.drive} min driving from where we stay`].filter(Boolean).join(' · ')}</div>
          {best.alsoWorks && <div className="small" style={{ fontWeight: 700 }} data-testid="also-works">✓ {roleOf(best.alsoWorks) ? `The ${roleOf(best.alsoWorks).toLowerCase()} weekend` : 'Another weekend'} ({TB.weekendLabel(best.alsoWorks)}) also works.</div>}
          {org && <button type="button" className="btn gold block" disabled={busy} onClick={() => lockThis(best.best)} data-testid="lock-this-in">🔒 Lock this in</button>}
          {org && votesOn && !v2 && configs.length >= 2 && (
            <button type="button" className="small" style={{ border: 0, background: 'none', padding: 0, color: 'var(--navy)', textDecoration: 'underline', alignSelf: 'flex-start' }} onClick={() => vote2(configs.slice(0, 5))} data-testid="ask-group">Ask the group instead</button>
          )}
        </div>
      )}
      {org && !st.picked && best && (
        <OtherWays title="Other ways to do it">
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => pick(best.best)} data-testid="pick-best">Pick the best one, lock it in later</button>
          {best.others.length > 0 && <div className="card" data-testid="tb-configs" style={{ overflow: 'hidden' }}>{best.others.slice(0, 4).map((c, i) => configRow(c, i + 1))}</div>}
        </OtherWays>
      )}
      {(!org || st.picked) && shownConfigs.length > 0 && (
        <details className="card" style={{ overflow: 'hidden' }}>
          <summary className="small" style={{ padding: '10px 14px', fontWeight: 700, cursor: 'pointer' }}>The {Math.min(5, shownConfigs.length)} best ways to do it</summary>
          <div data-testid="tb-configs">{shownConfigs.slice(0, 5).map((c, i) => configRow(c, i))}</div>
        </details>
      )}
      {v2 && <VoteLink planId={planId} title={v2.title} />}
    </>
  );

  const bodies = { area: stepArea, courses: stepCourses, calls: stepCalls, configs: stepConfigs };
  const summaries = {
    // The same lines as the Organise step cards (lib/tripsteps.js).
    area: areaLine(st),
    courses: coursesLine(st),
    calls: st.callsMade ? `${tees.filter((t) => slotsFor(t).length).length} sets of tee times in` : null,
    configs: st.pickedText || (configs.length ? `${configs.length} trip${configs.length === 1 ? '' : 's'} that work` : null),
  };

  return (
    <div className="page tb-wide">
      <Header back="Trip" title="Plan the trip" sub={plan.name} />
      <div className="section stack">
        <div className="tb-steps" role="list" aria-label="Steps">
          {steps.map((s) => (
            <button key={s.key} type="button" role="listitem" className={`tb-step${s.done ? ' done' : ''}${s.locked ? ' locked' : ''}`} aria-current={current === s.key ? 'step' : undefined} onClick={() => setStep(s.key)}>
              {s.locked ? '🔒' : s.done ? '✓' : s.n} {s.label}
            </button>
          ))}
          {/* ov23: the same six steps as Organise — the last two live there. */}
          {TRIP_STEPS.filter((t) => !t.builder).map((t) => (
            <Link key={t.key} role="listitem" className="tb-step tb-step-out" to={`/plan/${planId}?view=organise&step=${t.key}`} data-testid={`tb-step-link-${t.key}`}>{t.n} {t.title} ↗</Link>
          ))}
        </div>
        {/* O1: the same "where we're up to" line as Organise and the Overview's card. */}
        <div className="small" style={{ fontWeight: 800 }} data-testid="up-to-line">📍 {upToLine(plan.status !== 'planning' ? 'money' : (steps.find((x) => !x.done) || { key: 'lockin' }).key)}</div>
        <CoOrganisersCard plan={plan} compact />
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
        <CallVoteSheet key={calling.depth || 'x'} plan={plan} title={calling.title} range={calling.range} keenDefault={calling.keen} keenOption={calling.keen}
          intro={calling.multi ? (
            <div className="stack" style={{ gap: 6 }} data-testid="vote-depth">
              <span className="label">How deep?</span>
              <Seg light options={[{ value: 'areas', label: 'Areas only' }, { value: 'full', label: 'Areas + what’s in them' }]} value={calling.depth} onChange={(d) => (calling.part ? callPart(calling.part, d) : vote1(d))} />
              <span className="small muted">{calling.depth === 'areas'
                ? 'Just “Which area?” (and the weekends). Courses and places get sorted once the area’s picked.'
                : 'Each area’s courses and places to stay go under it, optional — voters can answer just the areas and weekends, or go into the detail.'}</span>
            </div>
          ) : null}
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

/** I4: the vote's result as a card — share it to the group chat, or put it in the calendar. */
function ResultCard({ text, plan, st }) {
  const w = st.weekends?.[0];
  const cal = w ? icsFor({ id: plan.id, name: plan.name, start_date: w.start, end_date: w.end, location_name: st.region || null }, appLink(`/plan/${plan.id}`)) : null;
  return (
    <div className="card pad stack" style={{ gap: 6, borderColor: 'var(--gold)', borderWidth: 2 }} data-testid="result-card">
      <strong>🗳️ The result</strong>
      <div className="small" data-testid="result-text">{text}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost sm" onClick={async () => { const r = await shareText(`${text}\n${appLink(`/plan/${plan.id}`)}`, plan.name); if (r === 'copied') toast('Copied — paste it in the group chat'); }} data-testid="share-result">📤 Share to the group chat</button>
        {cal && <button type="button" className="btn ghost sm" onClick={() => downloadFile(`${plan.name.replace(/[^a-z0-9]+/gi, '-')}.ics`, cal)} data-testid="result-calendar">📅 Add to calendar</button>}
      </div>
    </div>
  );
}

/** O5: what the trip looked like before the area was re-opened — kept, folded away. */
function BeforeReopened({ before }) {
  return (
    <details className="card" data-testid="before-reopened" style={{ overflow: 'hidden' }}>
      <summary className="small" style={{ padding: '10px 14px', fontWeight: 700, cursor: 'pointer' }}>Before you reopened ({before.length})</summary>
      <div className="stack small" style={{ padding: '0 14px 12px', gap: 6 }}>
        {before.slice().reverse().map((b, i) => (
          <div key={`${b.at}-${i}`} className="muted">
            <strong style={{ color: 'var(--text)' }}>📍 {b.region || 'No area'}</strong>
            {(b.weekends || []).length > 0 && <div>{rolesLine(b.weekends)}</div>}
            {(b.stays || []).length > 0 && <div>Stay: {b.stays.join(', ')}</div>}
            {b.pickedText && <div>Picked: {b.pickedText}</div>}
            {b.calls ? <div>{b.calls} call{b.calls === 1 ? '' : 's'} made · re-opened {dueWords(b.at)}</div> : <div>Re-opened {dueWords(b.at)}</div>}
          </div>
        ))}
      </div>
    </details>
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
