import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData, useScores, useSession } from '../lib/store.jsx';
import { roundBoard, headlines } from '../lib/board.js';
import { formatToPar, strokesReceived, stablefordPoints } from '../lib/scoring.js';
import { Header, Seg, AvatarStack, Icon, Sheet, Loading } from '../components/ui.jsx';
import { TrophyArt } from '../components/TrophyArt.jsx';
import DrawSetup from '../components/DrawSetup.jsx';

export function useRoundChoice() {
  const data = useData();
  const [params, setParams] = useSearchParams();
  const id = params.get('r');
  const round = (id && data.rounds?.find((r) => r.id === id)) || data.defaultRound;
  const choose = (rid) => setParams(rid ? { r: rid } : {}, { replace: true });
  return [round, choose];
}

export function RoundChips({ round, onChoose, filter }) {
  const data = useData();
  const list = data.rounds.filter((r) => (filter ? filter(r) : true) && (r.trip_id === data.currentTrip?.id || r.id === round?.id));
  if (list.length <= 1) return null;
  return (
    <div className="chips" role="group" aria-label="Round">
      {list.map((r) => (
        <button key={r.id} type="button" className="chip" aria-pressed={r.id === round?.id} onClick={() => onChoose(r.id)}>
          {r.name}{r.status === 'live' ? ' · live' : ''}
        </button>
      ))}
    </div>
  );
}

