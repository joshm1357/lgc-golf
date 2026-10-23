// Comps (migration 067): the group's comps, live, and the little chips on the leaderboard ("Today counts for: BD
// Trophy · 6th Ryder Cup"). Kept apart from screens/CompsBoard.jsx so the leaderboard (loaded first) stays small.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useScores, cacheGet, cacheSet } from '../lib/store.jsx';
import { useRoundGames } from './GamesChip.jsx';
import { currentGroup } from '../lib/group.js';
import { tripComps, roundComps, COMP_TYPE } from '../lib/comps.js';
import { isCupComp, mainWinnerIds } from '../lib/cups.js';
import { tripSpan } from '../lib/activetrip.js';

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
  const [allComps] = useComps();
  // ov32: a weekend / combined cup on this trip needs a few more things (cup_points, cap tips, posts, tips, breaches).
  const cupComps = useMemo(() => (allComps || []).filter((c) => c.trip_id === tripId && !c.retired && isCupComp(c)), [allComps, tripId]);
  const hasCup = cupComps.length > 0;
  const [extra, setExtra] = useState({ sideEntries: [], ownDefs: [], ownEntries: [], cupSides: [], cupMatches: [] });
  const [cupExtra, setCupExtra] = useState({});
  const idKey = ids.join(',');
  const trip = (data.trips || []).find((t) => t.id === tripId) || null;
  const span = trip ? tripSpan(trip, data.rounds || []) : { start: null, end: null };
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
  const loadCup = useCallback(async () => {
    if (!hasCup || !tripId) { setCupExtra({}); return; }
    const q = (b) => Promise.resolve(b).then((r) => (r.error ? [] : r.data || []), () => []);
    const shift = (d, n) => (d ? new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString() : null);
    const posts = span.start
      ? supabase.from('posts').select('id,kind,player_id,photo_url,link,body,trip_id,created_at').gte('created_at', shift(span.start, -2)).lte('created_at', shift(span.end || span.start, 3)).limit(2000)
      : null;
    const [cupPoints, capTips, postRows, tips, plans, scoreAdjustments, groups] = await Promise.all([
      q(supabase.from('cup_points').select('*').eq('trip_id', tripId)),
      q(supabase.from('cap_tips').select('*').eq('trip_id', tripId).order('created_at')),
      posts ? q(posts) : [],
      q(supabase.from('tips').select('*').eq('trip_id', tripId)),
      q(supabase.from('plans').select('id,status,trip_id').eq('trip_id', tripId)),
      ids.length ? q(supabase.from('score_adjustments').select('*').in('round_id', ids)) : [],
      currentGroup() ? q(supabase.from('groups').select('id,cap_tip_name').eq('id', currentGroup())) : [],
    ]);
    const plan = plans.find((p) => p.status !== 'cancelled');
    const tripTips = plan ? await q(supabase.from('trip_tips').select('player_id,pick_id').eq('plan_id', plan.id)) : [];
    setCupExtra({ cupPoints, capTips, posts: postRows, tips, tripTips, scoreAdjustments, capTipName: groups[0]?.cap_tip_name || 'cap' });
  }, [hasCup, tripId, idKey, span.start, span.end]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCup(); }, [loadCup]);
  useRealtime(entries ? ['cup_sides', 'cup_matches', 'side_entries', 'side_comp_defs', 'side_comp_entries'] : ['cup_sides', 'cup_matches'], load);
  useRealtime(hasCup ? ['cup_points', 'cap_tips', 'posts', 'tips', 'score_adjustments'] : [], loadCup);
  const index = scoresIdx || sc.index;
  return useMemo(() => {
    const out = {
      trips: data.trips || [], rounds: data.rounds || [], coursesById: data.coursesById || {}, playersById: data.playersById || {},
      players: data.players || [], roundPlayers: data.roundPlayers || {}, teamsByRound: data.teamsByRound || {},
      scoresIdx: index, quickResults: data.quick_results || [], honourBoard: data.honour_board || [], trophies: data.trophies || [],
      games, ...extra, ...cupExtra, reload: load, reloadCup: loadCup,
    };
    if (hasCup && (cupExtra.tripTips || []).length) {
      try { out.mainWinnerIds = mainWinnerIds((allComps || []).filter((c) => c.trip_id === tripId), out); } catch { out.mainWinnerIds = []; }
    }
    return out;
  }, [data, index, games, extra, cupExtra, load, loadCup, hasCup, allComps, tripId]);
}
