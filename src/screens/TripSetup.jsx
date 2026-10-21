// Admin: set a trip up for the golf — a round per day and the trophies — in one go.
// Locking a trip in already makes its trip in the app (the database does it, once); this adds the rounds to it.
// A plan from before Stage 1b with no trip yet gets one made here, as before.
import React, { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature } from '../lib/store.jsx';
import { Sheet, toast } from '../components/ui.jsx';
import { FindCourse } from '../components/CourseLibrary.jsx';
import { fmtRange, parseDate, daysUntil, roundSettingsFromRules } from '../lib/plan.js';
import { useRun, must, feedPost } from './Planner.jsx';
import { formatName } from '../lib/board.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function planDays(plan) {
  const a = parseDate(plan.start_date);
  if (!a) return [];
  const b = parseDate(plan.end_date) || a;
  const out = [];
  for (let d = new Date(a); d <= b && out.length < 10; d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
}

export function TripSetupCard({ plan, reload }) {
  const data = useData();
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  if (!status.is_admin || plan.proposed || !plan.start_date || plan.status === 'cancelled' || plan.status === 'done') return null;
  const trip = plan.trip_id && data.trips.find((t) => t.id === plan.trip_id);
  const n = trip ? data.rounds.filter((r) => r.trip_id === trip.id).length : 0;
  if (trip && n > 0) {
    return <div className="small" style={{ fontWeight: 600 }}>✅ Set up in the app as “{trip.name}” · {n} round{n === 1 ? '' : 's'} · {trip.status === 'active' ? 'current trip' : 'becomes the current trip on its first day'}</div>;
  }
  return (
    <>
      <button type="button" className="card pad row" onClick={() => setOpen(true)} style={{ textAlign: 'left', color: 'inherit', width: '100%', borderColor: 'var(--navy)', gap: 12 }}>
        <span style={{ fontSize: 26 }}>🏌️</span>
        <span className="grow"><strong>{plan.trip_id ? 'Add the rounds' : 'Set it up in the app'}</strong><div className="small muted">A round for each day and the trophies — ready for scoring.</div></span>
        <span className="btn sm">Set up</span>
      </button>
      {open && <TripSetupSheet plan={plan} onClose={() => setOpen(false)} onDone={reload} />}
    </>
  );
}

