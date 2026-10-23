import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData, useScores, useSession, useSideEntriesState, useFeature, playerName } from '../lib/store.jsx';
import { readyBoard, headlines, isNetFormat, isTeamFormat, orderBoard, hasPace, isMine } from '../lib/board.js';
import { formatToPar, strokesReceived, stablefordPoints, strokeHoleNet } from '../lib/scoring.js';
import { Header, Seg, AvatarStack, Icon, Sheet, Loading, toast } from '../components/ui.jsx';
import { supabase, friendlyError } from '../lib/supabase.js';
import { TrophyArt } from '../components/TrophyArt.jsx';
import { QuickRoundDone } from './QuickRound.jsx';
import SharePicture from '../components/SharePicture.jsx';
import { boardCard } from '../lib/shareCard.js';
import { lazyScreen, LazyArea } from '../lib/lazy.jsx';
import { GamesChip } from '../components/GamesChip.jsx';
import { CompChips } from '../components/CompsChip.jsx';
import { RulesTodayChip } from '../components/RulesLinks.jsx';
import RuleTag from '../components/RuleTag.jsx';
import { TeeGroupsBoard } from './TeeGroups.jsx';
import { AwardCards } from '../components/Awards.jsx';
import RoundRecap from '../components/RoundRecap.jsx';
import { CourseGuideChip } from '../components/CourseGuideLink.jsx';
import { WeatherChip } from '../components/Weather.jsx';
import { AskChip } from '../components/AskChip.jsx';
import { RoundTools } from '../components/RoundTools.jsx';
import { SaveSpotBanner } from '../components/SaveSpot.jsx';
import { useRoundAdjustments, PenaltyLines } from '../components/LateJobs.jsx';
import { useProjectedDrives, DriveTracker } from '../components/AmbroseDrives.jsx';
import { PendingPenalties } from '../components/RulePenalty.jsx';
import { penaltyBadgeWord, penaltyRowWords, projectedStrokes } from '../lib/drives.js';

