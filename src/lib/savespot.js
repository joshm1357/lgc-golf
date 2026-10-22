// "Save your spot" (22 Oct 2026, Josh: "It should have a reminder to log in via Google or email once when the link is
// opened. Then that's how they log in." and "They need to be able to sign up with email and password.")
//
// Plain words:
//   - Someone joins from the group's link on a phone. The app makes a phone-only (anonymous) user for them and they
//     pick their name. That user is the key to their group and their player.
//   - "Save your spot" asks them, once, to add a proper sign-in to that SAME user: Google, or an email and password.
//     Same user = same group, same name, same scores. Next time, on any phone or laptop, they just tap Sign in.
//   - Asked once as a pop-up (after the notifications one), then a small banner on Home and More until it's done or
//     they've closed the banner twice. Group & invites always has it too.
//
// Pure functions only (no React, no database) — tested in savespot.test.js. The calls to Supabase are in auth.js and
// the screens in components/SaveSpot.jsx.

export const SAVE_KEY = 'tgt-save-spot';
export const BANNER_GAP_MS = 3 * 24 * 60 * 60 * 1000; // a closed banner comes back once, three days later
export const MIN_PASSWORD = 8;
const PENDING_FOR_MS = 15 * 60 * 1000; // a Google trip left half-done stops counting after 15 minutes

/** Which ways in this build offers. SIGN_IN is the list from VITE_SIGN_IN ("google,password", or "google,email"). */
export function signInModes(list = []) {
  const has = (k) => list.includes(k);
  return {
    google: has('google'),
    facebook: has('facebook'),
    // Email + password (Josh, 22 Oct). "email" on its own (staging before 22 Oct) means a 6-digit code every time.
    password: has('password'),
    emailCode: has('email') && !has('password'),
    any: list.length > 0,
  };
}

/** Is this person someone to ask? In a group, with a name, on a phone-only user, not an organiser viewing as them. */
export function canSaveSpot({ signInOn, status }) {
  if (!signInOn || !status?.is_member || !status.player_id) return false;
  if (status.signed_in || status.viewing || status.quick) return false;
  return true;
}

/** Screens where a pop-up would get in the way. */
export function quietPath(path = '/') {
  return path.startsWith('/score/') || path.startsWith('/join/') || path === '/notifications' || path.startsWith('/me/');
}

/** Should the one-time pop-up show now? (The notifications pop-up goes first: the screen waits while it's open.) */
export function shouldAskOnce({ eligible, state, path = '/', offline = false }) {
  if (!eligible || offline || quietPath(path)) return false;
  const s = state || {};
  return !s.asked && !s.done;
}

/** Should the small banner show on Home / More? */
export function shouldShowBanner({ eligible, state, now = Date.now() }) {
  if (!eligible) return false;
  const s = state || {};
  if (s.done || !s.asked) return false; // not before the pop-up has had its turn
  const closed = Number(s.closed || 0);
  if (closed >= 2) return false;
  if (closed === 1 && s.closedAt && now - Number(s.closedAt) < BANNER_GAP_MS) return false;
  return true;
}

/** State changes (each returns a new state). */
export const asked = (state, now = Date.now()) => ({ ...(state || {}), asked: now });
export const closedBanner = (state, now = Date.now()) => ({ ...(state || {}), closed: Number(state?.closed || 0) + 1, closedAt: now });
export const saved = (state) => ({ ...(state || {}), done: true, pending: null });
/** Going to Google: remember it on the phone, so the "Done" note shows when they're back. */
export const goingToGoogle = (state, to = '', now = Date.now()) => ({ ...(state || {}), asked: state?.asked || now, pending: { provider: 'google', to, at: now } });

/** Back in the app after a Google trip: 'done' (now signed in), 'failed' (still phone-only) or null (no trip). */
export function backFromGoogle({ state, signedIn, now = Date.now() }) {
  const p = state?.pending;
  if (!p || !p.at || now - Number(p.at) < 0 || now - Number(p.at) > PENDING_FOR_MS) return null;
  return signedIn ? 'done' : 'failed';
}

