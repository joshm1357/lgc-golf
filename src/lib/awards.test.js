import { describe, it, expect } from 'vitest';
import {
  nameList, ordinal, dayBefore, isFresh, roundSubjects, holeDecided, roundComplete, bestEntry, roundMoment, compMoments,
  trophyMoment, cupMoment, decidedMoments, momentChanged, recentMoments, canChangePhoto,
} from './awards.js';

const TODAY = '2026-10-21';
const course = { id: 'c1', holes: [{ n: 1, par: 4, si: 1 }, { n: 2, par: 3, si: 2 }, { n: 3, par: 5, si: 3 }] };
const players = {
  mike: { id: 'mike', name: 'Mike Smith', nickname: 'Mike', handicap: 0 },
  al: { id: 'al', name: 'Al', handicap: 0 },
  kurt: { id: 'kurt', name: 'Kurt', handicap: 0 },
  bo: { id: 'bo', name: 'Bo', handicap: 0 },
};
const card = (strokes) => Object.fromEntries(strokes.map((s, i) => [i + 1, s == null ? undefined : s === 'P' ? { strokes: null, picked_up: true } : { strokes: s }]).filter(([, v]) => v));

function stableford(over = {}) {
  const round = { id: 'r1', trip_id: 't1', course_id: 'c1', name: 'Saturday Stableford', format: 'stableford', status: 'live', play_date: TODAY, ctp_holes: [2], ld_holes: [3], ...over };
  return {
    today: TODAY, rounds: [round], coursesById: { c1: course }, teamsByRound: {}, playersById: players, quickResults: [],
    roundPlayers: { r1: ['mike', 'al', 'kurt'].map((id) => ({ round_id: 'r1', player_id: id, playing_handicap: 0 })) },
    scoresIdx: { r1: { mike: card([3, 2, 4]), al: card([4, 3, 5]), kurt: card([5, 3, 5]) } }, // 9, 6, 5 pts
    sideEntries: [], trophies: [], cupMatches: [], cupSides: [], features: { side_comps: true, trophies: true, cup: true },
    round,
  };
}

