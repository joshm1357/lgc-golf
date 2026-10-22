// Calling the courses (080, Josh 22 Oct):
//   * "Who's calling the courses?" — one person for all (sets every open call job's owner in one go) or per course.
//   * Each course's call covers every day of every weekend still in play: available yes / no / not sure, the times on
//     offer (ranges), how many they can take, price each, a note. A checklist, a short script to read, and progress
//     ("2 of 6 days filled"). The job can't be ticked off until every day has an answer ("not sure" counts, but
//     "ask again?").
//   * The course's usual social golf times, kept for the group (course_social_times) so they're there next trip.
//   * The best times per day across every course, for the organiser.
// The maths is in lib/teegrid.js and lib/tripjobs.js.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useRealtime, playerName } from '../lib/store.jsx';
import { toast } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify } from '../lib/push.js';
import { callProgress, canFinishCall, callChecklist, callScript, parseRanges, dayShort, bestPerDay, socialLine, slotsFor } from '../lib/teegrid.js';
import { bestBlock } from '../lib/tripbuilder.js';
import { bulkAllocate, callMode, jobStage, stagePatch } from '../lib/tripjobs.js';
import './planux.css';

/** The group's usual social times for these courses: { course_id: row }. */
export function useSocialTimes(ids) {
  const key = (ids || []).slice().sort().join(',');
  const [rows, setRows] = useState({});
  const load = useCallback(async () => {
    if (!key) return;
    const { data } = await supabase.from('course_social_times').select('*').in('course_id', key.split(','));
    setRows(Object.fromEntries((data || []).map((r) => [r.course_id, r])));
  }, [key]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['course_social_times'], load);
  return [rows, load];
}

/** "Who's calling the courses?" — one person for all, or per course. */
export function CallsWho({ items, callJobIds, org, reload }) {
  const data = useData();
  const [busy, run] = useRun();
  const [mode, setMode] = useState(() => callMode(items, callJobIds));
  const [who, setWho] = useState('');
  if (!org) return null;
  const giveAll = (pid) => run(async () => {
    setWho(pid);
    const ids = bulkAllocate(items, callJobIds, pid);
    if (!ids.length) return 'They’ve already got them all';
    await must(supabase.from('plan_items').update({ owner_id: pid }).in('id', ids));
    for (const id of ids) notify('job_assigned', { item_id: id }).catch(() => {});
    reload();
    return `${ids.length} call${ids.length === 1 ? '' : 's'} handed to ${playerName(data.playersById[pid])}`;
  }).then((m) => m && toast(m));
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="calls-who">
      <strong>Who’s calling the courses?</strong>
      <div className="seg light" role="group" aria-label="Who calls">
        <button type="button" aria-pressed={mode === 'one'} onClick={() => setMode('one')} data-testid="calls-one">One person for all</button>
        <button type="button" aria-pressed={mode === 'per'} onClick={() => setMode('per')} data-testid="calls-per">Per course</button>
      </div>
      {mode === 'one' ? (
        <label className="field"><span>Hand every call to</span>
          <select className="select" value={who} disabled={busy} onChange={(e) => e.target.value && giveAll(e.target.value)} aria-label="One person for all">
            <option value="">Pick someone…</option>
            {data.players.filter((p) => p.approved !== false).map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
          </select>
        </label>
      ) : <span className="small muted">Pick who rings each course on its card below. Calls already handed out stay as they are.</span>}
    </div>
  );
}

const AVAIL = [['yes', '✓ Yes'], ['no', '✗ No'], ['unknown', '? Not sure']];

