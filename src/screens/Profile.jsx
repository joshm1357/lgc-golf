import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useScores, useSession, playerName } from '../lib/store.jsx';
import { roundBoard } from '../lib/board.js';
import { uploadPhoto } from '../lib/images.js';
import { Header, Avatar, Icon, Loading, toast } from '../components/ui.jsx';

/** Everything we know about a player: Stableford rounds, Ambrose results, trophies, comps, Tribunal, handicap. */
export function usePlayerHistory(playerId) {
  const data = useData();
  const roundIds = data.rounds.map((r) => r.id);
  const scores = useScores(roundIds);
  const [extra, setExtra] = useState({ hist: [], cases: [], side: [] });
  useEffect(() => {
    if (!playerId) return;
    Promise.all([
      supabase.from('handicap_history').select('*').eq('player_id', playerId).order('created_at'),
      supabase.from('tribunal_cases').select('*').eq('accused_id', playerId).order('created_at', { ascending: false }),
      supabase.from('side_entries').select('*'),
    ]).then(([h, c, s]) => setExtra({ hist: h.data || [], cases: c.data || [], side: s.data || [] }));
  }, [playerId]);

  return useMemo(() => {
    const stableford = [];
    const ambrose = [];
    for (const r of data.rounds) {
      const course = data.coursesById[r.course_id];
      if (r.format === 'stableford') {
        if (!(data.roundPlayers[r.id] || []).some((rp) => rp.player_id === playerId)) continue;
        const b = roundBoard({ round: r, course, roundPlayers: data.roundPlayers[r.id] || [], playersById: data.playersById, scoresIdx: scores.index, quickResults: data.quick_results });
        const row = b.rows.find((x) => x.id === playerId);
        if (row && row.thru > 0) stableford.push({ round: r, course, points: row.points, finished: row.finished, rank: row.rankLabel, of: b.rows.length });
      } else {
        const team = (data.teamsByRound[r.id] || []).find((t) => t.players.some((p) => p.id === playerId));
        if (!team) continue;
        const b = roundBoard({ round: r, course, teams: data.teamsByRound[r.id], playersById: data.playersById, scoresIdx: scores.index });
        const row = b.rows.find((x) => x.id === team.id);
        if (row && row.thru > 0) ambrose.push({ round: r, course, team, rank: row.rankLabel, of: b.rows.length, netToPar: row.netToPar });
      }
    }
    const finished = stableford.filter((s) => s.finished);
    const avg = finished.length ? finished.reduce((a, s) => a + s.points, 0) / finished.length : null;
    const best = finished.length ? Math.max(...finished.map((s) => s.points)) : null;
    const p = data.playersById[playerId];
    const honours = data.honour_board.filter((h) =>
      (h.player_ids || []).includes(playerId) || (p && h.winner_names.toLowerCase().includes(p.name.toLowerCase()))
    ).sort((a, b) => b.sort_key - a.sort_key);
    // Side comp wins: best entry per round/hole/kind.
    const groups = {};
    for (const e of extra.side) (groups[`${e.round_id}|${e.hole}|${e.kind}`] ||= []).push(e);
    let sideWins = 0;
    for (const list of Object.values(groups)) {
      const best2 = [...list].filter((e) => e.distance_m != null).sort((a, b) => (list[0].kind === 'ctp' ? a.distance_m - b.distance_m : b.distance_m - a.distance_m))[0];
      if (best2?.player_id === playerId) sideWins++;
    }
    return { stableford, ambrose, avg, best, honours, sideWins, hist: extra.hist, cases: extra.cases };
  }, [data, scores.index, playerId, extra]);
}

function HcpChart({ hist }) {
  const pts = hist.map((h) => Number(h.new_handicap));
  if (pts.length < 2) return null;
  const w = 300, hgt = 70, min = Math.min(...pts) - 1, max = Math.max(...pts) + 1;
  const x = (i) => (i / (pts.length - 1)) * (w - 20) + 10;
  const y = (v) => hgt - 8 - ((v - min) / (max - min)) * (hgt - 16);
  return (
    <svg viewBox={`0 0 ${w} ${hgt}`} width="100%" height={hgt} role="img" aria-label={`Handicap over time: ${pts.join(', ')}`}>
      <polyline points={pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="#1C2B3F" strokeWidth="2.5" />
      {pts.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="4" fill="#D9A521" stroke="#1C2B3F" strokeWidth="1.5" />)}
    </svg>
  );
}

