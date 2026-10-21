// Trip extras on one trip's page in the planner (Planner.jsx renders <TripExtras pd={pd} />):
//   * the weather for the trip days (feature 'weather')
//   * "Same as last time" on a past trip (organisers) — copies its shape into a new trip idea (lib/repeat.js)
//   * on a trip copied from last time: who from last time hasn't said yet, and that the golf fills in at set-up
//   * a line to the trip's fines and dinner awards (feature 'dinner_awards')
// applyRepeatExtras is used by TripSetup.jsx once the rounds are made.
import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, playerName } from '../lib/store.jsx';
import { Sheet, toast } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify, shareText, appLink } from '../lib/push.js';
import { fmtRange, todayISO } from '../lib/plan.js';
import { tripStage } from '../lib/trips.js';
import { buildRepeat, describeRepeat, nextYearStart, nextName, shiftDate, extrasForRounds, notReplied } from '../lib/repeat.js';
import { TripWeather } from '../components/Weather.jsx';

export default function TripExtras({ pd }) {
  const data = useData();
  const { status } = useSession();
  const dinnerOn = useFeature('dinner_awards');
  const { plan } = pd;
  const trip = plan.trip_id ? data.trips.find((t) => t.id === plan.trip_id) : null;
  const stage = tripStage(plan, trip);
  const shapeCourseIds = (plan.repeat_shape?.rounds || []).map((r) => r.course_id);
  return (
    <>
      {stage !== 'cancelled' && stage !== 'done' && <TripWeather plan={plan} rounds={data.rounds} coursesById={data.coursesById} shapeCourseIds={shapeCourseIds} />}
      {plan.repeat_shape && stage !== 'done' && stage !== 'cancelled' && <RepeatInfo pd={pd} />}
      {dinnerOn && trip && ['locked', 'on', 'done'].includes(stage) && (
        <Link to={`/dinner/${trip.id}`} className="small" style={{ fontWeight: 700 }} data-testid="dinner-link">🍽️ Fines and dinner awards →</Link>
      )}
      {status.is_admin && !status.viewing && stage === 'done' && plan.start_date && <SameAsLastTime pd={pd} />}
    </>
  );
}

/** On a copied trip: who from last time hasn't replied, and where the golf comes from. */
function RepeatInfo({ pd }) {
  const data = useData();
  const shape = pd.plan.repeat_shape;
  const waiting = notReplied(shape.invited || [], pd.rsvps);
  const rounds = shape.rounds?.length || 0;
  const names = waiting.map((id) => playerName(data.playersById[id])).filter(Boolean);
  const nudge = async () => {
    const r = await shareText(`🔁 ${pd.plan.name}: same as last time? ${names.join(', ')} — say if you’re in: ${appLink(`/plan/${pd.plan.id}?tab=people`)}`);
    if (r === 'copied') toast('Copied — paste it into the group chat');
  };
  return (
    <div className="card pad stack" style={{ gap: 6 }} data-testid="repeat-info">
      <div className="small"><strong>🔁 Same as {shape.from_name || 'last time'}.</strong>{rounds > 0 ? ` ${rounds} round${rounds === 1 ? '' : 's'}, side comps${shape.trophies?.length ? ' and trophies' : ''} fill in when it’s set up in the app.` : ''}</div>
      {names.length > 0 ? (
        <div className="row between" style={{ gap: 8 }}>
          <span className="small muted grow">In last time, not replied yet: {names.join(', ')}</span>
          <button type="button" className="btn ghost sm" onClick={nudge}>Nudge</button>
        </div>
      ) : (shape.invited?.length > 0 && <span className="small muted">Everyone from last time has replied.</span>)}
    </div>
  );
}

/** Organisers, on a past trip: "Same as last time" → confirm card → a new trip idea. */
function SameAsLastTime({ pd }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="card pad row" onClick={() => setOpen(true)} style={{ textAlign: 'left', color: 'inherit', width: '100%', gap: 12, borderColor: 'var(--navy)' }}>
        <span style={{ fontSize: 26 }} aria-hidden>🔁</span>
        <span className="grow"><strong>Same as last time</strong><div className="small muted">A new trip idea with the same place, courses, formats, comps, jobs and crew — on new dates.</div></span>
        <span className="btn sm">Copy</span>
      </button>
      {open && <RepeatSheet pd={pd} onClose={() => setOpen(false)} />}
    </>
  );
}

