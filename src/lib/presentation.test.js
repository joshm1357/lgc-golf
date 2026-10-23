import { describe, it, expect } from 'vitest';
import {
  presentationItems, podiumPlaces, honourableMentions, stepsFor, flatSteps, winnerStep, awardItem, applyOrder, moveKey,
  finesTallyItem, cupStandingsItem, shareText, postIdFor, rankBy, beatFor,
} from './presentation.js';

const names = { mo: 'Mo', lou: 'Lou', bo: 'Bo', al: 'Al', ed: 'Ed', cy: 'Cy', di: 'Di' };
const nameOf = (id) => names[id] || id;
const trip = { id: 'trip1', name: 'Hunter 2026' };
const round = { id: 'r1', name: 'The big day', play_date: '2026-10-18' };

const bdRows = [
  { id: 'mo', name: 'Mo', rank: 1, total: 40, text: '40 pts' },
  { id: 'lou', name: 'Lou', rank: 2, total: 38, text: '38 pts' },
  { id: 'bo', name: 'Bo', rank: 3, total: 36, text: '36 pts' },
  { id: 'al', name: 'Al', rank: 4, total: 33, text: '33 pts' },
  { id: 'ed', name: 'Ed', rank: 5, total: 0, text: '–' },
];
const bd = {
  comp: { id: 'comp-bd', kind: 'individual_points' }, name: 'BD Trophy', trophy: { type: 'stableford_total' },
  st: { rows: bdRows }, winner: { names: 'Mo', ids: ['mo'] }, engraved: false, line: 'Mo wins the BD Trophy 2026, takes it from Bo',
};
const ambrose = {
  comp: { id: 'comp-amb', kind: 'ambrose_teams' }, name: 'Putt Buddies', st: { rows: [{ id: 't1', name: 'Mo & Lou', rank: 1, text: '−8', value: -8, played: 1 }] },
  winner: { names: 'Mo & Lou', ids: ['mo', 'lou'] }, engraved: false, line: 'Mo & Lou win Putt Buddies',
};
const award = { id: 'aw1', trip_id: 'trip1', title: 'Shot of the trip', kind: 'award', status: 'closed', created_at: '1' };
const fine = { id: 'f1', trip_id: 'trip1', title: 'Wrong ball', kind: 'fine', status: 'closed', reward_type: 'money', reward_amount: 5, created_at: '2' };
const late = { id: 'late', trip_id: 'trip1', title: 'Latest out', kind: 'award', status: 'closed', reward_type: 'strokes', reward_amount: -1, proof: 'photo_time', best: 'latest', winner_id: 'cy', created_at: '3' };
const nominations = [
  { id: 'n1', award_id: 'aw1', player_id: 'lou', reason: 'Holed out from the bunker', created_at: '1' },
  { id: 'n2', award_id: 'aw1', player_id: 'bo', reason: 'Chip-in on 18', created_at: '2' },
  { id: 'n3', award_id: 'aw1', player_id: 'al', photo_url: 'https://x/p.jpg', created_at: '3' },
  { id: 'n4', award_id: 'f1', player_id: 'mo', created_at: '1' },
  { id: 'n5', award_id: 'late', player_id: 'cy', claim_at: '2026-10-18T16:47:00Z', photo_url: 'https://x/late.jpg', created_at: '1' },
  { id: 'n6', award_id: 'late', player_id: 'di', claim_at: '2026-10-18T15:10:00Z', created_at: '2' },
];
const votes = [
  { award_id: 'aw1', nomination_id: 'n1', voter_id: 'bo', created_at: '1' },
  { award_id: 'aw1', nomination_id: 'n1', voter_id: 'al', created_at: '1' },
  { award_id: 'aw1', nomination_id: 'n2', voter_id: 'mo', created_at: '1' },
  { award_id: 'f1', nomination_id: 'n4', voter_id: 'lou', created_at: '1' },
];
const results = {
  nameOf, year: '2026',
  trophies: [bd, ambrose], hero: bd,
  podiums: [{ round, podium: [], rows: [
    { place: 1, id: 'mo', name: 'Mo', score: '40 pts', players: [{ id: 'mo' }] },
    { place: 2, id: 'lou', name: 'Lou', score: '38 pts', players: [{ id: 'lou' }] },
    { place: 2, id: 'bo', name: 'Bo', score: '38 pts', players: [{ id: 'bo' }] },
    { place: 4, id: 'al', name: 'Al', score: '33 pts', players: [{ id: 'al' }] },
  ] }],
  sides: [{ round, label: 'Sat 💣 LD 7', id: 'ed', name: 'Ed' }],
  sideEntries: [
    { round_id: 'r1', kind: 'ld', hole: 7, player_id: 'ed', distance_m: 271 },
    { round_id: 'r1', kind: 'ld', hole: 7, player_id: 'mo', distance_m: 255 },
  ],
  awards: { awards: [award, fine, late], nominations, votes },
  tally: [{ player_id: 'mo', count: 1, titles: ['Wrong ball'] }],
  tipped: [], photos: [],
};

