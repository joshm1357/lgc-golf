// Votes by email (079): the choice of how you get votes and trip questions (Notifications), the group's default and
// emails for people not on the app yet (Group & invites, organisers), and the "answered by email" line on a vote card.
// Everything hides itself on an older database without 079.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, playerName } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { currentGroup } from '../lib/group.js';
import { previewOf } from '../lib/preview.js';
import { CHANNELS, CHANNEL_LABEL, CHANNEL_HELP, isEmail, cleanEmail, answeredByEmail, emailAnswerLine, channelSummary } from '../lib/emailvotes.js';

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney'; } catch { return 'Australia/Sydney'; } };

function ChannelPicker({ value, onPick, busy, name, extra }) {
  return (
    <div className="stack" style={{ gap: 6 }} role="radiogroup" aria-label={name}>
      {CHANNELS.map((c) => (
        <button key={c} type="button" className="chip" role="radio" aria-checked={value === c} aria-pressed={value === c} disabled={busy}
          data-channel={c} style={{ textAlign: 'left', whiteSpace: 'normal', minHeight: 48, display: 'block' }} onClick={() => onPick(c)}>
          <strong>{value === c ? '● ' : '○ '}{CHANNEL_LABEL[c]}</strong>{extra?.(c)}<div className="small muted" style={value === c ? { color: 'inherit', opacity: 0.85 } : undefined}>{CHANNEL_HELP[c]}</div>
        </button>
      ))}
    </div>
  );
}

/** Notifications screen: "How do you want votes and trip questions?" and the address emails go to. */
export function VoteChannelCard() {
  const { status } = useSession();
  const tasksOn = useFeature('planner_tasks');
  const [me, setMe] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, run] = useRun();
  const g = currentGroup() || status?.group_id;
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_vote_email');
    if (error) { setMe(false); return; } // older database: no vote emails yet
    const row = (Array.isArray(data) ? data[0] : data) || {};
    setMe(row);
    setDraft('');
  }, []);
  useEffect(() => { load(); }, [load, g]);
  if (previewOf() || !tasksOn || !me || !status?.player_id) return null;
  const groupDefault = me.group_default || 'app';
  const choice = me.vote_channel || groupDefault;
  const pick = (c) => run(async () => {
    // Picking the group's own default goes back to "follow the group" (so a later change by the organiser applies).
    await must(supabase.from('notify_prefs').upsert({ group_id: g, vote_channel: c === groupDefault ? null : c, tz: tz(), updated_at: new Date().toISOString() }, { onConflict: 'group_id,user_id' }));
    await load();
  }, 'Saved');
  const saveEmail = (e) => run(async () => { await must(supabase.rpc('set_my_vote_email', { p_email: e })); await load(); }, e ? 'Email saved' : 'Email removed');
  const needsEmail = choice !== 'app' && !me.email;
  return (
    <div className="card pad stack" style={{ gap: 10 }} data-testid="vote-channel-card">
      <strong>🗳️ How do you want votes and trip questions?</strong>
      <ChannelPicker value={choice} onPick={pick} busy={busy} name="How you get votes"
        extra={(c) => (c === groupDefault ? <span className="small muted" style={{ fontWeight: 600 }}> · your group’s choice</span> : null)} />
      {needsEmail && <div className="small" style={{ color: '#7A5A00', fontWeight: 700 }}>Add your email below — until then, votes come in the app.</div>}
      <span className="label">Email for trip votes</span>
      {me.email ? (
        <div className="stack" style={{ gap: 6 }}>
          <div className="small">Votes go to <strong>{me.email}</strong>{me.source === 'invited' ? ' (an organiser added it for trip emails)' : ''}.</div>
          <div className="small muted">Only you can see it. It’s used for trip votes, nothing else.</div>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => saveEmail('')}>Remove my email</button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {me.signin_email && (
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => saveEmail(me.signin_email)}>Use {me.signin_email}</button>
          )}
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" aria-label="Your email for trip votes"
              value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="button" className="btn sm" disabled={busy || !isEmail(draft)} onClick={() => saveEmail(cleanEmail(draft))}>Save</button>
          </div>
          <div className="small muted">Only you can see it — not other players or organisers. Used for trip votes only.</div>
        </div>
      )}
    </div>
  );
}

