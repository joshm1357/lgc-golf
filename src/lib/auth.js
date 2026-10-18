// Proper sign-in (Stage 2): Google and an emailed link, on top of today's phone-only (anonymous) sign-in.
// Hidden until Josh has set the providers up: the build lists them in VITE_SIGN_IN, e.g. "google,email".
// A phone-only person who signs in properly is LINKED to the same user, so they keep their scores and groups.
import { supabase } from './supabase.js';

export const SIGN_IN = String(import.meta.env.VITE_SIGN_IN || '')
  .split(',').map((s) => s.trim()).filter((s) => ['google', 'email', 'facebook'].includes(s));

const back = () => `${window.location.origin}${import.meta.env.BASE_URL}`;

/** Add Google (or Facebook) to this phone's user — same user, same scores. */
export async function linkProvider(provider) {
  const { error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo: back() } });
  if (error) throw error;
}

/** Add an email to this phone's user; they confirm it from the email. */
export async function linkEmail(email) {
  const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: back() });
  if (error) throw error;
}

/** On a new phone: sign in to an existing account. */
export async function signInWith(provider) {
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: back() } });
  if (error) throw error;
}
export async function signInWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: back(), shouldCreateUser: false } });
  if (error) throw error;
}
