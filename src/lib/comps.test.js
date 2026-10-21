import { describe, it, expect } from 'vitest';
import {
  COMP_TYPES, COMP_TYPE, COMP_KINDS, fits, trophyTypeFor, kindForTrophy, cleanSettings, tripComps, compRounds,
  fittingRounds, dayOf, noRoundHint, roundComps, defaultName, compStandings, compNeeds, needsSummary, actionPath,
  actionLabel, cupSides, tripPlayerIds,
} from './comps.js';
import { stablefordTrophyBoard } from './board.js';

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const sc = (arr) => Object.fromEntries(arr.map((v, i) => [i + 1, v === 'P' ? { picked_up: true } : { strokes: v }]));
const P = (id, handicap, extra = {}) => ({ id, name: id, handicap, approved: true, ...extra });
const players = [P('A', 0, { cup_side: 's1' }), P('B', 18, { cup_side: 's1' }), P('C', 9, { cup_side: 's2' }), P('D', 9), P('E', 5)];
const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
const T = 't1';
const R = (id, format, play_date, extra = {}) => ({ id, trip_id: T, format, play_date, course_id: 'c', name: `${id} round`, status: 'live', ctp_holes: [], ld_holes: [], own_comps: [], created_at: play_date, ...extra });
const rounds = [
  R('r1', 'stableford', '2026-10-23', { ctp_holes: [3], ld_holes: [5], own_comps: [{ comp: 'd1', holes: [] }] }), // Friday
  R('r2', 'stableford', '2026-10-24'), // Saturday
  R('r3', 'ambrose', '2026-10-25'), // Sunday
  R('r5', 'ambrose', '2026-10-26'), // Monday
  R('r6', 'fourball', '2026-10-27'), // Tuesday
  R('r7', 'stroke', '2026-10-28'), // Wednesday
  { ...R('other', 'stableford', '2026-10-23'), trip_id: 't2' },
];
const team = (id, round_id, ids, handicap = 0) => ({ id, round_id, name: ids.join(' & '), handicap, players: ids.map((x) => playersById[x]) });
const rp = (pid, h) => ({ player_id: pid, playing_handicap: h });
const base = {
  trips: [{ id: T, name: 'Hunter 2026', cup_points: null }],
  rounds, players, playersById, coursesById: { c: { id: 'c', holes } },
  roundPlayers: { r1: [rp('A', 0), rp('B', 18), rp('E', 5)], r2: [rp('A', 0), rp('B', 18)], r6: [rp('A', 0), rp('B', 18), rp('C', 9)], r7: [rp('A', 0), rp('C', 9)] },
  teamsByRound: {
    r3: [team('t3a', 'r3', ['A', 'B']), team('t3b', 'r3', ['C', 'D'])],
    r5: [team('t5a', 'r5', ['A', 'C']), team('t5b', 'r5', ['B', 'D'])],
    r6: [team('p1', 'r6', ['A', 'B']), team('p2', 'r6', ['C', 'D'])],
  },
  scoresIdx: {
    // Friday Stableford: A off 0 → 4 (2 pts), 3 (3 pts) = 5. B off 18 → 5, 5 (2 + 2) = 4. E off 5 → 5, 5 = 1 + 1... (shots on SI 1–5) 2 + 2 = 4.
    r1: { A: sc([4, 3]), B: sc([5, 5]), E: sc([5, 5]) },
    // Saturday: A 4, 4 = 4. B 4, 4 = 3 + 3 = 6.
    r2: { A: sc([4, 4]), B: sc([4, 4]) },
    // Sunday Ambrose (team handicap 0): A&B 3, 4 = −1; C&D 4, 4 = E.
    r3: { t3a: sc([3, 4]), t3b: sc([4, 4]) },
    // Monday Ambrose: A&C 4, 4 = E; B&D 3, 3 = −2.
    r5: { t5a: sc([4, 4]), t5b: sc([3, 3]) },
    // Wednesday stroke play: A off 0: 4, 5 = +1; C off 9: 5, 5 = 0 net (shots on SI 1, 2).
    r7: { A: sc([4, 5]), C: sc([5, 5]) },
  },
  quickResults: [],
  sideEntries: [
    { round_id: 'r1', kind: 'ctp', hole: 3, player_id: 'A', distance_m: 2.1 },
    { round_id: 'r1', kind: 'ctp', hole: 3, player_id: 'B', distance_m: 1.5 },
    { round_id: 'r1', kind: 'ld', hole: 5, player_id: 'A', distance_m: null, confirmed: true },
  ],
  ownDefs: [{ id: 'd1', name: 'Longest putt', emoji: '🕳️', how: 'highest' }],
  ownEntries: [{ round_id: 'r1', comp_id: 'd1', hole: null, player_id: 'C', value: 10, confirmed: false, created_at: '1' }],
  games: [],
  cupSides: [{ id: 's1', name: 'Blue', colour: '#1F4B9E', sort: 1, comp_id: null }, { id: 's2', name: 'Red', colour: '#B3261E', sort: 2, comp_id: null }],
  cupMatches: [
    { id: 'm1', round_id: 'r1', format: 'singles', a_players: ['A'], b_players: ['C'], points: 1, holes: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), 'a'])) },
    { id: 'm2', round_id: 'r2', format: 'singles', a_players: ['B'], b_players: ['C'], points: 1, holes: {} },
  ],
  honourBoard: [{ id: 'h1', trophy_name: 'Noodle Cup', trip_id: T, winner_names: 'Kurt', label: '2026', player_ids: [] }],
  trophies: [{ id: 'tr1', trip_id: T, name: 'BD', type: 'stableford_total' }, { id: 'tr2', trip_id: T, name: 'Noodle Cup', type: 'manual' }],
};
const comp = (kind, extra = {}) => ({ id: `c-${kind}`, trip_id: T, name: kind, kind, round_ids: [], settings: {}, trophy_id: null, sort: 0, ...extra });

