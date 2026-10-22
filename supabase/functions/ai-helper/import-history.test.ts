// Deno tests for "import anything" (22 Oct 2026): rounds and scorecards, cups, awards and moments, stories, other,
// and reading a big import in parts. Fake fetch — no network, no key.
// Run: deno test --no-check supabase/functions/ai-helper/import-history.test.ts
import nodeAssert from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
const assertMatch = (s: string, re: RegExp) => nodeAssert.match(String(s), re);
import type { AiConfig } from './providers.ts';
import {
  importRequest, validateImport, mergeProposals, planBatches, partWords, readTrip, importSystem, cleanBody, readPars, readSi,
  readStrokes, readNames, IMPORT_TOOL, IMPORT_LIMITS, type ImportDeps,
} from './import.ts';

// deno-lint-ignore no-explicit-any
type Any = any;
const TODAY = '2026-10-22';
const OPENAI: AiConfig = { provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'cheap-text', caps: { groupPerMonth: 60, personPerDay: 10 } };
const PHOTO = 'data:image/jpeg;base64,' + btoa('fake jpeg bytes');
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const SI = [7, 15, 3, 11, 1, 17, 9, 13, 5, 8, 16, 4, 12, 2, 18, 10, 14, 6];

const EVERYTHING = {
  players: [], trips: [], winners: [], handicaps: [], rules: [],
  rounds: [
    { trip: 'Kiama 2018', year: 2018, date: '2018-03-10', course: 'Kiama Golf Club', format: 'stableford', pars: PARS, si: SI,
      players: [{ name: 'Dave', handicap: 14, strokes: [5, 5, 3, 6, 0, 4, 2, 5, 6, 5, 4, 5, 6, 5, 4, 3, 6, 5] }, { name: 'Kurt', points: 36 }] },
    { trip: 'Kiama 2018', year: 2018, course: 'Jamberoo', format: 'stroke', players: [{ name: 'Dave', gross: 92, net: 78 }] },
  ],
  cups: [{ name: 'The Ryder Cup', year: 2019, trip: 'Hunter 2019', sides: [{ name: 'Blue', players: ['Kurt', 'Bluey'], points: 4.5 }, { name: 'Gold', players: ['Dave', 'Sam'], points: 3.5 }],
    matches: [{ format: 'singles', a: ['Kurt'], b: ['Dave'], result: '3&2', winner: 'a', points: 1 }, { a: ['Bluey'], b: ['Sam'], result: 'halved', winner: 'halved' }] }],
  awards: [
    { kind: 'moment', title: 'Hole-in-one', year: 2018, trip: 'Kiama 2018', winners: ['Dave'], detail: 'On the 7th at Kiama', hole: 7, course: 'Kiama' },
    { kind: 'side_comp', title: 'Closest to the pin', year: 2018, winners: 'Kurt', hole: 16 },
    { kind: 'fine', title: 'Late to the bus', year: 2019, winners: ['Bluey'], detail: '$10' },
    { kind: 'award', title: 'Hack of the day', year: 2019, winners: ['Sam'] },
  ],
  stories: [{ kind: 'report', title: 'Kiama wrap', year: 2018, trip: 'Kiama 2018', body: 'Wild weekend.\r\n\r\n\r\n\r\nDave aced the 7th and shouted the bar.' }],
  other: [{ title: 'The bus', text: 'We hired a party bus in 2017 and never again.', year: 2017 }],
  unsure: [],
};

Deno.test('import tool: every new list is in the schema, and only the old five are required', () => {
  const props = IMPORT_TOOL.input_schema.properties as Any;
  for (const k of ['rounds', 'cups', 'awards', 'stories', 'other']) assert(props[k], k);
  assertEquals(IMPORT_TOOL.input_schema.required, ['players', 'trips', 'winners', 'handicaps', 'rules']);
  const sys = importSystem(TODAY, 'L.G.C');
  for (const w of ['rounds:', 'cups:', 'awards:', 'stories:', 'other:']) assert(sys.includes(w), w);
});

