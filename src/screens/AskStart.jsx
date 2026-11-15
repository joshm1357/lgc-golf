// "Ask some mates for a round", no group needed (#/ask). ov43 made it (Josh 12 Nov: "an ability to just start a call
// out to people without starting a group"); ov44 opens it to anyone (Josh 15 Nov, claude/round-door-addendum.md):
//   * BUILD FIRST, SIGN IN AT "MAKE THE LINK". The form shows to everyone. Sign-in is asked for only when they tap
//     "⛳ Make the link", with the reason ("so the answers come back to you"). What they chose is kept on this phone
//     across the trip to Google (or the emailed code) and back, and the link is then made without tapping it all again.
//   * DAYLIGHT. The ask has a place (the city of this phone's clock to start with; "change" for another city or any
//     suburb). The line under the form shows that place's sunrise, sunset and the last tee for 18 on the first date.
//   * It's counted, with no person attached: opened → tapped "Make the link" → signed in → link made (lib/door.js).
// Behind the scenes it's a quick group (036's kind, hidden) — migration 113's start_round_ask, which refuses unless the
// round door is open on this database (round_asks_open).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { Toaster } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { GolfTripCrest } from '../components/Logo.jsx';
import { SignInButtons } from './Join.jsx';
import { ASK_PART_KEYS, ASK_PARTS, RANGE_CHOICES, askCells, askWords, cleanAsk, askCloses, askPlace, cleanPlace, dayWord, DEFAULT_ASK, WEEK_DAYS } from '../lib/ask.js';
import { sydneyToday } from '../lib/callout.js';
import { SunLine, PlacePicker, guessPlace, phoneZone } from '../components/AskDaylight.jsx';
import { count, doorParams, setDoorSource } from '../lib/door.js';
import '../components/callout.css';

const DRAFT_KEY = 'tgt-ask-draft';
const DRAFT_MINUTES = 30;
/** What they chose, kept on this phone while they sign in (30 minutes is plenty; older than that is forgotten). */
export function readDraft(now = Date.now()) {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || typeof d.at !== 'number' || now - d.at > DRAFT_MINUTES * 60000 || now < d.at) return null;
    return d;
  } catch { return null; }
}
const writeDraft = (d) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, at: Date.now() })); } catch { /* fine */ } };
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* fine */ } };

