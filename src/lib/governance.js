// Governance and the Tribunal (Stage 11b, migration 061). Pure logic only — no screens, no database.
//
// Words (used the same way in code, comments and the app):
//   case          — anything raised for the group to decide, serious or silly.
//   hearing       — the time a case is open: the case is put, the person it's about can reply, people discuss and vote.
//   verdict       — the result of a case.
//   decision rule — who decides a kind of case, and how (e.g. "majority of players").
//   committee     — a named set of players who decide certain kinds of case (e.g. Handicap Committee).
//   seat / term   — a place on a committee, and how long the holder keeps it.
//
// The database has the same rules (061_governance.sql: private.gov_preset, private.gov_settings,
// private.case_evaluate, private.seat_term_ended). The app uses this file to SHOW what will happen; the database
// decides. Keep both in step — the unit tests below and the staging SQL tests check the same cases.

export const KINDS = [
  { key: 'new_rule', label: 'New rule', example: 'Gimmes inside a putter length', effect: 'Adds the rule', rule: true, feature: 'rule_voting' },
  { key: 'change_rule', label: 'Change a rule', example: 'Make the CTP $10', effect: 'New version of the rule; the old one is kept', rule: true, challenge: true, feature: 'rule_challenges' },
  { key: 'scrap_rule', label: 'Scrap a rule', example: 'Drop the minimum drives rule', effect: 'Retires the rule; kept in history', rule: true, challenge: true, feature: 'rule_challenges' },
  { key: 'ruling', label: 'Ruling', example: 'Does the mulligan rule cover the drive on 1?', effect: 'Written ruling attached to the rule', challenge: true, feature: 'rule_challenges' },
  { key: 'handicap', label: 'Handicap', example: '39 points and still crying poor', effect: 'Handicap change', feature: 'tribunal' },
  { key: 'other', label: 'Anything else', example: 'That shirt on day 2', effect: 'Verdict, plus a penalty in words if you like', feature: 'other_cases' },
  { key: 'trip_decision', label: 'Trip decisions', example: 'Pick the winning dates or place', effect: 'Who picks the winner of a trip vote', feature: 'tribunal', settingsOnly: true },
  { key: 'election', label: 'Committee election', example: 'Fill a seat on the Handicap Committee', effect: 'Seat filled for a term', feature: 'committees' },
  { key: 'governance', label: 'Governance change', example: 'Rule changes now need two-thirds', effect: 'Changes the decision rules', feature: 'tribunal' },
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.key, k]));
/** Kinds whose verdict changes the rules or the decision rules: these wait for the next trip unless approved. */
export const TIMED_KINDS = new Set(['new_rule', 'change_rule', 'scrap_rule', 'governance']);

export const DECIDES = {
  organiser: 'Any organiser',
  organisers_majority: 'Majority of organisers',
  organisers_all: 'All organisers',
  committee: 'A committee (majority of its members)',
  players_majority: 'Majority of players',
  players_two_thirds: 'Two-thirds of players',
  trip_organiser: 'Any organiser, or the trip’s organiser',
};
/** Which "who decides" choices each kind allows. Handicap cases still run through today's Tribunal functions. */
export function decidesFor(kind) {
  if (kind === 'trip_decision') return ['organiser', 'trip_organiser'];
  if (kind === 'handicap') return ['players_majority', 'organiser', 'committee'];
  return ['organiser', 'organisers_majority', 'organisers_all', 'committee', 'players_majority', 'players_two_thirds'];
}

export const EFFECT = {
  now: 'Straight away',
  next_trip: 'From the next trip',
  mid_trip_approval: 'Next trip, or mid-trip if an organiser approves',
};

const BASE = { decides: 'players_majority', committee_id: null, raise_by: 'players', close_hours: 48, min_turnout: 0, tie_break: 'status_quo', subject_votes: false, takes_effect: 'next_trip' };
const ALL = KINDS.map((k) => k.key);
const fill = (fn) => Object.fromEntries(ALL.map((k) => [k, { ...BASE, ...fn(k) }]));

