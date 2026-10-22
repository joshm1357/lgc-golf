// The Caddie (22 Oct 2026) — the AI helper as a button that's always there. Rendered once, in App.jsx.
//   * Phone: a round caddie button bottom-right, just above the tab bar. Tap → "Ask the caddie" sheet over the
//     current screen. It moves up when a bottom button ("Enter score", "Enter a shot"…) is showing, so it never
//     covers one.
//   * Laptop (1024 px and up) and the desk: a panel docked down the right, which folds away to a slim tab.
//   * Never greyed out (Josh, 22 Oct): when the AI can't answer, it still takes you to the right page
//     (components/CaddieChat.jsx, lib/caddie.js). Hidden only on full-screen views (TV, print, replay, score entry…).
// The chat itself is loaded when first opened, so the leaderboard stays quick to load.
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sheet } from './ui.jsx';
import { lazyScreen, LazyArea } from '../lib/lazy.jsx';
import { caddieHidden, usesPanel } from '../lib/caddie.js';
import './caddie.css';

const CaddieChat = lazyScreen(() => import('./CaddieChat.jsx'), 'default', { inline: true });
const PANEL_KEY = 'tgt-caddie-panel';

/** Open the caddie from anywhere (optionally asking something straight away). */
export function openCaddie(question) {
  window.dispatchEvent(new CustomEvent('caddie:open', { detail: { question: question || null } }));
}

/** An original glyph: a golf bag with three clubs. */
export function CaddieGlyph({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M13 11 L10.5 3.5" /><path d="M16 11 V2.5" /><path d="M19 11 L22 4" />
      </g>
      <g fill="var(--gold)">
        <rect x="8" y="2" width="4" height="2.6" rx="1.2" transform="rotate(-18 10 3.3)" />
        <circle cx="16" cy="2.6" r="1.8" />
        <rect x="20.5" y="2.4" width="4" height="2.6" rx="1.2" transform="rotate(24 22.5 3.7)" />
      </g>
      <path d="M10 12.5 h12 l-1.6 15.5 a1.6 1.6 0 0 1 -1.6 1.4 h-5.6 a1.6 1.6 0 0 1 -1.6 -1.4 z" fill="#fff" />
      <rect x="9.2" y="10.4" width="13.6" height="3.2" rx="1.6" fill="#fff" stroke="var(--navy)" strokeWidth="1" />
      <path d="M22 15 c3 1 3 8 0 9.5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <rect x="13" y="18" width="6" height="5" rx="1" fill="var(--navy)" opacity=".25" />
    </svg>
  );
}

/** Is the window laptop-wide? Follows resizing. */
function useWidth() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    const f = () => setW(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return w;
}

/** How far up the button must sit to clear any bottom button on the page (px from the bottom), or null. */
function useFabLift(active, pathname) {
  const [lift, setLift] = useState(null);
  useEffect(() => {
    if (!active) { setLift(null); return undefined; }
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let top = Infinity;
        document.querySelectorAll('.fab').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.height > 0 && r.width > 0 && getComputedStyle(el).position === 'fixed') top = Math.min(top, r.top);
        });
        setLift(Number.isFinite(top) ? Math.round(window.innerHeight - top + 12) : null);
      });
    };
    measure();
    const mo = new MutationObserver(measure);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); mo.disconnect(); window.removeEventListener('resize', measure); };
  }, [active, pathname]);
  return lift;
}

export function Caddie() {
  const loc = useLocation();
  const navigate = useNavigate();
  const width = useWidth();
  const hidden = caddieHidden(loc.pathname);
  const panel = usesPanel(loc.pathname, width);
  const [open, setOpen] = useState(false); // the phone's sheet
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem(PANEL_KEY) === 'open'; } catch { return false; } });
  const [ask, setAsk] = useState(null); // a question to ask as soon as it opens ({ q, n })
  const lift = useFabLift(!hidden && !panel, loc.pathname);

  useEffect(() => {
    const f = (e) => {
      const q = e.detail?.question;
      if (q) setAsk({ q, n: Date.now() });
      if (usesPanel(window.location.hash.slice(1), window.innerWidth)) setPanelOpen(true); else setOpen(true);
    };
    window.addEventListener('caddie:open', f);
    return () => window.removeEventListener('caddie:open', f);
  }, []);
  useEffect(() => { try { localStorage.setItem(PANEL_KEY, panelOpen ? 'open' : 'closed'); } catch { /* fine */ } }, [panelOpen]);
  // The page makes room for the open panel (desktop.css).
  useLayoutEffect(() => {
    const on = !hidden && panel && panelOpen;
    document.documentElement.classList.toggle('caddie-open', on);
    document.documentElement.classList.toggle('has-caddie', !hidden && !panel);
    return () => document.documentElement.classList.remove('caddie-open', 'has-caddie');
  }, [hidden, panel, panelOpen]);
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  if (hidden) return null;
  const go = (path) => { setOpen(false); navigate(path); };
  const chat = (
    <LazyArea fallback={<div className="small muted" style={{ padding: 12 }}>Opening…</div>} onClose={() => { setOpen(false); setPanelOpen(false); }}>
      <CaddieChat onGo={go} ask={ask} />
    </LazyArea>
  );

  if (panel) {
    if (!panelOpen) {
      return (
        <button type="button" className="caddie-tab no-print" data-testid="caddie" aria-label="Ask the caddie" onClick={() => setPanelOpen(true)}>
          <CaddieGlyph size={26} /><span>Caddie</span>
        </button>
      );
    }
    return (
      <aside className="caddie-panel no-print" data-testid="caddie-panel" aria-label="Ask the caddie">
        <div className="caddie-panel-hdr">
          <span className="caddie-face"><CaddieGlyph size={24} /></span>
          <strong className="grow">Ask the caddie</strong>
          <button type="button" className="btn ghost sm" aria-label="Fold the caddie away" onClick={() => setPanelOpen(false)}>→</button>
        </div>
        <div className="caddie-panel-body">{chat}</div>
      </aside>
    );
  }
  return (
    <>
      <button type="button" className="caddie-btn no-print" data-testid="caddie" aria-label="Ask the caddie"
        style={lift ? { bottom: `${lift}px` } : undefined} onClick={() => setOpen(true)}>
        <CaddieGlyph />
      </button>
      {open && <Sheet title="Ask the caddie" onClose={() => setOpen(false)}>{chat}</Sheet>}
    </>
  );
}

export default Caddie;
