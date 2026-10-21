// Small helpers shared by the planner, Rulebook and other screens: run an action with a busy flag
// and a toast, and turn a Supabase reply into data-or-throw.
import { useCallback, useState } from 'react';
import { friendlyError } from './supabase.js';
import { toast } from '../components/ui.jsx';

export function useRun() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, ok) => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toast(friendlyError(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, run];
}

/** Insert or throw. */
export async function must(q) {
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

