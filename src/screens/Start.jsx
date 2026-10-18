import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { SIGN_IN } from '../lib/auth.js';
import { STARTERS } from '../lib/starters.js';
import { FEATURES, PRESETS, PRESET_BY_KEY, featureOn } from '../lib/features.js';
import { useRun, must } from '../lib/run.js';
import { GolfTripCrest } from '../components/Logo.jsx';
import { Toaster, toast } from '../components/ui.jsx';
import { SignInCard, InviteCard, LookCard } from './Group.jsx';

// Stage 7: the public start page and the start-a-group wizard (#/start, #/start/new).
// The group is made at step 2 (it needs a name); every step after that saves straight away, so leaving half-way and
// coming back carries on where you were (this phone remembers which step).

const KEY = 'lgc-start';
const loadProgress = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const saveProgress = (p) => { try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch { /* fine */ } };

export const STEPS = [
  { key: 'signin', title: 'Sign in', mins: 1 },
  { key: 'name', title: 'Name your group', mins: 1 },
  { key: 'look', title: 'Crest and colours', mins: 2 },
  { key: 'rules', title: 'Rulebook', mins: 1 },
  { key: 'features', title: 'Features', mins: 1 },
  { key: 'players', title: 'Players', mins: 2 },
  { key: 'invite', title: 'Invite your group', mins: 1 },
];

async function ensureSignedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }
}

export default function Start() {
  const wizard = useLocation().pathname.startsWith('/start/new');
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #F4F5F7)' }}>
      {wizard ? <Wizard /> : <Intro />}
      <Toaster />
    </div>
  );
}

// ---------------------------------------------------------------- The public page

