// Standard game options (migration 073): validated skins, Nassau bet values and auto-presses, a gross Stableford pot,
// eagles double in the birdie pool. The rest of the games maths is in games.test.js.
import { describe, it, expect } from 'vitest';
import { skins, nassau, stablefordPot, birdiePool, gameLabel, fullOptions } from './games.js';

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const card = (arr) => Object.fromEntries(arr.map((v, i) => [i + 1, v == null ? undefined : { strokes: v, picked_up: false }]).filter(([, v]) => v));
const fours = () => Array(18).fill(4);
const sub = (id, hcp = 0) => ({ id, name: id.toUpperCase(), hcp, members: [id] });
const zero = (m) => Object.values(m).reduce((a, b) => a + b, 0);

describe('standard game options', () => {
  it('fills defaults for every standard option', () => {
    expect(fullOptions('skins', {})).toEqual({ net: true, carry: true, validate: false });
    expect(fullOptions('nassau', { press: 7, front: '5' })).toEqual({ net: true, scoring: 'stroke', front: 5, back: null, total: null, press: 0 });
    expect(fullOptions('stableford_pot', { net: false })).toEqual({ net: false });
  });

  it('validated skins: the winner must at least tie the next hole, or the skins carry on to it', () => {
    const a = fours(); const b = fours(); const c = fours();
    a[0] = 3; // A wins 1 — validated on 2 (ties at 4); 2 ties and carries
    b[2] = 3; // B wins 3 (2 skins) — but makes 5 on 4: not validated, the 2 carry to 4
    b[3] = 5; c[3] = 3; // C wins 4 worth 3; validated on 5
    a[17] = 3; // A wins the last hole (14 skins: 5–17 tied) — the last hole needs no validation
    const r = skins({ holes, subjects: [sub('a'), sub('b'), sub('c')], scores: { a: card(a), b: card(b), c: card(c) }, options: { net: false, carry: true, validate: true }, stakeCents: 100 });
    expect(r.holes[0]).toMatchObject({ status: 'won', winner: 'a', value: 1, validating: false });
    expect(r.holes[2]).toMatchObject({ status: 'unvalidated', winner: 'b', value: 2 });
    expect(r.holes[3]).toMatchObject({ status: 'won', winner: 'c', value: 3 });
    expect(r.holes[17]).toMatchObject({ status: 'won', winner: 'a', value: 14 });
    expect(r.won).toEqual({ a: 15, c: 3 });
    expect(r.final).toBe(true);
    expect(zero(r.money)).toBe(0);
  });

  it('validated skins wait for the next hole; without validation the same skin pays straight away', () => {
    const two = holes.slice(0, 2);
    const sc = { a: card([3]), b: card([4]) };
    const r = skins({ holes: two, subjects: [sub('a'), sub('b')], scores: sc, options: { net: false, validate: true }, stakeCents: 100 });
    expect(r.holes[0]).toMatchObject({ status: 'won', validating: true });
    expect(r.money).toEqual({});
    expect(r.final).toBe(false);
    const plain = skins({ holes: two, subjects: [sub('a'), sub('b')], scores: sc, options: { net: false }, stakeCents: 100 });
    expect(plain.money).toEqual({ a: 100, b: -100 });
  });

  it('Nassau: each bet can have its own value', () => {
    const a = fours(); const b = fours();
    a[0] = 3; b[12] = 2; // A wins the front, B the back and the 18
    const r = nassau({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(a), b: card(b) }, options: { net: false, front: 5, back: null, total: 20 }, stakeCents: 1000 });
    expect(r.bets.map((x) => [x.key, x.leaders, x.stake])).toEqual([['front', ['a'], 500], ['back', ['b'], 1000], ['total', ['b'], 2000]]);
    expect(r.money).toEqual({ a: 500 - 1000 - 2000, b: -500 + 1000 + 2000 });
  });

  it('Nassau auto-press at 2: a new bet from the next hole to the end of that nine (up to 2 a nine)', () => {
    const a = fours(); const b = fours();
    a[0] = 3; a[1] = 3; // A 2 clear after hole 2 → press on 3–9
    b[4] = 3; b[5] = 3; b[6] = 3; // B 2 clear on the press after 6 → second press on 7–9
    const r = nassau({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(a), b: card(b) }, options: { net: false, press: 2 }, stakeCents: 100 });
    const presses = r.bets.filter((x) => x.press);
    expect(presses.map((x) => [x.key, x.holes[0], x.holes[x.holes.length - 1], x.leaders])).toEqual([
      ['front_press1', 3, 9, ['b']], ['front_press2', 7, 9, ['b']],
    ]);
    expect(r.bets.find((x) => x.key === 'front').leaders).toEqual(['b']); // −3 v −2
    expect(r.money).toEqual({ a: -400, b: 400 }); // B wins the front, both presses and the 18; the back is tied
    expect(zero(r.money)).toBe(0);
    expect(nassau({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(a), b: card(b) }, options: { net: false }, stakeCents: 100 }).bets).toHaveLength(3);
  });

  it('Stableford pot can be gross points; birdie pool eagles can count double', () => {
    const pot = (net) => stablefordPot({ holes, subjects: [sub('a', 0), sub('b', 18)], scores: { a: card(fours()), b: card(fours()) }, options: { net }, stakeCents: 100 });
    expect(pot(true).leaders).toEqual(['b']);
    expect(pot(false).leaders).toEqual(['a', 'b']);
    const a = fours(); a[0] = 2; // eagle
    const b = fours(); b[1] = 3; // birdie
    const pool = (eagleDouble) => birdiePool({ holes, subjects: [sub('a'), sub('b')], scores: { a: card(a), b: card(b) }, options: { net: false, eagle_double: eagleDouble }, stakeCents: 300 });
    expect(pool(false).money).toEqual({ a: 0, b: 0 });
    expect(pool(true).shares).toBe(3);
    expect(pool(true).money).toEqual({ a: 100, b: -100 });
  });

  it('labels show the standard options', () => {
    expect(gameLabel({ kind: 'skins', stake: 5, options: { net: true, carry: true }, settings: { validate: true } })).toBe('Skins $5 (net, carry-overs, validated)');
    expect(gameLabel({ kind: 'nassau', stake: 10, options: {}, settings: { front: 5, total: 20, press: 2 } })).toBe('Nassau $5/$10/$20 (net, auto-press at 2)');
    expect(gameLabel({ kind: 'stableford_pot', stake: 10, options: {}, settings: { net: false } })).toBe('Stableford pot $10 (gross)');
    expect(gameLabel({ kind: 'birdie_pool', stake: 2, options: {}, settings: { eagle_double: true } })).toBe('Birdie pool $2 (net, eagles double)');
  });
});