const DrawSetup = lazyScreen(() => import('../components/DrawSetup.jsx'), 'default', { inline: true });

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
  // The rounds of this round's trip (a past trip's leaderboard shows its own days).
  const tripId = round?.trip_id || data.currentTrip?.id;
  const list = data.rounds.filter((r) => (filter ? filter(r) : true) && (r.trip_id === tripId || r.id === round?.id));
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
  const drawOn = useFeature('draw');
  const sideCompsOn = useFeature('side_comps');
  const tvOn = useFeature('clubhouse_tv');
  const scores = useScores(round?.id);
  const side = useSideEntriesState(round?.id);
  const savedAdjustments = useRoundAdjustments(round?.id);
  // 099: drive penalties still to come on a live Ambrose round — shown on the board as "projected", not counted.
  const projectedDrives = useProjectedDrives(round, scores.index);
  const adjustments = useMemo(() => (projectedDrives.length ? [...savedAdjustments, ...projectedDrives] : savedAdjustments), [savedAdjustments, projectedDrives]);

  // Null until everything the total needs is here (side comp bonus strokes included), so it never flickers.
  const rawBoard = useMemo(() => readyBoard({
    round, course: round && data.coursesById[round.course_id], teams: (round && data.teamsByRound[round.id]) || [],
    roundPlayers: (round && data.roundPlayers[round.id]) || [], playersById: data.playersById,
    scoresIdx: scores.index, quickResults: data.quick_results, adjustments,
    sideEntries: side.rows, sideLoaded: side.loaded,
  }), [round, data, scores.index, side, adjustments]);
  // ov28 (D2): points order by default ("15 points sat above 19"); "On pace" keeps the old against-2-a-hole order.
  const board = useMemo(() => orderBoard(rawBoard, mode === 'pace' ? 'pace' : 'points'), [rawBoard, mode]);

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
        <Header logo title={trip?.name || (status?.legacy ? 'L.G.C Golf' : status?.group_name) || 'The Golf Trip'} sub="No rounds set up yet" />
        <SaveSpotBanner />
        {status?.is_admin && !status?.viewing ? (
          <div className="section">
            <Link to="/setup" className="card pad row" style={{ gap: 12, textDecoration: 'none', color: 'inherit', borderColor: 'var(--navy)' }}>
              <span style={{ fontSize: 30 }} aria-hidden="true">🏌️</span>
              <span className="grow"><strong style={{ fontSize: 18 }}>Set up your trip</strong><div className="small muted">5 quick steps: trip, courses, rounds, players, side comps.</div></span>
              <span className="btn gold sm">Start</span>
            </Link>
          </div>
        ) : (
          <div className="empty">Nothing to show yet. The organiser is setting things up.</div>
        )}
      </div>
    );
  }

  if (!board) {
    return (
      <div className="page">
        <Header logo title={trip?.name || 'Leaderboard'} sub={round.name} />
        <div data-testid="board-loading"><Loading /></div>
      </div>
    );
  }

  const isA = board.format === 'ambrose';
  const isNet = isNetFormat(board.format); // Ambrose and stroke play: net to par, lower better
  const isTeams = isTeamFormat(board.format); // Ambrose teams, 4BBB pairs
  const isStroke = board.format === 'stroke';
  const isFour = board.format === 'fourball';
  const projected = mode === 'proj';
  const rows = projected ? board.projection : board.rows;
  const heads = headlines(board, prevRanks, { projected });
  const me = status?.player_id;
  const myTeam = isTeams ? (data.teamsByRound[round.id] || []).find((t) => t.players.some((p) => p.id === me)) : null;
  const imPlaying = isTeams ? !!myTeam : (data.roundPlayers[round.id] || []).some((rp) => rp.player_id === me);
  const canScore = round.status === 'live' && (imPlaying || status?.is_admin);
  const winner = round.status === 'locked' ? board.rows[0] : null;
  const trophy = data.trophies.find((t) => t.trip_id === round.trip_id && t.type === (isA ? 'ambrose' : isStroke || isFour ? 'none' : 'stableford_total'));

  return (
    <div className="page">
      <Header
        logo
        title={round.name}
        sub={`${course?.name || ''}${trip ? ' · ' + trip.name : ''}`}
        right={round.status === 'live' ? <span className="pill-live"><span className="dot" />LIVE</span> : round.status === 'locked' ? <span className="pill-live">FINAL</span> : <span className="pill-live">NOT STARTED</span>}
      >
        {round.status !== 'locked' && (
          <Seg value={mode} onChange={setMode} options={hasPace(round.format)
            ? [{ value: 'live', label: 'Points' }, { value: 'pace', label: 'On pace' }, { value: 'proj', label: 'Projected' }]
            : [{ value: 'live', label: 'Live' }, { value: 'proj', label: 'Projected' }]} />
        )}
      </Header>
      <SaveSpotBanner />
      {trip && !status?.quick && <div className="section" style={{ paddingBottom: 0 }}><Link to={`/trip-now/${trip.id}`} className="small" style={{ fontWeight: 700 }} data-testid="back-to-trip">‹ {trip.name}</Link></div>}
      <RoundChips round={round} onChoose={choose} />
      <CompChips round={round} />
      <RulesTodayChip round={round} />
      <TeeGroupsBoard round={round} />
      <AwardCards />
      <CourseGuideChip course={course} round={round} />
      {!status?.quick && <AskChip about="round" />}

      {winner && (
        <div className="winner">
          <TrophyArt name={trophy?.name} type={trophy?.type} size={72} />
          <div className="grow">
            <div className="label">{trophy ? trophy.name : 'Winner'}{isTeams ? '' : ' · this round'}</div>
            <div className="t">{winner.name}</div>
            <div className="hdr-sub">{isA ? `${formatToPar(winner.netToPar, 1)} net` : isStroke ? `${formatToPar(winner.netToPar)} net · ${winner.gross} gross` : `${winner.points} points`}</div>
          </div>
          <AvatarStack players={winner.players} size={30} />
        </div>
      )}

      {winner && !status?.quick && (
        <div className="section row" style={{ gap: 8 }}>
          <SharePicture className="btn ghost sm grow" label="🖼️ Winner picture" kind="winner"
            data={{ name: winner.name, score: isA ? `${formatToPar(winner.netToPar, 1)} net` : isStroke ? `${formatToPar(winner.netToPar)} net` : `${winner.points} points`, roundName: trophy?.name || round.name, courseName: course?.name,
              date: round.play_date ? new Date(`${round.play_date}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '' }}
            text={`🏆 ${winner.name} wins ${trophy?.name || round.name}!`} />
          <SharePicture className="btn ghost sm grow" label="🖼️ Leaderboard picture" kind="leaderboard"
            data={boardCard(board, { roundName: round.name, courseName: course?.name, playDate: round.play_date, final: round.status === 'locked' })}
            text={`⛳ ${round.name}${course?.name ? ` at ${course.name}` : ''} — the leaderboard`} />
        </div>
      )}

      {status?.quick && <QuickRoundDone round={round} board={board} course={course} />}
      {status?.is_admin && ((tvOn && round.status !== 'locked') || round.tv) && <TvToggle round={round} />}
      <RoundTools round={round} />

      {sideCompsOn && round.status === 'live' && ((round.ctp_holes || []).length > 0 || (round.ld_holes || []).length > 0) && (
        <div className="section">
          <Link to={`/comps?r=${round.id}`} className="card pad row" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)', textDecoration: 'none', color: 'inherit' }}>
            <span className="grow small" style={{ lineHeight: 1.4 }}>
              <strong>Side comps today:</strong>
              {(round.ctp_holes || []).length > 0 && <> 🎯 Closest to pin on {round.ctp_holes.join(', ')}</>}
              {(round.ld_holes || []).length > 0 && <> · 💣 Longest drive on {round.ld_holes.join(', ')}</>}
            </span>
            <span className="btn sm gold">Record</span>
          </Link>
        </div>
      )}
      <GamesChip round={round} />
      <WeatherChip round={round} course={course} />
      {round.rules && round.status !== 'locked' && (
        <div className="section"><div className="card pad small" style={{ lineHeight: 1.45 }}><strong><RuleTag testId="todays-rules" rule={{ table: 'rounds', id: round.id, field: 'rules', label: 'Today’s rules', value: round.rules, where: { round_id: round.id, trip_id: round.trip_id, path: '/' } }}
          explain={round.rules}>Today's rules:</RuleTag></strong> {round.rules}{status?.legacy && <> <a href="?guide" style={{ fontWeight: 700 }}>How it works</a></>}</div></div>
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
        <span>{isA ? 'Team' : isFour ? 'Pair' : 'Player'}</span>
        <span style={{ textAlign: 'center' }}>Thru</span>
        <span style={{ textAlign: 'right' }}>{projected ? 'Proj.' : isNet ? 'Net' : 'Pts'}</span>
        <span style={{ textAlign: 'right' }}>{projected ? 'Win' : isA ? 'Move' : isStroke ? 'Gross' : '+/−'}</span>
      </div>
      <div className="card lb">
        {rows.length === 0 && (
          <div className="empty">
            {isA ? (status?.is_admin ? (
              <div className="stack" style={{ alignItems: 'stretch' }}>
                <strong style={{ color: 'var(--text)' }}>How are teams decided?</strong>
                {drawOn && <button type="button" className="btn gold" onClick={() => setDrawing(true)}>🎲 Random draw — live for everyone</button>}
                <Link to="/admin" className="btn ghost">Pick the teams myself</Link>
              </div>
            ) : (drawOn ? 'Teams come out of the draw — keep the app open and it will pop up.' : 'Teams aren’t set yet.')) : isFour ? (status?.is_admin ? <Link to="/admin" className="btn ghost">Pick the pairs in Admin</Link> : 'The pairs aren’t set yet.') : 'No players in this round yet.'}
          </div>
        )}
        {(() => {
          // ov28 (D2): your row (or your team's) is highlighted, and pinned at the top when you're further down.
          const at = projected ? -1 : rows.findIndex((r) => isMine(r, me));
          return at >= 4 ? [{ ...rows[at], pinned: true }, ...rows] : rows;
        })().map((r, i) => {
          const prev = prevRanks?.[r.id];
          const mv = prev ? prev - r.rank : 0;
          const mainVal = projected ? r.proj?.projected : isNet ? r.netToPar : r.points;
          const main = projected
            ? (r.proj ? (isNet ? formatToPar(r.proj.projected, 1) : r.proj.projected.toFixed(1)) : '–')
            : r.thru === 0 ? '–' : isNet ? formatToPar(r.netToPar, r.finished && r.netToPar % 1 ? 1 : 0) : String(r.points);
          const under = isNet && mainVal < 0 && r.thru > 0;
          return (
            <button key={`${r.pinned ? 'pin-' : ''}${r.id}`} type="button" data-testid={r.pinned ? 'lb-pinned' : isMine(r, me) ? 'lb-me' : undefined}
              className={'lb-row' + ((projected ? i === 0 : r.rank === 1 && !r.pinned) && (r.thru > 0 || projected) ? ' lead' : '') + (isMine(r, me) ? ' me' : '') + (r.pinned ? ' lb-pin' : '')} onClick={() => setOpen(r)}>
              <span className="lb-rank">{projected ? i + 1 : r.rankLabel}</span>
              <span className="stack" style={{ gap: 5, minWidth: 0 }}>
                <span className="lb-name ellipsis">{r.name}</span>
                <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <AvatarStack players={r.players} size={isTeams ? 26 : 22} />
                  {!!r.penalty && (
                    <span data-testid="lb-penalty" title={(r.penaltyLines || []).filter((l) => !l.waived).map((l) => l.label).join(', ')} style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: 999, background: r.penalty > 0 ? '#FDF1EF' : 'var(--gold-soft)', border: `1px solid ${r.penalty > 0 ? 'var(--under)' : 'var(--gold)'}`, color: r.penalty > 0 ? 'var(--under)' : 'var(--text)', fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap' }}>
                      {r.penalty > 0 ? '⚠️ +' : '🏆 −'}{Math.abs(r.penalty)} {penaltyBadgeWord(r.penaltyLines)}
                    </span>
                  )}
                  {projectedStrokes(r.penaltyLines) > 0 && (
                    <span data-testid="lb-projected-penalty" title={(r.penaltyLines || []).filter((l) => l.projected).map((l) => l.label).join(', ')} style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: 999, border: '1px dashed var(--under)', color: 'var(--under)', fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap' }}>
                      ⏳ +{projectedStrokes(r.penaltyLines)} drives
                    </span>
                  )}
                  {(r.bonusWins || []).map((w) => (
                    <span key={w} title={`${w}: −${round.comp_bonus} strokes`} style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 999, background: 'var(--gold)', color: 'var(--text)', fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap' }}>
                      {w.split(' ')[0]} {w.split(' ')[1]} −{round.comp_bonus}
                    </span>
                  ))}
                </span>
              </span>
              <span className="lb-thru">{r.finished ? 'F' : r.thru || '–'}{r.quick ? '*' : ''}</span>
              <span className={'lb-main' + (under ? ' under' : '') + (projected ? ' proj' : '')}>{main}</span>
              <span className="lb-side">
                {projected ? (
                  <>
                    <span>{r.proj?.winPct ?? 0}%</span>
                    <span className="bar"><i style={{ width: `${r.proj?.winPct ?? 0}%` }} /></span>
                  </>
                ) : isStroke ? (
                  <span className="mv-same">{r.thru ? r.gross : '—'}</span>
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
          : isFour
            ? '4BBB: each pair scores the better Stableford points on every hole (a hole counts once both have a score). +/− is against the expected 2 points a hole. Tap a pair for both cards.'
          : isStroke
            ? 'Stroke play: net to par for the holes each player has played, so players on different holes compare fairly. Gross is the total strokes so far; a pick-up counts as net double bogey. Tap a player for their card.'
          : isA
            ? `Net to par for the holes each team has played, so teams on different holes compare fairly.${round.comp_bonus ? ` Gold tags = side comp won (−${round.comp_bonus} strokes, already in the score).` : ''} Arrows show movement since you last looked. Tap a team for its card.`
            : 'Points, and +/− against the expected 2 points a hole, so players on different holes compare fairly. * = typed in from a paper card.'}
      </p>
      <PendingPenalties round={round} />
      {!status?.quick && <RoundRecap round={round} board={board} course={course} />}
      {scores.pendingCount > 0 && <div className="sync">{scores.pendingCount} score{scores.pendingCount > 1 ? 's' : ''} waiting to sync — they'll send when signal's back.</div>}

      {canScore && <div className="fab-space" aria-hidden="true" />}
      {canScore && (
        <Link to={`/score/${round.id}`} className="btn gold fab">Enter score{myTeam ? ` — ${myTeam.name}` : ''}</Link>
      )}

      {drawing && <LazyArea onClose={() => setDrawing(false)}><DrawSetup round={round} onClose={() => setDrawing(false)} /></LazyArea>}
      {open && (
        <Sheet title={open.name} onClose={() => setOpen(null)}>
          <Scorecard row={open} board={board} round={round} />
        </Sheet>
      )}
    </div>
  );
}

export function Scorecard({ row, board, round }) {
  if (board.format === 'fourball') return <FourballCard row={row} board={board} round={round} />;
  const isA = board.format === 'ambrose';
  const isNet = isNetFormat(board.format);
  const isStroke = board.format === 'stroke';
  const holes = board.holes;
  const tot = { par: 0, s: 0, x: 0 };
  return (
    <div className="stack">
      <div className="row">
        <AvatarStack players={row.players} size={34} />
        <span className="muted small">{isA ? <RuleTag testId="team-handicap" rule={{ table: 'teams', id: row.id, field: 'handicap', label: `Team handicap ${row.handicap}`, value: row.handicap, where: { path: '/' } }}
          explain="A team’s handicap is its players’ handicaps added up, divided by twice the team size (4 players ÷ 8, 3 players ÷ 6), unless an organiser set it by hand.">Team handicap {row.handicap}</RuleTag> : `Playing off ${row.handicap}`}</span>
      </div>
      {row.bonus ? <div className="card pad small" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)' }}><strong>Side comp bonus −{row.bonus}</strong> · {row.bonusWins.join(', ')} (already taken off the score)</div> : null}
      <PenaltyLines lines={row.penaltyLines} round={round} names={(row.players || []).length > 1} />
      {isA && round?.status === 'live' && <DriveTracker round={round} team={row} holes={holes} scores={row.scores || {}} />}
      {row.quick ? (
        <div className="card pad">Typed in from a paper card: <strong>{row.points} points</strong>.</div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="sc">
            <thead>
              <tr><th>Hole</th><th>Par</th><th>SI</th><th>Shots</th><th>Score</th><th>{isNet ? 'Net' : 'Pts'}</th></tr>
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
                  x = isStroke ? formatToPar(strokeHoleNet(h, s, row.handicap)) : isA ? formatToPar(strokes - h.par - recv) : String(stablefordPoints(h, strokes, row.handicap, s.picked_up));
                  if (!isNet) tot.x += stablefordPoints(h, strokes, row.handicap, s.picked_up);
                }
                return (
                  <tr key={h.n}>
                    <td><strong>{h.n}</strong></td><td>{h.par}</td><td>{h.si}</td><td>{recv || ''}</td>
                    <td className={strokes != null && strokes < h.par ? 'under' : ''}>{s?.picked_up ? 'P' : strokes ?? ''}{s?.pending ? '…' : ''}</td>
                    <td>{x}</td>
                  </tr>
                );
              })}
              {!!row.penalty && (
                <tr data-testid="sc-penalty-row">
                  <td colSpan={5}><strong>{row.penalty > 0 ? 'Penalty' : 'Strokes off'}</strong> <span className="muted">({penaltyRowWords(row.penaltyLines)})</span></td>
                  <td><strong>{(isNet ? row.penalty > 0 : row.penalty < 0) ? '+' : '−'}{Math.abs(row.penalty)}</strong></td>
                </tr>
              )}
              <tr>
                <td><strong>Tot</strong></td><td>{tot.par}</td><td /><td /><td><strong>{isStroke ? row.gross || '' : tot.s || ''}</strong></td>
                <td><strong>{isNet ? formatToPar(row.netToPar, isA && row.finished ? 1 : 0) : tot.x - (row.penalty || 0)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Organiser: show this round on the clubhouse TV (the group's switch must be on too). First names only. */
function TvToggle({ round }) {
  const data = useData();
  const [busy, setBusy] = useState(false);
  const flip = async (on) => {
    setBusy(true);
    const { error } = await supabase.rpc('set_round_tv', { p_round: round.id, p_on: on });
    if (error) toast(friendlyError(error)); else { toast(on ? 'On the clubhouse TV (first names only)' : 'Off the clubhouse TV'); data.reload(); }
    setBusy(false);
  };
  return (
    <div className="section">
      <label className="card pad row between" style={{ gap: 10 }}>
        <span className="small"><strong>📺 Show on the clubhouse TV</strong><div className="muted">On the club’s TV screen today — first names only, no photos. Anyone with the club’s TV link can see it.</div></span>
        <input type="checkbox" checked={!!round.tv} disabled={busy} onChange={(e) => flip(e.target.checked)} style={{ width: 24, height: 24, flex: 'none' }} aria-label="Show on the clubhouse TV" />
      </label>
    </div>
  );
}

/** A 4BBB pair's card: both players' scores and points, and the better ball that counted. */
function FourballCard({ row, board, round }) {
  const holes = board.holes;
  const m = row.members || [];
  const name = (id) => playerName(row.players.find((p) => p.id === id));
  const tot = Object.fromEntries(m.map((x) => [x.id, 0]));
  return (
    <div className="stack">
      <div className="row"><AvatarStack players={row.players} size={34} /><span className="muted small">{m.map((x) => `${name(x.id)} off ${Math.round(x.hcp)}`).join(' · ')}</span></div>
      <PenaltyLines lines={row.penaltyLines} round={round} names />
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="sc">
          <thead><tr><th>Hole</th><th>Par</th><th>SI</th>{m.map((x) => <th key={x.id}>{name(x.id).split(' ')[0]}</th>)}<th>Best</th></tr></thead>
          <tbody>
            {holes.map((h) => (
              <tr key={h.n}>
                <td><strong>{h.n}</strong></td><td>{h.par}</td><td>{h.si}</td>
                {m.map((x) => {
                  const s = x.scores[h.n];
                  const pts = s ? stablefordPoints(h, s.strokes, x.hcp, s.picked_up) : null;
                  if (pts != null) tot[x.id] += pts;
                  const counts = (row.counted?.[h.n] || []).includes(x.id);
                  return <td key={x.id} style={counts ? { fontWeight: 800, background: 'var(--gold-soft)' } : undefined}>{s ? `${s.picked_up ? 'P' : s.strokes}·${pts}` : ''}</td>;
                })}
                <td><strong>{row.perHole[h.n] ?? ''}</strong></td>
              </tr>
            ))}
            <tr><td><strong>Tot</strong></td><td /><td />{m.map((x) => <td key={x.id}>{tot[x.id]}</td>)}<td><strong>{row.points}</strong></td></tr>
          </tbody>
        </table>
      </div>
      <span className="small muted">Each box: strokes · points. Gold = the points that counted.</span>
    </div>
  );
}