export const PRESETS = {
  organiser: {
    label: 'Organiser runs it',
    blurb: 'Organisers decide everything. Players can still raise cases and have a say.',
    settings: fill(() => ({ decides: 'organiser', takes_effect: 'mid_trip_approval' })),
  },
  majority: {
    label: 'Majority rules',
    blurb: 'Players vote on rules and “anything else” (at least half must vote). Organisers handle trip decisions.',
    settings: fill((k) => (k === 'trip_decision' ? { decides: 'organiser' } : { decides: 'players_majority', min_turnout: k === 'handicap' ? 0 : 0.5 })),
  },
  club: {
    label: 'Club style',
    blurb: 'A Handicap Committee and a Rules Committee, elected for a term. Players vote on the rest.',
    settings: fill((k) => {
      if (k === 'trip_decision') return { decides: 'organiser' };
      if (k === 'handicap' || KIND[k].rule || k === 'ruling') return { decides: 'committee', min_turnout: 0.5 };
      if (k === 'governance') return { decides: 'players_two_thirds', min_turnout: 0.5 };
      return { decides: 'players_majority', min_turnout: 0.5 };
    }),
  },
  lgc: {
    label: 'L.G.C (as today)',
    blurb: 'Exactly how the L.G.C works now: the lads vote on handicaps, organisers decide rules, plus rule challenges.',
    settings: fill((k) => {
      if (k === 'handicap' || k === 'other' || k === 'election') return { decides: 'players_majority', takes_effect: 'now' };
      return { decides: 'organiser', takes_effect: 'now' };
    }),
  },
};
/** Which committee a Club style kind goes to (by name; the database makes them when the preset is picked). */
export const CLUB_COMMITTEES = [
  { name: 'Handicap Committee', kinds: ['handicap'] },
  { name: 'Rules Committee', kinds: ['new_rule', 'change_rule', 'scrap_rule', 'ruling'] },
];

/** A preset's setting for one kind. Unknown preset = L.G.C (today's behaviour). */
export function presetSettings(preset, kind) {
  return { ...(PRESETS[preset] || PRESETS.lgc).settings[kind] };
}

/** What applies to each kind: the group's own row if it has one, else its preset (none yet = today's behaviour).
 *  Trip decisions always follow groups.vote_decider (old app versions read it). */
export function effectiveSettings(rows = [], { preset = null, voteDecider = 'admin' } = {}) {
  const out = {};
  for (const k of ALL) {
    const row = rows.find((r) => r.kind === k);
    out[k] = row ? { ...BASE, ...pick(row) } : presetSettings(preset || 'lgc', k);
  }
  out.trip_decision = { ...out.trip_decision, decides: voteDecider === 'admin_or_organiser' ? 'trip_organiser' : 'organiser' };
  return out;
}
function pick(r) {
  const o = {};
  for (const k of Object.keys(BASE)) if (r[k] !== undefined && r[k] !== null) o[k] = k === 'min_turnout' ? Number(r[k]) : r[k];
  if (r.committee_id !== undefined) o.committee_id = r.committee_id;
  return o;
}

/** Problems with a setting — the app refuses any that could never pass. [] = fine. */
export function settingsProblems(kind, s, { committees = [] } = {}) {
  const p = [];
  if (!decidesFor(kind).includes(s.decides)) p.push('That choice isn’t available for this kind of case.');
  if (s.decides === 'committee') {
    const c = committees.find((x) => x.id === s.committee_id);
    if (!c) p.push('Pick a committee.');
    else if (!(Number(c.seats) >= 1)) p.push('A committee needs at least one seat.');
  }
  if (!['players', 'organisers'].includes(s.raise_by)) p.push('Who can raise it: players or organisers.');
  if (!(Number(s.close_hours) >= 1 && Number(s.close_hours) <= 720)) p.push('Voting closes after 1 hour to 30 days.');
  if (!(Number(s.min_turnout) >= 0 && Number(s.min_turnout) <= 1)) p.push('Minimum turnout is between none and everyone.');
  if (!['status_quo', 'organiser'].includes(s.tie_break)) p.push('Tie-break: stays as it is, or an organiser’s casting vote.');
  if (!EFFECT[s.takes_effect]) p.push('Pick when it takes effect.');
  return p;
}

