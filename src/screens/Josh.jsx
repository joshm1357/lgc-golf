import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useRun, must } from '../lib/run.js';
import { QrCard } from '../components/QrCard.jsx';

// Stage 9: Josh's own screen (#/club/josh; platform admins only — the database checks too).
// Numbers (counts only, no names), app problems the app has reported, and stay cards for accommodation.

const PLACES = { cart: 'Cart sticker', par3: 'Par 3 sign', counter: 'Counter card', tv: 'Clubhouse TV', stay: 'Stay card' };

export default function JoshPage({ Top }) {
  const [tab, setTab] = useState('numbers');
  return (
    <>
      <Top title="Josh’s screen" sub="Counts only — no names" />
      <div className="stack" style={{ maxWidth: 640, margin: '0 auto', padding: 16, gap: 12 }}>
        <a href="#/club" className="small">← Back</a>
        <div className="seg light" role="group" aria-label="Show">
          {[['numbers', 'Numbers'], ['problems', 'App problems'], ['stays', 'Stay cards']].map(([k, label]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        {tab === 'numbers' && <Numbers />}
        {tab === 'problems' && <Problems />}
        {tab === 'stays' && <Stays />}
      </div>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card" style={{ padding: '8px 6px', textAlign: 'center' }}>
      <div className="num" style={{ fontSize: 24 }}>{value ?? 0}</div>
      <div className="small muted">{label}</div>
    </div>
  );
}

function Numbers() {
  const [days, setDays] = useState(90);
  const [u, setU] = useState(null);
  const [b, setB] = useState(null);
  useEffect(() => {
    setU(null);
    supabase.rpc('admin_usage', { p_days: days }).then(({ data }) => setU(data || {}));
    supabase.rpc('admin_booking_numbers', { p_days: days }).then(({ data }) => setB(data || null), () => setB(null));
  }, [days]);
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
        <option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option><option value={3650}>All time</option>
      </select>
      {!u ? <span className="muted">Loading…</span> : (
        <>
          <strong>Groups</strong>
          <div style={grid}>
            <Stat label="All groups" value={u.groups?.all} />
            <Stat label={`New (${days < 3650 ? `${days} days` : 'all time'})`} value={u.groups?.new} />
            <Stat label="Quick rounds" value={u.groups?.quick} />
            <Stat label="Proper groups" value={u.groups?.official} />
            <Stat label="Came back" value={u.groups?.came_back} />
            <Stat label="Planned a trip" value={u.groups?.planned_a_trip} />
          </div>
          <span className="small muted">“Came back” = scored on two or more different days. {u.groups?.from_another_groups_card ?? 0} group(s) started from another group’s results card or invite.</span>
          <strong>Trips</strong>
          <div style={grid}>
            <Stat label="Trips run" value={u.trips?.run} />
            <Stat label="Avg players scoring" value={u.trips?.players_scoring_avg} />
            <Stat label="Most players" value={u.trips?.players_scoring_max} />
          </div>
          <strong>Scan funnel (by club and where the code is)</strong>
          {!u.funnel?.length ? <span className="small muted">No scans yet.</span> : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ textAlign: 'left' }}><th style={{ padding: 6 }}>Where</th><th>Scans</th><th>Groups</th><th>Played</th><th>Back / trip</th></tr></thead>
                <tbody>
                  {u.funnel.map((f) => (
                    <tr key={`${f.ref}-${f.placement}`} style={{ borderTop: '1px solid var(--line, #E3E6EA)' }}>
                      <td style={{ padding: 6 }}><strong>{f.name}</strong><div className="muted">{PLACES[f.placement] || f.placement}{f.kind === 'stay' ? ' · stay' : ''}</div></td>
                      <td>{f.scans}</td><td>{f.groups_started}</td><td>{f.rounds_started}</td><td>{f.came_back_or_planned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {b && (
            <>
              <strong>Bookings (no money changes hands)</strong>
              <span className="small">Group booking enquiries: {(b.enquiries || []).length ? b.enquiries.map((e) => `${e.name} ${e.n}`).join(' · ') : 'none yet'}</span>
              <span className="small">Booking-link taps: {Object.keys(b.link_taps || {}).length ? Object.entries(b.link_taps).map(([k, n]) => `${{ stay: 'accommodation', golf: 'courses', transport: 'getting there' }[k] || k} ${n}`).join(' · ') : 'none yet'}</span>
            </>
          )}
          <span className="small muted">Scans count each phone once a day. Groups = started from that code; Played = scored a round; Back / trip = came back or planned a trip.</span>
        </>
      )}
    </div>
  );
}

function Problems() {
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { setRows(null); supabase.rpc('admin_errors', { p_days: days }).then(({ data }) => setRows(data || [])); }, [days]);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
        <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
      </select>
      {rows == null && <span className="muted">Loading…</span>}
      {rows && !rows.length && <span className="muted">No problems reported. 🎉</span>}
      {rows?.map((r) => (
        <button key={r.message} type="button" className="card pad stack" style={{ gap: 4, textAlign: 'left', font: 'inherit', color: 'inherit' }} onClick={() => setOpen(open === r.message ? null : r.message)}>
          <strong style={{ overflowWrap: 'anywhere' }}>{r.message}</strong>
          <span className="small muted">{r.times}× on {r.phones} phone{r.phones === 1 ? '' : 's'} · last {new Date(r.last_seen).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })} · {r.path || '—'} · version {r.version || '?'}</span>
          {open === r.message && (
            <pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0, maxHeight: 240, overflow: 'auto' }}>{[r.stack, r.agent].filter(Boolean).join('\n\n')}</pre>
          )}
        </button>
      ))}
      <span className="small muted">The app sends these itself when something breaks on a phone — the message, where in the code, the screen and the version. No names.</span>
    </div>
  );
}

