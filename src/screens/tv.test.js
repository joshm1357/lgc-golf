import { describe, it, expect } from 'vitest';
import { boardFor } from './TvBoard.jsx';

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));

describe('the clubhouse TV board', () => {
  it('ranks a Stableford round from the TV feed, first names only', () => {
    const r = { id: 'r1', format: 'stableford', holes, players: [{ id: 'a', name: 'Josh' }, { id: 'b', name: 'Mike' }],
      round_players: [{ player_id: 'a', playing_handicap: 18 }, { player_id: 'b', playing_handicap: 0 }],
      scores: [{ subject_id: 'a', hole: 1, strokes: 4 }, { subject_id: 'b', hole: 1, strokes: 5 }] };
    const b = boardFor(r);
    expect(b.rows.map((x) => [x.name, x.points])).toEqual([['Josh', 3], ['Mike', 1]]);
  });
  it('names Ambrose teams by their players', () => {
    const r = { id: 'r2', format: 'ambrose', holes, players: [{ id: 'a', name: 'Josh' }, { id: 'b', name: 'Mike' }],
      teams: [{ id: 't1', handicap: 5, player_ids: ['a', 'b'] }], round_players: [], scores: [{ subject_id: 't1', hole: 1, strokes: 3 }] };
    expect(boardFor(r).rows[0].name).toBe('Josh & Mike');
  });
});
