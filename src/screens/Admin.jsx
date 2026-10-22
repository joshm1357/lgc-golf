import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { roundSettingsFromRules } from '../lib/plan.js';
import { honourOrder } from '../lib/history.js';
import { formatName } from '../lib/board.js';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useSession, playerName, useFeature } from '../lib/store.jsx';
import { Header, Avatar, Loading, toast } from '../components/ui.jsx';
import DrawSetup from '../components/DrawSetup.jsx';
import { FindCourse, ShareCourse } from '../components/CourseLibrary.jsx';
import { OwnCompsAdmin, RoundOwnComps } from './OwnComps.jsx';
import { RoundGames } from './Games.jsx';
import { TeeGroupsCard } from './TeeGroups.jsx';
import { RoundCompsCard, useScrollToRound } from './CompsBoard.jsx';
import { CommentarySettings } from '../components/Commentary.jsx';
import { isYearOnly, tripWhen } from '../lib/trips.js';

async function run(fn, okMsg) {
  try {
    const res = await fn();
    if (res?.error) throw res.error;
    if (okMsg) toast(okMsg);
    return res?.data ?? true;
  } catch (e) {
    toast(friendlyError(e));
    return null;
  }
}

function Section({ title, children, open: startOpen = false, anchor }) {
  const [params] = useSearchParams(); // ?open=players (the Caddie's "Players & handicaps") opens that section
  const [open, setOpen] = useState(startOpen || (!!anchor && params.get('open') === anchor));
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen(!open)} className="row between" style={{ width: '100%', padding: '14px', background: 'none', border: 0, fontWeight: 700, fontSize: 17 }} aria-expanded={open}>
        <span>{title}</span><span className="muted">{open ? '−' : '+'}</span>
      </button>
      {open && <div style={{ padding: '0 14px 14px' }} className="stack">{children}</div>}
    </div>
  );
}

export default function Admin() {
  const { status, refresh } = useSession();
  const data = useData();
  const trophiesOn = useFeature('trophies');
  const sideCompsOn = useFeature('side_comps');

  useScrollToRound(data.ready && status?.is_admin);

  if (!data.ready) return <Loading />;

  if (!status?.is_admin) {
    return (
      <div className="page">
        <Header back title="Admin" sub="For whoever's running the trip" />
        {/* No admin PIN any more (083): an organiser makes you one in Group & invites, or sends you an organiser link. */}
        <div className="section">
          <div className="card pad stack" style={{ gap: 6 }}>
            <strong>Only organisers can open Admin</strong>
            <span className="small muted">Ask an organiser to make you one (More → Group & invites → People), or to send you their organiser link.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Header back title="Admin" sub="Set up trips, courses, players and rounds" />
      <div className="section stack" style={{ paddingBottom: 20 }}>
        <Link to="/setup" className="card pad row" style={{ gap: 10, textDecoration: 'none', color: 'inherit', borderColor: 'var(--navy)' }}>
          <span aria-hidden="true">🧭</span><span className="grow"><strong>Set up your trip</strong> <span className="small muted">— the step-by-step guide</span></span><span className="muted">›</span>
        </Link>
        <p className="note" style={{ margin: '0 4px' }}>Order for a new round: 1. Trip → 2. Course → 3. Players → 4. Round & teams → Start round.</p>
        <PendingApprovals />
        <TripsAdmin />
        <CoursesAdmin />
        <PlayersAdmin />
        <RoundsAdmin />
        {sideCompsOn && <Section title="Your own side comps"><OwnCompsAdmin /></Section>}
        <CommentarySettings />
        {trophiesOn && <TrophiesAdmin />}
        {trophiesOn ? <HonourAdmin /> : <Link to="/history" className="btn ghost block">Add past handicaps (from before the app) →</Link>}
        {/* Change PINs is gone (083): links only. set_pins stays in the database for old app versions. */}
        <VotesAdmin />
      </div>
    </div>
  );
}

// ---------- Trips ----------
function TripsAdmin() {
  const data = useData();
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  return (
    <Section title={`1. Trips (${data.trips.length})`} open={!data.trips.length}>
      {data.trips.map((t) => (
        <div key={t.id} className="row between">
          <span><strong>{t.name}</strong> <span className="muted small">{isYearOnly(t) ? tripWhen(t) : t.start_date || ''}{t.status === 'locked' ? ' · locked' : ''}</span></span>
          <button type="button" className="btn ghost sm" onClick={() => run(() => supabase.from('trips').update({ status: t.status === 'active' ? 'locked' : 'active' }).eq('id', t.id), 'Updated').then(data.reload)}>
            {t.status === 'active' ? 'Lock trip' : 'Reopen'}
          </button>
        </div>
      ))}
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => supabase.from('trips').insert({ name, start_date: start || null, end_date: end || null }), 'Trip added')) {
          setName(''); data.reload();
        }
      }}>
        <label className="field"><span>New trip name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring Trip 2026" required /></label>
        <div className="row">
          <label className="field grow"><span>Start</span><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field grow"><span>End</span><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <button className="btn">Add trip</button>
      </form>
    </Section>
  );
}

