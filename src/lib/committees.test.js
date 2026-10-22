// Committees, terms and elections (090) and the "How we decide things" summary. Same rules as the database
// (private.seat_term_ended, private.stand_problem, private.election_evaluate) — supabase/tests/090_committees_elections.sql
// checks the same cases on staging.
import { describe, it, expect } from 'vitest';
import {
  presetSettings, effectiveSettings, termStatus, termEndsWords, termLimitWords, standProblem, staggeredHalfSeats,
  isContest, electionStage, electionCount, afterNominations, canPickWinner, howWeDecide, howWeDecideLine, committeeJob, KINDS,
} from './governance.js';

const all = (preset) => Object.fromEntries(KINDS.map((k) => [k.key, presetSettings(preset, k.key)]));

describe('How we decide things (plain words)', () => {
  it('L.G.C as today: organisers decide rules, the group votes on handicaps', () => {
    const line = howWeDecideLine(effectiveSettings([]), []);
    expect(line).toBe('Organisers decide new rules, rule changes, scrapping rules, rule challenges and changes to how we decide; the group votes on handicaps, “anything else” cases and committee elections.');
  });
  it('Club style names the committees', () => {
    const s = all('club');
    s.handicap.committee_id = 'hc'; s.new_rule.committee_id = 'rc'; s.change_rule.committee_id = 'rc'; s.scrap_rule.committee_id = 'rc'; s.ruling.committee_id = 'rc';
    const lines = howWeDecide(s, [{ id: 'hc', name: 'Handicap Committee' }, { id: 'rc', name: 'Rules Committee' }]);
    expect(lines).toContain('the Rules Committee decides new rules, rule changes, scrapping rules and rule challenges');
    expect(lines).toContain('the Handicap Committee decides handicaps');
    expect(lines).toContain('two-thirds of the group must agree on changes to how we decide');
  });
  it('leaves out kinds that are switched off', () => {
    const lines = howWeDecide(all('majority'), [], (k) => k !== 'other' && k !== 'election');
    expect(lines.join(' ')).not.toMatch(/anything else|committee elections/);
  });
  it('nothing switched on: empty', () => {
    expect(howWeDecideLine(all('lgc'), [], () => false)).toBe('');
  });
  it('a committee’s job comes from the decision rules, not just its label', () => {
    const s = all('club'); s.handicap.committee_id = 'hc';
    expect(committeeJob({ id: 'hc', kinds: ['handicap'] }, s)).toBe('Decides handicaps');
    expect(committeeJob({ id: 'x', kinds: ['ruling'] }, all('lgc'))).toMatch(/^Set up for rule challenges — not handling any cases yet/);
    expect(committeeJob({ id: 'x', kinds: [] }, all('lgc'))).toBe('Not handling any cases yet');
  });
});

