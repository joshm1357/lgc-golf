import { describe, it, expect } from 'vitest';
import {
  PURPOSES, GOLF_FORMATS, SOURCES, LATER_SOURCES, defaultCounts, cleanCounts, sourceOn, kindForCup, compForCup, cupsForTrip,
  tripCupComps, howToWin, trophyReminder, capTipState, canUndo, vibePoints, isSystemPost, placingPoints, cupStandings,
  isCupComp, capTipName, myLine, ordinal, mainWinnerIds,
} from './cups.js';
import { compStandings, cleanSettings } from './comps.js';

const T = 't1';
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const sc = (arr) => Object.fromEntries(arr.map((v, i) => [i + 1, { strokes: v }]));
const P = (id) => ({ id, name: id, nickname: id, handicap: 0, approved: true });
const players = ['A', 'B', 'C', 'D'].map(P);
const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
const R = (id, play_date, extra = {}) => ({ id, trip_id: T, course_id: 'c', name: `Round ${id.slice(1)}`, format: 'stableford', play_date, status: 'locked', ctp_holes: [], ld_holes: [], own_comps: [], created_at: play_date, ...extra });
const rounds = [R('r1', '2026-10-23', { ctp_holes: [3] }), R('r2', '2026-10-24')];
const rp = (ids) => ids.map((id) => ({ player_id: id, playing_handicap: 0 }));
const at = (day, hh = '10') => `${day}T${hh}:00:00+11:00`;
const data = {
  trips: [{ id: T, name: 'Hunter 2026', start_date: '2026-10-23', end_date: '2026-10-24' }],
  rounds, players, playersById, coursesById: { c: { id: 'c', holes } },
  roundPlayers: { r1: rp(['A', 'B', 'C', 'D']), r2: rp(['A', 'B']) },
  teamsByRound: {},
  // Round 1: A 3,4 = 5 pts · B 4,4 = 4 · C 5,4 = 3 · D 4,5 = 3 (C and D tie 3rd). Round 2: B 3,3 = 6 · A 4,4 = 4.
  scoresIdx: { r1: { A: sc([3, 4]), B: sc([4, 4]), C: sc([5, 4]), D: sc([4, 5]) }, r2: { A: sc([4, 4]), B: sc([3, 3]) } },
  quickResults: [],
  sideEntries: [{ round_id: 'r1', kind: 'ctp', hole: 3, player_id: 'C', distance_m: 1.2 }, { round_id: 'r1', kind: 'ctp', hole: 3, player_id: 'A', distance_m: 3 }],
  ownDefs: [], ownEntries: [], games: [],
  cupSides: [], cupMatches: [
    { id: 'm1', round_id: 'r1', a_players: ['A', 'B'], b_players: ['C', 'D'], points: 1, holes: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), 'a'])) },
  ],
  trophies: [], honourBoard: [],
  cupPoints: [
    { id: 'p1', comp_id: 'cup-social', player_id: 'B', points: 2, source_type: 'award', label: 'Latest out', confirmed_at: at('2026-10-23') },
    { id: 'p2', comp_id: 'cup-social', player_id: 'A', points: -1, source_type: 'fine', label: 'Wrong ball', confirmed_at: at('2026-10-23') },
    { id: 'p3', comp_id: 'cup-social', player_id: 'A', points: 5, source_type: 'award', label: 'Pending one', confirmed_at: null },
    { id: 'p4', comp_id: 'cup-social', player_id: 'A', points: 5, source_type: 'manual', label: 'Waived', confirmed_at: at('2026-10-23'), waived_at: at('2026-10-23') },
    { id: 'p5', comp_id: 'other-cup', player_id: 'D', points: 9, source_type: 'award', label: 'Another cup', confirmed_at: at('2026-10-23') },
    ...[1, 2, 3].map((i) => ({ id: `k${i}`, comp_id: 'cup-social', player_id: 'D', points: 1, source_type: 'kudos', label: 'Cap tip', confirmed_at: at('2026-10-23') })),
    { id: 'p6', comp_id: 'cup-social', player_id: 'C', points: 3, source_type: 'activity', label: 'Go-karts 1st', confirmed_at: at('2026-10-23') },
  ],
  posts: [
    { id: 'v1', kind: 'user', player_id: 'C', body: 'Here we go', created_at: at('2026-10-22') }, // day before: counts
    { id: 'v2', kind: 'user', player_id: 'C', photo_url: 'https://x/p.jpg', created_at: at('2026-10-23') },
    { id: 'v3', kind: 'user', player_id: 'C', photo_url: 'https://x/v.mp4', created_at: at('2026-10-23', '11') },
    { id: 'v4', kind: 'auto', player_id: 'C', body: 'Birdie!', created_at: at('2026-10-23') }, // scoreboard: no
    { id: 'v5', kind: 'user', player_id: 'C', body: 'too early', created_at: at('2026-10-20') }, // outside the window
  ],
  tips: [{ id: 'tp1', trip_id: T, player_id: 'D', target: 'match', target_id: 'm1', pick: 'a' }, { id: 'tp2', trip_id: T, player_id: 'C', target: 'round', target_id: 'r2', pick: 'B' }],
  scoreAdjustments: [{ id: 'sa1', round_id: 'r1', player_id: 'B', strokes: 1, kind: 'rule_breach', label: 'Wrong ball (+1)' }, { id: 'sa2', round_id: 'r1', player_id: 'B', strokes: 2, kind: 'late_job', label: 'Late job' }],
};
const social = (counts = defaultCounts('social'), extra = {}) => ({ id: 'cup-social', trip_id: T, cup_id: 'lib1', name: 'Weekend Cup', kind: 'manual', round_ids: [], settings: { cup: 'social', counts }, retired: false, ...extra });

