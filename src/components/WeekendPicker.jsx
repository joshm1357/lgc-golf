// "Which weekends?" and "How long?" in the trip builder's step 1 (ov23, Josh 23 Oct): EVERY weekend in the window
// being looked at (default the next 6 months), grouped by month, each a chip "Fri 6 – Sun 8 Mar" with its tags (long
// weekend, school holidays). Tick any number into the shortlist — the shortlist goes to the vote — plus your own dates.
// "How long?" is either set (1 / 2 / 3 nights, or a day trip) or put to the group ("Let the group vote on how long").
// The maths is in lib/weekends.js.
import React, { useMemo, useState } from 'react';
import { Seg, toast } from './ui.jsx';
import { todayISO } from '../lib/plan.js';
import * as TB from '../lib/tripbuilder.js';
import {
  weekendsInWindow, byMonth, weekendTags, toggleWeekend, customWeekend, addMonths, monthLabel, resizeWeekend,
  LENGTHS, lengthLabel, SCHOOL_KNOWN_TO,
} from '../lib/weekends.js';

const SPANS = [3, 4, 6, 9, 12];

export function LengthPicker({ st, save, org, leading = null }) {
  const lv = st.lengthVote || { on: false, options: [1, 2, 3] };
  const setNights = (n) => {
    if (!org) return;
    // The shortlist keeps its weekends — each one just gets the new dates (ov23; it used to be cleared).
    save({ ...st, nights: n, days: TB.resizeDays(st.days, n), weekends: (st.weekends || []).map((w) => resizeWeekend(w, n, st.extraNight || null)), weekendsSettled: false });
  };
  const setLv = (p) => save({ ...st, lengthVote: { ...lv, ...p } });
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="length-picker">
      <span className="label">How long?</span>
      {/* V2 (walkthrough): while the vote's deciding the length, the switch shows the leader, not the old setting. */}
      <Seg light options={LENGTHS.map((n) => ({ value: n, label: n === 0 ? 'Day trip' : `${n} night${n === 1 ? '' : 's'}` }))} value={lv.on && leading != null && !st.weekendsSettled ? leading : st.nights} onChange={setNights} />
      {org && (
        <label className="row small" style={{ gap: 8, minHeight: 40 }}>
          <input type="checkbox" checked={!!lv.on} onChange={(e) => setLv({ on: e.target.checked })} style={{ width: 22, height: 22 }} data-testid="length-vote" />
          <span>Let the group vote on how long</span>
        </label>
      )}
      {lv.on && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="tb-chips" data-testid="length-options">
            {LENGTHS.map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={(lv.options || []).includes(n)} disabled={!org}
                onClick={() => setLv({ options: (lv.options || []).includes(n) ? lv.options.filter((x) => x !== n) : [...(lv.options || []), n].sort() })}>{lengthLabel(n)}</button>
            ))}
          </div>
          <span className="small muted">“How long?” goes on the vote next to the area and the weekends. Each weekend on the ballot shows what it would be at each length (e.g. “Plus Mon if we go 3 nights”).{leading != null ? ` Leading: ${lengthLabel(leading)}.` : ''}</span>
          {(lv.options || []).includes(3) && (
            <div className="row small" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span>If it’s 3 nights, add the night:</span>
              <Seg light options={[{ value: 'thu', label: 'Thursday' }, { value: 'mon', label: 'Monday' }]} value={st.extraNight || 'mon'} onChange={(v) => org && save({ ...st, extraNight: v })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WeekendPicker({ st, save, org, points = {}, nights = null }) {
  const win = st.window || { from: todayISO().slice(0, 7), months: 6 };
  const n = nights ?? st.nights ?? 2;
  const all = useMemo(() => weekendsInWindow({ from: win.from, months: win.months, nights: n, side: st.extraNight || null }), [win.from, win.months, n, st.extraNight]);
  const groups = byMonth(all);
  const list = st.weekends || [];
  const [own, setOwn] = useState({ start: '', end: '' });
  const on = (w) => list.some((x) => (x.from || x.start) === w.start || x.start === w.start);
  const tick = (w) => {
    if (!org) return;
    const next = toggleWeekend(list, w, TB.MAX_WEEKENDS);
    if (next === list) { toast(`Up to ${TB.MAX_WEEKENDS} weekends`); return; }
    save({ ...st, weekends: next, weekendsSettled: false });
  };
  const addOwn = () => {
    const w = customWeekend(own.start, own.end);
    if (!w) { toast('Pick a start date from today, at most 10 days long'); return; }
    if (list.some((x) => x.start === w.start)) { toast('Already on the shortlist'); return; }
    save({ ...st, weekends: [...list, { start: w.start, end: w.end, long: false, holiday: w.holiday, school: w.school, custom: true }].sort((a, b) => a.start.localeCompare(b.start)), weekendsSettled: false });
    setOwn({ start: '', end: '' });
  };
  const months = Array.from({ length: 12 }, (_, i) => addMonths(todayISO().slice(0, 7), i));
  const pts = (k) => (points[k] ? <span className="tb-chip-pts">{points[k]}</span> : null);
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="weekend-picker">
      <span className="label">Which weekends? Tick as many as you like — the shortlist goes to the vote</span>
      {org && (
        <div className="row small" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Looking at</span>
          <select className="select" value={win.from} aria-label="From month" onChange={(e) => save({ ...st, window: { ...win, from: e.target.value } })} style={{ maxWidth: 160 }}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <span>for</span>
          <select className="select" value={win.months} aria-label="How many months" onChange={(e) => save({ ...st, window: { ...win, months: Number(e.target.value) } })} style={{ maxWidth: 120 }}>
            {SPANS.map((m) => <option key={m} value={m}>{m} months</option>)}
          </select>
        </div>
      )}
      <div className="stack" style={{ gap: 8 }} data-testid="tb-weekend-options">
        {groups.map((g) => (
          <div key={g.month} className="stack" style={{ gap: 4 }} data-testid="weekend-month">
            <span className="small" style={{ fontWeight: 800 }}>{g.label}</span>
            <div className="tb-chips">
              {g.weekends.map((w) => (
                <button key={w.start} type="button" className="chip wk-chip" aria-pressed={on(w)} disabled={!org} onClick={() => tick(w)} data-testid="weekend-chip" data-start={w.start}
                  title={weekendTags(w).join(' · ') || undefined}
                  style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', minHeight: 44, lineHeight: 1.25, maxWidth: '100%', whiteSpace: 'normal', textAlign: 'left', padding: '6px 14px' }}>
                  <span>{w.label}{(st.lengthVote?.on || n !== 2) && <span style={{ fontWeight: 400, opacity: 0.75 }}> ({lengthLabel(n).toLowerCase()})</span>}{pts(`weekend:${w.start}`)}</span>
                  {weekendTags(w).length > 0 && <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }} data-testid="weekend-tags">{weekendTags(w).map((t) => (t.startsWith('School') ? `🎒 ${t}` : `🏖️ ${t}`)).join(' · ')}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <span className="small muted">🏖️ long weekend (NSW public holiday) · 🎒 NSW school holidays{all.some((w) => w.start > SCHOOL_KNOWN_TO) ? ` (known to ${monthLabel(SCHOOL_KNOWN_TO.slice(0, 7))})` : ''}</span>
      {org && (
        <div className="row small" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }} data-testid="custom-dates">
          <label className="field"><span>Your own dates: from</span><input className="input" type="date" min={todayISO()} value={own.start} onChange={(e) => setOwn({ ...own, start: e.target.value })} aria-label="Own dates from" /></label>
          <label className="field"><span>to</span><input className="input" type="date" min={own.start || todayISO()} value={own.end} onChange={(e) => setOwn({ ...own, end: e.target.value })} aria-label="Own dates to" /></label>
          <button type="button" className="btn ghost sm" disabled={!own.start} onClick={addOwn}>+ Add</button>
        </div>
      )}
      <div className="card pad stack" style={{ gap: 4 }} data-testid="tb-weekends">
        <strong className="small">📅 The shortlist ({list.length})</strong>
        {!list.length && <span className="small muted">Nothing ticked yet.</span>}
        {list.map((w) => (
          <div key={w.start} className="row between small" style={{ gap: 6 }} data-testid="shortlist-weekend">
            <span>{TB.weekendLabel({ start: w.start, end: w.end })}{w.custom ? ' · your dates' : ''}{w.long ? ' · 🏖️ long weekend' : ''}{w.school ? ' · 🎒 school hols' : ''}{pts(`weekend:${w.from || w.start}`)}</span>
            {org && <button type="button" className="btn ghost sm" aria-label={`Take ${w.start} off`} onClick={() => save({ ...st, weekends: list.filter((x) => x.start !== w.start), weekendsSettled: false })}>✕</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
