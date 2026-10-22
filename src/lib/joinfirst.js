// Sign in first, as part of joining (ov13, 22 Oct 2026). Josh: "That seems weird that I need Save my spot in addition
// to signing in with Google. When you sign in with Google surely it's connected to that account?"
//
// Plain words:
//   - Opening any join link (invite, team, organiser) on a phone or laptop that isn't signed in shows ONE screen first:
//     "Join <group> — sign in so it's you on any phone or laptop". Continue with Google, Email + password, or a small
//     "Just this phone for now" (the old phone-only way; Save your spot stays for those people).
//   - After signing in, the link is used by the SIGNED-IN account, then pick your name → notifications → the page.
//   - Already in that group with a name: straight to the page ("Welcome back, Josh"). In it with no name: pick one.
//
// Pure functions (plus two small notes kept on the phone for this tab). Tested in joinfirst.test.js.

const JOIN_KEY = 'tgt-join-after-sign-in';
const WELCOME_KEY = 'tgt-welcome-back';
const FOR_MS = 15 * 60 * 1000; // a sign-in left half-done (e.g. Google cancelled) stops counting after 15 minutes

/**
 * What a join link shows first.
 *  'sign-in' the sign-in-first screen (sign-in is on in this build, nobody is signed in, they haven't chosen "Just this
 *            phone")
 *  'join'    the join screen as before (signed in already, sign-in off in this build, or "Just this phone")
 */
export function joinDoor({ signInOn, signedIn, phoneOnly = false }) {
  if (!signInOn || signedIn || phoneOnly) return 'join';
  return 'sign-in';
}

/**
 * The email form that works out which: sign in, or (no account with that email and password) offer to make one.
 * After a sign-in attempt fails, which step comes next?
 *  'code'     signed up but never confirmed: the 6-digit code
 *  'no-match' no account with that email and password: "Create my account" or "Forgot password?"
 *  'problem'  anything else: just say it
 */
export function afterSignInTry(problem) {
  if (problem?.action === 'code') return 'code';
  if (problem?.action === 'forgot') return 'no-match';
  return 'problem';
}

/** What a join link that won't work says on the sign-in screen (state from used_link_info, 086). */
export function deadLinkWords(state) {
  if (state === 'used') return { title: 'This link’s already been used', body: 'If that was you, sign in below.', signIn: true };
  if (state === 'expired') return { title: 'This link has run out', body: 'Ask your organiser for a new one. If you used it before, sign in below.', signIn: true };
  return { title: 'That link isn’t working', body: 'Check you copied all of it, or ask for a new one in the group chat. Been in before? Sign in below.', signIn: true };
}

/** The line under a name someone else has already picked. */
export function takenHelp(signInOn) {
  return signInOn
    ? 'That’s you on another phone? Sign in there and connect Google or email, then sign in here.'
    : 'That’s you on another phone? Open your profile there and tap “Copy my link”, then open that link here.';
}

/** "You're signed in but not in a group yet" (never a blank app). */
export function noGroupWords(email) {
  const who = String(email || '').trim();
  return {
    title: 'You’re not in a group yet',
    body: who
      ? `You’re signed in as ${who} but not in a group yet. Open your group’s link (paste it here) and you’ll join as this account.`
      : 'You’re signed in but not in a group yet. Open your group’s link (paste it here) and you’ll join as this account.',
  };
}

/** "Welcome back, Josh" — the name to greet with (nickname first). */
export function welcomeName(player) {
  const n = String(player?.nickname || '').trim() || String(player?.name || '').trim().split(/\s+/)[0] || '';
  return n ? `Welcome back, ${n}` : 'Welcome back';
}

// ------------------------------------------------------------------ Notes kept on the phone (this tab only)

/** They started signing in from this join link: once they're back signed in, join straight away (no extra tap). */
export function markJoinAfterSignIn(code, store = safeStore(), now = Date.now()) {
  if (!code) return;
  try { store?.setItem(JOIN_KEY, JSON.stringify({ code: String(code).toUpperCase(), at: now })); } catch { /* fine: they tap Join */ }
}
/** Is there a join waiting for this code? Doesn't clear it. */
export function joinAfterSignIn(code, store = safeStore(), now = Date.now()) {
  try {
    const v = JSON.parse(store?.getItem(JOIN_KEY) || 'null');
    if (!v || !code || v.code !== String(code).toUpperCase()) return false;
    return now - v.at >= 0 && now - v.at < FOR_MS;
  } catch { return false; }
}
export function clearJoinAfterSignIn(store = safeStore()) {
  try { store?.removeItem(JOIN_KEY); } catch { /* ignore */ }
}

/** Say "Welcome back" once they're in this group (it may take a reload to get there). */
export function markWelcome(groupId, store = safeStore(), now = Date.now()) {
  if (!groupId) return;
  try { store?.setItem(WELCOME_KEY, JSON.stringify({ g: groupId, at: now })); } catch { /* fine: no greeting */ }
}
/** The greeting is due in this group? Clears it when it is. */
export function takeWelcome(groupId, store = safeStore(), now = Date.now()) {
  try {
    const v = JSON.parse(store?.getItem(WELCOME_KEY) || 'null');
    if (!v || !groupId || v.g !== groupId) return false;
    store?.removeItem(WELCOME_KEY);
    return now - v.at >= 0 && now - v.at < FOR_MS;
  } catch { return false; }
}

function safeStore() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}
