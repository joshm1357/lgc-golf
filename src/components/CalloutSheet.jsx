// "⛳ Put a round out" — the 30-second sheet (ov34, Josh 23 Oct 2026). Course → when → spots → who's asked → send.
// Opened from anywhere with openCallout({ text, date, place }) — Trips, Home, the old "⛳ One-day round" choices, the
// Caddie ("ask the guys for a hit fri arvo" fills it in with the same local parser) and "Same time next year?".
// components/CalloutHost.jsx (App.jsx) renders it once. The words → options maths is in lib/callout.js (tested); the database
// (103's put_round_out) checks everything again and sends the buzzes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, playerName } from '../lib/store.jsx';
import { Sheet, toast } from './ui.jsx';
import { notify } from '../lib/push.js';
import { useRun, must } from '../lib/run.js';
import { gate } from '../lib/savedgate.js';
import {
  parseWhen, buildOptions, makeOption, defaultCloses, defaultName, cleanExtras, EXTRAS, PARTS, PART_KEYS, RANGES,
  BUILDER_DAYS, DAY_KEYS, sydneyToday, cleanTime, partOfTime, closesWords, MAX_OPTIONS, askable,
} from '../lib/callout.js';
import './callout.css';

export { openCallout } from '../lib/calloutopen.js';

const DAY_WORD = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const SPOT_CHOICES = [4, 8, 12];
const keyOf = (o) => `${o.date}|${o.tee_time || ''}|${o.part || ''}`;
const pad = (n) => String(n).padStart(2, '0');
/** A Date → the phone's 'YYYY-MM-DDTHH:MM' for a datetime-local box. */
const toInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The group's course whose name is in the words ("… at moore park"), if any. */
function courseInWords(text, courses) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  return [...(courses || [])].sort((a, b) => b.name.length - a.name.length).find((c) => {
    const n = c.name.toLowerCase();
    return s.includes(n) || s.includes(n.replace(/\s+(golf club|golf course|gc|country club)$/i, ''));
  }) || null;
}

/** Search the shared course library (or pick one of the group's). onPick({ kind: 'group'|'library', id, name }) */
export function CourseFinder({ onPick, placeholder = 'Search courses by name or town' }) {
  const data = useData();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const latest = useRef(0);
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return undefined; }
    const t = setTimeout(async () => {
      const ticket = ++latest.current;
      const { data: found } = await supabase.rpc('find_courses', { p_query: q.trim(), p_lat: null, p_lng: null, p_limit: 6 });
      if (ticket === latest.current) setRows(found || []);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const mine = (r) => data.courses.find((c) => c.library_id && c.library_id === r.id);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search courses" data-testid="co-course-search" />
      {rows.map((r) => (
        <button key={r.id} type="button" className="co-opt" style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }}
          onClick={() => { const m = mine(r); onPick(m ? { kind: 'group', id: m.id, name: m.name } : { kind: 'library', id: r.id, name: r.name }); setQ(''); setRows([]); }}>
          <strong>{r.name}</strong><span className="small muted" style={{ paddingRight: 8 }}>{r.area || ''}</span>
        </button>
      ))}
    </div>
  );
}

