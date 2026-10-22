// "✨ Plan it with AI" (AI helper v2, 21 Oct 2026) — on the Trips tab, for organisers.
// The organiser says what they want ("Weekend away in March, 12 of us, within 3 hours of Sydney, about $500 each")
// → the helper proposes a plan → a confirm card lists exactly what [Create it] will make: the trip, a dates vote,
// a place vote (real courses from the library where it can), a starter jobs list and bring list, and rough costs
// each. Nothing is saved until Create it, which writes it with the organiser's own sign-in into the same planner
// tables "Suggest a trip" uses, then opens it. Everything can be changed afterwards.
// Hidden when the 'ai_helper' (or 'planner') feature is off, and for players (they get the Ask chip only).
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession, useFeature } from '../lib/store.jsx';
import { Sheet, toast } from '../components/ui.jsx';
import { notify } from '../lib/push.js';
import { PLAN_EXAMPLE, MAX_TEXT, canSend } from '../lib/aihelper.js';
import { askHelper, Rate, Remaining } from './AiHelper.jsx';
import { AskChip } from '../components/AskChip.jsx';

/** The Trips tab's AI bits in one line: [✨ Plan it with AI] for organisers, and the "✨ Ask" chip for everyone. */
export function TripsAi() {
  const on = useFeature('ai_helper');
  const planner = useFeature('planner');
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  if (!on || !planner) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {status?.is_admin && (
        <button type="button" className="btn ghost block" style={{ minHeight: 52, borderColor: 'var(--navy)', fontWeight: 800 }} onClick={() => setOpen(true)}>
          ✨ Plan it with AI
        </button>
      )}
      <div style={{ textAlign: 'center' }}><AskChip about="trips" inline /></div>
      {open && <PlanWithAiSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

export function PlanWithAiSheet({ onClose }) {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(null);
  const [remaining, setRemaining] = useState(null);

  const send = async () => {
    setBusy(true);
    const r = await askHelper({ mode: 'plan', text: text.trim() });
    if (r.remaining) setRemaining(r.remaining);
    setReply(r);
    setBusy(false);
  };
  const create = async () => {
    setBusy(true);
    const r = await askHelper({ mode: 'plan_apply', plan: reply.plan });
    if (r.kind === 'done' && r.planId) {
      await notify('plan_new', { plan_id: r.planId }).catch(() => null);
      toast('Up for a vote — check the details');
      onClose();
      nav(`/plan/${r.planId}`);
      return;
    }
    setBusy(false);
    setReply(r);
  };

  const planning = reply?.kind === 'tripplan';
  return (
    <Sheet title="✨ Plan it with AI" onClose={onClose}>
      <div className="stack" style={{ gap: 10 }} aria-label="Plan it with AI">
        {!planning && (
          <>
            <span className="small muted">Say roughly when, how many, how far and the budget. You’ll see exactly what it’ll make — votes on dates and places, jobs, a bring list and rough costs — before anything’s saved.</span>
            <textarea className="textarea" rows={4} style={{ padding: 12 }} value={text} maxLength={MAX_TEXT} aria-label="Describe the trip you want"
              placeholder={PLAN_EXAMPLE} onChange={(e) => setText(e.target.value)} disabled={busy} />
            <button type="button" className="btn gold block" disabled={busy || !canSend(text)} onClick={send}>{busy ? 'Working it out…' : 'Plan it'}</button>
          </>
        )}
        {reply?.kind === 'message' && <div className="card pad small" style={{ background: 'var(--ground)' }}>💬 {reply.text}</div>}
        {reply?.kind === 'error' && <div className="small err" style={{ margin: 0 }} role="alert">{reply.text}</div>}
        {planning && (
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">I’ll set up:</span>
            <ul style={{ margin: 0, paddingLeft: 20 }} className="stack small" aria-label="What will be made">
              {reply.summary.map((line, i) => <li key={i} style={{ lineHeight: 1.4 }}>{line}</li>)}
            </ul>
            {reply.warnings.map((w, i) => <span key={i} className="small err" style={{ margin: 0 }}>⚠️ {w}</span>)}
            {reply.notes && <span className="small muted">Note: {reply.notes}</span>}
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn gold grow" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create it'}</button>
              <button type="button" className="btn ghost grow" disabled={busy} onClick={() => setReply(null)}>Change something</button>
            </div>
            <span className="small muted">Costs are rough AI estimates — check before booking. Everyone can add options, vote and say if they’re in once it’s up.</span>
          </div>
        )}
        {(planning || reply?.kind === 'message') && <Rate key={reply.logId} logId={reply.logId} />}
        <Remaining r={remaining} />
      </div>
    </Sheet>
  );
}

export default TripsAi;
