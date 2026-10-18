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
import { REVEAL_MS, SPIN_MS, makeDraw, makeGroupDraw } from '../lib/draw.js';
import { notify } from '../lib/push.js';
import { Avatar, toast } from './ui.jsx';

export const TEAM_COLOURS = ['#D9A521', '#5FB3E0', '#E0705F', '#7FD1AE', '#C79BE6', '#F2F4F6'];
const COUNTDOWN_MS = 5000;

/** The live ceremony, writing to the database so every phone follows along (opened by DrawOverlay). */
export function LiveDrawCeremony({ draw, onClose }) {
  return <DrawCeremony draw={draw} actions={liveActions} onClose={onClose} />;
}

/** Real actions: write to the database so every phone follows along. */
const liveActions = {
  async start(draw, field) {
    const d = draw.payload.mode === 'groups'
      ? makeGroupDraw(field.map((f) => f.id), draw.payload.groups)
      : makeDraw(field, draw.payload.k, { balance: draw.payload.balance });
    const { error } = await supabase.from('draws').update({
      status: 'running',
      payload: { ...draw.payload, ...d, step: 0 },
      started_at: new Date(Date.now() + COUNTDOWN_MS).toISOString(),
    }).eq('id', draw.id);
    if (error) throw error;
  },
  // Click-through mode: admin reveals the next name on every phone.
  async next(draw) {
    const step = Math.min(draw.payload.picks.length, (draw.payload.step || 0) + 1);
    const { error } = await supabase.from('draws').update({ payload: { ...draw.payload, step } }).eq('id', draw.id);
    if (error) throw error;
  },
  async finish(draw) {
    await supabase.from('draws').update({ status: 'done' }).eq('id', draw.id).eq('status', 'running');
  },
  async lock(draw, data, me, startRound) {
    if (draw.payload.mode === 'groups') return lockGroups(draw, data, me);
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
    const { teams, picks, spread, step, ...rest } = draw.payload; // eslint-disable-line no-unused-vars
    await supabase.from('draws').update({ status: 'lobby', payload: rest }).eq('id', draw.id);
  },
};

/** Rooms/cars draw: write who's in each room or car to the plan. */
async function lockGroups(draw, data, me) {
  const { teams, groups, keep, kind, title } = draw.payload;
  // Redraw everyone: clear all the rooms/cars first. Keep mode: just make sure nobody drawn is also somewhere else.
  const drawn = teams.flatMap((tm) => tm.players);
  const { data: all } = await supabase.from('plan_groups').select('id').eq('plan_id', draw.plan_id).eq('kind', kind);
  const allIds = (all || []).map((g) => g.id);
  let q = supabase.from('plan_group_members').delete().in('group_id', allIds.length ? allIds : groups.map((g) => g.id));
  if (keep) q = q.in('player_id', drawn.length ? drawn : ['00000000-0000-0000-0000-000000000000']);
  const { error: e0 } = await q;
  if (e0) throw e0;
  const rows = teams.flatMap((tm) => tm.players.map((pid) => ({ group_id: tm.group_id, player_id: pid })));
  if (rows.length) {
    const { error } = await supabase.from('plan_group_members').insert(rows);
    if (error) throw error;
  }
  const { error } = await supabase.from('draws').update({ status: 'locked' }).eq('id', draw.id);
  if (error) throw error;
  const summary = teams.filter((tm) => tm.players.length).map((tm) => `${tm.name}: ${tm.players.map((id) => playerName(data.playersById[id])).join(', ')}`).join(' · ');
  await supabase.from('posts').insert({ kind: 'user', player_id: me, link: `/plan/${draw.plan_id}?tab=groups`, body: `${kind === 'car' ? '🚗' : '🛏️'} ${title} are drawn! ${summary}` });
  await notify('groups_set', { plan_id: draw.plan_id, kind });
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
  const groupsMode = draw.payload.mode === 'groups';
  const roundName = groupsMode ? draw.payload.title : data.rounds.find((r) => r.id === draw.round_id)?.name || 'Ambrose';
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
      <div style={sub}>{roundName} · {groupsMode ? `${draw.payload.groups.length} ${draw.payload.kind === 'car' ? 'cars' : 'rooms'}` : `${draw.payload.k} teams · ${draw.payload.balance ? 'random, kept close' : 'truly random'}`} · {draw.payload.pace === 'click' ? 'admin clicks through' : 'timed'}</div>
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
                    {!groupsMode && <span style={{ fontSize: 11, color: '#AFC0D4' }}>off {Number(p?.handicap)}</span>}
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

  return <Ceremony draw={draw} onClose={onClose} actions={actions} demo={demo} header={header} busy={busy} run={run} isAdmin={isAdmin} me={me} groupsMode={groupsMode} />;
}

