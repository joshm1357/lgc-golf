import React, { useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { inviteCode } from '../lib/invite.js';
import { personalCode } from '../lib/personal.js';
import { SIGN_IN, signInWith, signInWithEmail, verifyEmailCode } from '../lib/auth.js';
import { cleanEmailCode, looksLikeEmail, clearFreshSignIn, markFreshSignIn } from '../lib/home.js';
import { GOOGLE_CLIENT_ID, googleButtonHere, loadGoogle, makeNonce } from '../lib/google.js';
import { GroupCrest } from '../components/Logo.jsx';
import { savedLook, paintLook, DEFAULT_LOOK } from '../lib/theme.js';
import { rememberSource } from '../lib/quick.js';

export async function ensureSignedIn() {
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
        // If they start their own group later, it's counted as coming from this one.
        if (live && data?.group_id && !data.already_in) rememberSource({ from_group: data.group_id, placement: 'invite' });
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
  // Sign-in switched off in this build (the live L.G.C app and GitHub Pages): the screen exactly as before.
  if (!SIGN_IN.length) return <ClassicJoin />;
  return <SignInHome />;
}

const ON_NAVY_GHOST = { color: '#fff', borderColor: 'rgba(255,255,255,.5)', background: 'transparent' };

/** The PIN (or pasted invite link) box. Used on every front-door screen. */
export function PinForm({ onInvite, onJoined, autoFocus = false, linkFirst = false }) {
  const { refresh } = useSession();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    const linkCode = inviteCode(pin);
    if (linkCode) { onInvite?.(linkCode); return; }
    // Someone's personal link pasted in (an iPhone Home Screen app can't open links itself).
    const mine = personalCode(pin);
    if (mine) { window.location.hash = `#/me/${mine}`; return; }
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
      clearFreshSignIn();
      if (onJoined) onJoined(data); else await refresh();
    } catch (e2) {
      setErr(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="field">
        <span style={{ color: 'var(--on-navy-muted)' }}>{linkFirst ? 'Invite link (or group PIN)' : 'Group PIN or invite link'}</span>
        <input
          className="input" autoComplete="one-time-code" autoCapitalize="none" value={pin} autoFocus={autoFocus}
          onChange={(e) => setPin(e.target.value)} placeholder={linkFirst ? 'Paste it here' : 'From the group chat'}
          style={linkFirst
            ? { fontSize: !pin || pin.length > 12 ? 16 : 24, textAlign: 'center', letterSpacing: pin && pin.length <= 12 ? '.3em' : 0, color: 'var(--text)' }
            : { fontSize: pin.length > 12 ? 15 : 24, textAlign: 'center', letterSpacing: pin.length > 12 ? 0 : '.3em', color: 'var(--text)' }}
        />
      </label>
      {err && <div className="err" style={{ color: '#FFB4AB' }}>{err}</div>}
      <button className="btn gold block" disabled={busy || pin.trim().length < 4}>{busy ? 'Checking…' : "Let's go"}</button>
      <span className="small" style={{ color: 'var(--on-navy-muted)', textAlign: 'center' }}>{linkFirst
        ? 'Tapping the link in the group chat works too. On an iPhone Home Screen app, copy the link and paste it here.'
        : 'Got an invite link? Paste it in the box (or just open it).'}</span>
    </form>
  );
}

/** Today's home screen (PIN first). Shown whenever sign-in isn't switched on in the build. */
function ClassicJoin() {
  const [pasted, setPasted] = useState(null);
  const [inviteLook, setInviteLook] = useState(null);
  // An invite link opened in the browser, or pasted into the box (on iPhone the Home Screen app is separate from
  // Safari, so a link tapped in a chat opens Safari — pasting it here is how the Home Screen app joins).
  const code = inviteCode(window.location.hash) || pasted;
  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 }}>
      <GroupCrest size={code ? 120 : 170} look={inviteLook || savedLook()} name={inviteLook?.name} />
      {code ? <InviteJoin code={code} onLook={setInviteLook} /> : (
        <>
          <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 700 }}>{savedLook()?.short_name ? `${savedLook().short_name} Golf` : 'The Golf Trip'}</div>
          <PinForm onInvite={setPasted} />
          <a href="#/start" className="small" style={{ color: '#fff', fontWeight: 700, textAlign: 'center', borderTop: '1px solid rgba(255,255,255,.2)', paddingTop: 14, width: '100%', maxWidth: 340 }}>Running a golf group? Start your own →</a>
          <span className="small" style={{ color: 'var(--on-navy-muted)' }}><a href="#/privacy" style={{ color: 'inherit' }}>Privacy</a> · <a href="#/terms" style={{ color: 'inherit' }}>Terms</a></span>
        </>
      )}
    </div>
  );
}

