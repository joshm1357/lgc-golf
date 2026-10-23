// "Save your spot to do this" (v10.2, Josh's option B). One gate for the whole app — the rules are in lib/savedgate.js.
//
//   - <SavedGate /> is rendered once in App.jsx. It watches every tap (before the button sees it). A tap on anything
//     marked {...gate('money')} (data-needs-saved="money") by a phone-only person, in a group that limits phone-only
//     accounts, opens the sheet instead. The button stays visible; nothing is hidden.
//   - The sheet is Save your spot's own panel (Google / email, whatever VITE_SIGN_IN allows). It adds the sign-in to
//     the CURRENT phone-only account, so nothing is lost. Once saved, the tap carries on: the same button is tapped
//     again for them (or the function they asked for runs).
//   - useSavedGate(): for code that isn't a plain button tap — `const ask = useSavedGate(); ask('dispute', () => …)`.
//   - The database says "Save your spot first …" for the same things (102). ui.jsx's toast spots that and asks here,
//     so a button not marked yet still ends in the same sheet.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession, useFeature } from '../lib/store.jsx';
import { supabase } from '../lib/supabase.js';
import { SIGN_IN } from '../lib/auth.js';
import { needsSaved, gateWords, FEATURE_KEY, PHONE_ONLY_LABEL } from '../lib/savedgate.js';
import { SaveSpotPanel } from './SaveSpot.jsx';
import { Sheet } from './ui.jsx';
import { SignInButtons } from '../screens/Join.jsx';

const ASK_EVENT = 'tgt-save-needed';

/** Ask from anywhere (no hook needed): opens the sheet; `then` runs once they've saved. */
export function askToSave(action = 'organise', then = null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { action, then } }));
}

/** ask(action, fn): runs fn now if allowed, else asks them to save first and runs fn after. Returns true if it ran. */
export function useSavedGate() {
  const { status } = useSession() || {};
  const limited = useFeature(FEATURE_KEY);
  return useCallback((action, fn) => {
    if (needsSaved(action, { status, signInOn: SIGN_IN.length > 0, limited })) { askToSave(action, fn); return false; }
    fn?.();
    return true;
  }, [status, limited]);
}

/** Does this action need saving first, for whoever's on this phone? (For words on a screen, e.g. a note.) */
export function useNeedsSaved(action) {
  const { status } = useSession() || {};
  const limited = useFeature(FEATURE_KEY);
  return needsSaved(action, { status, signInOn: SIGN_IN.length > 0, limited });
}

export function SavedGate() {
  const { status, refresh } = useSession() || {};
  const limited = useFeature(FEATURE_KEY);
  const [ask, setAsk] = useState(null); // { action, el?, then? }
  const now = useRef({});
  now.current = { status, limited };
  const letThrough = useRef(null); // the button tapped again for them after saving

  useEffect(() => {
    const onTap = (e) => {
      const el = e.target?.closest?.('[data-needs-saved]');
      if (!el) return;
      if (letThrough.current === el) { letThrough.current = null; return; }
      const action = el.getAttribute('data-needs-saved');
      if (!needsSaved(action, { ...now.current, signInOn: SIGN_IN.length > 0 })) return;
      e.preventDefault();
      e.stopPropagation();
      setAsk({ action, el });
    };
    const onAsk = (e) => setAsk({ action: e.detail?.action || 'organise', then: e.detail?.then || null });
    window.addEventListener('click', onTap, true);
    window.addEventListener(ASK_EVENT, onAsk);
    return () => { window.removeEventListener('click', onTap, true); window.removeEventListener(ASK_EVENT, onAsk); };
  }, []);

  if (!ask) return null;
  const done = async () => {
    const was = ask;
    setAsk(null);
    // A fresh token says is_anonymous: false (the database checks it too), and the app learns it's saved.
    try { await supabase.auth.refreshSession(); } catch { /* the database also checks the account itself */ }
    try { await refresh?.(); } catch { /* fine */ }
    setTimeout(() => {
      if (was.then) was.then();
      else if (was.el?.isConnected) { letThrough.current = was.el; was.el.click(); }
    }, 60);
  };
  return (
    <Sheet title="🔐 Save your spot to do this" onClose={() => setAsk(null)}>
      <div className="stack" style={{ gap: 14 }} data-testid="saved-gate">
        <div style={{ margin: 0 }}>{gateWords(ask.action)}</div>
        <div className="small muted">You’re on “{PHONE_ONLY_LABEL}”. You can still follow along, vote and score.</div>
        <SaveSpotPanel onDone={done} />
        <button type="button" className="btn ghost block" onClick={() => setAsk(null)}>Not now</button>
      </div>
    </Sheet>
  );
}

/**
 * Pages outside a group that make or claim something (start a group, a quick round, a club's claim, a group-booking
 * enquiry): a saved account first, never a phone-only one. Someone already on a phone-only account (from a group's
 * link) adds Google or email to it (Save your spot, so their group stays); anyone else signs in or makes an account.
 */
export function SignInToContinue({ returnHash = '', title = 'First, sign in', why = '' }) {
  const { user } = useSession() || {};
  if (!SIGN_IN.length) {
    return <div className="card pad small" data-testid="sign-in-to-continue">Signing in with Google or email isn’t switched on yet — check back soon.</div>;
  }
  return (
    <div className="card pad stack" style={{ gap: 10, borderColor: 'var(--gold)' }} data-testid="sign-in-to-continue">
      <strong>{title}</strong>
      {why && <span className="small">{why}</span>}
      {user?.is_anonymous ? <SaveSpotPanel returnHash={returnHash} /> : (
        <div style={{ background: 'var(--navy)', color: '#fff', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'center' }}>
          <SignInButtons returnHash={returnHash} />
        </div>
      )}
    </div>
  );
}

/** Is whoever's on this phone signed in with a saved account (not phone-only, not signed out)? */
export function useSavedAccount() {
  const { user, status } = useSession() || {};
  return !!(status?.signed_in || (user && user.is_anonymous === false));
}

/** For organiser screens: a phone-only organiser sees why their changes won't save, with the button to fix it. */
export function OrganiserSaveCard() {
  const { status } = useSession() || {};
  const need = useNeedsSaved('organise');
  if (!status?.is_admin || !need) return null;
  return (
    <div className="section" style={{ paddingBottom: 0 }}>
      <div className="card pad row" data-testid="organiser-save-card" style={{ gap: 10, alignItems: 'center', borderColor: 'var(--gold)' }}>
        <span style={{ fontSize: 24 }} aria-hidden="true">🔐</span>
        <span className="grow" style={{ minWidth: 0 }}>
          <strong>Organisers need a saved account</strong>
          <div className="small muted">Save your spot (Google or email) before you change anything here.</div>
        </span>
        <button type="button" className="btn gold sm" style={{ minHeight: 44, flex: 'none' }} onClick={() => askToSave('organise')}>Save</button>
      </div>
    </div>
  );
}