Deno.test('rounds: a full scorecard (pars, SI, per-hole strokes) and a totals-only card', () => {
  const p = validateImport(EVERYTHING, TODAY);
  assertEquals(p.rounds.length, 2);
  const r = p.rounds[0];
  assertEquals([r.course, r.year, r.date, r.format, r.trip], ['Kiama Golf Club', 2018, '2018-03-10', 'stableford', 'Kiama 2018']);
  assertEquals(r.pars, PARS);
  assertEquals(r.si, SI);
  assertEquals(r.players[0].strokes![4], null); // 0 = no score
  assertEquals(r.players[0].handicap, 14);
  assertEquals(r.players[1].points, 36);
  assertEquals(r.players[1].strokes, null);
  const t = p.rounds[1];
  assertEquals([t.format, t.date, t.pars, t.players[0].gross, t.players[0].net], ['stroke', null, null, 92, 78]);
});

Deno.test('rounds: partial and junk cards are cleaned or dropped (and counted)', () => {
  const p = validateImport({ rounds: [
    { course: 'Kiama', year: 2018, format: 'skins', pars: [4, 4, 4], si: [1, 1, 2], players: [{ name: 'Dave', points: '38 pts' }, { name: 'Dave', points: 20 }, { name: 'X', points: 30 }, { name: 'Nobody' }] },
    { course: 'K', year: 2018, players: [{ name: 'Dave', points: 30 }] }, // course too short
    { course: 'Kiama', players: [{ name: 'Dave', points: 30 }] }, // no year and no trip
    { course: 'Kiama', year: 2040, players: [{ name: 'Dave', points: 30 }] }, // future year, no trip
    { course: 'Kiama', year: 2018, players: [{ name: 'Dave', gross: 5 }] }, // no believable score
    { course: 'Bowral', trip: 'Bowral weekend', date: '2019-02-30', players: [{ name: 'Sam', strokes: [4, 99, 'x', 5] }] },
    'nonsense', null,
  ] }, TODAY);
  assertEquals(p.rounds.length, 2);
  const a = p.rounds[0];
  assertEquals([a.format, a.pars, a.si, a.players.length, a.players[0].points], ['stableford', null, null, 1, 38]);
  const b = p.rounds[1];
  assertEquals([b.year, b.date, b.trip], [null, null, 'Bowral weekend']);
  assertEquals(b.players[0].strokes, [4, null, null, 5]);
  assertEquals(p.dropped, 6);
});

Deno.test('cups: two sides, matches, the winner from the points; junk refused', () => {
  const p = validateImport(EVERYTHING, TODAY);
  const c = p.cups[0];
  assertEquals([c.name, c.year, c.winner, c.sides.length, c.matches.length], ['The Ryder Cup', 2019, 'Blue', 2, 2]);
  assertEquals(c.matches[0], { format: 'singles', a: ['Kurt'], b: ['Dave'], result: '3&2', winner: 'a', points: 1 });
  assertEquals(c.matches[1].winner, 'halved');
  const q = validateImport({ cups: [
    { name: 'One side', year: 2019, sides: [{ name: 'Blue' }] },
    { name: '', year: 2019, sides: [{ name: 'A', points: 'lots' }, { name: 'B' }, { name: 'C' }], matches: [{ a: [], b: ['x'] }], winner: 'Nobody' },
  ] }, TODAY);
  assertEquals(q.cups.length, 1);
  assertEquals([q.cups[0].name, q.cups[0].sides.length, q.cups[0].matches.length, q.cups[0].winner, q.cups[0].sides[0].points], ['The Cup', 2, 0, null, null]);
  assertEquals(q.dropped, 1);
});

Deno.test('awards, stories and other: kinds, names, holes, bodies kept with line breaks', () => {
  const p = validateImport(EVERYTHING, TODAY);
  assertEquals(p.awards.map((a) => a.kind), ['moment', 'side_comp', 'fine', 'award']);
  assertEquals([p.awards[0].hole, p.awards[0].winners, p.awards[0].course], [7, 'Dave', 'Kiama']);
  assertEquals(p.awards[1].winners, 'Kurt');
  assertEquals(p.stories[0].body, 'Wild weekend.\n\nDave aced the 7th and shouted the bar.');
  assertEquals(p.stories[0].kind, 'report');
  assertEquals(p.other[0], { title: 'The bus', text: 'We hired a party bus in 2017 and never again.', year: 2017, trip: null });
  const q = validateImport({
    awards: [{ kind: 'bogus', title: 'Best hat', hole: 40, year: 1800 }, { kind: 'award', title: '' }],
    stories: [{ title: '', body: 'Short' }, { body: 'No title here but a decent story about the 2019 trip.' }],
    other: [{ title: 'x', text: '' }],
  }, TODAY);
  assertEquals([q.awards.length, q.awards[0].kind, q.awards[0].hole, q.awards[0].year], [1, 'other', null, null]);
  assertEquals(q.stories.length, 1);
  assert(q.stories[0].title.startsWith('No title here'));
  assertEquals(q.dropped, 3);
});

