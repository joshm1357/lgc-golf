// "Save your spot" (22 Oct 2026). After someone joins from a link (pick name → notifications → the shared page), ask
// them ONCE to sign in with Google or an email and password, added to the same phone-only user so their group and
// name stay. Then a small banner on Home and More until it's done (or they've closed it twice).
//   - SaveSpotPrompt: the one-time pop-up, rendered once in App.jsx. Also says "Done" after a trip to Google.
//   - SaveSpotBanner: the small banner on Home and More.
//   - SaveSpotPanel: the buttons themselves, also used in Group & invites.
// The rules (when, how often, error words) are in lib/savespot.js.
import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession, useData } from '../lib/store.jsx';
import { SIGN_IN } from '../lib/auth.js';
import {
  signInModes, canSaveSpot, shouldAskOnce, shouldShowBanner, readSaveState, writeSaveState,
  asked, closedBanner, saved, goingToGoogle, backFromGoogle, authProblem,
} from '../lib/savespot.js';
import { GoogleSignIn } from '../screens/Join.jsx';
import { SaveSpotEmail } from './SignInForms.jsx';
import { Sheet } from './ui.jsx';
import { popupFree, takePopup } from '../lib/firstopen.js';

const modes = () => signInModes(SIGN_IN);

function useEligible() {
  const { status } = useSession();
  return canSaveSpot({ signInOn: SIGN_IN.length > 0, status });
}

/** Google and/or email, for a phone-only user. onDone when their spot is saved (same user, now signed in). */
export function SaveSpotPanel({ onDone, returnHash }) {
  const m = modes();
  const [email, setEmail] = useState(false);
  const [err, setErr] = useState('');
  // Back from Google to the page they were on (e.g. the trip page their join link was for).
  const hash = returnHash || (typeof window !== 'undefined' ? window.location.hash : '');
  if (!m.any) return null;
  const done = () => { writeSaveState(saved(readSaveState())); onDone?.(); };
  return (
    <div className="stack" style={{ gap: 10 }} data-testid="save-spot-panel">
      {m.google && !email && (
        <GoogleSignIn link light returnHash={hash} onLinked={done}
          onLeaving={() => writeSaveState(goingToGoogle(readSaveState(), hash))}
          onError={(x) => setErr(authProblem(x).message)} />
      )}
      {(m.password || m.emailCode) && (email
        ? <SaveSpotEmail withPassword={m.password} onDone={done} />
        : <button type="button" className="btn block" onClick={() => { setErr(''); setEmail(true); }}>✉️ Use my email</button>)}
      {email && m.google && <button type="button" className="btn ghost block" onClick={() => setEmail(false)}>Back</button>}
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}

function DoneNote({ onClose }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card pad" role="status" style={{ borderColor: 'var(--navy)' }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Done ✓</div>
        <div className="small muted">Next time just tap <strong>Sign in</strong> — on this phone, a new one or a laptop. Same name, same scores.</div>
      </div>
      <button type="button" className="btn gold block" onClick={onClose}>Great</button>
    </div>
  );
}

function SaveSpotSheet({ onClose, onDone, done }) {
  return (
    <Sheet title={done ? 'Your spot is saved' : '🔐 Save your spot'} onClose={onClose}>
      {done ? <DoneNote onClose={onClose} /> : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="small muted" style={{ margin: 0 }}>Connect Google or email so you can sign in on your laptop (or a new phone). Same account, same name, same scores.</div>
          <SaveSpotPanel onDone={onDone} />
          <button type="button" className="btn ghost block" onClick={onClose}>Not now</button>
        </div>
      )}
    </Sheet>
  );
}

/** The one-time pop-up. Waits for the notifications pop-up (and any other sheet) to close first. */
export function SaveSpotPrompt() {
  const { status } = useSession();
  const data = useData();
  const loc = useLocation();
  const eligible = useEligible();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [tick, setTick] = useState(0);
  const decided = useRef(false);
  const offline = !!data?.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);

  // Back from Google: say it worked (or forget the trip — the problem shows in the red bar at the top).
  useEffect(() => {
    const s = readSaveState();
    const back = backFromGoogle({ state: s, signedIn: !!status?.signed_in });
    if (back === 'done') { writeSaveState(saved(s)); decided.current = true; setDone(true); setOpen(true); }
    else if (back === 'failed' || s.pending) writeSaveState({ ...s, pending: null });
  }, [status?.signed_in]);

  useEffect(() => {
    if (decided.current || open) return undefined;
    const ask = () => shouldAskOnce({ eligible, state: readSaveState(), path: loc.pathname, offline });
    if (!ask()) return undefined;
    // After the notifications pop-up has had its chance (it waits 1.8 seconds).
    const t = setTimeout(() => {
      if (decided.current || !ask()) return;
      // F1 (ov27): one pop-up a visit — if something else has popped up this visit, ask next time.
      if (!popupFree('save-spot')) { decided.current = true; return; }
      if (document.querySelector('.sheet-bg, [role="dialog"]')) { setTick((n) => n + 1); return; } // another sheet open
      decided.current = true;
      takePopup('save-spot');
      writeSaveState(asked(readSaveState()));
      setOpen(true);
    }, tick ? 2000 : 3500);
    return () => clearTimeout(t);
  }, [loc.pathname, eligible, offline, open, tick]);

  if (!open) return null;
  return <SaveSpotSheet done={done} onDone={() => setDone(true)} onClose={() => setOpen(false)} />;
}

/** The small banner on Home and More, after the pop-up, until it's done or closed twice. */
export function SaveSpotBanner() {
  const eligible = useEligible();
  const [state, setState] = useState(() => readSaveState());
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (open) return <SaveSpotSheet done={done} onDone={() => setDone(true)} onClose={() => { setOpen(false); setState(readSaveState()); }} />;
  if (!shouldShowBanner({ eligible, state })) return null;
  const close = () => { const s = closedBanner(readSaveState()); writeSaveState(s); setState(s); };
  return (
    <div className="section" style={{ paddingBottom: 0 }}>
      <div className="card pad row" data-testid="save-spot-banner" style={{ gap: 10, alignItems: 'center', borderColor: 'var(--gold)' }}>
        <span style={{ fontSize: 24 }} aria-hidden="true">🔐</span>
        <span className="grow" style={{ minWidth: 0 }}>
          <strong>Save your spot</strong>
          <div className="small muted">Connect Google or email so you can sign in on your laptop.</div>
        </span>
        <button type="button" className="btn gold sm" style={{ minHeight: 44, flex: 'none' }} onClick={() => setOpen(true)}>Save</button>
        <button type="button" className="btn ghost sm" style={{ minHeight: 44, minWidth: 44, flex: 'none' }} onClick={close} aria-label="Close the Save your spot reminder">✕</button>
      </div>
    </div>
  );
}