/** The new front door (sign-in switched on): sign in first; a PIN or invite link still works without an account. */
function SignInHome() {
  const { status } = useSession();
  const [pasted, setPasted] = useState(null);
  const [inviteLook, setInviteLook] = useState(null);
  const [showPin, setShowPin] = useState(false);
  const code = inviteCode(window.location.hash) || pasted;
  // A brand-new phone has no group look yet: show The Golf Trip's own colours, never L.G.C's.
  useEffect(() => { if (!code && !savedLook()) paintLook(DEFAULT_LOOK, null); }, [code]);

  if (code) {
    // An invite: join as a guest straight away (no account needed before the first tee). Signing in is optional,
    // and brings them back to this same invite.
    return (
      <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 }}>
        <GroupCrest size={120} look={inviteLook || savedLook()} name={inviteLook?.name} />
        <InviteJoin code={code} onLook={setInviteLook} />
        {!status?.signed_in && <div className="stack" style={{ width: '100%', maxWidth: 340, gap: 8, borderTop: '1px solid rgba(255,255,255,.2)', paddingTop: 14 }}>
          <span className="small" style={{ color: 'var(--on-navy-muted)', textAlign: 'center' }}>Got an account already? Sign in first and your scores stay with you on any phone.</span>
          <SignInButtons returnHash={`#/join/${code}`} quiet />
        </div>}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
      <GroupCrest size={130} look={savedLook()} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 36, fontWeight: 700, lineHeight: 1.05 }}>The Golf Trip</div>
        <div style={{ color: 'var(--on-navy-muted)', marginTop: 6 }}>Your golf group’s home: scores, trips and the honour board.</div>
      </div>
      <SignInButtons />
      <div role="separator" style={{ width: '100%', maxWidth: 340, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--on-navy-muted)' }} className="small">
        <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.2)' }} />or<span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.2)' }} />
      </div>
      {showPin
        ? <PinForm onInvite={setPasted} autoFocus linkFirst />
        : <button type="button" className="btn ghost block" style={{ ...ON_NAVY_GHOST, maxWidth: 340 }} onClick={() => setShowPin(true)}>Got an invite link?</button>}
      <a href="#/start" className="btn ghost block" style={{ ...ON_NAVY_GHOST, maxWidth: 340, borderColor: 'transparent', textDecoration: 'underline' }}>Start a new group</a>
      <span className="small" style={{ color: 'var(--on-navy-muted)' }}><a href="#/privacy" style={{ color: 'inherit' }}>Privacy</a> · <a href="#/terms" style={{ color: 'inherit' }}>Terms</a></span>
    </div>
  );
}

