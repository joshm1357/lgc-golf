// The bits every desk screen shares: the tabs across the top, and saving a file (CSV) from the browser.
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useFeature } from '../lib/store.jsx';

/** The tabs across the top of every desk screen. */
export function DeskNav() {
  const planner = useFeature('planner');
  const { pathname } = useLocation();
  const items = [
    planner && { to: '/desk', label: 'Trip desk', on: pathname === '/desk' || pathname.startsWith('/desk/trip') },
    { to: '/desk/players', label: 'Players & handicaps' },
    { to: '/desk/courses', label: 'Course scorecards' },
    { to: '/desk/cards', label: 'Paper cards', on: pathname.startsWith('/desk/card') || pathname.startsWith('/desk/print') },
  ].filter(Boolean);
  return (
    <nav className="desk-nav no-print" aria-label="Desk">
      {items.map((t) => {
        const on = t.on ?? pathname === t.to;
        return <Link key={t.to} to={t.to} className={'desk-nav-link' + (on ? ' active' : '')} aria-current={on ? 'page' : undefined}>{t.label}</Link>;
      })}
      <span className="grow" />
      <span className="small desk-hint">Press <kbd>?</kbd> for shortcuts</span>
    </nav>
  );
}

/** Save text as a file (e.g. the costs CSV). The BOM at the front makes Excel read $ signs and dashes right. */
export function download(name, text, type = 'text/csv') {
  const blob = new Blob([`﻿${text}`], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
