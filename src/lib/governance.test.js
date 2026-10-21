import { describe, it, expect } from 'vitest';
import {
  KINDS, PRESETS, presetSettings, effectiveSettings, settingsProblems, decidesFor, electorate, tally, evaluate,
  canRaise, canVote, canDecide, tripInProgress, whenItApplies, isDue, canApproveMidTrip, tripsSince, termStatus,
  termLabel, challengeBlock, verdictWord, verdictLine, verdictCard, voteWords,
} from './governance.js';

const S = (o = {}) => ({ ...presetSettings('majority', 'other'), min_turnout: 0, ...o });
const members = [
  { player_id: 'o1', role: 'organiser' }, { player_id: 'o2', role: 'organiser' },
  { player_id: 'p1', role: 'player' }, { player_id: 'p2', role: 'player' }, { player_id: 'p3', role: 'player' },
  { player_id: 'g1', role: 'guest' }, { player_id: null, role: 'player' },
];
const v = (list) => list.map(([player_id, vote]) => ({ player_id, vote }));

describe('presets', () => {
  it('every preset covers every kind with a valid choice', () => {
    for (const p of Object.keys(PRESETS)) {
      for (const k of KINDS) {
        const s = presetSettings(p, k.key);
        expect(decidesFor(k.key)).toContain(s.decides);
      }
    }
  });
  it('L.G.C is today: lads vote on handicaps, organisers decide rules, straight away', () => {
    expect(presetSettings('lgc', 'handicap').decides).toBe('players_majority');
    expect(presetSettings('lgc', 'new_rule')).toMatchObject({ decides: 'organiser', takes_effect: 'now' });
    expect(presetSettings('lgc', 'governance').decides).toBe('organiser');
  });
  it('Majority rules: players decide rules with half voting; organisers handle trips', () => {
    expect(presetSettings('majority', 'change_rule')).toMatchObject({ decides: 'players_majority', min_turnout: 0.5, takes_effect: 'next_trip' });
    expect(presetSettings('majority', 'trip_decision').decides).toBe('organiser');
  });
  it('Club style uses committees for handicaps and rules, two-thirds for governance', () => {
    expect(presetSettings('club', 'handicap').decides).toBe('committee');
    expect(presetSettings('club', 'ruling').decides).toBe('committee');
    expect(presetSettings('club', 'governance').decides).toBe('players_two_thirds');
  });
  it('an unknown preset is today’s behaviour', () => {
    expect(presetSettings('nope', 'new_rule')).toEqual(presetSettings('lgc', 'new_rule'));
  });
});

describe('effective settings', () => {
  it('no rows = L.G.C; rows override; trip decisions follow vote_decider', () => {
    const e = effectiveSettings([{ kind: 'other', decides: 'players_two_thirds', min_turnout: '0.5' }], { voteDecider: 'admin_or_organiser' });
    expect(e.new_rule.decides).toBe('organiser');
    expect(e.other).toMatchObject({ decides: 'players_two_thirds', min_turnout: 0.5 });
    expect(e.trip_decision.decides).toBe('trip_organiser');
    expect(effectiveSettings([], { preset: 'majority' }).other.decides).toBe('players_majority');
    expect(effectiveSettings([], {}).trip_decision.decides).toBe('organiser');
  });
});

describe('settings that could never pass are refused', () => {
  it('a committee needs to exist and have seats', () => {
    expect(settingsProblems('other', S({ decides: 'committee', committee_id: 'c1' }), { committees: [] })).toHaveLength(1);
    expect(settingsProblems('other', S({ decides: 'committee', committee_id: 'c1' }), { committees: [{ id: 'c1', seats: 0 }] })).toHaveLength(1);
    expect(settingsProblems('other', S({ decides: 'committee', committee_id: 'c1' }), { committees: [{ id: 'c1', seats: 3 }] })).toEqual([]);
  });
  it('bad numbers and choices', () => {
    expect(settingsProblems('other', S({ close_hours: 0 }))).toHaveLength(1);
    expect(settingsProblems('other', S({ min_turnout: 1.5 }))).toHaveLength(1);
    expect(settingsProblems('trip_decision', S({ decides: 'players_majority' }))).toHaveLength(1);
    expect(settingsProblems('handicap', S({ decides: 'players_two_thirds' }))).toHaveLength(1);
    expect(settingsProblems('other', S({ takes_effect: 'whenever' }))).toHaveLength(1);
  });
});

