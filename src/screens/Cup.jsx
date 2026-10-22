// Team match play, Ryder Cup style (migration 050, feature 'cup'). The board, a match's hole-by-hole scoring, and the
// organiser's set-up (teams, team links, who's on which team, the matches). The maths is in lib/cup.js.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName, cacheGet, cacheSet } from '../lib/store.jsx';
import { currentGroup } from '../lib/group.js';
import { Header, Avatar, Loading, toast } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { inviteLink } from '../lib/invite.js';
import { shareText } from '../lib/push.js';
import { useComps } from '../components/CompsChip.jsx';
import { cleanSettings } from '../lib/comps.js';
import { sideHandicap, shotsOnHole, shots, matchState, matchText, cupTotals, toWin, pts, nextHole, matchPoints } from '../lib/cup.js';

const FORMAT_LABEL = { ambrose: 'Ambrose pairs', singles: 'Singles' };
const DEFAULT_SIDES = [{ name: 'Team Blue', colour: '#1F4B9E', sort: 1 }, { name: 'Team Red', colour: '#B3261E', sort: 2 }];
const COLOURS = ['#1F4B9E', '#B3261E', '#1F6B3A', '#C9A227', '#5B2A86', '#E06A1B', '#111827', '#0E7490'];

/** The cup's teams and matches, live. The last good copy stays on the phone for poor signal on the course. */
export function useCup() {
  const key = `cup-${currentGroup() || 'none'}`;
  const [state, setState] = useState(() => {
    const kept = cacheGet(key);
    return kept ? { ready: true, sides: kept.sides || [], matches: kept.matches || [], stale: true } : { ready: false, sides: [], matches: [] };
  });
  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([
        supabase.from('cup_sides').select('*').order('sort'),
        supabase.from('cup_matches').select('*').order('sort').order('created_at'),
      ]);
      if (s.error || m.error) throw s.error || m.error;
      const next = { sides: s.data || [], matches: m.data || [] };
      cacheSet(key, next);
      setState({ ready: true, ...next });
    } catch {
      // No signal (or a hiccup): keep what's on screen and say so, rather than "no teams yet".
      setState((cur) => ({ ...cur, ready: true, failed: true }));
    }
  }, [key]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['cup_sides', 'cup_matches'], load);
  return { ...state, reload: load };
}

/** Shown when the cup couldn't load: what's on screen may be old. */
function Offline({ cup }) {
  if (!cup.failed) return null;
  return (
    <div className="section">
      <div className="card pad row" style={{ gap: 8, background: '#FFF4E5', borderColor: '#E0A23B' }}>
        <span className="grow small">{cup.matches.length || cup.sides.length ? 'No signal — showing the last scores this phone saw.' : 'Can’t reach the cup — check your signal.'}</span>
        <button type="button" className="btn ghost sm" onClick={cup.reload}>Try again</button>
      </div>
    </div>
  );
}

function names(data, ids) {
  return (ids || []).map((id) => playerName(data.playersById[id])).join(' & ') || '—';
}

function sideNames(sides) {
  return { a: sides[0]?.name || 'Team 1', b: sides[1]?.name || 'Team 2' };
}