// ---------- Courses ----------
function parseNums(s) {
  return String(s).trim().split(/[\s,]+/).filter(Boolean).map(Number);
}
function CoursesAdmin() {
  const data = useData();
  const [editing, setEditing] = useState(null);
  const [finding, setFinding] = useState(!data.courses.length);
  return (
    <Section title={`2. Courses (${data.courses.length})`} open={!data.courses.length}>
      {data.courses.map((c) => (
        <div key={c.id} className="row between" style={{ gap: 6 }}>
          <span style={{ minWidth: 0 }}><strong>{c.name}</strong> <span className="muted small">par {c.holes.reduce((s, h) => s + h.par, 0)}</span></span>
          <span className="row" style={{ gap: 6, flex: 'none' }}>
            <ShareCourse course={c} />
            <button type="button" className="btn ghost sm" onClick={() => setEditing(c)}>Edit</button>
          </span>
        </div>
      ))}
      {finding ? (
        <div className="card pad stack" style={{ gap: 8 }}>
          <strong>📚 Find it in the course library</strong>
          <span className="small muted">Courses other groups have set up — pars, stroke index and often the greens for GPS. You get your own copy.</span>
          <FindCourse onAdded={() => setFinding(false)} />
          <button type="button" className="btn ghost sm" onClick={() => setFinding(false)}>Close</button>
        </div>
      ) : <button type="button" className="btn ghost" onClick={() => setFinding(true)}>📚 Find a course in the library</button>}
      {editing ? <CourseForm course={editing} onDone={() => setEditing(null)} /> : <button type="button" className="btn" onClick={() => setEditing({})}>Add a course by hand</button>}
    </Section>
  );
}
function CourseForm({ course, onDone }) {
  const data = useData();
  const holes = course.holes ? [...course.holes].sort((a, b) => a.n - b.n) : null;
  const [name, setName] = useState(course.name || '');
  const [pars, setPars] = useState(holes ? holes.map((h) => h.par).join(' ') : '');
  const [sis, setSis] = useState(holes ? holes.map((h) => h.si).join(' ') : '');
  const p = parseNums(pars), s = parseNums(sis);
  const problems = [];
  if (p.length !== 18) problems.push(`Pars: ${p.length} of 18 entered`);
  if (p.some((x) => ![3, 4, 5, 6].includes(x))) problems.push('Pars should be 3, 4 or 5');
  if (s.length !== 18) problems.push(`Stroke index: ${s.length} of 18 entered`);
  else if (new Set(s).size !== 18 || s.some((x) => x < 1 || x > 18)) problems.push('Stroke index must use each of 1–18 once');
  return (
    <form className="stack card pad" style={{ background: 'var(--ground)' }} onSubmit={async (e) => {
      e.preventDefault();
      if (problems.length) return;
      const newHoles = p.map((par, i) => ({ ...(holes?.[i] || {}), n: i + 1, par, si: s[i] }));
      const q = course.id
        ? supabase.from('courses').update({ name, holes: newHoles }).eq('id', course.id)
        : supabase.from('courses').insert({ name, holes: newHoles });
      if (await run(() => q, 'Course saved')) { data.reload(); onDone(); }
    }}>
      <label className="field"><span>Course name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label className="field"><span>Pars, holes 1–18 (spaces between)</span><textarea className="textarea" inputMode="numeric" value={pars} onChange={(e) => setPars(e.target.value)} placeholder="4 4 3 5 4 4 3 4 5 4 3 4 5 4 4 3 5 4" /></label>
      <label className="field"><span>Stroke index, holes 1–18 (from the scorecard)</span><textarea className="textarea" inputMode="numeric" value={sis} onChange={(e) => setSis(e.target.value)} placeholder="7 15 3 11 1 17 9 13 5 8 16 4 12 2 18 10 14 6" /></label>
      <div className="small muted">Par total: {p.reduce((a, b) => a + b, 0)}</div>
      {problems.map((x) => <div key={x} className="err">{x}</div>)}
      <div className="row">
        <button type="button" className="btn ghost grow" onClick={onDone}>Cancel</button>
        <button className="btn grow" disabled={!!problems.length || !name}>Save course</button>
      </div>
    </form>
  );
}

