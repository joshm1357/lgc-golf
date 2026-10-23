// 📅 When? and 📍 Where? — two vote cards in the trip builder (ov35, Josh 23 Oct: "the dates should be reasonably
// independent of location … They are two separate."). Each card says plainly where it's up to — Not called yet /
// Out now — 4 of 9 voted, closes Thu / Closed — Hunter Valley won 5–2 — and its buttons say what they do ("Close the
// vote and go with …" closes it AND posts the result). Call either first, or both in one message.
// The maths is in lib/votecards.js; the screen that owns the state is screens/TripBuilder.jsx.
import React from 'react';
import { Link } from 'react-router-dom';
import { areaVoteResults } from '../lib/areavote.js';
import { rankWeekends, lengthLabel } from '../lib/weekends.js';
import { detailVerdict, namesList } from '../lib/callvote.js';
import { PART_LOOK, cardStatus, closeButton, whenLabel } from '../lib/votecards.js';
import OtherWays from './OtherWays.jsx';

const PILL = {
  none: { bg: 'var(--line-soft)', fg: 'var(--text)' },
  out: { bg: 'var(--gold-soft)', fg: '#7A5A00' },
  closed: { bg: 'var(--navy)', fg: '#fff' },
  decided: { bg: 'var(--navy)', fg: '#fff' },
};

function StatusLine({ s }) {
  const c = PILL[s.state] || PILL.none;
  return (
    <span className="small" data-testid="vote-status" data-state={s.state}
      style={{ background: c.bg, color: c.fg, borderRadius: 999, padding: '3px 10px', fontWeight: 800, alignSelf: 'flex-start' }}>
      {s.state === 'out' ? '🗳️ ' : s.state === 'none' ? '' : '✓ '}{s.line}
    </span>
  );
}

/**
 * props: st, pd (plan data), points, org, busy, of (how many can vote), today, courseMap, detail, voters,
 *   choices ({ when, where, both } from callChoices), votedNights, lengthNote, checkNames,
 *   onCall(part | 'both'), onCloseWhen(start | null, nights), onCloseWhere(area), onSkipWhen(), planId
 */
export default function WhenWhere(props) {
  const { choices, org, busy, onCall } = props;
  return (
    <div className="stack" style={{ gap: 10 }} data-testid="when-where">
      {org && choices.both && (
        <div className="stack" style={{ gap: 4 }}>
          <button type="button" className="btn gold block" disabled={busy} onClick={() => onCall('both')} data-testid="call-both">🗳️ Call both votes — one message to the group</button>
          <span className="small muted">Or call just one below. The dates don’t depend on the place: each vote closes on its own.</span>
        </div>
      )}
      <WhenCard {...props} />
      <WhereCard {...props} />
    </div>
  );
}

function Card({ part, status, children }) {
  const look = PART_LOOK[part];
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: status.state === 'out' ? 'var(--gold)' : 'var(--navy)', borderWidth: 2 }} data-testid={`vote-card-${part}`}>
      <div className="row between" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 17 }}>{look.icon} {look.title}</strong>
        <StatusLine s={status} />
      </div>
      {children}
    </div>
  );
}

function SeeVotes({ planId }) {
  return <Link to={`/plan/${planId}?tab=vote`} className="small" style={{ color: 'var(--navy)', fontWeight: 700 }} data-testid="see-votes">See who’s voted, or share the vote →</Link>;
}

