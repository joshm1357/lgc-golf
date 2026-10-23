// The money line (M1, Josh 23 Oct 2026 — walkthrough review option A). One line per person, the same everywhere:
//   the trip page's "Your weekend", the Kitty tab (with the full table behind Details), and the results page's
//   "Settle up" (I15 — W3 drops <MoneyLine tripId={…} settle /> in; it loads the trip's money itself).
//
//   Your share $535 · paid $200 · still to pay $335 to Josh      [I've paid $335]
//   PayID 0400 000 000 — Josh  (tap to copy)
//   After "I've paid": "$335 waiting for Josh to confirm" — no Pay button.
//
// Organisers also get the payments waiting for their tick (Got it / Not received) and a short list of who still has
// to pay with ONE Remind button (a phone buzz when they can send one, else a group-chat message).
// The words and maths are in lib/money.js.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { notify, shareText, appLink } from '../lib/push.js';
import { money } from '../lib/plan.js';
import { myMoney, moneyWords, whoOwes, collectorOf, remindText } from '../lib/money.js';
import { toast, askConfirm } from './ui.jsx';

/** Copy or share text (PayID, a reminder) — the share sheet on a phone, else the clipboard. */
async function shareOrCopy(text, copied = 'Copied') {
  const r = await shareText(text);
  if (r === 'copied') toast(copied);
  else if (r === 'failed') toast('Couldn’t share from this phone');
}

/** A trip's money rows, for a screen that doesn't already have them (the results page). */
export function useTripMoney(tripId) {
  const [pd, setPd] = useState(null);
  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      const { data: plan } = await supabase.from('plans').select('*').eq('trip_id', tripId).neq('status', 'cancelled').order('created_at').limit(1).maybeSingle();
      if (!plan) { setPd({ plan: null }); return; }
      const by = (t) => supabase.from(t).select('*').eq('plan_id', plan.id);
      const [costs, payments, transfers, rsvps] = await Promise.all([by('plan_costs'), by('plan_payments'), by('plan_transfers'), by('plan_rsvps')]);
      setPd({ plan, costs: costs.data || [], payments: payments.data || [], transfers: transfers.data || [], rsvps: rsvps.data || [], reload: load });
    } catch { setPd({ plan: null }); }
  }, [tripId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['plan_costs', 'plan_payments', 'plan_transfers'], load);
  return pd;
}

/**
 * pd: the plan's data (Planner's usePlanData), or tripId to load it here.
 * compact: just my line (the trip page's Your weekend). settle: titled "Settle up" (after the trip).
 * organiser: show the organiser's bits (confirm payments, who still owes, Remind) — on by default for organisers.
 */
export function MoneyLine({ pd: given = null, tripId = null, compact = false, settle = false, organiser = true }) {
  const loaded = useTripMoney(given ? null : tripId);
  const pd = given || loaded;
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const me = status?.player_id;
  const plan = pd?.plan || null;
  const rows = { costs: pd?.costs || [], payments: pd?.payments || [], transfers: pd?.transfers || [], rsvps: pd?.rsvps || [] };
  const m = useMemo(() => (plan ? myMoney({ ...rows, plan, me, playersById: data.playersById }) : null), [pd, me, data.playersById]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!plan) return null;
  const collector = collectorOf(plan, data.playersById);
  const isOrg = !!status?.is_admin || (!!me && plan.organiser_id === me);
  const showOrg = organiser && isOrg && !compact;
  if (!m && !showOrg) return null;

  const paid = () => run(async () => {
    // The deposit is the seat: paying it says you're in.
    if (m.depositOnly && !rows.rsvps.some((r) => r.player_id === me && r.status === 'in')) {
      await must(supabase.from('plan_rsvps').upsert({ plan_id: plan.id, player_id: me, status: 'in' }));
    }
    for (const p of m.payees.filter((x) => x.toPay > 0.5)) {
      // Paying the organiser who collects = money paid in (no to_id), like a deposit: it counts towards the seat and
      // the organiser ticks it off. Paying anyone else is person to person.
      const toCollector = p.id === 'kitty' || p.id === collector.id;
      const t = await must(supabase.from('plan_transfers').insert({ plan_id: plan.id, from_id: me, to_id: toCollector ? null : p.id, amount: p.toPay }).select().single());
      await notify('payment_recorded', { transfer_id: t.id }).catch(() => null);
    }
    pd.reload?.();
  }, `Done — ${m.payees.filter((x) => x.toPay > 0.5).map((x) => x.name).join(' and ') || collector.name} will be asked to confirm`);

  const payeesToPay = m ? m.payees.filter((p) => p.toPay > 0.5) : [];
  const details = [...new Set(payeesToPay.map((p) => p.details).filter(Boolean))];
  const tone = !m ? '' : m.state === 'owe' ? ' owe' : m.state === 'waiting' ? ' waiting' : ' square';
  return (
    <div className="stack" style={{ gap: 8 }}>
      {m && (
        <div className={`money-line${tone}${compact ? ' compact' : ' card pad'}`} data-testid="money-line" data-state={m.state}>
          {!compact && <div className="label">{settle ? '💸 Settle up' : '💰 Your money'}</div>}
          <div className="money-words" data-testid="money-words">{moneyWords(m)}</div>
          {m.state === 'owe' && details.map((d) => (
            <button key={d} type="button" className="btn ghost sm" style={{ justifyContent: 'flex-start', alignSelf: 'flex-start' }} onClick={() => shareOrCopy(d, 'Copied — paste it into your bank app')}>📋 {d}</button>
          ))}
          {m.state === 'owe' && !details.length && <span className="small muted">{payeesToPay[0]?.name || collector.name} hasn’t added payment details yet — ask in the group chat.</span>}
          {m.state === 'owe' && (
            <button type="button" className="btn gold sm" disabled={busy} data-testid="ive-paid" style={{ alignSelf: 'flex-start' }} onClick={paid}>I’ve paid {money(m.toPay)}</button>
          )}
          {m.state === 'waiting' && <span className="small muted" data-testid="money-waiting">⏳ You’ve said you paid — nothing more to do until it’s ticked off.</span>}
        </div>
      )}
      {showOrg && <OrganiserMoney pd={pd} plan={plan} collector={collector} />}
    </div>
  );
}

