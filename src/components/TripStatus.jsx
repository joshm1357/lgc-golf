// A trip's status (ov15, 22 Oct 2026): what's happening on this trip, in one place. Josh: "within that there is a trip
// status that is more about the active trip, like leaderboards, trip feed, comps etc."
//   * today's round (or the next / last one): a short leaderboard → tap for the full one (#/?r=<round>)
//   * side comps to record today
//   * the trip's rounds, each → its leaderboard (how a past trip's leaderboards are reached)
//   * what we're playing for: the trip's comps with who leads → their standings (Cup, games too)
//   * the trip's feed (posts from this trip)
// Shown on This trip (screens/TripNow.jsx) and, without the feed, on a trip's Overview (one line in TripOverview.jsx).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useScores, useSession, useSideEntriesState, useFeature, useRealtime, playerName } from '../lib/store.jsx';
import { readyBoard, isNetFormat, isTeamFormat } from '../lib/board.js';
import { formatToPar } from '../lib/scoring.js';
import { focusRound } from '../lib/activetrip.js';
import { compStandings, COMP_TYPE, dayOf } from '../lib/comps.js';
import { useTripComps, useCompData } from './CompsChip.jsx';
import { AvatarStack, Avatar, timeAgo } from './ui.jsx';

const FORMAT = { stableford: 'Stableford', ambrose: 'Ambrose', stroke: 'Stroke play', fourball: '4BBB' };
const pill = (r) => (r.status === 'live' ? '● Live' : r.status === 'locked' ? 'Final' : 'Not started');

/** Today's round as a short leaderboard. */
function RoundBoardMini({ round, when }) {
  const data = useData();
  const { status } = useSession();
  const scores = useScores(round.id);
  const side = useSideEntriesState(round.id);
  // Null until the side comp entries are here when the round has bonus strokes — never a total without its bonus.
  const board = useMemo(() => readyBoard({
    round, course: data.coursesById[round.course_id], teams: data.teamsByRound[round.id] || [], roundPlayers: data.roundPlayers[round.id] || [],
    playersById: data.playersById, scoresIdx: scores.index, quickResults: data.quick_results,
    sideEntries: side.rows, sideLoaded: side.loaded,
  }), [round, data, scores.index, side]);
  if (!board) {
    return <div className="card pad small muted" data-testid="trip-round-board-loading">Loading {round.name}’s leaderboard…</div>;
  }
  const isNet = isNetFormat(board.format);
  const me = status?.player_id;
  const imPlaying = isTeamFormat(board.format)
    ? (data.teamsByRound[round.id] || []).some((t) => t.players.some((p) => p.id === me))
    : (data.roundPlayers[round.id] || []).some((rp) => rp.player_id === me);
  const canScore = round.status === 'live' && (imPlaying || status?.is_admin) && !status?.viewing;
  const course = data.coursesById[round.course_id];
  const head = { live: 'Today’s round', today: 'Today’s round', next: 'Next round', last: 'Last round' }[when] || 'Round';
  const rows = board.rows.slice(0, 8);
  return (
    <div className="card" data-testid="trip-round-board" style={{ overflow: 'hidden' }}>
      <div className="row between" style={{ gap: 8, padding: '12px 14px 6px' }}>
        <div style={{ minWidth: 0 }}>
          <span className="label">{head}</span>
          <div style={{ fontWeight: 800 }} className="ellipsis">{round.name}</div>
          <div className="small muted ellipsis">{[course?.name, FORMAT[round.format], dayOf(round)].filter(Boolean).join(' · ')}</div>
        </div>
        <span className="chip" style={{ alignSelf: 'center', flex: 'none', ...(round.status === 'live' ? { background: 'var(--gold)', borderColor: 'var(--gold)', fontWeight: 800 } : { fontWeight: 700 }) }}>{pill(round)}</span>
      </div>
      {rows.length === 0 ? (
        <div className="small muted" style={{ padding: '4px 14px 12px' }}>{isTeamFormat(board.format) ? 'Teams aren’t set yet.' : 'No players in this round yet.'}</div>
      ) : rows.map((r, i) => (
        <Link key={r.id} to={`/?r=${round.id}`} data-testid="mini-row" className={'lb-row' + (i === 0 && r.thru > 0 ? ' lead' : '')}
          style={{ gridTemplateColumns: '34px minmax(0,1fr) 34px 54px', color: 'inherit', textDecoration: 'none', minHeight: 48 }}>
          <span className="lb-rank" style={{ fontSize: 18 }}>{r.thru ? r.rankLabel : '–'}</span>
          <span className="row" style={{ gap: 8, minWidth: 0 }}><AvatarStack players={r.players} size={24} /><span className="lb-name ellipsis" style={{ fontSize: 15 }}>{r.name}</span></span>
          <span className="lb-thru">{r.finished ? 'F' : r.thru || '–'}</span>
          <span className="lb-main" style={{ fontSize: 18 }}>{r.thru === 0 ? '–' : isNet ? formatToPar(r.netToPar, r.finished && r.netToPar % 1 ? 1 : 0) : r.points}</span>
        </Link>
      ))}
      <div className="row" style={{ gap: 8, padding: 12, flexWrap: 'wrap' }}>
        <Link to={`/?r=${round.id}`} className="btn ghost sm grow" style={{ textAlign: 'center' }}>Full leaderboard{board.rows.length > rows.length ? ` (${board.rows.length})` : ''} →</Link>
        {canScore && <Link to={`/score/${round.id}`} className="btn gold sm grow" style={{ textAlign: 'center' }}>Enter score</Link>}
      </div>
    </div>
  );
}

