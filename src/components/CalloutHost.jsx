// ov34 — listens for "⛳ Put a round out" (openCallout in lib/calloutopen.js) and opens the sheet. Rendered once in
// App.jsx; the sheet itself is only loaded the first time it's opened.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lazyScreen, LazyArea } from '../lib/lazy.jsx';
import { CALLOUT_EVENT } from '../lib/calloutopen.js';

const CalloutSheet = lazyScreen(() => import('./CalloutSheet.jsx'), 'CalloutSheet', { inline: true });

export function CalloutHost() {
  const [open, setOpen] = useState(null);
  const nav = useNavigate();
  useEffect(() => {
    const f = (e) => setOpen({ ...(e.detail || {}), n: Date.now() });
    window.addEventListener(CALLOUT_EVENT, f);
    return () => window.removeEventListener(CALLOUT_EVENT, f);
  }, []);
  if (!open) return null;
  return (
    <LazyArea fallback={null} quiet>
      <CalloutSheet key={open.n} prefill={open} onClose={() => setOpen(null)} onSaved={(id) => { setOpen(null); nav(`/plan/${id}`); }} />
    </LazyArea>
  );
}

export default CalloutHost;
