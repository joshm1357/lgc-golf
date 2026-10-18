import { describe, it, expect } from 'vitest';
import { yearOf, honourOrder, parseHonours, parseHandicaps, parseDate, matchPlayers, matchTrip, readHandicap, winnerNames } from './history.js';

const players = [
  { id: 'p1', name: 'Josh M', nickname: 'Joshy' },
  { id: 'p2', name: 'Mike M', nickname: null },
  { id: 'p3', name: 'Sam', nickname: null },
  { id: 'p4', name: 'Sam', nickname: 'Sammy' },
];
const trips = [
  { id: 't1', name: 'Bowral 2023', start_date: '2023-05-12' },
  { id: 't2', name: 'South Coast', start_date: '2024-03-01' },
  { id: 't3', name: 'Hunter', start_date: '2024-11-01' },
];

describe('yearOf / honourOrder', () => {
  it('reads the year from a label', () => {
    expect(yearOf('2019')).toBe(2019);
    expect(yearOf('Nov 2024')).toBe(2024);
    expect(yearOf('Bowral')).toBe(null);
  });
  it('app-made winners keep exactly their old order (nothing moves without history)', () => {
    const app = [
      { label: 'Mar 2025', sort_key: 40 }, { label: 'Bowral 2025', sort_key: 60 }, { label: 'Hunter Valley', sort_key: 50, created_at: '2025-11-01T00:00:00Z' },
    ];
    expect(honourOrder(app).map((h) => h.label)).toEqual(['Bowral 2025', 'Hunter Valley', 'Mar 2025']);
  });
  it('history slots in before the first app-made winner from an earlier year', () => {
    const list = [
      { label: '2025', sort_key: 30 }, { label: 'Nov 2024', sort_key: 20 }, { label: 'Mar 2022', sort_key: 10 },
      { label: '2023', imported: true }, { label: '2019', imported: true }, { label: '2024', imported: true },
    ];
    expect(honourOrder(list).map((h) => h.label)).toEqual(['2025', 'Nov 2024', '2024', '2023', 'Mar 2022', '2019']);
  });
  it('history with no year never becomes the holder', () => {
    expect(honourOrder([{ label: 'Hunter', imported: true }, { label: '2019', sort_key: 10 }])[0].label).toBe('2019');
  });
});

describe('matchPlayers / matchTrip', () => {
  it('finds players by name or nickname, skipping names that are shared', () => {
    expect(matchPlayers('Joshy & Mike M', players)).toEqual(['p1', 'p2']);
    expect(matchPlayers('Josh M and Sam', players)).toEqual(['p1']);
    expect(matchPlayers('Nobody', players)).toEqual([]);
  });
  it('links a trip only by its exact name (a year alone could be any trip)', () => {
    expect(matchTrip('Bowral 2023', trips)).toBe('t1');
    expect(matchTrip('bowral 2023 ', trips)).toBe('t1');
    expect(matchTrip('2023', trips)).toBe(null);
  });
  it('splits winners and copes with non-breaking spaces', () => {
    expect(winnerNames('Josh M & Mike M and Sam')).toEqual(['Josh M', 'Mike M', 'Sam']);
    expect(matchPlayers('Josh\u00a0M', players)).toEqual(['p1']);
  });
});

describe('parseHonours', () => {
  it('reads year, trophy, winners from commas or a spreadsheet', () => {
    const { rows, problems } = parseHonours('Year,Trophy,Winner\n2019, The Cup, Josh M & Mike M\n2020\tThe Cup\tSam\n\n2023 - Spoon - Joshy', { players, trips });
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ label: '2019', trophy: 'The Cup', winners: 'Josh M & Mike M', player_ids: ['p1', 'p2'], trip_id: null, unmatched: 0, already: false });
    expect(rows[2]).toMatchObject({ label: '2023', trophy: 'Spoon', trip_id: null, player_ids: ['p1'] });
  });
  it('a trophy picked for the whole list: year, winners', () => {
    const { rows } = parseHonours('2018, Josh M, Mike M', { trophy: 'The Cup', players });
    expect(rows[0]).toMatchObject({ trophy: 'The Cup', label: '2018', winners: 'Josh M & Mike M' });
  });
  it('needs a year, flags unmatched names and repeats, skips a header after blank lines', () => {
    const { rows, problems } = parseHonours('\n\nTrophy, Year, Winner\nHunter, Cup, Josh M\n2019, Cup, Smith, John\n2019, Cup, Josh M\n2019, Cup, Josh M',
      { players, board: [{ trophy_name: 'cup', label: '2019', winner_names: 'josh m' }] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^Line 4: put the year first/);
    expect(rows[0]).toMatchObject({ winners: 'Smith & John', unmatched: 2, already: false });
    expect(rows[1].already).toBe(true);
    expect(rows[2].already).toBe(true);
  });
  it('says which lines it couldn’t read', () => {
    const { rows, problems } = parseHonours('2019, The Cup\njust words', {});
    expect(rows).toEqual([]);
    expect(problems[0]).toMatch(/^Line 1/);
    expect(problems).toHaveLength(2);
  });
});

describe('parseDate', () => {
  it('reads the usual ways of writing a date', () => {
    expect(parseDate('1/6/2023')).toBe('2023-06-01');
    expect(parseDate('01/06/23')).toBe('2023-06-01');
    expect(parseDate('2023-06-01')).toBe('2023-06-01');
    expect(parseDate('June 2023')).toBe('2023-06-01');
    expect(parseDate('2023')).toBe('2023-01-01');
    expect(parseDate('31/2/2023')).toBe(null);
    expect(parseDate('1/6/99')).toBe('1999-06-01');
    expect(parseDate('soon')).toBe(null);
  });
});

describe('readHandicap', () => {
  it('reads plus handicaps and refuses odd ones', () => {
    expect(readHandicap('14.2')).toBe(14.2);
    expect(readHandicap('+2')).toBe(-2);
    expect(readHandicap('70')).toBe(null);
    expect(readHandicap('abc')).toBe(null);
  });
});

describe('parseHandicaps', () => {
  it('reads player, date, handicap', () => {
    const { rows, problems } = parseHandicaps('Name, Date, Handicap\nJosh M, 1/6/2023, 14.2\nMike M\t2022\t+2\nJoshy, 9.5, 2024-01-10', { players, today: '2026-10-18' });
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { player_id: 'p1', name: 'Josh M', date: '2023-06-01', handicap: 14.2, already: false },
      { player_id: 'p2', name: 'Mike M', date: '2022-01-01', handicap: -2, already: false },
      { player_id: 'p1', name: 'Josh M', date: '2024-01-10', handicap: 9.5, already: false },
    ]);
  });
  it('marks lines already added', () => {
    const { rows } = parseHandicaps('Josh M, 1/6/2023, 14.2', { players, today: '2026-10-18', existing: [{ player_id: 'p1', date: '2023-06-01', handicap: 14.2 }] });
    expect(rows[0].already).toBe(true);
  });
  it('flags unknown or shared names, future dates and odd handicaps', () => {
    const { rows, problems } = parseHandicaps('Bob, 2023, 10\nSam, 2023, 10\nJosh M, 1/1/2030, 10\nJosh M, 2023, 70\nJosh M, 2023', { players, today: '2026-10-18' });
    expect(rows).toEqual([]);
    expect(problems.map((p) => p.slice(0, 7))).toEqual(['Line 1:', 'Line 2:', 'Line 3:', 'Line 4:', 'Line 5:']);
    expect(problems[1]).toMatch(/more than one/);
  });
});