// ---------- Players ----------
function PendingApprovals() {
  const data = useData();
  const pending = data.players.filter((p) => p.approved === false);
  if (!pending.length) return null;
  return (
    <div className="card pad stack" style={{ borderColor: 'var(--gold)', background: 'var(--gold-soft)' }}>
      <strong>Waiting for your approval ({pending.length})</strong>
      <span className="small muted">These people weren't on the list and added themselves.</span>
      {pending.map((p) => (
        <div key={p.id} className="row">
          <Avatar player={p} size={36} />
          <span className="grow"><strong>{p.name}</strong>{p.nickname ? <span className="muted small"> · {p.nickname}</span> : ''}<div className="small muted">Handicap {Number(p.handicap)}</div></span>
          <button type="button" className="btn sm" onClick={() => run(() => supabase.from('players').update({ approved: true }).eq('id', p.id), `${p.name} approved`).then(data.reload)}>Approve</button>
          <button type="button" className="btn ghost sm" aria-label={`Reject ${p.name}`} onClick={() => { if (window.confirm(`Reject ${p.name}? Their profile will be removed.`)) run(() => supabase.from('players').delete().eq('id', p.id), 'Removed').then(data.reload); }}>✕</button>
        </div>
      ))}
    </div>
  );
}

function PlayersAdmin() {
  const data = useData();
  const [name, setName] = useState('');
  const [hcp, setHcp] = useState('');
  const players = data.players.filter((p) => p.approved !== false).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Section title={`3. Players (${players.length})`} anchor="players">
      <p className="small muted" style={{ margin: 0 }}>Players normally add themselves when they join. Add someone here if they won't have the app.</p>
      {players.map((p) => <PlayerRow key={p.id} p={p} />)}
      <form className="row" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => supabase.rpc('admin_create_player', { p_name: name, p_nickname: null, p_handicap: Number(hcp), p_avatar_url: null }), 'Player added')) {
          setName(''); setHcp(''); data.reload();
        }
      }}>
        <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
        <input className="input" style={{ width: 80 }} inputMode="decimal" value={hcp} onChange={(e) => setHcp(e.target.value)} placeholder="Hcp" required />
        <button className="btn sm">Add</button>
      </form>
    </Section>
  );
}
function PlayerRow({ p }) {
  const data = useData();
  const [hcp, setHcp] = useState(String(p.handicap));
  const changed = Number(hcp) !== Number(p.handicap) && hcp !== '';
  return (
    <div className="row">
      <Avatar player={p} size={32} />
      <span className="grow ellipsis">{p.name}{p.nickname ? <span className="muted small"> · {p.nickname}</span> : ''}</span>
      <input className="input" style={{ width: 70, minHeight: 38 }} inputMode="decimal" value={hcp} onChange={(e) => setHcp(e.target.value)} aria-label={`${p.name} handicap`} />
      {changed && (
        <button type="button" className="btn sm" onClick={() => run(() => supabase.from('players').update({ handicap: Number(hcp) }).eq('id', p.id), 'Handicap updated').then(data.reload)}>Save</button>
      )}
    </div>
  );
}

// ---------- Rounds & teams ----------
function RoundsAdmin() {
  const data = useData();
  const trip = data.currentTrip;
  const [form, setForm] = useState({ name: '', course_id: '', play_date: '', format: 'ambrose' });
  const rounds = data.rounds.filter((r) => r.trip_id === trip?.id);
  if (!trip) return <Section title="4. Rounds & teams"><div className="muted">Add a trip first.</div></Section>;
  return (
    <Section title={`4. Rounds & teams — ${trip.name}`} open>
      {rounds.map((r) => <RoundCard key={r.id} round={r} />)}
      <form className="stack card pad" style={{ background: 'var(--ground)' }} onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => supabase.from('rounds').insert({ ...form, trip_id: trip.id, play_date: form.play_date || null }), 'Round added')) {
          setForm({ name: '', course_id: '', play_date: '', format: 'ambrose' }); data.reload();
        }
      }}>
        <strong>Add a round</strong>
        <label className="field"><span>Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sunday Ambrose" required /></label>
        <label className="field"><span>Course</span>
          <select className="select" value={form.course_id} onChange={(e) => setForm({ ...form, course_id: e.target.value })} required>
            <option value="">Choose…</option>
            {data.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="row">
          <label className="field grow"><span>Date</span><input className="input" type="date" value={form.play_date} onChange={(e) => setForm({ ...form, play_date: e.target.value })} /></label>
          <label className="field grow"><span>Format</span>
            <select className="select" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
              <option value="ambrose">Ambrose (teams)</option>
              <option value="stableford">Stableford (individual)</option>
              <option value="stroke">Stroke play (individual, net)</option>
              <option value="fourball">4BBB (pairs, better-ball Stableford)</option>
            </select>
          </label>
        </div>
        <button className="btn">Add round</button>
      </form>
    </Section>
  );
}

