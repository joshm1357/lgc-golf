import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useFeature, useSession } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import PlaceSearch from './PlaceSearch.jsx';

// Your home suburb (optional, Stage 16.1): set once, reused for every trip's drive times. Only a suburb or town, kept
// to about 1 km — never an address. You choose whether to share it; if you do, only the group's organisers see it.
export function HomeArea({ player }) {
  const on = useFeature('trip_finder');
  const { status } = useSession();
  const [row, setRow] = useState(undefined);
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(null);
  const [busy, run] = useRun();
  const load = useCallback(async () => {
    const { data } = await supabase.from('player_home_areas').select('*').eq('player_id', player.id).maybeSingle();
    setRow(data || null);
  }, [player.id]);
  useEffect(() => { if (on) load(); }, [on, load]);
  if (!on || status.viewing || row === undefined) return null;

  const save = () => run(async () => {
    const body = { player_id: player.id, label: v.label.trim(), postcode: v.postcode || null, lat: v.lat, lng: v.lng, share: v.share };
    await must(supabase.from('player_home_areas').upsert(body, { onConflict: 'player_id' }));
    setEdit(false); load();
  }, 'Saved');
  const remove = () => run(async () => {
    await must(supabase.from('player_home_areas').delete().eq('player_id', player.id));
    setEdit(false); load();
  }, 'Removed');
  const share = (yes) => run(async () => {
    await must(supabase.from('player_home_areas').update({ share: yes }).eq('player_id', player.id));
    load();
  }, yes ? 'Shared with the organisers' : 'Not shared');

  if (!edit) {
    return (
      <div className="card pad stack" data-testid="home-area" style={{ gap: 6 }}>
        <span className="label">Home suburb (optional)</span>
        {row ? (
          <>
            <div className="row between"><strong>{row.label}{row.postcode ? ` ${row.postcode}` : ''}</strong>
              <button type="button" className="btn ghost sm" onClick={() => { setV({ ...row }); setEdit(true); }}>Change</button></div>
            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={row.share} disabled={busy} onChange={(e) => share(e.target.checked)} />
              Share with the organisers for trip drive times
            </label>
          </>
        ) : (
          <button type="button" className="btn ghost sm" onClick={() => { setV({ label: '', postcode: '', lat: null, lng: null, share: true }); setEdit(true); }}>Add your home suburb</button>
        )}
        <span className="small muted">Just a suburb or town — never your address. Only the organisers see it, and only if you share it.</span>
      </div>
    );
  }
  return (
    <div className="card pad stack" data-testid="home-area">
      <span className="label">Home suburb</span>
      <PlaceSearch initial={v.label} allowHere onPick={(p) => setV((x) => ({ ...x, label: p.label || x.label, postcode: p.postcode || x.postcode, lat: p.lat, lng: p.lng }))} />
      <div className="row" style={{ gap: 8 }}>
        <label className="field grow"><span>Suburb</span><input className="input" value={v.label} maxLength={60} onChange={(e) => setV({ ...v, label: e.target.value.replace(/[0-9]/g, '') })} /></label>
        <label className="field" style={{ width: 100 }}><span>Postcode</span><input className="input" inputMode="numeric" maxLength={4} value={v.postcode || ''} onChange={(e) => setV({ ...v, postcode: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></label>
      </div>
      {v.lat == null && <span className="small muted">Pick it from the list (or “Where I am”) so drive times can be worked out.</span>}
      <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={v.share} onChange={(e) => setV({ ...v, share: e.target.checked })} /> Share with the organisers for trip drive times</label>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn ghost grow" onClick={() => setEdit(false)}>Cancel</button>
        <button type="button" className="btn grow" disabled={busy || v.label.trim().length < 2 || v.lat == null || (v.postcode && v.postcode.length !== 4)} onClick={save}>Save</button>
      </div>
      {row && <button type="button" className="btn danger sm" disabled={busy} onClick={remove}>Remove my home suburb</button>}
    </div>
  );
}
