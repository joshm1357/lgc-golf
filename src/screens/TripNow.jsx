// A trip's status page (ov15, 22 Oct 2026; ov21, 23 Oct): the trip that's on, the next one, or the last one, with its
// status underneath — today's leaderboard, the comps, the trip's feed and its rounds (components/TripStatus.jsx).
// Reached from the Trips sub-items (sidebar) and the Next / Last cards at the top of Trips: #/trip-now/<trip>.
// #/ (home) shows the On now / Next trip here when there is one, else the Trips screen (App.jsx → Home).
// A round's full leaderboard is #/?r=<round> (App.jsx sends that to Leaderboard, so every recap link already in a
// group chat still works). No trip at all and the planner switched off: a small "no trip on" card.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, useRealtime, cacheGet, cacheSet } from '../lib/store.jsx';
import { Header, Loading } from '../components/ui.jsx';
import { SaveSpotBanner } from '../components/SaveSpot.jsx';
import { tripDayWords, tripPath, tripsMenu } from '../lib/activetrip.js';
import { tripWhen } from '../lib/trips.js';
import { LazyArea } from '../lib/lazy.jsx';
import { AwardCards } from '../components/Awards.jsx';
// Loaded with the app (like the leaderboard): the first screen opens from one file, even on weak signal.
import TripStatus from '../components/TripStatus.jsx';
import Memories from '../components/Memories.jsx';

/** The group's plans (id, trip, status) — for "Trip page →" and to leave called-off trips out of Next / Last. */
export function usePlans(on) {
  const [plans, setPlans] = useState(() => (on ? cacheGet('trips-menu-plans') : null));
  const [loaded, setLoaded] = useState(!on);
  const load = useCallback(() => {
    if (!on) return;
    supabase.from('plans').select('id,trip_id,status,name').then(({ data, error }) => {
      if (!error) { setPlans(data || []); cacheSet('trips-menu-plans', data || []); }
      setLoaded(true);
    }, () => setLoaded(true));
  }, [on]);
  useEffect(() => { load(); }, [load]);
  useRealtime(on ? ['plans'] : [], load);
  return { plans: plans || [], ready: loaded || !!plans };
}

/** On now / Next trip, Last trip, or "Plan a trip" (lib/activetrip.js tripsMenu), kept up to date. */
export function useTripsMenu() {
  const data = useData();
  const plannerOn = useFeature('planner');
  const { plans, ready } = usePlans(plannerOn);
  const menu = useMemo(() => tripsMenu({ trips: data.trips, rounds: data.rounds, plans }), [data.trips, data.rounds, plans]);
  return { ...menu, plans, ready: !!data.ready && ready };
}

export default function TripNow({ menu: given }) {
  const data = useData();
  const { tripId } = useParams();
  const { status } = useSession();
  const plannerOn = useFeature('planner');
  const own = useTripsMenu();
  const menu = given || own;
  if (!data.ready) return <Loading />;
  // A trip asked for by address (a sub-item), else the one that's on or next.
  const asked = tripId ? data.trips.find((t) => t.id === tripId) || null : null;
  const trip = tripId ? asked : menu.now?.trip || null;
  const kind = !trip ? null
    : menu.now?.trip.id === trip.id ? (menu.now.on ? 'On now' : 'Next trip')
      : menu.last?.id === trip.id ? 'Last trip' : 'Trip';
  const admin = status?.is_admin && !status?.viewing;
  const groupName = (status?.legacy ? 'L.G.C Golf' : status?.group_name) || 'The Golf Trip';
  if (tripId && !asked) {
    return <div className="page"><Header back="Trips" title="Not found" /><div className="empty">This trip isn’t here any more.</div></div>;
  }
  return (
    <div className="page">
      <Header logo={!tripId} back={tripId ? 'Trips' : undefined} title={trip ? trip.name : groupName}
        sub={trip ? 'Trip status' : groupName === 'The Golf Trip' ? '' : 'The Golf Trip'} />
      <SaveSpotBanner />
      <AwardCards />
      <div className="section stack" style={{ gap: 12, paddingBottom: 24 }}>
        {/* ov28 (I16): "this time last year" and, six months after the last trip, a nudge to suggest the next. */}
        {!tripId && <Memories plans={menu.plans} />}
        {trip ? (
          <>
            <Link to={tripPath(trip, menu.plans)} className="card pad row" data-testid="this-trip"
              style={{ gap: 12, textDecoration: 'none', color: '#fff', background: 'var(--navy)', borderColor: 'var(--navy)' }}>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="label" style={{ color: 'var(--on-navy-muted)' }}>{kind}</span>
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