/** The Rulebook rules for this round's format, and the numbers scoring uses (side comp strokes, minimum drives). */
function RoundRules({ round }) {
  const data = useData();
  const bonusOn = useFeature('comp_bonus');
  const [rules, setRules] = useState(null);
  const [bonus, setBonus] = useState(String(round.comp_bonus ?? 0));
  const [drives, setDrives] = useState(String(round.min_drives ?? ''));
  useEffect(() => {
    supabase.from('rules').select('*').eq('status', 'active').order('sort').then(({ data: r }) => setRules(r || []), () => setRules([]));
  }, []);
  const isA = round.format === 'ambrose';
  const s = roundSettingsFromRules(rules || [], round.format);
  const changed = String(round.comp_bonus ?? 0) !== bonus || String(round.min_drives ?? '') !== drives;
  const save = (patch, msg) => run(() => supabase.from('rounds').update(patch).eq('id', round.id), msg).then(data.reload);
  return (
    <details className="card pad" style={{ background: '#fff' }}>
      <summary style={{ fontWeight: 700, cursor: 'pointer' }}>📜 Rules for this round{rules ? ` (${s.applies.length})` : ''}</summary>
      <div className="stack" style={{ marginTop: 8, gap: 8 }}>
        {rules && !s.applies.length && <span className="small muted">No active rules for {round.format} yet. <Link to="/rules">Open the Rulebook</Link>.</span>}
        {s.applies.map((r) => <div key={r.id} className="small"><strong>{r.title}</strong>{r.value ? ` · ${r.value}` : ''}</div>)}
        {isA && (
          <div className="row">
            {bonusOn && <label className="field grow"><span>Side comp worth (strokes off)</span><input className="input" inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value.replace(/[^0-9]/g, ''))} /></label>}
            <label className="field grow"><span>Minimum drives each</span><input className="input" inputMode="numeric" value={drives} onChange={(e) => setDrives(e.target.value.replace(/[^0-9]/g, ''))} placeholder="none" /></label>
          </div>
        )}
        {changed && <button type="button" className="btn sm" onClick={() => save({ comp_bonus: bonusOn ? parseInt(bonus, 10) || 0 : 0, min_drives: drives ? Number(drives) : null }, 'Round settings saved')}>Save these settings</button>}
        {rules && s.applies.length > 0 && (
          <button type="button" className="btn ghost sm" onClick={() => {
            const patch = { rules: s.text };
            if (isA && s.comp_bonus != null && bonusOn) patch.comp_bonus = s.comp_bonus;
            if (isA && s.min_drives != null) patch.min_drives = s.min_drives;
            if (isA) { setBonus(String(patch.comp_bonus ?? round.comp_bonus ?? 0)); setDrives(String(patch.min_drives ?? round.min_drives ?? '')); }
            save(patch, 'Applied from the Rulebook — shown on the leaderboard');
          }}>Apply from the Rulebook{isA && (s.comp_bonus != null || s.min_drives != null) ? ` (${[s.comp_bonus != null ? `comps −${s.comp_bonus}` : null, s.min_drives != null ? `${s.min_drives} drives` : null].filter(Boolean).join(', ')})` : ''}</button>
        )}
        {round.rules && <span className="small muted">Shown to the lads: “{round.rules.length > 140 ? `${round.rules.slice(0, 140)}…` : round.rules}”</span>}
      </div>
    </details>
  );
}

