import { describe, it, expect } from 'vitest';
import { buildReplay, isRoundFinished, raceSubjects, gapWords, holeWord, sideCompWinners } from './replay.js';
import { buildStory } from './replaybeats.js';
import { roundBoard } from './board.js';
import {
  LINES, STYLES, pickLine, fill, captionFor, pickInJoke, popWord, ordinal, savedStyle, saveStyle, DEFAULT_STYLE,
  popFor, topMoment,
} from './replay-lines.js';

const PARS = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]];
const course = { id: 'c1', name: 'Cypress Lakes', holes: PARS.map(([par, si], i) => ({ n: i + 1, par, si })) };
const par = (n) => PARS[n - 1][0];
const t = (n, extra = 0) => new Date(Date.UTC(2026, 9, 21, 8, n * 10 + extra)).toISOString();

/** Score rows for a subject: diffs[hole-1] = strokes over par (null = no score). `start` = first hole (shotgun). */
function rows(roundId, subject, diffs, { start = 1, type = 'player' } = {}) {
  const out = [];
  for (let i = 0; i < 18; i++) {
    const n = ((start - 1 + i) % 18) + 1;
    const d = diffs[n - 1];
    if (d == null) continue;
    out.push({ round_id: roundId, subject_id: subject, subject_type: type, hole: n, strokes: par(n) + d, picked_up: false, updated_at: t(i) });
  }
  return out;
}
const zeros = () => Array(18).fill(0);
const P = (id, name) => ({ id, name, nickname: null, handicap: 0 });

// Stableford, everyone off scratch: A leads early (birdie 1), blows up on 10; B birdies 10 and 11 and wins by 2 from C.
function stableford() {
  const round = { id: 'r1', name: 'Saturday', format: 'stableford', status: 'locked', course_id: 'c1', ctp_holes: [], ld_holes: [] };
  const players = [P('a', 'Al'), P('b', 'Bo'), P('c', 'Cy'), P('d', 'Di')];
  const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
  const roundPlayers = players.map((p) => ({ round_id: 'r1', player_id: p.id, playing_handicap: 0 }));
  const a = zeros(); a[0] = -1; a[9] = 3;
  const b = zeros(); b[9] = -1; b[10] = -1;
  const d = Array(18).fill(1);
  const scores = [...rows('r1', 'a', a), ...rows('r1', 'b', b), ...rows('r1', 'c', zeros()), ...rows('r1', 'd', d)];
  return { round, course, roundPlayers, playersById, scores };
}

