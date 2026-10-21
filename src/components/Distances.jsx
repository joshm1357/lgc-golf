// Live GPS distances to the green (front / middle / back) and today's pin, on the score screen.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useRealtime, useSession } from '../lib/store.jsx';
import { getFix, useWatchPosition } from '../lib/geo.js';
import { greenDistances } from '../lib/greens.js';
import { toast } from './ui.jsx';
import { lazyScreen, LazyArea } from '../lib/lazy.jsx';
import { CourseGuideHoleLink } from './CourseGuideLink.jsx';

// The shot planner brings the map library with it, so it only loads when opened.
const ShotPlanner = lazyScreen(() => import('./ShotPlanner.jsx'), 'default', { inline: true });

const KEY = 'lgc-distances-on';

export function useRoundPins(roundId) {
  const [pins, setPins] = useState({});
  const load = useCallback(async () => {
    if (!roundId) return;
    try {
      const { data, error } = await supabase.from('round_pins').select('*').eq('round_id', roundId);
      if (!error) setPins(Object.fromEntries((data || []).map((p) => [p.hole, p])));
    } catch { /* no signal: keep what we have */ }
  }, [roundId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['round_pins'], load);
  return [pins, load];
}

export default function Distances({ round, course, hole }) {
  const { status } = useSession();
  const [on, setOn] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  // GPS only while the screen is actually showing (saves battery over a whole round).
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const f = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  const { pos, error } = useWatchPosition(on && visible && round.status !== 'locked');
  const [pins, reloadPins] = useRoundPins(round.id);
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const pin = pins[hole.n];
  const planner = planning && <LazyArea onClose={() => setPlanning(false)}><ShotPlanner hole={hole} pin={pin} onClose={() => setPlanning(false)} /></LazyArea>;
  const d = pos ? greenDistances(hole, pos, pin) : null;
  const mapped = !!(hole.green || pin);
  const toggle = () => {
    const v = !on;
    setOn(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  };
  async function setPin() {
    setBusy(true);
    try {
      const f = await getFix();
      if (f.accuracy > 25) throw new Error(`GPS is only good to ±${Math.round(f.accuracy)} m right now — wait a few seconds in the open and try again.`);
      const { error: e } = await supabase.from('round_pins').upsert({ round_id: round.id, hole: hole.n, lat: f.lat, lng: f.lng, set_by: status.player_id, set_at: new Date().toISOString() });
      if (e) throw e;
      toast(`Today's pin on ${hole.n} set (±${Math.round(f.accuracy)} m) — everyone gets the distance`);
      reloadPins();
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  }
  // Admin only: take away a pin dropped in the wrong place (distances go back to front/middle/back).
  async function clearPin() {
    if (!window.confirm(`Clear today's pin on ${hole.n}?`)) return;
    setBusy(true);
    try {
      const { data: gone, error: e } = await supabase.from('round_pins').delete().eq('round_id', round.id).eq('hole', hole.n).select('hole');
      if (e) throw e;
      if (!gone?.length) throw new Error('The pin wasn’t cleared — only the admin can clear a pin.');
      toast(`Today's pin on ${hole.n} cleared`);
      reloadPins();
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  }

  if (!on) {
    return (
      <div className="section" style={{ paddingBottom: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button type="button" className="btn ghost" onClick={toggle}>📍 GPS distances</button>
          <button type="button" className="btn ghost" onClick={() => setPlanning(true)}>🗺️ Plan my shots</button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 8 }}><CourseGuideHoleLink course={course} hole={hole} round={round} /></div>
        {planner}
      </div>
    );
  }
  const big = (label, v, strong) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <span className="small muted" style={{ fontWeight: 700 }}>{label}</span>
      <span className="num" style={{ fontSize: strong ? 44 : 30, lineHeight: 1 }}>{v != null ? v : '–'}</span>
    </div>
  );
  const far = d?.middle != null && d.middle > 650;
  return (
    <div className="section" style={{ paddingBottom: 0 }}>
      <div className="card pad stack" style={{ gap: 8 }}>
        <div className="row between">
          <span className="label">📍 Distance to the green (m)</span>
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn ghost sm" onClick={() => setPlanning(true)}>🗺️ Plan shots</button>
            <button type="button" className="btn ghost sm" onClick={toggle}>Hide</button>
          </span>
        </div>
        {!mapped ? (
          <div className="small">
            The greens for {course.name} aren’t mapped yet.
            {status.is_admin ? <> <Link to={`/courses/${course.id}/greens`}>Map them now</Link> (about 5 minutes, or fill from OpenStreetMap).</> : ' Ask the admin to map them.'}
          </div>
        ) : !pos ? (
          <div className="small muted">{error || 'Getting your GPS position…'}</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: pin ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', alignItems: 'end' }}>
              {big('Front', d.front)}
              {big('Middle', d.middle, !pin)}
              {big('Back', d.back)}
              {pin && big('🚩 Pin', d.pin, true)}
            </div>
            <div className="small muted">GPS ±{Math.round(pos.accuracy)} m{far ? ` · you’re a long way from hole ${hole.n} — on the right hole?` : ''}</div>
            {hole.osm && <div className="small muted">Green © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</div>}
          </>
        )}
        <CourseGuideHoleLink course={course} hole={hole} round={round} />
        {planner}
        {round.status === 'live' && (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={setPin}>🚩 {pin ? 'Move' : 'Set'} today’s pin on {hole.n} — stand next to the flag</button>
        )}
        {pin && status.is_admin && (
          <button type="button" className="btn danger" style={{ marginTop: 8 }} disabled={busy} onClick={clearPin}><span aria-hidden="true">✕</span> Clear today’s pin on {hole.n}</button>
        )}
      </div>
    </div>
  );
}
