// Email + password forms (22 Oct 2026, Josh: "They need to be able to sign up with email and password.")
//   - EmailPasswordSignIn: the front door on a new phone or laptop — Sign in, Forgot password? (a 6-digit code by
//     email, then a new password), and Create an account (new organisers).
//   - SaveSpotEmail: "Save your spot" — adds an email and password (or, on an email-code build, just an email) to the
//     phone-only user someone already is, so they keep their group and name.
// Both work on the navy front door and on a white sheet (`light`). The rules and wording are in lib/savespot.js.
import React, { useState } from 'react';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { cleanEmailCode, looksLikeEmail } from '../lib/home.js';
import { authProblem, passwordProblem } from '../lib/savespot.js';
import {
  signInPassword, signUpPassword, confirmSignUpCode, resendSignUpCode, sendResetCode, resetWithCode,
  linkEmailPassword, confirmLinkCode, signInWithEmail, verifyEmailCode,
} from '../lib/auth.js';

const GHOST_ON_NAVY = { color: '#fff', borderColor: 'rgba(255,255,255,.5)', background: 'transparent' };
const LINK_BTN = (light) => ({ background: 'none', border: 0, padding: '8px 4px', minHeight: 44, color: light ? 'var(--navy)' : '#fff', textDecoration: 'underline', fontWeight: 600, cursor: 'pointer' });
const muted = (light) => (light ? 'var(--muted)' : 'var(--on-navy-muted)');
const errStyle = (light) => (light ? undefined : { color: '#FFB4AB' });

/** A password box with a Show/Hide button and, when `rules`, the rule underneath as they type. */
export function PasswordInput({ value, onChange, label = 'Password', autoComplete = 'current-password', rules = false, light = false, autoFocus = false }) {
  const [show, setShow] = useState(false);
  const problem = rules ? passwordProblem(value) : '';
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div style={{ position: 'relative' }}>
        <input className="input" type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label}
          style={{ color: 'var(--text)', width: '100%', paddingRight: 72, fontSize: 16 }} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
          style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', minHeight: 40, minWidth: 60, border: 0, background: 'none', color: 'var(--navy)', fontWeight: 700, cursor: 'pointer' }}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {rules && <span className="small" data-testid="password-rule" style={{ color: problem ? muted(light) : (light ? 'var(--up)' : '#9BE3B0') }}>{problem || `✓ ${value.length} characters — good`}</span>}
    </div>
  );
}

function CodeInput({ value, onChange }) {
  return (
    <input className="input" inputMode="numeric" autoComplete="one-time-code" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder="6-digit code" aria-label="6-digit code from the email" style={{ color: 'var(--text)', textAlign: 'center', fontSize: 24, letterSpacing: '.3em' }} />
  );
}

function EmailInput({ value, onChange, autoFocus }) {
  return (
    <input className="input" type="email" autoComplete="email" value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus}
      placeholder="Your email" aria-label="Your email" style={{ color: 'var(--text)', fontSize: 16 }} />
  );
}

function useStep(initial) {
  const [step, setStepRaw] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const setStep = (s) => { setStepRaw(s); setProblem(null); };
  const go = (fn, context) => async (e) => {
    e?.preventDefault?.();
    setBusy(true);
    setProblem(null);
    try { await fn(); } catch (x) { setProblem(authProblem(x, context)); } finally { setBusy(false); }
  };
  return { step, setStep, busy, problem, setProblem, go };
}

