import React, { useEffect, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useFeature, useSession } from '../lib/store.jsx';
import { GroupCrest } from './Logo.jsx';
import { Icon } from './ui.jsx';
import { openFeedback } from './Feedback.jsx';
import { DESKTOP } from '../lib/beta.js';
import { useTripsMenu } from '../screens/TripNow.jsx';
import { menuLabel, tripNowPath } from '../lib/activetrip.js';
import { openPlanner } from './Caddie.jsx';

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
        {Icon.feed(20)}<span>Tell Josh</span>
      </button>
    </nav>
  );
}

/** Trips, with its sub-items (ov21). */
function TripsGroup({ planner }) {
  const menu = useTripsMenu();
  const loc = useLocation();
  const p = loc.pathname;
  // Trips is lit on its own screens; a sub-item is lit when its trip's status page is open (or home shows it).
  const homeTrip = p === '/' && !new URLSearchParams(loc.search).get('r') ? menu.now?.trip.id : null;
  const openTrip = p.startsWith('/trip-now/') ? p.slice('/trip-now/'.length) : homeTrip;
  const tripsLit = !openTrip && (p === '/plan' || p.startsWith('/plan/') || p.startsWith('/trip/') || (p === '/' && menu.ready && !menu.now));
  const sub = (trip, kind) => (
    <Link key={kind} to={tripNowPath(trip)} data-testid={`side-${kind}`}
      className={'side-link side-subitem' + (openTrip === trip.id ? ' active' : '') + (kind === 'on' ? ' side-on' : '')}
      aria-current={openTrip === trip.id ? 'page' : undefined} title={menuLabel(kind, trip)}>
      <span className="ellipsis">{menuLabel(kind, trip)}</span>
    </Link>
  );
  return (
    <div className="side-group" data-testid="side-trips">
      <Link to={planner ? '/plan' : '/'} className={'side-link' + (tripsLit ? ' active' : '')} aria-current={tripsLit ? 'page' : undefined}>
        {Icon.calendar(20)}<span>Trips</span>
      </Link>
      {menu.now && sub(menu.now.trip, menu.now.on ? 'on' : 'next')}
      {menu.next && sub(menu.next, 'next')}
      {!menu.now && menu.ready && (
        <button type="button" className="side-link side-subitem" data-testid="side-plan" onClick={openPlanner}>
          <span>✨ Plan a trip</span>
        </button>
      )}
      {menu.last && sub(menu.last, 'last')}
    </div>
  );
}
