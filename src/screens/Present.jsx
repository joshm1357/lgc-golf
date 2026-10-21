// Stage 11c — "Present": the group's leaderboard on a big screen (a TV, a projector at the dinner). Fills the window
// over the sidebar, big type, live (it updates as scores come in). Full screen button, Esc to leave.
// Same leaderboard maths as everywhere else (lib/board.js); the clubhouse TV (TvBoard.jsx) is the public,
// many-groups version of this.
import React, { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useData, useScores, useSession, useFeature } from '../lib/store.jsx';
import { roundBoard, isNetFormat, formatName } from '../lib/board.js';
import { formatToPar } from '../lib/scoring.js';
import { Avatar } from '../components/ui.jsx';
import { GroupCrest } from '../components/Logo.jsx';

export function Present() {
  const { roundId } = useParams();
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const replayOn = useFeature('replay');
  const round = (roundId && data.rounds.find((r) => r.id === roundId)) || data.liveRound || data.defaultRound;
  const scores = useScores(round?.id);
  const course = round ? data.coursesById[round.course_id] : null;
  const board = useMemo(() => (round && course ? roundBoard({
    round, course, teams: data.teamsByRound[round.id] || [], roundPlayers: data.roundPlayers[round.id] || [],
    playersById: data.playersById, scoresIdx: scores.index, quickResults: data.quick_results || [],
  }) : null), [round, course, data, scores.index]);
  const close = () => (window.history.length > 1 ? nav(-1) : nav('/'));
  useEffect(() => {
    const f = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) close(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const full = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  };
  const net = round && isNetFormat(round.format);
  const look = status?.look || (status && status.legacy !== false ? { crest_url: 'builtin:lgc' } : null);
  const rounds = data.rounds.filter((r) => r.trip_id === round?.trip_id);
  return (
    <div className="present" data-testid="present" role="dialog" aria-label="Leaderboard on the big screen">
      <div className="present-top">
        <GroupCrest size={64} look={look} name={status?.group_name} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="present-title">{round ? round.name : 'No round yet'}</div>
          <div className="present-sub">{[status?.group_name, course?.name, round && formatName(round.format), round?.status === 'live' ? 'Live' : round?.status === 'locked' ? 'Final' : null].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="present-actions">
          {rounds.length > 1 && (
            <select className="select present-select" aria-label="Round" value={round.id} onChange={(e) => nav(`/desk/present/${e.target.value}`, { replace: true })}>
              {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          {replayOn && round?.status === 'locked' && <Link className="present-btn" to={`/replay/${round.id}`}>▶ Replay</Link>}
          <button type="button" className="present-btn" onClick={full}>⛶ Full screen</button>
          <button type="button" className="present-btn" onClick={close} aria-label="Close">✕</button>
        </div>
      </div>
      {!board && <div className="present-empty">No round to show yet.</div>}
      {board && (
        <table className="present-board" data-testid="present-board">
          <thead><tr><th>#</th><th>{board.format === 'ambrose' ? 'Team' : board.format === 'fourball' ? 'Pair' : 'Player'}</th><th>Thru</th><th className="r">{net ? 'Net' : 'Pts'}</th></tr></thead>
          <tbody>
            {board.rows.slice(0, 16).map((row, n) => (
              <tr key={row.id} className={n === 0 && row.thru ? 'lead' : ''}>
                <td className="pos">{row.thru ? row.rank ?? n + 1 : '–'}</td>
                <td className="who">
                  <div className="present-who">
                    <span className="present-avatars">{(row.players || []).slice(0, 4).map((p) => <Avatar key={p.id} player={p} size={44} />)}</span>
                    <span className="ellipsis">{row.name}</span>
                  </div>
                </td>
                <td className="thru">{row.finished ? 'F' : row.thru || '–'}</td>
                <td className="r score">{!row.thru ? '–' : net ? formatToPar(row.netToPar) : row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="present-foot">Live from The Golf Trip · Esc to close</div>
    </div>
  );
}
