// ov43 — the ask's own link: #/a/<token> (Josh 12 Nov: "I want the app to be independent… they can answer simply, but
// try to incentivise them to log in. Ensure there is an email or something to enable them to be contacted").
// Opens straight on the grid — no group, no "Who are you?", no sign-in. First time: a name and an email or mobile, then
// the times. This phone keeps a key so the answer can be changed. Then the nudge: sign in (10 seconds) and the answer
// becomes yours in the app — a buzz when it's locked in, your usual week next time, your scores. Already in the group
// on this phone? The app opens instead. Database: migration 111 (ask_public, ask_guest_answer, ask_guest_claim).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { Toaster, toast } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { GolfTripCrest } from '../components/Logo.jsx';
import { SignInButtons } from './Join.jsx';
import AskReply from '../components/AskReply.jsx';
import { askCells, askWords, rankCells, cellWords, leaderLine, teeWords, contactOf, guestKeyName } from '../lib/ask.js';
import { dayLabel, clock, sydneyToday } from '../lib/callout.js';
import '../components/callout.css';

const keyOf = (token) => { try { return localStorage.getItem(guestKeyName(token)) || null; } catch { return null; } };
const openInApp = (groupId, planId) => { setCurrentGroup(groupId); window.location.hash = `#/plan/${planId}`; window.location.reload(); };