/** Group & invites (organisers): the group's default, and emails for people who aren't on the app yet. */
export function GroupVoteEmailCard() {
  const { status } = useSession();
  const data = useData();
  const tasksOn = useFeature('planner_tasks');
  const [def, setDef] = useState(null);
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, run] = useRun();
  const load = useCallback(async () => {
    const [{ data: gr, error: e1 }, { data: ch, error: e2 }] = await Promise.all([
      supabase.from('groups').select('vote_channel').eq('id', status.group_id).maybeSingle(),
      supabase.rpc('vote_channels'),
    ]);
    if (e1 || e2) { setDef(false); return; }
    setDef(gr?.vote_channel || 'app');
    setRows(ch || []);
  }, [status.group_id]);
  useEffect(() => { load(); }, [load]);
  if (!status.is_admin || !tasksOn || !def || !rows) return null;
  const sum = channelSummary(rows);
  const names = (ids) => ids.map((id) => playerName(data.playersById[id])).filter(Boolean).join(', ');
  const offApp = rows.filter((r) => !r.on_app).sort((a, b) => playerName(data.playersById[a.player_id]).localeCompare(playerName(data.playersById[b.player_id])));
  const saveInvite = (pid, e) => run(async () => {
    await must(supabase.rpc('set_invited_vote_email', { p_player: pid, p_email: e }));
    setEditing(null); setDraft(''); await load();
  }, e ? 'Email added' : 'Email removed');
  return (
    <div className="card pad stack" style={{ gap: 10 }} data-testid="group-vote-email">
      <strong>🗳️ Votes by email</strong>
      <div className="small muted">How your group gets votes and trip questions, unless someone picks for themselves in Notifications.</div>
      <ChannelPicker value={def} busy={busy} name="Group default for votes"
        onPick={(c) => run(async () => { await must(supabase.rpc('set_vote_channel', { p_group: status.group_id, p_value: c })); await load(); }, 'Saved')} />
      <div className="small" data-testid="channel-summary">
        {sum.email.length > 0 && <div><strong>📧 Email:</strong> {names(sum.email)}</div>}
        {sum.both.length > 0 && <div><strong>📧+🔔 Both:</strong> {names(sum.both)}</div>}
        {sum.app.length > 0 && <div><strong>🔔 App:</strong> {names(sum.app)}</div>}
        {sum.none.length > 0 && <div className="muted"><strong>Not reached:</strong> {names(sum.none)} — not on the app and no email.</div>}
      </div>
      {offApp.length > 0 && (
        <>
          <span className="label">Not on the app yet</span>
          <div className="small muted">Type in their email and they’ll get trip votes by email with one-tap answers. Only used for trip emails; they can remove it.</div>
          {offApp.map((r) => {
            const p = data.playersById[r.player_id];
            return (
              <div key={r.player_id} className="stack" style={{ gap: 6, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
                <div className="row between" style={{ gap: 8, alignItems: 'center' }}>
                  <span><strong>{playerName(p)}</strong>{r.has_email && <span className="small muted"> · {r.email_hint}</span>}</span>
                  {editing !== r.player_id && (
                    <span className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setEditing(r.player_id); setDraft(''); }}>{r.has_email ? 'Change' : 'Add email'}</button>
                      {r.has_email && r.source === 'invited' && <button type="button" className="btn ghost sm" disabled={busy} aria-label={`Remove ${playerName(p)}'s email`} onClick={() => saveInvite(r.player_id, '')}>✕</button>}
                    </span>
                  )}
                </div>
                {editing === r.player_id && (
                  <div className="row" style={{ gap: 6 }}>
                    <input className="input grow" type="email" inputMode="email" placeholder="their@email.com" aria-label={`${playerName(p)}'s email`} value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <button type="button" className="btn sm" disabled={busy || !isEmail(draft)} onClick={() => saveInvite(r.player_id, cleanEmail(draft))}>Save</button>
                    <button type="button" className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// One lookup for every vote card on the screen (organisers only).
let channelsCache = null;
function useChannels(isAdmin) {
  const [rows, setRows] = useState(channelsCache?.rows || null);
  useEffect(() => {
    if (!isAdmin) return undefined;
    let live = true;
    if (!channelsCache || Date.now() - channelsCache.at > 60000) {
      channelsCache = { at: Date.now(), rows: null, p: supabase.rpc('vote_channels').then(({ data, error }) => (error ? [] : data || []), () => []) };
    }
    channelsCache.p.then((r) => { channelsCache.rows = r; if (live) setRows(r); });
    return () => { live = false; };
  }, [isAdmin]);
  return rows;
}

/** On a vote card: "📧 3 people answered by email", and for organisers who's on email. */
export function EmailVoteLine({ poll, pd }) {
  const { status } = useSession();
  const data = useData();
  const rows = useChannels(status.is_admin && poll.status === 'open');
  const n = answeredByEmail(pd.votes || [], poll.id);
  const sum = rows ? channelSummary(rows) : null;
  const onEmail = sum ? [...sum.email, ...sum.both] : [];
  if (!n && !onEmail.length) return null;
  return (
    <div className="small" data-testid="email-vote-line">
      {n > 0 && <div style={{ fontWeight: 700 }}>{emailAnswerLine(n)}</div>}
      {status.is_admin && poll.status === 'open' && onEmail.length > 0 && (
        <div className="muted">Getting this by email: {onEmail.map((id) => playerName(data.playersById[id])).filter(Boolean).join(', ')}</div>
      )}
    </div>
  );
}
