import React, { useEffect, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useFeature, useSession } from '../lib/store.jsx';
import { GroupCrest } from './Logo.jsx';
import { Icon } from './ui.jsx';
import { openFeedback } from './Feedback.jsx';
import { DESKTOP } from '../lib/beta.js';

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
    feed: useFeature('feed'), side_comps: useFeature('side_comps'), planner: useFeature('planner'),
    trophies: useFeature('trophies'), tribunal: useFeature('tribunal'), cup: useFeature('cup'),
  };
  const look = status?.look || (status && status.legacy !== false ? { crest_url: 'builtin:lgc' } : null);
  const items = [
    { to: '/', label: 'Leaderboard', icon: Icon.board, end: true },
    on.cup && { to: '/cup', label: 'The Cup', icon: Icon.trophy },
    on.feed && { to: '/feed', label: 'Feed', icon: Icon.feed },
    on.side_comps && { to: '/comps', label: 'Comps', icon: Icon.flag },
    on.planner && { to: '/plan', label: 'Trips', icon: Icon.calendar },
    on.trophies && { to: '/trophies', label: 'Trophy Room', icon: Icon.trophy },
    on.tribunal && { to: '/tribunal', label: 'Tribunal', icon: Icon.gavel },
    { to: '/rules', label: 'Rulebook', icon: Icon.book },
    { to: '/courses', label: 'Courses', icon: Icon.map },
    { to: '/group', label: 'Group & invites', icon: Icon.user },
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
