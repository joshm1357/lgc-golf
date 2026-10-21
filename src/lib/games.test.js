import { describe, it, expect } from 'vitest';
import {
  toCents, formatMoney, splitCents, settleUp, sumMoney, toPlayers, cleanOptions, gameLabel, gameSuits,
  gameSubjects, skins, nassau, stablefordPot, birdiePool, eclectic, playGame, moneyTally, GAME_KINDS, PRESETS,
} from './games.js';

// 18 par 4s, stroke index = hole number (hole 1 hardest).
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const card = (arr) => Object.fromEntries(arr.map((v, i) => [i + 1, v === 'P' ? { strokes: null, picked_up: true } : v == null ? undefined : { strokes: v, picked_up: false }]).filter(([, v]) => v));
const fours = () => Array(18).fill(4);
const sub = (id, hcp = 0, members) => ({ id, name: id.toUpperCase(), hcp, members: members || [id] });
const zero = (m) => Object.values(m).reduce((a, b) => a + b, 0);

describe('money', () => {
  it('turns dollars into whole cents and back', () => {
    expect(toCents(5)).toBe(500);
    expect(toCents('2.50')).toBe(250);
    expect(toCents('$1,000')).toBe(100000);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents('abc')).toBe(0);
    expect(formatMoney(1200)).toBe('$12');
    expect(formatMoney(1250)).toBe('$12.50');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(-750)).toBe('−$7.50');
    expect(formatMoney(300, { signed: true })).toBe('+$3');
    expect(formatMoney(-300, { signed: true })).toBe('−$3');
    expect(formatMoney(0, { signed: true })).toBe('$0');
  });
  it('splits cents exactly, odd cents to the first', () => {
    expect(splitCents(1000, 3)).toEqual([334, 333, 333]);
    expect(splitCents(-1000, 3)).toEqual([-334, -333, -333]);
    expect(splitCents(0, 2)).toEqual([0, 0]);
    expect(splitCents(5, 0)).toEqual([]);
    for (const [t, n] of [[1, 7], [9999, 4], [-123457, 11]]) expect(splitCents(t, n).reduce((a, b) => a + b, 0)).toBe(t);
  });
  it('settles up with the fewest payments, exact matches first', () => {
    const s = settleUp({ a: 3000, b: -1000, c: -2000 });
    expect(s).toEqual([{ from: 'c', to: 'a', cents: 2000 }, { from: 'b', to: 'a', cents: 1000 }]);
    // Exact pair settles in one payment instead of being split.
    const t = settleUp({ a: 500, b: 1500, c: -1500, d: -500 });
    expect(t).toHaveLength(2);
    expect(t).toContainEqual({ from: 'c', to: 'b', cents: 1500 });
    expect(t).toContainEqual({ from: 'd', to: 'a', cents: 500 });
    expect(settleUp({ a: 0, b: 0 })).toEqual([]);
  });
  it('every settle-up squares everyone to zero', () => {
    const bal = { a: 1234, b: -567, c: -667, d: 1, e: -1 };
    const left = { ...bal };
    for (const p of settleUp(bal)) { left[p.from] += p.cents; left[p.to] -= p.cents; }
    expect(Object.values(left).every((v) => v === 0)).toBe(true);
  });
  it('splits a team’s money between its players, adding up exactly', () => {
    const m = toPlayers({ t1: 1001, t2: -1001 }, [sub('t1', 0, ['p2', 'p1']), sub('t2', 0, ['p3', 'p4'])]);
    expect(m).toEqual({ p1: 501, p2: 500, p3: -501, p4: -500 });
    expect(sumMoney([{ a: 1 }, { a: 2, b: -3 }])).toEqual({ a: 3, b: -3 });
  });
});

