// Comps (migration 067): the group's comps, live, and the little chips on the leaderboard ("Today counts for: BD
// Trophy · 6th Ryder Cup"). Kept apart from screens/CompsBoard.jsx so the leaderboard (loaded first) stays small.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useScores, cacheGet, cacheSet } from '../lib/store.jsx';
import { useRoundGames } from './GamesChip.jsx';
import { currentGroup } from '../lib/group.js';
import { tripComps, roundComps, COMP_TYPE } from '../lib/comps.js';

/** The group's comps (every trip, retired ones too — the screens filter), live. An older database has none. */
export function useComps() {
  const key = `comps-${currentGroup() || 'none'}`;
  const [comps, setComps] = useState(() => cacheGet(key) || []);
  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('comps').select('*').order('sort').order('created_at');
      if (error) return;
      setComps(data || []);
      cacheSet(key, data || []);
    } catch { /* no signal: keep the last copy */ }
  }, [key]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['comps'], load);
  return [comps, load];
}

/** The trip's comps (with a stand-in for any trophy that has no comp yet). */
export function useTripComps(tripId) {
  const data = useData();
  const [comps, reload] = useComps();
  return [tripComps({ comps, trophies: data?.trophies || [], tripId }), reload, comps];
}

/** Leaderboard: the comps this round counts towards, each a chip to its standings. */
export function CompChips({ round }) {
  const data = useData();
  const [list] = useTripComps(round?.trip_id);
  const mine = round ? roundComps(round, list, data.rounds) : [];
  if (!mine.length) return null;
  return (
    <div className="chips" role="group" aria-label="This round counts for" style={{ alignItems: 'center' }}>
      <span className="small muted" style={{ flex: 'none', fontWeight: 700 }}>Counts for</span>
      {mine.map((c) => (
        <Link key={c.id} to={`/comps-board?c=${encodeURIComponent(c.id)}`} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'inherit' }}>
          <span aria-hidden="true">{c.trophy_id ? '🏆' : COMP_TYPE[c.kind]?.emoji}</span>{c.name}
        </Link>
      ))}
    </div>
  );
}

/**
 * Everything compStandings / compNeeds need for a trip. scores: false skips the scores (the to-do list doesn't need
 * them); entries: false skips side comp entries. scoresIdx: use scores already loaded by the screen.
 */
export function useCompData(tripId, { scores = true, entries = true, scoresIdx = null } = {}) {
  const data = useData();
  const ids = useMemo(() => (data.rounds || []).filter((r) => r.trip_id === tripId).map((r) => r.id), [data.rounds, tripId]);
  const sc = useScores(scores && !scoresIdx ? ids : []);
  const [games] = useRoundGames();
  const [extra, setExtra] = useState({ sideEntries: [], ownDefs: [], ownEntries: [], cupSides: [], cupMatches: [] });
  const idKey = ids.join(',');
  const load = useCallback(async () => {
    const q = (b) => Promise.resolve(b).then((r) => (r.error ? [] : r.data || []), () => []);
    const none = Promise.resolve([]);
    const [cupSides, cupMatches, sideEntries, ownDefs, ownEntries] = await Promise.all([
      q(supabase.from('cup_sides').select('*').order('sort')),
      q(supabase.from('cup_matches').select('*').order('sort')),
      entries && ids.length ? q(supabase.from('side_entries').select('*').in('round_id', ids)) : none,
      entries ? q(supabase.from('side_comp_defs').select('*')) : none,
      entries && ids.length ? q(supabase.from('side_comp_entries').select('*').in('round_id', ids)) : none,
    ]);
    setExtra({ cupSides, cupMatches, sideEntries, ownDefs, ownEntries });
  }, [idKey, entries]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useRealtime(entries ? ['cup_sides', 'cup_matches', 'side_entries', 'side_comp_defs', 'side_comp_entries'] : ['cup_sides', 'cup_matches'], load);
  const index = scoresIdx || sc.index;
  return useMemo(() => ({
    trips: data.trips || [], rounds: data.rounds || [], coursesById: data.coursesById || {}, playersById: data.playersById || {},
    players: data.players || [], roundPlayers: data.roundPlayers || {}, teamsByRound: data.teamsByRound || {},
    scoresIdx: index, quickResults: data.quick_results || [], honourBoard: data.honour_board || [], trophies: data.trophies || [],
    games, ...extra, reload: load,
  }), [data, index, games, extra, load]);
}
