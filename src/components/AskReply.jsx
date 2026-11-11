// ov43 — the reply screen for "Anyone keen for a round?" (claude/round-callout-v2-design.md). 10 seconds: the link opens
// straight on this grid, filled in from your usual week. Tap = can; everything unticked counts as can't. Swipe to tick
// several, tap a date or a heading to fill the line, hold a square for a note. One-tap answers, type it, "Where? Any".
// All the sums are in lib/ask.js (tested); migration 111's callout_answer checks it again.
// preview: the organiser's "Send to myself" — works the same, saves nothing.
// guest: the public link (#/a/<token>, screens/AskPublic.jsx) — no group, no sign-in: guest.submit({ slots, cant, where })
// saves it; the usual week is kept on this phone instead of the database.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature } from '../lib/store.jsx';
import { Sheet, toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import {
  askCells, askPartKeys, isLong, ASK_PARTS, finishWords, rowKey, answerSlots, quickPicks, QUICK, typedPicks, usualFrom,
  prefill, parseNote, narrow, NOTE_CHIPS, WHERE_WISHES, cleanWhere, dayWord, overlaps,
} from '../lib/ask.js';
import { DAY_KEYS, dowOf, dayLabel, clock, sydneyToday } from '../lib/callout.js';
import { CourseFinder } from './CalloutSheet.jsx';
import './callout.css';

const shortDate = (d) => dayLabel(d).split(' ').slice(0, 2).join(' ');

/** An existing answer → the picks and notes for these cells. */
function fromAnswer(cells, answer, weekly) {
  const picks = new Set(); const notes = {};
  for (const c of cells) {
    const s = (answer?.slots || []).find((x) => x.date === c.date && (c.part ? x.part === c.part : overlaps(x, c)));
    if (!s) continue;
    const k = weekly ? rowKey(c) : c.key;
    picks.add(k);
    if (s.note) notes[k] = s.note;
  }
  return { picks, notes };
}

export const USUAL_KEY = 'tgt-usual-week';
const localUsual = () => { try { return JSON.parse(localStorage.getItem(USUAL_KEY) || 'null'); } catch { return null; } };

export default function AskReply({ plan, answer = null, preview = false, guest = null, onSent }) {
  const data = useData() || { courses: [] };
  const { status } = useSession() || {};
  const today = sydneyToday();
  const notesOn = useFeature('ask_notes') !== false;
  const whereOn = useFeature('ask_where') !== false;
  const usualOn = useFeature('ask_usual_week') !== false;
  const ask = plan.ask || {};
  const cells = useMemo(() => askCells(ask, today), [JSON.stringify(ask), today]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekly = isLong(ask, today);
  const parts = askPartKeys(ask);
  const gridCells = cells.filter((c) => c.part);
  const exactCells = cells.filter((c) => !c.part);
  const dows = useMemo(() => [...new Set(cells.map((c) => DAY_KEYS[dowOf(c.date)]))].sort((a, b) => ((DAY_KEYS.indexOf(a) + 6) % 7) - ((DAY_KEYS.indexOf(b) + 6) % 7)), [cells]);
  const allDates = useMemo(() => [...new Set(gridCells.map((c) => c.date))], [gridCells]);
  const k = (c) => (weekly ? rowKey(c) : c.key);

  const [picks, setPicks] = useState(() => new Set());
  const [notes, setNotes] = useState({});
  const [usual, setUsual] = useState(null);
  const [filled, setFilled] = useState(answer ? 'answer' : null); // 'answer' | 'usual' | null
  const [hidden, setHidden] = useState(() => new Set()); // "Show only" — hidden days count as can't
  const [cant, setCant] = useState(() => new Set()); // long asks: dates marked can't
  const [typed, setTyped] = useState('');
  const [noteFor, setNoteFor] = useState(null);
  const [noteMode, setNoteMode] = useState(false);
  const [where, setWhere] = useState({ courses: [], wishes: [], note: '' });
  const [whereOpen, setWhereOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const [busy, run] = useRun();

  // Fill in: your answer if you've sent one, else your usual week.
  useEffect(() => {
    if (answer) {
      const f = fromAnswer(cells, answer, weekly);
      setPicks(f.picks); setNotes(f.notes); setFilled('answer');
      if (answer.where && Object.keys(answer.where).length) setWhere({ courses: answer.where.courses || [], wishes: answer.where.wishes || [], note: answer.where.note || '' });
      return;
    }
    if (preview || !usualOn) return;
    if (guest) {
      const u = localUsual();
      if (!u) return;
      setUsual(u);
      const f = prefill(cells, u, { weekly });
      if (f.picks.size) { setPicks(f.picks); setNotes(f.notes); setFilled('usual'); }
      return;
    }
    if (!status?.player_id) return;
    supabase.from('player_usual_weeks').select('usual,where').eq('group_id', plan.group_id).eq('player_id', status.player_id).maybeSingle().then(({ data: u }) => {
      if (!u) return;
      setUsual(u.usual);
      const f = prefill(cells, u.usual, { weekly });
      if (f.picks.size) { setPicks(f.picks); setNotes(f.notes); setFilled('usual'); }
      if (u.where?.courses) setWhere({ courses: u.where.courses || [], wishes: u.where.wishes || [], note: u.where.note || '' });
    }, () => {});
  }, [answer?.updated_at, cells.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- tapping, swiping, holding
  const drag = useRef(null);
  const setKeys = (keys, on) => setPicks((cur) => { const n = new Set(cur); keys.forEach((x) => (on ? n.add(x) : n.delete(x))); return n; });
  const down = (key, e) => {
    if (noteMode) { setNoteMode(false); setKeys([key], true); setNoteFor(key); return; }
    const timer = notesOn ? setTimeout(() => { drag.current = { ...drag.current, held: true }; setKeys([key], true); setNoteFor(key); }, 550) : null;
    drag.current = { start: key, paint: !picks.has(key), moved: false, held: false, timer, seen: new Set([key]) };
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* fine */ }
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || d.held) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-cell]');
    const key = el?.getAttribute('data-cell');
    if (!key || d.seen.has(key)) return;
    clearTimeout(d.timer);
    if (!d.moved) { d.moved = true; setKeys([d.start], d.paint); }
    d.seen.add(key);
    setKeys([key], d.paint);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    clearTimeout(d.timer);
    if (!d.moved && !d.held) setKeys([d.start], d.paint);
  };
  useEffect(() => { const f = () => up(); window.addEventListener('pointerup', f); return () => window.removeEventListener('pointerup', f); });

  const rowKeys = (r) => gridCells.filter((c) => (weekly ? DAY_KEYS[dowOf(c.date)] === r : c.date === r)).map(k);
  const colKeys = (p) => gridCells.filter((c) => c.part === p && !hidden.has(DAY_KEYS[dowOf(c.date)])).map(k);
  const fill = (keys) => { const all = keys.length && keys.every((x) => picks.has(x)); setKeys(keys, !all); };

  const rows = weekly ? dows.filter((d) => !hidden.has(d)) : allDates.filter((d) => !hidden.has(DAY_KEYS[dowOf(d)]));
  const shownCells = cells.filter((c) => !hidden.has(DAY_KEYS[dowOf(c.date)]));
  const slots = useMemo(() => answerSlots(shownCells, picks, { notes, weekly, cantDates: [...cant] }), [shownCells, picks, notes, weekly, cant]);

  const typedNow = useMemo(() => (typed.trim() ? typedPicks(typed, shownCells, { weekly }) : null), [typed, shownCells, weekly]);
  const applyTyped = () => { if (typedNow?.understood) { setPicks(typedNow.picks); setTyped(''); } };

  const send = (cantRound = false) => run(async () => {
    if (!cantRound && !slots.length) { toast('Tick at least one time — or tap “Can’t this round”'); return; }
    if (preview) { toast(cantRound ? 'Preview: “Can’t this round” sent' : `Preview: ${slots.length} time${slots.length === 1 ? '' : 's'} sent — nothing saved`); onSent?.(); return; }
    const w = whereOn ? cleanWhere(where) : null;
    if (guest) {
      await guest.submit({ slots: cantRound ? null : slots, cant: cantRound, where: w });
      if (!cantRound) { try { localStorage.setItem(USUAL_KEY, JSON.stringify(usualFrom(shownCells, picks, { weekly, notes, before: usual }))); } catch { /* fine */ } }
      onSent?.();
      return;
    }
    await must(supabase.rpc('callout_answer', {
      p_plan: plan.id, p_slots: cantRound ? null : slots, p_cant: cantRound, p_where: w,
      p_usual: !cantRound && usualOn ? usualFrom(shownCells, picks, { weekly, notes, before: usual }) : null,
    }));
    toast(cantRound ? 'Got it — you won’t be nagged about this one' : 'Sent — you’ll hear when it’s locked in');
    onSent?.();
  });

  const cellView = (c) => {
    const key = k(c);
    const on = picks.has(key);
    const dead = weekly ? false : cant.has(c.date);
    const n = notes[key];
    const ruledOut = on && n && !narrow(c.from, c.to, n);
    return (
      <button key={key} type="button" data-cell={key} className={`ask-cell${on ? ' on' : ''}${ruledOut ? ' out' : ''}`} aria-pressed={on} disabled={dead}
        aria-label={`${weekly ? dayWord(DAY_KEYS[dowOf(c.date)]) : shortDate(c.date)} ${ASK_PARTS[c.part].label}${on ? ', can' : ''}${n ? `, note: ${n}` : ''}`}
        onPointerDown={(e) => down(key, e)} onContextMenu={(e) => e.preventDefault()} data-testid="ask-cell">
        {on ? '✓' : ''}{n ? <span className="ask-dot" aria-hidden="true">•</span> : null}
      </button>
    );
  };

  return (
    <div className="stack" style={{ gap: 12 }} data-testid="ask-reply">
      {filled === 'usual' && <span className="small muted" data-testid="ask-prefilled">Filled in from your usual week — change anything.</span>}
      {filled === 'answer' && <span className="small muted">Your answer — change it and send again. You keep your place.</span>}

      {/* One-tap answers */}
      <div className="co-chips" role="group" aria-label="Quick answers" data-testid="ask-quick">
        {QUICK.map((q) => <button key={q.key} type="button" className="chip" onClick={() => setPicks(quickPicks(q.key, shownCells, { weekly }))}>{q.label}</button>)}
        <button type="button" className="chip" onClick={() => setPicks(new Set())}>Clear</button>
      </div>

      {/* Show only */}
      {dows.length > 1 && (
        <div className="co-chips ask-showonly" role="group" aria-label="Show only these days" data-testid="ask-showonly">
          <span className="small muted" style={{ alignSelf: 'center' }}>Show</span>
          {dows.map((d) => <button key={d} type="button" className="chip" aria-pressed={!hidden.has(d)} onClick={() => { const n = new Set(hidden); if (n.has(d)) n.delete(d); else if (n.size < dows.length - 1) n.add(d); setHidden(n); }}>{dayWord(d)}</button>)}
        </div>
      )}

      {/* The grid */}
      <div className="ask-grid" style={{ gridTemplateColumns: `74px repeat(${parts.length}, 1fr)` }} onPointerMove={move} data-testid="ask-grid">
        <span />
        {parts.map((p) => (
          <button key={p} type="button" className="ask-head" onClick={() => fill(colKeys(p))} data-testid="ask-head">
            <strong>{ASK_PARTS[p].label}</strong><span>{finishWords(allDates[0] || today, p)}</span>
          </button>
        ))}
        {rows.map((r) => (
          <React.Fragment key={r}>
            <button type="button" className="ask-rowhead" onClick={() => fill(rowKeys(r))} data-testid="ask-rowhead">
              {weekly ? <strong>{dayWord(r)}s</strong> : <><strong>{shortDate(r).split(' ')[0]}</strong> {shortDate(r).split(' ')[1]}</>}
            </button>
            {parts.map((p) => {
              const c = weekly ? gridCells.find((x) => DAY_KEYS[dowOf(x.date)] === r && x.part === p) : gridCells.find((x) => x.date === r && x.part === p);
              return c ? cellView(c) : <span key={p} />;
            })}
          </React.Fragment>
        ))}
      </div>
      {notesOn && (
        <span className="small muted" data-testid="ask-hint">
          Tap = can · swipe to tick several · tap a day or heading to fill it · hold a square for a note{' '}
          <button type="button" className="linkish" onClick={() => setNoteMode(!noteMode)} data-testid="ask-add-note">{noteMode ? '(tap a square…)' : '· add a note'}</button>
        </span>
      )}

      {/* Long asks: a strip of dates to mark can't */}
      {weekly && (
        <details className="co-more" data-testid="ask-cant-strip">
          <summary>Away some dates? Mark them can’t{cant.size ? ` (${cant.size})` : ''}</summary>
          <div className="ask-strip">
            {allDates.filter((d) => !hidden.has(DAY_KEYS[dowOf(d)])).map((d) => (
              <button key={d} type="button" className="chip" aria-pressed={cant.has(d)} onClick={() => { const n = new Set(cant); if (n.has(d)) n.delete(d); else n.add(d); setCant(n); }}>
                {cant.has(d) ? '✗ ' : ''}{shortDate(d)}
              </button>
            ))}
          </div>
        </details>
      )}

      {/* Exact times the organiser added */}
      {exactCells.length > 0 && (
        <div className="co-chips" data-testid="ask-exact">
          {exactCells.map((c) => <button key={c.key} type="button" className="chip" aria-pressed={picks.has(k(c))} onClick={() => setKeys([k(c)], !picks.has(k(c)))}>{shortDate(c.date)} · {clock(c.from)}</button>)}
        </div>
      )}

      {/* Type it */}
      <div className="row" style={{ gap: 8 }}>
        <input className="input grow" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyTyped(); }}
          placeholder="Or type it: fri arvos and any Sunday" aria-label="Type when you can play" data-testid="ask-typed" />
        <button type="button" className="btn ghost sm" disabled={!typedNow?.understood} onClick={applyTyped}>Fill</button>
      </div>
      {typed.trim() && !typedNow?.understood && <span className="small muted">Try days and times of day — “sat morning”, “weekends”, “after work”.</span>}

      {/* Where? */}
      {whereOn && (
        <div className="stack" style={{ gap: 6 }} data-testid="ask-where">
          <button type="button" className="ask-whereline" onClick={() => setWhereOpen(!whereOpen)}>
            <span>📍 Where?</span>
            <strong>{where.courses.length ? where.courses.map((c) => c.name).join(', ') : 'Any'}{where.wishes.length ? ` · ${where.wishes.map((w) => WHERE_WISHES.find((x) => x.key === w)?.label.toLowerCase()).join(', ')}` : ''}</strong>
            <span className="muted">{whereOpen ? '▴' : '▾'}</span>
          </button>
          {whereOpen && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="co-chips">
                <button type="button" className="chip" aria-pressed={!where.courses.length} onClick={() => setWhere({ ...where, courses: [] })}>Any</button>
                {!guest && data.courses.slice(0, 6).map((c) => {
                  const on = where.courses.some((x) => x.kind === 'group' && x.id === c.id);
                  return <button key={c.id} type="button" className="chip" aria-pressed={on} onClick={() => setWhere({ ...where, courses: on ? where.courses.filter((x) => x.id !== c.id) : [...where.courses, { kind: 'group', id: c.id, name: c.name }].slice(0, 6) })}>{c.name}</button>;
                })}
                {where.courses.filter((x) => x.kind === 'library').map((x) => <button key={x.id} type="button" className="chip" aria-pressed="true" onClick={() => setWhere({ ...where, courses: where.courses.filter((y) => y.id !== x.id) })}>{x.name} ✕</button>)}
                {!guest && <button type="button" className="chip" aria-pressed={finding} onClick={() => setFinding(!finding)}>+ Somewhere else</button>}
              </div>
              {finding && <CourseFinder onPick={(c) => { setWhere({ ...where, courses: [...where.courses.filter((x) => x.id !== c.id), c].slice(0, 6) }); setFinding(false); }} />}
              <div className="co-chips">
                {WHERE_WISHES.map((w) => { const on = where.wishes.includes(w.key); return <button key={w.key} type="button" className="chip" aria-pressed={on} onClick={() => setWhere({ ...where, wishes: on ? where.wishes.filter((x) => x !== w.key) : [...where.wishes, w.key] })}>{w.label}</button>; })}
              </div>
              <input className="input" value={where.note} onChange={(e) => setWhere({ ...where, note: e.target.value })} maxLength={120} placeholder="A line, e.g. “not Moore Park again”" aria-label="Where note" />
            </div>
          )}
        </div>
      )}

      <button type="button" className="btn gold block" style={{ minHeight: 56 }} disabled={busy} onClick={() => send(false)} data-testid="ask-send">
        {slots.length ? `Send — I can make ${slots.length} time${slots.length === 1 ? '' : 's'}` : 'Send'}
      </button>
      <button type="button" className="btn ghost block" disabled={busy} onClick={() => send(true)} data-testid="ask-cant">Can’t this round</button>

      {noteFor && (
        <NoteSheet cell={cells.find((c) => k(c) === noteFor) || null} weekly={weekly} value={notes[noteFor] || ''}
          onClose={() => setNoteFor(null)}
          onSave={(t) => { setNotes((cur) => { const n = { ...cur }; if (t) n[noteFor] = t; else delete n[noteFor]; return n; }); setNoteFor(null); }} />
      )}
    </div>
  );
}

