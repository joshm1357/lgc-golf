// Award moments (migration 054, feature 'awards'). Two pieces:
//  * <AwardWatcher /> (in App.jsx): while a round is being played (or was today/yesterday), it watches the scores,
//    side comp entries and the Cup, and the first phone to see something decided records it. The database turns that
//    into a Feed post and a queued phone buzz. An organiser's phone also fixes a moment if a score is corrected after.
//  * <AwardCards /> (top of the Leaderboard): the moments from the last few hours, with the winner's photo — anyone can
//    take the first one; after that only whoever took it, or an organiser, can swap it. No photo: the winner's avatar.
// "Is it decided, and who won" is all in lib/awards.js.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useFeature, useRealtime, useScores, useSession } from '../lib/store.jsx';
import { uploadPhoto } from '../lib/images.js';
import { decidedMoments, isFresh, momentChanged, recentMoments, canChangePhoto, RECENT_HOURS } from '../lib/awards.js';
import { Avatar, PhotoButtons, timeAgo, toast } from './ui.jsx';

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Rows of a table, live (an empty list when `enabled` is false). */
function useLive(table, enabled, query) {
  const [state, setState] = useState({ ready: !enabled, rows: [] });
  const q = useRef(query);
  q.current = query;
  const load = useCallback(async () => {
    if (!enabled) { setState({ ready: true, rows: [] }); return; }
    try {
      const { data, error } = await q.current(supabase.from(table));
      if (!error && data) setState({ ready: true, rows: data });
    } catch { /* no signal: keep what we have */ }
  }, [table, enabled]);
  useEffect(() => { load(); }, [load]);
  useRealtime(enabled ? [table] : [], load);
  // This phone just changed it: show that now, without waiting for the live update.
  useEffect(() => {
    const ev = `tgt-reload-${table}`;
    window.addEventListener(ev, load);
    return () => window.removeEventListener(ev, load);
  }, [table, load]);
  return state;
}
const changed = () => window.dispatchEvent(new Event('tgt-reload-award_moments'));

/** Watches for things being decided and records each one once. Renders nothing. */
export function AwardWatcher() {
  const on = useFeature('awards');
  const { status } = useSession() || {};
  const data = useData();
  if (!on || !data?.ready || !status?.player_id || status?.viewing) return null;
  const today = localToday();
  const freshTrips = new Set(data.rounds.filter((r) => isFresh(r, today)).map((r) => r.trip_id));
  if (!freshTrips.size) return null;
  // Every played round of those trips (a trophy adds up all of them), not just the fresh ones.
  const rounds = data.rounds.filter((r) => freshTrips.has(r.trip_id) && r.status !== 'setup');
  return <Watch rounds={rounds} today={today} />;
}

