// ov43 v2.1 — the reply screen for "Anyone keen for a round?" (claude/round-ask-v2-1-rethink.md, Josh 12 Nov 2026).
//   * The Caddie box at the top: "Tell the Caddie when you can play". Easy phrases fill instantly on the phone
//     (lib/ask.js quickFill); anything else goes to the AI (the ask-fill function, capped), which fills the grid and
//     shows what it changed, with Undo. Works on the no-sign-in link too.
//   * "Your week" first: Mon–Sun × parts of the day, every square ? to start. Tap cycles ✓ → ✗ → ?. Only ✓ counts
//     toward a tee time; ? shows as maybe. "Show the dates ▾" opens every date, by week, filled in from your week — change
//     just the exceptions (marked). Short asks (a week or less) and picked dates go straight to the dates.
//   * Where, always open: where you'll leave from (one or more places, each with its own days and max drive) and the
//     courses near you, by drive. The organiser's card ranks courses by everyone's drive.
// All the sums are in lib/ask.js (tested); migration 111/112's callout_answer / ask_guest_answer check it again.
// preview: the organiser's "Send to myself" — works the same, saves nothing (no AI: it isn't sent yet).
// guest: the public link (#/a/<token>) — guest.submit({ slots, cant, where }); the usual week stays on this phone.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature } from '../lib/store.jsx';
import { toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import {
  askCells, askPartKeys, ASK_PARTS, finishWords, rowKey, dayWord, weekFirst, weekRows, weeksOf, spanWords, statusOf,
  isException, setWeek, setDates, everythingElse, counts, slotsFrom, stateFromAnswer, usualFrom2, stateFromUsual, narrow,
  emptyState, nextStatus, quickFill, cleanFill, applyFill, fillContext, cleanWhere2, cleanFrom, fromDaysWords, fromDaySet,
  personDrive, DRIVE_CHOICES, DEFAULT_DRIVE, MAX_FROM, WEEK_DAYS, MARK, YES, NO, MAYBE,
} from '../lib/ask.js';
import { dayLabel, clock, sydneyToday } from '../lib/callout.js';
import { fmtDrive } from '../lib/tripfinder.js';
import PlaceSearch from './PlaceSearch.jsx';
import './callout.css';

const shortDate = (d) => dayLabel(d).split(' ').slice(0, 2).join(' ');
const CLS = { y: 'y', n: 'n', '?': 'm' };

export const USUAL_KEY = 'tgt-usual-week';
export const USUAL_WHERE_KEY = 'tgt-usual-where';
const DEVICE_KEY = 'tgt-device';
const readLocal = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* fine */ } };
/** A random id for this phone (the AI cap's "person" before they've answered). */
export function deviceId() {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) {
      const a = new Uint8Array(18); crypto.getRandomValues(a);
      d = Array.from(a, (x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join('');
      localStorage.setItem(DEVICE_KEY, d);
    }
    return d;
  } catch { return null; }
}

const emptyWhere = () => ({ courses: [], wishes: [], note: '', from: [], avoid: [] });
const whereFrom = (w) => ({ courses: w?.courses || [], wishes: w?.wishes || [], note: w?.note || '', from: (w?.from || []).map(cleanFrom).filter(Boolean), avoid: w?.avoid || [] });