function TripSetupSheet({ plan, onClose, onDone }) {
  const data = useData();
  const bonusOn = useFeature('comp_bonus');
  const trophiesOn = useFeature('trophies');
  const { status } = useSession();
  const [busy, run] = useRun();
  const days = useMemo(() => planDays(plan), [plan]);
  const lastTrip = data.trips.find((t) => t.id !== plan.trip_id && data.trophies.some((x) => x.trip_id === t.id));
  const lastTrophies = lastTrip ? data.trophies.filter((x) => x.trip_id === lastTrip.id) : [];
  const soon = daysUntil(plan.start_date) <= 7;
  const [name, setName] = useState(plan.name);
  const [copyTrophies, setCopyTrophies] = useState(plan.kind === 'trip' && lastTrophies.length > 0);
  const [current, setCurrent] = useState(soon);
  const [rounds, setRounds] = useState(() => days.map((d, i) => ({ date: d, course_id: '', format: plan.kind === 'trip' && i === days.length - 1 && days.length > 1 ? 'ambrose' : 'stableford' })));
  const set = (i, patch) => setRounds(rounds.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rounds.filter((r) => r.course_id);
  const [finding, setFinding] = useState(false);

  const go = () => run(async () => {
    const { data: rules } = await supabase.from('rules').select('*').eq('status', 'active');
    // 1. The trip: the one made when it was locked in, or (older plans) a new one linked straight away — so a retry
    //    after a hiccup can't make a second one.
    const { data: had } = plan.trip_id ? await supabase.from('trips').select('*').eq('id', plan.trip_id).maybeSingle() : { data: null };
    let trip = had;
    if (trip) {
      trip = await must(supabase.from('trips').update({ name: name.trim(), status: current ? 'active' : trip.status }).eq('id', trip.id).select().single());
      if (plan.status === 'planning') await must(supabase.from('plans').update({ status: 'confirmed' }).eq('id', plan.id));
    } else {
      trip = await must(supabase.from('trips').insert({ name: name.trim(), start_date: plan.start_date, end_date: plan.end_date || plan.start_date, status: current ? 'active' : 'locked' }).select().single());
      await must(supabase.from('plans').update({ trip_id: trip.id, status: plan.status === 'planning' ? 'confirmed' : plan.status }).eq('id', plan.id));
    }
    const problems = [];
    if (trophiesOn && copyTrophies && lastTrophies.length) {
      const { error } = await supabase.from('trophies').insert(lastTrophies.map((x) => ({ trip_id: trip.id, name: x.name, type: x.type, description: x.description })));
      if (error) problems.push('the trophies');
    }
    if (chosen.length) {
      const { error } = await supabase.from('rounds').insert(chosen.map((r) => {
        const course = data.coursesById[r.course_id];
        const s = roundSettingsFromRules(rules || [], r.format);
        return {
          trip_id: trip.id, course_id: r.course_id, play_date: r.date, format: r.format, status: 'setup',
          name: `${DOW[parseDate(r.date).getDay()]} ${formatName(r.format)} — ${course?.name || ''}`.trim(),
          ...(r.format === 'ambrose' ? { comp_bonus: bonusOn ? s.comp_bonus ?? 0 : 0, min_drives: s.min_drives } : {}),
          rules: s.text || null,
        };
      }));
      if (error) problems.push('the rounds');
    }
    // 2. Only now close the old trip (and any round still live in it), so there's never no current trip.
    if (current) {
      const others = data.trips.filter((t) => t.status === 'active' && t.id !== trip.id).map((t) => t.id);
      if (others.length) {
        await supabase.from('trips').update({ status: 'locked' }).in('id', others);
        await supabase.from('rounds').update({ status: 'locked' }).in('trip_id', others).eq('status', 'live');
      }
    }
    if (problems.length) toast(`Trip made, but ${problems.join(' and ')} didn't save — add them in Admin.`);
    await feedPost(status.player_id, plan, `🏌️ ${trip.name} is set up in the app${chosen.length ? ` — ${chosen.length} round${chosen.length === 1 ? '' : 's'} ready` : ''}. See you on the first tee.`);
    data.reload();
    onDone();
    onClose();
    toast(current ? 'Done — it’s the current trip now' : 'Done — it becomes the current trip on its first day');
  });

  return (
    <Sheet title="Set it up in the app" onClose={onClose}>
      <div className="stack">
        <label className="field"><span>Trip name (shows on the trophies and honour boards)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <span className="label">Rounds · {fmtRange(plan.start_date, plan.end_date)}</span>
        {rounds.map((r, i) => (
          <div key={r.date} className="card pad stack" style={{ gap: 6 }}>
            <strong>{fmtRange(r.date)}</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
              <select className="select" value={r.course_id} onChange={(e) => set(i, { course_id: e.target.value })} aria-label="Course">
                <option value="">No golf / add later</option>
                {data.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="select" value={r.format} onChange={(e) => set(i, { format: e.target.value })} aria-label="Format">
                <option value="stableford">Stableford</option>
                <option value="ambrose">Ambrose</option>
                <option value="stroke">Stroke play</option>
                <option value="fourball">4BBB (pairs)</option>
              </select>
            </div>
          </div>
        ))}
        {finding ? (
          <div className="card pad stack" style={{ gap: 8 }}>
            <strong>📚 Find a course in the library</strong>
            <FindCourse hint="add it in Admin → Courses" onAdded={(id) => {
              setFinding(false);
              // Put the new course on the first round that hasn't got one.
              setRounds((rs) => { const i = rs.findIndex((r) => !r.course_id); return i < 0 ? rs : rs.map((r, j) => (j === i ? { ...r, course_id: id } : r)); });
            }} />
          </div>
        ) : <button type="button" className="btn ghost block" onClick={() => setFinding(true)}>📚 Course not listed? Find it in the library</button>}
        <span className="small muted">Not in the library either? Add it in Admin → Courses (par and stroke index), then pick it here. Ambrose rounds take the side comp and drive rules from the Rulebook. Teams and side comp holes are set nearer the day.</span>
        {trophiesOn && lastTrophies.length > 0 && (
          <label className="row" style={{ gap: 8, fontWeight: 600 }}>
            <input type="checkbox" checked={copyTrophies} onChange={(e) => setCopyTrophies(e.target.checked)} style={{ width: 20, height: 20 }} />
            <span>Play for the same trophies ({lastTrophies.map((x) => x.name).join(', ')})</span>
          </label>
        )}
        <label className="row" style={{ gap: 8, fontWeight: 600, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2 }} />
          <span>Make it the current trip now<div className="small muted" style={{ fontWeight: 400 }}>{current ? 'The leaderboard and trophies switch to this trip; the current trip (and any round still live in it) is closed off.' : 'It waits, closed, until you reopen it in Admin → Trips.'}</div></span>
        </label>
        <button type="button" className="btn gold block" style={{ minHeight: 56 }} disabled={busy || !name.trim()} onClick={go}>
          Set it up{chosen.length ? ` — ${chosen.length} round${chosen.length === 1 ? '' : 's'}` : ''}
        </button>
      </div>
    </Sheet>
  );
}
