// The planning maps' tools (ov22, Josh 23 Oct) — used by BuilderMap (Build the trip, the area start) and TripMap (the
// trip finder). The rules are pure, in lib/placeinfo.js.
//   * WheelZoom: "Maps in planning don't allow scrolling in for zoom." Mouse-wheel zoom works after a click on the map
//     (until the pointer leaves it), or any time with Ctrl / ⌘ held — so scrolling the page never gets caught by a map.
//     The first time the pointer comes over a map, a small "Scroll to zoom" hint says how. Pinch and +/− as before.
//   * Club names: a small on/off switch top-right of the map (on by default, remembered on this device); a short name
//     next to each course pin; labels that would sit on top of each other are hidden (the more important one stays).
//   * Hover for a quick summary, click for everything: the summary card (TipCard) on a pin or beside a list row.
//   * useHot: the course or place being pointed at — the pin grows and bounces, its row lights up, the map pans to it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { readNames, saveNames, NAMES_KEY, declutter, tapAction } from '../lib/placeinfo.js';
import './planmap.css';

/** Can this device hover (a mouse or trackpad)? Phones can't: they get first tap / second tap. */
export function canHover() {
  try { return !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches; } catch { return false; }
}
// What the last press was — a finger or a mouse. A touch laptop has both, so each tap is judged by what made it.
let lastPointer = null;
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || null; }, true);
/** Was the last press a finger (or, before any press, is this a phone)? */
export const touchNow = () => lastPointer === 'touch' || lastPointer === 'pen' || (lastPointer == null && !canHover());

// ------------------------------------------------------------------ scroll-wheel zoom

const isMac = () => { try { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''); } catch { return false; } };

/** Inside a MapContainer (made with scrollWheelZoom={false}). */
export function WheelZoom() {
  const map = useMap();
  const [hint, setHint] = useState(false);
  useEffect(() => {
    const el = map.getContainer();
    const hover = canHover();
    let hintedOnce = false;
    let timer = 0;
    let last = 0;
    const show = () => { setHint(true); clearTimeout(timer); timer = setTimeout(() => setHint(false), 2400); };
    const on = () => {
      if (map.scrollWheelZoom.enabled()) return;
      map.scrollWheelZoom.enable();
      el.classList.add('pm-wheel-on');
      setHint(false);
    };
    const off = () => { map.scrollWheelZoom.disable(); el.classList.remove('pm-wheel-on'); };
    const enter = () => { if (hover && !hintedOnce && !map.scrollWheelZoom.enabled()) { hintedOnce = true; show(); } };
    const wheel = (e) => {
      if (map.scrollWheelZoom.enabled()) return;
      if (e.ctrlKey || e.metaKey) {
        // Ctrl/⌘ + wheel (and a trackpad pinch, which arrives as Ctrl + wheel): zoom about the pointer, one step at a time.
        e.preventDefault();
        const now = Date.now();
        if (now - last < 160 || !e.deltaY) return;
        last = now;
        map.setZoomAround(map.mouseEventToContainerPoint(e), map.getZoom() + (e.deltaY < 0 ? 1 : -1), { animate: false });
      } else if (hover) show();
    };
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseleave', off);
    el.addEventListener('mouseenter', enter);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      clearTimeout(timer);
      el.removeEventListener('mousedown', on);
      el.removeEventListener('mouseleave', off);
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('wheel', wheel);
    };
  }, [map]);
  if (!hint) return null;
  return createPortal(
    <div className="pm-hint" role="status" data-testid="map-wheel-hint">Scroll to zoom: click the map first, or hold {isMac() ? '⌘' : 'Ctrl'} while you scroll</div>,
    map.getContainer(),
  );
}

// ------------------------------------------------------------------ club names

/** The Club names switch, the same on every planning map on this device. → [on, setOn] */
export function useNamesPref() {
  const [on, setOn] = useState(() => readNames());
  useEffect(() => {
    const f = (e) => setOn(e.detail !== false);
    window.addEventListener(NAMES_KEY, f);
    return () => window.removeEventListener(NAMES_KEY, f);
  }, []);
  const set = useCallback((v) => {
    saveNames(v);
    setOn(v);
    window.dispatchEvent(new CustomEvent(NAMES_KEY, { detail: v }));
  }, []);
  return [on, set];
}

