// Stage 11c — paper cards at a laptop, and printing a round.
//   CardPicker  /cards                 pick a round ("g c"; each round also has its own Paper cards button)
//   PaperCard   /round/:id/cards       a grid: one row per player (or team), one box per hole. Tab along, Enter for the
//                                      next row, arrows to move. Each box saves as you leave it, through the score
//                                      queue (offline.js), so no signal just means it sends later.
//   PrintRound  /round/:id/print       results and every card, laid out for paper.
// The reading of boxes, totals and what changed are in lib/papercard.js.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData, useScores, useSession, playerName } from '../lib/store.jsx';
import { saveScore } from '../lib/offline.js';
import { courseHoles, roundBoard, formatName, isNetFormat } from '../lib/board.js';
import { formatToPar } from '../lib/scoring.js';
import { fmtRange } from '../lib/plan.js';
import { cardSubjects, readCell, rowDraft, rowTotals, changedCells, parseCardLine, moveFrom } from '../lib/papercard.js';
import { friendlyError } from '../lib/supabase.js';
import { Loading, toast } from '../components/ui.jsx';
import { DeskNav } from './DeskNav.jsx';
import { TOOL } from '../lib/desk.js';
import './desk.css';

export function CardPicker() {
  const data = useData();
  const trip = data.currentTrip;
  const rounds = [...data.rounds].reverse();
  const mine = rounds.filter((r) => r.trip_id === trip?.id);
  const rest = rounds.filter((r) => r.trip_id !== trip?.id).slice(0, 12);
  const line = (r) => (
    <li key={r.id}>
      <span className="grow"><strong>{r.name}</strong><div className="small muted">{[r.play_date && fmtRange(r.play_date), data.coursesById[r.course_id]?.name, formatName(r.format), r.status === 'live' ? '🔴 live' : r.status === 'locked' ? 'final' : 'not started'].filter(Boolean).join(' · ')}</div></span>
      <Link className="btn sm" to={TOOL.card(r.id)}>Enter cards</Link>
      <Link className="btn sm ghost" to={TOOL.print(r.id)}>Print</Link>
    </li>
  );
  return (
    <div className="page desk-page">
      <DeskNav />
      <div className="desk-head"><div className="desk-head-main"><h1 className="hdr-title desk-title">Paper cards</h1><div className="hdr-sub">Type a pile of scorecards in quickly — Tab along the holes.</div></div></div>
      <div className="desk-grid single">
        <section className="desk-panel wide">
          {!data.rounds.length && <div className="empty">No rounds yet.</div>}
          {mine.length > 0 && <><span className="label">{trip.name}</span><ul className="desk-list">{mine.map(line)}</ul></>}
          {rest.length > 0 && <><span className="label" style={{ display: 'block', marginTop: 10 }}>Other rounds</span><ul className="desk-list">{rest.map(line)}</ul></>}
        </section>
      </div>
    </div>
  );
}

const keyOf = (sid, n) => `${sid}|${n}`;

