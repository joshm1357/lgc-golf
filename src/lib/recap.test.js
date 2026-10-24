// The Weekend Recap (ov37): the facts, the missing-cards nudge, the script check, the no-AI script and the two voices.
import { describe, it, expect, vi } from 'vitest';
import {
  buildRecapFacts, missingCards, missingNudge, cardsIn, postMoments, holeHighlights, historyLines, tribunalFacts, datesWords,
  checkScript, templateScript, factLines, scriptText, pickDuoVoices, createDuoReader, recapOutOfDate, tripPlayerIds, feedLine, LIMITS,
} from './recap.js';

const HOLES = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: i % 6 === 2 ? 3 : 4, si: i + 1 }));
const course = { id: 'c1', name: 'Narooma', holes: HOLES };
const P = { josh: 'p1', mo: 'p2', bo: 'p3', kurt: 'p4', lou: 'p5', di: 'p6', away: 'p9' };
const playersById = Object.fromEntries([
  [P.josh, 'Josh'], [P.mo, 'Mo'], [P.bo, 'Bo'], [P.kurt, 'Kurt'], [P.lou, 'Lou'], [P.di, 'Di'], [P.away, 'Stayhome Steve'],
].map(([id, n]) => [id, { id, name: `${n} Full`, nickname: n }]));
const FRI = { id: 'r1', trip_id: 't1', course_id: 'c1', name: 'Friday', play_date: '2026-10-16', format: 'stableford', status: 'locked' };
const SAT = { id: 'r2', trip_id: 't1', course_id: 'c1', name: 'Saturday', play_date: '2026-10-17', format: 'stableford', status: 'locked' };
const SUN = { id: 'r3', trip_id: 't1', course_id: 'c1', name: 'Sunday Ambrose', play_date: '2026-10-18', format: 'ambrose', status: 'locked' };
const trip = { id: 't1', name: 'L.G.C South Coast Trip 2026', start_date: '2026-10-16', end_date: '2026-10-18' };
const card = (strokesByHole) => Object.fromEntries(Object.entries(strokesByHole).map(([h, s]) => [h, { strokes: s, picked_up: false }]));
const parCard = (over = {}) => card(Object.fromEntries(HOLES.map((h) => [h.n, over[h.n] ?? h.par])));
const roundPlayers = {
  r1: [P.josh, P.mo, P.bo].map((id) => ({ round_id: 'r1', player_id: id })),
  r2: [P.josh, P.mo, P.bo, P.kurt, P.lou, P.di, 'p7', 'p8'].map((id) => ({ round_id: 'r2', player_id: id })),
};
const teamsByRound = { r3: [{ id: 'tm1', round_id: 'r3', name: 'Team Josh', players: [{ id: P.josh }, { id: P.mo }] }, { id: 'tm2', round_id: 'r3', name: 'Team Bo', players: [{ id: P.bo }, { id: P.kurt }] }] };
const scoresIdx = {
  r1: { [P.josh]: parCard({ 3: 2 }), [P.mo]: parCard({ 7: 10, 2: 3 }), [P.bo]: parCard({ 5: 3, 9: 2 }) },
  r2: { [P.mo]: parCard(), [P.kurt]: parCard({ 11: 8 }) },
  r3: { tm1: parCard() },
};

describe('missing cards', () => {
  it('counts the cards in per round (players, or teams for Ambrose) and makes the nudge', () => {
    const m = missingCards([FRI, SAT, SUN], { roundPlayers, teamsByRound, playersById, scoresIdx });
    expect(m.map((x) => [x.name, x.have, x.of])).toEqual([['Friday', 3, 3], ['Saturday', 2, 8], ['Sunday', 1, 2]]);
    expect(m[1].missing).toContain('Josh');
    expect(cardsIn(m)).toBe(6);
    const n = missingNudge(m);
    expect(n.count).toBe(7);
    expect(n.text).toBe('7 cards missing — add yours and you’re in the recap');
    expect(n.round.id).toBe('r2'); // the button goes to the worst round
    expect(missingNudge(m.slice(1, 2)).text).toBe('6 cards missing from Saturday — add yours and you’re in the recap');
    expect(missingNudge([m[0]])).toBe(null);
  });
  it('a quick result counts as a card', () => {
    const m = missingCards([SAT], { roundPlayers, teamsByRound, playersById, scoresIdx, quickResults: [{ round_id: 'r2', player_id: P.josh, points: 30 }] });
    expect(m[0].have).toBe(3);
  });
});

