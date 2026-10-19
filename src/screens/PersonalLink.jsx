// A personal link (#/me/CODE): "Hi Mike, this link is just for you." Sign in properly, then "Yes, I'm Mike", and
// that sign-in becomes Mike's player (same name, scores and history). Server side: migration 046.
import React, { useEffect, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { linkScreen } from '../lib/personal.js';
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
      goInto(data);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const screen = info === undefined ? 'checking' : linkScreen(info, signedIn);
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
            {screen === 'used' && `Someone has already signed in with ${name}'s link. If that wasn't you, ask an organiser of ${group} for a new one.`}
            {screen === 'expired' && `Personal links last 14 days. Ask an organiser of ${group} to send you a new one.`}
            {screen === 'replaced' && 'Your organiser sent you a newer link. Use the latest one in your messages.'}
          </div>
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
          {screen === 'sign-in' && (SIGN_IN.length
            ? <SignInButtons returnHash={`#/me/${code}`} />
            : <div style={muted}>Signing in isn’t switched on in this version of the app yet.</div>)}
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
