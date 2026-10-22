// A chat with the AI helper (080): messages back and forth, each helper turn can carry a card (e.g. the trip draft)
// and 1–3 questions with tappable quick answers. A quick answer ending in "…" opens the box to type instead.
// Reusable: "Plan it with AI" uses it now; the Caddie can later. No maths here — see lib/planchat.js.
import React, { useEffect, useRef, useState } from 'react';
import { quickChoice } from '../lib/planchat.js';
import './planux.css';

/**
 * turns: [{ role: 'user' | 'assistant', text, questions?: [{ id, text, quick: [] }], card?: node }]
 * onSend(text) → sends one message. busy: waiting for the helper. left: questions left (null = don't show).
 * placeholder: the box's hint. footer: anything under the box (e.g. "Use this plan").
 */
export default function AiChat({ turns = [], onSend, busy = false, left = null, placeholder = 'Type here…', footer = null, intro = null, maxLength = 600 }) {
  const [text, setText] = useState('');
  const box = useRef(null);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [turns.length, busy]);
  const last = turns[turns.length - 1];
  const send = (t) => { const v = String(t || '').trim(); if (!v || busy) return; onSend(v); setText(''); };
  const tapQuick = (q, quick) => {
    const c = quickChoice(q, quick);
    if (c.send) send(c.send);
    else { setText(c.ask); setTimeout(() => { const el = box.current; if (!el) return; el.focus(); const n = el.value.length; el.setSelectionRange?.(n, n); }, 0); }
  };
  const out = left != null && left <= 0;
  return (
    <div className="stack" style={{ gap: 10 }} data-testid="ai-chat">
      {intro}
      {turns.map((t, i) => (
        <div key={i} className="stack" style={{ gap: 6, alignItems: t.role === 'user' ? 'flex-end' : 'stretch' }} data-testid={t.role === 'user' ? 'chat-me' : 'chat-ai'}>
          {t.text && (
            <div className="small" style={{
              maxWidth: '88%', padding: '9px 12px', borderRadius: 14, lineHeight: 1.4,
              ...(t.role === 'user' ? { background: 'var(--navy)', color: '#fff', borderBottomRightRadius: 4 } : { background: 'var(--ground)', borderBottomLeftRadius: 4 }),
            }}>{t.role === 'user' ? t.text : `✨ ${t.text}`}</div>
          )}
          {t.card}
          {t === last && t.role === 'assistant' && (t.questions || []).map((q) => (
            <div key={q.id} className="card pad stack" style={{ gap: 6 }} data-testid="chat-question">
              <span className="small" style={{ fontWeight: 700 }}>{q.text}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {q.quick.map((x) => <button key={x} type="button" className="chip" style={{ minHeight: 40 }} disabled={busy || out} onClick={() => tapQuick(q, x)}>{x}</button>)}
              </div>
            </div>
          ))}
        </div>
      ))}
      {busy && <div className="small muted" role="status">✨ Thinking…</div>}
      <div ref={end} />
      {out ? <span className="small muted">That’s the most questions for one chat — use what you’ve got, or start again.</span> : (
        <form className="row" style={{ gap: 6, alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <textarea ref={box} className="textarea grow" rows={2} style={{ padding: 10 }} value={text} maxLength={maxLength} placeholder={placeholder}
            aria-label="Your message" disabled={busy} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} />
          <button type="submit" className="btn gold" disabled={busy || text.trim().length < 2} style={{ minHeight: 48 }}>Send</button>
        </form>
      )}
      {left != null && !out && <span className="small muted">{left} question{left === 1 ? '' : 's'} left in this chat</span>}
      {footer}
    </div>
  );
}
