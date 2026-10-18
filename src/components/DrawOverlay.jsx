// Watches for an open draw room or a live draw. The ceremony itself (the big part) only loads
// when there's a draw to show.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useRealtime } from '../lib/store.jsx';
import { lazyScreen, LazyArea } from '../lib/lazy.jsx';

const LiveDrawCeremony = lazyScreen(() => import('./DrawCeremony.jsx'), 'LiveDrawCeremony');
const DISMISS_KEY = 'lgc-draw-dismissed';

/** Watches for an open draw room or a live draw and takes over the screen. */
export function DrawOverlay() {
  const [draw, setDraw] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const { data } = await supabase.from('draws').select('*').gte('created_at', since).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(10);
    // A draw that's open or running always wins over one that's finished (e.g. cars drawn after the teams room opened).
    const d = (data || []).find((x) => x.status === 'lobby' || x.status === 'running' || x.status === 'done') || data?.[0] || null;
    // A locked draw only reappears for 30 minutes.
    if (d && d.status === 'locked' && Date.now() - new Date(d.started_at).getTime() > 30 * 60 * 1000) setDraw(null);
    else setDraw(d);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['draws'], load);

  if (!draw || dismissed === draw.id + ':' + draw.status) return null;
  return (
    <LazyArea resetKey={draw.id + ':' + draw.status}>
      <LiveDrawCeremony draw={draw} onClose={() => {
        const v = draw.id + ':' + draw.status;
        try { localStorage.setItem(DISMISS_KEY, v); } catch { /* ignore */ }
        setDismissed(v);
      }} />
    </LazyArea>
  );
}

