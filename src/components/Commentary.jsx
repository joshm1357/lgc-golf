// Live commentary (migration 071, feature 'commentary', a child of 'awards'). Two pieces:
//  * <CommentaryWatcher /> (in App.jsx): while a round is being played (or was today/yesterday), the first phone to
//    see a moment worth a line (lib/commentary.js — a lead change, a birdie run, an ace, the Cup…) records it once.
//    The server writes the words and the database puts them in the Feed and buzzes phones (rate-limited).
//  * <CommentarySettings /> (Admin, organisers): the tone, how often phones buzz, and today's lines with Hide.
// "When is it worth saying" is all in lib/commentary.js; the words are written on the server.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { currentGroup } from '../lib/group.js';
import { useData, useFeature, useRealtime, useScores, useSession } from '../lib/store.jsx';
import { isFresh } from '../lib/awards.js';
import { commentaryMoments, templateLine, TONES, BUZZ_LEVELS, DEFAULT_TONE, DEFAULT_BUZZ } from '../lib/commentary.js';
import { timeAgo, toast } from './ui.jsx';

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Rows of a table, live (an empty list when `enabled` is false). */
function useLive(table, enabled, query, deps = '') {
  const [state, setState] = useState({ ready: !enabled, rows: [] });
  const q = useRef(query);
  q.current = query;
  const load = useCallback(async () => {
    if (!enabled) { setState({ ready: true, rows: [] }); return; }
    try {
      const { data, error } = await q.current(supabase.from(table));
      if (!error && data) setState({ ready: true, rows: data });
    } catch { /* no signal: keep what we have */ }
  }, [table, enabled, deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useRealtime(enabled ? [table] : [], load);
  useEffect(() => {
    const ev = `tgt-reload-${table}`;
    window.addEventListener(ev, load);
    return () => window.removeEventListener(ev, load);
  }, [table, load]);
  return state;
}

/** Watches the scores and records each moment once. Renders nothing. */
export function CommentaryWatcher() {
  const on = useFeature('commentary');
  const { status } = useSession() || {};
  const data = useData();
  if (!on || !data?.ready || !status?.player_id || status?.viewing || status?.role === 'guest') return null;
  const today = localToday();
  const freshTrips = new Set(data.rounds.filter((r) => isFresh(r, today)).map((r) => r.trip_id));
  if (!freshTrips.size) return null;
  // Every played round of those trips (the Cup adds up the whole trip); only fresh ones get lines.
  const rounds = data.rounds.filter((r) => freshTrips.has(r.trip_id) && r.status !== 'setup');
  return <Watch rounds={rounds} today={today} />;
}

function Watch({ rounds, today }) {
  const data = useData();
  const cupOn = useFeature('cup');
  const ids = rounds.map((r) => r.id);
  const freshIds = rounds.filter((r) => isFresh(r, today)).map((r) => r.id);
  const idKey = ids.join(',');
  const scores = useScores(freshIds);
  const matches = useLive('cup_matches', cupOn, (t) => t.select('*').in('round_id', ids), idKey);
  const awards = useLive('award_moments', true, (t) => t.select('key,created_at').in('round_id', freshIds).like('key', 'round:%'), idKey);
  // Only scores the database has (not ones still waiting on this phone), so nothing is said early.
  const synced = useMemo(() => {
    const idx = {};
    for (const s of scores.all) if (!s.pending) ((idx[s.round_id] ||= {})[s.subject_id] ||= {})[s.hole] = s;
    return idx;
  }, [scores.all]);
  const tried = useRef(new Set());
  useEffect(() => {
    if (!matches.ready || !awards.ready) return;
    const moments = commentaryMoments({
      now: Date.now(), today, rounds: data.rounds.filter((r) => ids.includes(r.id)), coursesById: data.coursesById,
      teamsByRound: data.teamsByRound, roundPlayers: data.roundPlayers, playersById: data.playersById, scoresIdx: synced,
      cupMatches: matches.rows, roundAwards: awards.rows, features: { cup: cupOn },
    });
    for (const m of moments) {
      if (tried.current.has(m.key)) continue;
      tried.current.add(m.key);
      supabase.from('commentary').upsert(m, { onConflict: 'group_id,key', ignoreDuplicates: true })
        .then(({ error }) => { if (error && !error.code) tried.current.delete(m.key); }) // no signal: try again later
        .catch(() => tried.current.delete(m.key));
    }
  }, [synced, matches, awards, data, cupOn, today, idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const SAMPLE = { who: 'Mike', hole: 7, score: '18 pts thru 7', prev: 'Al' };

/** Organisers: tone, buzz level and today's lines. */
export function CommentarySettings() {
  const on = useFeature('commentary');
  const { status } = useSession() || {};
  if (!on || !status?.is_admin) return null;
  return <SettingsCard />;
}

function SettingsCard() {
  const settings = useLive('commentary_settings', true, (t) => t.select('*').limit(1));
  const since = useMemo(() => new Date(Date.now() - 24 * 3600000).toISOString(), []);
  const lines = useLive('commentary', true, (t) => t.select('id,kind,line,status,created_at').in('status', ['ready', 'hidden']).gte('created_at', since).order('created_at', { ascending: false }).limit(6));
  const s = settings.rows[0] || {};
  const tone = s.tone || DEFAULT_TONE;
  const buzz = s.buzz || DEFAULT_BUZZ;
  const [busy, setBusy] = useState(false);
  const save = async (patch) => {
    setBusy(true);
    const { error } = await supabase.from('commentary_settings').upsert({ group_id: currentGroup(), tone, buzz, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'group_id' });
    setBusy(false);
    if (error) toast(friendlyError(error));
    else { window.dispatchEvent(new Event('tgt-reload-commentary_settings')); toast('Saved'); }
  };
  const hide = async (id) => {
    const { error } = await supabase.from('commentary').update({ status: 'hidden' }).eq('id', id);
    if (error) toast(friendlyError(error));
    else { window.dispatchEvent(new Event('tgt-reload-commentary')); toast('Hidden from the Feed'); }
  };
  return (
    <div className="card pad stack" aria-label="Live commentary">
      <div>
        <div style={{ fontWeight: 700, fontSize: 17 }}>🎙️ Live commentary</div>
        <div className="small muted">As the round goes on, the app posts a short line when something happens — a new leader, a birdie run, an ace. Your running jokes stay private.</div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="label">Tone</div>
        <div className="seg light" role="group" aria-label="Tone">
          {TONES.map((t) => <button key={t.key} type="button" aria-pressed={tone === t.key} disabled={busy} onClick={() => save({ tone: t.key })}>{t.name}</button>)}
        </div>
        <div className="small muted" aria-live="polite">e.g. “{templateLine('lead', SAMPLE, tone, 'sample:1')}”</div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="label">Buzz phones</div>
        <div className="seg light" role="group" aria-label="Buzz phones">
          {BUZZ_LEVELS.map((b) => <button key={b.key} type="button" aria-pressed={buzz === b.key} disabled={busy} onClick={() => save({ buzz: b.key })}>{b.name}</button>)}
        </div>
        <div className="small muted">{BUZZ_LEVELS.find((b) => b.key === buzz)?.blurb} Only for people who chose “straight away” notifications.</div>
      </div>
      {lines.rows.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="label">Today’s lines</div>
          {lines.rows.map((l) => (
            <div key={l.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <span className="grow small" style={{ opacity: l.status === 'hidden' ? 0.5 : 1, textDecoration: l.status === 'hidden' ? 'line-through' : 'none' }}>
                {l.line} <span className="muted">· {timeAgo(l.created_at)}</span>
              </span>
              {l.status === 'ready'
                ? <button type="button" className="btn ghost sm" style={{ flex: 'none' }} onClick={() => hide(l.id)}>Hide</button>
                : <span className="small muted" style={{ flex: 'none' }}>Hidden</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
