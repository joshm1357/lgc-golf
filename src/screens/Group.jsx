// Group (More → Group & invites): switch between your groups, how you're signed in, and — for organisers —
// invite links with QR codes, and the people in the group with their roles.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, playerName } from '../lib/store.jsx';
import { Header, Avatar, Loading, toast } from '../components/ui.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { inviteLink, inviteCode, ROLE_LABEL, ROLE_HELP } from '../lib/invite.js';
import { SIGN_IN, linkProvider, linkEmail } from '../lib/auth.js';
import { shareText } from '../lib/push.js';
import { FEATURES, featureOn, children } from '../lib/features.js';
import { FONTS, DEFAULT_LOOK, LGC_LOOK, lookProblems, themeVars, applyLook } from '../lib/theme.js';
import { uploadPhoto } from '../lib/images.js';
import { GroupCrest } from '../components/Logo.jsx';
import { useRun, must } from '../lib/run.js';

export default function Group() {
  const { status } = useSession();
  return (
    <div className="page">
      <Header back title="Group & invites" sub={status.group_name} />
      <div className="section stack">
        <MyGroups />
        <SignInCard />
        {status.is_admin && <InviteCard role="player" />}
        {status.is_admin && <InviteCard role="guest" />}
        {status.is_admin && <Members />}
        {status.is_admin && <LookCard />}
        {status.is_admin && <FeaturesCard />}
        {status.is_admin && status.legacy && <AdminPinCard />}
        <JoinAnother />
        {!status.is_admin && <div className="small muted">You’re a {ROLE_LABEL[status.role] || 'member'} here — {ROLE_HELP[status.role] || ''} Ask an organiser for an invite link to bring someone in.</div>}
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

function SignInCard() {
  const { status } = useSession();
  const [email, setEmail] = useState('');
  const [busy, run] = useRun();
  if (status.signed_in) return <div className="small muted">✅ You’re signed in properly — you can use this account on any phone.</div>;
  if (!SIGN_IN.length) return null; // providers not set up yet
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--gold)' }}>
      <strong>🔐 Keep your scores if you change phones</strong>
      <span className="small">Right now you’re only signed in on this phone. Add a sign-in and everything stays with you — same name, same scores.</span>
      {SIGN_IN.includes('google') && <button type="button" className="btn block" disabled={busy} onClick={() => run(() => linkProvider('google'))}>Add Google sign-in</button>}
      {SIGN_IN.includes('facebook') && <button type="button" className="btn block" disabled={busy} onClick={() => run(() => linkProvider('facebook'))}>Add Facebook sign-in</button>}
      {SIGN_IN.includes('email') && (
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); run(() => linkEmail(email), 'Check your email to confirm'); }}>
          <input className="input grow" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" />
          <button className="btn" disabled={busy || !email.includes('@')}>Add email</button>
        </form>
      )}
    </div>
  );
}

