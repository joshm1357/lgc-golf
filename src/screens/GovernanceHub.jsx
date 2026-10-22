// Governance (ov19): one place for how the group runs itself, with three tabs across the top —
// Rulebook · Tribunal · Committees — and a short "How we decide things" summary above them.
// Routes: /governance/rulebook, /governance/tribunal, /governance/committees (App.jsx redirects the old /rules,
// /tribunal and /cases into the right tab; deep links to a rule or a case keep their own pages).
import React from 'react';
import { Link, NavLink, Navigate, useParams } from 'react-router-dom';
import { useSession, useFeature } from '../lib/store.jsx';
import { Header, Loading } from '../components/ui.jsx';
import { howWeDecideLine } from '../lib/governance.js';
import { useGovernance } from './Cases.jsx';
import { CommitteesTab } from '../components/Elections.jsx';
import Rulebook from './Rulebook.jsx';
import Tribunal from './Tribunal.jsx';

export const GOV_TABS = [
  { key: 'rulebook', label: 'Rulebook' },
  { key: 'tribunal', label: 'Tribunal' },
  { key: 'committees', label: 'Committees' },
];

function useKindOn() {
  const on = {
    tribunal: useFeature('tribunal'), rule_voting: useFeature('rule_voting'), rule_challenges: useFeature('rule_challenges'),
    other_cases: useFeature('other_cases'), committees: useFeature('committees'),
  };
  return (k) => {
    if (k === 'new_rule') return true; // every group adds rules (with voting off, organisers just add them)
    if (['change_rule', 'scrap_rule', 'ruling'].includes(k)) return on.rule_challenges && on.rule_voting && on.tribunal;
    if (k === 'other') return on.other_cases && on.tribunal;
    if (k === 'election') return on.committees;
    return on.tribunal;
  };
}

export default function GovernanceHub() {
  const { tab } = useParams();
  const { status } = useSession();
  const g = useGovernance();
  const tribunalOn = useFeature('tribunal');
  const committeesOn = useFeature('committees');
  const isOn = useKindOn();
  if (!GOV_TABS.some((t) => t.key === tab)) return <Navigate to="/governance/rulebook" replace />;
  const organiser = status?.role === 'organiser';
  const tabs = GOV_TABS.filter((t) => t.key !== 'committees' || committeesOn || organiser);
  const summary = g?.ok ? howWeDecideLine(g.settings, g.committees, isOn) : '';
  return (
    <div className="page">
      <Header logo title="⚖️ Governance" sub="How the group runs itself: the rules, the cases, and who decides">
        <nav className="seg gov-tabs" aria-label="Governance" style={{ marginTop: 10 }}>
          {tabs.map((t) => (
            <NavLink key={t.key} to={`/governance/${t.key}`} className={({ isActive }) => (isActive ? 'active' : undefined)} data-testid={`gov-tab-${t.key}`}>{t.label}</NavLink>
          ))}
        </nav>
      </Header>
      <div className="section stack" style={{ paddingBottom: 0 }}>
        {summary && (
          <div className="card pad stack" style={{ gap: 6 }} data-testid="how-we-decide">
            <span className="label">How we decide things</span>
            <span style={{ fontSize: 15, lineHeight: 1.4 }}>{summary}</span>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              {tribunalOn && <Link to="/governance/settings" className="small" data-testid="change-how">{organiser ? 'Change how we decide →' : 'The details →'}</Link>}
            </div>
            <details className="small" data-testid="how-groups-work">
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>How groups work</summary>
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                <span>A <strong>group</strong> is your golf group — {status?.group_name || 'this one'}. Everything here (rules, cases, committees) belongs to it, and nobody outside it can see it.</span>
                <span><strong>Members</strong> play, vote and raise cases. <strong>Organisers</strong> are members who also run things: set up trips, change settings and decide what the rules say they decide. <strong>Guests</strong> can watch but don’t vote or raise cases.</span>
                <span>A <strong>committee</strong> is a named set of members who decide certain things for the group — say, a Handicap Committee. Its seats are filled by an election or by an organiser, for a term.</span>
              </div>
            </details>
          </div>
        )}
      </div>
      {tab === 'rulebook' && <Rulebook embedded />}
      {tab === 'tribunal' && (tribunalOn ? <Tribunal embedded /> : <div className="section empty">The Tribunal is switched off for this group.</div>)}
      {tab === 'committees' && (g ? (g.ok ? <CommitteesTab g={g} /> : <div className="section empty">Committees aren’t set up on this database yet.</div>) : <Loading />)}
    </div>
  );
}
