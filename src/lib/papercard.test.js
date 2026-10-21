import { describe, it, expect } from 'vitest';
import { cardSubjects, readCell, cellText, parseCardLine, rowDraft, rowTotals, changedCells, moveFrom } from './papercard.js';

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const players = { a: { id: 'a', name: 'Al Test', nickname: 'Al', handicap: 18 }, b: { id: 'b', name: 'Bo Test', handicap: 9 } };

describe('who has a row', () => {
  const teams = { r: [{ id: 't1', name: 'Al & Bo', handicap: 5.5, players: [players.a, players.b] }] };
  const roundPlayers = { r: [{ player_id: 'a', playing_handicap: 16 }, { player_id: 'b', playing_handicap: 9 }] };
  it('Ambrose: one row per team', () => {
    expect(cardSubjects({ round: { id: 'r', format: 'ambrose' }, teamsByRound: teams })).toEqual([{ id: 't1', type: 'team', name: 'Al & Bo', hcp: 5.5 }]);
  });
  it('4BBB: each player in each pair, off the round handicap', () => {
    const s = cardSubjects({ round: { id: 'r', format: 'fourball' }, teamsByRound: teams, roundPlayers });
    expect(s.map((x) => [x.id, x.name, x.hcp])).toEqual([['a', 'Al (Al & Bo)', 16], ['b', 'Bo Test (Al & Bo)', 9]]);
  });
  it('Stableford and stroke: the round’s players', () => {
    for (const format of ['stableford', 'stroke']) {
      const s = cardSubjects({ round: { id: 'r', format }, roundPlayers, playersById: players });
      expect(s.map((x) => [x.id, x.type, x.hcp])).toEqual([['a', 'player', 16], ['b', 'player', 9]]);
    }
  });
  it('no round, no rows', () => { expect(cardSubjects({ round: null })).toEqual([]); });
});

describe('reading a box', () => {
  it('reads strokes, pick-ups and empty', () => {
    expect(readCell('5', 'stableford')).toEqual({ strokes: 5, picked_up: false });
    expect(readCell(' p ', 'stroke')).toEqual({ strokes: null, picked_up: true });
    expect(readCell('-', 'fourball')).toEqual({ strokes: null, picked_up: true });
    expect(readCell('', 'stableford')).toEqual({ empty: true });
  });
  it('refuses nonsense and Ambrose pick-ups', () => {
    expect(readCell('0', 'stableford').error).toMatch(/1 to 20/);
    expect(readCell('21', 'stableford').error).toMatch(/1 to 20/);
    expect(readCell('4.5', 'stableford').error).toMatch(/isn’t a score/);
    expect(readCell('P', 'ambrose').error).toMatch(/No pick-ups in Ambrose/);
  });
  it('shows saved scores', () => {
    expect(cellText({ strokes: 4 })).toBe('4');
    expect(cellText({ strokes: null, picked_up: true })).toBe('P');
    expect(cellText(undefined)).toBe('');
  });
});

describe('pasting a row', () => {
  it('fills the holes, dropping Out / In / Total', () => {
    const front = [5, 4, 3, 6, 4, 4, 3, 5, 5];
    const back = [4, 4, 4, 5, 4, 3, 4, 6, 4];
    const line = [...front, 39, ...back, 38, 77].join('\t');
    expect(parseCardLine(line, 18)).toEqual([...front, ...back].map(String));
    expect(parseCardLine('5 4 P 6', 18)).toEqual(['5', '4', 'P', '6']);
  });
  it('isn’t a row when it’s one value or words', () => {
    expect(parseCardLine('5', 18)).toBeNull();
    expect(parseCardLine('five four', 18)).toBeNull();
  });
});

describe('totals as you type', () => {
  it('Stableford points, gross, out and in', () => {
    const d = rowDraft(holes, {});
    d[1] = '4'; d[2] = '5'; d[10] = 'P'; d[11] = 'zz';
    const t = rowTotals(holes, d, 18, 'stableford');
    // 18 handicap = a shot a hole: par 4 net par = 3 pts, a 5 = 2 pts, pick-up = 0.
    expect(t).toMatchObject({ played: 3, gross: 9, out: 9, in: 0, points: 5, errors: 1 });
  });
  it('stroke and Ambrose: net to par', () => {
    const d = rowDraft(holes, {});
    d[1] = '4'; d[2] = '4';
    expect(rowTotals(holes, d, 0, 'stroke').netToPar).toBe(0);
    expect(rowTotals(holes, d, 18, 'ambrose').netToPar).toBe(-2);
  });
});

describe('what gets saved', () => {
  const round = { id: 'r', format: 'stableford' };
  const subject = { id: 'a', type: 'player' };
  it('only valid boxes that changed', () => {
    const saved = { 1: { strokes: 4, picked_up: false }, 2: { strokes: null, picked_up: true }, 3: { strokes: 5 } };
    const draft = { ...rowDraft(holes, saved), 3: '6', 4: '3', 5: 'x9', 6: '' };
    expect(changedCells({ round, subject, holes, draft, saved })).toEqual([
      { round_id: 'r', subject_id: 'a', subject_type: 'player', hole: 3, strokes: 6, picked_up: false },
      { round_id: 'r', subject_id: 'a', subject_type: 'player', hole: 4, strokes: 3, picked_up: false },
    ]);
  });
  it('a pick-up replacing strokes is a change', () => {
    const saved = { 1: { strokes: 7, picked_up: false } };
    expect(changedCells({ round, subject, holes, draft: { 1: 'P' }, saved })[0]).toMatchObject({ hole: 1, strokes: null, picked_up: true });
  });
});

describe('moving around the card', () => {
  it('Tab goes along the row then to the next row', () => {
    expect(moveFrom({ row: 0, col: 17 }, 'next', 2, 18)).toEqual({ row: 1, col: 0 });
    expect(moveFrom({ row: 1, col: 17 }, 'next', 2, 18)).toBeNull();
    expect(moveFrom({ row: 1, col: 0 }, 'prev', 2, 18)).toEqual({ row: 0, col: 17 });
    expect(moveFrom({ row: 0, col: 4 }, 'down', 2, 18)).toEqual({ row: 1, col: 4 });
    expect(moveFrom({ row: 0, col: 4 }, 'up', 2, 18)).toBeNull();
    expect(moveFrom({ row: 0, col: 4 }, 'nextRow', 2, 18)).toEqual({ row: 1, col: 0 });
  });
});
