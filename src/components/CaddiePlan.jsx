// "✨ Plan a trip" — the Caddie's planning mode (ov16, 22 Oct: Josh expected "Plan it with AI" to BE the Caddie).
// The chat lives in the Caddie (a side panel on a laptop, a sheet on a phone) and the REAL trip screen fills in as you
// talk: once the helper has a draft, a draft trip is made and the trip builder opens beside the chat; every turn the
// draft is written into the builder's saved state as ✨ suggestions (lib/planchat.js mergeDraftIntoBuild), and what
// the organiser changes on the page goes back to the helper next turn (pageFromBuild). The helper asks first (a short
// reply with questions until it knows when, where and how many) and "plan it" stops the questions any time.
// A helper, never a decider: nothing is picked for anyone; the group votes on the trip screen.
// Without the trip builder (feature 'trip_finder' off) it works as before: the draft card here, then Create it.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession, useFeature } from '../lib/store.jsx';
import { toast } from './ui.jsx';
import { notify } from '../lib/push.js';
import { must } from '../lib/run.js';
import { PLAN_EXAMPLE } from '../lib/aihelper.js';
import {
  chatBody, cleanQuestions, diffDraft, turnsLeft, draftToPlan, loadChat, saveChat, clearChat, pending,
  mergeDraftIntoBuild, pageFromBuild, courseNamesFromDraft, PLAN_IT_HINT, PLAN_IT,
} from '../lib/planchat.js';
import { askHelper, Rate, Remaining } from '../screens/AiHelper.jsx';
import { DraftCard } from '../screens/AiPlanner.jsx';
import AiChat from './AiChat.jsx';

/** Tell an open trip builder its saved state changed (realtime also does, this is just quicker). */
// Trips the chat lets go of: called off, done.
export const LET_GO = ['cancelled', 'done'];

const changed = (planId) => window.dispatchEvent(new CustomEvent('tripbuild:changed', { detail: { planId } }));

