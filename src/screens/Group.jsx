// Players & group (was Group & invites; ov15): the players list first (handicaps — organisers change them, everyone
// else can dispute), then invite links with QR codes, then the organiser's settings (people and roles, votes by email,
// look, features). SignInCard is used on your own profile, the start wizard and the quick round.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, playerName } from '../lib/store.jsx';
import { Header, Avatar, Loading, toast } from '../components/ui.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { inviteLink, ROLE_LABEL, ROLE_HELP } from '../lib/invite.js';
import { readLink } from '../lib/links.js';
import { SaveSpotPanel } from '../components/SaveSpot.jsx';
import { SIGN_IN } from '../lib/auth.js';
import { shareText } from '../lib/push.js';
import { FEATURES, featureOn, children, followers } from '../lib/features.js';
import { FONTS, DEFAULT_LOOK, LGC_LOOK, lookProblems, themeVars, applyLook } from '../lib/theme.js';
import { uploadPhoto } from '../lib/images.js';
import { GroupCrest } from '../components/Logo.jsx';
import { useRun, must } from '../lib/run.js';
import { NEW_GROUPS } from '../lib/beta.js';
import ForgetJokes from '../components/ForgetJokes.jsx';
import { GovernanceLink } from './Cases.jsx';
import { GroupVoteEmailCard } from '../components/VoteEmail.jsx';
import { Link, useLocation } from 'react-router-dom';
import { GroupTabs } from './DeskNav.jsx';
import PlayersList from '../components/PlayersList.jsx';
import { gate } from '../lib/savedgate.js';
import { OrganiserSaveCard } from '../components/SavedGate.jsx';

export default function Group() {
  const { status } = useSession();
  const admin = status.is_admin;
  // ov15 (Josh): "the players table, which is the most important, is hidden." Players first; then invites; then the
  // organiser's settings. Your own things (Save your spot, how you get votes, your link) are on your profile now.
  return (
    <div className="page">
      <GroupTabs deskOnly />
      <Header back title="Players & group" sub={status.group_name} />
      <OrganiserSaveCard />
      <div className="section stack">
        <PlayersList />
        {admin && <span className="label" style={{ marginTop: 8 }}>Invite people</span>}
        {admin && <InviteCard role="player" />}
        {admin && <InviteCard role="guest" />}
        {admin && <span className="label" style={{ marginTop: 8 }}>Organiser settings</span>}
        {admin && <Members />}
        {admin && <GroupVoteEmailCard />}
        {admin && <LookCard />}
        {admin && <FeaturesCard />}
        {admin && <ForgetJokes />}
        <GovernanceLink />
        <MyGroups />
        <JoinAnother />
        <YourData />
        {!admin && <div className="small muted">You’re a {ROLE_LABEL[status.role] || 'member'} here — {ROLE_HELP[status.role] || ''} Any link you share from the app (a recap, a vote, a trip) lets someone new join and land on it. Your own settings (sign-in, votes by email, your link) are on <Link to={`/player/${status.player_id}`}>your profile</Link>.</div>}
      </div>
    </div>
  );
}

function MyGroups() {
  const { status } = useSession();
  const groups = status.groups || [];
  if (groups.length < 2) return null;
  const open = (id) => {
    setCurrentGroup(id);
    // Everything on screen belongs to the old group: start fresh in the new one.
    window.location.hash = '#/';
    window.location.reload();
  };
  return (
    <div className="card">
      <div className="label" style={{ padding: '12px 14px 4px' }}>Your groups</div>
      {groups.map((g) => (
        <button key={g.id} type="button" className="row" onClick={() => g.id !== status.group_id && open(g.id)} aria-current={g.id === status.group_id ? 'true' : undefined}
          style={{ width: '100%', padding: '12px 14px', border: 0, borderTop: '1px solid var(--line-soft)', background: g.id === status.group_id ? 'var(--gold-soft)' : '#fff', textAlign: 'left', color: 'inherit' }}>
          <span className="grow"><strong>{g.name}</strong><div className="small muted">{ROLE_LABEL[g.role] || g.role}</div></span>
          <span className="small" style={{ fontWeight: 700 }}>{g.id === status.group_id ? 'Open now' : 'Switch →'}</span>
        </button>
      ))}
    </div>
  );
}

