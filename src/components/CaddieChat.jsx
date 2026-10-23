// The Caddie's chat (22 Oct 2026), inside the phone's sheet or the laptop's side panel (components/Caddie.jsx).
//   * It knows the screen you're on (lib/caddie.js caddieContext) and offers three questions for it.
//   * With the AI: asks the ai-helper function (mode 'history' — the Ask screen's — with the screen as `context`).
//     An answer can bring a "Go there →" button (the function's go_to); if not, places that match the question are
//     offered as "Might help:". 👍 / 👎 as on the Ask screen. The caddie never changes anything itself.
//   * Without the AI (switched off, not set up yet, no signal, cap reached, a guest, a quick round, viewing as
//     someone): it still opens and says why in one line, then finds the right page by keyword (no AI, no signal
//     needed). Organiser-only places are only offered to organisers.
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { currentGroup } from '../lib/group.js';
import { featureOn as featureOnIn } from '../lib/features.js';
import { useData, useSession, cacheGet, cacheSet } from '../lib/store.jsx';
import { readReply, canSend, remainingLabel, MAX_TEXT } from '../lib/aihelper.js';
import { pickDeskPlan } from '../lib/desk.js';
import { todayISO } from '../lib/plan.js';
import {
  caddieContext, caddieSuggestions, caddieMode, fallbackIntro, sessionFlag, caddieIds, searchDestinations, goButton,
  HELLO_TEXT, isPlanATrip,
} from '../lib/caddie.js';
import { Rate } from '../screens/AiHelper.jsx';
import Thinking from './Thinking.jsx';

const FLAG_KEY = 'tgt-caddie-flag'; // 'not_set_up' | 'capped', remembered for this visit
const readFlag = () => { try { return sessionStorage.getItem(FLAG_KEY); } catch { return null; } };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function useOnline() {
  const [on, setOn] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

/** The trip plan the caddie points to for "kitty", "jobs"… (the desk's pick), kept on the phone for no signal. */
function useCurrentPlan(planner, trips) {
  const key = `caddie-plan-${currentGroup() || 'x'}`;
  const [plan, setPlan] = useState(() => cacheGet(key));
  useEffect(() => {
    if (!planner) return;
    let live = true;
    supabase.from('plans').select('id,name,status,start_date,end_date,trip_id,created_at').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (!live || error) return;
      const p = pickDeskPlan(data || [], trips || []);
      const small = p ? { id: p.id } : null;
      cacheSet(key, small);
      setPlan(small);
    }, () => {});
    return () => { live = false; };
  }, [planner]); // eslint-disable-line react-hooks/exhaustive-deps
  return planner ? plan : null;
}

function GoList({ items, onGo, label }) {
  if (!items?.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {label && <span className="small muted">{label}</span>}
      {items.map((m) => (
        <button key={m.key + m.path} type="button" className="btn ghost caddie-go" aria-label={`${m.label} — Go there`} onClick={() => onGo(m.path)}>
          <span className="grow" style={{ textAlign: 'left' }}>{m.label}</span><span aria-hidden="true">Go there →</span>
        </button>
      ))}
    </div>
  );
}