export default function CaddiePlan({ onGo }) {
  const nav = useNavigate();
  const loc = useLocation();
  const { status } = useSession();
  const aiOn = useFeature('ai_helper');
  const plannerOn = useFeature('planner');
  const builderOn = useFeature('trip_finder');
  const gid = status?.group_id;
  const saved = useMemo(() => loadChat(gid), [gid]);
  const [turns, setTurns] = useState(saved?.turns || []);
  const [draft, setDraft] = useState(saved?.draft || null);
  const [planId, setPlanId] = useState(saved?.planId || null);
  const [prev, setPrev] = useState(null);
  const [summary, setSummary] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [logId, setLogId] = useState(null);
  const [gone, setGone] = useState(''); // e.g. “March 2027” was called off — the trip the chat had been filling in
  const areas = useRef(null);
  useEffect(() => { saveChat(gid, { turns: turns.map(({ card, ...t }) => t), draft, planId }); }, [gid, turns, draft, planId]);

  const stayAreas = async () => {
    if (!areas.current) { const { data } = await supabase.from('stay_areas').select('name,region,lat,lng'); areas.current = data || []; }
    return areas.current;
  };
  // The trip screen, filling in: the first draft makes a draft trip and opens the builder; later ones update it.
  // v10.5 (Josh 23 Oct: "it doesn't show the planning screen, let alone update it… that should not be the requirement"):
  //  - every update opens the trip screen if you're not on it (no need to find "Show the trip");
  //  - a trip that's been called off (or is done, or gone) is let go: the next draft starts a new trip, with a note.
  const isLive = async (pid) => {
    if (!pid) return false;
    const { data: p } = await supabase.from('plans').select('id,name,status').eq('id', pid).maybeSingle();
    if (p && !LET_GO.includes(p.status)) return true;
    setGone(`“${p?.name || 'Your last trip'}” ${p?.status === 'done' ? 'has been played' : p ? 'was called off' : 'is gone'}`);
    return false;
  };
  const onIt = (pid) => String(window.location.hash || '').includes(`/plan/${pid}`);
  const syncBuild = async (d, pid0) => {
    if (!builderOn || !d) return pid0;
    let pid = pid0;
    try {
      const a = await stayAreas();
      if (pid && !(await isLive(pid))) pid = null;
      if (!pid) {
        const plan = await must(supabase.from('plans').insert({ kind: d.kind === 'round' ? 'round' : 'trip', name: d.name || 'Golf trip', status: 'planning', proposed: false, ...(d.budget_pp != null ? { budget_pp: d.budget_pp } : {}) }).select('id').single());
        await must(supabase.from('trip_builds').upsert({ plan_id: plan.id, state: mergeDraftIntoBuild(null, d, a) }, { onConflict: 'plan_id' }));
        if (status?.player_id) await supabase.from('plan_rsvps').upsert({ plan_id: plan.id, player_id: status.player_id, status: 'in' });
        nav(`/plan/${plan.id}/build`);
        return plan.id;
      }
      const { data: b } = await supabase.from('trip_builds').select('state').eq('plan_id', pid).maybeSingle();
      await must(supabase.from('trip_builds').upsert({ plan_id: pid, state: mergeDraftIntoBuild(b?.state || null, d, a) }, { onConflict: 'plan_id' }));
      changed(pid);
      if (!onIt(pid)) nav(`/plan/${pid}/build`);
      return pid;
    } catch {
      toast('Couldn’t update the trip screen — the options are still here in the chat');
      return pid;
    }
  };
  // Opening the chat on a trip that's since been called off: say so, and let it go.
  useEffect(() => {
    if (!planId || !builderOn) return;
    let live = true;
    isLive(planId).then((ok) => { if (live && !ok) setPlanId(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, builderOn]);
  // What the trip screen shows now (the organiser may have changed it there) — sent with the next question.
  const readPage = async () => {
    if (!planId) return null;
    const { data: b } = await supabase.from('trip_builds').select('state').eq('plan_id', planId).maybeSingle();
    return b?.state ? pageFromBuild(b.state, courseNamesFromDraft(draft)) : null;
  };

  // A question keeps going if you close the Caddie: its answer is saved for this group and shows when you're back.
  const finish = (r, before, mine) => {
    if (r.kind === 'chat') return { turns: [...before, mine, { role: 'assistant', text: r.text, questions: cleanQuestions(r.questions), done: r.done }], draft: r.draft || null };
    if (r.kind === 'message') return { turns: [...before, mine, { role: 'assistant', text: r.text, questions: [] }], draft: null };
    return null;
  };
  const ask = (before, mine, page) => {
    const promise = askHelper(chatBody(before, draft, mine.text, page)).then((r) => {
      pending.delete(gid);
      const done = finish(r, before, mine);
      if (done) saveChat(gid, { turns: done.turns, draft: done.draft || draft, planId });
      return r;
    }, (e) => { pending.delete(gid); throw e; });
    pending.set(gid, { promise, before, mine });
    return promise;
  };
  const land = async (r, before, mine) => {
    if (r.remaining) setRemaining(r.remaining);
    if (r.logId != null) setLogId(r.logId);
    const done = finish(r, before, mine);
    if (!done) { setBusy(false); setErr(r.text || 'The helper didn’t answer — try again.'); return; }
    setTurns(done.turns);
    if (r.kind === 'chat' && r.draft) {
      setPrev(draft); setDraft(r.draft); setSummary(r.summary || []);
      const pid = await syncBuild(r.draft, planId);
      if (pid !== planId) setPlanId(pid);
    }
    setBusy(false);
  };
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
    try { r = await ask(before, mine, await readPage().catch(() => null)); } catch { setBusy(false); setErr('The helper didn’t answer — try again.'); return; }
    await land(r, before, mine);
  };
  const create = async () => {
    setBusy(true);
    const r = await askHelper({ mode: 'plan_apply', plan: draftToPlan(draft) });
    if (r.kind === 'done' && r.planId) {
      await notify('plan_new', { plan_id: r.planId }).catch(() => null);
      clearChat(gid);
      toast('Up for a vote — check the details');
      onGo?.(`/plan/${r.planId}`);
      return;
    }
    setBusy(false);
    setErr(r.text || 'Couldn’t create it.');
  };
  const restart = () => { setGone(''); clearChat(gid); setTurns([]); setDraft(null); setPrev(null); setPlanId(null); setConfirm(false); setErr(''); };

  if (!aiOn || !plannerOn) return <div className="small caddie-why" role="note">Planning with the Caddie is switched off for this group.</div>;
  if (!status?.is_admin || status?.viewing) return <div className="small caddie-why" role="note">Only an organiser can plan a trip with the Caddie. Ask me about your trips instead.</div>;

  const diff = diffDraft(prev, draft);
  const lastAi = [...turns].reverse().find((t) => t.role === 'assistant');
  const onTrip = planId && loc.pathname.startsWith(`/plan/${planId}`);
  // No trip screen to fill in (builder off): the draft shows here in the chat, as before.
  const shown = turns.map((t) => (t === lastAi && draft && (!builderOn || !planId) ? { ...t, card: <div className="pc-inline-card"><DraftCard draft={draft} diff={diff} prev={prev} /></div> } : t));
  const ready = draft && (draft.places || []).length > 0 && (draft.dates || []).length > 0;
  const hint = (
    <div className="small muted row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} data-testid="plan-it-hint">
      <span>{PLAN_IT_HINT}</span>
      <button type="button" className="chip" style={{ minHeight: 36 }} disabled={busy} onClick={() => send(PLAN_IT)}>{PLAN_IT}</button>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 10 }} data-testid="caddie-plan">
      {!confirm ? (
        <AiChat turns={shown} onSend={send} busy={busy} left={turnsLeft(turns)} placeholder={turns.length ? 'Answer, or say what to change…' : PLAN_EXAMPLE}
          hint={lastAi && !busy ? hint : null}
          thinkingSteps={['Reading what you said', 'Thinking about where and when', 'Writing back']}
          intro={!turns.length && (
            <span className="small muted">Tell me roughly when, how many and how far you’ll travel. I’ll ask a couple of quick questions, then fill in the trip {builderOn ? 'on the screen as we go' : 'here'} — you choose what goes to the group. {PLAN_IT_HINT}</span>
          )}
          footer={(
            <div className="stack" style={{ gap: 6 }}>
              {planId && !onTrip && <button type="button" className="btn gold block" disabled={busy} onClick={() => onGo?.(`/plan/${planId}/build`)} data-testid="open-trip">🗺️ Show the trip</button>}
              {!builderOn && ready && <button type="button" className="btn gold block" disabled={busy} onClick={() => setConfirm(true)} data-testid="use-plan">Use this plan</button>}
              {turns.length > 0 && <button type="button" className="btn ghost sm" disabled={busy} onClick={restart}>Start a new plan</button>}
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
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setConfirm(false)}>Back to the chat</button>
          <span className="small muted">Costs are the Caddie’s rough guesses — check before booking.</span>
        </div>
      )}
      {gone && !planId && (
        <div className="small caddie-why" role="note" data-testid="plan-gone">{gone}, so I’ll start a new trip from your next answer.</div>
      )}
      {planId && onTrip && <span className="small muted">✨ The trip screen fills in as we talk. Change anything there — I’ll see it next time you say something.</span>}
      {err && <div className="small err" style={{ margin: 0 }} role="alert">{err}</div>}
      {lastAi && logId != null && <Rate key={logId} logId={logId} />}
      <Remaining r={remaining} />
    </div>
  );
}