describe('options and labels', () => {
  it('fills defaults and drops unknown keys', () => {
    expect(cleanOptions('skins', {})).toEqual({ net: true, carry: true });
    expect(cleanOptions('skins', { net: false, carry: false, junk: 1 })).toEqual({ net: false, carry: false });
    expect(cleanOptions('nassau', { scoring: 'stableford' })).toEqual({ net: true, scoring: 'stableford' });
    expect(cleanOptions('nassau', { scoring: 'rubbish' }).scoring).toBe('stroke');
    expect(cleanOptions('stableford_pot', { net: false })).toEqual({});
  });
  it('labels the presets in plain words', () => {
    const lab = Object.fromEntries(PRESETS.map((p) => [p.key, gameLabel(p)]));
    expect(lab.skins).toBe('Skins $5 (net, carry-overs)');
    expect(lab.nassau).toBe('Nassau $10 (net)');
    expect(lab.stableford_pot).toBe('Stableford pot $10');
    expect(lab.birdie_pool).toBe('Birdie pool $2 (net)');
    expect(lab.eclectic).toBe('Eclectic $20 (net, for the trip)');
    expect(gameLabel({ kind: 'skins', stake: 2.5, options: { net: false, carry: false } })).toBe('Skins $2.50 (gross, no carry-overs)');
    expect(PRESETS.map((p) => p.kind).sort()).toEqual([...GAME_KINDS].sort());
  });
  it('Ambrose rounds only take skins and Nassau', () => {
    expect(gameSuits('skins', 'ambrose')).toBe(true);
    expect(gameSuits('nassau', 'ambrose')).toBe(true);
    expect(gameSuits('birdie_pool', 'ambrose')).toBe(false);
    expect(gameSuits('eclectic', 'ambrose')).toBe(false);
    for (const f of ['stableford', 'stroke', 'fourball']) for (const k of GAME_KINDS) expect(gameSuits(k, f)).toBe(true);
  });
});

describe('who plays', () => {
  const playersById = { p1: { id: 'p1', name: 'Al', nickname: 'Big Al', handicap: 10 }, p2: { id: 'p2', name: 'Bo', handicap: 20 }, p3: { id: 'p3', name: 'Cy', handicap: 5 } };
  it('Stableford / stroke: the round’s players and their playing handicaps', () => {
    const s = gameSubjects({ round: { format: 'stroke' }, roundPlayers: [{ player_id: 'p1', playing_handicap: 9 }, { player_id: 'p2', playing_handicap: 18 }], playersById });
    expect(s).toEqual([{ id: 'p1', name: 'Big Al', hcp: 9, members: ['p1'] }, { id: 'p2', name: 'Bo', hcp: 18, members: ['p2'] }]);
  });
  it('4BBB: every player in the pairs, round handicap first', () => {
    const teams = [{ id: 't1', players: [playersById.p1, playersById.p2] }, { id: 't2', players: [playersById.p3] }];
    const s = gameSubjects({ round: { format: 'fourball' }, teams, roundPlayers: [{ player_id: 'p1', playing_handicap: 8 }], playersById });
    expect(s.map((x) => [x.id, x.hcp])).toEqual([['p1', 8], ['p2', 20], ['p3', 5]]);
  });
  it('Ambrose: the teams, off the team handicap', () => {
    const teams = [{ id: 't1', name: 'Team A', handicap: 7.4, players: [playersById.p1, playersById.p2] }];
    expect(gameSubjects({ round: { format: 'ambrose' }, teams })).toEqual([{ id: 't1', name: 'Team A', hcp: 7.4, members: ['p1', 'p2'], team: true }]);
  });
});

