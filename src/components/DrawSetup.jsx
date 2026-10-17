import React, { useMemo, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useScores, playerName } from '../lib/store.jsx';
import { roundBoard } from '../lib/board.js';
import { salary, makeDraw, teamSizes, REVEAL_MS } from '../lib/draw.js';
import { Avatar, Sheet, toast } from './ui.jsx';

/** Admin: choose who's in and how many teams, then start the live draw for everyone. */
export default function DrawSetup({ round, onClose }) {
  const data = useData();
  const tripRounds = data.rounds.filter((r) => r.trip_id === round.trip_id && r.format === 'stableford');
  const scores = useScores(tripRounds.map((r) => r.id));

  // This trip's Stableford average per player (for the form nudge).
  const avg = useMemo(() => {
    const pts = {};
    for (const r of tripRounds) {
      const b = roundBoard({ round: r, course: data.coursesById[r.course_id], roundPlayers: data.roundPlayers[r.id] || [], playersById: data.playersById, scoresIdx: scores.index, quickResults: data.quick_results });
      for (const row of b.rows) if (row.finished) (pts[row.id] ||= []).push(row.points);
    }
    return Object.fromEntries(Object.entries(pts).map(([id, a]) => [id, a.reduce((x, y) => x + y, 0) / a.length]));
  }, [tripRounds, data, scores.index]);

  const onTrip = new Set(tripRounds.flatMap((r) => (data.roundPlayers[r.id] || []).map((rp) => rp.player_id)));
  const players = data.players.filter((p) => p.approved !== false).sort((a, b) => a.name.localeCompare(b.name));
  const [sel, setSel] = useState(() => players.filter((p) => onTrip.has(p.id)).map((p) => p.id));
  const [k, setK] = useState(null);
  const [busy, setBusy] = useState(false);
  const n = sel.length;
  const options = [2, 3, 4, 5].filter((x) => n >= x * 2);
  const teams = k && options.includes(k) ? k : options.find((x) => n / x <= 4) || options[0];
  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const priced = sel.map((id) => {
    const p = data.playersById[id];
    return { id, handicap: Number(p.handicap), salary: salary(p.handicap, avg[id] ?? null) };
  });

  async function start() {
    setBusy(true);
    try {
      const d = makeDraw(priced, teams);
      await supabase.from('draws').update({ status: 'cancelled' }).eq('round_id', round.id).in('status', ['running', 'done']);
      const { error } = await supabase.from('draws').insert({
        round_id: round.id,
        payload: { ...d, salaries: Object.fromEntries(priced.map((p) => [p.id, p.salary])), interval_ms: REVEAL_MS, started_by: 'admin' },
        // Start 3 seconds from now so every phone catches the first pick.
        started_at: new Date(Date.now() + 3000).toISOString(),
      });
      if (error) throw error;
      onClose();
    } catch (e) {
      toast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="The Draw" onClose={onClose}>
      <div className="stack">
        <span className="small muted">Random teams, kept fair by salary. Everyone with the app open watches it live.</span>
        <span className="label">Who's in ({n})</span>
        <div className="card">
          {players.map((p) => (
            <button key={p.id} type="button" className="row" onClick={() => toggle(p.id)} style={{ width: '100%', padding: '8px 12px', background: sel.includes(p.id) ? 'var(--gold-soft)' : '#fff', border: 0, borderBottom: '1px solid var(--line-soft)', textAlign: 'left' }} aria-pressed={sel.includes(p.id)}>
              <Avatar player={p} size={30} />
              <span className="grow" style={{ fontWeight: 600 }}>{playerName(p)}</span>
              <span className="small muted">off {Number(p.handicap)}{avg[p.id] != null ? ` · avg ${avg[p.id].toFixed(1)} pts` : ''}</span>
              <span className="num" style={{ width: 62, textAlign: 'right' }}>{sel.includes(p.id) ? `$${salary(p.handicap, avg[p.id] ?? null).toFixed(1)}M` : '—'}</span>
            </button>
          ))}
        </div>
        {options.length > 0 ? (
          <>
            <span className="label">How many teams</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {options.map((x) => (
                <button key={x} type="button" className="chip" aria-pressed={x === teams} onClick={() => setK(x)}>
                  {x} teams · {teamSizes(n, x).join('/')}
                </button>
              ))}
            </div>
            <span className="small muted">Team handicap = combined handicaps ÷ (2 × team size) — 4-player ÷ 8, 3-player ÷ 6. Starting the draw replaces any teams already set for this round once you lock it in.</span>
            <button type="button" className="btn gold block" disabled={busy || !teams} onClick={start} style={{ minHeight: 56, fontSize: 18 }}>
              {busy ? 'Starting…' : `🎲 Start the draw — ${teams} teams`}
            </button>
          </>
        ) : <div className="err">Pick at least 4 players.</div>}
      </div>
    </Sheet>
  );
}