/** The small switch, top-right of the map (put it inside the map's wrapper, which is position: relative). */
export function NamesToggle({ on, onChange }) {
  return (
    <button type="button" className={`pm-names${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)} data-testid="map-names">
      <span className="pm-switch" aria-hidden="true" /> Club names
    </button>
  );
}

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
/** A course's name label, just right of its pin. p = priority (higher keeps its label when they overlap). */
export const labelIcon = (text, p = 1, hot = false) => L.divIcon({
  className: 'pm-label-icon',
  html: `<span class="pm-label${hot ? ' hot' : ''}" data-p="${Number(p)}">${esc(text)}</span>`,
  iconSize: null, iconAnchor: [-12, 10],
});

/** Inside a MapContainer: hides course labels that would overlap (re-checked after every zoom or move). */
export function Declutter({ dep = '' }) {
  const map = useMap();
  const raf = useRef(0);
  const run = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const box = map.getContainer();
      // The one being pointed at always keeps its name (it's drawn on top); the rest give way to each other.
      const els = [...box.querySelectorAll('.pm-label:not(.hot)')];
      els.forEach((el) => { el.style.visibility = ''; });
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
      const boxes = els.map((el, i) => ({ id: i, p: Number(el.dataset.p) || 1, ...rect(el) }));
      const fixed = [...box.querySelectorAll('.tb-stay')].map(rect);
      const hidden = declutter(boxes, fixed);
      els.forEach((el, i) => { if (hidden.has(i)) el.style.visibility = 'hidden'; });
    });
  }, [map]);
  useMapEvents({ zoomend: run, moveend: run, resize: run, viewreset: run });
  useEffect(() => { const t = setTimeout(run, 0); return () => clearTimeout(t); }, [dep, run]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return null;
}

/** Inside a MapContainer: pans to a point when it's off-screen (the course pointed at in the list). */
export function PanTo({ point }) {
  const map = useMap();
  const key = point ? `${point.lat},${point.lng}` : '';
  useEffect(() => {
    if (!point || point.lat == null) return;
    const ll = L.latLng(point.lat, point.lng);
    if (!map.getBounds().pad(-0.08).contains(ll)) map.panTo(ll, { animate: false });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Inside a MapContainer: after a tap on a pin, nudge the map so the pin's summary card isn't cut off at the edge
 *  (or tucked under the + / − buttons). Not on a mouse hover — moving the map under the pointer would lose it. */
export function FitTip({ dep }) {
  const map = useMap();
  useEffect(() => {
    if (!dep) return undefined;
    // The card is drawn a moment after the tap (react-leaflet fills it in once the tooltip opens): check twice.
    const fit = () => {
      const c = map.getContainer();
      const tip = c.querySelector('.leaflet-tooltip.pm-tip');
      if (!tip || !tip.offsetHeight) return;
      const r = tip.getBoundingClientRect(); const b = c.getBoundingClientRect();
      const top = 60; const side = 8;
      const dx = r.left < b.left + side ? r.left - b.left - side : r.right > b.right - side ? Math.min(r.right - b.right + side, r.left - b.left - side) : 0;
      const dy = r.top < b.top + top ? r.top - b.top - top : 0;
      if (dx || dy) map.panBy([Math.round(dx), Math.round(dy)], { animate: false });
    };
    const a = setTimeout(fit, 60); const b = setTimeout(fit, 260);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [dep]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ------------------------------------------------------------------ the one being pointed at

/**
 * hot: 'c:<course id>' | 's:<stay key>' | null; from: 'pin' | 'row'.
 * hoverIn / hoverOut are for the mouse (hoverOut waits a moment so you can move onto the summary card);
 * pick is for taps (stays until something else is tapped). hold / release: the pointer is on the summary card.
 */
export function useHot() {
  const [state, setState] = useState({ hot: null, from: null, via: null });
  const t = useRef(0);
  const hoverIn = useCallback((key, from = 'pin') => { clearTimeout(t.current); setState((s) => (s.hot === key && s.from === from ? s : { hot: key, from, via: 'hover' })); }, []);
  const hoverOut = useCallback(() => { clearTimeout(t.current); t.current = setTimeout(() => setState({ hot: null, from: null, via: null }), 220); }, []);
  const hold = useCallback(() => clearTimeout(t.current), []);
  const pick = useCallback((key, from) => { clearTimeout(t.current); setState({ hot: key, from, via: 'tap' }); }, []);
  const clear = useCallback(() => { clearTimeout(t.current); setState({ hot: null, from: null, via: null }); }, []);
  useEffect(() => () => clearTimeout(t.current), []);
  return { ...state, hoverIn, hoverOut, hold, release: hoverOut, pick, clear };
}

// ------------------------------------------------------------------ the summary card

/** tip: { name, lines }. onMore: open the details (a "More →" button). hint: a quiet line instead (mouse, beside a row). */
export function TipCard({ tip, onMore, onEnter, onLeave, hint = '' }) {
  if (!tip) return null;
  return (
    <div className="pm-tip-card" data-testid="place-tip" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <strong>{tip.name}</strong>
      {tip.lines.map((l) => <span key={l} className="pm-tip-line">{l}</span>)}
      {hint ? <span className="pm-tip-hint">{hint}</span> : onMore && (
        <button type="button" className="pm-tip-more" onClick={(e) => { e.stopPropagation(); onMore(); }} data-testid="place-tip-more">More →</button>
      )}
    </div>
  );
}

/** The summary card beside a list row (fixed on the screen, next to the row). anchor: the row element.
 *  passive (pointing with a mouse): the card lets the pointer through, and says "Click for everything". */
export function RowTip({ anchor, tip, onMore, onEnter, onLeave, passive = false }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!anchor) { setPos(null); return undefined; }
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = Math.min(280, window.innerWidth - 24);
      const right = r.right + 10 + w <= window.innerWidth - 8;
      setPos(right ? { left: r.right + 10, top: Math.max(8, r.top) } : { left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)), top: r.bottom + 6 });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [anchor]);
  if (!anchor || !tip || !pos) return null;
  return createPortal(
    <div className={`pm-row-tip${passive ? ' passive' : ''}`} style={{ left: pos.left, top: pos.top }}>
      <TipCard tip={tip} onMore={onMore} onEnter={onEnter} onLeave={onLeave} hint={passive ? 'Click for everything' : ''} />
    </div>,
    document.body,
  );
}

/**
 * Hover for a quick summary, click for everything — for one screen's map and lists together.
 *   row(key): props for a list row (hover → its summary card, and its pin lights up on the map);
 *   tapRow(key, el) / tapPin(key): a click opens the details; on a phone the first tap shows the summary instead;
 *   sheet: the key whose details are open (setSheet(null) closes); rowAnchor: the row to put the summary card beside.
 * key: 'c:<course id>' | 's:<stay key>'.
 */
export function usePlaceInfo({ onOpen = null } = {}) {
  const hot = useHot();
  const [anchor, setAnchor] = useState(null);
  const [sheet, setSheet] = useState(null);
  const hover = canHover();
  const mouse = () => !touchNow();
  const open = (key, how = null) => { hot.clear(); setAnchor(null); if (how) how(key); else if (onOpen) onOpen(key); else setSheet(key); };
  const row = (key) => (hover ? {
    'data-place': key,
    onMouseEnter: (e) => { if (touchNow()) return; hot.hoverIn(key, 'row'); setAnchor({ key, el: e.currentTarget }); },
    onMouseLeave: () => { if (!touchNow()) hot.hoverOut(); },
  } : { 'data-place': key });
  /** how: this row's own way to open its details (e.g. a day's course), else onOpen. */
  const tapRow = (key, el, how = null) => {
    if (tapAction({ key, hotKey: hot.from === 'row' ? hot.hot : null, canHover: mouse() }) === 'open') open(key, how);
    else { hot.pick(key, 'row'); setAnchor({ key, el }); }
  };
  const tapPin = (key) => {
    if (tapAction({ key, hotKey: hot.from === 'pin' ? hot.hot : null, canHover: mouse() }) === 'open') open(key);
    else hot.pick(key, 'pin');
  };
  // Phone: a tap anywhere else puts the summary away.
  useEffect(() => {
    if (!hot.hot) return undefined;
    const f = (e) => { if (e.pointerType !== 'mouse' && !e.target?.closest?.('.leaflet-interactive, .leaflet-marker-icon, .pm-tip-card, [data-place]')) hot.clear(); };
    document.addEventListener('pointerdown', f, true);
    return () => document.removeEventListener('pointerdown', f, true);
  }, [hot.hot]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mouse: a row that's gone from the page (e.g. a "+ course" chip just added) never says the pointer left it — so
  // anything the pointer moves onto that isn't the row or its card puts the card away.
  useEffect(() => {
    if (hot.from !== 'row' || !hot.hot) return undefined;
    const f = (e) => {
      if (e.target?.closest?.('.pm-tip-card')) return;
      if (anchor?.el?.isConnected && anchor.el.contains(e.target)) return;
      if (!e.target?.closest?.('[data-place]')) hot.hoverOut();
    };
    document.addEventListener('mousemove', f, true);
    return () => document.removeEventListener('mousemove', f, true);
  }, [hot.hot, hot.from, anchor]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowAnchor = hot.from === 'row' && anchor && anchor.key === hot.hot && anchor.el?.isConnected ? anchor.el : null;
  const isHot = (key) => hot.hot === key;
  return { hot, row, tapRow, tapPin, open, sheet, setSheet, rowAnchor, canHover: hover, isHot, touchNow };
}
