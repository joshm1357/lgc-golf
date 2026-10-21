import { describe, it, expect } from 'vitest';
import {
  LIBRARY, LIB_GROUPS, AUTO_METRICS, MAX_PER_ROUND, findPreset, searchLibrary, wonText, holesLabel, compKind, defFromPreset,
  defaultHoles, roundsToAdd, tallyStandings, lastDotFor, metricHoles, lowerWins, autoDisplay, autoStandings, previousRounds,
} from './sidecomplib.js';
import { gameSubjects } from './games.js';

// Cypress Lakes-ish: par 3s on 3 5 11 15, par 5s on 1 6 14 16, the rest par 4.
const holes = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]]
  .map(([par, si], i) => ({ n: i + 1, par, si }));
const course = { id: 'c1', holes };
const S = (strokes) => ({ strokes });
const PU = { picked_up: true };
// Every hole at the same number of strokes over par (n → strokes), handy for full cards.
const card = (over, except = {}) => Object.fromEntries(holes.map((h) => [h.n, except[h.n] ?? S(h.par + over)]));

describe('the catalogue', () => {
  it('has unique keys the database accepts, and every preset is complete', () => {
    const keys = LIBRARY.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of LIBRARY) {
      expect(p.key).toMatch(/^[a-z0-9_]{2,40}$/);
      expect(p.name.trim().length).toBeGreaterThanOrEqual(2);
      expect(p.name.length).toBeLessThanOrEqual(40);
      expect(p.emoji.length).toBeLessThanOrEqual(8);
      expect(p.blurb.length).toBeGreaterThan(10);
      expect(LIB_GROUPS.map((g) => g.key)).toContain(p.group);
      expect(['lowest', 'highest', 'pick']).toContain(p.how);
      expect([null, 'count', 'count_last', 'auto']).toContain(p.scoring);
      expect(['par3', 'par4', 'par5', 'whole']).toContain(p.holes);
      if (p.scoring === 'auto') expect(AUTO_METRICS).toContain(p.settings.metric);
      if (p.scoring === 'count') expect(p.how).toBe('highest');
      if (p.scoring === 'count_last') expect(p.how).toBe('pick');
      if (p.how === 'pick' || p.scoring) expect(p.unit).toBeNull();
    }
  });
  it('has everything Josh asked for', () => {
    const want = ['ntp_in_2', 'ntp_in_3', 'longest_putt', 'closest_chip', 'ld_fairway', 'closest_line', 'bunker_ntp', 'longest_holeout',
      'greenie', 'sandy', 'chippie', 'barkie', 'arnie', 'ferret', 'polie', 'birdie_par3', 'snake', 'three_putts', 'lost_balls', 'air_shots',
      'birdies_gross', 'birdies_net', 'most_pars', 'best_front9', 'best_back9', 'best_par3s', 'best_par4s', 'best_par5s', 'fewest_wipes',
      'bogey_train', 'best_finish', 'most_improved', 'shot_of_day', 'worst_shot', 'best_excuse', 'best_dressed'];
    for (const k of want) expect(findPreset(k), k).toBeTruthy();
    expect(findPreset('snake').scoring).toBe('count_last');
    expect(findPreset('birdies_net').settings).toEqual({ metric: 'birdies', basis: 'net' });
    expect(findPreset('fewest_wipes').how).toBe('lowest');
    expect(findPreset('nope')).toBeNull();
  });
  it('searches by words and filters by group', () => {
    const keys = (list) => list.map((p) => p.key);
    expect(keys(searchLibrary('sand'))).toEqual(expect.arrayContaining(['sandy']));
    expect(keys(searchLibrary('bunker'))).toEqual(expect.arrayContaining(['sandy', 'bunker_ntp']));
    expect(keys(searchLibrary('par 3'))).toEqual(expect.arrayContaining(['greenie', 'birdie_par3', 'best_par3s']));
    expect(searchLibrary('', 'auto').every((p) => p.scoring === 'auto')).toBe(true);
    expect(searchLibrary('', 'picks').length).toBe(4);
    expect(searchLibrary('BIRDIE', 'auto').map((p) => p.key)).toEqual(['birdies_gross', 'birdies_net']);
    expect(searchLibrary('zzzz')).toEqual([]);
    expect(searchLibrary().length).toBe(LIBRARY.length);
  });
  it('says how each kind is won, in plain words', () => {
    expect(wonText(findPreset('greenie'))).toMatch(/Most dots wins/);
    expect(wonText({ ...findPreset('lost_balls'), preset: 'lost_balls' })).toMatch(/Most dots “wins”/);
    expect(wonText(findPreset('snake'))).toMatch(/logged it last holds it/);
    expect(wonText(findPreset('birdies_net'))).toMatch(/Most birdies.*\(net\)/);
    expect(wonText(findPreset('birdies_gross'))).toMatch(/off the stick/);
    expect(wonText(findPreset('best_front9'))).toMatch(/front 9.*stroke play/);
    expect(wonText(findPreset('fewest_wipes'))).toMatch(/^Fewest wipes wins/);
    expect(wonText({ how: 'lowest', unit: 'm' })).toBe('Smallest number wins (m)');
    expect(wonText({ how: 'highest' })).toBe('Biggest number wins');
    expect(wonText({ how: 'pick' })).toBe('The organiser picks the winner');
    expect(wonText(null)).toBe('');
  });
  it('labels holes and kinds', () => {
    expect(holesLabel(findPreset('greenie'))).toBe('All par 3s');
    expect(holesLabel(findPreset('ntp_in_2'))).toBe('All par 4s');
    expect(holesLabel(findPreset('ntp_in_3'))).toBe('All par 5s');
    expect(holesLabel(findPreset('sandy'))).toBe('Whole round');
    expect(holesLabel(findPreset('best_par3s'))).toBe('From the scores');
    expect(compKind(findPreset('greenie'))).toBe('tally');
    expect(compKind(findPreset('snake'))).toBe('tally');
    expect(compKind(findPreset('most_pars'))).toBe('auto');
    expect(compKind(findPreset('best_dressed'))).toBe('pick');
    expect(compKind(findPreset('longest_putt'))).toBe('measured');
    expect(compKind({ how: 'lowest' })).toBe('measured');
  });
  it('makes the database row for a preset', () => {
    expect(defFromPreset(findPreset('greenie'))).toEqual({ name: 'Greenie', emoji: '🟢', how: 'highest', unit: null, preset: 'greenie', scoring: 'count', settings: {} });
    expect(defFromPreset(findPreset('birdies_gross')).settings).toEqual({ metric: 'birdies', basis: 'gross' });
    expect(defFromPreset(findPreset('ntp_in_2'))).toMatchObject({ how: 'lowest', unit: 'm', scoring: null });
  });
});

