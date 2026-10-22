// "▶ Friday replay" chips for a trip's finished (locked) rounds, so replays can be found after the leaderboard has
// moved on to the next round: on the Trophy Room (this trip) and on each past trip card (Josh, 21 Oct: "I don't see
// it on the finished rounds"). Hidden when the group has switched the replay off.
import React from 'react';
import { Link } from 'react-router-dom';
import { useFeature } from '../lib/store.jsx';
import { finishedRounds } from '../lib/replay.js';


export function ReplayChips({ rounds = [], title = null, style = null }) {
  const on = useFeature('replay');
  const list = finishedRounds(rounds);
  if (!on || !list.length) return null;
  return (
    <div className="stack" style={{ gap: 6, ...style }}>
      {title && <span className="label">{title}</span>}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {list.map((r) => (
          <Link key={r.id} to={`/replay/${r.id}`} className="btn sm ghost" style={{ gap: 6 }} aria-label={`Watch the ${r.name} replay`}>
            ▶ {r.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
