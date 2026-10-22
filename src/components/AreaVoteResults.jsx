// The start vote's results in the trip builder (ov23): the area winner and, inside each area, how its courses and
// places to stay ranked (and how many went into the detail); how long; and the weekends ranked — the top one is the
// PRIMARY weekend, the next the BACKUP. "Choose this one" picks the area with its favourites ticked for step 2 and
// sets the primary and backup weekends. The maths is in lib/areavote.js and lib/weekends.js.
import React from 'react';
import * as TB from '../lib/tripbuilder.js';
import { areaVoteResults } from '../lib/areavote.js';
import { rankWeekends, weekendRole, lengthLabel, leadingNights } from '../lib/weekends.js';

export default function AreaVoteResults({ st, points, detail = {}, courseMap = {}, org, onChoose, onSettle }) {
  const areas = st.region ? [] : areaVoteResults(st, points, { courseMap, detail });
  const pool = st.weekendPool?.length ? st.weekendPool : (st.weekends || []);
  const wk = rankWeekends(pool, points);
  const lengthOn = !!st.lengthVote?.on;
  const nights = lengthOn ? leadingNights(points, st.nights) : st.nights;
  const anyVotes = Object.values(points).some((n) => n > 0);
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--navy)', borderWidth: 2 }} data-testid="vote-results">
      <strong>📊 How the vote’s going</strong>
      {!anyVotes && <span className="small muted">No votes in yet.</span>}
      {areas.map((r, i) => (
        <div key={r.area} className="stack" style={{ gap: 2, borderTop: i ? '1px solid var(--line-soft)' : 0, paddingTop: i ? 6 : 0 }} data-testid="result-area" data-area={r.area}>
          <div className="row between" style={{ gap: 8 }}>
            <span><strong>📍 {r.area}</strong>{r.leading && <span className="small" style={{ marginLeft: 6, color: '#7A5A00', fontWeight: 800 }}>LEADING</span>}</span>
            <span className="small">{r.points} pts</span>
          </div>
          <span className="small muted" data-testid="result-detail">{r.detail} went into the detail</span>
          {r.courses.length > 0 && <span className="small">⛳ {r.courses.slice(0, 4).map((c) => `${c.name}${c.points ? ` (${c.points})` : ''}`).join(', ')}</span>}
          {r.stays.length > 0 && <span className="small">🏠 {r.stays.slice(0, 3).map((s) => `${s.name}${s.points ? ` (${s.points})` : ''}`).join(', ')}</span>}
          {org && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => onChoose(r.area, nights)} data-testid="choose-voted-area">Choose this one</button>}
        </div>
      ))}
      {lengthOn && <div className="small" data-testid="result-length">🛏️ How long: <strong>{lengthLabel(nights)}</strong> is leading</div>}
      {wk.length > 0 && (
        <div className="stack" style={{ gap: 2 }} data-testid="result-weekends">
          <span className="small" style={{ fontWeight: 700 }}>📅 Weekends, best first</span>
          {wk.slice(0, 4).map((w, i) => (
            <span key={w.start} className="small">{i < 2 ? <strong>{weekendRole(i)}: </strong> : `${i + 1}. `}{TB.weekendLabel({ start: w.start, end: w.end })} · {w.points} pts</span>
          ))}
          {org && st.region && !st.weekendsSettled && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => onSettle(nights)} data-testid="set-primary-backup">Set the primary and backup weekends</button>}
        </div>
      )}
    </div>
  );
}
