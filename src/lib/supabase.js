import { createClient } from '@supabase/supabase-js';

// These two values are public by design (they ship in every browser).
// The data is protected by the group PIN and Row Level Security in the database.
export const SUPABASE_URL = 'https://luogyzvrbedmicjejilr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uNBEcPawkDZHYGeubyYyag_MwhYkhR7';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lgc-auth' },
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
