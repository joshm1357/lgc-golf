import React, { useEffect, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { GroupCrest } from './Logo.jsx';
import { useFeature, useSession } from '../lib/store.jsx';
import { SIGN_IN } from '../lib/auth.js';
import { updateNow, watchTyping } from '../lib/unsaved.js';

// ---------- Icons (simple stroke icons) ----------
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
export const Icon = {
  board: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M5 20V11M12 20V4M19 20v-6" /></svg>,
  feed: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  flag: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M6 21V3" /><path d="M6 4h11l-2.5 4L17 12H6" /></svg>,
  pin: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>,
  calendar: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  book: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2.5z" /><path d="M8 7h8M8 11h6" /></svg>,
  more: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>,
  back: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} strokeWidth="2.2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>,
  next: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} strokeWidth="2.2" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>,
  minus: (s = 30) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} strokeWidth="2.6" aria-hidden="true"><path d="M5 12h14" /></svg>,
  plus: (s = 30) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} strokeWidth="2.6" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>,
  camera: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>,
  trophy: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M8 21h8M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></svg>,
  gavel: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M14 13l-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10" /><path d="M16 16l6-6" /><path d="M8 8l6-6" /><path d="M9 7l8 8" /></svg>,
  hot: (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} stroke="#C62828" strokeWidth="2.5" aria-hidden="true"><path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 2 1 3 2 3 4" /></svg>,
  cold: (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} stroke="#2B6CB0" strokeWidth="2.5" aria-hidden="true"><path d="M12 2v20M4 6l16 12M20 6L4 18" /></svg>,
  up: (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} stroke="#1F7A4D" strokeWidth="2.5" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>,
  target: (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} stroke="var(--navy)" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>,
  user: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>,
  cog: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  map: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></svg>,
  x: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>,
};

const AV_COLOURS = ['#2F6B53', '#8A4B2A', '#3B4F8F', '#6B3B7A', '#2E4561', '#7A5A1E', '#285E6B'];
function colourFor(id = '') {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_COLOURS[h % AV_COLOURS.length];
}
export function initials(p) {
  const n = (p?.nickname || p?.name || '?').trim();
  const parts = n.split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

export function Avatar({ player, size = 32, ring }) {
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.36), background: colourFor(player?.id), ...(ring ? { borderColor: ring } : {}) };
  return (
    <span className="av" style={style} title={player?.nickname || player?.name}>
      {player?.avatar_url ? <img src={player.avatar_url} alt="" loading="lazy" /> : initials(player)}
    </span>
  );
}

export function AvatarStack({ players = [], size = 26 }) {
  return (
    <span className="av-stack">
      {players.slice(0, 5).map((p) => <Avatar key={p.id} player={p} size={size} />)}
    </span>
  );
}

