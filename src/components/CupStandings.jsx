// The group's cups on screen (ov32, migration 101): standings with a breakdown per player, cap tips (give one from a
// Feed post, a player's card or the day screen; "3 left to give"; undo within 10 minutes), organiser side activities
// and adjustments, the day screen's cups card, the results page's cups and the cup's photo. Maths: lib/cups.js.
// Test ids are cup-* and captip-*.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useRealtime, playerName } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { currentGroup } from '../lib/group.js';
import { pickActiveTrip } from '../lib/activetrip.js';
import { tripPlayerIds } from '../lib/comps.js';
import {
  isCupComp, cupStandings, capTipState, capTipName, canUndo, sourceOn, howToWin, myLine, tripCupComps, cupOf, UNDO_MINUTES, signed,
} from '../lib/cups.js';
import { useTripComps, useComps, useCompData } from './CompsChip.jsx';
import RuleTag from './RuleTag.jsx';
import { Sheet, AvatarStack } from './ui.jsx';

// ------------------------------------------------------------------ data

/** The group's cup library, live. An older database (before 101) has none. */
export function useCups() {
  const [cups, setCups] = useState([]);
  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('cups').select('*').order('created_at');
      if (!error) setCups(data || []);
    } catch { /* no signal */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['cups'], load);
  return [cups, load];
}

