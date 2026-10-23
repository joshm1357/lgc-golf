// The Rulebook's standard rules and ideas (073). Standard rules come from the app (lib/standardrules.js): a simplified
// rules of golf plus the rules for each format, game and side comp the group plays (or all of them). A standard rule
// the group plays differently links to its own rule. The ideas are local rules the group can propose with one tap —
// they go through the usual vote / case (RuleSheet in screens/Rulebook.jsx).
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useFeature } from '../lib/store.jsx';
import { useRoundGames } from './GamesChip.jsx';
import { useComps } from './CompsChip.jsx';
import { useCustomGames } from './CustomGames.jsx';
import { useBuiltinConditions } from './CompConditions.jsx';
import { useOwnDefs } from '../screens/OwnComps.jsx';
import { inUse, standardSections, overrideCount, freshIdeas, ideaToRule, STANDARD_VERSION } from '../lib/standardrules.js';
import { conditionsLine } from '../lib/conditions.js';
import { customSummary } from '../lib/customgames.js';
import { drivesRule, drivesRoundLine } from '../lib/drives.js';

export function StandardRules({ localRules }) {
  const data = useData();
  const [games] = useRoundGames();
  const [customGames] = useCustomGames();
  const [comps] = useComps();
  const [ownDefs] = useOwnDefs();
  const [builtin] = useBuiltinConditions();
  const sideOn = useFeature('side_comps');
  const [showAll, setShowAll] = useState(false);
  const used = useMemo(() => inUse({ rounds: data.rounds, games, customGames, comps, ownDefs: sideOn ? ownDefs : [] }), [data.rounds, games, customGames, comps, ownDefs, sideOn]);
  const sections = useMemo(() => standardSections({ used, localRules, showAll }), [used, localRules, showAll]);
  const n = overrideCount(sections);
  // What the group adds to a section: its own versions of a game, and its comp conditions.
  const extras = (key) => {
    const out = [];
    for (const c of customGames.filter((x) => !x.retired && x.base_type === key)) out.push({ k: c.id, title: `Our game: ${c.name}`, text: `${customSummary(c)}. House rules: ${c.rules_text}` });
    if ((key === 'ctp' || key === 'ld') && conditionsLine(builtin[key])) out.push({ k: key, title: 'Our conditions', text: conditionsLine(builtin[key]) });
    // 099: the group's own drives numbers and penalty under Ambrose's "How it works".
    if (key === 'ambrose') {
      const dr = drivesRule(localRules || []);
      if (dr?.on) out.push({ k: 'drives', title: 'Our drives rule', text: `${drivesRoundLine({ dr, round: null, teamSizes: [3, 4] })}. On 9 holes, half.` });
    }
    if (key === 'own_comps') for (const d of ownDefs.filter((x) => !x.retired && conditionsLine(x.conditions))) out.push({ k: d.id, title: `${d.emoji || ''} ${d.name}`.trim(), text: conditionsLine(d.conditions) });
    return out;
  };
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="standard-rules">
      <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div>
          <strong style={{ fontSize: 17 }}>📘 Standard rules</strong>
          <div className="small muted">The rules of golf in plain words, and the standard rules for what you play.{n ? ` You play ${n} of them differently — see your local rules below.` : ''}</div>
        </div>
        <button type="button" className="btn ghost sm" onClick={() => setShowAll(!showAll)} aria-pressed={showAll}>{showAll ? 'Just ours' : 'Show all'}</button>
      </div>
      {sections.map((s) => {
        const more = extras(s.key);
        const differs = s.rules.some((r) => r.overriddenBy.length);
        return (
          <details key={s.key} data-testid={`std-${s.key}`}>
            <summary style={{ padding: '10px 0', cursor: 'pointer', fontWeight: 700, minHeight: 44 }}>
              {s.emoji} {s.title}{!s.used ? <span className="small muted"> · not played yet</span> : ''}{differs ? <span className="small"> · ⚠️ we differ</span> : ''}
            </summary>
            <div className="stack" style={{ gap: 8, paddingBottom: 8 }}>
              {s.rules.map((r) => (
                <div key={r.id} className="stack" style={{ gap: 2, borderTop: '1px solid var(--line-soft)', paddingTop: 6 }} data-testid={`std-rule-${r.id}`}>
                  <strong style={{ textDecoration: r.overriddenBy.length ? 'line-through' : 'none', opacity: r.overriddenBy.length ? 0.7 : 1 }}>{r.title}</strong>
                  <div className="small" style={{ lineHeight: 1.45, opacity: r.overriddenBy.length ? 0.7 : 1 }}>{r.text}</div>
                  {r.overriddenBy.map((o) => (
                    <Link key={o.id} to={`/rules/${o.id}`} className="small" style={{ fontWeight: 700 }} data-testid="override-link">⚠️ We play this differently — see our rule: {o.title}</Link>
                  ))}
                </div>
              ))}
              {more.map((m) => (
                <div key={m.k} className="small" style={{ padding: '6px 10px', borderRadius: 10, background: 'var(--gold-soft)' }}><strong>{m.title}:</strong> {m.text}</div>
              ))}
            </div>
          </details>
        );
      })}
      <span className="small muted">Written in our own words — not the official text. Standard rules version {STANDARD_VERSION}.</span>
    </div>
  );
}

/** Ideas for local rules: tap one to propose it (it goes to a vote, or straight in where an organiser decides). */
export function RuleIdeas({ localRules, onPropose }) {
  const ideas = freshIdeas(localRules);
  if (!ideas.length) return null;
  return (
    <details className="card pad" data-testid="rule-ideas">
      <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 32 }}>💡 Ideas to get started ({ideas.length})</summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        <span className="small muted">Local rules plenty of groups play. Tap one to propose it — you can change the wording first.</span>
        {ideas.map((i) => (
          <div key={i.key} className="row" style={{ gap: 8, borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
            <div className="grow"><strong>{i.title}</strong><div className="small muted">{i.detail}</div></div>
            <button type="button" className="btn ghost sm" onClick={() => onPropose(ideaToRule(i))}>Propose</button>
          </div>
        ))}
      </div>
    </details>
  );
}
