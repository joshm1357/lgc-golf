// The notifications on/off card (More and Coming up). Kept out of the planner so the More tab
// doesn't have to load the whole planner.
import React, { useCallback, useEffect, useState } from 'react';
import { useRun } from '../lib/run.js';
import { notify, pushState, enablePush, disablePush, isIOS } from '../lib/push.js';

export function NotifyCard({ compact }) {
  const [state, setState] = useState(null);
  const [busy, run] = useRun();
  const refresh = useCallback(() => pushState().then(setState), []);
  useEffect(() => { refresh(); }, [refresh]);
  if (!state || (compact && state === 'on')) return null;
  const body = {
    'needs-home-screen': <>On iPhone, notifications only work from the Home Screen app: tap Share <span aria-hidden="true">⎋</span> → <strong>Add to Home Screen</strong>, open L.G.C from there, then come back here.</>,
    unsupported: 'This browser can’t do notifications. On Android use Chrome; on iPhone add the app to your Home Screen.',
    blocked: <>Notifications are blocked for this app. Turn them on in your phone’s settings{isIOS() ? ' (Settings → Notifications → L.G.C)' : ' (tap the ⓘ or 🔒 next to the address → Notifications)'}.</>,
    off: 'Get a buzz when a vote opens, a reminder before it closes, when you’re given a job, and a heads-up before each trip.',
    on: 'You’ll get votes, reminders, jobs and trip countdowns on this phone.',
  }[state];
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: state === 'on' ? 'var(--line)' : 'var(--gold)' }}>
      <div className="row between"><strong>🔔 Notifications</strong><span className="small" style={{ fontWeight: 700, color: state === 'on' ? 'var(--navy)' : 'var(--muted)' }}>{state === 'on' ? 'On' : 'Off'}</span></div>
      <div className="small">{body}</div>
      {state === 'off' && <button type="button" className="btn gold" disabled={busy} onClick={() => run(enablePush, 'Notifications on — check for a test buzz').then(refresh)}>Turn on notifications</button>}
      {state === 'on' && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => { const r = await notify('test'); if (!r.sent) throw new Error('Didn’t reach this phone — try turning it off and on again.'); }, 'Test sent')}>Send a test</button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(disablePush, 'Notifications off').then(refresh)}>Turn off</button>
        </div>
      )}
    </div>
  );
}