// ------------------------------------------------------------------ The board
export default function Cup() {
  const data = useData();
  const { status } = useSession();
  const cup = useCup();
  // The Cup comp (migration 067) gives the Cup its name and points; none yet (an older group) = the trip's.
  const [comps] = useComps();
  const cupComp = comps.find((c) => c.kind === 'cup' && !c.retired) || null;
  const [params] = useSearchParams();
  const [setup, setSetup] = useState(params.get('setup') === '1');
  const { sides, matches } = cup;
  const rounds = useMemo(() => data.rounds.filter((r) => matches.some((m) => m.round_id === r.id)), [data.rounds, matches]);
  const totals = cupTotals(matches);
  // The whole cup's points (set by the organiser, e.g. 28), so "to win" is right before every day's matches exist.
  // The trip's own points first while both exist: an older phone only updates trips.cup_points (release review).
  const cupPoints = Number(data.currentTrip?.cup_points) || Number(cupComp?.settings?.points) || totals.total;
  const n = sideNames(sides);
  const [A, B] = sides;

  if (!cup.ready) return <div className="page"><Header logo title="The Cup" /><Loading /></div>;
  return (
    <div className="page">
      <Header logo title={cupComp?.name || data.currentTrip?.name || 'The Cup'} sub="Team match play" />
      <Offline cup={cup} />
      {sides.length === 2 ? (
        <div className="section">
          <div className="card pad" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, textAlign: 'center' }}>
            <div><div style={{ fontWeight: 800, color: A.colour }}>{A.name}</div><div style={{ fontSize: 40, fontWeight: 800, color: A.colour }}>{pts(totals.won.a)}</div></div>
            <div className="small muted">{cupPoints ? <>{pts(toWin(cupPoints))}<br />to win</> : 'v'}</div>
            <div><div style={{ fontWeight: 800, color: B.colour }}>{B.name}</div><div style={{ fontSize: 40, fontWeight: 800, color: B.colour }}>{pts(totals.won.b)}</div></div>
            {(totals.projected.a !== totals.won.a || totals.projected.b !== totals.won.b) && (
              <div className="small muted" style={{ gridColumn: '1 / -1' }}>If it finished now: {A.name} {pts(totals.projected.a)} – {pts(totals.projected.b)} {B.name}</div>
            )}
          </div>
        </div>
      ) : (
        cup.failed ? null : <div className="empty">{status.is_admin ? 'Set up the two teams below to start the cup.' : 'The organiser hasn’t set up the teams yet.'}</div>
      )}

      {rounds.map((r) => {
        const ms = matches.filter((m) => m.round_id === r.id);
        const t = cupTotals(ms);
        return (
          <div key={r.id} className="section stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="label">{r.name}</div>
              <div className="small muted">{pts(t.won.a)} – {pts(t.won.b)} · {pts(t.total)} pts</div>
            </div>
            {ms.map((m) => <MatchRow key={m.id} m={m} sides={sides} data={data} />)}
          </div>
        );
      })}
      {sides.length === 2 && !matches.length && <div className="empty">No matches yet.{status.is_admin ? ' Add them below.' : ''}</div>}

      {status.is_admin && !status.viewing && (
        <div className="section" style={{ paddingBottom: 24 }}>
          <button type="button" className="btn ghost block" onClick={() => setSetup(!setup)}>{setup ? 'Hide set-up' : '⚙️ Set up the cup (organiser)'}</button>
          {setup && <CupSetup cup={cup} cupComp={cupComp} />}
        </div>
      )}
      {!status.is_admin && <div className="section small muted" style={{ paddingBottom: 24 }}>Tap your match to score it. Anyone in the group can score, so one person per match is plenty.</div>}
      {sides.length !== 2 && !status.is_admin && <div className="small muted section">{n.a} v {n.b}</div>}
    </div>
  );
}

function MatchRow({ m, sides, data }) {
  const n = sideNames(sides);
  const s = matchState(m);
  const col = s.leader === 'a' ? sides[0]?.colour : s.leader === 'b' ? sides[1]?.colour : 'var(--muted)';
  const p = matchPoints(m);
  return (
    <Link to={`/cup/${m.id}`} className="card pad" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', textDecoration: 'none', color: 'inherit', borderLeft: `5px solid ${s.leader === 'a' || s.winner === 'a' ? sides[0]?.colour : 'var(--line)'}`, borderRight: `5px solid ${s.leader === 'b' || s.winner === 'b' ? sides[1]?.colour : 'var(--line)'}` }}>
      <div style={{ fontWeight: 700, color: sides[0]?.colour }}>{names(data, m.a_players)}</div>
      <div style={{ textAlign: 'center', minWidth: 96 }}>
        <div style={{ fontWeight: 800, color: col }}>{matchText(m, n)}</div>
        <div className="small muted">{FORMAT_LABEL[m.format]} · {s.decided ? `${pts(p.a)}–${pts(p.b)}` : `${pts(Number(m.points))} pt${Number(m.points) === 1 ? '' : 's'}`}</div>
      </div>
      <div style={{ fontWeight: 700, color: sides[1]?.colour, textAlign: 'right' }}>{names(data, m.b_players)}</div>
    </Link>
  );
}