export default function AskStart() {
  const { user, loading } = useSession() || {};
  const signedIn = !!user && !user.is_anonymous;
  const today = sydneyToday();
  const draft = useRef(readDraft()).current;
  const googleName = String(user?.user_metadata?.full_name || user?.user_metadata?.name || '').split(' ')[0].slice(0, 30);
  const [name, setName] = useState(() => draft?.name || googleName);
  const [days, setDays] = useState(() => (Array.isArray(draft?.days) && draft.days.length ? draft.days : WEEK_DAYS.slice())); // v2.1: every day, any time, next 4 weeks
  const [parts, setParts] = useState(() => (Array.isArray(draft?.parts) ? draft.parts : []));
  const [range, setRange] = useState(() => draft?.range || DEFAULT_ASK.range);
  const [place, setPlace] = useState(() => cleanPlace(draft?.place) || guessPlace() || askPlace({ zone: phoneZone() }));
  const [wantSignIn, setWantSignIn] = useState(false);
  const [open, setOpen] = useState(null); // is the round door open on this database? null = not known yet
  const [busy, run] = useRun();
  const ask = useMemo(() => cleanAsk({ days: days.length === 7 ? [] : days, parts, range, times: [], place }), [days, parts, range, place]);
  const cells = useMemo(() => askCells(ask, today), [ask, today]);
  const n = cells.length;
  const dates = useMemo(() => [...new Set(cells.map((c) => c.date))].sort(), [cells]);

  // Where they came from (the website's button, a mate's ask), and "opened".
  useEffect(() => {
    const hash = window.location.hash || '';
    const p = doorParams(hash.includes('?') ? hash.slice(hash.indexOf('?')) : '');
    setDoorSource(p.source);
    count(supabase, 'opened');
    if (p.from) count(supabase, 'own_started');
    supabase.rpc('round_asks_open').then(({ data, error }) => setOpen(error ? true : data !== false), () => setOpen(true)); // older database: let the ask itself say
  }, []);
  // The name from Google, once they're signed in (only if they haven't typed one).
  useEffect(() => { if (googleName && !name.trim()) setName(googleName); }, [googleName]); // eslint-disable-line react-hooks/exhaustive-deps

  const make = () => run(async () => {
    count(supabase, 'signed_in');
    let r;
    try {
      r = await must(supabase.rpc('start_round_ask', { p_my_name: name.trim(), p_ask: ask, p_spots: null, p_closes_at: askCloses(ask, today).toISOString() }));
    } catch (e) {
      writeDraft({ name: name.trim(), days, parts, range, place, go: false }); // keep what they chose, but don't try again by itself
      throw e;
    }
    clearDraft();
    count(supabase, 'link_made');
    setCurrentGroup(r.group_id);
    window.location.hash = `#/plan/${r.plan_id}`;
    window.location.reload();
  });
  const go = () => {
    count(supabase, 'built');
    if (signedIn) { make(); return; }
    writeDraft({ name: name.trim(), days, parts, range, place, go: true });
    setWantSignIn(true);
  };
  // Back from signing in (a trip to Google reloads the page; an emailed code doesn't) with an ask waiting: make the link.
  const resumed = useRef(false);
  useEffect(() => {
    if (loading || !signedIn || resumed.current) return;
    const d = readDraft();
    if (!d?.go || !String(d.name || name).trim()) return;
    resumed.current = true;
    make();
  }, [loading, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !!name.trim() && n > 0;
  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 14px 40px', gap: 14 }} data-testid="ask-start">
      <GolfTripCrest size={64} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>⛳ Ask some mates for a round</div>
        <div className="small" style={{ color: 'var(--on-navy-muted)', marginTop: 6, maxWidth: 360 }}>No group needed. Say when, share the link in the chat, and they tap the times they can play — no app, no sign-in for them.</div>
      </div>
      {open === false ? (
        <div className="card pad stack" style={{ width: '100%', maxWidth: 480, gap: 8, color: 'var(--text)' }} data-testid="ask-start-shut">
          <strong>Not open just yet</strong>
          <span className="small">Asking some mates for a round is on its way. Got an invite link from your group? Open it to join them.</span>
        </div>
      ) : wantSignIn && !signedIn ? (
        <div className="stack" style={{ width: '100%', maxWidth: 480, gap: 12, alignItems: 'center' }} data-testid="ask-start-signin">
          <div className="card pad stack" style={{ width: '100%', gap: 4, color: 'var(--text)' }}>
            <strong>Your ask: {askWords(ask)}</strong>
            <span className="small muted">Kept on this phone while you sign in — you won’t tap it all again.</span>
          </div>
          <div style={{ fontWeight: 700, textAlign: 'center' }}>Sign in so the answers come back to you</div>
          <div className="small" style={{ color: 'var(--on-navy-muted)', textAlign: 'center', maxWidth: 340, marginTop: -6 }}>It’s how you see who can play when, and get a buzz the first time a 4-ball can. Your mates don’t need to.</div>
          <SignInButtons returnHash="#/ask" />
          <button type="button" className="linkish" style={{ color: 'var(--on-navy-muted)' }} onClick={() => { clearDraft(); setWantSignIn(false); }} data-testid="ask-start-back">Change the ask</button>
        </div>
      ) : (
        <div className="card pad stack" style={{ width: '100%', maxWidth: 480, gap: 14, color: 'var(--text)' }} data-testid="ask-start-form">
          <label className="field"><span>Your name (what your mates see)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="given-name" data-testid="ask-start-name" /></label>
          <div className="co-step">
            <span className="label">Days</span>
            <div className="co-chips" data-testid="ask-start-days">
              <button type="button" className="chip" aria-pressed={days.length === 7} onClick={() => setDays(WEEK_DAYS.slice())}>Every day</button>
              {WEEK_DAYS.map((d) => <button key={d} type="button" className="chip" aria-pressed={days.length < 7 && days.includes(d)} onClick={() => setDays(days.length === 7 ? [d] : days.includes(d) && days.length === 1 ? WEEK_DAYS.slice() : days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}>{dayWord(d)}</button>)}
            </div>
          </div>
          <div className="co-step">
            <span className="label">Times</span>
            <div className="co-chips" data-testid="ask-start-parts">
              <button type="button" className="chip" aria-pressed={!parts.length} onClick={() => setParts([])}>Any time</button>
              {ASK_PART_KEYS.map((p) => <button key={p} type="button" className="chip" aria-pressed={parts.includes(p)} onClick={() => setParts(!parts.length ? [p] : parts.includes(p) ? parts.filter((x) => x !== p) : parts.length + 1 === ASK_PART_KEYS.length ? [] : [...parts, p])}>{ASK_PARTS[p].label}</button>)}
            </div>
          </div>
          <div className="co-step">
            <span className="label">How far ahead</span>
            <div className="co-chips" data-testid="ask-start-range">{RANGE_CHOICES.map((c) => <button key={c.key} type="button" className="chip" aria-pressed={range.kind === c.range.kind && (c.range.kind === 'open' || range.days === c.range.days)} onClick={() => setRange(c.range)}>{c.label}</button>)}</div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <SunLine dates={dates} place={place} />
            <PlacePicker place={place} onPick={setPlace} words="Daylight and weather for" />
          </div>
          <div className="small muted" data-testid="ask-start-words">{askWords(ask)} · they say when they can; you hear the first time a 4-ball can play</div>
          <button type="button" className="btn gold block" style={{ minHeight: 56 }} disabled={busy || loading || !ready} onClick={go} data-testid="ask-start-go">{busy ? 'Making the link…' : '⛳ Make the link'}</button>
          <span className="small muted">{signedIn ? 'Next you share it to the group chat. You’ll see who can make what as they answer.' : 'Next: a quick sign-in (so the answers come back to you), then share it to the group chat.'}</span>
        </div>
      )}
      <a href="#/" className="small" style={{ color: 'var(--on-navy-muted)' }}>Back</a>
      <span className="small" style={{ color: 'var(--on-navy-muted)' }}>The Golf Trip · <a href="#/privacy" style={{ color: 'inherit' }}>Privacy</a></span>
      <Toaster />
    </div>
  );
}
