// App-wide state: who I am, and the shared reference data (players, trips, rounds, teams…).
// Everything re-loads automatically when the database changes (Supabase Realtime).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { pendingScores, onQueueChange, freeCacheSpace } from './offline.js';
import { currentGroup, setCurrentGroup, GROUP_TABLES } from './group.js';
import { featureOn } from './features.js';
import { applyLook, DEFAULT_LOOK, LGC_LOOK } from './theme.js';

// The offline copy of a group's players, rounds, courses… is kept per group.
const refKey = () => `ref-${currentGroup() || 'x'}`;

const SessionCtx = createContext(null);

// Offline: the last good copy of things the app needs to open and score with no signal.
export function cacheGet(key) {
  try { return JSON.parse(localStorage.getItem(`lgc-cache-${key}`) || 'null'); } catch { return null; }
}
export function cacheSet(key, value) {
  const text = JSON.stringify(value);
  try {
    localStorage.setItem(`lgc-cache-${key}`, text);
  } catch {
    // Full: clear the old offline copies and try once more. Never touches the score queue.
    freeCacheSpace();
    try { localStorage.setItem(`lgc-cache-${key}`, text); } catch { /* fine — just no offline copy */ }
  }
}
// Old multi-round score copies (one per screen) from the first offline version: no longer used.
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith('lgc-cache-scores-') && k.includes(',')) localStorage.removeItem(k);
  }
} catch { /* ignore */ }
const DataCtx = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, status: null });

  const refresh = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setState({ loading: false, user: null, status: null });
      return;
    }
    let res;
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
      res = await supabase.rpc('my_status');
    } catch (e) { res = { error: e }; }
    const { data, error } = res;
    if (!error && data) cacheSet(`status-${session.user.id}`, data);
    // No signal: use who I was last time on this phone, so the app still opens.
    const cached = error ? cacheGet(`status-${session.user.id}`) : null;
    const status = error ? cached : data;
    // The database says which group I'm in (the one this phone asked for, if I'm still in it).
    if (status?.group_id) setCurrentGroup(status.group_id);
    setState({ loading: false, user: session.user, status, offline: !!(error && cached) });
    // The group's look. (An older database has no look: it only has L.G.C.)
    if (status?.is_member) applyLook(status.look || (status.legacy === false ? DEFAULT_LOOK : LGC_LOOK));
  }, []);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_OUT') {
        freeCacheSpace(); // the saved offline copies belong to whoever was signed in
        setCurrentGroup(null);
        refresh();
      }
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
    // Only this group's changes (a person in two groups isn't woken by the other one's).
    const g = currentGroup();
    for (const table of tables) {
      const f = filter && table === 'scores' ? filter : g && GROUP_TABLES.has(table) ? `group_id=eq.${g}` : null;
      ch.on('postgres_changes', { event: '*', schema: 'public', table, ...(f ? { filter: f } : {}) }, fire);
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

  const [offline, setOffline] = useState(false);
  const load = useCallback(async () => {
    let results;
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false && cacheGet(refKey())) throw new Error('offline');
      results = await Promise.all(REF_TABLES.map((t) => supabase.from(t).select('*')));
    } catch (e) {
      results = [{ error: e }];
    }
    const bad = results.find((r) => r.error);
    if (bad) {
      // No signal: open on the last copy saved on this phone.
      // (A phone coming from v1.x has its one copy under the old name until its first load with signal.)
      const cached = cacheGet(refKey()) || cacheGet('ref');
      if (cached) {
        setData((cur) => cur || cached);
        setOffline(true);
        return;
      }
      setError(bad.error);
      return;
    }
    const d = Object.fromEntries(REF_TABLES.map((t, i) => [t, results[i].data || []]));
    cacheSet(refKey(), d);
    try { localStorage.removeItem('lgc-cache-ref'); } catch { /* ignore */ }
    setError(null);
    setOffline(false);
    setData(d);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Feature switches for this group (Stage 3). Loaded on their own, so an older database without them just means
  // "everything at its default" rather than the app failing to load.
  const [features, setFeatures] = useState(() => cacheGet(`features-${currentGroup()}`) || {});
  const loadFeatures = useCallback(async () => {
    const { data: rows, error: e } = await supabase.from('group_features').select('feature_key,enabled');
    if (e) return;
    const next = Object.fromEntries((rows || []).map((r) => [r.feature_key, r.enabled]));
    cacheSet(`features-${currentGroup()}`, next);
    setFeatures(next);
  }, []);
  useEffect(() => { loadFeatures(); }, [loadFeatures]);
  useRealtime(['group_features'], loadFeatures);

  useRealtime(['players', 'trips', 'rounds', 'teams', 'team_players', 'quick_results', 'honour_board', 'trophies', 'round_players', 'courses'], load);

  const value = useMemo(() => {
    if (!data) return { ready: false, error, reload: load, features };
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
    const todayIso = new Date().toISOString().slice(0, 10);
    // The open trip; if none, the latest one that has started (not a future trip set up early).
    const currentTrip = trips.find((t) => t.status === 'active') || trips.find((t) => !t.start_date || t.start_date <= todayIso) || trips[trips.length - 1] || null;
    const liveRound = [...rounds].reverse().find((r) => r.status === 'live') || null;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const defaultRound =
      liveRound ||
      [...rounds].reverse().find((r) => r.play_date === today) ||
      [...rounds].reverse().find((r) => r.trip_id === currentTrip?.id && r.status !== 'setup') ||
      [...rounds].reverse().find((r) => r.trip_id === currentTrip?.id) ||
      rounds[rounds.length - 1] || null;
    return {
      ready: true, error, offline, reload: load, ...data, trips, rounds, playersById, coursesById,
      teamsByRound, roundPlayers, currentTrip, liveRound, defaultRound, features,
    };
  }, [data, error, load, offline, features]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export const useData = () => useContext(DataCtx);

/** Is a feature switched on for this group? (lib/features.js has the list, defaults and which needs which.) */
export function useFeature(key) {
  const d = useContext(DataCtx);
  return featureOn(key, d?.features || {});
}

/** Scores for one or more rounds, live, with my not-yet-synced saves merged in. */
export function useScores(roundIds) {
  const ids = (Array.isArray(roundIds) ? roundIds : [roundIds]).filter(Boolean);
  const idKey = ids.join(',');
  // Offline copy only for one-round screens (leaderboard, score entry) — small, and what's needed on a course.
  const cacheKey = ids.length === 1 ? `scores-${ids[0]}` : null;
  const [rows, setRows] = useState(() => (cacheKey && cacheGet(cacheKey)) || []);
  const [queue, setQueue] = useState(pendingScores());

  const load = useCallback(async () => {
    if (!ids.length) {
      setRows([]);
      return;
    }
    try {
      const { data, error } = await supabase.from('scores').select('*').in('round_id', ids);
      if (error || !data) {
        // No signal: show the last copy saved for these rounds (plus anything queued on this phone).
        const c = cacheKey && cacheGet(cacheKey);
        if (c) setRows(c);
        return;
      }
      if (cacheKey) cacheSet(cacheKey, data);
      setRows(data);
    } catch {
      /* keep what we have */
    }
  }, [idKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);
  // When the queue changes (e.g. a save just synced), re-load so the synced score stays on screen.
  useEffect(() => onQueueChange((q) => { setQueue(q); load(); }), [load]);
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

/** For the demo page: supply fixed session + data without touching the database. */
export function DemoProviders({ session, data, children }) {
  return (
    <SessionCtx.Provider value={session}>
      <DataCtx.Provider value={data}>{children}</DataCtx.Provider>
    </SessionCtx.Provider>
  );
}

/** Side-comp entries for a round, live. */
export function useSideEntries(roundId) {
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    if (!roundId) { setRows([]); return; }
    try {
      const { data, error } = await supabase.from('side_entries').select('*').eq('round_id', roundId);
      if (!error && data) setRows(data);
    } catch { /* keep what we have */ }
  }, [roundId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['side_entries'], load);
  return rows;
}