describe('default holes', () => {
  it('puts each comp on the right holes of the course', () => {
    expect(defaultHoles(findPreset('greenie'), course)).toEqual([3, 5, 11, 15]);
    expect(defaultHoles(findPreset('birdie_par3'), course)).toEqual([3, 5, 11, 15]);
    expect(defaultHoles(findPreset('ntp_in_2'), course)).toEqual([2, 4, 7, 8, 9, 10, 12, 13, 17, 18]);
    expect(defaultHoles(findPreset('ntp_in_3'), course)).toEqual([1, 6, 14, 16]);
    expect(defaultHoles(findPreset('sandy'), course)).toEqual([]);
    expect(defaultHoles(findPreset('most_pars'), course)).toEqual([]);
    expect(defaultHoles(findPreset('greenie'), null)).toEqual([]);
    expect(defaultHoles(findPreset('greenie'), { holes: [{ n: 9, par: 3 }, { n: 2, par: 3 }] })).toEqual([2, 9]);
  });
  it('switches a comp on for the trip’s rounds, skipping the ones it shouldn’t', () => {
    const rounds = [
      { id: 'r1', course_id: 'c1', format: 'stableford', status: 'setup', own_comps: [] },
      { id: 'r2', course_id: 'c1', format: 'ambrose', status: 'live', own_comps: [{ comp: 'x', holes: [] }] },
      { id: 'r3', course_id: 'c1', format: 'stroke', status: 'locked', own_comps: [] },
      { id: 'r4', course_id: 'c1', format: 'fourball', status: 'setup', own_comps: [{ comp: 'd1', holes: [3] }] },
      { id: 'r5', course_id: 'zz', format: 'stableford', status: 'setup', own_comps: Array.from({ length: MAX_PER_ROUND }, (_, i) => ({ comp: `c${i}`, holes: [] })) },
    ];
    const greenie = roundsToAdd(rounds, 'd1', findPreset('greenie'), { c1: course });
    expect(greenie.map((x) => x.round.id)).toEqual(['r1', 'r2']);
    expect(greenie[0].own_comps).toEqual([{ comp: 'd1', holes: [3, 5, 11, 15] }]);
    expect(greenie[1].own_comps).toEqual([{ comp: 'x', holes: [] }, { comp: 'd1', holes: [3, 5, 11, 15] }]);
    const birdies = roundsToAdd(rounds, 'd2', findPreset('birdies_gross'), { c1: course });
    expect(birdies.map((x) => x.round.id)).toEqual(['r1', 'r4']); // not Ambrose
    expect(birdies[0].own_comps).toEqual([{ comp: 'd2', holes: [] }]);
    expect(roundsToAdd([], 'd1', findPreset('greenie'), {})).toEqual([]);
  });
});

