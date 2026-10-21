// Comps (migration 067): the group's comps, live, and the little chips on the leaderboard ("Today counts for: BD
// Trophy · 6th Ryder Cup"). Kept apart from screens/CompsBoard.jsx so the leaderboard (loaded first) stays small.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, cacheGet, cacheSet } from '../lib/store.jsx';
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
