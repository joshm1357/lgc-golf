// "✨ Ask" — the small way into the AI helper from shared screens (Leaderboard, Trips). Kept apart from
// screens/AiHelper.jsx so the leaderboard (loaded first) stays small. Hidden when the 'ai_helper' feature is off.
//   about: 'round' (the leaderboard: who's leading, what anyone needs) | 'trips' (the Trips tab)
import React from 'react';
import { Link } from 'react-router-dom';
import { useFeature, useSession } from '../lib/store.jsx';

const LABEL = { round: '✨ Ask about this round', trips: '✨ Ask about our trips' };

export function AskChip({ about = 'round', inline = false }) {
  const on = useFeature('ai_helper');
  const { status } = useSession();
  // Guests (quick-round and personal links) don't get the helper; the function refuses them too.
  if (!on || status?.quick || status?.role === 'guest') return null;
  const chip = (
    <Link to={`/ask?about=${about}`} className="chip" data-testid="ask-chip"
      style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'inherit', minHeight: 40 }}>
      {LABEL[about] || '✨ Ask'}
    </Link>
  );
  return inline ? chip : <div style={{ padding: '8px 16px 0' }}>{chip}</div>;
}

export default AskChip;