describe('words', () => {
  it('lists names and places', () => {
    expect(nameList(['Mike'])).toBe('Mike');
    expect(nameList(['Mike', 'Al'])).toBe('Mike and Al');
    expect(nameList(['Mike', 'Al', 'Bo'])).toBe('Mike, Al and Bo');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
  it('the day before, across a month', () => {
    expect(dayBefore('2026-11-01')).toBe('2026-10-31');
  });
});

describe('fresh rounds only', () => {
  it('live, or locked today/yesterday', () => {
    expect(isFresh({ status: 'live' }, TODAY)).toBe(true);
    expect(isFresh({ status: 'locked', play_date: TODAY }, TODAY)).toBe(true);
    expect(isFresh({ status: 'locked', play_date: '2026-10-20' }, TODAY)).toBe(true);
    expect(isFresh({ status: 'locked', play_date: '2026-10-19' }, TODAY)).toBe(false);
    expect(isFresh({ status: 'locked' }, TODAY)).toBe(false);
    expect(isFresh({ status: 'setup', play_date: TODAY }, TODAY)).toBe(false);
  });
});

describe('when a round is decided', () => {
  it('needs everyone on every hole (a pick-up counts)', () => {
    const c = stableford();
    expect(roundComplete({ ...c, round: c.round, course })).toBe(true);
    c.scoresIdx.r1.kurt = card([5, 3, null]);
    expect(roundComplete({ ...c, round: c.round, course })).toBe(false);
    c.scoresIdx.r1.kurt = card([5, 3, 'P']);
    expect(roundComplete({ ...c, round: c.round, course })).toBe(true);
  });
  it('locked counts as decided; not started does not', () => {
    const c = stableford();
    c.scoresIdx.r1.kurt = {};
    expect(roundComplete({ ...c, round: { ...c.round, status: 'locked' }, course })).toBe(true);
    expect(roundComplete({ ...c, round: { ...c.round, status: 'setup' }, course })).toBe(false);
  });
  it('a paper-card total counts as finished', () => {
    const c = stableford();
    c.scoresIdx.r1.kurt = {};
    c.quickResults = [{ round_id: 'r1', player_id: 'kurt', points: 30 }];
    expect(roundComplete({ ...c, round: c.round, course })).toBe(true);
  });
  it('subjects by format', () => {
    const teams = { r1: [{ id: 'tA', players: [players.mike, players.al] }] };
    expect(roundSubjects({ id: 'r1', format: 'ambrose' }, teams, {})).toEqual(['tA']);
    expect(roundSubjects({ id: 'r1', format: 'fourball' }, teams, {})).toEqual(['mike', 'al']);
    expect(roundSubjects({ id: 'r1', format: 'stroke' }, {}, { r1: [{ player_id: 'bo' }] })).toEqual(['bo']);
  });
});

describe('round winner', () => {
  it('Stableford: winner, points and the next two', () => {
    const c = stableford();
    const m = roundMoment(c, c.round);
    expect(m).toMatchObject({ key: 'round:r1', kind: 'round', round_id: 'r1', winner_player_ids: ['mike'] });
    expect(m.title).toBe('🏆 Mike wins Saturday Stableford — 9 pts');
    expect(m.detail).toBe('2nd Al 6 pts · 3rd Kurt 5 pts');
  });
  it('nothing until everyone is in (no spoilers)', () => {
    const c = stableford();
    c.scoresIdx.r1.kurt = card([5, 3]);
    expect(roundMoment(c, c.round)).toBe(null);
  });
  it('a locked round with no scores has no winner', () => {
    const c = stableford({ status: 'locked' });
    c.scoresIdx = {};
    expect(roundMoment(c, c.round)).toBe(null);
  });
  it('Ambrose: the team wins, net to par, with its players', () => {
    const c = stableford({ format: 'ambrose', name: 'Day 2 Ambrose' });
    c.teamsByRound = { r1: [{ id: 'tA', name: 'Team Kurt', handicap: 0, players: [players.kurt, players.al] }, { id: 'tB', name: 'Team Mike', handicap: 0, players: [players.mike, players.bo] }] };
    c.scoresIdx = { r1: { tA: card([3, 3, 4]), tB: card([4, 3, 5]) } };
    const m = roundMoment(c, c.round);
    expect(m.title).toBe('🏆 Team Kurt win Day 2 Ambrose — −2 net');
    expect(m.detail).toBe('Kurt and Al · 2nd Team Mike E net');
    expect(m.winner_player_ids).toEqual(['kurt', 'al']);
  });
  it('Stroke play: net to par', () => {
    const c = stableford({ format: 'stroke', name: 'Medal' });
    expect(roundMoment(c, c.round).title).toBe('🏆 Mike wins Medal — −3 net');
  });
  it('4BBB: the pair wins on better-ball points', () => {
    const c = stableford({ format: 'fourball', name: '4BBB' });
    c.teamsByRound = { r1: [{ id: 'p1', name: 'Mike & Al', players: [players.mike, players.al] }, { id: 'p2', name: 'Kurt & Bo', players: [players.kurt, players.bo] }] };
    c.scoresIdx.r1.bo = card([4, 3, 5]);
    c.roundPlayers = { r1: ['mike', 'al', 'kurt', 'bo'].map((id) => ({ round_id: 'r1', player_id: id, playing_handicap: 0 })) };
    const m = roundMoment(c, c.round);
    expect(m.title).toBe('🏆 Mike & Al win 4BBB — 9 pts');
    expect(m.winner_player_ids).toEqual(['mike', 'al']);
  });
  it('a dead heat after countback is a tie', () => {
    const c = stableford();
    c.scoresIdx.r1.al = card([3, 2, 4]);
    const m = roundMoment(c, c.round);
    expect(m.title).toBe('🏆 Al and Mike tie for Saturday Stableford — 9 pts');
    expect(m.winner_player_ids.sort()).toEqual(['al', 'mike']);
  });
});

describe('closest to the pin and longest drive', () => {
  it('decided once everyone has played the hole; the confirmed entry wins, else the best distance', () => {
    const c = stableford();
    c.scoresIdx.r1.kurt = card([5, 3]); // round not finished, but hole 2 is
    c.sideEntries = [
      { round_id: 'r1', kind: 'ctp', hole: 2, player_id: 'al', distance_m: 4.2 },
      { round_id: 'r1', kind: 'ctp', hole: 2, player_id: 'kurt', distance_m: 1.8 },
      { round_id: 'r1', kind: 'ld', hole: 3, player_id: 'mike', distance_m: 260 },
    ];
    const ms = compMoments(c, c.round);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ key: 'ctp:r1:2', kind: 'ctp', title: '🎯 Kurt wins closest to the pin on 2 — 1.8 m', winner_player_ids: ['kurt'] });
    c.sideEntries[0].confirmed = true;
    expect(compMoments(c, c.round)[0].title).toBe('🎯 Al wins closest to the pin on 2 — 4.2 m');
    c.scoresIdx.r1.kurt = card([5, 3, 6]);
    expect(compMoments(c, c.round).map((m) => m.title)).toContain('💣 Mike wins longest drive on 3 — 260 m');
  });
  it('no entries: no moment; locked: decided', () => {
    const c = stableford({ status: 'locked' });
    expect(compMoments(c, c.round)).toEqual([]);
    expect(holeDecided({ round: c.round, hole: 2 })).toBe(true);
  });
  it('best entry helper', () => {
    expect(bestEntry('ld', [{ distance_m: 200 }, { distance_m: 250 }]).distance_m).toBe(250);
    expect(bestEntry('ctp', [{ distance_m: null }])).toBe(null);
  });
});

