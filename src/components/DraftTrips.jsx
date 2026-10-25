// "My draft trips" (ov35, Josh 23 Oct: "be able to organise more than one at once, i.e. retrieve later"). Every trip
// being planned that I can change — all of them for an organiser, the ones I co-organise otherwise — with when it last
// changed, and its ✨ planning chat if this phone has one. Used on Trips and by the Caddie's trip picker.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useRealtime, useSession, useFeature } from '../lib/store.jsx';
import { listPlanChats, changedWords } from '../lib/planchat.js';
import { useMyCoorganised } from './CoOrganisers.jsx';
import { openPlanner } from './Caddie.jsx';

/** Draft trips I can plan, newest change first: [{ plan, changedAt, chat: { size } | null, coorg }] (null = loading). */
export function useDraftTrips() {
  const { status } = useSession() || {};
  const isAdmin = !!status?.is_admin && !status?.viewing;
  const me = status?.player_id;
  const gid = status?.group_id;
  const coorg = useMyCoorganised();
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => {
    const [{ data: plans }, { data: builds }] = await Promise.all([
      supabase.from('plans').select('id,name,kind,status,proposed,created_by,organiser_id,created_at,start_date').eq('status', 'planning'),
      supabase.from('trip_builds').select('plan_id,updated_at'),
    ]);
    const at = new Map((builds || []).map((b) => [b.plan_id, b.updated_at]));
    setRows((plans || []).map((p) => ({ plan: p, changedAt: [at.get(p.id), p.created_at].filter(Boolean).sort().pop() || null })));
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['plans', 'trip_builds'], load);
  return useMemo(() => {
    if (!rows) return null;
    const chats = new Map(listPlanChats(gid).map((c) => [c.planId, c]));
    return rows
      .filter(({ plan: p }) => (isAdmin ? (!p.proposed || p.created_by === me) : coorg.includes(p.id) || (me && p.organiser_id === me && !p.proposed)))
      .map((r) => ({ ...r, chat: chats.get(r.plan.id) || null, coorg: coorg.includes(r.plan.id) }))
      .sort((a, b) => String(b.changedAt || '').localeCompare(String(a.changedAt || '')));
  }, [rows, gid, isAdmin, me, coorg]);
}

/** The Trips card: "🧭 My draft trips" — open one, or carry on its planning chat. */
export function MyDraftTrips() {
  const drafts = useDraftTrips();
  const builderOn = useFeature('trip_finder');
  const aiOn = useFeature('ai_helper');
  const { status } = useSession();
  if (!drafts || !drafts.length) return null;
  const now = Date.now();
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="my-drafts">
      <div className="row between" style={{ gap: 8 }}>
        <strong>🧭 My draft trips</strong>
        <span className="small muted">{drafts.length}</span>
      </div>
      {drafts.map(({ plan, changedAt, chat, coorg }) => (
        <div key={plan.id} className="row between" style={{ gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--line-soft)', paddingTop: 8 }} data-testid="draft-row" data-plan={plan.id}>
          <span style={{ minWidth: 0 }}>
            <strong>{plan.name}</strong>
            <div className="small muted">{[changedWords(changedAt, now), coorg ? 'you’re a co-organiser' : null].filter(Boolean).join(' · ')}</div>
          </span>
          <span className="row" style={{ gap: 6 }}>
            <Link className="btn ghost sm" to={builderOn ? `/plan/${plan.id}/build` : `/plan/${plan.id}?view=organise`} data-testid="draft-open">Open</Link>
            {aiOn && status.is_admin && (
              <button type="button" className="btn ghost sm" onClick={() => openPlanner({ planId: plan.id })} data-testid="draft-chat">
                ✨ {chat ? `Chat (${chat.size})` : 'Plan with the Caddie'}</button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
