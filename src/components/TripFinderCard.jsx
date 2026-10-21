import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession, useFeature } from '../lib/store.jsx';
import { toast } from './ui.jsx';
import { decidedCourse } from '../lib/tripfinder.js';
import { todayISO } from '../lib/plan.js';

// The trip finder on a trip (Stage 16): organisers get "Find a course"; after the trip, everyone gets a one-tap
// course rating (1–5), kept for the group — it feeds the finder's "Best course" ranking next time.
export function TripFinderCard({ pd }) {
  const on = useFeature('trip_finder');
  const { status } = useSession();
  const plan = pd?.plan;
  const [find, setFind] = useState(undefined);
  const [mine, setMine] = useState(null);
  const [group, setGroup] = useState(null);

  const courseId = decidedCourse(find, pd?.polls);
  const past = plan && (plan.status === 'done' || ((plan.end_date || plan.start_date) && (plan.end_date || plan.start_date) < todayISO()));
  const load = useCallback(async () => {
    if (!on || !plan) return;
    const { data } = await supabase.from('trip_finds').select('*').eq('plan_id', plan.id).maybeSingle();
    setFind(data || null);
  }, [on, plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  const loadRatings = useCallback(async () => {
    if (!courseId || !past) return;
    const { data } = await supabase.from('course_ratings').select('*').eq('plan_id', plan.id).eq('course_id', courseId);
    const rows = data || [];
    setMine(rows.find((r) => r.player_id === status.player_id)?.rating ?? null);
    setGroup(rows.length ? { avg: rows.reduce((n, r) => n + r.rating, 0) / rows.length, n: rows.length } : null);
  }, [courseId, past, plan?.id, status.player_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadRatings(); }, [loadRatings]);

  if (!on || !plan || plan.status === 'cancelled') return null;
  const rate = async (n) => {
    setMine(n);
    const { error } = await supabase.from('course_ratings').upsert({ plan_id: plan.id, course_id: courseId, player_id: status.player_id, rating: n }, { onConflict: 'plan_id,course_id,player_id' });
    if (error) { toast('Couldn’t save that — try again'); setMine(null); return; }
    toast('Thanks — saved for the group');
    loadRatings();
  };
  const name = (find?.picks || []).find((p) => p.course_id === courseId)?.name || plan.location_name || 'the course';

  return (
    <>
      {status.is_admin && !past && plan.status !== 'done' && !status.viewing && (
        <Link to={`/plan/${plan.id}/find`} className="card pad row" data-testid="tf-link" style={{ textDecoration: 'none', color: 'inherit', gap: 12 }}>
          <span style={{ fontSize: 24 }}>🧭</span>
          <span className="grow"><strong>Find a course</strong><div className="small muted">Which courses suit everyone — tee times, drives and what we know, ranked.</div></span>
          <span className="btn sm">Find</span>
        </Link>
      )}
      {past && courseId && (
        <div className="card pad stack" data-testid="tf-rate" style={{ gap: 6 }}>
          <strong>How was {name}?</strong>
          <div className="row" style={{ gap: 4 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className="btn ghost sm" aria-label={`${n} out of 5`} aria-pressed={mine === n} onClick={() => rate(n)}
                style={{ fontSize: 22, minWidth: 48, color: mine != null && n <= mine ? 'var(--gold)' : '#B9C2CC' }}>★</button>
            ))}
          </div>
          <span className="small muted">{group ? `Your group: ${group.avg.toFixed(1)} from ${group.n}. ` : ''}It helps rank courses for your next trip. Other groups only ever see an average.</span>
        </div>
      )}
    </>
  );
}