describe('presentationItems: the running order', () => {
  it('side comps and fines first, then awards, the rounds, other trophies, and the main trophy last', () => {
    const items = presentationItems(trip, results);
    const keys = items.map((x) => x.key);
    expect(keys[0]).toBe('s-r1-Sat 💣 LD 7');
    expect(items.map((x) => x.section)).toEqual(['sides', 'fines', 'fines', 'awards', 'awards', 'rounds', 'trophies', 'main']);
    expect(keys[keys.length - 1]).toBe('t-comp-bd');
    expect(items.find((x) => x.key === 'a-f1').kind).toBe('fine');
  });
  it('works with nothing but a trip (nothing to present) and with no trip', () => {
    expect(presentationItems(trip, {})).toEqual([]);
    expect(presentationItems(null, results)).toEqual([]);
  });
  it('the main trophy has the hand-over line and its score', () => {
    const main = presentationItems(trip, results).find((x) => x.section === 'main');
    expect(main.handover).toMatch(/takes it from Bo/);
    expect(main.mode).toBe('podium');
    expect(main.worth).toBe('40 pts');
  });
  it('never says "dinner"', () => {
    const all = JSON.stringify(presentationItems(trip, results)).toLowerCase();
    expect(all).not.toContain('dinner');
  });
});

describe('honourable mentions', () => {
  it('4th and beyond, only with a story', () => {
    const m = honourableMentions(bdRows.filter((r) => r.text !== '–'));
    expect(m.map((x) => x.name)).toEqual(['Al']);
    expect(m[0].story).toBe('4th · 33 pts');
  });
  it('drops rows with no story or photo, and caps the list', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, rank: i + 1, text: i === 5 ? '' : `${30 - i} pts` }));
    const m = honourableMentions(rows);
    expect(m).toHaveLength(4);
    expect(m.map((x) => x.name)).toEqual(['P3', 'P4', 'P6', 'P7']);
  });
  it('an award\'s mentions are the nominations that missed out, with their reason or photo', () => {
    const it = awardItem(award, { nominations, votes, nameOf });
    expect(it.winner.name).toBe('Lou');
    expect(it.winner.score).toBe('2 votes');
    expect(it.mentions.map((m) => [m.name, m.story, m.photo])).toEqual([['Bo', 'Chip-in on 18', null], ['Al', '', 'https://x/p.jpg']]);
  });
});

describe('ties', () => {
  it('joint 2nd shows both, and there is no 3rd', () => {
    const r = presentationItems(trip, results).find((x) => x.kind === 'round');
    expect(r.places.map((p) => [p.label, p.entrants.map((e) => e.name)])).toEqual([['1st', ['Mo']], ['Joint 2nd', ['Lou', 'Bo']]]);
    expect(stepsFor(r).map((s) => s.type + (s.place || ''))).toEqual(['title', 'mentions', 'place2', 'place1']);
    expect(r.mentions[0].story).toBe('4th · 33 pts');
    expect(beatFor(2, true)).toMatch(/tie/);
  });
  it('joint 1st on votes is a joint win', () => {
    const v = [...votes, { award_id: 'aw1', nomination_id: 'n2', voter_id: 'ed', created_at: '1' }];
    const it = awardItem(award, { nominations, votes: v, nameOf });
    expect(it.winner.name).toBe('Lou & Bo');
    expect(it.winner.joint).toBe(true);
    expect(it.winner.score).toBe('2 votes each');
  });
  it('podiumPlaces groups ties and rankBy ranks 1, 2, 2, 4', () => {
    const ranked = rankBy([{ id: 'a', v: 5 }, { id: 'b', v: 3 }, { id: 'c', v: 3 }, { id: 'd', v: 1 }], (r) => r.v);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    const places = podiumPlaces(ranked.map((r) => ({ ...r, name: r.id })));
    expect(places.map((p) => p.place)).toEqual([1, 2]);
    expect(places[1].joint).toBe(true);
  });
});

