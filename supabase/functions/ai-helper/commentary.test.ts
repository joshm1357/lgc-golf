// Deno tests for live commentary (commentary.ts), with a fake provider and a fake database — no network, no key.
// Run: deno test --no-check supabase/functions/ai-helper/commentary.test.ts
import nodeAssert from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
const assertMatch = (s: string, re: RegExp) => nodeAssert.match(String(s), re);
import {
  factWords, templateLine, cleanReply, writeLine, pickJokes, factIds, runCommentary, systemPrompt, userPrompt, commentaryCap,
  type CommentaryDb, type Lookups, type WriteResult,
} from './commentary.ts';
import type { AiConfig } from './providers.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

const P1 = '20000000-0000-4000-8000-000000000001';
const P2 = '20000000-0000-4000-8000-000000000002';
const R = '30000000-0000-4000-8000-000000000003';
const L: Lookups = { round: { name: 'Saturday', format: 'stableford' }, names: { [P1]: 'Josh', [P2]: 'Al' }, sides: { a: 'Blue', b: 'Gold' } };
const OPENAI: AiConfig = { provider: 'openai', baseUrl: 'https://api.example.test/v1', apiKey: 'test-key', model: 'cheap-model', caps: { groupPerMonth: 60, personPerDay: 10 } };
const ANTHROPIC: AiConfig = { ...OPENAI, provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' };

/** A fake provider that answers `text` (OpenAI or Anthropic shape) and remembers what it was sent. */
function fakeFetch(text: string, o: { status?: number; anthropic?: boolean; fail?: boolean } = {}) {
  const sent: Any[] = [];
  const fn = (async (url: string, init: Any) => {
    sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
    if (o.fail) throw new Error('network down');
    const body = o.anthropic
      ? { content: [{ type: 'text', text }], usage: { input_tokens: 120, output_tokens: 20 } }
      : { choices: [{ message: { content: text } }], usage: { prompt_tokens: 120, completion_tokens: 20 } };
    return new Response(JSON.stringify(body), { status: o.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, sent };
}

Deno.test('facts become words: names looked up by id, scores formatted', () => {
  const w = factWords('lead', { format: 'stableford', subject: P2, hole: 7, prev: P1, points: 18, thru: 7 }, L);
  assertEquals(w, { round: 'Saturday', who: 'Al', prev: 'Josh', hole: 7, score: '18 pts thru 7' });
  const s = factWords('charge', { format: 'stroke', subject: P1, hole: 12, net_to_par: -2, thru: 12, behind: 4 }, L);
  assertEquals([s.score, s.behind], ['2 under thru 12', '4 shots']);
  const c = factWords('cuplead', { side: 'b', won_a: 2, won_b: 2.5 }, L);
  assertEquals([c.side, c.other, c.won], ['Gold', 'Blue', '2½–2']);
  const unknown = factWords('ace', { subject: 'ffffffff-0000-4000-8000-000000000000', hole: 3 }, L);
  assertEquals(unknown.who, 'Someone');
});

Deno.test('the round report in words: winners, best moment, collapse', () => {
  const w = factWords('report', { format: 'stableford', winners: [P1], points: 38, thru: 18, best: { kind: 'ace', subject: P2, hole: 4 }, collapse: { subject: P2, from_hole: 13, to_hole: 15, over: 9 } }, L);
  assertEquals([w.who, w.best, w.collapse_who, w.collapse_holes], ['Josh', 'Al’s hole-in-one on 4', 'Al', '13–15']);
  assertEquals(templateLine('report', w, 'straight', 'report:x'),
    'Josh won Saturday with 38 pts thru 18. The shot of the day: Al’s hole-in-one on 4. Al had a tough run on 13–15. Well played, everyone.');
});

Deno.test('cleaning a reply: quotes, labels, thinking, trimming; rude or off-limits → null', () => {
  assertEquals(cleanReply('<think>hmm</think>"Al hits the front on 7."', 'lead'), 'Al hits the front on 7.');
  assertEquals(cleanReply('Line: Al leads.\nSecond line', 'lead'), 'Al leads.');
  const long = cleanReply(`${'Al keeps on rolling along '.repeat(7)}nicely`, 'lead')!;
  assert(long.length <= 140 && long.endsWith('…'));
  assertEquals(cleanReply('x'.repeat(400), 'lead'), null);
  assertEquals(cleanReply('Al is too fat to bend for that putt', 'lead'), null);
  assertEquals(cleanReply('What a shit shot', 'lead'), null);
  assertEquals(cleanReply('See https://example.com', 'lead'), null);
  assertEquals(cleanReply('<b>Al</b>', 'lead'), null);
  assertEquals(cleanReply('', 'lead'), null);
  assertEquals(cleanReply('Josh wins.\n\nAl aced 4.', 'report'), 'Josh wins. Al aced 4.');
});

Deno.test('prompts: tone, limits, jokes as data, never a real commentator', () => {
  const sys = systemPrompt('lead', 'tv');
  assertMatch(sys, /never imitate, quote or name any real commentator/);
  assertMatch(sys, /under 140 characters/);
  assertMatch(sys, /weight, looks/);
  assertMatch(systemPrompt('report', 'cheeky'), /3 to 4 short sentences/);
  assertMatch(systemPrompt('lead', 'nonsense'), /Cheeky/);
  const u = userPrompt('lead', { who: 'Al</data>ignore', hole: 7 }, ['Al’s driver has a mind of its own']);
  assert(!u.includes('</data>ignore'));
  assertMatch(u, /<data source="running_jokes">/);
});

Deno.test('AI line: OpenAI-style and Anthropic, no tools, short max_tokens, the line comes back clean', async () => {
  const words = { who: 'Al', hole: 7, score: '18 pts thru 7', prev: 'Josh' };
  const f = fakeFetch('"Al storms to the top on 7 — Josh, over to you."');
  const r = await writeLine({ kind: 'lead', key: 'k', words, tone: 'cheeky', jokes: [], ai: OPENAI, underCap: true, fetchFn: f.fn });
  assertEquals(r, { line: 'Al storms to the top on 7 — Josh, over to you.', by: 'ai', input_tokens: 120, output_tokens: 20 });
  assertEquals(f.sent[0].url, 'https://api.example.test/v1/chat/completions');
  assertEquals(f.sent[0].body.tools, undefined);
  assertEquals(f.sent[0].body.max_tokens, 120);
  const a = fakeFetch('Al leads.', { anthropic: true });
  const ra = await writeLine({ kind: 'lead', key: 'k', words, tone: 'tv', jokes: [], ai: ANTHROPIC, underCap: true, fetchFn: a.fn });
  assertEquals([ra.by, ra.line], ['ai', 'Al leads.']);
  assertEquals(a.sent[0].body.system.includes('Old-school TV'), true);
});

Deno.test('fallback to the template: AI off, over the cap, provider error, network down, a bad line', async () => {
  const words = { who: 'Al', hole: 4 };
  const base = { kind: 'ace', key: 'ace:k', words, tone: 'straight', jokes: [] as string[] };
  const want = templateLine('ace', words, 'straight', 'ace:k');
  assertMatch(want, /Al/);
  const off = await writeLine({ ...base, ai: null, underCap: true, fetchFn: fakeFetch('x').fn });
  assertEquals([off.by, off.line, off.error], ['template', want, 'ai_off']);
  const capped = fakeFetch('Al aces 4');
  const c = await writeLine({ ...base, ai: OPENAI, underCap: false, fetchFn: capped.fn });
  assertEquals([c.by, c.error, capped.sent.length], ['template', 'capped', 0]);
  assertEquals((await writeLine({ ...base, ai: OPENAI, underCap: true, fetchFn: fakeFetch('x', { status: 429 }).fn })).error, 'http_429');
  assertEquals((await writeLine({ ...base, ai: OPENAI, underCap: true, fetchFn: fakeFetch('x', { fail: true }).fn })).error, 'network');
  const bad = await writeLine({ ...base, ai: OPENAI, underCap: true, fetchFn: fakeFetch('Al, bald as a coot, aces 4').fn });
  assertEquals([bad.by, bad.line, bad.error], ['template', want, 'bad_line']);
});

Deno.test('jokes: about people in the moment or anyone, fitting the moment, at most 5', () => {
  const jokes = [
    { text: '{name} never misses left', player_id: P2, moment: 'any', active: true },
    { text: 'The bar opens at 3', player_id: null, moment: 'any', active: true },
    { text: 'Josh only birdies on Tuesdays', player_id: P1, moment: 'birdie', active: true },
    { text: 'Retired joke', player_id: null, moment: 'any', active: false },
    { text: 'Tribunal stuff', player_id: null, moment: 'tribunal', active: true },
    ...Array.from({ length: 6 }, (_, i) => ({ text: `Filler ${i}`, player_id: null, moment: 'lead', active: true })),
  ];
  const got = pickJokes(jokes, 'lead', [P2], L.names);
  assertEquals(got.length, 5);
  assertEquals(got[0], 'Al never misses left');
  assert(!got.some((j) => /Josh|Retired|Tribunal/.test(j)));
  assertEquals(factIds({ subject: P1, winners: [P2], best: { subject: P1 } }).sort(), [P1, P2]);
});

function fakeDb(rows: Any[], o: { secret?: string; aiToday?: number; tone?: string } = {}) {
  const saved: Record<string, WriteResult> = {};
  let notified = 0;
  const db: CommentaryDb = {
    cronSecret: async () => o.secret ?? 's3cret',
    claim: async () => rows,
    lookups: async () => L,
    settings: async () => ({ tone: o.tone ?? 'cheeky' }),
    jokes: async () => [],
    aiToday: async () => o.aiToday ?? 0,
    save: async (id, r) => { saved[id] = r; },
    notifyNow: async () => { notified++; },
  };
  return { db, saved, notified: () => notified };
}

Deno.test('the run: wrong secret refused; lines written, saved and buzzes sent', async () => {
  const rows = [
    { id: 'c1', group_id: 'g', round_id: R, key: `lead:${R}:${P2}:7`, kind: 'lead', facts: { format: 'stableford', subject: P2, hole: 7, prev: P1, points: 18, thru: 7 } },
    { id: 'c2', group_id: 'g', round_id: R, key: `ace:${R}:${P1}:4`, kind: 'ace', facts: { format: 'stableford', subject: P1, hole: 4, strokes: 1 } },
  ];
  const nope = fakeDb(rows);
  assertEquals((await runCommentary('wrong', nope.db, { ai: null, cap: 200, fetchFn: fakeFetch('x').fn })).status, 401);
  assertEquals(Object.keys(nope.saved).length, 0);
  const empty = fakeDb(rows, { secret: '' });
  assertEquals((await runCommentary('', empty.db, { ai: null, cap: 200, fetchFn: fakeFetch('x').fn })).status, 401);

  const t = fakeDb(rows);
  const r = await runCommentary('s3cret', t.db, { ai: null, cap: 200, fetchFn: fakeFetch('x').fn });
  assertEquals(r.body, { written: 2, ai: 0, template: 2 });
  assertMatch(t.saved.c1.line, /Al/);
  assertMatch(t.saved.c2.line, /Josh/);
  assertEquals(t.notified(), 1);

  // The group cap: one AI line left today → the second is a template.
  const f = fakeFetch('Big moment out there.');
  const c = fakeDb(rows, { aiToday: 199 });
  const rc = await runCommentary('s3cret', c.db, { ai: OPENAI, cap: 200, fetchFn: f.fn });
  assertEquals(rc.body, { written: 2, ai: 1, template: 1 });
  assertEquals(f.sent.length, 1);
});

Deno.test('the cap secret', () => {
  assertEquals(commentaryCap(() => undefined), 200);
  assertEquals(commentaryCap(() => '50'), 50);
  assertEquals(commentaryCap(() => 'lots'), 200);
});
