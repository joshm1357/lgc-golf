// Stage 1 (the L.G.C beta, 20 Oct 2026): the bits that only exist while the app is in beta.
// - NEW_GROUPS: can anyone start a group on this build? Off on live until Stage 2 (friends' beta). The database
//   refuses new groups too (047), so hiding the buttons is a courtesy, not the lock.
// - Feedback ("Tell Josh"): what someone types, plus the screen and app version, so Josh can find the problem.
// - What's new: shown once per phone after the move to The Golf Trip.
// - Install on a computer: Chrome and Edge offer it; we keep their offer so a button in More can use it.

export const NEW_GROUPS = String(import.meta.env.VITE_NEW_GROUPS || '').trim() === 'on';

export const FEEDBACK_KINDS = [
  { value: 'idea', label: 'Idea' },
  { value: 'problem', label: 'Something’s wrong' },
  { value: 'like', label: 'Like it' },
];
export const FEEDBACK_MAX = 1000;

/** Tidy what someone typed and say what's wrong with it, if anything. Returns { text, error }. */
export function checkFeedback(kind, message) {
  const text = String(message || '').replace(/\r\n/g, '\n').trim();
  if (!FEEDBACK_KINDS.some((k) => k.value === kind)) return { text, error: 'Pick what kind of feedback it is' };
  if (text.length < 3) return { text, error: 'Type a few words first' };
  if (text.length > FEEDBACK_MAX) return { text, error: `That’s ${text.length} characters — keep it under 1,000` };
  return { text, error: '' };
}

// Bump this when there's something new worth a note; each phone sees each note once.
export const WHATS_NEW_ID = 'beta-1';
export const WHATS_NEW = [
  { title: 'Trips', body: 'The Trips tab replaces Coming up. Every trip goes from idea to votes to locked in to the record, with past trips kept.' },
  { title: 'Sign in once, any phone', body: 'Sign in with Google or an emailed code. Your scores and history follow you to a new phone.' },
  { title: 'On your laptop', body: 'Open the app on a computer for a bigger layout, and install it from Chrome or Edge.' },
  { title: 'Tell Josh', body: 'It’s a beta. Anything broken, annoying or missing: More → Tell Josh.' },
];
const SEEN_KEY = 'tgt-whats-new';

/** Show the note? Only on builds with sign-in (the new app), once per phone. */
export function shouldShowWhatsNew({ signInOn, seen, id = WHATS_NEW_ID }) {
  return !!signInOn && seen !== id;
}
export function whatsNewSeen() {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}
export function markWhatsNewSeen(id = WHATS_NEW_ID) {
  try { localStorage.setItem(SEEN_KEY, id); } catch { /* private window: it just shows again next time */ }
}

/** Screen sizes (the same numbers as styles.css). */
export const WIDE = 768;
export const DESKTOP = 1024;

// ---- Install on this computer (Chrome and Edge fire beforeinstallprompt; Safari and Firefox don't) ----
let offer = null;
const listeners = new Set();
const tell = () => listeners.forEach((f) => f(!!offer));
export function watchInstallOffer() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Phones keep Chrome's own "Add to Home screen" prompt; only on a computer do we hold it for the button in More.
    let computer = false;
    try { computer = window.matchMedia(`(min-width: ${DESKTOP}px) and (pointer: fine)`).matches; } catch { /* phone */ }
    if (!computer) return;
    e.preventDefault(); offer = e; tell();
  });
  window.addEventListener('appinstalled', () => { offer = null; tell(); });
}
export function canInstall() { return !!offer; }
export function onInstallOffer(f) { listeners.add(f); return () => listeners.delete(f); }
export async function install() {
  if (!offer) return false;
  const e = offer;
  offer = null; tell();
  e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}
/** Already running as an installed app (its own window or from the Home Screen)? */
export function isInstalled() {
  try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch { return false; }
}