export function SignInCard({ returnHash = '' } = {}) {
  const { status } = useSession();
  const [done, setDone] = useState(false);
  if (done) return <div className="card pad" role="status"><strong>Done ✓</strong><div className="small muted">Next time just tap Sign in — on this phone, a new one or a laptop.</div></div>;
  if (status.signed_in) return <div className="small muted">✅ You’re signed in properly — you can use this account on any phone.</div>;
  if (!SIGN_IN.length) return null; // providers not set up yet
  // Save your spot (22 Oct): Google, or an email and password, added to this same phone-only user.
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--gold)' }} data-testid="sign-in-card">
      <strong>🔐 Save your spot</strong>
      <span className="small">Right now you’re only on this phone. Connect Google or email so you can sign in on your laptop — same name, same scores.</span>
      <SaveSpotPanel returnHash={returnHash || undefined} onDone={() => setDone(true)} />
    </div>
  );
}

export function InviteCard({ role }) {
  const [code, setCode] = useState(null);
  const [qr, setQr] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, run] = useRun();
  const load = useCallback(async (reset = false) => {
    const { data, error } = await supabase.rpc(reset ? 'reset_group_invite' : 'group_invite', { p_role: role });
    if (error) {
      // An older database without invite links: hide the card. Anything else: say so.
      if (!reset && /PGRST202|Could not find the function/i.test(`${error.code} ${error.message}`)) { setFailed(true); return; }
      throw error;
    }
    setCode(data);
  }, [role]);
  useEffect(() => { load().catch(() => setFailed(true)); }, [load]);
  const link = code ? inviteLink(code) : '';
  useEffect(() => {
    if (!link) return;
    let live = true;
    import('qrcode').then((QR) => QR.toDataURL(link, { margin: 1, width: 360, color: { dark: '#1C2B4A', light: '#FFFFFF' } }))
      .then((url) => live && setQr(url)).catch(() => {});
    return () => { live = false; };
  }, [link]);
  if (failed) return null; // e.g. an older database without invite links
  const guest = role === 'guest';
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div><strong>{guest ? '🎟️ Guest link' : '✉️ Invite link'}</strong><div className="small muted">{guest ? ROLE_HELP.guest : 'Anyone with this link joins as a player. Share it in the group chat, or show the QR code.'}</div></div>
      {!code ? <Loading /> : (
        <>
          {qr && <img src={qr} alt={`QR code for the ${guest ? 'guest' : 'invite'} link`} style={{ width: 180, height: 180, alignSelf: 'center', borderRadius: 8 }} />}
          <code style={{ fontSize: 13, wordBreak: 'break-all', background: 'var(--bg, #F4F5F7)', padding: 8, borderRadius: 8 }}>{link}</code>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button {...gate('invite')} type="button" className="btn gold sm" onClick={async () => {
              const r = await shareText(`Join us on the golf app: ${link}`);
              if (r === 'copied') toast('Link copied — paste it in the group chat');
              else if (r === 'failed') toast('Couldn’t share from this phone');
            }}>Share link</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => {
              if (window.confirm('Make a new link? The old one stops working straight away (people already in stay in).')) run(() => load(true), 'New link made');
            }}>New link</button>
          </div>
        </>
      )}
    </div>
  );
}

