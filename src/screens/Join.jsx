import React, { useEffect, useRef, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { inviteCode } from '../lib/invite.js';
import { linkTarget, inviteNext, readLink, pageToKeep, targetQuery } from '../lib/links.js';
import { SIGN_IN, signInWith, signInWithEmail, verifyEmailCode, linkProvider, linkGoogleToken } from '../lib/auth.js';
import { signInModes } from '../lib/savespot.js';
import { EmailPasswordSignIn, EmailContinue } from '../components/SignInForms.jsx';
import { joinDoor, deadLinkWords, markJoinAfterSignIn, joinAfterSignIn, clearJoinAfterSignIn, markWelcome } from '../lib/joinfirst.js';
import { cleanEmailCode, looksLikeEmail, clearFreshSignIn, markFreshSignIn, rememberReturn, takeReturn } from '../lib/home.js';
import { GOOGLE_CLIENT_ID, googleButtonHere, loadGoogle, makeNonce } from '../lib/google.js';
import { GroupCrest } from '../components/Logo.jsx';
import { savedLook, paintLook, DEFAULT_LOOK } from '../lib/theme.js';
import { rememberSource } from '../lib/quick.js';
import { NEW_GROUPS } from '../lib/beta.js';

export async function ensureSignedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }
}

/** Joining by link (#/join/CODE, maybe ?to=<page>): used before you're in any group, and inside the app for another. */
export function InviteJoin({ code, inside = false, onLook }) {
  const { refresh, status } = useSession();
  // A shared link (#/join/CODE?to=<page>, 083; or an old vote link ?vote=<plan>): after joining, land on that page.
  const target = linkTarget(window.location.hash);
  const after = () => target || takeReturn() || '#/';
  const signedIn = !!status?.signed_in;
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
        if (!live) return;
        setInfo(data || { bad: true });
        // If they start their own group later, it's counted as coming from this one.
        if (data?.group_id && !data.already_in) rememberSource({ from_group: data.group_id, placement: 'invite' });
        // Show the group's own crest and colours (not when already inside another group's app).
        if (data?.look && !inside) { paintLook(data.look, data.group_name); onLook?.(data.look); }
        // Already in: straight to the page (switching group first if another one is open on this phone). Signed in
        // properly: always straight there, with "Welcome back" (ov13).
        const next = inviteNext({ info: data, inside, currentGroupId: status?.group_id, hasTarget: !!target, signedIn });
        if ((next === 'go' || next === 'switch') && signedIn) { clearJoinAfterSignIn(); markWelcome(data.group_id); }
        if (next === 'go') window.location.hash = after();
        else if (next === 'switch') { setCurrentGroup(data.group_id); window.location.hash = after(); window.location.reload(); }
        // Just signed in from this link's sign-in screen: join as that account straight away (no second tap).
        else if (next === 'join' && signedIn && joinAfterSignIn(code)) { clearJoinAfterSignIn(); join(); }
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
      clearFreshSignIn();
      clearJoinAfterSignIn();
      if (inside) {
        // Everything on screen belongs to the old group: start fresh in the new one.
        window.location.hash = after();
        window.location.reload();
        return;
      }
      window.location.hash = after();
      await refresh();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ width: '100%', maxWidth: 340, gap: 12, textAlign: 'center' }}>
      {!info && <div style={{ color: 'var(--on-navy-muted)' }}>Checking the link…</div>}
      {info?.bad && <div className="err" style={{ color: '#FFB4AB' }}>{err || 'That link isn’t working — ask for a new one in the group chat.'}</div>}
      {info && !info.bad && (
        <>
          <div style={{ fontSize: 20 }}>You’re invited to</div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 32, fontWeight: 700 }}>{info.group_name}</div>
          <div style={{ color: 'var(--on-navy-muted)' }}>{info.role === 'organiser' ? 'as the organiser — you set up rounds, players and invites. This link works once.' : info.team ? <>as a player on <strong style={{ color: '#fff' }}>{info.team}</strong>.</> : info.role === 'guest' ? 'as a guest — play, score and join in (no votes on rules or in the Tribunal).' : 'as a player.'}</div>
          {target && !info.already_in && <div className="small" style={{ color: 'var(--on-navy-muted)' }}>Join, pick your name, and you’ll go straight to what was shared.</div>}
          {err && <div className="err" style={{ color: '#FFB4AB' }}>{err}</div>}
          {info.team && info.my_team && <div className="small" style={{ color: 'var(--on-navy-muted)' }}>You’re already on {info.my_team} — a link never moves you to another team.</div>}
          {info.already_in && !(info.team && !info.my_team)
            ? <button type="button" className="btn gold block" onClick={() => { setCurrentGroup(info.group_id); window.location.hash = after(); window.location.reload(); }}>You’re already in — open it</button>
            : <button type="button" className="btn gold block" disabled={busy} onClick={join}>{busy ? 'Joining…' : info.already_in && info.team ? `Join ${info.team}` : 'Join'}</button>}
        </>
      )}
    </div>
  );
}

