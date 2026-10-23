import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession, useFeature } from '../lib/store.jsx';
import { builderSteps } from '../lib/tripbuilder.js';
import { upToLine } from '../lib/tripsteps.js'; // O1: the same line as Organise — "Up to step 3 of 6: Call the courses"

// The way into the trip builder (077) on a trip that's still being decided: the first card on its overview, and in
// Organise. Organisers always see it; players see it once the organiser has started building (read-only + votes).
// viewer (ov23): the Overview — the same card for everyone (read-only wording), even for organisers.
export function TripBuilderCard({ pd, first = false, viewer = false }) {
  const on = useFeature('trip_finder');
  const { status: real } = useSession();
  const status = viewer ? { ...real, is_admin: false } : real;
  const plan = pd?.plan;
  const [build, setBuild] = useState(undefined);
  useEffect(() => {
    if (!on || !plan?.id) return undefined;
    let live = true;
    supabase.from('trip_builds').select('state').eq('plan_id', plan.id).maybeSingle()
      .then(({ data }) => live && setBuild(data?.state || null), () => live && setBuild(null));
    return () => { live = false; };
  }, [on, plan?.id]);
  if (!on || !plan || plan.status !== 'planning' || plan.proposed) return null;
  if (!status.is_admin && !build) return null;
  const steps = builderSteps(build || {});
  const at = steps.find((s) => !s.done) || steps[steps.length - 1];
  return (
    <Link to={`/plan/${plan.id}/build`} className="card pad row" data-testid="tb-link"
      style={{ textDecoration: 'none', color: 'inherit', gap: 12, borderColor: 'var(--navy)', borderWidth: 2, marginBottom: first ? 12 : 0 }}>
      <span style={{ fontSize: 26 }}>🗺️</span>
      <span className="grow">
        <strong>{status.is_admin ? 'Build the trip' : 'How the trip’s coming together'}</strong>
        <div className="small muted">{build ? upToLine(steps.every((x) => x.done) ? 'money' : at.key) : 'Areas and weekends → the vote → courses and stays → call the courses → pick & lock in.'}</div>
      </span>
      <span className="btn sm">{status.is_admin ? (build ? 'Open' : 'Start') : 'Look'}</span>
    </Link>
  );
}