// ------------------------------------------------------------------ Scoring a match
export function CupMatch() {
  const { matchId } = useParams();
  const data = useData();
  const { status } = useSession();
  const cup = useCup();
  const nav = useNavigate();
  const [busy, run] = useRun();
  const m = cup.matches.find((x) => x.id === matchId);
  const [hole, setHole] = useState(null);
  const [picked, setPicked] = useState(false); // a hole chip was tapped (to fix one) rather than moved on to
  const [saved, setSaved] = useState(null); // "✓ Hole 3: Team Blue" after a save, for a moment
  const coolUntil = useRef(0); // a quick second tap mustn't land on the next hole
  const [local, setLocal] = useState(null); // holes just saved, until the live copy catches up
  useEffect(() => { setLocal(null); }, [m?.updated_at]);
  if (!cup.ready) return <div className="page"><Header back title="Match" /><Loading /></div>;
  if (!m) return <div className="page"><Header back title="Match" /><Offline cup={cup} />{!cup.failed && <div className="empty">That match isn’t here any more.</div>}</div>;
  const match = local ? { ...m, holes: local } : m;
  const sides = cup.sides;
  const n = sideNames(sides);
  const round = data.rounds.find((r) => r.id === m.round_id);
  const course = round ? data.coursesById[round.course_id] : null;
  const h = hole || nextHole(match);
  const info = course?.holes?.find((x) => x.n === h);
  const shot = shotsOnHole(match, info);
  const s = matchState(match);
  const res = match.holes?.[String(h)] || null;
  const { side: shotSide, diff } = shots(match);

  const save = async (result) => {
    if (Date.now() < coolUntil.current) return;
    const holes = await run(() => must(supabase.rpc('set_cup_hole', { p_match: m.id, p_hole: h, p_result: result })));
    if (!holes) return;
    setLocal(holes);
    const after = matchState({ ...match, holes });
    setSaved(result ? { hole: h, text: result === 'h' ? 'halved' : result === 'a' ? n.a : n.b } : null);
    if (result && !after.decided && h < 18) {
      coolUntil.current = Date.now() + 1200;
      setPicked(false);
      setHole(h + 1);
    } else if (after.decided) toast(matchText({ ...match, holes }, n));
  };
  useEffect(() => {
    if (!saved) return undefined;
    const t = setTimeout(() => setSaved(null), 4000);
    return () => clearTimeout(t);
  }, [saved]);
  // Once the match is decided, the buttons only come back for a hole that's tapped (to fix a mistake).
  const locked = s.decided && !res && !picked;
  const big = (side, label, colour) => (
    <button type="button" className="btn block" disabled={busy || status.viewing}
      onClick={() => save(res === side ? null : side)}
      style={{ minHeight: 64, fontSize: 18, background: res === side ? colour : '#fff', color: res === side ? '#fff' : colour, border: `2px solid ${colour}` }}>
      {label}
    </button>
  );

  return (
    <div className="page">
      <Header back="The Cup" title={`${names(data, m.a_players)} v ${names(data, m.b_players)}`} sub={`${round?.name || ''} · ${FORMAT_LABEL[m.format]} · ${pts(Number(m.points))} pt${Number(m.points) === 1 ? '' : 's'}`} />
      <Offline cup={cup} />
      <div className="section">
        <div className="card pad" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: s.leader === 'a' ? sides[0]?.colour : s.leader === 'b' ? sides[1]?.colour : 'inherit' }}>{matchText(match, n)}</div>
          <div className="small muted">
            Handicaps {Number(m.a_hcp)} v {Number(m.b_hcp)}{shotSide ? ` · ${shotSide === 'a' ? n.a : n.b} get ${diff} shot${diff === 1 ? '' : 's'}` : ' · no shots'}
          </div>
        </div>
      </div>

      <div className="chips" role="group" aria-label="Hole">
        {Array.from({ length: 18 }, (_, i) => i + 1).map((k) => {
          const r = match.holes?.[String(k)];
          const bg = r === 'a' ? sides[0]?.colour : r === 'b' ? sides[1]?.colour : r === 'h' ? '#8A94A3' : undefined;
          const hasShot = shotsOnHole(match, course?.holes?.find((x) => x.n === k)).n > 0;
          return (
            <button key={k} type="button" className="chip" aria-pressed={k === h} onClick={() => { setHole(k); setPicked(true); coolUntil.current = 0; }}
              style={bg && k !== h ? { background: bg, borderColor: bg, color: '#fff' } : undefined}>
              {k}{hasShot ? '•' : ''}
            </button>
          );
        })}
      </div>

      <div className="section stack" style={{ gap: 10 }}>
        <div className="card pad stack" style={{ gap: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Hole {h}</div>
          {info?.si ? <div className="muted">Par {info.par} · Stroke index {info.si}</div> : null}
          {!info?.si && shotSide
            ? <div style={{ fontWeight: 700 }}>This course has no stroke index here — {shotSide === 'a' ? n.a : n.b} get a shot on stroke index 1{diff > 1 ? `–${Math.min(diff, 18)}` : ''}{diff > 18 ? ' (and a second on 1–' + (diff - 18) + ')' : ''}. Check the card.</div>
            : shot.n > 0
            ? <div style={{ fontWeight: 700, color: shot.side === 'a' ? sides[0]?.colour : sides[1]?.colour }}>🎯 {shot.side === 'a' ? n.a : n.b} ({names(data, shot.side === 'a' ? m.a_players : m.b_players)}) get {shot.n === 1 ? 'a shot' : `${shot.n} shots`} here</div>
            : <div className="small muted">No shots on this hole</div>}
        </div>
        {saved && <div className="small" style={{ textAlign: 'center', fontWeight: 700 }} role="status">✓ Hole {saved.hole} saved: {saved.text}</div>}
        {!locked && <>
          <div className="label" style={{ textAlign: 'center' }}>Who won the hole (after shots)?</div>
          {big('a', `${n.a} — ${names(data, m.a_players)}`, sides[0]?.colour || 'var(--navy)')}
          {big('h', 'Halved', '#5B6573')}
          {big('b', `${n.b} — ${names(data, m.b_players)}`, sides[1]?.colour || 'var(--navy)')}
        </>}
        {res && <button type="button" className="btn ghost sm" disabled={busy || status.viewing} onClick={() => save(null)}>Clear hole {h}</button>}
        {s.decided && <div className="card pad" style={{ textAlign: 'center', fontWeight: 700 }}>Match over: {matchText(match, n)}. Tap a hole above to fix a mistake.</div>}
        <button type="button" className="btn ghost block" onClick={() => nav('/cup')}>Back to the board</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Organiser set-up
function CupSetup({ cup, cupComp }) {
  const data = useData();
  const [busy, run] = useRun();
  const { sides } = cup;
  if (sides.length < 2) {
    return (
      <div className="card pad stack" style={{ gap: 8, marginTop: 10 }}>
        <strong>1. Make the two teams</strong>
        <div className="small muted">You can rename them and change their colours straight after.</div>
        <button type="button" className="btn gold" disabled={busy} onClick={() => run(async () => {
          for (const s of DEFAULT_SIDES) if (!sides.some((x) => x.sort === s.sort)) await must(supabase.from('cup_sides').insert(cupComp ? { ...s, comp_id: cupComp.id } : s));
          await cup.reload();
        }, 'Teams made')}>Make Team Blue and Team Red</button>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 12, marginTop: 10 }}>
      <TeamsCard cup={cup} />
      <CupPoints cupComp={cupComp} />
      {sides.map((s) => <TeamLink key={s.id} side={s} />)}
      <PlayersCard cup={cup} />
      <AddMatch cup={cup} cupComp={cupComp} />
      <MatchList cup={cup} data={data} />
    </div>
  );
}

function CupPoints({ cupComp }) {
  const data = useData();
  const trip = data.currentTrip;
  const [busy, run] = useRun();
  const saved = trip?.cup_points ?? cupComp?.settings?.points;
  const [val, setVal] = useState(saved != null ? String(Number(saved)) : '');
  if (!trip) return null;
  const changed = val !== (saved != null ? String(Number(saved)) : '');
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <strong>Points in the whole cup</strong>
      <div className="small muted">All days added up (e.g. 14 on Friday + 14 on Saturday = 28), so the board shows the right number to win from day one.</div>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" style={{ maxWidth: 110 }} inputMode="decimal" value={val} placeholder="e.g. 28" onChange={(e) => setVal(e.target.value)} />
        {changed && <button type="button" className="btn sm" disabled={busy} onClick={() => run(async () => {
          const n = val.trim() === '' ? null : Number(val.replace(',', '.'));
          await must(supabase.from('trips').update({ cup_points: n }).eq('id', trip.id));
          if (cupComp) {
            const { points: _old, ...rest } = cupComp.settings || {};
            await must(supabase.from('comps').update({ settings: cleanSettings('cup', n ? { ...rest, points: n } : rest) }).eq('id', cupComp.id));
          }
          await data.reload();
        }, 'Saved')}>Save</button>}
        {!changed && val && <span className="small muted">{pts(toWin(Number(val)))} to win</span>}
      </div>
    </div>
  );
}

