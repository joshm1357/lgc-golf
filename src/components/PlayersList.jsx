// The players list (ov15, 22 Oct 2026) — the top of Players & group. Josh: "There should be a group list that has the
// players, handicaps (only editable by admin, but disputable)."
//   * everyone: name, nickname, photo, handicap and when it last changed, role, on the app ✓;
//   * organisers also see signed in ✓, and change a handicap in place (same write as the players table — the
//     database checks it's an organiser and records the change in the handicap history);
//   * everyone else taps a handicap → the rule sheet → "⚖️ Dispute this" (players.handicap, migration 087). An
//     upheld verdict is applied by an organiser from the case (apply_dispute_verdict).
//   * tap a name → their card: handicap history, profile link; for organisers, a player not on the app can be given
//     an email for trip votes. Nobody's email address is ever shown here.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useRealtime, useFeature, playerName } from '../lib/store.jsx';
import { Avatar, toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { readHandicap } from '../lib/history.js';
import { ROLE_LABEL } from '../lib/invite.js';
import { isEmail, cleanEmail } from '../lib/emailvotes.js';
import RuleTag from './RuleTag.jsx';

const showHcp = (h) => (h == null ? '–' : Number(h) < 0 ? `+${-Number(h)}` : String(Number(h)));
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' }) : '');
const NOT_YET = /PGRST202|Could not find the function/i;

/** The players list. */
export default function PlayersList() {
  const data = useData();
  const { status } = useSession();
  const admin = !!status?.is_admin && !status?.viewing;
  const tasksOn = useFeature('planner_tasks');
  const [busy, run] = useRun();
  const [members, setMembers] = useState([]);
  const [signIns, setSignIns] = useState({});
  const [channels, setChannels] = useState({});
  const [history, setHistory] = useState([]);
  const [edit, setEdit] = useState(null); // { id, value }
  const [open, setOpen] = useState(null); // player id whose card is open

  const loadHistory = useCallback(async () => {
    const { data: rows, error } = await supabase.from('handicap_history').select('id, player_id, old_handicap, new_handicap, reason, created_at').order('created_at', { ascending: false });
    if (!error) setHistory(rows || []);
  }, []);
  const loadPeople = useCallback(async () => {
    const { data: m } = await supabase.from('group_members').select('user_id,player_id,role').eq('group_id', status.group_id);
    setMembers(m || []);
    if (!admin) return;
    const { data: s, error } = await supabase.rpc('player_sign_ins');
    if (!error) setSignIns(Object.fromEntries((s || []).map((r) => [r.player_id, r])));
    if (tasksOn) {
      const { data: c, error: e2 } = await supabase.rpc('vote_channels');
      if (!e2) setChannels(Object.fromEntries((c || []).map((r) => [r.player_id, r])));
    }
  }, [status.group_id, admin, tasksOn]);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { loadPeople().catch(() => {}); }, [loadPeople]);
  useRealtime(['handicap_history'], loadHistory);

  const lastOf = useMemo(() => {
    const m = {};
    for (const h of history) if (!m[h.player_id]) m[h.player_id] = h;
    return m;
  }, [history]);
  const roleOf = useMemo(() => {
    const order = { organiser: 1, player: 2, guest: 3 };
    const m = {};
    for (const r of members) if (r.player_id && (!m[r.player_id] || order[r.role] < order[m[r.player_id]])) m[r.player_id] = r.role;
    return m;
  }, [members]);
  const players = data.players.filter((p) => p.approved !== false).sort((a, b) => playerName(a).localeCompare(playerName(b)));

  const saveHcp = () => {
    const e = edit;
    setEdit(null);
    if (!e) return;
    const p = players.find((x) => x.id === e.id);
    const h = readHandicap(e.value);
    if (h == null) { if (String(e.value).trim()) toast('A handicap is a number from −10 to 54 (write a plus handicap as +2)'); return; }
    if (h === Number(p.handicap)) return;
    run(async () => { await must(supabase.from('players').update({ handicap: h }).eq('id', p.id)); await data.reload(); await loadHistory(); }, `${playerName(p)}: ${showHcp(h)}`);
  };

  return (
    <div className="card" data-testid="players-list">
      <div style={{ padding: '12px 14px 6px' }}>
        <div className="row between" style={{ gap: 8 }}>
          <strong>Players · {players.length}</strong>
          {admin && <Link to="/group/players" className="small" style={{ fontWeight: 700 }} data-testid="players-table-link">Full table →</Link>}
        </div>
        <div className="small muted">{admin
          ? 'Tap a handicap to change it. Tap a name for their card.'
          : 'Handicaps are set by an organiser. Think one’s wrong? Tap it to dispute it.'}</div>
      </div>
      {players.map((p) => {
        const role = roleOf[p.id];
        const onApp = !!role;
        const signedIn = signIns[p.id]?.signed_in;
        const last = lastOf[p.id];
        const name = playerName(p);
        return (
          <div key={p.id} style={{ borderTop: '1px solid var(--line-soft)' }}>
            <div className="row" style={{ gap: 10, padding: '8px 14px', alignItems: 'center', minHeight: 56 }}>
              <Avatar player={p} size={38} />
              <button type="button" className="grow" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}
                style={{ minWidth: 0, border: 0, background: 'none', padding: 0, textAlign: 'left', color: 'inherit', font: 'inherit', minHeight: 44 }}>
                <strong className="ellipsis" style={{ display: 'block' }}>{p.name}{p.id === status.player_id ? ' (you)' : ''}</strong>
                <span className="small muted" style={{ display: 'block' }}>
                  {[p.nickname ? `“${p.nickname}”` : null, role ? ROLE_LABEL[role] : null, onApp ? 'on the app ✓' : 'not on the app', admin && signedIn ? 'signed in ✓' : null].filter(Boolean).join(' · ')}
                </span>
              </button>
              <span style={{ textAlign: 'right', flex: 'none', minWidth: 64 }}>
                {edit?.id === p.id ? (
                  <input className="input" autoFocus value={edit.value} aria-label={`${p.name} handicap`} inputMode="decimal"
                    style={{ width: 72, minHeight: 44, textAlign: 'right', fontSize: 18 }}
                    onChange={(e) => setEdit({ ...edit, value: e.target.value })} onBlur={saveHcp}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveHcp(); } if (e.key === 'Escape') { e.stopPropagation(); setEdit(null); } }} />
                ) : admin ? (
                  <button type="button" className="btn ghost sm num" style={{ minWidth: 64, minHeight: 44, fontSize: 20 }} disabled={busy}
                    aria-label={`Change ${p.name}’s handicap (${showHcp(p.handicap)})`} onClick={() => setEdit({ id: p.id, value: showHcp(p.handicap) })}>{showHcp(p.handicap)}</button>
                ) : (
                  <span className="num" style={{ fontSize: 22 }}>
                    <RuleTag testId="hcp-tag" rule={{ table: 'players', id: p.id, field: 'handicap', label: `${name}’s handicap`, value: Number(p.handicap), where: { path: '/group' } }}
                      explain="Handicaps are set by an organiser. If you think one’s wrong, dispute it: the group decides at the Tribunal, and if the verdict says change it, an organiser applies it.">
                      {showHcp(p.handicap)}
                    </RuleTag>
                  </span>
                )}
                {last && <span className="small muted" style={{ display: 'block' }}>{day(last.created_at)}</span>}
              </span>
            </div>
            {open === p.id && <PlayerCard player={p} history={history.filter((h) => h.player_id === p.id)} admin={admin} onApp={onApp}
              channel={channels[p.id]} onChanged={() => loadPeople().catch(() => {})} />}
          </div>
        );
      })}
      {!players.length && <div className="small muted" style={{ padding: '4px 14px 12px' }}>No players yet.</div>}
    </div>
  );
}

