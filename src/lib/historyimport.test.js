// "Import anything from past trips" (22 Oct 2026): matching proposals to trips and courses, the rows written, and
// the keys that make a second run add nothing.
import { describe, it, expect } from 'vitest';
import {
  normKey, courseKey, findCourse, libraryPick, cardHoles, newTripName, chooseTrip, tripWords, roundKey, noteKey, noteFor,
  cupSummary, roundRow, noteRow, cupHonour, buildHistoryItems, chooseItemTrip, historyProblem, historyLine, tripsNeeded, historyCounts,
} from './historyimport.js';
import { buildReview, picked, readImportReply, summaryLine, itemProblem, itemLine, rematch, MAX_PHOTOS } from './aiimport.js';

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const SI = [7, 15, 3, 11, 1, 17, 9, 13, 5, 8, 16, 4, 12, 2, 18, 10, 14, 6];
const players = [
  { id: 'dave', name: 'Dave Smith', nickname: 'Davo' },
  { id: 'kurt', name: 'Kurt Dahl', nickname: 'Kurt' },
  { id: 'sam', name: 'Sam Lee', nickname: null },
];
const trips = [
  { id: 'kiama', name: 'Kiama 2018', start_date: '2018-03-09', end_date: '2018-03-11', status: 'locked' },
  { id: 'hunter', name: 'Hunter Valley', start_date: '2019-01-01', end_date: '2019-01-01', status: 'locked' },
  { id: 'now', name: 'This weekend', start_date: '2026-10-21', end_date: '2026-10-25', status: 'active' },
];
const PROPOSAL = {
  players: [], trips: [{ name: 'Bowral 2021', year: 2021, place: 'Bowral', courses: [], start_date: null, end_date: null }], winners: [], handicaps: [], rules: [],
  rounds: [
    { trip: 'Kiama 2018', year: 2018, date: '2018-03-10', course: 'Kiama GC', name: null, format: 'stableford', pars: PARS, si: SI,
      players: [{ name: 'Davo', handicap: 14, strokes: [5, 5, 2, 6, null, 4, 1, 5, 6, 5, 4, 5, 6, 5, 4, 3, 6, 5], gross: null, net: null, points: null }, { name: 'Kurt', handicap: null, strokes: null, gross: 90, net: null, points: 36 }, { name: 'Ollie', handicap: null, strokes: null, gross: null, net: null, points: 30 }] },
    { trip: 'Bowral 2021', year: 2021, date: null, course: 'Bowral', name: 'Day 1', format: 'stroke', pars: null, si: null, players: [{ name: 'Sam', handicap: null, strokes: null, gross: 92, net: 78, points: null }] },
    { trip: null, year: 2015, date: null, course: 'Moss Vale', name: null, format: 'stableford', pars: null, si: null, players: [{ name: 'Sam', handicap: null, strokes: null, gross: null, net: null, points: 33 }], guess: true },
  ],
  cups: [{ name: 'The Ryder Cup', year: 2019, trip: 'Hunter Valley', winner: 'Blue',
    sides: [{ name: 'Blue', players: ['Kurt', 'Davo'], points: 4.5 }, { name: 'Gold', players: ['Sam', 'Ollie'], points: 3.5 }],
    matches: [{ format: 'singles', a: ['Kurt'], b: ['Sam'], result: '3&2', winner: 'a', points: 1 }, { format: null, a: ['Davo'], b: ['Ollie'], result: null, winner: 'halved', points: null }] }],
  awards: [
    { kind: 'moment', title: 'Hole-in-one', year: 2018, trip: 'Kiama 2018', date: null, winners: 'Davo', detail: null, hole: 7, course: 'Kiama' },
    { kind: 'fine', title: 'Late to the bus', year: 2019, trip: null, date: null, winners: 'Kurt', detail: '$10', hole: null, course: null },
  ],
  stories: [{ kind: 'report', title: 'Kiama wrap', year: 2018, trip: 'Kiama 2018', date: null, body: 'Wild weekend.\nDave aced the 7th.' }],
  other: [{ title: 'The bus', text: 'Party bus in 2014, never again.', year: 2014, trip: null }],
  unsure: [], dropped: 0,
};
const group = { players, trips, courses: [{ id: 'c-kiama', name: 'Kiama Golf Club' }], rounds: [], notes: [], honour_board: [], trophies: [], trophiesOn: true };