describe('buildReplay — Stableford', () => {
  const input = stableford();
  const r = buildReplay(input);

  it('has a frame per hole, labelled with the hole', () => {
    expect(r.frames).toHaveLength(18);
    expect(r.frames[0].label).toBe('Hole 1');
    expect(r.frames[0].par).toBe(5);
    expect(r.unit).toBe('points');
  });

  it('frames are the leaderboard after each hole', () => {
    const f1 = r.frames[0];
    expect(f1.rows[0].name).toBe('Al');
    expect(f1.rows[0].score).toBe(3);
    expect(f1.rows.every((x) => x.thru === 1)).toBe(true);
    const f9 = r.frames[8];
    expect(f9.rows.find((x) => x.id === 'a').score).toBe(19);
    expect(f9.rows.find((x) => x.id === 'b').score).toBe(18);
  });

  it('spots the lead change on 10, the birdies and the blow-up', () => {
    const f10 = r.frames[9];
    const kinds = f10.moments.map((m) => m.kind);
    expect(kinds).toContain('lead_change');
    const lc = f10.moments.find((m) => m.kind === 'lead_change');
    expect(lc.name).toBe('Bo');
    expect(lc.other).toBe('Al');
    expect(f10.moments.find((m) => m.kind === 'blowup')).toMatchObject({ name: 'Al', over: 3, hole: 10 });
    expect(f10.moments.find((m) => m.kind === 'birdie')).toMatchObject({ name: 'Bo', hole: 10 });
    expect(r.frames[0].moments.find((m) => m.kind === 'birdie')).toMatchObject({ name: 'Al', hole: 1 });
    expect(r.frames[0].moments.find((m) => m.kind === 'new_leader')).toMatchObject({ name: 'Al' });
  });

  it('moments are sorted by drama; dramatic frames outrank quiet ones', () => {
    for (const f of r.frames) for (let i = 1; i < f.moments.length; i++) expect(f.moments[i - 1].drama).toBeGreaterThanOrEqual(f.moments[i].drama);
    expect(r.frames[9].drama).toBeGreaterThan(r.frames[4].drama);
  });

  it('a close finish: 2 points in it with 3 to play', () => {
    expect(r.finish).toMatchObject({ left: 3, gap: 2, gapText: '2 points', close: true, leader: 'Bo', second: 'Cy' });
    expect(r.finish.chances.length).toBeGreaterThan(0);
    expect(r.finish.chances.reduce((a, c) => a + c.winPct, 0)).toBeLessThanOrEqual(101);
    expect(r.frames[r.finish.frameIndex].moments.some((m) => m.kind === 'close')).toBe(true);
  });

  it('the winner matches the leaderboard', () => {
    const board = roundBoard({ round: input.round, course, roundPlayers: input.roundPlayers, playersById: input.playersById, scoresIdx: { r1: Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, Object.fromEntries(input.scores.filter((s) => s.subject_id === id).map((s) => [s.hole, s]))])) } });
    expect(r.winner.name).toBe(board.rows[0].name);
    expect(r.winner).toMatchObject({ name: 'Bo', score: 38, by: '2 points' });
    expect(r.frames[17].moments[0].kind).toBe('win');
  });

  it('awards: biggest climber, worst hole, best hole', () => {
    expect(r.awards.climber).toMatchObject({ name: 'Bo', places: 1, to: 1 });
    expect(r.awards.worst).toMatchObject({ name: 'Al', hole: 10, diff: 3 });
    // Birdies on 1 (SI 17), 10 (SI 6) and 11 (SI 14): the hardest hole wins.
    expect(r.awards.best).toMatchObject({ name: 'Bo', hole: 10, diff: -1 });
  });
});

