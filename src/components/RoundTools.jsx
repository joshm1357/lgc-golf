// A round's organiser tools (were on the Trip desk until 22 Oct): type in paper cards, show the leaderboard on a big
// screen (Present), print the results and cards. On a laptop they're buttons; on a phone they sit in a ⋯ menu.
// Organisers only, and never while viewing the app as someone else.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../lib/store.jsx';
import { Sheet } from './ui.jsx';
import { TOOL } from '../lib/desk.js';

export function roundTools(roundId) {
  return [
    { key: 'cards', label: '⌨️ Paper cards', to: TOOL.card(roundId), help: 'Type in a pile of scorecards — Tab along the holes.' },
    { key: 'present', label: '📺 Present', to: TOOL.present(roundId), help: 'The leaderboard on a TV or projector, live.' },
    { key: 'print', label: '🖨 Print', to: TOOL.print(roundId), help: 'The results and every card, laid out for paper.' },
  ];
}

export function RoundTools({ round }) {
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  if (!round || !status?.is_admin || status?.viewing || status?.quick) return null;
  const tools = roundTools(round.id);
  return (
    <div className="section round-tools" data-testid="round-tools">
      {tools.map((t) => <Link key={t.key} to={t.to} className="btn ghost sm rt-wide" title={t.help}>{t.label}</Link>)}
      <button type="button" className="btn ghost sm rt-more" aria-label="Round tools" aria-haspopup="dialog" onClick={() => setOpen(true)}>⋯ Round tools</button>
      {open && (
        <Sheet title={round.name} onClose={() => setOpen(false)}>
          <div className="stack">
            {tools.map((t) => (
              <Link key={t.key} to={t.to} className="card pad row" style={{ gap: 12, textDecoration: 'none', color: 'inherit' }} onClick={() => setOpen(false)}>
                <span className="grow"><strong>{t.label}</strong><div className="small muted">{t.help}</div></span>
              </Link>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