describe('the library', () => {
  it('has golf, weekend and combined cups, golf formats and every source', () => {
    expect(PURPOSES.map((p) => p.key)).toEqual(['golf', 'social', 'combined']);
    expect(GOLF_FORMATS.map((f) => f.key)).toEqual(['stableford', 'stroke', 'ambrose', 'fourball', 'match_play', 'eclectic']);
    expect(SOURCES.map((s) => s.key)).toEqual(['awards', 'placings', 'matches', 'side', 'games', 'tips', 'penalties', 'activities', 'manual', 'kudos', 'vibe']);
    expect(LATER_SOURCES.map((s) => s.key)).toEqual(['jobs', 'early', 'season']);
  });
  it('defaults: vibe and cap tips on for weekend cups; combined adds golf placings and matches; golf counts nothing', () => {
    const s = defaultCounts('social');
    expect(s.vibe).toEqual({ on: true, post: 1, photo: 2, video: 3, daily_cap: 10 });
    expect(s.kudos).toEqual({ on: true, allowance: 5, per: 1, max_same: 2, guests: false });
    expect(s.placings.on).toBe(false);
    const c = defaultCounts('combined');
    expect(c.placings).toEqual({ on: true, scale: [5, 3, 1], rounds: [] });
    expect(c.matches.on).toBe(true);
    expect(defaultCounts('golf')).toEqual({});
  });
  it('cleanCounts keeps only what fits and clamps the numbers', () => {
    const out = cleanCounts({ placings: { on: true, scale: '5/3/1', rounds: ['nope', '11111111-1111-4111-8111-111111111111'] }, vibe: { on: 1, daily_cap: '500', post: 'x' }, junk: { on: true }, kudos: { on: true, guests: 1, allowance: 3.6 } });
    expect(out.placings).toEqual({ on: true, scale: [5, 3, 1], rounds: ['11111111-1111-4111-8111-111111111111'] });
    expect(out.vibe).toEqual({ on: true, post: 1, photo: 2, video: 3, daily_cap: 100 });
    expect(out.kudos).toEqual({ on: true, allowance: 4, per: 1, max_same: 2, guests: true });
    expect(out.junk).toBeUndefined();
  });
  it('sourceOn fills the defaults, null when off', () => {
    expect(sourceOn(social({ vibe: { on: true } }), 'vibe')).toMatchObject({ post: 1, daily_cap: 10 });
    expect(sourceOn(social({ vibe: { on: false } }), 'vibe')).toBeNull();
  });
});

