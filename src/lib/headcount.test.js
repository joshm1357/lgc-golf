import { describe, it, expect } from 'vitest';
import { tripPeople, replies, repliesLine, playing, teeTimesFor, playersLine } from './headcount.js';
import { tripHeadcount } from './weekends.js';
import { teeTimesNeeded } from './tripbuilder.js';
import { callScript, callChecklist } from './teegrid.js';

// The walkthrough's trip: 11 in the group, 9 in, 1 maybe, 1 not replied — one count everywhere (O6).
const players = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, approved: true }));
const rsvps = [...players.slice(0, 9).map((p) => ({ player_id: p.id, status: 'in' })), { player_id: 'p9', status: 'maybe' }];

describe('one headcount rule (O6)', () => {
  it('replies are counted over the trip’s people, one way', () => {
    const r = replies({ players, rsvps });
    expect(r).toMatchObject({ in: 9, maybe: 1, out: 0, noReply: 1, total: 11 });
    expect(repliesLine(r)).toBe('9 in · 1 maybe · 1 not replied');
    expect(r.ids.noReply).toEqual(['p10']);
  });
  it('guests count only once they reply; unapproved players never', () => {
    const more = [...players, { id: 'g', approved: true, role: 'guest' }, { id: 'x', approved: false }];
    expect(tripPeople({ players: more, rsvps })).toHaveLength(11);
    expect(tripPeople({ players: more, rsvps: [...rsvps, { player_id: 'g', status: 'in' }] })).toHaveLength(12);
    expect(repliesLine(replies({ players: more, rsvps: [...rsvps, { player_id: 'p10', status: 'out' }] }))).toBe('9 in · 1 maybe · 1 out');
  });
  it('playing: the target first — labelled as a target — then in, then in or maybe, then the group', () => {
    expect(playing({ target: 10, players, rsvps })).toMatchObject({ people: 10, needed: 3, source: 'target', label: 'for 10 (target)' });
    expect(playing({ target: 10, targetBy: 'ai', players, rsvps }).label).toBe('for 10 (target)');
    expect(playing({ players, rsvps })).toMatchObject({ people: 9, needed: 3, source: 'in', label: '9 in' });
    expect(playing({ players, rsvps: [{ player_id: 'p0', status: 'maybe' }] })).toMatchObject({ people: 1, source: 'keen' });
    expect(playing({ players })).toMatchObject({ people: 11, source: 'group' });
    expect(playing({})).toMatchObject({ people: 0, needed: 0, source: 'none', label: 'not known yet' });
  });
  it('tee times: players ÷ 4, up', () => {
    expect([1, 4, 5, 9, 10, 12, 13].map(teeTimesFor)).toEqual([1, 1, 2, 3, 3, 3, 4]);
    expect(playersLine(10)).toBe('10 players — 3 tee times in a row');
  });
  it('the old helpers give the same number (the trip builder, the searches)', () => {
    expect(tripHeadcount({ set: 10, players, rsvps }).people).toBe(playing({ target: 10, players, rsvps }).people);
    expect(tripHeadcount({ players, rsvps })).toMatchObject({ people: 9, source: 'in' });
    expect(teeTimesNeeded({ rsvps, override: 10, players })).toMatchObject({ people: 10, needed: 3, source: 'set' });
    expect(teeTimesNeeded({ players })).toMatchObject({ people: 11, needed: 3, source: 'group' });
  });
  it('the calling script says the same number as the screen (10, not 3 × 4 = 12)', () => {
    const s = callScript({ course: 'Nowra GC', need: 3, people: 10, dates: ['2027-01-22'] });
    expect(s).toMatch(/3 tee times in a row — 10 players/);
    expect(s).not.toMatch(/12 players/);
    expect(callChecklist(['2027-01-22'], { need: 3, people: 10 })[1]).toBe('3 tee times in a row (10 players) — what times?');
  });
});
