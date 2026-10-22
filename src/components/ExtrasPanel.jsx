// Optional extras at the start (080, Josh): the organiser ticks what's in, and what goes to the group as "Would you do
// these?" (⭐ Want it · 👍 Happy either way · 👎 Skip it), each with a rough cost each. Extras that are in (or win the
// vote) go into the trip plan budget and, where there's something to book, a job. The list is in lib/extras.js.
import React, { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { startExtras, setExtraState, setExtraCost, addCustomExtra, extrasIn, extrasToVote, extrasToPlan } from '../lib/extras.js';

const STATES = [['off', 'No'], ['in', 'In'], ['vote', 'Ask']];

export default function ExtrasPanel({ plan, st, save, org }) {
  const list = st.extras || startExtras();
  const [own, setOwn] = useState('');
  const [ownPp, setOwnPp] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, run] = useRun();
  const set = (next) => save({ ...st, extras: next });
  const ins = extrasIn(list);
  const asks = extrasToVote(list);
  const addToPlan = (extras) => run(async () => {
    const [{ data: budget }, { data: items }] = await Promise.all([
      supabase.from('plan_budget_items').select('label').eq('plan_id', plan.id),
      supabase.from('plan_items').select('title').eq('plan_id', plan.id),
    ]);
    const r = extrasToPlan(extras, { planId: plan.id, budget: budget || [], items: items || [] });
    if (r.budgetRows.length) await must(supabase.from('plan_budget_items').insert(r.budgetRows));
    if (r.jobRows.length) await must(supabase.from('plan_items').insert(r.jobRows));
    return r.budgetRows.length || r.jobRows.length ? `Added to the trip plan${r.jobRows.length ? ` (+ ${r.jobRows.length} job${r.jobRows.length === 1 ? '' : 's'})` : ''}` : 'Already in the trip plan';
  }).then((m) => m && toast(m));
  return (
    <div className="card pad stack" style={{ gap: 6 }} data-testid="extras">
      <button type="button" className="row between" onClick={() => setOpen(!open)} style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit', font: 'inherit', minHeight: 40 }}>
        <span><strong>🎁 Extras</strong><div className="small muted">{ins.length || asks.length ? `${ins.length} in · ${asks.length} to ask the group` : 'Trophy, shirts, a bus, a dinner out… — optional'}</div></span>
        <span className="small muted">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          <span className="small muted">In = it’s happening. Ask = it goes on the vote as “Would you do these?”.</span>
          {list.map((e) => (
            <div key={e.key} className="stack" style={{ gap: 4, borderTop: '1px solid var(--line-soft)', paddingTop: 6 }} data-testid="extra">
              <div className="row between" style={{ gap: 6 }}>
                <span className="small grow" style={{ fontWeight: 600 }}>{e.label}{e.suggested && <span className="muted"> ✨</span>}</span>
                <input className="input" style={{ width: 70 }} inputMode="numeric" value={e.pp ?? ''} disabled={!org} placeholder="$ each" aria-label={`${e.label} cost each`} onChange={(ev) => set(setExtraCost(list, e.key, ev.target.value))} />
              </div>
              <div className="seg light" role="group" aria-label={e.label}>
                {STATES.map(([k, l]) => <button key={k} type="button" aria-pressed={e.state === k} disabled={!org} onClick={() => set(setExtraState(list, e.key, k))}>{l}</button>)}
              </div>
            </div>
          ))}
          {org && (
            <div className="row" style={{ gap: 6, borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
              <input className="input grow" value={own} maxLength={60} onChange={(e) => setOwn(e.target.value)} placeholder="Your own, e.g. Footy tipping" aria-label="Your own extra" />
              <input className="input" style={{ width: 70 }} inputMode="numeric" value={ownPp} onChange={(e) => setOwnPp(e.target.value)} placeholder="$ each" aria-label="Your own extra cost" />
              <button type="button" className="btn sm" disabled={own.trim().length < 2} onClick={() => { const n = addCustomExtra(list, own, ownPp); if (!n) { toast('Already there, or too many'); return; } set(n); setOwn(''); setOwnPp(''); }}>Add</button>
            </div>
          )}
          {org && ins.length > 0 && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => addToPlan(ins)} data-testid="extras-to-plan">+ Put the “in” ones in the trip plan</button>}
        </>
      )}
    </div>
  );
}

/** After the vote: the extras that won, with [Add them to the trip plan]. */
export function addExtrasToPlan(plan, extras) {
  return (async () => {
    const [{ data: budget }, { data: items }] = await Promise.all([
      supabase.from('plan_budget_items').select('label').eq('plan_id', plan.id),
      supabase.from('plan_items').select('title').eq('plan_id', plan.id),
    ]);
    const r = extrasToPlan(extras, { planId: plan.id, budget: budget || [], items: items || [] });
    if (r.budgetRows.length) await must(supabase.from('plan_budget_items').insert(r.budgetRows));
    if (r.jobRows.length) await must(supabase.from('plan_items').insert(r.jobRows));
    return r;
  })();
}