export default function CaddieChat({ onGo, ask: askNow }) {
  const loc = useLocation();
  const data = useData();
  const { status } = useSession();
  const online = useOnline();
  const isOn = (k) => featureOnIn(k, data.features || {});
  const [flag, setFlag] = useState(readFlag);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState([]); // newest first
  const [remaining, setRemaining] = useState(null);
  const plan = useCurrentPlan(isOn('planner'), data.trips);

  const ctx = useMemo(() => caddieContext(loc.pathname, loc.search, { round: data.defaultRound?.id }), [loc.pathname, loc.search, data.defaultRound?.id]);
  const isAdmin = !!status?.is_admin && !status?.viewing;
  const roundName = ctx.round_id ? data.rounds?.find((r) => r.id === ctx.round_id)?.name : '';
  // Walkthrough small fix (ov27): no "Who's leading today?" when nothing's being played.
  const playDay = todayISO();
  const playing = !!ctx.round_id || (data.rounds || []).some((r) => r.status === 'live' || (r.play_date && String(r.play_date).slice(0, 10) === playDay));
  const suggestions = caddieSuggestions(ctx, { isAdmin, roundName, playing });
  const mode = caddieMode({
    viewing: !!status?.viewing, guest: status?.role === 'guest', quick: !!status?.quick, featureOn: isOn('ai_helper'),
    notSetUp: flag === 'not_set_up', capped: flag === 'capped', offline: !online || !!data.offline,
  });
  const ids = caddieIds(ctx, { rounds: data.rounds, liveRound: data.liveRound, defaultRound: data.defaultRound, currentTrip: data.currentTrip, plan, me: status?.player_id, today: today() });
  const find = (q) => searchDestinations(q, { isAdmin, featureOn: isOn, ids });

  const ask = async (raw) => {
    const q = String(raw || '').trim();
    if (!q || busy) return;
    setText('');
    // "plan a trip" (the hello says to): over to ✨ Plan a trip.
    if (isPlanATrip(q)) { window.dispatchEvent(new CustomEvent('caddie:open', { detail: { plan: true } })); return; }
    if (!mode.ai) {
      setThread((t) => [{ q, local: true, intro: fallbackIntro(mode), matches: find(q) }, ...t].slice(0, 10));
      return;
    }
    if (!canSend(q)) return;
    setBusy(true);
    const { data: d, error } = await supabase.functions.invoke('ai-helper', { body: { mode: 'history', text: q, context: ctx, group_id: currentGroup() || undefined } });
    const reply = readReply(d, error);
    setBusy(false);
    if (reply.remaining) setRemaining(reply.remaining);
    const f = sessionFlag(reply) || (reply.off ? 'off' : null);
    if (f === 'not_set_up' || f === 'capped') { try { sessionStorage.setItem(FLAG_KEY, f); } catch { /* fine */ } setFlag(f); }
    if (f) {
      const why = caddieMode({ featureOn: f !== 'off', notSetUp: f === 'not_set_up', capped: f === 'capped' });
      setThread((t) => [{ q, local: true, intro: fallbackIntro(why), matches: find(q) }, ...t].slice(0, 10));
      return;
    }
    const go = reply.go ? goButton(reply.go, { isAdmin, featureOn: isOn, me: status?.player_id }) : null;
    setThread((t) => [{ q, reply, go, matches: go ? [] : find(q) }, ...t].slice(0, 10));
  };

  // Opened with a question (openCaddie('…')): ask it straight away.
  useEffect(() => { if (askNow?.q) ask(askNow.q); }, [askNow?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack caddie-chat" style={{ gap: 10 }} data-testid="caddie-chat" data-ai={mode.ai ? 'on' : 'off'}>
      {!thread.length && (
        // ov22: the empty chat starts with Caddie saying hello — the same words as the first-visit bubble.
        <div className="caddie-hello-msg" data-testid="caddie-greeting"><span aria-hidden="true">👋 </span>{HELLO_TEXT}</div>
      )}
      {!mode.ai && <div className="small caddie-why" role="note">{fallbackIntro(mode).replace(/:$/, '.')}</div>}
      <div className="chips" style={{ padding: 0, flexWrap: 'wrap' }} role="group" aria-label="Try asking">
        {suggestions.map((q) => <button key={q} type="button" className="chip" disabled={busy} onClick={() => ask(q)}>{q}</button>)}
      </div>
      <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <textarea className="textarea" rows={2} style={{ padding: 12, minHeight: 64 }} value={text} maxLength={MAX_TEXT} aria-label="Ask the caddie" disabled={busy}
          placeholder={mode.ai ? 'Ask anything — or where to find something…' : 'Where do you want to go? e.g. teams, rules, kitty'}
          onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn gold" disabled={busy || !String(text).trim() || (mode.ai && !canSend(text))}>
          {busy ? 'Looking it up…' : mode.ai ? 'Ask' : 'Find it'}
        </button>
      </form>
      {busy && mode.ai && <Thinking steps={['Reading your question', 'Looking it up', 'Writing the answer']} />}
      {remaining && <span className="small muted">{remainingLabel(remaining)}</span>}
      {thread.map((m, i) => (
        <div key={thread.length - i} className="card pad stack" style={{ gap: 8 }} data-testid="caddie-answer">
          <span className="small muted">{m.q}</span>
          {m.local ? (
            <>
              <span style={{ lineHeight: 1.45 }}>{m.intro}</span>
              {m.matches.length
                ? <GoList items={m.matches} onGo={onGo} />
                : <span className="small muted">Nothing matched — try a word like teams, rules, scores or kitty.</span>}
            </>
          ) : (
            <>
              {m.reply.kind === 'error'
                ? <span className="small err" style={{ margin: 0 }} role="alert">{m.reply.text}</span>
                : <span style={{ lineHeight: 1.45 }}>{m.reply.text}</span>}
              {m.go && <GoList items={[m.go]} onGo={onGo} />}
              <GoList items={m.matches} onGo={onGo} label="Might help:" />
              {m.reply.kind !== 'error' && <Rate logId={m.reply.logId} />}
            </>
          )}
        </div>
      ))}
      {!thread.length && (
        <p className="note small" style={{ margin: 2 }}>
          {mode.ai
            ? 'I read your group’s own trips, rounds, scores and rules, and can take you to the right screen. I can make mistakes — the leaderboard is the official record.'
            : 'Type what you’re after and I’ll find the screen.'}
          {mode.ai && <> <a href="#/ask" onClick={(e) => { e.preventDefault(); onGo('/ask'); }}>Full screen</a></>}
        </p>
      )}
    </div>
  );
}
