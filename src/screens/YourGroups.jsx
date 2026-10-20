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
import { PinForm } from './Join.jsx';
import { paintLook, DEFAULT_LOOK } from '../lib/theme.js';
import { SIGN_IN } from '../lib/auth.js';
import { NEW_GROUPS } from '../lib/beta.js';

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

/** Groups this person deleted (as an organiser) in the last 7 days, with "Bring back". Hidden when there are none,
 * or on a database without the 7-day undo yet. */
function DeletedGroups({ light }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    supabase.rpc('my_deleted_groups').then(({ data, error }) => { if (live && !error && Array.isArray(data)) setRows(data); }, () => {});
    return () => { live = false; };
  }, []);
  if (!rows.length) return null;
  const back = async (g) => {
    setBusy(g.id); setErr('');
    const { error } = await supabase.rpc('undo_delete_group', { p_group: g.id });
    setBusy(null);
    if (error) { setErr(error.message.replace(/^.*?ERROR:\s*/, '')); return; }
    openGroup(g.id);
  };
  const until = (d) => new Date(d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const muted = { color: light ? 'var(--muted)' : 'var(--on-navy-muted)' };
  return (
    <div style={{ width: '100%', maxWidth: light ? undefined : 340, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="small" style={{ ...muted, fontWeight: 700 }}>Deleted recently</div>
      {rows.map((g) => (
        <div key={g.id} className="row" style={{ gap: 10, padding: '10px 14px', borderRadius: 14, border: light ? '1px solid var(--line)' : '1px dashed rgba(255,255,255,.35)', background: light ? '#fff' : 'transparent' }}>
          <span className="grow" style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</strong>
            <span className="small" style={muted}>You can bring it back until {until(g.undo_until)}</span>
          </span>
          <button type="button" className="btn sm gold" disabled={busy === g.id} onClick={() => back(g)}>{busy === g.id ? 'Bringing back…' : 'Bring back'}</button>
        </div>
      ))}
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}

/** Before you're in a group: a full navy screen, like the home screen. */
export default function YourGroups() {
  const { status, user } = useSession();
  const [showPin, setShowPin] = useState(false);
  const rows = groupRows(status?.groups, status?.group_id);
  const none = rows.length === 0;
  const ghost = { color: '#fff', borderColor: 'rgba(255,255,255,.5)', background: 'transparent', maxWidth: 340 };
  // Not in any one group here: The Golf Trip's own colours (not the last group's).
  useEffect(() => { paintLook(DEFAULT_LOOK, null); }, []);
  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
      <GolfTripCrest size={84} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 32, fontWeight: 700 }}>{none ? 'You’re not in a group yet' : 'Your groups'}</div>
        <div className="small" style={{ color: 'var(--on-navy-muted)', marginTop: 4 }}>
          {none ? (NEW_GROUPS ? 'Start one for your mates, or join theirs with the invite link from the group chat.' : 'Join your group with the invite link from the group chat.') : 'Tap the one you want to go into.'}
        </div>
      </div>
      {!none && <GroupList rows={rows} status={status} onPick={(g) => openGroup(g.id)} />}
      <DeletedGroups />
      {none && NEW_GROUPS && <a href="#/start" className="btn gold block" style={{ maxWidth: 340 }}>Start a new group</a>}
      {showPin
        ? <PinForm autoFocus linkFirst onInvite={(c) => { window.location.hash = `#/join/${c}`; }} />
        : <button type="button" className="btn ghost block" style={ghost} onClick={() => setShowPin(true)}>{none ? 'Join with an invite link' : 'Join another with an invite link'}</button>}
      {none && <div className="small" style={{ color: 'var(--on-navy-muted)', textAlign: 'center', maxWidth: 340 }}>Played before without signing in? Ask your organiser for your personal link. It brings your scores and history with you.</div>}
      {!none && NEW_GROUPS && <a href="#/start" className="btn ghost block" style={{ ...ghost, borderColor: 'transparent', textDecoration: 'underline' }}>Start a new group</a>}
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
        <DeletedGroups light />
        {NEW_GROUPS && <a href="#/start" className="btn block">Start a new group</a>}
        {showPin
          ? (
            // The PIN box is styled for the navy front door; give it a navy panel here too.
            <div style={{ background: 'var(--navy)', color: '#fff', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'center' }}>
              <PinForm autoFocus linkFirst={SIGN_IN.length > 0} onJoined={(id) => openGroup(typeof id === 'string' ? id : status?.group_id)}
                onInvite={(c) => { window.location.hash = `#/join/${c}`; }} />
            </div>
          )
          : <button type="button" className="btn ghost block" onClick={() => setShowPin(true)}>{SIGN_IN.length > 0 ? 'Join another with an invite link' : 'Join another with a PIN or invite link'}</button>}
        {!status?.signed_in && <p className="note">To keep your groups on a new phone, add a sign-in in <Link to="/group">Group & invites</Link>.</p>}
      </div>
    </div>
  );
}
