// Tipping (ov28, migration 097, walkthrough I9): tip the Cup, a Cup match, or who wins a round (a team or pair for
// Ambrose / 4BBB, a player for Stableford / stroke play). Bragging rights only — no money in the app. Locks once it
// starts (checked in the database). Shows "7 tipped Red, 4 tipped Blue" as tips come in; the results page says who
// tipped right. The trip's main-trophy tip stays in the run-up (trip_tips, 094).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useSession, useFeature, useRealtime } from '../lib/store.jsx';
import { toast } from './ui.jsx';
import { tipCounts } from '../lib/results.js';

/** Every tip on a trip, live. An older database (no tips table yet): none, quietly. */
export function useTips(tripId) {
  const on = useFeature('tipping');
  const [tips, setTips] = useState([]);
  const load = useCallback(async () => {
    if (!on || !tripId) { setTips([]); return; }
    try {
      const { data, error } = await supabase.from('tips').select('*').eq('trip_id', tripId);
      if (!error) setTips(data || []);
    } catch { /* keep what we have */ }
  }, [on, tripId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(on && tripId ? ['tips'] : [], load);
  return { tips, on, reload: load };
}

/**
 * One thing to tip. options: [{ value, label, colour? }]. locked: it's started (no more changes).
 * tips/reload: from useTips (one load per screen).
 */
export function TipPicker({ tripId, target, targetId, options = [], locked = false, title = 'Your tip', tips = [], reload, compact = false }) {
  const { status } = useSession();
  const on = useFeature('tipping');
  const [busy, setBusy] = useState(false);
  const mine = useMemo(() => tips.filter((t) => t.target === target && t.target_id === targetId), [tips, target, targetId]);
  const me = status?.player_id;
  const myTip = mine.find((t) => t.player_id === me) || null;
  const counts = tipCounts(mine, options);
  if (!on || !tripId || !targetId || !options.length) return null;
  const canTip = !locked && !!me && !status?.viewing && status?.role !== 'guest';
  if (!canTip && !counts) return null;
  const pick = async (value) => {
    setBusy(true);
    try {
      const res = myTip
        ? await supabase.from('tips').update({ pick: value }).eq('id', myTip.id)
        : await supabase.from('tips').insert({ trip_id: tripId, player_id: me, target, target_id: targetId, pick: value });
      if (res.error) throw res.error;
      toast('Tipped — bragging rights only');
      await reload?.();
    } catch (e) { toast(friendlyError(e)); }
    setBusy(false);
  };
  return (
    <div className="stack" style={{ gap: 6 }} data-testid={`tip-${target}`}>
      {canTip && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {!compact && <span className="small" style={{ fontWeight: 700 }}>🎯 {title}:</span>}
          {options.map((o) => {
            const on2 = myTip?.pick === o.value;
            return (
              <button key={o.value} type="button" className="chip" disabled={busy} aria-pressed={on2} data-testid="tip-option"
                onClick={() => pick(o.value)}
                style={on2 ? { background: o.colour || 'var(--navy)', borderColor: o.colour || 'var(--navy)', color: '#fff', fontWeight: 800 } : { borderColor: o.colour || undefined }}>
                {on2 ? '✓ ' : ''}{o.label}
              </button>
            );
          })}
        </div>
      )}
      {counts && <span className="small muted" data-testid="tip-counts">{counts}{locked ? ' · tipping closed' : ''}</span>}
    </div>
  );
}
