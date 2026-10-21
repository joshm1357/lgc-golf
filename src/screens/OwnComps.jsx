// A group's own side comps (migration 051): the comp inside Comps, the organiser's list of comps, and which comps a
// round has. Closest to pin and longest drive are unchanged (Comps.jsx). The rules for winners are in lib/sidecomps.js.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName } from '../lib/store.jsx';
import { sendOrQueue } from '../lib/outbox.js';
import { Avatar, Sheet, toast, timeAgo, PhotoButtons, Icon } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { HOW, compsForRound, sortOwnEntries, beats, parseHoles } from '../lib/sidecomps.js';
import { compKind, wonText } from '../lib/sidecomplib.js';
import { CompLibrary, TallyComp, AutoComp } from './SideCompLibrary.jsx';

/** The group's own side comps, live. */
export function useOwnDefs() {
  const [defs, setDefs] = useState([]);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('side_comp_defs').select('*').order('created_at');
    if (!error) setDefs(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['side_comp_defs'], load);
  return [defs, load];
}

export function useRoundOwnComps(round) {
  const [defs] = useOwnDefs();
  return useMemo(() => compsForRound(round, defs), [round, defs]);
}

// ------------------------------------------------------------------ The comp, inside Comps
/** Dots get a +1 per player, comps from the scores show live standings, the rest are measured or picked. */
export function OwnComp(props) {
  const kind = compKind(props.comp);
  if (kind === 'tally') return <TallyComp {...props} />;
  if (kind === 'auto') return <AutoComp {...props} />;
  return <MeasuredComp {...props} />;
}

function MeasuredComp({ round, comp, playerIds }) {
  const data = useData();
  const { status } = useSession();
  const [entries, setEntries] = useState([]);
  const [holeSel, setHoleSel] = useState(null);
  const [adding, setAdding] = useState(false);
  const whole = !comp.holes.length;
  const hole = whole ? null : comp.holes.includes(holeSel) ? holeSel : comp.holes[0];
  const load = useCallback(async () => {
    const { data: rows } = await supabase.from('side_comp_entries').select('*').eq('round_id', round.id).eq('comp_id', comp.id).order('created_at');
    setEntries(rows || []);
  }, [round.id, comp.id]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['side_comp_entries'], load);
  const list = useMemo(() => sortOwnEntries(comp.how, entries.filter((e) => (whole ? e.hole == null : e.hole === hole))), [entries, comp.how, whole, hole]);
  const leader = list[0];
  const unit = comp.unit ? ` ${comp.unit}` : '';

  const confirm = async (e, on) => {
    if (on) {
      const others = list.filter((x) => x.id !== e.id && x.confirmed).map((x) => x.id);
      if (others.length) await supabase.from('side_comp_entries').update({ confirmed: false }).in('id', others);
    }
    const { error } = await supabase.from('side_comp_entries').update({ confirmed: on }).eq('id', e.id);
    if (error) toast(friendlyError(error)); else { toast(on ? 'Winner confirmed' : 'Unconfirmed'); load(); }
  };
  const remove = async (e) => {
    if (!window.confirm('Remove this entry?')) return;
    const { error } = await supabase.from('side_comp_entries').delete().eq('id', e.id);
    if (error) toast(friendlyError(error)); else load();
  };

  return (
    <>
      {!whole && (
        <div className="chips" role="group" aria-label="Hole">
          {comp.holes.map((n) => <button key={n} type="button" className="chip" aria-pressed={n === hole} onClick={() => setHoleSel(n)}>Hole {n}</button>)}
        </div>
      )}
      <div className="section stack">
        {leader ? (
          <div className="card pad row" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)', gap: 12 }}>
            {leader.photo_url ? <img src={leader.photo_url} alt="" style={{ width: 76, height: 76, borderRadius: 12, objectFit: 'cover' }} /> : <Avatar player={data.playersById[leader.player_id]} size={64} />}
            <div className="grow">
              <div className="label" style={{ color: '#5A4300' }}>{leader.confirmed ? 'Winner ✓ confirmed' : comp.how === 'pick' ? 'Latest nomination' : 'Leader'}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{playerName(data.playersById[leader.player_id])}</div>
              {leader.note && <div className="small">“{leader.note}”</div>}
              <div className="small muted">{timeAgo(leader.created_at)}</div>
            </div>
            {comp.how !== 'pick' && <span className="num" style={{ fontSize: 36, lineHeight: 1 }}>{leader.value != null ? Number(leader.value) : '–'}<span style={{ fontSize: 18 }}>{unit}</span></span>}
          </div>
        ) : <div className="empty">No entries {whole ? 'yet' : `on hole ${hole} yet`}. {comp.how === 'pick' ? 'Nominate a shot!' : 'First to enter leads!'}</div>}
        {list.length > 0 && (
          <div className="card">
            {list.map((e, i) => (
              <div key={e.id} className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)', gap: 8 }}>
                <span className="num" style={{ width: 20, fontSize: 18 }}>{i + 1}</span>
                <Avatar player={data.playersById[e.player_id]} size={32} />
                <span className="grow ellipsis"><strong>{playerName(data.playersById[e.player_id])}</strong>{e.note ? <span className="small muted"> · {e.note}</span> : null}</span>
                {comp.how !== 'pick' && <span className="num">{e.value != null ? `${Number(e.value)}${unit}` : '–'}</span>}
                {status.is_admin && !status.viewing && <button type="button" className="btn ghost sm" onClick={() => confirm(e, !e.confirmed)}>{e.confirmed ? 'Unconfirm' : 'Winner'}</button>}
                {(e.created_by === status.player_id || status.is_admin) && !status.viewing && <button type="button" className="btn ghost sm" aria-label="Remove entry" onClick={() => remove(e)}>{Icon.x(14)}</button>}
              </div>
            ))}
          </div>
        )}
        <p className="note" style={{ margin: 0 }}>{HOW.find((h) => h.value === comp.how)?.label}.{comp.how === 'pick' ? ' The organiser confirms the winner.' : ' A confirmed winner beats any number.'}</p>
      </div>
      {round.status !== 'locked' && <button type="button" className="btn gold fab" onClick={() => setAdding(true)}>{comp.how === 'pick' ? 'Nominate' : 'Enter'}{whole ? '' : ` — hole ${hole}`}</button>}
      {adding && <OwnEntryForm round={round} comp={comp} hole={hole} leader={leader} playerIds={playerIds} onClose={() => setAdding(false)} onSaved={load} />}
    </>
  );
}