describe('buildReplay — other formats', () => {
  it('Ambrose: team scores, net, side comp bonus once the hole is played', () => {
    const round = { id: 'r2', name: 'Ambrose', format: 'ambrose', status: 'locked', course_id: 'c1', ctp_holes: [3], ld_holes: [], comp_bonus: 1 };
    const pl = [P('a', 'Al'), P('b', 'Bo'), P('c', 'Cy'), P('d', 'Di')];
    const teams = [
      { id: 't1', name: 'Hackers', handicap: 0, players: [pl[0], pl[1]] },
      { id: 't2', name: 'Slicers', handicap: 0, players: [pl[2], pl[3]] },
    ];
    const t2 = zeros(); t2[0] = -1;
    const scores = [...rows('r2', 't1', zeros(), { type: 'team' }), ...rows('r2', 't2', t2, { type: 'team' })];
    const side = [{ round_id: 'r2', kind: 'ctp', hole: 3, player_id: 'a', distance_m: 2.1, confirmed: false }];
    const r = buildReplay({ round, course, teams, roundPlayers: [], playersById: Object.fromEntries(pl.map((p) => [p.id, p])), scores, sideEntries: side });
    expect(r.unit).toBe('shots');
    expect(r.teams).toBe(true);
    expect(r.frames[0].rows[0]).toMatchObject({ name: 'Slicers', display: '−1' });
    // Before hole 3 the CTP bonus isn't counted; from 3 it is (Hackers −1 back to level with Slicers).
    expect(r.frames[1].rows.find((x) => x.id === 't1').score).toBe(0);
    expect(r.frames[2].rows.find((x) => x.id === 't1').score).toBe(-1);
    expect(r.frames[2].moments.find((m) => m.kind === 'side_comp')).toMatchObject({ name: 'Al', comp: 'closest to the pin', hole: 3 });
    expect(r.frames[0].moments.find((m) => m.kind === 'birdie')).toMatchObject({ name: 'Slicers' });
  });

  it('stroke play: net to par, lower better', () => {
    const round = { id: 'r3', name: 'Stroke', format: 'stroke', status: 'live', course_id: 'c1' };
    const pl = [P('a', 'Al'), P('b', 'Bo')];
    const a = zeros(); a[17] = -1;
    const scores = [...rows('r3', 'a', a), ...rows('r3', 'b', zeros())];
    const r = buildReplay({ round, course, roundPlayers: pl.map((p) => ({ player_id: p.id, playing_handicap: 0 })), playersById: Object.fromEntries(pl.map((p) => [p.id, p])), scores });
    expect(r.winner).toMatchObject({ name: 'Al', display: '−1', by: '1 shot' });
    // Level for 17 holes, then Al's birdie on 18 gives him the outright lead for the first time.
    expect(r.frames[17].moments.map((m) => m.kind)).toEqual(['win', 'new_leader', 'birdie']);
    expect(r.frames[16].moments.map((m) => m.kind)).toEqual([]);
  });

  it('4BBB: pairs race, a birdie names the player', () => {
    const round = { id: 'r4', name: '4BBB', format: 'fourball', status: 'locked', course_id: 'c1' };
    const pl = [P('a', 'Al'), P('b', 'Bo'), P('c', 'Cy'), P('d', 'Di')];
    const teams = [{ id: 'p1', name: 'Al & Bo', players: [pl[0], pl[1]] }, { id: 'p2', name: 'Cy & Di', players: [pl[2], pl[3]] }];
    const b = zeros(); b[1] = -1;
    const scores = [...rows('r4', 'a', zeros()), ...rows('r4', 'b', b), ...rows('r4', 'c', zeros()), ...rows('r4', 'd', zeros())];
    const r = buildReplay({ round, course, teams, roundPlayers: pl.map((p) => ({ player_id: p.id, playing_handicap: 0 })), playersById: Object.fromEntries(pl.map((p) => [p.id, p])), scores });
    expect(r.frames).toHaveLength(18);
    expect(r.frames[1].moments.find((m) => m.kind === 'birdie')).toMatchObject({ name: 'Bo', subjectId: 'p1', playerId: 'b' });
    expect(r.winner).toMatchObject({ name: 'Al & Bo', score: 37 });
  });

  it('shotgun start: holes go in the order they were played', () => {
    const subs = raceSubjects({
      round: { format: 'stableford' }, roundPlayers: [{ player_id: 'a' }], playersById: { a: P('a', 'Al') },
      scoresBySubject: { a: Object.fromEntries(rows('r', 'a', zeros(), { start: 10 }).map((s) => [s.hole, s])) },
      holeNums: course.holes.map((h) => h.n),
    });
    expect(subs[0].order.slice(0, 3)).toEqual([10, 11, 12]);
    expect(subs[0].order[17]).toBe(9);
  });

  it('mixed starts: the frame says how many holes in, not a hole number', () => {
    const input = stableford();
    input.scores = [...rows('r1', 'a', zeros()), ...rows('r1', 'b', zeros(), { start: 10 })];
    input.roundPlayers = input.roundPlayers.slice(0, 2);
    const r = buildReplay(input);
    expect(r.frames[0]).toMatchObject({ hole: null, label: '1 hole in' });
  });

  it('an empty round has nothing to replay', () => {
    const r = buildReplay({ round: { id: 'x', format: 'stableford' }, course, roundPlayers: [{ player_id: 'a' }], playersById: {}, scores: [] });
    expect(r.empty).toBe(true);
    expect(r.winner).toBeNull();
    expect(buildStory(r).steps).toEqual([{ scene: 'end', kind: 'end', text: '', ms: null }]);
  });

  it('typed-in (quick) cards join at the end, so the winner still matches the leaderboard', () => {
    const input = stableford();
    input.roundPlayers.push({ round_id: 'r1', player_id: 'q', playing_handicap: 0 });
    input.playersById.q = P('q', 'Quinn');
    const r = buildReplay({ ...input, quickResults: [{ round_id: 'r1', player_id: 'q', points: 41 }] });
    expect(r.frames[5].rows.find((x) => x.id === 'q').thru).toBe(0);
    expect(r.winner.name).toBe('Quinn');
  });
});

