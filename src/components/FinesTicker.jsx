// Fines so far (ov28, walkthrough I12): a running "🏷 Fines so far: Mo 3 · Bo 2" line on the day screen, and a one-tap
// "Fine someone" — there and on the hole screen. Built on ov24's awards and fines (components/AwardsFines.jsx: the
// trip's fines come from the Rulebook; FineSheet does the picking, proof and saving). The tally maths is in
// lib/results.js (finesTally), shared with the results page and the awards presentation.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, useRealtime, playerName } from '../lib/store.jsx';
import { FineSheet, useAwardsData } from './AwardsFines.jsx';
import { finesTally, finesLine } from '../lib/results.js';
import { gate } from '../lib/savedgate.js';

/** The trip's awards and fines with their nominations (who's been fined), live. { awards, nominations, votes, ready }. */
export function useTripFines(tripId) {
  const on = useFeature('dinner_awards');
  const [d, setD] = useState({ awards: [], nominations: [], votes: [], ready: false });
  const load = useCallback(async () => {
    if (!on || !tripId) { setD({ awards: [], nominations: [], votes: [], ready: true }); return; }
    try {
      const { data: awards, error } = await supabase.from('dinner_awards').select('*').eq('trip_id', tripId);
      if (error) { setD((x) => ({ ...x, ready: true })); return; }
      const ids = (awards || []).map((a) => a.id);
      const [n, v] = ids.length ? await Promise.all([
        supabase.from('dinner_award_nominations').select('*').in('award_id', ids),
        supabase.from('dinner_award_votes').select('*').in('award_id', ids),
      ]) : [{ data: [] }, { data: [] }];
      setD({ awards: awards || [], nominations: n.data || [], votes: v.data || [], ready: true });
    } catch { setD((x) => ({ ...x, ready: true })); }
  }, [on, tripId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(on && tripId ? ['dinner_awards', 'dinner_award_nominations', 'dinner_award_votes'] : [], load);
  return { ...d, on, reload: load };
}

/** "Fine someone": the fines sheet with no feed post behind it (from the day screen or the hole screen). */
export function FineSomeone({ tripId, className = 'btn ghost sm', label = '🏷 Fine someone', who = '', onSaved }) {
  const { status } = useSession();
  const on = useFeature('dinner_awards');
  const [open, setOpen] = useState(false);
  if (!on || !tripId || status?.viewing || status?.role === 'guest' || !status?.player_id) return null;
  return (
    <>
      <button {...gate('fine')} type="button" className={className} onClick={() => setOpen(true)} data-testid="fine-someone">{label}</button>
      {open && <FineSheet post={{ id: null, trip_id: tripId, player_id: who || '', created_at: new Date().toISOString() }} who={who || ''}
        onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}

/** The day screen's ticker: who's been fined so far, and "Fine someone". Nothing when awards and fines are off. */
export default function FinesTicker({ trip }) {
  const data = useData();
  const f = useTripFines(trip?.id);
  const ad = useAwardsData(trip?.id);
  const tally = useMemo(() => finesTally(f), [f]);
  if (!f.on || !trip || !f.ready) return null;
  const line = finesLine(tally, (id) => playerName(data.playersById?.[id]));
  // Nothing fined yet and no fines on the books for this trip: say nothing.
  const anyFines = (ad.rules || []).some((r) => r.award_kind === 'fine') || f.awards.some((a) => a.kind === 'fine');
  if (!line && !anyFines) return null;
  return (
    <div className="card pad row" data-testid="fines-ticker" style={{ gap: 10, alignItems: 'center' }}>
      <span className="grow small" style={{ lineHeight: 1.4, minWidth: 0 }}>
        <strong>🏷 Fines so far:</strong> {line || 'nobody yet'}
      </span>
      <FineSomeone tripId={trip.id} onSaved={f.reload} />
    </div>
  );
}
