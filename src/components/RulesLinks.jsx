// Rulebook v3: the small links into "the rules for this round / this comp". Kept apart from RuleLayers.jsx so the
// leaderboard and comp / game screens stay small.
import React from 'react';
import { Link } from 'react-router-dom';

/** Leaderboard: "📘 Rules for today" (the rules that apply to this round, overrides worked out). */
export function RulesTodayChip({ round }) {
  if (!round) return null;
  return (
    <div className="chips" style={{ paddingTop: 4 }}>
      <Link to={`/rules?round=${round.id}`} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'inherit' }} data-testid="rules-today">📘 Rules for today</Link>
    </div>
  );
}

/** A comp or game card: its rules and the layers it inherits. value: 'comp:<id>', 'game:skins', 'custom_game:<id>'. */
export function RulesLink({ value, label = '📘 Its rules' }) {
  if (!value || /^comp:trophy-/.test(value)) return null;
  return <Link to={`/rules?f=${encodeURIComponent(value)}`} className="btn ghost sm" style={{ textDecoration: 'none' }} data-testid="rules-link">{label}</Link>;
}