function RoundCard({ round }) {
  const data = useData();
  const sideCompsOn = useFeature('side_comps');
  const drawOn = useFeature('draw');
  const [ld, setLd] = useState(round.ld_holes.join(' '));
  const [ctp, setCtp] = useState(round.ctp_holes.join(' '));
  const course = data.coursesById[round.course_id];
  const next = { setup: ['live', 'Start round'], live: ['locked', 'Finish & lock'], locked: ['live', 'Reopen'] }[round.status];
  return (
    <div className="card pad stack" id={`round-${round.id}`} style={{ background: 'var(--ground)' }}>
      <div className="row between">
        <div><strong>{round.name}</strong><div className="small muted">{course?.name} · {formatName(round.format)} · {round.status}</div></div>
        <button type="button" className={'btn sm' + (round.status === 'setup' ? ' gold' : ' ghost')} onClick={() => run(() => supabase.from('rounds').update({ status: next[0] }).eq('id', round.id), 'Round updated').then(data.reload)}>{next[1]}</button>
      </div>
      <RoundCompsCard round={round} />
      {sideCompsOn && <div className="row">
        <label className="field grow"><span>Longest drive holes</span><input className="input" value={ld} onChange={(e) => setLd(e.target.value)} placeholder="e.g. 5" inputMode="numeric" /></label>
        <label className="field grow"><span>Closest to pin holes</span><input className="input" value={ctp} onChange={(e) => setCtp(e.target.value)} placeholder="e.g. 3 7" inputMode="numeric" /></label>
      </div>}
      {sideCompsOn && (ld !== round.ld_holes.join(' ') || ctp !== round.ctp_holes.join(' ')) && (
        <button type="button" className="btn sm" onClick={() => run(() => supabase.from('rounds').update({ ld_holes: parseNums(ld).filter((n) => n >= 1 && n <= 18), ctp_holes: parseNums(ctp).filter((n) => n >= 1 && n <= 18) }).eq('id', round.id), 'Side comps saved').then(data.reload)}>Save side comp holes</button>
      )}
      {sideCompsOn && <RoundOwnComps round={round} onSaved={data.reload} />}
      <RoundGames round={round} />
      <TeeGroupsCard round={round} />
      <RoundRules round={round} />
      {round.format === 'ambrose' && drawOn && <DrawButton round={round} />}
      {round.format === 'ambrose' || round.format === 'fourball' ? <TeamsEditor round={round} pairs={round.format === 'fourball'} /> : <StablefordPlayers round={round} />}
      <details>
        <summary className="small muted">Delete this round</summary>
        <button type="button" className="btn danger sm" style={{ marginTop: 8 }} onClick={() => { if (window.confirm(`Delete ${round.name} and all its scores?`)) run(() => supabase.from('rounds').delete().eq('id', round.id), 'Round deleted').then(data.reload); }}>Delete round</button>
      </details>
    </div>
  );
}

function DrawButton({ round }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn gold" onClick={() => setOpen(true)}>🎲 The Draw — random fair teams, live for everyone</button>
      {open && <DrawSetup round={round} onClose={() => setOpen(false)} />}
    </>
  );
}

function PlayerPicker({ selected, onToggle, exclude = [] }) {
  const data = useData();
  const players = data.players.filter((p) => p.approved !== false).sort((a, b) => a.name.localeCompare(b.name)).filter((p) => !exclude.includes(p.id) || selected.includes(p.id));
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
      {players.map((p) => (
        <button key={p.id} type="button" className="chip" aria-pressed={selected.includes(p.id)} onClick={() => onToggle(p.id)}>{playerName(p)}</button>
      ))}
    </div>
  );
}

