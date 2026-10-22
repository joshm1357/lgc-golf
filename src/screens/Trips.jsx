// The Trips tab: every trip in one list — the one that's on (or next), the ideas being voted on, and past trips.
// A trip moves idea → deciding → locked in → on → done (see lib/trips.js). Tapping one opens it (Planner.jsx).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName, cacheGet, cacheSet, useFeature } from '../lib/store.jsx';
import { Header, AvatarStack, Sheet, Loading, toast } from '../components/ui.jsx';
import { fmtRange, countdown, RSVP_LABEL, todayISO, money } from '../lib/plan.js';
import { STAGE_LABEL, sortTrips, stillToDecide, suggestionOptions, defaultCloses, tripWhen } from '../lib/trips.js';
import { notify, shareText, appLink } from '../lib/push.js';
import { useRun, must } from '../lib/run.js';
import { NotifyCard } from '../components/NotifyCard.jsx';
import { TripsAi } from './AiPlanner.jsx';
import { ReplayChips } from '../components/ReplayChips.jsx';

const TABLES = ['plans', 'plan_rsvps', 'plan_polls', 'plan_options'];

export default function Trips() {
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const [rows, setRows] = useState(null);
  const loc = useLocation();
  // "Same time next year?" from a finished quick round opens a ready-made idea.
  const [suggesting, setSuggesting] = useState(() => {
    const q = new URLSearchParams(loc.search);
    if (!q.get('suggest')) return false;
    const d = q.get('date');
    return { kind: q.get('kind') === 'trip' ? 'trip' : 'round', name: (q.get('name') || '').slice(0, 60), dates: d ? [{ start_date: d, end_date: d }] : [],
      place: (q.get('place') || '').slice(0, 80) || null, share: q.get('share') === '1' };
  });
  const notifyOn = useFeature('notifications');
  const votesOn = useFeature('planner_tasks');
  const trophiesOn = useFeature('trophies');
  const load = useCallback(async () => {
    try {
      const [plans, rsvps, polls] = await Promise.all([
        supabase.from('plans').select('*'),
        supabase.from('plan_rsvps').select('plan_id,player_id,status'),
        supabase.from('plan_polls').select('id,plan_id,kind,question,status,closes_on').eq('status', 'open'),
      ]);
      if (plans.error) throw plans.error;
      const pollIds = (polls.data || []).map((p) => p.id);
      const { data: options } = pollIds.length ? await supabase.from('plan_options').select('id,poll_id').in('poll_id', pollIds) : { data: [] };
      const next = { plans: plans.data || [], rsvps: rsvps.data || [], polls: polls.data || [], options: options || [] };
      cacheSet('trips-list', next);
      setRows(next);
    } catch {
      // No signal: show the copy saved on this phone last time.
      const c = cacheGet('trips-list');
      setRows((cur) => cur || (c ? { ...c, offline: true } : { plans: [], rsvps: [], polls: [], options: [], failed: true }));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(TABLES, load);

  const today = todayISO();
  // Trips added in Admin → Trips (no plan behind them) still belong in the list.
  const sorted = useMemo(() => (rows ? sortTrips([...rows.plans, ...tripsWithoutPlan(data.trips, rows.plans)], data.trips, today) : null), [rows, data.trips, today]);
  const photos = usePastPhotos(sorted?.past);

  if (!rows) return <div className="page"><Header logo title="Trips" /><Loading /></div>;
  const rsvpsOf = (id) => rows.rsvps.filter((r) => r.plan_id === id);
  const { now, later, ideas, past } = sorted;

  return (
    <div className="page">
      <Header logo title="Trips" sub="What’s on, what’s being decided, and every trip so far" />
      <div className="section stack">
        {notifyOn && <NotifyCard compact />}
        {rows.offline && <div className="small muted">No signal — showing the list from last time.</div>}
        {rows.failed && <div className="err">Couldn’t load the trips — check your signal and open Trips again.</div>}

        {now ? <NowCard plan={now.plan} stage={now.stage} rsvps={rsvpsOf(now.plan.id)} me={status.player_id} />
          : <div className="empty">Nothing locked in yet. Suggest a trip below and let everyone vote on when and where.</div>}
        {later.map((x) => <TripCard key={x.plan.id} plan={x.plan} stage={x.stage} rsvps={rsvpsOf(x.plan.id)} me={status.player_id} />)}

        <span className="label" style={{ marginTop: 6 }}>{votesOn ? 'Ideas and voting' : 'Ideas'}</span>
        {ideas.length === 0 && <div className="small muted">No ideas on the go.</div>}
        {ideas.map((x) => (
          <TripCard key={x.plan.id} plan={x.plan} stage={x.stage} rsvps={rsvpsOf(x.plan.id)} me={status.player_id}
            decide={stillToDecide(x.plan, rows.polls, rows.options, today)} suggestedBy={data.playersById[x.plan.organiser_id || x.plan.created_by]} />
        ))}
        <button type="button" className="btn gold block" style={{ minHeight: 56 }} onClick={() => setSuggesting(true)}>💡 Suggest a trip or round</button>
        <span className="small muted" style={{ textAlign: 'center' }}>{votesOn ? 'Everyone votes on when and where; ' : 'Everyone says if they’re in; '}{status.is_admin ? 'you lock it in' : 'the admin locks it in'}.</span>
        <TripsAi />

        {past.length > 0 && <span className="label" style={{ marginTop: 6 }}>Past trips</span>}
        {past.map((x) => <PastCard key={x.plan.id} plan={x.plan} stage={x.stage} photo={photos[x.plan.trip_id]} rounds={data.rounds.filter((r) => x.plan.trip_id && r.trip_id === x.plan.trip_id)}
          winners={trophiesOn && x.plan.trip_id ? data.honour_board.filter((h) => h.trip_id === x.plan.trip_id).sort((a, b) => a.trophy_name.localeCompare(b.trophy_name)) : []} />)}
      </div>
      {suggesting && <SuggestSheet initial={typeof suggesting === 'object' ? suggesting : null} onClose={() => setSuggesting(false)} onSaved={(p) => nav(`/plan/${p.id}`)} />}
    </div>
  );
}

/** One photo per past trip (the first one posted on it). */
function usePastPhotos(past) {
  const [photos, setPhotos] = useState({});
  const ids = (past || []).map((x) => x.plan.trip_id).filter(Boolean);
  const key = ids.join(',');
  useEffect(() => {
    if (!ids.length) return;
    let live = true;
    supabase.from('posts').select('trip_id,photo_url,created_at').in('trip_id', ids).not('photo_url', 'is', null).order('created_at').limit(200)
      .then(({ data }) => {
        if (!live) return;
        const first = {};
        for (const p of data || []) if (!first[p.trip_id]) first[p.trip_id] = p.photo_url;
        setPhotos(first);
      });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return photos;
}

function Chip({ children, strong }) {
  return (
    <span className="small" style={{ flex: 'none', padding: '4px 10px', borderRadius: 999, fontWeight: 700, whiteSpace: 'nowrap',
      background: strong ? 'var(--gold)' : 'var(--gold-soft)', border: '1px solid var(--gold)', color: 'var(--navy)' }}>{children}</span>
  );
}

function NowCard({ plan, stage, rsvps, me }) {
  const data = useData();
  const ins = rsvps.filter((r) => r.status === 'in');
  const mine = rsvps.find((r) => r.player_id === me);
  const on = stage === 'on';
  return (
    <div className="card" style={{ overflow: 'hidden', borderColor: 'var(--navy)' }}>
      <Link to={plan.tripOnly ? `/trip/${plan.trip_id}` : `/plan/${plan.id}`} className="stack" style={{ gap: 6, padding: 16, textDecoration: 'none', color: '#fff', background: 'var(--navy)' }}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <span className="small" style={{ fontWeight: 800, letterSpacing: '.04em', color: 'var(--gold)' }}>{on ? '⛳ ON NOW' : '🔒 NEXT UP'} · {plan.kind === 'round' ? 'ONE-DAY ROUND' : 'TRIP'}</span>
          {plan.start_date && !on && <Chip strong>{countdown(plan.start_date)}</Chip>}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.15 }}>{plan.name}</div>
        <div style={{ fontSize: 15, opacity: 0.9 }}>{plan.start_date ? fmtRange(plan.start_date, plan.end_date) : 'Dates TBC'} · {plan.location_name || 'Place TBC'}</div>
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <AvatarStack players={ins.map((r) => data.playersById[r.player_id]).filter(Boolean)} />
          <span className="small" style={{ opacity: 0.9 }}>{ins.length} in{!on && ` · You: ${mine ? RSVP_LABEL[mine.status] : 'not replied'}`}</span>
        </div>
      </Link>
      {on && (
        <div className="row" style={{ gap: 8, padding: 10 }}>
          <Link to="/" className="btn gold sm grow" style={{ textAlign: 'center' }}>This trip</Link>
          <Link to={`/plan/${plan.id}?tab=details`} className="btn ghost sm grow" style={{ textAlign: 'center' }}>Details</Link>
        </div>
      )}
    </div>
  );
}

function TripCard({ plan, stage, rsvps, me, decide, suggestedBy }) {
  const data = useData();
  const ins = rsvps.filter((r) => r.status === 'in');
  const mine = rsvps.find((r) => r.player_id === me);
  return (
    <Link to={plan.tripOnly ? `/trip/${plan.trip_id}` : `/plan/${plan.id}`} className="card pad stack" style={{ gap: 6, textDecoration: 'none', color: 'inherit' }}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div className="small muted" style={{ fontWeight: 700 }}>{STAGE_LABEL[stage]} · {plan.kind === 'round' ? 'One-day round' : 'Trip'}{suggestedBy && stage === 'idea' ? ` · from ${playerName(suggestedBy)}` : ''}</div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{plan.name}</div>
        </div>
        {plan.start_date && <Chip>{countdown(plan.start_date)}</Chip>}
      </div>
      <div style={{ fontSize: 15 }}>{plan.start_date ? fmtRange(plan.start_date, plan.end_date) : 'When: to be voted on'} · {plan.location_name || 'Where: to be voted on'}{plan.budget_pp ? ` · ~${money(plan.budget_pp)} each` : ''}</div>
      {decide?.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          {decide.map((d) => <span key={d} className="small" style={{ fontWeight: 700, color: 'var(--navy)' }}>🗳️ {d}</span>)}
        </div>
      )}
      <div className="row between">
        <span className="row" style={{ gap: 8 }}><AvatarStack players={ins.map((r) => data.playersById[r.player_id]).filter(Boolean)} /><span className="small muted">{ins.length} in</span></span>
        <span className="small" style={{ fontWeight: 700, color: mine ? 'var(--navy)' : 'var(--under)' }}>{mine ? `You: ${RSVP_LABEL[mine.status]}` : 'You haven’t replied'}</span>
      </div>
    </Link>
  );
}

/** A trip in the app with no plan behind it (e.g. added in Admin → Trips), shaped like a plan for the list. */
export function tripsWithoutPlan(trips, plans) {
  const linked = new Set(plans.map((p) => p.trip_id).filter(Boolean));
  const today = todayISO();
  return (trips || []).filter((t) => !linked.has(t.id)).map((t) => ({
    id: `trip-${t.id}`, tripOnly: true, kind: 'trip', name: t.name, start_date: t.start_date, end_date: t.end_date, trip_id: t.id,
    proposed: false, created_at: t.created_at, trip_status: t.status,
    status: t.status === 'active' || ((t.end_date || t.start_date) && (t.end_date || t.start_date) >= today) ? 'confirmed' : 'done',
  }));
}

function PastCard({ plan, stage, photo, rounds: roundList = [], winners = [] }) {
  const cancelled = stage === 'cancelled';
  const rounds = roundList.length;
  return (
    <div className="card" style={{ padding: 0, opacity: cancelled ? 0.55 : 1 }}>
    <Link to={plan.tripOnly ? `/trip/${plan.trip_id}` : `/plan/${plan.id}`} className="row" style={{ gap: 12, padding: 10, textDecoration: 'none', color: 'inherit' }}>
      <div style={{ width: 64, height: 64, flex: 'none', borderRadius: 10, overflow: 'hidden', background: 'var(--gold-soft)', display: 'grid', placeItems: 'center', fontSize: 26 }}>
        {photo ? <img src={photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (cancelled ? '✖️' : '⛳')}
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 17 }}>{plan.name}</div>
        <div className="small muted">{cancelled ? (plan.proposed ? 'Idea passed on' : 'Called off') : [plan.start_date ? tripWhen(plan.tripOnly ? { ...plan, status: plan.trip_status } : plan) : null, plan.location_name].filter(Boolean).join(' · ') || 'Done'}</div>
        {!cancelled && rounds > 0 && <div className="small" style={{ fontWeight: 700 }}>{rounds} round{rounds === 1 ? '' : 's'} played</div>}
        {winners.slice(0, 3).map((h) => <div key={h.id} className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🏆 {h.trophy_name}: <strong>{h.winner_names}</strong></div>)}
        {winners.length > 3 && <div className="small muted">+{winners.length - 3} more in the Trophy Room</div>}
      </div>
    </Link>
    {!cancelled && <ReplayChips rounds={roundList} style={{ padding: '0 10px 10px' }} />}
    </div>
  );
}

// ---------------------------------------------------------------- Suggest a trip

function blankDate() { return { start_date: '', end_date: '' }; }

export function SuggestSheet({ onClose, onSaved, initial = null }) {
  const { status } = useSession();
  // initial: a ready-made idea, e.g. "Same time next year?" after a quick round ({ kind, name, dates }).
  const [kind, setKind] = useState(initial?.kind || 'trip');
  const [name, setName] = useState(initial?.name || '');
  const [dates, setDates] = useState(() => (initial?.dates?.length ? [...initial.dates, blankDate()] : [blankDate(), blankDate()]));
  const [rough, setRough] = useState('');
  const [places, setPlaces] = useState(() => (initial?.place ? [{ label: initial.place, cost_pp: '' }, { label: '', cost_pp: '' }] : [{ label: '', cost_pp: '' }, { label: '', cost_pp: '' }]));
  const [budget, setBudget] = useState('');
  const [note, setNote] = useState('');
  const [closes, setCloses] = useState(defaultCloses());
  const [busy, run] = useRun();
  const votesOn = useFeature('planner_tasks');
  const opts = suggestionOptions({ dates, rough, places });
  // With votes switched off, the first date and place are simply the trip's.
  const firstDate = opts.dates.find((d) => d.start_date);

  const save = () => run(async () => {
    const each = budget === '' ? null : Number(String(budget).replace(/[^0-9.]/g, '')) || null;
    const created = await must(supabase.from('plans').insert({
      kind, name: name.trim(), status: 'planning', proposed: !status.is_admin, brief: note.trim() || null,
      ...(each ? { budget_pp: each } : {}), // only sent when given, so the form works on a database without it
      ...(!votesOn ? { start_date: firstDate?.start_date || null, end_date: firstDate?.end_date || null, location_name: opts.places[0]?.label || null } : {}),
    }).select().single());
    if (votesOn && (opts.dates.length || opts.places.length)) {
      const { error } = await supabase.rpc('start_trip_votes', { p_plan: created.id, p_dates: opts.dates, p_places: opts.places, p_closes_on: closes || null });
      if (error) toast('Saved, but the votes didn’t open — add them on the Vote tab');
    }
    await supabase.from('plan_rsvps').upsert({ plan_id: created.id, player_id: status.player_id, status: 'in' });
    await supabase.from('posts').insert({ kind: 'user', player_id: status.player_id, link: `/plan/${created.id}`,
      body: `💡 New ${kind === 'round' ? 'round' : 'trip'} idea: ${created.name}. ${opts.dates.length || opts.places.length ? 'Vote on when and where, and say if you’re in.' : 'Say if you’re in.'}` });
    const r = await notify(status.is_admin ? 'plan_new' : 'plan_proposed', { plan_id: created.id });
    // From a finished quick round: send the vote to everyone who played (they may not have notifications).
    if (initial?.share) await shareText(`📅 ${created.name}? Vote on the date and say if you’re in: ${appLink(`/plan/${created.id}`)}`);
    onClose(); onSaved?.(created);
    toast(`Up for a vote${r?.sent ? ` — ${r.sent} phone${r.sent === 1 ? '' : 's'} told` : ''}`);
  });

  const setDate = (i, patch) => setDates(dates.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const setPlace = (i, patch) => setPlaces(places.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <Sheet title="Suggest a trip or round" onClose={onClose}>
      <div className="stack">
        <div className="seg light" role="group">
          <button type="button" aria-pressed={kind === 'trip'} onClick={() => setKind('trip')}>🧳 Trip (away)</button>
          <button type="button" aria-pressed={kind === 'round'} onClick={() => setKind('round')}>⛳ One-day round</button>
        </div>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'trip' ? 'e.g. Autumn trip 2027' : 'e.g. Xmas Ambrose'} /></label>

        <span className="label">{votesOn ? 'When? (2–3 options to vote on)' : 'When?'}</span>
        {(votesOn ? dates : dates.slice(0, 1)).map((d, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: kind === 'trip' ? '1fr 1fr' : '1fr', gap: 8 }}>
            <label className="field"><span>{votesOn ? (kind === 'trip' ? `Option ${i + 1}: from` : `Option ${i + 1}`) : (kind === 'trip' ? 'From' : 'Date')}</span>
              <input className="input" type="date" value={d.start_date} min={todayISO()} onChange={(e) => setDate(i, { start_date: e.target.value, end_date: d.end_date && d.end_date >= e.target.value ? d.end_date : e.target.value })} /></label>
            {kind === 'trip' && <label className="field"><span>to</span><input className="input" type="date" value={d.end_date} min={d.start_date || undefined} onChange={(e) => setDate(i, { end_date: e.target.value })} /></label>}
          </div>
        ))}
        {votesOn && dates.length < 3 && <button type="button" className="btn ghost sm" onClick={() => setDates([...dates, blankDate()])}>+ Another date option</button>}
        {votesOn && <label className="field"><span>…or roughly (optional)</span><input className="input" value={rough} onChange={(e) => setRough(e.target.value)} placeholder="e.g. A long weekend in March" /></label>}

        <span className="label">{votesOn ? 'Where? (1–3 places)' : 'Where?'}</span>
        {(votesOn ? places : places.slice(0, 1)).map((p, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 8 }}>
            <label className="field"><span>Place {i + 1}</span><input className="input" value={p.label} onChange={(e) => setPlace(i, { label: e.target.value })} placeholder={i === 0 ? 'e.g. Port Macquarie' : ''} /></label>
            <label className="field"><span>~$ each</span><input className="input" inputMode="decimal" value={p.cost_pp} onChange={(e) => setPlace(i, { cost_pp: e.target.value })} /></label>
          </div>
        ))}
        {votesOn && places.length < 3 && <button type="button" className="btn ghost sm" onClick={() => setPlaces([...places, { label: '', cost_pp: '' }])}>+ Another place</button>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="field"><span>Rough budget each $</span><input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          {votesOn && <label className="field"><span>Votes close</span><input className="input" type="date" value={closes} min={todayISO()} onChange={(e) => setCloses(e.target.value)} /></label>}
        </div>
        <label className="field"><span>Pitch it (optional)</span><textarea className="textarea" rows={3} style={{ padding: 12 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it’d be great, who’s keen…" /></label>
        <span className="small muted">{votesOn ? `Anyone can add more options once it’s up. ${status.is_admin ? 'You lock it in when it’s decided.' : 'The admin picks the winners and locks it in.'}` : (status.is_admin ? 'You lock it in when it’s sorted.' : 'The admin locks it in.')}</span>
        <button type="button" className="btn gold block" disabled={busy || !name.trim()} onClick={save}>{votesOn ? '🗳️ Call the vote' : 'Put it to the group'}</button>
      </div>
    </Sheet>
  );
}