describe('terms', () => {
  const trips = [{ start_date: '2026-03-05' }, { start_date: '2026-09-10' }, { start_date: '2027-03-04' }];
  it('a staggered seat’s first term is half length (trips)', () => {
    const at = { now: new Date('2026-04-01T00:00:00Z'), today: '2026-04-01', trips };
    expect(termStatus({ started_at: '2026-01-01T00:00:00Z', term_trips: 2 }, at)).toMatchObject({ ended: false, tripsLeft: 1 });
    expect(termStatus({ started_at: '2026-01-01T00:00:00Z', term_trips: 2, half_term: true }, at)).toMatchObject({ ended: true, by: 'trips' });
  });
  it('a staggered seat’s first term is half length (years) — like the staging test: 7 months into a 1-year term', () => {
    const now = new Date('2026-08-02T00:00:00Z');
    expect(termStatus({ started_at: '2026-01-01T00:00:00Z', term_years: 1 }, { now, trips: [] }).ended).toBe(false);
    expect(termStatus({ started_at: '2026-01-01T00:00:00Z', term_years: 1, half_term: true }, { now, trips: [] })).toMatchObject({ ended: true, endsOn: '2026-07-01' });
  });
  it('half of a 1-trip term is still one trip', () => {
    expect(termStatus({ started_at: '2026-01-01T00:00:00Z', term_trips: 1, half_term: true }, { now: new Date('2026-02-01T00:00:00Z'), today: '2026-02-01', trips }).tripsLeft).toBe(1);
  });
  it('even seats are the staggered ones', () => {
    expect(staggeredHalfSeats(5)).toEqual([2, 4]);
    expect(staggeredHalfSeats(1)).toEqual([]);
  });
  it('term end in words', () => {
    const com = { term_trips: 2, term_years: 1, fill: 'election' };
    const seat = { player_id: 'p', started_at: '2026-01-01T00:00:00Z' };
    const opts = { now: new Date('2026-04-01T00:00:00Z'), today: '2026-04-01', trips };
    expect(termEndsWords(seat, com, opts)).toBe('Term ends after 1 more trip or on 1 Jan 2027, whichever comes first');
    expect(termEndsWords(seat, { term_trips: 2, fill: 'election' }, opts)).toBe('Term ends after 1 more trip');
    expect(termEndsWords(seat, { term_years: 1, fill: 'election' }, opts)).toBe('Term ends on 1 Jan 2027');
    expect(termEndsWords(seat, { fill: 'election' }, opts)).toBe('No end date (until replaced)');
    expect(termEndsWords(seat, { term_trips: 1, fill: 'election' }, opts)).toBe('Term is up — election due');
    expect(termEndsWords(seat, { term_trips: 1, fill: 'appointment' }, opts)).toBe('Term is up — due for re-appointment');
    expect(termEndsWords({ player_id: null }, com, opts)).toBe('');
  });
  it('term limit in words', () => {
    expect(termLimitWords({ term_limit: null })).toBe('No term limit');
    expect(termLimitWords({ term_limit: 1 })).toBe('One term at a time — then sit one out');
    expect(termLimitWords({ term_limit: 3 })).toBe('No more than 3 terms in a row');
  });
});

describe('who can stand', () => {
  const committee = { name: 'Rules Committee', seats: 2, term_limit: 2 };
  const members = [{ player_id: 'a', role: 'player' }, { player_id: 'b', role: 'organiser' }, { player_id: 'g', role: 'guest' }];
  it('guests and strangers can’t', () => {
    expect(standProblem({ committee, seats: [], seatNo: 1, playerId: 'g', members })).toMatch(/not a guest/);
    expect(standProblem({ committee, seats: [], seatNo: 1, playerId: 'zz', members })).toMatch(/not a guest/);
  });
  it('one seat per person per committee', () => {
    const seats = [{ seat_no: 2, player_id: 'a', term_no: 1 }];
    expect(standProblem({ committee, seats, seatNo: 1, playerId: 'a', members, name: 'Al' })).toBe('Al already holds a seat on the Rules Committee');
  });
  it('term limit: at the limit on this seat → sit one out; under it → fine', () => {
    expect(standProblem({ committee, seats: [{ seat_no: 1, player_id: 'a', term_no: 2 }], seatNo: 1, playerId: 'a', members, name: 'Al' }))
      .toBe('Al has served 2 terms in a row on this seat — they can stand again after sitting one out');
    expect(standProblem({ committee, seats: [{ seat_no: 1, player_id: 'a', term_no: 1 }], seatNo: 1, playerId: 'a', members })).toBeNull();
    // Someone else held it since (the sit-out): fine again.
    expect(standProblem({ committee, seats: [{ seat_no: 1, player_id: 'b', term_no: 1 }], seatNo: 1, playerId: 'a', members })).toBeNull();
    expect(standProblem({ committee: { ...committee, term_limit: null }, seats: [{ seat_no: 1, player_id: 'a', term_no: 9 }], seatNo: 1, playerId: 'a', members })).toBeNull();
  });
});

