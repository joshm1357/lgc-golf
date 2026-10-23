import { describe, it, expect } from 'vitest';
import { tripRole, addable, coorgLine, helpPath, helpMessage, MAX_COORGANISERS } from './coorganisers.js';

describe('co-organisers', () => {
  const plan = { id: 'p1', organiser_id: 'o' };
  const list = [{ player_id: 'h' }];
  it('knows who can plan and who can name them', () => {
    expect(tripRole({ list, me: 'h', plan })).toEqual({ coorg: true, canName: false, organises: true });
    expect(tripRole({ list, me: 't', plan })).toEqual({ coorg: false, canName: false, organises: false });
    expect(tripRole({ list, me: 'a', plan, isAdmin: true })).toEqual({ coorg: false, canName: true, organises: true });
    // The trip's own organiser (not a group organiser) can name them but isn't a co-organiser.
    expect(tripRole({ list, me: 'o', plan })).toEqual({ coorg: false, canName: true, organises: false });
    expect(tripRole({})).toEqual({ coorg: false, canName: false, organises: false });
  });
  it('offers players who aren’t on yet, not guests or me', () => {
    const players = [{ id: 'me' }, { id: 'h' }, { id: 't' }, { id: 'g' }, { id: 'x', approved: false }];
    expect(addable(players, list, { me: 'me', guests: ['g'] }).map((p) => p.id)).toEqual(['t']);
  });
  it('words', () => {
    expect(coorgLine(['Hamish'])).toBe('Hamish can change this plan too.');
    expect(coorgLine(['Hamish', 'Tom', 'Al'])).toBe('Hamish, Tom and Al can change this plan too.');
    expect(coorgLine([])).toBe('');
    expect(helpPath('p1')).toBe('/plan/p1?view=organise&role=co');
    expect(helpMessage({ planName: 'March trip', who: 'Hamish', link: 'https://x/#/plan/p1' }))
      .toBe('🧰 Hamish, help me plan March trip? You’re a co-organiser — you can change the plan, call the votes and sort the jobs. https://x/#/plan/p1');
    expect(MAX_COORGANISERS).toBe(3);
  });
});