/** The front door before you're in a group: links first (no PINs, 083). Sign-in too, when it's on in this build. */
export default function Join() {
  return <FrontDoor />;
}

const ON_NAVY_GHOST = { color: '#fff', borderColor: 'rgba(255,255,255,.5)', background: 'transparent' };
const NAVY_PAGE = { minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 };

/**
 * The "open your link" box. Takes any link the app makes — an invite (player, guest, team, organiser), a personal
 * link, or a shared page with its join code. On an iPhone the Home Screen app is separate from Safari, so a link
 * tapped in a chat opens Safari; pasting it here is how the Home Screen app gets in.
 */
export function LinkForm({ autoFocus = false, onOpen, light = false }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const submit = (e) => {
    e.preventDefault();
    setErr('');
    const l = readLink(text);
    if (!l) { setErr('That doesn’t look like a link from the app. Copy the whole link from the group chat and try again.'); return; }
    if (l.kind === 'page') {
      rememberReturn(l.hash);
      setErr('That link opens a page, but it can’t let you in on its own. Open your group’s invite link or your personal link — you’ll land on that page after.');
      return;
    }
    if (onOpen) onOpen(l); else window.location.hash = l.hash;
  };
  const muted = light ? 'var(--muted)' : 'var(--on-navy-muted)';
  return (
    <form onSubmit={submit} style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="field">
        <span style={{ color: muted }}>Your link</span>
        <input className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" value={text} autoFocus={autoFocus}
          onChange={(e) => { setText(e.target.value); setErr(''); }} placeholder="Paste the link here" style={{ fontSize: 16, color: 'var(--text)' }} />
      </label>
      {err && <div className="err" role="alert" style={light ? undefined : { color: '#FFB4AB' }}>{err}</div>}
      <button className={light ? 'btn block' : 'btn gold block'} disabled={!text.trim()}>Open</button>
    </form>
  );
}

export function LostLink({ light = false }) {
  return <span className="small" style={{ color: light ? 'var(--muted)' : 'var(--on-navy-muted)', textAlign: 'center', maxWidth: 340 }}>Lost your link? Ask your organiser to send your personal link.</span>;
}

function FrontDoor() {
  const { status } = useSession();
  const [inviteLook, setInviteLook] = useState(null);
  const [phoneOnly, setPhoneOnly] = useState(null); // the link code they chose "Just this phone for now" for
  const signInOn = SIGN_IN.length > 0;
  const hash = window.location.hash;
  const code = inviteCode(hash);
  // An app page opened with no join code (an older link): keep it, so they land there once they're in.
  const kept = code ? null : pageToKeep(hash);
  useEffect(() => { if (kept) rememberReturn(kept); }, [kept]);
  // A brand-new phone has no group look yet: show The Golf Trip's own colours, never L.G.C's.
  useEffect(() => { if (signInOn && !code && !savedLook()) paintLook(DEFAULT_LOOK, null); }, [code, signInOn]);

  if (code) {
    // A link on a phone or laptop that isn't signed in: sign in first, as part of joining (ov13). "Just this phone
    // for now" is the old phone-only way (they get Save your spot later).
    if (joinDoor({ signInOn, signedIn: !!status?.signed_in, phoneOnly: phoneOnly === code }) === 'sign-in') {
      return <JoinSignIn code={code} returnHash={`#/join/${code}${targetQuery(hash)}`} onPhone={() => { clearJoinAfterSignIn(); setPhoneOnly(code); }} />;
    }
    return (
      <div style={{ ...NAVY_PAGE, gap: 18 }}>
        <GroupCrest size={120} look={inviteLook || savedLook()} name={inviteLook?.name} />
        <InviteJoin code={code} onLook={setInviteLook} />
      </div>
    );
  }

  const short = savedLook()?.short_name;
  return (
    <div style={NAVY_PAGE}>
      <GroupCrest size={signInOn ? 130 : 150} look={savedLook()} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 700, lineHeight: 1.05 }}>{!signInOn && short ? `${short} Golf` : 'The Golf Trip'}</div>
        {signInOn && <div style={{ color: 'var(--on-navy-muted)', marginTop: 6 }}>Your golf group’s home: scores, trips and the honour board.</div>}
      </div>
      {signInOn && (
        <>
          <div style={{ fontSize: 20, fontWeight: 700, textAlign: 'center' }}>Been here before? Sign in</div>
          <SignInButtons returnHash={kept || ''} />
          <div role="separator" style={{ width: '100%', maxWidth: 340, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--on-navy-muted)' }} className="small">
            <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.2)' }} />or<span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.2)' }} />
          </div>
        </>
      )}
      <div style={{ textAlign: 'center', maxWidth: 340 }} data-testid="link-first">
        <div style={{ fontSize: 20, fontWeight: 700 }}>{signInOn ? 'New here? Open the link from your group chat' : 'Open the link from your group chat'}</div>
        <div className="small" style={{ color: 'var(--on-navy-muted)', marginTop: 4 }}>
          {kept ? 'Open your group’s link and you’ll land on the page you opened.' : 'Tap it in the chat. On an iPhone Home Screen app, copy it and paste it here.'}
        </div>
      </div>
      <LinkForm />
      <LostLink />
      {NEW_GROUPS && <a href="#/start" className="small" style={{ color: '#fff', fontWeight: 700, textAlign: 'center', borderTop: '1px solid rgba(255,255,255,.2)', paddingTop: 14, width: '100%', maxWidth: 340 }}>{signInOn ? 'Start a new group' : 'Running a golf group? Start your own →'}</a>}
      <span className="small" style={{ color: 'var(--on-navy-muted)' }}><a href="#/privacy" style={{ color: 'inherit' }}>Privacy</a> · <a href="#/terms" style={{ color: 'inherit' }}>Terms</a></span>
    </div>
  );
}