describe('trophies', () => {
  it('Stableford total: decided when its last counting round is', () => {
    const c = stableford();
    const r0 = { ...c.round, id: 'r0', name: 'Friday', status: 'locked', play_date: '2026-10-20' };
    c.rounds = [r0, c.round];
    c.roundPlayers.r0 = c.roundPlayers.r1.map((x) => ({ ...x, round_id: 'r0' }));
    c.scoresIdx.r0 = { mike: card([4, 3, 5]), al: card([3, 2, 4]), kurt: card([4, 3, 5]) }; // 6, 9, 6
    const t = { id: 'tr1', trip_id: 't1', name: 'BD Trophy', type: 'stableford_total' };
    expect(trophyMoment(c, t)).toMatchObject({ key: 'trophy:tr1', kind: 'trophy', round_id: 'r1' });
    // Mike 15, Al 15: Al wins on the better last round? No — Mike's last round (9) beats Al's (6).
    expect(trophyMoment(c, t).title).toBe('🏆 Mike wins the BD Trophy — 15 pts');
    expect(trophyMoment(c, t).detail).toBe('2nd Al 15 pts · 3rd Kurt 11 pts');
    c.scoresIdx.r1.kurt = card([5]);
    expect(trophyMoment(c, t)).toBe(null);
  });
  it('Ambrose trophy follows the trip’s last Ambrose round; "The" names keep their own "The"', () => {
    const c = stableford({ format: 'ambrose' });
    c.teamsByRound = { r1: [{ id: 'tA', name: 'Team Kurt', handicap: 0, players: [players.kurt, players.al] }] };
    c.scoresIdx = { r1: { tA: card([3, 3, 4]) } };
    const m = trophyMoment(c, { id: 'tr2', trip_id: 't1', name: 'The Noodle Cup', type: 'ambrose' });
    expect(m.title).toBe('🏆 Team Kurt win The Noodle Cup — −2 net');
    expect(trophyMoment(c, { id: 'tr3', trip_id: 't1', name: 'Plate', type: 'manual' })).toBe(null);
  });
  it('an old trip’s trophy isn’t dug up', () => {
    const c = stableford({ status: 'locked', play_date: '2026-09-01' });
    expect(trophyMoment(c, { id: 'tr1', trip_id: 't1', name: 'BD Trophy', type: 'stableford_total' })).toBe(null);
  });
});

