import { describe, it, expect } from 'vitest';
import {
  findPlayer, findTrip, trophyNames, honourLabel, buildReview, itemLine, picked, handicapPlayer, startingHandicap, tripRow,
  honourRows, ruleRows, summaryLine, readImportReply, rematch, itemProblem, fileKind, capText, docxText, xlsxText, unzip, fitSize, MAX_TEXT,
} from './aiimport.js';

const players = [
  { id: 'k', name: 'Kurt Dahl', nickname: 'Kurt' },
  { id: 'b', name: 'Matt Blue', nickname: 'Bluey' },
  { id: 's1', name: 'Sam Jones' }, { id: 's2', name: 'Sam Smith' },
];
const trips = [{ id: 't1', name: 'Hunter Valley 2019', start_date: '2019-10-10' }, { id: 't2', name: 'Bowral Weekend', start_date: '2023-05-04' }];
const group = {
  players, trips,
  trophies: [{ name: 'BD Trophy' }],
  honour_board: [{ trophy_name: 'Wooden Spoon', label: '2018', winner_names: 'Sam Jones' }],
  rules: [{ title: 'Ready golf', status: 'active' }, { title: 'Old rule', status: 'retired' }],
  handicaps: [{ player_id: 'k', date: '2019-01-01', handicap: 14.2 }],
};
const proposal = {
  players: [{ name: 'Kurt', nickname: null }, { name: 'Pete Green', nickname: 'Greeny' }],
  trips: [{ name: '2019 Hunter', year: 2019, place: 'Hunter Valley', courses: [] }, { name: 'Port Stephens 2021', year: 2021, place: 'Port Stephens', courses: ['Horizons'] }],
  winners: [
    { trophy: 'bd trophy', year: 2019, trip: 'Hunter Valley 2019', winners: 'Kurt & Bluey', score: '44 pts' },
    { trophy: 'Wooden Spoon', year: 2018, trip: null, winners: 'Sam Jones', score: null },
    { trophy: 'The Claret Jug', year: 2021, trip: 'Port Stephens', winners: 'Greeny', score: null },
  ],
  handicaps: [{ player: 'Kurt', date: '2019-01-01', handicap: 14.2 }, { player: 'Greeny', date: '2021-03-01', handicap: 22 }, { player: 'Greeny', date: '2022-01-01', handicap: 19.5 }],
  rules: [{ title: 'ready golf', wording: '', category: 'etiquette' }, { title: 'Lost ball fine', wording: '$5 a ball', category: 'fines', value: '$5' }, { title: 'Old rule', category: 'other' }],
  unsure: [],
};

describe('matching against the group', () => {
  it('finds players by name, nickname or an unambiguous first name', () => {
    expect(findPlayer('Kurt', null, players)?.id).toBe('k');
    expect(findPlayer('kurt dahl', null, players)?.id).toBe('k');
    expect(findPlayer('Matt', 'Bluey', players)?.id).toBe('b');
    expect(findPlayer('Matt', null, players)?.id).toBe('b'); // the only Matt
    expect(findPlayer('Sam', null, players)).toBe(null); // two Sams
    expect(findPlayer('Pete', null, players)).toBe(null);
  });
  it('finds trips by name, or by year and a shared word', () => {
    expect(findTrip({ name: 'Hunter Valley 2019', year: 2019 }, trips)?.id).toBe('t1');
    expect(findTrip({ name: '2019 Hunter', year: 2019, place: 'Hunter Valley' }, trips)?.id).toBe('t1');
    expect(findTrip({ name: 'Hunter 2020', year: 2020 }, trips)).toBe(null);
    expect(findTrip({ name: 'Bowral', year: 2023 }, trips)?.id).toBe('t2');
  });
  it('knows the trophy names from trophies and the honour board', () => {
    const m = trophyNames(group.trophies, group.honour_board);
    expect([...m.values()]).toEqual(['BD Trophy', 'Wooden Spoon']);
  });
  it('labels a winner with the trip and year (30 letters max, always the year)', () => {
    expect(honourLabel({ year: 2019, trip: 'Hunter Valley 2019' })).toBe('Hunter Valley 2019');
    expect(honourLabel({ year: 2021, trip: 'Port Stephens' })).toBe('Port Stephens 2021');
    expect(honourLabel({ year: 2021, trip: '' })).toBe('2021');
    expect(honourLabel({ year: 2021, trip: 'A very long trip name that goes on and on' })).toBe('2021');
  });
});

