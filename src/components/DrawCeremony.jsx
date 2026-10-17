// The Draw ceremony — shown live on everyone's phone, all in step with the start time.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName } from '../lib/store.jsx';
import { REVEAL_MS, SPIN_MS, teamHandicap } from '../lib/draw.js';
import { Avatar, toast } from './ui.jsx';

const TEAM_COLOURS = ['#D9A521', '#5FB3E0', '#E0705F', '#7FD1AE', '#C79BE6', '#F2F4F6'];
const DISMISS_KEY = 'lgc-draw-dismissed';

/** Watches for a live draw and takes over the screen while it runs. */
export function DrawOverlay() {
  const [draw, setDraw] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data } = await supabase.from('draws').select('*').gte('started_at', since).neq('status', 'cancelled').order('started_at', { ascending: false }).limit(1);
    setDraw(data?.[0] || null);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['draws'], load);

  if (!draw || dismissed === draw.id + ':' + draw.status) return null;
  return (
    <DrawCeremony draw={draw} onClose={() => {
      const v = draw.id + ':' + draw.status;
      try { localStorage.setItem(DISMISS_KEY, v); } catch { /* ignore */ }
      setDismissed(v);
    }} />
  );
}

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

export default function DrawCeremony({ draw, onClose }) {
  const data = useData();
  const { status } = useSession();
  const { teams, picks } = draw.payload;
  const interval = draw.payload.interval_ms || REVEAL_MS;
  const total = picks.length * interval;
  const [skipped, setSkipped] = useState(false);
  const start = new Date(draw.started_at).getTime();
  const runningClock = draw.status === 'running' && !skipped;
  const now = useNow(runningClock);
  const elapsed = runningClock ? Math.max(0, now - start) : total + 1;
  const finished = elapsed >= total;
  const idx = Math.min(picks.length - 1, Math.floor(elapsed / interval));
  const within = elapsed - idx * interval;
  const spinning = !finished && within < SPIN_MS;
  const revealedCount = finished ? picks.length : idx + (spinning ? 0 : 1);
  const lastBuzz = useRef(-1);

  // Buzz the phone on each reveal.
  useEffect(() => {
    if (!finished && !spinning && lastBuzz.current !== idx) {
      lastBuzz.current = idx;
      try { navigator.vibrate?.(60); } catch { /* ignore */ }
    }
  }, [idx, spinning, finished]);

  // Admin: flip the draw to "done" once the clock runs out (so late openers jump to the result).
  useEffect(() => {
    if (finished && draw.status === 'running' && status.is_admin) {
      supabase.from('draws').update({ status: 'done' }).eq('id', draw.id).then(() => {});
    }
  }, [finished, draw.status, draw.id, status.is_admin]);

  // The face on the big spinner: cycles through who's left, slowing down, landing on the pick.
  const current = picks[idx];
  let face = current ? data.playersById[current.player_id] : null;
  if (spinning && current) {
    const left = picks.slice(idx).map((p) => p.player_id);
    const n = left.length;
    const t = within / SPIN_MS;
    const steps = 26;
    const step = Math.floor(steps * (1 - Math.pow(1 - t, 3)));
    const k = ((0 - (steps - step)) % n + n) % n; // lands on index 0 (the pick) at the end
    face = data.playersById[left[k]];
  }
  const teamOf = current ? teams[current.team] : null;

  const revealed = picks.slice(0, revealedCount);
  const teamRows = teams.map((tm, ti) => {
    const got = revealed.filter((p) => p.team === ti).map((p) => p.player_id);
    const hcpSoFar = got.length ? teamHandicap(got.map((id) => Number(data.playersById[id]?.handicap ?? 0))) : null;
    return { ...tm, got, hcpSoFar, colour: TEAM_COLOURS[ti % TEAM_COLOURS.length] };
  });

  async function lockIn() {
    try {
      const round = draw.round_id;
      let { error } = await supabase.from('teams').delete().eq('round_id', round);
      if (error) throw error;
      for (const tm of teams) {
        const { data: row, error: e1 } = await supabase.from('teams').insert({ round_id: round, name: tm.name, handicap: tm.handicap }).select().single();
        if (e1) throw e1;
        const { error: e2 } = await supabase.from('team_players').insert(tm.players.map((pid) => ({ team_id: row.id, player_id: pid })));
        if (e2) throw e2;
      }
      ({ error } = await supabase.from('draws').update({ status: 'locked' }).eq('id', draw.id));
      if (error) throw error;
      const r = data.rounds.find((x) => x.id === round);
      const summary = teams.map((tm) => `${tm.name} (${tm.handicap}): ${tm.players.map((id) => playerName(data.playersById[id])).join(', ')}`).join(' · ');
      await supabase.from('posts').insert({ kind: 'user', player_id: status.player_id, round_id: round, trip_id: r?.trip_id || null, body: `🎲 The draw is in! ${summary}` });
      data.reload();
      toast('Teams locked in');
    } catch (e) {
      toast(friendlyError(e));
    }
  }

  async function cancel() {
    if (!window.confirm('Scrap this draw?')) return;
    await supabase.from('draws').update({ status: 'cancelled' }).eq('id', draw.id);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="The Draw" style={{ position: 'fixed', inset: 0, zIndex: 80, overflowY: 'auto', color: '#F4EFE3', background: 'radial-gradient(90% 55% at 50% 18%, rgba(217,165,33,.28) 0%, rgba(217,165,33,0) 60%), #0E1622' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 'calc(18px + env(safe-area-inset-top, 0px)) 16px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: "'Pirata One', serif", fontSize: 46, color: '#EBD496', lineHeight: 1 }}>The Draw</div>
          <div style={{ fontSize: 14, color: '#AFC0D4' }}>{data.rounds.find((r) => r.id === draw.round_id)?.name} · {draw.payload.balance ? 'random, evened out' : 'fully random'}</div>
        </div>

        {!finished ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minHeight: 300, justifyContent: 'center' }} aria-live="polite">
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.12em', color: '#AFC0D4' }}>PICK {idx + 1} OF {picks.length}</div>
            <div style={{ borderRadius: '50%', padding: 6, background: spinning ? 'transparent' : teamOf?.name ? TEAM_COLOURS[current.team % TEAM_COLOURS.length] : 'transparent', transition: 'background .2s', transform: spinning ? 'scale(1)' : 'scale(1.08)' }}>
              <Avatar player={face} size={150} />
            </div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 700, opacity: spinning ? 0.55 : 1, filter: spinning ? 'blur(1px)' : 'none' }}>{face ? playerName(face) : '…'}</div>
            {!spinning && current && (
              <>
                <div style={{ fontSize: 15, color: '#AFC0D4' }}>Off {Number(face?.handicap)}</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 700, color: TEAM_COLOURS[current.team % TEAM_COLOURS.length] }}>→ {teamOf?.name}</div>
              </>
            )}
            {spinning && <div style={{ fontSize: 15, color: '#AFC0D4' }}>Drawing…</div>}
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
              <div style={{ fontSize: 12, color: '#AFC0D4', marginBottom: 6 }}>
                {finished ? `Team handicap ${tm.handicap}` : tm.hcpSoFar != null ? `Handicap so far ${tm.hcpSoFar}` : 'Waiting…'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tm.players.map((pid, i) => {
                  const shown = tm.got.includes(pid);
                  const p = data.playersById[pid];
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, opacity: shown ? 1 : 0.35 }}>
                      {shown ? <Avatar player={p} size={28} /> : <span style={{ width: 28, height: 28, borderRadius: '50%', border: '2px dashed #5C6B7E', display: 'inline-block' }} />}
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{shown ? playerName(p) : '?'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {finished && <p style={{ fontSize: 12.5, color: '#AFC0D4', lineHeight: 1.45, margin: 0 }}>Team handicap = combined handicaps ÷ (2 × team size): 4-player ÷ 8, 3-player ÷ 6.{draw.payload.balance ? ' "Even it out" only kept random line-ups where the team handicaps were within a shot of each other.' : ''}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {status.is_admin && !finished && <button type="button" className="btn ghost" onClick={() => setSkipped(true)}>Skip to the result (just my screen)</button>}
          {status.is_admin && finished && draw.status !== 'locked' && (
            <>
              <button type="button" className="btn gold" onClick={lockIn}>Lock in these teams</button>
              <button type="button" className="btn ghost" onClick={cancel}>Scrap it (then redraw from Admin)</button>
            </>
          )}
          {!status.is_admin && finished && draw.status !== 'locked' && <div style={{ textAlign: 'center', color: '#AFC0D4' }}>Waiting for the admin to lock it in…</div>}
          {(finished || !status.is_admin) && <button type="button" className="btn ghost" onClick={onClose}>{finished ? 'Close' : 'Watch later'}</button>}
        </div>
      </div>
    </div>
  );
}
