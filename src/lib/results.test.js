import { describe, it, expect } from 'vitest';
import {
  tripFinished, tripYear, roundPodium, previousHolder, engraved, handoverLine, compWinner, finesTally, finesLine,
  tippedRight, tipCounts, bestPhotos, resultsText, thisTimeLastYear, nextTripNudge,
} from './results.js';

describe('is the trip over?', () => {
  const trip = { id: 't', start_date: '2026-10-22', end_date: '2026-10-24' };
  it('after its last day, or every round locked on the last day', () => {
    expect(tripFinished(trip, [], '2026-10-25')).toBe(true);
    expect(tripFinished(trip, [{ trip_id: 't', status: 'locked', play_date: '2026-10-24' }], '2026-10-24')).toBe(true);
    expect(tripFinished(trip, [{ trip_id: 't', status: 'live', play_date: '2026-10-24' }], '2026-10-24')).toBe(false);
    expect(tripFinished(trip, [], '2026-10-23')).toBe(false);
    expect(tripFinished({ id: 'x' }, [], '2026-10-23')).toBe(false);
    expect(tripYear(trip, [], '2027-01-01')).toBe('2026');
  });
});

describe('podium', () => {
  it('the top three places (ties share), only people who played', () => {
    const board = { format: 'stableford', rows: [
      { id: 'a', name: 'Mo', rank: 1, rankLabel: '1', thru: 18, points: 40 },
      { id: 'b', name: 'Lou', rank: 2, rankLabel: 'T2', thru: 18, points: 36 },
      { id: 'c', name: 'Bo', rank: 2, rankLabel: 'T2', thru: 18, points: 36 },
      { id: 'd', name: 'Al', rank: 4, rankLabel: '4', thru: 18, points: 30 },
      { id: 'e', name: 'Cy', rank: 5, rankLabel: '5', thru: 0, points: 0 },
    ] };
    expect(roundPodium(board).map((p) => `${p.label} ${p.name} ${p.score}`)).toEqual(['1 Mo 40 pts', 'T2 Lou 36 pts', 'T2 Bo 36 pts']);
    expect(roundPodium(null)).toEqual([]);
  });
});

describe('trophies hand over', () => {
  const hb = [
    { id: 1, trophy_name: 'BD Trophy', label: '2025', winner_names: 'Bo', player_ids: ['bo'], trip_id: 'old', sort_key: 10, created_at: '2025-10-01' },
    { id: 2, trophy_name: 'BD Trophy', label: '2024', winner_names: 'Al', player_ids: ['al'], trip_id: 'older', sort_key: 5, created_at: '2024-10-01' },
    { id: 3, trophy_name: 'Noodle Cup', label: '2026', winner_names: 'Mo', player_ids: ['mo'], trip_id: 'now', sort_key: 20 },
  ];
  it('who held it, and whether it\'s engraved yet', () => {
    expect(previousHolder({ trophyName: 'bd trophy', tripId: 'now', honourBoard: hb })).toEqual({ names: 'Bo', ids: ['bo'] });
    expect(previousHolder({ trophyName: 'Putt Buddies', tripId: 'now', honourBoard: hb })).toBeNull();
    expect(engraved({ trophyName: 'Noodle Cup', tripId: 'now', honourBoard: hb })?.id).toBe(3);
    expect(engraved({ trophyName: 'BD Trophy', tripId: 'now', honourBoard: hb })).toBeNull();
  });
  it('the words', () => {
    expect(handoverLine({ trophyName: 'BD Trophy', year: '2026', winner: 'Mo', winnerIds: ['mo'], previous: { names: 'Bo', ids: ['bo'] } }))
      .toBe('Mo wins the BD Trophy 2026, takes it from Bo');
    expect(handoverLine({ trophyName: 'BD Trophy', year: '2026', winner: 'Bo', winnerIds: ['bo'], previous: { names: 'Bo', ids: ['bo'] } }))
      .toBe('Bo keeps the BD Trophy 2026');
    expect(handoverLine({ trophyName: 'Putt Buddies', year: '2026', winner: 'Mo & Lou', winnerIds: ['mo', 'lou'] })).toBe('Mo & Lou win the Putt Buddies 2026');
    expect(handoverLine({ trophyName: 'X', winner: null })).toBeNull();
  });
  it('a comp\'s winner, joint winners together', () => {
    expect(compWinner({ rows: [{ id: 'a', name: 'Mo', rank: 1, total: 41, text: '41 pts', players: [{ id: 'a' }] }, { id: 'b', name: 'Lou', rank: 2, total: 40 }] }))
      .toEqual({ names: 'Mo', ids: ['a'], text: '41 pts' });
    expect(compWinner({ rows: [{ id: 'a', name: 'Mo', rank: 1, total: 41, text: '41' }, { id: 'b', name: 'Lou', rank: 1, total: 41, text: '41' }] }).names).toBe('Mo & Lou');
    expect(compWinner({ rows: [] })).toBeNull();
  });
});

