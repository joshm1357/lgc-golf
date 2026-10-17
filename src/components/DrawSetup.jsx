import React, { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useSession, playerName } from '../lib/store.jsx';
import { teamSizes, REVEAL_MS } from '../lib/draw.js';
import { Avatar, Sheet, toast } from './ui.jsx';

/** Admin: choose who's in and how many teams, then start the live draw for everyone. */
export default function DrawSetup({ round, onClose }) {
  const data = useData();
  const me = useSession().status.player_id;
  const tripRounds = data.rounds.filter((r) => r.trip_id === round.trip_id && r.id !== round.id);
  const onTrip = new Set(tripRounds.flatMap((r) => (data.roundPlayers[r.id] || []).map((rp) => rp.player_id)));
  const players = data.players.filter((p) => p.approved !== false).sort((a, b) => a.name.localeCompare(b.name));
  const [sel, setSel] = useState(() => players.filter((p) => onTrip.has(p.id) || p.name === 'Hamish Davey').map((p) => p.id));
  const [k, setK] = useState(null);
  const [balance, setBalance] = useState(false);
  const [pace, setPace] = useState('click');
  const [busy, setBusy] = useState(false);
  const n = sel.length;
  // Every way to split the field into teams of 2 or more, labelled by team size.
  const options = Array.from({ length: Math.floor(n / 2) - 1 }, (_, i) => i + 2);
  const teams = k && options.includes(k) ? k : options.find((x) => n / x <= 4) || options[0];
  const sizeLabel = (x) => {
    const sz = teamSizes(n, x);
    const lo = Math.min(...sz), hi = Math.max(...sz);
    return lo === hi ? `Teams of ${hi} · ${x} teams` : `Teams of ${hi}/${lo} · ${x} teams (${sz.join('-')})`;
  };
  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);

  async function openRoom() {
    setBusy(true);
    try {
      await supabase.from('draws').update({ status: 'cancelled' }).eq('round_id', round.id).in('status', ['lobby', 'running', 'done']);
      const { error } = await supabase.from('draws').insert({
        round_id: round.id,
        status: 'lobby',
        payload: { field: sel, k: teams, balance, pace, interval_ms: REVEAL_MS },
      });
      if (error) throw error;
      await supabase.from('posts').insert({ kind: 'user', player_id: me, round_id: round.id, trip_id: round.trip_id, body: `🎲 The draw room is open for ${round.name} — open the app to watch the teams drawn live.` });
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
            <span className="label">Team size</span>
            <div className="stack" style={{ gap: 6 }}>
              {options.map((x) => (
                <button key={x} type="button" className="chip" style={{ textAlign: 'left' }} aria-pressed={x === teams} onClick={() => setK(x)}>
                  {sizeLabel(x)}
                </button>
              ))}
            </div>
            <span className="label">How random</span>
            <div className="seg light" role="group">
              <button type="button" aria-pressed={!balance} onClick={() => setBalance(false)}>Truly random</button>
              <button type="button" aria-pressed={balance} onClick={() => setBalance(true)}>Keep it close</button>
            </div>
            <span className="label">Reveal</span>
            <div className="seg light" role="group">
              <button type="button" aria-pressed={pace === 'click'} onClick={() => setPace('click')}>I'll click through</button>
              <button type="button" aria-pressed={pace === 'timed'} onClick={() => setPace('timed')}>Timed</button>
            </div>
            <span className="small muted">{pace === 'click' ? 'You tap for each name — the drum rolls for a couple of seconds, then the name lands on everyone\'s phone.' : 'A new name every few seconds, team by team.'}</span>
            <span className="small muted">
              {balance ? 'Still random, but only line-ups where the team handicaps end up within a shot of each other.' : 'Pure luck of the draw — could be stacked.'}
              {' '}Team handicap = combined handicaps ÷ (2 × team size): 4-player ÷ 8, 3-player ÷ 6. Locking in the draw replaces any teams already set for this round.
            </span>
            <button type="button" className="btn gold block" disabled={busy || !teams} onClick={openRoom} style={{ minHeight: 56, fontSize: 18 }}>
              {busy ? 'Opening…' : `🎲 Open the draw room — ${teams} teams`}
            </button>
            <span className="small muted">Everyone's phone shows the draw room. When the lads are watching, you press Start.</span>
          </>
        ) : <div className="err">Pick at least 4 players.</div>}
      </div>
    </Sheet>
  );
}
