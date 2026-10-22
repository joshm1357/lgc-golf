// Proper sign-in (Stage 2): Google and an emailed 6-digit code, on top of today's phone-only (anonymous) sign-in.
// Hidden until Josh has set the providers up: the build lists them in VITE_SIGN_IN, e.g. "google,email".
// Inside a group, a phone-only person ADDS a sign-in (linkProvider / linkEmail): same user, same scores and groups.
// The front door (signInWith / signInWithEmail) starts or opens an account instead; a phone-only user left behind
// there is never in a group (anyone in one goes straight in and never sees the front door).
import { supabase } from './supabase.js';
import { markFreshSignIn, clearFreshSignIn, rememberReturn } from './home.js';

export const SIGN_IN = String(import.meta.env.VITE_SIGN_IN || '')
  .split(',').map((s) => s.trim()).filter((s) => ['google', 'email', 'facebook'].includes(s));

// Where to come back to after Google or an email link: always the app's own address. A page to go back to (the
// start-a-group wizard, an invite) is kept on the phone and restored on return (App.jsx), never put after a # here.
const back = (hash = '') => {
  if (hash) rememberReturn(hash);
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
};

/** Add Google (or Facebook) to this phone's user — same user, same scores. */
export async function linkProvider(provider, returnHash = '') {
  const { error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo: back(returnHash) } });
  if (error) throw error;
}

/** Add an email to this phone's user; they confirm it from the email. */
export async function linkEmail(email, returnHash = '') {
  const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: back(returnHash) });
  if (error) throw error;
}

/**
 * Sign in (or sign up) from the front door. Same call for a brand-new organiser and for someone on a new phone.
 * Remembers on this phone that they've just signed in, so they land on Your groups when they're back.
 * returnHash brings them back to where they were (e.g. an invite link), not just the home screen.
 */
export async function signInWith(provider, returnHash = '') {
  markFreshSignIn();
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: back(returnHash) } });
  if (error) { clearFreshSignIn(); throw error; }
}
/**
 * Email a 6-digit code. Makes an account if there isn't one yet (new organisers sign up this way).
 * The code is typed into the app: an emailed link would open Safari, not the Home Screen app on iPhone.
 * Both Supabase email templates ("Magic link" for a returning person, "Confirm sign up" for a new one) must
 * include {{ .Token }} — see docs/SIGN-IN-SETUP.md.
 */
export async function signInWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: back(), shouldCreateUser: true } });
  if (error) {
    if (/rate limit|too many|security purposes/i.test(error.message || '')) throw new Error('Too many codes asked for — wait a minute and try again.');
    if (/signups not allowed|signup.*disabled/i.test(error.message || '')) throw new Error('New accounts are switched off at the moment. Open your group’s link instead.');
    throw error;
  }
}
export async function verifyEmailCode(email, token) {
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: String(token).replace(/\s+/g, ''), type: 'email' });
  if (error) {
    if (/expired|invalid/i.test(error.message || '')) throw new Error('That code didn’t work — it may have expired. Ask for a new one.');
    throw error;
  }
  markFreshSignIn();
}

/** After coming back from Google: a problem is reported in the address, not thrown. Read it once and explain it. */
export function signInProblemFromUrl(href = window.location.href) {
  const m = href.match(/[?#&]error_code=([^&#]+)/) || href.match(/[?#&]error=([^&#]+)/);
  if (!m) return null;
  const code = decodeURIComponent(m[1]);
  if (/identity_already_exists/.test(code)) return 'That Google account is already used by another sign-in. Sign out, then sign in with it from the home screen instead.';
  if (/access_denied/.test(code)) return 'Sign-in was cancelled.';
  return 'Sign-in didn’t work — try again.';
}
