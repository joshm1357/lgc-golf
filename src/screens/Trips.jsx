// The Trips tab: every trip in one list, one section per stage, each looking different (ov25, Josh 23 Oct):
// ⛳ On now · 🔒 Upcoming · 🧭 Being organised · 💡 Proposed · 🏁 Previous · ✖️ Called off (folded away).
// A trip moves idea → deciding → locked in → on → done (see lib/trips.js); the looks are in lib/runup.js and
// components/runup.css. Tapping one opens it (Planner.jsx) — an Upcoming trip opens on The run-up.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName, cacheGet, cacheSet, useFeature } from '../lib/store.jsx';
import { Header, AvatarStack, Sheet, Loading, toast } from '../components/ui.jsx';
import { RSVP_LABEL, todayISO, money } from '../lib/plan.js';
import { sortTrips, stillToDecide, suggestionOptions, defaultCloses, tripWhen } from '../lib/trips.js';
import { STAGE_LOOK, stageLook, stageTag, stageSections, mainTrophy } from '../lib/runup.js';
import '../components/runup.css';
import { notify, shareText, appLink } from '../lib/push.js';
import { useRun, must } from '../lib/run.js';
import { NotifyCard } from '../components/NotifyCard.jsx';
import { TripsAi } from './AiPlanner.jsx';
import { ReplayChips } from '../components/ReplayChips.jsx';
import { tripsMenu, tripNowPath, tripPath, tripDayWords } from '../lib/activetrip.js';
import { openPlanner } from '../components/Caddie.jsx';
import { SaveSpotBanner } from '../components/SaveSpot.jsx';

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
  // ov21: which trip is on right now (a round live or today) — the same pick as the sidebar's sub-items.
  const menu = useMemo(() => tripsMenu({ trips: data.trips, rounds: data.rounds, plans: rows?.plans || [], today }), [data.trips, data.rounds, rows, today]);
  // ov25: one section per stage, each with its own look — On now, Upcoming, Being organised, Proposed, Previous, Called off.
  const sections = useMemo(() => {
    if (!sorted) return [];
    const onTrip = menu.now?.on ? menu.now.trip.id : null;
    const lift = (x) => (onTrip && x.plan.trip_id === onTrip && x.stage === 'locked' ? { ...x, stage: 'on' } : x);
    return stageSections({ now: sorted.now && lift(sorted.now), later: sorted.later.map(lift), ideas: sorted.ideas, past: sorted.past });
  }, [sorted, menu]);

  if (!rows) return <div className="page"><Header logo title="Trips" /><Loading /></div>;
  const rsvpsOf = (id) => rows.rsvps.filter((r) => r.plan_id === id);
  const has = (stage) => sections.some((s) => s.stage === stage);
  const offList = sections.find((s) => s.stage === 'cancelled')?.items || [];
  const suggestButton = (
    <>
      <button type="button" className="btn gold block" style={{ minHeight: 56 }} onClick={() => setSuggesting(true)}>💡 Suggest a trip or round</button>
      <span className="small muted" style={{ textAlign: 'center' }}>{votesOn ? 'Everyone votes on when and where; ' : 'Everyone says if they’re in; '}{status.is_admin ? 'you lock it in' : 'the admin locks it in'}.</span>
    </>
  );
  const card = (x, i) => (
    <StageCard key={x.plan.id} x={x} first={i === 0} rsvps={rsvpsOf(x.plan.id)} me={status.player_id} polls={rows.polls} options={rows.options} today={today}
      photo={photos[x.plan.trip_id]} rounds={x.plan.trip_id ? data.rounds.filter((r) => r.trip_id === x.plan.trip_id) : []}
      winners={trophiesOn && x.plan.trip_id ? data.honour_board.filter((h) => h.trip_id === x.plan.trip_id) : []} plans={rows.plans} />
  );

  return (
    <div className="page">
      <Header logo title="Trips" sub="Every trip, from first idea to the record books" />
      {/* ov21 made Trips the Home screen when no trip's on; the phone-only "Save your spot" reminder belongs on Home. */}
      <SaveSpotBanner />
      <div className="section stack trips-stage">
        {notifyOn && <NotifyCard compact />}
        {rows.offline && <div className="small muted">No signal — showing the list from last time.</div>}
        {rows.failed && <div className="err">Couldn’t load the trips — check your signal and open Trips again.</div>}

        {!has('on') && !has('locked') && (
          <button type="button" className="card pad row" data-testid="trips-plan-it" onClick={openPlanner}
            style={{ gap: 12, textAlign: 'left', width: '100%', borderColor: 'var(--gold)', background: 'var(--gold-soft)', color: 'inherit' }}>
            <span style={{ fontSize: 28 }} aria-hidden="true">✨</span>
            <span className="grow"><strong style={{ fontSize: 18 }}>Plan a trip</strong>
              <div className="small muted">No trip coming up. The caddie helps you pick when and where, then puts it to the group.</div></span>
          </button>
        )}

        {sections.filter((s) => s.stage !== 'cancelled').map((s) => (
          <div key={s.stage} className="stack" style={{ gap: 10 }} data-testid={s.stage === 'deciding' ? 'trips-being-planned' : `trips-section-${s.stage}`}>
            <div className="stage-head"><span className="label">{s.look.icon} {s.look.label}</span><span className="small muted">{s.items.length}</span></div>
            {s.items.map(card)}
            {s.stage === 'idea' && suggestButton}
          </div>
        ))}
        {!has('idea') && (
          <div className="stack" style={{ gap: 10 }} data-testid="trips-section-idea">
            <div className="stage-head"><span className="label">{STAGE_LOOK.idea.icon} {STAGE_LOOK.idea.label}</span></div>
            <div className="small muted">No ideas on the go.</div>
            {suggestButton}
          </div>
        )}
        <TripsAi />

        {offList.length > 0 && (
          <details className="card" data-testid="called-off" style={{ padding: '10px 14px' }}>
            <summary style={{ fontWeight: 700, cursor: 'pointer', minHeight: 32 }}>{STAGE_LOOK.cancelled.icon} Called off · {offList.length}</summary>
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {offList.map((x, i) => (
                <StageCard key={x.plan.id} x={x} first={i === 0} rsvps={[]} me={status.player_id} today={today} by={data.playersById[x.plan.cancelled_by]} plans={rows.plans} />
              ))}
            </div>
          </details>
        )}
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

// The old first-card test ids, kept so links and tests that look for them still find the right card.
const FIRST_ID = { on: 'trips-on', locked: 'trips-next', done: 'trips-last' };

/**
 * ov25: one trip on the Trips list, looking like its stage (components/runup.css):
 *   On now gold · Upcoming navy with the countdown · Being organised outline · Proposed dashed · Previous muted ·
 *   Called off grey. The tag on the right: "Day 2 of 3" / "16 days" / "voting on dates" / "3 keen" / "Oct 2025".
 */
function StageCard({ x, first, rsvps, me, polls = [], options = [], today, photo = null, rounds = [], winners = [], by = null, plans = [] }) {
  const data = useData();
  const { plan, stage } = x;
  const look = stageLook(stage);
  const trip = plan.trip_id ? data.trips.find((t) => t.id === plan.trip_id) : null;
  const ins = rsvps.filter((r) => r.status === 'in');
  const mine = rsvps.find((r) => r.player_id === me);
  const tag = stageTag({ stage, plan, polls, rsvps, today, dayWords: stage === 'on' && trip ? tripDayWords(trip, data.rounds) : null });
  const to = stage === 'on' && trip ? tripNowPath(trip) : plan.tripOnly ? `/trip/${plan.trip_id}` : `/plan/${plan.id}`;
  const early = stage === 'idea' || stage === 'deciding';
  const when = plan.start_date ? tripWhen(plan.tripOnly ? { ...plan, status: plan.trip_status } : plan) : (early ? 'When: to be voted on' : 'Dates to come');
  const where = plan.location_name || (early ? 'Where: to be voted on' : null);
  const decide = early ? stillToDecide(plan, polls, options, today) : [];
  const who = stage === 'idea' ? data.playersById[plan.organiser_id || plan.created_by] : stage === 'deciding' ? data.playersById[plan.organiser_id] : null;
  // Previous: the main trophy's winner first, then up to two more (the rest are in the Trophy Room).
  const main = stage === 'done' ? mainTrophy(winners) : null;
  const wins = main ? [main, ...winners.filter((h) => h !== main).sort((a, b) => a.trophy_name.localeCompare(b.trophy_name))] : [];
  return (
    <div className={`card trip-card ${look.cls}`} data-testid={first && FIRST_ID[stage] ? FIRST_ID[stage] : 'trip-card'} data-stage={look.key}>
      <Link to={to} className="trip-card-top" style={{ textDecoration: 'none' }}>
        <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
          <span className="stage-pill" data-testid="stage-pill">{look.icon} {look.label}{plan.kind === 'round' ? ' · one-day round' : ''}</span>
          <span className="stage-tag" data-testid="stage-tag">{tag}</span>
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          {stage === 'done' && (
            <span style={{ width: 56, height: 56, flex: 'none', borderRadius: 10, overflow: 'hidden', background: 'var(--line-soft)', display: 'grid', placeItems: 'center', fontSize: 24 }}>
              {photo ? <img src={photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '⛳'}
            </span>
          )}
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="trip-card-name">{plan.name}</div>
            <div className="small" style={{ opacity: 0.9 }}>{stage === 'cancelled' ? (plan.proposed ? 'Idea passed on' : `Called off${by ? ` by ${playerName(by)}` : ''}`) : [when, where].filter(Boolean).join(' · ')}{plan.budget_pp && early ? ` · ~${money(plan.budget_pp)} each` : ''}</div>
            {who && <div className="small" style={{ opacity: 0.85 }}>{stage === 'idea' ? `from ${playerName(who)}` : `organiser ${playerName(who)}`}</div>}
            {wins.slice(0, 3).map((h, i) => (
              <div key={h.id || h.trophy_name} className="small ellipsis" style={{ fontWeight: i === 0 ? 700 : 500 }} data-testid={i === 0 ? 'winner-line' : undefined}>🏆 {h.trophy_name}: <strong>{h.winner_names}</strong></div>
            ))}
            {wins.length > 3 && <div className="small muted">+{wins.length - 3} more in the Trophy Room</div>}
            {stage === 'done' && rounds.length > 0 && <div className="small muted">{rounds.length} round{rounds.length === 1 ? '' : 's'} played</div>}
          </div>
        </div>
        {decide.length > 0 && (
          <div className="stack" style={{ gap: 2 }}>
            {decide.map((d) => <span key={d} className="small" style={{ fontWeight: 700, color: 'var(--navy)' }}>🗳️ {d}</span>)}
          </div>
        )}
        {['on', 'locked', 'deciding', 'idea'].includes(stage) && !plan.tripOnly && (
          <div className="row between" style={{ gap: 8 }}>
            <span className="row" style={{ gap: 8 }}><AvatarStack players={ins.map((r) => data.playersById[r.player_id]).filter(Boolean)} /><span className="small" style={{ opacity: 0.85 }}>{ins.length} in</span></span>
            {stage !== 'on' && <span className="small" style={{ fontWeight: 700 }}>{mine ? `You: ${RSVP_LABEL[mine.status]}` : 'You haven’t replied'}</span>}
          </div>
        )}
      </Link>
      {(stage === 'on' || stage === 'locked') && trip && (
        <div className="row" style={{ gap: 8, padding: '8px 10px' }}>
          <Link to={tripNowPath(trip)} className={stage === 'on' ? 'btn gold sm grow' : 'btn ghost sm grow'} style={{ textAlign: 'center' }}>Trip status</Link>
          <Link to={tripPath(trip, plans)} className="btn ghost sm grow" style={{ textAlign: 'center' }}>{stage === 'locked' ? 'The run-up' : 'Trip page'}</Link>
        </div>
      )}
      {stage === 'done' && <ReplayChips rounds={rounds} style={{ padding: '0 10px 10px' }} />}
    </div>
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
