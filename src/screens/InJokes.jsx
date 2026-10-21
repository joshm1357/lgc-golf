// In-jokes (migration 058, feature 'in_jokes'): the group's running jokes and nicknames. Anyone adds one; whoever
// added it (or an organiser) edits or retires it. Award moments and round replays pick from these with
// pickJoke / fillJoke in lib/injokes.js — use useInJokes() below to get the live list.
import { currentGroup } from '../lib/group.js';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, useFeature, playerName } from '../lib/store.jsx';
import { sendOrQueue } from '../lib/outbox.js';
import { Header, Sheet, toast, Icon } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { MOMENTS, MOMENT_LABEL, EXAMPLES, MAX_LEN, checkJoke, canEdit, fillJoke, groupJokes } from '../lib/injokes.js';

/** The group's jokes, live (retired ones too — filter on `active`). Empty while the feature is off. */
export function useInJokes() {
  const on = useFeature('in_jokes');
  const [jokes, setJokes] = useState([]);
  const load = useCallback(async () => {
    if (!on) { setJokes([]); return; }
    const { data, error } = await supabase.from('in_jokes').select('*').order('created_at');
    if (!error) setJokes(data || []);
  }, [on]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['in_jokes'], load);
  return [jokes, load];
}

/** A row for Group & invites (shows only while the feature is on). */
export function InJokesLink() {
  const on = useFeature('in_jokes');
  const { status } = useSession() || {};
  if (!on || !status?.is_admin) return null; // organisers only — not a public list (Josh, 21 Oct)
  return (
    <Link to="/in-jokes" className="card pad row" style={{ gap: 10, textDecoration: 'none', color: 'inherit' }}>
      <span style={{ fontSize: 22 }} aria-hidden>😂</span>
      <span className="grow"><strong>Running jokes</strong><div className="small muted">Private — the replay and award commentary use them</div></span>
      <span className="muted">{Icon.next()}</span>
    </Link>
  );
}

