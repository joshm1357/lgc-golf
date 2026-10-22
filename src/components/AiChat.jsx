// A chat with the AI helper (080): messages back and forth, each helper turn can carry a card (e.g. the trip draft)
// and 1–3 questions with tappable quick answers. A quick answer ending in "…" opens the box to type instead.
// Reusable: "Plan it with AI" uses it now; the Caddie can later. No maths here — see lib/planchat.js.
// ov22 (Josh 23 Oct): a question the helper marks multi (regions, extras, weekends…) has toggle chips — tap several,
// then "Send (3)" sends them together. One-answer questions (driving or flying, how many) still send on tap.
import React, { useEffect, useRef, useState } from 'react';
import { quickChoice, togglePick, multiSend, multiOther, typesIt } from '../lib/planchat.js';
import Thinking from './Thinking.jsx';
import './planux.css';

/**
 * turns: [{ role: 'user' | 'assistant', text, questions?: [{ id, text, quick: [] }], card?: node }]
 * onSend(text) → sends one message. busy: waiting for the helper. left: questions left (null = don't show).
 * placeholder: the box's hint. footer: anything under the box (e.g. "Use this plan"). hint: a line under the helper's
 * latest reply (the planning chat's "Or just say 'plan it'…", ov16).
 */
export default function AiChat({ turns = [], onSend, busy = false, left = null, placeholder = 'Type here…', footer = null, intro = null, hint = null, maxLength = 600, thinkingSteps = undefined }) {
  const [text, setText] = useState('');
  const [picks, setPicks] = useState({}); // question id → quick answers picked (pick-several questions)
  const box = useRef(null);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [turns.length, busy]);
  const last = turns[turns.length - 1];
  // A new reply: nothing picked yet.
  useEffect(() => { setPicks({}); }, [turns.length]);
  const send = (t) => { const v = String(t || '').trim(); if (!v || busy) return; onSend(v); setText(''); };
  const openBox = (prefix) => { setText(prefix); setTimeout(() => { const el = box.current; if (!el) return; el.focus(); const n = el.value.length; el.setSelectionRange?.(n, n); }, 0); };
  const tapQuick = (q, quick) => {
    if (q.multi) {
      if (typesIt(quick)) { const c = multiOther(q, picks[q.id] || [], quick); if (c.send) send(c.send); else openBox(c.ask); return; }
      setPicks((p) => ({ ...p, [q.id]: togglePick(p[q.id] || [], quick) }));
      return;
    }
    const c = quickChoice(q, quick);
    if (c.send) send(c.send);
    else openBox(c.ask);
  };
  const sendPicks = (q) => { const c = multiSend(q, picks[q.id] || []); if (c) { send(c.send); setPicks((p) => ({ ...p, [q.id]: [] })); } };
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
          {t === last && t.role === 'assistant' && (t.questions || []).map((q) => {
            const mine = picks[q.id] || [];
            return (
              <div key={q.id} className="card pad stack" style={{ gap: 6 }} data-testid="chat-question" data-multi={q.multi ? 'yes' : undefined}>
                <span className="small" style={{ fontWeight: 700 }}>{q.text}</span>
                {q.multi && <span className="small muted">Pick any, then send.</span>}
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role={q.multi ? 'group' : undefined} aria-label={q.multi ? q.text : undefined}>
                  {q.quick.map((x) => {
                    const toggle = q.multi && !typesIt(x);
                    const on = toggle && mine.includes(x);
                    return (
                      <button key={x} type="button" className="chip" style={{ minHeight: 40 }} disabled={busy || out}
                        aria-pressed={toggle ? on : undefined} onClick={() => tapQuick(q, x)}>{on ? '✓ ' : ''}{x}</button>
                    );
                  })}
                </div>
                {q.multi && (
                  <button type="button" className="btn gold sm" style={{ alignSelf: 'flex-start', minHeight: 44 }} disabled={busy || out || !mine.length}
                    onClick={() => sendPicks(q)} data-testid="chat-multi-send">{mine.length ? `Send (${mine.length})` : 'Send'}</button>
                )}
              </div>
            );
          })}
          {t === last && t.role === 'assistant' && hint}
        </div>
      ))}
      {busy && <Thinking steps={thinkingSteps} />}
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
