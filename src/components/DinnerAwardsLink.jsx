// One small line on the Feed into the current trip's fines and dinner awards (feature 'dinner_awards').
// Kept apart from screens/DinnerAwards.jsx so the Feed stays small.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useFeature, useRealtime } from '../lib/store.jsx';

export function DinnerAwardsLink() {
  const on = useFeature('dinner_awards');
  const trip = useData()?.currentTrip;
  const [voting, setVoting] = useState(0);
  const load = useCallback(async () => {
    if (!on || !trip) return;
    const { data, error } = await supabase.from('dinner_awards').select('id,status').eq('trip_id', trip.id);
    if (!error) setVoting((data || []).filter((a) => a.status === 'voting').length);
  }, [on, trip]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['dinner_awards'], load);
  if (!on || !trip) return null;
  return (
    <Link to={`/dinner/${trip.id}`} className="small" style={{ fontWeight: 700, display: 'block' }} data-testid="feed-dinner-link">
      🏅 Awards and fines{voting ? ` — ${voting} open for votes` : ''} →
    </Link>
  );
}