/** Hold a square → a note. The app reads "only after…", "must finish by…", "9 holes only". */
function NoteSheet({ cell, weekly, value, onClose, onSave }) {
  const [t, setT] = useState(value);
  if (!cell) return null;
  const w = narrow(cell.from, cell.to, t);
  const n = parseNote(t);
  const title = `${weekly ? `${dayWord(DAY_KEYS[dowOf(cell.date)])}s` : shortDate(cell.date)} · ${ASK_PARTS[cell.part]?.label || clock(cell.from)}`;
  return (
    <Sheet title={`📝 ${title}`} onClose={onClose}>
      <div className="stack" style={{ gap: 10 }} data-testid="ask-note-sheet">
        <div className="co-chips">{NOTE_CHIPS.map((c) => <button key={c.key} type="button" className="chip" onClick={() => setT(t ? `${t}, ${c.fill}` : c.fill)}>{c.label}</button>)}</div>
        <input className="input" autoFocus value={t} onChange={(e) => setT(e.target.value)} maxLength={120} placeholder="e.g. only after 9 · must finish by 12 · 9 holes only" data-testid="ask-note-input" />
        <span className="small muted" data-testid="ask-note-read">
          {!t.trim() ? 'The app reads times — “after 9”, “finish by 12” — and “9 holes”.'
            : w ? `So: tee off ${clock(w.from)}${w.from === w.to ? '' : `–${clock(w.to)}`}${n.nine ? ' · 9 holes' : ''}.` : 'That rules this square out — it won’t count.'}
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn gold grow" onClick={() => onSave(t.trim())} data-testid="ask-note-save">Save note</button>
          {value && <button type="button" className="btn ghost" onClick={() => onSave('')}>Remove</button>}
        </div>
      </div>
    </Sheet>
  );
}