describe('the catalogue', () => {
  it('has a plain-words card for every kind', () => {
    expect(COMP_KINDS).toEqual(['individual_points', 'individual_net', 'day', 'ambrose_teams', 'fourball_pairs', 'cup', 'side_comps', 'games', 'manual']);
    for (const t of COMP_TYPES) {
      expect(t.name.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.example).toMatch(/^e\.g\. /);
    }
  });
  it('knows which rounds fit which comps', () => {
    expect(fits('individual_points', rounds[0])).toBe(true);
    expect(fits('individual_points', rounds[2])).toBe(false);
    expect(fits('ambrose_teams', rounds[2])).toBe(true);
    expect(fits('fourball_pairs', rounds[4])).toBe(true);
    expect(fits('day', rounds[6 - 1])).toBe(true); // stroke
    expect(fits('cup', rounds[2])).toBe(true);
    expect(fits('manual', rounds[0])).toBe(false);
    expect(fits('nope', rounds[0])).toBe(false);
  });
  it('maps trophies both ways (older app versions understand three trophy types)', () => {
    expect(trophyTypeFor('individual_points')).toBe('stableford_total');
    expect(trophyTypeFor('ambrose_teams')).toBe('ambrose');
    expect(trophyTypeFor('cup')).toBe('manual');
    expect(kindForTrophy('stableford_total')).toBe('individual_points');
    expect(kindForTrophy('ambrose')).toBe('ambrose_teams');
    expect(kindForTrophy('manual')).toBe('manual');
  });
  it('keeps only settings that fit the kind (same as the database)', () => {
    expect(cleanSettings('ambrose_teams', { teams: 'fixed', pairs: 'fixed', junk: 1 })).toEqual({ teams: 'fixed' });
    expect(cleanSettings('fourball_pairs', { pairs: 'each_round' })).toEqual({ pairs: 'each_round' });
    expect(cleanSettings('individual_points', { teams: 'fixed', note: '  hi ' })).toEqual({ note: 'hi' });
    const id = '5a37650f-a98d-4366-8613-d8289f970152';
    expect(cleanSettings('cup', { points: '28', sessions: { [id]: { format: 'ambrose', points: 2, matches: '4', x: 1 }, bad: { points: 1 } } }))
      .toEqual({ points: 28, sessions: { [id]: { format: 'ambrose', points: 2, matches: 4 } } });
    expect(cleanSettings('cup', { points: 500, sessions: { [id]: { points: 50 } } })).toEqual({});
    expect(cleanSettings('side_comps', { most_wins: true })).toEqual({ most_wins: true });
  });
  it('names a new comp', () => {
    expect(defaultName('cup', { name: 'Hunter 2026' })).toBe('Hunter 2026 Cup');
    expect(defaultName('ambrose_teams')).toBe('Ambrose teams');
  });
});

