// The Draw — a draw room everyone can jump into, then a live ceremony in step on every phone.
//
// Lifecycle (draws.status):
//   lobby    → admin has ticked the players; everyone can open the app and wait in the room
//   running  → admin pressed Start; 5-second countdown, then picks reveal one by one
//   done     → all picks revealed; admin locks in or scraps
//   locked   → teams written to the round
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName } from '../lib/store.jsx';
import { REVEAL_MS, SPIN_MS, teamHandicap, makeDraw } from '../lib/draw.js';
import { Avatar, toast } from './ui.jsx';

export const TEAM_COLOURS = ['#D9A521', '#5FB3E0', '#E0705F', '#7FD1AE', '#C79BE6', '#F2F4F6'];
const COUNTDOWN_MS = 5000;
const DISMISS_KEY = 'lgc-draw-dismissed';

/** Watches for an open draw room or a live draw and takes over the screen. */
export function DrawOverlay() {
  const [draw, setDraw] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const { data } = await supabase.from('draws').select('*').gte('created_at', since).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(1);
    const d = data?.[0] || null;
    // A locked draw only reappears for 30 minutes.
    if (d && d.status === 'locked' && Date.now() - new Date(d.started_at).getTime() > 30 * 60 * 1000) setDraw(null);
    else setDraw(d);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['draws'], load);

  if (!draw || dismissed === draw.id + ':' + draw.status) return null;
  return (
    <DrawCeremony draw={draw} actions={liveActions} onClose={() => {
      const v = draw.id + ':' + draw.status;
      try { localStorage.setItem(DISMISS_KEY, v); } catch { /* ignore */ }
      setDismissed(v);
    }} />
  );
}

/** Real actions: write to the database so every phone follows along. */
const liveActions = {
  async start(draw, field) {
    const d = makeDraw(field, draw.payload.k, { balance: draw.payload.balance });
    const { error } = await supabase.from('draws').update({
      status: 'running',
      payload: { ...draw.payload, ...d },
      started_at: new Date(Date.now() + COUNTDOWN_MS).toISOString(),
    }).eq('id', draw.id);
    if (error) throw error;
  },
  async finish(draw) {
    await supabase.from('draws').update({ status: 'done' }).eq('id', draw.id).eq('status', 'running');
  },
  async lock(draw, data, me, startRound) {
    const round = draw.round_id;
    let { error } = await supabase.from('teams').delete().eq('round_id', round);
    if (error) throw error;
    for (const tm of draw.payload.teams) {
      const { data: row, error: e1 } = await supabase.from('teams').insert({ round_id: round, name: tm.name, handicap: tm.handicap }).select().single();
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('team_players').insert(tm.players.map((pid) => ({ team_id: row.id, player_id: pid })));
      if (e2) throw e2;
    }
    ({ error } = await supabase.from('draws').update({ status: 'locked' }).eq('id', draw.id));
    if (error) throw error;
    if (startRound) await supabase.from('rounds').update({ status: 'live' }).eq('id', round);
    const r = data.rounds.find((x) => x.id === round);
    const summary = draw.payload.teams.map((tm) => `${tm.name} (hcp ${tm.handicap}): ${tm.players.map((id) => playerName(data.playersById[id])).join(', ')}`).join(' · ');
    await supabase.from('posts').insert({ kind: 'user', player_id: me, round_id: round, trip_id: r?.trip_id || null, body: `🎲 The draw is in! ${summary}` });
    data.reload();
  },
  async cancel(draw) {
    await supabase.from('draws').update({ status: 'cancelled' }).eq('id', draw.id);
  },
  async reopen(draw) {
    const { teams, picks, spread, ...rest } = draw.payload; // eslint-disable-line no-unused-vars
    await supabase.from('draws').update({ status: 'lobby', payload: rest }).eq('id', draw.id);
  },
};

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    let raf;
    const tick = () => { setNow(Date.now()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return now;
}

/** Who's in the room right now (Supabase presence). */
function useWatchers(drawId, me, enabled) {
  const [ids, setIds] = useState([]);
  useEffect(() => {
    if (!enabled || !me) return undefined;
    const ch = supabase.channel(`draw-room-${drawId}`, { config: { presence: { key: me } } });
    ch.on('presence', { event: 'sync' }, () => setIds(Object.keys(ch.presenceState())));
    ch.subscribe((s) => { if (s === 'SUBSCRIBED') ch.track({ at: Date.now() }); });
    return () => { supabase.removeChannel(ch); };
  }, [drawId, me, enabled]);
  return ids;
}

const shell = { position: 'fixed', inset: 0, zIndex: 80, overflowY: 'auto', color: '#F4EFE3', background: 'radial-gradient(90% 55% at 50% 18%, rgba(217,165,33,.28) 0%, rgba(217,165,33,0) 60%), #0E1622' };
const sub = { fontSize: 14, color: '#AFC0D4' };

export default function DrawCeremony({ draw, onClose, actions = liveActions, demo = false }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const isAdmin = status.is_admin;
  const roundName = data.rounds.find((r) => r.id === draw.round_id)?.name || 'Ambrose';
  const fieldIds = draw.payload.field || draw.payload.teams?.flatMap((t) => t.players) || [];
  const watchers = useWatchers(draw.id, me, !demo && (draw.status === 'lobby' || draw.status === 'running'));
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };

  const header = (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: "'Pirata One', serif", fontSize: 46, color: '#EBD496', lineHeight: 1 }}>The Draw</div>
      <div style={sub}>{roundName} · {draw.payload.k} teams · {draw.payload.balance ? 'random, kept close' : 'truly random'}</div>
    </div>
  );

  // ---------- The draw room (before it starts) ----------
  if (draw.status === 'lobby') {
    const field = fieldIds.map((id) => ({ id, handicap: Number(data.playersById[id]?.handicap ?? 0) }));
    return (
      <div role="dialog" aria-modal="true" aria-label="The Draw room" style={shell}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: 'calc(18px + env(safe-area-inset-top, 0px)) 16px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {header}
          <div style={{ textAlign: 'center', fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700 }}>The draw room is open</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#AFC0D4', marginBottom: 8 }}>IN THE DRAW · {fieldIds.length}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
              {fieldIds.map((id) => {
                const p = data.playersById[id];
                const here = demo || watchers.includes(id);
                return (
                  <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: here ? 1 : 0.55 }}>
                    <div style={{ borderRadius: '50%', padding: 3, background: here ? '#7FD1AE' : 'transparent' }}><Avatar player={p} size={50} /></div>
                    <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'center' }}>{playerName(p)}</span>
                    <span style={{ fontSize: 11, color: '#AFC0D4' }}>off {Number(p?.handicap)}</span>
                  </div>
                );
              })}
            </div>
            {!demo && <div style={{ ...sub, marginTop: 10, textAlign: 'center' }}>Green ring = watching now ({watchers.length} in the room)</div>}
          </div>
          {isAdmin ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="btn gold" style={{ minHeight: 60, fontSize: 20 }} disabled={busy} onClick={() => run(() => actions.start(draw, field))}>🎲 Start the draw</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => run(() => actions.cancel(draw))}>Close the room</button>
            </div>
          ) : (
            <div style={{ textAlign: 'center', ...sub, fontSize: 16 }}>Waiting for the admin to start it… keep this screen open.</div>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>Watch later</button>
        </div>
      </div>
    );
  }

  return <Ceremony draw={draw} onClose={onClose} actions={actions} demo={demo} header={header} busy={busy} run={run} isAdmin={isAdmin} me={me} />;
}