/** Front door: sign in with email + password, or Forgot password?, or Create an account. */
export function EmailPasswordSignIn({ light = false, startWith = 'sign-in', presetEmail = '', keepGroup = false }) {
  const { refresh } = useSession();
  const { step, setStep, busy, problem, setProblem, go } = useStep(startWith);
  const [email, setEmail] = useState(presetEmail);
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const main = light ? 'btn gold block' : 'btn gold block';
  const second = light ? 'btn ghost block' : 'btn ghost block';
  const secondStyle = light ? undefined : GHOST_ON_NAVY;
  // Whoever used this phone before: don't carry their group across. (Save your spot → "sign in instead" keeps it:
  // if that account is in this group, they go straight back in.)
  const fresh = () => { if (!keepGroup) setCurrentGroup(null); };
  const say = (text) => <span className="small" style={{ color: muted(light), textAlign: 'center' }}>{text}</span>;
  const Problem = problem && (
    <div className="err" role="alert" style={errStyle(light)}>
      {problem.message}
      {problem.action === 'forgot' && step === 'sign-in' && <> <button type="button" style={LINK_BTN(light)} onClick={() => { setStep('forgot'); }}>Reset it</button></>}
      {problem.action === 'sign-in' && step === 'sign-up' && <> <button type="button" style={LINK_BTN(light)} onClick={() => { setStep('sign-in'); }}>Sign in instead</button></>}
    </div>
  );

  if (step === 'sign-in') {
    return (
      <form className="stack" style={{ gap: 8 }} data-testid="password-sign-in" onSubmit={go(async () => {
        fresh();
        try {
          await signInPassword(email, pw);
        } catch (x) {
          // Signed up but never confirmed: send the code and ask for it.
          if (authProblem(x).action === 'code') { await resendSignUpCode(email).catch(() => {}); setStep('signup-code'); setProblem(authProblem(x)); return; }
          throw x;
        }
        await refresh();
      })}>
        <EmailInput value={email} onChange={setEmail} />
        <PasswordInput value={pw} onChange={setPw} light={light} />
        <button className={main} disabled={busy || !looksLikeEmail(email) || !pw}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {Problem}
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
          <button type="button" style={LINK_BTN(light)} onClick={() => setStep('forgot')}>Forgot password?</button>
          <button type="button" style={LINK_BTN(light)} onClick={() => setStep('sign-up')}>Create an account</button>
        </div>
      </form>
    );
  }
  if (step === 'sign-up') {
    return (
      <form className="stack" style={{ gap: 8 }} data-testid="password-sign-up" onSubmit={go(async () => {
        fresh();
        const r = await signUpPassword(email, pw);
        if (r === 'code') { setStep('signup-code'); return; }
        await refresh();
      }, 'sign-up')}>
        {say('New here and running a group? Make an account. Joining a group? Open its link from your group chat instead.')}
        <EmailInput value={email} onChange={setEmail} />
        <PasswordInput value={pw} onChange={setPw} label="Choose a password" autoComplete="new-password" rules light={light} />
        <button className={main} disabled={busy || !looksLikeEmail(email) || !!passwordProblem(pw)}>{busy ? 'Making it…' : 'Create account'}</button>
        {Problem}
        <button type="button" className={second} style={secondStyle} onClick={() => setStep('sign-in')}>I have an account — sign in</button>
      </form>
    );
  }
  if (step === 'signup-code') {
    return (
      <form className="stack" style={{ gap: 8 }} onSubmit={go(async () => { await confirmSignUpCode(email, cleanEmailCode(code)); await refresh(); })}>
        {say(<>We’ve emailed a 6-digit code to <strong style={{ color: light ? 'inherit' : '#fff' }}>{email.trim()}</strong> to confirm it’s you. It can take a minute (check junk too).</>)}
        <CodeInput value={code} onChange={setCode} />
        <button className={main} disabled={busy || !cleanEmailCode(code)}>{busy ? 'Checking…' : 'Confirm'}</button>
        {Problem}
        <button type="button" className={second} style={secondStyle} disabled={busy} onClick={go(async () => { await resendSignUpCode(email); setProblem({ message: 'New code sent.' }); })}>Send a new code</button>
      </form>
    );
  }
  if (step === 'forgot') {
    return (
      <form className="stack" style={{ gap: 8 }} data-testid="forgot" onSubmit={go(async () => { await sendResetCode(email); setStep('reset'); })}>
        {say('We’ll email you a 6-digit code. Type it in here, then choose a new password.')}
        <EmailInput value={email} onChange={setEmail} autoFocus />
        <button className={main} disabled={busy || !looksLikeEmail(email)}>{busy ? 'Sending…' : 'Email me a code'}</button>
        {Problem}
        <button type="button" className={second} style={secondStyle} onClick={() => setStep('sign-in')}>Back to sign in</button>
      </form>
    );
  }
  // 'reset': the code and a new password.
  return (
    <form className="stack" style={{ gap: 8 }} data-testid="reset" onSubmit={go(async () => { fresh(); await resetWithCode(email, cleanEmailCode(code), pw); await refresh(); })}>
      {say(<>If <strong style={{ color: light ? 'inherit' : '#fff' }}>{email.trim()}</strong> has an account, a 6-digit code is on its way (check junk too).</>)}
      <CodeInput value={code} onChange={setCode} />
      <PasswordInput value={pw} onChange={setPw} label="New password" autoComplete="new-password" rules light={light} />
      <button className={main} disabled={busy || !cleanEmailCode(code) || !!passwordProblem(pw)}>{busy ? 'Saving…' : 'Save new password and sign in'}</button>
      {Problem}
      <button type="button" className={second} style={secondStyle} onClick={() => { setCode(''); setStep('forgot'); }}>Send a new code</button>
    </form>
  );
}