describe('fines, tips and photos', () => {
  it('fines tally: fines only, most first', () => {
    const awards = [{ id: 'f1', kind: 'fine', title: 'Wrong ball' }, { id: 'f2', kind: 'fine', title: 'Late' }, { id: 'a1', kind: 'award', title: 'Shot of the day' }];
    const noms = [{ award_id: 'f1', player_id: 'mo' }, { award_id: 'f2', player_id: 'mo' }, { award_id: 'f1', player_id: 'bo' }, { award_id: 'a1', player_id: 'al' }];
    const t = finesTally({ awards, nominations: noms });
    expect(t.map((x) => [x.player_id, x.count])).toEqual([['mo', 2], ['bo', 1]]);
    expect(finesLine(t, (id) => id.toUpperCase())).toBe('MO 2 · BO 1');
    expect(finesLine([], (x) => x)).toBeNull();
  });
  it('who tipped right, and the running counts', () => {
    const tips = [{ player_id: 'a', pick: 'red' }, { player_id: 'b', pick: 'blue' }, { player_id: 'c', pick: 'red' }];
    expect(tippedRight(tips, 'red')).toEqual({ right: ['a', 'c'], count: 2, of: 3 });
    expect(tippedRight([{ player_id: 'a', pick_id: 'mo' }], ['mo']).right).toEqual(['a']);
    expect(tipCounts(tips, [{ value: 'blue', label: 'Blue' }, { value: 'red', label: 'Red' }])).toBe('2 tipped Red, 1 tipped Blue');
    expect(tipCounts([], [])).toBeNull();
  });
  it('best photos: most reactions, then newest', () => {
    const posts = [{ id: 1, photo_url: 'x', created_at: '1' }, { id: 2, photo_url: 'y', created_at: '2' }, { id: 3, photo_url: null }];
    expect(bestPhotos(posts, [{ post_id: 1 }]).map((p) => p.id)).toEqual([1, 2]);
  });
  it('the text for the group chat', () => {
    expect(resultsText('Hunter 2026', ['🏆 Mo wins', null])).toBe('🏁 Hunter 2026 — the results\n\n🏆 Mo wins');
  });
});

describe('months later (I16)', () => {
  const trips = [
    { id: 'a', name: 'Hunter 2025', start_date: '2025-10-20', end_date: '2025-10-22' },
    { id: 'b', name: 'Coast 2026', start_date: '2026-03-01', end_date: '2026-03-03' },
  ];
  it('this time last year', () => {
    expect(thisTimeLastYear({ trips, today: '2026-10-23' })).toMatchObject({ trip: { id: 'a' }, ago: 1 });
    expect(thisTimeLastYear({ trips, today: '2026-12-25' })).toBeNull();
  });
  it('a nudge six months after the last trip, only when nothing is coming', () => {
    expect(nextTripNudge({ trips, today: '2026-10-23' })).toMatchObject({ trip: { id: 'b' }, months: 7 });
    expect(nextTripNudge({ trips, today: '2026-06-01' })).toBeNull();
    expect(nextTripNudge({ trips: [...trips, { id: 'c', start_date: '2027-01-10' }], today: '2026-10-23' })).toBeNull();
  });
});