function Stays() {
  const [busy, run] = useRun();
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const [card, setCard] = useState(null);
  const [course, setCourse] = useState('');
  const load = useCallback(() => supabase.rpc('admin_stays').then(({ data }) => setRows(data || [])), []);
  useEffect(() => { load(); }, [load]);
  const add = () => run(async () => {
    const s = await must(supabase.rpc('admin_new_stay', { p_name: name.trim() }));
    setName('');
    await load();
    setCard(s);
  }, 'Stay card made');
  if (card) return <StayCard stay={card} course={course} setCourse={setCourse} onClose={() => setCard(null)} />;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="small">Cards for accommodation — welcome packs, stay-and-play confirmations. Scans and groups started from them show in the numbers. No account needed for the place.</span>
      <div className="row" style={{ gap: 8 }}>
        <input className="input grow" style={{ minWidth: 0 }} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Place, e.g. Bowral Motor Inn" aria-label="Place name" />
        <button type="button" className="btn" disabled={busy || name.trim().length < 2} onClick={add}>Make</button>
      </div>
      {rows == null && <span className="muted">Loading…</span>}
      {rows?.map((s) => (
        <button key={s.id} type="button" className="card pad row between" style={{ gap: 8, textAlign: 'left', font: 'inherit', color: 'inherit' }} onClick={() => setCard(s)}>
          <span style={{ minWidth: 0 }}><strong>{s.name}</strong><div className="small muted">{s.ref} · {s.scans} scan{Number(s.scans) === 1 ? '' : 's'} · {s.groups} group{Number(s.groups) === 1 ? '' : 's'}</div></span>
          <span className="small" style={{ flex: 'none', fontWeight: 700 }}>Card →</span>
        </button>
      ))}
    </div>
  );
}

function StayCard({ stay, course, setCourse, onClose }) {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
  const slug = course.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const link = slug ? `${base}#/c/${slug}?ref=${stay.ref}&p=stay` : `${base}#/start?ref=${stay.ref}&p=stay`;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <style>{'@media print { .no-print { display: none !important; } body { background: #fff !important; } }'}</style>
      <div className="no-print stack" style={{ gap: 8 }}>
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onClose}>← Stay cards</button>
        <div className="card pad small" style={{ borderColor: 'var(--gold)' }}>
          <strong>Draft — please don’t print yet.</strong> This code points at the test address until The Golf Trip moves to its own web address.
        </div>
        <label className="field"><span>Course it’s for (optional — the course page’s web name, e.g. bowral-golf-club)</span>
          <input className="input" value={course} onChange={(e) => setCourse(e.target.value)} placeholder="Leave empty to open “Start your group”" /></label>
        <button type="button" className="btn block" onClick={() => window.print()}>🖨️ Print or save as PDF</button>
      </div>
      <QrCard link={link} title={`Staying at ${stay.name}?`} line="Bring the group — live scores, side comps and trophies on everyone’s phone. Free. Scan to start." />
      <span className="no-print small muted" style={{ overflowWrap: 'anywhere' }}>{link}</span>
    </div>
  );
}