/** "Side comps today: closest to pin on 6 · longest drive on 9" → record one. */
function SideCompsToday({ round }) {
  const on = useFeature('side_comps');
  const ctp = round?.ctp_holes || [];
  const ld = round?.ld_holes || [];
  if (!on || !round || round.status !== 'live' || (!ctp.length && !ld.length)) return null;
  return (
    <Link to={`/comps?r=${round.id}`} className="card pad row" data-testid="trip-side-comps"
      style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)', textDecoration: 'none', color: 'inherit', gap: 10 }}>
      <span className="grow small" style={{ lineHeight: 1.4 }}>
        <strong>Side comps today:</strong>
        {ctp.length > 0 && <> 🎯 Closest to pin on {ctp.join(', ')}</>}
        {ld.length > 0 && <>{ctp.length ? ' ·' : ''} 💣 Longest drive on {ld.join(', ')}</>}
      </span>
      <span className="btn sm gold">Record</span>
    </Link>
  );
}

/** The trip's rounds, each to its leaderboard. */
function RoundsList({ rounds }) {
  const data = useData();
  if (!rounds.length) return null;
  return (
    <div className="card" data-testid="trip-rounds">
      <div className="label" style={{ padding: '12px 14px 4px' }}>Rounds · leaderboards</div>
      {rounds.map((r) => (
        <Link key={r.id} to={`/?r=${r.id}`} className="row" aria-label={`${r.name} leaderboard`}
          style={{ gap: 10, padding: '10px 14px', borderTop: '1px solid var(--line-soft)', textDecoration: 'none', color: 'inherit', minHeight: 48 }}>
          <span className="grow" style={{ minWidth: 0 }}>
            <strong className="ellipsis" style={{ display: 'block' }}>{r.name}</strong>
            <span className="small muted">{[dayOf(r), data.coursesById[r.course_id]?.name, FORMAT[r.format]].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="small" style={{ fontWeight: 700, color: r.status === 'live' ? 'var(--navy)' : 'var(--muted)', flex: 'none' }}>{pill(r)} ›</span>
        </Link>
      ))}
    </div>
  );
}

/** What we're playing for on this trip: each comp with who leads, → its standings. */
function CompsSection({ trip, rounds }) {
  const [comps] = useTripComps(trip.id);
  const cd = useCompData(trip.id);
  const cupOn = useFeature('cup');
  const gamesOn = useFeature('games');
  const list = comps.filter((c) => !c.retired);
  const lines = useMemo(() => list.map((c) => {
    let st = null;
    try { st = compStandings(c, cd); } catch { st = null; }
    return { c, lead: st?.leaderText || null };
  }), [list, cd]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = rounds.find((r) => r.status === 'live');
  const hasCup = list.some((c) => c.kind === 'cup');
  if (!list.length && !gamesOn && !cupOn) return null;
  return (
    <div className="card" data-testid="trip-comps">
      <div className="label" style={{ padding: '12px 14px 4px' }}>What we’re playing for</div>
      {lines.map(({ c, lead }) => (
        <Link key={c.id} to={c.kind === 'cup' && cupOn ? '/cup' : `/comps-board?trip=${trip.id}&c=${encodeURIComponent(c.id)}`} className="row"
          style={{ gap: 10, padding: '10px 14px', borderTop: '1px solid var(--line-soft)', textDecoration: 'none', color: 'inherit', minHeight: 48 }}>
          <span aria-hidden="true" style={{ fontSize: 22 }}>{c.trophy_id ? '🏆' : COMP_TYPE[c.kind]?.emoji}</span>
          <span className="grow" style={{ minWidth: 0 }}>
            <strong className="ellipsis" style={{ display: 'block' }}>{c.name}</strong>
            <span className="small muted">{lead || COMP_TYPE[c.kind]?.name}</span>
          </span>
          <span className="muted" aria-hidden="true">›</span>
        </Link>
      ))}
      {!list.length && <div className="small muted" style={{ padding: '4px 14px 10px' }}>Nothing set yet — just the round leaderboards.</div>}
      <div className="row" style={{ gap: 12, padding: '8px 14px 12px', flexWrap: 'wrap', borderTop: '1px solid var(--line-soft)' }}>
        <Link to={`/comps-board?trip=${trip.id}`} className="small" style={{ fontWeight: 700 }}>All standings →</Link>
        {cupOn && !hasCup && <Link to="/cup" className="small" style={{ fontWeight: 700 }}>The Cup →</Link>}
        {gamesOn && <Link to={live ? `/games?r=${live.id}` : '/games'} className="small" style={{ fontWeight: 700 }}>Games & side bets →</Link>}
      </div>
    </div>
  );
}

/** The trip's feed: the latest few posts from this trip. */
function TripFeed({ trip }) {
  const data = useData();
  const [posts, setPosts] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data: ps, error } = await supabase.from('posts').select('*').eq('trip_id', trip.id).order('created_at', { ascending: false }).limit(3);
      setPosts(error ? [] : ps || []);
    } catch { setPosts([]); }
  }, [trip.id]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['posts'], load);
  if (posts == null) return null;
  return (
    <div className="card" data-testid="trip-feed">
      <div className="label" style={{ padding: '12px 14px 4px' }}>Trip feed</div>
      {!posts.length && <div className="small muted" style={{ padding: '4px 14px 10px' }}>Nothing posted on this trip yet.</div>}
      {posts.map((p) => {
        const who = data.playersById[p.player_id];
        return (
          <Link key={p.id} to={`/feed?trip=${trip.id}`} className="row" style={{ gap: 10, padding: '10px 14px', borderTop: '1px solid var(--line-soft)', textDecoration: 'none', color: 'inherit', alignItems: 'flex-start' }}>
            {who ? <Avatar player={who} size={30} /> : <span aria-hidden="true" style={{ fontSize: 22 }}>⛳</span>}
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="small"><strong>{who ? playerName(who) : 'The app'}</strong> <span className="muted">· {timeAgo(p.created_at)}</span></span>
              <span style={{ fontSize: 15, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{p.body}</span>
            </span>
            {p.photo_url && <img src={p.photo_url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flex: 'none' }} />}
          </Link>
        );
      })}
      <div style={{ padding: '8px 14px 12px', borderTop: '1px solid var(--line-soft)' }}>
        <Link to={`/feed?trip=${trip.id}`} className="small" style={{ fontWeight: 700 }}>All of this trip’s posts →</Link>
      </div>
    </div>
  );
}

/** The trip's status. overview: on the trip's Overview (no feed — the Overview has its photos; the board only if live). */
export default function TripStatus({ trip, overview = false }) {
  const data = useData();
  const feedOn = useFeature('feed');
  const rounds = useMemo(() => (trip ? data.rounds.filter((r) => r.trip_id === trip.id) : []), [data.rounds, trip]);
  if (!trip) return null;
  const focus = focusRound(trip, rounds);
  const showBoard = focus && (!overview || focus.when === 'live');
  return (
    <div className="stack" style={{ gap: 12 }} data-testid="trip-status">
      {showBoard && <RoundBoardMini round={focus.round} when={focus.when} />}
      {focus && <SideCompsToday round={focus.round} />}
      <CompsSection trip={trip} rounds={rounds} />
      {!overview && feedOn && <TripFeed trip={trip} />}
      <RoundsList rounds={rounds} />
    </div>
  );
}
