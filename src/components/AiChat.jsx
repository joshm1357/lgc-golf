// A chat with the AI helper (080): messages back and forth, each helper turn can carry a card (e.g. the trip draft)
// and 1–3 questions with tappable quick answers. A quick answer ending in "…" opens the box to type instead.
// Reusable: "Plan it with AI" uses it now; the Caddie can later. No maths here — see lib/planchat.js.
// ov22 + v10.4 (Josh 23 Oct): every quick answer is a toggle — tap as many as you like across the questions, type
// anything extra in the box, then one Send sends it all together. Nothing sends on a single tap.
import React, { useEffect, useRef, useState } from 'react';
import { togglePick, multiOther, typesIt, answersMessage, pickCount } from '../lib/planchat.js';
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
    // "Other…": open the box (with what's picked for that question so far) — never sends.
    // Its picks move into the box, so they're cleared here (not sent twice).
    if (typesIt(quick)) {
      const c = multiOther(q, picks[q.id] || [], quick);
      const before = String(text || '').trim();
      openBox(`${before ? `${before}\n` : ''}${c.ask || ''}`);
      setPicks((p) => ({ ...p, [q.id]: [] }));
      return;
    }
    setPicks((p) => ({ ...p, [q.id]: togglePick(p[q.id] || [], quick) }));
  };
  const questions = last?.role === 'assistant' ? (last.questions || []) : [];
  const picked = pickCount(picks);
  // One send for the lot: the picks (per question) plus what's typed.
  const sendAll = () => {
    const typed = String(text || '').trim();
    const msg = answersMessage(questions, picks, typed);
    if (!msg) return;
    send(msg);
    setPicks({});
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
          {t === last && t.role === 'assistant' && (t.questions || []).map((q) => {
            const mine = picks[q.id] || [];
            return (
              <div key={q.id} className="card pad stack" style={{ gap: 6 }} data-testid="chat-question" data-multi="yes">
                <span className="small" style={{ fontWeight: 700 }}>{q.text}</span>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label={q.text}>
                  {q.quick.map((x) => {
                    const toggle = !typesIt(x);
                    const on = toggle && mine.includes(x);
                    return (
                      <button key={x} type="button" className="chip" style={{ minHeight: 40 }} disabled={busy || out}
                        aria-pressed={toggle ? on : undefined} onClick={() => tapQuick(q, x)}>{on ? '✓ ' : ''}{x}</button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {t === last && t.role === 'assistant' && questions.some((q) => q.quick.length) && (
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn gold sm" style={{ minHeight: 44 }} disabled={busy || out || !picked}
                onClick={sendAll} data-testid="chat-multi-send">{picked ? `Send ${picked} answer${picked === 1 ? '' : 's'}` : 'Send answers'}</button>
              <span className="small muted">{picked ? 'Tap again to untick. Add anything else in the box.' : 'Tap as many as fit, then send.'}</span>
            </div>
          )}
          {t === last && t.role === 'assistant' && hint}
        </div>
      ))}
      {busy && <Thinking steps={thinkingSteps} />}
      <div ref={end} />
      {out ? <span className="small muted">That’s the most questions for one chat — use what you’ve got, or start again.</span> : (
        <form className="row" style={{ gap: 6, alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); sendAll(); }}>
          <textarea ref={box} className="textarea grow" rows={2} style={{ padding: 10 }} value={text} maxLength={maxLength} placeholder={placeholder}
            aria-label="Your message" disabled={busy} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAll(); } }} />
          <button type="submit" className="btn gold" disabled={busy || (text.trim().length < 2 && !picked)} style={{ minHeight: 48 }}>Send</button>
        </form>
      )}
      {left != null && !out && <span className="small muted">{left} question{left === 1 ? '' : 's'} left in this chat</span>}
      {footer}
    </div>
  );
}
