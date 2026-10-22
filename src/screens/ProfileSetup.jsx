import React, { useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useSession, playerName } from '../lib/store.jsx';
import { uploadPhoto } from '../lib/images.js';
import { Avatar, Icon, Loading, PhotoButtons, Sheet, toast } from '../components/ui.jsx';
import { QuickJoin } from './QuickRound.jsx';

function PhotoCircle({ preview, player }) {
  return (
    <div style={{ width: 112, height: 112, borderRadius: '50%', border: '2px dashed #8A96A6', background: '#F2F4F6', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
      {preview ? <img src={preview} alt="Your photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : player?.avatar_url ? <img src={player.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : Icon.camera(34)}
    </div>
  );
}

/** First time in: pick your name from the list. Anyone not on it can add themselves — the admin approves them. */
export default function ProfileSetup() {
  const { status } = useSession();
  // A quick round: just a name, no list to pick from, no waiting for approval.
  if (status?.quick) return <QuickJoin />;
  return <PickOrAdd />;
}

function PickOrAdd() {
  const { refresh, status } = useSession();
  // Names someone else has already picked (only an organiser can free one).
  const [taken, setTaken] = useState(new Set());
  useEffect(() => {
    if (!status?.group_id) return;
    supabase.from('group_members').select('player_id').eq('group_id', status.group_id).not('player_id', 'is', null)
      .then(({ data: rows }) => setTaken(new Set((rows || []).map((r) => r.player_id))));
  }, [status?.group_id]);
  const data = useData();
  // Guests add themselves; an organiser can link them to an existing name.
  const [mode, setMode] = useState(() => (status?.role === 'guest' ? 'new' : 'pick'));
  const [chosen, setChosen] = useState(null);
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [hcp, setHcp] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  if (!data.ready) return <Loading />;
  const players = data.players.filter((p) => p.approved !== false).sort((a, b) => a.name.localeCompare(b.name));

  async function upload() {
    if (!file) return null;
    try {
      return await uploadPhoto(file, 'avatars', { maxDim: 400, square: true, quality: 0.85 });
    } catch (e3) {
      toast(`Photo didn't upload (${friendlyError(e3)}) — add it later from your profile.`);
      return null;
    }
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const url = await upload();
      const { error } = await supabase.rpc('create_my_player', { p_name: name, p_nickname: nickname, p_handicap: Number(hcp), p_avatar_url: url });
      if (error) throw error;
      await data.reload();
      await refresh();
    } catch (e2) {
      setErr(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    setBusy(true);
    setErr('');
    try {
      const { error } = await supabase.rpc('claim_player', { p_player_id: chosen.id });
      if (error) throw error;
      const url = await upload();
      if (url) {
        const { error: e2 } = await supabase.from('players').update({ avatar_url: url }).eq('id', chosen.id);
        if (e2) toast(friendlyError(e2));
      }
      await data.reload();
      await refresh();
    } catch (e2) {
      setErr(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="hdr">
        <div className="hdr-title">{mode === 'pick' ? 'Who are you?' : 'Add yourself'}</div>
        <div className="hdr-sub">{mode === 'pick' ? 'Tap your name. Your photo becomes your icon on every leaderboard, post and map pin.' : "Not on the list? Add yourself — the admin will approve you."}</div>
      </header>
      <div className="section stack" style={{ paddingBottom: 24 }}>
        {mode === 'pick' ? (
          <>
            <div className="card">
              {players.map((p) => (
                <button key={p.id} type="button" className="lb-row" style={{ gridTemplateColumns: '40px 1fr auto' }} onClick={() => { setChosen(p); setFile(null); setErr(''); }}>
                  <Avatar player={p} size={36} />
                  <span className="lb-name">{p.name}{p.nickname ? <span className="muted small"> · {p.nickname}</span> : null}</span>
                  {taken.has(p.id) ? <span className="small muted">taken</span> : <span className="muted">{Icon.next()}</span>}
                </button>
              ))}
              {!players.length && <div className="empty">Nobody on the list yet.</div>}
            </div>
            <button type="button" className="btn ghost block" onClick={() => setMode('new')}>I'm not on the list</button>
            <span className="small muted" style={{ textAlign: 'center' }}>Got a personal link from your organiser? Tap it in your messages instead — it opens the app as you.</span>
          </>
        ) : (
          <form className="card pad stack" onSubmit={create}>
            <PhotoCircle preview={preview} />
            <PhotoButtons onPick={setFile} facing="user" cameraLabel="Take a selfie" libraryLabel="Choose photo" />
            <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" required /></label>
            <label className="field"><span>Nickname (optional)</span><input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="What the lads call you" /></label>
            <label className="field">
              <span>Starting handicap</span>
              <input className="input" inputMode="decimal" value={hcp} onChange={(e) => setHcp(e.target.value)} placeholder="e.g. 14" required />
            </label>
            <div className="sync" style={{ margin: 0 }}>The admin needs to approve new people before you can join in.</div>
            {err && <div className="err">{err}</div>}
            <div className="row">
              {status?.role !== 'guest' && <button type="button" className="btn ghost grow" onClick={() => setMode('pick')}>Back to the list</button>}
              <button className="btn gold grow" disabled={busy || !name || hcp === '' || Number.isNaN(Number(hcp))}>{busy ? 'Sending…' : 'Ask to join'}</button>
            </div>
          </form>
        )}
      </div>

      {chosen && (
        <Sheet title={`You're ${playerName(chosen)}?`} onClose={() => setChosen(null)}>
          <div className="stack">
            <PhotoCircle preview={preview} player={chosen} />
            <PhotoButtons onPick={setFile} facing="user" cameraLabel={chosen.avatar_url ? 'New selfie' : 'Take a selfie'} libraryLabel="Choose photo" />
            <span className="small muted" style={{ textAlign: 'center' }}>Optional — you can add or change your photo later.</span>
            {err && <div className="err">{err}</div>}
            <button type="button" className="btn gold block" disabled={busy} onClick={claim}>{busy ? 'Saving…' : `Yes, I'm ${playerName(chosen)}`}</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Shown to someone who added themselves until the admin approves them. */
export function AwaitingApproval({ player }) {
  const { refresh } = useSession();
  const data = useData();
  const [pickInstead, setPickInstead] = useState(false);
  if (pickInstead) return <ProfileSetup />;
  return (
    <div className="app" style={{ minHeight: '100vh' }}>
      <header className="hdr"><div className="hdr-title">Nearly there</div><div className="hdr-sub">Waiting for the admin to approve you</div></header>
      <div className="section stack" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 30 }}>
        <Avatar player={player} size={96} />
        <div style={{ fontSize: 20, fontWeight: 700 }}>{player.name}</div>
        <p className="muted" style={{ lineHeight: 1.5, maxWidth: 320 }}>The admin has been told you're here. This screen opens up by itself once you're approved.</p>
        <button type="button" className="btn ghost" onClick={async () => { await data.reload(); await refresh(); }}>Check again</button>
        <button type="button" className="btn ghost" onClick={() => setPickInstead(true)}>Actually, I'm on the list</button>
      </div>
    </div>
  );
}