describe('dots (tallies)', () => {
  const e = (id, player, t) => ({ id, player_id: player, created_at: `2026-10-23T0${t}:00:00Z` });
  it('counts dots, most first, with everyone shown', () => {
    const t = tallyStandings([e('1', 'a', 1), e('2', 'b', 2), e('3', 'a', 3)], { playerIds: ['a', 'b', 'c'], names: { a: 'Al', b: 'Bo', c: 'Cy' } });
    expect(t.rows.map((r) => [r.id, r.count, r.rankLabel])).toEqual([['a', 2, '1'], ['b', 1, '2'], ['c', 0, '3']]);
    expect(t.total).toBe(3);
    expect(t.leaders).toEqual(['a']);
    expect(t.holder).toBeNull();
  });
  it('shares the lead on a tie, and nobody leads with no dots', () => {
    const t = tallyStandings([e('1', 'a', 1), e('2', 'b', 2)], { playerIds: ['a', 'b'] });
    expect(t.rows.map((r) => r.rankLabel)).toEqual(['T1', 'T1']);
    expect(t.leaders.sort()).toEqual(['a', 'b']);
    const none = tallyStandings([], { playerIds: ['a', 'b'] });
    expect(none.leaders).toEqual([]);
    expect(none.total).toBe(0);
  });
  it('counts a dot for someone not in the round (e.g. a guest the organiser added)', () => {
    const t = tallyStandings([e('1', 'z', 1)], { playerIds: ['a'] });
    expect(t.rows.map((r) => [r.id, r.count])).toEqual([['z', 1], ['a', 0]]);
  });
  it('the snake: whoever logged last holds it', () => {
    const list = [e('1', 'a', 1), e('2', 'b', 3), e('3', 'a', 2)];
    const t = tallyStandings(list, { scoring: 'count_last', playerIds: ['a', 'b'] });
    expect(t.holder).toBe('b');
    expect(t.since).toBe('2026-10-23T03:00:00Z');
    expect(tallyStandings([], { scoring: 'count_last' }).holder).toBeNull();
  });
  it('finds a player’s latest dot to undo', () => {
    const list = [e('1', 'a', 1), e('2', 'b', 3), e('3', 'a', 2)];
    expect(lastDotFor(list, 'a').id).toBe('3');
    expect(lastDotFor(list, 'c')).toBeNull();
  });
});