// ------------------------------------------------------------------ who votes
/** members: [{ player_id, role }] (role organiser | player | guest); seats: player ids holding a seat.
 *  Returns { mode: 'organiser' | 'votes', voters: [player ids] }.
 *  'organiser' = one organiser decides (players can still vote, as a show of hands: `voters` are those players). */
export function electorate({ settings, members = [], seats = [], subjectId = null, fallback = false }) {
  const real = members.filter((m) => m.player_id && m.role !== 'guest');
  const players = real.filter((m) => settings.subject_votes || m.player_id !== subjectId).map((m) => m.player_id);
  const organisers = real.filter((m) => m.role === 'organiser' && m.player_id !== subjectId).map((m) => m.player_id);
  const d = settings.decides;
  if (fallback || d === 'organiser' || d === 'trip_organiser') return { mode: 'organiser', voters: uniq(players) };
  if (d === 'organisers_majority' || d === 'organisers_all') return { mode: 'votes', voters: uniq(organisers) };
  if (d === 'committee') {
    const ok = new Set(real.map((m) => m.player_id));
    return { mode: 'votes', voters: uniq(seats.filter((p) => p && p !== subjectId && ok.has(p))) };
  }
  return { mode: 'votes', voters: uniq(players) };
}
const uniq = (a) => [...new Set(a)];

/** Count the votes that matter (only from the electorate). votes: [{ player_id, vote: for|against|abstain }]. */
export function tally(votes = [], voters = []) {
  const ok = new Set(voters);
  const t = { for: 0, against: 0, abstain: 0, cast: 0 };
  for (const v of votes) {
    if (!ok.has(v.player_id) || !(v.vote in t)) continue;
    t[v.vote] += 1;
    t.cast += 1;
  }
  return t;
}

/** Where a case stands.
 *  Returns { state, reason }: state 'open' | 'passed' | 'failed' | 'fallback' (committee → organisers) |
 *  'casting' (a tie, an organiser has the casting vote) | 'organiser' (waiting for an organiser's decision).
 *  `closed` = voting time is up. A case is settled early once no remaining vote could change it. */
export function evaluate({ settings, voters = [], votes = [], closed = false, fallback = false }) {
  const d = settings.decides;
  if (fallback || d === 'organiser' || d === 'trip_organiser') return { state: 'organiser', reason: 'An organiser decides' };
  const n = voters.length;
  if (n === 0) return { state: 'fallback', reason: 'Nobody left to vote — the organisers decide' };
  const t = tally(votes, voters);
  const remaining = n - t.cast;
  const need = Math.ceil(Number(settings.min_turnout || 0) * n - 1e-9);
  const turnoutMet = t.cast >= need;
  const done = closed || remaining <= 0;
  const rule = d === 'players_two_thirds' ? 'two_thirds' : d === 'organisers_all' ? 'all' : 'majority';
  const casting = settings.tie_break === 'organiser';

  if (rule === 'all') {
    if (t.against > 0 || t.abstain > 0) return { state: 'failed', reason: 'Not every organiser agreed' };
    if (t.for === n) return { state: 'passed', reason: 'Every organiser agreed' };
    return done ? { state: 'failed', reason: 'Not every organiser voted' } : { state: 'open', reason: 'Waiting for every organiser' };
  }
  if (!done) {
    if (rule === 'majority') {
      if (turnoutMet && t.for > t.against + remaining) return { state: 'passed', reason: 'A majority is in' };
      if (t.against > t.for + remaining || (t.against === t.for + remaining && !casting)) return { state: 'failed', reason: 'It can’t pass now' };
    } else {
      if (turnoutMet && t.for * 3 >= 2 * (t.for + t.against + remaining)) return { state: 'passed', reason: 'Two-thirds are in' };
      if ((t.for + remaining) * 3 < 2 * (t.for + remaining + t.against)) return { state: 'failed', reason: 'It can’t reach two-thirds now' };
    }
    return { state: 'open', reason: 'Voting' };
  }
  if (!turnoutMet) {
    return d === 'committee'
      ? { state: 'fallback', reason: 'The committee didn’t reach its turnout — the organisers decide' }
      : { state: 'failed', reason: 'Not enough people voted, so it stays as it is' };
  }
  if (rule === 'two_thirds') {
    return t.for > 0 && t.for * 3 >= 2 * (t.for + t.against) ? { state: 'passed', reason: 'Two-thirds voted for' } : { state: 'failed', reason: 'Short of two-thirds' };
  }
  if (t.for > t.against) return { state: 'passed', reason: 'Majority for' };
  if (t.for < t.against) return { state: 'failed', reason: 'Majority against' };
  return casting ? { state: 'casting', reason: 'A tie — an organiser has the casting vote' } : { state: 'failed', reason: 'A tie, so it stays as it is' };
}