/** What the group calls cap tips: 'cap' | 'fist' | 'shout'. */
export function useCapTipName() {
  const [name, setName] = useState('cap');
  const load = useCallback(async () => {
    const g = currentGroup();
    if (!g) return;
    try {
      const { data, error } = await supabase.from('groups').select('cap_tip_name').eq('id', g).maybeSingle();
      if (!error && data?.cap_tip_name) setName(data.cap_tip_name);
    } catch { /* keep the default */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  return [name, setName];
}

/** A trip's cap tips, live. */
function useCapTips(tripId) {
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    if (!tripId) { setRows([]); return; }
    try {
      const { data, error } = await supabase.from('cap_tips').select('*').eq('trip_id', tripId).order('created_at');
      if (!error) setRows(data || []);
    } catch { /* no signal */ }
  }, [tripId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['cap_tips'], load);
  return [rows, load];
}

// ------------------------------------------------------------------ standings with the breakdown

/** One cup's standings: each player, their points and the breakdown ("Latest out +2 · Round 1 3rd +1 · Vibe +14 …"). */
export function CupStandingsView({ comp, st, data, limit = 0, admin = false }) {
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const rows = limit && !all ? st.rows.slice(0, limit) : st.rows;
  const trip = (data?.trips || []).find((t) => t.id === comp.trip_id) || null;
  const cupPoints = (data?.cupPoints || []).filter((p) => p.comp_id === comp.id);
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="cup-standings">
      <span className="small" data-testid="cup-how">{st.how || howToWin(comp)}</span>
      {!st.rows.length && <div className="card pad small muted">{st.empty || 'No points yet.'}</div>}
      {rows.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {rows.map((r) => (
            <div key={r.id} className="row" style={{ gap: 10, padding: '10px 12px', borderTop: '1px solid var(--line-soft)', alignItems: 'flex-start' }} data-testid="cup-row">
              <span className="lb-rank" style={{ fontSize: 16, width: 26, flex: 'none' }}>{r.rankLabel}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="row" style={{ gap: 6 }}>
                  {r.players?.length ? <AvatarStack players={r.players} size={22} /> : null}
                  <strong className="ellipsis">{r.name}</strong>
                </span>
                {r.breakdown && <span className="small muted" style={{ display: 'block', lineHeight: 1.35 }} data-testid="cup-breakdown">{r.breakdown}</span>}
              </span>
              <strong style={{ flex: 'none', fontSize: 17 }}>{r.text}</strong>
            </div>
          ))}
        </div>
      )}
      {limit > 0 && st.rows.length > limit && (
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${st.rows.length}`}</button>
      )}
      {/* Organiser adjustments and side activities: everyone sees them, and any of them can be disputed. */}
      {cupPoints.some((p) => ['manual', 'activity'].includes(p.source_type) && !p.waived_at) && (
        <div className="stack" style={{ gap: 2 }} data-testid="cup-adjustments">
          <span className="label">Entered by an organiser</span>
          {cupPoints.filter((p) => ['manual', 'activity'].includes(p.source_type) && !p.waived_at).map((p) => (
            <div key={p.id} className="row between small" style={{ gap: 8 }}>
              <span className="grow">{playerName(data.playersById?.[p.player_id])}: {p.label}</span>
              <RuleTag testId="cup-points-tag" rule={{ table: 'cup_points', id: p.id, field: 'points', label: `${comp.name}: ${p.label}`, value: Number(p.points), where: { comp_id: comp.id, trip_id: comp.trip_id, path: `/comps-board?c=${comp.id}` } }}
                explain="Entered by an organiser. If you think it’s wrong, dispute it: the group decides.">
                <strong>{signed(Number(p.points))}</strong>
              </RuleTag>
              {admin && <WaiveButton id={p.id} onDone={data.reloadCup} />}
            </div>
          ))}
        </div>
      )}
      {admin && isCupComp(comp) && comp.settings?.cup !== 'eclectic' && (sourceOn(comp, 'activities') || sourceOn(comp, 'manual')) && (
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)} data-testid="cup-add-points">+ Side activity or adjustment</button>
      )}
      {adding && <PointsSheet comp={comp} trip={trip} data={data} onClose={() => setAdding(false)} />}
    </div>
  );
}

function WaiveButton({ id, onDone }) {
  const [busy, run] = useRun();
  return (
    <button type="button" className="btn ghost sm" disabled={busy} aria-label="Take it back"
      onClick={() => run(async () => { await must(supabase.rpc('waive_cup_points', { p_id: id })); await onDone?.(); }, 'Taken back')}>Undo</button>
  );
}

/** Organiser: a side activity's placings (go-karts, poker, darts) or an adjustment with a reason. */
function PointsSheet({ comp, trip, data, onClose }) {
  const [mode, setMode] = useState(sourceOn(comp, 'activities') ? 'activity' : 'manual');
  const [what, setWhat] = useState('');
  const [places, setPlaces] = useState([{ who: '', pts: '3' }, { who: '', pts: '2' }, { who: '', pts: '1' }]);
  const [who, setWho] = useState('');
  const [pts, setPts] = useState('1');
  const [activities, setActivities] = useState([]);
  const [activityId, setActivityId] = useState('');
  const [busy, run] = useRun();
  useEffect(() => {
    if (!trip) return;
    (async () => {
      try {
        const { data: plans } = await supabase.from('plans').select('id,status').eq('trip_id', trip.id);
        const plan = (plans || []).find((p) => p.status !== 'cancelled');
        if (!plan) return;
        const { data: acts } = await supabase.from('trip_activities').select('id,title').eq('plan_id', plan.id);
        setActivities(acts || []);
      } catch { /* none */ }
    })();
  }, [trip]);
  const people = useMemo(() => {
    const ids = tripPlayerIds((data.rounds || []).filter((r) => r.trip_id === comp.trip_id), data);
    return ids.map((id) => data.playersById?.[id]).filter(Boolean).sort((a, b) => playerName(a).localeCompare(playerName(b)));
  }, [comp.trip_id, data]);
  const ordinal = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  const save = () => run(async () => {
    if (mode === 'activity') {
      const name = what.trim() || activities.find((a) => a.id === activityId)?.title || '';
      if (name.length < 2) throw new Error('Name the activity');
      const filled = places.filter((p) => p.who && Number(p.pts));
      if (!filled.length) throw new Error('Pick who placed');
      for (const [i, p] of places.entries()) {
        if (!p.who || !Number(p.pts)) continue;
        await must(supabase.rpc('add_cup_points', { p_comp: comp.id, p_player: p.who, p_points: Number(p.pts), p_source: 'activity', p_label: `${name} ${ordinal[i]}`, p_source_id: activityId || null }));
      }
    } else {
      if (!who) throw new Error('Pick who');
      if (what.trim().length < 2) throw new Error('Say why (a few words)');
      await must(supabase.rpc('add_cup_points', { p_comp: comp.id, p_player: who, p_points: Number(pts), p_source: 'manual', p_label: what.trim() }));
    }
    await data.reloadCup?.();
    onClose();
  }, 'Added — everyone can see it');
  const pick = (value, onChange, testId) => (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      <option value="">Pick someone</option>
      {people.map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
    </select>
  );
  return (
    <Sheet title={`${comp.name}: add points`} onClose={onClose}>
      <div className="stack" data-testid="cup-points-sheet">
        <div className="seg light" role="group" aria-label="What kind">
          {sourceOn(comp, 'activities') && <button type="button" aria-pressed={mode === 'activity'} onClick={() => setMode('activity')}>🏎️ Side activity</button>}
          {sourceOn(comp, 'manual') && <button type="button" aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>✍️ Adjustment</button>}
        </div>
        {mode === 'activity' ? (
          <>
            {activities.length > 0 && (
              <label className="field"><span>From the run-up</span>
                <select className="select" value={activityId} onChange={(e) => { setActivityId(e.target.value); setWhat(''); }}>
                  <option value="">Something else</option>
                  {activities.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </label>
            )}
            {!activityId && <label className="field"><span>What was it?</span><input className="input" value={what} maxLength={60} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Go-karts, poker, darts" data-testid="cup-activity-name" /></label>}
            {places.map((p, i) => (
              <div key={i} className="row" style={{ gap: 8 }}>
                <span className="small" style={{ width: 34, fontWeight: 700 }}>{ordinal[i]}</span>
                <span className="grow">{pick(p.who, (v) => setPlaces(places.map((x, j) => (j === i ? { ...x, who: v } : x))), `cup-place-${i}`)}</span>
                <input className="input" style={{ width: 64 }} inputMode="decimal" aria-label={`Points for ${ordinal[i]}`} value={p.pts}
                  onChange={(e) => setPlaces(places.map((x, j) => (j === i ? { ...x, pts: e.target.value.replace(/[^\d.-]/g, '').slice(0, 5) } : x)))} />
              </div>
            ))}
            {places.length < 6 && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPlaces([...places, { who: '', pts: '0' }])}>+ Another place</button>}
          </>
        ) : (
          <>
            <label className="field"><span>Who</span>{pick(who, setWho, 'cup-adjust-who')}</label>
            <label className="field"><span>Points (minus to take off)</span><input className="input" inputMode="decimal" value={pts} onChange={(e) => setPts(e.target.value.replace(/[^\d.-]/g, '').slice(0, 5))} data-testid="cup-adjust-points" /></label>
            <label className="field"><span>Why</span><input className="input" value={what} maxLength={120} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Carried the esky all weekend" data-testid="cup-adjust-why" /></label>
            <span className="small muted">Everyone sees it, with your reason, and can dispute it.</span>
          </>
        )}
        <button type="button" className="btn gold block" disabled={busy} onClick={save} data-testid="cup-points-save">Add the points</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ cap tips

/** The cups on a trip that take cap tips. */
function useKudosCups(tripId) {
  const [list] = useTripComps(tripId);
  return useMemo(() => tripCupComps(list, tripId).filter((c) => sourceOn(c, 'kudos')), [list, tripId]);
}

/**
 * Give a cap tip. receiverId: who (null = pick); postId: the Feed post it's from. Shows "3 left to give", the most to
 * one person, and what you've given in the last 10 minutes (with Undo).
 */
export function CapTipSheet({ trip, receiverId = null, postId = null, onClose }) {
  const data = useData();
  const { status } = useSession();
  const cups = useKudosCups(trip?.id);
  const [tips, reload] = useCapTips(trip?.id);
  const [nameKey] = useCapTipName();
  const nm = capTipName(nameKey);
  const [compId, setCompId] = useState('');
  const [to, setTo] = useState(receiverId || '');
  const [reason, setReason] = useState('');
  const [busy, run] = useRun();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  const comp = cups.find((c) => c.id === compId) || cups[0] || null;
  const me = status?.player_id;
  const st = capTipState({ tips: tips.filter((t) => t.comp_id === comp?.id), me, settings: comp ? sourceOn(comp, 'kudos') : null, meGuest: status?.role === 'guest' });
  const why = to ? st.canGiveTo(to) : '';
  const people = useMemo(() => {
    const ids = tripPlayerIds((data.rounds || []).filter((r) => r.trip_id === trip?.id), data);
    return ids.filter((id) => id !== me).map((id) => data.playersById?.[id]).filter(Boolean).sort((a, b) => playerName(a).localeCompare(playerName(b)));
  }, [data, trip?.id, me]);
  const recent = tips.filter((t) => canUndo(t, me)).reverse();
  const give = () => run(async () => {
    await must(supabase.from('cap_tips').insert({ trip_id: trip.id, comp_id: comp.id, giver_id: me, receiver_id: to, reason: reason.trim() || null, post_id: postId || null }));
    setReason('');
    await reload();
    if (!receiverId) setTo('');
  }, `${nm.emoji} ${nm.one[0].toUpperCase()}${nm.one.slice(1)} given to ${playerName(data.playersById?.[to])}`);
  const undo = (t) => run(async () => { await must(supabase.from('cap_tips').delete().eq('id', t.id)); await reload(); }, 'Taken back');
  return (
    <Sheet title={`${nm.emoji} Give a ${nm.one}`} onClose={onClose}>
      <div className="stack" data-testid="captip-sheet">
        {!cups.length && <span className="small muted">No cup on this trip takes {nm.name.toLowerCase()} yet. An organiser turns them on under “What counts” for a cup.</span>}
        {cups.length > 1 && (
          <label className="field"><span>Towards</span>
            <select className="select" value={comp?.id || ''} onChange={(e) => setCompId(e.target.value)}>{cups.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
        )}
        {comp && (
          <>
            <strong data-testid="captip-left">{st.left} left to give{cups.length === 1 ? ` · ${comp.name}` : ''}</strong>
            <span className="small muted">{signed(st.per)} each · at most {st.maxSame} to the same person{st.guests ? '' : ' · not for guests'}.</span>
            {!receiverId && (
              <div className="chips" style={{ flexWrap: 'wrap' }}>
                {people.map((p) => <button key={p.id} type="button" className="chip" aria-pressed={to === p.id} onClick={() => setTo(p.id)} data-testid="captip-to">{playerName(p)}</button>)}
              </div>
            )}
            {receiverId && <span>To <strong>{playerName(data.playersById?.[receiverId])}</strong></span>}
            <label className="field"><span>What for? (optional)</span>
              <input className="input" value={reason} maxLength={80} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Drove everyone home" data-testid="captip-reason" />
            </label>
            {why && <span className="small" style={{ color: 'var(--under)' }} data-testid="captip-why">{why}</span>}
            <button type="button" className="btn gold block" disabled={busy || !to || !!why || status?.viewing} onClick={give} data-testid="captip-give">Give {nm.emoji}</button>
          </>
        )}
        {recent.length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">You can take these back for {UNDO_MINUTES} minutes</span>
            {recent.map((t) => (
              <div key={t.id} className="row between small" style={{ gap: 8 }}>
                <span>{nm.emoji} {playerName(data.playersById?.[t.receiver_id])}{t.reason ? ` · ${t.reason}` : ''}</span>
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => undo(t)} data-testid="captip-undo">Undo</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

// The Feed shows many posts: one shared, lightly cached read of the cups on and the group's name for cap tips.
const shared = { at: 0, comps: [], name: 'cap', loading: null, subs: new Set() };
function useSharedKudos() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    shared.subs.add(f);
    if (Date.now() - shared.at > 60000 && !shared.loading) {
      shared.loading = (async () => {
        try {
          const g = currentGroup();
          const [c, n] = await Promise.all([
            supabase.from('comps').select('*').eq('retired', false),
            g ? supabase.from('groups').select('cap_tip_name').eq('id', g).maybeSingle() : Promise.resolve({ data: null }),
          ]);
          if (!c.error) shared.comps = c.data || [];
          if (!n?.error && n?.data?.cap_tip_name) shared.name = n.data.cap_tip_name;
          shared.at = Date.now();
        } catch { /* no signal */ }
        shared.loading = null;
        shared.subs.forEach((fn) => fn());
      })();
    }
    return () => { shared.subs.delete(f); };
  }, []);
  return shared;
}

/** The Feed post chip, next to "🏷 Fine / award": only when a cup on the post's trip (or the trip on now) takes them. */
export function CapTipChip({ post }) {
  const data = useData();
  const { status } = useSession();
  const k = useSharedKudos();
  const [open, setOpen] = useState(false);
  const tripId = post?.trip_id || pickActiveTrip({ trips: data.trips, rounds: data.rounds })?.trip?.id || null;
  const trip = (data.trips || []).find((t) => t.id === tripId) || null;
  const on = trip && tripCupComps(k.comps, trip.id).some((c) => sourceOn(c, 'kudos'));
  if (!on || !post?.player_id || post.player_id === status?.player_id || post.kind !== 'user' || status?.viewing) return null;
  const nm = capTipName(k.name);
  return (
    <>
      <button type="button" className="react" onClick={() => setOpen(true)} aria-label={`Give ${playerName(data.playersById?.[post.player_id])} a ${nm.one}`} data-testid="captip-post">{nm.emoji} {nm.name.replace(/s$/, '')}</button>
      {open && <CapTipSheet trip={trip} receiverId={post.player_id} postId={post.id} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A player's card: "🧢 Give Mo a cap tip" when a cup on the trip on now takes them. */
export function CapTipButton({ playerId }) {
  const data = useData();
  const { status } = useSession();
  const [comps] = useComps();
  const [nameKey] = useCapTipName();
  const [open, setOpen] = useState(false);
  const trip = pickActiveTrip({ trips: data.trips, rounds: data.rounds })?.trip || null;
  const on = trip && tripCupComps(comps, trip.id).some((c) => sourceOn(c, 'kudos'));
  if (!on || !playerId || playerId === status?.player_id || status?.viewing) return null;
  const nm = capTipName(nameKey);
  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)} data-testid="captip-player">{nm.emoji} Give {playerName(data.playersById?.[playerId])} a {nm.one}</button>
      {open && <CapTipSheet trip={trip} receiverId={playerId} onClose={() => setOpen(false)} />}
    </>
  );
}

// ------------------------------------------------------------------ the day screen and the results page

/** The day screen's cups: each weekend / combined cup on the trip, who leads, your points, and cap tips. */
export function CupsToday({ trip }) {
  const { status } = useSession();
  const [list] = useTripComps(trip?.id);
  const cd = useCompData(trip?.id);
  const [nameKey] = useCapTipName();
  const [giving, setGiving] = useState(false);
  const cups = useMemo(() => (trip ? tripCupComps(list, trip.id).filter(isCupComp) : []), [list, trip]);
  const lines = useMemo(() => cups.map((c) => { let st = null; try { st = cupStandings(c, cd); } catch { st = null; } return { c, st }; }), [cups, cd]);
  const kudos = cups.some((c) => sourceOn(c, 'kudos'));
  if (!trip || !cups.length) return null;
  const nm = capTipName(nameKey);
  const left = kudos ? capTipState({ tips: (cd.capTips || []).filter((t) => t.comp_id === cups.find((c) => sourceOn(c, 'kudos'))?.id), me: status?.player_id, settings: sourceOn(cups.find((c) => sourceOn(c, 'kudos')), 'kudos') }).left : 0;
  return (
    <div className="section" style={{ paddingBottom: 0 }}>
      <div className="card pad stack" style={{ gap: 6 }} data-testid="cups-today">
        {lines.map(({ c, st }) => (
          <Link key={c.id} to={`/comps-board?trip=${trip.id}&c=${encodeURIComponent(c.id)}`} className="row between" style={{ gap: 8, color: 'inherit', textDecoration: 'none' }}>
            <span className="grow" style={{ minWidth: 0 }}>
              <strong>🏆 {c.name}</strong>
              <span className="small muted" style={{ display: 'block' }}>{st?.leaderText || st?.empty || 'No points yet'}{myLine(st, status?.player_id) ? ` · ${myLine(st, status?.player_id)}` : ''}</span>
            </span>
            <span className="muted" aria-hidden="true">›</span>
          </Link>
        ))}
        {kudos && !status?.viewing && (
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setGiving(true)} data-testid="captip-day">{nm.emoji} Give a {nm.one} · {left} left to give</button>
        )}
      </div>
      {giving && <CapTipSheet trip={trip} onClose={() => setGiving(false)} />}
    </div>
  );
}

/** The results page: each weekend / combined cup's final standings with the breakdown (the top five). */
export function CupsResults({ trip }) {
  const [list] = useTripComps(trip?.id);
  const cd = useCompData(trip?.id);
  const cups = useMemo(() => (trip ? tripCupComps(list, trip.id).filter(isCupComp) : []), [list, trip]);
  if (!cups.length) return null;
  return cups.map((c) => {
    let st = null;
    try { st = cupStandings(c, cd); } catch { st = null; }
    if (!st) return null;
    return (
      <div key={c.id} className="card pad stack" style={{ gap: 6 }} data-testid="results-cup-standings">
        <strong>🏆 {c.name}</strong>
        <CupStandingsView comp={c} st={st} data={cd} limit={5} />
      </div>
    );
  });
}

/** A library cup's photo (Trophy Room, results page) and who has it now. comp: the trip's comp for it. */
export function CupPhoto({ comp, size = 56, cups: given = null }) {
  const data = useData();
  const [own] = useCups();
  const cup = cupOf(comp, given || own);
  if (!cup || !cup.has_trophy || (!cup.trophy_photo_url && !cup.held_by)) return null;
  return (
    <span className="row" style={{ gap: 8, alignItems: 'center' }} data-testid="cup-photo">
      {cup.trophy_photo_url && <img src={cup.trophy_photo_url} alt={`The ${cup.name}`} loading="lazy" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 10, flex: 'none' }} />}
      {cup.held_by && <span className="small muted">With {playerName(data.playersById?.[cup.held_by])} now</span>}
    </span>
  );
}

export default CupsToday;
