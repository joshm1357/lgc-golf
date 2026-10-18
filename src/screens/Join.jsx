import React, { useEffect, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { inviteCode } from '../lib/invite.js';
import { SIGN_IN, signInWith, signInWithEmail, verifyEmailCode, isEmptyNewAccount } from '../lib/auth.js';
import { GroupCrest } from '../components/Logo.jsx';
import { savedLook, paintLook } from '../lib/theme.js';

async function ensureSignedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }
}

/** Joining by invite link (#/join/CODE): used before you're in any group, and inside the app for another group. */
export function InviteJoin({ code, inside = false, onLook }) {
  const { refresh } = useSession();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await ensureSignedIn();
        const { data, error } = await supabase.rpc('invite_info', { p_token: code });
        if (error) throw error;
        if (live) setInfo(data || { bad: true });
        // Show the group's own crest and colours (not when already inside another group's app).
        if (live && data?.look && !inside) { paintLook(data.look, data.group_name); onLook?.(data.look); }
      } catch (e) {
        if (live) { setErr(friendlyError(e)); setInfo({ bad: true }); }
      }
    })();
    return () => { live = false; };
  }, [code]);

  const join = async () => {
    setBusy(true);
    setErr('');
    try {
      const { data, error } = await supabase.rpc('join_by_invite', { p_token: code });
      if (error) throw error;
      if (!data) { setErr('That link has stopped working — ask for a new one.'); return; }
      setCurrentGroup(data);
      if (inside) {
        // Everything on screen belongs to the old group: start fresh in the new one.
        window.location.hash = '#/';
        window.location.reload();
        return;
      }
      window.location.hash = '#/';
      await refresh();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ width: '100%', maxWidth: 340, gap: 12, textAlign: 'center' }}>
      {!info && <div style={{ color: 'var(--on-navy-muted)' }}>Checking the invite…</div>}
      {info?.bad && <div className="err" style={{ color: '#FFB4AB' }}>{err || 'That invite link isn’t working — ask for a new one.'}</div>}
      {info && !info.bad && (
        <>
          <div style={{ fontSize: 20 }}>You’re invited to</div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 32, fontWeight: 700 }}>{info.group_name}</div>
          <div style={{ color: 'var(--on-navy-muted)' }}>{info.role === 'guest' ? 'as a guest — play, score and join in (no votes on rules or in the Tribunal).' : 'as a player.'}</div>
          {err && <div className="err" style={{ color: '#FFB4AB' }}>{err}</div>}
          {info.already_in
            ? <button type="button" className="btn gold block" onClick={() => { setCurrentGroup(info.group_id); window.location.hash = '#/'; window.location.reload(); }}>You’re already in — open it</button>
            : <button type="button" className="btn gold block" disabled={busy} onClick={join}>{busy ? 'Joining…' : 'Join'}</button>}
        </>
      )}
    </div>
  );
}