describe('worked out from the scores — the pieces', () => {
  it('picks the holes for each metric', () => {
    const ns = (m) => metricHoles(m, holes).map((h) => h.n);
    expect(ns('front9')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ns('back9')).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(ns('par3s')).toEqual([3, 5, 11, 15]);
    expect(ns('par4s')).toEqual([2, 4, 7, 8, 9, 10, 12, 13, 17, 18]);
    expect(ns('par5s')).toEqual([1, 6, 14, 16]);
    expect(ns('finish')).toEqual([16, 17, 18]);
    expect(ns('birdies').length).toBe(18);
    expect(metricHoles('finish', holes.slice(0, 9)).map((h) => h.n)).toEqual([7, 8, 9]); // a 9-hole course
    expect(metricHoles('back9', holes.slice(0, 9))).toEqual([]);
  });
  it('knows which way wins', () => {
    expect(lowerWins('wipes', 'stableford')).toBe(true);
    expect(lowerWins('front9', 'stroke')).toBe(true);
    expect(lowerWins('front9', 'stableford')).toBe(false);
    expect(lowerWins('front9', 'fourball')).toBe(false);
    expect(lowerWins('birdies', 'stroke')).toBe(false);
    expect(lowerWins('improved', 'stroke')).toBe(false);
  });
  it('shows numbers in words', () => {
    expect(autoDisplay('birdies', 'stableford', 1)).toBe('1 birdie');
    expect(autoDisplay('birdies', 'stableford', 3)).toBe('3 birdies');
    expect(autoDisplay('pars', 'stroke', 0)).toBe('0 pars');
    expect(autoDisplay('bogeys', 'stroke', 2)).toBe('2 bogeys');
    expect(autoDisplay('wipes', 'stableford', 1)).toBe('1 wipe');
    expect(autoDisplay('front9', 'stableford', 17)).toBe('17 pts');
    expect(autoDisplay('front9', 'stroke', 0)).toBe('E');
    expect(autoDisplay('front9', 'stroke', 3)).toBe('+3');
    expect(autoDisplay('front9', 'stroke', -2)).toBe('−2');
    expect(autoDisplay('improved', 'stableford', 5)).toBe('+5 pts');
    expect(autoDisplay('improved', 'stableford', -1)).toBe('−1 pts');
    expect(autoDisplay('birdies', 'stableford', null)).toBe('–');
  });
});

