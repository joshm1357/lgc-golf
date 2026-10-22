// The bits the laptop tools share (the players table, pasting a scorecard, paper cards, printing): the bar across the
// top that leads back to where each tool lives now, and saving a file (CSV) from the browser.
// (Until 22 Oct these were tabs of the Trip desk; the desk folded into Trips, Group & invites, Courses and the rounds.)
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../lib/store.jsx';
import { TOOL, toolHome } from '../lib/desk.js';
import './desk.css';

/** The bar across the top of a laptop tool: back to its home, and the shortcuts hint. */
export function DeskNav() {
  const { pathname } = useLocation();
  const { status } = useSession();
  const home = toolHome(pathname);
  if (pathname === TOOL.players && status?.is_admin) return <GroupTabs />;
  return (
    <nav className="desk-nav no-print" aria-label="Back">
      <Link to={home.to} className="desk-nav-link">‹ {home.label}</Link>
      <span className="grow" />
      <span className="small desk-hint">Press <kbd>?</kbd> for shortcuts</span>
    </nav>
  );
}

/** Group & invites | Players table — the two halves of the group, for organisers (tabs on a laptop, a bar on a phone). */
export function GroupTabs({ deskOnly = false }) {
  const { pathname } = useLocation();
  const { status } = useSession();
  if (!status?.is_admin) return null;
  const items = [{ to: '/group', label: 'Players & group' }, { to: TOOL.players, label: 'Players table' }];
  return (
    <nav className={'desk-nav group-tabs no-print' + (deskOnly ? ' desk-only' : '')} aria-label="Group">
      {items.map((t) => {
        const on = pathname === t.to;
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