function TeamsEditor({ round, pairs = false }) {
  const data = useData();
  const teams = data.teamsByRound[round.id] || [];
  const taken = teams.flatMap((t) => t.players.map((p) => p.id));
  const [name, setName] = useState('');
  const [hcp, setHcp] = useState('');
  const [sel, setSel] = useState([]);
  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const total = sel.reduce((s, id) => s + Number(data.playersById[id]?.handicap || 0), 0);
  return (
    <div className="stack">
      <span className="label">{pairs ? 'Pairs (4BBB)' : 'Teams'}</span>
      {pairs && <span className="small muted">Two players a pair. Each plays off their own handicap, fixed for this round (change it below); the better Stableford points on each hole count.</span>}
      {teams.map((t) => <TeamRow key={t.id} team={t} pairs={pairs} takenElsewhere={teams.filter((o) => o.id !== t.id).flatMap((o) => o.players.map((p) => p.id))} />)}
      {data.players.length < 2 && <span className="small muted">Only {data.players.length} player so far — the lads appear here once they join with the invite link, or add them under 3. Players.</span>}
      <div className="stack card pad">
        <strong>{pairs ? 'Add a pair' : 'Add a team'}</strong>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={pairs ? 'Pair name (e.g. Kurt & Al)' : 'Team name'} />
        <span className="small muted">Pick players (already-teamed players are hidden):</span>
        <PlayerPicker selected={sel} onToggle={toggle} exclude={taken} />
        {!pairs && <div className="row">
          <label className="field grow"><span>Team handicap</span><input className="input" inputMode="decimal" value={hcp} onChange={(e) => setHcp(e.target.value)} placeholder={sel.length ? `e.g. ${(total / (sel.length * 2)).toFixed(1)}` : ''} /></label>
        </div>}
        {sel.length > 0 && !pairs && <span className="small muted">Players' handicaps add to {total}. Common rules: 4-player team ÷ 8, 3-player ÷ 6, 2-player ÷ 4.</span>}
        <button type="button" className="btn" disabled={!name || !sel.length || (pairs ? sel.length !== 2 : hcp === '')} onClick={async () => {
          const res = await run(() => supabase.from('teams').insert({ round_id: round.id, name, handicap: pairs ? 0 : Number(hcp) }).select().single());
          if (res) {
            await run(() => supabase.from('team_players').insert(sel.map((pid) => ({ team_id: res.id, player_id: pid }))), pairs ? 'Pair added' : 'Team added');
            // 4BBB: each player's handicap is fixed for the round (so changing it later doesn't change this result).
            if (pairs) await addRoundHcps(round.id, sel, data);
            setName(''); setHcp(''); setSel([]); data.reload();
          }
        }}>{pairs ? 'Add pair' : 'Add team'}</button>
      </div>
      {pairs && <PairHandicaps round={round} />}
    </div>
  );
}

/** 4BBB: put players in the round at their current handicap (a playing handicap for the round), if not already. */
async function addRoundHcps(roundId, playerIds, data) {
  const have = new Set((data.roundPlayers[roundId] || []).map((rp) => rp.player_id));
  const add = playerIds.filter((pid) => !have.has(pid))
    .map((pid) => ({ round_id: roundId, player_id: pid, playing_handicap: Math.round(Number(data.playersById[pid]?.handicap || 0)) }));
  if (add.length) await run(() => supabase.from('round_players').insert(add));
}

function TeamRow({ team, takenElsewhere = [], pairs = false }) {
  const data = useData();
  const [hcp, setHcp] = useState(String(team.handicap));
  const [editing, setEditing] = useState(false);
  const ids = team.players.map((p) => p.id);
  const total = team.players.reduce((s, p) => s + Number(p.handicap || 0), 0);
  return (
    <div className="stack" style={{ gap: 6, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
    <div className="row">
      <div className="grow">
        <strong>{team.name}</strong>
        <div className="small muted ellipsis">{team.players.map(playerName).join(', ') || 'No players'}</div>
        <button type="button" className="small" style={{ background: 'none', border: 0, padding: 0, color: 'var(--navy)', fontWeight: 700 }} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Change players'}</button>
      </div>
      {!pairs && <input className="input" style={{ width: 70, minHeight: 38 }} inputMode="decimal" value={hcp} onChange={(e) => setHcp(e.target.value)} aria-label="Team handicap" />}
      {!pairs && Number(hcp) !== Number(team.handicap) && hcp !== '' && (
        <button type="button" className="btn sm" onClick={() => run(() => supabase.from('teams').update({ handicap: Number(hcp) }).eq('id', team.id), 'Saved').then(data.reload)}>Save</button>
      )}
      <button type="button" className="btn ghost sm" aria-label={`Remove ${team.name}`} onClick={() => { if (window.confirm(`Remove ${team.name}?`)) run(() => supabase.from('teams').delete().eq('id', team.id), 'Team removed').then(data.reload); }}>✕</button>
    </div>
    {editing && (
      <div className="stack" style={{ gap: 6 }}>
        <span className="small muted">Tap to add or remove. Players in other teams are hidden. Handicaps add to {total}.</span>
        <PlayerPicker selected={ids} exclude={takenElsewhere} onToggle={async (pid) => {
          if (ids.includes(pid)) await run(() => supabase.from('team_players').delete().eq('team_id', team.id).eq('player_id', pid));
          else if (pairs && ids.length >= 2) { toast('A pair is two players — take one out first'); return; }
          else {
            await run(() => supabase.from('team_players').insert({ team_id: team.id, player_id: pid }));
            if (pairs) await addRoundHcps(team.round_id, [pid], data);
          }
          data.reload();
        }} />
      </div>
    )}
    </div>
  );
}

/** 4BBB: each paired player's playing handicap for this round, with the World Handicap four-ball allowance. */
function PairHandicaps({ round }) {
  const data = useData();
  const inPairs = new Set((data.teamsByRound[round.id] || []).flatMap((t) => t.players.map((p) => p.id)));
  const rps = (data.roundPlayers[round.id] || []).filter((rp) => inPairs.has(rp.player_id));
  if (!rps.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">Playing handicaps for this round</span>
      {rps.map((rp) => <RoundPlayerRow key={rp.player_id} round={round} rp={rp} />)}
      <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={async () => {
        if (!window.confirm('Set everyone to 85% of their handicap (the World Handicap allowance for four-ball stroke play / Stableford)?')) return;
        for (const rp of rps) {
          const full = Number(data.playersById[rp.player_id]?.handicap || 0);
          await run(() => supabase.from('round_players').update({ playing_handicap: Math.round(full * 0.85) }).eq('round_id', round.id).eq('player_id', rp.player_id));
        }
        toast('Set to 85%');
        data.reload();
      }}>Use 85% of handicap (four-ball allowance)</button>
    </div>
  );
}

function StablefordPlayers({ round }) {
  const data = useData();
  const rps = data.roundPlayers[round.id] || [];
  const inRound = rps.map((r) => r.player_id);
  const qr = Object.fromEntries(data.quick_results.filter((q) => q.round_id === round.id).map((q) => [q.player_id, q.points]));
  return (
    <div className="stack">
      <span className="label">Players & playing handicaps</span>
      <button type="button" className="btn ghost sm" onClick={async () => {
        const add = data.players.filter((p) => p.approved !== false && !inRound.includes(p.id)).map((p) => ({ round_id: round.id, player_id: p.id, playing_handicap: Math.round(Number(p.handicap)) }));
        if (add.length) await run(() => supabase.from('round_players').insert(add), `Added ${add.length} players`);
        data.reload();
      }}>Add everyone at their current handicap</button>
      {rps.map((rp) => <RoundPlayerRow key={rp.player_id} round={round} rp={rp} points={qr[rp.player_id]} />)}
      <PlayerPicker selected={inRound} exclude={[]} onToggle={async (pid) => {
        if (inRound.includes(pid)) await run(() => supabase.from('round_players').delete().eq('round_id', round.id).eq('player_id', pid));
        else await run(() => supabase.from('round_players').insert({ round_id: round.id, player_id: pid, playing_handicap: Math.round(Number(data.playersById[pid].handicap)) }));
        data.reload();
      }} />
      {round.format === 'stableford' && <span className="small muted">Played on paper? Type each player's total Stableford points in the "Card pts" box — it counts toward the trophy.</span>}
    </div>
  );
}

function RoundPlayerRow({ round, rp, points }) {
  const data = useData();
  const p = data.playersById[rp.player_id];
  const [h, setH] = useState(String(rp.playing_handicap));
  const [pts, setPts] = useState(points != null ? String(points) : '');
  const dirty = Number(h) !== rp.playing_handicap || (pts !== '' && Number(pts) !== points) || (pts === '' && points != null);
  return (
    <div className="row">
      <Avatar player={p} size={28} />
      <span className="grow ellipsis">{playerName(p)}</span>
      <label className="field" style={{ width: 64 }}><span className="small">Hcp</span><input className="input" style={{ minHeight: 38 }} inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} /></label>
      {round.format === 'stableford' && <label className="field" style={{ width: 70 }}><span className="small">Card pts</span><input className="input" style={{ minHeight: 38 }} inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value)} /></label>}
      {dirty && (
        <button type="button" className="btn sm" style={{ alignSelf: 'flex-end' }} onClick={async () => {
          await run(() => supabase.from('round_players').update({ playing_handicap: Math.round(Number(h)) }).eq('round_id', round.id).eq('player_id', rp.player_id));
          if (round.format !== 'stableford') { /* card points are Stableford only */ }
          else if (pts === '') await run(() => supabase.from('quick_results').delete().eq('round_id', round.id).eq('player_id', rp.player_id));
          else await run(() => supabase.from('quick_results').upsert({ round_id: round.id, player_id: rp.player_id, points: Number(pts) }));
          toast('Saved');
          data.reload();
        }}>Save</button>
      )}
    </div>
  );
}

// ---------- Trophies ----------
function TrophiesAdmin() {
  const data = useData();
  const { status } = useSession();
  const trip = data.currentTrip;
  const [name, setName] = useState('');
  const [type, setType] = useState('stableford_total');
  if (!trip) return null;
  const list = data.trophies.filter((t) => t.trip_id === trip.id);
  return (
    <Section title={`5. Trophies — ${trip.name}`}>
      {list.map((t) => (
        <div key={t.id} className="row between">
          <span><strong>{t.name}</strong> <span className="muted small">{t.type === 'ambrose' ? 'Ambrose (team)' : t.type === 'manual' ? 'Awarded' : 'Stableford total'}</span></span>
          <button type="button" className="btn ghost sm" onClick={() => run(() => supabase.from('trophies').delete().eq('id', t.id), 'Removed').then(data.reload)}>Remove</button>
        </div>
      ))}
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => supabase.from('trophies').insert({ trip_id: trip.id, name, type }), 'Trophy added')) { setName(''); data.reload(); }
      }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={status?.legacy ? 'Trophy name, e.g. The BD' : 'Trophy name, e.g. The Cup'} required />
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="stableford_total">Stableford — total points across the trip</option>
          <option value="ambrose">Ambrose — winning team</option>
          <option value="manual">Awarded by the group{status?.legacy ? ' (e.g. the Noodle Cup)' : ' (e.g. best on-course outfit)'}</option>
        </select>
        <button className="btn">Add trophy</button>
      </form>
    </Section>
  );
}