export default function AskPublic({ token }) {
  const { status, user, loading } = useSession() || {};
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [key, setKey] = useState(() => keyOf(token));
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, run] = useRun();
  const signedIn = !!user && !user.is_anonymous;

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('ask_public', { p_token: token, p_key: key });
    if (error) { setErr(error.message || 'That link isn’t working'); return; }
    setD(data);
  }, [token, key]);
  useEffect(() => { if (!loading) load(); }, [load, loading, user?.id]);

  // In the group on this phone already → the app. Signed in with an answer from this phone → make it yours, then the app.
  useEffect(() => {
    if (!d) return;
    if (d.member) { openInApp(d.group_id, d.plan_id); return; }
    if (signedIn && key && d.me) {
      supabase.rpc('ask_guest_claim', { p_token: token, p_key: key }).then(({ data, error }) => {
        if (error) { toast(error.message); return; }
        openInApp(data.group_id, data.plan_id);
      });
    }
  }, [d?.member, d?.me?.player_id, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = sydneyToday();
  const cells = useMemo(() => (d?.ask ? askCells(d.ask, today) : []), [d?.ask, today]);
  const ranked = useMemo(() => rankCells(cells, d?.answers || [], { full: d?.ask_full || [] }), [cells, d?.answers, d?.ask_full]);
  const names = (ids) => ids.map((id) => d.answers.find((a) => a.player_id === id)?.name).filter(Boolean).join(', ');

  if (err) {
    return <Page><div className="card pad" data-testid="ask-public-err"><strong>{err}</strong></div></Page>;
  }
  if (!d) return <Page><div className="small" style={{ color: 'var(--on-navy-muted)' }}>Loading…</div></Page>;

  const me = d.me;
  const open = d.status === 'planning' && !d.voting;
  const plan = { id: d.plan_id, group_id: d.group_id, ask: d.ask };
  const needWho = !me;
  const c = contactOf(contact);
  const submit = async ({ slots, cant, where }) => {
    if (needWho && !name.trim()) throw new Error('Your name, please');
    if (needWho && !c) throw new Error('Add an email or mobile so they can reach you');
    const r = await must(supabase.rpc('ask_guest_answer', {
      p_token: token, p_name: name.trim() || null, p_email: c?.email || null, p_phone: c?.phone || null,
      p_slots: slots, p_cant: cant, p_where: where, p_key: key,
    }));
    if (r?.key) { try { localStorage.setItem(guestKeyName(token), r.key); } catch { /* fine */ } setKey(r.key); }
    toast(cant ? 'Got it — you won’t be nagged about this one' : 'Sent');
    setEditing(false);
  };
  const top = ranked[0];
  const standing = me?.standing;

  return (
    <Page>
      <div className="stack" style={{ gap: 4, textAlign: 'center', color: '#fff' }} data-testid="ask-public">
        <div style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>⛳ {d.by}: anyone keen for a round?</div>
        <div className="small" style={{ color: 'var(--on-navy-muted)' }}>{d.ask ? askWords(d.ask) : ''}{d.course ? ` · ${d.course}` : ''}</div>
      </div>

      {d.status === 'cancelled' && <div className="card pad"><strong>Called off.</strong> Nobody’s playing this one.</div>}

      {/* Locked in */}
      {(d.status === 'confirmed' || d.status === 'done') && (
        <div className="card pad stack" style={{ gap: 6 }} data-testid="ask-public-locked">
          <span className="label">🔒 Locked in</span>
          <strong style={{ fontSize: 20 }}>{dayLabel(String(d.start_date).slice(0, 10))}{d.tee_time ? ` · ${clock(d.tee_time)}` : ''}{d.course ? ` · ${d.course}` : ''}</strong>
          {standing && <span>{standing.has_spot ? '✅ You’re in.' : `⏳ You’re reserve #${standing.place} — you’ll hear if a spot opens.`}</span>}
          {me && !standing && <span>🙁 Not this time — it’s the time you couldn’t make.</span>}
          {d.booked && <span className="small muted">Booked ✓</span>}
        </div>
      )}

      {d.voting && d.status === 'planning' && (
        <div className="card pad"><strong>It’s down to a vote.</strong> <span className="small">Sign in below to tick the times you can make.</span></div>
      )}

      {/* Answer (or change it) */}
      {open && (me && !editing ? (
        <div className="card pad row between" data-testid="ask-public-mine">
          <span><strong>{me.name}:</strong> {me.answer?.cant ? 'can’t this round' : `${me.answer?.slots?.length || 0} time${me.answer?.slots?.length === 1 ? '' : 's'}`}</span>
          <button type="button" className="btn ghost sm" onClick={() => setEditing(true)} data-testid="ask-public-change">Change</button>
        </div>
      ) : (
        <div className="card pad stack" style={{ gap: 10 }}>
          {needWho && (
            <div className="stack" style={{ gap: 8 }} data-testid="ask-public-who">
              <label className="field"><span>Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="name" data-testid="ask-public-name" /></label>
              <label className="field"><span>Email or mobile — so {d.by} can reach you</span>
                <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} inputMode="email" autoComplete="email" placeholder="you@email.com or 04…" data-testid="ask-public-contact" /></label>
              {contact.trim() && !c && <span className="small err">An email, or a mobile number.</span>}
            </div>
          )}
          <strong>When can you play?</strong>
          <AskReply plan={plan} guest={{ submit, key }} token={token} answer={me?.answer ? { ...me.answer, updated_at: 'x' } : null} onSent={load} />
        </div>
      ))}

      {/* Who's in (after answering) */}
      {me && open && (
        <div className="card pad stack" style={{ gap: 6 }} data-testid="ask-public-board">
          <strong>Who can make what</strong>
          <span>{leaderLine(top)}</span>
          {top && top.can.length > 0 && <span className="small muted" data-testid="ask-public-tee">{teeWords(top.can.length, d.spots)}</span>}
          {ranked.filter((r) => r.can.length).slice(0, 3).map((r) => <span key={r.cell.key} className="small"><strong>{cellWords(r.cell)}</strong>: {names(r.can)}{r.maybe.length ? <span className="muted"> · maybe: {names(r.maybe)}</span> : null}</span>)}
        </div>
      )}

      {/* The nudge to sign in */}
      {me && !me.claimed && (
        <div className="card pad stack" style={{ gap: 8 }} data-testid="ask-public-signin">
          <strong>Get a buzz when it’s locked in</strong>
          <span className="small">Sign in (10 seconds) and this answer is yours in the app: a buzz when it’s locked in or a spot opens, your usual times filled in next time, and your scores on the day.</span>
          {signedIn
            ? <button type="button" className="btn gold block" disabled={busy} onClick={() => run(async () => { const r = await must(supabase.rpc('ask_guest_claim', { p_token: token, p_key: key })); openInApp(r.group_id, r.plan_id); })} data-testid="ask-public-claim">Add it to my app</button>
            : <SignInButtons returnHash={`#/a/${token}`} />}
        </div>
      )}
      {!me && !open && !signedIn && <SignInButtons returnHash={`#/a/${token}`} />}
      <span className="small" style={{ color: 'var(--on-navy-muted)', textAlign: 'center' }}>The Golf Trip · <a href="#/privacy" style={{ color: 'inherit' }}>Privacy</a></span>
    </Page>
  );
}

function Page({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 14px 40px', gap: 14 }}>
      <GolfTripCrest size={56} />
      <div className="stack" style={{ width: '100%', maxWidth: 480, gap: 14, color: 'var(--text)' }}>{children}</div>
      <Toaster />
    </div>
  );
}
