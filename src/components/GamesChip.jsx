// Games and side bets (migration 055): the group's games, live, and the little link on the leaderboard. Kept apart
// from screens/Games.jsx so the leaderboard (loaded first) stays small.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useRealtime, useFeature } from '../lib/store.jsx';
import { GAME_INFO } from '../lib/games.js';

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