describe('who votes', () => {
  it('players: no guests, no one without a profile, not the person it’s about (default)', () => {
    expect(electorate({ settings: S(), members, subjectId: 'p1' }).voters).toEqual(['o1', 'o2', 'p2', 'p3']);
  });
  it('the person it’s about can vote when the group says so', () => {
    expect(electorate({ settings: S({ subject_votes: true }), members, subjectId: 'p1' }).voters).toContain('p1');
  });
  it('organisers only; never on a case about themselves', () => {
    expect(electorate({ settings: S({ decides: 'organisers_majority', subject_votes: true }), members, subjectId: 'o1' }).voters).toEqual(['o2']);
  });
  it('a committee: its seat holders, minus a conflict of interest, minus anyone who has left', () => {
    const e = electorate({ settings: S({ decides: 'committee' }), members, seats: ['p1', 'p2', 'gone', null], subjectId: 'p2' });
    expect(e).toEqual({ mode: 'votes', voters: ['p1'] });
  });
  it('organiser-decided cases: a show of hands from the players', () => {
    expect(electorate({ settings: S({ decides: 'organiser' }), members }).mode).toBe('organiser');
    expect(electorate({ settings: S({ decides: 'committee' }), members, fallback: true }).mode).toBe('organiser');
  });
  it('tally only counts the electorate', () => {
    expect(tally(v([['p1', 'for'], ['p2', 'against'], ['g1', 'for'], ['p3', 'abstain']]), ['p1', 'p2', 'p3'])).toEqual({ for: 1, against: 1, abstain: 1, cast: 3 });
  });
});