describe('skins', () => {
  it('gross: a tie carries to the next hole, which is won outright', () => {
    const a = fours(); const b = fours(); const c = fours();
    a[0] = 3; // A wins hole 1
    b[1] = 3; c[1] = 3; // 2: B and C tie → carries
    c[2] = 3; // 3: C wins 2 skins
    const r = skins({ holes, subjects: [sub('a'), sub('b'), sub('c')], scores: { a: card(a), b: card(b), c: card(c) }, options: { net: false, carry: true }, stakeCents: 500 });
    expect(r.holes[0]).toMatchObject({ n: 1, status: 'won', winner: 'a', value: 1 });
    expect(r.holes[1]).toMatchObject({ n: 2, status: 'tied', value: 1 });
    expect(r.holes[2]).toMatchObject({ n: 3, status: 'won', winner: 'c', value: 2 });
    // Holes 4–18 all tie at 4 → 15 skins still in the pot.
    expect(r.won).toEqual({ a: 1, c: 2 });
    expect(r.pot).toBe(15);
    expect(r.final).toBe(true);
    // A: +1 skin × $5 × 2 others, −$5 to C twice. C: +2 × $5 × 2, −$5 to A.
    expect(r.money).toEqual({ a: 1000 - 1000, b: -500 - 1000, c: -500 + 2000 });
    expect(zero(r.money)).toBe(0);
  });
  it('carry-overs off: a tie kills the skin', () => {
    const a = fours(); const b = fours();
    a[1] = 3;
    const r = skins({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(a), b: card(b) }, options: { net: false, carry: false }, stakeCents: 500 });
    expect(r.holes[0].status).toBe('tied');
    expect(r.holes[1]).toMatchObject({ status: 'won', winner: 'a', value: 1 });
    expect(r.pot).toBe(0);
    expect(r.money).toEqual({ a: 500, b: -500 });
  });
  it('net: shots received decide it', () => {
    // B gets a shot on hole 1 (SI 1, handicap 1): both make 4 → B nets 3 and wins.
    const r = skins({ holes, subjects: [sub('a', 0), sub('b', 1)], scores: { a: card(fours()), b: card(fours()) }, options: { net: true, carry: true }, stakeCents: 100 });
    expect(r.holes[0]).toMatchObject({ status: 'won', winner: 'b' });
    const gross = skins({ holes, subjects: [sub('a', 0), sub('b', 1)], scores: { a: card(fours()), b: card(fours()) }, options: { net: false }, stakeCents: 100 });
    expect(gross.holes[0].status).toBe('tied');
  });
  it('a pick-up never wins, even when everyone else blows up', () => {
    const a = fours(); const b = fours();
    a[0] = 'P'; b[0] = 9;
    const r = skins({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(a), b: card(b) }, options: { net: false } });
    expect(r.holes[0]).toMatchObject({ status: 'won', winner: 'b' });
    const both = skins({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(['P']), b: card(['P']) }, options: { net: false } });
    expect(both.holes[0].status).toBe('tied');
  });
  it('waits for everyone; with carry-overs later holes wait on an unfinished one', () => {
    const a = [4, 3, 3]; const b = [4, null, 4];
    const r = skins({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(a), b: card(b) }, options: { net: false, carry: true }, stakeCents: 500 });
    expect(r.holes[0].status).toBe('tied');
    expect(r.holes[1].status).toBe('pending');
    expect(r.holes[2]).toMatchObject({ status: 'waiting', winner: 'a', value: null });
    expect(r.money).toEqual({});
    expect(r.final).toBe(false);
    // Without carry-overs hole 3 can be paid straight away.
    const off = skins({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(a), b: card(b) }, options: { net: false, carry: false }, stakeCents: 500 });
    expect(off.holes[2]).toMatchObject({ status: 'won', winner: 'a', value: 1 });
  });
  it('a locked round counts a missing hole as a pick-up', () => {
    const r = skins({ holes, subjects: [sub('a'), sub('b')], scores: { a: card([4]), b: card([5]) }, options: { net: false }, locked: true });
    expect(r.holes[0]).toMatchObject({ status: 'won', winner: 'a' });
    expect(r.holes[1].status).toBe('tied'); // both "picked up"
    expect(r.final).toBe(true);
  });
  it('needs two players', () => {
    expect(skins({ holes, subjects: [sub('a')], scores: {}, options: {} }).holes).toEqual([]);
  });
});

