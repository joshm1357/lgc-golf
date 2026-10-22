// A trip's history notes (migration 081): stories, commentary, awards and moments, fines, side comp winners, past
// cups and scorecard notes brought in with "Bring your history". Shown on the trip's Overview (everyone in the
// group) and, for the whole group, on the History screen (organisers, with ✕ to remove one).
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { NOTE_ICON } from '../lib/historyimport.js';

/** history_notes for a trip (or every one, when tripId is null), newest year first. [] on an older database. */
export function useHistoryNotes(tripId, { all = false } = {}) {
  const [notes, setNotes] = useState([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!tripId && !all) return undefined;
    let live = true;
    let q = supabase.from('history_notes').select('id,trip_id,round_id,kind,title,body,year,happened_on,people,data,created_at');
    if (tripId) q = q.eq('trip_id', tripId);
    q.order('year', { ascending: false, nullsFirst: false }).order('created_at').limit(300)
      .then(({ data, error }) => { if (live) setNotes(error ? [] : data || []); }, () => {});
    return () => { live = false; };
  }, [tripId, all, tick]);
  return [notes, () => setTick((t) => t + 1)];
}

const half = (n) => (n == null ? '' : Number.isInteger(Number(n)) ? String(n) : `${Math.floor(n) || ''}½`);

/** A past cup: the two sides and the score, then the matches. */
function CupNote({ n }) {
  const sides = Array.isArray(n.data?.sides) ? n.data.sides : [];
  const matches = Array.isArray(n.data?.matches) ? n.data.matches : [];
  return (
    <div className="stack" style={{ gap: 4 }}>
      <strong>🏆 {n.title}{n.year ? <span className="muted" style={{ fontWeight: 600 }}> · {n.year}</span> : null}</strong>
      {sides.length === 2 && (
        <div className="row between" style={{ gap: 8, fontWeight: 800 }}>
          <span>{sides[0].name} {half(sides[0].points)}</span><span className="muted">v</span><span>{half(sides[1].points)} {sides[1].name}</span>
        </div>
      )}
      {n.data?.winner && <span className="small" style={{ fontWeight: 700 }}>{n.data.winner} won{n.people ? ` — ${n.people}` : ''}</span>}
      {matches.slice(0, 20).map((m, i) => (
        <span key={i} className="small muted">{(m.a || []).join(' & ')} v {(m.b || []).join(' & ')}{m.result ? ` · ${m.result}` : m.winner === 'halved' ? ' · halved' : ''}{m.winner === 'a' || m.winner === 'b' ? ` (${(m.winner === 'a' ? sides[0] : sides[1])?.name || ''})` : ''}</span>
      ))}
    </div>
  );
}

/** One note: its icon and title, who, and the text. */
export function NoteLine({ n, onRemove, busy }) {
  if (n.kind === 'cup') {
    return (
      <div className="row between" style={{ gap: 8, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
        <div className="grow" style={{ minWidth: 0 }}><CupNote n={n} /></div>
        {onRemove && <button type="button" className="btn ghost sm" disabled={busy} aria-label={`Remove ${n.title}`} onClick={() => onRemove(n)}>✕</button>}
      </div>
    );
  }
  return (
    <div className="row between" style={{ gap: 8, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
      <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 700 }}>{NOTE_ICON[n.kind] || '🗂️'} {n.title}{n.people ? <span style={{ fontWeight: 600 }}> — {n.people}</span> : null}
          {n.year ? <span className="small muted" style={{ fontWeight: 600 }}> · {n.happened_on || n.year}</span> : null}</span>
        {n.body && <span className="small muted" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.body}</span>}
      </div>
      {onRemove && <button type="button" className="btn ghost sm" disabled={busy} aria-label={`Remove ${n.title}`} onClick={() => onRemove(n)}>✕</button>}
    </div>
  );
}

/** The trip's history on its Overview: cups first, then awards and moments, then stories and the rest. */
export default function TripHistory({ tripId }) {
  const [notes] = useHistoryNotes(tripId);
  if (!notes.length) return null;
  const order = ['cup', 'award', 'moment', 'side_comp', 'fine', 'scorecard', 'report', 'story', 'commentary', 'other'];
  const sorted = [...notes].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return (
    <div className="card pad" style={{ paddingTop: 10 }} aria-label="From the history">
      <strong>📖 From the history</strong>
      {sorted.map((n) => <NoteLine key={n.id} n={n} />)}
    </div>
  );
}