Deno.test('guesses: only a real true marks a new item as a guess', () => {
  const p = validateImport({
    rounds: [{ course: 'Kiama', year: 2018, players: [{ name: 'Dave', points: 30 }], guess: true }],
    cups: [{ name: 'Cup', year: 2019, sides: [{ name: 'A' }, { name: 'B' }], guess: 'yes' }],
    awards: [{ kind: 'award', title: 'Hack', guess: true }], stories: [{ title: 'S', body: 'A long enough story.', guess: true }],
    other: [{ title: 'Odd', text: 'Text', guess: 1 }],
  }, TODAY);
  assertEquals([p.rounds[0].guess, p.cups[0].guess, p.awards[0].guess, p.stories[0].guess, p.other[0].guess], [true, undefined, true, true, undefined]);
});

Deno.test('little readers: pars, SI, strokes, names, bodies, the trip hint', () => {
  assertEquals(readPars([4, 4, 3, 5, 4, 4, 3, 4, 5]), [4, 4, 3, 5, 4, 4, 3, 4, 5]);
  assertEquals(readPars([4, 4, 2, 5, 4, 4, 3, 4, 5]), null);
  assertEquals(readSi([1, 2, 3], 3), [1, 2, 3]);
  assertEquals(readSi([1, 1, 3], 3), null);
  assertEquals(readStrokes([0, 0]), null);
  assertEquals(readStrokes(Array(20).fill(4))!.length, 18);
  assertEquals(readNames('Kurt & Bluey, kurt and Sam'), ['Kurt', 'Bluey', 'Sam']);
  assertEquals(cleanBody('<b>hi</b>\u0007 there'), 'b hi /b there');
  assertEquals(readTrip({ name: 'Kiama <2018>', year: 2018 }), { name: 'Kiama 2018', year: 2018 });
  assertEquals(readTrip({ name: 'x' }), null);
  assertEquals(readTrip('Kiama'), null);
});

Deno.test('merge: parts joined, repeats across parts removed, dropped added up', () => {
  const a = validateImport({ ...EVERYTHING, players: [{ name: 'Dave' }] }, TODAY);
  const b = validateImport({ players: [{ name: 'dave' }, { name: 'Sam' }], rounds: EVERYTHING.rounds.slice(0, 1), awards: [{ kind: 'award', title: 'x' }], unsure: ['smudged'] }, TODAY);
  const m = mergeProposals([{ ...a, dropped: 2 }, { ...b, dropped: 1 }], TODAY);
  assertEquals(m.players.map((p) => p.name), ['Dave', 'Sam']);
  assertEquals(m.rounds.length, 2);
  assertEquals(m.awards.length, 4);
  assertEquals(m.unsure, ['smudged']);
  assertEquals(m.dropped, 3); // each part's own count added up (nothing more is left out when they're joined)
  assertEquals(mergeProposals([a], TODAY), a);
});

Deno.test('batching: text in ~80k pieces cut at a line end, photos 4 at a time, at most 6 parts', () => {
  assertEquals(planBatches('hello', []), [{ text: 'hello', images: [] }]);
  assertEquals(planBatches('hello', [PHOTO, PHOTO]), [{ text: 'hello', images: [PHOTO, PHOTO] }]);
  const nine = Array(9).fill(PHOTO);
  const p9 = planBatches('notes', nine);
  assertEquals(p9.map((p) => [p.text, p.images.length]), [['notes', 4], ['', 4], ['', 1]]);
  const line = 'x'.repeat(99) + '\n';
  const big = line.repeat(2000); // 200,000 characters
  const pb = planBatches(big, Array(12).fill(PHOTO));
  assertEquals(pb.length, IMPORT_LIMITS.maxParts);
  assertEquals(pb.slice(0, 3).map((p) => p.images.length), [0, 0, 0]);
  assert(pb.slice(0, 3).every((p) => p.text.length <= IMPORT_LIMITS.textPerPart && p.text.endsWith('x')), 'cut at a line end');
  assertEquals(pb.slice(0, 3).reduce((n, p) => n + p.text.length, 0), big.trim().length - 2); // the two line ends cut on
  assertEquals(pb.slice(3).map((p) => p.images.length), [4, 4, 4]);
  assertEquals(partWords(p9, 1), 'photos 5–8');
  assertEquals(partWords(p9, 2), 'photo 9');
  assertEquals(partWords(p9, 0), 'the text and photos 1–4');
  assertEquals(partWords(pb, 1), 'the text (part 2 of 3)');
});