function Ceremony({ draw, onClose, actions, demo, header, busy, run, isAdmin, me }) {
  const data = useData();
  const { teams, picks } = draw.payload;
  const interval = draw.payload.interval_ms || REVEAL_MS;
  const total = picks.length * interval;
  const [skipped, setSkipped] = useState(false);
  const [startRound, setStartRound] = useState(true);
  const start = new Date(draw.started_at).getTime();
  const runningClock = draw.status === 'running' && !skipped;
  const now = useNow(runningClock);
  const countdown = runningClock && now < start ? Math.ceil((start - now) / 1000) : 0;
  const elapsed = runningClock ? Math.max(0, now - start) : total + 1;
  const finished = elapsed >= total;
  const idx = Math.min(picks.length - 1, Math.floor(elapsed / interval));
  const within = elapsed - idx * interval;
  const spinning = !finished && within < SPIN_MS;
  const revealedCount = countdown ? 0 : finished ? picks.length : idx + (spinning ? 0 : 1);
  const lastBuzz = useRef(-1);
  const round = data.rounds.find((r) => r.id === draw.round_id);

  useEffect(() => {
    if (!countdown && !finished && !spinning && lastBuzz.current !== idx) {
      lastBuzz.current = idx;
      try { navigator.vibrate?.(60); } catch { /* ignore */ }
    }
  }, [idx, spinning, finished, countdown]);

  useEffect(() => {
    if (finished && draw.status === 'running' && isAdmin) actions.finish(draw);
  }, [finished, draw, isAdmin, actions]);

  const current = picks[idx];
  let face = current ? data.playersById[current.player_id] : null;
  if (spinning && current) {
    const left = picks.slice(idx).map((p) => p.player_id);
    const n = left.length;
    const t = within / SPIN_MS;
    const steps = 26;
    const step = Math.floor(steps * (1 - Math.pow(1 - t, 3)));
    const k = ((0 - (steps - step)) % n + n) % n;
    face = data.playersById[left[k]];
  }
  const teamOf = current ? teams[current.team] : null;
  const revealed = picks.slice(0, revealedCount);
  const teamRows = teams.map((tm, ti) => {
    const got = revealed.filter((p) => p.team === ti).map((p) => p.player_id);
    const hcpSoFar = got.length ? teamHandicap(got.map((id) => Number(data.playersById[id]?.handicap ?? 0))) : null;
    return { ...tm, got, hcpSoFar, colour: TEAM_COLOURS[ti % TEAM_COLOURS.length] };
  });

  return (
    <div role="dialog" aria-modal="true" aria-label="The Draw" style={shell}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 'calc(18px + env(safe-area-inset-top, 0px)) 16px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {header}

        {countdown ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 6 }} aria-live="assertive">
            <div style={{ ...sub, fontWeight: 700, letterSpacing: '.12em' }}>DRAW STARTS IN</div>
            <div key={countdown} style={{ fontFamily: "'Pirata One', serif", fontSize: 150, lineHeight: 1, color: '#EBD496' }}>{countdown}</div>
          </div>
        ) : !finished ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minHeight: 300, justifyContent: 'center' }} aria-live="polite">
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.12em', color: '#AFC0D4' }}>PICK {idx + 1} OF {picks.length}</div>
            <div style={{ borderRadius: '50%', padding: 6, background: spinning ? 'transparent' : TEAM_COLOURS[current.team % TEAM_COLOURS.length], transition: 'background .2s', transform: spinning ? 'scale(1)' : 'scale(1.08)' }}>
              <Avatar player={face} size={150} />
            </div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 700, opacity: spinning ? 0.55 : 1, filter: spinning ? 'blur(1px)' : 'none' }}>{face ? playerName(face) : '…'}</div>
            {spinning ? <div style={sub}>Drawing…</div> : current && (
              <>
                <div style={{ ...sub, fontSize: 15 }}>Off {Number(face?.handicap)}</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 700, color: TEAM_COLOURS[current.team % TEAM_COLOURS.length] }}>→ {teamOf?.name}</div>
              </>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700 }}>
            {draw.status === 'locked' ? 'Teams locked in. Good luck.' : 'The teams are set.'}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(teams.length, 2)}, minmax(0, 1fr))`, gap: 10 }}>
          {teamRows.map((tm) => (
            <div key={tm.name} style={{ border: `2px solid ${tm.colour}`, borderRadius: 14, padding: 10, background: 'rgba(255,255,255,.04)' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 700, color: tm.colour }}>{tm.name}</div>
              <div style={{ fontSize: 13, color: '#AFC0D4', marginBottom: 6 }}>
                {finished ? <>Team handicap <strong style={{ color: '#F4EFE3', fontSize: 16 }}>{tm.handicap}</strong></> : tm.hcpSoFar != null ? `Handicap so far ${tm.hcpSoFar}` : 'Waiting…'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tm.players.map((pid, i) => {
                  const shown = tm.got.includes(pid);
                  const p = data.playersById[pid];
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, opacity: shown ? 1 : 0.35 }}>
                      {shown ? <Avatar player={p} size={28} /> : <span style={{ width: 28, height: 28, borderRadius: '50%', border: '2px dashed #5C6B7E', display: 'inline-block' }} />}
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{shown ? playerName(p) : '?'}</span>
                      {shown && finished && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#AFC0D4' }}>{Number(p?.handicap)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {finished && <p style={{ fontSize: 12.5, color: '#AFC0D4', lineHeight: 1.45, margin: 0 }}>Team handicap = combined handicaps ÷ (2 × team size): 4-player ÷ 8, 3-player ÷ 6.{draw.payload.balance ? ' "Keep it close" only used random line-ups where the team handicaps were within a shot of each other.' : ''}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isAdmin && !finished && !countdown && <button type="button" className="btn ghost" onClick={() => setSkipped(true)}>Skip to the result (just my screen)</button>}
          {isAdmin && finished && draw.status !== 'locked' && (
            <>
              {round?.status === 'setup' && (
                <label className="row" style={{ justifyContent: 'center', gap: 8, fontWeight: 600 }}>
                  <input type="checkbox" checked={startRound} onChange={(e) => setStartRound(e.target.checked)} style={{ width: 20, height: 20 }} />
                  <span>…and start the round (scoring opens)</span>
                </label>
              )}
              <button type="button" className="btn gold" disabled={busy} onClick={() => run(async () => { await actions.lock(draw, data, me, startRound && round?.status === 'setup'); toast(startRound ? 'Teams locked — round is live' : 'Teams locked in'); })}>Lock in these teams</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => { if (window.confirm('Scrap these teams and go back to the draw room?')) run(() => actions.reopen(draw)); }}>Scrap it — back to the draw room</button>
            </>
          )}
          {!isAdmin && finished && draw.status !== 'locked' && <div style={{ textAlign: 'center', color: '#AFC0D4' }}>Waiting for the admin to lock it in…</div>}
          {(finished || !isAdmin) && <button type="button" className="btn ghost" onClick={onClose}>{finished ? 'Close' : 'Watch later'}</button>}
        </div>
      </div>
    </div>
  );
}
