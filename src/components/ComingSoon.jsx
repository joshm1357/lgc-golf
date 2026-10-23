// "Coming soon" with an "I'm interested" button (ov32). <ComingSoon feature="trophy_shop" label="Weekend Cup" />
// shows "🛒 Get one: coming soon" and the button. The button sends one idea through the beta feedback path (as
// Feedback.jsx does) with the fixed line "Interested: <feature> (<label>)", remembers it on this phone, then shows
// "✓ Noted, thanks". No links, no prices.
import React, { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { appVersion, safePath } from '../lib/problems.js';
import { toast } from './ui.jsx';

const WHAT = { trophy_shop: '🛒 Get one: coming soon' };
const key = (feature, label) => `tgt-interested-${feature}-${String(label || '').toLowerCase().slice(0, 60)}`;
const remembered = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };

/** The fixed line sent to Josh. */
export const interestedLine = (feature, label) => `Interested: ${feature}${label ? ` (${label})` : ''}`;

export default function ComingSoon({ feature, label = '', text = null }) {
  const k = key(feature, label);
  const [done, setDone] = useState(() => remembered(k));
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { toast('No signal — try again when you have it'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('send_feedback', {
      p_kind: 'idea', p_message: interestedLine(feature, label), p_path: safePath(window.location.hash || ''), p_version: appVersion(),
      p_agent: (navigator.userAgent || '').slice(0, 200),
    }).then((r) => r, (e) => ({ error: e }));
    setBusy(false);
    if (error) { toast('Couldn’t send that — try again later'); return; }
    try { localStorage.setItem(k, '1'); } catch { /* private mode: it just shows again next time */ }
    setDone(true);
  };
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-testid="coming-soon">
      <span className="small">{text || WHAT[feature] || 'Coming soon'}</span>
      {done
        ? <span className="small" style={{ fontWeight: 700 }} data-testid="coming-soon-noted">✓ Noted, thanks</span>
        : <button type="button" className="btn ghost sm" disabled={busy} onClick={send} data-testid="coming-soon-interested">I’m interested</button>}
    </div>
  );
}
