// ov28 (walkthrough C1, D2, W1 and the small fixes): match results, the Cup verdict, the board's order, "joint lead",
// "won" not "leads", and the BD Trophy listed once.
import { describe, it, expect } from 'vitest';
import { matchState, matchText, cupVerdict } from './cup.js';
import { orderBoard, leaderWords, roundBoard, headlines } from './board.js';
import { tripComps, compStandings, leadWho } from './comps.js';
import { strokesReceived, stablefordPoints } from './scoring.js';
import { cupState, cupSwing, passedOnPoints, passedText, shotsOn, holePoints, swingGapMinutes } from '../../supabase/functions/_shared/swing.js';

const H = (list) => Object.fromEntries(list.map((r, i) => [String(i + 1), r]));

describe('match play results (no "10&2")', () => {
  it('the match stops the moment it is decided', () => {
    // A wins the first 10 holes, then everything typed in after hole 10 is ignored.
    const holes = H(['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'b', 'h', 'a', 'a']);
    const s = matchState({ holes });
    expect(s.decided).toBe(true);
    expect(s.played).toBe(10);
    expect(s.extra).toBe(6);
    expect(matchText({ holes }, { a: 'Blue', b: 'Red' })).toBe('Blue won 10&8');
  });
  it('normal results still read the same', () => {
    expect(matchText({ holes: H(Array(16).fill('h').map((x, i) => (i < 4 ? 'a' : x))) }, { a: 'Blue', b: 'Red' })).toBe('Blue won 4&3');
    expect(matchText({ holes: H([...Array(17).fill('h'), 'b']) }, { a: 'Blue', b: 'Red' })).toBe('Red won 1 UP');
  });
});

describe('the Cup verdict', () => {
  const names = { a: 'Team Blue', b: 'Team Red' };
  const won = (side, pts = 2) => ({ points: pts, holes: H(Array(10).fill(side)) });
  it('a side past half wins', () => {
    expect(cupVerdict({ matches: [won('a'), won('a'), won('a'), won('a'), won('b')], total: 12, names }).text).toBe('Team Blue win 8–2');
  });
  it('all played and level', () => {
    const halved = { points: 2, holes: H(Array(18).fill('h')) };
    expect(cupVerdict({ matches: [won('a'), won('b'), halved], names })).toMatchObject({ status: 'halved', text: 'All square 3–3' });
  });
  it('a finished trip with points not played says so', () => {
    expect(cupVerdict({ matches: [won('a'), won('b'), won('a'), { points: 2, holes: {} }], total: 12, names, finished: true }).text)
      .toBe('Not finished: 6 of 12 points played · Team Blue 4–2 Team Red');
  });
  it('still going', () => {
    expect(cupVerdict({ matches: [won('a')], total: 12, names })).toMatchObject({ status: 'live', text: 'Team Blue 2 – 0 Team Red' });
    expect(cupVerdict({ matches: [], names }).status).toBe('none');
  });
});

describe('the leaderboard order (D2)', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
  const course = { holes };
  const score = (n, strokes) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, { strokes }]));
  const round = { id: 'r', format: 'stableford' };
  const roundPlayers = [{ player_id: 'lou', playing_handicap: 0 }, { player_id: 'mo', playing_handicap: 0 }];
  const playersById = { lou: { name: 'Lou' }, mo: { name: 'Mo' } };
  // Lou: 7 holes of 3s (3 pts each = 21... use par: 4 strokes = 2 pts) — Lou 7 holes × 2 = 14 + birdie; Mo 9 holes × 2 = 18.
  const scoresIdx = { r: { lou: { ...score(7, 4), 1: { strokes: 3 } }, mo: score(9, 4) } };
  const board = roundBoard({ round, course, roundPlayers, playersById, scoresIdx });
  it('points first by default; pace keeps the old order', () => {
    expect(board.rows.map((r) => r.name)).toEqual(['Lou', 'Mo']); // +1 v level on pace
    const pts = orderBoard(board);
    expect(pts.rows.map((r) => [r.name, r.points, r.rankLabel])).toEqual([['Mo', 18, '1'], ['Lou', 15, '2']]);
    expect(orderBoard(board, 'pace')).toBe(board);
    expect(orderBoard({ format: 'ambrose', rows: [] })).toEqual({ format: 'ambrose', rows: [] });
  });
  it('joint lead in words', () => {
    expect(leaderWords([{ name: 'Lou', rank: 1, thru: 7 }, { name: 'Mo', rank: 1, thru: 9 }]).text).toBe('Lou and Mo joint lead');
    expect(leaderWords([{ name: 'Lou', rank: 1, thru: 7 }, { name: 'Mo', rank: 2, thru: 9 }]).text).toBe('Lou leads');
    expect(leaderWords([{ name: 'Lou', rank: 1, thru: 18 }], { finished: true }).text).toBe('Lou won');
    expect(leaderWords([{ name: 'Lou', rank: 1, thru: 0 }]).text).toBeNull();
    expect(leadWho([{ name: 'A', rank: 1 }, { name: 'B', rank: 1 }], true)).toBe('A and B tie for first');
  });
  it('the headline agrees with the board', () => {
    const tied = { ...board, rows: [{ ...board.rows[0], rank: 1 }, { ...board.rows[1], rank: 1 }] };
    expect(headlines(tied, null)[0]).toMatchObject({ label: 'Joint lead' });
  });
});

