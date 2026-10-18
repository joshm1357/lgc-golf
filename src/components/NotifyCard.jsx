// The notifications card (More and Trips): on/off for this phone, and — per group — when you hear about things:
// straight away, one daily digest at a time you pick, or only the important ones. Kept out of the planner so the
// More tab doesn't have to load the whole planner.
import React, { useCallback, useEffect, useState } from 'react';
import { useRun, must } from '../lib/run.js';
import { notify, pushState, enablePush, disablePush, isIOS } from '../lib/push.js';
import { supabase } from '../lib/supabase.js';
import { currentGroup } from '../lib/group.js';

const MODES = [
  ['instant', 'Straight away', 'Each thing as it happens.'],
  ['digest', 'Daily digest', 'One message a day with everything new. The draw room still buzzes straight away.'],
  ['important', 'Only important', 'The draw room, jobs given to you, money owed to you, and your trip tomorrow.'],
];
const hourLabel = (h) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);

export function NotifyCard({ compact }) {
  const [state, setState] = useState(null);
  const [busy, run] = useRun();
  const refresh = useCallback(() => pushState().then(setState), []);
  useEffect(() => { refresh(); }, [refresh]);
  if (!state || (compact && state === 'on')) return null;
  const body = {
    'needs-home-screen': (
      <>
        On iPhone, notifications only work once the app is on your Home Screen (iOS 16.4 or later):
        <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
          <li>In Safari, tap Share <span aria-hidden="true">⎋</span> (the square with the arrow).</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open the app from its new icon and come back to this card.</li>
        </ol>
      </>
    ),
    unsupported: 'This browser can’t do notifications. On Android use Chrome; on iPhone add the app to your Home Screen.',
    blocked: <>Notifications are blocked for this app. Turn them on in your phone’s settings{isIOS() ? ` (Settings → Notifications → ${document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content || 'this app'})` : ' (tap the ⓘ or 🔒 next to the address → Notifications)'}.</>,
    off: 'Get a buzz when a vote opens, a reminder before it closes, when you’re given a job, and a heads-up before each trip.',
    on: 'You’ll get votes, reminders, jobs and trip countdowns on this phone.',
  }[state];
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: state === 'on' ? 'var(--line)' : 'var(--gold)' }}>
      <div className="row between"><strong>🔔 Notifications</strong><span className="small" style={{ fontWeight: 700, color: state === 'on' ? 'var(--navy)' : 'var(--muted)' }}>{state === 'on' ? 'On' : 'Off'}</span></div>
      <div className="small">{body}</div>
      {state === 'off' && <button type="button" className="btn gold" disabled={busy} onClick={() => run(enablePush, 'Notifications on — check for a test buzz').then(refresh)}>Turn on notifications</button>}
      {state === 'on' && !compact && <WhenCard />}
      {state === 'on' && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => { const r = await notify('test'); if (!r.sent) throw new Error('Didn’t reach this phone — try turning it off and on again.'); }, 'Test sent')}>Send a test</button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(disablePush, 'Notifications off').then(refresh)}>Turn off</button>
        </div>
      )}
    </div>
  );
}


/** When you hear about things, for the group this phone is in. Saved per person per group. */
function WhenCard() {
  const [pref, setPref] = useState(null);
  const [busy, run] = useRun();
  const g = currentGroup();
  useEffect(() => {
    if (!g) return;
    supabase.from('notify_prefs').select('mode,digest_hour').maybeSingle()
      .then(({ data, error }) => setPref(error ? null : data || { mode: 'instant', digest_hour: 18 }));
  }, [g]);
  if (!g || !pref) return null;
  const save = (next) => run(async () => {
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney'; } catch { return 'Australia/Sydney'; } })();
    await must(supabase.from('notify_prefs').upsert({ group_id: g, ...next, tz, updated_at: new Date().toISOString() }, { onConflict: 'group_id,user_id' }));
    setPref({ ...pref, ...next });
  }, 'Saved');
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">When you hear about things</span>
      {MODES.map(([m, label, help]) => (
        <button key={m} type="button" className="chip" aria-pressed={pref.mode === m} disabled={busy}
          style={{ textAlign: 'left', whiteSpace: 'normal', minHeight: 48, display: 'block' }} onClick={() => save({ mode: m, digest_hour: pref.digest_hour })}>
          <strong>{pref.mode === m ? '● ' : '○ '}{label}</strong><div className="small muted">{help}</div>
        </button>
      ))}
      {pref.mode === 'digest' && (
        <label className="field"><span>Send my digest at</span>
          <select className="select" value={pref.digest_hour} disabled={busy} onChange={(e) => save({ mode: 'digest', digest_hour: Number(e.target.value) })}>
            {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
