// Running jokes (072): organisers can wipe the slate without ever seeing the jokes. Shown in Group & invites while
// the in_jokes feature is on. The jokes themselves live only in the background (the AI picks them up from the feed and
// trip chat; the replay and commentary use a few at a time) — there is no list anywhere.
import React from 'react';
import { supabase } from '../lib/supabase.js';
import { useFeature } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';

export default function ForgetJokes() {
  const on = useFeature('in_jokes');
  const [busy, run] = useRun();
  if (!on) return null;
  const forget = () => {
    if (!window.confirm('Forget all the running jokes? The Caddie starts fresh from today’s chat. This can’t be undone.')) return;
    run(() => must(supabase.rpc('forget_running_jokes')), 'Running jokes forgotten');
  };
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="forget-jokes">
      <div className="label">Running jokes</div>
      <div className="small muted">
        The Caddie quietly picks up running jokes from the feed and trip chat for commentary and the replay. Nobody sees them
        as a list — not even organisers.
      </div>
      <button type="button" className="btn ghost" disabled={busy} onClick={forget}>Forget the running jokes</button>
    </div>
  );
}