export function Header({ title, sub, right, back, court, children, logo }) {
  const nav = useNavigate();
  return (
    <header className={'hdr' + (court ? ' court' : '')}>
      {back && (
        <div className="hdr-row">
          <button type="button" className="back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>
            {Icon.back()} <span>{typeof back === 'string' ? back : 'Back'}</span>
          </button>
        </div>
      )}
      <div className="hdr-row">
        {logo && <HeaderCrest />}
        <div className="hdr-grow">
          <div className="hdr-title">{title}</div>
          {sub && <div className="hdr-sub">{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </header>
  );
}

export function Seg({ options, value, onChange, light }) {
  return (
    <div className={'seg' + (light ? ' light' : '')} role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function TabBar() {
  const on = { feed: useFeature('feed'), side_comps: useFeature('side_comps'), planner: useFeature('planner'), cup: useFeature('cup') };
  const tabs = [
    { to: '/', label: 'Leaderboard', icon: Icon.board, end: true },
    { to: '/cup', label: 'Cup', icon: Icon.trophy, feature: 'cup' },
    { to: '/feed', label: 'Feed', icon: Icon.feed, feature: 'feed' },
    { to: '/comps', label: 'Comps', icon: Icon.flag, feature: 'side_comps' },
    { to: '/plan', label: 'Trips', icon: Icon.calendar, feature: 'planner' },
    { to: '/more', label: 'More', icon: Icon.more },
  ].filter((t) => !t.feature || on[t.feature]);
  return (
    <nav className="tabs" aria-label="Main">
      <div className="tabs-in" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>
            {t.icon()}
            <span>{t.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  // A keyboard closes it with Esc (laptops); phones are unchanged.
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-hdr">
          <h2>{title}</h2>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close">{Icon.x(18)}</button>
        </div>
        {children}
      </div>
    </div>
  );
}

let toastSet = null;
export function Toaster() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    toastSet = setMsg;
    return () => { toastSet = null; };
  }, []);
  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}
export function toast(m) {
  toastSet?.(m);
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

/**
 * Two clear choices: open the camera, or pick from the gallery.
 * (A single "choose file" button hides the camera on some Android phones.)
 */
export function PhotoButtons({ onPick, facing = 'environment', cameraLabel = 'Take a photo', libraryLabel = 'Choose photo', picked }) {
  const camRef = React.useRef();
  const libRef = React.useRef();
  const handle = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onPick(f);
  };
  return (
    <div className="row" style={{ gap: 8 }}>
      <button type="button" className="btn ghost grow" onClick={() => camRef.current.click()}>{Icon.camera()}<span>{cameraLabel}</span></button>
      <button type="button" className="btn ghost grow" onClick={() => libRef.current.click()}><span>{picked ? 'Photo added ✓' : libraryLabel}</span></button>
      <input ref={camRef} type="file" accept="image/*" capture={facing} hidden onChange={handle} />
      <input ref={libRef} type="file" accept="image/*" hidden onChange={handle} />
    </div>
  );
}

export function Loading({ text = 'Loading…' }) {
  return <div className="loading">{text}</div>;
}

/** Checks for a newer version of the app every minute and offers a one-tap update. It never reloads by itself;
 *  with a sheet open or something typed it asks first (lib/unsaved.js). */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => watchTyping(), []);
  useEffect(() => {
    const current = [...document.scripts].map((s) => s.src).find((src) => /\/assets\/index-.*\.js/.test(src));
    if (!current) return undefined;
    const name = current.split('/').pop();
    const check = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}index.html?v=${Date.now()}`, { cache: 'no-store' });
        const html = await res.text();
        const m = html.match(/assets\/(index-[^"']+\.js)/);
        if (m && m[1] !== name) setReady(true);
      } catch { /* offline */ }
    };
    const t = setInterval(check, 60000);
    const vis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', vis);
    check();
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, []);
  if (!ready) return null;
  return (
    <button type="button" onClick={() => updateNow()} style={{ position: 'fixed', top: 'calc(8px + env(safe-area-inset-top, 0px))', left: '50%', transform: 'translateX(-50%)', zIndex: 70, border: 0, borderRadius: 999, padding: '10px 16px', background: 'var(--gold)', color: 'var(--text)', fontWeight: 800, fontSize: 14, boxShadow: '0 4px 14px rgba(0,0,0,.3)' }}>
      New version ready — tap to update
    </button>
  );
}

function HeaderCrest() {
  const { status } = useSession() || {};
  const crest = <GroupCrest size={46} look={status?.look || (status && status.legacy !== false ? { crest_url: 'builtin:lgc' } : null)} name={status?.group_name} />;
  // Tapping the crest goes back to Your groups. Builds without sign-in only do this for someone in more than one
  // group, so L.G.C's live app is unchanged.
  if (!status?.is_member || !(SIGN_IN.length > 0 || (status.groups?.length || 0) > 1)) return crest;
  return <Link to="/groups" aria-label="Your groups" style={{ display: 'block', padding: 1, margin: -1, borderRadius: '50%' }}>{crest}</Link>;
}
