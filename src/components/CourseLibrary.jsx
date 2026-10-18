import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { getFix } from '../lib/geo.js';
import { parTotal } from '../lib/scoring.js';
import { Sheet, toast } from './ui.jsx';

// Stage 8: the shared course library. One group sets up a course (pars, stroke index, greens) and shares it; the next
// group finds it by name or nearest, and gets its own copy to adjust — the shared one doesn't change.

const OsmCredit = () => <>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</>;

/** Search the library and add a course to this group. */
export function FindCourse({ onAdded, hint = 'add it below' }) {
  const data = useData();
  const [busy, run] = useRun();
  const [q, setQ] = useState('');
  const near = useRef(null); // where this phone is, once asked — every search after that is nearest first
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0); // replies can come back out of order: only the newest search counts

  const search = async (query = q, at = near.current) => {
    const ticket = ++latest.current;
    const { data: found, error } = await supabase.rpc('search_courses', { p_query: query, p_lat: at?.lat ?? null, p_lng: at?.lng ?? null, p_limit: 20 });
    if (ticket !== latest.current) return;
    if (error) {
      if (/PGRST202|Could not find the function/i.test(`${error.code} ${error.message}`)) { setRows([]); toast('The course library isn’t switched on yet.'); return; }
      throw error;
    }
    setFailed(false);
    setRows(found || []);
  };
  useEffect(() => {
    const t = setTimeout(() => { search().catch(() => { setFailed(true); setRows([]); }); }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearMe = () => run(async () => {
    const f = await getFix();
    near.current = f;
    await search(q, f);
  });
  const have = new Set(data.courses.map((c) => c.library_id).filter(Boolean));
  const sameName = (r) => data.courses.some((c) => !c.library_id && c.name.trim().toLowerCase() === r.name.trim().toLowerCase());
  const add = (row) => run(async () => {
    const id = await must(supabase.rpc('copy_library_course', { p_id: row.id }));
    await data.reload();
    setOpen(null);
    onAdded?.(id);
  }, `${row.name} added to your courses`);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="input grow" style={{ minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by course or town" aria-label="Search courses" />
        <button type="button" className="btn ghost" disabled={busy} onClick={nearMe}>📍 Near me</button>
      </div>
      {rows == null && <span className="small muted">Searching…</span>}
      {failed && <span className="small err" style={{ margin: 0 }}>Couldn’t search — no signal? Try again in a moment.</span>}
      {rows && !rows.length && !failed && <span className="small muted">{q ? `No courses by that name yet — ${hint}, then share it so the next group finds it.` : 'No courses in the library yet.'}</span>}
      {rows?.map((r) => (
        <button key={r.id} type="button" className="card pad stack" style={{ gap: 2, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => setOpen(r)}>
          <div className="row between" style={{ gap: 8 }}>
            <strong style={{ minWidth: 0 }}>{r.name}</strong>
            {r.km != null && <span className="small muted" style={{ flex: 'none' }}>{Number(r.km) < 10 ? Number(r.km).toFixed(1) : Math.round(Number(r.km))} km</span>}
          </div>
          <span className="small muted">{[r.area, `${r.holes} holes`, r.greens ? `${r.greens} greens mapped` : 'no greens mapped yet', r.copies ? `used by ${r.copies} group${r.copies === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</span>
          {have.has(r.id) && <span className="small" style={{ fontWeight: 700 }}>✓ In your courses</span>}
          {r.osm && <span className="small muted">Greens <OsmCredit /></span>}
        </button>
      ))}
      {open && <LibraryCourse row={open} have={have.has(open.id)} sameName={sameName(open)} busy={busy} onAdd={() => add(open)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function LibraryCourse({ row, have, sameName, busy, onAdd, onClose }) {
  const [course, setCourse] = useState(null);
  useEffect(() => {
    supabase.rpc('library_course', { p_id: row.id }).then(({ data }) => setCourse(data || null));
  }, [row.id]);
  const holes = course?.holes || [];
  return (
    <Sheet title={row.name} onClose={onClose}>
      <div className="stack">
        <span className="small muted">{[row.area, `${row.holes} holes`, holes.length ? `par ${parTotal(holes)}` : null].filter(Boolean).join(' · ')}</span>
        {holes.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(9, holes.length)}, minmax(0, 1fr))`, gap: 4, textAlign: 'center' }} className="small">
            {holes.map((h) => (
              <div key={h.n} style={{ background: 'var(--ground, #F4F5F7)', borderRadius: 6, padding: '4px 0' }}>
                <div className="muted" style={{ fontSize: 11 }}>{h.n}</div><strong>{h.par}</strong><div className="muted" style={{ fontSize: 11 }}>SI {h.si}</div>
              </div>
            ))}
          </div>
        )}
        <span className="small muted">You get your own copy: change tees, greens or anything else for your group without changing it for anyone else.</span>
        {row.osm && <span className="small muted">Some greens are from OpenStreetMap — <OsmCredit />.</span>}
        {sameName && !have && <span className="small err" style={{ margin: 0 }}>You already have a course called {row.name} (added by hand). Adding this gives you a second one — fine if you want its greens.</span>}
        <button type="button" className="btn gold block" disabled={busy || have} onClick={onAdd}>{have ? 'Already in your courses' : sameName ? 'Add it anyway' : 'Add to our courses'}</button>
      </div>
    </Sheet>
  );
}

/** Share one of this group's courses with other groups (or update the shared one, or give greens back to it). */
export function ShareCourse({ course }) {
  const data = useData();
  const [busy, run] = useRun();
  const [asking, setAsking] = useState(false);
  const [area, setArea] = useState('');
  const [entry, setEntry] = useState(null); // the library entry this course is linked to
  const linked = !!course.library_id;
  useEffect(() => {
    if (!asking || !linked) return;
    supabase.rpc('library_course', { p_id: course.library_id }).then(({ data: e }) => setEntry(e || false));
  }, [asking, linked, course.library_id]);
  const mine = entry && entry.mine;
  const share = () => run(async () => {
    await must(supabase.rpc('share_course', { p_course_id: course.id, p_area: area.trim() || null }));
    await data.reload();
    setAsking(false);
  }, !linked ? `${course.name} shared — other groups can find it now` : mine ? 'Shared copy updated' : 'Thanks — your greens are in the library now');
  return (
    <>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setAsking(true)}>{linked ? 'Library ✓' : 'Share'}</button>
      {asking && (
        <Sheet title={!linked ? `Share ${course.name}` : `${course.name} is in the library`} onClose={() => setAsking(false)}>
          <div className="stack">
            {linked && entry === null && <span className="small muted">Checking…</span>}
            {linked && entry && !mine && <span className="small">This came from the course library. If you’ve mapped greens or tees it’s missing, you can give them back — they only fill gaps, nothing anyone else mapped changes.</span>}
            {linked && mine && <span className="small">You shared this one. {entry.copies > 0 ? `${entry.copies} other group${entry.copies === 1 ? ' uses' : 's use'} it, so sharing again only fills in missing tees and greens.` : 'Sharing again updates it with your changes.'}</span>}
            {!linked && <span className="small">Other groups can find it in the course library and add their own copy. They get the name, pars, stroke index, tees and greens — never your rounds, scores, pins or players.</span>}
            {(!linked || mine) && <label className="field"><span>Town and state (helps people find it)</span><input className="input" value={area} maxLength={80} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Bowral NSW" /></label>}
            {(!linked || entry) && (
              <button type="button" className="btn gold block" disabled={busy} onClick={share}>{!linked ? 'Share with other groups' : mine ? 'Update the shared copy' : 'Give our greens to the library'}</button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