describe('worked out from the scores — Stableford', () => {
  // Al plays off 0, Bo off 18 (a shot on every hole).
  const subjects = [{ id: 'al', name: 'Al', hcp: 0 }, { id: 'bo', name: 'Bo', hcp: 18 }];
  const scores = {
    // h1 par 5: 4 (birdie). h2 par 4: 4 (par). h3 par 3: 2 (birdie). h4 par 4: 5 (bogey). h5 par 3: picked up.
    al: { 1: S(4), 2: S(4), 3: S(2), 4: S(5), 5: PU },
    // h1: 5 (gross par, net birdie). h2: 8 (net quad, 0 pts). h3: 4 (gross bogey, net par). h4: 5 (gross bogey, net par). h5: 3 (gross par, net birdie).
    bo: { 1: S(5), 2: S(8), 3: S(4), 4: S(5), 5: S(3) },
  };
  const run = (metric, basis, extra = {}) => autoStandings({ metric, basis, format: 'stableford', holes, subjects, scores, ...extra });
  const table = (r) => r.rows.map((x) => [x.id, x.value, x.rankLabel]);

  it('most birdies off the stick (eagles count, pick-ups never do)', () => {
    const r = run('birdies', 'gross');
    expect(table(r)).toEqual([['al', 2, '1'], ['bo', 0, '2']]);
    expect(r.leaders).toEqual(['al']);
    expect(r.rows[0].display).toBe('2 birdies');
    expect(r.lowerWins).toBe(false);
    const eagle = autoStandings({ metric: 'birdies', format: 'stableford', holes, subjects: [subjects[0]], scores: { al: { 1: S(3) } } });
    expect(eagle.rows[0].value).toBe(1);
  });
  it('most net birdies uses the handicap shots', () => {
    expect(table(run('birdies', 'net'))).toEqual([['al', 2, 'T1'], ['bo', 2, 'T1']]);
  });
  it('most pars and the bogey train', () => {
    expect(table(run('pars', 'gross'))).toEqual([['bo', 2, '1'], ['al', 1, '2']]); // Bo's 5 on the par 5 and 3 on the par 3
    expect(table(run('pars', 'net'))).toEqual([['bo', 2, '1'], ['al', 1, '2']]);
    expect(table(run('bogeys', 'gross'))).toEqual([['bo', 2, '1'], ['al', 1, '2']]);
  });
  it('fewest wipes: holes with no points, pick-ups included; fewest wins', () => {
    // Al: only the pick-up on 5. Bo: the 8 on 2 (0 pts). Then Al gets another 0 on 6.
    const r = run('wipes', 'net', { scores: { ...scores, al: { ...scores.al, 6: S(9) } } });
    expect(r.lowerWins).toBe(true);
    expect(table(r)).toEqual([['bo', 1, '1'], ['al', 2, '2']]);
    expect(r.rows[0].display).toBe('1 wipe');
  });
  it('best front 9 and back 9 on Stableford points', () => {
    // Al points: 3 + 2 + 3 + 1 + 0 = 9. Bo: 3 + 0 + 2 + 2 + 3 = 10.
    const f = run('front9', 'net');
    expect(table(f)).toEqual([['bo', 10, '1'], ['al', 9, '2']]);
    expect(f.rows[0].display).toBe('10 pts');
    expect(f.final).toBe(false);
    const b = run('back9', 'net');
    expect(b.rows.every((x) => x.value == null && x.rankLabel === '–')).toBe(true);
    expect(b.leaders).toEqual([]);
  });
  it('best on the par 3s, par 4s and par 5s', () => {
    // Par 3s (3, 5): Al 3 + 0 = 3, Bo 2 + 3 = 5. Par 4s (2, 4): Al 2 + 1 = 3, Bo 0 + 2 = 2. Par 5s (1): 3 each.
    expect(table(run('par3s', 'net'))).toEqual([['bo', 5, '1'], ['al', 3, '2']]);
    expect(table(run('par4s', 'net'))).toEqual([['al', 3, '1'], ['bo', 2, '2']]);
    expect(table(run('par5s', 'net'))).toEqual([['al', 3, 'T1'], ['bo', 3, 'T1']]);
  });
  it('best finish: the last 3 holes, and decided once everyone is through them', () => {
    const fin = { al: card(0), bo: card(0, { 16: S(4), 17: S(4), 18: S(4) }) }; // Bo (18) on the last 3: 4 + 3 + 3
    const r = autoStandings({ metric: 'finish', format: 'stableford', holes, subjects, scores: fin });
    expect(table(r)).toEqual([['bo', 10, '1'], ['al', 6, '2']]);
    expect(r.final).toBe(true);
    expect(r.holes).toBe(3);
  });
  it('a locked round counts holes nobody entered as pick-ups', () => {
    const r = run('wipes', 'net', { locked: true, scores: { al: { 1: S(5) }, bo: {} } });
    expect(r.rows.find((x) => x.id === 'al').value).toBe(17);
    expect(r.rows.find((x) => x.id === 'bo').value).toBe(18);
    expect(r.final).toBe(true);
  });
  it('nobody has played: no values, no leaders', () => {
    const r = autoStandings({ metric: 'birdies', format: 'stableford', holes, subjects, scores: {} });
    expect(r.rows.map((x) => x.value)).toEqual([null, null]);
    expect(r.leaders).toEqual([]);
    expect(r.final).toBe(false);
  });
});

