// "📝 Round recap" at the bottom of a finished round's leaderboard (Josh, 22 Oct). Every finished round gets one,
// old rounds too: the lines come from the board (lib/roundrecap.js). When live commentary has written the round
// report (071), it sits on top. Then ▶ Watch the replay and a share button.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useFeature } from '../lib/store.jsx';
import { isRoundFinished } from '../lib/replay.js';
import { roundRecap, recapText } from '../lib/roundrecap.js';
import { shareText } from '../lib/push.js';
import { toast } from './ui.jsx';

function useRoundReport(roundId, on) {
  const [line, setLine] = useState(null);
  useEffect(() => {
    if (!roundId || !on) return undefined;
    let live = true;
    supabase.from('commentary').select('line,status').eq('key', `report:${roundId}`).eq('status', 'ready').maybeSingle()
      .then(({ data }) => { if (live) setLine(data?.line || null); }, () => {});
    return () => { live = false; };
  }, [roundId, on]);
  return line;
}

export default function RoundRecap({ round, board, course }) {
  const replayOn = useFeature('replay');
  const commentaryOn = useFeature('commentary');
  const done = isRoundFinished(round, board);
  const report = useRoundReport(done ? round.id : null, commentaryOn);
  const lines = roundRecap(board, { done, courseName: course?.name || '' });
  if (!done || (!lines.length && !report)) return null;
  const share = async () => {
    const text = `${report ? `🎙️ ${report}\n\n` : ''}${recapText(lines, `${round.name}${course?.name && !round.name.includes(course.name) ? ` — ${course.name}` : ''}`)}`;
    const r = await shareText(text);
    if (r === 'copied') toast('Copied — paste it into the group chat');
  };
  return (
    <div className="section" data-testid="round-recap">
      <div className="card pad stack" style={{ gap: 8 }}>
        <strong>📝 Round recap</strong>
        {report && <p style={{ margin: 0, lineHeight: 1.45, fontStyle: 'italic' }}>🎙️ {report}</p>}
        {lines.map((l, i) => (
          <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start', lineHeight: 1.4 }}>
            <span aria-hidden="true">{l.icon}</span><span className="grow">{l.text}</span>
          </div>
        ))}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {replayOn && <Link to={`/replay/${round.id}`} className="btn gold sm grow" style={{ gap: 6, whiteSpace: 'nowrap' }}>▶ Watch the replay</Link>}
          <button type="button" className="btn ghost sm grow" onClick={share}>📤 Share the recap</button>
        </div>
      </div>
    </div>
  );
}
