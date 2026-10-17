import React, { useRef, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useSession } from '../lib/store.jsx';
import { uploadPhoto } from '../lib/images.js';
import { Avatar, Icon, Loading } from '../components/ui.jsx';

/** First time in: pick yourself from the list, or set up a new profile. */
export default function ProfileSetup() {
  const { refresh } = useSession();
  const data = useData();
  const [mode, setMode] = useState('new');
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [hcp, setHcp] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef();

  if (!data.ready) return <Loading />;
  const players = [...data.players].sort((a, b) => a.name.localeCompare(b.name));

  function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      let url = null;
      if (file) url = await uploadPhoto(file, 'avatars', { maxDim: 400, square: true, quality: 0.85 });
      const { error } = await supabase.rpc('create_my_player', {
        p_name: name, p_nickname: nickname, p_handicap: Number(hcp), p_avatar_url: url,
      });
      if (error) throw error;
      await data.reload();
      await refresh();
    } catch (e2) {
      setErr(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  }

  async function claim(p) {
    setBusy(true);
    setErr('');
    const { error } = await supabase.rpc('claim_player', { p_player_id: p.id });
    if (error) setErr(friendlyError(error));
    else await refresh();
    setBusy(false);
  }

  return (
    <div className="app">
      <header className="hdr">
        <div className="hdr-title">Set up your profile</div>
        <div className="hdr-sub">Your photo is your icon on every leaderboard, post and map pin.</div>
      </header>
      <div className="section stack">
        {players.length > 0 && (
          <div className="seg light" role="group">
            <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>I'm new</button>
            <button type="button" aria-pressed={mode === 'pick'} onClick={() => setMode('pick')}>I'm already on the list</button>
          </div>
        )}

        {mode === 'pick' ? (
          <div className="card">
            {players.map((p) => (
              <button key={p.id} type="button" className="lb-row" style={{ gridTemplateColumns: '40px 1fr auto' }} onClick={() => claim(p)} disabled={busy}>
                <Avatar player={p} size={36} />
                <span className="lb-name">{p.name}{p.nickname ? <span className="muted small"> · {p.nickname}</span> : null}</span>
                <span className="muted small">That's me</span>
              </button>
            ))}
          </div>
        ) : (
          <form className="card pad stack" onSubmit={create}>
            <div className="row" style={{ justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
              <button type="button" onClick={() => fileRef.current.click()} aria-label="Add a photo" style={{ width: 112, height: 112, borderRadius: '50%', border: '2px dashed #8A96A6', background: '#F2F4F6', overflow: 'hidden', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {preview ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : Icon.camera(34)}
              </button>
              <span className="small muted">Tap to take a selfie or pick a photo</span>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
            </div>
            <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mike Morris" required /></label>
            <label className="field"><span>Nickname (optional)</span><input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="What the lads call you" /></label>
            <label className="field">
              <span>Starting handicap</span>
              <input className="input" inputMode="decimal" value={hcp} onChange={(e) => setHcp(e.target.value)} placeholder="e.g. 14" required />
              <span className="small muted" style={{ fontWeight: 400 }}>You set this once. After that it only changes through the admin or the Tribunal.</span>
            </label>
            {err && <div className="err">{err}</div>}
            <button className="btn gold block" disabled={busy || !name || hcp === '' || Number.isNaN(Number(hcp))}>{busy ? 'Saving…' : "I'm in"}</button>
          </form>
        )}
        {mode === 'pick' && err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