function Watch({ rounds, today }) {
  const data = useData();
  const { status } = useSession();
  const sideOn = useFeature('side_comps');
  const trophiesOn = useFeature('trophies');
  const cupOn = useFeature('cup');
  const ids = rounds.map((r) => r.id);
  const idKey = ids.join(',');
  const scores = useScores(ids);
  const side = useLive('side_entries', true, (t) => t.select('*').in('round_id', ids));
  const sides = useLive('cup_sides', cupOn, (t) => t.select('*'));
  const matches = useLive('cup_matches', cupOn, (t) => t.select('*').in('round_id', ids));
  const saved = useLive('award_moments', true, (t) => t.select('id,key,title,detail,winner_player_ids,photo_url,created_at').in('round_id', ids));

  // Only scores the database has (not ones still waiting on this phone), so nothing is announced early.
  const synced = useMemo(() => {
    const idx = {};
    for (const s of scores.all) if (!s.pending) ((idx[s.round_id] ||= {})[s.subject_id] ||= {})[s.hole] = s;
    return idx;
  }, [scores.all]);

  const tried = useRef(new Set());
  const seen = useRef(null);
  useEffect(() => {
    if (!saved.ready || !side.ready || !matches.ready || !sides.ready) return;
    const computed = decidedMoments({
      today, rounds: data.rounds, coursesById: data.coursesById, teamsByRound: data.teamsByRound,
      roundPlayers: data.roundPlayers, playersById: data.playersById, scoresIdx: synced, quickResults: data.quick_results,
      sideEntries: side.rows, trophies: data.trophies, cupMatches: matches.rows, cupSides: sides.rows,
      features: { side_comps: sideOn, trophies: trophiesOn, cup: cupOn },
    }).filter((m) => !m.round_id || ids.includes(m.round_id));
    const have = new Map(saved.rows.map((m) => [m.key, m]));
    for (const m of computed) {
      const was = have.get(m.key);
      if (!was) {
        if (tried.current.has(m.key)) continue;
        tried.current.add(m.key);
        supabase.from('award_moments').upsert(m, { onConflict: 'group_id,key', ignoreDuplicates: true })
          .then(({ error }) => { if (!error) changed(); else if (!error.code) tried.current.delete(m.key); }) // no signal: try again later
          .catch(() => tried.current.delete(m.key));
      } else if (status.is_admin && momentChanged(was, m) && !tried.current.has(`fix:${m.key}:${m.title}:${m.detail}`)) {
        // A score was fixed after it was recorded: the organiser's phone puts it right (a new winner loses the photo).
        tried.current.add(`fix:${m.key}:${m.title}:${m.detail}`);
        const winnersChanged = [...(was.winner_player_ids || [])].sort().join() !== [...m.winner_player_ids].sort().join();
        supabase.from('award_moments').update({ title: m.title, detail: m.detail, winner_player_ids: m.winner_player_ids, ...(winnersChanged ? { photo_url: null } : {}) })
          .eq('id', was.id).then(changed, () => {});
      }
    }
  }, [saved, side, matches, sides, synced, data, sideOn, trophiesOn, cupOn, status.is_admin, today, idKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A pop-up the moment something new is decided (not for what was already there when the app opened).
  useEffect(() => {
    if (!saved.ready) return;
    const keys = new Set(saved.rows.map((m) => m.key));
    if (seen.current) {
      const fresh = saved.rows.find((m) => !seen.current.has(m.key) && Date.now() - new Date(m.created_at).getTime() < 15 * 60000);
      if (fresh) toast(fresh.title);
    }
    seen.current = keys;
  }, [saved]);
  return null;
}

const onNavy = { background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.45)' };
const HIDE_KEY = 'tgt-awards-hidden';
const readHidden = () => { try { return JSON.parse(localStorage.getItem(HIDE_KEY) || '[]'); } catch { return []; } };

/** The winner cards at the top of the Leaderboard. */
export function AwardCards() {
  const on = useFeature('awards');
  if (!on) return null;
  return <Cards />;
}

function Cards() {
  const [hidden, setHidden] = useState(readHidden);
  const since = useMemo(() => new Date(Date.now() - RECENT_HOURS * 3600000).toISOString(), []);
  const live = useLive('award_moments', true, (t) => t.select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(10));
  const list = recentMoments(live.rows, { hidden }).slice(0, 3);
  const hide = (id) => {
    const next = [...hidden, id].slice(-40);
    setHidden(next);
    try { localStorage.setItem(HIDE_KEY, JSON.stringify(next)); } catch { /* fine */ }
  };
  if (!list.length) return null;
  return (
    <div className="section stack" style={{ gap: 10 }} aria-label="Just decided">
      {list.map((m, i) => <AwardCard key={m.id} moment={m} big={i === 0} onHide={() => hide(m.id)} />)}
    </div>
  );
}

function AwardCard({ moment: m, big, onHide }) {
  const data = useData();
  const { status } = useSession();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(m.photo_url);
  useEffect(() => { setShown(m.photo_url); }, [m.photo_url]);
  const winners = (m.winner_player_ids || []).map((id) => data.playersById[id]).filter(Boolean);
  const me = status?.player_id;
  const organiser = !!status?.is_admin;
  const canPhoto = !status?.viewing && canChangePhoto({ ...m, photo_url: shown }, { playerId: me, isOrganiser: organiser });

  const save = async (file) => {
    setBusy(true);
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('No signal — try the photo again when you’re back in range.');
      const url = await uploadPhoto(file, 'awards');
      const { error } = await supabase.from('award_moments').update({ photo_url: url }).eq('id', m.id);
      if (error) throw error;
      setShown(url);
      setPicking(false);
      changed();
      toast('Photo added 📸');
    } catch (e) {
      toast(friendlyError(e));
    }
    setBusy(false);
  };

  const navy = big;
  return (
    <div className="card" style={{ overflow: 'hidden', position: 'relative', background: navy ? 'var(--navy)' : 'var(--gold-soft)', borderColor: navy ? 'var(--navy)' : 'var(--gold)', color: navy ? '#fff' : 'inherit' }}>
      {shown && big && <img src={shown} alt={`Winner’s photo: ${m.title.replace(/^\S+\s/, '')}`} style={{ width: '100%', maxHeight: 260, objectFit: 'cover', display: 'block', background: '#E6EAEF' }} />}
      <div className="pad row" style={{ gap: 12, alignItems: 'flex-start' }}>
        {(!big || !shown) && (shown
          ? <img src={shown} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
          : winners.length > 0 && (
            <span className="row" style={{ flex: 'none', gap: 0 }}>
              {winners.slice(0, 2).map((p, i) => <span key={p.id} style={{ marginLeft: i ? -14 : 0 }}><Avatar player={p} size={big ? 64 : 48} ring={navy ? 'var(--gold)' : undefined} /></span>)}
            </span>
          ))}
        <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
          <div className="label" style={{ color: navy ? 'var(--gold)' : '#5A4300' }}>Just decided · {timeAgo(m.created_at)}</div>
          <div style={{ fontFamily: big ? 'var(--display)' : undefined, fontSize: big ? 22 : 16, fontWeight: 700, lineHeight: 1.15 }}>{m.title}</div>
          {m.detail && <div className="small" style={{ opacity: 0.85, lineHeight: 1.35 }}>{m.detail}</div>}
        </div>
        <button type="button" className="btn ghost sm" onClick={onHide} aria-label="Hide this card" style={{ flex: 'none', minWidth: 40, ...(navy ? onNavy : {}) }}>✕</button>
      </div>
      {canPhoto && (
        <div className="pad" style={{ paddingTop: 0 }}>
          {busy ? <div className="small" role="status">Uploading the photo…</div>
            : (!shown && big) || picking ? (
              <div style={navy ? { background: '#fff', borderRadius: 12, padding: 6 } : undefined}>
                <PhotoButtons onPick={save} cameraLabel="Take the winner’s photo" libraryLabel="Choose one" />
              </div>
            ) : (
              <button type="button" className="btn ghost sm" style={navy ? onNavy : undefined} onClick={() => setPicking(true)}>
                {!shown ? '📸 Add the winner’s photo' : organiser ? '🔁 Swap photo' : '📸 Retake photo'}
              </button>
            )}
        </div>
      )}
    </div>
  );
}
