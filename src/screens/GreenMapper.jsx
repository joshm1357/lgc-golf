// Admin: map each hole's tee and the green's front / middle / back on the satellite map, once per course.
// Then everyone gets GPS distances on the score screen. Can fill the lot from OpenStreetMap if the
// course is drawn there; every point can be dragged to fine-tune.
import React, { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useSession } from '../lib/store.jsx';
import { courseHoles } from '../lib/board.js';
import { distanceM, getFix } from '../lib/geo.js';
import { holesFromOsm, mergeGreens, osmQuery, greensMapped } from '../lib/greens.js';
import CourseMap, { labelIcon, teeIcon } from '../components/CourseMap.jsx';
import { Header, Loading, toast } from '../components/ui.jsx';
import { holeFromParam, mappingProgress, nextUnmapped } from '../lib/courseguide.js';
import { CourseGuideHoleLink } from '../components/CourseGuideLink.jsx';

const MODES = [
  { key: 'tee', label: 'Tee' },
  { key: 'front', label: 'Front' },
  { key: 'green', label: 'Middle' },
  { key: 'back', label: 'Back' },
];
const ICON = {
  tee: teeIcon,
  front: labelIcon('F'),
  green: labelIcon('M', '#2E7D32', '#fff'),
  back: labelIcon('B', '#15202E', '#fff'),
};
const r6 = (p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });

export default function GreenMapper() {
  const { courseId } = useParams();
  const nav = useNavigate();
  const data = useData();
  const { status } = useSession();
  const course = data.coursesById?.[courseId];
  const [holes, setHoles] = useState(() => (course ? courseHoles(course).map((h) => ({ ...h })) : []));
  // Opened from the course guide on a hole (?hole=7): start there.
  const [params] = useSearchParams();
  const [n, setN] = useState(() => holeFromParam(holes, params.get('hole')) ?? 1);
  const [mode, setMode] = useState(() => { const x = holes.find((y) => y.n === n); return x && !x.tee ? 'tee' : 'green'; });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [centre, setCentre] = useState(null);

  const h = holes.find((x) => x.n === n) || holes[0];
  const anyPoint = useMemo(() => {
    for (const x of holes) for (const k of ['green', 'tee', 'front', 'back']) if (x[k]) return x[k];
    return null;
  }, [holes]);

  if (!data.ready) return <Loading />;
  if (!course) return <div className="page"><Header back title="Course not found" /></div>;
  if (!status.is_admin) return <div className="page"><Header back title="Map the greens" /><div className="empty">Only an organiser can map greens.</div></div>;

  const setPoint = (key, p) => {
    setHoles((all) => all.map((x) => (x.n === h.n ? { ...x, [key]: r6(p) } : x)));
    setDirty(true);
    // Move on to the next point so mapping a course is tap, tap, tap.
    const order = ['tee', 'front', 'green', 'back'];
    const next = order[order.indexOf(key) + 1];
    if (next) setMode(next);
    else if (h.n < holes.length) { setN(h.n + 1); setMode('tee'); }
  };
  const clearHole = () => {
    setHoles((all) => all.map((x) => (x.n === h.n ? { n: x.n, par: x.par, si: x.si } : x)));
    setDirty(true);
    setMode('tee');
  };

  const markers = MODES.filter((m) => h?.[m.key]).map((m) => ({
    id: m.key, lat: h[m.key].lat, lng: h[m.key].lng, icon: ICON[m.key], draggable: true,
    onDragEnd: (p) => { setHoles((all) => all.map((x) => (x.n === h.n ? { ...x, [m.key]: r6(p) } : x))); setDirty(true); },
  }));
  const prev = holes.find((x) => x.n === h.n - 1);
  const fit = markers.length ? markers : prev?.green ? [prev.green] : anyPoint ? [anyPoint] : centre ? [centre] : [];
  const progress = mappingProgress(holes);
  const nextGap = nextUnmapped(holes, h?.n);
  const goTo = (x) => { setN(x.n); setMode(x.tee ? (x.green ? 'green' : 'front') : 'tee'); };
  const lengthM = h?.tee && h?.green ? Math.round(distanceM(h.tee, h.green)) : null;
  const depthM = h?.front && h?.back ? Math.round(distanceM(h.front, h.back)) : null;

  async function here() {
    try {
      const f = await getFix();
      setCentre(f);
      setPoint(mode, f);
      toast(`${MODES.find((m) => m.key === mode).label} set where you're standing (±${Math.round(f.accuracy)} m)`);
    } catch (e) { toast(e.message); }
  }
  async function centreOnMe() {
    try { setCentre(await getFix()); } catch (e) { toast(e.message); }
  }
  async function fromOsm() {
    setBusy(true);
    try {
      let at = anyPoint || centre;
      if (!at) { at = await getFix(); setCentre(at); }
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(osmQuery(at))}`,
      });
      if (!res.ok) throw new Error('OpenStreetMap is busy — try again in a minute.');
      const found = holesFromOsm(await res.json(), at);
      const count = Object.keys(found).length;
      if (!count) throw new Error('This course isn’t drawn on OpenStreetMap near here — map it by tapping instead.');
      const overwrite = greensMapped(holes) > 0 && window.confirm(`OpenStreetMap has ${count} holes here. Replace the greens you've already mapped? (Cancel = only fill the empty holes.)`);
      const merged = mergeGreens(holes, found, overwrite);
      setHoles(merged.holes);
      setDirty(merged.changed > 0);
      toast(merged.changed ? `Filled ${merged.changed} holes — check each one, then Save` : 'Nothing new to fill');
    } catch (e) {
      toast(e.message === 'Failed to fetch' ? 'Couldn’t reach OpenStreetMap — need signal.' : friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const clean = holes.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v != null)));
      const { error } = await supabase.from('courses').update({ holes: clean }).eq('id', course.id);
      if (error) throw error;
      setDirty(false);
      toast(`Saved — ${greensMapped(clean)} of ${clean.length} greens mapped`);
      data.reload();
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  }

  return (
    <div className="page" style={{ paddingBottom: 150 }}>
      <Header back title="Map the greens" sub={`${course.name} · ${greensMapped(holes)}/${holes.length} mapped`} />
      <div className="chips" role="group" aria-label="Hole" style={{ padding: '10px 16px' }}>
        {holes.map((x) => (
          <button key={x.n} type="button" className="chip" aria-pressed={x.n === h.n} onClick={() => goTo(x)}>
            {x.n}{x.green ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <div className="section stack" style={{ paddingTop: 0 }}>
        <details className="card pad small" open={progress.mapped === 0} style={{ lineHeight: 1.45 }}>
          <summary style={{ fontWeight: 700, cursor: 'pointer' }}>How it works (about 2 minutes)</summary>
          <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            <li>First try <strong>Fill from OpenStreetMap</strong> (below the map) — it often does every hole at once.</li>
            <li>Otherwise, for each hole tap the <strong>tee</strong>, then the <strong>front</strong>, <strong>middle</strong> and <strong>back</strong> of the green. It moves on by itself.</li>
            <li>Only the middle is a must; drag any point to fine-tune. Then <strong>Save</strong>.</li>
          </ol>
        </details>
        <div className="stack" style={{ gap: 6 }} data-testid="map-progress">
          <div className="row between">
            <strong>{progress.mapped} of {progress.total} greens mapped{progress.done ? ' ✓' : ''}</strong>
            {nextGap != null && nextGap !== h.n && <button type="button" className="btn ghost sm" onClick={() => goTo(holes.find((x) => x.n === nextGap))}>Next: hole {nextGap} →</button>}
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }} aria-hidden="true">
            <div style={{ height: '100%', width: `${progress.total ? (100 * progress.mapped) / progress.total : 0}%`, background: 'var(--gold)' }} />
          </div>
        </div>
        <div className="row between">
          <strong>Hole {h.n} · par {h.par}</strong>
          <span className="small muted">{lengthM ? `${lengthM} m tee to middle` : ''}{depthM ? ` · green ${depthM} m deep` : ''}</span>
        </div>
        <div className="seg light" role="group" aria-label="What to place">
          {MODES.map((m) => <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>{m.label}{h[m.key] ? ' ✓' : ''}</button>)}
        </div>
        <span className="small muted">Tap the map to place the <strong>{MODES.find((m) => m.key === mode).label.toLowerCase()}</strong>{mode === 'tee' ? '' : ' of the green'}. Drag any point to fine-tune. Zoom right in on the green for front and back.</span>
        <CourseMap className="map tall" markers={markers} fit={fit} zoom={fit.length === 1 ? 18 : undefined} onTap={(p) => setPoint(mode, p)} osm={holes.some((h) => h.osm)} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn ghost sm" onClick={here}>📍 {MODES.find((m) => m.key === mode).label} = where I’m standing</button>
          {!fit.length && <button type="button" className="btn ghost sm" onClick={centreOnMe}>Centre the map on me</button>}
          {(h.tee || h.green) && <button type="button" className="btn ghost sm" onClick={clearHole}>Clear hole {h.n}</button>}
        </div>
        <button type="button" className="btn ghost block" disabled={busy} onClick={fromOsm}>🌐 Fill from OpenStreetMap (if the course is drawn there)</button>
        {!dirty && h.green && <CourseGuideHoleLink course={course} hole={h} />}
        <p className="note" style={{ margin: 0 }}>Points from OpenStreetMap (© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors) are drawn by volunteers — check each hole on the satellite picture. Phone GPS is good to about 5–10 m, so distances are a guide, like any golf GPS app.</p>
      </div>
      <div className="fab" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, boxShadow: 'none' }}>
        <button type="button" className="btn ghost" onClick={() => { if (!dirty || window.confirm('Leave without saving?')) nav(-1); }}>Done</button>
        <button type="button" className="btn gold" disabled={busy || !dirty} onClick={save}>{dirty ? 'Save' : 'Saved ✓'}</button>
      </div>
    </div>
  );
}