// ------------------------------------------------------------------ who can do what (the app hides; the database refuses)
export function canRaise({ role, settings }) {
  if (!role || role === 'guest') return false;
  return settings.raise_by !== 'organisers' || role === 'organiser';
}
/** Can this person vote (a real vote or a show of hands)? */
export function canVote({ playerId, role, voters = [] }) {
  return !!playerId && role !== 'guest' && voters.includes(playerId);
}
/** Can this person make the organiser's decision on an open case? Never on a case about themselves. */
export function canDecide({ role, playerId, subjectId, state }) {
  return role === 'organiser' && !!playerId && playerId !== subjectId && ['organiser', 'casting', 'fallback'].includes(state);
}

// ------------------------------------------------------------------ when a verdict takes effect
/** Today in Sydney as YYYY-MM-DD. */
export function sydneyDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
/** The trip under way (dates include today, not locked) or the trip of a live round. Returns its id or null. */
export function tripInProgress({ trips = [], rounds = [], today }) {
  const live = rounds.find((r) => r.status === 'live' && r.trip_id);
  if (live) return live.trip_id;
  const t = trips.find((x) => x.status !== 'locked' && x.start_date && x.start_date <= today && (x.end_date || x.start_date) >= today);
  return t ? t.id : null;
}
/** When a passed case's change applies: 'now' | 'next_trip' | 'next_round'. */
export function whenItApplies({ kind, settings, tripId = null, liveRound = false, approved = false }) {
  if (!TIMED_KINDS.has(kind)) return 'now';
  if (settings.takes_effect === 'now' || !tripId) return 'now';
  if (approved && settings.takes_effect === 'mid_trip_approval') return liveRound ? 'next_round' : 'now';
  return 'next_trip';
}
/** Is a waiting change due? waiting: 'next_trip' (with the trip it was decided in) or 'next_round'. */
export function isDue({ waiting, decidedInTrip = null, tripId = null, liveRound = false, startingRoundTrip }) {
  if (waiting === 'next_round') return !liveRound;
  if (waiting === 'next_trip') {
    if (startingRoundTrip !== undefined) return startingRoundTrip !== decidedInTrip;
    return !tripId || tripId !== decidedInTrip;
  }
  return false;
}
/** Can an organiser approve this passed change mid-trip? */
export function canApproveMidTrip({ role, waiting, settings }) {
  return role === 'organiser' && waiting === 'next_trip' && settings.takes_effect === 'mid_trip_approval';
}

