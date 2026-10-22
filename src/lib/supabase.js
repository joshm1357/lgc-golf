import { createClient } from '@supabase/supabase-js';
import { currentGroup, scopeRequest } from './group.js';
import { previewOf, blockedWhileViewing, READ_ONLY_MESSAGE } from './preview.js';

// These two values are public by design (they ship in every browser).
// The data is protected by group membership (joined by link) and Row Level Security in the database.
// A test build can point at the staging database instead (VITE_SUPABASE_URL / VITE_SUPABASE_KEY);
// the live app uses the L.G.C database below.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://luogyzvrbedmicjejilr.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_uNBEcPawkDZHYGeubyYyag_MwhYkhR7';

/** Every database request says which group it's for (see group.js). Photos and functions are left alone. */
function groupFetch(input, init = {}) {
  const g = currentGroup();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url;
  // Viewing as a player (preview.js): read only. Any change is refused here, before it leaves the phone.
  const viewing = previewOf();
  if (viewing) {
    const m = (init.method || (typeof input === 'object' && !(input instanceof URL) && input.method) || 'GET').toUpperCase();
    if (blockedWhileViewing(url, m, viewing)) {
      return Promise.resolve(new Response(JSON.stringify({ message: READ_ONLY_MESSAGE(viewing.name), code: 'VIEWING' }),
        { status: 403, headers: { 'content-type': 'application/json' } }));
    }
  }
  if (!g || !url || !url.includes('/rest/v1/')) return fetch(input, init);
  const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
  const scoped = scopeRequest(url, method, g);
  const headers = new Headers(init.headers || (typeof input === 'object' && !(input instanceof URL) ? input.headers : undefined));
  headers.set('x-group-id', scoped.header);
  return fetch(scoped.url, { ...init, method, headers });
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lgc-auth' },
  global: { fetch: groupFetch },
  // No built-in retries: on a golf course they turn a lost signal into a 7-second freeze. The app
  // re-loads by itself when signal returns, and score saves have their own queue (offline.js).
  db: { retry: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

/** Turn a Supabase error into a plain-English message. */
export function friendlyError(err) {
  if (!err) return '';
  if (typeof Event !== 'undefined' && err instanceof Event) return "Couldn't read that photo — try a different one.";
  const msg = err.message || String(err);
  if (/anonymous sign-ins are disabled/i.test(msg)) {
    return 'Sign-in is switched off in Supabase. Ask Josh to turn on "Allow anonymous sign-ins".';
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'No signal — try again in a moment.';
  if (/row-level security|permission denied/i.test(msg)) return "You're not allowed to do that.";
  return msg.replace(/^.*?ERROR:\s*/, '');
}
