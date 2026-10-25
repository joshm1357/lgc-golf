// "✨ Plan it with the Caddie" (AI helper v2, 21 Oct 2026; a conversation since 22 Oct, 080) — on the Trips tab, for organisers.
// It's a chat now: the helper replies with its draft (a shortlist of places with their courses, weekends, extras,
// rough costs) and 1–3 questions with quick answers; the draft card shows what changed. A helper, never a decider.
// The organiser says what they want ("Weekend away in March, 12 of us, within 3 hours of Sydney, about $500 each")
// → the helper proposes a plan → a confirm card lists exactly what [Create it] will make: the trip, a dates vote,
// a place vote (real courses from the library where it can), a starter jobs list and bring list, and rough costs
// each. Nothing is saved until Create it, which writes it with the organiser's own sign-in into the same planner
// tables "Suggest a trip" uses, then opens it. Everything can be changed afterwards.
// Hidden when the 'ai_helper' (or 'planner') feature is off, and for players (they get the Ask chip only).
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession, useFeature } from '../lib/store.jsx';
import { Sheet, toast } from '../components/ui.jsx';
import { notify } from '../lib/push.js';
import { must } from '../lib/run.js';
import { PLAN_EXAMPLE } from '../lib/aihelper.js';
import { fmtRange } from '../lib/plan.js';
import { chatBody, cleanQuestions, diffDraft, markFor, removedNames, turnsLeft, draftToPlan, builderStateFromDraft, loadChat, saveChat, clearChat, chatSize, pending, listPlanChats, carryOnWords } from '../lib/planchat.js';
import { newState } from '../lib/tripbuilder.js';
import { startExtras } from '../lib/extras.js';
import { askHelper, Rate, Remaining } from './AiHelper.jsx';
import { AskChip } from '../components/AskChip.jsx';
import AiChat from '../components/AiChat.jsx';
import { openPlanner } from '../components/Caddie.jsx';

/** The Trips tab's AI bits in one line: [✨ Plan it with AI] for organisers, and the "✨ Ask" chip for everyone. */
export function TripsAi() {
  const on = useFeature('ai_helper');
  const planner = useFeature('planner');
  const { status } = useSession();
  if (!on || !planner) return null;
  // ov35: a chat per trip — "Carry on your plan (12 messages)", or "Carry on a plan (3 on the go)" with several.
  const gid = status?.group_id;
  const carryOn = carryOnWords(listPlanChats(gid), chatSize(loadChat(gid)) || (pending.has(gid) || [...pending.keys()].some((k) => String(k).startsWith(`${gid}:`)) ? 1 : 0));
  // ov16: "Plan it with the Caddie" IS the Caddie now — this is a shortcut that opens it in ✨ Plan a trip mode (the chat
  // beside the trip screen, which fills in as you talk). PlanWithAiSheet below is kept for older links only.
  return (
    <div className="stack" style={{ gap: 8 }}>
      {status?.is_admin && (
        <button type="button" className="btn ghost block" style={{ minHeight: 52, borderColor: 'var(--navy)', fontWeight: 800 }} onClick={openPlanner} data-testid="plan-with-ai">
          ✨ {carryOn || 'Plan it with the Caddie'}
        </button>
      )}
      <div style={{ textAlign: 'center' }}><AskChip about="trips" inline /></div>
    </div>
  );
}

