// Proper sign-in (Stage 2): Google and an emailed link, on top of today's phone-only (anonymous) sign-in.
// Hidden until Josh has set the providers up: the build lists them in VITE_SIGN_IN, e.g. "google,email".
// A phone-only person who signs in properly is LINKED to the same user, so they keep their scores and groups.
import { supabase } from './supabase.js';

export const SIGN_IN = String(import.meta.env.VITE_SIGN_IN || '')
  .split(',').map((s) => s.trim()).filter((s) => ['google', 'email', 'facebook'].includes(s));

// Where to come back to after Google or an email link (the start-a-group wizard passes its own page).
const back = (hash = '') => `${window.location.origin}${import.meta.env.BASE_URL}${hash}`;

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

/** On a new phone: sign in to an existing account. */
export async function signInWith(provider) {
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: back() } });
  if (error) throw error;
}
export async function signInWithEmail(email) {
  // Only for people who already have an account (shouldCreateUser false); the email carries a 6-digit code
  // (the Supabase email template must include {{ .Token }} — see docs/SIGN-IN-SETUP.md).
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: back(), shouldCreateUser: false } });
  if (error) {
    if (/signups not allowed|not found/i.test(error.message || '')) throw new Error('No account uses that email yet — on your old phone, add your email in More → Group & invites first.');
    throw error;
  }
}
export async function verifyEmailCode(email, token) {
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'email' });
  if (error) throw error;
}

/** After coming back from Google: a problem is reported in the address, not thrown. Read it once and explain it. */
export function signInProblemFromUrl(href = window.location.href) {
  const m = href.match(/[?#&]error_code=([^&#]+)/) || href.match(/[?#&]error=([^&#]+)/);
  if (!m) return null;
  const code = decodeURIComponent(m[1]);
  if (/identity_already_exists/.test(code)) return 'That Google account is already used by another sign-in. Sign in with it on the Join screen instead.';
  if (/access_denied/.test(code)) return 'Sign-in was cancelled.';
  return 'Sign-in didn’t work — try again.';
}

/** Signed in with Google on a new phone, but that made a brand-new empty account (it was never added on the old phone). */
export function isEmptyNewAccount(status, user) {
  return !!user && !user.is_anonymous && !(status?.groups?.length);
}