/** A player's card: handicap history, their profile; for organisers, a vote email for someone not on the app. */
function PlayerCard({ player, history, admin, onApp, channel, onChanged }) {
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, run] = useRun();
  const name = playerName(player);
  const save = (e) => run(async () => {
    const { error } = await supabase.rpc('set_invited_vote_email', { p_player: player.id, p_email: e });
    if (error) throw NOT_YET.test(`${error.code} ${error.message}`) ? new Error('Votes by email aren’t switched on yet') : error;
    setAdding(false); setDraft(''); onChanged();
  }, e ? 'Email added' : 'Email removed');
  return (
    <div className="stack" data-testid="player-card" style={{ gap: 8, padding: '4px 14px 14px 62px' }}>
      <div className="small">
        <strong>Handicap history</strong>
        {history.length ? history.slice(0, 4).map((h) => (
          <div key={h.id} className="row between" style={{ gap: 8 }}>
            <span>{h.old_handicap == null ? '' : `${showHcp(h.old_handicap)} → `}<strong>{showHcp(h.new_handicap)}</strong> · {h.reason}</span>
            <span className="muted">{day(h.created_at)}</span>
          </div>
        )) : <div className="muted">No changes recorded.</div>}
      </div>
      {admin && !onApp && channel && (
        <div className="small stack" style={{ gap: 6 }}>
          <span><strong>Trip votes by email:</strong> {channel.has_email ? '✓ has an email' : 'no email yet'}</span>
          {adding ? (
            <div className="row" style={{ gap: 6 }}>
              <input className="input grow" type="email" inputMode="email" placeholder="their@email.com" aria-label={`${name}'s email`} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button type="button" className="btn sm" disabled={busy || !isEmail(draft)} onClick={() => save(cleanEmail(draft))}>Save</button>
              <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          ) : (
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setAdding(true)}>{channel.has_email ? 'Change email' : 'Add an email'}</button>
              {channel.has_email && channel.source === 'invited' && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => save('')}>Remove it</button>}
            </div>
          )}
          <span className="muted">Only used for trip votes. The address isn’t shown to anyone.</span>
        </div>
      )}
      <Link to={`/player/${player.id}`} className="small" style={{ fontWeight: 700 }}>{name}’s profile →</Link>
    </div>
  );
}