describe('courses', () => {
  it('matches a card’s course to the group’s by its core name', () => {
    expect(courseKey('The Kiama Golf Club')).toBe('kiama');
    expect(findCourse('Kiama GC', group.courses)?.id).toBe('c-kiama');
    expect(findCourse('kiama golf club', group.courses)?.id).toBe('c-kiama');
    expect(findCourse('Jamberoo', group.courses)).toBe(null);
    expect(findCourse('Kiama', [{ id: 1, name: 'Kiama GC' }, { id: 2, name: 'Kiama Golf Club' }])).toBe(null); // two: no guess
  });
  it('picks a library course only when the core name is the same, and only with a scorecard', () => {
    expect(libraryPick('Kiama', [{ id: 'l1', name: 'Kiama Golf Club', holes: 18 }])?.id).toBe('l1');
    expect(libraryPick('Kiama', [{ id: 'l1', name: 'Kiama Golf Club', holes: 0 }])).toBe(null);
    expect(libraryPick('Kiama', [{ id: 'l2', name: 'Kiama Heights' }])).toBe(null);
  });
  it('uses the card’s own holes only with pars and a stroke index', () => {
    expect(cardHoles({ pars: PARS, si: SI })[4]).toEqual({ n: 5, par: 4, si: 1 });
    expect(cardHoles({ pars: PARS, si: null })).toBe(null);
    expect(cardHoles({ pars: PARS.slice(0, 9), si: SI.slice(0, 8) })).toBe(null);
  });
});

describe('trips', () => {
  const proposed = [{ id: 'tr0', section: 'trips', data: { name: 'Bowral 2021', year: 2021 }, existingId: null }];
  const ctx = { trips, proposed };
  it('goes on an existing trip by name, a proposed trip, one trip that year, or a new past trip', () => {
    expect(chooseTrip('rounds', { trip: 'Kiama 2018', year: 2018 }, ctx)).toBe('kiama');
    expect(chooseTrip('rounds', { trip: 'kiama', year: 2018 }, ctx)).toBe('kiama'); // same year, a word in common
    expect(chooseTrip('rounds', { trip: 'Bowral 2021', year: 2021 }, ctx)).toBe('p:tr0');
    expect(chooseTrip('awards', { trip: null, year: 2019 }, ctx)).toBe('hunter');
    expect(chooseTrip('rounds', { trip: null, year: 2015, course: 'Moss Vale' }, ctx)).toBe('new');
    expect(chooseTrip('stories', { trip: null, year: 2014 }, ctx)).toBe(''); // no trip: the group's history
    expect(chooseTrip('stories', { trip: 'Port 2014', year: 2014 }, ctx)).toBe('new');
  });
  it('the trip the organiser started from wins unless the item names one that’s there', () => {
    expect(chooseTrip('stories', { trip: null, year: 2014 }, { ...ctx, preset: 'hunter' })).toBe('hunter');
    expect(chooseTrip('rounds', { trip: 'Kiama 2018', year: 2018 }, { ...ctx, preset: 'hunter' })).toBe('kiama');
    expect(chooseTrip('rounds', { trip: 'Somewhere else' }, { ...ctx, preset: 'hunter' })).toBe('hunter');
    expect(chooseTrip('rounds', { trip: null }, { ...ctx, preset: 'gone' })).toBe('new'); // not the group's trip
  });
  it('names new past trips and says where things go', () => {
    expect(newTripName('rounds', { course: 'Moss Vale', year: 2015 })).toBe('Moss Vale 2015');
    expect(newTripName('cups', { name: 'The Cup', trip: 'Port 2014' })).toBe('Port 2014');
    expect(tripWords({ section: 'rounds', tripChoice: 'new', data: { course: 'Moss Vale', year: 2015 } }, ctx)).toBe('new past trip Moss Vale 2015');
    expect(tripWords({ section: 'rounds', tripChoice: 'p:tr0', data: {} }, ctx)).toBe('new past trip Bowral 2021');
    expect(tripWords({ section: 'stories', tripChoice: '', data: {} }, ctx)).toBe('the group’s history (no trip)');
    expect(tripWords({ section: 'rounds', tripChoice: 'kiama', data: {} }, ctx)).toBe('Kiama 2018');
  });
});

describe('keys (the same as the database makes)', () => {
  it('round and note keys', () => {
    expect(normKey('  Kiama   Golf\nClub ')).toBe('kiama golf club');
    expect(roundKey('t1', 'Kiama  GC', '2018-03-10', 'Day 1')).toBe('t1|kiama gc|2018-03-10|day 1');
    expect(roundKey('t1', 'Kiama', null, null)).toBe('t1|kiama||');
    expect(noteKey('story', null, 'The  Bus', 2014, 'Party bus\nin 2014')).toBe('story||the bus|2014|party bus in 2014');
    expect(noteKey('moment', 't1', 'Ace', null, 'x'.repeat(100)).endsWith(`|${'x'.repeat(60)}`)).toBe(true);
  });
});

