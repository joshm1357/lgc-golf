import { describe, it, expect } from 'vitest';
import {
  yourRound, offLine, matchLine, drawOutMessage, teeTomorrowMessage, teeWhen, dayAndTime,
  peopleStatus, drawNudge, calledTeeTime, roundsNeedingGroups, flagMark,
} from './yourround.js';

const names = { me: 'Mike', bo: 'Bo', kurt: 'Kurt', al: 'Al', cy: 'Cy', di: 'Di', ed: 'Ed', fin: 'Fin' };
const nameOf = (id) => names[id] || id;
const sides = [{ id: 'blue', name: 'Team Blue', colour: '#1F4B9E', sort: 1 }, { id: 'red', name: 'Team Red', colour: '#B3261E', sort: 2 }];

describe('yourRound — a Cup match', () => {
  const round = { id: 'r1', name: 'Saturday', format: 'stableford', play_date: '2026-10-22' };
  const matches = [
    { id: 'm1', round_id: 'r1', a_players: ['kurt', 'al'], b_players: ['me', 'bo'], tee_time: '07:00', start_hole: null },
    { id: 'm2', round_id: 'r1', a_players: ['cy', 'ed'], b_players: ['di', 'fin'], tee_time: '07:08' },
  ];
  const y = yourRound({ round, me: 'me', matches, sides });
  it('your team, partner and opponents', () => {
    expect(y.kind).toBe('cup');
    expect(y.team).toEqual({ id: 'red', name: 'Team Red', colour: '#B3261E' });
    expect(y.partners).toEqual(['bo']);
    expect(y.opponents).toEqual(['kurt', 'al']);
    expect(y.opposingTeams[0].name).toBe('Team Blue');
    expect(y.match.id).toBe('m1');
  });
  it('the match is your group when there are no tee groups; its tee time counts', () => {
    expect(y.group).toEqual(['bo', 'kurt', 'al']);
    expect(y.tee).toEqual({ time: '07:00', hole: null });
    expect(teeWhen(y)).toBe('7:00, hole 1');
    expect(offLine(y, nameOf)).toBe('You’re off 7:00, hole 1, with Bo, Kurt and Al');
    expect(matchLine(y, nameOf)).toBe('You & Bo v Kurt & Al');
  });
  it('the draw-out line (I8)', () => {
    expect(dayAndTime(round, y)).toBe('Thu 7:00am');
    expect(drawOutMessage({ roundName: 'Saturday', round, y, nameOf })).toEqual({ title: '📣 The draw is out — Saturday', body: 'You & Bo v Kurt & Al, Thu 7:00am' });
  });
});

describe('yourRound — Ambrose teams, 4BBB pairs and plain groups', () => {
  const teams = [
    { id: 't1', name: 'Team 1', players: [{ id: 'me' }, { id: 'bo' }] },
    { id: 't2', name: 'Team 2', players: [{ id: 'cy' }, { id: 'di' }] },
    { id: 't3', name: 'Team 3', players: [{ id: 'ed' }, { id: 'fin' }] },
  ];
  it('Ambrose: your team, teammates and the teams in your group as the opposition', () => {
    const teeRows = [{ group_no: 1, tee_time: '08:16', start_hole: null, player_ids: ['me', 'bo', 'cy', 'di'] }];
    const y = yourRound({ round: { id: 'r', format: 'ambrose' }, me: 'me', teams, teeRows });
    expect(y.kind).toBe('ambrose');
    expect(y.team.name).toBe('Team 1');
    expect(y.partners).toEqual(['bo']);
    expect(y.opposingTeams.map((t) => t.name)).toEqual(['Team 2']);
    expect(y.group).toEqual(['bo', 'cy', 'di']);
    expect(offLine(y, nameOf)).toBe('You’re off 8:16, hole 1, with Bo, Cy and Di');
    expect(matchLine(y, nameOf)).toBe('Team 1 with Bo');
  });
  it('no tee groups: every other team is the opposition', () => {
    const y = yourRound({ round: { id: 'r', format: 'fourball' }, me: 'me', teams });
    expect(y.kind).toBe('fourball');
    expect(y.opposingTeams.map((t) => t.name)).toEqual(['Team 2', 'Team 3']);
    expect(y.tee).toBeNull();
  });
  it('Stableford with a shotgun group', () => {
    const teeRows = [{ group_no: 3, tee_time: '08:00', start_hole: 5, player_ids: ['bo', 'me'] }];
    const y = yourRound({ round: { id: 'r', format: 'stableford' }, me: 'me', teams, teeRows });
    expect(y.kind).toBe('group');
    expect(y.team).toBeNull(); // Ambrose teams don't count on a Stableford day
    expect(offLine(y, nameOf)).toBe('You’re off 8:00, hole 5, with Bo');
  });
  it('a group with no time yet', () => {
    const y = yourRound({ round: { id: 'r', format: 'stableford' }, me: 'me', teeRows: [{ group_no: 2, player_ids: ['me', 'cy'] }] });
    expect(offLine(y, nameOf)).toBe('Group 2 with Cy');
  });
  it('nothing set → null (the card shows nothing)', () => {
    expect(yourRound({ round: { id: 'r', format: 'stableford' }, me: 'me' })).toBeNull();
    expect(yourRound({ round: null, me: 'me' })).toBeNull();
    expect(yourRound({ round: { id: 'r' }, me: null })).toBeNull();
  });
});

