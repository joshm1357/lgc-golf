// Games and side bets (migration 055): the group's games, live, and the little link on the leaderboard. Kept apart
// from screens/Games.jsx so the leaderboard (loaded first) stays small.
// 098 (ov29, 23 Oct): who's in each game — the opt-in list (round_game_players), "I'm in" / "I'm out" while it's open,
// the organiser adding or taking someone out, the proposer taking their game down — and the small pieces other
// screens mount: SideGamesToday (the day screen), SideGameAsk (In / Out under the Feed post).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useRealtime, useFeature, useData, useSession, playerName } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { GAME_INFO, WHO_IN, isOptIn, optInIds, optInState, gameLabel, AMBROSE_OPT_IN_NOTE } from '../lib/games.js';

/** The group's games (all rounds), live. Retired ones are left out. */
export function useRoundGames() {
  const on = useFeature('games');
  const [games, setGames] = useState([]);
  const load = useCallback(async () => {
    if (!on) { setGames([]); return; }
    const { data, error } = await supabase.from('round_games').select('*').order('created_at');
    if (!error) setGames((data || []).filter((g) => !g.retired));
  }, [on]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['round_games'], load);
  return [games, load];
}

/** Who's in the group's opt-in games (round_game_players), live. An older database (before 098) has none. */
export function useGamePlayers() {
  const on = useFeature('games');
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    if (!on) { setRows([]); return; }
    const { data, error } = await supabase.from('round_game_players').select('game_id,player_id,added_by,created_at').order('created_at');
    if (!error) setRows(data || []);
  }, [on]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['round_game_players'], load);
  return [rows, load];
}

/** Tee times of some rounds (for when opt-ins close), live. */
export function useTeeTimes(roundIds = []) {
  const [rows, setRows] = useState([]);
  const key = [...roundIds].sort().join(',');
  const load = useCallback(async () => {
    if (!key) { setRows([]); return; }
    const { data, error } = await supabase.from('tee_groups').select('round_id,tee_time').in('round_id', key.split(','));
    if (!error) setRows(data || []);
  }, [key]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['tee_groups'], load);
  return rows;
}

/** The little link on the leaderboard (only when the round has games). */
export function GamesChip({ round }) {
  const on = useFeature('games');
  const [games] = useRoundGames();
  if (!on || !round) return null;
  const mine = games.filter((g) => g.round_id === round.id);
  if (!mine.length) return null;
  return (
    <div className="section">
      <Link to={`/games?r=${round.id}`} className="card pad row" style={{ gap: 10, textDecoration: 'none', color: 'inherit' }}>
        <span style={{ fontSize: 22 }} aria-hidden="true">🎲</span>
        <span className="grow small" style={{ lineHeight: 1.4 }}>
          <strong>Games today:</strong> {[...new Set(mine.map((g) => GAME_INFO[g.kind]?.name))].join(' · ')}
        </span>
        <span className="btn sm ghost">Who’s up</span>
      </Link>
    </div>
  );
}

/** "I'm in" / "I'm out" for me on an opt-in game. Returns [busy, toggle(on)]. */
export function useOptIn(game, reload) {
  const { status } = useSession();
  const [busy, run] = useRun();
  const me = status.player_id;
  const toggle = (on, who = me) => run(async () => {
    if (on) await must(supabase.from('round_game_players').insert({ game_id: game.id, player_id: who }));
    else await must(supabase.from('round_game_players').delete().eq('game_id', game.id).eq('player_id', who));
    await reload?.();
  }, on ? (who === me ? 'You’re in' : 'Added') : (who === me ? 'You’re out' : 'Taken out'));
  return [busy, toggle];
}

/**
 * Who's in a game, for the Games screen, the day screen and the Feed. Everyone-in games just say so.
 * Opt-in: the names, "I'm in" / "I'm out" while it's open, when it closes, the organiser's add / take out (works after
 * it closes too — for the bloke without his phone), and "Take it down" for the proposer or an organiser while open.
 */
