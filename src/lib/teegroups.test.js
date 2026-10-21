import { describe, it, expect } from 'vitest';
import {
  seeded, joinNames, parseTime, addMinutes, showTime, teeTimes, timeSettings, roundTeeInputs, pastPartners, buildBlocks,
  groupShape, makeTeeGroups, scoreGroups, scoringContext, explain, explainLine, swapPlayers, rowsToSave, groupWhen,
  myGroupLine, shareTeeText, pairKey,
} from './teegroups.js';

const P = (n, hcps) => Array.from({ length: n }, (_, i) => ({ id: `p${String(i + 1).padStart(2, '0')}`, hcp: hcps ? hcps[i] : 10 + i }));
const sizes = (groups) => groups.map((g) => g.length).sort((a, b) => b - a);
const together = (groups, a, b) => groups.some((g) => g.includes(a) && g.includes(b));
const historyFrom = (groups) => {
  const h = {};
  for (const g of groups) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) h[pairKey(g[i], g[j])] = (h[pairKey(g[i], g[j])] || 0) + 1;
  return h;
};

describe('times', () => {
  it('reads and shows times', () => {
    expect(parseTime('8:00')).toBe('08:00');
    expect(parseTime('0815')).toBe('08:15');
    expect(parseTime('8.30')).toBe('08:30');
    expect(parseTime('25:00')).toBe(null);
    expect(parseTime('')).toBe(null);
    expect(addMinutes('08:00', 16)).toBe('08:16');
    expect(addMinutes('23:56', 8)).toBe('00:04');
    expect(showTime('08:16')).toBe('8:16');
    expect(showTime('13:04')).toBe('1:04pm');
    expect(showTime('12:30')).toBe('12:30pm');
    expect(showTime(null)).toBe('');
  });
  it('first tee time plus a gap', () => {
    expect(teeTimes(3, { mode: 'times', first: '08:00', gap: 8 })).toEqual([
      { tee_time: '08:00', start_hole: null }, { tee_time: '08:08', start_hole: null }, { tee_time: '08:16', start_hole: null },
    ]);
  });
  it('shotgun: one time, holes 1, 2, 3…', () => {
    expect(teeTimes(3, { mode: 'shotgun', first: '12:30' })).toEqual([
      { tee_time: '12:30', start_hole: 1 }, { tee_time: '12:30', start_hole: 2 }, { tee_time: '12:30', start_hole: 3 },
    ]);
    expect(teeTimes(20, { mode: 'shotgun', first: '12:30' })[18].start_hole).toBe(1);
  });
  it('no first time → no times', () => {
    expect(teeTimes(2, { first: '' })).toEqual([{ tee_time: null, start_hole: null }, { tee_time: null, start_hole: null }]);
  });
  it('works out the settings from saved rows', () => {
    expect(timeSettings([{ group_no: 2, tee_time: '07:40' }, { group_no: 1, tee_time: '07:30' }])).toEqual({ mode: 'times', first: '07:30', gap: 10 });
    expect(timeSettings([{ group_no: 1, tee_time: '12:00', start_hole: 1 }])).toEqual({ mode: 'shotgun', first: '12:00', gap: 8 });
    expect(timeSettings([])).toEqual({ mode: 'times', first: '08:00', gap: 8 });
  });
});