describe('the facts', () => {
  it('reads the moments people tagged, the biggest number, birdies and the honour board', () => {
    expect(postMoments([{ body: 'Bomb drive on 7', player_id: P.kurt, round_id: 'r2' }, { body: 'What a day', player_id: P.mo }, { body: 'Three-putt on 18 (Team Bo)', player_id: P.bo }]))
      .toEqual([{ kind: 'Bomb drive', hole: 7, player_id: P.kurt, round_id: 'r2', at: '' }, { kind: 'Three-putt', hole: 18, player_id: P.bo, round_id: null, at: '' }]);
    const hl = holeHighlights([FRI, SAT, SUN], { coursesById: { c1: course }, scoresIdx, roundPlayers, playersById });
    expect(hl.big[0]).toMatchObject({ name: 'Mo', strokes: 10, par: 4, hole: 7, round: 'Friday' });
    expect(hl.big[1]).toMatchObject({ name: 'Kurt', strokes: 8, hole: 11, round: 'Saturday' });
    expect(hl.birdies).toEqual([{ id: P.bo, name: 'Bo', count: 2 }]);
    const hb = [{ trophy_name: 'BD Trophy', label: '2025', winner_names: 'Bo', player_ids: [P.bo], sort_key: 20, trip_id: 'old' },
      { trophy_name: 'BD Trophy', label: '2024', winner_names: 'Mo', player_ids: [P.mo], sort_key: 10, trip_id: 'older' }];
    expect(historyLines([{ name: 'BD Trophy', winner: { names: 'Mo', ids: [P.mo] } }], hb, 't1')).toEqual(['Bo held the BD Trophy (2025) before this trip.', 'Mo has now won the BD Trophy 2 times.']);
    expect(historyLines([{ name: 'BD Trophy', winner: { names: 'Bo', ids: [P.bo] } }], hb, 't1')).toEqual(['Bo: 2 BD Trophy wins in a row.']);
    expect(historyLines([{ name: 'BD Trophy', winner: { names: 'Josh', ids: [P.josh] } }], hb, 't1')[1]).toBe('Josh: first ever BD Trophy.');
  });
  it('Tribunal cases around the trip, with charge, defence and verdict', () => {
    const nameOf = (id) => playersById[id]?.nickname;
    const t = tribunalFacts({
      trip, rounds: [FRI, SAT, SUN], nameOf,
      tribunal: [{ accused_id: P.kurt, proposed_change: -2, case_text: '38 points off a 16', defence: 'The wind was behind me all day', status: 'closed', verdict: 'upheld', new_handicap: 14, created_at: '2026-10-18T09:00:00Z' },
        { accused_id: P.bo, proposed_change: -1, case_text: 'old', status: 'closed', verdict: 'dismissed', created_at: '2026-08-01T00:00:00Z' }],
      cases: [{ id: 'c1', kind: 'ruling', title: 'Mo’s mulligan on the 1st', body: 'Took a breakfast ball without asking', subject_id: P.mo, status: 'failed', created_at: '2026-10-17T02:00:00Z' },
        { id: 'c2', kind: 'election', title: 'Captain', status: 'passed', created_at: '2026-10-17T02:00:00Z' }],
      casePosts: [{ case_id: 'c1', kind: 'reply', player_id: P.mo, body: 'Everyone gets one on the first. It’s tradition.' }],
    });
    expect(t).toEqual([
      { title: 'Handicap case: Kurt, -2', accused: 'Kurt', charge: '38 points off a 16', defence: 'The wind was behind me all day', verdict: 'guilty, handicap now 14' },
      { title: 'Mo’s mulligan on the 1st', accused: 'Mo', charge: 'Took a breakfast ball without asking', defence: 'Everyone gets one on the first. It’s tradition.', verdict: 'thrown out' },
    ]);
  });
  it('builds the whole set from the results page’s sums, only for people in the trip', () => {
    const res = {
      hero: { name: 'BD Trophy', line: 'Mo wins the BD Trophy 2026, takes it from Bo', winner: { names: 'Mo', ids: [P.mo] }, st: { rows: [{ text: '102 pts' }] } },
      trophies: [{ name: 'BD Trophy', line: 'Mo wins the BD Trophy 2026, takes it from Bo', winner: { names: 'Mo', ids: [P.mo] } }],
      podiums: [{ round: FRI, podium: [{ place: 1, name: 'Bo', score: '38 pts' }, { place: 2, name: 'Josh', score: '36 pts' }], rows: [] }],
      sides: [{ label: 'Saturday 💣 LD 7', name: 'Kurt' }], tally: [{ player_id: P.mo, count: 2, titles: ['Wrong ball', 'Late to the bus'] }], photos: [{}, {}],
      awards: { awards: [], nominations: [], votes: [] }, cup: null,
    };
    const f = buildRecapFacts({
      trip, res, rounds: [FRI, SAT, SUN], playersById, roundPlayers, teamsByRound, coursesById: { c1: course }, scoresIdx,
      posts: [{ body: 'Bomb drive on 7', player_id: P.kurt, round_id: 'r2' }, { body: 'Bomb drive on 3', player_id: P.away, round_id: 'r2' }],
    });
    expect(f.trip).toEqual({ name: 'L.G.C South Coast Trip 2026', dates: 'Fri 16 – Sun 18 Oct', year: '2026', rounds: 3 });
    expect(f.players).not.toContain('Stayhome Steve');
    expect(f.moments).toEqual([{ kind: 'Bomb drive', name: 'Kurt', hole: 7, round: 'Saturday' }]); // not the player who wasn't there
    expect(f.winner).toMatchObject({ names: 'Mo', score: '102 pts' });
    expect(f.rounds[0]).toMatchObject({ name: 'Friday', winners: 'Bo', score: '38 pts', cards: 3, of: 3 });
    expect(f.missing).toEqual([{ round: 'Saturday', have: 2, of: 8 }, { round: 'Sunday', have: 1, of: 2 }]);
    expect(f.cards).toBe(6);
    const lines = factLines(f).map((l) => l.text);
    expect(lines).toContain('Mo wins the BD Trophy 2026, takes it from Bo (102 pts).');
    expect(lines).toContain('Kurt posted a bomb drive on the 7th (Saturday).');
    expect(lines).toContain('Saturday: only 2 of 8 cards are in the app.');
    expect(lines).toContain('Biggest number: Mo made 10 on the par-4 7th (Friday).');
    expect(JSON.stringify(f).length).toBeLessThan(LIMITS.factsChars);
    expect(recapOutOfDate({ cards: 5 }, f)).toBe(true);
    expect(recapOutOfDate({ cards: 6 }, f)).toBe(false);
    expect(tripPlayerIds([SUN], { teamsByRound })).toEqual([P.josh, P.mo, P.bo, P.kurt]);
  });
  it('dates in words', () => {
    expect(datesWords('2026-10-16', '2026-10-18')).toBe('Fri 16 – Sun 18 Oct');
    expect(datesWords('2026-10-31', '2026-11-01')).toBe('Sat 31 Oct – Sun 1 Nov');
    expect(datesWords('2026-10-16')).toBe('Fri 16 Oct');
  });
});

