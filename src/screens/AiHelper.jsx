// The AI helper (21 Oct 2026; v2 the same night). Ways in:
//   * SetupHelperBox — "✨ Set it up for me" at the top of Set up your trip (organisers). Type the trip in plain
//     words → a confirm card listing exactly what will be made → [Do it] [Change something]. Nothing is saved until
//     Do it.
//   * Ask (default export, /ask) — anyone in the group asks about what's on (the trip, the live round: who's
//     leading, what someone needs) and the group's history. /ask?about=round (from the leaderboard's "✨ Ask" chip)
//     or ?about=trips (the Trips tab) picks the example questions.
//   * "✨ Plan it with AI" on the Trips tab (screens/AiPlanner.jsx).
// Each answer has 👍 / 👎 (Rate) so Josh can see whether people want it. All of them call the ai-helper edge
// function, which checks who you are, the feature switch and the limits, and only ever reads or writes as you.
// Hidden when the 'ai_helper' feature is off.
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { currentGroup } from '../lib/group.js';
import { useData, useFeature, useSession } from '../lib/store.jsx';
import { Header, toast } from '../components/ui.jsx';
import AnswerFeedback from '../components/AnswerFeedback.jsx';
import { SETUP_EXAMPLE, MAX_TEXT, ASK_KEEP, canSend, remainingLabel, readReply, nextRating, askExamples, askTitle, withRetry, loadAsk, saveAsk } from '../lib/aihelper.js';

/** One call to the helper; tried once more by itself if the AI company was busy, replied oddly or was too slow
 *  (those don't use up a question). "Do it" / "Create it" are never retried. */
export async function askHelper(body) {
  return withRetry(async () => {
    const { data, error } = await supabase.functions.invoke('ai-helper', { body: { ...body, group_id: currentGroup() || undefined } });
    return readReply(data, error);
  }, body);
}

export const Remaining = ({ r }) => (r ? <span className="small muted">{remainingLabel(r)}</span> : null);

/** 👍 / 👎 on one answer, with a reason after 👎 (components/AnswerFeedback.jsx, 075). */
export const Rate = AnswerFeedback;

/** "✨ Set it up for me" — goes at the top of Set up your trip. onApplied(tripId) after Do it. */
export function SetupHelperBox({ onApplied }) {
  const on = useFeature('ai_helper');
  const data = useData();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(null);
  const [remaining, setRemaining] = useState(null);
  if (!on) return null;

  const send = async () => {
    setBusy(true);
    const r = await askHelper({ mode: 'setup', text: text.trim() });
    if (r.remaining) setRemaining(r.remaining);
    setReply(r);
    setBusy(false);
  };
  const doIt = async () => {
    setBusy(true);
    const r = await askHelper({ mode: 'apply', plan: reply.plan });
    setBusy(false);
    if (r.kind === 'done') {
      await data.reload();
      toast('All set up — check each step below');
      setReply(null);
      setText('');
      onApplied?.(r.tripId);
    } else {
      setReply(r);
    }
  };

  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--navy)' }} aria-label="Set it up for me">
      <strong>✨ Set it up for me</strong>
      {reply?.kind !== 'plan' && (
        <>
          <span className="small muted">Say where, when, which courses and what you’re playing. You’ll see exactly what it’ll make before anything’s saved.</span>
          <textarea className="textarea" rows={4} style={{ padding: 12 }} value={text} maxLength={MAX_TEXT} aria-label="Describe your trip"
            placeholder={SETUP_EXAMPLE} onChange={(e) => setText(e.target.value)} disabled={busy} />
          <button type="button" className="btn gold" disabled={busy || !canSend(text)} onClick={send}>{busy ? 'Working it out…' : 'Send'}</button>
        </>
      )}
      {reply?.kind === 'message' && <div className="card pad small" style={{ background: 'var(--ground)' }}>💬 {reply.text}</div>}
      {reply?.kind === 'error' && <div className="small err" style={{ margin: 0 }} role="alert">{reply.text}</div>}
      {reply?.kind === 'plan' && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="label">I’ll set up:</span>
          <ul style={{ margin: 0, paddingLeft: 20 }} className="stack small" aria-label="What will be made">
            {reply.summary.map((line, i) => <li key={i} style={{ lineHeight: 1.4 }}>{line}</li>)}
          </ul>
          {reply.warnings.map((w, i) => <span key={i} className="small err" style={{ margin: 0 }}>⚠️ {w}</span>)}
          {reply.notes && <span className="small muted">Note: {reply.notes}</span>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn gold grow" disabled={busy} onClick={doIt}>{busy ? 'Setting it up…' : 'Do it'}</button>
            <button type="button" className="btn ghost grow" disabled={busy} onClick={() => setReply(null)}>Change something</button>
          </div>
          <span className="small muted">Players join with the link as usual (step 4). Everything can be changed afterwards.</span>
        </div>
      )}
      {(reply?.kind === 'plan' || reply?.kind === 'message') && <Rate key={reply.logId} logId={reply.logId} />}
      <Remaining r={remaining} />
    </div>
  );
}

