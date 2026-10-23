// Months later (ov28, walkthrough I16): "This time last year" — the trip that was on a year ago, who won what, and a
// photo — plus a nudge to suggest the next trip six months after the last one, and the way to the honour board.
// Shown on the first screen (screens/TripNow.jsx). The picking is in lib/results.js (thisTimeLastYear, nextTripNudge).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useFeature } from '../lib/store.jsx';
import { todayISO } from '../lib/plan.js';
import { tripPath } from '../lib/activetrip.js';
import { thisTimeLastYear, nextTripNudge } from '../lib/results.js';

export default function Memories({ plans = [] }) {
  const data = useData();
  const plannerOn = useFeature('planner');
  const feedOn = useFeature('feed');
  const trophiesOn = useFeature('trophies');
  const today = todayISO();
  const memory = thisTimeLastYear({ trips: data.trips || [], rounds: data.rounds || [], today });
  const nudge = plannerOn ? nextTripNudge({ trips: data.trips || [], rounds: data.rounds || [], today }) : null;
  const [photo, setPhoto] = useState(null);
  const memId = memory?.trip.id || null;
  useEffect(() => {
    if (!memId || !feedOn) { setPhoto(null); return undefined; }
    let live = true;
    supabase.from('posts').select('photo_url').eq('trip_id', memId).not('photo_url', 'is', null).limit(1)
      .then(({ data: ps }) => { if (live) setPhoto(ps?.[0]?.photo_url || null); }, () => {});
    return () => { live = false; };
  }, [memId, feedOn]);
  if (!memory && !nudge) return null;
  const won = memory ? (data.honour_board || []).filter((h) => h.trip_id === memory.trip.id) : [];
  return (
    <div className="stack" style={{ gap: 12 }}>
      {memory && (
        <Link to={tripPath(memory.trip, plans)} className="card pad stack" data-testid="this-time-last-year" style={{ gap: 6, textDecoration: 'none', color: 'inherit' }}>
          {photo && <img src={photo} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 10 }} />}
          <span className="label">📅 This time {memory.ago === 1 ? 'last year' : `${memory.ago} years ago`}</span>
          <strong style={{ fontSize: 18 }}>{memory.trip.name}</strong>
          {won.slice(0, 3).map((h) => <span key={h.id} className="small">🏆 {h.winner_names} won the {h.trophy_name}</span>)}
          {trophiesOn && <span className="small" style={{ fontWeight: 700 }}>The honour board →</span>}
        </Link>
      )}
      {nudge && (
        <Link to="/plan" className="card pad row" data-testid="next-trip-nudge" style={{ gap: 10, textDecoration: 'none', color: 'inherit', background: 'var(--gold-soft)', borderColor: 'var(--gold)' }}>
          <span className="grow small"><strong>It’s been {nudge.months} months since {nudge.trip.name}.</strong> Time to suggest the next one?</span>
          <span className="btn gold sm">Suggest a trip</span>
        </Link>
      )}
    </div>
  );
}