describe('decision rules', () => {
  const five = ['a', 'b', 'c', 'd', 'e'];
  it('majority: settles early once it can’t change', () => {
    expect(evaluate({ settings: S(), voters: five, votes: v([['a', 'for'], ['b', 'for'], ['c', 'for']]) }).state).toBe('passed');
    expect(evaluate({ settings: S(), voters: five, votes: v([['a', 'for'], ['b', 'for']]) }).state).toBe('open');
    expect(evaluate({ settings: S(), voters: five, votes: v([['a', 'against'], ['b', 'against'], ['c', 'against']]) }).state).toBe('failed');
  });
  it('majority at close: more for than against passes; abstentions don’t count either way', () => {
    expect(evaluate({ settings: S(), voters: five, votes: v([['a', 'for'], ['b', 'abstain']]), closed: true }).state).toBe('passed');
    expect(evaluate({ settings: S(), voters: five, votes: v([['a', 'for'], ['b', 'against'], ['c', 'against']]), closed: true }).state).toBe('failed');
  });
  it('ties: stays as it is by default; or an organiser gets the casting vote', () => {
    const votes = v([['a', 'for'], ['b', 'against']]);
    expect(evaluate({ settings: S(), voters: five, votes, closed: true })).toMatchObject({ state: 'failed' });
    expect(evaluate({ settings: S({ tie_break: 'organiser' }), voters: five, votes, closed: true }).state).toBe('casting');
    // Early: a worst-case tie is a sure fail only without a casting vote.
    const early = v([['a', 'against'], ['b', 'against'], ['c', 'for']]);
    expect(evaluate({ settings: S(), voters: ['a', 'b', 'c', 'd'], votes: early }).state).toBe('failed');
    expect(evaluate({ settings: S({ tie_break: 'organiser' }), voters: ['a', 'b', 'c', 'd'], votes: early }).state).toBe('open');
  });
  it('everyone voted = closed', () => {
    expect(evaluate({ settings: S(), voters: ['a', 'b'], votes: v([['a', 'for'], ['b', 'against']]) }).state).toBe('failed');
  });
  it('turnout: missed by close = stays as it is; met = counts', () => {
    const s = S({ min_turnout: 0.5 });
    expect(evaluate({ settings: s, voters: five, votes: v([['a', 'for'], ['b', 'for']]), closed: true })).toMatchObject({ state: 'failed', reason: expect.stringMatching(/Not enough/) });
    expect(evaluate({ settings: s, voters: five, votes: v([['a', 'for'], ['b', 'for'], ['c', 'abstain']]), closed: true }).state).toBe('passed');
    // An early pass waits for the turnout too.
    expect(evaluate({ settings: S({ min_turnout: 1 }), voters: ['a', 'b', 'c'], votes: v([['a', 'for'], ['b', 'for']]) }).state).toBe('open');
  });
  it('two-thirds', () => {
    const s = S({ decides: 'players_two_thirds' });
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(evaluate({ settings: s, voters: six, votes: v([['a', 'for'], ['b', 'for'], ['c', 'for'], ['d', 'for']]) }).state).toBe('passed');
    expect(evaluate({ settings: s, voters: six, votes: v([['a', 'for'], ['b', 'for'], ['c', 'for']]) }).state).toBe('open');
    expect(evaluate({ settings: s, voters: six, votes: v([['a', 'against'], ['b', 'against'], ['c', 'against']]) }).state).toBe('failed');
    expect(evaluate({ settings: s, voters: six, votes: v([['a', 'for'], ['b', 'for'], ['c', 'against']]), closed: true }).state).toBe('passed');
    expect(evaluate({ settings: s, voters: six, votes: v([['a', 'for'], ['b', 'against']]), closed: true }).state).toBe('failed');
    expect(evaluate({ settings: s, voters: six, votes: [], closed: true }).state).toBe('failed');
  });
  it('all organisers: one no (or abstain) fails it; everyone yes passes', () => {
    const s = S({ decides: 'organisers_all' });
    expect(evaluate({ settings: s, voters: ['o1', 'o2'], votes: v([['o1', 'for']]) }).state).toBe('open');
    expect(evaluate({ settings: s, voters: ['o1', 'o2'], votes: v([['o1', 'for'], ['o2', 'for']]) }).state).toBe('passed');
    expect(evaluate({ settings: s, voters: ['o1', 'o2'], votes: v([['o1', 'for'], ['o2', 'abstain']]) }).state).toBe('failed');
    expect(evaluate({ settings: s, voters: ['o1', 'o2'], votes: v([['o1', 'for']]), closed: true }).state).toBe('failed');
  });
  it('majority of organisers', () => {
    const s = S({ decides: 'organisers_majority' });
    expect(evaluate({ settings: s, voters: ['o1', 'o2', 'o3'], votes: v([['o1', 'for'], ['o2', 'for']]) }).state).toBe('passed');
  });
  it('organiser decides: waits for an organiser', () => {
    expect(evaluate({ settings: S({ decides: 'organiser' }), voters: five, votes: v([['a', 'for']]), closed: true }).state).toBe('organiser');
  });
  it('committee fallback: no members left, or turnout missed, goes to the organisers', () => {
    const s = S({ decides: 'committee', min_turnout: 0.5 });
    expect(evaluate({ settings: s, voters: [], votes: [] }).state).toBe('fallback');
    expect(evaluate({ settings: s, voters: ['a', 'b', 'c'], votes: v([['a', 'for']]), closed: true }).state).toBe('fallback');
    expect(evaluate({ settings: s, voters: ['a', 'b', 'c'], votes: v([['a', 'for'], ['b', 'for']]) }).state).toBe('passed');
    expect(evaluate({ settings: s, voters: ['a'], votes: [], fallback: true }).state).toBe('organiser');
  });
});

describe('who can do what', () => {
  it('raising: guests never; organisers-only kinds', () => {
    expect(canRaise({ role: 'guest', settings: S() })).toBe(false);
    expect(canRaise({ role: 'player', settings: S() })).toBe(true);
    expect(canRaise({ role: 'player', settings: S({ raise_by: 'organisers' }) })).toBe(false);
    expect(canRaise({ role: 'organiser', settings: S({ raise_by: 'organisers' }) })).toBe(true);
  });
  it('voting: in the electorate, not a guest', () => {
    expect(canVote({ playerId: 'p1', role: 'player', voters: ['p1'] })).toBe(true);
    expect(canVote({ playerId: 'p1', role: 'guest', voters: ['p1'] })).toBe(false);
    expect(canVote({ playerId: 'p9', role: 'player', voters: ['p1'] })).toBe(false);
  });
  it('deciding: an organiser, not about themselves, when it’s theirs to decide', () => {
    expect(canDecide({ role: 'organiser', playerId: 'o1', subjectId: 'p1', state: 'organiser' })).toBe(true);
    expect(canDecide({ role: 'organiser', playerId: 'o1', subjectId: 'o1', state: 'organiser' })).toBe(false);
    expect(canDecide({ role: 'organiser', playerId: 'o1', state: 'open' })).toBe(false);
    expect(canDecide({ role: 'player', playerId: 'p1', state: 'casting' })).toBe(false);
  });
});

