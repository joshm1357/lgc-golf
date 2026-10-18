import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { Header, Seg, toast } from '../components/ui.jsx';
import { parseHonours, parseHandicaps, honourSort, matchPlayers, matchTrip, parseDate } from '../lib/history.js';

const EACH_LINE = '__each_line__';

/** Stage 6: history from before the app — past winners and past handicaps, one at a time or pasted as a list. */
export default function History() {
  const { status } = useSession();
  const trophiesOn = useFeature('trophies');
  const [tab, setTab] = useState(trophiesOn ? 'winners' : 'handicaps');
  if (!status?.is_admin) {
    return (
      <div className="page">
        <Header back title="History" />
        <div className="empty">Only an organiser can add history.</div>
      </div>
    );
  }
  return (
    <div className="page">
      <Header back title="History" sub="Winners and handicaps from before the app" />
      <div className="section stack" style={{ paddingBottom: 24 }}>
        {trophiesOn && (
          <Seg light value={tab} onChange={setTab} options={[{ value: 'winners', label: 'Past winners' }, { value: 'handicaps', label: 'Past handicaps' }]} />
        )}
        {tab === 'winners' && trophiesOn ? <Winners /> : <Handicaps />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Past winners

function Winners() {
  const data = useData();
  const [busy, run] = useRun();
  const names = useMemo(() => {
    const seen = new Map();
    for (const t of data.trophies) seen.set(t.name.toLowerCase(), t.name);
    for (const h of data.honour_board) if (!seen.has(h.trophy_name.toLowerCase())) seen.set(h.trophy_name.toLowerCase(), h.trophy_name);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [data.trophies, data.honour_board]);
  const [trophy, setTrophy] = useState(names[0] || EACH_LINE);
  const [newName, setNewName] = useState('');
  const [text, setText] = useState('');
  const [one, setOne] = useState({ label: '', winners: '' });
  const trophyName = trophy === EACH_LINE ? null : trophy === '__new__' ? newName.trim() : trophy;
  const ctx = { players: data.players, trips: data.trips };
  const parsed = useMemo(() => parseHonours(text, { trophy: trophyName, ...ctx }), [text, trophyName, data.players, data.trips]); // eslint-disable-line react-hooks/exhaustive-deps
  const tripName = (id) => data.trips.find((t) => t.id === id)?.name;

  const save = (rows, after) => run(async () => {
    const n = await must(supabase.rpc('import_honours', { p_rows: rows }));
    after();
    await data.reload();
    toast(`${n} added to the honour board`);
  });
  const addOne = () => {
    if (!trophyName) { toast('Pick or type the trophy first'); return; }
    save([{ label: one.label.trim(), trophy: trophyName, winners: one.winners.trim(), player_ids: matchPlayers(one.winners, data.players), trip_id: matchTrip(one.label, data.trips) }],
      () => setOne({ label: '', winners: '' }));
  };

  return (
    <>
      <div className="card pad stack" style={{ gap: 10 }}>
        <div><strong>🏆 Past winners</strong><div className="small muted">They go on the honour board and in the Trophy Room with this app’s own winners, newest first.</div></div>
        <label className="field"><span>Trophy</span>
          <select className="select" value={trophy} onChange={(e) => setTrophy(e.target.value)}>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="__new__">A trophy that’s not listed…</option>
            <option value={EACH_LINE}>Different trophies — named on each line</option>
          </select>
        </label>
        {trophy === '__new__' && <label className="field"><span>Trophy name</span><input className="input" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. The Wooden Spoon" /></label>}

        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Add one</span>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" style={{ width: 96, flex: 'none' }} value={one.label} maxLength={30} onChange={(e) => setOne({ ...one, label: e.target.value })} placeholder="Year" aria-label="Year" />
            <input className="input grow" style={{ minWidth: 0 }} value={one.winners} maxLength={200} onChange={(e) => setOne({ ...one, winners: e.target.value })} placeholder="Winner(s)" aria-label="Winner(s)" />
          </div>
          <button type="button" className="btn" disabled={busy || !one.label.trim() || !one.winners.trim() || trophy === EACH_LINE} onClick={addOne}>Add</button>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Or paste a list</span>
          <span className="small muted">One per line — {trophyName ? 'year, winner(s)' : 'year, trophy, winner(s)'}. Straight from a spreadsheet works too.</span>
          <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Paste past winners"
            placeholder={trophyName ? '2019, Josh & Mike\n2018, Sam' : '2019, The Cup, Josh & Mike\n2019, Wooden Spoon, Sam'} style={{ fontFamily: 'inherit', resize: 'vertical' }} />
          <Preview parsed={parsed} render={(r) => (
            <><strong>{r.label}</strong> · {r.trophy} — {r.winners}
              <span className="muted">{r.player_ids.length ? ` · ${r.player_ids.length} matched to players` : ''}{r.trip_id ? ` · ${tripName(r.trip_id)}` : ''}</span></>
          )} />
          <button type="button" className="btn gold block" disabled={busy || !parsed.rows.length || parsed.problems.length > 0}
            onClick={() => save(parsed.rows, () => setText(''))}>
            {parsed.rows.length ? `Add ${parsed.rows.length} winner${parsed.rows.length === 1 ? '' : 's'}` : 'Add to the honour board'}
          </button>
        </div>
      </div>
      <HonourList />
    </>
  );
}

function Preview({ parsed, render }) {
  if (!parsed.rows.length && !parsed.problems.length) return null;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {parsed.problems.map((p) => <div key={p} className="err" style={{ margin: 0 }}>{p}</div>)}
      {parsed.problems.length > 0 && <span className="small muted">Fix those lines (or delete them) to add the list.</span>}
      {parsed.rows.slice(0, 50).map((r, i) => <div key={i} className="small">{render(r)}</div>)}
      {parsed.rows.length > 50 && <span className="small muted">…and {parsed.rows.length - 50} more</span>}
    </div>
  );
}

function HonourList() {
  const data = useData();
  const [busy, run] = useRun();
  const byTrophy = useMemo(() => {
    const m = new Map();
    for (const h of [...data.honour_board].sort(honourSort)) {
      const k = h.trophy_name;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(h);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data.honour_board]);
  if (!byTrophy.length) return null;
  const remove = (h) => {
    if (!window.confirm(`Take ${h.winner_names} (${h.label}) off the ${h.trophy_name}?`)) return;
    run(async () => { await must(supabase.from('honour_board').delete().eq('id', h.id)); await data.reload(); }, 'Removed');
  };
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <strong>The honour board</strong>
      {byTrophy.map(([name, list]) => (
        <div key={name} className="stack" style={{ gap: 4 }}>
          <span className="label">{name}</span>
          {list.map((h) => (
            <div key={h.id} className="row between small" style={{ gap: 8 }}>
              <span style={{ minWidth: 0 }}><strong>{h.label}</strong> — {h.winner_names}{h.imported ? <span className="muted"> · history</span> : null}</span>
              <button type="button" className="btn ghost sm" disabled={busy} aria-label={`Remove ${h.label} ${h.winner_names}`} onClick={() => remove(h)}>✕</button>
            </div>
          ))}
        </div>
      ))}
      <Link to="/trophies" className="small" style={{ fontWeight: 700 }}>See it in the Trophy Room →</Link>
    </div>
  );
}

// ---------------------------------------------------------------- Past handicaps

function Handicaps() {
  const data = useData();
  const [busy, run] = useRun();
  const [text, setText] = useState('');
  const players = useMemo(() => data.players.filter((p) => p.approved !== false).sort((a, b) => a.name.localeCompare(b.name)), [data.players]);
  const [one, setOne] = useState({ player_id: '', date: '', handicap: '' });
  const [list, setList] = useState(null);
  const parsed = useMemo(() => parseHandicaps(text, { players }), [text, players]);

  const load = async () => {
    const { data: rows, error } = await supabase.from('handicap_history').select('id, player_id, new_handicap, created_at').eq('imported', true).order('created_at', { ascending: false });
    setList(error ? [] : rows || []);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (rows, after) => run(async () => {
    const n = await must(supabase.rpc('import_handicaps', { p_rows: rows.map(({ player_id, date, handicap }) => ({ player_id, date, handicap })) }));
    after();
    await load();
    toast(`${n} handicap${n === 1 ? '' : 's'} added to history`);
  });
  const oneDate = parseDate(one.date) || (/^\d{4}-\d{2}-\d{2}$/.test(one.date) ? one.date : null);
  const remove = (h) => {
    if (!window.confirm('Remove this handicap from the history?')) return;
    run(async () => {
      const { error } = await supabase.rpc('remove_history_handicap', { p_id: h.id });
      if (error && /could not find|does not exist/i.test(error.message || '')) throw new Error('Removing isn’t switched on yet — ask whoever looks after the app.');
      if (error) throw error;
      await load();
    }, 'Removed');
  };

  return (
    <>
      <div className="card pad stack" style={{ gap: 10 }}>
        <div><strong>📈 Past handicaps</strong>
          <div className="small muted">Shown on each player’s handicap history. Today’s handicaps don’t change — only the admin or the Tribunal changes those.</div></div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Add one</span>
          <select className="select" value={one.player_id} onChange={(e) => setOne({ ...one, player_id: e.target.value })} aria-label="Player">
            <option value="">Player…</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" style={{ minWidth: 0 }} type="date" value={one.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setOne({ ...one, date: e.target.value })} aria-label="Date" />
            <input className="input" style={{ width: 96, flex: 'none' }} inputMode="decimal" value={one.handicap} onChange={(e) => setOne({ ...one, handicap: e.target.value })} placeholder="Hcp" aria-label="Handicap" />
          </div>
          <button type="button" className="btn" disabled={busy || !one.player_id || !oneDate || one.handicap.trim() === '' || Number.isNaN(Number(one.handicap))}
            onClick={() => save([{ player_id: one.player_id, date: oneDate, handicap: Number(one.handicap) }], () => setOne({ ...one, date: '', handicap: '' }))}>Add</button>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Or paste a list</span>
          <span className="small muted">One per line — player, date, handicap (e.g. “Josh M, 1/6/2023, 14.2”; a year on its own is fine). Names must match the players in the group.</span>
          <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Paste past handicaps"
            placeholder={'Josh M, 1/6/2023, 14.2\nJosh M, 2022, 16'} style={{ fontFamily: 'inherit', resize: 'vertical' }} />
          <Preview parsed={parsed} render={(r) => <><strong>{r.name}</strong> · {new Date(r.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })} · {r.handicap}</>} />
          <button type="button" className="btn gold block" disabled={busy || !parsed.rows.length || parsed.problems.length > 0}
            onClick={() => save(parsed.rows, () => setText(''))}>
            {parsed.rows.length ? `Add ${parsed.rows.length} handicap${parsed.rows.length === 1 ? '' : 's'}` : 'Add to history'}
          </button>
        </div>
      </div>

      {list && list.length > 0 && (
        <div className="card pad stack" style={{ gap: 6 }}>
          <strong>Added as history</strong>
          {list.map((h) => (
            <div key={h.id} className="row between small" style={{ gap: 8 }}>
              <span><Link to={`/player/${h.player_id}`}>{data.playersById[h.player_id]?.name || 'Player'}</Link> · {Number(h.new_handicap)} · {new Date(h.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <button type="button" className="btn ghost sm" disabled={busy} aria-label="Remove" onClick={() => remove(h)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