function RepeatSheet({ pd, onClose }) {
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const gamesOn = useFeature('games');
  const sideCompsOn = useFeature('side_comps');
  const { plan } = pd;
  const [start, setStart] = useState(() => {
    const n = nextYearStart(plan.start_date);
    return n > todayISO() ? n : todayISO();
  });
  const length = plan.end_date && plan.start_date ? Math.max(0, Math.round((new Date(plan.end_date) - new Date(plan.start_date)) / 864e5)) : 0;
  const [end, setEnd] = useState(() => shiftDate(start, length));
  const [name, setName] = useState(() => nextName(plan.name, plan.start_date, start));
  const [extra, setExtra] = useState({ games: [], comps: [] });
  const [busy, run] = useRun();
  const tripRounds = useMemo(() => data.rounds.filter((r) => plan.trip_id && r.trip_id === plan.trip_id), [data.rounds, plan.trip_id]);
  React.useEffect(() => {
    let live = true;
    const ids = tripRounds.map((r) => r.id);
    Promise.all([
      gamesOn && ids.length ? supabase.from('round_games').select('*').in('round_id', ids) : { data: [] },
      sideCompsOn ? supabase.from('side_comp_defs').select('id,name,retired') : { data: [] },
    ]).then(([g, c]) => live && setExtra({ games: g.error ? [] : g.data || [], comps: c.error ? [] : c.data || [] }), () => {});
    return () => { live = false; };
  }, [tripRounds, gamesOn, sideCompsOn]);

  const built = useMemo(() => buildRepeat({
    plan, rounds: tripRounds, games: extra.games, items: pd.items, rsvps: pd.rsvps,
    trophies: data.trophies.filter((t) => plan.trip_id && t.trip_id === plan.trip_id), start, end, name, me: status.player_id,
  }), [plan, tripRounds, extra.games, pd.items, pd.rsvps, data.trophies, start, end, name, status.player_id]);
  const lines = describeRepeat(built, {
    coursesById: data.coursesById, compsById: Object.fromEntries(extra.comps.map((c) => [c.id, c])),
    playersById: data.playersById, nameOf: playerName,
  });

  const go = () => run(async () => {
    const created = await must(supabase.from('plans').insert(built.plan).select().single());
    const problems = [];
    if (built.items.length) {
      const { error } = await supabase.from('plan_items').insert(built.items.map((i) => ({ ...i, plan_id: created.id })));
      if (error) problems.push('the jobs and bring list');
    }
    await supabase.from('plan_rsvps').upsert({ plan_id: created.id, player_id: status.player_id, status: 'in' });
    const others = built.invited.filter((id) => id !== status.player_id).map((id) => playerName(data.playersById[id])).filter(Boolean);
    await supabase.from('posts').insert({ kind: 'user', player_id: status.player_id, link: `/plan/${created.id}`,
      body: `🔁 Same as last time: ${created.name}, ${fmtRange(created.start_date, created.end_date)}${created.location_name ? ` at ${created.location_name}` : ''}.${others.length ? ` ${others.join(', ')} — you were in last time. Are you in again?` : ' Say if you’re in.'}` });
    const r = await notify('plan_new', { plan_id: created.id });
    if (problems.length) toast(`Trip idea made, but ${problems.join(' and ')} didn’t copy`);
    else toast(`Trip idea made${r?.sent ? ` — ${r.sent} phone${r.sent === 1 ? '' : 's'} told` : ''}`);
    onClose();
    nav(`/plan/${created.id}`);
  });

  return (
    <Sheet title="Same as last time" onClose={onClose}>
      <div className="stack" data-testid="repeat-sheet">
        <span className="small muted">Copies “{plan.name}” into a new trip idea. Nothing is booked and nobody is marked in — they’re asked.</span>
        <label className="field"><span>Name</span><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: plan.kind === 'round' ? '1fr' : '1fr 1fr', gap: 8 }}>
          <label className="field"><span>{plan.kind === 'round' ? 'Date' : 'From'}</span>
            <input className="input" style={{ minWidth: 0 }} type="date" value={start} min={todayISO()} onChange={(e) => { const v = e.target.value; if (!v) return; setStart(v); setEnd(shiftDate(v, length)); }} /></label>
          {plan.kind !== 'round' && <label className="field"><span>to</span><input className="input" style={{ minWidth: 0 }} type="date" value={end || ''} min={start} onChange={(e) => setEnd(e.target.value)} /></label>}
        </div>
        <div className="card pad stack" style={{ gap: 4 }}>
          <strong>{built.plan.name}</strong>
          <span className="small">{fmtRange(built.plan.start_date, built.plan.end_date)}{built.plan.location_name ? ` · ${built.plan.location_name}` : ''}</span>
          {lines.map((l) => <span key={l} className="small" data-testid="repeat-line">• {l}</span>)}
          {!lines.length && <span className="small muted">Just the place and dates — the past trip had no rounds, jobs or crew to copy.</span>}
        </div>
        <span className="small muted">The rounds, side comps, games and trophies are set up when you tap “Set it up in the app” on the new trip — so the dates can still change.</span>
        <button type="button" className="btn gold block" style={{ minHeight: 56 }} disabled={busy || !name.trim() || !start} onClick={go}>Make the trip idea</button>
      </div>
    </Sheet>
  );
}

/**
 * After "Set it up in the app" makes the rounds of a trip copied from last time: put the side comp holes, own side
 * comps and games back on. Each bit is tried on its own; returns how many didn't save (0 = all good).
 */
export async function applyRepeatExtras(plan, made, { gamesOn = true } = {}) {
  const shape = plan?.repeat_shape;
  if (!shape?.rounds?.length || !made?.length) return 0;
  const { data: defs } = await supabase.from('side_comp_defs').select('id');
  const extras = extrasForRounds(shape, made, plan.start_date, { ownCompIds: defs ? defs.map((d) => d.id) : [], gamesOn });
  let failed = 0;
  for (const x of extras) {
    if (Object.keys(x.patch).length) {
      const { error } = await supabase.from('rounds').update(x.patch).eq('id', x.round_id);
      if (error) failed += 1;
    }
    if (x.games.length) {
      const { error } = await supabase.from('round_games').insert(x.games);
      if (error) failed += 1;
    }
  }
  return failed;
}