/** Password rules, shown as they type. Returns '' when it's fine. */
export function passwordProblem(pw) {
  const s = String(pw || '');
  if (!s) return `At least ${MIN_PASSWORD} characters.`;
  if (s.length < MIN_PASSWORD) return `${MIN_PASSWORD - s.length} more character${MIN_PASSWORD - s.length === 1 ? '' : 's'} — at least ${MIN_PASSWORD}.`;
  if (s.length > 72) return 'That’s too long — 72 characters at most.';
  return '';
}

/**
 * Supabase's sign-in errors in plain words. Returns { message, action } where action (optional) is what the screen
 * can offer next: 'sign-in' (that email already has an account), 'code' (the email isn't confirmed yet: enter the
 * code), 'forgot' (wrong password).
 */
export function authProblem(err, context = 'sign-in') {
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '');
  const is = (codes, re) => codes.includes(code) || (re && re.test(msg));
  if (is(['identity_already_exists'], /identity is already linked|already linked to another user/i)) {
    return { message: 'That Google account is already signed in as someone else — use Sign in instead.', action: 'sign-in' };
  }
  if (is(['email_exists', 'user_already_exists'], /already (been )?registered|already exists|already in use/i)) {
    return { message: 'That email already has an account. Sign in with it instead.', action: 'sign-in' };
  }
  if (is(['invalid_credentials'], /invalid login credentials/i)) {
    return { message: 'That email and password don’t match. Check them, or tap “Forgot password?”.', action: 'forgot' };
  }
  if (is(['email_not_confirmed'], /email not confirmed/i)) {
    return { message: 'That email isn’t confirmed yet — we’ve sent a 6-digit code to finish it.', action: 'code' };
  }
  if (is(['weak_password'], /password should|weak password|password is known/i)) {
    return { message: /known|pwned|leak/i.test(msg) ? 'That password is too easy to guess (it’s been in a leak). Pick another.' : `Pick a longer password — at least ${MIN_PASSWORD} characters.` };
  }
  if (is(['same_password'], /different from the old password/i)) return { message: 'That’s your old password — pick a new one.' };
  if (is(['otp_expired'], /expired|invalid.*(otp|token)|token.*(invalid|expired)/i)) {
    return { message: 'That code didn’t work — it may have expired. Ask for a new one.' };
  }
  if (is(['over_email_send_rate_limit', 'over_request_rate_limit'], /rate limit|too many|security purposes/i)) {
    return { message: 'Too many tries — wait a minute and try again.' };
  }
  if (is(['manual_linking_disabled'], /manual linking/i)) {
    return { message: 'Saving your spot isn’t switched on yet — tell your organiser.' };
  }
  if (is(['email_provider_disabled', 'signup_disabled'], /signups? not allowed|signup.*disabled|email.*disabled/i)) {
    return { message: context === 'sign-up' ? 'New accounts are switched off at the moment. Open your group’s link instead.' : 'Email sign-in is switched off at the moment.' };
  }
  if (is(['validation_failed', 'email_address_invalid'], /unable to validate email|invalid format|email address .* is invalid/i)) {
    return { message: 'That email doesn’t look right — check it and try again.' };
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return { message: 'No signal — try again in a moment.' };
  return { message: msg || 'That didn’t work — try again.' };
}

/** The organiser's "Remind" as a chat message (when a phone notification can't be sent). */
export function signInReminder(name, groupName, link = '') {
  const who = String(name || '').trim() || 'mate';
  const group = String(groupName || '').trim() || 'the group';
  return `G'day ${who}, quick one for ${group} on The Golf Trip: open the app and tap “Save your spot” (your profile in the app) to connect Google or your email. Then you can sign in on your laptop or a new phone — same name, same scores.${link ? ` ${link}` : ''}`;
}

/** Which button an organiser sees for a player who hasn't saved their spot: 'remind' (on the app on a phone) | 'link'. */
export function organiserAction(row) {
  if (row?.signed_in) return null;
  return Number(row?.phones || 0) > 0 ? 'remind' : 'link';
}

/** Reading and writing the state on this phone. Never throws. */
export function readSaveState(store = safeStore()) {
  try { return JSON.parse(store?.getItem(SAVE_KEY) || 'null') || {}; } catch { return {}; }
}
export function writeSaveState(state, store = safeStore()) {
  try { store?.setItem(SAVE_KEY, JSON.stringify(state || {})); } catch { /* private browsing: it may ask again */ }
}

function safeStore() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