export default function AskReply({ plan, answer = null, preview = false, guest = null, token = null, onSent }) {
  const data = useData() || { courses: [] };
  const { status } = useSession() || {};
  const today = sydneyToday();
  const whereOn = useFeature('ask_where') !== false;
  const usualOn = useFeature('ask_usual_week') !== false;
  const ask = plan.ask || {};
  const tok = token || plan.ask_token || null;
  const cells = useMemo(() => askCells(ask, today), [JSON.stringify(ask), today]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekView = weekFirst(ask, today);
  const parts = askPartKeys(ask);
  const gridCells = cells.filter((c) => c.part);
  const exactCells = cells.filter((c) => !c.part);
  const rows = weekRows(cells);
  const weeks = useMemo(() => weeksOf(gridCells), [gridCells]);

  const [st, setSt] = useState(emptyState);
  const [notes, setNotes] = useState({});
  const [usual, setUsual] = useState(null);
  const [filled, setFilled] = useState(answer ? 'answer' : null); // 'answer' | 'usual' | null
  const [showDates, setShowDates] = useState(false);
  const [where, setWhere] = useState(emptyWhere);
  const [said, setSaid] = useState('');
  const [result, setResult] = useState(null); // { words, said, undo: { st, notes, where }, changed: Set }
  const [thinking, setThinking] = useState(false);
  const [busy, run] = useRun();

  // Fill in: your answer if you've sent one, else your usual week.
  useEffect(() => {
    if (answer) {
      const f = stateFromAnswer(cells, answer, { weekView });
      setSt(f.st); setNotes(f.notes); setFilled('answer');
      if (answer.where && Object.keys(answer.where).length) setWhere(whereFrom(answer.where));
      return;
    }
    if (preview || !usualOn) return;
    if (guest) {
      const u = readLocal(USUAL_KEY);
      const w = readLocal(USUAL_WHERE_KEY);
      if (w) setWhere(whereFrom(w));
      if (!u) return;
      setUsual(u);
      const f = stateFromUsual(u);
      if (Object.keys(f.st.week).length) { setSt(f.st); setNotes(f.notes); setFilled('usual'); }
      return;
    }
    if (!status?.player_id) return;
    supabase.from('player_usual_weeks').select('usual,where').eq('group_id', plan.group_id).eq('player_id', status.player_id).maybeSingle().then(({ data: u }) => {
      if (!u) return;
      setUsual(u.usual);
      const f = stateFromUsual(u.usual);
      if (Object.keys(f.st.week).length) { setSt(f.st); setNotes(f.notes); setFilled('usual'); }
      if (u.where && Object.keys(u.where).length) setWhere(whereFrom(u.where));
    }, () => {});
  }, [answer?.updated_at, cells.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- tapping and swiping (a swipe paints what the first square turned into)
  const drag = useRef(null);
  const paint = (kind, keys, s) => setSt((cur) => (kind === 'week' ? setWeek(cur, keys, s, cells) : setDates(cur, keys, s, cells)));
  const down = (kind, key, now) => {
    const to = nextStatus(now);
    drag.current = { kind, to, seen: new Set([key]) };
    paint(kind, [key], to);
    setResult(null);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-sq]');
    const key = el?.getAttribute('data-sq');
    if (!key || el.getAttribute('data-kind') !== d.kind || d.seen.has(key)) return;
    d.seen.add(key);
    paint(d.kind, [key], d.to);
  };
  useEffect(() => { const f = () => { drag.current = null; }; window.addEventListener('pointerup', f); return () => window.removeEventListener('pointerup', f); }, []);

  /** A heading tap: all the same → the next status; mixed → ✓. */
  const cycleAll = (kind, keys, statuses) => {
    if (!keys.length) return;
    const same = statuses.every((s) => s === statuses[0]);
    paint(kind, keys, same ? nextStatus(statuses[0]) : YES);
    setResult(null);
  };
  const weekStatus = (rk) => st.week[rk] || MAYBE;

  // ---- the Caddie box
  const tell = (text) => run(async () => {
    const t = String(text || '').trim();
    if (t.length < 2) return;
    const before = { st, notes, where };
    const q = quickFill(t, cells, st, { weekView });
    if (q.ok) {
      const changed = new Set(cells.filter((c) => statusOf(c, q.st) !== statusOf(c, st)).map((c) => c.key));
      setSt(q.st); setSaid('');
      setResult({ words: q.words, said: '', undo: before, changed });
      return;
    }
    if (preview || !tok) { toast('Easy ones work here (“weekends”, “fri arvos”, “not the 21st”). The Caddie reads the rest once it’s sent.'); return; }
    setThinking(true);
    try {
      const key = guest ? guest.key : null;
      const { data: r, error } = await supabase.functions.invoke('ask-fill', { body: { token: tok, text: t, key, device: deviceId() } });
      if (error || !r) { toast('Couldn’t reach the Caddie — tap the squares instead.'); return; }
      if (r.error) { toast(r.error); return; }
      const ctx = fillContext(ask, today);
      const fill = cleanFill(r.fill, { dates: ctx.dates.map((d) => d.slice(0, 10)), parts }); // cleaned again on the phone
      const a = applyFill(fill, cells, st, notes, { weekView });
      setSt(a.st); setNotes(a.notes);
      // Where: new places (by name, with a spot if the server found one), courses to avoid, a line.
      if (fill.where.from.length || fill.where.avoid.length || fill.where.note || fill.where.like.length) {
        setWhere((w) => {
          const have = new Set(w.from.map((f) => f.label.toLowerCase()));
          const from = [...w.from, ...fill.where.from.filter((f) => !have.has(f.label.toLowerCase())).map((f) => cleanFrom({ ...f, max_min: f.max_min || DEFAULT_DRIVE }))].filter(Boolean).slice(0, MAX_FROM);
          const avoid = [...new Set([...(w.avoid || []), ...fill.where.avoid])].slice(0, 6);
          const note = [w.note, fill.where.note, fill.where.like.length ? `keen on ${fill.where.like.join(', ')}` : ''].filter(Boolean).join(' · ').slice(0, 120);
          return { ...w, from, avoid, note };
        });
      }
      setSaid(fill.said);
      const placeWords = fill.where.from.map((f) => `📍 ${f.label}${f.days.length ? ` (${fromDaysWords(f.days)})` : ''}`);
      setResult({ words: [...a.words, ...placeWords, ...(fill.where.avoid.length ? [`not ${fill.where.avoid.join(', ')}`] : [])], said: fill.said, undo: before, changed: new Set(a.changed), left: r.remaining });
      if (a.changed.some((k) => isException(cells.find((c) => c.key === k), a.st))) setShowDates(true);
    } finally { setThinking(false); }
  });
  const undo = () => { if (!result?.undo) return; setSt(result.undo.st); setNotes(result.undo.notes); setWhere(result.undo.where); setResult(null); setSaid(''); };

  // ---- sending
  const shownCells = cells;
  const slots = useMemo(() => slotsFrom(shownCells, st, notes), [shownCells, st, notes]);
  const n = counts(shownCells, st);
  const send = (cantRound = false) => run(async () => {
    const cant = cantRound || !slots.length; // everything ✗ = can't this round
    if (preview) { toast(cant ? 'Preview: “Can’t this round” sent' : `Preview: ✓ ${n.y} · ? ${n['?']} sent — nothing saved`); onSent?.(); return; }
    const w = whereOn ? cleanWhere2(where) : null;
    const u = !cant && usualOn ? usualFrom2(shownCells, st, notes, usual) : null;
    if (guest) {
      await guest.submit({ slots: cant ? null : slots, cant, where: w });
      if (u) writeLocal(USUAL_KEY, u);
      if (w) writeLocal(USUAL_WHERE_KEY, w);
      onSent?.();
      return;
    }
    await must(supabase.rpc('callout_answer', { p_plan: plan.id, p_slots: cant ? null : slots, p_cant: cant, p_where: w, p_usual: u }));
    toast(cant ? 'Got it — you won’t be nagged about this one' : 'Sent — you’ll hear when it’s locked in');
    onSent?.();
  });

  // ---- squares
  const square = (kind, key, s, c, label) => {
    const note = kind === 'week' ? notes[key] : (notes[key] || (c?.part ? notes[rowKey(c)] : null));
    const ex = kind === 'date' && c && isException(c, st);
    const ref = c || gridCells.find((x) => rowKey(x) === key);
    const out = s !== NO && note && ref && !narrow(ref.from, ref.to, note); // e.g. "home by 12" on an arvo: won't count
    return (
      <button key={key} type="button" data-sq={key} data-kind={kind} className={`ask-cell ${out ? 'out' : CLS[s]}${ex ? ' ex' : ''}${result?.changed?.has(key) ? ' changed' : ''}`}
        aria-label={`${label}: ${s === YES ? 'can' : s === NO ? 'can’t' : 'not said'}${note ? `, note: ${note}` : ''}${out ? ' (rules it out)' : ''}${ex ? ', changed from your week' : ''}`}
        onPointerDown={(e) => { try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* fine */ } down(kind, key, s); }}
        onContextMenu={(e) => e.preventDefault()} data-testid={kind === 'week' ? 'ask-wsq' : 'ask-dsq'}>
        {MARK[s]}{note ? <span className="ask-dot" aria-hidden="true">•</span> : null}
      </button>
    );
  };
  const heads = (onHead) => (
    <>
      <span />
      {parts.map((p) => (
        <button key={p} type="button" className="ask-head" onClick={() => onHead(p)} data-testid="ask-head">
          <strong>{ASK_PARTS[p].label}</strong><span>{finishWords(gridCells[0]?.date || today, p)}</span>
        </button>
      ))}
    </>
  );
  const datesGrid = (dates, testid) => (
    <div className="ask-grid" style={{ gridTemplateColumns: `74px repeat(${parts.length}, 1fr)` }} onPointerMove={move} data-testid={testid}>
      {heads((p) => { const cs = gridCells.filter((c) => c.part === p && dates.includes(c.date)); cycleAll('date', cs.map((c) => c.key), cs.map((c) => statusOf(c, st))); })}
      {dates.map((d) => (
        <React.Fragment key={d}>
          <button type="button" className="ask-rowhead" onClick={() => { const cs = gridCells.filter((c) => c.date === d); cycleAll('date', cs.map((c) => c.key), cs.map((c) => statusOf(c, st))); }}>
            <strong>{shortDate(d).split(' ')[0]}</strong> {shortDate(d).split(' ')[1]}
          </button>
          {parts.map((p) => { const c = gridCells.find((x) => x.date === d && x.part === p); return c ? square('date', c.key, statusOf(c, st), c, `${shortDate(d)} ${ASK_PARTS[p].label}`) : <span key={p} />; })}
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div className="stack" style={{ gap: 14 }} data-testid="ask-reply">
      {/* The Caddie box */}
      <CaddieBox onTell={tell} busy={busy || thinking} thinking={thinking} said={said} result={result} onUndo={undo} onOk={() => setResult(null)} canAi={!preview && !!tok} />

      {filled === 'usual' && !result && <span className="small muted" data-testid="ask-prefilled">Filled in from your usual week — change anything.</span>}
      {filled === 'answer' && !result && <span className="small muted">Your answer — change it and send again. You keep your place.</span>}

      {/* Your week (or the dates, for a short ask) */}
      <div className="stack" style={{ gap: 8 }}>
        <div className="ask-week-title">
          <strong>{weekView ? 'Your week' : 'The dates'}</strong>
          <span className="small muted" data-testid="ask-span">{weekView ? `Applies to every week, ${spanWords(gridCells)}` : spanWords(gridCells)}</span>
        </div>
        <div className="ask-legend" aria-hidden="true"><span>Tap: ? → ✓ → ✗</span><span><b className="y">✓</b> can</span><span><b className="n">✗</b> can’t</span><span><b className="m">?</b> not said</span></div>
        <div className="co-chips" role="group" aria-label="Quick answers" data-testid="ask-quick">
          <button type="button" className="chip" onClick={() => { setSt(everythingElse(st, cells, NO, { weekView })); setResult(null); }} data-testid="ask-else-no">Everything else ✗</button>
          <button type="button" className="chip" onClick={() => { setSt(everythingElse(st, cells, YES, { weekView })); setResult(null); }} data-testid="ask-else-yes">Everything else ✓</button>
          <button type="button" className="chip" onClick={() => { setSt(emptyState()); setNotes({}); setResult(null); }}>Clear</button>
        </div>

        {weekView ? (
          <div className="ask-grid" style={{ gridTemplateColumns: `74px repeat(${parts.length}, 1fr)` }} onPointerMove={move} data-testid="ask-grid">
            {heads((p) => { const ks = rows.map((d) => `${d}|${p}`); cycleAll('week', ks, ks.map(weekStatus)); })}
            {rows.map((d) => (
              <React.Fragment key={d}>
                <button type="button" className="ask-rowhead" onClick={() => { const ks = parts.map((p) => `${d}|${p}`); cycleAll('week', ks, ks.map(weekStatus)); }} data-testid="ask-rowhead">
                  <strong>{dayWord(d)}s</strong>
                </button>
                {parts.map((p) => square('week', `${d}|${p}`, weekStatus(`${d}|${p}`), null, `${dayWord(d)}s ${ASK_PARTS[p].label}`))}
              </React.Fragment>
            ))}
          </div>
        ) : weeks.map((w) => (
          <div key={w.monday} className="stack" style={{ gap: 4 }}>
            {weeks.length > 1 && <span className="small muted">Week of {shortDate(w.monday)}</span>}
            {datesGrid(w.dates, 'ask-grid')}
          </div>
        ))}
        {Object.keys(notes).length > 0 && (
          <span className="small muted" data-testid="ask-notes">📝 {Object.entries(notes).map(([k, v]) => `${noteWhere(k)}: ${v}`).join(' · ')}</span>
        )}

        {weekView && (
          <>
            <button type="button" className="ask-dates-toggle" onClick={() => setShowDates(!showDates)} aria-expanded={showDates} data-testid="ask-show-dates">
              {showDates ? 'Hide the dates ▴' : `Show the dates ▾`}{Object.keys(st.dates).length ? ` (${Object.keys(st.dates).length} changed)` : ''}
            </button>
            {showDates && (
              <div className="stack" style={{ gap: 6 }} data-testid="ask-dates">
                <span className="small muted">Filled in from your week. Change just the dates that are different — they’re outlined in gold.</span>
                {weeks.map((w) => (
                  <div key={w.monday} className="ask-weekblock">
                    <strong className="small">Week of {shortDate(w.monday)}</strong>
                    {datesGrid(w.dates, 'ask-week-dates')}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Exact times the organiser added */}
      {exactCells.length > 0 && (
        <div className="stack" style={{ gap: 6 }} data-testid="ask-exact">
          <span className="label">Exact times on offer</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {exactCells.map((c) => (
              <div key={c.key} className="row" style={{ gap: 6, alignItems: 'center' }}>
                <span className="small">{shortDate(c.date)} · {clock(c.from)}</span>
                <div style={{ width: 56 }}>{square('date', c.key, statusOf(c, st), c, `${shortDate(c.date)} ${clock(c.from)}`)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Where — always open */}
      {whereOn && <WhereBox where={where} setWhere={setWhere} guest={!!guest} token={tok} courses={data.courses || []} />}

      <button type="button" className="btn gold block" style={{ minHeight: 56 }} disabled={busy} onClick={() => send(false)} data-testid="ask-send">
        {slots.length ? `Send — ✓ ${n.y}${n['?'] ? ` · ? ${n['?']}` : ''}` : 'Send'}
      </button>
      {!n.y && n['?'] > 0 && <span className="small muted" style={{ marginTop: -8 }}>Nothing ✓ yet — the ? squares go as “maybe”, which never books you in.</span>}
      <button type="button" className="btn ghost block" disabled={busy} onClick={() => send(true)} data-testid="ask-cant">Can’t this round</button>
    </div>
  );
}

const noteWhere = (k) => {
  const [a, p] = k.split('|');
  const part = ASK_PARTS[p]?.label.toLowerCase() || p;
  return /^\d{4}-/.test(a) ? `${shortDate(a)} ${part}` : `${dayWord(a)}s ${part}`;
};

/** "Tell the Caddie when you can play." */
function CaddieBox({ onTell, busy, thinking, result, onUndo, onOk, canAi }) {
  const [t, setT] = useState('');
  return (
    <div className="ask-caddie" data-testid="ask-caddie">
      <label htmlFor="ask-caddie-text"><strong>🗣️ Tell the Caddie when you can play</strong></label>
      <textarea id="ask-caddie-text" className="input" value={t} maxLength={300} onChange={(e) => setT(e.target.value)} data-testid="ask-caddie-text"
        placeholder="e.g. any arvo except the 21st, Sundays home by 12, from Leichhardt on weekends"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onTell(t); } }} />
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button type="button" className="btn gold sm" disabled={busy || t.trim().length < 2} onClick={() => onTell(t)} data-testid="ask-caddie-go">{thinking ? 'Thinking…' : 'Fill it in'}</button>
        <span className="small muted">{canAi ? 'Or just tap the squares below.' : 'Easy ones fill here — or tap the squares.'}</span>
      </div>
      {result && (
        <div className="ask-filled" data-testid="ask-filled">
          {result.said && <strong className="small">{result.said}</strong>}
          <span className="small">Filled in: {result.words.join(' · ') || 'nothing new'} — changed squares are dashed. Check it, then send.</span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn ghost sm" onClick={() => { onOk(); setT(''); }} data-testid="ask-filled-ok">Looks right</button>
            <button type="button" className="btn ghost sm" onClick={onUndo} data-testid="ask-filled-undo">↺ Undo</button>
          </div>
          {result.left && typeof result.left.you === 'number' && result.left.you <= 2 && <span className="small muted">{result.left.you} more Caddie go{result.left.you === 1 ? '' : 'es'} on this one.</span>}
        </div>
      )}
    </div>
  );
}

/** Where — leaving from (one or more places, each with its days and max drive) and the courses near you, by drive. */
function WhereBox({ where, setWhere, guest, token, courses }) {
  const [adding, setAdding] = useState(false);
  const [near, setNear] = useState([]);
  const first = where.from.find((f) => f.lat != null);
  const search = token ? async (term) => { const { data } = await supabase.rpc('ask_places', { p_token: token, p_query: term }); return data || []; } : null;
  useEffect(() => {
    if (!first || !token) { setNear([]); return; }
    supabase.rpc('ask_courses_near', { p_token: token, p_lat: first.lat, p_lng: first.lng, p_limit: 8 }).then(({ data }) => setNear(data || []), () => {});
  }, [first?.lat, first?.lng, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFrom = (i, patch) => setWhere({ ...where, from: where.from.map((f, j) => (j === i ? cleanFrom({ ...f, ...patch }) : f)) });
  // Courses: near your places (library) plus the group's own, each with your drive; nearest first.
  const list = useMemo(() => {
    const out = [];
    for (const c of near) out.push({ kind: 'library', id: c.id, name: c.name, lat: c.lat, lng: c.lng });
    if (!guest) for (const c of courses.slice(0, 8)) if (!out.some((x) => x.id === c.library_id)) out.push({ kind: 'group', id: c.id, name: c.name, lat: c.lat ?? null, lng: c.lng ?? null });
    return out.map((c) => ({ ...c, drive: personDrive(where, c) })).sort((a, b) => (a.drive?.min ?? 999) - (b.drive?.min ?? 999)).slice(0, 8);
  }, [near, courses, guest, where]);
  const picked = (c) => where.courses.some((x) => x.id === c.id);
  return (
    <div className="ask-where" data-testid="ask-where">
      <strong>📍 Where</strong>
      <span className="label">Leaving from</span>
      {where.from.map((f, i) => (
        <div key={`${f.label}-${i}`} className="ask-from" data-testid="ask-from">
          <div className="row between"><strong>{f.label}</strong>{f.lat == null && <span className="small muted">(pick it below to get drive times)</span>}
            <button type="button" className="btn ghost sm" onClick={() => setWhere({ ...where, from: where.from.filter((_, j) => j !== i) })} aria-label={`Remove ${f.label}`}>✕</button></div>
          <div className="co-chips" role="group" aria-label="Which days">
            {['any', 'weekdays', 'weekends'].map((k) => <button key={k} type="button" className="chip" aria-pressed={fromDaysWords(f.days) === fromDaysWords(fromDaySet(k))} onClick={() => setFrom(i, { days: fromDaySet(k) })}>{k === 'any' ? 'Any day' : k[0].toUpperCase() + k.slice(1)}</button>)}
          </div>
          <div className="co-chips" role="group" aria-label="Or pick days">
            {WEEK_DAYS.map((d) => { const on = f.days.includes(d); return <button key={d} type="button" className="chip" aria-pressed={on} onClick={() => setFrom(i, { days: on ? f.days.filter((x) => x !== d) : [...f.days, d] })}>{dayWord(d)}</button>; })}
          </div>
          <div className="co-chips" role="group" aria-label="Happy to drive up to">
            <span className="small muted" style={{ alignSelf: 'center' }}>Drive up to</span>
            {DRIVE_CHOICES.map((m) => <button key={m} type="button" className="chip" aria-pressed={f.max_min === m} onClick={() => setFrom(i, { max_min: m })}>{m} min</button>)}
          </div>
          {f.lat == null && <PlaceSearch initial={f.label} search={search} allowHere onPick={(p) => setFrom(i, { label: p.label || f.label, lat: p.lat, lng: p.lng })} />}
        </div>
      ))}
      {where.from.length < MAX_FROM && (adding ? (
        <PlaceSearch search={search} allowHere placeholder={where.from.length ? 'Another suburb (e.g. work)' : 'Your suburb or town'}
          onPick={(p) => { setWhere({ ...where, from: [...where.from, cleanFrom({ label: p.label || 'Here', lat: p.lat, lng: p.lng, max_min: DEFAULT_DRIVE, days: [] })].filter(Boolean) }); setAdding(false); }} />
      ) : (
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)} data-testid="ask-add-from">
          {where.from.length ? '+ Another place (e.g. work, on weekdays)' : '+ Add your suburb'}
        </button>
      ))}
      <span className="small muted">A suburb, never an address — your group sees it to find courses that suit everyone.</span>

      <span className="label">Courses {first ? 'by drive from ' + first.label : ''}</span>
      <div className="co-chips" data-testid="ask-courses">
        <button type="button" className="chip" aria-pressed={!where.courses.length} onClick={() => setWhere({ ...where, courses: [] })}>Any</button>
        {list.map((c) => (
          <button key={`${c.kind}-${c.id}`} type="button" className="chip" aria-pressed={picked(c)}
            onClick={() => setWhere({ ...where, courses: picked(c) ? where.courses.filter((x) => x.id !== c.id) : [...where.courses, { kind: c.kind, id: c.id, name: c.name }].slice(0, 6) })}>
            {c.name}{c.drive ? ` · ${fmtDrive(c.drive.min)}${c.drive.over ? ' ⚠' : ''}` : ''}
          </button>
        ))}
      </div>
      {!list.length && <span className="small muted">Add where you’re leaving from to see the courses near you.</span>}
      {(where.avoid || []).length > 0 && (
        <div className="co-chips">{where.avoid.map((a) => <button key={a} type="button" className="chip" aria-pressed="true" onClick={() => setWhere({ ...where, avoid: where.avoid.filter((x) => x !== a) })}>Not {a} ✕</button>)}</div>
      )}
      <input className="input" value={where.note} onChange={(e) => setWhere({ ...where, note: e.target.value })} maxLength={120} placeholder="A line, e.g. “anywhere east, not Moore Park again”" aria-label="Where note" />
    </div>
  );
}