describe('group sizes', () => {
  const shapeOf = (n) => groupShape(Array(n).fill(1), seeded(1)).map((c) => c.length).sort((a, b) => b - a);
  it('fours, with threes when the numbers need it; never a 1 or 2 from 3 players up', () => {
    expect(shapeOf(1)).toEqual([1]);
    expect(shapeOf(2)).toEqual([2]);
    expect(shapeOf(3)).toEqual([3]);
    expect(shapeOf(4)).toEqual([4]);
    expect(shapeOf(5)).toEqual([5]);
    expect(shapeOf(6)).toEqual([3, 3]);
    expect(shapeOf(7)).toEqual([4, 3]);
    expect(shapeOf(8)).toEqual([4, 4]);
    expect(shapeOf(9)).toEqual([3, 3, 3]);
    expect(shapeOf(10)).toEqual([4, 3, 3]);
    expect(shapeOf(11)).toEqual([4, 4, 3]);
    expect(shapeOf(13)).toEqual([4, 3, 3, 3]);
    expect(shapeOf(24)).toEqual([4, 4, 4, 4, 4, 4]);
    for (let n = 3; n <= 40; n++) expect(Math.min(...shapeOf(n))).toBeGreaterThanOrEqual(3);
  });
  it('pairs go two to a group', () => {
    const s = groupShape([2, 2, 2, 2], seeded(3));
    expect(s.map((c) => c.reduce((a, b) => a + b, 0))).toEqual([4, 4]);
  });
});