describe('elections', () => {
  it('knows an election with nominations from the old yes/no one', () => {
    expect(isContest({ kind: 'election', proposal: { mode: 'contest' } })).toBe(true);
    expect(isContest({ kind: 'election', proposal: { candidate: 'x' } })).toBe(false);
    expect(isContest({ kind: 'other', proposal: { mode: 'contest' } })).toBe(false);
  });
  it('stages', () => {
    expect(electionStage({ status: 'open', stage: 'voting', election_phase: 'nominating' })).toBe('nominating');
    expect(electionStage({ status: 'open', stage: 'voting', election_phase: 'voting' })).toBe('voting');
    expect(electionStage({ status: 'open', stage: 'casting' })).toBe('casting');
    expect(electionStage({ status: 'open', stage: 'organiser' })).toBe('organiser');
    expect(electionStage({ status: 'passed' })).toBe('done');
  });
  it('after nominations: nobody, unopposed, organiser picks, or a vote', () => {
    expect(afterNominations(0, { decides: 'players_majority' })).toBe('none');
    expect(afterNominations(1, { decides: 'players_majority' })).toBe('unopposed');
    expect(afterNominations(2, { decides: 'organiser' })).toBe('organiser');
    expect(afterNominations(3, { decides: 'players_majority' })).toBe('vote');
  });
  const voters = ['o', 'a', 'b', 'c'];
  const ballot = (list) => list.map(([voter_id, nominee_id]) => ({ voter_id, nominee_id }));
  it('settles early once nobody can catch the leader (3–0 with one to vote)', () => {
    const r = electionCount({ nominees: ['a', 'b'], voters, ballots: ballot([['a', 'a'], ['b', 'a'], ['c', 'a']]) });
    expect(r).toMatchObject({ settled: true, winner: 'a', cast: 3, remaining: 1 });
  });
  it('stays open while it can still change (2–1 with one to vote)', () => {
    const r = electionCount({ nominees: ['a', 'b'], voters, ballots: ballot([['a', 'a'], ['b', 'a'], ['c', 'b']]) });
    expect(r).toMatchObject({ settled: false, winner: null });
  });
  it('most votes wins with three candidates (a plurality)', () => {
    const r = electionCount({ nominees: ['a', 'b', 'c'], voters: [...voters, 'd', 'e'], closed: true,
      ballots: ballot([['o', 'a'], ['a', 'a'], ['b', 'b'], ['c', 'c'], ['d', 'a']]) });
    expect(r.winner).toBe('a');
    expect(r.results.map((x) => x.votes)).toEqual([3, 1, 1]);
  });
  it('a tie for most votes goes to an organiser who isn’t in it', () => {
    const r = electionCount({ nominees: ['o', 'c'], voters, ballots: ballot([['o', 'o'], ['a', 'c'], ['b', 'o'], ['c', 'c']]) });
    expect(r).toMatchObject({ settled: true, winner: null, tied: ['o', 'c'] });
    expect(canPickWinner({ role: 'organiser', playerId: 'o', stage: 'casting', tied: r.tied })).toBe(false);
    expect(canPickWinner({ role: 'organiser', playerId: 'a', stage: 'casting', tied: r.tied })).toBe(true);
    expect(canPickWinner({ role: 'player', playerId: 'b', stage: 'casting', tied: r.tied })).toBe(false);
  });
  it('only votes from people with a vote, for real candidates, count', () => {
    const r = electionCount({ nominees: ['a', 'b'], voters: ['a', 'b'], closed: true, ballots: ballot([['g', 'b'], ['a', 'zz'], ['b', 'a']]) });
    expect(r).toMatchObject({ cast: 1, winner: 'a' });
  });
  it('nobody voted: nobody elected', () => {
    expect(electionCount({ nominees: ['a', 'b'], voters, closed: true, ballots: [] })).toMatchObject({ settled: true, winner: null, tied: [] });
  });
});
