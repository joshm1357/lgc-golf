// Each group's look (Stage 4): two colours, a heading font, a crest and a short name — from the database
// (my_status().look). The app's colours are CSS variables, so a group's look is applied by setting them.
//
// Readability: headers are white text on the main colour, and gold-style buttons put main-colour text on the accent
// colour. Both pairs must pass a contrast check good enough for a phone in sunlight (WCAG 4.5:1 for normal text).

export const DEFAULT_LOOK = { short_name: null, crest_url: null, primary: '#1F4B33', accent: '#E0B84A', font: 'condensed' };
export const LGC_LOOK = { short_name: 'L.G.C', crest_url: 'builtin:lgc', primary: '#1C2B3F', accent: '#D9A521', font: 'condensed' };

export const FONTS = {
  condensed: { label: 'Condensed (sporty)', css: "'Barlow Condensed', 'Arial Narrow', sans-serif" },
  plain: { label: 'Plain', css: "'Barlow', system-ui, sans-serif" },
  old_english: { label: 'Old English (clubhouse)', css: "'Pirata One', Georgia, serif" },
  serif: { label: 'Classic serif', css: "Georgia, 'Times New Roman', serif" },
};

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
  if (contrast(primary, accent) < 4.5) out.push('The two colours are too alike — buttons would be hard to read. Pick a lighter accent or a darker main colour.');
  return out;
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
    '--on-navy-muted': mix(primary, '#FFFFFF', 0.76),
    '--display': (FONTS[l.font] || FONTS.condensed).css,
  };
}

const KEY = 'lgc-look';
/** Paint the app in a group's look, and remember it so the next start doesn't flash the wrong colours. */
export function applyLook(look) {
  if (typeof document === 'undefined') return;
  const vars = themeVars(look);
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', vars['--navy']);
  try { localStorage.setItem(KEY, JSON.stringify(look || null)); } catch { /* fine */ }
}
/** The look this phone used last time (painted at start, before the database answers). */
export function savedLook() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