/**
 * Save your spot with an email: email + password ("password" builds) or just the email ("email" builds — then
 * they sign in with an emailed code each time). Same user, so their group and name stay. Calls onDone when saved.
 */
export function SaveSpotEmail({ withPassword, onDone, light = true }) {
  const { refresh } = useSession();
  const { step, setStep, busy, problem, go } = useStep('form');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const finish = async () => { await refresh(); onDone?.(); };
  const say = (text) => <span className="small" style={{ color: muted(light) }}>{text}</span>;
  const Problem = problem && <div className="err" role="alert" style={errStyle(light)}>{problem.message}</div>;

  if (step === 'form') {
    return (
      <form className="stack" style={{ gap: 8 }} data-testid="save-spot-email" onSubmit={go(async () => {
        const r = await linkEmailPassword(email, withPassword ? pw : '');
        if (r === 'code') { setStep('code'); return; }
        await finish();
      })}>
        <EmailInput value={email} onChange={setEmail} autoFocus />
        {withPassword && <PasswordInput value={pw} onChange={setPw} label="Choose a password" autoComplete="new-password" rules light={light} />}
        <button className="btn gold block" disabled={busy || !looksLikeEmail(email) || (withPassword && !!passwordProblem(pw))}>{busy ? 'Saving…' : 'Save my spot'}</button>
        {Problem}
        {problem?.action === 'sign-in' && (
          <button type="button" className="btn block" onClick={() => setStep(withPassword ? 'sign-in' : 'code-sign-in')}>
            {withPassword ? 'Sign in with that email instead' : 'Email me a sign-in code instead'}
          </button>
        )}
      </form>
    );
  }
  if (step === 'code') {
    return (
      <form className="stack" style={{ gap: 8 }} data-testid="save-spot-code" onSubmit={go(async () => { await confirmLinkCode(email, cleanEmailCode(code), withPassword ? pw : ''); await finish(); })}>
        {say(<>We’ve emailed a 6-digit code to <strong>{email.trim()}</strong>. Type it in here to finish. It can take a minute (check junk too).</>)}
        <CodeInput value={code} onChange={setCode} />
        <button className="btn gold block" disabled={busy || !cleanEmailCode(code)}>{busy ? 'Checking…' : 'Finish'}</button>
        {Problem}
        <button type="button" className="btn ghost block" onClick={() => { setCode(''); setStep('form'); }}>Use a different email</button>
      </form>
    );
  }
  if (step === 'code-sign-in') {
    // Email-code builds: that email already has an account — sign in to it with a code.
    return <CodeSignIn email={email} onDone={finish} />;
  }
  // 'sign-in': that email already has an account — sign in to it (it becomes this phone's user).
  return (
    <div className="stack" style={{ gap: 8 }}>
      {say('That email already has an account — sign in to it. If that account isn’t in this group yet, open the group’s link again after.')}
      <EmailPasswordSignIn light={light} presetEmail={email} keepGroup />
    </div>
  );
}

function CodeSignIn({ email, onDone }) {
  const { step, setStep, busy, problem, go } = useStep('send');
  const [code, setCode] = useState('');
  return step === 'send' ? (
    <form className="stack" style={{ gap: 8 }} onSubmit={go(async () => { await signInWithEmail(email); setStep('enter'); })}>
      <span className="small muted">That email already has an account. We’ll email a code to {email.trim()} so you can sign in to it.</span>
      <button className="btn gold block" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
      {problem && <div className="err" role="alert">{problem.message}</div>}
    </form>
  ) : (
    <form className="stack" style={{ gap: 8 }} onSubmit={go(async () => { await verifyEmailCode(email, cleanEmailCode(code)); await onDone(); })}>
      <CodeInput value={code} onChange={setCode} />
      <button className="btn gold block" disabled={busy || !cleanEmailCode(code)}>{busy ? 'Checking…' : 'Sign in'}</button>
      {problem && <div className="err" role="alert">{problem.message}</div>}
    </form>
  );
}