describe('which comps and which rounds', () => {
  it('lists the trip’s comps, plus a stand-in for a trophy with no comp yet', () => {
    const comps = [comp('ambrose_teams', { sort: 2, trophy_id: null }), comp('manual', { trophy_id: 'tr2', sort: 1 }), comp('games', { retired: true }), { ...comp('day'), trip_id: 't2' }];
    const list = tripComps({ comps, trophies: base.trophies, tripId: T });
    expect(list.map((c) => c.kind)).toEqual(['manual', 'ambrose_teams', 'individual_points']);
    expect(list[2]).toMatchObject({ virtual: true, name: 'BD', trophy_id: 'tr1', id: 'trophy-tr1' });
  });
  it('counts all fitting rounds when none are picked, or just the picked ones', () => {
    expect(compRounds(comp('individual_points'), rounds).map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(compRounds(comp('individual_points', { round_ids: ['r2'] }), rounds).map((r) => r.id)).toEqual(['r2']);
    expect(compRounds(comp('ambrose_teams'), rounds).map((r) => r.id)).toEqual(['r3', 'r5']);
    expect(compRounds(comp('day'), rounds).map((r) => r.id)).toEqual(['r1']);
    expect(compRounds(comp('cup'), rounds).map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r5', 'r6', 'r7']);
    expect(compRounds(comp('manual'), rounds)).toEqual([]);
    expect(fittingRounds('fourball_pairs', rounds).map((r) => r.id)).toEqual(['r6']);
  });
  it('says the day, and what to do when no round fits', () => {
    expect(dayOf(rounds[0])).toBe('Friday');
    expect(dayOf({ name: 'Bonus round' })).toBe('Bonus round');
    const stablefordOnly = rounds.slice(0, 2);
    expect(noRoundHint('ambrose_teams', stablefordOnly)).toBe('Make Friday an Ambrose round first');
    expect(noRoundHint('fourball_pairs', stablefordOnly)).toBe('Make Friday a 4BBB round first');
    expect(noRoundHint('individual_net', stablefordOnly)).toBe('Make Friday a stroke play round first');
    expect(noRoundHint('individual_points', stablefordOnly)).toBe(null);
    expect(noRoundHint('ambrose_teams', [])).toBe('Add the trip’s rounds first');
    expect(noRoundHint('manual', [])).toBe(null);
  });
  it('finds the comps a round counts towards', () => {
    const comps = [comp('individual_points', { name: 'BD Trophy' }), comp('ambrose_teams', { name: 'Putt Buddies' }), comp('cup', { name: '6th Ryder Cup', round_ids: ['r1'] })];
    expect(roundComps(rounds[0], comps, rounds).map((c) => c.name)).toEqual(['BD Trophy', '6th Ryder Cup']);
    expect(roundComps(rounds[2], comps, rounds).map((c) => c.name)).toEqual(['Putt Buddies']);
    expect(roundComps(null, comps, rounds)).toEqual([]);
  });
});

describe('standings', () => {
  it('points over rounds: the same numbers as the Stableford trophy board', () => {
    const st = compStandings(comp('individual_points'), base);
    const old = stablefordTrophyBoard({ trip: { id: T }, rounds, coursesById: base.coursesById, roundPlayers: base.roundPlayers, playersById, scoresIdx: base.scoresIdx, quickResults: [] });
    expect(st.rows.map((r) => [r.name, r.total])).toEqual(old.rows.map((r) => [r.name, r.total]));
    expect(st.rows.map((r) => [r.name, r.value, r.text])).toEqual([['B', 10, '10 pts'], ['A', 9, '9 pts'], ['E', 4, '4 pts']]);
    expect(st.leaderText).toBe('B leads · 10 pts');
    expect(st.rounds.map((r) => r.id)).toEqual(['r1', 'r2']);
  });
  it('points over just the rounds picked', () => {
    const st = compStandings(comp('individual_points', { round_ids: ['r1'] }), base);
    expect(st.rows.map((r) => [r.name, r.value])).toEqual([['A', 5], ['B', 4], ['E', 4]]);
  });
  it('net strokes over rounds (lowest wins)', () => {
    const st = compStandings(comp('individual_net'), base);
    expect(st.higherBetter).toBe(false);
    expect(st.rows.map((r) => [r.name, r.text])).toEqual([['C', 'E'], ['A', '+1']]);
    expect(st.leaderText).toBe('C leads · E net');
  });
  it('day winner', () => {
    const st = compStandings(comp('day', { round_ids: ['r1'] }), base);
    expect(st.rows[0]).toMatchObject({ name: 'A', text: '5 pts' });
    expect(st.leaderText).toBe('A leads · 5 pts');
  });
  it('Ambrose teams over one round: best net wins', () => {
    const st = compStandings(comp('ambrose_teams', { round_ids: ['r3'] }), base);
    expect(st.rows.map((r) => [r.name, r.text])).toEqual([['A & B', '−1'], ['C & D', 'E']]);
    expect(st.leaderText).toBe('A & B lead · −1 net');
  });
  it('Ambrose teams over two rounds: new teams each round → each player carries their team’s score', () => {
    const st = compStandings(comp('ambrose_teams', { settings: { teams: 'each_round' } }), base);
    // A: −1 + 0 = −1; B: −1 − 2 = −3; C: 0 + 0 = 0; D: 0 − 2 = −2.
    expect(st.rows.map((r) => [r.name, r.text])).toEqual([['B', '−3'], ['D', '−2'], ['A', '−1'], ['C', 'E']]);
    expect(st.note).toMatch(/each player carries/);
  });
  it('Ambrose teams fixed for the trip: the same players are the same team', () => {
    const data = { ...base, teamsByRound: { ...base.teamsByRound, r5: [team('x1', 'r5', ['B', 'A']), team('x2', 'r5', ['C', 'D'])] }, scoresIdx: { ...base.scoresIdx, r5: { x1: sc([4, 4]), x2: sc([3, 3]) } } };
    const st = compStandings(comp('ambrose_teams', { settings: { teams: 'fixed' } }), data);
    // A&B: −1 + 0 = −1; C&D: 0 − 2 = −2.
    expect(st.rows.map((r) => [r.name, r.value])).toEqual([['C & D', -2], ['B & A', -1]]);
  });
  it('4BBB pairs', () => {
    const data = { ...base, scoresIdx: { ...base.scoresIdx, r6: { A: sc([4]), B: sc([5]), C: sc([4]), D: sc([6]) } } };
    const st = compStandings(comp('fourball_pairs'), data);
    expect(st.higherBetter).toBe(true);
    expect(st.rows[0].name).toBe('C & D');
    // Hole 1 (SI 1): A par 2, B 5 off 18 = 2 → 2. C 4 off 9 = net birdie 3, D 6 off 9 = 1 → 3.
    expect(st.rows.map((r) => [r.name, r.text])).toEqual([['C & D', '3 pts'], ['A & B', '2 pts']]);
    expect(st.leaderText).toBe('C & D lead · 3 pts');
  });
  it('the Cup: points from decided matches, the number to win, each session', () => {
    const st = compStandings(comp('cup', { settings: { points: 4 } }), base);
    expect(st.rows.map((r) => [r.name, r.value])).toEqual([['Blue', 1], ['Red', 0]]);
    expect(st.toWin).toBe(2.5);
    expect(st.perRound.find((p) => p.round.id === 'r1')).toMatchObject({ matches: 1, won: { a: 1, b: 0 } });
    expect(st.leaderText).toBe('Blue 1 – 0 Red');
    expect(st.note).toBe('4 points in the Cup · 2½ to win.');
  });
  it('the Cup only counts its rounds, and falls back to the trip’s cup points', () => {
    const data = { ...base, trips: [{ id: T, cup_points: 10 }] };
    const st = compStandings(comp('cup', { round_ids: ['r2'] }), data);
    expect(st.won).toEqual({ a: 0, b: 0 });
    expect(st.total).toBe(10);
  });
  it('the Cup with no sides yet says so', () => {
    const st = compStandings(comp('cup'), { ...base, cupSides: [] });
    expect(st.empty).toMatch(/sides/);
    expect(st.rows).toEqual([]);
  });
  it('side comps: closest to pin, longest drive and own comps, most wins', () => {
    const st = compStandings(comp('side_comps'), base);
    expect(st.results.map((r) => [r.label, r.winner])).toEqual([['Friday 🎯 CTP 3', 'B'], ['Friday 💣 LD 5', 'A'], ['Friday 🕳️ Longest putt', 'C']]);
    expect(st.rows.map((r) => [r.name, r.text])).toEqual([['A', '1 win'], ['B', '1 win'], ['C', '1 win']]);
  });
  it('games: the money tally over the rounds', () => {
    const data = { ...base, rounds: rounds.map((r) => (r.id === 'r1' ? { ...r, status: 'locked' } : r)), games: [{ id: 'g1', round_id: 'r1', kind: 'stableford_pot', stake: 10, options: {} }] };
    const st = compStandings(comp('games', { round_ids: ['r1'] }), data);
    expect(st.games).toBe(1);
    expect(st.rows.reduce((s, r) => s + r.value, 0)).toBe(0);
    expect(st.rows[0]).toMatchObject({ name: 'A', text: '+$20' });
  });
  it('awarded: the winner engraved on this trip', () => {
    const st = compStandings(comp('manual', { name: 'Noodle Cup', trophy_id: 'tr2' }), base);
    expect(st.rows[0]).toMatchObject({ name: 'Kurt', text: '2026' });
    expect(st.leaderText).toBe('Won by Kurt');
    expect(compStandings(comp('manual', { name: 'Shirt of the Day' }), base).empty).toBe('Not awarded yet.');
  });
  it('says when nothing counts yet', () => {
    const st = compStandings(comp('fourball_pairs'), { ...base, rounds: rounds.slice(0, 2) });
    expect(st.empty).toBe('No 4BBB round counts yet.');
  });
});

describe('the Cup’s sides', () => {
  it('uses the sides linked to the comp, else the group’s unlinked sides', () => {
    const sides = [{ id: 's1', sort: 1, comp_id: 'c1' }, { id: 's2', sort: 2, comp_id: 'c1' }];
    expect(cupSides({ id: 'c1' }, sides).map((s) => s.id)).toEqual(['s1', 's2']);
    expect(cupSides({ id: 'c2' }, base.cupSides).map((s) => s.id)).toEqual(['s1', 's2']);
    expect(cupSides({ id: 'c2' }, sides)).toEqual([]);
  });
});

describe('the to-do list', () => {
  const texts = (items) => items.map((i) => [i.text, i.done]);
  it('individual: who’s playing each counting round', () => {
    const items = compNeeds(comp('individual_points'), base);
    expect(texts(items)).toEqual([['Friday: 3 playing', true], ['Saturday: 2 playing', true]]);
    const data = { ...base, roundPlayers: { r1: [rp('A', 0)] } };
    expect(texts(compNeeds(comp('individual_points'), data))).toEqual([['Friday: only 1 playing — add the rest', false], ['Saturday: pick who’s playing', false]]);
    expect(compNeeds(comp('individual_points'), data)[1].action).toEqual({ kind: 'round_players', roundId: 'r2' });
  });
  it('Ambrose: players on the trip not in a team', () => {
    const items = compNeeds(comp('ambrose_teams', { round_ids: ['r3'] }), base);
    // E plays Friday but isn't in a Sunday team.
    expect(texts(items)).toEqual([['Sunday: Ambrose teams — 1 player not in a team', false]]);
    expect(items[0].action).toEqual({ kind: 'round_teams', roundId: 'r3' });
    const full = { ...base, roundPlayers: {} , teamsByRound: { r3: base.teamsByRound.r3 } };
    expect(texts(compNeeds(comp('ambrose_teams', { round_ids: ['r3'] }), full))).toEqual([['Sunday: 2 teams made', true]]);
    const none = { ...base, teamsByRound: {} };
    expect(texts(compNeeds(comp('ambrose_teams', { round_ids: ['r3'] }), none))).toEqual([['Sunday: make the Ambrose teams', false]]);
  });
  it('Ambrose fixed for the trip: says when a later round’s teams differ', () => {
    const full = { ...base, roundPlayers: {} };
    const items = compNeeds(comp('ambrose_teams', { settings: { teams: 'fixed' } }), full);
    expect(texts(items)).toContainEqual(['Monday: teams differ from Sunday (they’re fixed for the trip)', false]);
  });
  it('4BBB: pairs and playing handicaps', () => {
    const items = compNeeds(comp('fourball_pairs'), { ...base, roundPlayers: { r6: base.roundPlayers.r6 } });
    expect(texts(items)).toEqual([['Tuesday: 2 pairs made', true], ['Tuesday: playing handicaps — 1 not set', false]]);
    const odd = { ...base, teamsByRound: { r6: [team('p1', 'r6', ['A', 'B', 'C'])] } };
    expect(compNeeds(comp('fourball_pairs'), odd)[0].text).toBe('Tuesday: 1 pair without two players');
  });
  it('a round that doesn’t fit, and no round at all', () => {
    expect(texts(compNeeds(comp('ambrose_teams', { round_ids: ['r1'] }), base))).toEqual([['Friday is Stableford — this comp needs Ambrose', false]]);
    const items = compNeeds(comp('ambrose_teams'), { ...base, rounds: rounds.slice(0, 2) });
    expect(texts(items)).toEqual([['Make Friday an Ambrose round first', false]]);
    expect(items[0].action).toEqual({ kind: 'round_format', roundId: 'r1' });
    expect(compNeeds(comp('ambrose_teams'), { ...base, rounds: [] })[0].action.kind).toBe('add_round');
  });
  it('the Cup: sides, everyone on a side, matches per session, points', () => {
    const items = compNeeds(comp('cup', { round_ids: ['r1', 'r2'], settings: { sessions: { r1: { matches: 2 } } } }), base);
    expect(texts(items)).toEqual([
      ['Cup: Blue v Red', true],
      ['Cup: 2 players not on a side', false],
      ['Friday: 1 of 2 matches made', false],
      ['Saturday: 1 of 1 matches made', true],
      ['Cup: set the points in the whole Cup', false],
    ]);
    expect(items.every((i) => i.action.kind === 'cup_setup')).toBe(true);
    expect(texts(compNeeds(comp('cup'), { ...base, cupSides: [] }))[0]).toEqual(['Cup: make the two sides', false]);
    expect(compNeeds(comp('cup', { settings: { points: 28 } }), base).at(-1).text).toBe('Cup: 28 points, 14½ to win');
  });
  it('side comps: holes set per round', () => {
    expect(texts(compNeeds(comp('side_comps', { round_ids: ['r1', 'r2'] }), base))).toEqual([
      ['Friday: CTP 3 · LD 5 · 1 own comp', true],
      ['Saturday: closest-to-pin / longest-drive holes not set', false],
    ]);
  });
  it('games: a game on each round', () => {
    const data = { ...base, games: [{ id: 'g', round_id: 'r1', kind: 'skins' }] };
    expect(texts(compNeeds(comp('games', { round_ids: ['r1', 'r2'] }), data))).toEqual([['Friday: Skins', true], ['Saturday: no games yet', false]]);
  });
  it('awarded with a trophy: engrave the winner', () => {
    expect(texts(compNeeds(comp('manual', { name: 'Noodle Cup', trophy_id: 'tr2' }), base))).toEqual([['Engraved: Kurt', true]]);
    expect(texts(compNeeds(comp('manual', { name: 'Shirt', trophy_id: 'trX' }), base))).toEqual([['Engrave the winner when it’s decided', false]]);
    expect(compNeeds(comp('manual'), base)).toEqual([]);
  });
  it('sums up, and every action has a place to go', () => {
    expect(needsSummary([{ done: true }, { done: false }])).toEqual({ todo: 1, total: 2, text: '1 to do' });
    expect(needsSummary([{ done: true }]).text).toBe('All set');
    expect(needsSummary([]).text).toBe('');
    for (const k of ['cup_setup', 'engrave', 'add_round', 'round_format', 'round_players', 'round_teams', 'round_pairs', 'side_holes', 'games']) {
      expect(actionPath({ kind: k, roundId: 'r1' })).toMatch(/^\//);
      expect(actionLabel({ kind: k })).not.toBe('Open');
    }
    expect(actionPath({ kind: 'round_teams', roundId: 'r3' })).toBe('/admin?round=r3');
    expect(actionPath(null)).toBe(null);
  });
  it('who’s on the trip', () => {
    expect(tripPlayerIds(rounds.slice(0, 1), base).sort()).toEqual(['A', 'B', 'E']);
    expect(tripPlayerIds([], base).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  it('every kind has a type entry', () => {
    for (const k of COMP_KINDS) expect(COMP_TYPE[k].kind).toBe(k);
  });
});
