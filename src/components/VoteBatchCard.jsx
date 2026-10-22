import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useRealtime, playerName } from '../lib/store.jsx';
import { toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify } from '../lib/push.js';
import { countdown } from '../lib/plan.js';
import { batchNonVoters } from '../lib/tripbuilder.js';
import { PollCard } from '../screens/Planner.jsx';

// Combined vote cards (077): several polls on a trip shown as ONE card with a section each ("Where and when?":
// area · weekend · are you keen?). One notification, one closing date, reminders only to people who haven't answered
// every section. The polls are ordinary planner polls (vote_batch set), so older app versions still show them one by one.

/** The trip's vote cards, loaded on their own (an older database without 077: nothing shown). */
export function useVoteBatches(planId) {
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('vote_batches').select('*').eq('plan_id', planId).order('created_at');
    if (!error) setRows(data || []);
  }, [planId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['vote_batches'], load);
  return [rows, load];
}

export function VoteBatches({ pd }) {
  const [batches] = useVoteBatches(pd.plan.id);
  const shown = batches.filter((b) => pd.polls.some((p) => p.vote_batch === b.id));
  if (!shown.length) return null;
  return <>{shown.map((b) => <VoteBatchCard key={b.id} batch={b} pd={pd} />)}</>;
}

const KEEN = [['in', '✓ In', 'var(--navy)'], ['maybe', '? Maybe', '#7A5A00'], ['out', '✗ Out', 'var(--under)']];

export function VoteBatchCard({ batch, pd }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [busy, run] = useRun();
  const polls = pd.polls.filter((p) => p.vote_batch === batch.id);
  const open = polls.some((p) => p.status === 'open');
  const people = data.players.filter((p) => p.approved !== false).map((p) => p.id);
  const waiting = open ? batchNonVoters({ polls: polls.filter((p) => p.status === 'open'), votes: pd.votes, rsvps: pd.rsvps, keen: batch.keen, playerIds: people }) : [];
  const mine = pd.rsvps.find((r) => r.player_id === me)?.status;
  const keen = (s) => run(async () => {
    await must(supabase.from('plan_rsvps').upsert({ plan_id: pd.plan.id, player_id: me, status: s, updated_at: new Date().toISOString() }));
    pd.reload();
  });
  const sections = polls.length + (batch.keen ? 1 : 0);
  return (
    <div className="card" data-testid="vote-batch" style={{ overflow: 'hidden', borderColor: 'var(--navy)', borderWidth: 2 }}>
      <div style={{ padding: '12px 14px', background: 'var(--navy)', color: '#fff' }}>
        <div className="small" style={{ fontWeight: 700, opacity: 0.85 }}>🗳️ {sections} quick question{sections === 1 ? '' : 's'}{open ? (batch.closes_on ? ` · closes ${countdown(batch.closes_on)}` : ' · open') : ' · closed'}</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{batch.title}</div>
      </div>
      <div className="stack" style={{ padding: 10, gap: 10 }}>
        {polls.map((p, i) => (
          <div key={p.id} data-testid="vote-batch-section">
            <div className="small muted" style={{ fontWeight: 800, margin: '0 4px 4px' }}>{i + 1} of {sections}</div>
            <PollCard poll={p} pd={pd} inCard />
          </div>
        ))}
        {batch.keen && (
          <div className="card pad stack" data-testid="vote-batch-keen" style={{ gap: 8 }}>
            <div className="small muted" style={{ fontWeight: 800 }}>{sections} of {sections}</div>
            <strong style={{ fontSize: 18 }}>Are you keen?</strong>
            {me && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {KEEN.map(([v, label, colour]) => (
                  <button key={v} type="button" className="btn ghost sm" aria-pressed={mine === v} disabled={busy || (pd.plan.rsvp_locked && !status.is_admin)}
                    style={mine === v ? { background: colour, borderColor: colour, color: '#fff' } : {}} onClick={() => keen(v)}>{label}</button>
                ))}
              </div>
            )}
            <span className="small muted">{['in', 'maybe', 'out'].map((s) => `${pd.rsvps.filter((r) => r.status === s).length} ${s}`).join(' · ')}</span>
          </div>
        )}
        {open && waiting.length > 0 && (
          <div className="small" data-testid="vote-batch-waiting"><strong>Still to answer ({waiting.length}):</strong> <span className="muted">{waiting.map((id) => playerName(data.playersById[id])).join(', ')}</span></div>
        )}
        {open && waiting.length > 0 && status.is_admin && (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => {
            const r = await notify('nudge_votes', { plan_id: pd.plan.id });
            toast(`Reminder sent to ${r?.sent || 0} phone${r?.sent === 1 ? '' : 's'}`);
          })}>🔔 Remind them</button>
        )}
      </div>
    </div>
  );
}
