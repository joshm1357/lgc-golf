// The open votes, front and centre on a trip's Overview (ov14, 22 Oct — Josh: "Maybe only having votes in the viewing
// screen would be cleaner"). Everyone sees the ballot here — organisers too (their results are on Organise → Vote).
//   Not answered yet → a big "Vote now" card with the ballot.
//   Answered         → "You've voted ✓ — see results" (tap to see how it's looking and change your answers).
import React, { useState } from 'react';
import { useSession } from '../lib/store.jsx';
import { hasAnsweredAll } from '../lib/callvote.js';
import { useVoteBatches, VoteBatchCard } from './VoteBatchCard.jsx';
import { PollCard } from './PollCard.jsx';

export function OverviewVotes({ pd }) {
  const { status } = useSession();
  const me = status.player_id;
  const [batches] = useVoteBatches(pd.plan.id);
  const open = pd.polls.filter((p) => p.status === 'open');
  // One entry per combined vote card (its polls together), and one per poll that isn't on a card.
  const cards = batches.filter((b) => open.some((p) => p.vote_batch === b.id)).map((b) => {
    const polls = open.filter((p) => p.vote_batch === b.id);
    return { key: b.id, title: b.title, polls, batch: b, done: hasAnsweredAll({ polls, votes: pd.votes, me, keen: b.keen, rsvps: pd.rsvps }) };
  });
  const loose = open.filter((p) => !p.vote_batch)
    .map((p) => ({ key: p.id, title: p.question, polls: [p], poll: p, done: hasAnsweredAll({ polls: [p], votes: pd.votes, me }) }));
  const all = [...cards, ...loose];
  if (!all.length) return null;
  return (
    <section className="stack" style={{ gap: 10 }} data-testid="overview-votes" aria-label="Open votes">
      <span className="label">🗳️ Open {all.length === 1 ? 'vote' : 'votes'}</span>
      {all.map((v) => <OneVote key={v.key} v={v} pd={pd} canVote={!!me} />)}
    </section>
  );
}

function OneVote({ v, pd, canVote }) {
  const [show, setShow] = useState(false);
  // Voting as the page opened: keep the ballot open after the last answer, so "Thanks — here's how it's looking" shows.
  const [voting] = useState(!v.done);
  const body = v.batch ? <VoteBatchCard batch={v.batch} pd={pd} voterOnly /> : <PollCard poll={v.poll} pd={pd} asVoter />;
  if ((voting || !v.done) && canVote) {
    return (
      <div className="ov-vote" data-testid="vote-now">
        <div className="ov-vote-hdr">
          <span className="ov-vote-tag">Vote now</span>
          <strong className="grow">{v.title}</strong>
        </div>
        {body}
      </div>
    );
  }
  return (
    <div className="card" data-testid="voted" style={{ overflow: 'hidden' }}>
      <button type="button" className="row between" aria-expanded={show} onClick={() => setShow(!show)}
        style={{ width: '100%', minHeight: 56, padding: '10px 14px', border: 0, background: '#fff', textAlign: 'left', color: 'inherit', gap: 10 }}>
        <span className="grow"><strong>{v.title}</strong>
          <div className="small muted">{canVote ? (show ? 'Change my votes below — saved as you go' : 'You’ve voted ✓ — see results or change my votes') : 'See how it’s looking'}</div></span>
        <span aria-hidden="true">{show ? '▴' : '▾'}</span>
      </button>
      {show && <div style={{ padding: '0 8px 8px' }}>{body}</div>}
    </div>
  );
}
