// A self-contained example of The Draw — nothing is saved. Open with ?demo=draw
import React, { useMemo, useState } from 'react';
import { DemoProviders } from '../lib/store.jsx';
import DrawCeremony from '../components/DrawCeremony.jsx';
import { makeDraw, teamSizes, REVEAL_MS } from '../lib/draw.js';
import { Toaster } from '../components/ui.jsx';

const FIELD = [
  ['Joshua Moran', 'Josh', 13], ['Michael Morris', 'Mike', 30], ['Fred Hammer', null, 18], ['Chris Payton', null, 27],
  ['Adam Halmarick', null, 16], ['Cameron Harrison', 'Cam', 27], ['Alasdair Davey', 'Al', 30], ['Mark Lewis', null, 16],
  ['Hamish Davey', null, 27],
].map(([name, nickname, handicap], i) => ({ id: `p${i}`, name, nickname, handicap, avatar_url: null, approved: true }));

export default function DrawDemo() {
  const [asAdmin, setAsAdmin] = useState(true);
  const [k, setK] = useState(3);
  const [balance, setBalance] = useState(false);
  const fresh = (kk = k, bal = balance) => ({ id: 'demo', round_id: 'demo-round', status: 'lobby', started_at: new Date().toISOString(), payload: { field: FIELD.map((p) => p.id), k: kk, balance: bal, interval_ms: REVEAL_MS } });
  const [draw, setDraw] = useState(fresh());
  const [round, setRound] = useState({ id: 'demo-round', name: 'Sunday Ambrose — Shoalhaven Heads', status: 'setup' });

  const data = useMemo(() => ({
    ready: true, players: FIELD, playersById: Object.fromEntries(FIELD.map((p) => [p.id, p])), rounds: [round], reload: () => {},
  }), [round]);
  const session = { loading: false, status: { is_member: true, is_admin: asAdmin, player_id: 'p0' }, refresh: () => {} };

  const actions = {
    async start(d, field) { setDraw({ ...d, status: 'running', payload: { ...d.payload, ...makeDraw(field, d.payload.k, { balance: d.payload.balance }) }, started_at: new Date(Date.now() + 5000).toISOString() }); },
    async finish(d) { setDraw((x) => (x.status === 'running' ? { ...x, status: 'done' } : x)); },
    async lock(d, _data, _me, startRound) { setDraw({ ...d, status: 'locked' }); if (startRound) setRound({ ...round, status: 'live' }); },
    async cancel() { setDraw(fresh()); },
    async reopen() { setDraw(fresh()); },
  };

  return (
    <DemoProviders session={session} data={data}>
      <DrawCeremony draw={draw} actions={actions} demo onClose={() => setDraw(fresh())} />
      <div style={{ position: 'fixed', left: 0, right: 0, top: 0, zIndex: 90, background: '#D9A521', color: '#15202E', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
        <span>EXAMPLE — nothing is saved</span>
        <button type="button" onClick={() => setAsAdmin(!asAdmin)} style={{ border: '1px solid #15202E', borderRadius: 999, background: 'transparent', padding: '2px 10px', fontWeight: 700 }}>{asAdmin ? 'View as a player' : 'View as admin'}</button>
        {draw.status === 'lobby' && (
          <>
            <select value={k} onChange={(e) => { const v = Number(e.target.value); setK(v); setDraw(fresh(v, balance)); }} style={{ borderRadius: 6, fontWeight: 700 }} aria-label="Team size">
              {[2, 3, 4].map((x) => <option key={x} value={x}>{x} teams ({teamSizes(FIELD.length, x).join('-')})</option>)}
            </select>
            <select value={balance ? 'close' : 'random'} onChange={(e) => { const b = e.target.value === 'close'; setBalance(b); setDraw(fresh(k, b)); }} style={{ borderRadius: 6, fontWeight: 700 }} aria-label="How random">
              <option value="random">Truly random</option>
              <option value="close">Keep it close</option>
            </select>
          </>
        )}
        {draw.status !== 'lobby' && <button type="button" onClick={() => setDraw(fresh())} style={{ border: '1px solid #15202E', borderRadius: 999, background: 'transparent', padding: '2px 10px', fontWeight: 700 }}>Start over</button>}
      </div>
      <Toaster />
    </DemoProviders>
  );
}
