import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useFeature, useSession } from '../lib/store.jsx';
import { GroupCrest } from './Logo.jsx';
import { Icon } from './ui.jsx';
import { openFeedback } from './Feedback.jsx';
import { DESKTOP } from '../lib/beta.js';
import { useTripsMenu } from '../screens/TripNow.jsx';
import { tripNowPath } from '../lib/activetrip.js';
import { tripStage } from '../lib/trips.js';
import { sideItems, soonestOrganising, stageLook } from '../lib/runup.js';
import { openPlanner } from './Caddie.jsx';
import './runup.css';

/** Is the screen laptop-wide? Follows the window as it's resized. */
export function useDesktop() {
  const q = `(min-width: ${DESKTOP}px)`;
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return undefined;
    const f = () => setOn(m.matches);
    m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, [q]);
  return on;
}

// Stage 1 light desktop: on a screen 1024 px wide or more, this sidebar replaces the bottom tab bar (styles.css shows
// one or the other). Same places, same feature switches, plus the screens a phone keeps under More.
export function Sidebar() {
  // Only on the page at laptop width, so phones get exactly the page they had before.
  return useDesktop() ? <SidebarNav /> : null;
}

function SidebarNav() {
  const { status } = useSession();
  const on = {
    feed: useFeature('feed'), planner: useFeature('planner'), trophies: useFeature('trophies'), tribunal: useFeature('tribunal'),
  };
  const look = status?.look || (status && status.legacy !== false ? { crest_url: 'builtin:lgc' } : null);
  // ov21 (23 Oct): no "This trip" item. Trips is a group with its sub-items underneath: On now / Next trip (or
  // ✨ Plan a trip when nothing's coming up) and Last trip — each opens that trip's status page.
  const items = [
    on.feed && { to: '/feed', label: 'Feed', icon: Icon.feed },
    { to: '/group', label: 'Players & group', icon: Icon.user },
    on.trophies && { to: '/trophies', label: 'Trophy Room', icon: Icon.trophy },
    // ov19: the Rulebook, Tribunal and Committees are one place — Governance, with tabs.
    { to: '/governance', label: 'Governance', icon: Icon.gavel },
    { to: '/courses', label: 'Courses', icon: Icon.map },
    { to: '/more', label: 'More', icon: Icon.more },
  ].filter(Boolean);
  return (
    <nav className="side" aria-label="Main">
      <Link to="/groups" className="side-brand" aria-label="Your groups">
        <GroupCrest size={44} look={look} name={status?.group_name} />
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="side-name ellipsis">{status?.group_name || 'The Golf Trip'}</span>
          <span className="side-sub">The Golf Trip <span className="beta-pill">Beta</span></span>
        </span>
      </Link>
      <div className="side-links">
        <TripsGroup planner={on.planner} />
        {items.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => 'side-link' + (isActive ? ' active' : '')}>
            {t.icon(20)}<span>{t.label}</span>
          </NavLink>
        ))}
      </div>
      <button type="button" className="side-link side-feedback" onClick={() => openFeedback('idea')}>
        {Icon.feed(20)}<span>Send feedback</span>
      </button>
    </nav>
  );
}

/** Trips, with its sub-items (ov21), labelled by stage (ov25): "Upcoming: Hunter · 16 days", "Being organised: March",
 *  "Previous: South Coast" — at most three, then "All trips". */
function TripsGroup({ planner }) {
  const menu = useTripsMenu();
  const loc = useLocation();
  const p = loc.pathname;
  const organising = useMemo(() => soonestOrganising((menu.plans || []).map((pl) => ({ plan: pl, stage: tripStage(pl, null) }))), [menu.plans]);
  const items = sideItems({ menu, organising });
  // Trips is lit on its own screens; a sub-item is lit when its trip's status page (or its plan) is open.
  const homeTrip = p === '/' && !new URLSearchParams(loc.search).get('r') ? menu.now?.trip.id : null;
  const openTrip = p.startsWith('/trip-now/') ? p.slice('/trip-now/'.length) : homeTrip;
  const openPlan = p.startsWith('/plan/') ? p.slice('/plan/'.length).split('/')[0] : null;
  const subLit = (x) => (x.trip ? openTrip === x.trip.id : openPlan === x.plan.id);
  const anyLit = items.some(subLit);
  const tripsLit = !anyLit && (p === '/plan' || p.startsWith('/plan/') || p.startsWith('/trip/') || (p === '/' && menu.ready && !menu.now));
  const STAGE = { on: 'on', upcoming: 'locked', organising: 'deciding', previous: 'done' };
  return (
    <div className="side-group" data-testid="side-trips">
      <Link to={planner ? '/plan' : '/'} className={'side-link' + (tripsLit ? ' active' : '')} aria-current={tripsLit ? 'page' : undefined}>
        {Icon.calendar(20)}<span>Trips</span>
      </Link>
      {/* Nothing on or coming up: ✨ Plan a trip comes first. */}
      {!menu.now && menu.ready && (
        <button type="button" className="side-link side-subitem" data-testid="side-plan" onClick={openPlanner}>
          <span>✨ Plan a trip</span>
        </button>
      )}
      {items.map((x) => (
        <Link key={`${x.kind}-${x.trip?.id || x.plan?.id}`} to={x.trip ? tripNowPath(x.trip) : `/plan/${x.plan.id}`} data-testid={`side-${x.kind}`}
          className={'side-link side-subitem side-' + x.kind + (subLit(x) ? ' active' : '')}
          aria-current={subLit(x) ? 'page' : undefined} title={x.label}>
          <span className="ellipsis"><span aria-hidden="true">{stageLook(STAGE[x.kind]).icon} </span>{x.label}</span>
        </Link>
      ))}
      {planner && <Link to="/plan" className="side-link side-subitem side-all" data-testid="side-all-trips"><span>All trips →</span></Link>}
    </div>
  );
}