export default function Leaderboard() {
  const data = useData();
  const { status } = useSession();
  const [round, choose] = useRoundChoice();
  const [mode, setMode] = useState('live');
  const [open, setOpen] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const scores = useScores(round?.id);

  const board = useMemo(() => {
    if (!round) return null;
    return roundBoard({
      round, course: data.coursesById[round.course_id], teams: data.teamsByRound[round.id] || [],
      roundPlayers: data.roundPlayers[round.id] || [], playersById: data.playersById,
      scoresIdx: scores.index, quickResults: data.quick_results,
    });
  }, [round, data, scores.index]);

  // "Since you last looked": ranks stored on this phone at the last visit.
  const storeKey = round ? `lgc-ranks-${round.id}` : null;
  const prevByRound = useRef({});
  if (storeKey && !(storeKey in prevByRound.current)) {
    try { prevByRound.current[storeKey] = JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch { prevByRound.current[storeKey] = null; }
  }
  const prevRanks = storeKey ? prevByRound.current[storeKey] : null;
  const latest = useRef(null);
  latest.current = board ? { key: storeKey, ranks: Object.fromEntries(board.rows.map((r) => [r.id, r.rank])) } : null;
  useEffect(() => {
    const save = () => {
      const l = latest.current;
      if (l?.key && Object.keys(l.ranks).length) {
        try { localStorage.setItem(l.key, JSON.stringify(l.ranks)); } catch { /* ignore */ }
      }
    };
    const onVis = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', onVis);
    return () => { save(); document.removeEventListener('visibilitychange', onVis); };
  }, [storeKey]);

  if (!data.ready) return <Loading />;
  const course = round ? data.coursesById[round.course_id] : null;
  const trip = round ? data.trips.find((t) => t.id === round.trip_id) : data.currentTrip;

  if (!round) {
    return (
      <div className="page">
        <Header logo title={trip?.name || 'L.G.C Golf'} sub="No rounds set up yet" />
        <div className="empty">
          Nothing to show yet.{status?.is_admin ? <> Set up the course, teams and round in <Link to="/admin">Admin</Link>.</> : ' The admin is setting things up.'}
        </div>
      </div>
    );
  }

  const isA = board.format === 'ambrose';
  const projected = mode === 'proj';
  const rows = projected ? board.projection : board.rows;
  const heads = headlines(board, prevRanks, { projected });
  const me = status?.player_id;
  const myTeam = isA ? (data.teamsByRound[round.id] || []).find((t) => t.players.some((p) => p.id === me)) : null;
  const imPlaying = isA ? !!myTeam : (data.roundPlayers[round.id] || []).some((rp) => rp.player_id === me);
  const canScore = round.status === 'live' && (imPlaying || status?.is_admin);
  const winner = round.status === 'locked' ? board.rows[0] : null;
  const trophy = data.trophies.find((t) => t.trip_id === round.trip_id && t.type === (isA ? 'ambrose' : 'stableford_total'));

  return (
    <div className="page">
      <Header
        logo
        title={round.name}
        sub={`${course?.name || ''}${trip ? ' · ' + trip.name : ''}`}
        right={round.status === 'live' ? <span className="pill-live"><span className="dot" />LIVE</span> : round.status === 'locked' ? <span className="pill-live">FINAL</span> : <span className="pill-live">NOT STARTED</span>}
      >
        {round.status !== 'locked' && (
          <Seg value={mode} onChange={setMode} options={[{ value: 'live', label: 'Live' }, { value: 'proj', label: 'Projected' }]} />
        )}
      </Header>
      <RoundChips round={round} onChoose={choose} />

      {winner && (
        <div className="winner">
          <TrophyArt name={trophy?.name} type={trophy?.type} size={72} />
          <div className="grow">
            <div className="label">{trophy ? trophy.name : 'Winner'}{isA ? '' : ' · this round'}</div>
            <div className="t">{winner.name}</div>
            <div className="hdr-sub">{isA ? `${formatToPar(winner.netToPar, 1)} net` : `${winner.points} points`}</div>
          </div>
          <AvatarStack players={winner.players} size={30} />
        </div>
      )}

      {heads.length > 0 && round.status !== 'locked' && (
        <div className="heads">
          {heads.map((h, i) => (
            <div key={i} className="head">
              <div className="row label" style={{ gap: 6 }}>{Icon[h.kind]?.()}<span>{h.label}</span></div>
              <div className="t">{h.text}</div>
            </div>
          ))}
        </div>
      )}

      <div className="lb-cols">
        <span style={{ textAlign: 'center' }}>#</span>
        <span>{isA ? 'Team' : 'Player'}</span>
        <span style={{ textAlign: 'center' }}>Thru</span>
        <span style={{ textAlign: 'right' }}>{projected ? 'Proj.' : isA ? 'Net' : 'Pts'}</span>
        <span style={{ textAlign: 'right' }}>{projected ? 'Win' : isA ? 'Move' : '+/−'}</span>
      </div>
      <div className="card lb">
        {rows.length === 0 && (
          <div className="empty">
            {isA ? (status?.is_admin
              ? <button type="button" className="btn gold" onClick={() => setDrawing(true)}>🎲 Start the draw</button>
              : 'Teams come out of the draw — watch for it here.') : 'No players in this round yet.'}
          </div>
        )}
        {rows.map((r, i) => {
          const prev = prevRanks?.[r.id];
          const mv = prev ? prev - r.rank : 0;
          const mainVal = projected ? r.proj?.projected : isA ? r.netToPar : r.points;
          const main = projected
            ? (r.proj ? (isA ? formatToPar(r.proj.projected, 1) : r.proj.projected.toFixed(1)) : '–')
            : r.thru === 0 ? '–' : isA ? formatToPar(r.netToPar, r.finished && r.netToPar % 1 ? 1 : 0) : String(r.points);
          const under = isA && mainVal < 0 && r.thru > 0;
          return (
            <button key={r.id} type="button" className={'lb-row' + (i === 0 && (r.thru > 0 || projected) ? ' lead' : '')} onClick={() => setOpen(r)}>
              <span className="lb-rank">{projected ? i + 1 : r.rankLabel}</span>
              <span className="stack" style={{ gap: 5, minWidth: 0 }}>
                <span className="lb-name ellipsis">{r.name}</span>
                <AvatarStack players={r.players} size={isA ? 26 : 22} />
              </span>
              <span className="lb-thru">{r.finished ? 'F' : r.thru || '–'}{r.quick ? '*' : ''}</span>
              <span className={'lb-main' + (under ? ' under' : '') + (projected ? ' proj' : '')}>{main}</span>
              <span className="lb-side">
                {projected ? (
                  <>
                    <span>{r.proj?.winPct ?? 0}%</span>
                    <span className="bar"><i style={{ width: `${r.proj?.winPct ?? 0}%` }} /></span>
                  </>
                ) : isA ? (
                  <span className={mv > 0 ? 'mv-up' : mv < 0 ? 'mv-down' : 'mv-same'}>{mv > 0 ? `▲ ${mv}` : mv < 0 ? `▼ ${-mv}` : '—'}</span>
                ) : (
                  <span className={r.vsExpected > 0 ? 'mv-up' : r.vsExpected < 0 ? 'mv-down' : 'mv-same'}>{r.thru ? (r.vsExpected > 0 ? '+' : r.vsExpected < 0 ? '−' : '') + Math.abs(r.vsExpected) : '—'}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="note">
        {projected
          ? 'Projected = score so far + expected score on the holes left, based on how the groups ahead played them, adjusted for each team’s form. Win % comes from 2,000 simulated finishes. Early on, with few holes played, treat it as banter.'
          : isA
            ? 'Net to par for the holes each team has played, so teams on different holes compare fairly. Arrows show movement since you last looked. Tap a team for its card.'
            : 'Points, and +/− against the expected 2 points a hole, so players on different holes compare fairly. * = typed in from a paper card.'}
      </p>
      {scores.pendingCount > 0 && <div className="sync">{scores.pendingCount} score{scores.pendingCount > 1 ? 's' : ''} waiting to sync — they'll send when signal's back.</div>}

      {canScore && (
        <Link to={`/score/${round.id}`} className="btn gold fab">Enter score{myTeam ? ` — ${myTeam.name}` : ''}</Link>
      )}

      {drawing && <DrawSetup round={round} onClose={() => setDrawing(false)} />}
      {open && (
        <Sheet title={open.name} onClose={() => setOpen(null)}>
          <Scorecard row={open} board={board} />
        </Sheet>
      )}
    </div>
  );
}

export function Scorecard({ row, board }) {
  const isA = board.format === 'ambrose';
  const holes = board.holes;
  const tot = { par: 0, s: 0, x: 0 };
  return (
    <div className="stack">
      <div className="row">
        <AvatarStack players={row.players} size={34} />
        <span className="muted small">{isA ? `Team handicap ${row.handicap}` : `Playing off ${row.handicap}`}</span>
      </div>
      {row.quick ? (
        <div className="card pad">Typed in from a paper card: <strong>{row.points} points</strong>.</div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="sc">
            <thead>
              <tr><th>Hole</th><th>Par</th><th>SI</th><th>Shots</th><th>Score</th><th>{isA ? 'Net' : 'Pts'}</th></tr>
            </thead>
            <tbody>
              {holes.map((h) => {
                const s = row.scores?.[h.n];
                const recv = strokesReceived(row.handicap, h.si);
                const strokes = s?.strokes;
                tot.par += h.par;
                if (strokes != null) tot.s += strokes;
                let x = '';
                if (s) {
                  x = isA ? formatToPar(strokes - h.par - recv) : String(stablefordPoints(h, strokes, row.handicap, s.picked_up));
                  if (!isA) tot.x += stablefordPoints(h, strokes, row.handicap, s.picked_up);
                }
                return (
                  <tr key={h.n}>
                    <td><strong>{h.n}</strong></td><td>{h.par}</td><td>{h.si}</td><td>{recv || ''}</td>
                    <td className={strokes != null && strokes < h.par ? 'under' : ''}>{s?.picked_up ? 'P' : strokes ?? ''}{s?.pending ? '…' : ''}</td>
                    <td>{x}</td>
                  </tr>
                );
              })}
              <tr>
                <td><strong>Tot</strong></td><td>{tot.par}</td><td /><td /><td><strong>{tot.s || ''}</strong></td>
                <td><strong>{isA ? formatToPar(row.netToPar, row.finished ? 1 : 0) : tot.x}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
