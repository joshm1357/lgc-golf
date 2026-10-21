import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Is this person a platform admin (Josh)? Asked once per app open (am_platform_admin, 057). Any problem — an older
// database without the function, no signal — means no, so the Wishes link simply doesn't show. The database checks
// again inside admin_connector_stats and admin_wishes, so hiding the link is only tidiness, not the lock.
let asked = null;
export function usePlatformAdmin() {
  const [yes, setYes] = useState(false);
  useEffect(() => {
    let live = true;
    if (!asked) {
      asked = Promise.resolve(supabase.rpc('am_platform_admin'))
        .then(({ data, error }) => !error && data === true, () => false);
    }
    asked.then((v) => { if (live) setYes(v); });
    return () => { live = false; };
  }, []);
  return yes;
}

/** The More-screen entry for the Wishes screen (only for Josh). */
export const wishesItem = (icon) => ({ to: '/wishes', icon, label: 'Wishes', sub: 'What organisers ask their assistant for' });
