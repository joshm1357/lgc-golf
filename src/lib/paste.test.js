import { describe, it, expect } from 'vitest';
import { detectDelimiter, splitLine, parseTable, parsePlayers, parseScorecard, dropTotals } from './paste.js';

const players = [
  { id: 'p1', name: 'Josh M', nickname: 'Jm', handicap: 14.2 },
  { id: 'p2', name: 'Al Smith', nickname: null, handicap: 20 },
];

describe('reading a paste', () => {
  it('spots tabs, commas, semicolons and spaces', () => {
    expect(detectDelimiter('a\tb')).toBe('\t');
    expect(detectDelimiter('a,b\nc,d')).toBe(',');
    expect(detectDelimiter('a;b')).toBe(';');
    expect(detectDelimiter('Josh M 14')).toBe(' ');
  });
  it('keeps commas inside quotes and doubled quotes', () => {
    expect(splitLine('"Smith, J",12', ',')).toEqual(['Smith, J', '12']);
    expect(splitLine('"He said ""hi""",3', ',')).toEqual(['He said "hi"', '3']);
    expect(splitLine('  a   b  ', ' ')).toEqual(['a', 'b']);
  });
  it('drops blank lines and keeps line numbers', () => {
    const t = parseTable('a\tb\n\n c\td \n');
    expect(t.map((r) => r.n)).toEqual([1, 3]);
    expect(t[1].cells).toEqual(['c', 'd']);
  });
});

describe('pasting players', () => {
  it('reads a spreadsheet with headings in any order', () => {
    const r = parsePlayers('Handicap\tName\tNickname\n12\tBo Jones\tBJ\n+2\tCy Lee\t', players);
    expect(r.rows.map((x) => [x.name, x.nickname, x.handicap, x.status])).toEqual([
      ['Bo Jones', 'BJ', 12, 'new'],
      ['Cy Lee', null, -2, 'new'],
    ]);
  });
  it('matches existing players by name or nickname and shows changes', () => {
    const r = parsePlayers('Josh M, 13.1\nal smith, 20\nJm, 9', players);
    expect(r.rows[0]).toMatchObject({ status: 'update', player_id: 'p1', old: 14.2, handicap: 13.1 });
    expect(r.rows[1]).toMatchObject({ status: 'same', player_id: 'p2' });
    // "Jm" is Josh again — the same person twice is a problem, not two changes.
    expect(r.rows[2].status).toBe('problem');
    expect(r.rows[2].problem).toMatch(/Josh M, already on line 1/);
    expect(r.counts).toEqual({ new: 0, update: 1, same: 1, problem: 1 });
  });
  it('reads plain lines with spaces, and a name on its own', () => {
    const r = parsePlayers('Di Wu 7.5\nEd Bloggs', players);
    expect(r.rows[0]).toMatchObject({ name: 'Di Wu', handicap: 7.5, status: 'new' });
    expect(r.rows[1]).toMatchObject({ name: 'Ed Bloggs', handicap: null, status: 'new', note: 'No handicap — starts on 18' });
  });
  it('reads name, nickname, handicap without headings', () => {
    const r = parsePlayers('Fin Grey,Finny,22', players);
    expect(r.rows[0]).toMatchObject({ name: 'Fin Grey', nickname: 'Finny', handicap: 22 });
  });
  it('flags odd handicaps and repeats', () => {
    const r = parsePlayers('Gus, 77\nHal, 10\nhal, 11', players);
    expect(r.rows[0].status).toBe('problem');
    expect(r.rows[0].problem).toMatch(/77/);
    expect(r.rows[2].status).toBe('problem');
    expect(r.problems).toHaveLength(2);
  });
  it('an empty paste is nothing', () => {
    expect(parsePlayers('  \n', players).rows).toEqual([]);
  });
});

const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const SI = [7, 15, 3, 11, 1, 17, 9, 13, 5, 8, 16, 4, 12, 2, 18, 10, 14, 6];
const sum = (a) => a.reduce((s, x) => s + x, 0);

describe('pasting a course scorecard', () => {
  it('reads Hole / Par / Index rows across the card, skipping Out, In and Total', () => {
    const holes = ['Hole', ...[1, 2, 3, 4, 5, 6, 7, 8, 9], 'Out', ...[10, 11, 12, 13, 14, 15, 16, 17, 18], 'In', 'Total'];
    const par = ['Par', ...PAR.slice(0, 9), sum(PAR.slice(0, 9)), ...PAR.slice(9), sum(PAR.slice(9)), sum(PAR)];
    const si = ['Index', ...SI.slice(0, 9), '', ...SI.slice(9), '', ''];
    const metres = ['Metres', ...PAR.map(() => 350), 3150, ...[], 3150, 6300].slice(0, 22);
    const text = [holes, metres, par, si].map((r) => r.join('\t')).join('\n');
    const r = parseScorecard(text);
    expect(r.problems).toEqual([]);
    expect(r.holes.map((h) => h.par)).toEqual(PAR);
    expect(r.holes.map((h) => h.si)).toEqual(SI);
    expect(r.holes[0]).toEqual({ n: 1, par: 4, si: 7 });
  });
  it('reads labelled rows with totals but no hole row', () => {
    const text = `Par ${[...PAR.slice(0, 9), 36, ...PAR.slice(9), 36, 72].join(' ')}\nSI ${SI.join(' ')}`;
    const r = parseScorecard(text);
    expect(r.problems).toEqual([]);
    expect(r.holes.map((h) => h.par)).toEqual(PAR);
  });
  it('reads unlabelled rows by what the numbers look like', () => {
    const r = parseScorecard(`${SI.join('\t')}\n${PAR.join('\t')}`);
    expect(r.holes.map((h) => h.si)).toEqual(SI);
    expect(r.holes.map((h) => h.par)).toEqual(PAR);
  });
  it('reads one line per hole, with or without headings', () => {
    const lines = PAR.map((p, i) => `${i + 1},${p},${SI[i]}`).join('\n');
    expect(parseScorecard(`Hole,Par,SI\n${lines}`).holes.map((h) => h.si)).toEqual(SI);
    expect(parseScorecard(lines).holes.map((h) => h.par)).toEqual(PAR);
    const two = PAR.slice(0, 9).map((p, i) => `${p}\t${SI[i]}`).join('\n');
    expect(parseScorecard(two).holes).toHaveLength(9);
  });
  it('a 9-hole card can use odd or even indexes up to 18', () => {
    const r = parseScorecard(`Par 4 4 3 5 4 4 3 4 5\nIndex 1 3 5 7 9 11 13 15 17`);
    expect(r.problems).toEqual([]);
    expect(r.holes).toHaveLength(9);
  });
  it('says what is wrong in plain words', () => {
    expect(parseScorecard('hello').problems[0]).toMatch(/pars/);
    expect(parseScorecard(`Par ${PAR.join(' ')}`).problems[0]).toMatch(/stroke index/);
    const bad = parseScorecard(`Par ${[9, ...PAR.slice(1)].join(' ')}\nSI ${[7, 7, ...SI.slice(2)].join(' ')}`);
    expect(bad.problems.join(' ')).toMatch(/Hole 1: a par of 9/);
    expect(bad.problems.join(' ')).toMatch(/Stroke index 7 is on more than one hole/);
    expect(parseScorecard(`Par 4 4 4 4 4\nSI 1 2 3 4 5`).problems[0]).toMatch(/9 or 18/);
  });
  it('drops totals from runs of numbers', () => {
    expect(dropTotals([...Array(21).keys()])).toHaveLength(18);
    expect(dropTotals([...Array(10).keys()])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