describe('when changes take effect', () => {
  const trips = [
    { id: 't1', start_date: '2026-03-06', end_date: '2026-03-09', status: 'locked' },
    { id: 't2', start_date: '2026-10-20', end_date: '2026-10-23', status: 'active' },
    { id: 't3', start_date: '2027-03-05', end_date: '2027-03-08', status: 'active' },
  ];
  it('finds the trip under way', () => {
    expect(tripInProgress({ trips, rounds: [], today: '2026-10-21' })).toBe('t2');
    expect(tripInProgress({ trips, rounds: [], today: '2026-11-01' })).toBe(null);
    expect(tripInProgress({ trips, rounds: [{ status: 'live', trip_id: 't3' }], today: '2026-11-01' })).toBe('t3');
  });
  it('rule and governance changes wait for the next trip during a trip; apply now between trips', () => {
    const s = presetSettings('majority', 'change_rule');
    expect(whenItApplies({ kind: 'change_rule', settings: s, tripId: 't2' })).toBe('next_trip');
    expect(whenItApplies({ kind: 'governance', settings: s, tripId: null })).toBe('now');
    expect(whenItApplies({ kind: 'other', settings: s, tripId: 't2' })).toBe('now');
    expect(whenItApplies({ kind: 'ruling', settings: s, tripId: 't2' })).toBe('now');
    expect(whenItApplies({ kind: 'new_rule', settings: presetSettings('lgc', 'new_rule'), tripId: 't2' })).toBe('now');
  });
  it('mid-trip approval: only when the group allows it; starts from the next round, never a round in play', () => {
    const s = { ...presetSettings('majority', 'change_rule'), takes_effect: 'mid_trip_approval' };
    expect(whenItApplies({ kind: 'change_rule', settings: s, tripId: 't2', approved: true, liveRound: true })).toBe('next_round');
    expect(whenItApplies({ kind: 'change_rule', settings: s, tripId: 't2', approved: true, liveRound: false })).toBe('now');
    expect(whenItApplies({ kind: 'change_rule', settings: presetSettings('majority', 'change_rule'), tripId: 't2', approved: true })).toBe('next_trip');
    expect(canApproveMidTrip({ role: 'organiser', waiting: 'next_trip', settings: s })).toBe(true);
    expect(canApproveMidTrip({ role: 'player', waiting: 'next_trip', settings: s })).toBe(false);
    expect(canApproveMidTrip({ role: 'organiser', waiting: 'next_trip', settings: presetSettings('majority', 'change_rule') })).toBe(false);
  });
  it('a waiting change is due at the next trip’s start, or (approved) once no round is in play', () => {
    expect(isDue({ waiting: 'next_trip', decidedInTrip: 't2', tripId: 't2' })).toBe(false);
    expect(isDue({ waiting: 'next_trip', decidedInTrip: 't2', tripId: null })).toBe(true);
    expect(isDue({ waiting: 'next_trip', decidedInTrip: 't2', tripId: 't3' })).toBe(true);
    expect(isDue({ waiting: 'next_trip', decidedInTrip: 't2', startingRoundTrip: 't2' })).toBe(false);
    expect(isDue({ waiting: 'next_trip', decidedInTrip: 't2', startingRoundTrip: 't3' })).toBe(true);
    expect(isDue({ waiting: 'next_round', liveRound: true })).toBe(false);
    expect(isDue({ waiting: 'next_round', liveRound: false })).toBe(true);
  });
});