const FACTS = {
  trip: { name: 'L.G.C South Coast Trip 2026', dates: 'Fri 16 – Sun 18 Oct', rounds: 3 }, players: ['Josh', 'Mo', 'Bo', 'Kurt'],
  winner: { line: 'Mo wins the BD Trophy 2026, takes it from Bo', score: '102 pts', names: 'Mo' },
  history: ['Bo held the BD Trophy (2025) before this trip.'],
  rounds: [{ name: 'Friday', winners: 'Bo', score: '38 pts' }], big: [{ name: 'Mo', strokes: 10, par: 4, hole: 7, round: 'Friday' }],
  moments: [{ kind: 'Bomb drive', name: 'Kurt', hole: 7, round: 'Saturday' }],
  tribunal: [{ title: 'Handicap case: Kurt, -2', accused: 'Kurt', charge: '38 points off a 16', defence: 'The wind was behind me all day', verdict: 'guilty' }],
  fines: [{ name: 'Mo', count: 2, titles: ['Wrong ball'] }], missing: [{ round: 'Saturday', have: 2, of: 8 }], cards: 6,
};
const opts = { tripNames: ['Josh', 'Mo', 'Bo', 'Kurt'], otherNames: ['Stayhome Steve', 'Gaz', 'Bo'], facts: FACTS };
const good = () => ({
  title: 'Mo’s Coastal Coronation',
  lines: [
    { who: 'A', text: 'Welcome to The Weekend Recap! Rex Fairway here, voice already gone.' },
    { who: 'B', text: 'Bev Divot. Three rounds on the South Coast. Rex cried at two of them.' },
    { who: 'A', text: 'Mo wins the BD Trophy on 102 points and takes it off Bo!' },
    { who: 'B', text: 'Bo has requested a recount. The recount says 102.' },
    { who: 'A', text: 'Kurt posted a bomb drive on the 7th! Satellites picked it up!' },
    { who: 'B', text: 'Then the Tribunal took two shots off him. Golf giveth.' },
    { who: 'A', text: 'His defence: the wind was behind him all day!' },
    { who: 'B', text: 'Saturday, only 2 of 8 cards are in. Add yours and you’re in the next one.' },
  ],
});