export function CalloutSheet({ prefill = {}, onClose, onSaved }) {
  const data = useData();
  const { status } = useSession();
  const notifyOn = useFeature('notifications');
  const on = { games: useFeature('games'), dinner_awards: useFeature('dinner_awards'), planner_rooms: useFeature('planner_rooms'), planner_costs: useFeature('planner_costs') };
  const today = sydneyToday();
  const [busy, run] = useRun();

  // ---- the course
  const fromWords = courseInWords(`${prefill.text || ''} ${prefill.place || ''}`, data.courses);
  const [course, setCourse] = useState(() => (fromWords ? { kind: 'group', id: fromWords.id, name: fromWords.name }
    : prefill.place ? { kind: 'tbc', name: String(prefill.place).slice(0, 80) } : null));
  const [finding, setFinding] = useState(false);

  // ---- when
  const typedFirst = prefill.text ? parseWhen(prefill.text, today, new Date()) : null;
  const [mode, setMode] = useState(prefill.date ? 'fixed' : 'options');
  const [fixedDate, setFixedDate] = useState(prefill.date && prefill.date >= today ? prefill.date : '');
  const [fixedTime, setFixedTime] = useState('');
  const [days, setDays] = useState([]);
  const [part, setPart] = useState('arvo');
  const [exact, setExact] = useState('');
  const [range, setRange] = useState('next14');
  const [moreDays, setMoreDays] = useState(false);
  const [typed, setTyped] = useState(() => (typedFirst?.understood ? prefill.text : ''));
  const [removed, setRemoved] = useState(() => new Set());
  const parsed = useMemo(() => (typed.trim() ? parseWhen(typed, today, new Date()) : null), [typed, today]);
  const built = useMemo(() => {
    if (mode === 'fixed') {
      if (!fixedDate) return { options: [], cut: 0 };
      const t = cleanTime(fixedTime);
      return { options: [makeOption(fixedDate, t ? partOfTime(t) : null, t)], cut: 0 };
    }
    if (parsed?.understood) return parsed;
    return buildOptions({ days, part: exact ? null : part, time: exact || null, range }, today);
  }, [mode, fixedDate, fixedTime, parsed, days, part, exact, range, today]);
  const options = built.options.filter((o) => !removed.has(keyOf(o)));

  // ---- spots, who, closes, note, extras
  const [spots, setSpots] = useState(4); // 4 | 8 | 12 | 'custom' | 'none'
  const [custom, setCustom] = useState('6');
  const people = useMemo(() => askable(data.players).sort((a, b) => playerName(a).localeCompare(playerName(b))), [data.players]);
  const [everyone, setEveryone] = useState(true);
  const [picked, setPicked] = useState(() => new Set(people.map((p) => p.id)));
  const [closes, setCloses] = useState('');
  const [note, setNote] = useState('');
  const [name, setName] = useState(String(prefill.name || '').slice(0, 60)); // e.g. "Moore Park again" from Same time next year?
  const [extras, setExtras] = useState({});
  const [courseChoices, setCourseChoices] = useState([]); // the course vote: [{ kind, id, name }]
  const autoCloses = useMemo(() => defaultCloses(options), [options.map(keyOf).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const closesAt = closes ? new Date(closes) : autoCloses;
  const cap = spots === 'none' ? null : spots === 'custom' ? Math.round(Number(custom)) || null : spots;
  const capBad = spots === 'custom' && !(cap >= 2 && cap <= 72);
  const askedCount = everyone ? people.length : picked.size;
  const courseName = course?.name || '';
  const placeholderName = defaultName({ options, courseName });

  const toggleDay = (d) => { setTyped(''); setRemoved(new Set()); setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]); };
  const setX = (k, v) => setExtras({ ...extras, [k]: v });
  const extraList = EXTRAS.filter((e) => !e.feature || on[e.feature]);

  const send = () => run(async () => {
    const p = {
      p_name: name.trim() || placeholderName,
      p_options: options.map((o) => ({ date: o.date, part: o.part, tee_time: o.tee_time, label: o.label })),
      p_spots: cap,
      p_invite: everyone ? null : [...picked],
      p_closes_at: closesAt.toISOString(),
      p_note: note.trim() || null,
      p_course: course?.kind === 'group' ? course.id : null,
      p_library: course?.kind === 'library' ? course.id : null,
      p_course_name: course?.kind === 'tbc' ? course.name.trim() || null : null,
      p_extras: cleanExtras(extras),
      p_courses: extras.course_vote ? courseChoices.map((c) => ({ label: c.name, course_id: c.kind === 'group' ? c.id : null, library_course_id: c.kind === 'library' ? c.id : null })) : null,
    };
    const id = await must(supabase.rpc('put_round_out', p));
    const r = notifyOn ? await notify('callout_send', { plan_id: id }) : null;
    toast(`Out to ${askedCount - 1} ${askedCount - 1 === 1 ? 'person' : 'people'}${r?.sent ? ` — ${r.sent} phone${r.sent === 1 ? '' : 's'} buzzed` : ''}`);
    onSaved?.(id);
  });

  const ready = options.length > 0 && !capBad && askedCount >= 2 && (!extras.course_vote || courseChoices.length >= 2 || course);
  return (
    <Sheet title="⛳ Put a round out" onClose={onClose}>
      <div className="stack" data-testid="callout-sheet" style={{ gap: 16 }}>
        <span className="small muted">Ask the group who’s up for a hit. Not a trip, not a cup — just a round.</span>

        {/* ---------------- 1. Course */}
        <div className="co-step">
          <span className="label">Course</span>
          <div className="co-chips" data-testid="co-courses">
            {data.courses.slice(0, 8).map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={course?.kind === 'group' && course.id === c.id} onClick={() => setCourse({ kind: 'group', id: c.id, name: c.name })}>{c.name}</button>
            ))}
            {course?.kind === 'library' && <button type="button" className="chip" aria-pressed="true">{course.name}</button>}
            <button type="button" className="chip" aria-pressed={course?.kind === 'tbc'} onClick={() => setCourse({ kind: 'tbc', name: course?.kind === 'tbc' ? course.name : '' })} data-testid="co-tbc">Course TBC</button>
            <button type="button" className="chip" aria-pressed={finding} onClick={() => setFinding(!finding)}>🔎 Another</button>
          </div>
          {finding && <CourseFinder onPick={(c) => { setCourse(c); setFinding(false); }} />}
          {course?.kind === 'tbc' && (
            <input className="input" value={course.name} onChange={(e) => setCourse({ kind: 'tbc', name: e.target.value })} placeholder="A name if you have one (optional)" aria-label="Course name" />
          )}
        </div>

        {/* ---------------- 2. When */}
        <div className="co-step">
          <span className="label">When</span>
          <div className="seg light" role="group" aria-label="When">
            <button type="button" aria-pressed={mode === 'options'} onClick={() => setMode('options')} data-testid="co-mode-options">A few options</button>
            <button type="button" aria-pressed={mode === 'fixed'} onClick={() => setMode('fixed')} data-testid="co-mode-fixed">A set tee time</button>
          </div>
          {mode === 'fixed' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="field"><span>Day</span><input className="input" type="date" min={today} value={fixedDate} onChange={(e) => setFixedDate(e.target.value)} data-testid="co-fixed-date" /></label>
              <label className="field"><span>Tee time</span><input className="input" type="time" value={fixedTime} onChange={(e) => setFixedTime(e.target.value)} data-testid="co-fixed-time" /></label>
            </div>
          ) : (
            <>
              <div className="co-chips" role="group" aria-label="Days" data-testid="co-days">
                {(moreDays ? DAY_KEYS.slice(1).concat('sun').filter((d, i, a) => a.indexOf(d) === i) : BUILDER_DAYS).map((d) => (
                  <button key={d} type="button" className="chip" aria-pressed={days.includes(d)} onClick={() => toggleDay(d)}>{DAY_WORD[d]}</button>
                ))}
                {!moreDays && <button type="button" className="chip" onClick={() => setMoreDays(true)}>Mon–Wed</button>}
              </div>
              <div className="co-chips" role="group" aria-label="Part of the day" data-testid="co-parts">
                {PART_KEYS.map((k) => (
                  <button key={k} type="button" className="chip" aria-pressed={!exact && part === k} onClick={() => { setTyped(''); setExact(''); setPart(k); }}>{PARTS[k].label}</button>
                ))}
                <label className="chip row" style={{ gap: 6 }} aria-pressed={!!exact}>
                  <span>Exact</span>
                  <input type="time" value={exact} onChange={(e) => { setTyped(''); setExact(e.target.value); }} aria-label="Exact tee time" style={{ border: 0, background: 'transparent', font: 'inherit', width: 96 }} />
                </label>
              </div>
              <div className="co-chips" role="group" aria-label="How far ahead" data-testid="co-ranges">
                {Object.entries(RANGES).map(([k, r]) => (
                  <button key={k} type="button" className="chip" aria-pressed={range === k} onClick={() => { setTyped(''); setRange(k); }}>{r.label}</button>
                ))}
              </div>
              <label className="field"><span>…or type it</span>
                <input className="input" value={typed} onChange={(e) => { setTyped(e.target.value); setRemoved(new Set()); }} data-testid="co-typed"
                  placeholder="e.g. this fri arvo · next thu · any fri arvo in nov · sat or sun morning" />
              </label>
              {parsed?.hint && <span className="small" style={{ color: parsed.understood ? 'var(--muted)' : 'var(--down)' }} data-testid="co-hint">{parsed.hint}</span>}
              {!parsed && built.cut > 0 && <span className="small muted">Only the first {MAX_OPTIONS} go out — fewer options get quicker answers.</span>}
            </>
          )}
          {options.length > 0 && (
            <div className="co-opts" data-testid="co-options">
              {options.map((o) => (
                <div key={keyOf(o)} className="co-opt" data-testid="co-option">
                  <strong>{o.label}</strong>
                  {mode === 'options' && <button type="button" className="co-x" aria-label={`Remove ${o.label}`} onClick={() => setRemoved(new Set([...removed, keyOf(o)]))}>✕</button>}
                </div>
              ))}
              {mode === 'options' && <span className="small muted">{options.length === 1 ? 'One time: they say In, Maybe or Can’t.' : 'They tick ✓ can, ? maybe or ✗ can’t for each.'}</span>}
            </div>
          )}
        </div>

        {/* ---------------- 3. Spots */}
        <div className="co-step">
          <span className="label">Spots</span>
          <div className="co-chips" role="group" aria-label="Spots" data-testid="co-spots">
            {SPOT_CHOICES.map((n) => <button key={n} type="button" className="chip" aria-pressed={spots === n} onClick={() => setSpots(n)}>{n}</button>)}
            <button type="button" className="chip" aria-pressed={spots === 'custom'} onClick={() => setSpots('custom')}>Other</button>
            <button type="button" className="chip" aria-pressed={spots === 'none'} onClick={() => setSpots('none')}>No cap</button>
          </div>
          {spots === 'custom' && <input className="input" inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))} aria-label="How many spots" style={{ maxWidth: 120 }} />}
          <span className="small muted">{cap ? `The first ${cap} who can make it are in; anyone after that goes on the reserve list, in order.` : 'Everyone who can make it plays.'}</span>
          {capBad && <span className="small err">From 2 to 72 spots.</span>}
        </div>

        {/* ---------------- 4. Who's asked */}
        <div className="co-step">
          <span className="label">Who’s asked <span className="small muted">{askedCount} of {people.length}</span></span>
          <details className="co-more" data-testid="co-who">
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
          <span className="small muted">{everyone ? 'Everyone gets a buzz, and it goes in the Feed.' : 'Only the people ticked get a buzz (no Feed post).'}</span>
        </div>

        {/* ---------------- 5. Closes, note, name */}
        <div className="stack" style={{ gap: 8 }}>
          <label className="field"><span>Replies close</span>
            <input className="input" type="datetime-local" value={closes || toInput(autoCloses)} onChange={(e) => setCloses(e.target.value)} data-testid="co-closes" /></label>
          <label className="field"><span>Name (optional)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholderName} maxLength={60} /></label>
        </div>
        <span className="small muted" style={{ marginTop: -10 }}>{closesWords(closesAt)} — you get a nudge then to lock it in.</span>
        <label className="field"><span>Note (optional)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="$65 green fee, carts optional" maxLength={500} data-testid="co-note" /></label>

        {/* ---------------- 6. ➕ Add to this round (hidden as standard) */}
        <details className="co-more" data-testid="co-extras">
          <summary>➕ Add to this round <span className="small muted" style={{ marginLeft: 6 }}>(optional)</span></summary>
          <div className="stack" style={{ gap: 8 }}>
            {extraList.map((e) => (
              <div key={e.key} className="stack" style={{ gap: 6 }}>
                {e.key === 'after' ? (
                  <label className="field"><span>{e.icon} {e.label}</span>
                    <input className="input" value={extras.after || ''} onChange={(ev) => setX('after', ev.target.value)} placeholder="Beers at the Bowlo after" maxLength={120} /></label>
                ) : (
                  <label className="row" style={{ gap: 10, minHeight: 44 }}>
                    <input type="checkbox" checked={!!extras[e.key]} onChange={(ev) => setX(e.key, ev.target.checked)} style={{ width: 22, height: 22 }} />
                    <span className="grow"><strong>{e.icon} {e.label}</strong><div className="small muted">{e.help}</div></span>
                  </label>
                )}
                {e.key === 'course_vote' && extras.course_vote && (
                  <div className="stack" style={{ gap: 6, paddingLeft: 32 }}>
                    <div className="co-chips">
                      {data.courses.slice(0, 10).map((c) => {
                        const onIt = courseChoices.some((x) => x.kind === 'group' && x.id === c.id);
                        return <button key={c.id} type="button" className="chip" aria-pressed={onIt} onClick={() => setCourseChoices(onIt ? courseChoices.filter((x) => !(x.kind === 'group' && x.id === c.id)) : [...courseChoices, { kind: 'group', id: c.id, name: c.name }].slice(0, 6))}>{c.name}</button>;
                      })}
                      {courseChoices.filter((x) => x.kind === 'library').map((x) => <button key={x.id} type="button" className="chip" aria-pressed="true" onClick={() => setCourseChoices(courseChoices.filter((y) => y !== x))}>{x.name} ✕</button>)}
                    </div>
                    <CourseFinder placeholder="Add another course to the vote" onPick={(c) => setCourseChoices([...courseChoices.filter((x) => x.id !== c.id), c].slice(0, 6))} />
                    <span className="small muted">{courseChoices.length < 2 ? 'Pick at least two courses to vote on.' : `${courseChoices.length} courses to vote on.`}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>

        <button {...gate('propose_trip')} type="button" className="btn gold block" style={{ minHeight: 56 }} disabled={busy || !ready} onClick={send} data-testid="co-send">
          ⛳ Put it out{askedCount > 1 ? ` to ${askedCount - 1}` : ''}
        </button>
        {!options.length && <span className="small muted" style={{ textAlign: 'center', marginTop: -8 }}>{mode === 'fixed' ? 'Pick the day.' : 'Pick a day (or type one) to make the times.'}</span>}
      </div>
    </Sheet>
  );
}

export default CalloutSheet;
