// "▶ Watch the replay" on a finished round's leaderboard (round locked, or everyone through every hole).
// Hidden when the group has switched the replay off.
import React from 'react';
import { Link } from 'react-router-dom';
import { useFeature } from '../lib/store.jsx';
import { isRoundFinished } from '../lib/replay.js';

export default function ReplayButton({ round, board }) {
  const on = useFeature('replay');
  if (!on || !isRoundFinished(round, board)) return null;
  return (
    <div className="section">
      <Link to={`/replay/${round.id}`} className="btn gold" style={{ width: '100%', gap: 8 }}>▶ Watch the replay</Link>
    </div>
  );
}