function TeamsCard({ cup }) {
  const [busy, run] = useRun();
  const [draft, setDraft] = useState(() => cup.sides.map((s) => ({ id: s.id, name: s.name, colour: s.colour })));
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <strong>Teams</strong>
      {draft.map((d, i) => (
        <div key={d.id} className="stack" style={{ gap: 6 }}>
          <input className="input" value={d.name} maxLength={30} aria-label={`Team ${i + 1} name`}
            onChange={(e) => setDraft(draft.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)))} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {COLOURS.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={d.colour === c}
                onClick={() => setDraft(draft.map((x) => (x.id === d.id ? { ...x, colour: c } : x)))}
                style={{ width: 30, height: 30, borderRadius: 999, background: c, border: d.colour === c ? '3px solid var(--gold)' : '1px solid #fff' }} />
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="btn sm" disabled={busy || draft.some((d) => !d.name.trim())} onClick={() => run(async () => {
        for (const d of draft) await must(supabase.from('cup_sides').update({ name: d.name.trim(), colour: d.colour }).eq('id', d.id));
        await cup.reload();
      }, 'Teams saved')}>Save teams</button>
    </div>
  );
}

function TeamLink({ side }) {
  const [code, setCode] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, run] = useRun();
  const load = useCallback(async (fresh = false) => {
    setFailed(false);
    const { data, error } = await supabase.rpc('team_invite', { p_side: side.id, p_new: fresh });
    if (error) { setFailed(true); throw error; }
    setCode(data);
  }, [side.id]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const link = code ? inviteLink(code) : '';
  return (
    <div className="card pad stack" style={{ gap: 8, borderLeft: `5px solid ${side.colour}` }}>
      <div><strong style={{ color: side.colour }}>✉️ {side.name} link</strong><div className="small muted">Anyone who opens it joins as a player on {side.name}, approved straight away.</div></div>
      {!code && failed ? <button type="button" className="btn ghost sm" onClick={() => load().catch(() => {})}>Couldn’t get the link — try again</button> : !code ? <Loading /> : (
        <>
          <code style={{ fontSize: 13, wordBreak: 'break-all', background: 'var(--bg, #F4F5F7)', padding: 8, borderRadius: 8 }}>{link}</code>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn gold sm" onClick={async () => {
              const r = await shareText(`You're on ${side.name}! Join the cup on the golf app: ${link}`);
              if (r === 'copied') toast('Link copied — paste it in the team chat');
              else if (r === 'failed') toast('Couldn’t share from this phone');
            }}>Share link</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => {
              if (window.confirm(`Make a new ${side.name} link? The old one stops working (people already in stay in).`)) run(() => load(true), 'New link made');
            }}>New link</button>
          </div>
        </>
      )}
    </div>
  );
}