export default function Profile() {
  const { playerId } = useParams();
  const { status } = useSession();
  const data = useData();
  const p = data.playersById[playerId];
  const h = usePlayerHistory(playerId);
  const isMe = status.player_id === playerId;
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState('');
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  if (!p) return <Loading text="Player not found" />;

  async function changePhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const url = await uploadPhoto(f, 'avatars', { maxDim: 400, square: true, quality: 0.85 });
      const { error } = await supabase.from('players').update({ avatar_url: url }).eq('id', p.id);
      if (error) throw error;
      toast('Photo updated');
      data.reload();
    } catch (e2) {
      toast(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  }

  async function saveNames() {
    const { error } = await supabase.from('players').update({ name: name.trim() || p.name, nickname: nick.trim() || null }).eq('id', p.id);
    if (error) toast(friendlyError(error));
    else { toast('Saved'); setEdit(false); data.reload(); }
  }

  const canEdit = isMe || status.is_admin;
  return (
    <div className="page">
      <Header back title={p.name} sub={p.nickname ? `“${p.nickname}”` : 'Player profile'} />
      <div className="section stack">
        <div className="card pad row" style={{ gap: 16 }}>
          <div style={{ position: 'relative' }}>
            <Avatar player={p} size={92} />
            {canEdit && (
              <button type="button" className="btn sm" style={{ position: 'absolute', right: -6, bottom: -4, minHeight: 34, padding: '0 8px', borderRadius: 999 }} onClick={() => fileRef.current.click()} disabled={busy} aria-label="Change photo">{Icon.camera(16)}</button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={changePhoto} />
          </div>
          <div className="grow">
            <div className="label">Handicap</div>
            <div className="num" style={{ fontSize: 44, lineHeight: 1 }}>{Number(p.handicap)}</div>
            <div className="small muted">Changes only via the admin or the Tribunal</div>
          </div>
        </div>
        {canEdit && (edit ? (
          <div className="card pad stack">
            <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field"><span>Nickname</span><input className="input" value={nick} onChange={(e) => setNick(e.target.value)} /></label>
            <div className="row"><button type="button" className="btn ghost grow" onClick={() => setEdit(false)}>Cancel</button><button type="button" className="btn grow" onClick={saveNames}>Save</button></div>
          </div>
        ) : (
          <button type="button" className="btn ghost" onClick={() => { setName(p.name); setNick(p.nickname || ''); setEdit(true); }}>Edit name / nickname</button>
        ))}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
          {[['Rounds', h.stableford.length + h.ambrose.length], ['Avg pts', h.avg != null ? h.avg.toFixed(1) : '–'], ['Best', h.best ?? '–'], ['Comp wins', h.sideWins]].map(([k, v]) => (
            <div key={k} className="card" style={{ padding: '10px 6px', textAlign: 'center' }}>
              <div className="num" style={{ fontSize: 26 }}>{v}</div>
              <div className="small muted">{k}</div>
            </div>
          ))}
        </div>

        {h.honours.length > 0 && (
          <div className="card pad stack">
            <span className="label">Trophies</span>
            {h.honours.map((x) => <div key={x.id} className="row">{Icon.trophy(18)}<strong>{x.trophy_name}</strong><span className="muted">{x.label}</span></div>)}
          </div>
        )}

        <div className="card pad stack">
          <span className="label">Handicap history</span>
          <HcpChart hist={h.hist} />
          {h.hist.slice().reverse().map((x) => (
            <div key={x.id} className="row between small">
              <span>{x.old_handicap != null ? `${Number(x.old_handicap)} → ` : ''}<strong>{Number(x.new_handicap)}</strong> · {x.reason}</span>
              <span className="muted">{new Date(x.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
            </div>
          ))}
          {!h.hist.length && <span className="muted small">No changes yet.</span>}
        </div>

        {(h.stableford.length > 0 || h.ambrose.length > 0) && (
          <div className="card pad stack">
            <span className="label">Rounds</span>
            {h.stableford.map((s) => (
              <div key={s.round.id} className="row between">
                <span><strong>{s.round.name}</strong> <span className="muted small">{s.course?.name}</span></span>
                <span>{s.points} pts · {s.rank}/{s.of}</span>
              </div>
            ))}
            {h.ambrose.map((s) => (
              <div key={s.round.id} className="row between">
                <span><strong>{s.round.name}</strong> <span className="muted small">{s.team.name}</span></span>
                <span>{s.rank}/{s.of}</span>
              </div>
            ))}
          </div>
        )}

        <div className="card pad stack">
          <span className="label">Tribunal record</span>
          {h.cases.length ? h.cases.map((c) => (
            <Link key={c.id} to={`/tribunal/${c.id}`} className="row between" style={{ color: 'inherit', textDecoration: 'none' }}>
              <span>Proposed {c.proposed_change > 0 ? '+' : ''}{Number(c.proposed_change)}</span>
              <span className="muted">{c.status === 'open' ? 'Open' : c.verdict === 'upheld' ? 'Guilty' : 'Not guilty'}</span>
            </Link>
          )) : <span className="muted small">Clean record. For now.</span>}
        </div>
        {isMe && <p className="note">Signed in as {playerName(p)} on this phone.</p>}
      </div>
    </div>
  );
}
