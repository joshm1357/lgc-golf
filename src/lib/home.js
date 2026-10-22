// The front door: which screen someone sees before they're inside a group.
// Pure functions (no React, no database) so they can be tested — see home.test.js.
//
// Words: a "group" is a golf group (L.G.C is one). "Signed in" means a proper sign-in (Google or an emailed
// code); a phone-only (anonymous) user is not signed in in this sense.

const FRESH_KEY = 'tgt-fresh-sign-in';
const RETURN_KEY = 'tgt-return-to';
// An app address, optionally with a plain query ("#/join/CODE?to=%2Fplan%2F…" — a shared link, 083; or the older
// "?vote=<id>", 080). Nothing else (no "//", no other site).
const SAFE_HASH = /^#\/(?!\/)[A-Za-z0-9/_.~-]*(\?[A-Za-z0-9=&_.~%-]*)?$/;
const FRESH_FOR_MS = 15 * 60 * 1000; // a sign-in left half-done (e.g. Google cancelled) stops counting after 15 minutes

/**
 * Which screen the Gate shows.
 *  - 'join'        the link-first screen: "Open the link from your group chat" (sign-in not switched on in this build)
 *  - 'home'        the new front door: sign in first, or open your group's link
 *  - 'your-groups' the list of groups you're in (or "You're not in a group yet")
 *  - 'inside'      straight into the current group
 */
export function frontDoor({ signInOn, status, fresh = false, hasInvite = false }) {
  const member = !!status?.is_member;
  if (!signInOn) return member ? 'inside' : 'join';
  // An invite link always wins: it's how a guest gets to the first tee without an account.
  if (hasInvite) return member ? 'inside' : 'home';
  const signedIn = !!status?.signed_in;
  const groups = status?.groups || [];
  if (signedIn && !member) return 'your-groups'; // signed in but in no group: "You're not in a group yet"
  if (signedIn && fresh && groups.length > 1) return 'your-groups'; // just signed in, several groups: pick one
  return member ? 'inside' : 'home';
}

/** Remember (on this phone) that someone has just started signing in, so they see Your groups when they're back. */
export function markFreshSignIn(store = safeStore(), now = Date.now()) {
  try { store?.setItem(FRESH_KEY, String(now)); } catch { /* fine: they just go straight into a group */ }
}

/** Has someone just signed in (within the last 15 minutes)? Doesn't clear it. */
export function isFreshSignIn(store = safeStore(), now = Date.now()) {
  try {
    const at = Number(store?.getItem(FRESH_KEY));
    return Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < FRESH_FOR_MS;
  } catch { return false; }
}

/** They've picked a group (or gone in another way): stop showing Your groups. */
export function clearFreshSignIn(store = safeStore()) {
  try { store?.removeItem(FRESH_KEY); } catch { /* ignore */ }
}

/**
 * Where to come back to after Google (an invite link, the start-a-group wizard…). It's kept on the phone rather than
 * in the address sent to Google, because Supabase hands the sign-in back in the address's # part, which a
 * "#/join/CODE" would clash with. Only app addresses like "#/join/ABC" are kept.
 */
export function rememberReturn(hash, store = safeStore(), now = Date.now()) {
  if (!SAFE_HASH.test(String(hash || ''))) return;
  try { store?.setItem(RETURN_KEY, JSON.stringify({ hash, at: now })); } catch { /* fine: they land on the home screen */ }
}
/** Back from signing in: the address to go to (once), or null. */
export function takeReturn(store = safeStore(), now = Date.now()) {
  try {
    const v = JSON.parse(store?.getItem(RETURN_KEY) || 'null');
    store?.removeItem(RETURN_KEY);
    if (!v || !SAFE_HASH.test(String(v.hash || ''))) return null;
    return now - v.at >= 0 && now - v.at < FRESH_FOR_MS ? v.hash : null;
  } catch { return null; }
}

/** Screens that are themselves a choice of where to go (an invite, a personal link, starting a group, a quick round). */
export function choosesItsOwnWay(path) {
  return /^\/(join|me|start|c)(\/|$)/.test(String(path || ''));
}

/** A 6-digit code, ignoring spaces people type or paste in ("123 456"). Returns '' if it isn't one. */
export function cleanEmailCode(text) {
  const digits = String(text || '').replace(/\s+/g, '');
  return /^\d{6}$/.test(digits) ? digits : '';
}

/** Good enough to send a code to (the email server does the real check). */
export function looksLikeEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text || '').trim());
}

export const ROLE_WORD = { organiser: 'Organiser', player: 'Player', guest: 'Guest' };

/** The groups list for Your groups: the one this phone is in now first, then the order you joined them. */
export function groupRows(groups, currentId) {
  const list = Array.isArray(groups) ? groups.filter((g) => g && g.id) : [];
  return list
    .map((g, i) => ({ ...g, i, current: g.id === currentId, roleWord: ROLE_WORD[g.role] || 'Player' }))
    .sort((a, b) => (b.current - a.current) || (a.i - b.i))
    .map(({ i, ...g }) => g);
}

/** A group's crest settings, in the shape GroupCrest takes. L.G.C (legacy) keeps its own crest. */
export function groupLook(g, current = null) {
  if (!g) return null;
  if (g.crest_url) return { crest_url: g.crest_url };
  if (g.legacy) return { crest_url: 'builtin:lgc' };
  // A database without 045 sends no crest in the list: for the group this phone is in, use its own look.
  if (g.current && current && g.legacy === undefined) {
    if (current.look?.crest_url) return { crest_url: current.look.crest_url };
    if (current.legacy) return { crest_url: 'builtin:lgc' };
  }
  return null;
}

function safeStore() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
