// The course guide: every hole on the satellite map, any time — par, stroke index, length (tee to the
// middle of the green), your GPS distance to the front / middle / back and today's pin, and a shot planner
// (tap the map where you want the ball to finish). Swipe or tap ‹ › to change hole, or tap a number.
// GPS only runs while this screen is open and showing, and only if you've switched distances on.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useData, useSession } from '../lib/store.jsx';
import { courseHoles } from '../lib/board.js';
import { useWatchPosition } from '../lib/geo.js';
import { planLegs } from '../lib/greens.js';
import { parTotal } from '../lib/scoring.js';
import {
  holeLength, frameHole, courseCentre, guideDistances, mappingProgress, stepHole, holeFromParam,
  swipeStep, plannerStart, liveRoundOn,
} from '../lib/courseguide.js';
import { useRoundPins } from '../components/Distances.jsx';
import CourseMap, { labelIcon, meIcon, teeIcon, flagIcon } from '../components/CourseMap.jsx';
import { Header, Icon, Loading } from '../components/ui.jsx';

const KEY = 'lgc-distances-on'; // the same "GPS distances on" choice as the score screen
const MAX_TARGETS = 3;
const legIcon = (n, m) => labelIcon(`${n} · ${m} m`, '#FFD54F', '#15202E');

export default function CourseGuide() {
  const { courseId, hole: holeParam } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const data = useData();
  const { status } = useSession();
  const course = data.coursesById?.[courseId];
  const holes = useMemo(() => courseHoles(course), [course]);
  const n = holeFromParam(holes, holeParam);
  const hole = holes.find((h) => h.n === n);
  const prefer = new URLSearchParams(loc.search).get('r');
  const round = liveRoundOn(data.rounds || [], courseId, prefer);
  const [pins] = useRoundPins(round?.id);
  const pin = hole ? pins[hole.n] || null : null;

  // GPS: opt-in, and only while this screen is showing (saves battery).
  const [gpsOn, setGpsOn] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const f = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  const { pos, error } = useWatchPosition(gpsOn && visible);
  const toggleGps = () => {
    const v = !gpsOn;
    setGpsOn(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  };

  // Shot planner: targets tapped on the map, cleared when the hole changes.
  const [targets, setTargets] = useState([]);
  const [want, setWant] = useState('me');
  useEffect(() => { setTargets([]); }, [n]);

  const touch = useRef(null);
  if (!data.ready) return <Loading />;
  if (!course) return <div className="page"><Header back title="Course guide" /><div className="empty">That course isn’t in this group.</div></div>;
  if (!hole) return <div className="page"><Header back title={course.name} sub="Course guide" /><div className="empty">This course has no holes set up yet.</div></div>;

  const go = (to) => nav(`/guide/${course.id}/${to}${loc.search}`, { replace: true });
  const step = (dir) => go(stepHole(holes, hole.n, dir));
  const onTouchStart = (e) => {
    if (e.target.closest?.('.leaflet-container')) { touch.current = null; return; } // the map pans; don't change hole
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const s = swipeStep(t.clientX - touch.current.x, t.clientY - touch.current.y);
    touch.current = null;
    if (s) step(s);
  };

  const progress = mappingProgress(holes);
  const length = holeLength(hole);
  const frame = frameHole(hole, { pin });
  const centre = courseCentre(holes);
  const organiser = !!status?.is_admin;
  const anyOsm = holes.some((h) => h.osm);
  const finish = pin || hole.green || null;
  const { from, start } = plannerStart({ want, pos, hole, finish });
  const plan = planLegs(start, targets, finish);
  const d = pos && hole.green ? guideDistances(hole, pos, pin) : null;
  const farKm = d?.middle != null && d.middle > 1500 ? (d.middle / 1000).toFixed(d.middle > 20000 ? 0 : 1) : null;
  const far = !farKm && d?.middle != null && d.middle > 650;

  const legInto = (i) => plan.legs[(start ? 0 : -1) + i];
  const markers = [
    ...(hole.tee ? [{ id: 'tee', ...hole.tee, icon: teeIcon }] : []),
    // Front and back aren't drawn: at the size of a whole hole they'd sit on top of the middle (their distances are below).
    ...(hole.green ? [{ id: 'm', ...hole.green, icon: labelIcon('M', '#2E7D32', '#fff') }] : []),
    ...(pin ? [{ id: 'pin', lat: pin.lat, lng: pin.lng, icon: flagIcon }] : []),
    ...(pos ? [{ id: 'me', lat: pos.lat, lng: pos.lng, icon: meIcon }] : []),
    ...targets.map((t, i) => ({ id: `t${i}`, ...t, draggable: true, onDragEnd: (p) => setTargets((all) => all.map((x, j) => (j === i ? p : x))), icon: legIcon(i + 1, legInto(i)?.m ?? '–') })),
  ];
  const planPts = [start, ...targets, finish].filter(Boolean);
  const lines = [
    ...(hole.tee && hole.green && !targets.length ? [{ id: 'hole', points: [hole.tee, hole.green], color: '#FFFFFF', dashed: true }] : []),
    ...(targets.length && planPts.length > 1 ? [{ id: 'plan', points: planPts }] : []),
  ];
  const fit = frame.length ? frame : centre ? [centre] : [];
  const showMap = fit.length > 0;
  const startName = from === 'tee' ? 'the tee' : 'you';
  const names = [...(start ? [startName] : []), ...targets.map((_, i) => `target ${i + 1}`), ...(finish ? [pin ? 'the pin' : 'the middle'] : [])];
  const big = (label, v, strong) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <span className="small muted" style={{ fontWeight: 700 }}>{label}</span>
      <span className="num" style={{ fontSize: strong ? 44 : 30, lineHeight: 1 }}>{v != null ? v : '–'}</span>
    </div>
  );

  return (
    <div className="page" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <Header back title={course.name} sub={`Course guide · par ${parTotal(holes)}${progress.mapped ? ` · ${progress.mapped} of ${progress.total} greens mapped` : ''}`}>
        <div className="holes" role="group" aria-label="Hole">
          {holes.map((h) => (
            <button key={h.n} type="button" className={'hole-dot' + (h.n === hole.n ? ' cur' : '')} aria-pressed={h.n === hole.n} onClick={() => go(h.n)}>{h.n}</button>
          ))}
        </div>
      </Header>

      <div className="section">
        <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 56px', alignItems: 'center', gap: 8 }}>
          <button type="button" className="btn ghost" aria-label="Previous hole" onClick={() => step(-1)}>{Icon.back(22)}</button>
          <div style={{ textAlign: 'center' }} data-testid="guide-hole">
            <div className="label">Hole</div>
            <div className="num" style={{ fontSize: 52, lineHeight: 0.95 }}>{hole.n}</div>
            <div className="row" style={{ justifyContent: 'center', gap: 14, marginTop: 4, fontWeight: 700 }}>
              <span>Par {hole.par}</span>
              <span>SI {hole.si}</span>
              {length != null && <span>{length} m <span className="small muted">approx</span></span>}
            </div>
          </div>
          <button type="button" className="btn ghost" aria-label="Next hole" onClick={() => step(1)}>{Icon.next(22)}</button>
        </div>
        {length != null && <div className="small muted" style={{ textAlign: 'center', marginTop: 2 }}>Length is a straight line, tee to the middle of the green</div>}
      </div>

      {showMap ? (
        <CourseMap className="map tall" markers={markers} fit={fit} zoom={frame.length ? undefined : 15} lines={lines} osm={anyOsm} animate={false}
          onTap={hole.green || hole.tee ? (p) => setTargets((t) => (t.length >= MAX_TARGETS ? [...t.slice(0, -1), p] : [...t, p])) : undefined} />
      ) : null}

      {!hole.green ? (
        <div className="section">
          <div className="card pad stack" style={{ gap: 8, background: 'var(--gold-soft)', borderColor: 'var(--gold)' }} data-testid="unmapped">
            <strong>{progress.mapped ? `Hole ${hole.n}’s green isn’t mapped yet` : 'Greens aren’t mapped for this course yet'} — distances need them.</strong>
            {organiser ? (
              <>
                <span className="small">Tap each green on the satellite map once (or fill them from OpenStreetMap) and everyone gets GPS distances.</span>
                <Link to={`/courses/${course.id}/greens?hole=${hole.n}`} className="btn gold block">📍 Map the greens (about 2 minutes)</Link>
              </>
            ) : (
              <span className="small">Ask an organiser to map them — it takes a couple of minutes.</span>
            )}
            {!centre && (
              <a className="small" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${course.name} golf`)}`} target="_blank" rel="noopener noreferrer">🗺️ Find {course.name} on a map</a>
            )}
          </div>
        </div>
      ) : (
        <div className="section">
          <div className="card pad stack" style={{ gap: 8 }} data-testid="guide-distances">
            <div className="row between">
              <span className="label">📍 To the green (m)</span>
              <button type="button" className="btn ghost sm" onClick={toggleGps}>{gpsOn ? 'GPS off' : 'GPS on'}</button>
            </div>
            {!gpsOn ? (
              <span className="small muted">Switch GPS on for your distance to the front, middle and back{pin ? ' and today’s pin' : ''}. It’s only used while this screen is open.</span>
            ) : !pos ? (
              <span className="small muted">{error || 'Getting your GPS position…'}</span>
            ) : farKm ? (
              <span className="small">You’re about {farKm} km from this green — distances show up when you’re on the course.</span>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: pin ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', alignItems: 'end' }}>
                  {big('Front', d.front)}
                  {big('Middle', d.middle, !pin)}
                  {big('Back', d.back)}
                  {pin && big('🚩 Pin', d.pin, true)}
                </div>
                <span className="small muted">Approx · GPS ±{Math.round(pos.accuracy)} m{d.flipped ? ' · you’re behind the green, so front and back are swapped' : ''}{far ? ` · you’re a long way from hole ${hole.n} — on the right hole?` : ''}</span>
              </>
            )}
            {pin && <span className="small muted">🚩 Today’s pin from {round.name}.</span>}
          </div>
        </div>
      )}

      {(hole.green || hole.tee) && (
        <div className="section">
          <div className="card pad stack" style={{ gap: 8 }} data-testid="guide-planner">
            <div className="row between">
              <span className="label">🗺️ Plan your shots</span>
              <span className="row" style={{ gap: 6 }}>
                <button type="button" className="btn ghost sm" disabled={!targets.length} onClick={() => setTargets((t) => t.slice(0, -1))}>Undo</button>
                <button type="button" className="btn ghost sm" disabled={!targets.length} onClick={() => setTargets([])}>Clear</button>
              </span>
            </div>
            <div className="seg light" role="group" aria-label="Measure from">
              <button type="button" aria-pressed={from === 'me'} disabled={!pos} onClick={() => setWant('me')}>From me</button>
              <button type="button" aria-pressed={from === 'tee'} disabled={!hole.tee} onClick={() => setWant('tee')}>From the tee</button>
            </div>
            {!plan.legs.length && <span className="small muted">Tap the map where you want the ball to finish — up to {MAX_TARGETS} shots. Drag a target to adjust it.</span>}
            {plan.legs.length > 0 && targets.length > 0 && (
              <div>
                {plan.legs.map((l, i) => (
                  <div key={i} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
                    <span><strong>Shot {i + 1}</strong> <span className="small muted">{names[i]} → {names[i + 1]}</span></span>
                    <span className="num" style={{ fontSize: 22 }}>{l.m}<span className="small muted" style={{ fontFamily: 'inherit' }}> m</span></span>
                  </div>
                ))}
                {plan.legs.length > 1 && <div className="row between" style={{ paddingTop: 6 }}><span className="small muted">Total</span><span className="num" style={{ fontSize: 18 }}>{plan.total} m</span></div>}
              </div>
            )}
          </div>
        </div>
      )}

      {!progress.mapped && (
        <div className="section">
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="sc">
              <thead><tr><th>Hole</th><th>Par</th><th>SI</th><th>Hole</th><th>Par</th><th>SI</th></tr></thead>
              <tbody>
                {holes.slice(0, Math.ceil(holes.length / 2)).map((h, i) => {
                  const b = holes[i + Math.ceil(holes.length / 2)];
                  return <tr key={h.n}><td><strong>{h.n}</strong></td><td>{h.par}</td><td>{h.si}</td><td><strong>{b?.n}</strong></td><td>{b?.par}</td><td>{b?.si}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="note">Swipe sideways (away from the map) or tap ‹ › to change hole. Distances are straight lines and approximate — phone GPS is good to about 5–10 m, like any golf GPS app.</p>
    </div>
  );
}