// ------------------------------------------------------------------ committees and terms
function addMonths(iso, months) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
/** Trips that have started since the seat was filled (start date after it, up to today). */
export function tripsSince(trips = [], sinceIso, today) {
  const since = String(sinceIso || '').slice(0, 10);
  return trips.filter((t) => t.start_date && t.start_date > since && t.start_date <= today).length;
}
/** A seat's term. term_trips / term_years: either, both ("whichever comes first") or neither (until replaced).
 *  half_term (090, staggered committees): this term is half length (at least 1 trip / 1 month).
 *  Same as private.seat_term_ended in the database.
 *  Returns { ended, by: 'trips'|'years'|null, soon, tripsDone, tripsLeft, endsOn (YYYY-MM-DD by years, or null) }. */
export function termStatus({ started_at, term_trips = null, term_years = null, half_term = false }, { trips = [], now = new Date(), today = sydneyDate(now) } = {}) {
  const tt = term_trips ? (half_term ? Math.max(1, Math.ceil(Number(term_trips) / 2)) : Number(term_trips)) : null;
  const months = term_years ? (half_term ? Math.max(1, Math.round(Number(term_years) * 6)) : Math.round(Number(term_years) * 12)) : null;
  if (!started_at) return { ended: false, by: null, soon: false, tripsDone: 0, tripsLeft: tt, endsOn: null };
  const tripsDone = tripsSince(trips, started_at, today);
  const end = months ? addMonths(started_at, months) : null;
  const byTrips = !!tt && tripsDone >= tt;
  const byYears = !!end && now >= end;
  const ended = byTrips || byYears;
  const soon = !ended && ((!!tt && tripsDone === tt - 1) || (!!end && end - now <= 14 * 86400000));
  return { ended, by: byTrips ? 'trips' : byYears ? 'years' : null, soon, tripsDone, tripsLeft: tt ? Math.max(0, tt - tripsDone) : null, endsOn: end ? end.toISOString().slice(0, 10) : null };
}

/** "Term ends 12 Mar 2027", "Term ends after 1 more trip", "Term ends after 2 more trips or on 12 Mar 2027, whichever
 *  comes first", "Term is up — election due", "No end date (until replaced)". */