describe('blocks', () => {
  it('teams, matches and keep-together pairs stay together; a keep-together never makes more than four', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const { blocks, notes } = buildBlocks({ playerIds: ids, units: [['a', 'b', 'c']], together: [['c', 'd'], ['d', 'e'], ['f', 'g']] });
    const of = (id) => blocks.find((b) => b.ids.includes(id)).ids;
    expect(of('a').sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(of('e')).toEqual(['e']);
    expect(of('f').sort()).toEqual(['f', 'g']);
    expect(notes).toEqual([{ kind: 'together-skipped', ids: ['d', 'e'] }]);
  });
  it('one match per group marks the match blocks', () => {
    const { blocks } = buildBlocks({ playerIds: ['a', 'b', 'c', 'd', 'e'], matches: [['a', 'b'], ['c', 'd']], oneMatchPerGroup: true });
    expect(blocks.filter((b) => b.solo).map((b) => b.ids)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(blocks.find((b) => b.ids.includes('e')).solo).toBe(false);
  });
});

describe('who is playing', () => {
  const playersById = { a: { id: 'a', handicap: 10 }, b: { id: 'b', handicap: 20 }, c: { id: 'c', handicap: 5 }, d: { id: 'd', handicap: 30 } };
  it('Stableford: round players with their playing handicaps; no units', () => {
    const r = roundTeeInputs({ round: { format: 'stableford' }, roundPlayers: [{ player_id: 'a', playing_handicap: 9 }, { player_id: 'b', playing_handicap: 18 }, { player_id: 'zz', playing_handicap: 1 }], teams: [{ players: [{ id: 'a' }, { id: 'b' }] }], playersById });
    expect(r.players).toEqual([{ id: 'a', hcp: 9 }, { id: 'b', hcp: 18 }]);
    expect(r.units).toEqual([]);
  });
  it('Ambrose: team players (not in round_players) are in, as units', () => {
    const r = roundTeeInputs({ round: { format: 'ambrose' }, teams: [{ players: [{ id: 'a' }, { id: 'b' }] }, { players: [{ id: 'c' }, { id: 'd' }] }], playersById });
    expect(r.players.map((p) => [p.id, p.hcp])).toEqual([['a', 10], ['b', 20], ['c', 5], ['d', 30]]);
    expect(r.units).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('Cup matches in order, both sides together', () => {
    const r = roundTeeInputs({ round: { format: 'stableford' }, matches: [{ sort: 2, a_players: ['c'], b_players: ['d'] }, { sort: 1, a_players: ['a'], b_players: ['b'] }], playersById });
    expect(r.matches).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('earlier partners', () => {
  const rounds = [
    { id: 'r1', trip_id: 't', play_date: '2026-10-22', created_at: '1', format: 'stableford' },
    { id: 'r2', trip_id: 't', play_date: '2026-10-23', created_at: '2', format: 'ambrose' },
    { id: 'r3', trip_id: 't', play_date: '2026-10-24', created_at: '3', format: 'stableford' },
    { id: 'rx', trip_id: 'other', play_date: '2026-10-01', created_at: '0', format: 'stableford' },
  ];
  it('counts pairs from earlier rounds of the same trip; teams stand in when no groups were saved', () => {
    const h = pastPartners({
      round: rounds[2], rounds,
      teeRowsByRound: { r1: [{ player_ids: ['a', 'b', 'c'] }], rx: [{ player_ids: ['a', 'b'] }], r3: [{ player_ids: ['a', 'd'] }] },
      teamsByRound: { r2: [{ players: [{ id: 'a' }, { id: 'b' }] }] },
    });
    expect(h).toEqual({ 'a|b': 2, 'a|c': 1, 'b|c': 1 });
  });
  it('the first round has no history', () => {
    expect(pastPartners({ round: rounds[0], rounds, teeRowsByRound: { r3: [{ player_ids: ['a', 'b'] }] } })).toEqual({});
  });
});

describe('making groups', () => {
  it('10 players: 4, 3, 3 and everyone once', () => {
    const players = P(10);
    const { groups } = makeTeeGroups({ players, seed: 7 });
    expect(sizes(groups)).toEqual([4, 3, 3]);
    expect(groups.flat().sort()).toEqual(players.map((p) => p.id).sort());
  });
  it('same seed, same groups; another seed can differ', () => {
    const players = P(12);
    const a = makeTeeGroups({ players, seed: 42 }).groups;
    const b = makeTeeGroups({ players, seed: 42 }).groups;
    expect(a).toEqual(b);
    const others = [43, 44, 45, 46].map((s) => JSON.stringify(makeTeeGroups({ players, seed: s }).groups));
    expect(others.some((o) => o !== JSON.stringify(a))).toBe(true);
  });
  it('day two avoids day-one partners (16 players: possible, so none)', () => {
    const players = P(16);
    const day1 = makeTeeGroups({ players, seed: 1 }).groups;
    const day2 = makeTeeGroups({ players, seed: 2, history: historyFrom(day1) });
    expect(day2.score.repeats).toEqual([]);
    for (const g of day1) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) expect(together(day2.groups, g[i], g[j])).toBe(false);
  });
  it('12 players: three groups of four can’t all be new, so the fewest repeats (one a group)', () => {
    const players = P(12);
    const day1 = makeTeeGroups({ players, seed: 1 }).groups;
    const day2 = makeTeeGroups({ players, seed: 2, history: historyFrom(day1) });
    expect(day2.score.repeats.length).toBe(3);
  });
  it('10 players over two rounds: just one repeat pair on day two (the fewest possible with 4, 3, 3)', () => {
    const players = P(10);
    const day1 = makeTeeGroups({ players, seed: 5 }).groups;
    const day2 = makeTeeGroups({ players, seed: 6, history: historyFrom(day1) });
    expect(day2.score.repeats.length).toBe(1);
    expect(Math.min(...sizes(day2.groups))).toBeGreaterThanOrEqual(3);
  });
  it('mixes handicaps: the four low markers are not all together', () => {
    const players = P(8, [1, 2, 3, 4, 25, 26, 27, 28]);
    const { groups, score } = makeTeeGroups({ players, seed: 9 });
    expect(score.mixed).toBe(true);
    for (const g of groups) expect(g.filter((id) => Number(id.slice(1)) <= 4).length).toBe(2);
  });
  it('keep apart beats everything; keep together is respected', () => {
    const players = P(8);
    const { groups, score } = makeTeeGroups({ players, seed: 3, apart: [['p01', 'p02']], together: [['p03', 'p04'], ['p05', 'p06']] });
    expect(together(groups, 'p01', 'p02')).toBe(false);
    expect(together(groups, 'p03', 'p04')).toBe(true);
    expect(together(groups, 'p05', 'p06')).toBe(true);
    expect(score.apartBroken).toEqual([]);
  });
  it('Ambrose teams of four are a group each; teams of two pair up', () => {
    const players = P(8);
    const ids = players.map((p) => p.id);
    const fours = makeTeeGroups({ players, units: [ids.slice(0, 4), ids.slice(4)], seed: 1 }).groups.map((g) => [...g].sort());
    expect(fours).toContainEqual(ids.slice(0, 4));
    expect(fours).toContainEqual(ids.slice(4));
    const pairs = [ids.slice(0, 2), ids.slice(2, 4), ids.slice(4, 6), ids.slice(6)];
    const { groups } = makeTeeGroups({ players, units: pairs, seed: 1 });
    expect(sizes(groups)).toEqual([4, 4]);
    for (const [a, b] of pairs) expect(together(groups, a, b)).toBe(true);
  });
  it('4BBB pairs: day two puts each pair with a new pair', () => {
    const players = P(8);
    const ids = players.map((p) => p.id);
    const pairs = [ids.slice(0, 2), ids.slice(2, 4), ids.slice(4, 6), ids.slice(6)];
    const day1 = makeTeeGroups({ players, units: pairs, seed: 1 }).groups;
    const day2 = makeTeeGroups({ players, units: pairs, seed: 1, history: historyFrom(day1) });
    expect(day2.score.repeats).toEqual([]);
  });
  it('Cup: two singles matches a group, or one a group when asked', () => {
    const players = P(8);
    const ids = players.map((p) => p.id);
    const matches = [ids.slice(0, 2), ids.slice(2, 4), ids.slice(4, 6), ids.slice(6)];
    const two = makeTeeGroups({ players, matches, seed: 1 });
    expect(sizes(two.groups)).toEqual([4, 4]);
    for (const [a, b] of matches) expect(together(two.groups, a, b)).toBe(true);
    const one = makeTeeGroups({ players, matches, oneMatchPerGroup: true, seed: 1 });
    expect(one.groups).toEqual(matches);
  });
  it('a pairs match (2 v 2) is its own group', () => {
    const players = P(8);
    const ids = players.map((p) => p.id);
    const { groups } = makeTeeGroups({ players, matches: [ids.slice(0, 4), ids.slice(4)], seed: 2 });
    expect(groups.map((g) => [...g].sort())).toEqual(expect.arrayContaining([ids.slice(0, 4), ids.slice(4)]));
  });
  it('5 pairs can only make a group of 2 — and says so', () => {
    const players = P(10);
    const ids = players.map((p) => p.id);
    const units = [0, 2, 4, 6, 8].map((i) => ids.slice(i, i + 2));
    const { groups, score, notes } = makeTeeGroups({ players, units, seed: 1 });
    expect(sizes(groups)).toEqual([4, 4, 2]);
    expect(explainLine(explain(score, (x) => x, { notes, groups }))).toContain('One group of 2');
  });
  it('fewer than 3 players: one group', () => {
    expect(makeTeeGroups({ players: P(2), seed: 1 }).groups.map((g) => [...g].sort())).toEqual([['p01', 'p02']]);
    expect(makeTeeGroups({ players: [], seed: 1 }).groups).toEqual([]);
  });
});

describe('swap, score and words', () => {
  it('swaps two players between groups', () => {
    const g = [['a', 'b'], ['c', 'd']];
    expect(swapPlayers(g, 'a', 'd')).toEqual([['d', 'b'], ['c', 'a']]);
    expect(swapPlayers(g, 'a', 'b')).toBe(g);
    expect(swapPlayers(g, 'a', 'zz')).toBe(g);
  });
  it('explains simply', () => {
    const players = P(8, [1, 2, 3, 4, 25, 26, 27, 28]);
    const ctx = scoringContext({ players, history: { 'p01|p02': 1 } });
    const good = scoreGroups([['p01', 'p03', 'p05', 'p07'], ['p02', 'p04', 'p06', 'p08']], ctx);
    expect(explainLine(explain(good, (x) => x, { groups: [1, 2] }))).toBe('No repeat partners · Handicaps mixed');
    const bad = scoreGroups([['p01', 'p02', 'p03', 'p04'], ['p05', 'p06', 'p07', 'p08']], ctx);
    expect(explainLine(explain(bad, (x) => x.toUpperCase(), { groups: [1, 2] }))).toBe('P01 & P02 together again · Handicaps a bit uneven');
  });
  it('a swap that splits a pair is called out', () => {
    const players = P(8);
    const ids = players.map((p) => p.id);
    const res = makeTeeGroups({ players, units: [ids.slice(0, 2)], seed: 1 });
    const g = res.groups.find((x) => x.includes('p01'));
    const other = res.groups.find((x) => !x.includes('p01'));
    const swapped = swapPlayers(res.groups, 'p02', other[0]);
    const s = scoreGroups(swapped, res.ctx);
    expect(g.includes('p02')).toBe(true);
    expect(s.split).toEqual([['p01', 'p02']]);
    expect(explainLine(explain(s, (x) => x))).toContain('p01 and p02 split up');
  });
  it('rows to save, numbered with times', () => {
    expect(rowsToSave('r', [['a', 'b', 'c'], ['d', 'e', 'f']], { mode: 'times', first: '08:00', gap: 8 })).toEqual([
      { round_id: 'r', group_no: 1, tee_time: '08:00', start_hole: null, player_ids: ['a', 'b', 'c'] },
      { round_id: 'r', group_no: 2, tee_time: '08:08', start_hole: null, player_ids: ['d', 'e', 'f'] },
    ]);
  });
  it('your group, and the share text', () => {
    const names = { a: 'Al', b: 'Bo', c: 'Cy', d: 'Di', k: 'Kurt' };
    const nameOf = (id) => names[id];
    const rows = [{ group_no: 2, tee_time: '08:16', start_hole: null, player_ids: ['k', 'a', 'b', 'c'] }, { group_no: 1, tee_time: '08:08', start_hole: null, player_ids: ['d'] }];
    expect(myGroupLine(rows, 'k', nameOf)).toBe('8:16 with Al, Bo and Cy');
    expect(myGroupLine(rows, 'd', nameOf)).toBe('8:08 — just you');
    expect(myGroupLine(rows, 'zz', nameOf)).toBe(null);
    expect(myGroupLine([{ group_no: 3, tee_time: '12:00', start_hole: 3, player_ids: ['k', 'a'] }], 'k', nameOf)).toBe('12:00pm shotgun, hole 3, with Al');
    expect(myGroupLine([{ group_no: 3, tee_time: null, start_hole: null, player_ids: ['k', 'a'] }], 'k', nameOf)).toBe('Group 3 with Al');
    expect(groupWhen({ group_no: 2, tee_time: '08:16' })).toBe('8:16');
    expect(groupWhen({ group_no: 2, tee_time: '12:00', start_hole: 2 })).toBe('12:00pm · hole 2');
    const text = shareTeeText({ round: { name: 'Saturday Stableford', play_date: '2026-10-24' }, rows, nameOf, courseName: 'Cypress Lakes' });
    expect(text.split('\n')[0]).toBe('⛳ Saturday Stableford — tee groups');
    expect(text).toContain('Cypress Lakes · ');
    expect(text).toContain('8:08  Di\n8:16  Kurt, Al, Bo, Cy');
    const sg = shareTeeText({ round: { name: 'R' }, rows: [{ group_no: 1, tee_time: '12:30', start_hole: 1, player_ids: ['a', 'b'] }], nameOf });
    expect(sg).toBe('⛳ R — tee groups\nShotgun start 12:30pm\n\nHole 1: Al, Bo');
  });
  it('joins names', () => {
    expect(joinNames(['Al'])).toBe('Al');
    expect(joinNames(['Al', 'Bo'])).toBe('Al and Bo');
    expect(joinNames(['Al', 'Bo', 'Cy'])).toBe('Al, Bo and Cy');
  });
});
