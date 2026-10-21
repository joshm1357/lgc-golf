// Keyboard shortcuts on a laptop (Stage 11c, full desktop). Pure functions, tested in shortcuts.test.js; the
// listener and the "?" list are in components/Shortcuts.jsx. Phones never see any of this.
//
//   ?        show the list of shortcuts
//   /        find a screen or a player
//   g then t the Trip desk          g then l  the leaderboard
//   g then p players & handicaps    g then c  paper cards
//   n        new (a cost on the Trip desk, a player on the players table)
//   Esc      close whatever is open

export const SHORTCUTS = [
  { keys: ['?'], does: 'Show this list' },
  { keys: ['/'], does: 'Find a screen or a player' },
  { keys: ['g', 't'], does: 'Go to the Trip desk' },
  { keys: ['g', 'l'], does: 'Go to the leaderboard' },
  { keys: ['g', 'p'], does: 'Go to players & handicaps' },
  { keys: ['g', 'c'], does: 'Go to paper cards' },
  { keys: ['n'], does: 'New — a cost on the Trip desk, a player on the players table' },
  { keys: ['Esc'], does: 'Close whatever is open' },
];

const GO = { t: '/desk', l: '/', p: '/desk/players', c: '/desk/cards' };
const WAIT = 1500; // ms to press the second key of "g t"

/** Is the keyboard busy typing into something? (Then shortcuts stay out of the way.) */
export function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(String(el.type || 'text').toLowerCase());
}

/**
 * One key press → what to do. state = { prefix, at } from the last call (or {}).
 * key: the KeyboardEvent key; mods: { ctrl, meta, alt }; now: ms.
 * Returns { state, action } — action: null | { type: 'help' | 'search' | 'new' | 'close' } | { type: 'go', to }.
 */
export function nextKey(state = {}, key, { ctrl = false, meta = false, alt = false, typing = false } = {}, now = Date.now()) {
  if (ctrl || meta || alt) return { state: {}, action: null };
  if (key === 'Escape') return { state: {}, action: { type: 'close' } };
  if (typing) return { state: {}, action: null };
  if (state.prefix === 'g' && now - state.at <= WAIT) {
    const to = GO[String(key).toLowerCase()];
    return { state: {}, action: to ? { type: 'go', to } : null };
  }
  if (key === 'g' || key === 'G') return { state: { prefix: 'g', at: now }, action: null };
  if (key === '?') return { state: {}, action: { type: 'help' } };
  if (key === '/') return { state: {}, action: { type: 'search' } };
  if (key === 'n' || key === 'N') return { state: {}, action: { type: 'new' } };
  return { state: {}, action: null };
}

/**
 * The "/" finder: screens and players matching what's typed, best first (starts-with beats contains), at most `max`.
 * items: [{ label, to, kind, words? }]
 */
export function findItems(items, query, max = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items.slice(0, max);
  const scored = [];
  for (const it of items) {
    const hay = [it.label, ...(it.words || [])].join(' ').toLowerCase();
    const parts = hay.split(/[^a-z0-9]+/);
    const score = hay.startsWith(q) ? 0 : parts.some((p) => p.startsWith(q)) ? 1 : hay.includes(q) ? 2 : -1;
    if (score >= 0) scored.push({ it, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.it.label.localeCompare(b.it.label)).slice(0, max).map((x) => x.it);
}
