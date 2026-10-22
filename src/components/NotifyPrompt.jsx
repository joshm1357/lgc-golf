// "Turn on notifications" help (21 Oct 2026, Josh: "When people log in and don't have notifications on, put a
// pop-up and how to set it up. Then direct to the settings of what notifications are.")
//
//   - NotifyPrompt: a sheet shown once after someone is in their group, then at most once a week while this phone
//     still isn't set up. What they'll get, the right steps for this phone, a big "Turn on" button, then "Choose what
//     you get" → the notifications screen. Rendered once in App.jsx.
//   - NotifySteps: the steps + "Turn on" button, shared by the sheet and the notifications screen's banner.
//   - notifyItem(): the "Notifications" row for More.
// The rules (which phone, which steps, when to ask) are in lib/notifyhelp.js.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useData, useFeature, useSession } from '../lib/store.jsx';
import { previewOf } from '../lib/preview.js';
import { myPushState, enablePush } from '../lib/push.js';
import { useRun } from '../lib/run.js';
import { readPhone, setupPlan, shouldPrompt, promptLastShown, markPromptShown, whatYouGet } from '../lib/notifyhelp.js';
import { Sheet } from './ui.jsx';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
export const BellIcon = (s = 22) => (
  <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>
);

/** The row in More. */
export function notifyItem() {
  return { to: '/notifications', icon: BellIcon, label: 'Notifications', sub: 'Turn them on, and choose what you get' };
}

/** The name iPhones show in Settings → Notifications (what the app is called on the Home Screen). */
export function appName() {
  try { return document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content || 'The Golf Trip'; } catch { return 'The Golf Trip'; }
}

/** This phone's notification state for me: null while checking, then 'on' | 'off' | 'blocked' | … */
export function useMyPushState() {
  const [state, setState] = useState(null);
  const refresh = useCallback(() => myPushState().then(setState, () => setState('unsupported')), []);
  useEffect(() => { refresh(); }, [refresh]);
  return [state, refresh];
}

/** What you'll get, as a short list. */
export function WhatYouGet({ limit }) {
  const data = useData();
  const items = whatYouGet(data?.features || {});
  return (
    <ul className="stack" style={{ gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
      {items.slice(0, limit || items.length).map((it) => (
        <li key={it.text} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span aria-hidden="true" style={{ fontSize: 18, lineHeight: '22px', width: 22, textAlign: 'center' }}>{it.icon}</span>
          <span className="small" style={{ lineHeight: '22px' }}>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The right steps for this phone, and the "Turn on" button when one tap will do it. */
export function NotifySteps({ state, onTurnedOn }) {
  const [busy, run] = useRun();
  const plan = setupPlan(readPhone(), state, appName());
  if (plan.step === 'on') return null;
  const turnOn = () => run(async () => { await enablePush(); return true; }).then((ok) => ok && onTurnedOn?.());
  return (
    <div className="stack" style={{ gap: 10 }} data-step={plan.step}>
      <div>
        <div style={{ fontWeight: 700 }}>{plan.title}</div>
        <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 20, lineHeight: 1.5 }}>
          {plan.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
        {plan.note && <div className="small muted" style={{ marginTop: 6 }}>{plan.note}</div>}
      </div>
      {plan.canTurnOn && (
        <button type="button" className="btn gold block" style={{ minHeight: 52, fontSize: 17 }} disabled={busy} onClick={turnOn}>
          {busy ? 'Turning on…' : plan.button || 'Turn on notifications'}
        </button>
      )}
    </div>
  );
}

/** The pop-up. Asks once, then at most once a week, until this phone is set up. */
export function NotifyPrompt() {
  const { status } = useSession();
  const data = useData();
  const on = useFeature('notifications');
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [done, setDone] = useState(false);
  const [tick, setTick] = useState(0); // retries while another sheet is open
  const decided = useRef(false); // asked already this visit, or nothing to ask
  const viewing = !!(status?.viewing || previewOf());
  const offline = !!data?.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
  const skip = !on || viewing || !!status?.quick || offline;

  useEffect(() => {
    if (decided.current || open || skip) return undefined;
    let live = true;
    // A moment after the group opens: the features have loaded and the first screen is drawn.
    const t = setTimeout(async () => {
      const s = await myPushState().catch(() => 'unsupported');
      if (!live || decided.current) return;
      const plan = setupPlan(readPhone(), s, appName());
      if (plan.step === 'on' || plan.step === 'unsupported' || plan.step === 'update-ios' || plan.step === 'open-in-browser') { decided.current = true; return; }
      const ask = { notificationsOn: true, step: plan.step, viewing, quick: !!status?.quick, offline, lastShown: promptLastShown() };
      // Shown in the last week: done for this visit.
      if (!shouldPrompt({ ...ask, path: '/' })) { decided.current = true; return; }
      // Entering scores, joining…: try again on the next screen.
      const path = window.location.hash.replace(/^#/, '').split('?')[0] || '/';
      if (!shouldPrompt({ ...ask, path })) return;
      // Something else is already open (What's new, the draw room…): try again shortly.
      if (document.querySelector('.sheet-bg, [role="dialog"]')) { setTick((n) => n + 1); return; }
      decided.current = true;
      markPromptShown();
      setState(s);
      setOpen(true);
    }, tick ? 5000 : 1800);
    return () => { live = false; clearTimeout(t); };
  }, [loc.pathname, skip, open, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switched off (or started viewing as someone) while it's open: put it away.
  useEffect(() => { if (skip && open) setOpen(false); }, [skip, open]);

  if (!open) return null;
  const close = () => { markPromptShown(); setOpen(false); };
  const settings = () => { setOpen(false); nav('/notifications'); };
  const plan = setupPlan(readPhone(), state, appName());
  return (
    <Sheet title={done ? 'Notifications are on' : '🔔 Turn on notifications'} onClose={close}>
      <div className="stack" style={{ gap: 14 }}>
        {done ? (
          <>
            <div className="card pad" role="status" style={{ borderColor: 'var(--navy)' }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>Done ✓</div>
              <div className="small muted">You’ll get a test buzz in a moment.</div>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <div style={{ fontWeight: 700 }}>Next: choose what you get</div>
              <div className="small muted">Straight away, one daily digest at a time you pick, or only the important ones.</div>
            </div>
            <button type="button" className="btn gold block" style={{ minHeight: 52, fontSize: 17 }} onClick={settings}>Choose what you get</button>
            <button type="button" className="btn ghost block" onClick={() => setOpen(false)}>Leave it as is</button>
          </>
        ) : (
          <>
            <div className="small muted" style={{ margin: 0 }}>Get a buzz on this {readPhone().os === 'desktop' ? 'computer' : 'phone'} when something happens in {status?.group_name || 'your group'}:</div>
            <WhatYouGet limit={6} />
            <div className="card pad">
              <NotifySteps state={state} onTurnedOn={() => setDone(true)} />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className={plan.canTurnOn ? 'btn ghost grow' : 'btn grow'} onClick={close}>{plan.canTurnOn ? 'Not now' : 'Got it'}</button>
              <button type="button" className="btn ghost grow" onClick={settings}>Notification settings</button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
