// Each group's look (Stage 4): two colours, a heading font, a crest and a short name — from the database
// (my_status().look). The app's colours are CSS variables, so a group's look is applied by setting them.
//
// Readability (checked for a phone in sunlight, WCAG 4.5:1 for normal text):
//  - headers are white text on the main colour;
//  - gold-style buttons and finished-hole dots put the dark text colour (--text) on the accent colour;
//  - year labels and winner labels put accent text on the main colour;
//  - avatars and hole dots put white on the lightest in-between shade (--navy-3) — 3:1, they're big and bold.
// The muted header text (--on-navy-muted) is worked out so it always passes. The server only checks the format of the
// colours (set_group_look); the app refuses to save an unreadable pair.

export const DEFAULT_LOOK = { short_name: null, crest_url: null, primary: '#1F4B33', accent: '#E0B84A', font: 'condensed' };
export const LGC_LOOK = { short_name: 'L.G.C', crest_url: 'builtin:lgc', primary: '#1C2B3F', accent: '#D9A521', font: 'condensed' };

export const FONTS = {
  condensed: { label: 'Condensed (sporty)', css: "'Barlow Condensed', 'Arial Narrow', sans-serif" },
  plain: { label: 'Plain', css: "'Barlow', system-ui, sans-serif" },
  old_english: { label: 'Old English (clubhouse)', css: "'Pirata One', Georgia, serif" },
  serif: { label: 'Classic serif', css: "Georgia, 'Times New Roman', serif" },
};

export const TEXT = '#15202E'; // styles.css --text
const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (s) => HEX.test(String(s || ''));

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
/** Mix a colour with another (0 = all a, 1 = all b). */
export function mix(a, b, t) {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}
/** WCAG relative luminance. */
export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio, 1–21. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Problems with a pair of colours, in plain words (empty = fine). */
export function lookProblems({ primary, accent }) {
  const out = [];
  if (!isHex(primary) || !isHex(accent)) return ['Pick both colours.'];
  if (contrast('#FFFFFF', primary) < 4.5) out.push('The main colour is too light — white writing on it would be hard to read in the sun. Pick a darker one.');
  if (contrast(TEXT, accent) < 4.5) out.push('The accent colour is too dark — the writing on buttons would be hard to read. Pick a lighter accent.');
  if (contrast(primary, accent) < 4.5) out.push('The two colours are too alike — accent writing on the main colour would be hard to read. Pick a lighter accent or a darker main colour.');
  if (!out.length && contrast('#FFFFFF', mix(primary, '#FFFFFF', 0.22)) < 3) out.push('The main colour is a little too light for the round badges. Pick a slightly darker one.');
  return out;
}

/** A soft, readable text colour on the main colour: mixed towards white until it passes 4.5:1. */
export function mutedOn(primary) {
  for (let t = 0.76; t < 1; t += 0.02) {
    const c = mix(primary, '#FFFFFF', t);
    if (contrast(c, primary) >= 4.5) return c;
  }
  return '#FFFFFF';
}

/** The CSS variables for a look. */
export function themeVars(look) {
  const l = { ...DEFAULT_LOOK, ...(look || {}) };
  const primary = isHex(l.primary) ? l.primary : DEFAULT_LOOK.primary;
  const accent = isHex(l.accent) ? l.accent : DEFAULT_LOOK.accent;
  // L.G.C's in-between shades were hand-picked: keep them exactly (styles.css values).
  if (primary.toUpperCase() === LGC_LOOK.primary && accent.toUpperCase() === LGC_LOOK.accent) {
    return { '--navy': '#1C2B3F', '--navy-2': '#2E4561', '--navy-3': '#3C5676', '--gold': '#D9A521', '--gold-soft': '#FFF6DC',
      '--on-navy-muted': '#C3CCD8', '--display': (FONTS[l.font] || FONTS.condensed).css };
  }
  return {
    '--navy': primary,
    '--navy-2': mix(primary, '#FFFFFF', 0.12),
    '--navy-3': mix(primary, '#FFFFFF', 0.22),
    '--gold': accent,
    '--gold-soft': mix(accent, '#FFFFFF', 0.86),
    '--on-navy-muted': mutedOn(primary),
    '--display': (FONTS[l.font] || FONTS.condensed).css,
  };
}

const KEY = 'lgc-look';
const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';

/** The app's name on this phone (tab, app switcher, Home Screen title) for a look. */
export function appTitle(look, name) {
  if (look?.crest_url === 'builtin:lgc') return { title: 'L.G.C Golf', short: 'L.G.C' };
  const short = look?.short_name || name || 'The Golf Trip';
  return { title: name || look?.short_name || 'The Golf Trip', short: short.length > 12 ? 'Golf Trip' : short };
}
/** The Home Screen icon for a look: the uploaded crest, L.G.C's, or the plain one. */
export function appIcon(look) {
  if (look?.crest_url === 'builtin:lgc') return `${BASE}brand/icon-192.png`;
  if (look?.crest_url) return look.crest_url;
  return `${BASE}brand/trip-192.png`;
}

function setHead(look, name) {
  const vars = themeVars(look);
  const { title, short } = appTitle(look, name);
  document.title = title;
  const set = (sel, attr, val) => { const el = document.querySelector(sel); if (el) el.setAttribute(attr, val); };
  set('meta[name="theme-color"]', 'content', vars['--navy']);
  set('meta[name="apple-mobile-web-app-title"]', 'content', short);
  set('link[rel="apple-touch-icon"]', 'href', appIcon(look));
  set('link[rel="icon"]', 'href', look?.crest_url === 'builtin:lgc' ? `${BASE}brand/icon.svg` : look?.crest_url || `${BASE}brand/trip-icon.svg`);
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
}

/** Paint the app in a group's look, and remember it so the next start doesn't flash the wrong colours. */
export function applyLook(look, name) {
  if (typeof document === 'undefined') return;
  setHead(look, name);
  try { localStorage.setItem(KEY, JSON.stringify(look ? { ...look, name: name || look.name || null } : null)); } catch { /* fine */ }
}
/** Show a look without remembering it (an invite to a group you're not in yet). */
export function paintLook(look, name) {
  if (typeof document !== 'undefined') setHead(look, name);
}
/** Back to the plain look and forget the saved one (signed out, or no longer in a group). */
export function clearLook() {
  if (typeof document === 'undefined') return;
  setHead(DEFAULT_LOOK, null);
  try { localStorage.removeItem(KEY); } catch { /* fine */ }
}
/** The look this phone used last time (painted at start, before the database answers). */
export function savedLook() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
