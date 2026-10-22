// Trip finder (Stage 16): which courses suit the group, ranked, on a map — and put 1–3 to the group.
//   /plan/:planId/find   (organisers; behind the 'trip_finder' feature switch)
// Few questions: 1–3 starting AREAS with headcounts (filled from players' shared home suburbs), the day, 9 or 18
// holes and the longest drive. Everything else is worked out (src/lib/teeWindow.js, src/lib/tripfinder.js).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession, useFeature } from '../lib/store.jsx';
import { Header, Loading, Sheet, Seg, toast } from '../components/ui.jsx';
import { useRun, must } from '../lib/run.js';
import { notify } from '../lib/push.js';
import TripMap, { FIT_COLOUR, FIT_WORD } from '../components/TripMap.jsx';
import PlaceSearch from '../components/PlaceSearch.jsx';
import {
  FACTS, PRESETS, MAX_PICKS, MAX_STARTS, searchBox, findCourses, startsFromHomes, startsText, defaultDay, voteOptions, cleanStart,
  fmtDrive, factLine,
} from '../lib/tripfinder.js';
import { teeGroupSizes, clock, ampm, toMin, DEFAULT_LEAVE, DEFAULT_FINISH } from '../lib/teeWindow.js';
import './tripfinder.css';

const DRIVES = [60, 90, 120, 150, 180, 210, 240, 300, 360];
const FILTERS = [
  ['fitsOnly', 'Fits only'], ['takesGroup', 'Takes our size'], ['stayPlay', 'Stay and play'], ['notPlayed', 'Not played before'], ['favourites', 'Our favourites'],
];