/**
 * The sign-in-first join screen (ov13): "Join <group> — sign in so it's you on any phone or laptop".
 * Continue with Google (Google's own button where it can, so no trip away), email + password (one form that works out
 * sign in or create), or "Just this phone for now". After signing in, InviteJoin uses the link as that account.
 */
function JoinSignIn({ code, returnHash, onPhone }) {
  const [info, setInfo] = useState(undefined); // undefined = checking; null = not a working link
  const [dead, setDead] = useState(null); // why it isn't working: 'used' | 'expired' | null
  const [err, setErr] = useState('');
  const modes = signInModes(SIGN_IN);
  const target = linkTarget(window.location.hash);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // A phone-only session is enough to read which group the link is for (it's replaced when they sign in).
        await ensureSignedIn();
        const { data, error } = await supabase.rpc('invite_info', { p_token: code });
        if (error) throw error;
        if (!live) return;
        setInfo(data || null);
        if (data?.look) paintLook(data.look, data.group_name);
        if (data) { markJoinAfterSignIn(code); return; }
        // Not working: used or run out (086)? An older database without it just says "isn't working".
        const r = await supabase.rpc('used_link_info', { p_token: code }).then((x) => x, () => ({ data: null }));
        if (live) setDead(r?.data?.state || null);
      } catch (e) {
        if (live) { setErr(friendlyError(e)); setInfo(null); }
      }
    })();
    return () => { live = false; };
  }, [code]);
  const muted = { color: 'var(--on-navy-muted)', textAlign: 'center' };
  const words = info === null ? deadLinkWords(dead) : null;
  return (
    <div style={{ ...NAVY_PAGE, gap: 14 }} data-testid="join-sign-in">
      <GroupCrest size={104} look={info?.look || savedLook()} name={info?.group_name} />
      {info === undefined && <div style={muted}>Checking the link…</div>}
      {info && (
        <div style={{ textAlign: 'center', maxWidth: 340 }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>Join {info.group_name}</div>
          <div style={{ ...muted, marginTop: 6 }}>Sign in so it’s you on any phone or laptop.</div>
          {(info.role === 'organiser' || info.team || info.role === 'guest') && (
            <div className="small" style={{ ...muted, marginTop: 6 }}>
              {info.role === 'organiser' ? 'This link makes you an organiser. It works once.' : info.team ? <>You’ll be on <strong style={{ color: '#fff' }}>{info.team}</strong>.</> : 'You’re joining as a guest.'}
            </div>
          )}
          {target && <div className="small" style={{ ...muted, marginTop: 4 }}>Then pick your name and you’ll go straight to what was shared.</div>}
        </div>
      )}
      {words && (
        <div style={{ textAlign: 'center', maxWidth: 340 }} role="alert" data-testid="dead-link">
          <div style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{words.title}</div>
          <div style={{ ...muted, marginTop: 6 }}>{words.body}</div>
        </div>
      )}
      {info !== undefined && (
        <div className="stack" style={{ width: '100%', maxWidth: 340, gap: 10 }}>
          {modes.google && <GoogleSignIn returnHash={returnHash} cont onError={(x) => setErr(friendlyError(x))} />}
          {modes.google && (modes.password || modes.emailCode) && (
            <div role="separator" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--on-navy-muted)' }} className="small">
              <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.2)' }} />or<span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.2)' }} />
            </div>
          )}
          {modes.password && <EmailContinue />}
          {modes.emailCode && <SignInButtons returnHash={returnHash} quiet emailOnly />}
          {err && <div className="err" role="alert" style={{ color: '#FFB4AB' }}>{err}</div>}
        </div>
      )}
      {/* F2 (ov27, walkthrough review option B): a proper button, with one line on what it means. */}
      {info && (
        <div className="stack" style={{ width: '100%', maxWidth: 340, gap: 6, borderTop: '1px solid rgba(255,255,255,.2)', paddingTop: 12 }}>
          <button type="button" className="btn ghost block" onClick={onPhone} data-testid="just-this-phone" style={ON_NAVY_GHOST}>
            📱 Just this phone for now
          </button>
          <span className="small" data-testid="just-this-phone-help" style={muted}>In straight away, but only on this phone — your name and scores won’t follow you to a laptop or new phone until you sign in.</span>
        </div>
      )}
    </div>
  );
}

