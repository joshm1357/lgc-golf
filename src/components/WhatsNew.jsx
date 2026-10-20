import React, { useState } from 'react';
import { Sheet } from './ui.jsx';
import { useSession } from '../lib/store.jsx';
import { SIGN_IN } from '../lib/auth.js';
import { WHATS_NEW, shouldShowWhatsNew, whatsNewSeen, markWhatsNewSeen } from '../lib/beta.js';

// Shown once per phone on the new app (builds with sign-in): what's changed since the old L.G.C app.
export function WhatsNew() {
  const { status } = useSession();
  const [open, setOpen] = useState(() => shouldShowWhatsNew({ signInOn: SIGN_IN.length > 0, seen: whatsNewSeen() }));
  // The note is about moving from the old L.G.C app, so only L.G.C sees it.
  if (!open || status?.legacy === false) return null;
  const close = () => { markWhatsNewSeen(); setOpen(false); };
  return (
    <Sheet title="What’s new" onClose={close}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>Welcome to The Golf Trip beta: the same app, now with a few new things.</p>
        {WHATS_NEW.map((w) => (
          <div key={w.title} className="card pad">
            <div style={{ fontWeight: 700 }}>{w.title}</div>
            <div className="small muted">{w.body}</div>
          </div>
        ))}
        <button type="button" className="btn gold block" onClick={close}>Got it</button>
      </div>
    </Sheet>
  );
}