// ---------- Honour board ----------
function HonourAdmin() {
  const data = useData();
  const { status } = useSession();
  const [f, setF] = useState({ trophy_name: status?.legacy ? 'BD' : '', label: '', winner_names: '' });
  const list = honourOrder(data.honour_board);
  return (
    <Section title={`6. Honour board (${list.length})`}>
      <Link to="/history" className="btn ghost block">Add past winners and handicaps (paste a list) →</Link>
      {list.map((h) => (
        <div key={h.id} className="row between">
          <span><strong>{h.trophy_name}</strong> {h.label} — {h.winner_names}</span>
          <button type="button" className="btn ghost sm" onClick={() => run(() => supabase.from('honour_board').delete().eq('id', h.id), 'Removed').then(data.reload)}>✕</button>
        </div>
      ))}
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        const max = Math.max(0, ...data.honour_board.map((h) => h.sort_key));
        if (await run(() => supabase.from('honour_board').insert({ ...f, sort_key: max + 10 }), 'Added')) { setF({ ...f, label: '', winner_names: '' }); data.reload(); }
      }}>
        <div className="row">
          <input className="input grow" value={f.trophy_name} onChange={(e) => setF({ ...f, trophy_name: e.target.value })} placeholder="Trophy" required />
          <input className="input" style={{ width: 110 }} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Year" required />
        </div>
        <input className="input" value={f.winner_names} onChange={(e) => setF({ ...f, winner_names: e.target.value })} placeholder="Winner(s)" required />
        <button className="btn">Add to honour board</button>
      </form>
    </Section>
  );
}