function Members() {
  const { status, user, refresh } = useSession();
  const data = useData();
  const [rows, setRows] = useState(null);
  const [busy, run] = useRun();
  const load = useCallback(async () => {
    const { data: m } = await supabase.from('group_members').select('user_id,player_id,role,created_at').eq('group_id', status.group_id).order('created_at');
    setRows(m || []);
  }, [status.group_id]);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <Loading />;
  const organisers = rows.filter((r) => r.role === 'organiser').length;
  const taken = new Set(rows.map((r) => r.player_id).filter(Boolean));
  const freeNames = data.players.filter((p) => p.approved !== false && !taken.has(p.id)).sort((a, b) => playerName(a).localeCompare(playerName(b)));
  const changeRole = (r, p, role) => {
    const self = r.user_id === user?.id;
    const who = p ? playerName(p) : 'this person';
    if (role === 'organiser' && !window.confirm(`Make ${who} an organiser? Organisers can change trips, players, roles and invites.`)) return;
    if (self && !window.confirm(`Change your own role to ${ROLE_LABEL[role]}? You'll lose the organiser controls.`)) return;
    run(async () => {
      await must(supabase.rpc('set_member_role', { p_user: r.user_id, p_role: role }));
      if (self) await refresh(); else load();
    }, 'Role changed');
  };
  // v8 fix: sign-ins with no name (mostly old ones from before the move to the new address, whose names were freed)
  // fold into one line, and aren't counted as people in the group. Nothing is deleted.
  const named = rows.filter((r) => data.playersById[r.player_id]);
  const nameless = rows.filter((r) => !data.playersById[r.player_id]);
  const line = (r) => {
        const p = data.playersById[r.player_id];
        const me = r.user_id === user?.id;
        const lastOrganiser = r.role === 'organiser' && organisers <= 1;
        return (
          <div key={r.user_id} className="row" style={{ gap: 10, padding: '10px 14px', borderTop: '1px solid var(--line-soft)', alignItems: 'center' }}>
            {p ? <Avatar player={p} size={34} /> : <span style={{ width: 34, height: 34, borderRadius: 17, background: 'var(--line-soft)', display: 'inline-block' }} />}
            <span className="grow" style={{ minWidth: 0 }}>
              <strong>{p ? playerName(p) : 'Hasn’t picked a name yet'}{me ? ' (you)' : ''}</strong>
              {p && <button type="button" className="small" disabled={busy} style={{ display: 'block', border: 0, background: 'none', padding: 0, color: 'var(--muted)' }}
                onClick={() => { if (window.confirm(`Free the name “${playerName(p)}”? Whoever it really is can then pick it on their phone. Scores stay with the name.`)) run(async () => { await must(supabase.rpc('release_player', { p_player: p.id })); load(); }, 'Name freed'); }}>Free this name</button>}
              {!p && freeNames.length > 0 && (
                <select className="select" value="" disabled={busy} aria-label="Give them a name" style={{ marginTop: 4, fontSize: 14, minHeight: 36, width: '100%' }}
                  onChange={(e) => e.target.value && run(async () => { await must(supabase.rpc('assign_player', { p_user: r.user_id, p_player: e.target.value })); load(); }, 'Name given')}>
                  <option value="">Give them a name…</option>
                  {freeNames.map((x) => <option key={x.id} value={x.id}>{playerName(x)}</option>)}
                </select>
              )}
            </span>
            <select className="select" value={r.role} disabled={busy || lastOrganiser} aria-label="Role" style={{ width: 'auto', flex: 'none' }}
              onChange={(e) => changeRole(r, p, e.target.value)}>
              {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {!me && !lastOrganiser && (
              <button type="button" className="btn ghost sm" disabled={busy} aria-label="Remove from group"
                onClick={() => { if (window.confirm(`Take ${p ? playerName(p) : 'this person'} out of the group? Their scores and posts stay.`)) run(async () => { await must(supabase.rpc('remove_member', { p_user: r.user_id })); load(); }, 'Removed'); }}>✕</button>
            )}
          </div>
        );
  };
  return (
    <div className="card" data-testid="members-card">
      <div className="label" style={{ padding: '12px 14px 4px' }}>People in the group · {named.length}</div>
      {named.map(line)}
      {nameless.length > 0 && (
        <details data-testid="nameless-sign-ins" style={{ borderTop: '1px solid var(--line-soft)' }}>
          <summary style={{ padding: '12px 14px', cursor: 'pointer', fontWeight: 700, minHeight: 48 }}>
            {nameless.length} old sign-in{nameless.length === 1 ? '' : 's'} without a name
            <div className="small muted" style={{ fontWeight: 400 }}>Phones that signed in but haven’t picked a name (mostly from before the move to the new address). Not counted above. Give one a name if you know who it is.</div>
          </summary>
          {nameless.map(line)}
        </details>
      )}
      <div className="small muted" style={{ padding: '8px 14px 12px' }}>{Object.entries(ROLE_HELP).map(([k, h]) => `${ROLE_LABEL[k]}: ${h}`).join(' ')}</div>
    </div>
  );
}

/** Join another group by pasting its invite link (iPhone Home Screen apps can't open links from chats). */
function JoinAnother() {
  const [text, setText] = useState('');
  const l = readLink(text);
  const code = l && l.kind !== 'page' ? l.hash : null;
  return (
    <form className="card pad stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (code) window.location.hash = code; }}>
      <strong>➕ Join another group</strong>
      <span className="small muted">Paste the invite link someone sent you.</span>
      <div className="row" style={{ gap: 6 }}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://…/#/join/…" autoCapitalize="none" />
        <button className="btn" disabled={!code}>Open</button>
      </div>
      {NEW_GROUPS && <a href="#/start" className="small" style={{ fontWeight: 700 }}>Or start a new group of your own →</a>}
    </form>
  );
}

/** Features: one switch each. A feature that needs another is greyed out while that one is off. Applies to everyone
 *  in the group straight away (the database refuses writes to a switched-off feature, so it can't be got around). */
function FeaturesCard() {
  const data = useData();
  // #/group?feature=connector (from the Caddie): that switch is highlighted and scrolled to.
  const want = new URLSearchParams(useLocation().search).get('feature');
  useEffect(() => {
    if (!want) return;
    const t = setTimeout(() => document.querySelector(`[data-feature="${CSS.escape(want)}"]`)?.scrollIntoView({ block: 'center' }), 300);
    return () => clearTimeout(t);
  }, [want]);
  const [busy, run] = useRun();
  const settings = data.features || {};
  const flip = (f, on) => {
    const kids = children(f.key).filter((k) => featureOn(k, settings));
    if (!on && kids.length && !window.confirm(`Switching off ${f.name} also switches off: ${kids.map((k) => FEATURES.find((x) => x.key === k).name).join(', ')}. Go ahead?`)) return;
    run(async () => {
      await must(supabase.rpc('set_feature', { p_key: f.key, p_on: on }));
      // Background parts (e.g. running jokes with commentary) go on and off with it, so the server agrees.
      for (const k of followers(f.key)) await supabase.rpc('set_feature', { p_key: k, p_on: on });
    }, on ? `${f.name} on` : `${f.name} off`);
  };
  return (
    <div className="card">
      <div style={{ padding: '12px 14px 4px' }}>
        <div className="label">Features</div>
        <div className="small muted">Switch off what your group doesn’t use — it disappears for everyone. History stays.</div>
      </div>
      {FEATURES.filter((f) => !f.hidden).map((f) => {
        const own = f.key in settings ? !!settings[f.key] : f.newGroup;
        const parentOff = f.parent && !featureOn(f.parent, settings);
        if (f.soon) {
          return (
            <div key={f.key} className="row" style={{ gap: 10, padding: '10px 14px', borderTop: '1px solid var(--line-soft)', opacity: 0.55 }}>
              <span className="grow"><strong style={{ fontSize: 15 }}>{f.name}</strong><div className="small muted">Coming soon. {f.description}</div></span>
            </div>
          );
        }
        return (
          <label key={f.key} className="row" data-feature={f.key} data-highlight={want === f.key ? 'true' : undefined}
            style={{ gap: 10, padding: '10px 14px', paddingLeft: f.parent ? 34 : 14, borderTop: '1px solid var(--line-soft)', opacity: parentOff ? 0.5 : 1,
              ...(want === f.key ? { background: 'var(--gold-soft)', boxShadow: 'inset 4px 0 0 var(--gold)' } : {}) }}>
            <span className="grow" style={{ minWidth: 0 }}>
              <strong style={{ fontSize: 15 }}>{f.name}</strong>
              <div className="small muted">{parentOff ? `Needs ${FEATURES.find((x) => x.key === f.parent).name} on. ` : ''}{f.description}</div>
            </span>
            <input type="checkbox" role="switch" checked={own && !parentOff} disabled={busy || parentOff} aria-label={f.name}
              onChange={(e) => flip(f, e.target.checked)} style={{ width: 24, height: 24, flex: 'none' }} />
          </label>
        );
      })}
    </div>
  );
}

/** The group's look: name, short name, crest, two colours (checked for readability in the sun) and heading font. */
export function LookCard({ onSaved, hideName = false } = {}) {
  const { status, refresh } = useSession();
  const start = status.look || (status.legacy === false ? DEFAULT_LOOK : LGC_LOOK);
  const [v, set] = useState(() => ({ name: status.group_name || '', short_name: start.short_name || '', primary: start.primary, accent: start.accent, font: start.font, crest_url: start.crest_url }));
  const [busy, run] = useRun();
  const problems = lookProblems(v);
  const preview = themeVars(v);
  const pickCrest = (file) => file && run(async () => {
    const url = await uploadPhoto(file, 'crest', { maxDim: 512, square: true, png: true, strict: true });
    set((x) => ({ ...x, crest_url: url }));
  }, 'Crest ready — save to use it');
  const save = () => run(async () => {
    await must(supabase.rpc('set_group_look', { p_name: v.name, p_short_name: v.short_name || null, p_primary: v.primary, p_accent: v.accent, p_font: v.font, p_crest_url: v.crest_url || null }));
    applyLook({ short_name: v.short_name || null, crest_url: v.crest_url || null, primary: v.primary, accent: v.accent, font: v.font }, v.name);
    await refresh();
    onSaved?.();
  }, 'Saved — everyone sees the new look');
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div><strong>🎨 Look</strong><div className="small muted">How the app looks for everyone in {status.group_name}.</div></div>
      {/* Preview: a header and a button in the chosen colours */}
      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
        <div className="row" style={{ gap: 10, padding: 12, background: preview['--navy'], color: '#fff' }}>
          <GroupCrest size={40} look={v} name={v.name} />
          <span><div style={{ fontFamily: preview['--display'], fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{v.name || 'Group name'}</div>
            <div style={{ fontSize: 13, color: preview['--on-navy-muted'] }}>Leaderboard</div></span>
        </div>
        {/* v8 fix: real spaces between the samples, so read out (or copied) it isn't "A gold button2026". */}
        <div className="row" data-testid="look-preview-samples" style={{ gap: 10, padding: 10, background: '#fff', flexWrap: 'wrap' }}>
          <span className="btn sm" style={{ background: preview['--gold'], color: 'var(--text)', borderColor: preview['--gold'] }}>A gold button</span>
          {' '}
          <span className="small" style={{ padding: '4px 8px', borderRadius: 6, background: preview['--navy'], color: preview['--gold'], fontWeight: 700 }}>🏆 2026</span>
        </div>
      </div>
      {!hideName && <label className="field"><span>Group name</span><input className="input" value={v.name} maxLength={40} onChange={(e) => set({ ...v, name: e.target.value })} /></label>}
      <label className="field"><span>Short name (on small screens, up to 12)</span><input className="input" value={v.short_name} maxLength={12} onChange={(e) => set({ ...v, short_name: e.target.value })} placeholder="e.g. L.G.C" /></label>
      <div className="stack" style={{ gap: 6 }}>
        <span className="label">Crest</span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="btn ghost sm" style={{ cursor: 'pointer' }}>Upload a crest<input type="file" accept="image/*" hidden onChange={(e) => pickCrest(e.target.files?.[0])} /></label>
          {v.crest_url && <button type="button" className="btn ghost sm" onClick={() => set({ ...v, crest_url: null })}>Use the plain crest</button>}
          {status.legacy && v.crest_url !== 'builtin:lgc' && <button type="button" className="btn ghost sm" onClick={() => set({ ...v, crest_url: 'builtin:lgc' })}>L.G.C crest</button>}
        </div>
        <span className="small muted">Square works best; it’s shrunk on the phone to 512 px before uploading.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="field"><span>Main colour</span><input type="color" value={v.primary} onChange={(e) => set({ ...v, primary: e.target.value.toUpperCase() })} style={{ width: '100%', height: 44, border: 0, background: 'none' }} /></label>
        <label className="field"><span>Accent colour</span><input type="color" value={v.accent} onChange={(e) => set({ ...v, accent: e.target.value.toUpperCase() })} style={{ width: '100%', height: 44, border: 0, background: 'none' }} /></label>
      </div>
      {problems.map((p) => <div key={p} className="err" style={{ margin: 0 }}>{p}</div>)}
      <label className="field"><span>Heading font</span>
        <select className="select" value={v.font} onChange={(e) => set({ ...v, font: e.target.value })}>
          {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </select>
      </label>
      <button type="button" className="btn gold block" disabled={busy || problems.length > 0 || v.name.trim().length < 2} onClick={save}>{onSaved ? 'Save and carry on' : 'Save the look'}</button>
    </div>
  );
}

const NOT_YET = /PGRST202|Could not find the function/i;
const notYet = (e) => NOT_YET.test(`${e?.code} ${e?.message}`);

/** Stage 9: your data — the privacy and terms drafts, leaving, deleting your account; organisers download or delete
 * the group. (Leaving and deleting need 041b on the database; until then they say "coming soon".) */
function YourData() {
  const { status, refresh } = useSession();
  const [busy, run] = useRun();
  const [removeName, setRemoveName] = useState(false);
  const [asking, setAsking] = useState(null);
  const [typed, setTyped] = useState('');
  const download = () => run(async () => {
    const { data, error } = await supabase.rpc('export_group');
    if (error) throw error;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(status.group_name || 'group').replace(/[^A-Za-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'Downloaded');
  const leave = () => run(async () => {
    const { error } = await supabase.rpc('leave_group', { p_group: status.group_id });
    if (error) throw notYet(error) ? new Error('Coming soon — Josh is switching this on.') : error;
    setCurrentGroup(null);
    await refresh?.();
    window.location.hash = '#/';
  }, 'You’ve left the group');
  const deleteAccount = () => run(async () => {
    const { error } = await supabase.rpc('delete_my_account', { p_remove_name: removeName });
    if (error) throw notYet(error) ? new Error('Coming soon — Josh is switching this on.') : error;
    try { Object.keys(localStorage).filter((k) => k.startsWith('lgc-')).forEach((k) => localStorage.removeItem(k)); } catch { /* fine */ }
    await supabase.auth.signOut().catch(() => {});
    window.location.hash = NEW_GROUPS ? '#/start' : '#/';
    window.location.reload();
  });
  const deleteGroup = () => run(async () => {
    const { error } = await supabase.rpc('delete_group', { p_group: status.group_id, p_confirm_name: typed });
    if (error) throw notYet(error) ? new Error('Coming soon — Josh is switching this on.') : error;
    setCurrentGroup(null);
    await refresh?.();
    window.location.hash = '#/';
  }, 'Group deleted');
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <strong>🔒 Your data</strong>
      <span className="small"><a href="#/privacy">Privacy</a> · <a href="#/terms">Terms</a> <span className="muted">(drafts)</span></span>
      {status.is_admin && (
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={download}>⬇️ Download our group’s data</button>
      )}
      {asking == null && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {!status.legacy && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setAsking('leave')}>Leave this group</button>}
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setAsking('account')}>Delete my account</button>
          {status.is_admin && !status.legacy && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setTyped(''); setAsking('group'); }}>Delete this group</button>}
        </div>
      )}
      {asking === 'leave' && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small">Leave {status.group_name}? Your scores stay in the group’s history; your location and notifications for this group are removed. You’d need a new invite to come back.</span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm" disabled={busy} onClick={leave}>Leave</button>
            <button type="button" className="btn ghost sm" onClick={() => setAsking(null)}>Cancel</button>
          </div>
        </div>
      )}
      {asking === 'account' && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small">Delete your account? You’ll leave every group you’re in and your sign-in is removed. Your scores stay in each group’s history. (If you’re the only organiser of a group, hand it over or delete it first.)</span>
          <label className="row small" style={{ gap: 8 }}>
            <input type="checkbox" checked={removeName} onChange={(e) => setRemoveName(e.target.checked)} style={{ width: 22, height: 22, flex: 'none' }} />
            Also take my name and selfie off the history — my profile, the honour board and the app’s own feed posts show “Former player”
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm" disabled={busy} onClick={deleteAccount}>Delete my account</button>
            <button type="button" className="btn ghost sm" onClick={() => setAsking(null)}>Cancel</button>
          </div>
        </div>
      )}
      {asking === 'group' && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small">Delete {status.group_name} for everyone? Every score, trip, plan, photo link and chat in it goes, and it can’t be undone. Download the group’s data first if you want a copy.</span>
          <label className="field"><span>Type the group’s name to delete it</span><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={status.group_name} /></label>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm" disabled={busy || typed.trim().toLowerCase() !== String(status.group_name || '').trim().toLowerCase()} onClick={deleteGroup}>Delete the group</button>
            <button type="button" className="btn ghost sm" onClick={() => setAsking(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