describe('awards with one winner', () => {
  it('Latest out: title → nominations → winner, with the claim and the reward', () => {
    const it = awardItem(late, { nominations, votes, nameOf });
    expect(it.mode).toBe('single');
    expect(stepsFor(it).map((s) => s.type)).toEqual(['title', 'mentions', 'winner']);
    expect(it.winner.name).toBe('Cy');
    expect(it.winner.photo).toBe('https://x/late.jpg');
    expect(it.winner.score).toMatch(/3:47am/);
    expect(it.worth).toBe('−1 stroke next round');
    expect(it.mentions.map((m) => m.name)).toEqual(['Di']);
  });
  it('a fine with one person fined: title → winner (nobody else to mention)', () => {
    const it = awardItem(fine, { nominations, votes, nameOf });
    expect(stepsFor(it).map((s) => s.type)).toEqual(['title', 'winner']);
    expect(it.about).toBe('Fine: $5');
  });
  it('open or empty awards are left out', () => {
    expect(awardItem({ ...award, status: 'voting' }, { nominations, votes })).toBeNull();
    expect(awardItem({ ...award, id: 'none' }, { nominations, votes })).toBeNull();
  });
  it('a side comp: one winner, the next-best shots as mentions', () => {
    const it = presentationItems(trip, results)[0];
    expect(it.title).toBe('Longest drive · 7');
    expect(it.winner).toMatchObject({ name: 'Ed', score: '271 m' });
    expect(it.mentions[0].story).toBe('2nd · 255 m');
  });
});

describe('steps and the running order', () => {
  it('flatSteps and "skip to winner"', () => {
    const items = presentationItems(trip, results);
    const flat = flatSteps(items);
    const j = winnerStep(flat, 0);
    expect(flat[j].step.type).toBe('winner');
    expect(flat[j].last).toBe(true);
    expect(flat[j + 1].index).toBe(1);
  });
  it('applyOrder keeps the organiser\'s order, ticks, and slots new items in', () => {
    const items = presentationItems(trip, results);
    const keys = items.map((x) => x.key);
    const saved = { order: moveKey(keys.filter((k) => k !== 'a-aw1'), 't-comp-bd', 0), off: ['fines-tally'] };
    const out = applyOrder(items, saved);
    expect(out[0].key).toBe('t-comp-bd');
    expect(out.find((x) => x.key === 'fines-tally').on).toBe(false);
    expect(out.map((x) => x.key)).toContain('a-aw1');
    expect(out).toHaveLength(items.length);
  });
  it('the fines tally is a podium of the most fined', () => {
    const it = finesTallyItem([{ player_id: 'mo', count: 3, titles: ['a'] }, { player_id: 'bo', count: 3, titles: ['b'] }, { player_id: 'al', count: 1, titles: ['c'] }], { nameOf });
    expect(it.places.map((p) => p.label)).toEqual(['Joint 1st', '3rd']);
  });
});

describe('ov32 cups (extension point)', () => {
  it('a cup with standings and a breakdown becomes a podium in the cups section, before the main trophy', () => {
    const cups = [{ cup: { id: 'c1', name: 'Weekend Cup' }, standings: { rows: [
      { id: 'mo', name: 'Mo', value: 30, breakdown: [{ label: 'Cap tips 🧢', value: 12 }, { label: 'Vibe points', value: 8 }] },
      { id: 'lou', name: 'Lou', value: 20 }, { id: 'bo', name: 'Bo', value: 15 }, { id: 'al', name: 'Al', value: 9, breakdown: [{ label: 'Vibe points', value: 9 }] },
    ] } }];
    const items = presentationItems(trip, { ...results, cups });
    const keys = items.map((x) => x.key);
    expect(keys.indexOf('cup-c1')).toBe(keys.length - 2);
    const cup = items.find((x) => x.key === 'cup-c1');
    expect(cup.places[0].entrants[0].name).toBe('Mo');
    expect(cup.mentions[0].story).toBe('4th · 9 pts · Vibe points 9');
    expect(cupStandingsItem({ cup: { id: 'x', name: 'Empty' }, standings: { rows: [] } })).toBeNull();
  });
});

describe('sharing to the Feed', () => {
  it('one line per item', () => {
    const items = presentationItems(trip, results);
    expect(shareText(items.find((x) => x.kind === 'round'))).toBe('⛳ The big day — 1st Mo 40 pts · Joint 2nd Lou & Bo 38 pts');
    expect(shareText(items.find((x) => x.section === 'main'), 'Hunter 2026')).toMatch(/takes it from Bo\n🎤 Hunter 2026 presentation$/);
  });
  it('the same item always gets the same post id (one post per item)', async () => {
    const a = await postIdFor('trip1', 't-comp-bd');
    expect(a).toBe(await postIdFor('trip1', 't-comp-bd'));
    expect(a).not.toBe(await postIdFor('trip1', 'a-aw1'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('cup standings from ov32 (wired at the v10 merge)', () => {
  it('takes a one-line breakdown as the honourable mention story', async () => {
    const { cupStandingsItem } = await import('./presentation.js');
    const rows = ['A', 'B', 'C', 'D'].map((n, i) => ({ id: n, name: n, value: 10 - i, text: `${10 - i} pts`, rank: i + 1, breakdown: `Latest out +${4 - i} · Vibe +6 (3 photos)` }));
    const item = cupStandingsItem({ cup: { id: 'c', name: 'Weekend Cup' }, standings: { rows } });
    expect(item.mentions.map((m) => m.story || m.text || JSON.stringify(m)).join(' ')).toMatch(/Vibe \+6/);
  });
});