function WhenCard({ st, pd, points, org, busy, of, today, choices, votedNights, lengthNote, checkNames = [], onCall, onCloseWhen, onSkipWhen, planId }) {
  const settled = st.weekendsSettled && st.weekends.length > 0;
  const status = cardStatus('when', { st, polls: pd.polls, options: pd.options, votes: pd.votes, of, today, decided: settled ? whenLabel(st.weekends[0]) : null });
  const pool = st.weekendPool?.length ? st.weekendPool : (st.weekends || []);
  const ranked = rankWeekends(pool, points);
  const leader = ranked[0] && ranked[0].points > 0 ? ranked[0] : null;
  const open = status.state === 'out';
  const lengthOn = !!st.lengthVote?.on;
  return (
    <Card part="when" status={status}>
      {status.state === 'none' && !settled && (
        <>
          {choices.when && org && (
            <button type="button" className={`btn ${choices.both ? 'ghost' : 'gold'} block`} disabled={busy} onClick={() => onCall('when')} data-testid="call-when">
              🗳️ {choices.both ? 'Call just the When? vote' : 'Call the When? vote'}</button>
          )}
          {choices.when && <span className="small muted">{pool.length} weekend{pool.length === 1 ? '' : 's'}{lengthOn ? ' and how long' : ''} — nothing about where.</span>}
          {!choices.when && pool.length === 1 && (
            <>
              <span className="small muted">One weekend on the shortlist — no vote needed.</span>
              {org && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={onSkipWhen} data-testid="settle-weekends">This is the weekend: {whenLabel(pool[0])}</button>}
            </>
          )}
          {!pool.length && <span className="small muted">Pick some weekends below first.</span>}
          {org && choices.when && pool.length > 1 && (
            <OtherWays title="Other ways: skip the vote">
              <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={onSkipWhen} data-testid="skip-when">Skip the vote: go with {whenLabel(pool[0])} (the next is the fallback)</button>
            </OtherWays>
          )}
        </>
      )}
      {(status.state === 'out' || (status.state === 'closed' && !settled)) && (
        <>
          <div className="stack" style={{ gap: 2 }} data-testid="result-weekends">
            {ranked.slice(0, 4).map((w, i) => (
              <span key={w.start} className="small">{i + 1}. {whenLabel(w)} · {w.points} pts{i === 0 && w.points > 0 ? <strong style={{ marginLeft: 6, color: '#7A5A00' }}>LEADING</strong> : null}</span>
            ))}
            {lengthOn && <span className="small" data-testid="result-length">🛏️ How long: <strong>{lengthLabel(votedNights)}</strong> is leading</span>}
            {lengthNote && <span className="small" style={{ fontWeight: 700, color: checkNames.length ? '#7A5A00' : 'inherit' }} data-testid="length-check">{lengthNote}{checkNames.length ? ` (${namesList(checkNames)})` : ''}</span>}
          </div>
          {org && leader && (
            <>
              <button type="button" className="btn gold block" disabled={busy} onClick={() => onCloseWhen(null, votedNights)} data-testid="close-when">{closeButton('when', whenLabel(leader), { open })}</button>
              <span className="small muted">{open ? 'This closes the When? vote now and posts the result in the Feed. ' : ''}{ranked[1] ? `If the courses can’t fit you, ${whenLabel(ranked[1])} is tried next.` : ''}</span>
            </>
          )}
          {org && !leader && open && <span className="small muted">No votes yet — wait for a few, or pick one below.</span>}
          {org && ranked.length > 1 && (
            <OtherWays title={open ? 'Other ways: close it with a different weekend' : 'Other ways: a different weekend'}>
              {ranked.filter((w) => w !== leader).slice(0, 5).map((w) => (
                <button key={w.start} type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => onCloseWhen(w.from || w.start, votedNights)} data-testid="close-when-other">
                  {open ? `Close the vote and go with ${whenLabel(w)}` : `Go with ${whenLabel(w)}`}</button>
              ))}
            </OtherWays>
          )}
        </>
      )}
      {settled && <span className="small">📅 <strong>{whenLabel(st.weekends[0])}</strong>{st.weekends[1] ? ` · if the courses can’t fit you: ${whenLabel(st.weekends[1])}` : ''}</span>}
      {status.state !== 'none' && <SeeVotes planId={planId} />}
    </Card>
  );
}

function WhereCard({ st, pd, points, org, busy, of, today, choices, courseMap, detail, voters, onCall, onCloseWhere, planId }) {
  const status = cardStatus('where', { st, polls: pd.polls, options: pd.options, votes: pd.votes, of, today, decided: st.region || null });
  const rows = st.region ? [] : areaVoteResults(st, points, { courseMap, detail });
  const leader = rows[0] && rows[0].points > 0 ? rows[0] : null;
  const open = status.state === 'out';
  const areas = st.region ? [st.region] : (st.regionOptions || []);
  return (
    <Card part="where" status={status}>
      {!st.region && status.state === 'none' && (
        <>
          {choices.where && org && areas.length > 1 && (
            <button type="button" className={`btn ${choices.both ? 'ghost' : 'gold'} block`} disabled={busy} onClick={() => onCall('where')} data-testid="call-where">
              🗳️ {choices.both ? 'Call just the Where? vote' : 'Call the Where? vote'}</button>
          )}
          <span className="small muted">{areas.length > 1 ? `${areas.join(' or ')} — nothing about dates. You choose how deep on the next screen.` : areas.length ? `Just ${areas[0]} so far — add another area to vote on, or choose it.` : 'Add the areas you’re thinking about above.'}</span>
        </>
      )}
      {!st.region && status.state !== 'none' && (
        <>
          {rows.map((r) => {
            const v = detailVerdict(r.detail, voters);
            return (
              <div key={r.area} className="stack" style={{ gap: 2 }} data-testid="result-area" data-area={r.area}>
                <div className="row between" style={{ gap: 8 }}>
                  <span><strong>📍 {r.area}</strong>{r.leading && <span className="small" style={{ marginLeft: 6, color: '#7A5A00', fontWeight: 800 }}>LEADING</span>}</span>
                  <span className="small">{r.points} pts</span>
                </div>
                {(r.courses.length > 0 || r.stays.length > 0) && <span className="small muted" data-testid="result-detail">{v.line}</span>}
              </div>
            );
          })}
          {org && leader && (
            <>
              <button type="button" className="btn gold block" disabled={busy} onClick={() => onCloseWhere(leader.area)} data-testid="close-where">{closeButton('where', leader.area, { open })}</button>
              {open && <span className="small muted">This closes the Where? vote now and posts the result in the Feed. The weekend isn’t touched.</span>}
            </>
          )}
          {org && !leader && open && <span className="small muted">No votes yet — wait for a few, or pick one below.</span>}
          {org && rows.length > 1 && (
            <OtherWays title={open ? 'Other ways: close it with a different area' : 'Other ways: a different area'}>
              {rows.filter((r) => r !== leader).map((r) => (
                <button key={r.area} type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => onCloseWhere(r.area)} data-testid="close-where-other" data-area={r.area}>
                  {open ? `Close the vote and go with ${r.area}` : `Go with ${r.area}`}</button>
              ))}
            </OtherWays>
          )}
        </>
      )}
      {st.region && (
        <>
          <span className="small">📍 Going to <strong>{st.region}</strong></span>
          {org && choices.where && status.state !== 'out' && (
            <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => onCall('where')} data-testid="call-where-detail">🗳️ Ask the group: courses and where to stay</button>
          )}
        </>
      )}
      {status.state !== 'none' && <SeeVotes planId={planId} />}
    </Card>
  );
}

