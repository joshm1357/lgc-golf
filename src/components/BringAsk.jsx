// "I'll bring it" right on the Feed post (ov25): a "📣 Ask the group" post from the run-up's What to bring lists the
// things nobody's claimed yet; each gets a button here. Claimed ones show who's bringing them.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName } from '../lib/store.jsx';
import { toast } from './ui.jsx';
import { bringEmoji } from '../lib/runup.js';

export function BringAsk({ planId }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data: rows, error } = await supabase.from('plan_items').select('id,title,owner_id,bring_shared').eq('plan_id', planId).eq('kind', 'bring');
    setItems(error ? [] : (rows || []).filter((i) => i.bring_shared));
  }, [planId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['plan_items'], load);
  if (!items?.length) return null;
  const claim = async (it) => {
    setBusy(true);
    const { error } = await supabase.rpc('runup_claim_bring', { p_item: it.id, p_on: true });
    setBusy(false);
    if (error) toast(friendlyError(error));
    else { toast(`You’re bringing the ${it.title.toLowerCase()}`); load(); }
  };
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="bring-ask">
      {items.map((it) => {
        const who = it.owner_id ? data.playersById[it.owner_id] : null;
        return (
          <div key={it.id} className="row" style={{ gap: 8, minHeight: 40 }}>
            <span aria-hidden="true">{bringEmoji(it.title)}</span>
            <span className="grow" style={{ fontWeight: 700 }}>{it.title}</span>
            {who ? <span className="small muted">{it.owner_id === me ? 'You’re bringing it' : `${playerName(who).split(' ')[0]}’s bringing it`}</span>
              : me && status.role !== 'guest' && <button type="button" className="btn gold sm" disabled={busy} data-testid="bring-ask-claim" onClick={() => claim(it)}>I’ll bring it</button>}
          </div>
        );
      })}
    </div>
  );
}