describe('side comps and posts', () => {
  it('own comps: a confirmed or measured winner; whole-round comps at the end', () => {
    const round = { id: 'r1', own_comps: [{ comp: 'k1', holes: [5] }, { comp: 'k2', holes: [] }] };
    const defs = [{ id: 'k1', name: 'Longest putt', emoji: '🐍', how: 'highest' }, { id: 'k2', name: 'Best shot', emoji: '📸', how: 'pick' }];
    const entries = [
      { comp_id: 'k1', hole: 5, player_id: 'a', value: 8, confirmed: false, created_at: t(1) },
      { comp_id: 'k1', hole: 5, player_id: 'b', value: 12, confirmed: false, created_at: t(2) },
      { comp_id: 'k2', hole: null, player_id: 'c', value: null, confirmed: false, created_at: t(3) },
    ];
    const w = sideCompWinners({ round, ownDefs: defs, ownEntries: entries });
    expect(w).toEqual([{ comp: 'Longest putt', emoji: '🐍', hole: 5, playerId: 'b' }]); // a 'pick' needs the organiser's say-so
    entries[2].confirmed = true;
    expect(sideCompWinners({ round, ownDefs: defs, ownEntries: entries })[1]).toMatchObject({ comp: 'Best shot', hole: null, playerId: 'c' });
  });

  it('people’s feed posts land on the hole they were posted during', () => {
    const input = stableford();
    const r = buildReplay({ ...input, posts: [
      { round_id: 'r1', kind: 'user', player_id: 'c', body: 'Lost a ball in the dam', created_at: t(4, 5) },
      { round_id: 'r1', kind: 'auto', body: 'Birdie!', created_at: t(1) },
      { round_id: 'other', kind: 'user', body: 'wrong round', created_at: t(1) },
    ] });
    const all = r.frames.flatMap((f, i) => f.moments.filter((m) => m.kind === 'post').map((m) => ({ i, m })));
    expect(all).toHaveLength(1);
    expect(all[0].i).toBe(5);
    expect(all[0].m).toMatchObject({ name: 'Cy', text: 'Lost a ball in the dam' });
  });
});

// The story (beats, lines, timing) is tested in replaybeats.test.js.

describe('small helpers', () => {
  it('isRoundFinished: locked, or everyone done', () => {
    expect(isRoundFinished({ status: 'locked' }, { rows: [] })).toBe(true);
    expect(isRoundFinished({ status: 'live' }, { rows: [{ finished: true }, { finished: true }] })).toBe(true);
    expect(isRoundFinished({ status: 'live' }, { rows: [{ finished: true }, { finished: false }] })).toBe(false);
    expect(isRoundFinished({ status: 'live' }, { rows: [] })).toBe(false);
    expect(isRoundFinished(null)).toBe(false);
  });
  it('words', () => {
    expect(gapWords('stableford', 1)).toBe('1 point');
    expect(gapWords('ambrose', 1.5)).toBe('1.5 shots');
    expect(holeWord(1, 3)).toBe('hole in one');
    expect(holeWord(3, 5)).toBe('eagle');
    expect(holeWord(9, 4)).toBe('+5');
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(23)).toBe('23rd');
  });
});