// ------------------------------------------------------------------ The whole request, in parts

function deps(fetchFn: typeof fetch, over: Partial<ImportDeps> = {}) {
  const log: Any[] = [];
  const d: ImportDeps = {
    status: { is_member: true, is_admin: true, group_id: 'g1', group_name: 'L.G.C', role: 'organiser' },
    ai: OPENAI, visionModel: 'vision-model', fetchFn,
    now: () => new Date(`${TODAY}T01:00:00Z`),
    featureOn: async () => true,
    usage: async () => ({ month: 1, today: 1 }),
    logStart: async (row) => { log.push({ start: row }); return 7; },
    logEnd: async (id, row) => { log.push({ end: row, id }); },
    ...over,
  };
  return { d, log };
}
const call = (args: unknown) => ({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'propose_import', arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });

Deno.test('import in parts: 9 photos → 3 calls at once, one proposal, one question, the trip hint in every prompt', async () => {
  const sent: Any[] = [];
  const fn = (async (_u: string, init: Any) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    const imgs = body.messages[1].content.filter((c: Any) => c.type === 'image_url').length;
    // Each part finds something different; the first and second both find Dave.
    const r = imgs === 4 && sent.length === 1 ? { ...EVERYTHING, players: [{ name: 'Dave' }] } : imgs === 4 ? { players: [{ name: 'Dave' }, { name: 'Sam' }] } : { other: [{ title: 'Back of the card', text: 'Signed by Kurt' }] };
    return new Response(JSON.stringify(call(r)), { status: 200 });
  }) as unknown as typeof fetch;
  const { d, log } = deps(fn);
  const out: Any = await importRequest({ mode: 'import', text: 'Kiama scorecards', images: Array(9).fill(PHOTO), trip: { name: 'Kiama 2018', year: 2018 } }, d);
  assertEquals(sent.length, 3);
  assert(sent.every((b) => b.model === 'vision-model'));
  assert(sent.every((b) => /about the trip "Kiama 2018" \(2018\)/.test(b.messages[0].content) && /part \d of 3/.test(b.messages[0].content)));
  assert(sent[0].messages[1].content[0].text.includes('Kiama scorecards'));
  assert(!JSON.stringify(sent[1]).includes('Kiama scorecards'), 'the text goes with the first part only');
  assertEquals(out.import.players.map((p: Any) => p.name).sort(), ['Dave', 'Sam']);
  assertEquals(out.import.rounds.length, 2);
  assertEquals(out.import.other.length + 0, 2);
  assertEquals(out.found, out.import.players.length + out.import.rounds.length + out.import.cups.length + out.import.awards.length + out.import.stories.length + out.import.other.length);
  assertEquals(log.filter((l) => l.start).length, 1); // one question
  assertEquals(log.find((l) => l.end).end.input_tokens, 300);
  assertEquals(log.find((l) => l.end).end.ok, true);
});

Deno.test('import in parts: a part that fails is named under "not sure"; all failing counts nothing', async () => {
  let n = 0;
  const half = (async () => {
    n++;
    return n === 2 ? new Response('{"error":"busy"}', { status: 503 }) : new Response(JSON.stringify(call({ players: [{ name: 'Dave' }] })), { status: 200 });
  }) as unknown as typeof fetch;
  const { d } = deps(half);
  const out: Any = await importRequest({ mode: 'import', images: Array(8).fill(PHOTO) }, d);
  assert(out.import, JSON.stringify(out));
  assertMatch(out.import.unsure[0], /^Couldn’t read photos 5–8 — send them again on their own\.$/);
  const bad = (async () => new Response('{"error":"busy"}', { status: 503 })) as unknown as typeof fetch;
  const { d: d2, log } = deps(bad);
  const out2: Any = await importRequest({ mode: 'import', images: Array(8).fill(PHOTO) }, d2);
  assert(out2.error && out2.code, JSON.stringify(out2));
  assertEquals(out2.remaining, { month: 60, today: 10 }); // not used up
  assertEquals(log.find((l) => l.end).end.ok, false);
});