export function PlanWithAiSheet({ onClose }) {
  const nav = useNavigate();
  const { status } = useSession();
  const builderOn = useFeature('trip_finder');
  const gid = status?.group_id;
  const saved = useMemo(() => loadChat(gid), [gid]);
  const [turns, setTurns] = useState(saved?.turns || []);
  const [draft, setDraft] = useState(saved?.draft || null);
  const [prev, setPrev] = useState(null);
  const [summary, setSummary] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [logId, setLogId] = useState(null);
  useEffect(() => { saveChat(gid, { turns: turns.map(({ card, ...t }) => t), draft }); }, [gid, turns, draft]);

  // A question keeps going if you leave the screen: its answer is saved for this group and shows when you're back.
  const finish = (r, before, mine) => {
    if (r.kind === 'chat') {
      return { turns: [...before, mine, { role: 'assistant', text: r.text, questions: cleanQuestions(r.questions), done: r.done }], draft: r.draft };
    }
    if (r.kind === 'message') return { turns: [...before, mine, { role: 'assistant', text: r.text, questions: [] }], draft: null };
    return null;
  };
  const ask = (before, mine) => {
    const promise = askHelper(chatBody(before, draft, mine.text)).then((r) => {
      pending.delete(gid);
      const done = finish(r, before, mine);
      if (done) saveChat(gid, { turns: done.turns, draft: done.draft || draft });   // saved even if the sheet has closed
      return r;
    }, (e) => { pending.delete(gid); throw e; });
    pending.set(gid, { promise, before, mine });
    return promise;
  };
  const land = (r, before, mine) => {
    setBusy(false);
    if (r.remaining) setRemaining(r.remaining);
    if (r.logId != null) setLogId(r.logId);
    const done = finish(r, before, mine);
    if (done && r.kind === 'chat' && r.draft) { setPrev(draft); setDraft(r.draft); setSummary(r.summary || []); }
    if (done) { setTurns(done.turns); return; }
    setErr(r.text || 'The helper didn’t answer — try again.');
  };
  // Came back while a question was still on its way: wait for it here too.
  useEffect(() => {
    const p = pending.get(gid);
    if (!p) return undefined;
    let live = true;
    setBusy(true);
    p.promise.then((r) => { if (live) land(r, p.before, p.mine); }, () => { if (live) { setBusy(false); setErr('The helper didn’t answer — try again.'); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid]);

  const send = async (text) => {
    setErr('');
    const mine = { role: 'user', text };
    const before = turns;
    setTurns([...before, mine]);
    setBusy(true);
    let r;
    try { r = await ask(before, mine); } catch { setBusy(false); setErr('The helper didn’t answer — try again.'); return; }
    land(r, before, mine);
  };
  const create = async () => {
    setBusy(true);
    const r = await askHelper({ mode: 'plan_apply', plan: draftToPlan(draft) });
    if (r.kind === 'done' && r.planId) {
      await notify('plan_new', { plan_id: r.planId }).catch(() => null);
      clearChat(gid);
      toast('Up for a vote — check the details');
      onClose();
      nav(`/plan/${r.planId}`);
      return;
    }
    setBusy(false);
    setErr(r.text || 'Couldn’t create it.');
  };
  // Open in the trip builder: the trip with the AI's shortlist as OPTIONS (✨ suggested), nothing picked.
  const toBuilder = async () => {
    setBusy(true);
    try {
      const { data: areas } = await supabase.from('stay_areas').select('name,region,lat,lng');
      const plan = await must(supabase.from('plans').insert({ kind: draft.kind === 'round' ? 'round' : 'trip', name: draft.name || 'Golf trip', status: 'planning', proposed: false, ...(draft.budget_pp != null ? { budget_pp: draft.budget_pp } : {}) }).select('id').single());
      const start = builderStateFromDraft(draft, areas || []);
      const extras = start.extrasSuggested.length ? startExtras().map((e) => (start.extrasSuggested.some((l) => l.toLowerCase() === e.label.toLowerCase()) ? { ...e, suggested: true } : e)) : null;
      const st = { ...newState({}), ...start, extras };
      delete st.extrasSuggested;
      await must(supabase.from('trip_builds').upsert({ plan_id: plan.id, state: st }, { onConflict: 'plan_id' }));
      if (status?.player_id) await supabase.from('plan_rsvps').upsert({ plan_id: plan.id, player_id: status.player_id, status: 'in' });
      clearChat(gid);
      onClose();
      nav(`/plan/${plan.id}/build`);
    } catch (e) {
      setBusy(false);
      setErr(e?.message || 'Couldn’t open Plan the trip.');
    }
  };
  const restart = () => { clearChat(gid); setTurns([]); setDraft(null); setPrev(null); setConfirm(false); setErr(''); };

  const diff = diffDraft(prev, draft);
  const lastAi = [...turns].reverse().find((t) => t.role === 'assistant');
  const shown = turns.map((t) => (t === lastAi && draft ? { ...t, card: <div className="pc-inline-card"><DraftCard draft={draft} diff={diff} prev={prev} /></div> } : t));
  const ready = draft && (draft.places || []).length > 0 && (draft.dates || []).length > 0;
  return (
    <Sheet title="✨ Plan it with the Caddie" onClose={onClose} wide>
      <div className="pc-grid">
      <div className="stack" style={{ gap: 10 }} aria-label="Plan it with the Caddie">
        {!confirm ? (
          <AiChat turns={shown} onSend={send} busy={busy} left={turnsLeft(turns)} placeholder={turns.length ? 'Answer, or say what to change…' : PLAN_EXAMPLE}
            intro={!turns.length && <span className="small muted">Say roughly when, how many, how far and the budget. The helper comes back with some options and a few questions — you choose what goes to the group. Nothing’s saved until you say so.</span>}
            footer={(
              <div className="stack" style={{ gap: 6 }}>
                {ready && <button type="button" className="btn gold block" disabled={busy} onClick={() => setConfirm(true)} data-testid="use-plan">Use this plan</button>}
                {turns.length > 0 && <button type="button" className="btn ghost sm" disabled={busy} onClick={restart}>Start again</button>}
              </div>
            )} />
        ) : (
          <div className="stack" style={{ gap: 8 }} data-testid="plan-confirm">
            <span className="label">I’ll set up:</span>
            <ul style={{ margin: 0, paddingLeft: 20 }} className="stack small" aria-label="What will be made">
              {(summary.length ? summary : [`Start the trip “${draft.name}”`]).map((line, i) => <li key={i} style={{ lineHeight: 1.4 }}>{line}</li>)}
            </ul>
            {(draft.warnings || []).map((w, i) => <span key={i} className="small err" style={{ margin: 0 }}>⚠️ {w}</span>)}
            <span className="small muted">These are options for the group to vote on — nothing is picked for them.</span>
            <button type="button" className="btn gold block" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create it'}</button>
            {builderOn && <button type="button" className="btn block" disabled={busy} onClick={toBuilder} data-testid="to-builder">🗺️ Plan it on the map instead</button>}
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setConfirm(false)}>Back to the chat</button>
            <span className="small muted">Costs are the Caddie’s rough guesses — check before booking.</span>
          </div>
        )}
        {err && <div className="small err" style={{ margin: 0 }} role="alert">{err}</div>}
        {lastAi && logId != null && <Rate key={logId} logId={logId} />}
        <Remaining r={remaining} />
      </div>
      <aside className="pc-aside" data-testid="draft-aside">
        {draft ? <DraftCard draft={draft} diff={diff} prev={prev} /> : <div className="card pad small muted">The trip’s options show here as you chat — places with their courses, weekends, extras and rough costs.</div>}
      </aside>
      </div>
    </Sheet>
  );
}

const MARK = { new: { label: 'New', bg: 'var(--gold-soft)' }, changed: { label: 'Changed', bg: '#EAF3FF' } };
const Tag = ({ m }) => (m ? <span className="tb-chip-pts" style={{ marginLeft: 6 }}>{MARK[m].label}</span> : null);

/** The draft as a card that changes each turn: what's new or changed is highlighted. All of it is ✨ suggestions. */
export function DraftCard({ draft, diff, prev }) {
  const gone = removedNames(diff, prev);
  const row = (m) => ({ padding: '6px 8px', borderRadius: 8, background: m ? MARK[m].bg : 'transparent' });
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--navy)' }} data-testid="draft-card">
      <div className="row between"><strong>{draft.name}</strong><span className="small muted">✨ suggested</span></div>
      {(draft.places || []).length > 0 && <span className="label">Places to look at</span>}
      {(draft.places || []).map((p) => {
        const m = markFor(diff, 'place', p);
        return (
          <div key={p.label} style={row(m)} data-testid="draft-place" data-mark={m || undefined}>
            <div style={{ fontWeight: 700 }}>📍 {p.label}<Tag m={m} />{p.cost_pp != null && <span className="small muted"> · ~${p.cost_pp} each</span>}</div>
            {p.address && <div className="small muted">⛳ {p.address.split(' + ').join(' · ')}</div>}
            {p.notes && <div className="small muted">{p.notes}</div>}
          </div>
        );
      })}
      {(draft.dates || []).length > 0 && <span className="label">Weekends</span>}
      {(draft.dates || []).map((d) => {
        const m = markFor(diff, 'date', d);
        return <div key={d.start_date} style={row(m)} className="small" data-testid="draft-date">📅 {fmtRange(d.start_date, d.end_date)}<Tag m={m} /></div>;
      })}
      {(draft.extras || []).length > 0 && (
        <>
          <span className="label">Extras to offer</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {draft.extras.map((e) => <span key={e.label} className="chip small" style={markFor(diff, 'extra', e) ? { background: 'var(--gold-soft)' } : {}}>{e.label}{e.pp != null ? ` ~$${e.pp}` : ''}</span>)}
          </div>
        </>
      )}
      {draft.budget_pp != null && <div className="small" style={row(diff?.changed?.includes('budget') ? 'changed' : '')}>💰 About ${draft.budget_pp} each{diff?.changed?.includes('budget') && <Tag m="changed" />}</div>}
      {gone.length > 0 && <span className="small muted">Taken off: {gone.join(', ')}</span>}
    </div>
  );
}

export default TripsAi;