describe('up for grabs on a trip', () => {
  const trip = { id: T, name: 'Hunter 2026' };
  it('golf cups play as the comp kind for their format; weekend cups as manual with what counts', () => {
    expect(kindForCup({ purpose: 'golf', format: 'ambrose' })).toBe('ambrose_teams');
    expect(kindForCup({ purpose: 'golf', format: 'match_play' })).toBe('cup');
    expect(compForCup({ id: 'k', name: 'BD Trophy', purpose: 'golf', format: 'stableford' }, trip)).toMatchObject({ kind: 'individual_points', cup_id: 'k', trip_id: T, settings: {} });
    const s = compForCup({ id: 'w', name: 'Weekend Cup', purpose: 'social', counts: {} }, trip);
    expect(s.kind).toBe('manual');
    expect(s.settings.cup).toBe('social');
    expect(s.settings.counts.vibe.on).toBe(true);
    expect(compForCup({ id: 'e', name: 'Eclectic', purpose: 'golf', format: 'eclectic' }, trip).settings).toEqual({ cup: 'eclectic', net: true, rounds: [] });
  });
  it('lists the library with what is ticked for this trip (no cup on by default)', () => {
    const cups = [{ id: 'a', name: 'A Cup', created_at: '1' }, { id: 'b', name: 'B Cup', created_at: '2' }, { id: 'x', name: 'Old', retired: true }];
    expect(cupsForTrip({ cups, comps: [], tripId: T }).map((c) => c.on)).toEqual([false, false]);
    const list = cupsForTrip({ cups, comps: [{ id: 'cb', trip_id: T, cup_id: 'b', retired: false }, { id: 'ca', trip_id: 't2', cup_id: 'a' }], tripId: T });
    expect(list.map((c) => [c.cup.id, c.on])).toEqual([['b', true], ['a', false]]);
    expect(tripCupComps([{ id: 'cb', trip_id: T, cup_id: 'b', retired: false }, social(), { id: 'z', trip_id: T, kind: 'day', retired: false }], T).map((c) => c.id)).toEqual(['cb', 'cup-social']);
  });
  it('one plain line on how to win', () => {
    expect(howToWin(social({ awards: { on: true }, vibe: { on: true } }))).toBe('Most points wins: awards and fines and vibe points.');
    expect(howToWin({ kind: 'individual_points', settings: {} }, { format: 'stableford' })).toMatch(/Most Stableford points/);
    expect(howToWin(social({}))).toMatch(/hasn’t said/);
  });
  it('"Not yet" for a real cup → the run-up reminder', () => {
    expect(trophyReminder({ name: 'The Weekend Cup', has_trophy: false })).toBe('No cup for the Weekend Cup yet: sort one before the presentation');
    expect(trophyReminder({ name: 'X', has_trophy: true })).toBeNull();
    expect(trophyReminder({ name: 'X', has_trophy: null })).toBeNull();
  });
});

describe('cap tips', () => {
  const s = { on: true, allowance: 5, per: 1, max_same: 2, guests: false };
  const tips = [{ giver_id: 'A', receiver_id: 'B' }, { giver_id: 'A', receiver_id: 'B' }, { giver_id: 'C', receiver_id: 'A' }];
  it('counts what is left to give and enforces the most to one person, no self, guests', () => {
    const st = capTipState({ tips, me: 'A', settings: s });
    expect(st.left).toBe(3);
    expect(st.canGiveTo('B')).toBe('Most 2 to the same person');
    expect(st.canGiveTo('A')).toBe('Not to yourself');
    expect(st.canGiveTo('C')).toBe('');
    expect(st.canGiveTo('D', { guest: true })).toBe('Guests can’t get them on this cup');
    expect(capTipState({ tips, me: 'G', settings: s, meGuest: true }).canGiveTo('A')).toBe('Guests can’t give them on this cup');
    expect(capTipState({ tips, me: 'G', settings: { ...s, guests: true }, meGuest: true }).canGiveTo('A')).toBe('');
    const all = capTipState({ tips: Array.from({ length: 5 }, (_, i) => ({ giver_id: 'A', receiver_id: `x${i}` })), me: 'A', settings: s });
    expect(all.left).toBe(0);
    expect(all.canGiveTo('B')).toBe('None left to give');
    expect(capTipState({ tips, me: 'A', settings: null }).on).toBe(false);
  });
  it('the giver can undo within 10 minutes', () => {
    const now = Date.parse('2026-10-23T10:00:00Z');
    expect(canUndo({ giver_id: 'A', created_at: '2026-10-23T09:51:00Z' }, 'A', now)).toBe(true);
    expect(canUndo({ giver_id: 'A', created_at: '2026-10-23T09:49:00Z' }, 'A', now)).toBe(false);
    expect(canUndo({ giver_id: 'A', created_at: '2026-10-23T09:59:00Z' }, 'B', now)).toBe(false);
  });
  it('the group names them', () => {
    expect(capTipName('fist')).toMatchObject({ name: 'Fist bumps', emoji: '👊' });
    expect(capTipName(undefined)).toMatchObject({ name: 'Cap tips', emoji: '🧢' });
  });
});

