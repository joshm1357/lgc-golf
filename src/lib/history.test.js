import { describe, it, expect } from 'vitest';
import { yearOf, honourSort, parseHonours, parseHandicaps, parseDate, matchPlayers, matchTrip } from './history.js';

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

describe('yearOf / honourSort', () => {
  it('reads the year from a label', () => {
    expect(yearOf('2019')).toBe(2019);
    expect(yearOf('Nov 2024')).toBe(2024);
    expect(yearOf('Bowral')).toBe(null);
  });
  it('mixes history and app-made entries newest first', () => {
    const list = [
      { label: '2019', sort_key: 0, imported: true },
      { label: '2025', sort_key: 10 },
      { label: 'Nov 2024', sort_key: 0 },
      { label: 'Mar 2024', sort_key: 0 },
      { label: '2021', sort_key: 0 },
      { label: 'Trip one', sort_key: 20, created_at: '2026-03-01T00:00:00Z' },
    ].sort(honourSort).map((h) => h.label);
    expect(list).toEqual(['Trip one', '2025', 'Nov 2024', 'Mar 2024', '2021', '2019']);
  });
  it('keeps the old order inside a year (sort_key)', () => {
    expect([{ label: '2025', sort_key: 10 }, { label: '2025', sort_key: 20 }].sort(honourSort)[0].sort_key).toBe(20);
  });
});

describe('matchPlayers / matchTrip', () => {
  it('finds players by name or nickname, skipping names that are shared', () => {
    expect(matchPlayers('Joshy & Mike M', players)).toEqual(['p1', 'p2']);
    expect(matchPlayers('Josh M and Sam', players)).toEqual(['p1']);
    expect(matchPlayers('Nobody', players)).toEqual([]);
  });
  it('finds the trip by name or a single trip that year', () => {
    expect(matchTrip('Bowral 2023', trips)).toBe('t1');
    expect(matchTrip('2023', trips)).toBe('t1');
    expect(matchTrip('2024', trips)).toBe(null); // two that year
    expect(matchTrip('Nov 2024', trips)).toBe(null);
  });
});

describe('parseHonours', () => {
  it('reads year, trophy, winners from commas or a spreadsheet', () => {
    const { rows, problems } = parseHonours('Year,Trophy,Winner\n2019, The Cup, Josh M & Mike M\n2020\tThe Cup\tSam\n\n2023 - Spoon - Joshy', { players, trips });
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ label: '2019', trophy: 'The Cup', winners: 'Josh M & Mike M', player_ids: ['p1', 'p2'], trip_id: null });
    expect(rows[2]).toMatchObject({ label: '2023', trophy: 'Spoon', trip_id: 't1', player_ids: ['p1'] });
  });
  it('a trophy picked for the whole list: year, winners', () => {
    const { rows } = parseHonours('2018, Josh M, Mike M', { trophy: 'The Cup', players });
    expect(rows[0]).toMatchObject({ trophy: 'The Cup', label: '2018', winners: 'Josh M & Mike M' });
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
    expect(parseDate('soon')).toBe(null);
  });
});

describe('parseHandicaps', () => {
  it('reads player, date, handicap', () => {
    const { rows, problems } = parseHandicaps('Name, Date, Handicap\nJosh M, 1/6/2023, 14.2\nMike M\t2022\t+2\nJoshy, 9.5, 2024-01-10', { players, today: '2026-10-18' });
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { player_id: 'p1', name: 'Josh M', date: '2023-06-01', handicap: 14.2 },
      { player_id: 'p2', name: 'Mike M', date: '2022-01-01', handicap: -2 },
      { player_id: 'p1', name: 'Josh M', date: '2024-01-10', handicap: 9.5 },
    ]);
  });
  it('flags unknown or shared names, future dates and odd handicaps', () => {
    const { rows, problems } = parseHandicaps('Bob, 2023, 10\nSam, 2023, 10\nJosh M, 1/1/2030, 10\nJosh M, 2023, 70\nJosh M, 2023', { players, today: '2026-10-18' });
    expect(rows).toEqual([]);
    expect(problems.map((p) => p.slice(0, 7))).toEqual(['Line 1:', 'Line 2:', 'Line 3:', 'Line 4:', 'Line 5:']);
    expect(problems[1]).toMatch(/more than one/);
  });
});