function OwnEntryForm({ round, comp, hole, leader, playerIds, onClose, onSaved }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [playerId, setPlayerId] = useState(playerIds.includes(me) ? me : playerIds[0] || me);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const options = [...new Set([...playerIds, me])].map((id) => data.playersById[id]).filter(Boolean);
  const pick = comp.how === 'pick';
  const num = value.trim() === '' ? null : Number(value.trim().replace(',', '.'));
  const badNum = !pick && (num == null || !Number.isFinite(num) || num < 0);
  const save = async () => {
    setBusy(true);
    try {
      const v = pick ? null : num;
      const res = await sendOrQueue('side_comp_entries', {
        round_id: round.id, comp_id: comp.id, hole, player_id: playerId, value: v, note: note.trim() || null, photo_url: null, created_by: me,
      }, { photo: file ? { file, field: 'photo_url', folder: 'comps' } : null });
      if (!res.sent) { toast('No signal — saved on your phone, it’ll send when signal’s back'); onClose(); return; }
      const leads = beats(comp.how, v, leader);
      if (leads || pick) {
        await sendOrQueue('posts', {
          kind: 'user', player_id: me, round_id: round.id, trip_id: round.trip_id, hole, photo_url: res.row?.photo_url || null,
          body: `${comp.emoji ? `${comp.emoji} ` : ''}${comp.name}${hole ? ` on ${hole}` : ''}: ${playerName(data.playersById[playerId])}${pick ? (note.trim() ? ` — ${note.trim()}` : '') : `, ${v}${comp.unit ? ` ${comp.unit}` : ''}`}`,
        }).catch(() => {});
      }
      toast(leads ? 'New leader!' : 'Entry saved');
      onSaved();
      onClose();
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`${comp.name}${hole ? ` · hole ${hole}` : ''}`} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>Player</span>
          <select className="select" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            {options.map((p) => <option key={p.id} value={p.id}>{playerName(p)}{p.id === me ? ' (me)' : ''}</option>)}
          </select>
        </label>
        {!pick && (
          <>
            <label className="field"><span>{comp.unit ? `How many ${comp.unit}` : 'Number'}</span>
              <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={{ fontSize: 22 }} />
            </label>
            {value.trim() !== '' && badNum && <span className="small err" style={{ margin: 0 }}>That isn’t a number — e.g. 12 or 12.5</span>}
          </>
        )}
        <label className="field"><span>{pick ? 'What happened' : 'Note (optional)'}</span>
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={pick ? 'e.g. holed out from the bunker' : ''} />
        </label>
        <PhotoButtons onPick={setFile} picked={!!file} cameraLabel={file ? 'Retake' : 'Take a photo'} />
        <button type="button" className="btn gold block" disabled={busy || badNum || (pick && !note.trim() && !file)} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Organiser: the group's comps (Admin)
export function OwnCompsAdmin({ trip } = {}) {
  const [defs, reload] = useOwnDefs();
  const [busy, run] = useRun();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [how, setHow] = useState('lowest');
  const [unit, setUnit] = useState('m');
  const add = () => run(async () => {
    await must(supabase.from('side_comp_defs').insert({ name: name.trim(), emoji: emoji.trim() || null, how, unit: how === 'pick' ? null : unit.trim() || null }));
    setName(''); setEmoji('');
    await reload();
  }, 'Side comp added — switch it on for a round below');
  const live = defs.filter((d) => !d.retired);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="small muted">Closest to pin and longest drive are always there. Add more from the list — greenies, sandies, most birdies, the snake… — or make your own.</div>
      <CompLibrary defs={defs} reload={reload} trip={trip} />
      {live.map((d) => (
        <div key={d.id} className="row" style={{ gap: 8 }}>
          <div className="grow"><strong>{d.emoji} {d.name}</strong><div className="small muted">{wonText(d)}</div></div>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => { await must(supabase.from('side_comp_defs').update({ retired: true }).eq('id', d.id)); await reload(); }, 'Side comp put away (its winners stay)')}>Put away</button>
        </div>
      ))}
      <span className="label" style={{ marginTop: 6 }}>Make your own</span>
      <div className="card pad stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ width: 72 }}><span>Emoji</span><input className="input" value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} placeholder="⛳" /></label>
          <label className="field grow"><span>Name</span><input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Longest putt" /></label>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {HOW.map((h) => (
            <label key={h.value} className="row" style={{ gap: 8 }}>
              <input type="radio" name="own-how" checked={how === h.value} onChange={() => { setHow(h.value); if (h.value === 'highest' && unit === 'm') setUnit('ft'); }} />
              <span>{h.label} <span className="small muted">({h.hint})</span></span>
            </label>
          ))}
        </div>
        {how !== 'pick' && <label className="field"><span>Unit (just a word: m, ft, shots…)</span><input className="input" value={unit} maxLength={12} onChange={(e) => setUnit(e.target.value)} /></label>}
        <button type="button" className="btn gold sm" disabled={busy || name.trim().length < 2} onClick={add}>Add side comp</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Organiser: which comps a round has (Admin → round)