/** One day of one course: available, times on offer, how many, price, note. */
function DayRow({ planId, courseId, jobId, date, row, need, canEdit, me, onSaved }) {
  const [v, setV] = useState(() => ({ available: row?.available || null, ranges: (row?.ranges || []).map((r) => r.replace('-', '–')).join(', '), capacity: row?.capacity ?? '', price: row?.price ?? '', notes: row?.notes || '' }));
  const [busy, run] = useRun();
  const [open, setOpen] = useState(false);
  useEffect(() => { setV({ available: row?.available || null, ranges: (row?.ranges || []).map((r) => r.replace('-', '–')).join(', '), capacity: row?.capacity ?? '', price: row?.price ?? '', notes: row?.notes || '' }); }, [row?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const block = bestBlock(slotsFor(row), need, { earliest: 0 });
  const save = (patch = {}) => run(async () => {
    const next = { ...v, ...patch };
    const ranges = next.available === 'no' ? [] : parseRanges(next.ranges);
    if (next.available === 'yes' && !ranges.length && !(row?.times || []).length) throw new Error('Put in the times they offered, e.g. 7:30–9:00');
    await must(supabase.from('trip_tee_options').upsert({
      plan_id: planId, play_date: date, course_id: courseId, job_id: jobId, entered_by: me, available: next.available, ranges,
      capacity: next.capacity === '' ? null : Math.max(1, Math.min(400, Number(next.capacity) || 1)),
      price: next.price === '' ? null : Number(String(next.price).replace(/[^0-9.]/g, '')) || null, notes: next.notes || null,
      ...(row ? {} : { times: [] }),
    }, { onConflict: 'plan_id,play_date,course_id' }));
    setOpen(false);
    onSaved();
  }, 'Saved');
  const status = !row?.available && !(row?.ranges || []).length && !(row?.times || []).length ? 'Not asked yet'
    : row.available === 'no' ? '✗ Nothing that day' : row.available === 'unknown' ? '? Not sure — ask again?'
      : block ? `✓ ${need} in a row ${block.text}` : `${(row.ranges || []).map((r) => r.replace('-', '–')).join(', ') || 'Times in'}${need > 1 ? ' — not enough in a row?' : ''}`;
  return (
    <div className="stack" style={{ gap: 4, borderTop: '1px solid var(--line-soft)', paddingTop: 6 }} data-testid="tee-day" data-date={date}>
      <div className="row between small" style={{ gap: 6 }}>
        <strong>{dayShort(date)}</strong>
        <span data-testid="tee-day-status" style={{ fontWeight: 700, color: row?.available === 'no' ? 'var(--under)' : row?.available ? 'var(--navy)' : 'var(--muted)' }}>{status}</span>
      </div>
      {(row?.capacity || row?.price || row?.notes) && <span className="small muted">{[row.capacity ? `takes ${row.capacity}` : null, row.price != null ? `$${Number(row.price)} each` : null, row.notes].filter(Boolean).join(' · ')}</span>}
      {canEdit && !open && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)} data-testid="tee-day-edit">{row ? 'Change' : 'Fill in'}</button>}
      {canEdit && open && (
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {AVAIL.map(([k, l]) => <button key={k} type="button" className="btn ghost sm" aria-pressed={v.available === k} style={v.available === k ? { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' } : {}} onClick={() => setV({ ...v, available: k })}>{l}</button>)}
          </div>
          {v.available === 'yes' && (
            <>
              <input className="input" value={v.ranges} onChange={(e) => setV({ ...v, ranges: e.target.value })} placeholder="Times on offer, e.g. 7:30–9:00, 1pm–2pm" aria-label={`Times on offer ${date}`} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <input className="input" inputMode="numeric" value={v.capacity} onChange={(e) => setV({ ...v, capacity: e.target.value.replace(/\D/g, '') })} placeholder="Players they can take" aria-label={`How many ${date}`} />
                <input className="input" inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} placeholder="$ each" aria-label={`Price ${date}`} />
              </div>
            </>
          )}
          <input className="input" value={v.notes} maxLength={300} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="Note (optional)" aria-label={`Note ${date}`} />
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm grow" disabled={busy || !v.available} onClick={() => save()} data-testid="tee-day-save">Save</button>
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The course's usual social golf times (kept for the group). */
export function SocialTimes({ courseId, row, canEdit, onSaved }) {
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ weekdays: row?.weekdays || '', weekends: row?.weekends || '', price: row?.price || '', group_size: row?.group_size || '', notes: row?.notes || '' });
  const [busy, run] = useRun();
  const save = () => run(async () => {
    const clean = (x, n) => (String(x || '').trim().slice(0, n) || null);
    await must(supabase.from('course_social_times').upsert({ course_id: courseId, group_id: status.group_id, weekdays: clean(v.weekdays, 120), weekends: clean(v.weekends, 120), price: clean(v.price, 60), group_size: clean(v.group_size, 80), notes: clean(v.notes, 300), updated_by: status.player_id }, { onConflict: 'group_id,course_id' }));
    setOpen(false);
    onSaved?.();
  }, 'Saved for next time too');
  return (
    <div className="stack" style={{ gap: 4 }} data-testid="social-times">
      <div className="small"><strong>Usual social golf times:</strong> {socialLine(row) || <span className="muted">not in yet</span>}</div>
      {canEdit && !open && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)} data-testid="social-edit">{row ? 'Change' : '+ Add their social times'}</button>}
      {canEdit && open && (
        <div className="stack" style={{ gap: 6 }}>
          <input className="input" value={v.weekdays} onChange={(e) => setV({ ...v, weekdays: e.target.value })} placeholder="Weekdays, e.g. after 11" aria-label="Social times weekdays" />
          <input className="input" value={v.weekends} onChange={(e) => setV({ ...v, weekends: e.target.value })} placeholder="Weekends, e.g. Sat after 2" aria-label="Social times weekends" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input className="input" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} placeholder="Price, e.g. $65" aria-label="Social price" />
            <input className="input" value={v.group_size} onChange={(e) => setV({ ...v, group_size: e.target.value })} placeholder="Groups, e.g. 4s walk-in OK" aria-label="Group size" />
          </div>
          <button type="button" className="btn sm" disabled={busy} onClick={save} data-testid="social-save">Save</button>
        </div>
      )}
    </div>
  );
}

/** One course's call: who's on it, the checklist, a script, every day in the window, social times, done. */
export function CourseCall({ planId, courseId, name, job, dates, need, rows, social, canEdit, me, groupName, onSaved, owner, booking }) {
  const [busy, run] = useRun();
  const [script, setScript] = useState(false);
  const [gapsMsg, setGapsMsg] = useState('');
  const p = callProgress(rows, dates, social);
  const finish = () => {
    const f = canFinishCall(p);
    if (!f.ok) { setGapsMsg(`${f.message} Every day needs an answer — “not sure” is fine.`); return; }
    run(async () => {
      await must(supabase.from('plan_items').update(stagePatch('done')).eq('id', job.id));
      onSaved();
      return f.nudge ? `Done. ${f.nudge}` : 'Done — thanks!';
    }).then((m) => m && toast(m));
  };
  const done = job && jobStage(job) === 'done';
  return (
    <div className="card pad stack" style={{ gap: 6 }} data-testid="tb-call" data-course={courseId}>
      <div className="row between" style={{ gap: 6 }}>
        <strong>{name}</strong>
        <span className="small" style={{ fontWeight: 700 }} data-testid="call-progress">{p.line}</span>
      </div>
      {booking?.phone && <a className="small" href={`tel:${booking.phone.replace(/[^0-9+]/g, '')}`}>📞 {booking.phone}</a>}
      {booking?.booking_url && <a className="small" href={booking.booking_url} target="_blank" rel="noopener noreferrer">Book online ↗</a>}
      {owner}
      {canEdit && !done && (
        <details className="small">
          <summary style={{ fontWeight: 700, cursor: 'pointer' }}>Ask about</summary>
          <ul style={{ margin: '4px 0', paddingLeft: 18 }} data-testid="call-checklist">{callChecklist(dates, { need }).map((x) => <li key={x}>{x}</li>)}</ul>
        </details>
      )}
      {canEdit && !done && (
        script
          ? <div className="small" style={{ background: 'var(--ground)', borderRadius: 10, padding: 8 }} data-testid="call-script">“{callScript({ course: name, group: groupName, need, dates })}” <button type="button" className="btn ghost sm" onClick={() => setScript(false)}>Hide</button></div>
          : <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setScript(true)}>📜 What to say</button>
      )}
      {dates.map((d) => (
        <DayRow key={d} planId={planId} courseId={courseId} jobId={job?.id || null} date={d} need={need} me={me} canEdit={canEdit}
          row={rows.find((r) => String(r.play_date).slice(0, 10) === d)} onSaved={onSaved} />
      ))}
      <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
        <SocialTimes courseId={courseId} row={social} canEdit={canEdit} onSaved={onSaved} />
      </div>
      {gapsMsg && <span className="small err" style={{ margin: 0 }} data-testid="call-gaps">{gapsMsg}</span>}
      {done ? <span className="small" style={{ fontWeight: 700 }}>✅ Call done{p.unknown.length ? ` — not sure about ${p.unknown.map(dayShort).join(', ')}: ask again?` : ''}</span>
        : job && canEdit && <button type="button" className="btn sm" disabled={busy} onClick={finish} data-testid="call-done">✓ That’s the call done</button>}
    </div>
  );
}

/** The best times each day across every course called (for the organiser). */
export function BestPerDay({ rows, dates, needed, courses }) {
  const days = bestPerDay(rows, { needed, dates, courses });
  if (!rows.length) return null;
  return (
    <div className="card pad stack" style={{ gap: 6, borderColor: 'var(--navy)' }} data-testid="best-per-day">
      <strong>⏱️ Best times each day</strong>
      {days.map((d) => (
        <div key={d.date} className="small" data-testid="best-day">
          <strong>{d.label}:</strong> {d.best.length ? d.best.slice(0, 3).map((b) => `${b.name} ${b.block.text}${b.price != null ? ` ($${b.price})` : ''}`).join(' · ') : <span className="muted">nothing with {needed} in a row yet</span>}
        </div>
      ))}
    </div>
  );
}

/** On a desktop: every course × every day at a glance (the cards below are where the times are put in). */
export function TeeGridTable({ courses, dates, rows, need }) {
  if (!courses.length || !dates.length) return null;
  const cell = (r) => {
    if (!r || (!r.available && !(r.ranges || []).length && !(r.times || []).length)) return <span className="muted">—</span>;
    if (r.available === 'no') return <span style={{ color: 'var(--under)' }}>✗</span>;
    if (r.available === 'unknown') return <span style={{ color: '#7A5A00' }}>? ask again</span>;
    const b = bestBlock(slotsFor(r), need, { earliest: 0 });
    return <span>{b ? <strong>✓ {b.text}</strong> : (r.ranges || []).map((x) => x.replace('-', '–')).join(', ')}{r.price != null ? <span className="muted"> · ${Number(r.price)}</span> : null}</span>;
  };
  return (
    <div className="tee-grid" data-testid="tee-grid">
      <table>
        <thead><tr><th>Course</th>{dates.map((d) => <th key={d}>{dayShort(d)}</th>)}</tr></thead>
        <tbody>
          {courses.map((c) => (
            <tr key={c.course_id}><td><strong>{c.name}</strong></td>{dates.map((d) => <td key={d}>{cell(rows.find((r) => r.course_id === c.course_id && String(r.play_date).slice(0, 10) === d))}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