export default function InJokes() {
  const data = useData();
  const { status } = useSession();
  const [jokes, reload] = useInJokes();
  const [editing, setEditing] = useState(null);
  const [showRetired, setShowRetired] = useState(false);
  const [busy, run] = useRun();
  const me = status.player_id;
  const who = { playerId: me, isOrganiser: !!status.is_admin };
  const readOnly = !!status.viewing;
  const groups = useMemo(() => groupJokes(jokes, data.playersById, { nameOf: playerName }), [jokes, data.playersById]);
  const retired = jokes.filter((j) => j.active === false && canEdit(j, who));

  const setActive = (j, active) => run(async () => {
    await must(supabase.from('in_jokes').update({ active }).eq('id', j.id));
    await reload();
  }, active ? 'Joke’s back' : 'Joke retired');

  if (!status?.is_admin) return <div className="page"><Header back title="Running jokes" /><div className="empty">Only organisers see the running jokes — they turn up in the replay and award commentary.</div></div>;
  return (
    <div className="page">
      <Header back title="In-jokes" sub="Roast the golf and the mates, keep it friendly" />
      <div className="section stack">
        {!readOnly && <AddJoke onSaved={reload} />}
        {groups.length === 0 && <div className="empty">No in-jokes yet. Add the first — it’ll turn up on award cards and round replays.</div>}
        {groups.map((g) => (
          <div key={g.playerId || 'everyone'} className="stack" style={{ gap: 6 }} data-testid="joke-group">
            <div className="label">{g.playerId ? `About ${g.name}` : 'About anyone'}</div>
            <div className="card">
              {g.jokes.map((j) => (
                <div key={j.id} className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)', gap: 8, alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div style={{ fontSize: 16 }}>{fillJoke(j.text, g.playerId ? { name: g.name } : {})}</div>
                    <div className="small muted">{MOMENT_LABEL[j.moment] || 'Any time'}{j.created_by ? ` · from ${playerName(data.playersById[j.created_by])}` : ''}</div>
                  </div>
                  {!readOnly && canEdit(j, who) && (
                    <>
                      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setEditing(j)}>Edit</button>
                      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => window.confirm('Retire this joke? It stops coming up, and you can bring it back.') && setActive(j, false)}>Retire</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {!readOnly && retired.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <button type="button" className="btn ghost sm" onClick={() => setShowRetired(!showRetired)}>{showRetired ? 'Hide' : 'Show'} retired ({retired.length})</button>
            {showRetired && (
              <div className="card">
                {retired.map((j) => (
                  <div key={j.id} className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)', gap: 8 }}>
                    <span className="grow muted">{j.text}</span>
                    <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setActive(j, true)}>Bring back</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="note" style={{ margin: 0 }}>Write {'{name}'} where the player’s name goes. No jokes about race, religion, sexuality or disability — the app won’t take them.</p>
      </div>
      {editing && <EditJoke joke={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}

/** Text, who it's about and when it comes up — shared by add and edit. */
function JokeFields({ text, setText, playerId, setPlayerId, moment, setMoment, idPrefix }) {
  const data = useData();
  const { status } = useSession();
  const players = useMemo(() => [...data.players].filter((p) => p.approved !== false).sort((a, b) => playerName(a).localeCompare(playerName(b))), [data.players]);
  const err = text.trim() ? checkJoke(text) : '';
  const name = playerName(data.playersById[playerId || status.player_id]);
  return (
    <>
      <label className="field"><span>The joke</span>
        <textarea id={`${idPrefix}-text`} className="input" rows={2} value={text} maxLength={MAX_LEN + 20} onChange={(e) => setText(e.target.value)}
          placeholder="{name}'s driver has a mind of its own" style={{ fontFamily: 'inherit', fontSize: 17 }} />
      </label>
      <div className="row small" style={{ justifyContent: 'space-between', marginTop: -6 }}>
        {err ? <span className="err" role="alert">{err}</span> : <span className="muted">{text.trim() ? `Shows as: “${fillJoke(text.trim(), { name })}”` : ' '}</span>}
        <span className={text.trim().length > MAX_LEN ? 'err' : 'muted'}>{text.trim().length}/{MAX_LEN}</span>
      </div>
      <label className="field"><span>About who (optional)</span>
        <select className="select" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
          <option value="">Anyone</option>
          {players.map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
        </select>
      </label>
      <label className="field"><span>When it comes up</span>
        <select className="select" value={moment} onChange={(e) => setMoment(e.target.value)}>
          {MOMENTS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
    </>
  );
}

function AddJoke({ onSaved }) {
  const { status } = useSession();
  const [text, setText] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [moment, setMoment] = useState('any');
  const [busy, setBusy] = useState(false);
  const bad = !text.trim() || !!checkJoke(text);
  const add = async () => {
    setBusy(true);
    try {
      const res = await sendOrQueue('in_jokes', { group_id: currentGroup(), text: text.trim(), player_id: playerId || null, moment, created_by: status.player_id });
      toast(res.sent ? 'Joke added' : 'No signal — saved on your phone, it’ll send when signal’s back');
      setText('');
      setPlayerId('');
      setMoment('any');
      if (res.sent) await onSaved();
    } catch (e) {
      toast(friendlyError(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <strong>Add an in-joke</strong>
      <div className="chips" role="group" aria-label="Ideas" style={{ flexWrap: 'wrap', padding: 0 }}>
        {EXAMPLES.slice(0, 3).map((e) => (
          <button key={e.text} type="button" className="chip" style={{ whiteSpace: 'normal', textAlign: 'left', height: 'auto', maxWidth: '100%' }} onClick={() => { setText(e.text); setMoment(e.moment); }}>{e.text}</button>
        ))}
      </div>
      <JokeFields idPrefix="add" text={text} setText={setText} playerId={playerId} setPlayerId={setPlayerId} moment={moment} setMoment={setMoment} />
      <button type="button" className="btn gold block" disabled={busy || bad} onClick={add}>{busy ? 'Adding…' : 'Add joke'}</button>
    </div>
  );
}

function EditJoke({ joke, onClose, onSaved }) {
  const [text, setText] = useState(joke.text);
  const [playerId, setPlayerId] = useState(joke.player_id || '');
  const [moment, setMoment] = useState(joke.moment || 'any');
  const [busy, run] = useRun();
  const bad = !text.trim() || !!checkJoke(text);
  const save = () => run(async () => {
    await must(supabase.from('in_jokes').update({ text: text.trim(), player_id: playerId || null, moment }).eq('id', joke.id));
    await onSaved();
    onClose();
  }, 'Joke saved');
  return (
    <Sheet title="Edit joke" onClose={onClose}>
      <div className="stack">
        <JokeFields idPrefix="edit" text={text} setText={setText} playerId={playerId} setPlayerId={setPlayerId} moment={moment} setMoment={setMoment} />
        <button type="button" className="btn gold block" disabled={busy || bad} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Sheet>
  );
}