/** /ask — questions about what's on and the group's own history. */
export default function Ask() {
  const [params] = useSearchParams();
  const about = params.get('about');
  const { status } = useSession();
  const head = askTitle(about);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // [{ q, reply }], newest first — kept for this tab's session per group (back from another page, it's still there).
  const group = currentGroup();
  const [thread, setThread] = useState(() => loadAsk(group));
  const [remaining, setRemaining] = useState(null);
  useEffect(() => { saveAsk(group, thread); }, [group, thread]);

  const ask = async (q) => {
    const question = String(q || '').trim();
    if (!canSend(question) || busy) return;
    setBusy(true);
    // 'history' (not 'ask') so it also works with the first version of the function, if that's what's deployed.
    const reply = await askHelper({ mode: 'history', text: question });
    if (reply.remaining) setRemaining(reply.remaining);
    setThread((t) => [{ q: question, reply }, ...t].slice(0, ASK_KEEP));
    setText('');
    setBusy(false);
  };

  return (
    <div className="page">
      <Header back title={head.title} sub={head.sub} />
      <div className="section stack" style={{ gap: 10 }}>
        <div className="chips" role="group" aria-label="Try asking">
          {askExamples(about).map((q) => <button key={q} type="button" className="chip" disabled={busy} onClick={() => ask(q)}>{q}</button>)}
          {status?.is_admin && <Link to="/import" className="chip" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'inherit', borderColor: 'var(--gold)' }}>✨ Bring in our history</Link>}
        </div>
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          <textarea className="textarea" rows={2} style={{ padding: 12 }} value={text} maxLength={MAX_TEXT} aria-label="Your question"
            placeholder="Ask anything about the group’s golf…" onChange={(e) => setText(e.target.value)} disabled={busy} />
          <button type="submit" className="btn gold" disabled={busy || !canSend(text)}>{busy ? 'Looking it up…' : 'Ask'}</button>
        </form>
        <Remaining r={remaining} />
        {thread.map(({ q, reply }, i) => (
          <div key={thread.length - i} className="card pad stack" style={{ gap: 6 }}>
            <span className="small muted">{q}</span>
            {reply.kind === 'error'
              ? <span className="small err" style={{ margin: 0 }} role="alert">{reply.text}</span>
              : <span style={{ lineHeight: 1.45 }}>{reply.text}</span>}
            {reply.kind !== 'error' && <Rate logId={reply.logId} />}
          </div>
        ))}
        {!thread.length && <p className="note" style={{ margin: 4 }}>The helper only reads your group’s own trips, rounds, scores, honour boards and handicaps. It can make mistakes — the leaderboard and honour boards are the official record.</p>}
      </div>
    </div>
  );
}
