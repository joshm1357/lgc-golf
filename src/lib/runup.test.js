import { describe, it, expect } from 'vitest';
import { upForGrabs, usualComps, handicapRows, ruleDisputes, reviewDue } from './runup.js';

describe('the run-up (ov23)', () => {
  it('what’s up for grabs: the trip’s comps and trophies; the Cup only for groups that use it; put-away ones unticked', () => {
    const comps = [
      { id: 'c1', trip_id: 't', name: 'BD Trophy', kind: 'individual_points', sort: 0 },
      { id: 'c2', trip_id: 't', name: 'The Cup', kind: 'cup', sort: 1 },
      { id: 'c3', trip_id: 't', name: 'Noodle Cup', kind: 'manual', sort: 2, retired: true },
      { id: 'x', trip_id: 'other', name: 'Old', kind: 'manual' },
    ];
    const trophies = [{ id: 'tr1', trip_id: 't', name: 'Putt Buddies', type: 'ambrose' }];
    const off = upForGrabs({ comps, trophies, tripId: 't', cupOn: false });
    expect(off.map((c) => [c.name, c.retired])).toEqual([['BD Trophy', false], ['Putt Buddies', false], ['Noodle Cup', true]]);
    expect(off.find((c) => c.name === 'Putt Buddies')).toMatchObject({ virtual: true, what: 'Ambrose teams' });
    expect(upForGrabs({ comps, trophies, tripId: 't', cupOn: true }).map((c) => c.name)).toContain('The Cup');
  });
  it('before the trip’s in the app: what the group usually plays for', () => {
    const trips = [{ id: 'a', start_date: '2025-03-01' }, { id: 'b', start_date: '2026-03-01' }, { id: 'c', start_date: '2026-09-01' }];
    const trophies = [{ trip_id: 'a', name: 'Old one' }, { trip_id: 'b', name: 'BD Trophy' }, { trip_id: 'b', name: 'The Cup' }];
    expect(usualComps({ trips, trophies })).toEqual(['BD Trophy']);
    expect(usualComps({ trips, trophies, cupOn: true })).toEqual(['BD Trophy', 'The Cup']);
  });
  it('handicaps check: who’s in, last change, open disputes', () => {
    const players = [{ id: 'p1', name: 'Kurt', handicap: 12.5 }, { id: 'p2', name: 'Al', handicap: 18 }, { id: 'p3', name: 'Gus', handicap: 9, role: 'guest' }];
    const history = [{ player_id: 'p1', old_handicap: 14, new_handicap: 12.5, reason: 'Tribunal', created_at: '2026-10-03T01:00:00Z' }, { player_id: 'p1', old_handicap: null, new_handicap: 14, reason: 'Starting handicap', created_at: '2026-01-01T00:00:00Z' }];
    const cases = [{ status: 'open', subject_ref: { table: 'players', id: 'p2', field: 'handicap' } }, { status: 'open', rule_id: 'r1', title: 'Gimmes' }];
    const rows = handicapRows({ players, inIds: [], history, cases });
    expect(rows.map((r) => [r.name, r.text, r.dispute])).toEqual([['Al', '18', true], ['Kurt', '12.5', false]]);
    expect(rows[1].lastChange).toMatch(/^Was 14 → 12\.5 on \d+ Oct · Tribunal$/);
    expect(rows[0].lastChange).toBe('No changes yet');
    expect(handicapRows({ players, inIds: ['p1'], history, cases }).map((r) => r.name)).toEqual(['Kurt']);
    expect(ruleDisputes(cases).map((c) => c.title)).toEqual(['Gimmes']);
  });
  it('the "Review handicaps" prompt: before the first round, until reviewed', () => {
    expect(reviewDue({ firstRound: '2026-11-06', today: '2026-10-23' })).toBe(true);
    expect(reviewDue({ firstRound: '2026-11-06', today: '2026-10-23', reviewed: { at: '2026-10-22T00:00:00Z' } })).toBe(false);
    expect(reviewDue({ firstRound: '2027-03-06', today: '2026-10-23', reviewed: { at: '2026-10-22T00:00:00Z' } })).toBe(true); // stale by then
    expect(reviewDue({ firstRound: '2026-10-01', today: '2026-10-23' })).toBe(false);
    expect(reviewDue({ firstRound: null, today: '2026-10-23' })).toBe(false);
  });
});