export function termEndsWords(seat, committee, opts = {}) {
  if (!seat?.player_id) return '';
  const t = termStatus({ ...committee, started_at: seat.started_at, half_term: seat.half_term }, opts);
  if (t.ended) return committee.fill === 'appointment' ? 'Term is up — due for re-appointment' : 'Term is up — election due';
  const trips = t.tripsLeft != null ? `after ${t.tripsLeft} more trip${t.tripsLeft === 1 ? '' : 's'}` : null;
  const date = t.endsOn ? `on ${fmtDay(t.endsOn)}` : null;
  if (trips && date) return `Term ends ${trips} or ${date}, whichever comes first`;
  if (trips || date) return `Term ends ${trips || date}`;
  return 'No end date (until replaced)';
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "No more than 2 terms in a row" / "No term limit". */
export function termLimitWords(committee) {
  const n = Number(committee?.term_limit);
  if (!n) return 'No term limit';
  return n === 1 ? 'One term at a time — then sit one out' : `No more than ${n} terms in a row`;
}

/** Can this player stand for (or be appointed to) this seat? Same rules as private.stand_problem. Returns why not, or null.
 *  seats: the committee's seats [{ seat_no, player_id, term_no }]; members: [{ player_id, role }]. */
export function standProblem({ committee, seats = [], seatNo, playerId, members = [], name = 'They' }) {
  const m = members.find((x) => x.player_id === playerId);
  if (!m || m.role === 'guest') return 'Pick a player in the group (not a guest)';
  if (seats.some((s) => s.seat_no !== seatNo && s.player_id === playerId && s.seat_no <= committee.seats)) {
    return `${name} already holds a seat on the ${committee.name}`;
  }
  const seat = seats.find((s) => s.seat_no === seatNo);
  const lim = Number(committee.term_limit);
  if (lim && seat?.player_id === playerId && Number(seat.term_no || 0) >= lim) {
    return `${name} has served ${lim} term${lim === 1 ? '' : 's'} in a row on this seat — they can stand again after sitting one out`;
  }
  return null;
}

/** Staggered seats: which seats get a half-length first term (even-numbered). */
export function staggeredHalfSeats(seats) {
  return Array.from({ length: Number(seats) || 0 }, (_, i) => i + 1).filter((n) => n % 2 === 0);
}

// ------------------------------------------------------------------ elections (090)
/** Is this case an election with nominations (not the old yes/no one)? */
export const isContest = (c) => c?.kind === 'election' && c?.proposal?.mode === 'contest';

/** Where an election is: 'nominating' | 'voting' | 'casting' (a tie) | 'organiser' (an organiser picks) | 'done'. */
export function electionStage(c) {
  if (!c || c.status !== 'open') return 'done';
  if (c.stage === 'casting') return 'casting';
  if (c.stage === 'organiser') return 'organiser';
  return c.election_phase === 'nominating' ? 'nominating' : 'voting';
}

/** The count, the same way the database does it: most votes wins; a tie for most → an organiser picks.
 *  nominees: accepted player ids; ballots: [{ voter_id, nominee_id }]; voters: who has a vote.
 *  Returns { results: [{ player_id, votes }] most first, cast, remaining, settled, winner, tied: [ids] }. */
export function electionCount({ nominees = [], ballots = [], voters = [], closed = false }) {
  const ok = new Set(voters);
  const counts = new Map(nominees.map((p) => [p, 0]));
  let cast = 0;
  for (const b of ballots) {
    if (!ok.has(b.voter_id) || !counts.has(b.nominee_id)) continue;
    counts.set(b.nominee_id, counts.get(b.nominee_id) + 1);
    cast += 1;
  }
  const results = [...counts.entries()].map(([player_id, votes]) => ({ player_id, votes }))
    .sort((a, b) => b.votes - a.votes || nominees.indexOf(a.player_id) - nominees.indexOf(b.player_id));
  const remaining = Math.max(0, voters.length - cast);
  const top = results[0]?.votes || 0;
  const second = results[1]?.votes || 0;
  const settled = closed || remaining === 0 || top - second > remaining;
  if (!settled) return { results, cast, remaining, settled, winner: null, tied: [] };
  if (cast === 0) return { results, cast, remaining, settled, winner: null, tied: [] };
  const tied = results.filter((r) => r.votes === top).map((r) => r.player_id);
  return { results, cast, remaining, settled, winner: tied.length === 1 ? tied[0] : null, tied: tied.length > 1 ? tied : [] };
}

/** After nominations close: 'none' (nobody stood), 'unopposed' (one), 'organiser' (an organiser picks) or 'vote'. */
export function afterNominations(acceptedCount, settings = {}) {
  if (!acceptedCount) return 'none';
  if (acceptedCount === 1) return 'unopposed';
  return ['organiser', 'trip_organiser'].includes(settings.decides) ? 'organiser' : 'vote';
}

/** Can this organiser pick the winner? Never someone in the tie, never themselves. */
export function canPickWinner({ role, playerId, stage, tied = [] }) {
  if (role !== 'organiser' || !playerId) return false;
  if (stage === 'casting') return !tied.includes(playerId);
  return stage === 'organiser';
}

// ------------------------------------------------------------------ the summary at the top of Governance
const THINGS = {
  new_rule: 'new rules', change_rule: 'rule changes', scrap_rule: 'scrapping rules', ruling: 'rule challenges',
  handicap: 'handicaps', other: '“anything else” cases', election: 'committee elections', governance: 'changes to how we decide',
};
function whoPhrase(s, committees) {
  switch (s.decides) {
    case 'organiser': case 'trip_organiser': return 'organisers decide';
    case 'organisers_majority': return 'the organisers vote on';
    case 'organisers_all': return 'all organisers must agree on';
    case 'committee': return `the ${committees.find((c) => c.id === s.committee_id)?.name || 'committee'} decides`;
    case 'players_two_thirds': return 'two-thirds of the group must agree on';
    default: return 'the group votes on';
  }
}
const andList = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
/** "How we decide things" in plain words, e.g. ["Organisers decide new rules", "the group votes on handicaps", …].
 *  isOn(kind): whether that kind of case is switched on for the group (default: all). */
export function howWeDecide(settings = {}, committees = [], isOn = () => true) {
  const groups = new Map();
  for (const k of Object.keys(THINGS)) {
    if (!settings[k] || !isOn(k)) continue;
    const who = whoPhrase(settings[k], committees);
    if (!groups.has(who)) groups.set(who, []);
    groups.get(who).push(THINGS[k]);
  }
  return [...groups.entries()].map(([who, things]) => `${who} ${andList(things)}`);
}
/** The same as one sentence: "Organisers decide new rules; the group votes on handicaps." */
export function howWeDecideLine(settings, committees, isOn) {
  const lines = howWeDecide(settings, committees, isOn);
  if (!lines.length) return '';
  const s = lines.join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}
/** What a committee actually decides (from the decision rules), in words: "Decides handicaps and rule changes". */
export function committeeJob(committee, settings = {}) {
  const kinds = Object.keys(THINGS).filter((k) => settings[k]?.decides === 'committee' && settings[k]?.committee_id === committee.id);
  if (kinds.length) return `Decides ${andList(kinds.map((k) => THINGS[k]))}`;
  const meant = (committee.kinds || []).filter((k) => THINGS[k]);
  return meant.length ? `Set up for ${andList(meant.map((k) => THINGS[k]))} — not handling any cases yet (see How we decide)` : 'Not handling any cases yet';
}
export function termLabel({ term_trips, term_years }) {
  const t = term_trips ? `${term_trips} trip${Number(term_trips) === 1 ? '' : 's'}` : null;
  const y = term_years ? `${Number(term_years)} year${Number(term_years) === 1 ? '' : 's'}` : null;
  if (t && y) return `${t} or ${y}, whichever comes first`;
  return t || y || 'until replaced';
}

// ------------------------------------------------------------------ challenges
/** Can this rule be challenged now? One open case per rule; a failed challenge waits for the next trip. */
export function challengeBlock({ ruleId, cases = [], trips = [], today }) {
  if (cases.some((c) => c.rule_id === ruleId && c.status === 'open')) return 'This rule already has an open case.';
  const lastStart = trips.filter((t) => t.start_date && t.start_date <= today).map((t) => t.start_date).sort().pop() || '';
  const failed = cases.find((c) => c.rule_id === ruleId && c.status === 'failed' && ['change_rule', 'scrap_rule', 'ruling'].includes(c.kind)
    && String(c.decided_at || '').slice(0, 10) >= lastStart);
  return failed ? 'A challenge to this rule failed — it can be raised again from the next trip.' : null;
}

// ------------------------------------------------------------------ words
const VOTE_WORDS = {
  default: { for: 'For', against: 'Against', abstain: 'Abstain' },
  other: { for: 'Guilty', against: 'Not guilty', abstain: 'Abstain' },
  election: { for: 'Yes', against: 'No', abstain: 'Abstain' },
};
export function voteWords(kind) { return VOTE_WORDS[kind] || VOTE_WORDS.default; }

/** The verdict in a few words, e.g. "GUILTY" or "Passed". */
export function verdictWord(c) {
  if (c.status === 'open') return 'In session';
  if (c.status === 'withdrawn') return 'Withdrawn';
  const pass = c.status === 'passed';
  if (c.kind === 'other') return pass ? 'GUILTY' : 'NOT GUILTY';
  if (c.kind === 'election') return pass ? 'Elected' : 'Not elected';
  if (c.kind === 'ruling') return pass ? 'Ruled' : 'No ruling';
  return pass ? 'Passed' : 'Failed';
}
/** The share line: "The Tribunal finds Mike GUILTY: crimes against fashion. Penalty: buys the first round." */
export function verdictLine(c, subjectName = '') {
  const w = verdictWord(c);
  if (c.kind === 'other') {
    const who = subjectName || 'the accused';
    return `The Tribunal finds ${who} ${w}${c.title ? `: ${c.title}` : ''}.${c.status === 'passed' && c.penalty ? ` Penalty: ${c.penalty}.` : ''}`;
  }
  return `The Tribunal: ${c.title} — ${w}.`;
}
/** What a share card shows (shareCard.js 'case' kind). Verdict only — never the discussion. */
export function verdictCard(c, subjectName = '', tallyText = '') {
  return {
    eyebrow: 'THE TRIBUNAL',
    big: verdictWord(c).toUpperCase(),
    title: String(c.kind === 'other' ? subjectName || c.title : c.title || '').slice(0, 30),
    line: String(c.kind === 'other' ? (c.title || '') : (c.verdict || KIND[c.kind]?.label || '')).slice(0, 60),
    sub: [c.status === 'passed' && c.penalty ? `Penalty: ${c.penalty}` : '', tallyText ? `Vote ${tallyText}` : ''].filter(Boolean).join(' · ').slice(0, 70),
  };
}

/** "closes in 2 days" / "closes in 5 hours" / "closes in 20 min" / "voting has closed". */
export function closesIn(closesAt, now = new Date()) {
  if (!closesAt) return '';
  const ms = new Date(closesAt) - now;
  if (ms <= 0) return 'voting has closed';
  const h = ms / 3600000;
  if (h >= 36) return `closes in ${Math.round(h / 24)} days`;
  if (h >= 1.5) return `closes in ${Math.round(h)} hours`;
  if (h >= 1) return 'closes in an hour';
  return `closes in ${Math.max(1, Math.round(ms / 60000))} min`;
}

/** One line on how a kind of case is decided, e.g. "Majority of players · at least half must vote · closes after 2 days". */
export function ruleLine(kind, s, committees = []) {
  const who = s.decides === 'committee' ? (committees.find((c) => c.id === s.committee_id)?.name || 'A committee') : DECIDES[s.decides] || s.decides;
  if (kind === 'trip_decision') return `${who} picks the winner of a trip vote`;
  if (kind === 'handicap') {
    const how = s.decides === 'players_majority' ? 'closes once everyone has voted, or the chair closes it' : s.decides === 'committee' ? 'closes once the committee has voted, or the chair closes it' : 'the chair closes it';
    return `${s.decides === 'organiser' ? 'The chair (an organiser) decides' : who} · ${how}`;
  }
  const bits = [who];
  const t = Number(s.min_turnout);
  if (s.decides !== 'organiser' && t > 0) bits.push(t >= 1 ? 'everyone must vote' : `at least ${t === 0.5 ? 'half' : `${Math.round(t * 100)}%`} must vote`);
  if (s.decides !== 'organiser') bits.push(`closes after ${Number(s.close_hours) % 24 === 0 ? `${Number(s.close_hours) / 24} day${Number(s.close_hours) === 24 ? '' : 's'}` : `${s.close_hours} hours`}`);
  if (s.tie_break === 'organiser' && s.decides !== 'organiser') bits.push('ties: an organiser’s casting vote');
  if (TIMED_KINDS.has(kind)) bits.push(EFFECT[s.takes_effect]?.toLowerCase());
  return bits.filter(Boolean).join(' · ');
}

/** What a passed case is waiting for, in words. */
export function applyWords(c, nextTripName = 'the next trip') {
  if (c.status !== 'passed' || !TIMED_KINDS.has(c.kind)) return '';
  if (c.apply_state === 'waiting_next_trip') return `Changes from ${nextTripName}`;
  if (c.apply_state === 'next_round') return 'Approved mid-trip: starts from the next round';
  if (c.apply_state === 'applied') return c.approved_at ? 'In force (approved mid-trip)' : 'In force';
  return '';
}