describe('the night-before buzz (I11) — only when a time or group is set', () => {
  it('time, hole and mates, plus the lift', () => {
    const y = yourRound({ round: { id: 'r', format: 'stableford' }, me: 'me', teeRows: [{ group_no: 1, tee_time: '07:52', player_ids: ['me', 'bo', 'cy', 'di'] }] });
    const msg = teeTomorrowMessage({ roundName: 'Saturday', y, nameOf, car: { driver: { name: 'Josh M' }, pickup_time: '6:30am' } });
    expect(msg).toEqual({ title: '⛳ Your tee time tomorrow: 7:52', body: 'Hole 1 with Bo, Cy and Di · Josh picks you up 6:30am' });
  });
  it('a Cup match leads with who you play', () => {
    const y = yourRound({ round: { id: 'r1', format: 'stableford' }, me: 'me', sides, matches: [{ id: 'm', a_players: ['kurt'], b_players: ['me'], tee_time: '13:04' }] });
    expect(teeTomorrowMessage({ y, nameOf })).toEqual({ title: '⛳ Your tee time tomorrow: 1:04pm', body: 'You v Kurt' });
  });
  it('nothing set → no buzz', () => {
    expect(teeTomorrowMessage({ y: null })).toBeNull();
    const y = yourRound({ round: { id: 'r', format: 'ambrose' }, me: 'me', teams: [{ id: 't', name: 'Team 1', players: ['me'] }] });
    expect(teeTomorrowMessage({ y, nameOf })).toBeNull();
  });
});

describe('maybes and non-payers in the pickers, and their nudge', () => {
  const s = peopleStatus({
    plan: { deposit_pp: 250 },
    rsvps: [{ player_id: 'me', status: 'in' }, { player_id: 'mo', status: 'maybe' }, { player_id: 'al', status: 'in' }, { player_id: 'cy', status: 'out' }],
    transfers: [{ from_id: 'me', to_id: null, amount: 250 }, { from_id: 'al', to_id: 'me', amount: 250 }],
  });
  it('flags', () => {
    expect(s('me').flag).toBeNull();
    expect(s('mo').flag).toBe('maybe');
    expect(s('al').flag).toBe('not paid'); // paid a mate, not the organiser
    expect(s('cy').flag).toBe('out');
    expect(s('zz').flag).toBe('no reply');
    expect(flagMark('maybe')).toBe(' · maybe');
    expect(flagMark(null)).toBe('');
  });
  it('no plan or no deposit: nobody flagged for money', () => {
    expect(peopleStatus({})('me').flag).toBeNull();
    expect(peopleStatus({ plan: {}, rsvps: [{ player_id: 'a', status: 'in' }] })('a').flag).toBeNull();
  });
  it('the nudge words', () => {
    const y = { team: { name: 'Team Blue' }, group: [] };
    expect(drawNudge({ flag: 'maybe', organiser: 'Kurt', y })).toBe('You’re in Kurt’s draw for Team Blue. Are you coming?');
    expect(drawNudge({ flag: 'not paid', y })).toBe('You’re in the draw for Team Blue. Pay your deposit so your spot’s locked in.');
    expect(drawNudge({ flag: null, y })).toBeNull();
    expect(drawNudge({ flag: 'out', y })).toBeNull();
  });
});

describe('C2: prefilled tee times and the run-up nudge', () => {
  it('the earliest time the course gave for that day and course', () => {
    const opts = [
      { play_date: '2026-10-24', course_id: 'c1', available: 'yes', ranges: ['08:10-09:00'], times: [] },
      { play_date: '2026-10-24', course_id: 'c1', available: 'yes', ranges: [], times: ['7:52'] },
      { play_date: '2026-10-24', course_id: 'c2', available: 'yes', ranges: ['06:30-07:00'] },
      { play_date: '2026-10-25', course_id: 'c1', available: 'yes', ranges: ['06:00-07:00'] },
    ];
    expect(calledTeeTime(opts, { play_date: '2026-10-24', course_id: 'c1' })).toBe('07:52');
    expect(calledTeeTime(opts, { play_date: '2026-10-26', course_id: 'c1' })).toBeNull();
    expect(calledTeeTime(opts, null)).toBeNull();
  });
  it('rounds in the next few days with no groups', () => {
    const rounds = [
      { id: 'a', play_date: '2026-10-24', status: 'setup' },
      { id: 'b', play_date: '2026-10-25', status: 'setup' },
      { id: 'c', play_date: '2026-11-20', status: 'setup' },
      { id: 'd', play_date: '2026-10-23', status: 'locked' },
    ];
    const out = roundsNeedingGroups({ rounds, teeRounds: new Set(['b']), today: '2026-10-23' });
    expect(out.map((r) => r.id)).toEqual(['a']);
    expect(roundsNeedingGroups({ rounds })).toEqual([]);
  });
});