describe('the script check', () => {
  it('a good script passes, cleaned', () => {
    const r = checkScript(good(), opts);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.script.lines).toHaveLength(8);
  });
  it('too short, too long, one voice, three in a row', () => {
    expect(checkScript({ title: 'x', lines: good().lines.slice(0, 4) }, opts).problems.join(' ')).toMatch(/short title.*8 to 14 lines/);
    const long = good(); long.lines = [...long.lines, ...long.lines];
    expect(checkScript(long, opts).problems.join(' ')).toMatch(/8 to 14 lines \(you used 16\)/);
    const wordy = good(); wordy.lines[0].text = 'Mo '.repeat(90);
    expect(checkScript(wordy, opts).problems.join(' ')).toMatch(/under 240 characters/);
    const solo = good(); solo.lines = solo.lines.map((l) => ({ ...l, who: 'A' }));
    expect(checkScript(solo, opts).problems.join(' ')).toMatch(/Both commentators.*Take turns/);
  });
  it('only people from this trip (or named in the facts), no film names, nothing off limits, no made-up numbers', () => {
    const away = good(); away.lines[3].text = 'Stayhome Steve would have won this.';
    expect(checkScript(away, opts).problems.join(' ')).toMatch(/Stayhome Steve weren’t there|Stayhome Steve wasn|Only people on this trip/);
    expect(checkScript(good(), opts).problems).toEqual([]); // Bo isn't on the trip list here but is in the facts (last year's holder)
    const film = good(); film.lines[0].text = 'Welcome back to ESPN8, I’m Pepper Brooks.';
    expect(checkScript(film, opts).problems.join(' ')).toMatch(/no film names/);
    const mean = good(); mean.lines[1].text = 'Bo spent his salary on the bar.';
    expect(checkScript(mean, opts).problems.join(' ')).toMatch(/friendly/);
    const made = good(); made.lines[2].text = 'Mo wins on 117 points!';
    expect(checkScript(made, opts).problems.join(' ')).toMatch(/117 isn’t in them/);
    const year = good(); year.lines[2].text = 'Mo wins the 2026 BD Trophy!';
    expect(checkScript(year, opts).ok).toBe(true);
  });
  it('the facts block can’t smuggle tags into the prompt or the page', () => {
    const lines = factLines({ trip: { name: '<script>x</script> Trip', rounds: 1 }, players: [] });
    expect(lines[0].text).not.toMatch(/[<>]/);
  });
});