function Ceremony({ draw, onClose, actions, header, busy, run, isAdmin, me, groupsMode }) {
  const things = draw.payload.kind === 'car' ? 'cars' : 'rooms';
  const data = useData();
  const { teams, picks } = draw.payload;
  const clickMode = draw.payload.pace === 'click';
  const interval = draw.payload.interval_ms || REVEAL_MS;
  const [skipped, setSkipped] = useState(false);
  const [startRound, setStartRound] = useState(true);
  const start = new Date(draw.started_at).getTime();
  const live = draw.status === 'running' && !skipped;
  const now = useNow(live);
  const round = data.rounds.find((r) => r.id === draw.round_id);

  // Click mode: each phone starts the drum the moment it hears about a new step.
  const step = draw.payload.step || 0;
  const [seen, setSeen] = useState(() => ({ step, at: 0 })); // at 0 = already shown when we opened
  useEffect(() => {
    if (step !== seen.step) setSeen({ step, at: Date.now() });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const countdown = live && now < start ? Math.ceil((start - now) / 1000) : 0;
  let triggered;
  let within;
  if (!live) {
    triggered = picks.length;
    within = Infinity;
  } else if (clickMode) {
    triggered = countdown ? 0 : step;
    within = seen.at ? now - seen.at : Infinity;
  } else {
    triggered = countdown ? 0 : Math.min(picks.length, Math.floor((now - start) / interval) + 1);
    within = now - (start + (triggered - 1) * interval);
  }
  const cur = triggered - 1;
  const spinning = triggered > 0 && within < SPIN_MS && !countdown;
  const revealedCount = Math.max(0, triggered - (spinning ? 1 : 0));
  const finished = !live || (revealedCount === picks.length && !spinning);
  const lastBuzz = useRef(-1);

  useEffect(() => {
    if (live && revealedCount > 0 && lastBuzz.current !== revealedCount) {
      lastBuzz.current = revealedCount;
      try { navigator.vibrate?.(80); } catch { /* ignore */ }
    }
  }, [revealedCount, live]);

  useEffect(() => {
    if (finished && draw.status === 'running' && isAdmin) actions.finish(draw);
  }, [finished, draw, isAdmin, actions]);

  const current = cur >= 0 ? picks[cur] : null;
  const upNext = picks[triggered] || null;
  const focusTeam = current ? teams[current.team] : upNext ? teams[upNext.team] : null;
  const focusTeamIdx = current ? current.team : upNext ? upNext.team : 0;
  let face = current ? data.playersById[current.player_id] : null;
  if (spinning && current) {
    // The drum: roll through everyone not yet drawn, slowing down, landing on the pick.
    const left = picks.slice(cur).map((p) => p.player_id);
    const n = left.length;
    const t = Math.min(1, within / SPIN_MS);
    const steps = 22;
    const stp = Math.floor(steps * (1 - Math.pow(1 - t, 3)));
    face = data.playersById[left[((0 - (steps - stp)) % n + n) % n]];
  }
  const revealed = picks.slice(0, revealedCount);
  const teamRows = teams.map((tm, ti) => {
    const got = revealed.filter((p) => p.team === ti).map((p) => p.player_id);
    // Builds up to the final team handicap: drawn players' handicaps ÷ (2 × full team size).
    const sum = got.reduce((a, id) => a + Number(data.playersById[id]?.handicap ?? 0), 0);
    const hcpSoFar = got.length ? Math.round((sum / (2 * tm.players.length)) * 10) / 10 : null;
    return { ...tm, got, hcpSoFar, colour: TEAM_COLOURS[ti % TEAM_COLOURS.length], drawing: !finished && ti === focusTeamIdx };
  });
  const colour = TEAM_COLOURS[focusTeamIdx % TEAM_COLOURS.length];
  const waitingForClick = live && clickMode && !countdown && !spinning && triggered < picks.length;
  const nextIsNewTeam = upNext && (!current || upNext.team !== current.team);

  return (
    <div role="dialog" aria-modal="true" aria-label="The Draw" style={shell}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 'calc(18px + env(safe-area-inset-top, 0px)) 16px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {header}

        {countdown ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 6 }} aria-live="assertive">
            <div style={{ ...sub, fontWeight: 700, letterSpacing: '.12em' }}>THE DRAW STARTS IN</div>
            <div key={countdown} style={{ fontFamily: "'Pirata One', serif", fontSize: 150, lineHeight: 1, color: '#EBD496' }}>{countdown}</div>
            {upNext && <div style={{ ...sub, fontSize: 16 }}>First up: <strong style={{ color: TEAM_COLOURS[upNext.team % TEAM_COLOURS.length] }}>{teams[upNext.team].name}</strong></div>}
          </div>
        ) : !finished ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minHeight: 320, justifyContent: 'center' }} aria-live="polite">
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.12em', color: '#AFC0D4' }}>
              {waitingForClick && nextIsNewTeam ? 'NEXT UP' : 'NOW DRAWING'}
            </div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 700, color: colour, lineHeight: 1 }}>{(waitingForClick ? teams[upNext.team] : focusTeam)?.name}</div>
            <div style={{ position: 'relative', marginTop: 8 }}>
              {/* the lotto ball */}
              <div style={{ width: 176, height: 176, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 35% 30%, #FFFFFF 0%, #E9EDF2 45%, #B9C2CC 100%)', boxShadow: spinning ? `0 0 0 6px rgba(255,255,255,.08), 0 0 40px rgba(235,212,150,.35)` : `0 0 0 6px ${colour}, 0 0 48px ${colour}`, transform: spinning ? `rotate(${(within / 6) % 360}deg)` : 'scale(1.04)', transition: spinning ? 'none' : 'transform .25s, box-shadow .25s' }}>
                {waitingForClick && !current ? (
                  <span style={{ fontFamily: "'Pirata One', serif", fontSize: 64, color: '#1C2B3F' }}>?</span>
                ) : (
                  <div style={{ transform: spinning ? `rotate(${-(within / 6) % 360}deg)` : 'none' }}><Avatar player={face} size={140} /></div>
                )}
              </div>
            </div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 36, fontWeight: 700, minHeight: 44, opacity: spinning ? 0.5 : 1, filter: spinning ? 'blur(1.5px)' : 'none' }}>
              {waitingForClick && !current ? '' : face ? playerName(face) : ''}
            </div>
            {!spinning && current && <div style={{ ...sub, fontSize: 15 }}>{groupsMode ? '' : `Off ${Number(data.playersById[current.player_id]?.handicap)} · `}{teams[current.team].name}</div>}
            {spinning && <div style={sub}>Drawing…</div>}
            <div style={{ ...sub, fontSize: 12 }}>Name {Math.max(1, triggered)} of {picks.length}</div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700 }}>
            {groupsMode ? (draw.status === 'locked' ? `The ${things} are locked in.` : `The ${things} are drawn.`) : draw.status === 'locked' ? 'Teams locked in. Good luck.' : 'The teams are set.'}
          </div>
        )}

        {live && clickMode && isAdmin && !countdown && triggered < picks.length && (
          <button type="button" className="btn gold" style={{ minHeight: 60, fontSize: 20 }} disabled={busy || spinning} onClick={() => run(() => actions.next(draw))}>
            {triggered === 0 ? '🎱 Draw the first name' : nextIsNewTeam ? `🎱 Start ${teams[upNext.team].name}` : '🎱 Draw the next name'}
          </button>
        )}
        {live && clickMode && !isAdmin && waitingForClick && <div style={{ textAlign: 'center', ...sub }}>Waiting for the admin to draw the next name…</div>}

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(teams.length, 2)}, minmax(0, 1fr))`, gap: 10 }}>
          {teamRows.map((tm) => (
            <div key={tm.name} style={{ border: `2px solid ${tm.colour}`, borderRadius: 14, padding: 10, background: tm.drawing ? 'rgba(255,255,255,.09)' : 'rgba(255,255,255,.03)', boxShadow: tm.drawing ? `0 0 18px ${tm.colour}55` : 'none' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 700, color: tm.colour }}>{tm.name}</div>
              <div style={{ fontSize: 13, color: '#AFC0D4', marginBottom: 6 }}>
                {groupsMode ? `${tm.got.length} of ${tm.players.length} drawn` : finished ? <>Team handicap <strong style={{ color: '#F4EFE3', fontSize: 16 }}>{tm.handicap}</strong></> : tm.hcpSoFar != null ? `Team handicap so far ${tm.hcpSoFar}` : 'Waiting…'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tm.players.map((pid, i) => {
                  const shown = tm.got.includes(pid);
                  const p = data.playersById[pid];
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, opacity: shown ? 1 : 0.35 }}>
                      {shown ? <Avatar player={p} size={28} /> : <span style={{ width: 28, height: 28, borderRadius: '50%', border: '2px dashed #5C6B7E', display: 'inline-block' }} />}
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{shown ? playerName(p) : '?'}</span>
                      {shown && !groupsMode && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#AFC0D4' }}>{Number(p?.handicap)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {finished && !groupsMode && <p style={{ fontSize: 12.5, color: '#AFC0D4', lineHeight: 1.45, margin: 0 }}>Team handicap = combined handicaps ÷ (2 × team size): 4-player ÷ 8, 3-player ÷ 6.{draw.payload.balance ? ' "Keep it close" only used random line-ups where the team handicaps were within a shot of each other.' : ''}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isAdmin && !finished && !countdown && !clickMode && <button type="button" className="btn ghost" onClick={() => setSkipped(true)}>Skip to the result (just my screen)</button>}
          {isAdmin && finished && draw.status !== 'locked' && (
            <>
              {round?.status === 'setup' && (
                <label className="row" style={{ justifyContent: 'center', gap: 8, fontWeight: 600 }}>
                  <input type="checkbox" checked={startRound} onChange={(e) => setStartRound(e.target.checked)} style={{ width: 20, height: 20 }} />
                  <span>…and start the round (scoring opens)</span>
                </label>
              )}
              <button type="button" className="btn gold" disabled={busy} onClick={() => run(async () => { await actions.lock(draw, data, me, startRound && round?.status === 'setup'); toast(groupsMode ? `The ${things} are locked in` : startRound && round?.status === 'setup' ? 'Teams locked — round is live' : 'Teams locked in'); })}>{groupsMode ? `Lock in these ${things}` : 'Lock in these teams'}</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => { if (window.confirm(`Scrap these ${groupsMode ? things : 'teams'} and go back to the draw room?`)) run(() => actions.reopen(draw)); }}>Scrap it — back to the draw room</button>
            </>
          )}
          {!isAdmin && finished && draw.status !== 'locked' && <div style={{ textAlign: 'center', color: '#AFC0D4' }}>Waiting for the admin to lock it in…</div>}
          {(finished || !isAdmin) && <button type="button" className="btn ghost" onClick={onClose}>{finished ? 'Close' : 'Watch later'}</button>}
        </div>
      </div>
    </div>
  );
}
