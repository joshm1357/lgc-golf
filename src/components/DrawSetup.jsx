import React, { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, playerName } from '../lib/store.jsx';
import { makeDraw, teamSizes, REVEAL_MS } from '../lib/draw.js';
import { Avatar, Sheet, toast } from './ui.jsx';

/** Admin: choose who's in and how many teams, then start the live draw for everyone. */
export default function DrawSetup({ round, onClose }) {
  const data = useData();
  const tripRounds = data.rounds.filter((r) => r.trip_id === round.trip_id && r.id !== round.id);
  const onTrip = new Set(tripRounds.flatMap((r) => (data.roundPlayers[r.id] || []).map((rp) => rp.player_id)));
  const players = data.players.filter((p) => p.approved !== false).sort((a, b) => a.name.localeCompare(b.name));
  const [sel, setSel] = useState(() => players.filter((p) => onTrip.has(p.id) || p.name === 'Hamish Davey').map((p) => p.id));
  const [k, setK] = useState(null);
  const [balance, setBalance] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = sel.length;
  const options = [2, 3, 4, 5].filter((x) => n >= x * 2);
  const teams = k && options.includes(k) ? k : options.find((x) => n / x <= 4) || options[0];
  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const field = sel.map((id) => ({ id, handicap: Number(data.playersById[id].handicap) }));

  async function start() {
    setBusy(true);
    try {
      const d = makeDraw(field, teams, { balance });
      await supabase.from('draws').update({ status: 'cancelled' }).eq('round_id', round.id).in('status', ['running', 'done']);
      const { error } = await supabase.from('draws').insert({
        round_id: round.id,
        payload: { ...d, handicaps: Object.fromEntries(field.map((p) => [p.id, p.handicap])), balance, interval_ms: REVEAL_MS },
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
        <span className="small muted">Random teams, with team handicaps worked out automatically. Everyone with the app open watches it live.</span>
        <span className="label">Who's in ({n})</span>
        <div className="card">
          {players.map((p) => (
            <button key={p.id} type="button" className="row" onClick={() => toggle(p.id)} style={{ width: '100%', padding: '8px 12px', background: sel.includes(p.id) ? 'var(--gold-soft)' : '#fff', border: 0, borderBottom: '1px solid var(--line-soft)', textAlign: 'left' }} aria-pressed={sel.includes(p.id)}>
              <Avatar player={p} size={30} />
              <span className="grow" style={{ fontWeight: 600 }}>{playerName(p)}</span>
              <span className="small muted">off {Number(p.handicap)}</span>
              <span style={{ width: 22, textAlign: 'right', fontWeight: 700 }}>{sel.includes(p.id) ? '✓' : ''}</span>
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
            <span className="label">How random</span>
            <div className="seg light" role="group">
              <button type="button" aria-pressed={!balance} onClick={() => setBalance(false)}>Fully random</button>
              <button type="button" aria-pressed={balance} onClick={() => setBalance(true)}>Even it out</button>
            </div>
            <span className="small muted">
              {balance ? 'Still random, but only line-ups where the team handicaps are within a shot of each other.' : 'Pure luck of the draw — could be stacked.'}
              {' '}Team handicap = combined handicaps ÷ (2 × team size): 4-player ÷ 8, 3-player ÷ 6. Locking in the draw replaces any teams already set for this round.
            </span>
            <button type="button" className="btn gold block" disabled={busy || !teams} onClick={start} style={{ minHeight: 56, fontSize: 18 }}>
              {busy ? 'Starting…' : `🎲 Start the draw — ${teams} teams`}
            </button>
          </>
        ) : <div className="err">Pick at least 4 players.</div>}
      </div>
    </Sheet>
  );
}
