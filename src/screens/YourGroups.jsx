// Your groups: after signing in, pick the group to go into (or start one / join one if you're in none yet).
// Also opened from inside the app (More → Your groups, or tapping the crest at the top) to switch group.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { groupRows, groupLook, clearFreshSignIn } from '../lib/home.js';
import { GroupCrest, GolfTripCrest } from '../components/Logo.jsx';
import { Header } from '../components/ui.jsx';
import { LinkForm } from './Join.jsx';
import { paintLook, DEFAULT_LOOK } from '../lib/theme.js';
import { SIGN_IN } from '../lib/auth.js';
import { NEW_GROUPS } from '../lib/beta.js';
import { noGroupWords, markJoinAfterSignIn } from '../lib/joinfirst.js';

/** Go into a group. Everything on screen belongs to the old group, so start fresh in the new one. */
function openGroup(id) {
  clearFreshSignIn();
  setCurrentGroup(id);
  window.location.hash = '#/';
  window.location.reload();
}

function GroupList({ rows, onPick, light, status }) {
  return (
    <div className={light ? 'card' : undefined} style={light ? undefined : { width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((g) => (
        <button key={g.id} type="button" onClick={() => onPick(g)} aria-current={g.current ? 'true' : undefined}
          className="row"
          style={light
            ? { width: '100%', minHeight: 64, padding: '10px 14px', border: 0, borderTop: '1px solid var(--line-soft)', background: g.current ? 'var(--gold-soft)' : '#fff', textAlign: 'left', color: 'inherit', gap: 12 }
            : { width: '100%', minHeight: 64, padding: '10px 14px', borderRadius: 14, border: '1px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.08)', textAlign: 'left', color: '#fff', gap: 12 }}>
          <GroupCrest size={44} look={groupLook(g, status)} name={g.name} />
          <span className="grow" style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 17, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</strong>
            <span className="small" style={{ color: light ? 'var(--muted)' : 'var(--on-navy-muted)' }}>{g.roleWord}{g.current && light ? ' · open now' : ''}</span>
          </span>
          <span aria-hidden="true" style={{ fontWeight: 700 }}>›</span>
        </button>
      ))}
    </div>
  );
}

/** Before you're in a group: a full navy screen, like the home screen. */
export default function YourGroups() {
  const { status, user } = useSession();
  const [showPin, setShowPin] = useState(false);
  const rows = groupRows(status?.groups, status?.group_id);
  const none = rows.length === 0;
  const words = noGroupWords(user?.email);
  // Signed in but in no group (e.g. a fresh Google account from the front door): open the link → join as this account.
  const openLink = (l) => { if (l.kind === 'invite') markJoinAfterSignIn(l.code); window.location.hash = l.hash; };
  const ghost = { color: '#fff', borderColor: 'rgba(255,255,255,.5)', background: 'transparent', maxWidth: 340 };
  // Not in any one group here: The Golf Trip's own colours (not the last group's).
  useEffect(() => { paintLook(DEFAULT_LOOK, null); }, []);
  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
      <GolfTripCrest size={84} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 32, fontWeight: 700 }}>{none ? words.title : 'Your groups'}</div>
        <div className="small" style={{ color: 'var(--on-navy-muted)', marginTop: 4, maxWidth: 340 }} data-testid={none ? 'no-group' : undefined}>
          {none ? words.body : 'Tap the one you want to go into.'}
        </div>
      </div>
      {!none && <GroupList rows={rows} status={status} onPick={(g) => openGroup(g.id)} />}
      {/* No group: the link box straight away, never a blank screen (ov13). */}
      {none || showPin
        ? <LinkForm autoFocus={showPin} onOpen={openLink} />
        : <button type="button" className="btn ghost block" style={ghost} onClick={() => setShowPin(true)}>Join another with an invite link</button>}
      {none && <div className="small" style={{ color: 'var(--on-navy-muted)', textAlign: 'center', maxWidth: 340 }}>Played before without signing in? Ask your organiser for your personal link. It brings your scores and history with you.</div>}
      {NEW_GROUPS && <a href="#/start" className="btn ghost block" style={{ ...ghost, borderColor: 'transparent', textDecoration: 'underline' }}>{none ? 'Or start a new group' : 'Start a new group'}</a>}
      <div className="small" style={{ color: 'var(--on-navy-muted)', textAlign: 'center' }}>
        {user?.email ? <>Signed in as {user.email}. </> : null}
        <button type="button" onClick={() => { clearFreshSignIn(); supabase.auth.signOut().then(() => { window.location.hash = '#/'; window.location.reload(); }); }}
          style={{ background: 'none', border: 0, color: '#fff', textDecoration: 'underline', padding: '0 8px', minHeight: 48, font: 'inherit' }}>
          {user?.email ? 'Not you? Sign out' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}

/** Inside the app (#/groups): switch group, start one, or join another. */
export function YourGroupsInside() {
  const { status } = useSession();
  const [showPin, setShowPin] = useState(false);
  const rows = groupRows(status?.groups, status?.group_id);
  return (
    <div className="page">
      <Header back title="Your groups" sub={rows.length > 1 ? 'Tap one to switch' : (NEW_GROUPS ? 'Start a new group or join another' : 'Join another group')} />
      <div className="section stack" style={{ gap: 12 }}>
        <GroupList light rows={rows} status={status} onPick={(g) => (g.current ? (window.location.hash = '#/') : openGroup(g.id))} />
        {NEW_GROUPS && <a href="#/start" className="btn block">Start a new group</a>}
        {showPin
          ? (
            // The link box is styled for the navy front door; give it a navy panel here too.
            <div style={{ background: 'var(--navy)', color: '#fff', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'center' }}>
              <LinkForm autoFocus />
            </div>
          )
          : <button type="button" className="btn ghost block" onClick={() => setShowPin(true)}>Join another with its link</button>}
        {!status?.signed_in && <p className="note">On a new phone? Open your personal link there (your profile → Copy my link){SIGN_IN.length > 0 ? <>, or add a sign-in on <Link to={`/player/${status.player_id}`}>your profile</Link></> : null}.</p>}
      </div>
    </div>
  );
}
