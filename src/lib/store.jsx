// App-wide state: who I am, and the shared reference data (players, trips, rounds, teams…).
// Everything re-loads automatically when the database changes (Supabase Realtime).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { pendingScores, onQueueChange } from './offline.js';

const SessionCtx = createContext(null);
const DataCtx = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, status: null });

  const refresh = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setState({ loading: false, user: null, status: null });
      return;
    }
    const { data, error } = await supabase.rpc('my_status');
    setState({ loading: false, user: session.user, status: error ? null : data });
  }, []);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_OUT') refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);

/** Debounced refetch on any change to the listed tables. */
export function useRealtime(tables, onChange, filter) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(',') + (filter || '');
  useEffect(() => {
    let t;
    const fire = () => {
      clearTimeout(t);
      t = setTimeout(() => cb.current(), 250);
    };
    const ch = supabase.channel('rt-' + key + '-' + Math.random().toString(36).slice(2, 7));
    for (const table of tables) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter && table === 'scores' ? { filter } : {}) }, fire);
    }
    ch.subscribe();
    // Catch up when the phone wakes or the app comes back to the front.
    const vis = () => document.visibilityState === 'visible' && fire();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', fire);
    return () => {
      clearTimeout(t);
      supabase.removeChannel(ch);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('online', fire);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

const REF_TABLES = ['players', 'trips', 'trophies', 'courses', 'rounds', 'teams', 'team_players', 'round_players', 'quick_results', 'honour_board'];

export function DataProvider({ children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const results = await Promise.all(
      REF_TABLES.map((t) => supabase.from(t).select('*'))
    );
    const bad = results.find((r) => r.error);
    if (bad) {
      setError(bad.error);
      return;
    }
    const d = Object.fromEntries(REF_TABLES.map((t, i) => [t, results[i].data || []]));
    setError(null);
    setData(d);
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime(['players', 'rounds', 'teams', 'team_players', 'quick_results'], load);

  const value = useMemo(() => {
    if (!data) return { ready: false, error, reload: load };
    const playersById = Object.fromEntries(data.players.map((p) => [p.id, p]));
    const coursesById = Object.fromEntries(data.courses.map((c) => [c.id, c]));
    const trips = [...data.trips].sort((a, b) => String(b.start_date || b.created_at).localeCompare(String(a.start_date || a.created_at)));
    const rounds = [...data.rounds].sort((a, b) =>
      String(a.play_date || a.created_at).localeCompare(String(b.play_date || b.created_at)) || a.created_at.localeCompare(b.created_at)
    );
    const teamsByRound = {};
    for (const t of data.teams) {
      const members = data.team_players.filter((tp) => tp.team_id === t.id).map((tp) => playersById[tp.player_id]).filter(Boolean);
      (teamsByRound[t.round_id] ||= []).push({ ...t, players: members });
    }
    const roundPlayers = {};
    for (const rp of data.round_players) (roundPlayers[rp.round_id] ||= []).push(rp);
    const currentTrip = trips.find((t) => t.status === 'active') || trips[0] || null;
    const liveRound = [...rounds].reverse().find((r) => r.status === 'live') || null;
    const defaultRound =
      liveRound ||
      [...rounds].reverse().find((r) => r.trip_id === currentTrip?.id && r.status !== 'setup') ||
      [...rounds].reverse().find((r) => r.trip_id === currentTrip?.id) ||
      rounds[rounds.length - 1] || null;
    return {
      ready: true, error, reload: load, ...data, trips, rounds, playersById, coursesById,
      teamsByRound, roundPlayers, currentTrip, liveRound, defaultRound,
    };
  }, [data, error, load]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export const useData = () => useContext(DataCtx);

/** Scores for one or more rounds, live, with my not-yet-synced saves merged in. */
export function useScores(roundIds) {
  const ids = (Array.isArray(roundIds) ? roundIds : [roundIds]).filter(Boolean);
  const idKey = ids.join(',');
  const [rows, setRows] = useState([]);
  const [queue, setQueue] = useState(pendingScores());

  const load = useCallback(async () => {
    if (!ids.length) {
      setRows([]);
      return;
    }
    const { data } = await supabase.from('scores').select('*').in('round_id', ids);
    setRows(data || []);
  }, [idKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => onQueueChange(setQueue), []);
  useRealtime(['scores'], load, ids.length === 1 ? `round_id=eq.${ids[0]}` : undefined);

  return useMemo(() => {
    const merged = new Map(rows.map((r) => [`${r.round_id}|${r.subject_id}|${r.hole}`, r]));
    for (const q of queue) {
      if (!ids.includes(q.round_id)) continue;
      merged.set(`${q.round_id}|${q.subject_id}|${q.hole}`, { ...q, updated_at: q.queued_at, pending: true });
    }
    // Index: round -> subject -> hole -> score
    const idx = {};
    for (const r of merged.values()) {
      ((idx[r.round_id] ||= {})[r.subject_id] ||= {})[r.hole] = r;
    }
    return { index: idx, all: [...merged.values()], reload: load, pendingCount: queue.length };
  }, [rows, queue, idKey]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function playerName(p) {
  if (!p) return 'Unknown';
  return p.nickname || p.name;
}