describe('the confirm screen', () => {
  const items = buildReview(PROPOSAL, group);
  const by = (s) => items.filter((x) => x.section === s);
  it('every kind comes through, each on a trip, ticked unless a guess', () => {
    expect(by('rounds').length).toBe(3);
    expect(by('rounds')[0].tripChoice).toBe('kiama');
    expect(by('rounds')[0].match).toBe('→ Kiama 2018 · course: Kiama Golf Club');
    expect(by('rounds')[1].tripChoice).toBe('p:tr0');
    expect(by('rounds')[1].match).toMatch(/new past trip Bowral 2021 · course from the library, or totals only/);
    expect(by('rounds')[2].tripChoice).toBe('new');
    expect(by('rounds')[2].ticked).toBe(false); // a guess
    expect(by('cups')[0].tripChoice).toBe('hunter');
    expect(by('cups')[0].detail).toBe('Blue goes on the honour board');
    expect(by('awards').map((x) => x.tripChoice)).toEqual(['kiama', 'hunter']);
    expect(by('stories')[0].tripChoice).toBe('kiama');
    expect(by('other')[0].tripChoice).toBe('');
    expect(items.filter((x) => x.ticked).length).toBe(1 + 2 + 1 + 2 + 1 + 1); // trip + rounds(2) + cup + awards + story + other
    expect(itemLine(by('rounds')[0])).toBe('Kiama GC · 2018-03-10 · 3 players, hole by hole');
    expect(historyLine(by('cups')[0])).toBe('The Ryder Cup 2019 — Blue 4½ v Gold 3½ (Blue won)');
    expect(itemLine(by('awards')[0])).toBe('Moment: Hole-in-one — Davo (hole 7) · 2018');
  });
  it('already in: a second run finds the round and the notes and unticks them', () => {
    const k = roundKey('kiama', 'Kiama GC', '2018-03-10', null);
    const n = noteFor('stories', PROPOSAL.stories[0]);
    const g2 = { ...group, rounds: [{ id: 'r1', trip_id: 'kiama', import_key: k }], notes: [{ import_key: noteKey(n.kind, 'kiama', n.title, 2018, n.body) }, { import_key: noteKey('other', null, 'The bus', 2014, 'Party bus in 2014, never again.') }] };
    const again = buildReview(PROPOSAL, g2);
    const r = again.find((x) => x.id === 'ro0');
    expect([r.already, r.ticked]).toEqual([true, false]);
    expect(again.find((x) => x.section === 'stories').already).toBe(true);
    expect(again.find((x) => x.section === 'other').already).toBe(true);
    // A round made in the app on the same course and day is "already in" too.
    const g3 = { ...group, rounds: [{ id: 'r9', trip_id: 'kiama', course_id: 'c-kiama', play_date: '2018-03-10', name: 'Saturday' }] };
    expect(buildReview(PROPOSAL, g3).find((x) => x.id === 'ro0').already).toBe(true);
  });
  it('moving an item to another trip rechecks it; a current trip is refused for rounds', () => {
    const ctx = { trips, proposed: by('trips'), today: '2026-10-22' };
    const moved = chooseItemTrip(by('rounds')[0], 'now', group, ctx);
    expect(moved.current).toBe(true);
    expect(historyProblem(moved)).toMatch(/on now or coming up/);
    expect(itemProblem(moved)).toMatch(/on now or coming up/);
    const story = chooseItemTrip(by('stories')[0], '', group, ctx);
    expect([story.tripChoice, story.ticked, historyProblem(story)]).toEqual(['', true, '']);
    expect(historyProblem({ ...by('rounds')[0], tripChoice: '' })).toBe('Pick a trip');
    expect(historyProblem({ ...by('stories')[0], data: { ...by('stories')[0].data, body: '' } })).toBe('Needs the story');
    expect(historyProblem({ ...by('awards')[0], data: { ...by('awards')[0].data, year: 1800 } })).toBe('Year 1950 or later');
    const edited = rematch({ ...by('rounds')[0], data: { ...by('rounds')[0].data, course: 'Jamberoo' } }, group, ctx);
    expect(edited.detail).toMatch(/new course from the card/);
  });
  it('picked, the trips they need, and the summary', () => {
    const p = picked(items);
    expect([p.rounds.length, p.cups.length, p.awards.length, p.stories.length, p.other.length]).toEqual([2, 1, 2, 1, 1]);
    const forced = items.map((x) => (x.id === 'ro2' ? { ...x, ticked: true } : x));
    expect(tripsNeeded(forced)).toEqual([{ name: 'Moss Vale 2015', year: 2015, date: null }]);
    expect(historyCounts({ rounds: 2, cups: 1, awards: 1, stories: 3 })).toEqual(['2 rounds', '1 cup', '1 award & moment', '3 stories']);
    expect(summaryLine({ trips: 1, rounds: 2, cups: 1, awards: 2, stories: 1, other: 1 })).toBe('Added 1 past trip, 2 rounds, 1 cup, 2 awards & moments, 1 story and 1 other');
  });
  it('reads every new list from the function’s reply; 12 photos', () => {
    const r = readImportReply({ import: { ...PROPOSAL, rounds: [{ x: 1 }], other: 'junk' }, found: 9 }, null);
    expect(r.proposal.rounds).toEqual([{ x: 1 }]);
    expect(r.proposal.other).toEqual([]);
    expect(r.proposal.cups.length).toBe(1);
    expect(MAX_PHOTOS).toBe(12);
  });
});

