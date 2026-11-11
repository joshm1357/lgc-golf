// ov43 — "Ask some mates for a round", no group needed (#/ask; Josh 12 Nov: "an ability to just start a call out to people
// without starting a group"). Sign in once (so the answers come back to you), say when, and share the link to WhatsApp.
// Behind the scenes it's a quick group (036's kind, hidden until made official) — migration 111's start_round_ask.
// The full ask (every option, the reply grid, the board) is the same as inside a group; this is the 10-second version.
import React, { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { Toaster } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { GolfTripCrest } from '../components/Logo.jsx';
import { SignInButtons } from './Join.jsx';
import { ASK_PART_KEYS, ASK_PARTS, RANGE_CHOICES, askCells, askWords, cleanAsk, askCloses, dayWord, DEFAULT_ASK, WEEK_DAYS } from '../lib/ask.js';
import { sydneyToday } from '../lib/callout.js';
import '../components/callout.css';

export default function AskStart() {
  const { user, loading } = useSession() || {};
  const signedIn = !!user && !user.is_anonymous;
  const today = sydneyToday();
  const [name, setName] = useState(() => String(user?.user_metadata?.full_name || user?.user_metadata?.name || '').split(' ')[0].slice(0, 30));
  const [days, setDays] = useState(WEEK_DAYS.slice()); // v2.1: every day, any time, next 4 weeks; no group size
  const [parts, setParts] = useState([]);
  const [range, setRange] = useState(DEFAULT_ASK.range);
  const [busy, run] = useRun();
  const ask = useMemo(() => cleanAsk({ days: days.length === 7 ? [] : days, parts, range, times: [] }), [days, parts, range]);
  const n = askCells(ask, today).length;
  const go = () => run(async () => {
    const r = await must(supabase.rpc('start_round_ask', { p_my_name: name.trim(), p_ask: ask, p_spots: null, p_closes_at: askCloses(ask, today).toISOString() }));
    setCurrentGroup(r.group_id);
    window.location.hash = `#/plan/${r.plan_id}`;
    window.location.reload();
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 14px 40px', gap: 14 }} data-testid="ask-start">
      <GolfTripCrest size={64} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>⛳ Ask some mates for a round</div>
        <div className="small" style={{ color: 'var(--on-navy-muted)', marginTop: 6, maxWidth: 360 }}>No group needed. Say when, share the link in the chat, and they tap the times they can play — no app, no sign-in for them.</div>
      </div>
      {loading ? null : !signedIn ? (
        <>
          <div style={{ fontWeight: 700 }}>Sign in first, so the answers come back to you</div>
          <SignInButtons returnHash="#/ask" />
        </>
      ) : (
        <div className="card pad stack" style={{ width: '100%', maxWidth: 480, gap: 14, color: 'var(--text)' }}>
          <label className="field"><span>Your name (what your mates see)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} data-testid="ask-start-name" /></label>
          <div className="co-step">
            <span className="label">Days</span>
            <div className="co-chips" data-testid="ask-start-days">
              <button type="button" className="chip" aria-pressed={days.length === 7} onClick={() => setDays(WEEK_DAYS.slice())}>Every day</button>
              {WEEK_DAYS.map((d) => <button key={d} type="button" className="chip" aria-pressed={days.length < 7 && days.includes(d)} onClick={() => setDays(days.length === 7 ? [d] : days.includes(d) && days.length === 1 ? WEEK_DAYS.slice() : days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}>{dayWord(d)}</button>)}
            </div>
          </div>
          <div className="co-step">
            <span className="label">Times</span>
            <div className="co-chips">
              <button type="button" className="chip" aria-pressed={!parts.length} onClick={() => setParts([])}>Any time</button>
              {ASK_PART_KEYS.map((p) => <button key={p} type="button" className="chip" aria-pressed={parts.includes(p)} onClick={() => setParts(!parts.length ? [p] : parts.includes(p) ? parts.filter((x) => x !== p) : parts.length + 1 === ASK_PART_KEYS.length ? [] : [...parts, p])}>{ASK_PARTS[p].label}</button>)}
            </div>
          </div>
          <div className="co-step">
            <span className="label">How far ahead</span>
            <div className="co-chips">{RANGE_CHOICES.map((c) => <button key={c.key} type="button" className="chip" aria-pressed={range.kind === c.range.kind && (c.range.kind === 'open' || range.days === c.range.days)} onClick={() => setRange(c.range)}>{c.label}</button>)}</div>
          </div>
          <div className="small muted">{askWords(ask)} · they say when they can; you hear the first time a 4-ball can play</div>
          <button type="button" className="btn gold block" style={{ minHeight: 56 }} disabled={busy || !name.trim() || !n} onClick={go} data-testid="ask-start-go">⛳ Make the link</button>
          <span className="small muted">Next you share it to the group chat. You’ll see who can make what as they answer.</span>
        </div>
      )}
      <a href="#/" className="small" style={{ color: 'var(--on-navy-muted)' }}>Back</a>
      <Toaster />
    </div>
  );
}