/** Sign in with Google, or have a 6-digit code emailed. Makes an account if there isn't one. */
export function SignInButtons({ returnHash = '', quiet = false, emailOnly = false }) {
  const { refresh } = useSession();
  const modes = signInModes(SIGN_IN);
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
      {SIGN_IN.includes('google') && !emailOnly && <GoogleSignIn returnHash={returnHash} quiet={quiet} busy={busy} onError={(x) => setErr(friendlyError(x))} />}
      {SIGN_IN.includes('facebook') && !emailOnly && <button type="button" className="btn ghost block" style={ON_NAVY_GHOST} disabled={busy} onClick={go(() => signInWith('facebook', returnHash))}>Sign in with Facebook</button>}
      {/* Email + password (22 Oct): Sign in, Forgot password? (an emailed code), Create an account. */}
      {modes.password && !emailOnly && <EmailPasswordSignIn />}
      {modes.emailCode && (sent
        ? (
          // A 6-digit code, typed here — an emailed link would open Safari, not the Home Screen app.
          <form className="stack" style={{ gap: 8 }} onSubmit={go(async () => {
            setCurrentGroup(null); // whoever used this phone before: don't carry their group across
            await verifyEmailCode(email, cleanEmailCode(codeIn));
            await refresh();
          })}>
            <span className="small" style={{ color: 'var(--on-navy-muted)', textAlign: 'center' }}>We’ve emailed a 6-digit code to <strong style={{ color: '#fff' }}>{email.trim()}</strong>. It can take a minute (check junk too). If the email has a sign-in link instead, open it on this phone.</span>
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
export function GoogleSignIn({ returnHash, quiet, busy, onError, link = false, onLinked, onLeaving, light = false, cont = false }) {
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
              if (link) {
                // Save your spot: Google joins the SAME (phone-only) user, so the group and name stay.
                await linkGoogleToken(resp.credential, raw);
                await refresh();
                onLinked?.();
                return;
              }
              setCurrentGroup(null); // whoever used this phone before: don't carry their group across
              markFreshSignIn();
              const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: resp.credential, nonce: raw });
              if (error) throw error;
              await refresh();
            } catch (e) {
              if (!link) clearFreshSignIn();
              onError(e);
              if (box.current) box.current.innerHTML = '';
              setMode('loading'); // draw the button again with a new one-time value
            } finally {
              setWorking(false);
            }
          },
        });
        id.renderButton(box.current, { type: 'standard', theme: 'outline', size: 'large', text: link || cont ? 'continue_with' : 'signin_with', shape: 'pill',
          logo_alignment: 'center', width: Math.min(340, Math.max(200, box.current.offsetWidth || 300)) });
        setMode('google');
      } catch { if (live) setMode('redirect'); }
    })();
    return () => { live = false; };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  if (mode === 'redirect') {
    const cls = quiet ? 'btn ghost block' : light ? 'btn block' : 'btn gold block';
    return (
      <button type="button" className={cls} style={quiet ? ON_NAVY_GHOST : undefined} disabled={busy}
        onClick={() => {
          if (!link) { signInWith('google', returnHash).catch(onError); return; }
          onLeaving?.(); // the app remembers it's gone to Google, to say "Done" when it's back
          linkProvider('google', returnHash).catch(onError);
        }}>
        <GoogleG /> {link || cont ? 'Continue with Google' : 'Sign in with Google'}
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
