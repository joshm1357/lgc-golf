// Proper sign-in (Stage 2): Google and an emailed 6-digit code, on top of today's phone-only (anonymous) sign-in.
// Hidden until Josh has set the providers up: the build lists them in VITE_SIGN_IN, e.g. "google,password"
// (email + password, 22 Oct) or "google,email" (an emailed code every time — staging before 22 Oct).
// Inside a group, a phone-only person ADDS a sign-in (linkProvider / linkEmail): same user, same scores and groups.
// The front door (signInWith / signInWithEmail) starts or opens an account instead; a phone-only user left behind
// there is never in a group (anyone in one goes straight in and never sees the front door).
import { supabase } from './supabase.js';
import { markFreshSignIn, clearFreshSignIn, rememberReturn } from './home.js';

export const SIGN_IN = String(import.meta.env.VITE_SIGN_IN || '')
  .split(',').map((s) => s.trim()).filter((s) => ['google', 'email', 'password', 'facebook'].includes(s));

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

// ------------------------------------------------------------------ Email and password (22 Oct, Josh)
// "Save your spot": a phone-only (anonymous) user adds an email and password to the SAME user, so their group and
// player stay. First the email (updateUser): if the project confirms emails, Supabase emails a 6-digit code
// ("Change email address" template, {{ .Token }}) that is typed in here (verifyOtp type 'email_change'); if it
// doesn't, the email is set straight away. Then the password: Supabase only lets an anonymous user set a password
// once it has an email, so it's two steps either way.
const cleanToken = (t) => String(t).replace(/\s+/g, '');

/** Step 1 of saving your spot with an email (and password). → 'done' (no code needed) | 'code'. */
export async function linkEmailPassword(email, password) {
  const e = email.trim();
  const { data, error } = await supabase.auth.updateUser({ email: e }, { emailRedirectTo: back() });
  if (error) throw error;
  const u = data?.user;
  const setNow = !!u && String(u.email || '').toLowerCase() === e.toLowerCase() && !u.new_email;
  if (!setNow) return 'code';
  if (password) await setPassword(password);
  return 'done';
}
/** Step 2: the code from the email, then the password. Same user throughout. */
export async function confirmLinkCode(email, token, password) {
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: cleanToken(token), type: 'email_change' });
  if (error) throw error;
  if (password) await setPassword(password);
}
export async function setPassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}
/** Link Google with Google's own button: no trip away from the app (suits the iPhone Home Screen app). */
export async function linkGoogleToken(token, nonce) {
  const { error } = await supabase.auth.linkIdentity({ provider: 'google', token, nonce });
  if (error) throw error;
}

/** Sign in on a new phone or laptop with email + password. */
export async function signInPassword(email, password) {
  markFreshSignIn();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) { clearFreshSignIn(); throw error; }
}
/** A new account (e.g. a new organiser). → 'in' (signed in) | 'code' (confirm the email with the 6-digit code first). */
export async function signUpPassword(email, password) {
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: back() } });
  if (error) throw error;
  // An email that already has an account comes back as a user with no identities (Supabase hides who's registered).
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw Object.assign(new Error('User already registered'), { code: 'user_already_exists' });
  }
  if (data?.session) { markFreshSignIn(); return 'in'; }
  return 'code';
}
export async function confirmSignUpCode(email, token) {
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: cleanToken(token), type: 'signup' });
  if (error) throw error;
  markFreshSignIn();
}
/** Not confirmed yet: send the confirm code again. */
export async function resendSignUpCode(email) {
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: back() } });
  if (error) throw error;
}
/** Forgot password: a 6-digit code by email ("Reset password" template, {{ .Token }}), then a new password. */
export async function sendResetCode(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: back() });
  if (error) throw error;
}
export async function resetWithCode(email, token, password) {
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: cleanToken(token), type: 'recovery' });
  if (error) throw error;
  markFreshSignIn();
  await setPassword(password);
}

/** After coming back from Google: a problem is reported in the address, not thrown. Read it once and explain it. */
export function signInProblemFromUrl(href = window.location.href) {
  const m = href.match(/[?#&]error_code=([^&#]+)/) || href.match(/[?#&]error=([^&#]+)/);
  if (!m) return null;
  const code = decodeURIComponent(m[1]);
  if (/identity_already_exists/.test(code)) return 'That Google account is already signed in as someone else — use Sign in instead.';
  if (/access_denied/.test(code)) return 'Sign-in was cancelled.';
  return 'Sign-in didn’t work — try again.';
}