describe('vibe points', () => {
  it('post 1, photo 2, video 3, from the day before to the day after; system posts never count', () => {
    const v = vibePoints({ posts: data.posts, start: '2026-10-23', end: '2026-10-24' });
    expect(v.C).toEqual({ points: 6, posts: 1, photos: 1, videos: 1 });
    expect(isSystemPost({ kind: 'user', player_id: 'A', link: '/rules/1' })).toBe(true);
    expect(isSystemPost({ kind: 'user', player_id: 'A', body: '🏆 Mo wins the BD Trophy' })).toBe(true);
  });
  it('caps each person at 10 a day', () => {
    const posts = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, kind: 'user', player_id: 'A', photo_url: 'https://x/p.jpg', created_at: at('2026-10-23', String(10 + i)) }));
    posts.push({ id: 'next', kind: 'user', player_id: 'A', body: 'next day', created_at: at('2026-10-24') });
    expect(vibePoints({ posts, start: '2026-10-23', end: '2026-10-24' }).A).toEqual({ points: 11, posts: 1, photos: 8, videos: 0 });
    expect(vibePoints({ posts, start: '2026-10-23', end: '2026-10-24', settings: { daily_cap: 4 } }).A.points).toBe(5);
  });
});

describe('placings', () => {
  it('ties share the places they cover', () => {
    const rows = [{ id: 'A', rank: 1, thru: 2 }, { id: 'B', rank: 2, thru: 2 }, { id: 'C', rank: 3, thru: 2 }, { id: 'D', rank: 3, thru: 2 }, { id: 'E', rank: 5, thru: 0 }];
    expect(placingPoints(rows, [5, 3, 1]).map((p) => [p.row.id, p.points, p.tied])).toEqual([['A', 5, false], ['B', 3, false], ['C', 0.5, true], ['D', 0.5, true]]);
  });
});

