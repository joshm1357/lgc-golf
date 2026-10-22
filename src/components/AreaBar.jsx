// "The areas we're considering" — the top of the trip builder's step 1 (ov23, Josh 23 Oct: "You should be able to
// have an 'Add another area' or something up the top, then it's added to that list up the top"). Each area on the
// table is a chip (tap = its own map and lists below, ✕ = take it off); "+ Add another area" opens a search (towns
// and regions) and the region guide list from the course research; "📊 Compare" puts them side by side.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { toast } from './ui.jsx';
import * as TB from '../lib/tripbuilder.js';
import { addArea, removeArea, guideAreaGroups, MAX_AREAS } from '../lib/areavote.js';

/** The region guides (088), loaded once per screen. Before 088 (or signed out): none. */
export function useRegionGuides() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let live = true;
    supabase.from('region_guides').select('title,kind,regions,body,sort').eq('active', true).order('sort')
      .then(({ data, error }) => { if (live && !error) setRows(data || []); }, () => {});
    return () => { live = false; };
  }, []);
  return rows;
}

export default function AreaBar({ st, save, org, areas, tab, onTab, guides = [] }) {
  const options = st.region ? [st.region] : (st.regionOptions || []);
  const [adding, setAdding] = useState(!options.length);
  const [query, setQuery] = useState('');
  useEffect(() => { if (!options.length) setAdding(true); }, [options.length]);
  const hits = TB.matchRegions(query, areas);
  const regions = [...new Set(areas.map((a) => a.region))];
  const groups = guideAreaGroups(guides, regions);
  const add = (r) => {
    if (options.includes(r)) { onTab(r); setAdding(false); return; }
    const p = addArea(st, r);
    if (!p) { toast(`Up to ${MAX_AREAS} areas`); return; }
    save({ ...st, ...p });
    onTab(r); setAdding(false); setQuery('');
  };
  const remove = (r) => {
    save({ ...st, ...removeArea(st, r) });
    if (tab === r) onTab(options.find((x) => x !== r) || null);
  };
  if (st.region) {
    return (
      <div className="card pad row between" style={{ gap: 8 }} data-testid="area-bar">
        <span><span className="small muted" style={{ display: 'block' }}>The area</span><strong data-testid="tb-region">📍 {st.region}</strong></span>
        {org && <button type="button" className="btn ghost sm" onClick={() => save({ ...st, region: null, regionOptions: st.areaPool?.length ? st.areaPool : options })}>Change</button>}
      </div>
    );
  }
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="area-bar">
      <div className="row between" style={{ gap: 8 }}>
        <strong>📍 The areas we’re considering</strong>
        <span className="small muted">{options.length ? `${options.length} on the table` : 'none yet'}</span>
      </div>
      <div className="tb-chips" role="tablist" aria-label="Regions on the table" data-testid="area-chips">
        {options.map((r) => (
          <span key={r} className="chip" role="tab" aria-selected={tab === r} aria-pressed={tab === r} data-testid="area-chip" data-area={r}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, paddingRight: org ? 4 : undefined }}>
            <button type="button" onClick={() => onTab(r)} style={{ background: 'none', border: 0, color: 'inherit', font: 'inherit', padding: 0, minHeight: 36 }}>{r}</button>
            {org && <button type="button" aria-label={`Take ${r} off`} onClick={() => remove(r)} data-testid="area-remove"
              style={{ background: 'none', border: 0, color: 'inherit', font: 'inherit', minWidth: 32, minHeight: 36, cursor: 'pointer' }}>✕</button>}
          </span>
        ))}
        {options.length > 1 && <button type="button" className="chip" role="tab" aria-selected={tab === '__compare'} aria-pressed={tab === '__compare'} onClick={() => onTab('__compare')} data-testid="area-compare-tab">📊 Compare</button>}
        {org && !adding && options.length < MAX_AREAS && <button type="button" className="chip" onClick={() => setAdding(true)} data-testid="add-area">+ Add another area</button>}
      </div>
      {org && adding && (
        <div className="stack" style={{ gap: 6 }} data-testid="add-area-panel">
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a region or town, e.g. Hunter, Mudgee, Kiama" aria-label="Area" autoFocus={options.length > 0} />
            {options.length > 0 && <button type="button" className="btn ghost sm" onClick={() => { setAdding(false); setQuery(''); }}>Done</button>}
          </div>
          {hits.length > 0 && (
            <div className="tb-chips" data-testid="tb-region-hits">
              {hits.slice(0, 8).map((r) => <button key={r.region} type="button" className="chip" aria-pressed={options.includes(r.region)} onClick={() => add(r.region)}>+ {r.region}</button>)}
            </div>
          )}
          {query.trim().length >= 2 && !hits.length && <span className="small muted">No area matches “{query.trim()}” — try a bigger town nearby, or browse below.</span>}
          {!query.trim() && groups.length > 0 && (
            <details data-testid="region-guides">
              <summary className="small" style={{ fontWeight: 700, cursor: 'pointer', minHeight: 32 }}>Browse the region guide</summary>
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                {groups.map((g) => (
                  <div key={g.title} className="stack" style={{ gap: 2 }}>
                    <span className="small muted" style={{ fontWeight: 700 }}>{g.title}</span>
                    <div className="tb-chips">{g.areas.map((r) => <button key={r} type="button" className="chip" aria-pressed={options.includes(r)} onClick={() => add(r)}>+ {r}</button>)}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {options.length === 1 && org && <span className="small muted">One area so far. Add another to put them to a vote, or go with this one.</span>}
    </div>
  );
}
