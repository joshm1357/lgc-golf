// Notifications (More → Notifications, and "Choose what you get" from the turn-on pop-up): is this phone set up,
// how to set it up if not, when you hear about things (straight away / daily digest / only important), and what
// kinds of things you'll get.
import React, { useState } from 'react';
import { Header } from '../components/ui.jsx';
import { NotifyCard, WhenCard } from '../components/NotifyCard.jsx';
import { NotifySteps, WhatYouGet, useMyPushState } from '../components/NotifyPrompt.jsx';
import { previewOf } from '../lib/preview.js';

export default function Notifications() {
  const [state, refresh] = useMyPushState();
  const [done, setDone] = useState(false);
  const [n, setN] = useState(0);
  const viewing = !!previewOf();
  const on = state === 'on';
  return (
    <div className="page">
      <Header back title="Notifications" sub="Buzzes on this phone, and what you get" />
      <div className="section stack" style={{ gap: 12 }}>
        {viewing && <div className="card pad small muted">You’re viewing as someone else — notifications belong to whoever owns this phone.</div>}
        {!viewing && state && !on && (
          <div className="card pad stack" style={{ gap: 10, borderColor: 'var(--gold)', borderWidth: 2 }} data-testid="notify-banner">
            <div className="row between"><strong>🔔 This phone isn’t set up yet</strong></div>
            <NotifySteps state={state} onTurnedOn={() => { setDone(true); refresh(); setN((x) => x + 1); }} />
          </div>
        )}
        {done && on && (
          <div className="card pad" role="status" style={{ borderColor: 'var(--navy)' }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Done ✓</div>
            <div className="small muted">Notifications are on. Now choose what you get below.</div>
          </div>
        )}
        {!viewing && on && <NotifyCard key={n} />}
        {!viewing && !on && state && (
          <div className="card pad stack" style={{ gap: 8 }}>
            <WhenCard />
            <div className="small muted">Saved for you in this group — it applies to every phone you turn notifications on.</div>
          </div>
        )}
        <div className="card pad stack" style={{ gap: 10 }}>
          <strong>What you’ll get</strong>
          <WhatYouGet />
          <div className="small muted">Only for things your group has switched on. “The draw room is open” always comes straight away.</div>
        </div>
      </div>
    </div>
  );
}
