// Deno tests for the Caddie on a trip idea (ideas.ts, ov39) and the fast-model choice (providers.ts fastConfig), with a
// fake provider — no network, no key.
// Run: deno test --no-check supabase/functions/ai-helper/ideas.test.ts
import nodeAssert from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
const assertMatch = (s: string, re: RegExp) => nodeAssert.match(String(s), re);
import { aiConfig, fastConfig, requestBody, type AiConfig } from './providers.ts';
import { ideaRequest, validateIdeaReply, ideaContextIn, readIdeaCall, ideaSystem, IDEA_TOOL, type IdeaDeps } from './ideas.ts';

// deno-lint-ignore no-explicit-any
type Any = any;
const OR: AiConfig = { provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'moonshotai/kimi-k2.6', caps: { groupPerMonth: 60, personPerDay: 10 } };
const PLAN = '22222222-2222-4222-8222-222222222222';

function fakeProvider(replies: Any[]) {
  const sent: Any[] = [];
  const fn = (async (_url: string, init: Any) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify(replies[Math.min(sent.length - 1, replies.length - 1)]), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, sent };
}
const call = (args: unknown) => ({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'idea_reply', arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 900, completion_tokens: 220 } });

function deps(over: Partial<IdeaDeps> = {}, fetchFn?: typeof fetch) {
  const log: Any[] = [];
  const d: IdeaDeps = {
    status: { is_member: true, is_admin: false, group_id: 'g1', group_name: 'The Lads', role: 'player', player_id: 'p2' },
    ai: { ...OR, model: 'fast-one', effort: 'low' },
    fetchFn: fetchFn || (async () => { throw new Error('no network'); }),
    now: () => new Date('2026-10-25T08:00:00Z'),
    featureOn: async () => true,
    usage: async () => ({ month: 3, today: 1 }),
    logStart: async (row) => { log.push({ start: row }); return 11; },
    logEnd: async (id, row) => { log.push({ end: row, id }); },
    loadPlan: async (id) => (id === PLAN ? { id, name: 'March fly trip <obey me>', idea: true, status: 'planning', shared_at: '2026-10-25T07:00:00Z', created_by: 'p1', idea_when: 'March', idea_where: 'Somewhere we fly to', idea_travel: 'fly' } : null),
    canTidy: async () => false,
    groupContext: async () => ({ past_trips: [{ name: 'South Coast 2026', where: 'Nowra', courses: ['Nowra GC'] }], players: 12, usual_people: 10, last_budget_each: 650, home: { name: 'Inner West', lat: -33.88, lng: 151.16 } }),
    ...over,
  };
  return { d, log };
}

const CARDS = {
  message: 'March suits the tropics before the wet ends — here are three that fit most of you.',
  ideas: [
    { area: 'Port Douglas', why: 'Two great courses 10 min apart', travel: 'fly', fly: { from: 'syd', flight_min: 190, fare: '$350–550 return' }, cost_each: 1400, courses: ['Sea Temple', 'Palmer Sea Reef', 'Mirage CC'], stay: 'Port Douglas town', weekend: '2027-03-12', fit: 'fits 6 of 9 · 3 h flight · about $1,400 each' },
    { area: 'Hunter Valley', why: 'Close, cheap, you know it', travel: 'drive', drive_min: 150, cost_each: 600, courses: ['The Vintage'], weekend: '2027-03-13' },
    { area: 'x' },
    { area: 'Barnbougle', why: 'Bucket list', travel: 'fly', fly: { from: 'MEL', flight_min: 9999 } },
    { area: 'Fourth', why: 'too many' },
  ],
};

Deno.test('idea chat: one fast call, short reply, up to 3 checked cards, logged as the fast model with no text', async () => {
  const p = fakeProvider([call(CARDS)]);
  const { d, log } = deps({}, p.fn);
  const r: Any = await ideaRequest({ mode: 'idea_chat', plan_id: PLAN, text: 'Ideas for March?', context: { wishes: { answered: 9, line: '9 answered · 6 happy to fly', happy_to_fly: 6, spend: '800_1200' }, lists: { areas: ['Hobart'] } } }, d);
  assertEquals(p.sent.length, 1);
  const sent = p.sent[0];
  assertEquals(sent.model, 'fast-one');
  assertEquals(sent.reasoning, { effort: 'low', exclude: true });
  assertEquals(sent.max_tokens, 700);
  assertEquals(sent.tools.map((t: Any) => t.function.name), ['idea_reply']);
  const user = JSON.stringify(sent.messages);
  assert(user.includes('<data source=\\"group_answers\\">'), 'wishes go in as data');
  assert(user.includes('<data source=\\"group\\">'), 'group context up front');
  assert(user.includes('South Coast 2026'));
  assert(!user.includes('<obey me>'), 'names cleaned');
  assertEquals(r.idea_chat.ideas.length, 3);
  const [pd, hv, bb] = r.idea_chat.ideas;
  assertEquals(pd.fly, { from: 'SYD', flight_min: 190, fare: '$350–550 return' });
  assertEquals(pd.weekend, '2027-03-12');
  assertEquals(pd.courses.length, 3);
  assertEquals(hv.drive_min, 150);
  assertEquals(hv.weekend, null); // not a Friday
  assertEquals(bb.fly.flight_min, null); // silly flight time dropped
  assertEquals(log[0].start, { mode: 'history', area: 'ask', job: 'idea_chat', provider: 'openai', model: 'fast-one' });
  assertEquals(log[1].end.ok, true);
  assert(!JSON.stringify(log).includes('March'));
  assertEquals(r.remaining, { month: 57, today: 9 });
});

