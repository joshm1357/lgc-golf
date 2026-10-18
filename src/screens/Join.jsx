import React, { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useSession } from '../lib/store.jsx';
import { setCurrentGroup } from '../lib/group.js';
import { Crest } from '../components/Logo.jsx';

export default function Join() {
  const { refresh } = useSession();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      }
      // join_group_id says which group the PIN opened, so the app shows that group.
      let { data, error } = await supabase.rpc('join_group_id', { p_pin: pin });
      if (error && /join_group_id/.test(error.message || '')) ({ data, error } = await supabase.rpc('join_group', { p_pin: pin }));
      if (error) throw error;
      if (!data) {
        setErr("That PIN's not right. Check the group chat.");
        return;
      }
      if (typeof data === 'string') setCurrentGroup(data);
      await refresh();
    } catch (e2) {
      setErr(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 }}>
      <Crest size={170} />
      <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 700 }}>L.G.C Golf</div>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field">
          <span style={{ color: 'var(--on-navy-muted)' }}>Group PIN</span>
          <input
            className="input" inputMode="numeric" autoComplete="one-time-code" value={pin}
            onChange={(e) => setPin(e.target.value)} placeholder="From the group chat"
            style={{ fontSize: 24, textAlign: 'center', letterSpacing: '.3em', color: 'var(--text)' }}
          />
        </label>
        {err && <div className="err" style={{ color: '#FFB4AB' }}>{err}</div>}
        <button className="btn gold block" disabled={busy || pin.length < 4}>{busy ? 'Checking…' : "Let's go"}</button>
      </form>
    </div>
  );
}
