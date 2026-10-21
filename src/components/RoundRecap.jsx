// "📝 Round recap" at the bottom of a finished round's leaderboard (Josh, 22 Oct). Every finished round gets one,
// old rounds too: the lines come from the board (lib/roundrecap.js). Plus a share button for the group chat.
// (The fuller version on the next release adds ▶ replay and the AI round report.)
import React from 'react';
import { roundRecap, recapText } from '../lib/roundrecap.js';
import { shareText } from '../lib/push.js';
import { toast } from './ui.jsx';

const finished = (round, board) => round?.status === 'locked' || ((board?.rows || []).length > 0 && board.rows.every((r) => r.finished));

export default function RoundRecap({ round, board, course }) {
  const done = finished(round, board);
  const lines = roundRecap(board, { done, courseName: course?.name || '' });
  if (!done || !lines.length) return null;
  const share = async () => {
    const r = await shareText(recapText(lines, `${round.name}${course?.name && !round.name.includes(course.name) ? ` — ${course.name}` : ''}`));
    if (r === 'copied') toast('Copied — paste it into the group chat');
  };
  return (
    <div className="section" data-testid="round-recap">
      <div className="card pad stack" style={{ gap: 8 }}>
        <strong>📝 Round recap</strong>
        {lines.map((l, i) => (
          <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start', lineHeight: 1.4 }}>
            <span aria-hidden="true">{l.icon}</span><span className="grow">{l.text}</span>
          </div>
        ))}
        <button type="button" className="btn ghost sm" style={{ marginTop: 4 }} onClick={share}>📤 Share the recap</button>
      </div>
    </div>
  );
}
