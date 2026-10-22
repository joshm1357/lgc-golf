// Stage 11c — laptop tables: players & handicaps (Group & invites → Players table, /group/players: sort, filter, edit in
// place, history, paste a list) and course scorecards (Courses → Paste a scorecard, /courses/paste). Was the Trip desk's.
// Course scorecards: paste the Par and Index rows. Every paste is shown as a preview first; nothing saves until "Save".
// The reading of pastes is in lib/paste.js; sorting and filtering in lib/desk.js.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useRealtime, playerName } from '../lib/store.jsx';
import { Avatar, toast } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { sortRows, nextSort, filterRows } from '../lib/desk.js';
import { parsePlayers, parseScorecard } from '../lib/paste.js';
import { readHandicap } from '../lib/history.js';
import { DeskNav } from './DeskNav.jsx';
import './desk.css';

const showHcp = (h) => (h == null ? '–' : Number(h) < 0 ? `+${-Number(h)}` : String(Number(h)));
const day = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

function SortHead({ sort, setSort, k, label, cls }) {
  return (
    <th className={cls} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-btn" onClick={() => setSort(nextSort(sort, k))}>{label}{sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button>
    </th>
  );
}

// ------------------------------------------------------------------ Players & handicaps

export function PlayersTable() {
  const data = useData();
  const { status } = useSession();
  const admin = !!status.is_admin;
  const [busy, run] = useRun();
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null); // { id, value }
  const [open, setOpen] = useState(null); // player id with history shown
  const [history, setHistory] = useState([]);
  const [one, setOne] = useState({ name: '', handicap: '' });
  const addRef = useRef(null);
  const loadHistory = useCallback(async () => {
    const { data: rows, error } = await supabase.from('handicap_history').select('id, player_id, old_handicap, new_handicap, reason, created_at').order('created_at', { ascending: false });
    if (!error) setHistory(rows || []);
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useRealtime(['handicap_history'], loadHistory);
  useEffect(() => {
    const f = () => addRef.current?.focus();
    window.addEventListener('tgt:new', f);
    return () => window.removeEventListener('tgt:new', f);
  }, []);
  const players = data.players.filter((p) => p.approved !== false);
  const lastOf = useMemo(() => {
    const m = {};
    for (const h of history) if (!m[h.player_id]) m[h.player_id] = h;
    return m;
  }, [history]);
  const rows = players.map((p) => ({ ...p, hcp: p.handicap == null ? null : Number(p.handicap), changed: lastOf[p.id]?.created_at || null, nick: p.nickname || '' }));
  const shown = sortRows(filterRows(rows, q, ['name', 'nickname']), sort.key, sort.dir);

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
  const addOne = () => {
    const h = one.handicap.trim() === '' ? 18 : readHandicap(one.handicap);
    if (!one.name.trim() || h == null) { toast('Type a name and a handicap (−10 to 54)'); return; }
    run(async () => {
      await must(supabase.rpc('admin_create_player', { p_name: one.name.trim(), p_nickname: null, p_handicap: h, p_avatar_url: null }));
      setOne({ name: '', handicap: '' });
      await data.reload();
      addRef.current?.focus();
    }, 'Player added');
  };

  return (
    <div className="page desk-page" data-testid="players-table-page">
      <DeskNav />
      <div className="desk-head">
        <div className="desk-head-main">
          <h1 className="hdr-title desk-title">Players & handicaps</h1>
          <div className="hdr-sub">{players.length} players · click a handicap to change it{admin ? '' : ' (organisers only)'}</div>
        </div>
      </div>
      <div className="desk-grid single">
        <section className="desk-panel wide">
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <input className="input grow" type="search" placeholder="Filter players" aria-label="Filter players" value={q} onChange={(e) => setQ(e.target.value)} data-search />
          </div>
          <div className="desk-scroll">
            <table className="desk-table" data-testid="players-table">
              <thead><tr>
                <th style={{ width: 40 }} />
                <SortHead sort={sort} setSort={setSort} k="name" label="Name" />
                <SortHead sort={sort} setSort={setSort} k="nick" label="Nickname" />
                <SortHead sort={sort} setSort={setSort} k="hcp" label="Handicap" cls="num-cell" />
                <SortHead sort={sort} setSort={setSort} k="changed" label="Last change" />
                <th />
              </tr></thead>
              <tbody>
                {shown.map((p) => (
                  <React.Fragment key={p.id}>
                    <tr data-testid="player-row">
                      <td><Avatar player={p} size={28} /></td>
                      <td><Link to={`/player/${p.id}`}>{p.name}</Link></td>
                      <td className="muted">{p.nickname || ''}</td>
                      <td className="num-cell">
                        {edit?.id === p.id ? (
                          <input className="input cell-input num-input" autoFocus value={edit.value} aria-label={`${p.name} handicap`}
                            onChange={(e) => setEdit({ ...edit, value: e.target.value })} onBlur={saveHcp}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveHcp(); } if (e.key === 'Escape') { e.stopPropagation(); setEdit(null); } }} />
                        ) : admin ? (
                          <button type="button" className="cell-btn num" aria-label={`Change ${p.name}’s handicap (${showHcp(p.hcp)})`} disabled={busy} onClick={() => setEdit({ id: p.id, value: showHcp(p.hcp) })}>{showHcp(p.hcp)}</button>
                        ) : <span className="num">{showHcp(p.hcp)}</span>}
                      </td>
                      <td className="small muted">{p.changed ? day(p.changed) : '–'}</td>
                      <td><button type="button" className="btn ghost sm" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>History</button></td>
                    </tr>
                    {open === p.id && (
                      <tr className="history-row"><td /><td colSpan={5}>
                        <HistoryList rows={history.filter((h) => h.player_id === p.id)} />
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
                {!shown.length && <tr><td colSpan={6} className="small muted">{q ? 'No players match.' : 'No players yet.'}</td></tr>}
              </tbody>
              {admin && (
                <tfoot><tr className="add-row">
                  <td />
                  <td colSpan={2}><input ref={addRef} className="input cell-input" placeholder="New player’s name" aria-label="New player’s name" value={one.name}
                    onChange={(e) => setOne({ ...one, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOne())} /></td>
                  <td><input className="input cell-input num-input" placeholder="Hcp" aria-label="New player’s handicap" value={one.handicap} inputMode="decimal"
                    onChange={(e) => setOne({ ...one, handicap: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOne())} /></td>
                  <td colSpan={2}><button type="button" className="btn sm" disabled={busy} onClick={addOne}>Add player</button></td>
                </tr></tfoot>
              )}
            </table>
          </div>
        </section>
        {admin && <PastePlayers players={players} onSaved={async () => { await data.reload(); await loadHistory(); }} />}
      </div>
    </div>
  );
}

function HistoryList({ rows }) {
  if (!rows.length) return <div className="small muted">No changes recorded.</div>;
  return (
    <ul className="desk-list" data-testid="handicap-history">
      {rows.map((h) => (
        <li key={h.id} className="small">
          <span className="grow"><strong>{h.old_handicap == null ? '' : `${showHcp(h.old_handicap)} → `}{showHcp(h.new_handicap)}</strong> · {h.reason}</span>
          <span className="muted">{day(h.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

const STATUS = { new: ['New', 'st-new'], update: ['Handicap change', 'st-update'], same: ['No change', 'st-same'], problem: ['Skipped', 'st-problem'] };

function PastePlayers({ players, onSaved }) {
  const [text, setText] = useState('');
  const [busy, run] = useRun();
  const parsed = useMemo(() => parsePlayers(text, players), [text, players]);
  const todo = parsed.rows.filter((r) => r.status === 'new' || r.status === 'update');
  const save = () => run(async () => {
    for (const r of todo) {
      if (r.status === 'new') await must(supabase.rpc('admin_create_player', { p_name: r.name, p_nickname: r.nickname, p_handicap: r.handicap ?? 18, p_avatar_url: null }));
      else await must(supabase.from('players').update({ handicap: r.handicap }).eq('id', r.player_id));
    }
    setText('');
    await onSaved();
    return todo.length;
  }).then((n) => n != null && toast(`Saved ${n} player${n === 1 ? '' : 's'}`));
  return (
    <section className="desk-panel wide" data-testid="paste-players">
      <div className="desk-panel-hdr"><h2>📋 Paste from a spreadsheet</h2></div>
      <div className="desk-panel-body stack" style={{ gap: 8 }}>
        <span className="small muted">Copy the name and handicap columns (a nickname column too, if you like) and paste them here. Headings are fine. You’ll see what happens before anything is saved.</span>
        <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-label="Paste players" placeholder={'Name\tHandicap\nJosh M\t14.2\nBig Al\t20'} style={{ fontFamily: 'inherit', resize: 'vertical' }} />
        {parsed.rows.length > 0 && (
          <>
            <div className="desk-scroll">
              <table className="desk-table compact" data-testid="paste-preview">
                <thead><tr><th>Line</th><th>Name</th><th>Nickname</th><th className="num-cell">Handicap</th><th>What happens</th></tr></thead>
                <tbody>
                  {parsed.rows.map((r) => (
                    <tr key={r.n} className={STATUS[r.status][1]}>
                      <td className="muted">{r.n}</td>
                      <td>{r.name || '–'}</td>
                      <td className="muted">{r.nickname || ''}</td>
                      <td className="num-cell">{r.status === 'update' ? `${showHcp(r.old)} → ${showHcp(r.handicap)}` : showHcp(r.handicap)}</td>
                      <td><span className={'st-pill ' + STATUS[r.status][1]}>{STATUS[r.status][0]}</span> <span className="small muted">{r.problem || r.note || ''}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="small"><strong>{parsed.counts.new}</strong> new · <strong>{parsed.counts.update}</strong> handicap change{parsed.counts.update === 1 ? '' : 's'} · {parsed.counts.same} no change{parsed.counts.problem ? ` · ${parsed.counts.problem} skipped` : ''}</div>
          </>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn gold" disabled={busy || !todo.length} onClick={save}>{todo.length ? `Save ${todo.length} player${todo.length === 1 ? '' : 's'}` : 'Nothing to save yet'}</button>
          {text && <button type="button" className="btn ghost" onClick={() => setText('')}>Clear</button>}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Course scorecards

export function CoursePaste() {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const [params] = useSearchParams();
  const [courseId, setCourseId] = useState(() => params.get('course') || ''); // '' = a new course (Courses → a course → Paste its card)
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const course = data.coursesById[courseId] || null;
  const parsed = useMemo(() => parseScorecard(text), [text]);
  const ok = parsed.holes.length && !parsed.problems.length && (course || name.trim());
  const save = () => run(async () => {
    const old = course ? [...(course.holes || [])].sort((a, b) => a.n - b.n) : [];
    // Keep each hole's map points (tee and green) — only par and index change.
    const holes = parsed.holes.map((h, i) => ({ ...(old[i] || {}), n: h.n, par: h.par, si: h.si }));
    if (course) await must(supabase.from('courses').update({ holes }).eq('id', course.id));
    else await must(supabase.from('courses').insert({ name: name.trim(), holes }));
    setText('');
    await data.reload();
  }, course ? `${course.name} updated` : 'Course added');
  const par = parsed.holes.reduce((s, h) => s + h.par, 0);
  return (
    <div className="page desk-page" data-testid="course-paste-page">
      <DeskNav />
      <div className="desk-head"><div className="desk-head-main"><h1 className="hdr-title desk-title">Course scorecards</h1><div className="hdr-sub">Paste the Par and Index rows from the course’s card or website.</div></div></div>
      <div className="desk-grid single">
        <section className="desk-panel wide">
          {!status.is_admin && <div className="small muted" style={{ marginBottom: 8 }}>Only organisers can save courses.</div>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="field grow"><span>Course</span>
              <select className="select" value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Course">
                <option value="">A new course…</option>
                {data.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {!course && <label className="field grow"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cypress Lakes" aria-label="New course name" /></label>}
          </div>
          <label className="field" style={{ marginTop: 8 }}><span>Paste the card</span>
            <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-label="Paste the scorecard"
              placeholder={'Hole\t1\t2\t3 …\nPar\t4\t4\t3 …\nIndex\t7\t15\t3 …'} style={{ fontFamily: 'inherit', resize: 'vertical' }} /></label>
          {parsed.problems.length > 0 && <div className="err" data-testid="course-problems">{parsed.problems.map((p) => <div key={p}>{p}</div>)}</div>}
          {parsed.holes.length > 0 && (
            <div className="desk-scroll" style={{ marginTop: 8 }}>
              <table className="desk-table compact card-table" data-testid="course-preview">
                <tbody>
                  <tr><th>Hole</th>{parsed.holes.map((h) => <th key={h.n} className="num-cell">{h.n}</th>)}<th className="num-cell">Total</th></tr>
                  <tr><th>Par</th>{parsed.holes.map((h) => <td key={h.n} className="num-cell">{h.par}</td>)}<td className="num-cell"><strong>{par}</strong></td></tr>
                  <tr><th>Index</th>{parsed.holes.map((h) => <td key={h.n} className="num-cell">{h.si}</td>)}<td /></tr>
                </tbody>
              </table>
            </div>
          )}
          {course && parsed.holes.length > 0 && (course.holes || []).length > 0 && (
            <div className="small muted" style={{ marginTop: 6 }}>Now: par {(course.holes || []).reduce((s, h) => s + h.par, 0)} over {(course.holes || []).length} holes. Map points for each hole are kept.</div>
          )}
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button type="button" className="btn gold" disabled={busy || !ok || !status.is_admin} onClick={save}>{course ? `Save to ${course.name}` : 'Add this course'}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