/** The organiser's bits: payments waiting for a tick, and who still has to pay with one Remind. */
function OrganiserMoney({ pd, plan, collector }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const me = status?.player_id;
  const isCollector = !!status?.is_admin || plan.organiser_id === me;
  const who = (id) => String(playerName(data.playersById[id]) || 'Someone').split(' ')[0];
  const toConfirm = (pd.transfers || []).filter((t) => !t.confirmed && (t.to_id === me || (!t.to_id && isCollector)));
  const w = whoOwes({ costs: pd.costs, payments: pd.payments, transfers: pd.transfers, rsvps: pd.rsvps, plan, playersById: data.playersById });
  const owing = w.owing.filter((o) => o.id !== me);
  const remind = () => run(async () => {
    if (status?.is_admin) {
      const r = await notify('nudge_kitty', { plan_id: plan.id }).catch(() => null);
      if (r?.sent) { toast(`Reminder sent to ${r.sent} phone${r.sent === 1 ? '' : 's'}`); return; }
    }
    await shareOrCopy(remindText({ plan, owing, collector, url: appLink(`/plan/${plan.id}?view=overview`) }), 'Copied — paste it into the group chat');
  });
  return (
    <>
      {toConfirm.map((t) => (
        <div key={t.id} className="card pad stack" style={{ gap: 6, borderColor: 'var(--gold)' }} data-testid="confirm-payment">
          <div><strong>{who(t.from_id)}</strong> says they paid you <strong>{money(t.amount)}</strong>.</div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn gold sm" disabled={busy} onClick={() => run(async () => { await must(supabase.from('plan_transfers').update({ confirmed: true }).eq('id', t.id)); pd.reload?.(); }, 'Confirmed ✓')}>✓ Got it</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={async () => { if (await askConfirm({ title: 'Remove this payment? Their balance goes back up.', yes: 'Remove it' })) run(async () => { await must(supabase.from('plan_transfers').delete().eq('id', t.id)); pd.reload?.(); }, 'Removed'); }}>Not received</button>
          </div>
        </div>
      ))}
      {(owing.length > 0 || (w.owing.length === 0 && ((pd.costs || []).length > 0 || Number(plan.deposit_pp) > 0))) && (
        <div className="card pad stack" style={{ gap: 6 }} data-testid="still-to-pay">
          <div className="row between" style={{ gap: 8 }}>
            <strong>{owing.length ? `Still to pay ${isCollector ? 'you' : collector.name}` : 'Everyone’s paid ✓'}</strong>
            {owing.length > 0 && <button type="button" className="btn ghost sm" disabled={busy} data-testid="remind" onClick={remind}>🔔 Remind</button>}
          </div>
          {owing.length > 0 && (
            <div className="small" data-testid="still-to-pay-list">
              {owing.map((o, i) => (
                <span key={o.id}>{i ? ' · ' : ''}<strong>{o.name}</strong> {o.toPay > 0.5 ? money(o.toPay) : ''}{o.waiting > 0.5 ? <span className="muted"> ({money(o.waiting)} to tick)</span> : null}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default MoneyLine;