describe('rows written', () => {
  const items = buildReview(PROPOSAL, group);
  const rd = items.find((x) => x.id === 'ro0');
  it('a round on a known course: strokes for players in the group, points otherwise, the rest in the scorecard note', () => {
    const row = roundRow(rd, 'kiama', { course_id: 'c-kiama' }, true, players);
    expect(row.trip_id).toBe('kiama');
    expect(row.course_id).toBe('c-kiama');
    expect(row.play_date).toBe('2018-03-10');
    expect(row.players).toEqual([
      { player_id: 'dave', handicap: 14, strokes: PROPOSAL.rounds[0].players[0].strokes, points: null },
      { player_id: 'kurt', handicap: null, strokes: null, points: 36 },
    ]);
    expect(row.summary).toBe('Kurt: 90 gross\nOllie: 30 pts — not in the group');
  });
  it('a totals-only placeholder: no strokes kept, they go in the note', () => {
    const it2 = { ...rd, data: { ...rd.data, pars: null, si: null } };
    const row = roundRow(it2, 'kiama', { course: { name: 'Kiama GC', holes: null } }, false, players);
    expect(row.course).toEqual({ name: 'Kiama GC', holes: null });
    expect(row.players[0]).toEqual({ player_id: 'dave', handicap: 14, strokes: null, points: null });
    expect(row.summary.split('\n')[0]).toBe('Davo (14): holes 5 5 2 6 – 4 1 5 6 5 4 5 6 5 4 3 6 5');
  });
  it('the organiser’s answers (aliases) decide who a name is', () => {
    const row = roundRow(rd, 'kiama', { course_id: 'c-kiama' }, true, players, { ollie: 'sam' });
    expect(row.players.map((p) => p.player_id)).toEqual(['dave', 'kurt', 'sam']);
    expect(row.summary).toBe('Kurt: 90 gross');
  });
  it('cups: a note with the sides and matches, and the winners on the honour board', () => {
    const cup = items.find((x) => x.section === 'cups');
    const row = noteRow(cup, 'hunter', players);
    expect(row.kind).toBe('cup');
    expect(row.body).toBe('Blue 4½ – Gold 3½ (Blue won).\nKurt beat Sam 3&2\nDavo and Ollie halved');
    expect(row.people).toBe('Kurt & Davo');
    expect(row.player_ids).toEqual(['kurt', 'dave']);
    expect(row.data.sides.length).toBe(2);
    const h = cupHonour(cup, trips[1], players);
    expect(h).toEqual({ label: 'Hunter Valley 2019', trophy: 'The Ryder Cup', winners: 'Blue — Kurt & Davo', player_ids: ['kurt', 'dave'], trip_id: 'hunter' });
    expect(cupHonour({ ...cup, data: { ...cup.data, winner: null } }, trips[1], players)).toBe(null);
    expect(cupSummary({ sides: [{ name: 'A', points: null }, { name: 'B', points: null }], matches: [], winner: null })).toBe('A v B.');
  });
  it('awards, stories and other: notes with who, where and when', () => {
    const [moment, fine] = items.filter((x) => x.section === 'awards');
    expect(noteRow(moment, 'kiama', players)).toEqual({
      kind: 'moment', title: 'Hole-in-one', body: 'Hole 7 at Kiama', trip_id: 'kiama', year: 2018, happened_on: null, people: 'Davo',
      player_ids: ['dave'], data: { hole: 7, course: 'Kiama' },
    });
    expect(noteRow(fine, null, players)).toMatchObject({ kind: 'fine', body: '$10', trip_id: null, people: 'Kurt', player_ids: ['kurt'] });
    expect(noteRow(items.find((x) => x.section === 'stories'), 'kiama', players)).toMatchObject({ kind: 'report', title: 'Kiama wrap', body: 'Wild weekend.\nDave aced the 7th.' });
    expect(noteRow(items.find((x) => x.section === 'other'), null, players)).toMatchObject({ kind: 'other', title: 'The bus', year: 2014, trip_id: null });
  });
});