describe('the script with no AI', () => {
  it('uses only the facts, passes its own check, 8–14 lines', () => {
    const s = templateScript(FACTS);
    const r = checkScript(s, opts);
    expect(r.problems).toEqual([]);
    expect(s.lines.length).toBeGreaterThanOrEqual(8);
    expect(s.lines.length).toBeLessThanOrEqual(14);
    expect(s.lines[0].who).toBe('A');
    const all = s.lines.map((l) => l.text).join(' ');
    expect(all).toMatch(/Mo wins the BD Trophy 2026/);
    expect(all).toMatch(/only 2 of 8 cards are in/);
  });
  it('lots of data: still 14 lines at most, taking turns, under the length limit', () => {
    const lots = { ...FACTS, rounds: [{ name: 'Friday', winners: 'Bo', score: '38 pts' }, { name: 'Saturday', winners: 'Kurt', score: '40 pts' }],
      comps: [{ label: 'Saturday LD 7', name: 'Kurt' }], fines: [{ name: 'Mo', count: 2, titles: [] }], missing: [{ round: 'Saturday', have: 2, of: 8 }] };
    const s = templateScript(lots);
    const r = checkScript(s, { ...opts, facts: lots });
    expect(r.problems).toEqual([]);
    expect(s.lines.at(-1).text).toBe('Same time next trip.');
    expect(s.lines.map((l) => l.text).join(' ')).toMatch(/only 2 of 8 cards/);
  });
  it('thin data still makes a full, honest script', () => {
    const s = templateScript({ trip: { name: 'Quiet Weekend', rounds: 1 }, players: ['Al'] });
    expect(checkScript(s, { tripNames: ['Al'], facts: { trip: { name: 'Quiet Weekend', rounds: 1 } } }).problems).toEqual([]);
  });
  it('the transcript for the group chat and the Feed line', () => {
    const t = scriptText({ title: 'Big Weekend', lines: [{ who: 'A', text: 'Hello!' }, { who: 'B', text: 'Hi.' }] }, 'https://x/#/recap/t1');
    expect(t).toBe('📺 Big Weekend\n\nRex: Hello!\nBev: Hi.\n\n▶️ Have a listen: https://x/#/recap/t1');
    expect(feedLine('Big Weekend')).toBe('📺 The Weekend Recap is out: Big Weekend — ▶️ have a listen');
  });
});

describe('two voices', () => {
  const v = (name, lang) => ({ name, lang, localService: true });
  it('picks two different accents when it can, one voice for both otherwise', () => {
    const d = pickDuoVoices([v('Karen', 'en-AU'), v('Daniel', 'en-GB'), v('Samantha', 'en-US'), v('Thomas', 'fr-FR')]);
    expect([d.A.name, d.B.name]).toEqual(['Karen', 'Daniel']);
    expect(d.distinct).toBe(true);
    const one = pickDuoVoices([v('Karen', 'en-AU')]);
    expect(one.A).toBe(one.B);
    expect(pickDuoVoices([])).toEqual({ A: null, B: null, distinct: false });
  });
  it('reads line by line, highlights each, never over itself, and stops cleanly', () => {
    const spoken = [];
    let last = null;
    const synth = { getVoices: () => [v('Karen', 'en-AU'), v('Daniel', 'en-GB')], cancel: vi.fn(), speak: (u) => { spoken.push(u); last = u; } };
    function U(text) { this.text = text; }
    const timers = [];
    const r = createDuoReader(synth, U, { setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
    const seen = [];
    let done = false;
    r.play([{ who: 'A', text: 'One' }, { who: 'B', text: 'Two' }], { onLine: (i) => seen.push(i), onDone: () => { done = true; } });
    expect(spoken[0].voice.name).toBe('Karen');
    expect(spoken[0].pitch).toBeLessThan(1);
    last.onend();
    expect(spoken[1].voice.name).toBe('Daniel');
    expect(spoken[1].pitch).toBeGreaterThan(1);
    spoken[0].onend(); // an old line finishing late changes nothing
    expect(seen).toEqual([0, 1]);
    last.onend();
    expect(done).toBe(true);
    r.play([{ who: 'A', text: 'Again' }, { who: 'B', text: 'More' }], { from: 1, onLine: (i) => seen.push(i) });
    r.stop();
    last.onend();
    expect(seen).toEqual([0, 1, 1]);
  });
});
