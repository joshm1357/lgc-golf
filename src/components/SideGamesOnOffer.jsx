// "Side games on offer: $5 skins Sat (6 in) [I'm in]" — one line per open opt-in side game on a trip's rounds (098,
// ov29). Self-contained so the run-up (components/RunUp.jsx, another builder's) only needs a one-line mount.
// Nothing shows when the trip has no open opt-in game, the games feature is off, or the database is older than 098.
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useData, useFeature, useSession } from '../lib/store.jsx';
import { isOptIn, optInIds, optInState, offerLine } from '../lib/games.js';
import { useRoundGames, useGamePlayers, useTeeTimes, useOptIn } from './GamesChip.jsx';

function OfferRow({ game, round, optIns, reload }) {
  const { status } = useSession();
  const [busy, toggle] = useOptIn(game, reload);
  const ids = [...(optInIds(game, optIns) || [])];
  const me = status.player_id;
  const imIn = !!me && ids.includes(me);
  const canTap = !!me && status.role !== 'guest' && !status.viewing;
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }} data-testid="side-game-offer">
      <Link to={`/games?r=${round.id}`} className="grow small" style={{ color: 'inherit' }}>{offerLine(game, round, ids.length)}</Link>
      {canTap && (
        <button type="button" className={`btn sm ${imIn ? 'ghost' : 'gold'}`} disabled={busy} aria-pressed={imIn} onClick={() => toggle(!imIn)}>
          {imIn ? 'I’m out' : 'I’m in'}
        </button>
      )}
    </div>
  );
}

export default function SideGamesOnOffer({ tripId }) {
  const on = useFeature('games');
  const data = useData();
  const rounds = useMemo(() => (tripId ? (data.rounds || []).filter((r) => r.trip_id === tripId) : []), [data.rounds, tripId]);
  const [games, reloadGames] = useRoundGames();
  const [optIns, reload] = useGamePlayers();
  const tees = useTeeTimes(rounds.map((r) => r.id));
  if (!on || !rounds.length) return null;
  const byId = Object.fromEntries(rounds.map((r) => [r.id, r]));
  const open = games.filter((g) => isOptIn(g) && byId[g.round_id] && optInState(byId[g.round_id], tees).open)
    .sort((a, b) => String(byId[a.round_id].play_date || '').localeCompare(String(byId[b.round_id].play_date || '')));
  if (!open.length) return null;
  const again = async () => { await reload(); await reloadGames(); };
  return (
    <div className="card pad stack" style={{ gap: 6 }} data-testid="side-games-on-offer">
      <strong>🎲 Side games on offer</strong>
      {open.map((g) => <OfferRow key={g.id} game={g} round={byId[g.round_id]} optIns={optIns} reload={again} />)}
    </div>
  );
}
