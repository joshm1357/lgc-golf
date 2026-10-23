// "Your round" (ov28, walkthrough C1/C2). Every player sees, for the round that's on or next: their team (colour and
// name if there is one), their partner(s), who they're up against, their playing group, their tee time and start hole.
// Works for any round — a Cup match, an Ambrose team, a 4BBB pair or just a playing group — and for groups without
// the Cup. Renders NOTHING when there's nothing to show (no team, no group, no time).
//
// Props kept simple so W2's "Your weekend" card can mount it: <YourRound trip={trip} round={round} me={playerId} />
//   trip  — the trip (used to pick the round when `round` is missing, and to find its plan for the maybe nudge)
//   round — the round (optional: defaults to the trip's live / today's / next round)
//   me    — a player id or player (optional: defaults to whoever is signed in)
// Also exports the small hooks the Cup, tee group and comp screens share: useRoundSetup (Cup matches, sides and tee
// groups for some rounds, kept on the phone for no signal) and usePeopleStatus (maybes and non-payers).
// The rules and words are in lib/yourround.js (shared with the notify function).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, useFeature, useRealtime, playerName, cacheGet, cacheSet } from '../lib/store.jsx';
import { currentGroup } from '../lib/group.js';
import { focusRound, tripPath } from '../lib/activetrip.js';
import { yourRound, offLine, teeWhen, andList, peopleStatus, drawNudge, dayAndTime } from '../lib/yourround.js';

const ids = (list) => (list || []).filter(Boolean);

/**
 * Cup matches, the Cup's sides and saved tee groups for these rounds, live. The last copy stays on the phone (patchy
 * signal on the course). Returns { ready, matches, sides, teeRows, reload }.
 */
