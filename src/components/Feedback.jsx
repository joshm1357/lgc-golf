import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useRun, must } from '../lib/run.js';
import { appVersion, safePath } from '../lib/problems.js';
import { FEEDBACK_KINDS, FEEDBACK_MAX, checkFeedback, canInstall, onInstallOffer, install, isInstalled } from '../lib/beta.js';
import { Sheet, Seg } from './ui.jsx';

// Stage 1 (beta): "Tell Josh". What someone types goes to Josh's screen with their name, the screen they were on
// the app version and the browser, so he can find the problem. Nothing else is sent.

let openSet = null;
/** Open the feedback sheet from anywhere (the sidebar, More). */
export function openFeedback(kind) { openSet?.(kind || 'idea'); }

/** Lives once in the app; opened by openFeedback(). */
export function FeedbackHost() {
  const [kind, setKind] = useState(null);
  useEffect(() => { openSet = setKind; return () => { openSet = null; }; }, []);
  return kind ? <FeedbackSheet start={kind} onClose={() => setKind(null)} /> : null;
}

function FeedbackSheet({ start, onClose }) {
  const loc = useLocation();
  const [kind, setKind] = useState(start);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useRun();
  const send = async () => {
    const c = checkFeedback(kind, text);
    if (c.error) { setError(c.error); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setError('No signal. Keep this open and try again when you have signal.'); return; }
    const ok = await run(() => must(supabase.rpc('send_feedback', {
      p_kind: kind, p_message: c.text, p_path: safePath(`#${loc.pathname}`), p_version: appVersion(),
      p_agent: (navigator.userAgent || '').slice(0, 200),
    })).then(() => true), 'Sent. Thanks!');
    if (ok) onClose();
  };
  return (
    <Sheet title="Send feedback" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>The Golf Trip is in beta. Anything broken, annoying or missing, or something you like: the people who make the app read every one.</p>
        <Seg light options={FEEDBACK_KINDS} value={kind} onChange={(v) => { setKind(v); setError(''); }} />
        <label className="field">
          <span>{kind === 'problem' ? 'What went wrong? What did you tap just before?' : kind === 'like' ? 'What do you like?' : 'What’s your idea?'}</span>
          <textarea className="textarea" value={text} maxLength={FEEDBACK_MAX + 50} autoFocus
            onChange={(e) => { setText(e.target.value); setError(''); }} />
        </label>
        <div className="row between small muted"><span>We see your name, this screen, the app version and your browser.</span><span>{text.trim().length}/{FEEDBACK_MAX}</span></div>
        {error && <div className="err" role="alert">{error}</div>}
        <button type="button" className="btn gold block" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </Sheet>
  );
}

/** The card at the top of More while the app is in beta. */
export function BetaCard() {
  return (
    <div className="card pad row" style={{ gap: 12, borderColor: 'var(--gold)', background: 'var(--gold-soft)' }}>
      <span className="beta-pill">Beta</span>
      <span className="grow small">Something broken, annoying or missing? Tell us — it takes 30 seconds.</span>
      <button type="button" className="btn sm" onClick={() => openFeedback('idea')}>Send feedback</button>
    </div>
  );
}

/** "Install on this computer" (Chrome and Edge only; hidden once installed or where the browser can't). */
export function InstallCard() {
  const [can, setCan] = useState(canInstall());
  useEffect(() => onInstallOffer(setCan), []);
  if (!can || isInstalled()) return null;
  const desktop = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;
  return (
    <div className="card pad row" style={{ gap: 12, marginTop: 12 }}>
      <span className="grow">
        <div style={{ fontWeight: 700 }}>{desktop ? 'Install on this computer' : 'Install the app'}</div>
        <div className="small muted">{desktop ? 'Opens in its own window, with its own icon.' : 'Adds it to your home screen.'}</div>
      </span>
      <button type="button" className="btn sm" onClick={() => install()}>Install</button>
    </div>
  );
}
