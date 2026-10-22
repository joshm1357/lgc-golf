// A trip's Overview (Josh, 21 Oct): what the trip is, not how to organise it.
//  - Coming up / on now: countdown, who's in, the plan by day (course, format, weather, course guide), what you're
//    playing for, and your own bits (your jobs, the bring list).
//  - Done: the honours, each day's round with its winner and ▶ replay, photos, and links to dinner awards and stats.
// Used on the plan page (Overview | Organise) and on its own at /trip/:tripId for trips that have no plan (history).
// The maths is in lib/tripsummary.js.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useScores, useFeature } from '../lib/store.jsx';
import { Header, AvatarStack, Loading } from '../components/ui.jsx';
import { roundBoard } from '../lib/board.js';
import { isRoundFinished } from '../lib/replay.js';
import { fmtRange } from '../lib/plan.js';
import { isYearOnly, tripWhen } from '../lib/trips.js';
import { tripDays, tripCourses, roundFormat, roundWinner, countdownWords, whosIn, tripHonours } from '../lib/tripsummary.js';
import { useTripComps } from '../components/CompsChip.jsx';
import { WeatherChip } from '../components/Weather.jsx';
import { CourseGuideChip } from '../components/CourseGuideLink.jsx';

function useTripPhotos(tripId, on) {
  const [photos, setPhotos] = useState([]);
  useEffect(() => {
    if (!tripId || !on) return undefined;
    let live = true;
    supabase.from('posts').select('id,photo_url,created_at').eq('trip_id', tripId).not('photo_url', 'is', null)
      .order('created_at', { ascending: false }).limit(9)
      .then(({ data }) => { if (live) setPhotos(data || []); }, () => {});
    return () => { live = false; };
  }, [tripId, on]);
  return photos;
}

/** One round's line: course, format, and (once it's done) the winner with ▶ replay. */
function RoundLine({ round, course, board, upcoming }) {
  const replayOn = useFeature('replay');
  const done = isRoundFinished(round, board);
  const win = roundWinner(board, done);
  return (
    <div className="stack" style={{ gap: 4, padding: '10px 0', borderTop: '1px solid var(--line-soft)' }}>
      <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800 }}>{course?.name || round.name}</div>
          <div className="small muted">{[round.name !== course?.name ? round.name : null, roundFormat(round)].filter(Boolean).join(' · ')}</div>
        </div>
        {round.status === 'live' && <Link to="/" className="chip" style={{ background: 'var(--gold)', borderColor: 'var(--gold)', color: 'var(--navy)', fontWeight: 800 }}>● Live</Link>}
      </div>
      {win && <div style={{ fontWeight: 700 }}>🏆 {win.name}{win.score ? <span className="muted" style={{ fontWeight: 600 }}> · {win.score}</span> : null}{win.tie ? <span className="small muted"> (tied)</span> : null}</div>}
      {(upcoming || round.status !== 'locked') && course && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <WeatherChip round={round} course={course} />
          <CourseGuideChip course={course} round={round} />
        </div>
      )}
      {replayOn && round.status === 'locked' && <Link to={`/replay/${round.id}`} className="btn sm ghost" style={{ alignSelf: 'flex-start' }}>▶ Watch the replay</Link>}
    </div>
  );
}