describe('Nassau', () => {
  it('front, back and total leaders on net strokes; money per bet, ties split', () => {
    const a = fours(); const b = fours(); const c = fours();
    a[0] = 3; // A −1 front
    b[9] = 3; // B −1 back
    c[2] = 3; c[10] = 3; c[11] = 5; // C −1 front, −1 back… +1 → level back, −1 total
    const r = nassau({ holes, subjects: [sub('a'), sub('b'), sub('c')], scores: { a: card(a), b: card(b), c: card(c) }, options: { net: true }, stakeCents: 1000 });
    const [front, back, total] = r.bets;
    expect(front.leaders.sort()).toEqual(['a', 'c']);
    expect(back.leaders).toEqual(['b']);
    expect(total.leaders.sort()).toEqual(['a', 'b', 'c']); // all −1
    expect(r.final).toBe(true);
    // Front: pot $30 split A/C ($15 each); back: B takes $30; total: $30 back to all three.
    expect(r.money).toEqual({ a: -1000 + 1500 - 1000 + 0, b: -1000 - 1000 + 3000 + 0, c: -1000 + 1500 - 1000 + 0 });
    expect(zero(r.money)).toBe(0);
  });
  it('compares groups on different holes fairly (to par so far), and only pays when everyone’s done', () => {
    const r = nassau({ holes, subjects: [sub('a'), sub('b')], scores: { a: card([4, 4, 3]), b: card([3]) }, options: { net: false }, stakeCents: 1000 });
    expect(r.bets[0].leaders.sort()).toEqual(['a', 'b']); // both −1
    expect(r.bets[0].decided).toBe(false);
    expect(r.money).toEqual({});
  });
  it('a pick-up is a net double bogey', () => {
    const a = fours(); a[0] = 'P';
    const b = fours(); b[0] = 7; // triple bogey
    const r = nassau({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(a), b: card(b) }, options: { net: true }, stakeCents: 500 });
    expect(r.bets[0].rows.find((x) => x.id === 'a').value).toBe(2);
    expect(r.bets[0].leaders).toEqual(['a']);
  });
  it('Stableford points option: most points wins', () => {
    const a = fours(); const b = fours();
    b[0] = 'P'; a[17] = 3;
    const r = nassau({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(a), b: card(b) }, options: { net: true, scoring: 'stableford' }, stakeCents: 500 });
    expect(r.scoring).toBe('stableford');
    expect(r.bets[0].leaders).toEqual(['a']); // B's pick-up is 0 points
    expect(r.bets[1].leaders).toEqual(['a']); // birdie on 18
    expect(r.money).toEqual({ a: 1500, b: -1500 });
  });
  it('a 9-hole course is one bet', () => {
    const nine = holes.slice(0, 9);
    const r = nassau({ holes: nine, subjects: [sub('a'), sub('b')], scores: { a: card([3]), b: card([4]) }, options: {} });
    expect(r.bets.map((b) => b.label)).toEqual(['All 9']);
  });
});

describe('Stableford pot', () => {
  it('most points takes the pot; ties split it', () => {
    const a = fours(); a[0] = 3;
    const r = stablefordPot({ holes, subjects: [sub('a', 0), sub('b', 0), sub('c', 18)], scores: { a: card(a), b: card(fours()), c: card(fours()) }, stakeCents: 1000 });
    // C gets a shot a hole: 54 points. A 37, B 36.
    expect(r.rows.find((x) => x.id === 'c').points).toBe(54);
    expect(r.leaders).toEqual(['c']);
    expect(r.money).toEqual({ a: -1000, b: -1000, c: 2000 });
    const tie = stablefordPot({ holes, subjects: [sub('a'), sub('b'), sub('c')], scores: { a: card(fours()), b: card(fours()), c: card(Array(18).fill(5)) }, stakeCents: 1000 });
    expect(tie.money).toEqual({ a: 500, b: 500, c: -1000 });
  });
  it('isn’t paid until everyone’s finished', () => {
    const r = stablefordPot({ holes, subjects: [sub('a'), sub('b')], scores: { a: card([3]), b: card([4]) }, stakeCents: 1000 });
    expect(r.final).toBe(false);
    expect(r.leaders).toEqual(['a']);
    expect(r.money).toEqual({});
  });
});

