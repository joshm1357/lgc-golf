// 👥 Co-organisers (ov35, Josh 23 Oct: "share a trip and ask people to contribute"). The organiser names 1–3 players
// who can change THIS trip's plan like the organiser — the trip builder, calling and closing votes, jobs, money.
// The database enforces it (migration 104). On the trip's screens a co-organiser sees the organiser's tools: PlanRole
// gives those screens the organiser's view (status.is_admin) for this trip only; anything outside the trip is still
// refused by the database. Pure helpers: lib/coorganisers.js.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName, SessionOverride } from '../lib/store.jsx';
import { toast, askConfirm } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify, shareText, appLink } from '../lib/push.js';
import { tripRole, addable, coorgLine, helpPath, helpMessage, MAX_COORGANISERS } from '../lib/coorganisers.js';

/** The trip's co-organisers, live. Older databases (before 104) have none. → { list, loaded, reload } */
export function useCoorganisers(planId) {
  const [list, setList] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    if (!planId) { setList([]); setLoaded(true); return; }
    const { data, error } = await supabase.from('plan_coorganisers').select('plan_id,player_id,added_by,created_at').eq('plan_id', planId).order('created_at');
    setList(error ? [] : data || []);
    setLoaded(true);
  }, [planId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['plan_coorganisers'], load);
  return { list, loaded, reload: load };
}

/** Every trip I co-organise (for "My draft trips" and the Caddie's trip picker). → [plan ids] */
export function useMyCoorganised() {
  const { status } = useSession() || {};
  const me = status?.player_id;
  const [ids, setIds] = useState([]);
  const load = useCallback(async () => {
    if (!me) { setIds([]); return; }
    const { data, error } = await supabase.from('plan_coorganisers').select('plan_id').eq('player_id', me);
    setIds(error ? [] : (data || []).map((r) => r.plan_id));
  }, [me]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['plan_coorganisers'], load);
  return ids;
}

/**
 * Wraps a trip's screens: a co-organiser of this trip gets the organiser's view of it (status.is_admin), and
 * status.coorganiser = true so the screens can say so. Everyone else is unchanged.
 */
export function PlanRole({ planId, children }) {
  const { status } = useSession() || {};
  const { list } = useCoorganisers(planId);
  const role = tripRole({ list, me: status?.player_id, isAdmin: !!status?.is_admin });
  const patch = React.useMemo(() => (role.coorg && !status?.is_admin && !status?.viewing ? { is_admin: true, coorganiser: true, real_is_admin: false } : null), [role.coorg, status?.is_admin, status?.viewing]);
  return patch ? <SessionOverride patch={patch}>{children}</SessionOverride> : children;
}

/**
 * "👥 Co-organisers" on a trip: who they are, and for the organiser [+ Add] / [Remove] and "Help me plan this" (the
 * trip link with their role). A co-organiser sees "You're a co-organiser" and can step down.
 */
export function CoOrganisersCard({ plan, compact = false }) {
  const { status } = useSession();
  const data = useData();
  const { list, reload } = useCoorganisers(plan?.id);
  const [busy, run] = useRun();
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState('');
  if (!plan || ['done', 'cancelled'].includes(plan.status)) return null;
  const me = status.player_id;
  // A co-organiser's screen says is_admin (PlanRole) — the real organiser check is real_is_admin when it's there.
  const realAdmin = status.coorganiser ? false : !!status.is_admin;
  const role = tripRole({ list, me, isAdmin: realAdmin, plan });
  const names = list.map((c) => data.playersById[c.player_id]).filter(Boolean);
  const choices = addable(data.players || [], list, { me });
  if (!role.canName && !role.coorg && !list.length) return null;

  const share = async (pid) => {
    const p = data.playersById[pid];
    const r = await shareText(helpMessage({ planName: plan.name, who: p ? playerName(p) : null, link: appLink(helpPath(plan.id)) }), plan.name);
    if (r === 'copied') toast('Copied — paste it to them');
  };
  const add = () => run(async () => {
    if (!pick) return;
    await must(supabase.from('plan_coorganisers').insert({ plan_id: plan.id, player_id: pick }));
    notify('coorganiser_added', { plan_id: plan.id, player_id: pick }).catch(() => {});
    const who = pick;
    setPick(''); setAdding(false);
    await reload();
    toast(`${playerName(data.playersById[who])} can change this plan now — they’ve been told`);
  });
  const remove = (pid) => askConfirm({
    title: pid === me ? 'Step down as co-organiser?' : `Take ${playerName(data.playersById[pid])} off?`,
    body: pid === me ? 'You won’t be able to change this plan any more. The organiser can add you back.' : 'They won’t be able to change this plan any more. Nothing they did is undone.',
    yes: pid === me ? 'Step down' : 'Take them off', tone: 'danger',
  }).then((yes) => yes && run(async () => {
    await must(supabase.from('plan_coorganisers').delete().eq('plan_id', plan.id).eq('player_id', pid));
    await reload();
  }));

  return (
    <details className="card" data-testid="coorganisers" open={!compact || undefined} style={{ overflow: 'hidden' }}>
      <summary className="small" style={{ padding: '10px 14px', fontWeight: 700, cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center', gap: 6 }}>
        👥 Co-organisers{names.length ? `: ${names.map(playerName).join(', ')}` : role.canName ? ' — share the planning' : ''}
      </summary>
      <div className="stack" style={{ padding: '0 14px 12px', gap: 8 }}>
        {role.coorg && <span className="small" style={{ fontWeight: 700 }} data-testid="you-coorg">🧰 You’re a co-organiser — you can change this plan, call and close the votes, and sort the jobs and money.</span>}
        {!names.length && role.canName && <span className="small muted">Name up to {MAX_COORGANISERS} mates who can change this plan like you: the map, the votes, the jobs and the money.</span>}
        {names.length > 0 && !role.coorg && <span className="small muted">{coorgLine(names.map(playerName))}</span>}
        {names.map((p) => (
          <div key={p.id} className="row between small" style={{ gap: 6 }} data-testid="coorg-row">
            <strong>{playerName(p)}{p.id === me ? ' (you)' : ''}</strong>
            <span className="row" style={{ gap: 4 }}>
              {role.canName && <button type="button" className="btn ghost sm" onClick={() => share(p.id)} data-testid="coorg-share">📤 Help me plan this</button>}
              {(role.canName || p.id === me) && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => remove(p.id)} aria-label={p.id === me ? 'Step down' : `Take ${playerName(p)} off`}>{p.id === me ? 'Step down' : '✕'}</button>}
            </span>
          </div>
        ))}
        {role.canName && list.length < MAX_COORGANISERS && (adding ? (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <select className="select grow" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Co-organiser" data-testid="coorg-pick">
              <option value="">Pick a player…</option>
              {choices.map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
            </select>
            <button type="button" className="btn gold sm" disabled={busy || !pick} onClick={add} data-testid="coorg-add-save">Add</button>
            <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        ) : (
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)} data-testid="coorg-add">+ Add a co-organiser</button>
        ))}
      </div>
    </details>
  );
}