describe('worked out from the scores — stroke play', () => {
  const subjects = [{ id: 'al', name: 'Al', hcp: 0 }, { id: 'bo', name: 'Bo', hcp: 18 }];
  it('best front 9 is net strokes to par; lowest wins; a pick-up is net double bogey', () => {
    // Al: 4 (−1), 4 (E), picked up (+2) = +1. Bo (shot a hole): 6 (E), 5 (E), 4 (E) = E.
    const scores = { al: { 1: S(4), 2: S(4), 3: PU }, bo: { 1: S(6), 2: S(5), 3: S(4) } };
    const r = autoStandings({ metric: 'front9', format: 'stroke', holes, subjects, scores });
    expect(r.lowerWins).toBe(true);
    expect(r.rows.map((x) => [x.id, x.value, x.display])).toEqual([['bo', 0, 'E'], ['al', 1, '+1']]);
    expect(r.leaders).toEqual(['bo']);
  });
  it('counts birdies the same way as Stableford', () => {
    const scores = { al: { 1: S(4), 3: S(2) }, bo: { 1: S(4) } };
    expect(autoStandings({ metric: 'birdies', basis: 'gross', format: 'stroke', holes, subjects, scores }).rows.map((x) => [x.id, x.value])).toEqual([['al', 2], ['bo', 1]]);
    // Net: Bo's 4 on the par 5 is a net eagle — still one birdie-or-better.
    expect(autoStandings({ metric: 'birdies', basis: 'net', format: 'stroke', holes, subjects, scores }).rows.map((x) => [x.id, x.value])).toEqual([['al', 2], ['bo', 1]]);
  });
  it('fewest wipes still uses Stableford points in stroke play', () => {
    const scores = { al: { 1: S(8) }, bo: { 1: S(8) } }; // Al: 0 pts. Bo (a shot): 2 + 5 + 1 − 8 = 0.
    expect(autoStandings({ metric: 'wipes', format: 'stroke', holes, subjects, scores }).rows.map((x) => x.value)).toEqual([1, 1]);
  });
  it('best finish in stroke play', () => {
    const scores = { al: card(0), bo: card(1) };
    const r = autoStandings({ metric: 'finish', format: 'stroke', holes, subjects, scores });
    // Bo is one over on every hole but gets a shot each: net E. Al is E.
    expect(r.rows.map((x) => [x.id, x.value])).toEqual([['al', 0], ['bo', 0]]);
    expect(r.rows.map((x) => x.rankLabel)).toEqual(['T1', 'T1']);
  });
});

describe('worked out from the scores — 4BBB and Ambrose', () => {
  const round = { id: 'r', format: 'fourball' };
  const teams = [{ id: 't1', players: [{ id: 'al', name: 'Al', handicap: 0 }, { id: 'bo', name: 'Bo', handicap: 18 }] }, { id: 't2', players: [{ id: 'cy', name: 'Cy', handicap: 10 }] }];
  it('4BBB: each player plays their own ball (round handicap if set)', () => {
    const subjects = gameSubjects({ round, teams, roundPlayers: [{ player_id: 'bo', playing_handicap: 0 }] });
    expect(subjects.map((s) => [s.id, s.hcp])).toEqual([['al', 0], ['bo', 0], ['cy', 10]]);
    const scores = { al: { 1: S(4) }, bo: { 1: S(5) }, cy: { 1: S(4), 3: S(2) } };
    const r = autoStandings({ metric: 'birdies', basis: 'net', format: 'fourball', holes, subjects, scores });
    // Bo plays off 0 this round, so his 5 is a par. Cy's 4 on the par 5 is a net eagle; his 2 on the par 3 a net birdie.
    expect(r.rows.map((x) => [x.id, x.value])).toEqual([['cy', 2], ['al', 1], ['bo', 0]]);
    const f = autoStandings({ metric: 'front9', format: 'fourball', holes, subjects, scores });
    expect(f.lowerWins).toBe(false);
    expect(f.rows[0].id).toBe('cy');
  });
  it('Ambrose is skipped (played as teams)', () => {
    const r = autoStandings({ metric: 'birdies', format: 'ambrose', holes, subjects: [{ id: 't1', hcp: 5 }], scores: { t1: { 1: S(3) } } });
    expect(r.skipped).toMatch(/not Ambrose/);
    expect(r.rows).toEqual([]);
  });
  it('an unknown metric is skipped', () => {
    expect(autoStandings({ metric: 'nope', format: 'stableford', holes }).skipped).toBeTruthy();
  });
});