describe('comps: "won" once it\'s over, and the BD Trophy once', () => {
  it('a trophy with the same name as a comp isn\'t listed twice', () => {
    const comps = [{ id: 'c1', trip_id: 't', name: 'BD Trophy', kind: 'individual_points', trophy_id: null, sort: 0 }];
    const trophies = [{ id: 'tr', trip_id: 't', name: 'BD Trophy', type: 'stableford_total' }, { id: 'n', trip_id: 't', name: 'Noodle Cup', type: 'manual' }];
    expect(tripComps({ comps, trophies, tripId: 't' }).map((c) => c.name)).toEqual(['BD Trophy', 'Noodle Cup']);
    const two = [{ id: 'c1', trip_id: 't', name: 'BD Trophy', kind: 'individual_points', trophy_id: 'tr' }, { id: 'c2', trip_id: 't', name: 'BD Trophy (old)', kind: 'individual_points', trophy_id: 'tr' }];
    expect(tripComps({ comps: two, trophies, tripId: 't' }).filter((c) => c.trophy_id === 'tr')).toHaveLength(1);
  });
  it('points over rounds: "won" when every round is locked', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
    const rounds = [{ id: 'r', trip_id: 't', format: 'stableford', status: 'locked', course_id: 'c' }];
    const data = {
      rounds, coursesById: { c: { holes } }, roundPlayers: { r: [{ player_id: 'mo', playing_handicap: 0 }] }, playersById: { mo: { name: 'Mo' } },
      scoresIdx: { r: { mo: Object.fromEntries(holes.map((h) => [h.n, { strokes: 4 }])) } },
    };
    const st = compStandings({ id: 'c1', trip_id: 't', kind: 'individual_points', round_ids: [] }, data);
    expect(st.leaderText).toBe('Mo won · 36 pts');
    expect(st.finished).toBe(true);
    const live = compStandings({ id: 'c1', trip_id: 't', kind: 'individual_points', round_ids: [] }, { ...data, rounds: [{ ...rounds[0], status: 'live' }] });
    expect(live.leaderText).toBe('Mo leads · 36 pts');
  });
});

describe('swing alerts (I13) — shared with the notify function', () => {
  it('scoring parity with the app', () => {
    for (const h of [-4, 0, 7, 18, 27, 36]) for (const si of [1, 9, 18]) expect(shotsOn(h, si)).toBe(strokesReceived(h, si));
    expect(holePoints({ par: 4, si: 1 }, 4, 18)).toBe(stablefordPoints({ par: 4, si: 1 }, 4, 18));
  });
  it('a Cup match swings only when the lead changes hands or goes back to level', () => {
    const names = { a: 'Blue', b: 'Red' };
    expect(cupState(H(['a', 'b']))).toMatchObject({ up: 0, played: 2 });
    expect(cupSwing({ holes: H(['a', 'b']), hole: 2, names })).toBeNull(); // only 2 played: back to level early on
    const late = H(['a', 'a', 'h', 'h', 'h', 'h', 'h', 'h', 'h', 'b', 'b']);
    expect(cupSwing({ holes: late, hole: 11, names })).toEqual({ key: 'as:11', text: 'Red win the 11th — all square after 11', leader: null });
    expect(cupSwing({ holes: H(['a', 'a', 'h']), hole: 3, names })).toBeNull(); // no change
    const flip = H(['a', 'h', 'h', 'h', 'h', 'h', 'h', 'h', 'h', 'b', 'b']);
    expect(cupSwing({ holes: flip, hole: 11, names }).text).toBe('Red win the 11th — Red now 1 UP');
    expect(cupSwing({ holes: {}, hole: 3, names })).toBeNull();
  });
  it('passing someone on points', () => {
    const holes = [{ n: 1, par: 4, si: 1 }, { n: 2, par: 4, si: 2 }];
    const scores = [
      { player_id: 'me', hole: 1, strokes: 4 }, { player_id: 'me', hole: 2, strokes: 3 },
      { player_id: 'mo', hole: 1, strokes: 3 }, { player_id: 'bo', hole: 1, strokes: 2 },
    ];
    const out = passedOnPoints({ holes, scores, hcps: { me: 0, mo: 0, bo: 0 }, mover: 'me', hole: 2 });
    expect(out).toEqual({ passed: ['mo', 'bo'], points: 5, thru: 2 }); // was 2, now 5: past Mo (3) and Bo (4)
    expect(passedText(['Mo'], 5, 2)).toBe('You’ve just passed Mo — 5 pts thru 2');
    expect(swingGapMinutes('feed')).toBeNull();
    expect(swingGapMinutes('often')).toBe(10);
    expect(swingGapMinutes()).toBe(30);
  });
});
