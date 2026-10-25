import { describe, it, expect } from 'vitest';
import { cleanWishes, fridayOf, peopleFor, datesCheck, driveCheck, flyCheck, golfCheck, teeCheck, costCheck, duskCheck, fitOption, notForLine, rankByFit, wishesSummary } from './tripfit.js';

const names = { a: 'Al', b: 'Bo', c: 'Cy', d: 'Di', e: 'Ed' };
const people = Object.entries(names).map(([id, name]) => ({ id, name }));
const nameOf = (id) => names[id];
const at = (h, m = 0) => h * 60 + m;

describe('reading plan_wishes defensively', () => {
  it('keeps the known values, drops the rest, newest row per person wins', () => {
    const w = cleanWishes([
      { player_id: 'a', travel: 'fly', spend_band: 'lt500', cant_dates: ['2027-03-12', 'junk'], max_drive_min: '180', day_pref: 'morning_free', golf_per_day: 'one', wish: '  beers  ' },
      { player_id: 'b', travel: 'boat', spend_band: 'lots', max_drive_min: -5 },
      { player_id: 'b', travel: 'drive' },
      null, { travel: 'fly' },
    ]);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ travel: 'fly', spend_band: 'lt500', cant_dates: ['2027-03-12'], max_drive_min: 180, day_pref: 'morning_free', golf_per_day: 'one', wish: 'beers' });
    expect(w[1]).toMatchObject({ travel: 'drive', spend_band: null, max_drive_min: null });
    expect(cleanWishes(undefined)).toEqual([]);
  });
});

describe('the weekend', () => {
  it('finds the Friday of a weekend', () => {
    expect(fridayOf('2027-03-12')).toBe('2027-03-12'); // Fri
    expect(fridayOf('2027-03-11')).toBe('2027-03-12'); // Thu
    expect(fridayOf('2027-03-13')).toBe('2027-03-12'); // Sat
    expect(fridayOf('2027-03-14')).toBe('2027-03-12'); // Sun
  });
  it('who can make it, from cant_dates and RSVPs', () => {
    const wishes = cleanWishes([{ player_id: 'a', cant_dates: ['2027-03-12'] }]);
    const r = datesCheck('2027-03-13', { people, wishes, rsvps: [{ player_id: 'b', status: 'out' }] });
    expect(r.line).toBe('fits 3 of 5');
    expect(r.no.map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('who we fit: in + maybe first, else those with wishes, else the group', () => {
    expect(peopleFor({ rsvps: [{ player_id: 'a', status: 'in' }, { player_id: 'b', status: 'maybe' }, { player_id: 'c', status: 'out' }], nameOf }).map((p) => p.name)).toEqual(['Al', 'Bo']);
    expect(peopleFor({ wishes: [{ player_id: 'd' }], nameOf })).toEqual([{ id: 'd', name: 'Di' }]);
    expect(peopleFor({ players: [{ id: 'e' }, { id: 'x', approved: false }], nameOf })).toEqual([{ id: 'e', name: 'Ed' }]);
  });
});

describe('the checks', () => {
  const wishes = cleanWishes([
    { player_id: 'a', max_drive_min: 120, travel: 'drive', golf_per_day: 'one', day_pref: 'morning_free', spend_band: 'lt500' },
    { player_id: 'b', max_drive_min: 240, travel: 'fly', day_pref: 'midday', spend_band: '800_1200' },
    { player_id: 'c', travel: 'either', day_pref: 'early' },
  ]);
  it('drive within each person’s longest', () => {
    const r = driveCheck(180, { people, wishes });
    expect(r.no).toEqual([{ id: 'a', why: 'more than 2 h drive' }]);
    expect(r.line).toBe('within 3 h for 4');
    expect(driveCheck(180, { people, wishes: [] }).line).toBe(null);
  });
  it('flying only if enough said fly or either', () => {
    expect(flyCheck({ people, wishes }).allowed).toBe(true); // 2 of 3
    expect(flyCheck({ people, wishes }).no).toEqual([{ id: 'a', why: 'would rather drive' }]);
    expect(flyCheck({ people, wishes: cleanWishes([{ player_id: 'a', travel: 'drive' }, { player_id: 'b', travel: 'drive' }, { player_id: 'c', travel: 'fly' }]) }).allowed).toBe(false);
  });
  it('36 holes in a day vs one round a day', () => {
    expect(golfCheck(2, { people, wishes }).no.map((x) => x.id)).toEqual(['a']);
    expect(golfCheck(1, { people, wishes }).line).toBe(null);
  });
  it('tee times vs the day wishes', () => {
    const prefs = wishes.filter((w) => w.day_pref).map((w) => ({ who: w.player_id, pref: w.day_pref }));
    const r = teeCheck(at(12, 30), { people, prefs });
    expect(r.no.map((x) => x.id)).toEqual(['c']);
    expect(r.line).toMatch(/^tee 12:30pm suits “(morning free|play midday)”$/);
    expect(teeCheck(at(7, 30), { people, prefs }).no.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
  it('daylight and cost', () => {
    expect(duskCheck(120).line).toBe('2 h before dusk');
    expect(duskCheck(10).line).toBe('tight before dusk');
    expect(duskCheck(-20).line).toBe('about 20 min after dusk ✗');
    const c = costCheck(650, { people, wishes });
    expect(c.no).toEqual([{ id: 'a', why: 'budget under $500' }]);
    expect(costCheck(null, { people, wishes }).line).toBe(null);
  });
});

describe('the fit line', () => {
  const wishes = cleanWishes([
    { player_id: 'a', cant_dates: ['2027-03-12'] },
    { player_id: 'b', max_drive_min: 120 },
    { player_id: 'c', day_pref: 'midday' },
  ]);
  const prefs = [{ who: 'c', pref: 'midday' }];
  it('says it plainly, and names who it doesn’t suit', () => {
    const f = fitOption({ weekend: '2027-03-12', drive: 180, tee: at(12, 30), duskMargin: 120 }, { people, wishes, prefs, nameOf });
    expect(f.line).toBe('fits 4 of 5 · within 3 h for 4 · tee 12:30pm suits “play midday” · 2 h before dusk');
    expect(f.fits).toBe(3);
    expect(f.notFor).toEqual([{ id: 'a', name: 'Al', why: ['can’t do that weekend'] }, { id: 'b', name: 'Bo', why: ['more than 2 h drive'] }]);
    expect(notForLine(f.notFor)).toBe('Not for: Al (can’t do that weekend), Bo (more than 2 h drive)');
  });
  it('without a weekend it leads with who it suits', () => {
    const f = fitOption({ tee: at(8) }, { people, wishes, prefs, nameOf });
    expect(f.line).toMatch(/^suits 4 of 5 · tee 8am/);
  });
  it('ranks by fit but keeps every line', () => {
    const r = rankByFit([{ k: 1, fit: { fits: 2 } }, { k: 2, fit: { fits: 4 } }, { k: 3, fit: { fits: 4 } }]);
    expect(r.map((x) => x.k)).toEqual([2, 3, 1]);
  });
  it('sums up what the group said', () => {
    expect(wishesSummary([], people)).toBe('Nobody’s said what they’d like yet.');
    const s = wishesSummary(cleanWishes([{ player_id: 'a', travel: 'fly', day_pref: 'morning_free', max_drive_min: 180 }, { player_id: 'b', golf_per_day: 'one', max_drive_min: 240 }]), people);
    expect(s).toBe('2 of 5 have said what they’d like · 1 happy to fly · longest drive mostly about 3 h · 1 want one round a day · 1 want mornings free');
  });
});
