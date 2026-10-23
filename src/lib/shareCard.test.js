import { describe, it, expect } from 'vitest';
import { cardContent, boardCard } from './shareCard.js';

describe('share cards', () => {
  it('a final leaderboard: top 8, positions only for those who have played', () => {
    const board = { format: 'stableford', rows: Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, thru: i < 9 ? 18 : 0, points: 40 - i })) };
    const c = cardContent('leaderboard', boardCard(board, { roundName: 'Saturday', courseName: 'Bowral', playDate: '2026-10-17', final: true }));
    expect(c.eyebrow).toBe('FINAL LEADERBOARD');
    expect(c.rows).toHaveLength(8);
    expect(c.rows[0]).toEqual({ pos: '1', name: 'P0', score: '40', first: true });
    expect(c.sub).toMatch(/Bowral · 17 Oct 2026/);
    expect(c.scoreLabel).toBe('PTS');
  });
  it('Ambrose shows net to par', () => {
    const c = boardCard({ format: 'ambrose', rows: [{ name: 'Josh & Mike', thru: 18, netToPar: -4 }, { name: 'B', thru: 18, netToPar: 0 }] }, {});
    expect(c.rows.map((r) => r.score)).toEqual(['-4', 'E']);
    expect(c.scoreLabel).toBe('NET');
  });
  it('a Tribunal verdict', () => {
    const g = cardContent('verdict', { accused: 'Mike', verdict: 'upheld', oldHcp: 18, newHcp: 16, votes: '5–2' });
    expect(g.big).toBe('GUILTY');
    expect(g.line).toBe('Handicap 18 → 16');
    expect(cardContent('verdict', { accused: 'Mike', verdict: 'dismissed' }).big).toBe('NOT GUILTY');
  });
});

describe('dinner awards card', () => {
  it('a label, winner and votes per award, at most 6', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ label: `AWARD · ${i}`, name: `Name ${i}`, line: '2 votes' }));
    const c = cardContent('awards', { title: 'Hunter 2026', sub: '8 decided', rows });
    expect(c.eyebrow).toBe('🍽️ FINES & AWARDS');
    expect(c.title).toBe('Hunter 2026');
    expect(c.rows).toHaveLength(6);
    expect(c.rows[0]).toEqual({ label: 'AWARD · 0', name: 'Name 0', line: '2 votes' });
  });
});