describe('cupStandings', () => {
  it('a weekend cup adds up every source with a breakdown per player', () => {
    const counts = cleanCounts({ ...defaultCounts('social'), matches: { on: true, per_win: 2 } });
    const st = cupStandings(social(counts), data);
    const row = (id) => st.rows.find((r) => r.id === id);
    // B: Latest out +2 · Team match won +2 · Wrong ball −1 (rule breach)
    expect(row('B').value).toBe(3);
    expect(row('B').breakdown).toBe('Latest out +2 · Team matches +2 · Wrong ball −1');
    // A: fine −1, match +2. The pending and waived rows don't count.
    expect(row('A').value).toBe(1);
    expect(row('A').breakdown).toBe('Wrong ball −1 · Team matches +2');
    // C: CTP +1, go-karts +3, vibe 6 (1 post, 1 photo, 1 video), tipped round 2 right +1.
    expect(row('C').value).toBe(11);
    expect(row('C').breakdown).toBe('Go-karts 1st +3 · 🎯 CTP Fri 3 +1 · Tipped right +1 · Vibe +6 (1 post, 1 photo, 1 video)');
    // D: 3 cap tips, tipped the match right. Another cup's 9 points don't count here.
    expect(row('D').value).toBe(4);
    expect(row('D').breakdown).toBe('🧢 Cap tips ×3 +3 · Tipped right +1');
    expect(st.rows[0].id).toBe('C');
    expect(st.leaderText).toBe('C won · 11 pts');
    expect(st.cupKind).toBe('social');
  });
  it('the group’s name for cap tips shows in the breakdown', () => {
    const st = cupStandings(social(cleanCounts({ kudos: { on: true } })), { ...data, capTipName: 'shout' });
    expect(st.rows[0].breakdown).toBe('📣 Shout-outs ×3 +3');
  });
  it('a source that is off counts nothing', () => {
    const st = cupStandings(social(cleanCounts({ awards: { on: true } })), data);
    expect(st.rows.map((r) => [r.id, r.value])).toEqual([['B', 2], ['A', -1]]);
  });
  it('a combined cup turns golf placings into points, only for the rounds picked', () => {
    const both = cupStandings({ ...social(cleanCounts({ placings: { on: true, scale: [5, 3, 1] } })), settings: { cup: 'combined', counts: cleanCounts({ placings: { on: true, scale: [5, 3, 1] } }) } }, data);
    // Round 1: A 5, B 3, C/D 0.5 each. Round 2: B 5, A 3.
    expect(both.rows.map((r) => [r.id, r.value])).toEqual([['A', 8], ['B', 8], ['C', 0.5], ['D', 0.5]]);
    expect(both.rows.find((r) => r.id === 'C').breakdown).toBe('Round 1 T3rd +0.5');
    const one = cupStandings({ ...social(), settings: { cup: 'combined', counts: { placings: { on: true, scale: [5, 3, 1], rounds: ['r2'] } } } }, data);
    expect(one.rows.map((r) => [r.id, r.value])).toEqual([['B', 5], ['A', 3]]);
  });
  it('side games: points per skin won, no money', () => {
    const games = [{ id: 'g1', round_id: 'r1', kind: 'skins', stake: 0, options: {} }];
    const st = cupStandings(social(cleanCounts({ games: { on: true, per_win: 1 } })), { ...data, games });
    expect(st.rows[0]).toMatchObject({ id: 'A' });
    expect(st.rows[0].breakdown).toMatch(/^Skins( ×\d+)? \+\d+$/);
  });
  it('a golf cup is decided by the scores (compStandings)', () => {
    const golf = { id: 'g', trip_id: T, cup_id: 'lib2', name: 'BD Trophy', kind: 'individual_points', round_ids: [], settings: {} };
    const st = cupStandings(golf, data);
    expect(st.rows.map((r) => [r.id, r.value])).toEqual([['B', 10], ['A', 9], ['C', 3], ['D', 3]]);
    expect(st.how).toMatch(/Most Stableford points/);
  });
  it('an eclectic cup: best score on each hole over the rounds', () => {
    const ec = { id: 'e', trip_id: T, name: 'Eclectic', kind: 'manual', round_ids: [], settings: { cup: 'eclectic', net: true, rounds: [] } };
    const st = cupStandings(ec, data);
    expect(st.rows[0].id).toBe('B'); // 3,3 on holes 1–2
    expect(st.higherBetter).toBe(false);
  });
  it('compStandings hands cup comps to cupStandings, and cleanSettings keeps their settings', () => {
    expect(isCupComp(social())).toBe(true);
    expect(compStandings(social(cleanCounts({ awards: { on: true } })), data).rows[0].id).toBe('B');
    const kept = cleanSettings('manual', { cup: 'social', counts: { vibe: { on: true } }, rounds: [], junk: 1 });
    expect(kept.cup).toBe('social');
    expect(kept.counts.vibe.on).toBe(true);
    expect(kept.junk).toBeUndefined();
  });
  it('my line for the day screen, and the main trophy winner for tips', () => {
    const st = cupStandings(social(cleanCounts({ awards: { on: true } })), data);
    expect(myLine(st, 'A')).toBe('You: -1 pts, 2nd');
    expect(myLine(st, 'Z')).toBeNull();
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(22)).toBe('22nd');
    expect(mainWinnerIds([{ id: 'g', trip_id: T, kind: 'individual_points', round_ids: [], settings: {} }], data)).toEqual(['B']);
  });
});