export default function Join() {
  const { refresh, status, user } = useSession();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pasted, setPasted] = useState(null);
  const [inviteLook, setInviteLook] = useState(null);
  // An invite link opened in the browser, or pasted into the box (on iPhone the Home Screen app is separate from
  // Safari, so a link tapped in a chat opens Safari — pasting it here is how the Home Screen app joins).
  const code = inviteCode(window.location.hash) || pasted;

  async function submit(e) {
    e.preventDefault();
    const linkCode = inviteCode(pin);
    if (linkCode) { setPasted(linkCode); return; }
    setBusy(true);
    setErr('');
    try {
      await ensureSignedIn();
      // join_group_id says which group the PIN opened, so the app shows that group.
      let { data, error } = await supabase.rpc('join_group_id', { p_pin: pin });
      if (error && /join_group_id/.test(error.message || '')) ({ data, error } = await supabase.rpc('join_group', { p_pin: pin }));
      if (error) throw error;
      if (!data) {
        setErr("That PIN's not right. Check the group chat.");
        return;
      }
      if (typeof data === 'string') setCurrentGroup(data);
      await refresh();
    } catch (e2) {
      setErr(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 }}>
      <GroupCrest size={code ? 120 : 170} look={inviteLook || savedLook()} name={inviteLook?.name} />
      {isEmptyNewAccount(status, user) && (
        <div className="stack" style={{ width: '100%', maxWidth: 340, gap: 8, textAlign: 'center' }}>
          <div className="err" style={{ color: '#FFB4AB' }}>No account found for that sign-in. If you’ve used the app before, open it on your old phone and add this sign-in there first (More → Group & invites). Or join with an invite link below.</div>
          <button type="button" className="btn ghost sm" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.5)' }} onClick={() => supabase.auth.signOut().then(() => window.location.reload())}>Sign out</button>
        </div>
      )}
      {code ? <><InviteJoin code={code} onLook={setInviteLook} />{SIGN_IN.length > 0 && <ReturningSignIn />}</> : (
        <>
          <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 700 }}>{savedLook()?.short_name ? `${savedLook().short_name} Golf` : 'The Golf Trip'}</div>
          <form onSubmit={submit} style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label className="field">
              <span style={{ color: 'var(--on-navy-muted)' }}>Group PIN or invite link</span>
              <input
                className="input" autoComplete="one-time-code" autoCapitalize="none" value={pin}
                onChange={(e) => setPin(e.target.value)} placeholder="From the group chat"
                style={{ fontSize: pin.length > 12 ? 15 : 24, textAlign: 'center', letterSpacing: pin.length > 12 ? 0 : '.3em', color: 'var(--text)' }}
              />
            </label>
            {err && <div className="err" style={{ color: '#FFB4AB' }}>{err}</div>}
            <button className="btn gold block" disabled={busy || pin.trim().length < 4}>{busy ? 'Checking…' : "Let's go"}</button>
            <span className="small" style={{ color: 'var(--on-navy-muted)', textAlign: 'center' }}>Got an invite link? Paste it in the box (or just open it).</span>
          </form>
          {SIGN_IN.length > 0 && <ReturningSignIn />}
          <a href="#/start" className="small" style={{ color: '#fff', fontWeight: 700, textAlign: 'center', borderTop: '1px solid rgba(255,255,255,.2)', paddingTop: 14, width: '100%', maxWidth: 340 }}>Running a golf group? Start your own →</a>
        </>
      )}
    </div>
  );
}

/** Already signed up on another phone? Sign in to the same account (only shown once providers are set up). */
function ReturningSignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [codeIn, setCodeIn] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="stack" style={{ width: '100%', maxWidth: 340, gap: 8, borderTop: '1px solid rgba(255,255,255,.2)', paddingTop: 14 }}>
      <span className="small" style={{ color: 'var(--on-navy-muted)', textAlign: 'center' }}>Signed in before, on another phone?</span>
      {SIGN_IN.includes('google') && <button type="button" className="btn ghost block" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.5)' }} onClick={() => signInWith('google').catch((e) => setErr(friendlyError(e)))}>Sign in with Google</button>}
      {SIGN_IN.includes('facebook') && <button type="button" className="btn ghost block" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.5)' }} onClick={() => signInWith('facebook').catch((e) => setErr(friendlyError(e)))}>Sign in with Facebook</button>}
      {SIGN_IN.includes('email') && (sent
        ? (
          // A 6-digit code, typed here — an emailed link would open Safari, not the Home Screen app.
          <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); verifyEmailCode(email, codeIn).then(() => window.location.reload(), (x) => setErr(friendlyError(x))); }}>
            <input className="input grow" inputMode="numeric" value={codeIn} onChange={(e) => setCodeIn(e.target.value)} placeholder="6-digit code from the email" style={{ color: 'var(--text)' }} />
            <button className="btn gold" disabled={codeIn.trim().length < 6}>Sign in</button>
          </form>
        )
        : (
          <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); signInWithEmail(email).then(() => setSent(true), (x) => setErr(friendlyError(x))); }}>
            <input className="input grow" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" style={{ color: 'var(--text)' }} />
            <button className="btn gold" disabled={!email.includes('@')}>Email me a code</button>
          </form>
        ))}
      {err && <div className="err" style={{ color: '#FFB4AB' }}>{err}</div>}
    </div>
  );
}