describe('replay lines', () => {
  const KINDS = Object.keys(LINES.broadcast);

  it('both styles cover every moment', () => {
    expect(STYLES.map((s) => s.key)).toEqual(['broadcast', 'larrikins']);
    for (const style of Object.keys(LINES)) for (const k of KINDS) expect(LINES[style][k]?.length, `${style}.${k}`).toBeGreaterThan(0);
    expect(Object.keys(LINES.larrikins).sort()).toEqual([...KINDS].sort());
  });

  it('guardrails: no race, religion, sexuality, disability or tragedy; no real commentators', () => {
    const banned = /\b(god|jesus|christ|pray|prayer|church|heaven|hell|miracle|gay|queer|blind|deaf|lame|crippl\w*|retard\w*|spastic|mental|psycho|autis\w*|tragedy|tragic|disaster|funeral|dead|died|die|death|kill\w*|murder\w*|cancer|race|racial|black|white|asian|girl|boys? club|benaud|alliss|nantz|feherty|mccord|faldo|maltbie|kostis|lawrenson|critchley|bill lawrie)\b/i;
    for (const style of Object.keys(LINES)) for (const k of KINDS) for (const line of LINES[style][k]) expect(line, `${style}.${k}`).not.toMatch(banned);
  });

  it('every placeholder is a known one', () => {
    const known = new Set(['name', 'other', 'hole', 'par', 'strokes', 'over', 'places', 'rank', 'gap', 'left', 'comp', 'score', 'by', 'round', 'course', 'count', 'text', 'holes']);
    for (const style of Object.keys(LINES)) for (const k of KINDS) for (const line of LINES[style][k]) for (const [, v] of line.matchAll(/\{(\w+)\}/g)) expect(known.has(v), `${style}.${k}: {${v}}`).toBe(true);
  });

  it('fill and pick are steady (same seed, same line)', () => {
    expect(fill('Hi {name}, {missing}!', { name: 'Al' })).toBe('Hi Al, !');
    expect(pickLine('birdie', 'broadcast', { name: 'Al', hole: 'the 3rd' }, 7)).toBe(pickLine('birdie', 'broadcast', { name: 'Al', hole: 'the 3rd' }, 7));
    expect(pickLine('birdie', 'nonsense', { name: 'Al', hole: 'the 3rd' }, 1)).toMatch(/Al/);
    expect(captionFor({ kind: 'birdie', name: 'Al', hole: 3 }, { style: 'broadcast', seed: 1 })).toMatch(/the 3rd/);
    expect(captionFor({ kind: 'climber', name: 'Al', places: 3, rank: 2 }, { style: 'broadcast', seed: 0 })).toMatch(/Al/);
    expect(captionFor({ kind: 'side_comp', name: 'Al', comp: 'Best shot', hole: null }, { style: 'larrikins', seed: 0 })).toMatch(/Best shot/);
  });

  it('pop-up words', () => {
    expect(popWord({ kind: 'birdie' })).toBe('BIRDIE!');
    expect(popWord({ kind: 'lead_change' })).toBe('NEW LEADER');
    expect(popWord({ kind: 'eagle', strokes: 2, par: 5 })).toBe('ALBATROSS!');
    expect(popWord({ kind: 'climber' })).toBeNull();
  });

  it('in-jokes: only where they fit, the right player, each once', () => {
    const jokes = [
      { id: 1, text: 'Bo still owes us for the cab.', player_id: 'b', moment: 'win' },
      { id: 2, text: 'Somebody call the greenkeeper.', player_id: null, moment: 'bogey' },
      { id: 3, text: 'x'.repeat(200), player_id: null, moment: 'any' },
    ];
    const used = new Set();
    expect(pickInJoke(jokes, { kind: 'win', subjectId: 'a', name: 'Al' }, used, 1)).toBeNull(); // Bo's joke, not Al's
    expect(pickInJoke(jokes, { kind: 'win', subjectId: 'b', name: 'Bo' }, used, 1)).toBe('Bo still owes us for the cab.');
    expect(pickInJoke(jokes, { kind: 'win', subjectId: 'b', name: 'Bo' }, used, 1)).toBeNull(); // used up
    expect(pickInJoke(jokes, { kind: 'climber', subjectId: 'b' }, new Set(), 1)).toBeNull(); // no joke kind for climbers
    // A bogey joke shows on about half the blow-ups (by seed), never the too-long one.
    const hits = [...Array(20).keys()].map((s) => pickInJoke(jokes, { kind: 'blowup', subjectId: 'a' }, new Set(), s)).filter(Boolean);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(20);
    expect(hits.every((h) => h === 'Somebody call the greenkeeper.')).toBe(true);
    expect(pickInJoke(null, { kind: 'win' })).toBeNull();
    expect(captionFor({ kind: 'win', subjectId: 'b', name: 'Bo', score: '38 points' }, { jokes, used: new Set(), seed: 1 })).toMatch(/cab/);
  });

  it('captions for every step: steady, in the chosen style, quiet holes get a quiet line', () => {
    const r = buildReplay(stableford());
    const opts = { style: 'larrikins', seed: 42, roundName: 'Saturday', courseName: 'Cypress Lakes' };
    const { steps } = buildStory(r, opts);
    const a = steps.map((s) => s.text);
    expect(a).toEqual(buildStory(r, opts).steps.map((s) => s.text));
    expect(a.every((x) => typeof x === 'string')).toBe(true);
    expect(a[0]).toMatch(/Saturday|Cypress Lakes/);
    expect(a.slice(0, -1).every((x) => x.length > 0)).toBe(true);
    expect(LINES.larrikins.welcome.some((l) => a[0] === fill(l, { round: 'Saturday', course: 'Cypress Lakes' }))).toBe(true);
    const winIdx = steps.findIndex((s) => s.scene === 'winner');
    expect(a[winIdx]).toMatch(/Bo/);
    const fin = steps.findIndex((s) => s.scene === 'finish');
    expect(a[fin]).toMatch(/2 points/);
    // The race frame for hole 10 talks about the lead change and pops NEW LEADER.
    const h10 = steps.findIndex((s) => s.scene === 'race' && s.frame === 9);
    expect(a[h10]).toMatch(/Bo/);
    expect(popFor(r.frames[9])).toEqual({ word: 'NEW LEADER', kind: 'lead_change' });
    expect(topMoment(r.frames[4])).toBeNull();
    expect(popFor(r.frames[4])).toBeNull();
  });

  it('the style is kept per group, Broadcast by default', () => {
    const had = globalThis.localStorage;
    const store = {};
    globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
    expect(savedStyle('g-new')).toBe(DEFAULT_STYLE);
    saveStyle('g1', 'larrikins');
    expect(savedStyle('g1')).toBe('larrikins');
    expect(savedStyle('g2')).toBe('broadcast');
    saveStyle('g1', 'rubbish');
    expect(savedStyle('g1')).toBe('larrikins');
    if (had === undefined) delete globalThis.localStorage; else globalThis.localStorage = had;
  });
});

describe('finishedRounds', () => {
  it('lists only locked rounds, in playing order', async () => {
    const { finishedRounds } = await import('./replay.js');
    const rounds = [
      { id: 'c', status: 'live', play_date: '2026-10-24' },
      { id: 'b', status: 'locked', play_date: '2026-10-23' },
      { id: 'a', status: 'locked', play_date: '2026-10-22' },
      { id: 's', status: 'setup', play_date: '2026-10-25' },
    ];
    expect(finishedRounds(rounds).map((r) => r.id)).toEqual(['a', 'b']);
    expect(finishedRounds()).toEqual([]);
  });
});