describe('terms', () => {
  const trips = [{ start_date: '2026-03-06' }, { start_date: '2026-10-20' }, { start_date: '2027-03-05' }, { start_date: '2027-10-01' }];
  it('counts trips started since the seat was filled', () => {
    expect(tripsSince(trips, '2026-01-01T00:00:00Z', '2026-12-01')).toBe(2);
    expect(tripsSince(trips, '2026-03-06T00:00:00Z', '2027-03-05')).toBe(2);
  });
  it('by trips', () => {
    const s = termStatus({ started_at: '2026-01-01T00:00:00Z', term_trips: 2 }, { trips, now: new Date('2026-12-01T00:00:00Z'), today: '2026-12-01' });
    expect(s).toMatchObject({ ended: true, by: 'trips', tripsDone: 2 });
    expect(termStatus({ started_at: '2026-01-01T00:00:00Z', term_trips: 2 }, { trips, now: new Date('2026-04-01T00:00:00Z'), today: '2026-04-01' })).toMatchObject({ ended: false, soon: true });
  });
  it('by years', () => {
    expect(termStatus({ started_at: '2025-06-01T00:00:00Z', term_years: 1 }, { trips: [], now: new Date('2026-06-02T00:00:00Z') })).toMatchObject({ ended: true, by: 'years', endsOn: '2026-06-01' });
    expect(termStatus({ started_at: '2025-06-01T00:00:00Z', term_years: 1 }, { trips: [], now: new Date('2026-05-25T00:00:00Z') })).toMatchObject({ ended: false, soon: true });
  });
  it('whichever comes first', () => {
    const seat = { started_at: '2026-01-01T00:00:00Z', term_trips: 3, term_years: 1 };
    expect(termStatus(seat, { trips, now: new Date('2027-01-02T00:00:00Z'), today: '2027-01-02' })).toMatchObject({ ended: true, by: 'years' });
    const seat2 = { started_at: '2026-01-01T00:00:00Z', term_trips: 1, term_years: 2 };
    expect(termStatus(seat2, { trips, now: new Date('2026-03-07T00:00:00Z'), today: '2026-03-07' })).toMatchObject({ ended: true, by: 'trips' });
  });
  it('until replaced, and an empty seat, never end', () => {
    expect(termStatus({ started_at: '2020-01-01T00:00:00Z' }, { trips }).ended).toBe(false);
    expect(termStatus({ started_at: null, term_years: 1 }, { trips }).ended).toBe(false);
  });
  it('labels', () => {
    expect(termLabel({ term_trips: 2, term_years: 1 })).toBe('2 trips or 1 year, whichever comes first');
    expect(termLabel({})).toBe('until replaced');
  });
});

describe('challenges', () => {
  const trips = [{ start_date: '2026-03-06' }, { start_date: '2026-10-20' }];
  it('one open case per rule', () => {
    expect(challengeBlock({ ruleId: 'r1', cases: [{ rule_id: 'r1', status: 'open', kind: 'ruling' }], trips, today: '2026-10-21' })).toMatch(/open case/);
  });
  it('a failed challenge waits for the next trip', () => {
    const cases = [{ rule_id: 'r1', status: 'failed', kind: 'change_rule', decided_at: '2026-10-21T02:00:00Z' }];
    expect(challengeBlock({ ruleId: 'r1', cases, trips, today: '2026-10-22' })).toMatch(/next trip/);
    expect(challengeBlock({ ruleId: 'r1', cases, trips: [...trips, { start_date: '2027-03-05' }], today: '2027-03-05' })).toBe(null);
    expect(challengeBlock({ ruleId: 'r2', cases, trips, today: '2026-10-22' })).toBe(null);
  });
});

describe('words', () => {
  it('verdicts and share lines', () => {
    const c = { kind: 'other', status: 'passed', title: 'Crimes against fashion', penalty: 'buys the first round' };
    expect(verdictWord(c)).toBe('GUILTY');
    expect(verdictLine(c, 'Mike')).toBe('The Tribunal finds Mike GUILTY: Crimes against fashion. Penalty: buys the first round.');
    expect(verdictLine({ ...c, status: 'failed' }, 'Mike')).toBe('The Tribunal finds Mike NOT GUILTY: Crimes against fashion.');
    expect(verdictWord({ kind: 'change_rule', status: 'failed' })).toBe('Failed');
    expect(verdictCard(c, 'Mike', '4–1')).toMatchObject({ big: 'GUILTY', title: 'Mike', sub: 'Penalty: buys the first round · Vote 4–1' });
    expect(voteWords('other').for).toBe('Guilty');
  });
});
