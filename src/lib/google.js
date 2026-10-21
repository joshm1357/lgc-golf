// Google's own "Sign in with Google" button (Google Identity Services), so Google shows our app, not the Supabase
// project's address. Google gives the app a signed token and Supabase checks it (signInWithIdToken): no trip away
// from the app, so nothing to come back to (which also suits the iPhone Home Screen app).
//
// Only on addresses Google has been told about (Google Cloud → the client's "Authorised JavaScript origins"), listed
// in infra/cloudflare.json → google.button_hosts. Google doesn't allow wildcards, so any other test link or a laptop
// uses the older redirect instead. The button also falls back to the redirect if Google's script can't load.
// Google's script loads only when a sign-in button is on screen.

export const GOOGLE_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
export const GOOGLE_HOSTS = String(import.meta.env.VITE_GOOGLE_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
const SCRIPT = 'https://accounts.google.com/gsi/client';

/** Can Google's own button be used on this address? */
export function googleButtonHere(host = typeof location !== 'undefined' ? location.hostname : '', clientId = GOOGLE_CLIENT_ID, hosts = GOOGLE_HOSTS) {
  if (!clientId || !/\.apps\.googleusercontent\.com$/.test(clientId)) return false;
  return hosts.includes(String(host || '').toLowerCase());
}

/** A random one-time value; Google gets its SHA-256 (hex) and Supabase the original, so a token can't be replayed. */
export async function makeNonce(cryptoObj = globalThis.crypto) {
  const bytes = cryptoObj.getRandomValues(new Uint8Array(24));
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await cryptoObj.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return { raw, hashed };
}

let loading = null;
/** Load Google's script once. Resolves with google.accounts.id, or rejects after 8 seconds. */
export function loadGoogle() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT;
      s.async = true;
      const t = setTimeout(() => { loading = null; reject(new Error('Google took too long')); }, 8000);
      s.onload = () => { clearTimeout(t); window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google didn’t load')); };
      s.onerror = () => { clearTimeout(t); loading = null; s.remove(); reject(new Error('Google didn’t load')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}
