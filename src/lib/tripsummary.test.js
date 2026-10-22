import { describe, it, expect } from 'vitest';
import { defaultView, dayLabel, tripDays, tripCourses, roundWinner, countdownWords, whosIn, tripHonours } from './tripsummary.js';

describe('defaultView', () => {
  it('opens on the overview once dates are locked in, organise while deciding', () => {
    expect(defaultView('locked')).toBe('overview');
    expect(defaultView('on')).toBe('overview');
    expect(defaultView('done')).toBe('overview');
    expect(defaultView('deciding')).toBe('organise');
    expect(defaultView('idea')).toBe('organise');
    expect(defaultView('cancelled')).toBe('organise');
  });
  it('players always open on the overview (the votes are there)', () => {
    expect(defaultView('deciding', false)).toBe('overview');
    expect(defaultView('idea', false)).toBe('overview');
    expect(defaultView('locked', false)).toBe('overview');
  });
});

describe('dayLabel', () => {
  it('names the day without time zone shifts', () => {
    expect(dayLabel('2026-10-23')).toBe('Fri 23 Oct');
    expect(dayLabel('2026-01-01')).toBe('Thu 1 Jan');
    expect(dayLabel(null)).toBe('Date TBC');
  });
});

describe('tripDays and tripCourses', () => {
  const coursesById = { c1: { id: 'c1', name: 'Cypress Lakes' }, c2: { id: 'c2', name: 'The Vintage' } };
  const rounds = [
    { id: 'r3', trip_id: 't', course_id: 'c1', play_date: '2026-10-24', created_at: '3' },
    { id: 'r1', trip_id: 't', course_id: 'c1', play_date: '2026-10-22', created_at: '1' },
    { id: 'r2', trip_id: 't', course_id: 'c2', play_date: '2026-10-23', created_at: '2' },
    { id: 'rx', trip_id: 'other', course_id: 'c2', play_date: '2026-10-23', created_at: '2' },
    { id: 'r4', trip_id: 't', course_id: null, play_date: null, created_at: '4' },
  ];
  it('groups the trip’s rounds by day, in order, undated last', () => {
    const days = tripDays(rounds, coursesById, 't');
    expect(days.map((d) => d.label)).toEqual(['Thu 22 Oct', 'Fri 23 Oct', 'Sat 24 Oct', 'Date TBC']);
    expect(days[1].rounds[0].course.name).toBe('The Vintage');
    expect(days.flatMap((d) => d.rounds.map((x) => x.round.id))).not.toContain('rx');
  });
  it('lists each course once', () => {
    expect(tripCourses(tripDays(rounds, coursesById, 't')).map((c) => c.name)).toEqual(['Cypress Lakes', 'The Vintage']);
  });
});

describe('roundWinner', () => {
  it('names the Stableford winner with points once the round is done', () => {
    const board = { format: 'stableford', rows: [{ name: 'Kurt', rank: 1, thru: 18, points: 38 }, { name: 'Al', rank: 2, thru: 18, points: 35 }] };
    expect(roundWinner(board, true)).toEqual({ name: 'Kurt', score: '38 pts', tie: false });
    expect(roundWinner(board, false)).toBeNull();
  });
  it('shows a tie and net to par for Ambrose / stroke play', () => {
    const board = { format: 'ambrose', rows: [{ name: 'Blue', rank: 1, thru: 18, netToPar: -6 }, { name: 'Red', rank: 1, thru: 18, netToPar: -6 }, { name: 'Gold', rank: 3, thru: 18, netToPar: -2 }] };
    expect(roundWinner(board, true)).toEqual({ name: 'Blue & Red', score: '−6 net', tie: true });
  });
  it('nothing for a round nobody scored', () => {
    expect(roundWinner({ format: 'stableford', rows: [{ name: 'Kurt', rank: 1, thru: 0 }] }, true)).toBeNull();
    expect(roundWinner(null, true)).toBeNull();
  });
});

describe('countdownWords', () => {
  it('counts down, says on now, and goes quiet after', () => {
    expect(countdownWords('2026-10-22', '2026-10-24', '2026-10-21')).toBe('Tomorrow');
    expect(countdownWords('2026-11-02', null, '2026-10-21')).toBe('In 12 days');
    expect(countdownWords('2026-10-22', '2026-10-24', '2026-10-23')).toBe('On now');
    expect(countdownWords('2026-10-22', '2026-10-24', '2026-10-30')).toBeNull();
    expect(countdownWords(null)).toBeNull();
  });
});

describe('whosIn', () => {
  const playersById = { a: { id: 'a', name: 'Al' }, b: { id: 'b', name: 'Bo' }, k: { id: 'k', name: 'Kurt' } };
  it('uses RSVPs marked in', () => {
    expect(whosIn({ rsvps: [{ player_id: 'a', status: 'in' }, { player_id: 'b', status: 'out' }], playersById }).map((p) => p.name)).toEqual(['Al']);
  });
  it('falls back to who played (players and teams) for older trips', () => {
    const got = whosIn({ rounds: [{ id: 'r1' }, { id: 'r2' }], roundPlayers: { r1: [{ player_id: 'k' }] }, teamsByRound: { r2: [{ players: [{ id: 'a' }, { id: 'k' }] }] }, playersById });
    expect(got.map((p) => p.name).sort()).toEqual(['Al', 'Kurt']);
  });
});

describe('tripHonours', () => {
  it('only this trip’s, by trophy name', () => {
    const hb = [{ trip_id: 't', trophy_name: 'Putt Buddies' }, { trip_id: 'x', trophy_name: 'BD' }, { trip_id: 't', trophy_name: 'BD Trophy' }];
    expect(tripHonours(hb, 't').map((h) => h.trophy_name)).toEqual(['BD Trophy', 'Putt Buddies']);
    expect(tripHonours(hb, null)).toEqual([]);
  });
});