describe('the confirm screen', () => {
  const items = buildReview(proposal, group);
  const by = (id) => items.find((x) => x.id === id);
  it('says how each item matches, and unticks what is already there', () => {
    expect(by('pl0')).toMatchObject({ match: 'already a player (Kurt Dahl)', already: true, ticked: false });
    expect(by('pl1')).toMatchObject({ match: 'new player', ticked: true });
    expect(by('tr0')).toMatchObject({ match: 'existing trip (Hunter Valley 2019)', already: true, ticked: false });
    expect(by('tr1')).toMatchObject({ match: 'new past trip', ticked: true });
    expect(by('wn0')).toMatchObject({ match: 'existing trophy', ticked: true });
    expect(by('wn0').data.trophy).toBe('BD Trophy'); // the group's own spelling
    expect(by('wn1')).toMatchObject({ match: 'already on the honour board', ticked: false });
    expect(by('wn2')).toMatchObject({ match: 'new trophy', ticked: true });
    expect(by('hc0')).toMatchObject({ match: 'already in their history', ticked: false });
    expect(by('hc1')).toMatchObject({ match: 'a new player’s history', ticked: true });
    expect(by('ru0')).toMatchObject({ match: 'already in the Rulebook', ticked: false });
    expect(by('ru2')).toMatchObject({ match: 'new rule', ticked: true }); // retired doesn't count
  });
  it('writes each item as one line', () => {
    expect(itemLine(by('pl1'))).toBe('Pete Green (“Greeny”)');
    expect(itemLine(by('tr1'))).toBe('Port Stephens 2021 · Horizons');
    expect(itemLine(by('wn0'))).toBe('BD Trophy Hunter Valley 2019 — Kurt & Bluey (44 pts)');
    expect(itemLine(by('hc0'))).toBe('Kurt · 14.2 · 2019');
    expect(itemLine({ section: 'handicaps', data: { player: 'Al', date: '2020-06-01', handicap: -2 } })).toBe('Al · +2 · 2020-06-01');
    expect(itemLine(by('ru1'))).toBe('Lost ball fine ($5)');
  });
  it('handles an empty or missing proposal', () => {
    expect(buildReview(null, {})).toEqual([]);
  });
});

describe('Add these: the rows', () => {
  const items = buildReview(proposal, group);
  const p = picked(items);
  it('keeps only ticked items', () => {
    expect(p.players.map((x) => x.data.name)).toEqual(['Pete Green']);
    expect(p.rules.map((x) => x.data.title)).toEqual(['Lost ball fine', 'Old rule']);
    const unticked = items.map((x) => (x.id === 'ru1' ? { ...x, ticked: false } : x));
    expect(picked(unticked).rules.map((x) => x.data.title)).toEqual(['Old rule']);
  });
  it('matches handicaps to existing or new players, and starts a new player on their latest handicap', () => {
    expect(handicapPlayer(p.handicaps[0], players, p.players)?.data?.name).toBe('Pete Green');
    expect(handicapPlayer({ data: { player: 'Nobody' } }, players, p.players)).toBe(null);
    expect(startingHandicap(p.players[0], p.handicaps)).toBe(19.5);
    expect(startingHandicap({ data: { name: 'X', nickname: '' } }, p.handicaps)).toBe(18);
  });
  it('makes locked past trips, dated 1 January when only the year is known', () => {
    expect(tripRow(p.trips[0])).toEqual({ name: 'Port Stephens 2021', start_date: '2021-01-01', end_date: '2021-01-01', status: 'locked' });
    expect(tripRow({ data: { name: 'Bowral', year: 2023, start_date: '2023-05-04', end_date: '2023-05-06' } })).toEqual({ name: 'Bowral', start_date: '2023-05-04', end_date: '2023-05-06', status: 'locked' });
  });
  it('makes honour rows with players and trips matched (after new players and trips exist)', () => {
    const all = [...players, { id: 'g', name: 'Pete Green', nickname: 'Greeny' }];
    const allTrips = [...trips, { id: 't3', name: 'Port Stephens 2021', start_date: '2021-01-01' }];
    const rows = honourRows(p.winners, all, allTrips);
    expect(rows[0]).toEqual({ label: 'Hunter Valley 2019', trophy: 'BD Trophy', winners: 'Kurt & Bluey', player_ids: ['k', 'b'], trip_id: 't1' });
    expect(rows[1]).toEqual({ label: 'Port Stephens 2021', trophy: 'The Claret Jug', winners: 'Greeny', player_ids: ['g'], trip_id: 't3' });
  });
  it('makes rule rows', () => {
    expect(ruleRows(p.rules)[0]).toEqual({ title: 'Lost ball fine', detail: '$5 a ball', category: 'fines', value: '$5' });
    expect(ruleRows(p.rules)[1]).toEqual({ title: 'Old rule', detail: null, category: 'other', value: null });
  });
  it('sums up what was added', () => {
    expect(summaryLine({ players: 6, trips: 3, winners: 14, rules: 9 })).toBe('Added 6 players, 3 past trips, 14 winners and 9 rules');
    expect(summaryLine({ players: 1 })).toBe('Added 1 player');
    expect(summaryLine({ rules: 0, proposed: 2 })).toBe('Added 2 rules up for a vote');
    expect(summaryLine({})).toMatch(/Nothing new/);
  });
});

