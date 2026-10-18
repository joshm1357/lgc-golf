// Shot planner: tap where you want each shot to land and see every distance — from you (or the tee)
// to your first target, target to target, and on to today's pin or the middle of the green.
import React, { useEffect, useMemo, useState } from 'react';
import { useWatchPosition } from '../lib/geo.js';
import { planLegs } from '../lib/greens.js';
import CourseMap, { labelIcon, meIcon, teeIcon, flagIcon } from './CourseMap.jsx';
import { Sheet } from './ui.jsx';

const MAX_TARGETS = 3;
const legIcon = (n, m) => labelIcon(`${n} · ${m} m`, '#FFD54F', '#15202E');

export default function ShotPlanner({ hole, pin, onClose }) {
  const { pos, error } = useWatchPosition(true);
  const [from, setFrom] = useState('me'); // 'me' | 'tee'
  const [targets, setTargets] = useState([]);
  const finish = pin || hole.green || null;
  // Off the course (no GPS fix near the hole) — start from the tee if we know it.
  const meNear = pos && (!hole.tee || !finish || planLegs(pos, [], finish).total < 800);
  useEffect(() => { if (pos && !meNear && hole.tee) setFrom('tee'); }, [pos?.lat]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = from === 'me' ? (pos ? { lat: pos.lat, lng: pos.lng } : null) : hole.tee || null;
  const plan = useMemo(() => planLegs(start, targets, finish), [start?.lat, start?.lng, targets, finish]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (p) => setTargets((t) => (t.length >= MAX_TARGETS ? [...t.slice(0, -1), p] : [...t, p]));
  const move = (i, p) => setTargets((t) => t.map((x, j) => (j === i ? p : x)));

  // Label each target with the shot that lands there; the last leg is labelled on the green.
  const legInto = (i) => plan.legs[(start ? 0 : -1) + i];
  const markers = [
    ...(hole.tee ? [{ id: 'tee', ...hole.tee, icon: teeIcon }] : []),
    ...(hole.front ? [{ id: 'f', ...hole.front, icon: labelIcon('F') }] : []),
    ...(hole.back ? [{ id: 'b', ...hole.back, icon: labelIcon('B', '#15202E', '#fff') }] : []),
    ...(pin ? [{ id: 'pin', ...pin, icon: flagIcon }] : hole.green ? [{ id: 'm', ...hole.green, icon: labelIcon('M', '#2E7D32', '#fff') }] : []),
    ...(pos ? [{ id: 'me', lat: pos.lat, lng: pos.lng, icon: meIcon }] : []),
    ...targets.map((t, i) => ({ id: `t${i}`, ...t, draggable: true, onDragEnd: (p) => move(i, p), icon: legIcon(i + 1, legInto(i)?.m ?? '–') })),
  ];
  const linePts = [start, ...targets, finish].filter(Boolean);
  const fit = [start, finish, hole.tee].filter(Boolean);
  const startLabel = from === 'me' ? 'you' : 'the tee';
  const names = [...(start ? [startLabel] : []), ...targets.map((_, i) => `target ${i + 1}`), ...(finish ? [pin ? 'the pin' : 'the middle'] : [])];

  return (
    <Sheet title={`Plan your shots · hole ${hole.n}`} onClose={onClose}>
      <div className="stack">
        <div className="seg light" role="group" aria-label="Start from">
          <button type="button" aria-pressed={from === 'me'} onClick={() => setFrom('me')}>From where I am</button>
          <button type="button" aria-pressed={from === 'tee'} disabled={!hole.tee} onClick={() => setFrom('tee')}>From the tee</button>
        </div>
        {from === 'me' && !pos && <span className="small muted">{error || 'Getting your GPS position…'}</span>}
        <span className="small muted">Tap the map where you want the ball to finish — up to {MAX_TARGETS} shots. Drag a target to adjust it.</span>
        <CourseMap className="map tall" markers={markers} fit={fit.length ? fit : undefined} onTap={add} osm={!!hole.osm}
          lines={linePts.length > 1 ? [{ id: 'plan', points: linePts }] : []} />
        <div className="card">
          {plan.legs.length === 0 && <div className="small muted" style={{ padding: 12 }}>{finish ? 'Tap the map to add your first target.' : 'This green isn’t mapped yet — tap targets to measure between them.'}</div>}
          {plan.legs.map((l, i) => (
            <div key={i} className="row between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)' }}>
              <span><strong>Shot {i + 1}</strong> <span className="small muted">{names[i]} → {names[i + 1]}</span></span>
              <span className="num" style={{ fontSize: 24 }}>{l.m}<span className="small muted" style={{ fontFamily: 'inherit' }}> m</span></span>
            </div>
          ))}
          {plan.legs.length > 1 && (
            <div className="row between" style={{ padding: '10px 14px' }}>
              <span className="small muted">Total</span><span className="num" style={{ fontSize: 18 }}>{plan.total} m</span>
            </div>
          )}
        </div>
        {pos && <span className="small muted">GPS ±{Math.round(pos.accuracy)} m · distances are straight lines, like any golf GPS.</span>}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn ghost sm" disabled={!targets.length} onClick={() => setTargets((t) => t.slice(0, -1))}>Undo</button>
          <button type="button" className="btn ghost sm" disabled={!targets.length} onClick={() => setTargets([])}>Clear</button>
        </div>
      </div>
    </Sheet>
  );
}