function useWide() {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return undefined;
    const on = () => setWide(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return wide;
}

const toStart = (r) => ({ id: r.id, label: r.label, lat: r.lat, lng: r.lng, count: r.headcount, leave: r.leave_after, finish: r.finish_by });

export default function TripFinder() {
  const { planId } = useParams();
  const { status } = useSession();
  const nav = useNavigate();
  const votesOn = useFeature('planner_tasks');
  const feedOn = useFeature('feed');
  const wide = useWide();
  const [base, setBase] = useState(null);
  const [courses, setCourses] = useState(null);
  const [failed, setFailed] = useState('');
  const [s, setS] = useState(null); // settings: day, holes, players, maxDrive, preset, filters
  const [view, setView] = useState('list');
  const [picked, setPicked] = useState([]);
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, run] = useRun();

  const load = useCallback(async () => {
    const [plan, find, starts, homes, rsvps] = await Promise.all([
      supabase.from('plans').select('*').eq('id', planId).maybeSingle(),
      supabase.from('trip_finds').select('*').eq('plan_id', planId).maybeSingle(),
      supabase.from('trip_start_points').select('*').eq('plan_id', planId).order('sort').order('created_at'),
      supabase.from('player_home_areas').select('*'),
      supabase.from('plan_rsvps').select('*').eq('plan_id', planId),
    ]);
    setBase({ plan: plan.data, find: find.data, starts: (starts.data || []).map(toStart), homes: homes.data || [], rsvps: rsvps.data || [] });
    setS((cur) => cur || {
      day: find.data?.day || defaultDay(plan.data || {}),
      holes: find.data?.holes || 18,
      players: find.data?.players ?? null,
      maxDrive: find.data?.max_drive_min || 180,
      preset: find.data?.preset || 'fair',
      filters: find.data?.filters || {},
    });
  }, [planId]);
  useEffect(() => { load(); }, [load]);

  const starts = base?.starts || [];
  const startsKey = starts.map((x) => `${x.lat},${x.lng},${x.count},${x.leave},${x.finish}`).join('|');
  const players = s?.players ?? (starts.reduce((n, x) => n + x.count, 0) || null);

  // Courses in reach of the starting points (the library), with their shared facts and ratings.
  const reload = useCallback(async () => {
    const box = searchBox(starts, s?.maxDrive || 180);
    if (!box) { setCourses([]); return; }
    const { data: rows, error } = await supabase.rpc('trip_finder_courses', {
      p_south: box.south, p_west: box.west, p_north: box.north, p_east: box.east, p_lat: box.lat, p_lng: box.lng, p_limit: 300,
    });
    if (error) { setFailed(error.message || 'Couldn’t load courses'); setCourses([]); return; }
    setFailed('');
    setCourses(Array.isArray(rows) ? rows : []);
  }, [startsKey, s?.maxDrive]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (base && s) reload(); }, [base, s?.maxDrive, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // Settings are saved for the trip (quietly, a moment after the last change).
  const first = useRef(true);
  useEffect(() => {
    if (!s || !base) return undefined;
    if (first.current) { first.current = false; return undefined; }
    const t = setTimeout(() => {
      supabase.from('trip_finds').upsert({
        plan_id: planId, day: s.day || null, holes: s.holes, players: s.players, max_drive_min: s.maxDrive, preset: s.preset, filters: s.filters,
      }, { onConflict: 'plan_id' }).then(() => {}, () => {});
    }, 800);
    return () => clearTimeout(t);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = useMemo(() => s && ({ starts, players: players || 0, holes: s.holes, day: s.day, maxDriveMin: s.maxDrive, now: new Date() }), [s, startsKey, players]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => (courses && ctx ? findCourses(courses, ctx, s.preset) : []), [courses, ctx, s?.preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (courses && ctx ? findCourses(courses, ctx, s.preset, s.filters) : []), [courses, ctx, s?.preset, s?.filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => all.reduce((c, a) => ({ ...c, [a.status]: (c[a.status] || 0) + 1 }), {}), [all]);

  if (!base || !s) return <div className="page"><Header back="Trip" title="Find a course" /><Loading /></div>;
  if (!base.plan) return <div className="page"><Header back="Trip" title="Find a course" /><div className="empty">This trip has been removed.</div></div>;
  if (!status.is_admin) return <div className="page"><Header back="Trip" title="Find a course" sub={base.plan.name} /><div className="empty">The trip finder is for organisers. Ask yours to put some options to the group.</div></div>;

  const set = (patch) => setS((cur) => ({ ...cur, ...patch }));
  const setFilter = (k, v) => set({ filters: { ...s.filters, [k]: v } });
  const sizes = teeGroupSizes(players || 0);
  const pickedRows = picked.map((id) => all.find((a) => a.course.id === id)).filter(Boolean);
  const toggle = (id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_PICKS ? (toast(`Up to ${MAX_PICKS} options — untick one first`), cur) : [...cur, id]));

  // Players who've said they're in (if anyone has), else everyone who shared a home suburb.
  const inIds = new Set(base.rsvps.filter((r) => r.status === 'in').map((r) => r.player_id));
  const homes = base.homes.filter((h) => !inIds.size || inIds.has(h.player_id));
  const fillFromHomes = () => run(async () => {
    const made = startsFromHomes(homes);
    if (!made.length) throw new Error('Nobody has shared a home suburb yet');
    await must(supabase.from('trip_start_points').insert(made.map((m, i) => ({
      plan_id: planId, label: m.label, lat: m.lat, lng: m.lng, headcount: m.count, leave_after: m.leave, finish_by: m.finish, sort: i,
    }))));
    await load();
  }, 'Starting points filled in');

  const putToGroup = () => run(async () => {
    const r = await must(supabase.rpc('trip_finder_to_group', { p_plan: planId, p_options: voteOptions(pickedRows, { day: s.day }) }));
    if (feedOn) {
      try { await supabase.from('posts').insert({ kind: 'user', player_id: status.player_id, body: `🗳️ ${pickedRows.length} course${pickedRows.length === 1 ? '' : 's'} up for a vote for ${base.plan.name} — have your say.`, link: `/plan/${planId}` }); } catch { /* the feed is a nice-to-have */ }
    }
    if (r?.poll_id) notify('poll_open', { poll_id: r.poll_id }).catch(() => {});
    nav(`/plan/${planId}?tab=vote`);
  }, 'Put to the group — the vote is up');

  const decide = (a) => run(async () => {
    await must(supabase.rpc('trip_finder_decide', { p_plan: planId, p_course: a.course.id, p_day: s.day || null }));
    nav(`/plan/${planId}?tab=details`);
  }, `Decided: ${a.course.name}`);

  const list = (
    <div className="card" data-testid="tf-list" style={{ overflow: 'hidden' }}>
      {courses == null && <div className="empty">Finding courses…</div>}
      {courses && !shown.length && <div className="empty">{starts.length ? 'No courses match — try a longer drive or fewer filters.' : 'Add where people are coming from to see courses.'}</div>}
      {shown.slice(0, 60).map((a, i) => (
        <div key={a.course.id} className="tf-row" data-testid="tf-row" data-status={a.status}>
          <span className="tf-rank" style={{ background: FIT_COLOUR[a.status] }} aria-label={FIT_WORD[a.status]}>{i + 1}</span>
          <div style={{ minWidth: 0 }}>
            <button type="button" className="tf-name" onClick={() => setOpen(a)}>{a.course.name}</button>
            <div className="small muted">{[a.course.area, a.played ? 'played before' : null, a.course.partner ? 'partner course' : null, a.stale ? 'some facts need checking' : null].filter(Boolean).join(' · ')}</div>
            <div className="tf-why" data-testid="tf-why" style={{ color: a.status === 'no' ? 'var(--muted)' : 'var(--text)' }}>{a.why}</div>
          </div>
          {a.status !== 'no'
            ? <button type="button" className="tf-tick" aria-pressed={picked.includes(a.course.id)} aria-label={`Tick ${a.course.name}`} onClick={() => toggle(a.course.id)}>{picked.includes(a.course.id) ? '✓' : '+'}</button>
            : <span />}
        </div>
      ))}
      {shown.length > 60 && <div className="small muted" style={{ padding: 10 }}>Showing the top 60 of {shown.length}.</div>}
    </div>
  );
  const map = <TripMap starts={starts} results={shown} picked={new Set(picked)} onOpen={setOpen} />;

  return (
    <div className="page">
      <Header back="Trip" title="Find a course" sub={base.plan.name} />
      <div className="section stack">
        {/* Where people are coming from */}
        <div className="card pad stack" data-testid="tf-starts">
          <div className="row between"><span className="label">Coming from</span>{starts.length > 0 && <span className="small muted">{startsText(starts)}</span>}</div>
          {starts.map((x) => (
            <button key={x.id} type="button" className="row between" onClick={() => setEditing(x)} style={{ background: 'none', border: 0, padding: '4px 0', textAlign: 'left', color: 'inherit', font: 'inherit' }}>
              <span><strong>{x.label} ×{x.count}</strong><div className="small muted">Leave after {clock(toMin(x.leave))} · finish by {ampm(toMin(x.finish))}</div></span>
              <span className="small" style={{ fontWeight: 700 }}>Edit</span>
            </button>
          ))}
          {!starts.length && homes.length > 0 && (
            <button type="button" className="btn gold" disabled={busy} onClick={fillFromHomes}>Fill in from {homes.length} home suburb{homes.length === 1 ? '' : 's'}</button>
          )}
          {starts.length < MAX_STARTS && <button type="button" className="btn ghost sm" onClick={() => setEditing({})}>+ Add a starting point</button>}
          <span className="small muted">Areas, not addresses — e.g. “Inner West ×8, Newcastle ×2”. Only organisers see these; they’re removed 30 days after the trip.</span>
        </div>

        {/* The day */}
        <div className="card pad stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="field grow"><span>Day</span><input className="input" type="date" value={s.day || ''} onChange={(e) => set({ day: e.target.value })} /></label>
            <label className="field" style={{ width: 110 }}><span>Players</span><input className="input" type="number" min="1" max="200" inputMode="numeric" value={players ?? ''} onChange={(e) => set({ players: e.target.value === '' ? null : Math.max(1, Math.min(200, Number(e.target.value))) })} aria-label="Players" /></label>
          </div>
          <Seg light options={[{ value: 18, label: '18 holes' }, { value: 9, label: '9 holes' }]} value={s.holes} onChange={(v) => set({ holes: v })} />
          <label className="field"><span>Longest drive anyone does: about {fmtDrive(s.maxDrive)}</span>
            <input type="range" min="0" max={DRIVES.length - 1} step="1" value={Math.max(0, DRIVES.indexOf(s.maxDrive))} onChange={(e) => set({ maxDrive: DRIVES[Number(e.target.value)] })} aria-label="Longest drive" />
          </label>
          {players > 0 && <span className="small muted">{players} players → {sizes.length} group{sizes.length === 1 ? '' : 's'} ({sizes.join(', ')}). Drive times are about: straight line × 1.3 at 80 km/h.</span>}
        </div>

        {/* Ranking and filters */}
        <Seg options={PRESETS} value={s.preset} onChange={(v) => set({ preset: v })} />
        <div className="tf-filters">
          {FILTERS.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={!!s.filters[k]} onClick={() => setFilter(k, !s.filters[k])}>{l}</button>)}
          <label className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Up to $
            <input type="number" min="0" inputMode="numeric" value={s.filters.maxPrice ?? ''} onChange={(e) => setFilter('maxPrice', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 60, border: 0, font: 'inherit' }} aria-label="Price per head up to" />
          </label>
        </div>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="tf-key">
            <span><i className="tf-dot" style={{ background: FIT_COLOUR.fits }} />Fits {counts.fits || 0}</span>
            <span><i className="tf-dot" style={{ background: FIT_COLOUR.check }} />Check {counts.check || 0}</span>
            <span><i className="tf-dot" style={{ background: FIT_COLOUR.no }} />Doesn’t fit {counts.no || 0}</span>
          </div>
          {!wide && <div className="tf-toggle"><Seg light options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} value={view} onChange={setView} /></div>}
        </div>
        {failed && <div className="err">{failed}</div>}
        {wide
          ? <div className="tf-split"><div className="tf-list">{list}</div><div className="tf-side">{map}</div></div>
          : view === 'map' ? map : list}
        <p className="note" style={{ margin: 0 }}>Course facts are shared by every group and say where they came from — never who. A fact older than a year says “check again”. Tap a course to add what you know.</p>
      </div>

      {picked.length > 0 && (
        <div className="fab card pad stack" style={{ gap: 8 }} data-testid="tf-bar">
          <span className="small"><strong>{picked.length} ticked:</strong> {pickedRows.map((a) => a.course.name).join(', ')}</span>
          <div className="row" style={{ gap: 8 }}>
            {votesOn && base.plan.status === 'planning' && <button type="button" className="btn gold grow" disabled={busy} onClick={putToGroup}>Put to the group</button>}
            <button type="button" className="btn ghost grow" disabled={busy || picked.length !== 1} onClick={() => decide(pickedRows[0])} title={picked.length !== 1 ? 'Tick just one to decide' : ''}>Just decide</button>
          </div>
        </div>
      )}

      {editing && <StartSheet planId={planId} start={editing} count={starts.length} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {open && <CourseSheet a={open} ticked={picked.includes(open.course.id)} onTick={() => toggle(open.course.id)} onDecide={() => decide(open)} busy={busy}
        onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

// ---------------------------------------------------------------- a starting point
function StartSheet({ planId, start, count, onClose, onSaved }) {
  const [v, setV] = useState({ label: start.label || '', lat: start.lat ?? null, lng: start.lng ?? null, count: start.count || 1, leave: start.leave || DEFAULT_LEAVE, finish: start.finish || DEFAULT_FINISH });
  const [busy, run] = useRun();
  const ok = v.label.trim().length >= 2 && v.lat != null;
  const save = () => run(async () => {
    const c = cleanStart(v);
    const row = { label: c.label, lat: c.lat, lng: c.lng, headcount: c.count, leave_after: c.leave, finish_by: c.finish };
    if (start.id) await must(supabase.from('trip_start_points').update(row).eq('id', start.id));
    else await must(supabase.from('trip_start_points').insert({ ...row, plan_id: planId, sort: count }));
    onSaved();
  }, 'Saved');
  const remove = () => run(async () => {
    await must(supabase.from('trip_start_points').delete().eq('id', start.id));
    onSaved();
  }, 'Removed');
  return (
    <Sheet title={start.id ? 'Starting point' : 'Add a starting point'} onClose={onClose}>
      <div className="stack">
        <span className="small muted">An area people leave from — a suburb or town, never an address. Pick it from the list, or tap the map.</span>
        <PlaceSearch initial={v.label} onPick={(p) => setV((x) => ({ ...x, label: p.label || x.label, lat: p.lat, lng: p.lng }))} />
        <TripMap className="tf-mini" labels={false} starts={v.lat != null ? [{ label: v.label || 'Here', lat: v.lat, lng: v.lng, count: v.count }] : []}
          frame={v.lat != null ? [{ lat: v.lat, lng: v.lng }] : [{ lat: -33.87, lng: 151.21 }]} onTap={(p) => setV((x) => ({ ...x, lat: p.lat, lng: p.lng }))} />
        <label className="field"><span>Name it</span><input className="input" value={v.label} maxLength={60} onChange={(e) => setV({ ...v, label: e.target.value.replace(/[0-9]/g, '') })} placeholder="e.g. Inner West" /></label>
        <div className="row" style={{ gap: 8 }}>
          <span className="grow"><strong>How many</strong></span>
          <button type="button" className="btn ghost sm" aria-label="One fewer" onClick={() => setV({ ...v, count: Math.max(1, v.count - 1) })}>−</button>
          <strong style={{ minWidth: 28, textAlign: 'center' }} data-testid="tf-count">{v.count}</strong>
          <button type="button" className="btn ghost sm" aria-label="One more" onClick={() => setV({ ...v, count: Math.min(60, v.count + 1) })}>+</button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="field grow"><span>Leave after</span><input className="input" type="time" value={v.leave} onChange={(e) => setV({ ...v, leave: e.target.value })} /></label>
          <label className="field grow"><span>Finish by</span><input className="input" type="time" value={v.finish} onChange={(e) => setV({ ...v, finish: e.target.value })} /></label>
        </div>
        <button type="button" className="btn gold block" disabled={busy || !ok} onClick={save}>Save</button>
        {start.id && <button type="button" className="btn danger block" disabled={busy} onClick={remove}>Remove</button>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- one course: why, facts, notes
function CourseSheet({ a, ticked, onTick, onDecide, onClose, onChanged, busy }) {
  const [adding, setAdding] = useState(false);
  const [notes, setNotes] = useState(null);
  const [note, setNote] = useState('');
  const [working, run] = useRun();
  const w = a.teeWindow;
  const loadNotes = useCallback(async () => {
    const { data } = await supabase.from('course_notes').select('*').eq('course_id', a.course.id).order('created_at', { ascending: false });
    setNotes(data || []);
  }, [a.course.id]);
  useEffect(() => { loadNotes(); }, [loadNotes]);
  const addNote = () => run(async () => {
    await must(supabase.from('course_notes').insert({ course_id: a.course.id, body: note.trim() }));
    setNote(''); loadNotes();
  }, 'Note saved — only your group sees it');
  return (
    <Sheet title={a.course.name} onClose={onClose}>
      <div className="stack" data-testid="tf-course">
        <div className="small muted">{a.course.area}</div>
        <div className="card pad" style={{ borderColor: FIT_COLOUR[a.status], borderWidth: 2 }}>
          <strong style={{ color: a.status === 'no' ? 'var(--muted)' : 'var(--text)' }}>{FIT_WORD[a.status]}</strong>
          <div className="small">{a.why}</div>
          {w.groups > 0 && <div className="small muted" style={{ marginTop: 4 }}>{w.groups} group{w.groups === 1 ? '' : 's'} ({w.sizes.join(', ')}), {w.interval} min apart, {fmtDrive(w.roundMinutes)} a round. First tee from {clock(w.earliest)}{w.fits ? ` to ${clock(w.latest)}` : ''}.</div>}
        </div>
        <span className="label">Drives (about)</span>
        {a.drives.list.map((d) => <div key={d.label} className="row between small"><span>{d.label} ×{d.count}</span><span>{fmtDrive(d.min)}</span></div>)}
        {a.average != null && <div className="row between small"><span className="muted">Average per person</span><span>{fmtDrive(a.average)}</span></div>}

        <span className="label">What we know</span>
        {FACTS.map((f) => (
          <div key={f.key} className="row between small" style={{ alignItems: 'flex-start', gap: 8 }}>
            <span style={{ flex: 'none', fontWeight: 600 }}>{f.label}</span>
            <span style={{ textAlign: 'right', color: a.facts[f.key] ? 'var(--text)' : 'var(--muted)' }}>
              {a.facts[f.key] ? factLine(a.facts[f.key]) : 'Not known yet'}
              {a.facts[f.key]?.source_link && <> · <a href={a.facts[f.key].source_link} target="_blank" rel="noopener noreferrer">source</a></>}
            </span>
          </div>
        ))}
        {a.ratingText && <div className="small">⭐ {a.ratingText}</div>}
        {adding ? <FactForm course={a.course} onDone={() => { setAdding(false); onChanged(); }} /> : <button type="button" className="btn ghost sm" onClick={() => setAdding(true)}>+ Add or correct a fact</button>}

        <span className="label">Your group’s notes (only your group sees these)</span>
        {notes?.map((n) => <div key={n.id} className="small">“{n.body}”</div>)}
        {notes && !notes.length && <span className="small muted">None yet.</span>}
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Good bar, slow greens" aria-label="Note" />
          <button type="button" className="btn sm" disabled={working || !note.trim()} onClick={addNote}>Add</button>
        </div>

        {a.status !== 'no' && <button type="button" className="btn gold block" onClick={() => { onTick(); onClose(); }}>{ticked ? 'Untick' : 'Tick for the group'}</button>}
        <button type="button" className="btn ghost block" disabled={busy} onClick={onDecide}>Just decide on this one</button>
      </div>
    </Sheet>
  );
}

function FactForm({ course, onDone }) {
  const [fact, setFact] = useState('visitor_times');
  const [value, setValue] = useState('');
  const [link, setLink] = useState('');
  const [source, setSource] = useState('organiser');
  const [busy, run] = useRun();
  const def = FACTS.find((f) => f.key === fact);
  const save = () => run(async () => {
    await must(supabase.rpc('propose_course_fact', { p_course: course.id, p_fact: fact, p_value: value.trim(), p_source: source, p_link: link.trim() || null }));
    onDone();
  }, 'Thanks — saved for every group. It shows as “not confirmed yet” until it’s checked.');
  return (
    <div className="card pad stack" data-testid="tf-fact-form">
      <label className="field"><span>Fact</span>
        <select className="select" value={fact} onChange={(e) => setFact(e.target.value)}>{FACTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
      </label>
      <label className="field"><span>{def.kind === 'money' ? 'Price each ($)' : def.kind === 'number' ? `Number (${def.unit})` : 'What it is'}</span>
        <input className="input" value={value} maxLength={200} inputMode={def.kind === 'money' || def.kind === 'number' ? 'decimal' : 'text'} onChange={(e) => setValue(e.target.value)} placeholder={def.hint || ''} aria-label="Fact value" />
      </label>
      <label className="field"><span>Where it’s from</span>
        <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="organiser">I know it / I asked</option><option value="research">Their website</option><option value="email">An email from the club</option>
        </select>
      </label>
      <label className="field"><span>Link (optional)</span><input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></label>
      <button type="button" className="btn" disabled={busy || !value.trim()} onClick={save}>Save fact</button>
    </div>
  );
}