function Intro() {
  const { status } = useSession() || {};
  const going = loadProgress();
  return (
    <>
      <div style={{ background: 'var(--navy)', color: '#fff', padding: '40px 20px 28px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}><GolfTripCrest size={120} /></div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 40, margin: '14px 0 6px' }}>The Golf Trip</h1>
        <div style={{ fontSize: 18, color: 'var(--on-navy-muted)' }}>The app for your golf group’s weekends away.</div>
      </div>
      <div className="section stack" style={{ maxWidth: 520, margin: '0 auto', padding: 16, gap: 12 }}>
        <div className="card pad stack" style={{ gap: 8 }}>
          {[
            ['⛳', 'Live scores', 'Everyone scores on their phone; the leaderboard updates as you play. Stableford and Ambrose, handicaps done for you.'],
            ['🏆', 'Trophies and history', 'Your own trophies, an honour board going back years, and a Trophy Room.'],
            ['🗳️', 'Plan the next trip', 'Ideas, votes on when and where, who’s in, jobs and shared costs.'],
            ['📖', 'Your rules', 'A Rulebook the group can vote on — and a Tribunal for the sandbagger.'],
            ['🎨', 'Yours', 'Your group’s name, crest and colours. Switch off anything you don’t need.'],
          ].map(([icon, title, text]) => (
            <div key={title} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 26, lineHeight: 1 }}>{icon}</span>
              <span><strong>{title}</strong><div className="small muted">{text}</div></span>
            </div>
          ))}
        </div>
        <a href="#/start/new" className="btn gold block" style={{ minHeight: 56, fontSize: 18 }}>{going?.gid ? 'Carry on setting up your group' : 'Start your group'}</a>
        <span className="small muted" style={{ textAlign: 'center' }}>About 10 minutes. You’ll get a link to send to your group at the end.</span>
        <a href="#/" className="btn ghost block">{status?.is_member ? 'Back to my group' : 'Got an invite? Join a group'}</a>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- The wizard

function Wizard() {
  const { status, refresh } = useSession() || {};
  const [ready, setReady] = useState(false);
  const [progress, setProgressState] = useState(() => {
    const p = loadProgress();
    return p && p.gid ? p : { step: 0 };
  });
  const setProgress = (p) => { saveProgress(p); setProgressState(p); };

  // A session first (a phone-only one if not signed in), and back into a half-made group if there is one.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await ensureSignedIn();
        if (progress.gid) setCurrentGroup(progress.gid);
        await refresh?.();
      } catch (e) { toast(e.message || 'No signal — try again'); }
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A half-made group this person no longer runs (removed, or another account): start again.
  useEffect(() => {
    if (!ready || !progress.gid || !status) return;
    const mine = (status.groups || []).find((g) => g.id === progress.gid && g.role === 'organiser');
    if (!mine) setProgress({ step: 0 });
  }, [ready, status, progress.gid]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = STEPS[progress.step] || STEPS[0];
  const next = () => setProgress({ ...progress, step: Math.min(progress.step + 1, STEPS.length - 1) });
  const back = () => setProgress({ ...progress, step: Math.max(progress.gid ? 2 : 0, progress.step - 1) });
  const minsLeft = STEPS.slice(progress.step).reduce((a, s) => a + s.mins, 0);

  return (
    <>
      <div style={{ background: 'var(--navy)', color: '#fff', padding: '18px 16px 14px' }}>
        <div className="row between" style={{ gap: 8 }}>
          <a href="#/start" style={{ color: 'var(--on-navy-muted)', fontWeight: 700, textDecoration: 'none' }}>✕ Close</a>
          <span className="small" style={{ color: 'var(--on-navy-muted)' }}>Step {progress.step + 1} of {STEPS.length} · about {minsLeft} min left</span>
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 30, margin: '10px 0 8px' }}>{step.title}</h1>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`, gap: 4 }} aria-hidden="true">
          {STEPS.map((s, i) => <span key={s.key} style={{ height: 5, borderRadius: 3, background: i <= progress.step ? 'var(--gold)' : 'rgba(255,255,255,.25)' }} />)}
        </div>
      </div>
      <div className="stack" style={{ maxWidth: 520, margin: '0 auto', padding: 16, gap: 12 }}>
        {!ready ? <div className="muted">Getting ready…</div> : (
          <>
            {step.key === 'signin' && <SignInStep status={status} onNext={next} />}
            {step.key === 'name' && <NameStep onMade={(gid) => setProgress({ gid, step: progress.step + 1 })} refresh={refresh} />}
            {step.key === 'look' && <LookStep onNext={next} />}
            {step.key === 'rules' && <RulesStep onNext={next} />}
            {step.key === 'features' && <FeaturesStep onNext={next} />}
            {step.key === 'players' && <PlayersStep onNext={next} />}
            {step.key === 'invite' && <InviteStep gid={progress.gid} />}
            {progress.step > (progress.gid ? 2 : 0) && <button type="button" className="btn ghost" onClick={back}>← Back</button>}
          </>
        )}
      </div>
    </>
  );
}

function SignInStep({ status, onNext }) {
  if (status?.signed_in) {
    return (
      <>
        <div className="card pad">✅ You’re signed in — the group will be safe on any phone you sign in on.</div>
        <button type="button" className="btn gold block" onClick={onNext}>Next</button>
      </>
    );
  }
  return (
    <>
      <p style={{ margin: 0 }}>You’ll be the group’s organiser. Signing in means you keep it if you lose or change your phone.</p>
      {SIGN_IN.length > 0 && status ? <SignInCard /> : (
        <div className="card pad small">Signing in with Google or email isn’t switched on yet. You can carry on — add a sign-in later in <strong>More → Group &amp; invites</strong>.</div>
      )}
      <button type="button" className="btn gold block" onClick={onNext}>{SIGN_IN.length > 0 ? 'Carry on without signing in' : 'Next'}</button>
    </>
  );
}

function NameStep({ onMade, refresh }) {
  const [busy, run] = useRun();
  const [name, setName] = useState('');
  const [me, setMe] = useState('');
  const [hcp, setHcp] = useState('');
  const ok = name.trim().length >= 2 && me.trim().length >= 1 && hcp !== '' && !Number.isNaN(Number(hcp)) && Number(hcp) >= -10 && Number(hcp) <= 54;
  const make = () => run(async () => {
    // Made with "Full trip" switches; the Features step changes them.
    const gid = await must(supabase.rpc('create_group', { p_name: name.trim(), p_features: PRESET_BY_KEY.full_trip.switches }));
    setCurrentGroup(gid);
    saveProgress({ gid, step: 1 }); // made: never make it twice, even if the next call fails
    await must(supabase.rpc('create_my_player', { p_name: me.trim(), p_nickname: null, p_handicap: Number(hcp), p_avatar_url: null }));
    await refresh?.();
    onMade(gid);
  });
  return (
    <>
      <label className="field"><span>Group name</span>
        <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Thursday Hackers" autoFocus /></label>
      <span className="small muted" style={{ marginTop: -6 }}>You can change it later.</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 8 }}>
        <label className="field"><span>Your name</span><input className="input" value={me} maxLength={30} onChange={(e) => setMe(e.target.value)} placeholder="As the group knows you" /></label>
        <label className="field"><span>Handicap</span><input className="input" inputMode="decimal" value={hcp} onChange={(e) => setHcp(e.target.value)} placeholder="18" /></label>
      </div>
      <button type="button" className="btn gold block" disabled={busy || !ok} onClick={make}>{busy ? 'Making your group…' : 'Make the group'}</button>
    </>
  );
}

function LookStep({ onNext }) {
  return (
    <>
      <p style={{ margin: 0 }}>Upload your crest (or skip — there’s a plain one), and pick two colours. The app checks they’re readable in the sun.</p>
      <LookCard onSaved={onNext} hideName />
      <button type="button" className="btn ghost block" onClick={onNext}>Skip — keep the plain look</button>
    </>
  );
}

function RulesStep({ onNext }) {
  const [busy, run] = useRun();
  const pick = (key) => run(async () => {
    try {
      await must(supabase.rpc('use_starter_rulebook', { p_starter: key }));
    } catch (e) {
      if (!/already has rules/i.test(e.message || '')) throw e; // came back to this step: rules are already there
    }
    onNext();
  });
  return (
    <>
      <p style={{ margin: 0 }}>Start from a ready-made Rulebook. You can change, add or remove any rule afterwards.</p>
      {STARTERS.map((s) => (
        <div key={s.key} className="card pad stack" style={{ gap: 6 }}>
          <strong>{s.name}</strong>
          <span className="small">{s.blurb}</span>
          <span className="small muted">{s.rules.join(' · ')}</span>
          <button type="button" className="btn gold block" disabled={busy} onClick={() => pick(s.key)}>Use these rules</button>
        </div>
      ))}
      <button type="button" className="btn ghost block" disabled={busy} onClick={onNext}>Start with an empty Rulebook</button>
    </>
  );
}

function FeaturesStep({ onNext }) {
  const [busy, run] = useRun();
  const [preset, setPreset] = useState('full_trip');
  const [custom, setCustom] = useState(() => ({ ...PRESET_BY_KEY.full_trip.switches }));
  const switches = preset === 'custom' ? custom : PRESET_BY_KEY[preset].switches;
  const save = () => run(async () => { await must(supabase.rpc('set_features', { p_switches: switches })); onNext(); });
  return (
    <>
      <p style={{ margin: 0 }}>Pick how much of the app your group uses. Scores, the leaderboard, players and courses are always there. Change any of it later in Group &amp; invites.</p>
      {[...PRESETS, { key: 'custom', name: 'Custom', blurb: 'Choose each feature yourself.' }].map((p) => (
        <button key={p.key} type="button" className="card pad stack" aria-pressed={preset === p.key} onClick={() => setPreset(p.key)}
          style={{ gap: 4, textAlign: 'left', borderColor: preset === p.key ? 'var(--gold)' : 'var(--line)', borderWidth: preset === p.key ? 2 : 1, cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
          <strong>{preset === p.key ? '◉' : '○'} {p.name}</strong>
          <span className="small muted">{p.blurb}</span>
        </button>
      ))}
      {preset === 'custom' && (
        <div className="card pad stack" style={{ gap: 8 }}>
          {FEATURES.map((f) => {
            const parentOff = f.parent && !featureOn(f.parent, custom);
            const disabled = f.soon || parentOff;
            return (
              <label key={f.key} className="row between" style={{ gap: 10, opacity: disabled ? 0.5 : 1 }}>
                <span style={{ minWidth: 0 }}><strong className="small">{f.name}</strong>{f.soon ? <span className="small muted"> · coming soon</span> : null}
                  <div className="small muted">{f.description}</div></span>
                <input type="checkbox" checked={!disabled && !!custom[f.key]} disabled={disabled} aria-label={f.name}
                  onChange={(e) => setCustom({ ...custom, [f.key]: e.target.checked })} style={{ width: 24, height: 24, flex: 'none' }} />
              </label>
            );
          })}
        </div>
      )}
      <button type="button" className="btn gold block" disabled={busy} onClick={save}>Next</button>
    </>
  );
}

/** "Josh M, 14" / "Mike 18" / "Sam" (handicap 18 if none) — one per line. */
export function parsePlayers(text) {
  const out = [];
  const problems = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/ /g, ' ').trim();
    if (!line) return;
    const m = line.match(/^(.*?)[\s,;\t]+([+-]?\d{1,2}(?:\.\d)?)$/);
    const name = (m ? m[1] : line).replace(/[,;\t]+$/, '').trim();
    let hcp = m ? Number(m[2].replace('+', '-')) : 18;
    if (!name || name.length > 30) { problems.push(`Line ${i + 1}: needs a name (up to 30 letters)`); return; }
    if (hcp < -10 || hcp > 54) { problems.push(`Line ${i + 1}: a handicap of ${m[2]} doesn’t look right`); return; }
    if (out.some((p) => p.name.toLowerCase() === name.toLowerCase())) { problems.push(`Line ${i + 1}: ${name} is on the list twice`); return; }
    out.push({ name, handicap: hcp });
  });
  return { players: out, problems };
}

function PlayersStep({ onNext }) {
  const [busy, run] = useRun();
  const [text, setText] = useState('');
  const parsed = useMemo(() => parsePlayers(text), [text]);
  const add = () => run(async () => {
    for (const p of parsed.players) {
      await must(supabase.rpc('admin_create_player', { p_name: p.name, p_nickname: null, p_handicap: p.handicap, p_avatar_url: null }));
    }
    onNext();
  }, `${parsed.players.length} player${parsed.players.length === 1 ? '' : 's'} added`);
  return (
    <>
      <p style={{ margin: 0 }}>Add the regulars now, so their names are there when they join (they pick their name from the list). Or skip — people add themselves when they open the invite. (You’re already on the list.)</p>
      <label className="field"><span>One per line — name and handicap</span>
        <textarea className="input" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Josh M, 14\nMike, 18\nSam 9.4'} style={{ fontFamily: 'inherit', resize: 'vertical' }} /></label>
      {parsed.problems.map((p) => <div key={p} className="err" style={{ margin: 0 }}>{p}</div>)}
      {parsed.players.length > 0 && <div className="small muted">{parsed.players.map((p) => `${p.name} (${p.handicap})`).join(' · ')}</div>}
      <button type="button" className="btn gold block" disabled={busy || !parsed.players.length || parsed.problems.length > 0} onClick={add}>
        {parsed.players.length ? `Add ${parsed.players.length} player${parsed.players.length === 1 ? '' : 's'}` : 'Add players'}</button>
      <button type="button" className="btn ghost block" disabled={busy} onClick={onNext}>Skip for now</button>
    </>
  );
}

function InviteStep({ gid }) {
  const open = () => {
    saveProgress(null);
    setCurrentGroup(gid);
    window.location.hash = '#/';
    window.location.reload();
  };
  return (
    <>
      <div className="card pad">🎉 Your group is ready. Send this link to the group chat — anyone who opens it joins as a player.</div>
      <InviteCard role="player" />
      <button type="button" className="btn gold block" style={{ minHeight: 56 }} onClick={open}>Open your group</button>
      <span className="small muted" style={{ textAlign: 'center' }}>Next: add a course and a trip in More → Admin. The guest link and everything else are in More → Group &amp; invites.</span>
    </>
  );
}
