import React, { useState } from 'react';
import { Sheet } from './ui.jsx';
import { GAME_INFO } from '../lib/games.js';
import { helpFor, helpHouseRules, OPT_IN_HELP } from '../lib/gamehelp.js';

/**
 * The ⓘ next to a side game: opens "How it works" — what it is, how you win, a worked example and how the money goes
 * (lib/gamehelp.js). houseRules: a custom game's own twist, shown on top — only when it has some (optional since 098).
 * optIn: an opt-in game (098) — says only those who are in play for the money.
 */
export default function GameHelp({ kind, houseRules = '', optIn = false, label = 'How it works' }) {
  const [open, setOpen] = useState(false);
  const h = helpFor(kind);
  const rules = helpHouseRules(houseRules);
  if (!h) return null;
  const info = GAME_INFO[kind] || {};
  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)} aria-label={`${label}: ${info.name || 'this game'}`}
        data-testid={`game-help-${kind}`} style={{ padding: '2px 10px' }}>ⓘ {label}</button>
      {open && (
        <Sheet title={`${info.emoji || ''} ${info.name || 'How it works'}`} onClose={() => setOpen(false)}>
          <div className="stack" style={{ gap: 12 }} data-testid="game-help-sheet">
            <p style={{ margin: 0, fontSize: 16 }}><strong>{h.what}</strong></p>
            {rules && <div className="small" style={{ whiteSpace: 'pre-wrap' }} data-testid="game-help-house-rules"><strong>Our house rules:</strong> {rules}</div>}
            {optIn && <div className="small" data-testid="game-help-opt-in">{OPT_IN_HELP}</div>}
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">How you win</span>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{h.steps.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">Example</span>
              <div>{h.example}</div>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">The money</span>
              <div>{h.money}</div>
            </div>
            {h.options && <div className="small muted">{h.options}</div>}
            <button type="button" className="btn" onClick={() => setOpen(false)}>Got it</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
