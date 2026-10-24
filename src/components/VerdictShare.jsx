import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, playerName } from '../lib/store.jsx';
import SharePicture from './SharePicture.jsx';

// ov38: "📤 Share the verdict" — a handicap verdict as a picture for the group chat, on the case page and (one tap)
// on its Feed post. Its own small file so the Feed doesn't load the Tribunal screen.

/** The verdict as a picture for the group chat (ov38: "📤 Share the verdict" — here and on the Feed post). */
export function VerdictSharePicture({ c, accused, className }) {
  return (
    <SharePicture label="📤 Share the verdict" kind="verdict" className={className}
      data={{ accused: playerName(accused), verdict: c.verdict, oldHcp: c.old_handicap != null ? Number(c.old_handicap) : null, newHcp: c.new_handicap != null ? Number(c.new_handicap) : null,
        votes: `${c.guilty_votes ?? 0}–${c.not_guilty_votes ?? 0}`, overruled: c.overruled }}
      text={`⚖️ The Handicap Tribunal: ${playerName(accused)} — ${c.verdict === 'upheld' ? 'GUILTY' : 'NOT GUILTY'}`} />
  );
}

/** On a Feed verdict post: one tap to share it (ov38). Loads its case; nothing until it's closed. */
export function FeedVerdictShare({ caseId }) {
  const data = useData();
  const [c, setC] = useState(null);
  useEffect(() => {
    let live = true;
    supabase.from('tribunal_cases').select('id,accused_id,status,verdict,old_handicap,new_handicap,guilty_votes,not_guilty_votes,overruled')
      .eq('id', caseId).limit(1).then(({ data: rows }) => { if (live) setC(rows?.[0] || null); });
    return () => { live = false; };
  }, [caseId]);
  if (!c || c.status !== 'closed' || !c.verdict) return null;
  return <VerdictSharePicture c={c} accused={data.playersById[c.accused_id]} className="btn ghost sm" />;
}

