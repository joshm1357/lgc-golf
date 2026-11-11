// ov43 — step 1 of "Anyone keen for a round?": the organiser's 10-second ask. Ticks the days and times on offer
// (Thu / Fri / Sat / Sun / any; early / morning / arvo / twilight / any), how far ahead (a range, specific dates, or
// "until we play"), and when it closes. "Same as last time" is one tap; exact times can be added; "Send to myself"
// previews the reply screen and the WhatsApp message. Lives inside CalloutSheet (the set-time call-out is unchanged).
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, playerName } from '../lib/store.jsx';
import { Sheet, toast } from './ui.jsx';
import { notify } from '../lib/push.js';
import { useRun, must } from '../lib/run.js';
import { gate } from '../lib/savedgate.js';
import {
  ASK_DAYS, ASK_PART_KEYS, ASK_PARTS, RANGE_CHOICES, askCells, askWords, cleanAsk, askCloses, askShareText, dayWord, isLong,
} from '../lib/ask.js';
import { DAY_KEYS, sydneyToday, askable, closesWords, clock, dayLabel, cleanTime } from '../lib/callout.js';
import { CourseFinder } from './CalloutSheet.jsx';
import AskReply from './AskReply.jsx';
import './callout.css';

const SPOT_CHOICES = [4, 8, 12];
const pad = (n) => String(n).padStart(2, '0');
const toInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export default function AskForm({ prefill = {}, onSaved }) {
  const data = useData();
  const { status } = useSession();
  const notifyOn = useFeature('notifications');
  const today = sydneyToday();
  const [busy, run] = useRun();
  const start = prefill.ask ? cleanAsk(prefill.ask) : null;
  const [days, setDays] = useState(start?.days?.length ? start.days : ['thu', 'fri', 'sat', 'sun']);
  const [moreDays, setMoreDays] = useState(() => (start?.days || []).some((d) => !ASK_DAYS.includes(d)));
  const [parts, setParts] = useState(start?.parts || []);
  const [range, setRange] = useState(start?.range || { kind: 'next', days: 14 });
  const [dates, setDates] = useState(start?.range?.kind === 'dates' ? start.range.dates : []);
  const [times, setTimes] = useState(start?.times || []);
  const [newT, setNewT] = useState({ date: '', at: '' });
  const [course, setCourse] = useState(prefill.course || null);
  const [finding, setFinding] = useState(false);
  const [spots, setSpots] = useState(prefill.spots === null ? 'none' : prefill.spots || 4);
  const people = useMemo(() => askable(data.players).sort((a, b) => playerName(a).localeCompare(playerName(b))), [data.players]);
  const [everyone, setEveryone] = useState(!prefill.invite);
  const [picked, setPicked] = useState(() => new Set(prefill.invite || people.map((p) => p.id)));
  const [closes, setCloses] = useState('');
  const [note, setNote] = useState('');
  const [last, setLast] = useState(null);
  const [preview, setPreview] = useState(false);

  // "Same as last time": your last ask.
  useEffect(() => {
    if (!status.player_id || prefill.ask) return;
    supabase.from('plans').select('ask,spots,invite_all,course_id,location_name,id').eq('callout', true).not('ask', 'is', null)
      .eq('created_by', status.player_id).order('created_at', { ascending: false }).limit(1)
      .then(({ data: rows }) => setLast(rows?.[0] || null), () => {});
  }, [status.player_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = useMemo(() => cleanAsk({ days: days.length === 7 ? [] : days, parts, range: range.kind === 'dates' ? { kind: 'dates', dates } : range, times }), [days, parts, range, dates, times]);
  const cells = useMemo(() => askCells(ask, today), [ask, today]);
  const autoCloses = useMemo(() => askCloses(ask, today), [JSON.stringify(ask), today]); // eslint-disable-line react-hooks/exhaustive-deps
  const closesAt = closes ? new Date(closes) : autoCloses;
  const cap = spots === 'none' ? null : spots;
  const askedCount = everyone ? people.length : picked.size;

  const sameAsLast = () => {
    const a = cleanAsk(last.ask);
    setDays(a.days.length ? a.days : DAY_KEYS.slice()); setParts(a.parts); setRange(a.range.kind === 'dates' ? { kind: 'next', days: 14 } : a.range);
    setTimes([]); setSpots(last.spots ?? 'none');
    if (last.course_id) setCourse({ kind: 'group', id: last.course_id, name: last.location_name });
    toast('Filled in from last time');
  };
  const toggle = (list, set, x) => set(list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  const send = () => run(async () => {
    const id = await must(supabase.rpc('put_round_ask', {
      p_name: null, p_ask: ask, p_spots: cap, p_invite: everyone ? null : [...picked], p_closes_at: closesAt.toISOString(), p_note: note.trim() || null,
      p_course: course?.kind === 'group' ? course.id : null, p_library: course?.kind === 'library' ? course.id : null, p_course_name: null,
    }));
    const r = notifyOn ? await notify('callout_send', { plan_id: id }) : null;
    toast(`Asked ${askedCount - 1} ${askedCount - 1 === 1 ? 'person' : 'people'}${r?.sent ? ` — ${r.sent} phone${r.sent === 1 ? '' : 's'} buzzed` : ''}. Answer it yourself too.`);
    onSaved?.(id);
  });

  const ready = cells.length > 0 && askedCount >= 2 && (range.kind !== 'dates' || dates.length > 0);
  const shownDays = moreDays ? ['mon', 'tue', 'wed', ...ASK_DAYS] : ASK_DAYS;
  return (
    <div className="stack" data-testid="ask-form" style={{ gap: 16 }}>
      <span className="small muted">Ask when they can play. The app finds the first time that fills a group — you choose, or put a few to a vote.</span>
      {last && <button type="button" className="chip" style={{ alignSelf: 'flex-start' }} onClick={sameAsLast} data-testid="ask-same">↺ Same as last time</button>}

      <div className="co-step">
        <span className="label">Days</span>
        <div className="co-chips" role="group" aria-label="Days" data-testid="ask-days">
          {shownDays.map((d) => <button key={d} type="button" className="chip" aria-pressed={days.includes(d)} onClick={() => toggle(days, setDays, d)}>{dayWord(d)}</button>)}
          <button type="button" className="chip" aria-pressed={days.length === 7} onClick={() => { setDays(days.length === 7 ? ASK_DAYS : DAY_KEYS.slice()); setMoreDays(true); }}>Any</button>
          {!moreDays && <button type="button" className="chip" onClick={() => setMoreDays(true)}>Mon–Wed</button>}
        </div>
      </div>

      <div className="co-step">
        <span className="label">Times</span>
        <div className="co-chips" role="group" aria-label="Times of day" data-testid="ask-parts">
          {ASK_PART_KEYS.map((p) => <button key={p} type="button" className="chip" aria-pressed={!parts.length || parts.includes(p)} onClick={() => setParts(!parts.length ? ASK_PART_KEYS.filter((x) => x !== p) : parts.includes(p) && parts.length === 1 ? [] : parts.includes(p) ? parts.filter((x) => x !== p) : parts.length + 1 === ASK_PART_KEYS.length ? [] : [...parts, p])}>{ASK_PARTS[p].label}</button>)}
          <button type="button" className="chip" aria-pressed={!parts.length} onClick={() => setParts([])}>Any</button>
        </div>
      </div>

      <div className="co-step">
        <span className="label">How far ahead</span>
        <div className="co-chips" role="group" aria-label="How far ahead" data-testid="ask-range">
          {RANGE_CHOICES.map((c) => <button key={c.key} type="button" className="chip" aria-pressed={range.kind === c.range.kind && (c.range.kind === 'open' || range.days === c.range.days)} onClick={() => setRange(c.range)}>{c.label}</button>)}
          <button type="button" className="chip" aria-pressed={range.kind === 'dates'} onClick={() => setRange({ kind: 'dates' })}>Pick dates</button>
        </div>
        {range.kind === 'dates' && (
          <div className="stack" style={{ gap: 6 }}>
            <input className="input" type="date" min={today} onChange={(e) => { const d = e.target.value; if (d && !dates.includes(d)) setDates([...dates, d].sort()); e.target.value = ''; }} aria-label="Add a date" data-testid="ask-add-date" />
            <div className="co-chips">{dates.map((d) => <button key={d} type="button" className="chip" aria-pressed="true" onClick={() => setDates(dates.filter((x) => x !== d))}>{dayLabel(d)} ✕</button>)}</div>
          </div>
        )}
      </div>

      <details className="co-more" data-testid="ask-exact-times">
        <summary>➕ Exact times{times.length ? ` (${times.length})` : ''} <span className="small muted" style={{ marginLeft: 6 }}>(optional — e.g. a tee time you can get)</span></summary>
        <div className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow" type="date" min={today} value={newT.date} onChange={(e) => setNewT({ ...newT, date: e.target.value })} aria-label="Exact time day" />
            <input className="input" type="time" value={newT.at} onChange={(e) => setNewT({ ...newT, at: e.target.value })} aria-label="Exact time" style={{ maxWidth: 120 }} />
            <button type="button" className="btn ghost sm" disabled={!newT.date || !cleanTime(newT.at)} onClick={() => { setTimes([...times, { date: newT.date, at: cleanTime(newT.at) }].slice(0, 12)); setNewT({ date: '', at: '' }); }}>Add</button>
          </div>
          <div className="co-chips">{times.map((t, i) => <button key={`${t.date}${t.at}`} type="button" className="chip" aria-pressed="true" onClick={() => setTimes(times.filter((_, j) => j !== i))}>{dayLabel(t.date)} {clock(t.at)} ✕</button>)}</div>
        </div>
      </details>

      <div className="co-step">
        <span className="label">Course <span className="small muted">optional — or let them say where</span></span>
        <div className="co-chips" data-testid="ask-course">
          <button type="button" className="chip" aria-pressed={!course} onClick={() => setCourse(null)}>Decide later</button>
          {data.courses.slice(0, 6).map((c) => <button key={c.id} type="button" className="chip" aria-pressed={course?.kind === 'group' && course.id === c.id} onClick={() => setCourse({ kind: 'group', id: c.id, name: c.name })}>{c.name}</button>)}
          {course?.kind === 'library' && <button type="button" className="chip" aria-pressed="true">{course.name}</button>}
          <button type="button" className="chip" aria-pressed={finding} onClick={() => setFinding(!finding)}>🔎 Another</button>
        </div>
        {finding && <CourseFinder onPick={(c) => { setCourse(c); setFinding(false); }} />}
      </div>

      <div className="co-step">
        <span className="label">Group size</span>
        <div className="co-chips" role="group" aria-label="Spots" data-testid="ask-spots">
          {SPOT_CHOICES.map((n) => <button key={n} type="button" className="chip" aria-pressed={spots === n} onClick={() => setSpots(n)}>{n}</button>)}
          <button type="button" className="chip" aria-pressed={spots === 'none'} onClick={() => setSpots('none')}>No cap</button>
        </div>
        <span className="small muted">{cap ? `You hear as soon as ${cap} can make the same time. Extras go on reserve, in the order they answered.` : 'You hear as soon as 4 can make the same time.'}</span>
      </div>

      <div className="co-step">
        <span className="label">Who’s asked <span className="small muted">{askedCount} of {people.length}</span></span>
        <details className="co-more">
          <summary>{everyone ? 'The whole group' : `${picked.size} people`} — change</summary>
          <div className="co-who">
            {people.map((p) => (
              <label key={p.id}>
                <input type="checkbox" checked={everyone || picked.has(p.id)} disabled={p.id === status.player_id}
                  onChange={() => { const n = new Set(everyone ? people.map((x) => x.id) : picked); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); setPicked(n); setEveryone(n.size === people.length); }} />
                {playerName(p)}{p.id === status.player_id ? ' (you)' : ''}
              </label>
            ))}
          </div>
        </details>
      </div>

      <label className="field"><span>Replies close</span>
        <input className="input" type="datetime-local" value={closes || toInput(autoCloses)} onChange={(e) => setCloses(e.target.value)} data-testid="ask-closes" /></label>
      <span className="small muted" style={{ marginTop: -10 }}>{closesWords(closesAt)} — or sooner, the moment a time fills a group.</span>
      <label className="field"><span>Note (optional)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="On a budget — twilight rates?" /></label>

      <div className="card pad small" style={{ background: 'var(--ground)' }} data-testid="ask-summary">
        <strong>{askWords(ask)}</strong> · {cells.length} square{cells.length === 1 ? '' : 's'} to tick{isLong(ask, today) ? ' (shown as one row per day)' : ''}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn ghost" disabled={!cells.length} onClick={() => setPreview(true)} data-testid="ask-preview">👀 Send to myself</button>
        <button {...gate('propose_trip')} type="button" className="btn gold grow" style={{ minHeight: 56 }} disabled={busy || !ready} onClick={send} data-testid="ask-go">
          ⛳ Ask {askedCount > 1 ? askedCount - 1 : ''}
        </button>
      </div>
      {preview && (
        <Sheet title="👀 What they’ll see" onClose={() => setPreview(false)}>
          <div className="stack" style={{ gap: 12 }} data-testid="ask-preview-sheet">
            <div className="ask-wa" data-testid="ask-wa-preview">
              <span className="small muted">In WhatsApp</span>
              <div className="ask-wa-bubble">{askShareText({ who: playerName(data.playersById[status.player_id]) || '', ask, courseName: course?.name || '', link: 'app.thegolftrip.club/…' })}</div>
              <div className="ask-wa-card"><strong>⛳ Anyone keen for a round?</strong><span className="small">{askWords(ask)} · tap the times you can play</span><span className="small muted">app.thegolftrip.club</span></div>
            </div>
            <span className="label">The link opens on this — try it (nothing is saved):</span>
            <AskReply plan={{ id: 'preview', group_id: null, ask }} preview onSent={() => setPreview(false)} />
          </div>
        </Sheet>
      )}
    </div>
  );
}
