// "Other ways to do this" (O2, Josh's walkthrough 23 Oct): every organiser screen has ONE gold Next step button; the
// other ways to start or commit (by hand, skip the vote, call a vote yourself, a different option) fold away under
// this. Closed until tapped. `open` starts it open (e.g. when there's no Next step on the screen).
import React from 'react';

export default function OtherWays({ children, title = 'Other ways to do this', open = false, testid = 'other-ways' }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  if (!kids.length) return null;
  return (
    <details className="card" data-testid={testid} open={open || undefined} style={{ overflow: 'hidden' }}>
      <summary className="small" style={{ padding: '10px 14px', fontWeight: 700, cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>{title}</summary>
      <div className="stack" style={{ padding: '0 14px 12px', gap: 8 }}>{kids}</div>
    </details>
  );
}