function PlayersCard({ cup }) {
  const data = useData();
  const [busy, run] = useRun();
  const [open, setOpen] = useState(false);
  const players = data.players.filter((p) => p.approved !== false).sort((a, b) => playerName(a).localeCompare(playerName(b)));
  const count = (sid) => players.filter((p) => p.cup_side === sid).length;
  const setSide = (p, sid) => run(async () => { await must(supabase.from('players').update({ cup_side: sid }).eq('id', p.id)); await data.reload(); });
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <button type="button" className="row" style={{ background: 'none', border: 0, padding: 0, justifyContent: 'space-between', width: '100%' }} onClick={() => setOpen(!open)}>
        <strong>Who’s on which team</strong>
        <span className="small muted">{cup.sides.map((s) => `${s.name} ${count(s.id)}`).join(' · ')} · no team {players.filter((p) => !p.cup_side).length} {open ? '▲' : '▼'}</span>
      </button>
      {open && players.map((p) => (
        <div key={p.id} className="row" style={{ gap: 8 }}>
          <Avatar player={p} size={28} />
          <div className="grow ellipsis">{playerName(p)} <span className="small muted">({Number(p.handicap)})</span></div>
          {cup.sides.map((s) => (
            <button key={s.id} type="button" className="chip" disabled={busy} aria-pressed={p.cup_side === s.id}
              style={p.cup_side === s.id ? { background: s.colour, borderColor: s.colour, color: '#fff' } : undefined}
              onClick={() => setSide(p, p.cup_side === s.id ? null : s.id)}>{s.name}</button>
          ))}
        </div>
      ))}
      {open && !players.length && <div className="small muted">Nobody yet — send the team links.</div>}
    </div>
  );
}

