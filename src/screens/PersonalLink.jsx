// A personal link (#/me/CODE): "Hi Mike, this link is just for you." Sign in properly, then "Yes, I'm Mike", and
// that sign-in becomes Mike's player (same name, scores and history). Server side: migration 046.
import React, { useEffect, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { linkScreen, phoneScreen } from '../lib/personal.js';
import { clearFreshSignIn } from '../lib/home.js';
import { paintLook } from '../lib/theme.js';
import { GroupCrest } from '../components/Logo.jsx';
import { SignInButtons, ensureSignedIn } from './Join.jsx';
import { SIGN_IN } from '../lib/auth.js';

function goInto(groupId) {
  clearFreshSignIn();
  setCurrentGroup(groupId);
  window.location.hash = '#/';
  window.location.reload();
}

export default function PersonalLink({ code }) {
  const { status } = useSession();
  const [info, setInfo] = useState(undefined); // undefined = still checking, null = not a real link
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const signedIn = !!status?.signed_in;

  // Read the link again whenever the sign-in changes (e.g. just signed in with Google or a code).
  useEffect(() => {
    let live = true;
    if (!code) { setInfo(null); return undefined; } // not a real code: say so without asking the server
    (async () => {
      try {
        await ensureSignedIn(); // a phone-only sign-in is enough to read who the link is for
        const { data, error } = await supabase.rpc('player_link_info', { p_token: code });
        if (error) throw error;
        if (!live) return;
        setInfo(data || null);
        if (data?.look) paintLook(data.look, data.group_name);
      } catch (e) {
        if (live) { setErr(friendlyError(e)); setInfo(null); }
      }
    })();
    return () => { live = false; };
  }, [code, signedIn]);

  const claim = async () => {
    setBusy(true);
    setErr('');
    try {
      const { data, error } = await supabase.rpc('claim_player_link', { p_token: code });
      if (error) throw error;
      if (!data) { setErr('That link isn’t right — ask your organiser for a new one.'); return; }
      goInto(data);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  // Opened on a phone with no proper sign-in (sign-in off in this build, or "just this phone"): the link makes this
  // phone that player straight away — no name to pick (083).
  const useHere = async () => {
    setBusy(true);
    setErr('');
    try {
      const { data, error } = await supabase.rpc('use_player_link', { p_token: code });
      if (error) throw error;
      if (!data) { setErr('That link isn’t right — ask your organiser for a new one.'); return; }
      goInto(data);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const inGroup = !!info && (status?.group_id === info.group_id || (status?.groups || []).some((g) => g.id === info.group_id));
  const phoneOnly = !SIGN_IN.length;
  const screen = info === undefined ? 'checking' : phoneOnly ? phoneScreen(info, inGroup) : linkScreen(info, signedIn);
  const name = info?.player_name || 'mate';
  const group = info?.group_name || 'your group';
  const muted = { color: 'var(--on-navy-muted)', textAlign: 'center' };
  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
      <GroupCrest size={110} look={info?.look} name={info?.group_name} />
      {screen === 'checking' && <div style={muted}>Checking your link…</div>}

      {screen === 'bad' && (
        <>
          <div style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 700, textAlign: 'center' }}>That link isn’t working</div>
          <div style={muted}>{err || 'Check you copied all of it, or ask your organiser to send you a new one.'}</div>
        </>
      )}

      {['used', 'expired', 'replaced'].includes(screen) && (
        <>
          <div style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 700, textAlign: 'center' }}>
            {screen === 'used' ? 'This link has been used' : screen === 'expired' ? 'This link has run out' : 'There’s a newer link'}
          </div>
          <div style={{ ...muted, maxWidth: 340 }}>
            {screen === 'used' && `Someone has already used ${name}'s link. If that wasn't you, ask an organiser of ${group} for a new one.`}
            {screen === 'expired' && `Personal links last 14 days. Ask an organiser of ${group} to send you a new one.`}
            {screen === 'replaced' && 'Your organiser sent you a newer link. Use the latest one in your messages.'}
          </div>
        </>
      )}

      {screen === 'in' && (
        <>
          <div style={{ fontFamily: 'var(--display)', fontSize: 32, fontWeight: 700, textAlign: 'center' }}>You’re already in</div>
          <div style={muted}>This phone is in {group}.</div>
          <button type="button" className="btn gold block" style={{ maxWidth: 340 }} onClick={() => goInto(info.group_id)}>Open {group}</button>
        </>
      )}

      {screen === 'use' && (
        <>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 700 }}>G’day {name} 👋</div>
            <div style={{ ...muted, marginTop: 6, maxWidth: 340 }}>This link is just for you, from {group}. It opens the app on this phone as you — your name, scores and history.</div>
          </div>
          {info?.role === 'organiser' && <div className="small" style={{ ...muted, maxWidth: 340, color: '#fff' }}>This link also makes you an organiser of {group}.</div>}
          <button type="button" className="btn gold block" style={{ maxWidth: 340 }} disabled={busy} onClick={useHere} data-testid="use-my-link">
            {busy ? 'Opening…' : `Yes, I’m ${name} — open the app`}
          </button>
          {err && <div className="err" role="alert" style={{ color: '#FFB4AB', maxWidth: 340 }}>{err}</div>}
          <div className="small" style={{ ...muted, maxWidth: 340 }}>Not {name}? Don’t use this link — ask your organiser for your own.</div>
        </>
      )}

      {screen === 'done' && (
        <>
          <div style={{ fontFamily: 'var(--display)', fontSize: 32, fontWeight: 700, textAlign: 'center' }}>You’re all set, {name}</div>
          <div style={muted}>Your sign-in is connected to your scores and history in {group}.</div>
          <button type="button" className="btn gold block" style={{ maxWidth: 340 }} onClick={() => goInto(info.group_id)}>Open {group}</button>
        </>
      )}

      {(screen === 'sign-in' || screen === 'confirm') && (
        <>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 700 }}>G’day {name} 👋</div>
            <div style={{ ...muted, marginTop: 6, maxWidth: 340 }}>
              This link is just for you, from {group}. {screen === 'sign-in'
                ? 'Sign in and your scores, handicap history and trophies stay with you on any phone.'
                : 'Connect this sign-in to your player and you’re in, with all your history.'}
            </div>
          </div>
          {screen === 'sign-in' && <SignInButtons returnHash={`#/me/${code}`} />}
          {screen === 'sign-in' && (
            <button type="button" className="btn ghost block" style={{ maxWidth: 340, color: '#fff', borderColor: 'rgba(255,255,255,.5)', background: 'transparent' }} disabled={busy} onClick={useHere}>
              {busy ? 'Opening…' : 'Just open it on this phone'}
            </button>
          )}
          {screen === 'confirm' && info?.role === 'organiser' && (
            <div className="small" style={{ ...muted, maxWidth: 340, color: '#fff' }}>This link also makes you an organiser of {group}.</div>
          )}
          {screen === 'confirm' && (
            <button type="button" className="btn gold block" style={{ maxWidth: 340 }} disabled={busy} onClick={claim}>
              {busy ? 'Connecting…' : `Yes, I’m ${name}`}
            </button>
          )}
          {err && <div className="err" role="alert" style={{ color: '#FFB4AB', maxWidth: 340 }}>{err}</div>}
          <div className="small" style={{ ...muted, maxWidth: 340 }}>Not {name}? Don’t use this link — ask your organiser for your own.</div>
        </>
      )}
    </div>
  );
}