// ---------- Who picks vote winners (group-wide) ----------
function VotesAdmin() {
  const { status } = useSession();
  const [value, setValue] = useState(null);
  useEffect(() => {
    if (!status?.group_id) return;
    supabase.from('groups').select('vote_decider').eq('id', status.group_id).maybeSingle()
      .then(({ data, error }) => setValue(error ? 'unavailable' : data?.vote_decider || 'admin'));
  }, [status?.group_id]);
  if (value === 'unavailable') return null;
  const pick = async (v) => {
    if (await run(() => supabase.rpc('set_vote_decider', { p_group: status.group_id, p_value: v }), 'Saved')) setValue(v);
  };
  return (
    <Section title="7. Trip votes — who picks the winner">
      <span className="small muted">Everyone votes on when and where. This decides who closes a vote and picks the winner. It applies to every trip in the group.</span>
      {[['admin', 'The admin', 'Only admins pick winners (as now).'], ['admin_or_organiser', 'The admin or the trip’s organiser', 'Whoever suggested a trip (or who you make its organiser) can pick its winners too.']].map(([v, label, help]) => (
        <button key={v} type="button" className="chip" aria-pressed={value === v} disabled={value == null}
          style={{ textAlign: 'left', whiteSpace: 'normal', minHeight: 48, display: 'block' }} onClick={() => pick(v)}>
          <strong>{value === v ? '● ' : '○ '}{label}</strong><div className="small muted">{help}</div>
        </button>
      ))}
    </Section>
  );
}
