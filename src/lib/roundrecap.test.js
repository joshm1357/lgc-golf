import { describe, it, expect } from 'vitest';
import { roundRecap, recapText, scoreWords, recapShare } from './roundrecap.js';

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const card = (strokes, over = {}) => Object.fromEntries(holes.map((h) => [h.n, { strokes: over[h.n] ?? strokes, picked_up: false }]));
const perHole = (v, over = {}) => Object.fromEntries(holes.map((h) => [h.n, over[h.n] ?? v]));

describe('roundRecap — Ambrose (net)', () => {
  const board = {
    format: 'ambrose', holes,
    rows: [
      { name: 'Josh & Hamish', rank: 1, thru: 18, netToPar: -9, scores: card(4, { 3: 3, 7: 2 }), perHole: perHole(-0.5), bonusWins: ['💣 LD'] },
      { name: 'Chris & Mike', rank: 2, thru: 18, netToPar: -7, scores: card(4, { 5: 3 }), perHole: perHole(-0.4, { 10: -1, 11: -1, 12: -1 }) },
      { name: 'Adam & Cam', rank: 3, thru: 18, netToPar: -6, scores: card(4), perHole: perHole(-0.3), bonusWins: ['🎯 CTP'] },
      { name: 'Mark & Al', rank: 4, thru: 18, netToPar: -3, scores: card(4), perHole: perHole(-0.1) },
    ],
  };
  const lines = roundRecap(board, { done: true, courseName: 'Shoalhaven Heads' });
  const text = lines.map((l) => l.text);
  it('leads with the winner and the margin', () => {
    expect(text[0]).toBe('Josh & Hamish won at Shoalhaven Heads with −9 net, by 2 shots.');
    expect(text[1]).toBe('Chris & Mike 2nd (−7 net), Adam & Cam 3rd (−6 net).');
  });
  it('finds the shot of the day, the birdies, the best back nine, side comps and the spoon', () => {
    expect(text).toContain('Shot of the day: Josh & Hamish with an eagle on the 7th.');
    expect(text).toContain('3 birdies or better on the day — Josh & Hamish had 2.');
    expect(text.some((t) => t.startsWith('Best back nine: Chris & Mike'))).toBe(true);
    expect(text).toContain('Side comps: 💣 LD to Josh & Hamish, 🎯 CTP to Adam & Cam.');
    expect(text).toContain('Wooden spoon: Mark & Al (−3 net).');
  });
  it('is empty until the round is done', () => {
    expect(roundRecap(board, { done: false })).toEqual([]);
    expect(roundRecap({ format: 'stableford', rows: [{ name: 'x', thru: 0 }] }, { done: true })).toEqual([]);
  });
  it('shares as plain text', () => {
    expect(recapText(lines.slice(0, 1), 'Sunday Ambrose')).toBe('📝 Sunday Ambrose\n🏆 Josh & Hamish won at Shoalhaven Heads with −9 net, by 2 shots.');
  });
});

describe('roundRecap — Stableford', () => {
  it('points, a tie, a countback and a hole-in-one', () => {
    const board = {
      format: 'stableford', holes,
      rows: [
        { name: 'Kurt', rank: 1, thru: 18, points: 38, scores: card(4, { 8: 1 }), perHole: perHole(2) },
        { name: 'Bo', rank: 1, thru: 18, points: 38, scores: card(5), perHole: perHole(2) },
        { name: 'Al', rank: 3, thru: 18, points: 30, scores: card(5), perHole: perHole(1) },
      ],
    };
    const text = roundRecap(board, { done: true }).map((l) => l.text);
    expect(text[0]).toBe('Kurt and Bo finished level on 38 pts.');
    expect(text).toContain('Shot of the day: Kurt with a hole-in-one on the 8th.');
    expect(text.some((t) => t.startsWith('Wooden spoon'))).toBe(false);
  });
  it('a countback win', () => {
    const board = { format: 'stableford', holes, rows: [{ name: 'Kurt', rank: 1, thru: 18, points: 36, scores: {} }, { name: 'Bo', rank: 2, thru: 18, points: 36, scores: {} }] };
    expect(roundRecap(board, { done: true })[0].text).toBe('Kurt won with 36 pts, on a countback.');
  });
  it('scoreWords', () => {
    expect(scoreWords({ format: 'stroke' }, { netToPar: 2 })).toBe('+2 net');
    expect(scoreWords({ format: 'fourball' }, { points: 44 })).toBe('44 pts');
  });
});

describe('recapShare', () => {
  it('adds the leaderboard and the join link', () => {
    expect(recapShare('📝 Sunday', { boardLink: 'https://x/#/?r=1', joinLink: 'https://x/#/join/ABC', groupName: 'L.G.C' }))
      .toBe('📝 Sunday\n\n📊 Full leaderboard: https://x/#/?r=1\n🙋 Not on the app yet? Join L.G.C: https://x/#/join/ABC');
  });
  it('no join link for players (only organisers can make one)', () => {
    expect(recapShare('📝 Sunday', { boardLink: 'https://x/#/?r=1' })).toBe('📝 Sunday\n\n📊 Full leaderboard: https://x/#/?r=1');
  });
});
