// Public "how it works" page for the lads — no sign-in needed. Open with ?guide
import React, { useState } from 'react';
import { Crest } from '../components/Logo.jsx';
import { PuttBuddiesBadge } from '../components/TrophyArt.jsx';
import { Icon } from '../components/ui.jsx';

const APP = './';
const PIN = '7851';

const GROUPS = [
  { label: 'Group 1', teams: [['Fred & Paul', 15], ['Mark & Al', 11]] },
  { label: 'Group 2', teams: [['Josh & Hamish', 9], ['Adam & Cam', 10]] },
  { label: 'Group 3', teams: [['Chris & Mike', 14]] },
];

function Step({ n, title, children }) {
  return (
    <div className="card pad row" style={{ alignItems: 'flex-start', gap: 12 }}>
      <span style={{ flex: 'none', width: 32, height: 32, borderRadius: '50%', background: 'var(--navy)', color: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--display)', fontWeight: 700, fontSize: 18 }}>{n}</span>
      <div className="stack" style={{ gap: 4 }}>
        <strong style={{ fontSize: 17 }}>{title}</strong>
        <div style={{ fontSize: 15, lineHeight: 1.45 }}>{children}</div>
      </div>
    </div>
  );
}

function Feature({ icon, title, children }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--line-soft)' }}>
      <span style={{ color: 'var(--navy)', flex: 'none', marginTop: 2 }}>{icon}</span>
      <div><strong>{title}</strong><div style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--muted)' }}>{children}</div></div>
    </div>
  );
}

export default function Guide() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="app" style={{ paddingBottom: 30 }}>
      <header className="hdr" style={{ alignItems: 'center', textAlign: 'center', paddingBottom: 20 }}>
        <Crest size={110} />
        <div className="hdr-title" style={{ fontSize: 30 }}>Sunday Ambrose</div>
        <div className="hdr-sub">Shoalhaven Heads · South Coast Trip 2026 · playing for <strong style={{ color: 'var(--gold)' }}>Putt Buddies</strong></div>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
          <a href={APP} className="btn gold block" style={{ minHeight: 56, fontSize: 18 }}>Open the app</a>
          <button type="button" className="btn block" style={{ background: 'var(--navy-2)' }} onClick={() => { try { navigator.clipboard.writeText(PIN); setCopied(true); } catch { /* ignore */ } }}>
            Group PIN: <span className="num" style={{ fontSize: 24, letterSpacing: '.2em', marginLeft: 6 }}>{PIN}</span>
            <span className="small" style={{ marginLeft: 8, opacity: 0.8 }}>{copied ? 'copied ✓' : 'tap to copy'}</span>
          </button>
        </div>
      </header>

      <div className="section stack">
        <span className="label">Get set up (1 minute)</span>
        <Step n="1" title="Open the app and enter the PIN">Tap <strong>Open the app</strong> above, enter <strong>{PIN}</strong>.</Step>
        <Step n="2" title="Tap your name">Pick yourself from the list, take a selfie (it's your face on the leaderboard), done. Not on the list? Tap "I'm not on the list" and Josh approves you.</Step>
        <Step n="3" title="Put it on your home screen">
          <strong>iPhone:</strong> in Safari tap Share <span aria-hidden="true">⎋</span> → <em>Add to Home Screen</em>.<br />
          <strong>Android:</strong> in Chrome tap ⋮ → <em>Add to Home screen</em>. It then opens like a normal app.
        </Step>
      </div>

      <div className="section stack">
        <span className="label">Today's format</span>
        <div className="card pad stack" style={{ gap: 8, fontSize: 15, lineHeight: 1.5 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}><span>⛳</span><span><strong>Ambrose pairs.</strong> Both hit, pick the best shot, both play from there. One score per team per hole.</span></div>
          <div className="row" style={{ alignItems: 'flex-start' }}><span>➖</span><span><strong>Final score = gross minus team handicap.</strong> Straight strokes — not Stableford points. Lowest net wins.</span></div>
          <div className="row" style={{ alignItems: 'flex-start' }}><span>🏌️</span><span><strong>Minimum 6 drives each.</strong> Every player must have at least 6 of their tee shots used. The app counts them for you.</span></div>
        </div>
      </div>

      <div className="section stack">
        <span className="label">Teams & handicaps</span>
        {GROUPS.map((g) => (
          <div key={g.label} className="card" style={{ overflow: 'hidden' }}>
            <div className="small" style={{ padding: '8px 14px', background: 'var(--navy)', color: '#fff', fontWeight: 700, letterSpacing: '.04em' }}>{g.label}</div>
            {g.teams.map(([name, h]) => (
              <div key={name} className="row between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)' }}>
                <strong style={{ fontSize: 17 }}>{name}</strong>
                <span>team handicap <span className="num" style={{ fontSize: 22 }}>{h}</span></span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="section stack">
        <span className="label">Scoring on the course</span>
        <Step n="1" title="One person per team enters scores">Tap the gold <strong>Enter score</strong> button at the bottom of the Leaderboard.</Step>
        <Step n="2" title="Set the team score">Big <strong>− / +</strong> buttons, starting at par.</Step>
        <Step n="3" title="Tap whose drive you used">Each name shows a counter, e.g. <strong>Josh 3/6</strong>. It goes red if someone's running out of holes to get their 6.</Step>
        <Step n="4" title="Save & next hole">No signal? It saves on your phone and sends itself when you're back in range. Got it wrong? Tap the hole number and fix it.</Step>
      </div>

      <div className="section">
        <span className="label">What else is in there</span>
        <div className="card" style={{ marginTop: 8 }}>
          <Feature icon={Icon.board()} title="Live leaderboard">Updates as every team enters scores. Compares teams on different holes fairly (net to par for holes played). Flip to <strong>Projected</strong> for predicted finishes and win %. Tap a team for their card.</Feature>
          <Feature icon={Icon.feed()} title="The Feed">Birdies post themselves. Add photos, comments and reactions — the banter goes here.</Feature>
          <Feature icon={Icon.flag()} title="Side comps">Closest to pin and longest drive — pin the ball on the map, add a photo and the distance.</Feature>
          <Feature icon={Icon.pin()} title="Where's everyone">Switch on location to see each group on the course map.</Feature>
          <Feature icon={Icon.trophy()} title="The Trophy Room">BD, Putt Buddies and the Noodle Cup, with standings and the honour boards.</Feature>
          <Feature icon={Icon.gavel()} title="Handicap Tribunal">Think someone's off the wrong handicap? Lodge a case. The lads vote.</Feature>
        </div>
      </div>

      <div className="section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 20 }}>
        <PuttBuddiesBadge size={130} />
        <a href={APP} className="btn gold block" style={{ minHeight: 56, fontSize: 18 }}>Open the app — PIN {PIN}</a>
      </div>
    </div>
  );
}
