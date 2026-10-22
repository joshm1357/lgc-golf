// "Was that helpful? 👍 👎" under every AI answer (22 Oct 2026, migration 075). Josh is testing whether people like
// the AI features (and which model they like more — see abtest.ts), so every answer asks, lightly:
//   * one row: Was that helpful? 👍 👎 (tap again to clear) → "Thanks!"
//   * after 👎, one tap to say why (Wrong, Didn't answer, Too slow, Too long, Not useful, Other) and an optional
//     short note. The note goes to Josh's Wishes screen only — never to the AI. No pop-ups, no nagging.
// Only the person who asked can rate their answer (rate_helper and helper_feedback check that in the database).
import React, { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { toast } from './ui.jsx';
import { nextRating } from '../lib/aihelper.js';
import { REASONS, MAX_NOTE, cleanNote } from '../lib/feedback.js';

export default function AnswerFeedback({ logId }) {
  const [rating, setRating] = useState(0);
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [noteSent, setNoteSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (logId == null) return null;

  const rate = async (v) => {
    const next = nextRating(rating, v);
    setBusy(true);
    const { error } = await supabase.rpc('rate_helper', { p_log: logId, p_rating: next });
    setBusy(false);
    if (error) return toast('Couldn’t save that — try again');
    setRating(next);
    if (next !== -1) { setReason(null); setNote(''); setNoteSent(false); }
  };
  const why = async (key, withNote = null) => {
    setBusy(true);
    const { error } = await supabase.rpc('helper_feedback', { p_log: logId, p_reason: key, p_note: withNote });
    setBusy(false);
    if (error) { toast('Couldn’t save that — try again'); return false; }
    setReason(key);
    return true;
  };
  const sendNote = async () => {
    const n = cleanNote(note);
    if (!n || !reason) return;
    if (await why(reason, n)) setNoteSent(true);
  };

  const thumb = (v, icon, label) => (
    <button type="button" className="btn ghost sm" aria-label={label} aria-pressed={rating === v} disabled={busy} onClick={() => rate(v)}
      style={{ minWidth: 48, minHeight: 40, ...(rating === v ? { background: 'var(--gold-soft)', borderColor: 'var(--gold)' } : {}) }}>{icon}</button>
  );
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="answer-feedback">
      <div className="row" style={{ gap: 6, alignItems: 'center' }} role="group" aria-label="Was that helpful?">
        <span className="small muted">{rating ? 'Thanks!' : 'Was that helpful?'}</span>
        {thumb(1, '👍', 'Helpful')}
        {thumb(-1, '👎', 'Not helpful')}
      </div>
      {rating === -1 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">{reason ? 'Got it, cheers — that helps us fix it.' : 'What was wrong with it?'}</span>
          <div className="chips" role="group" aria-label="What was wrong" style={{ flexWrap: 'wrap' }}>
            {REASONS.map((r) => (
              <button key={r.key} type="button" className="chip" aria-pressed={reason === r.key} disabled={busy} onClick={() => why(r.key)}>{r.label}</button>
            ))}
          </div>
          {reason && !noteSent && (
            <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); sendNote(); }}>
              <input className="input grow" value={note} maxLength={MAX_NOTE} onChange={(e) => setNote(e.target.value)} disabled={busy}
                placeholder="Add a note (optional)" aria-label="Add a note (optional)" style={{ minWidth: 0 }} />
              <button type="submit" className="btn ghost sm" disabled={busy || !cleanNote(note)} style={{ minHeight: 40 }}>Send</button>
            </form>
          )}
          {noteSent && <span className="small muted">Note sent to the app’s owner.</span>}
        </div>
      )}
    </div>
  );
}