export function TripOverview({ trip, plan = null, rsvps = [], items = [], stage = null, onOrganise = null }) {
  const data = useData();
  const { status } = useSession();
  const feedOn = useFeature('feed');
  const dinnerOn = useFeature('dinner_awards');
  const statsOn = useFeature('stats');
  const cupOn = useFeature('cup');
  const tripId = trip?.id || plan?.trip_id || null;
  const rounds = useMemo(() => (tripId ? data.rounds.filter((r) => r.trip_id === tripId) : []), [data.rounds, tripId]);
  const days = useMemo(() => tripDays(rounds, data.coursesById, tripId), [rounds, data.coursesById, tripId]);
  const courses = tripCourses(days);
  const scores = useScores(rounds.map((r) => r.id));
  const boards = useMemo(() => Object.fromEntries(rounds.map((r) => [r.id, roundBoard({
    round: r, course: data.coursesById[r.course_id], teams: data.teamsByRound[r.id] || [], roundPlayers: data.roundPlayers[r.id] || [],
    playersById: data.playersById, scoresIdx: scores.index, quickResults: data.quick_results,
  })])), [rounds, data, scores.index]);
  const [comps] = useTripComps(tripId);
  const photos = useTripPhotos(tripId, feedOn);
  const people = whosIn({ rsvps, rounds, roundPlayers: data.roundPlayers, teamsByRound: data.teamsByRound, playersById: data.playersById });
  const honours = tripHonours(data.honour_board, tripId);

  const start = plan?.start_date || trip?.start_date || days[0]?.date || null;
  const end = plan?.end_date || trip?.end_date || days[days.length - 1]?.date || null;
  const done = stage ? stage === 'done' : (end && countdownWords(start, end) == null);
  const countdown = done ? null : countdownWords(start, end);
  const place = plan?.location_name || courses.map((c) => c.name).join(', ');
  const me = status?.player_id;
  const myJobs = items.filter((j) => j.kind === 'job' && j.owner_id === me && !j.done);
  const bring = items.filter((j) => j.kind === 'bring');
  const cupComp = comps.find((c) => c.kind === 'cup' && !c.retired);

  return (
    <div className="stack" style={{ gap: 14 }}>
      {/* What and when */}
      <div className="card pad stack" style={{ gap: 8 }}>
        {photos[0] && <img src={photos[0].photo_url} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10 }} />}
        <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
          <div className="grow" style={{ minWidth: 0 }}>
            {/* The plan page's header already shows the dates and place. */}
            {!plan && <div className="small muted">{[start ? (isYearOnly(trip) ? tripWhen(trip) : fmtRange(start, end)) : 'Dates TBC', place || null].filter(Boolean).join(' · ')}</div>}
            {!done && plan && <div style={{ fontWeight: 800 }}>{countdown === 'On now' ? '⛳ On now' : '🔒 Locked in'}</div>}
            {done && <div style={{ fontWeight: 800 }}>🏁 Done and dusted</div>}
          </div>
          {countdown && countdown !== 'On now' && <span className="chip" style={{ alignSelf: 'center', background: 'var(--navy)', borderColor: 'var(--navy)', color: '#fff', fontWeight: 800, whiteSpace: 'nowrap' }}>{countdown}</span>}
        </div>
        {people.length > 0 && (
          <div className="row" style={{ gap: 8 }}>
            <AvatarStack players={people} />
            <span className="small muted">{people.length} {done ? 'played' : 'in'}</span>
          </div>
        )}
      </div>

      {/* Results (done) */}
      {done && honours.length > 0 && (
        <div className="card pad stack" style={{ gap: 6 }}>
          <strong>🏆 Honours</strong>
          {honours.map((h) => <div key={h.id} className="row between" style={{ gap: 8 }}><span className="muted">{h.trophy_name}</span><strong style={{ textAlign: 'right' }}>{h.winner_names}</strong></div>)}
          <Link to="/trophies" className="small" style={{ fontWeight: 700 }}>The Trophy Room →</Link>
        </div>
      )}

      {/* The days */}
      {days.length > 0 ? (
        <div className="card pad" style={{ paddingTop: 10 }}>
          <strong>{done ? '⛳ The rounds' : '🗓️ The plan'}</strong>
          {days.map((d) => (
            <div key={d.date || 'tbc'} style={{ marginTop: 8 }}>
              <span className="label">{d.label}</span>
              {d.rounds.map(({ round, course }) => <RoundLine key={round.id} round={round} course={course} board={boards[round.id]} upcoming={!done} />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="card pad small muted">No rounds set up yet.{status?.is_admin && plan && onOrganise ? ' Add them under Organise → Set up your trip.' : ''}</div>
      )}

      {/* What you're playing for */}
      {comps.length > 0 && (
        <div className="card pad stack" style={{ gap: 6 }}>
          <strong>🎯 What you’re playing for</strong>
          {comps.filter((c) => !c.retired).map((c) => <div key={c.id} className="small" style={{ fontWeight: 600 }}>{c.name}</div>)}
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <Link to="/comps-board" className="small" style={{ fontWeight: 700 }}>Standings →</Link>
            {cupOn && cupComp && <Link to="/cup" className="small" style={{ fontWeight: 700 }}>The Cup →</Link>}
          </div>
        </div>
      )}

      {/* Your bits (coming up) */}
      {!done && plan && (myJobs.length > 0 || bring.length > 0) && (
        <div className="card pad stack" style={{ gap: 6 }}>
          <strong>🙋 Your bits</strong>
          {myJobs.map((j) => <div key={j.id} className="small">📋 {j.title}{j.due ? <span className="muted"> · by {j.due}</span> : null}</div>)}
          {bring.length > 0 && <div className="small">🎒 Bring list: {bring.length} thing{bring.length === 1 ? '' : 's'}</div>}
          {onOrganise && <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onOrganise(myJobs.length ? 'jobs' : 'details')}>See it all →</button>}
        </div>
      )}

      {/* Photos and the rest (done) */}
      {photos.length > 1 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Photos</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            {photos.slice(0, 6).map((p) => <Link key={p.id} to="/feed"><img src={p.photo_url} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }} /></Link>)}
          </div>
        </div>
      )}
      {done && ((dinnerOn && !plan) || statsOn) && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {dinnerOn && tripId && !plan && <Link to={`/dinner/${tripId}`} className="btn sm ghost">🍽️ Dinner awards</Link>}
          {statsOn && <Link to="/stats" className="btn sm ghost">📊 Stats</Link>}
        </div>
      )}

      {onOrganise && (
        <button type="button" className="btn ghost block" onClick={() => onOrganise(null)}>
          {status?.is_admin ? '🧰 Organise this trip' : '🧰 Chat, jobs, kitty and rooms'}
        </button>
      )}
    </div>
  );
}

/** /trip/:tripId — the overview for a trip with no plan (e.g. one added from history). */
export default function TripOverviewScreen() {
  const { tripId } = useParams();
  const data = useData();
  const trip = data.ready ? data.trips.find((t) => t.id === tripId) : null;
  if (!data.ready) return <div className="page"><Header back title="Loading…" /><Loading /></div>;
  if (!trip) return <div className="page"><Header back title="Not found" /><div className="empty">This trip isn’t here any more.</div></div>;
  return (
    <div className="page">
      <Header back title={trip.name} sub={tripWhen(trip, null)} />
      <div className="section"><TripOverview trip={trip} /></div>
    </div>
  );
}

