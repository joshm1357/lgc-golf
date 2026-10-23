import { describe, it, expect } from 'vitest';
import {
  atSydney, sydneyDate, addDays, claimWindow, windowDateFor, tripHas, proposeTimes, autoTerms, runsWords, clock, clockAt,
  checkPoints, linePoints, pointsWords, rankRun, proposalText, claimableFor, resultLines, pointsTally, signedPoints, runLabel,
} from './autoawards.js';

const LATE = { mode: 'per_unit', per: 1, size: 1, from: '00:00', to: '05:00', round: 'whole' };
const hhmm = (d) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

describe('Sydney time', () => {
  it('turns a Sydney date and time into the moment, summer and winter', () => {
    expect(atSydney('2026-01-10', '02:47').toISOString()).toBe('2026-01-09T15:47:00.000Z'); // AEDT +11
    expect(atSydney('2026-07-10', '02:47').toISOString()).toBe('2026-07-09T16:47:00.000Z'); // AEST +10
    expect(sydneyDate('2026-01-09T15:47:00Z')).toBe('2026-01-10');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('words a time like the database', () => {
    expect(clock('21:00')).toBe('9pm');
    expect(clock('07:30')).toBe('7:30am');
    expect(clock('00:00')).toBe('12am');
    expect(clockAt(atSydney('2026-01-10', '08:00'))).toBe('8am');
    expect(clockAt(atSydney('2026-01-10', '02:47'))).toBe('2:47am');
  });
});

describe('the claim window (across midnight)', () => {
  it('a night runs 9pm to 6am the next morning', () => {
    const w = claimWindow('21:00', '06:00', '2026-11-06');
    expect(hhmm(w.opens)).toBe('21:00');
    expect(sydneyDate(w.closes)).toBe('2026-11-07');
    expect(hhmm(w.closes)).toBe('06:00');
  });
  it('a day runs 6am to 9pm', () => {
    const w = claimWindow('06:00', '21:00', '2026-11-06');
    expect(sydneyDate(w.closes)).toBe('2026-11-06');
  });
  it('finds which night a moment belongs to (as the SQL test)', () => {
    expect(windowDateFor('21:00', '06:00', atSydney('2026-11-06', '23:30'))).toBe('2026-11-06');
    expect(windowDateFor('21:00', '06:00', atSydney('2026-11-07', '02:47'))).toBe('2026-11-06');
    expect(windowDateFor('21:00', '06:00', atSydney('2026-11-06', '15:00'))).toBe(null);
    expect(windowDateFor('21:00', '06:00', atSydney('2026-11-07', '06:00'))).toBe(null); // closes at 6am sharp
    expect(windowDateFor('21:00', '06:00', atSydney('2026-11-06', '21:00'))).toBe('2026-11-06');
  });
  it("only the trip's nights and days count", () => {
    const trip = { start_date: '2026-11-05', end_date: '2026-11-08' };
    expect(tripHas(trip, 'night', '2026-11-05')).toBe(true);
    expect(tripHas(trip, 'night', '2026-11-07')).toBe(true);
    expect(tripHas(trip, 'night', '2026-11-08')).toBe(false); // the last day has no night on the trip
    expect(tripHas(trip, 'day', '2026-11-08')).toBe(true);
    expect(tripHas({ start_date: '2026-11-05', end_date: '2026-11-05' }, 'night', '2026-11-05')).toBe(true);
    expect(tripHas({ start_date: null }, 'night', '2030-01-01')).toBe(true);
  });
});

describe('the morning proposal and the auto-confirm', () => {
  it('7am, confirmed at the first tee', () => {
    const t = proposeTimes({ windowDate: '2026-11-06', firstTee: '08:00', closes: atSydney('2026-11-07', '06:00') });
    expect(hhmm(t.propose_at)).toBe('07:00');
    expect(hhmm(t.confirm_by)).toBe('08:00');
  });
  it('an hour before an earlier tee', () => {
    const t = proposeTimes({ windowDate: '2026-11-06', firstTee: '07:30', closes: atSydney('2026-11-07', '06:00') });
    expect(hhmm(t.propose_at)).toBe('06:30');
    expect(hhmm(t.confirm_by)).toBe('07:30');
  });
  it('never before the window closes; at least 15 minutes to confirm', () => {
    const t = proposeTimes({ windowDate: '2026-11-06', firstTee: '06:15', closes: atSydney('2026-11-07', '06:00') });
    expect(hhmm(t.propose_at)).toBe('06:00');
    expect(hhmm(t.confirm_by)).toBe('06:15');
    const u = proposeTimes({ windowDate: '2026-11-06', firstTee: '06:05', closes: atSydney('2026-11-07', '06:00') });
    expect(hhmm(u.confirm_by)).toBe('06:15');
  });
  it('noon with no round that day', () => {
    const t = proposeTimes({ windowDate: '2026-11-07', closes: atSydney('2026-11-08', '06:00') });
    expect(hhmm(t.propose_at)).toBe('07:00');
    expect(hhmm(t.confirm_by)).toBe('12:00');
  });
});

describe('automatic terms', () => {
  it('a time proof decided by "latest" runs each night', () => {
    const t = autoTerms({ title: 'Latest out', kind: 'award', proof: 'photo_time', best: 'latest' });
    expect(t.runs).toBe('night');
    expect([t.window_from, t.window_to, t.propose_time]).toEqual(['21:00', '06:00', '07:00']);
    expect(runsWords(t)).toBe('Each night, 9pm–6am · proposed 7am');
  });
  it('from the scores runs per round; a vote-decided award once a trip; days 6am–9pm', () => {
    expect(autoTerms({ from_scores: 'birdies_gross', runs: 'night' }).runs).toBe('round');
    expect(autoTerms({ proof: 'photo', best: null }).runs).toBe('trip');
    const d = autoTerms({ runs: 'day', proof: 'time', best: 'earliest' });
    expect([d.window_from, d.window_to]).toEqual(['06:00', '21:00']);
  });
  it("a Rulebook award's rule decides the terms", () => {
    const t = autoTerms({ title: 'Latest out', rule_id: 'r1', comp_id: 'c1' }, { id: 'r1', award_kind: 'award', proof: 'photo_time', best: 'latest', points: LATE, comp_id: null });
    expect(t.runs).toBe('night');
    expect(t.points).toEqual(LATE);
    expect(t.comp_id).toBe('c1');
  });
});

describe('points', () => {
  const night = { best: 'latest', runs: 'night', windowFrom: '21:00', windowDate: '2026-11-06' };
  it('per unit: 1 pt an hour after midnight, whole or part, to 5am, at most', () => {
    expect(linePoints(LATE, { ...night, at: atSydney('2026-11-07', '02:47') })).toBe(2);
    expect(linePoints({ ...LATE, round: 'part' }, { ...night, at: atSydney('2026-11-07', '02:47') })).toBe(2.78);
    expect(linePoints({ ...LATE, max: 1 }, { ...night, at: atSydney('2026-11-07', '02:47') })).toBe(1);
    expect(linePoints(LATE, { ...night, at: atSydney('2026-11-07', '05:30') })).toBe(5);
    expect(linePoints(LATE, { ...night, at: atSydney('2026-11-06', '23:00') })).toBe(0);
  });
  it('per unit on a number: 1 pt per 5 m over 10 m', () => {
    expect(linePoints({ mode: 'per_unit', per: 1, size: 5, from: 10 }, { best: 'highest', number: 23 })).toBe(2);
    expect(linePoints({ mode: 'per_unit', per: 1, from: 10, to: 12 }, { best: 'lowest', number: 5 })).toBe(0);
    expect(linePoints({ mode: 'per_unit', per: 2, from: 10, to: 5 }, { best: 'lowest', number: 3 })).toBe(10);
  });
  it('placings and winner', () => {
    const P = { mode: 'placings', places: [3, 2, 1] };
    expect(linePoints(P, { rank: 2 })).toBe(2);
    expect(linePoints(P, { rank: 4 })).toBe(0);
    expect(linePoints({ mode: 'winner', points: 3 }, { winner: true })).toBe(3);
    expect(linePoints({ mode: 'winner', points: 3 }, { winner: false })).toBe(0);
  });
  it('checks a setting like the database', () => {
    expect(checkPoints({ mode: 'per_unit', per: 1 }, 'latest', null)).toBe('Say when the points start (a time)');
    expect(checkPoints({ mode: 'placings', places: 'x' })).toBe('Placings: 1 to 10 places');
    expect(checkPoints(LATE, 'latest', null)).toBe('');
    expect(checkPoints(LATE, null, null)).toMatch(/need/);
    expect(checkPoints(LATE, 'latest', 'birdies_gross')).toMatch(/not scores/);
    expect(checkPoints({ mode: 'winner', points: 0 })).toMatch(/0.5 to 100/);
    expect(checkPoints({ mode: 'what' })).toMatch(/winner, per unit or placings/);
  });
  it('in words, as the database writes them', () => {
    expect(pointsWords({ mode: 'per_unit', per: 1, from: '00:00', to: '05:00' }, 'award', 'latest')).toBe('1 pt an hour after 12am, to 5am');
    expect(pointsWords({ mode: 'placings', places: [3, 2, 1] }, 'award', 'earliest')).toBe('3-2-1 pts');
    expect(pointsWords({ mode: 'winner', points: 2 }, 'fine')).toBe('−2 pts to whoever cops it');
    expect(pointsWords({ mode: 'per_unit', per: 1, size: 5, from: 10, round: 'part', max: 4 }, 'award', 'highest', 'm')).toBe('1 pt per 5 m over 10 (part units count), at most 4');
  });
  it('fines take points off', () => {
    const terms = autoTerms({ kind: 'fine', title: 'Last to bed', proof: 'photo_time', best: 'latest', points: { mode: 'winner', points: 2 } });
    const lines = rankRun([{ id: 'n1', player_id: 'h', claim_at: atSydney('2026-11-07', '02:47').toISOString(), post_id: 'p' }], terms, { kind: 'night', window_date: '2026-11-06' });
    expect(lines[0].points).toBe(-2);
    expect(signedPoints(-2)).toBe('−2');
    expect(signedPoints(2.78)).toBe('+2.78');
  });
});

describe('ranking a night and the proposal', () => {
  const terms = autoTerms({ title: 'Latest out', kind: 'award', proof: 'photo_time', best: 'latest', points: LATE });
  const noms = [
    { id: 'n2', player_id: 'tom', claim_at: atSydney('2026-11-07', '01:15').toISOString(), post_id: 'p2', created_at: '1' },
    { id: 'n1', player_id: 'hamish', claim_at: atSydney('2026-11-07', '02:47').toISOString(), post_id: 'p1', created_at: '2' },
    { id: 'n3', player_id: 'al', claim_at: atSydney('2026-11-07', '01:15').toISOString(), created_at: '3' },
  ];
  const run = { kind: 'night', window_date: '2026-11-06' };
  it('latest first, ties share a rank, points per line', () => {
    const lines = rankRun(noms, terms, run);
    expect(lines.map((l) => [l.player_id, l.rank, l.points, l.display])).toEqual([
      ['hamish', 1, 2, '2:47am'], ['tom', 2, 1, '1:15am'], ['al', 2, 1, '1:15am'],
    ]);
  });
  it('words the post like the server', () => {
    const lines = rankRun(noms.slice(0, 2), terms, run);
    const names = { hamish: 'Hamish', tom: 'Tom' };
    expect(proposalText({ terms, run, lines, nameOf: (id) => names[id], worth: '−1 stroke', byTee: true, confirmBy: atSydney('2026-11-07', '08:00') }))
      .toBe('🌙 Proposed — Latest out, last night: Hamish 2:47am 📷 (+2), Tom 1:15am 📷 (+1) · −1 stroke. Confirm or dispute by the first tee (8am).');
  });
  it('winner-only points list only the winner', () => {
    const t2 = { ...terms, points: { mode: 'winner', points: 3 } };
    const lines = rankRun(noms.slice(0, 2), t2, run);
    expect(proposalText({ terms: t2, run, lines, nameOf: (id) => id })).toBe('🌙 Proposed — Latest out, last night: hamish 2:47am 📷 (+3). Confirm or dispute by the first tee.');
  });
  it('an organiser picking another claim moves the winner points', () => {
    const t2 = { ...terms, points: { mode: 'winner', points: 3 } };
    const lines = rankRun(noms.slice(0, 2), t2, { ...run, player_id: 'tom' });
    expect(lines.find((l) => l.player_id === 'tom').points).toBe(3);
    expect(lines.find((l) => l.player_id === 'hamish').points).toBe(0);
  });
});

describe('claiming from a post', () => {
  const trip = { id: 'T', start_date: '2026-11-05', end_date: '2026-11-08' };
  const items = [
    { key: 'a', award: { id: 'A' }, terms: autoTerms({ title: 'Latest out', proof: 'photo_time', best: 'latest' }) },
    { key: 'b', award: { id: 'B' }, terms: autoTerms({ title: 'Longest putt', proof: 'number', best: 'highest' }) },
    { key: 'c', award: null, terms: autoTerms({ title: 'Earliest up', proof: 'time', best: 'earliest' }) },
  ];
  it('a night photo can claim the night awards it proves', () => {
    const post = { trip_id: 'T', photo_url: 'x', server_at: atSydney('2026-11-07', '02:47').toISOString() };
    expect(claimableFor(post, items, [], trip).map((c) => [c.item.key, c.windowDate])).toEqual([['a', '2026-11-06'], ['c', '2026-11-06']]);
  });
  it('no photo: only the ones that need just a time', () => {
    const post = { trip_id: 'T', server_at: atSydney('2026-11-07', '02:47').toISOString() };
    expect(claimableFor(post, items, [], trip).map((c) => c.item.key)).toEqual(['c']);
  });
  it('outside the window, off the trip or already proposed: nothing', () => {
    expect(claimableFor({ trip_id: 'T', photo_url: 'x', server_at: atSydney('2026-11-07', '15:00').toISOString() }, items, [], trip)).toEqual([]);
    expect(claimableFor({ trip_id: 'T', photo_url: 'x', server_at: atSydney('2026-11-09', '01:00').toISOString() }, items, [], trip)).toEqual([]);
    expect(claimableFor({ trip_id: 'X', photo_url: 'x', server_at: atSydney('2026-11-07', '01:00').toISOString() }, items, [], trip)).toEqual([]);
    const runs = [{ source_id: 'A', kind: 'night', window_date: '2026-11-06', status: 'proposed' }];
    expect(claimableFor({ trip_id: 'T', photo_url: 'x', server_at: atSydney('2026-11-07', '01:00').toISOString() }, items, runs, trip).map((c) => c.item.key)).toEqual(['c']);
  });
});

describe('results', () => {
  it('confirmed runs, oldest first, with the worth', () => {
    const runs = [
      { id: 'r2', source_id: 'A', kind: 'night', window_date: '2026-11-07', status: 'confirmed', player_id: 'tom', reward_type: 'strokes', reward_amount: -1, worth: '−1 stroke' },
      { id: 'r1', source_id: 'A', kind: 'night', window_date: '2026-11-06', status: 'confirmed', player_id: 'hamish', reward_type: 'strokes', reward_amount: -1, worth: '−1 stroke' },
      { id: 'r3', source_id: 'B', kind: 'night', window_date: '2026-11-06', status: 'proposed', player_id: 'tom' },
      { id: 'r4', source_id: 'C', kind: 'round', round_id: 'R', window_date: '2026-11-05', status: 'confirmed', player_id: 'al', reward_type: 'money', reward_amount: 10 },
    ];
    const lines = resultLines(runs, { titles: { A: 'Latest out', C: 'Most birdies' }, roundNames: { R: 'Day 1' } });
    expect(lines.map((l) => [l.title, l.player_id, l.worth, l.strokes])).toEqual([
      ['Most birdies · Day 1', 'al', '$10', 0], ['Latest out · Fri night', 'hamish', '−1 stroke', -1], ['Latest out · Sat night', 'tom', '−1 stroke', -1],
    ]);
    expect(runLabel({ kind: 'day', window_date: '2026-11-06' }, 'Early bird')).toBe('Early bird · Fri 6');
  });
  it('counts only confirmed, unwaived points; fines take off; by cup', () => {
    const rows = [
      { player_id: 'h', points: 2, confirmed_at: 'x', comp_id: 'C' },
      { player_id: 'h', points: 3, confirmed_at: null, comp_id: 'C' },
      { player_id: 'h', points: 5, confirmed_at: 'x', waived_at: 'y', comp_id: 'C' },
      { player_id: 't', points: 1, confirmed_at: 'x', comp_id: 'C' },
      { player_id: 't', points: -2, confirmed_at: 'x', comp_id: null },
    ];
    expect(pointsTally(rows).map((r) => [r.player_id, r.points])).toEqual([['h', 2], ['t', -1]]);
    expect(pointsTally(rows, 'C').map((r) => [r.player_id, r.points])).toEqual([['h', 2], ['t', 1]]);
  });
});