describe('the Cup', () => {
  const sides = [{ sort: 1, name: 'Team Blue' }, { sort: 2, name: 'Team Red' }];
  const res = (list) => Object.fromEntries(list.map((r, i) => [String(i + 1), r]));
  it('won early, and halved', () => {
    const c = { playersById: players, cupSides: sides, rounds: [{ id: 'r1', name: 'Day 1' }] };
    const won = { id: 'm3', round_id: 'r1', sort: 3, a_players: ['kurt', 'al'], b_players: ['mike', 'bo'], holes: res([...Array(13).fill('h'), 'a', 'a', 'a']) };
    expect(cupMoment(c, won)).toMatchObject({ key: 'cup:m3', kind: 'cup', title: '🏆 Team Blue win match 3: Kurt & Al 3&2', winner_player_ids: ['kurt', 'al'] });
    expect(cupMoment(c, { ...won, holes: res(Array(18).fill('h')) }).title).toBe('🤝 Match 3 halved: Kurt & Al v Mike & Bo');
    expect(cupMoment(c, { ...won, holes: res(['a']) })).toBe(null);
  });
});

describe('everything decided', () => {
  it('respects the feature switches and freshness', () => {
    const c = stableford();
    c.sideEntries = [{ round_id: 'r1', kind: 'ctp', hole: 2, player_id: 'al', distance_m: 3 }];
    expect(decidedMoments(c).map((m) => m.key)).toEqual(['round:r1', 'ctp:r1:2']);
    expect(decidedMoments({ ...c, features: {} }).map((m) => m.key)).toEqual(['round:r1']);
    expect(decidedMoments({ ...c, rounds: [{ ...c.round, status: 'locked', play_date: '2026-01-01' }] })).toEqual([]);
  });
});

describe('the card', () => {
  it('a changed result is spotted', () => {
    const a = { title: 'x', detail: null, winner_player_ids: ['b', 'a'] };
    expect(momentChanged(a, { title: 'x', winner_player_ids: ['a', 'b'] })).toBe(false);
    expect(momentChanged(a, { title: 'y', winner_player_ids: ['a', 'b'] })).toBe(true);
  });
  it('recent only, newest first, hidden ones left out', () => {
    const now = Date.parse('2026-10-21T10:00:00Z');
    const list = [
      { id: '1', created_at: '2026-10-21T09:00:00Z' }, { id: '2', created_at: '2026-10-21T09:30:00Z' },
      { id: '3', created_at: '2026-10-21T01:00:00Z' }, { id: '4', created_at: '2026-10-21T09:45:00Z' },
    ];
    expect(recentMoments(list, { now, hidden: ['4'] }).map((m) => m.id)).toEqual(['2', '1']);
  });
  it('decided together: the round before its side comps', () => {
    const now = Date.parse('2026-10-21T10:00:00Z');
    const list = [{ id: 'c', kind: 'ctp', created_at: '2026-10-21T09:00:01Z' }, { id: 'r', kind: 'round', created_at: '2026-10-21T09:00:00Z' }];
    expect(recentMoments(list, { now }).map((m) => m.id)).toEqual(['r', 'c']);
  });
  it('photo: anyone first, then whoever took it or an organiser', () => {
    expect(canChangePhoto({ photo_url: null }, { playerId: 'p' })).toBe(true);
    expect(canChangePhoto({ photo_url: 'x', photo_by: 'q' }, { playerId: 'p' })).toBe(false);
    expect(canChangePhoto({ photo_url: 'x', photo_by: 'p' }, { playerId: 'p' })).toBe(true);
    expect(canChangePhoto({ photo_url: 'x', photo_by: 'q' }, { playerId: 'p', isOrganiser: true })).toBe(true);
  });
});
