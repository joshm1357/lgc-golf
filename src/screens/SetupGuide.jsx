// "Set up your trip": the guided setup for organisers (21 Oct 2026). Five steps on one screen — trip, courses,
// rounds, players, extras — each ticked off from what's already in the group, so you can do them in any order and
// come back to change one. Admin stays for fine-tuning. The step logic is in lib/setupguide.js.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { Header, Loading } from '../components/ui.jsx';
import { FindCourse } from '../components/CourseLibrary.jsx';
import { InviteCard } from './Group.jsx';
import { OwnCompsAdmin, RoundOwnComps } from './OwnComps.jsx';
import { SetupGames } from './Games.jsx';
import { TeeGroupsForTrip } from './TeeGroups.jsx';
import { upcomingTrips, tripDays, dayLabel, roundName, setupSteps, nextAction } from '../lib/setupguide.js';
import { parseHoles } from '../lib/sidecomps.js';
import { SetupHelperBox } from './AiHelper.jsx';
import { ImportCard } from './AiImport.jsx';
import { CompsStep, RoundCompsCard } from './CompsBoard.jsx';
import { useTripComps } from '../components/CompsChip.jsx';

const FORMATS = [
  { value: 'stableford', label: 'Stableford (individual)' },
  { value: 'ambrose', label: 'Ambrose (teams)' },
  { value: 'stroke', label: 'Stroke play (individual, net)' },
  { value: 'fourball', label: '4BBB (pairs, better-ball Stableford)' },
];
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function SetupGuide() {
  const data = useData();
  const { status } = useSession();
  const cupOn = useFeature('cup');
  const sideCompsOn = useFeature('side_comps');
  const [params] = useSearchParams();
  const [tripId, setTripId] = useState(() => params.get('trip')); // the trip being set up (default: the nearest one that isn't over; ?trip= from the Caddie)
  const candidates = data.ready ? upcomingTrips(data.trips, todayIso()) : [];
  const trip = (tripId && tripId !== 'new' && data.trips?.find((t) => t.id === tripId)) || (tripId === 'new' ? null : candidates[0] || null);
  const [comps] = useTripComps(trip?.id);
  const steps = data.ready ? setupSteps({ ...data, comps }, { cup: cupOn, side_comps: sideCompsOn }, trip) : [];
  const firstTodo = steps.find((s) => !s.done && !s.optional)?.key;
  const [open, setOpen] = useState(null);
  useEffect(() => { if (open == null && data.ready) setOpen(firstTodo || 'none'); }, [data.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data.ready) return <Loading />;
  if (!status?.is_admin) {
    return <div className="page"><Header back title="Set up your trip" /><div className="empty">Only the organiser sets the trip up.</div></div>;
  }
  const rounds = trip ? data.rounds.filter((r) => r.trip_id === trip.id) : [];
  const hasPlayers = (r) => ((r.format === 'ambrose' || r.format === 'fourball') ? (data.teamsByRound[r.id] || []).length : (data.roundPlayers[r.id] || []).length) > 0;
  const next = nextAction(steps, rounds, todayIso(), hasPlayers);
  const doneCount = steps.filter((s) => s.done && !s.optional).length;
  const needed = steps.filter((s) => !s.optional).length;

  const body = {
    trip: <TripStep key={trip?.id || 'new'} trip={trip} onNew={() => setTripId('new')} onDone={(id) => { setTripId(id); setOpen('courses'); }} />,
    courses: <CoursesStep onDone={() => setOpen('rounds')} />,
    rounds: <RoundsStep trip={trip} onDone={() => setOpen('players')} />,
    comps: <CompsStep trip={trip} onStep={setOpen} />,
    players: <PlayersStep cupOn={cupOn} />,
    extras: <ExtrasStep trip={trip} sideCompsOn={sideCompsOn} cupOn={cupOn} />,
  };

  return (
    <div className="page">
      <Header back title="Set up your trip" sub={`${doneCount} of ${needed} done`} />
      <div className="section stack" style={{ gap: 10 }}>
        <SetupHelperBox onApplied={(id) => { if (id) setTripId(id); setOpen('players'); }} />
        <ImportCard />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${needed}, 1fr)`, gap: 4 }} aria-hidden="true">
          {steps.filter((s) => !s.optional).map((s) => <span key={s.key} style={{ height: 6, borderRadius: 3, background: s.done ? 'var(--gold)' : 'var(--line-soft, #E3E7EC)' }} />)}
        </div>
        {(candidates.length > 1 || (tripId === 'new' && candidates.length > 0)) && (
          <div className="chips" role="group" aria-label="Which trip">
            {candidates.map((t) => <button key={t.id} type="button" className="chip" aria-pressed={trip?.id === t.id} onClick={() => setTripId(t.id)}>{t.name}</button>)}
            <button type="button" className="chip" aria-pressed={tripId === 'new'} onClick={() => { setTripId('new'); setOpen('trip'); }}>+ New trip</button>
          </div>
        )}
        <NextUp next={next} onStep={setOpen} />
        {steps.map((s, i) => (
          <div key={s.key} className="card" style={{ overflow: 'hidden', borderColor: open === s.key ? 'var(--navy)' : undefined }}>
            <button type="button" className="row" aria-expanded={open === s.key} onClick={() => setOpen(open === s.key ? 'none' : s.key)}
              style={{ width: '100%', padding: 14, background: 'none', border: 0, gap: 12, textAlign: 'left', color: 'inherit', font: 'inherit' }}>
              <span aria-hidden="true" style={{ width: 30, height: 30, flex: 'none', borderRadius: 15, display: 'grid', placeItems: 'center', fontWeight: 800,
                background: s.done ? 'var(--gold)' : 'transparent', border: s.done ? 0 : '2px solid var(--line, #C9D0D8)' }}>{s.done ? '✓' : i + 1}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <strong>{s.title}{s.optional ? <span className="small muted"> · optional</span> : null}</strong>
                <div className="small muted ellipsis">{s.summary}</div>
              </span>
              <span className="muted">{open === s.key ? '−' : s.done ? 'Change' : '+'}</span>
            </button>
            {open === s.key && <div style={{ padding: '0 14px 14px' }} className="stack">{body[s.key]}</div>}
          </div>
        ))}
        <p className="note" style={{ margin: '4px' }}>Everything here can be changed later. For the finer details (teams for Ambrose, playing handicaps, trophies) use <Link to="/admin">Admin</Link>.</p>
      </div>
    </div>
  );
}

function NextUp({ next, onStep }) {
  const nav = useNavigate();
  const [busy, run] = useRun();
  const data = useData();
  if (next.kind === 'step') return null;
  return (
    <div className="card pad stack" style={{ gap: 8, background: 'var(--gold-soft)', borderColor: 'var(--gold)' }}>
      <strong>{next.kind === 'players' ? '👥' : '✅'} {next.label}</strong>
      {next.kind === 'players' && (
        <>
          <span className="small">{next.round.format === 'ambrose' ? 'Make the teams' : next.round.format === 'fourball' ? 'Make the pairs' : 'Add who’s playing'} in Admin → Rounds &amp; teams.</span>
          <Link to="/admin" className="btn gold sm" style={{ alignSelf: 'flex-start' }}>Go to Admin</Link>
        </>
      )}
      {next.kind === 'start' && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn gold sm" disabled={busy} onClick={() => {
            if (!window.confirm(`Start ${next.round.name} now? Scores can be entered once it’s live.`)) return;
            run(async () => {
              await must(supabase.from('rounds').update({ status: 'live' }).eq('id', next.round.id));
              await data.reload();
              nav('/');
            }, 'Round started');
          }}>Start {next.round.name}</button>
          <button type="button" className="btn ghost sm" onClick={() => onStep('extras')}>Add side comps first</button>
        </div>
      )}
      {next.kind === 'live' && <Link to="/" className="btn gold sm">Go to the leaderboard</Link>}
    </div>
  );
}

function TripStep({ trip, onDone, onNew }) {
  const data = useData();
  const [busy, run] = useRun();
  const [name, setName] = useState(trip?.name || '');
  const [start, setStart] = useState(trip?.start_date || '');
  const [end, setEnd] = useState(trip?.end_date || '');
  const ok = name.trim().length >= 2 && start && (!end || end >= start);
  const save = () => run(async () => {
    const row = { name: name.trim(), start_date: start, end_date: end || start };
    let id = trip?.id;
    if (trip) await must(supabase.from('trips').update(row).eq('id', trip.id));
    else id = (await must(supabase.from('trips').insert(row).select('id').single())).id;
    await data.reload();
    onDone(id);
  }, trip ? 'Trip saved' : 'Trip made');
  return (
    <>
      <label className="field"><span>Trip name</span><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hunter Valley 2026" /></label>
      <div className="row" style={{ gap: 8 }}>
        <label className="field grow"><span>First day</span><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field grow"><span>Last day</span><input className="input" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      {end && start && end < start && <span className="small err">The last day is before the first.</span>}
      <button type="button" className="btn gold" disabled={busy || !ok} onClick={save}>{trip ? 'Save changes to this trip' : 'Make the trip'}</button>
      {trip && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onNew}>This is a different trip — start a new one</button>}
    </>
  );
}

function CoursesStep({ onDone }) {
  const data = useData();
  return (
    <>
      {data.courses.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Your courses</span>
          {data.courses.map((c) => <div key={c.id} className="small">⛳ <strong>{c.name}</strong>{c.holes?.length ? ` · ${c.holes.length} holes` : ' · no scorecard yet'}</div>)}
          <button type="button" className="btn sm" onClick={onDone}>Next: the rounds →</button>
        </div>
      )}
      <span className="label">Add a course</span>
      <FindCourse hint="add it in Admin → Courses" />
    </>
  );
}

function RoundsStep({ trip, onDone }) {
  const data = useData();
  if (!trip) return <div className="small muted">Make the trip first (step 1).</div>;
  if (!trip.start_date) return <div className="small muted">Add the trip’s dates first (step 1) — each round goes on a day.</div>;
  if (!data.courses.length) return <div className="small muted">Add a course first (step 2).</div>;
  const days = tripDays(trip);
  const rounds = data.rounds.filter((r) => r.trip_id === trip.id);
  const list = days;
  const others = rounds.filter((r) => !days.includes(r.play_date));
  return (
    <>
      {list.map((day) => {
        const have = rounds.filter((r) => (day ? r.play_date === day : true));
        return (
          <div key={day || 'any'} className="card pad stack" style={{ gap: 6, background: 'var(--ground)' }}>
            <strong>{day ? dayLabel(day) : 'A round'}</strong>
            {have.map((r) => (
              <div key={r.id} className="small">✓ {r.name} · {data.coursesById[r.course_id]?.name || 'course'} · {{ ambrose: 'Ambrose', stroke: 'Stroke play', fourball: '4BBB' }[r.format] || 'Stableford'}{r.status === 'live' ? ' · live' : r.status === 'locked' ? ' · finished' : ''}</div>
            ))}
            <AddRound trip={trip} day={day} first={!have.length} />
          </div>
        );
      })}
      {others.length > 0 && (
        <div className="small muted">Also on this trip: {others.map((r) => `${r.name}${r.play_date ? ` (${dayLabel(r.play_date)})` : ' (no date)'}`).join(', ')} — change dates in Admin.</div>
      )}
      {rounds.length > 0 && <button type="button" className="btn sm" onClick={onDone}>Next: players →</button>}
      <p className="note" style={{ margin: 0 }}>Ambrose teams, 4BBB pairs, and who’s playing a Stableford or stroke round, are set in Admin → Rounds &amp; teams (or with The Draw).</p>
    </>
  );
}

function AddRound({ trip, day, first }) {
  const data = useData();
  const [busy, run] = useRun();
  const [open, setOpen] = useState(first);
  const [courseId, setCourseId] = useState(data.courses.length === 1 ? data.courses[0].id : '');
  const [format, setFormat] = useState('stableford');
  const [date, setDate] = useState(day || '');
  if (!open) return <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>+ Another round {day ? 'this day' : ''}</button>;
  const course = data.coursesById[courseId];
  const add = () => run(async () => {
    await must(supabase.from('rounds').insert({ trip_id: trip.id, course_id: courseId, play_date: date || null, format, name: roundName(date, course?.name) }));
    await data.reload();
    setOpen(false);
  }, 'Round added');
  return (
    <div className="stack" style={{ gap: 6 }}>
      <select className="select" aria-label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
        <option value="">Which course?</option>
        {data.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select className="select" aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)}>
        {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      {!day && <input className="input" type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />}
      {courseId && <span className="small muted">It’ll be called “{roundName(date, course?.name)}” — rename it in Admin if you like.</span>}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn gold sm" disabled={busy || !courseId} onClick={add}>Add round</button>
        {!first && <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>}
        {first && day && <span className="small muted">No golf this day? Just skip it.</span>}
      </div>
    </div>
  );
}

function PlayersStep({ cupOn }) {
  const data = useData();
  const approved = data.players.filter((p) => p.approved !== false);
  const waiting = data.players.length - approved.length;
  return (
    <>
      <div className="small"><strong>{approved.length}</strong> in so far{waiting ? <> · <Link to="/admin">{waiting} waiting for you to approve</Link></> : null}.</div>
      {cupOn ? (
        <div className="card pad stack" style={{ gap: 6 }}>
          <strong>It’s a Cup: use the team links</strong>
          <span className="small muted">Each team has its own link — whoever opens it lands on that team, approved straight away.</span>
          <Link to="/cup" className="btn gold sm" style={{ alignSelf: 'flex-start' }}>Get the team links (Cup → Set up the cup)</Link>
        </div>
      ) : (
        <>
          <span className="small muted">Paste this in the group chat. Everyone taps it, puts in their name and handicap, and they’re in.</span>
          <InviteCard role="player" />
          <details>
            <summary className="small muted">A link for guests (play and score, no votes)</summary>
            <InviteCard role="guest" />
          </details>
        </>
      )}
      <span className="small muted">Someone without a phone? Add their name in <Link to="/admin">Admin → Players</Link>.</span>
    </>
  );
}

function ExtrasStep({ trip, sideCompsOn, cupOn }) {
  const data = useData();
  const rounds = trip ? data.rounds.filter((r) => r.trip_id === trip.id) : [];
  return (
    <>
      {cupOn && <Link to="/cup" className="btn sm" style={{ alignSelf: 'flex-start' }}>🏆 Set up the Cup — teams and matches</Link>}
      <TeeGroupsForTrip trip={trip} />
      {sideCompsOn ? (
        <>
          {!rounds.length && <div className="small muted">Add a round first (step 3).</div>}
          {rounds.map((r) => <RoundExtras key={r.id} round={r} />)}
          <details className="card pad">
            <summary><strong>More side comps</strong> <span className="small muted">— pick from the list: greenies, sandies, most birdies, the snake…</span></summary>
            <div style={{ marginTop: 10 }}><OwnCompsAdmin trip={trip} /></div>
          </details>
        </>
      ) : (
        <div className="small muted">Side comps are switched off for this group — switch them on in <Link to="/group">Group → Features</Link>.</div>
      )}
      <SetupGames rounds={rounds} />
    </>
  );
}

function RoundExtras({ round }) {
  const data = useData();
  const [busy, run] = useRun();
  const [ctp, setCtp] = useState((round.ctp_holes || []).join(' '));
  const [ld, setLd] = useState((round.ld_holes || []).join(' '));
  const course = data.coursesById[round.course_id];
  const par3s = (course?.holes || []).filter((h) => h.par === 3).map((h) => h.n);
  const changed = parseHoles(ctp).join(' ') !== (round.ctp_holes || []).join(' ') || parseHoles(ld).join(' ') !== (round.ld_holes || []).join(' ');
  return (
    <div className="card pad stack" style={{ gap: 8, background: 'var(--ground)' }}>
      <strong>{round.name}</strong>
      <RoundCompsCard round={round} />
      <div className="row" style={{ gap: 8 }}>
        <label className="field grow"><span>Closest to pin holes</span><input className="input" inputMode="numeric" value={ctp} onChange={(e) => setCtp(e.target.value)} placeholder="e.g. 3 7" /></label>
        <label className="field grow"><span>Longest drive holes</span><input className="input" inputMode="numeric" value={ld} onChange={(e) => setLd(e.target.value)} placeholder="e.g. 5" /></label>
      </div>
      {par3s.length > 0 && !ctp && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCtp(par3s.join(' '))}>Use the par 3s ({par3s.join(', ')})</button>}
      {changed && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => run(async () => {
        await must(supabase.from('rounds').update({ ctp_holes: parseHoles(ctp), ld_holes: parseHoles(ld) }).eq('id', round.id));
        await data.reload();
      }, 'Side comp holes saved')}>Save holes</button>}
      <RoundOwnComps round={round} onSaved={data.reload} />
    </div>
  );
}