describe('birdie pool', () => {
  it('each birdie or better takes a share; odd cents add up', () => {
    const a = fours(); a[0] = 3; a[1] = 2; // birdie + eagle = 2 shares
    const b = fours(); b[5] = 3; // 1 share
    const c = fours(); c[6] = 'P';
    const r = birdiePool({ holes, subjects: [sub('a'), sub('b'), sub('c')], scores: { a: card(a), b: card(b), c: card(c) }, options: { net: false }, stakeCents: 200 });
    expect(r.birdies).toEqual({ a: [1, 2], b: [6], c: [] });
    expect(r.shares).toBe(3);
    expect(r.money).toEqual({ a: -200 + 400, b: -200 + 200, c: -200 });
    expect(zero(r.money)).toBe(0);
    const odd = birdiePool({ holes, subjects: [sub('a'), sub('b'), sub('c')], scores: { a: card(a), b: card(b), c: card(c) }, options: { net: false }, stakeCents: 100 });
    expect(zero(odd.money)).toBe(0); // $3 over 3 shares, exact
  });
  it('net birdies use shots received; no birdies = no money moves', () => {
    const r = birdiePool({ holes, subjects: [sub('a', 0), sub('b', 1)], scores: { a: card(fours()), b: card(fours()) }, options: { net: true }, stakeCents: 200 });
    expect(r.birdies.b).toEqual([1]);
    const none = birdiePool({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(fours()), b: card(fours()) }, options: { net: false }, stakeCents: 200 });
    expect(none.shares).toBe(0);
    expect(none.money).toEqual({});
  });
});

describe('eclectic', () => {
  it('best net score per hole across rounds; lowest full card wins when every round is locked', () => {
    const r1 = { id: 'r1', holes, locked: true, subjects: [sub('a', 0), sub('b', 0)], scores: { a: card([3, ...Array(17).fill(5)]), b: card(fours()) } };
    const r2 = { id: 'r2', holes, locked: false, subjects: [sub('a', 0), sub('b', 0)], scores: { a: card([5, ...Array(17).fill(4)]) } };
    const live = eclectic({ rounds: [r1, r2], options: { net: true }, stakeCents: 2000 });
    const A = live.rows.find((x) => x.id === 'a');
    expect(A.best[1]).toBe(3);
    expect(A.best[2]).toBe(4);
    expect(A.total).toBe(71);
    expect(A.toPar).toBe(-1);
    expect(live.leaders).toEqual(['a']);
    expect(live.final).toBe(false);
    expect(live.money).toEqual({});
    const done = eclectic({ rounds: [r1, { ...r2, locked: true }], options: { net: true }, stakeCents: 2000 });
    expect(done.final).toBe(true);
    expect(done.money).toEqual({ a: 2000, b: -2000 });
  });
  it('net uses each round’s handicap; a pick-up is a net double bogey; only a full card can win', () => {
    const r1 = { id: 'r1', holes, locked: true, subjects: [sub('a', 18), sub('b', 0)], scores: { a: card(['P', ...Array(17).fill(5)]), b: card([4, 4]) } };
    const res = eclectic({ rounds: [r1], options: { net: true } });
    const A = res.rows.find((x) => x.id === 'a');
    expect(A.best[1]).toBe(6); // pick-up = par + 2
    expect(A.best[2]).toBe(4); // 5 less a shot
    const B = res.rows.find((x) => x.id === 'b');
    expect(B.full).toBe(true); // locked: missing holes are pick-ups
  });
});

