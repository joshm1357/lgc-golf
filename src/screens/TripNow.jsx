// This trip — the first tab (ov15, 22 Oct 2026). The trip that's on, or the next one, or the one that just finished
// (lib/activetrip.js picks it), with its status underneath: today's leaderboard, the comps, the trip's feed and its
// rounds (components/TripStatus.jsx). A round's full leaderboard is #/?r=<round> (App.jsx sends that to Leaderboard,
// so every recap link already in a group chat still works). No trip on: a small "plan one" card.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature } from '../lib/store.jsx';
import { Header, Loading } from '../components/ui.jsx';
import { SaveSpotBanner } from '../components/SaveSpot.jsx';
import { pickActiveTrip, tripDayWords, tripPath } from '../lib/activetrip.js';
import { tripWhen } from '../lib/trips.js';
import { LazyArea } from '../lib/lazy.jsx';
import { AwardCards } from '../components/Awards.jsx';
// Loaded with the app (like the leaderboard): the first screen opens from one file, even on weak signal.
import TripStatus from '../components/TripStatus.jsx';

/** The trip's plan (for "Trip page →"), if the Trips planner is on. */
function usePlans(on) {
  const [plans, setPlans] = useState([]);
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    supabase.from('plans').select('id,trip_id,status').then(({ data, error }) => { if (live && !error) setPlans(data || []); }, () => {});
    return () => { live = false; };
  }, [on]);
  return plans;
}

export default function TripNow() {
  const data = useData();
  const { status } = useSession();
  const plannerOn = useFeature('planner');
  const plans = usePlans(plannerOn);
  const pick = useMemo(() => (data.ready ? pickActiveTrip({ trips: data.trips, rounds: data.rounds }) : null), [data.ready, data.trips, data.rounds]);
  if (!data.ready) return <Loading />;
  const trip = pick?.trip || null;
  const admin = status?.is_admin && !status?.viewing;
  const groupName = (status?.legacy ? 'L.G.C Golf' : status?.group_name) || 'The Golf Trip';
  return (
    <div className="page">
      <Header logo title={trip ? trip.name : groupName} sub={trip ? 'This trip' : groupName === 'The Golf Trip' ? '' : 'The Golf Trip'} />
      <SaveSpotBanner />
      <AwardCards />
      <div className="section stack" style={{ gap: 12, paddingBottom: 24 }}>
        {trip ? (
          <>
            <Link to={tripPath(trip, plans)} className="card pad row" data-testid="this-trip"
              style={{ gap: 12, textDecoration: 'none', color: '#fff', background: 'var(--navy)', borderColor: 'var(--navy)' }}>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="label" style={{ color: 'var(--on-navy-muted)' }}>{pick.why === 'recent' ? 'Last trip' : pick.why === 'upcoming' ? 'Next trip' : 'On now'}</span>
                <strong style={{ display: 'block', fontSize: 20 }} className="ellipsis">{trip.name}</strong>
                <span className="small" style={{ color: 'var(--on-navy-muted)' }}>{tripWhen(trip, 'Dates to come')}</span>
              </span>
              <span className="chip" style={{ background: 'var(--gold)', borderColor: 'var(--gold)', color: 'var(--text)', fontWeight: 800, whiteSpace: 'nowrap', flex: 'none', alignSelf: 'center' }}>
                {tripDayWords(trip, data.rounds)}
              </span>
            </Link>
            <LazyArea resetKey={trip.id} fallback={<Loading />}>
              <TripStatus trip={trip} />
            </LazyArea>
          </>
        ) : (
          <div className="card pad stack" data-testid="no-trip" style={{ gap: 8 }}>
            <strong style={{ fontSize: 18 }}>No trip on — plan one</strong>
            <span className="small muted">When a trip is on or coming up, its leaderboards, comps and feed are here.</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {plannerOn && <Link to="/plan" className="btn gold sm">{admin ? 'Plan a trip' : 'Trips'}</Link>}
              {admin && <Link to="/setup" className="btn ghost sm">Set up your trip</Link>}
              {data.rounds.length > 0 && <Link to="/leaderboard" className="btn ghost sm">Last leaderboard</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