export function WhosIn({ game, round, optIns = [], teeGroups = [], reload, compact = false }) {
  const data = useData();
  const { status } = useSession();
  const [busy, toggle] = useOptIn(game, reload);
  const [busy2, run] = useRun();
  const [adding, setAdding] = useState('');
  if (!isOptIn(game)) {
    return compact ? null : <div className="small muted" data-testid="whos-in">Who’s in: {WHO_IN.everyone.label.toLowerCase()}.</div>;
  }
  const me = status.player_id;
  const guest = status.role === 'guest' || !!status.viewing;
  const organiser = !!status.is_admin && !status.viewing;
  const ids = [...(optInIds(game, optIns) || [])];
  const names = ids.map((id) => ({ id, name: playerName(data.playersById?.[id]) })).sort((a, b) => a.name.localeCompare(b.name));
  const imIn = !!me && ids.includes(me);
  const st = optInState(round, teeGroups);
  const canTakeDown = st.open && !guest && (organiser || (me && game.created_by === me));
  const others = Object.values(data.playersById || {}).filter((p) => !ids.includes(p.id) && p.approved !== false)
    .sort((a, b) => playerName(a).localeCompare(playerName(b)));
  const takeDown = () => window.confirm('Take this side game down? It comes off the round and everyone who’s in is out.') && run(async () => {
    await must(supabase.from('round_games').update({ retired: true }).eq('id', game.id));
    await reload?.();
  }, 'Side game taken down');
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="whos-in">
      <div className="small">
        <strong>Who’s in ({ids.length}):</strong>{' '}
        {names.length ? names.map((n, i) => (
          <span key={n.id} data-testid="whos-in-name">
            {i ? ', ' : ''}{n.name}
            {organiser && <button type="button" aria-label={`Take ${n.name} out`} disabled={busy} onClick={() => toggle(false, n.id)}
              style={{ background: 'none', border: 0, padding: '0 6px', minHeight: 0, color: 'var(--muted)', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>×</button>}
          </span>
        )) : <span className="muted">nobody yet</span>}
      </div>
      {round?.format === 'ambrose' && !compact && <div className="small muted">{AMBROSE_OPT_IN_NOTE}</div>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {st.open && me && !guest && (
          <button type="button" className={`btn sm ${imIn ? 'ghost' : 'gold'}`} disabled={busy} data-testid="opt-toggle" aria-pressed={imIn}
            onClick={() => toggle(!imIn)}>{imIn ? 'I’m out' : 'I’m in'}</button>
        )}
        <span className="small muted" data-testid="opt-closes">{st.words}</span>
      </div>
      {organiser && others.length > 0 && !compact && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="input" style={{ maxWidth: 200, minHeight: 40 }} value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add someone to this game">
            <option value="">Add someone…</option>
            {others.map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
          </select>
          <button type="button" className="btn ghost sm" disabled={!adding || busy} onClick={() => { toggle(true, adding); setAdding(''); }}>Add</button>
        </div>
      )}
      {canTakeDown && !compact && <button type="button" className="btn ghost sm" disabled={busy2} onClick={takeDown} data-testid="take-down" style={{ alignSelf: 'flex-start' }}>Take it down</button>}
    </div>
  );
}

/** The day screen: this round's side games, with who's in and the toggle. Nothing when the round has none. */
export function SideGamesToday({ round }) {
  const on = useFeature('games');
  const [games, reloadGames] = useRoundGames();
  const [optIns, reload] = useGamePlayers();
  const tees = useTeeTimes(round ? [round.id] : []);
  const mine = useMemo(() => (round ? games.filter((g) => g.round_id === round.id) : []), [games, round]);
  if (!on || !round || !mine.length) return null;
  const again = async () => { await reload(); await reloadGames(); };
  return (
    <div className="card pad stack" style={{ gap: 10 }} data-testid="side-games-today">
      <div className="row between" style={{ gap: 8 }}>
        <strong>🎲 Side games</strong>
        <Link to={`/games?r=${round.id}`} className="btn ghost sm">Games →</Link>
      </div>
      {mine.map((g) => (
        <div key={g.id} className="stack" style={{ gap: 4, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
          <span style={{ fontWeight: 700 }}>{GAME_INFO[g.kind]?.emoji} {gameLabel(g)}</span>
          <WhosIn game={g} round={round} optIns={optIns} teeGroups={tees} reload={again} compact />
        </div>
      ))}
    </div>
  );
}

/** "/games?r=<round>&g=<game>" → the game id (the link on a proposed side game's Feed post), else null. */
export function sideGameFromLink(link) {
  const m = /^\/games\?r=[0-9a-f-]{36}&g=([0-9a-f-]{36})$/i.exec(String(link || ''));
  return m ? m[1] : null;
}

/** In / Out under a proposed side game's Feed post. Nothing once it's gone. */
export function SideGameAsk({ gameId }) {
  const on = useFeature('games');
  const data = useData();
  const [games, reloadGames] = useRoundGames();
  const [optIns, reload] = useGamePlayers();
  const game = games.find((g) => g.id === gameId);
  const round = game ? data.rounds?.find((r) => r.id === game.round_id) : null;
  const tees = useTeeTimes(round ? [round.id] : []);
  if (!on || !game || !round) return null;
  return (
    <div style={{ padding: '0 14px 10px' }} data-testid="side-game-ask">
      <WhosIn game={game} round={round} optIns={optIns} teeGroups={tees} reload={async () => { await reload(); await reloadGames(); }} compact />
    </div>
  );
}