describe('playGame and the money tally', () => {
  const playersById = { p1: { id: 'p1', name: 'Al' }, p2: { id: 'p2', name: 'Bo' }, p3: { id: 'p3', name: 'Cy' }, p4: { id: 'p4', name: 'Di' } };
  const course = { id: 'c1', holes };
  it('works out a Stableford round’s games and settles up to zero', () => {
    const round = { id: 'r1', course_id: 'c1', format: 'stableford', status: 'locked' };
    const roundPlayers = ['p1', 'p2', 'p3'].map((id) => ({ player_id: id, playing_handicap: 0 }));
    const a = fours(); a[0] = 3;
    const b = fours(); b[1] = 3; const c = fours(); c[1] = 3; c[2] = 3;
    const scoresIdx = { r1: { p1: card(a), p2: card(b), p3: card(c) } };
    const ctx = { round, course, roundPlayers, playersById, scoresIdx };
    const games = [
      { id: 'g1', kind: 'skins', stake: 5, options: { net: true, carry: true } },
      { id: 'g2', kind: 'stableford_pot', stake: 10, options: {} },
    ].map((g) => playGame(g, ctx));
    expect(games[0].result.won).toEqual({ p1: 1, p3: 2 });
    expect(games[1].result.leaders).toEqual(['p3']);
    const t = moneyTally(games);
    expect(t.rows[0]).toEqual({ id: 'p3', cents: 1500 + 2000 });
    expect(t.rows.reduce((s, r) => s + r.cents, 0)).toBe(0);
    expect(t.undecided).toBe(0);
    const left = Object.fromEntries(t.rows.map((r) => [r.id, r.cents]));
    for (const p of t.settle) { left[p.from] += p.cents; left[p.to] -= p.cents; }
    expect(Object.values(left).every((v) => v === 0)).toBe(true);
  });
  it('Ambrose: team skins split between the team; other games are skipped', () => {
    const round = { id: 'r2', course_id: 'c1', format: 'ambrose', status: 'live' };
    const teams = [{ id: 't1', name: 'A', handicap: 0, players: [playersById.p1, playersById.p2] }, { id: 't2', name: 'B', handicap: 0, players: [playersById.p3, playersById.p4] }];
    const scoresIdx = { r2: { t1: card([3]), t2: card([4]) } };
    const sk = playGame({ kind: 'skins', stake: 5, options: { net: false } }, { round, course, teams, scoresIdx, playersById });
    expect(sk.money).toEqual({ p1: 250, p2: 250, p3: -250, p4: -250 });
    const bp = playGame({ kind: 'birdie_pool', stake: 2, options: {} }, { round, course, teams, scoresIdx, playersById });
    expect(bp.skipped).toBeTruthy();
    expect(moneyTally([sk, bp]).undecided).toBe(1);
  });
  it('eclectic runs across the trip’s rounds on the same course, skipping Ambrose and other courses', () => {
    const r1 = { id: 'r1', course_id: 'c1', format: 'stableford', status: 'locked' };
    const r2 = { id: 'r2', course_id: 'c1', format: 'stroke', status: 'locked' };
    const r3 = { id: 'r3', course_id: 'c2', format: 'stableford', status: 'locked' };
    const rp = (ids) => ids.map((id) => ({ player_id: id, playing_handicap: 0 }));
    const scoresIdx = { r1: { p1: card(fours()), p2: card([3, ...Array(17).fill(5)]) }, r2: { p1: card(fours()), p2: card(fours()) }, r3: { p1: card(Array(18).fill(1)) } };
    const g = playGame({ kind: 'eclectic', stake: 20, options: { net: true } }, {
      round: r1, course, tripRounds: [r1, r2, r3], coursesById: { c1: course, c2: course },
      roundPlayersByRound: { r1: rp(['p1', 'p2']), r2: rp(['p1', 'p2']), r3: rp(['p1']) }, teamsByRound: {}, scoresIdx, playersById,
    });
    expect(g.rounds).toBe(2);
    expect(g.result.leaders).toEqual(['p2']); // 3 on hole 1, 4s elsewhere
    expect(g.money).toEqual({ p1: -2000, p2: 2000 });
  });
});

describe('paper-card players (review fix)', () => {
  it('count in the Stableford pot with their card points, and are left out of hole-by-hole games', async () => {
    const { playGame } = await import('./games.js');
    const holes = [1, 2, 3].map((n) => ({ n, par: 4, si: n }));
    const round = { id: 'r', format: 'stableford', status: 'locked' };
    const ctx = {
      round, course: { holes }, teams: [],
      roundPlayers: [{ player_id: 'a', playing_handicap: 0 }, { player_id: 'q', playing_handicap: 0 }],
      playersById: { a: { id: 'a', name: 'Al' }, q: { id: 'q', name: 'Quinn' } },
      scoresIdx: { r: { a: { 1: { strokes: 4 }, 2: { strokes: 4 }, 3: { strokes: 4 } } } },
      quickResults: [{ round_id: 'r', player_id: 'q', points: 9 }],
    };
    const pot = playGame({ kind: 'stableford_pot', stake: 10, options: {} }, ctx);
    expect(pot.result.leaders).toEqual(['q']);
    const sk = playGame({ kind: 'skins', stake: 5, options: {} }, ctx);
    expect(sk.subjects.map((x) => x.id)).toEqual(['a']);
    expect(sk.note).toContain('Quinn');
  });
});
