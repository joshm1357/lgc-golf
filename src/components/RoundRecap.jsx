// "📝 Round recap" at the bottom of a finished round's leaderboard (Josh, 22 Oct). Every finished round gets one,
// old rounds too: the lines come from the board (lib/roundrecap.js). Plus a share button for the group chat.
// (The fuller version on the next release adds ▶ replay and the AI round report.)
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { roundRecap, recapText, recapShare } from '../lib/roundrecap.js';
import { shareText, appLink } from '../lib/push.js';
import { inviteLink } from '../lib/invite.js';
import { toast } from './ui.jsx';

/** The group's player join link, for organisers (only organisers can make one). Null for everyone else. */
function useJoinLink(on) {
  const [link, setLink] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    supabase.rpc('group_invite', { p_role: 'player' })
      .then(({ data }) => { if (live && data) setLink(inviteLink(data)); }, () => {});
    return () => { live = false; };
  }, [on]);
  return link;
}

const finished = (round, board) => round?.status === 'locked' || ((board?.rows || []).length > 0 && board.rows.every((r) => r.finished));

export default function RoundRecap({ round, board, course }) {
  const { status } = useSession();
  const done = finished(round, board);
  const joinLink = useJoinLink(done && !!status?.is_admin && !status?.viewing);
  const lines = roundRecap(board, { done, courseName: course?.name || '' });
  if (!done || !lines.length) return null;
  const share = async () => {
    const title = `${round.name}${course?.name && !round.name.includes(course.name) ? ` — ${course.name}` : ''}`;
    const r = await shareText(recapShare(recapText(lines, title), {
      boardLink: appLink(`/?r=${round.id}`), joinLink, groupName: status?.look?.short_name || status?.group_name || '',
    }));
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
