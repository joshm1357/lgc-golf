// The start vote's results in the trip builder (ov23): the area winner and, inside each area, how its courses and
// places to stay ranked (and how many went into the detail); how long; and the weekends ranked — the top one is the
// PRIMARY weekend, the next the BACKUP. The maths is in lib/areavote.js and lib/weekends.js.
// Walkthrough fixes (23 Oct):
//   * O2 — one gold button: "Go with <the leader>". Choosing another area is under "Other ways to do this".
//   * V4 — the detail says plainly when too few went into it: "Only 1 of 10 picked courses and places — not enough to
//     go by. You choose." Under a third, the courses and places are shown "for info".
//   * V2 — when "How long?" was on the ballot: "3 nights won, so it's Fri 22 – Mon 25 Jan. 2 people only said yes to a
//     shorter trip — check with them" (with their names).
import React from 'react';
import * as TB from '../lib/tripbuilder.js';
import { areaVoteResults } from '../lib/areavote.js';
import { rankWeekends, weekendRole, lengthLabel, leadingNights } from '../lib/weekends.js';
import { detailVerdict, namesList } from '../lib/callvote.js';
import OtherWays from './OtherWays.jsx';

export default function AreaVoteResults({ st, points, detail = {}, courseMap = {}, org, onChoose, onSettle, voters = 0, lengthNote = null, checkNames = [] }) {
  const areas = st.region ? [] : areaVoteResults(st, points, { courseMap, detail });
  const pool = st.weekendPool?.length ? st.weekendPool : (st.weekends || []);
  const wk = rankWeekends(pool, points);
  const lengthOn = !!st.lengthVote?.on;
  const nights = lengthOn ? leadingNights(points, st.nights) : st.nights;
  const anyVotes = Object.values(points).some((n) => n > 0);
  const leader = areas[0] && areas[0].points > 0 ? areas[0] : null;
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--navy)', borderWidth: 2 }} data-testid="vote-results">
      <strong>📊 How the vote’s going</strong>
      {!anyVotes && <span className="small muted">No votes in yet.</span>}
      {areas.map((r, i) => {
        const v = detailVerdict(r.detail, voters);
        return (
          <div key={r.area} className="stack" style={{ gap: 2, borderTop: i ? '1px solid var(--line-soft)' : 0, paddingTop: i ? 6 : 0 }} data-testid="result-area" data-area={r.area}>
            <div className="row between" style={{ gap: 8 }}>
              <span><strong>📍 {r.area}</strong>{r.leading && <span className="small" style={{ marginLeft: 6, color: '#7A5A00', fontWeight: 800 }}>LEADING</span>}</span>
              <span className="small">{r.points} pts</span>
            </div>
            <span className="small" style={{ fontWeight: v.forInfo ? 700 : 400, color: v.forInfo ? '#7A5A00' : 'var(--muted)' }} data-testid="result-detail">{v.line}</span>
            <div className={v.forInfo ? 'small muted' : 'small'} data-testid={v.forInfo ? 'result-for-info' : 'result-detail-list'}>
              {v.forInfo && (r.courses.length > 0 || r.stays.length > 0) && <span style={{ fontWeight: 700 }}>For info: </span>}
              {r.courses.length > 0 && <span>⛳ {r.courses.slice(0, 4).map((c) => `${c.name}${c.points ? ` (${c.points})` : ''}`).join(', ')} </span>}
              {r.stays.length > 0 && <span>🏠 {r.stays.slice(0, 3).map((s) => `${s.name}${s.points ? ` (${s.points})` : ''}`).join(', ')}</span>}
            </div>
            {org && leader && r.area === leader.area && (
              <button type="button" className="btn gold block" style={{ marginTop: 6 }} onClick={() => onChoose(r.area, nights)} data-testid="choose-voted-area">Go with {r.area}</button>
            )}
          </div>
        );
      })}
      {org && areas.length > 1 && (
        <OtherWays title="Other ways to do this: choose another area">
          {areas.filter((r) => r.area !== leader?.area).map((r) => (
            <button key={r.area} type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChoose(r.area, nights)} data-testid="choose-other-area" data-area={r.area}>Choose {r.area} instead</button>
          ))}
        </OtherWays>
      )}
      {lengthOn && <div className="small" data-testid="result-length">🛏️ How long: <strong>{lengthLabel(nights)}</strong> is leading</div>}
      {lengthNote && (
        <div className="small" style={{ fontWeight: 700, color: checkNames.length ? '#7A5A00' : 'inherit' }} data-testid="length-check">
          {lengthNote}{checkNames.length ? ` (${namesList(checkNames)})` : ''}
        </div>
      )}
      {wk.length > 0 && (
        <div className="stack" style={{ gap: 2 }} data-testid="result-weekends">
          <span className="small" style={{ fontWeight: 700 }}>📅 Weekends, best first</span>
          {wk.slice(0, 4).map((w, i) => (
            <span key={w.start} className="small">{i < 2 ? <strong>{weekendRole(i)}: </strong> : `${i + 1}. `}{TB.weekendLabel({ start: w.start, end: w.end })} · {w.points} pts</span>
          ))}
          {org && st.region && !st.weekendsSettled && <button type="button" className="btn gold block" style={{ marginTop: 4 }} onClick={() => onSettle(nights)} data-testid="set-primary-backup">Set the primary and backup weekends</button>}
        </div>
      )}
    </div>
  );
}