function PlayerPick({ label, colour, options, value, onChange, max }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="small" style={{ fontWeight: 700, color: colour }}>{label} (pick {max === 1 ? '1' : 'up to 2'})</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {options.map((p) => {
          const on = value.includes(p.id);
          return (
            <button key={p.id} type="button" className="chip" aria-pressed={on}
              style={on ? { background: colour, borderColor: colour, color: '#fff' } : undefined}
              onClick={() => onChange(on ? value.filter((x) => x !== p.id) : max === 1 ? [p.id] : [...value, p.id].slice(-max))}>
              {playerName(p)}
            </button>
          );
        })}
        {!options.length && <span className="small muted">Nobody on this team yet.</span>}
      </div>
    </div>
  );
}

function AddMatch({ cup, cupComp }) {
  const data = useData();
  const [busy, run] = useRun();
  const tripRounds = data.rounds.filter((r) => r.trip_id === data.currentTrip?.id);
  const [roundId, setRoundId] = useState(() => (tripRounds.find((r) => r.status !== 'locked') || tripRounds[0])?.id || '');
  // Each session's format and points a match, as set on the Cup comp (migration 067).
  const ses = (rid) => cupComp?.settings?.sessions?.[rid] || {};
  const [format, setFormat] = useState(() => ses(roundId).format || 'ambrose');
  const [a, setA] = useState([]);
  const [b, setB] = useState([]);
  const [points, setPoints] = useState(() => String(ses(roundId).points ?? ((ses(roundId).format || 'ambrose') === 'ambrose' ? 2 : 1)));
  const [hcp, setHcp] = useState({ a: '', b: '' });
  const [A, B] = cup.sides;
  const used = new Set(cup.matches.filter((m) => m.round_id === roundId).flatMap((m) => [...m.a_players, ...m.b_players]));
  const pool = (sid) => data.players.filter((p) => p.cup_side === sid && p.approved !== false && !used.has(p.id))
    .sort((x, y) => playerName(x).localeCompare(playerName(y)));
  const max = format === 'ambrose' ? 2 : 1;
  const auto = (ids) => sideHandicap(format, ids.map((id) => data.playersById[id]?.handicap));
  const num = (t) => Number(String(t).replace(',', '.'));
  const aH = hcp.a === '' ? auto(a) : num(hcp.a);
  const bH = hcp.b === '' ? auto(b) : num(hcp.b);
  const ok = roundId && a.length && b.length && (format === 'singles' || (a.length === 2 && b.length === 2)) && num(points) > 0
    && Number.isFinite(aH) && Number.isFinite(bH) && aH >= -10 && aH <= 54 && bH >= -10 && bH <= 54;
  const add = () => run(async () => {
    const sort = cup.matches.filter((m) => m.round_id === roundId).length + 1;
    await must(supabase.from('cup_matches').insert({ round_id: roundId, sort, format, a_players: a, b_players: b, a_hcp: aH, b_hcp: bH, points: num(points) }));
    setA([]); setB([]); setHcp({ a: '', b: '' });
    await cup.reload();
  }, 'Match added');
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <strong>Add a match</strong>
      <label className="field"><span>Day</span>
        <select className="select" value={roundId} onChange={(e) => {
          const s = ses(e.target.value);
          setRoundId(e.target.value); setA([]); setB([]);
          if (s.format) setFormat(s.format);
          if (s.points != null || s.format) setPoints(String(s.points ?? (s.format === 'singles' ? 1 : 2)));
        }}>
          {tripRounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <div className="row" style={{ gap: 6 }}>
        {['ambrose', 'singles'].map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={format === f} onClick={() => { setFormat(f); setPoints(f === 'ambrose' ? '2' : '1'); setA([]); setB([]); setHcp({ a: '', b: '' }); }}>{FORMAT_LABEL[f]}</button>
        ))}
      </div>
      <PlayerPick label={A.name} colour={A.colour} options={pool(A.id)} value={a} onChange={(v) => { setA(v); setHcp((h) => ({ ...h, a: '' })); }} max={max} />
      <PlayerPick label={B.name} colour={B.colour} options={pool(B.id)} value={b} onChange={(v) => { setB(v); setHcp((h) => ({ ...h, b: '' })); }} max={max} />
      <div className="row" style={{ gap: 8 }}>
        <label className="field grow"><span>{A.name} hcp</span><input className="input" inputMode="decimal" value={hcp.a === '' ? String(aH) : hcp.a} onChange={(e) => setHcp({ ...hcp, a: e.target.value })} /></label>
        <label className="field grow"><span>{B.name} hcp</span><input className="input" inputMode="decimal" value={hcp.b === '' ? String(bH) : hcp.b} onChange={(e) => setHcp({ ...hcp, b: e.target.value })} /></label>
        <label className="field" style={{ width: 80 }}><span>Points</span><input className="input" inputMode="decimal" value={points} onChange={(e) => setPoints(e.target.value)} /></label>
      </div>
      <div className="small muted">{format === 'ambrose' ? 'Ambrose pairs: each pair’s handicap is their two handicaps added up ÷ 4.' : 'Singles: each player’s handicap.'} The higher side gets the difference as shots on the hardest holes. Change either number if you’ve agreed something else.</div>
      <button type="button" className="btn gold" disabled={busy || !ok} onClick={add}>Add match</button>
    </div>
  );
}

function MatchList({ cup, data }) {
  const [busy, run] = useRun();
  if (!cup.matches.length) return null;
  return (
    <div className="card pad stack" style={{ gap: 6 }}>
      <strong>Matches ({cup.matches.length})</strong>
      {cup.matches.map((m) => {
        const r = data.rounds.find((x) => x.id === m.round_id);
        return (
          <div key={m.id} className="row" style={{ gap: 8 }}>
            <div className="grow small">{r?.name} · {names(data, m.a_players)} v {names(data, m.b_players)} · {Number(m.a_hcp)} v {Number(m.b_hcp)} · {pts(Number(m.points))} pts</div>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => {
              if (window.confirm('Delete this match and its hole results?')) run(async () => { await must(supabase.from('cup_matches').delete().eq('id', m.id)); await cup.reload(); }, 'Match deleted');
            }}>Delete</button>
          </div>
        );
      })}
    </div>
  );
}