function InviteCard({ role }) {
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
            <button type="button" className="btn gold sm" onClick={async () => {
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
  const named = new Set(rows.map((r) => r.player_id).filter(Boolean));
  const freeNames = data.players.filter((p) => p.approved !== false && !named.has(p.id)).sort((a, b) => playerName(a).localeCompare(playerName(b)));
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
  return (
    <div className="card">
      <div className="label" style={{ padding: '12px 14px 4px' }}>People in the group · {rows.length}</div>
      {rows.map((r) => {
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
      })}
      <div className="small muted" style={{ padding: '8px 14px 12px' }}>{Object.entries(ROLE_HELP).map(([k, h]) => `${ROLE_LABEL[k]}: ${h}`).join(' ')}</div>
    </div>
  );
}

/** L.G.C's old admin PIN: an organiser switches it off once everyone who should be an organiser is one. */
function AdminPinCard() {
  const [busy, run] = useRun();
  const [off, setOff] = useState(false);
  if (off) return <div className="small muted">🔑 The admin PIN is off. New organisers are made here.</div>;
  return (
    <div className="card pad stack" style={{ gap: 6 }}>
      <strong>🔑 Admin PIN</strong>
      <span className="small muted">Anyone with L.G.C’s admin PIN can make themselves an organiser. Once your organisers are set up here, switch it off.</span>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => {
        if (window.confirm('Switch the admin PIN off? Organisers are then only made here. (An organiser can set a new PIN in Admin → Change PINs.)')) run(async () => { await must(supabase.rpc('turn_off_admin_pin')); setOff(true); }, 'Admin PIN off');
      }}>Switch the admin PIN off</button>
    </div>
  );
}

/** Join another group by pasting its invite link (iPhone Home Screen apps can't open links from chats). */
function JoinAnother() {
  const [text, setText] = useState('');
  const code = inviteCode(text);
  return (
    <form className="card pad stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (code) window.location.hash = `#/join/${code}`; }}>
      <strong>➕ Join another group</strong>
      <span className="small muted">Paste the invite link someone sent you.</span>
      <div className="row" style={{ gap: 6 }}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://…/#/join/…" autoCapitalize="none" />
        <button className="btn" disabled={!code}>Open</button>
      </div>
    </form>
  );
}

/** Features: one switch each. A feature that needs another is greyed out while that one is off. Applies to everyone
 *  in the group straight away (the database refuses writes to a switched-off feature, so it can't be got around). */
function FeaturesCard() {
  const data = useData();
  const [busy, run] = useRun();
  const settings = data.features || {};
  const flip = (f, on) => {
    const kids = children(f.key).filter((k) => featureOn(k, settings));
    if (!on && kids.length && !window.confirm(`Switching off ${f.name} also switches off: ${kids.map((k) => FEATURES.find((x) => x.key === k).name).join(', ')}. Go ahead?`)) return;
    run(() => must(supabase.rpc('set_feature', { p_key: f.key, p_on: on })), on ? `${f.name} on` : `${f.name} off`);
  };
  return (
    <div className="card">
      <div style={{ padding: '12px 14px 4px' }}>
        <div className="label">Features</div>
        <div className="small muted">Switch off what your group doesn’t use — it disappears for everyone. History stays.</div>
      </div>
      {FEATURES.map((f) => {
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
          <label key={f.key} className="row" style={{ gap: 10, padding: '10px 14px', paddingLeft: f.parent ? 34 : 14, borderTop: '1px solid var(--line-soft)', opacity: parentOff ? 0.5 : 1 }}>
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
function LookCard() {
  const { status, refresh } = useSession();
  const start = status.look || (status.legacy === false ? DEFAULT_LOOK : LGC_LOOK);
  const [v, set] = useState(() => ({ name: status.group_name || '', short_name: start.short_name || '', primary: start.primary, accent: start.accent, font: start.font, crest_url: start.crest_url }));
  const [busy, run] = useRun();
  const problems = lookProblems(v);
  const preview = themeVars(v);
  const pickCrest = (file) => file && run(async () => {
    const url = await uploadPhoto(file, 'crest', { maxDim: 512, square: true, quality: 0.85 });
    set((x) => ({ ...x, crest_url: url }));
  }, 'Crest ready — save to use it');
  const save = () => run(async () => {
    await must(supabase.rpc('set_group_look', { p_name: v.name, p_short_name: v.short_name || null, p_primary: v.primary, p_accent: v.accent, p_font: v.font, p_crest_url: v.crest_url || null }));
    applyLook({ short_name: v.short_name || null, crest_url: v.crest_url || null, primary: v.primary, accent: v.accent, font: v.font });
    await refresh();
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
        <div style={{ padding: 10, background: '#fff' }}>
          <span className="btn sm" style={{ background: preview['--gold'], color: preview['--navy'], borderColor: preview['--gold'] }}>A gold button</span>
        </div>
      </div>
      <label className="field"><span>Group name</span><input className="input" value={v.name} maxLength={40} onChange={(e) => set({ ...v, name: e.target.value })} /></label>
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
      <button type="button" className="btn gold block" disabled={busy || problems.length > 0 || v.name.trim().length < 2} onClick={save}>Save the look</button>
    </div>
  );
}
