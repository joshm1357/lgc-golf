import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useScores, useSession } from '../lib/store.jsx';
import { greensMapped, courseTiles } from '../lib/greens.js';
import { Header, Sheet, toast } from '../components/ui.jsx';
import { roundBoard, courseHoles } from '../lib/board.js';
import { formatToPar, parTotal } from '../lib/scoring.js';
import { CourseGuideButton } from '../components/CourseGuideLink.jsx';

const TILE = (t) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t.z}/${t.y}/${t.x}`;

/** Fetch the satellite pictures for a course once, so the map (comps, greens, where's everyone) works with no signal. */
async function saveCourseMap(course, setProgress) {
  const tiles = courseTiles(course.holes);
  if (!tiles.length) { toast('Map the greens first — the app needs to know where the course is.'); return; }
  if (!navigator.serviceWorker?.controller) { toast('Open the app from the Home Screen (or reload once) first, then try again.'); return; }
  let done = 0;
  for (let i = 0; i < tiles.length; i += 6) {
    await Promise.all(tiles.slice(i, i + 6).map((t) => fetch(TILE(t), { mode: 'cors', credentials: 'omit' }).catch(() => {})));
    done = Math.min(tiles.length, i + 6);
    setProgress(Math.round((done / tiles.length) * 100));
  }
  setProgress(null);
  toast(`Saved ${tiles.length} map pieces for ${course.name} — the map works without signal now`);
}

export default function Courses() {
  const data = useData();
  const { status } = useSession();
  const scores = useScores(data.rounds.map((r) => r.id));
  const [open, setOpen] = useState(null);
  const [progress, setProgress] = useState(null);

  const stats = useMemo(() => Object.fromEntries(data.courses.map((c) => {
    const rounds = data.rounds.filter((r) => r.course_id === c.id);
    let bestS = null, bestA = null;
    for (const r of rounds) {
      const b = roundBoard({ round: r, course: c, teams: data.teamsByRound[r.id] || [], roundPlayers: data.roundPlayers[r.id] || [], playersById: data.playersById, scoresIdx: scores.index, quickResults: data.quick_results });
      for (const row of b.rows.filter((x) => x.finished)) {
        if (r.format === 'stableford' && (!bestS || row.points > bestS.points)) bestS = { name: row.name, points: row.points, round: r };
        if (r.format === 'ambrose' && (!bestA || row.netToPar < bestA.netToPar)) bestA = { name: row.name, netToPar: row.netToPar, round: r };
      }
    }
    return [c.id, { rounds, bestS, bestA }];
  })), [data, scores.index]);

  return (
    <div className="page">
      <Header back title="Courses" sub={`${data.courses.length} course${data.courses.length === 1 ? '' : 's'} played`} />
      <div className="section stack">
        {!data.courses.length && <div className="empty">No courses yet — the admin adds them.</div>}
        {data.courses.map((c) => {
          const s = stats[c.id];
          return (
            <button key={c.id} type="button" className="card pad stack" style={{ textAlign: 'left', gap: 4 }} onClick={() => setOpen(c)}>
              <div className="row between"><strong style={{ fontSize: 18 }}>{c.name}</strong><span className="muted">Par {parTotal(c.holes)}</span></div>
              <div className="small muted">{s.rounds.length} round{s.rounds.length === 1 ? '' : 's'} played · 📍 {greensMapped(c.holes)}/{c.holes.length} greens mapped for GPS</div>
              {s.bestS && <div className="small">Best Stableford: <strong>{s.bestS.name}, {s.bestS.points} pts</strong></div>}
              {s.bestA && <div className="small">Best Ambrose: <strong>{s.bestA.name}, {formatToPar(s.bestA.netToPar, 1)} net</strong></div>}
            </button>
          );
        })}
      </div>
      {open && (
        <Sheet title={open.name} onClose={() => setOpen(null)}>
          <div className="stack">
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="sc">
                <thead><tr><th>Hole</th><th>Par</th><th>SI</th><th>Hole</th><th>Par</th><th>SI</th></tr></thead>
                <tbody>
                  {courseHoles(open).slice(0, 9).map((h, i) => {
                    const b = courseHoles(open)[i + 9];
                    return <tr key={h.n}><td><strong>{h.n}</strong></td><td>{h.par}</td><td>{h.si}</td><td><strong>{b?.n}</strong></td><td>{b?.par}</td><td>{b?.si}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
            <CourseGuideButton course={open} onClick={() => setOpen(null)} />
            {status.is_admin && <Link to={`/courses/${open.id}/greens`} className="btn gold block" onClick={() => setOpen(null)}>📍 Map the greens for GPS distances</Link>}
            {greensMapped(open.holes) > 0 && (
              <button type="button" className="btn ghost block" disabled={progress != null} onClick={() => saveCourseMap(open, setProgress)}>
                {progress != null ? `Saving the map… ${progress}%` : '📵 Save the course map for no signal'}
              </button>
            )}
            <span className="label">Rounds here</span>
            {stats[open.id].rounds.map((r) => (
              <Link key={r.id} to={`/?r=${r.id}`} className="card pad row between" style={{ color: 'inherit', textDecoration: 'none' }} onClick={() => setOpen(null)}>
                <span><strong>{r.name}</strong> <span className="muted small">{r.format}</span></span>
                <span className="muted small">{r.play_date || ''}</span>
              </Link>
            ))}
            {!stats[open.id].rounds.length && <span className="muted small">No rounds here yet.</span>}
          </div>
        </Sheet>
      )}
    </div>
  );
}
