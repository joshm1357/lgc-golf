// The Caddie (22 Oct 2026) — the AI helper as a button that's always there. Rendered once, in App.jsx.
//   * Phone: a round caddie button bottom-right, just above the tab bar. Tap → "Ask the caddie" sheet over the
//     current screen. It moves up when a bottom button ("Enter score", "Enter a shot"…) is showing, so it never
//     covers one.
//   * Laptop (1024 px and up) and the desk: a panel docked down the right, which folds away to a slim tab.
//   * Never greyed out (Josh, 22 Oct): when the AI can't answer, it still takes you to the right page
//     (components/CaddieChat.jsx, lib/caddie.js). Hidden only on full-screen views (TV, print, replay, score entry…).
// The chat itself is loaded when first opened, so the leaderboard stays quick to load.
// Two modes (ov16, 22 Oct): Ask (CaddieChat) and ✨ Plan a trip (CaddiePlan) — "Plan it with AI" IS the Caddie: the
// planning chat sits beside the trip screen (laptop) or in a sheet that folds down to show it (phone), and the trip
// screen fills in as you talk. The phone's planning sheet stays open as the page changes underneath it.
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sheet } from './ui.jsx';
import { lazyScreen, LazyArea } from '../lib/lazy.jsx';
import { caddieHidden, usesPanel } from '../lib/caddie.js';
import './caddie.css';

const CaddieChat = lazyScreen(() => import('./CaddieChat.jsx'), 'default', { inline: true });
const CaddiePlan = lazyScreen(() => import('./CaddiePlan.jsx'), 'default', { inline: true });
const PANEL_KEY = 'tgt-caddie-panel';
const MODE_KEY = 'tgt-caddie-mode'; // 'ask' | 'plan', for this visit

/** Open the caddie from anywhere (optionally asking something straight away, or in ✨ Plan a trip mode). */
export function openCaddie(question, { plan = false } = {}) {
  window.dispatchEvent(new CustomEvent('caddie:open', { detail: { question: question || null, plan: !!plan } }));
}
/** "✨ Plan it with AI": the Caddie, in planning mode. */
export const openPlanner = () => openCaddie(null, { plan: true });

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
  const [mode, setMode] = useState(() => { try { return sessionStorage.getItem(MODE_KEY) === 'plan' ? 'plan' : 'ask'; } catch { return 'ask'; } });
  const [folded, setFolded] = useState(false); // the phone's planning sheet, folded down to show the trip
  const lift = useFabLift(!hidden && !panel, loc.pathname);

  useEffect(() => {
    const f = (e) => {
      const q = e.detail?.question;
      if (q) setAsk({ q, n: Date.now() });
      setMode(e.detail?.plan ? 'plan' : 'ask');
      setFolded(false);
      if (usesPanel(window.location.hash.slice(1), window.innerWidth)) setPanelOpen(true); else setOpen(true);
    };
    window.addEventListener('caddie:open', f);
    return () => window.removeEventListener('caddie:open', f);
  }, []);
  useEffect(() => { try { localStorage.setItem(PANEL_KEY, panelOpen ? 'open' : 'closed'); } catch { /* fine */ } }, [panelOpen]);
  useEffect(() => { try { sessionStorage.setItem(MODE_KEY, mode); } catch { /* fine */ } }, [mode]);
  // The page makes room for the open panel (desktop.css).
  useLayoutEffect(() => {
    const on = !hidden && panel && panelOpen;
    document.documentElement.classList.toggle('caddie-open', on);
    document.documentElement.classList.toggle('has-caddie', !hidden && !panel);
    return () => document.documentElement.classList.remove('caddie-open', 'has-caddie');
  }, [hidden, panel, panelOpen]);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('caddie-planning', !hidden && !panel && open && mode === 'plan');
    return () => document.documentElement.classList.remove('caddie-planning');
  }, [hidden, panel, open, mode]);
  // The Ask sheet closes when the page changes; the planning sheet stays (it's filling in the page), folded down.
  useEffect(() => { if (mode === 'plan') setFolded(true); else setOpen(false); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden) return null;
  const go = (path) => { if (mode === 'plan') setFolded(true); else setOpen(false); navigate(path); };
  const chat = (
    <LazyArea fallback={<div className="small muted" style={{ padding: 12 }}>Opening…</div>} onClose={() => { setOpen(false); setPanelOpen(false); }}>
      {mode === 'plan' ? <CaddiePlan onGo={go} /> : <CaddieChat onGo={go} ask={ask} />}
    </LazyArea>
  );
  const tabs = (
    <div className="caddie-modes" role="tablist" aria-label="What the caddie does">
      <button type="button" role="tab" aria-selected={mode === 'ask'} className={mode === 'ask' ? 'on' : ''} onClick={() => setMode('ask')}>Ask</button>
      <button type="button" role="tab" aria-selected={mode === 'plan'} className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')} data-testid="caddie-plan-tab">✨ Plan a trip</button>
    </div>
  );
  const title = mode === 'plan' ? 'Plan a trip' : 'Ask the caddie';

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
          <strong className="grow">{title}</strong>
          <button type="button" className="btn ghost sm" aria-label="Fold the caddie away" onClick={() => setPanelOpen(false)}>→</button>
        </div>
        {tabs}
        <div className="caddie-panel-body">{chat}</div>
      </aside>
    );
  }
  return (
    <>
      <button type="button" className="caddie-btn no-print" data-testid="caddie" aria-label="Ask the caddie"
        style={lift ? { bottom: `${lift}px` } : undefined} onClick={() => { setOpen(true); setFolded(false); }}>
        <CaddieGlyph />
      </button>
      {open && mode !== 'plan' && <Sheet title="Ask the caddie" onClose={() => setOpen(false)}>{tabs}{chat}</Sheet>}
      {open && mode === 'plan' && (
        // Not a modal: the trip screen stays usable above it, and it folds down to a bar to see the whole page.
        <section className={`caddie-plan-sheet no-print${folded ? ' folded' : ''}`} role="dialog" aria-label="Plan a trip" data-testid="caddie-plan-sheet">
          <div className="caddie-plan-hdr">
            <button type="button" className="grow caddie-plan-grab" onClick={() => setFolded(!folded)} aria-expanded={!folded}>
              <CaddieGlyph size={22} /><strong>✨ Plan a trip</strong><span className="small">{folded ? 'Show the chat ↑' : 'Show the trip ↓'}</span>
            </button>
            <button type="button" className="btn ghost sm" aria-label="Close" onClick={() => { setOpen(false); setMode('ask'); }}>✕</button>
          </div>
          {!folded && <div className="caddie-plan-body">{tabs}{chat}</div>}
        </section>
      )}
    </>
  );
}

export default Caddie;
