import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useScores, useSession, playerName } from '../lib/store.jsx';
import { useWatchPosition, distanceM } from '../lib/geo.js';
import { Header, timeAgo } from '../components/ui.jsx';
import CourseMap, { avatarIcon } from '../components/CourseMap.jsx';

const PREF = 'lgc-share-location';

export default function MapScreen() {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [share, setShare] = useState(() => {
    try { return localStorage.getItem(PREF) === 'on'; } catch { return false; }
  });
  const { pos, error } = useWatchPosition(share);
  const [pings, setPings] = useState([]);
  const lastSent = useRef(null);
  const round = data.liveRound || data.defaultRound;
  const scores = useScores(round?.id);

  const load = useCallback(async () => {
    const { data: rows } = await supabase.from('location_pings').select('*');
    setPings(rows || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['location_pings'], load);

  // Send my position at most once a minute, or sooner if I've moved 40 m.
  useEffect(() => {
    if (!share || !pos || !me) return;
    const prev = lastSent.current;
    const moved = prev ? distanceM(prev, pos) : Infinity;
    if (prev && Date.now() - prev.at < 60000 && moved < 40) return;
    lastSent.current = { ...pos, at: Date.now() };
    supabase.from('location_pings').upsert({ player_id: me, lat: pos.lat, lng: pos.lng, accuracy_m: pos.accuracy, updated_at: new Date().toISOString() }).then(() => {});
  }, [share, pos, me]);

  async function toggle(on) {
    setShare(on);
    try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* ignore */ }
    if (!on) {
      lastSent.current = null;
      await supabase.from('location_pings').delete().eq('player_id', me);
      load();
    }
  }

  // Where each group is, from their last saved score (works without GPS).
  const groups = useMemo(() => {
    if (!round) return [];
    const idx = scores.index[round.id] || {};
    const subjects = round.format === 'ambrose'
      ? (data.teamsByRound[round.id] || []).map((t) => ({ id: t.id, name: t.name, players: t.players }))
      : round.format === 'fourball'
      ? (data.teamsByRound[round.id] || []).flatMap((t) => t.players.map((p) => ({ id: p.id, name: playerName(p), players: [p] })))
      : (data.roundPlayers[round.id] || []).map((rp) => ({ id: rp.player_id, name: playerName(data.playersById[rp.player_id]), players: [data.playersById[rp.player_id]] }));
    return subjects.map((s) => {
      const holes = Object.values(idx[s.id] || {});
      const last = holes.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
      const ping = pings.filter((p) => s.players.some((pl) => pl?.id === p.player_id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      return { ...s, lastHole: last?.hole, lastAt: last?.updated_at, ping, done: holes.length };
    }).sort((a, b) => (b.lastHole || 0) - (a.lastHole || 0));
  }, [round, scores.index, data, pings]);

  const fresh = pings.filter((p) => Date.now() - new Date(p.updated_at).getTime() < 3 * 3600 * 1000);
  const markers = fresh.map((p) => ({
    id: p.player_id, lat: p.lat, lng: p.lng,
    icon: avatarIcon(data.playersById[p.player_id], { gold: p.player_id === me, label: `${playerName(data.playersById[p.player_id])} · ${timeAgo(p.updated_at).replace(' ago', '')}` }),
  }));
  if (share && pos && !fresh.some((p) => p.player_id === me)) {
    markers.push({ id: 'me', lat: pos.lat, lng: pos.lng, icon: avatarIcon(data.playersById[me], { gold: true, label: 'You' }) });
  }

  return (
    <div className="page">
      <Header logo title="Where's everyone" sub={round ? round.name : ''}>
        <label className="row between" style={{ background: 'var(--navy-2)', borderRadius: 12, padding: '10px 12px' }}>
          <span className="stack" style={{ gap: 2 }}>
            <span style={{ fontWeight: 700 }}>Share my location</span>
            <span className="hdr-sub" style={{ fontSize: 12.5 }}>{share ? (error || (pos ? `On · ±${Math.round(pos.accuracy)} m` : 'Getting GPS…')) : 'Only while the app is open'}</span>
          </span>
          <span className="switch"><input type="checkbox" role="switch" checked={share} onChange={(e) => toggle(e.target.checked)} /><span /></span>
        </label>
      </Header>
      {markers.length ? <CourseMap markers={markers} className="map tall" /> : <div className="empty">Nobody's sharing their location right now. Switch it on above.</div>}
      <div className="section">
        <div className="card">
          {groups.map((g) => (
            <div key={g.id} className="row between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)' }}>
              <span style={{ fontWeight: 600 }}>{g.name}</span>
              <span className="small muted">
                {g.done >= 18 ? 'Finished' : g.lastHole ? `On ${Math.min(18, g.lastHole + 1)} · from last score` : 'Not started'}
                {g.ping ? ` · GPS ${timeAgo(g.ping.updated_at)}` : ''}
              </span>
            </div>
          ))}
          {!groups.length && <div className="empty">No round on.</div>}
        </div>
      </div>
      <p className="note">Phones stop sharing when the app is closed or the screen is off. Groups not sharing show the hole from their last saved score.</p>
    </div>
  );
}