export function PaperCard() {
  const { roundId } = useParams();
  const data = useData();
  const { status } = useSession();
  const scores = useScores(roundId);
  const round = data.rounds.find((r) => r.id === roundId);
  const course = round ? data.coursesById[round.course_id] : null;
  const holes = useMemo(() => courseHoles(course), [course]);
  const subjects = useMemo(() => cardSubjects({ round, teamsByRound: data.teamsByRound, roundPlayers: data.roundPlayers, playersById: data.playersById }), [round, data]);
  const saved = scores.index[roundId] || {};
  const [draft, setDraft] = useState({}); // { subjectId: { hole: text } }
  const touched = useRef(new Set()); // boxes typed in (saved values never overwrite them)
  const [state, setState] = useState({}); // { key: 'saving' | 'saved' | 'queued' | 'error' }
  const inputs = useRef({});
  const locked = round && round.status === 'locked' && !status.is_admin;

  // Fill the boxes from what's saved (and keep them in step with other phones), except boxes being typed in.
  const savedKey = JSON.stringify(Object.keys(saved).map((sid) => [sid, Object.entries(saved[sid]).map(([n, s]) => `${n}:${s.strokes}:${s.picked_up}`)]));
  useEffect(() => {
    setDraft((cur) => {
      const next = { ...cur };
      for (const s of subjects) {
        const fromSaved = rowDraft(holes, saved[s.id] || {});
        const row = { ...(next[s.id] || {}) };
        for (const h of holes) if (!touched.current.has(keyOf(s.id, h.n))) row[h.n] = fromSaved[h.n];
        next[s.id] = row;
      }
      return next;
    });
  }, [savedKey, subjects, holes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data.ready) return <Loading />;
  if (!round || !course) return <div className="page desk-page"><DeskNav /><div className="empty">Round not found.</div></div>;

  const focus = (r, c) => {
    const el = inputs.current[`${r}:${c}`];
    if (el) { el.focus(); el.select(); }
  };
  const setCell = (sid, n, text) => {
    touched.current.add(keyOf(sid, n));
    setDraft((cur) => ({ ...cur, [sid]: { ...(cur[sid] || {}), [n]: text } }));
  };
  // Save one row's changed boxes (only the holes given, or all of them).
  const saveRow = async (subject, onlyHoles, rowDraftNow) => {
    const d = rowDraftNow || draft[subject.id] || {};
    const list = changedCells({ round, subject, holes: onlyHoles ? holes.filter((h) => onlyHoles.includes(h.n)) : holes, draft: d, saved: saved[subject.id] || {} });
    for (const row of list) {
      const k = keyOf(subject.id, row.hole);
      setState((s) => ({ ...s, [k]: 'saving' }));
      try {
        const sent = await saveScore({ ...row, entered_by: status.player_id });
        setState((s) => ({ ...s, [k]: sent ? 'saved' : 'queued' }));
      } catch (e) {
        setState((s) => ({ ...s, [k]: 'error' }));
        toast(friendlyError(e));
      }
      touched.current.delete(k);
    }
  };
  const leave = (subject, n) => {
    const c = readCell(draft[subject.id]?.[n], round.format);
    if (c.error) { setState((s) => ({ ...s, [keyOf(subject.id, n)]: 'error' })); return; }
    if (c.empty) { touched.current.delete(keyOf(subject.id, n)); return; }
    saveRow(subject, [n]);
  };
  const onKey = (e, r, c) => {
    const map = { Tab: e.shiftKey ? 'prev' : 'next', Enter: 'nextRow', ArrowDown: 'down', ArrowUp: 'up', ArrowRight: 'next', ArrowLeft: 'prev' };
    const how = map[e.key];
    if (!how) return;
    // Arrows left/right only move when the box is empty or fully selected, so you can still fix a typo.
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const el = e.target;
      const len = el.value.length;
      const all = el.selectionStart === 0 && el.selectionEnd === len;
      const atEdge = el.selectionStart === el.selectionEnd && (e.key === 'ArrowRight' ? el.selectionStart === len : el.selectionStart === 0);
      if (len && !all && !atEdge) return;
    }
    const to = moveFrom({ row: r, col: c }, how, subjects.length, holes.length);
    if (!to) return; // off the card: let Tab leave the grid as normal
    e.preventDefault();
    focus(to.row, to.col);
  };
  // A whole row (or several rows) pasted: fill along from this box, then save.
  const onPaste = (e, r, c) => {
    const text = e.clipboardData?.getData('text') || '';
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const rowsOf = lines.map((l) => parseCardLine(l, holes.length));
    if (!rowsOf.length || rowsOf.some((x) => !x) || (rowsOf.length === 1 && rowsOf[0].length < 2)) return;
    e.preventDefault();
    rowsOf.forEach((vals, i) => {
      const subject = subjects[r + i];
      if (!subject) return;
      const startCol = i === 0 ? c : 0;
      const nextRow = { ...(draft[subject.id] || {}) };
      const changed = [];
      vals.forEach((v, j) => {
        const h = holes[startCol + j];
        if (!h) return;
        nextRow[h.n] = v;
        touched.current.add(keyOf(subject.id, h.n));
        changed.push(h.n);
      });
      setDraft((cur) => ({ ...cur, [subject.id]: nextRow }));
      saveRow(subject, changed, nextRow);
    });
    toast(`Pasted ${rowsOf.length} row${rowsOf.length === 1 ? '' : 's'}`);
  };

  const net = isNetFormat(round.format);
  const front = holes.filter((h) => h.n <= 9);
  const hasBack = holes.length > 9;
  return (
    <div className="page desk-page" data-testid="paper-card">
      <DeskNav />
      <div className="desk-head">
        <div className="desk-head-main">
          <h1 className="hdr-title desk-title">{round.name}</h1>
          <div className="hdr-sub">{[course.name, formatName(round.format), round.play_date && fmtRange(round.play_date)].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="desk-head-side no-print">
          <Link className="btn ghost sm desk-ghost" to={TOOL.print(round.id)}>Print</Link>
          <Link className="btn ghost sm desk-ghost" to={`/?r=${round.id}`}>Leaderboard</Link>
        </div>
      </div>
      <div className="section">
        <p className="small muted" style={{ margin: '0 0 8px' }}>
          Type the strokes{round.format === 'ambrose' ? ' (the team’s score)' : ', or P for a pick-up'}. <kbd>Tab</kbd> next hole · <kbd>Enter</kbd> next {round.format === 'ambrose' ? 'team' : 'player'} · arrows to move.
          Each box saves as you leave it. Paste a whole row from a spreadsheet into the first box to fill it.
        </p>
        {locked && <div className="sync">This round is final — only an organiser can change scores.</div>}
        {scores.pendingCount > 0 && <div className="sync">{scores.pendingCount} waiting to sync — they’ll send when there’s signal.</div>}
        {!subjects.length && <div className="empty">No {round.format === 'ambrose' ? 'teams' : 'players'} in this round yet.</div>}
        {subjects.length > 0 && (
          <div className="desk-scroll pc-scroll">
            <table className="pc-grid" role="grid" aria-label={`Scorecards for ${round.name}`}>
              <thead>
                <tr><th className="pc-name">Hole</th>{holes.map((h) => <th key={h.n}>{h.n}</th>)}{hasBack && <th className="pc-tot">Out</th>}{hasBack && <th className="pc-tot">In</th>}<th className="pc-tot">Gross</th><th className="pc-tot">{net ? 'Net' : 'Pts'}</th></tr>
                <tr className="pc-par"><th className="pc-name">Par</th>{holes.map((h) => <td key={h.n}>{h.par}</td>)}{hasBack && <td>{front.reduce((s, h) => s + h.par, 0)}</td>}{hasBack && <td>{holes.filter((h) => h.n > 9).reduce((s, h) => s + h.par, 0)}</td>}<td>{holes.reduce((s, h) => s + h.par, 0)}</td><td /></tr>
                <tr className="pc-si"><th className="pc-name">Index</th>{holes.map((h) => <td key={h.n}>{h.si}</td>)}{hasBack && <td />}{hasBack && <td />}<td /><td /></tr>
              </thead>
              <tbody>
                {subjects.map((s, r) => {
                  const d = draft[s.id] || {};
                  const t = rowTotals(holes, d, s.hcp, round.format);
                  return (
                    <tr key={s.id} data-testid="pc-row">
                      <th className="pc-name" scope="row"><span className="ellipsis">{s.name}</span><span className="small muted"> {s.hcp}</span></th>
                      {holes.map((h, c) => {
                        const k = keyOf(s.id, h.n);
                        const bad = readCell(d[h.n], round.format).error;
                        const st = bad ? 'error' : state[k];
                        return (
                          <td key={h.n} className={'pc-cell' + (st ? ` ${st}` : '')}>
                            <input ref={(el) => { inputs.current[`${r}:${c}`] = el; }} className="pc-input" value={d[h.n] ?? ''} disabled={locked}
                              inputMode="numeric" maxLength={64} autoComplete="off" aria-label={`${s.name}, hole ${h.n}`} aria-invalid={!!bad} title={bad || undefined}
                              data-testid={`pc-${r}-${h.n}`}
                              onFocus={(e) => e.target.select()} onChange={(e) => setCell(s.id, h.n, e.target.value.slice(0, 2))}
                              onBlur={() => leave(s, h.n)} onKeyDown={(e) => onKey(e, r, c)} onPaste={(e) => onPaste(e, r, c)} />
                          </td>
                        );
                      })}
                      {hasBack && <td className="pc-tot">{t.out || ''}</td>}
                      {hasBack && <td className="pc-tot">{t.in || ''}</td>}
                      <td className="pc-tot" data-testid={`pc-gross-${r}`}>{t.gross || ''}</td>
                      <td className="pc-tot strong" data-testid={`pc-score-${r}`}>{!t.played ? '' : net ? formatToPar(t.netToPar) : t.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="row small muted" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
          <span><span className="pc-key saved" /> saved</span><span><span className="pc-key queued" /> waiting for signal</span><span><span className="pc-key error" /> check this box</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Print

export function PrintRound() {
  const { roundId } = useParams();
  const data = useData();
  const { status } = useSession();
  const scores = useScores(roundId);
  const round = data.rounds.find((r) => r.id === roundId);
  const course = round ? data.coursesById[round.course_id] : null;
  const holes = useMemo(() => courseHoles(course), [course]);
  const subjects = useMemo(() => cardSubjects({ round, teamsByRound: data.teamsByRound, roundPlayers: data.roundPlayers, playersById: data.playersById }), [round, data]);
  if (!data.ready) return <Loading />;
  if (!round || !course) return <div className="page desk-page"><DeskNav /><div className="empty">Round not found.</div></div>;
  const board = roundBoard({ round, course, teams: data.teamsByRound[round.id] || [], roundPlayers: data.roundPlayers[round.id] || [], playersById: data.playersById, scoresIdx: scores.index, quickResults: data.quick_results || [] });
  const net = isNetFormat(round.format);
  const saved = scores.index[round.id] || {};
  const show = (s) => (!s ? '' : s.picked_up ? 'P' : s.strokes ?? '');
  return (
    <div className="page desk-page print-page" data-testid="print-round">
      <DeskNav />
      <div className="no-print section row" style={{ gap: 8 }}>
        <button type="button" className="btn gold" onClick={() => window.print()}>🖨 Print</button>
        <Link className="btn ghost" to={TOOL.card(round.id)}>Paper cards</Link>
      </div>
      <div className="section print-sheet">
        <div className="print-title">{status.group_name || 'The Golf Trip'} — {round.name}</div>
        <div className="small muted">{[course.name, formatName(round.format), round.play_date && fmtRange(round.play_date), round.status === 'locked' ? 'Final' : 'Not final yet'].filter(Boolean).join(' · ')}</div>
        <h2 className="print-h">Results</h2>
        <table className="desk-table print-table" data-testid="print-results">
          <thead><tr><th>#</th><th>{round.format === 'ambrose' ? 'Team' : round.format === 'fourball' ? 'Pair' : 'Player'}</th><th className="num-cell">Thru</th><th className="num-cell">{net ? 'Net' : 'Points'}</th></tr></thead>
          <tbody>
            {board.rows.map((r, i) => (
              <tr key={r.id}><td>{r.thru ? r.rank ?? i + 1 : '–'}</td><td>{r.name}{r.players?.length > 1 ? <span className="small muted"> · {r.players.map(playerName).join(', ')}</span> : null}</td>
                <td className="num-cell">{r.finished ? 'F' : r.thru || '–'}</td><td className="num-cell"><strong>{!r.thru ? '–' : net ? formatToPar(r.netToPar) : r.points}</strong></td></tr>
            ))}
          </tbody>
        </table>
        <h2 className="print-h">Scorecards</h2>
        <table className="desk-table print-table card-table" data-testid="print-cards">
          <thead>
            <tr><th>Hole</th>{holes.map((h) => <th key={h.n} className="num-cell">{h.n}</th>)}<th className="num-cell">Gross</th><th className="num-cell">{net ? 'Net' : 'Pts'}</th></tr>
            <tr><th>Par</th>{holes.map((h) => <td key={h.n} className="num-cell">{h.par}</td>)}<td className="num-cell">{holes.reduce((s, h) => s + h.par, 0)}</td><td /></tr>
          </thead>
          <tbody>
            {subjects.map((s) => {
              const t = rowTotals(holes, rowDraft(holes, saved[s.id] || {}), s.hcp, round.format);
              return (
                <tr key={s.id}><th>{s.name} <span className="small muted">({s.hcp})</span></th>{holes.map((h) => <td key={h.n} className="num-cell">{show(saved[s.id]?.[h.n])}</td>)}
                  <td className="num-cell">{t.gross || ''}</td><td className="num-cell"><strong>{!t.played ? '' : net ? formatToPar(t.netToPar) : t.points}</strong></td></tr>
              );
            })}
          </tbody>
        </table>
        <div className="small muted" style={{ marginTop: 10 }}>Printed from The Golf Trip.</div>
      </div>
    </div>
  );
}