/** Sign in with Google, or have a 6-digit code emailed. Makes an account if there isn't one. */
export function SignInButtons({ returnHash = '', quiet = false }) {
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [codeIn, setCodeIn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = (fn) => async (e) => {
    e?.preventDefault?.();
    setBusy(true);
    setErr('');
    try { await fn(); } catch (x) { setErr(friendlyError(x)); } finally { setBusy(false); }
  };
  const primary = quiet ? 'btn ghost block' : 'btn gold block';
  const primaryStyle = quiet ? ON_NAVY_GHOST : undefined;
  return (
    <div className="stack" style={{ width: '100%', maxWidth: 340, gap: 10 }}>
      {SIGN_IN.includes('google') && <GoogleSignIn returnHash={returnHash} quiet={quiet} busy={busy} onError={(x) => setErr(friendlyError(x))} />}
      {SIGN_IN.includes('facebook') && <button type="button" className="btn ghost block" style={ON_NAVY_GHOST} disabled={busy} onClick={go(() => signInWith('facebook', returnHash))}>Sign in with Facebook</button>}
      {SIGN_IN.includes('email') && (sent
        ? (
          // A 6-digit code, typed here — an emailed link would open Safari, not the Home Screen app.
          <form className="stack" style={{ gap: 8 }} onSubmit={go(async () => {
            setCurrentGroup(null); // whoever used this phone before: don't carry their group across
            await verifyEmailCode(email, cleanEmailCode(codeIn));
            await refresh();
          })}>
            <span className="small" style={{ color: 'var(--on-navy-muted)', textAlign: 'center' }}>We’ve emailed a 6-digit code to <strong style={{ color: '#fff' }}>{email.trim()}</strong>. It can take a minute (check junk too).</span>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" value={codeIn} onChange={(e) => setCodeIn(e.target.value)}
              placeholder="6-digit code" aria-label="6-digit code from the email" style={{ color: 'var(--text)', textAlign: 'center', fontSize: 24, letterSpacing: '.3em' }} />
            <button className="btn gold block" disabled={busy || !cleanEmailCode(codeIn)}>{busy ? 'Checking…' : 'Sign in'}</button>
            <button type="button" className="btn ghost block" style={ON_NAVY_GHOST} onClick={() => { setSent(false); setCodeIn(''); setErr(''); }}>Use a different email</button>
          </form>
        )
        : (
          <form className="stack" style={{ gap: 8 }} onSubmit={go(async () => { await signInWithEmail(email); setSent(true); })}>
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email" aria-label="Your email" style={{ color: 'var(--text)' }} />
            <button className="btn ghost block" style={ON_NAVY_GHOST} disabled={busy || !looksLikeEmail(email)}>{busy ? 'Sending…' : 'Email me a code'}</button>
          </form>
        ))}
      {err && <div className="err" role="alert" style={{ color: '#FFB4AB' }}>{err}</div>}
    </div>
  );
}

/**
 * Sign in with Google. Where Google knows this address, Google's own button: Google shows our app, and the sign-in
 * happens without leaving the app. Anywhere else (or if Google's script won't load): the redirect via Supabase.
 */
function GoogleSignIn({ returnHash, quiet, busy, onError }) {
  const { refresh } = useSession();
  const [mode, setMode] = useState(() => (googleButtonHere() ? 'loading' : 'redirect'));
  const [working, setWorking] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (mode !== 'loading') return undefined;
    let live = true;
    (async () => {
      try {
        const id = await loadGoogle();
        const { raw, hashed } = await makeNonce();
        if (!live || !box.current) return;
        id.initialize({
          client_id: GOOGLE_CLIENT_ID, nonce: hashed, ux_mode: 'popup', auto_select: false, itp_support: true,
          callback: async (resp) => {
            setWorking(true);
            try {
              setCurrentGroup(null); // whoever used this phone before: don't carry their group across
              markFreshSignIn();
              const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: resp.credential, nonce: raw });
              if (error) throw error;
              await refresh();
            } catch (e) {
              clearFreshSignIn();
              onError(e);
              if (box.current) box.current.innerHTML = '';
              setMode('loading'); // draw the button again with a new one-time value
            } finally {
              setWorking(false);
            }
          },
        });
        id.renderButton(box.current, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill',
          logo_alignment: 'center', width: Math.min(340, Math.max(200, box.current.offsetWidth || 300)) });
        setMode('google');
      } catch { if (live) setMode('redirect'); }
    })();
    return () => { live = false; };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  if (mode === 'redirect') {
    const cls = quiet ? 'btn ghost block' : 'btn gold block';
    return (
      <button type="button" className={cls} style={quiet ? ON_NAVY_GHOST : undefined} disabled={busy}
        onClick={() => signInWith('google', returnHash).catch(onError)}>
        <GoogleG /> Sign in with Google
      </button>
    );
  }
  // Google draws its own button here (Google's rules say how it looks). Same height while it loads, so nothing jumps.
  return (
    <div style={{ position: 'relative' }}>
      <div ref={box} data-google-button={mode} aria-busy={mode === 'loading' || working}
        style={{ minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: working ? 0.4 : 1, pointerEvents: working ? 'none' : undefined }} />
      {working && <div role="status" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>Signing in…</div>}
    </div>
  );
}

/** Google's "G", drawn here so nothing loads from Google before you tap. */
function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" style={{ flex: 'none', background: '#fff', borderRadius: '50%', padding: 2 }}>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