describe('most improved', () => {
  const fri = { id: 'fri', trip_id: 'T', format: 'stableford', play_date: '2026-10-23', created_at: '1' };
  const sat = { id: 'sat', trip_id: 'T', format: 'stroke', play_date: '2026-10-24', created_at: '2' };
  const amb = { id: 'amb', trip_id: 'T', format: 'ambrose', play_date: '2026-10-23', created_at: '3' };
  const thu = { id: 'thu', trip_id: 'T', format: 'stableford', play_date: '2026-10-22', created_at: '0' };
  const other = { id: 'oth', trip_id: 'X', format: 'stableford', play_date: '2026-10-01', created_at: '0' };
  const al = { id: 'al', name: 'Al', hcp: 0 };
  const bo = { id: 'bo', name: 'Bo', hcp: 18 };
  const earlier = [
    { round: thu, holes, subjects: [al, bo], scores: { al: card(0), bo: card(0) } },
    { round: fri, holes, subjects: [{ ...al, hcp: 2 }], scores: { al: { 1: S(7), 2: S(6) } } }, // Al's Friday: 0 + 0 pts (off 2: shots on SI 1–2 only)
    { round: amb, holes, subjects: [{ id: 'al', hcp: 0 }], scores: { al: { 1: S(1) } } },
    { round: other, holes, subjects: [bo], scores: { bo: card(5) } },
    { round: sat, holes, subjects: [al], scores: { al: card(0) } }, // this round itself — ignored
  ];
  it('finds each player’s latest earlier round on the trip (not Ambrose, not another trip)', () => {
    const prev = previousRounds(sat, earlier);
    expect(prev.al.roundId).toBe('fri');
    expect(prev.al.hcp).toBe(2);
    expect(prev.bo.roundId).toBe('thu');
    expect(previousRounds(thu, earlier)).toEqual({});
  });
  it('compares points hole for hole on the holes played in both', () => {
    const prev = previousRounds(sat, earlier);
    // Saturday: Al pars 1 and 2 (2 + 2 pts) vs Friday 0 + 0 = +4 (hole 3 wasn't played on Friday). Bo: card(0) on Thursday (2 + 1 shot = 3 pts a hole);
    // today Bo makes 6 on 1 (2 + 5 + 1 − 6 = 2 pts) = −1. Cy has no previous round.
    const scores = { al: { 1: S(5), 2: S(4), 3: S(3) }, bo: { 1: S(6) }, cy: { 1: S(5) } };
    const r = autoStandings({ metric: 'improved', format: 'stroke', holes, subjects: [al, bo, { id: 'cy', name: 'Cy', hcp: 0 }], scores, prev });
    expect(r.rows.map((x) => [x.id, x.value, x.display])).toEqual([['al', 4, '+4 pts'], ['bo', -1, '−1 pts'], ['cy', null, '–']]);
    expect(r.leaders).toEqual(['al']);
  });
});