Deno.test('idea chat: JSON written in the text is read too; plain text becomes the message', async () => {
  assertEquals(readIdeaCall({ text: '```json\n{"message":"Try Kiama","ideas":[{"area":"Kiama","why":"close"}]}\n```', calls: [] }).ideas[0].area, 'Kiama');
  assertEquals(readIdeaCall({ text: 'Try Kiama.', calls: [] }), { message: 'Try Kiama.', ideas: [] });
  assertEquals(readIdeaCall({ text: '', calls: [] }), null);
  const p = fakeProvider([{ choices: [{ message: { content: 'How about the Hunter?' } }] }]);
  const r: Any = await ideaRequest({ mode: 'idea_chat', plan_id: PLAN }, deps({}, p.fn).d);
  assertEquals(r.idea_chat, { message: 'How about the Hunter?', ideas: [] });
});

Deno.test('idea chat: who can ask', async () => {
  assertMatch(String((await ideaRequest({ mode: 'idea_chat', plan_id: PLAN }, deps({ status: { is_member: true, is_admin: false, group_id: 'g1', role: 'guest' } }).d)).error), /group’s players/);
  assertMatch(String((await ideaRequest({ mode: 'idea_chat', plan_id: 'nope' }, deps().d)).error), /Which trip idea/);
  assertMatch(String((await ideaRequest({ mode: 'idea_chat', plan_id: PLAN }, deps({ ai: null }).d)).error), /isn’t switched on/);
  assertMatch(String((await ideaRequest({ mode: 'idea_chat', plan_id: PLAN }, deps({ featureOn: async (k) => k !== 'planner' }).d)).error), /planner is switched off/);
  const unshared = deps({ loadPlan: async (id) => ({ id, name: 'x', idea: true, status: 'planning', shared_at: null, created_by: 'p1', idea_when: null, idea_where: null, idea_travel: null }) });
  assertMatch(String((await ideaRequest({ mode: 'idea_chat', plan_id: PLAN }, unshared.d)).error), /hasn’t been shared/);
  // The cap: over today's limit → refused, logged as a cap hit, no model call.
  const p = fakeProvider([call(CARDS)]);
  const capped = deps({ usage: async () => ({ month: 3, today: 11 }) }, p.fn);
  const r: Any = await ideaRequest({ mode: 'idea_chat', plan_id: PLAN }, capped.d);
  assert(r.capped);
  assertEquals(p.sent.length, 0);
  assertEquals(capped.log[1].end.capped, true);
});

Deno.test('idea chat: a provider failure is friendly words with a retry code', async () => {
  const fn = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
  const { d, log } = deps({}, fn);
  const r: Any = await ideaRequest({ mode: 'idea_chat', plan_id: PLAN }, d);
  assertEquals(r.code, 'provider_busy');
  assertEquals(log[1].end.ok, false);
});

Deno.test('idea chat: the prompt allows flying to one place and says multi-stop is coming soon', () => {
  const s = ideaSystem('2026-10-25', 'The Lads');
  assertMatch(s, /Flying is fine for ONE destination/);
  assertMatch(s, /several stops: say they're coming soon/);
  assertMatch(s, /fits 9 of 11 · within 3 h · about \$750 each/);
  assertMatch(s, /Don't ask a string of questions/);
  assertEquals((IDEA_TOOL.input_schema.properties as Any).ideas.maxItems, 3);
});

Deno.test('idea chat: the app’s context is cleaned again', () => {
  const c = ideaContextIn({ lists: { areas: ['<b>Hunter</b>', '', 'Kiama'] }, wishes: { answered: '9', cant: [{ fri: '2027-03-12', n: 5 }, { fri: 'bad' }], day_prefs: { fri: 'late' } }, idea: { fixed: { weekend: { start: '2027-03-12', end: '2027-03-14' }, nights: 99 } }, home: { lat: -33.8812, lng: 'x' } });
  assertEquals(c.lists!.areas, ['b Hunter /b', 'Kiama']);
  assertEquals(c.wishes!.answered, 9);
  assertEquals(c.wishes!.cant, [{ fri: '2027-03-12', n: 5 }]);
  assertEquals(c.fixed.nights, null);
  assertEquals(c.home, null);
  assertEquals(validateIdeaReply({ message: '', ideas: [] }).message, '');
});

Deno.test('fast model: AI_FAST_MODEL on the same provider and key, light thinking; not set → the usual model', () => {
  const env = (o: Record<string, string>) => (k: string) => o[k];
  const a = aiConfig(env({ AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_API_KEY: 'k', AI_MODEL: 'moonshotai/kimi-k2.6' }));
  assert(a.ok);
  const cfgA = (a as Any).cfg as AiConfig;
  const f = fastConfig(env({ AI_FAST_MODEL: 'google/gemini-2.5-flash' }), cfgA);
  assertEquals(f.fast, true);
  assertEquals(f.cfg!.model, 'google/gemini-2.5-flash');
  assertEquals(f.cfg!.apiKey, 'k');
  assertEquals(f.cfg!.baseUrl, 'https://openrouter.ai/api/v1');
  assertEquals((requestBody(f.cfg!, { system: 's', tools: [], messages: [], maxTokens: 10 }) as Any).reasoning, { effort: 'low', exclude: true });
  // The usual model keeps medium thinking.
  assertEquals((requestBody(cfgA, { system: 's', tools: [], messages: [], maxTokens: 10 }) as Any).reasoning, { effort: 'medium', exclude: true });
  assertEquals(fastConfig(env({}), cfgA), { cfg: cfgA, fast: false });
  assertEquals(fastConfig(env({ AI_FAST_MODEL: 'has space' }), cfgA).cfg, cfgA);
  assertEquals(fastConfig(env({ AI_FAST_MODEL: 'x' }), null), { cfg: null, fast: false });
});