describe('files and photos', () => {
  it('knows which files it can read', () => {
    expect(['a.txt', 'B.CSV', 'notes.md', 'x.docx', 'y.xlsx', 'z.pdf', 'w.doc'].map(fileKind)).toEqual(['text', 'text', 'text', 'docx', 'xlsx', null, null]);
  });
  it('caps text at about 200 KB', () => {
    expect(capText('abc')).toEqual({ text: 'abc', cut: false });
    const big = capText('x'.repeat(MAX_TEXT + 5));
    expect(big.cut).toBe(true);
    expect(big.text.length).toBe(MAX_TEXT);
  });
  it('reads the words out of a Word document', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>BD Trophy</w:t></w:r></w:p><w:p><w:r><w:t>2019</w:t></w:r><w:r><w:tab/><w:t>Kurt &amp; Bluey</w:t></w:r></w:p><w:p/></w:body></w:document>';
    expect(docxText(xml)).toBe('BD Trophy\n2019\tKurt & Bluey');
  });
  it('reads a spreadsheet as tab-separated lines', () => {
    const shared = '<sst><si><t>Year</t></si><si><t>Winner</t></si><si><r><t>Kurt </t></r><r><t>&amp; Bluey</t></r></si></sst>';
    const sheet = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>2019</v></c><c r="C2" t="s"><v>2</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>2018</t></is></c></row></sheetData>';
    expect(xlsxText(sheet, shared)).toBe('Year\tWinner\n2019\t\tKurt & Bluey\n2018');
  });
  it('unzips a stored and a deflated file', async () => {
    const { deflateRawSync } = await import('node:zlib');
    const enc = new TextEncoder();
    const files = [['a.txt', enc.encode('stored text'), 0], ['word/document.xml', enc.encode('<w:p><w:t>hi</w:t></w:p>'), 8]];
    const parts = []; const central = []; let off = 0;
    for (const [name, raw, method] of files) {
      const data = method ? new Uint8Array(deflateRawSync(raw)) : raw;
      const n = enc.encode(name);
      const lh = new Uint8Array(30 + n.length); const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, method, true); lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, n.length, true); lh.set(n, 30);
      const ch = new Uint8Array(46 + n.length); const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, method, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, off, true); ch.set(n, 46);
      parts.push(lh, data); central.push(ch); off += lh.length + data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22); const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 2, true); ev.setUint16(10, 2, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true);
    const all = new Uint8Array([...parts, ...central, end].reduce((s, x) => s + x.length, 0));
    let p = 0; for (const x of [...parts, ...central, end]) { all.set(x, p); p += x.length; }
    const out = await unzip(all.buffer, ['a.txt', 'word/document.xml']);
    expect(out).toEqual({ 'a.txt': 'stored text', 'word/document.xml': '<w:p><w:t>hi</w:t></w:p>' });
    await expect(unzip(new Uint8Array(30).buffer, ['x'])).rejects.toThrow();
  });
  it('shrinks photos to 1600px on the longest side, never up', () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe('the function’s reply', () => {
  it('reads a proposal, or falls back to the helper’s usual words', () => {
    const r = readImportReply({ import: { players: [{ name: 'Al' }], unsure: ['hmm'] }, found: 1, remaining: { month: 5, today: 2 }, log_id: 3 }, null);
    expect(r).toMatchObject({ kind: 'import', found: 1, logId: 3, remaining: { month: 5, today: 2 } });
    expect(r.proposal.trips).toEqual([]);
    expect(readImportReply({ error: 'Only an organiser can bring in the group’s history.' }, null)).toMatchObject({ kind: 'error' });
    expect(readImportReply({ message: 'Is this the right file?' }, null)).toMatchObject({ kind: 'message' });
    expect(readImportReply(null, { name: 'FunctionsFetchError', message: 'Failed to fetch' })).toMatchObject({ kind: 'error', text: 'No signal — try again in a moment.' });
  });
});

describe('editing on the confirm screen', () => {
  it('matches an edited item again, and checks it', () => {
    const it0 = { id: 'pl0', section: 'players', data: { name: 'Pete', nickname: '' }, match: 'new player', ticked: true };
    expect(rematch({ ...it0, data: { name: 'Kurt Dahl', nickname: '' } }, group)).toMatchObject({ match: 'already a player', already: true, ticked: false, existingId: 'k' });
    expect(rematch({ id: 'ru0', section: 'rules', data: { title: 'Brand new', wording: '' }, ticked: true }, group)).toMatchObject({ match: 'new rule', ticked: true });
    expect(itemProblem({ section: 'winners', data: { trophy: 'Cup', year: 1900, winners: 'Al' } })).toBe('Needs a year');
    expect(itemProblem({ section: 'handicaps', data: { player: 'Al', date: '2020-01-01', handicap: 60 } })).toBe('Handicap −10 to 54');
    expect(itemProblem({ section: 'handicaps', data: { player: 'Al', date: '2020-01-01', handicap: '' } })).toBe('Handicap −10 to 54');
    expect(itemProblem({ section: 'rules', data: { title: 'Fines' } })).toBe('');
  });
});