export function useRoundSetup(roundIds) {
  const cupOn = useFeature('cup');
  const list = ids(roundIds);
  const key = `round-setup-${currentGroup() || 'none'}-${list.join(',')}`;
  const [state, setState] = useState(() => cacheGet(key) || { matches: [], sides: [], teeRows: [] });
  const [ready, setReady] = useState(() => !!cacheGet(key));
  const load = useCallback(async () => {
    if (!list.length) { setReady(true); return; }
    const q = (b) => Promise.resolve(b).then((r) => (r.error ? null : r.data || []), () => null);
    const [matches, sides, teeRows] = await Promise.all([
      cupOn ? q(supabase.from('cup_matches').select('*').in('round_id', list).order('sort').order('created_at')) : Promise.resolve([]),
      cupOn ? q(supabase.from('cup_sides').select('*').order('sort')) : Promise.resolve([]),
      q(supabase.from('tee_groups').select('*').in('round_id', list)),
    ]);
    if (matches == null && sides == null && teeRows == null) { setReady(true); return; } // no signal: keep the last copy
    const next = { matches: matches || [], sides: sides || [], teeRows: teeRows || [] };
    cacheSet(key, next);
    setState(next);
    setReady(true);
  }, [key, cupOn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useRealtime(['cup_matches', 'cup_sides', 'tee_groups'], load);
  return { ...state, ready, reload: load };
}

/**
 * Who's a maybe, out, hasn't replied or hasn't paid on this trip (its plan's who's-in and deposits). No plan, or the
 * planner off: nobody is flagged. Returns { statusOf(pid) → { flag }, plan }.
 * (W1's src/lib/headcount.js will be the one headcount rule; lib/yourround.js peopleStatus should call it once it's in.)
 */
export function usePeopleStatus(trip) {
  const plannerOn = useFeature('planner');
  const [d, setD] = useState({ plan: null, rsvps: [], transfers: [] });
  const load = useCallback(async () => {
    if (!plannerOn || !trip?.id) { setD({ plan: null, rsvps: [], transfers: [] }); return; }
    try {
      const { data: plans } = await supabase.from('plans').select('*').eq('trip_id', trip.id);
      const plan = (plans || []).find((p) => p.status !== 'cancelled') || null;
      if (!plan) { setD({ plan: null, rsvps: [], transfers: [] }); return; }
      const [r, t] = await Promise.all([
        supabase.from('plan_rsvps').select('player_id,status').eq('plan_id', plan.id),
        supabase.from('plan_transfers').select('from_id,to_id,amount').eq('plan_id', plan.id),
      ]);
      setD({ plan, rsvps: r.error ? [] : r.data || [], transfers: t.error ? [] : t.data || [] });
    } catch { /* no signal: nobody flagged */ }
  }, [plannerOn, trip?.id]);
  useEffect(() => { load(); }, [load]);
  useRealtime(plannerOn && trip?.id ? ['plan_rsvps', 'plan_transfers'] : [], load);
  const statusOf = useMemo(() => peopleStatus(d), [d]);
  return { statusOf, plan: d.plan };
}

/** One player's round, worked out from the app's data and the round's setup. */
export function useYourRound(round, meId) {
  const data = useData();
  const setup = useRoundSetup(round ? [round.id] : []);
  const y = useMemo(() => {
    if (!round || !meId) return null;
    const teams = (data.teamsByRound?.[round.id] || []).map((t) => ({ id: t.id, name: t.name, players: (t.players || []).map((p) => p.id) }));
    return yourRound({
      round, me: meId, teams,
      matches: setup.matches.filter((m) => m.round_id === round.id),
      sides: setup.sides,
      teeRows: setup.teeRows.filter((r) => r.round_id === round.id),
    });
  }, [round, meId, data.teamsByRound, setup.matches, setup.sides, setup.teeRows]);
  return { y, setup };
}

export default function YourRound({ trip = null, round = null, me = null, showScore = true }) {
  const data = useData();
  const { status } = useSession();
  const meId = (typeof me === 'string' ? me : me?.id) || status?.player_id || null;
  const tripRow = trip || (round ? data.trips?.find((t) => t.id === round.trip_id) : null) || null;
  const theRound = round || (tripRow ? focusRound(tripRow, data.rounds || [])?.round : null) || null;
  const { y } = useYourRound(theRound && theRound.status !== 'locked' ? theRound : null, meId);
  const people = usePeopleStatus(y ? tripRow : null);
  if (!y || !theRound) return null;
  const nameOf = (id) => playerName(data.playersById?.[id]);
  const colour = y.team?.colour || 'var(--navy)';
  const flag = people.statusOf(meId).flag;
  const organiser = people.plan?.organiser_id ? playerName(data.playersById?.[people.plan.organiser_id]).split(' ')[0] : '';
  const nudge = drawNudge({ flag, organiser: organiser === playerName(data.playersById?.[meId]).split(' ')[0] ? '' : organiser, y });
  const off = offLine(y, nameOf);
  const when = dayAndTime(theRound, y);
  const vs = y.opponents.length ? y.opponents.map(nameOf).join(' & ')
    : y.opposingTeams.length ? andList(y.opposingTeams.slice(0, 3).map((t) => t.name)) + (y.opposingTeams.length > 3 ? ` and ${y.opposingTeams.length - 3} more` : '')
      : null;
  return (
    <div className="card pad stack" data-testid="your-round" style={{ gap: 6, borderLeft: `6px solid ${colour}` }}>
      <div className="row between" style={{ gap: 8, alignItems: 'baseline' }}>
        <span className="label">Your round · {theRound.name}</span>
        {when && <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{when}</span>}
      </div>
      {y.team && (
        <div className="row" style={{ gap: 8 }} data-testid="your-team">
          {y.team.colour && <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 999, background: y.team.colour, flex: 'none' }} />}
          <strong style={{ fontSize: 18, color: y.team.colour || 'inherit' }}>{y.team.name}</strong>
          {y.partners.length > 0 && <span className="muted">with {andList(y.partners.map(nameOf))}</span>}
        </div>
      )}
      {vs && <div data-testid="your-opponents"><span className="muted">{y.kind === 'cup' ? 'Against' : 'Up against'}</span> <strong>{vs}</strong></div>}
      {off && <div data-testid="your-tee" style={{ fontWeight: 700 }}>⛳ {off}</div>}
      {!off && !y.tee && y.kind !== 'group' && <div className="small muted">Tee time to come.</div>}
      {nudge && (
        <Link to={tripPath(tripRow, people.plan ? [people.plan] : [])} className="card pad small" data-testid="your-nudge"
          style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)', color: 'inherit', textDecoration: 'none', fontWeight: 700 }}>
          🙋 {nudge} →
        </Link>
      )}
      {showScore && y.match && theRound.status === 'live' && (
        <Link to={`/cup/${y.match.id}`} className="btn gold block" data-testid="score-my-match">Score my match</Link>
      )}
    </div>
  );
}

export { teeWhen };