export function RoundOwnComps({ round, onSaved }) {
  const [defs] = useOwnDefs();
  const [busy, run] = useRun();
  const current = Object.fromEntries((round.own_comps || []).map((c) => [c.comp, (c.holes || []).join(' ')]));
  const [draft, setDraft] = useState(current);
  useEffect(() => { setDraft(Object.fromEntries((round.own_comps || []).map((c) => [c.comp, (c.holes || []).join(' ')]))); }, [round.own_comps]);
  const live = defs.filter((d) => !d.retired || d.id in draft);
  if (!live.length) return null;
  const changed = JSON.stringify(draft) !== JSON.stringify(current);
  const save = () => run(async () => {
    const own = live.filter((d) => d.id in draft).map((d) => ({ comp: d.id, holes: parseHoles(draft[d.id]) }));
    await must(supabase.from('rounds').update({ own_comps: own }).eq('id', round.id));
    onSaved?.();
  }, 'Side comps saved');
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">Your own side comps</span>
      {live.map((d) => {
        const on = d.id in draft;
        return (
          <div key={d.id} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="chip" aria-pressed={on} onClick={() => {
              const next = { ...draft };
              if (on) delete next[d.id]; else next[d.id] = '';
              setDraft(next);
            }}>{d.emoji} {d.name}</button>
            {on && d.scoring === 'auto' && <span className="small muted">From the scores</span>}
            {on && d.scoring !== 'auto' && <input className="input" style={{ maxWidth: 200, minHeight: 38 }} value={draft[d.id]} inputMode="numeric" placeholder="Holes, or blank = whole round"
              onChange={(e) => setDraft({ ...draft, [d.id]: e.target.value })} />}
          </div>
        );
      })}
      {changed && <button type="button" className="btn sm" disabled={busy} onClick={save}>Save your side comps</button>}
    </div>
  );
}
