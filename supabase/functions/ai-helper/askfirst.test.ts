// Deno tests for ov16 (22 Oct, after "too_many_rounds" twice on live): the planning chat asks first, never dead-ends,
// and wastes fewer rounds. Fake model, no network, no key.
import nodeAssert from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
const assertMatch = (s: string, re: RegExp) => nodeAssert.match(s, re);
import { helperRequest, runLoop, salvagePlan, emptyLookups, errTags, logDetail, stableJson, LIMITS, FINAL_RESERVE_MS, type Deps } from './logic.ts';
import { validatePlanChat, fallbackChat, wantsPlanNow, tripPageIn, CHAT_TOOL, CHAT_TOOLS } from './plan.ts';
import { requestBody, type AiConfig } from './providers.ts';

// deno-lint-ignore no-explicit-any
type Any = any;
const AI: AiConfig = { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'test-key-not-real', model: 'example-model-id', caps: { groupPerMonth: 60, personPerDay: 10 } };
const OA: AiConfig = { provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'test-key-not-real', model: 'example/model', caps: { groupPerMonth: 60, personPerDay: 10 } };
const K = '11111111-0000-4000-8000-000000000001';
const C = '11111111-0000-4000-8000-000000000002';
const M = '11111111-0000-4000-8000-000000000005';
const lib = { [K]: { id: K, name: 'Kurri Kurri Golf Club' }, [C]: { id: C, name: 'Cypress Lakes' }, [M]: { id: M, name: 'Mudgee Golf Club' } };
const tctx = { today: '2026-10-22', tasksOn: true, library: lib };

function fakeModel(turns: ((req: Any, n: number) => Any)[]) {
  const calls: Any[] = [];
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body));
    calls.push(req);
    const content = turns[Math.min(calls.length - 1, turns.length - 1)](req, calls.length);
    return new Response(JSON.stringify({ content, stop_reason: content.some((b: Any) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200 });
  }) as typeof fetch;
  return { fetchFn, calls };
}
const use = (id: string, name: string, input: Any = {}) => ({ type: 'tool_use', id, name, input });
const userText = (req: Any) => JSON.stringify(req.messages[0]);

function deps(fetchFn: typeof fetch, over: Partial<Deps> = {}) {
  const log: Any[] = [];
  const tools: Any[] = [];
  const d: Deps = {
    status: { is_member: true, is_admin: true, group_id: 'g1', group_name: 'L.G.C' },
    ai: AI, fetchFn, now: () => new Date('2026-10-22T03:00:00Z'), featureOn: async () => true,
    usage: async () => ({ month: 3, today: 1 }),
    logStart: async (row) => { log.push(row); return log.length; },
    logEnd: async (_id, row) => { log.push(row); },
    planContext: async () => ({ courses: [], library: {}, trips: [], today: '2026-10-22', sideComps: true }),
    setupTool: async () => [], history: async () => ({}) as Any,
    applyDb: { insertTrip: async () => 'x', copyLibraryCourse: async () => 'x', insertRound: async () => {} },
    tripPlanContext: async () => tctx,
    planTool: async (name, input) => {
      tools.push([name, input]);
      if (name !== 'courses_near') return [];
      const one = (p: string) => (/mudgee/i.test(p) ? { near: p, courses: [{ id: M, name: 'Mudgee Golf Club', km: 2 }] } : /hunter/i.test(p) ? { near: p, courses: [{ id: K, name: 'Kurri Kurri Golf Club', km: 3 }, { id: C, name: 'Cypress Lakes', km: 20 }] } : { near: p, courses: [], note: 'Nothing in the course library there yet.' });
      return Array.isArray(input.places) ? { results: input.places.map(one) } : one(input.place);
    },
    planDb: { insertPlan: async () => 'p', startVotes: async () => {}, insertItems: async () => {}, rsvpIn: async () => {}, post: async () => {} },
    libraryInfo: async () => ({ courses: 3, more: false }),
    ...over,
  };
  return { d, log, tools };
}

const QUESTIONS = [
  { id: 'when', text: 'Which month or weekends?', quick: ['March', 'April', 'Other…'] },
  { id: 'where', text: 'How far will you travel?', quick: ['Under 2 hrs', 'Up to 3 hrs'] },
];
const DRAFT = {
  name: 'March Away', kind: 'trip',
  dates: [{ start_date: '2027-03-12', end_date: '2027-03-14' }, { start_date: '2027-03-19', end_date: '2027-03-21' }],
  places: [{ place: 'Hunter Valley', courses: [K, C] }, { place: 'Mudgee', courses: [M] }],
};

// ------------------------------------------------------------------ 1. Ask first
Deno.test('a vague first message → a short reply with questions and no plan; the prompt and tool say ask first', async () => {
  const model = fakeModel([() => [use('t1', 'reply_with_draft', { message: 'Got it — a golf weekend away. A couple of quick ones first:', questions: QUESTIONS })]]);
  const { d, tools } = deps(model.fetchFn);
  const out: Any = await helperRequest({ mode: 'plan_chat', text: 'Golf trip next year' }, d);
  assert(out.chat, JSON.stringify(out));
  assertEquals(out.chat.draft, null);
  assertEquals(out.chat.summary, []);
  assertEquals(out.chat.questions.map((q: Any) => q.id), ['when', 'where']);
  assertEquals(tools.length, 0); // no course searches on a vague first message
  assertEquals(model.calls.length, 1);
  const req = model.calls[0];
  assertMatch(req.system, /ASK FIRST/);
  assertMatch(req.system, /plan it/);
  assertMatch(req.system, /like a mate/);
  assertMatch(userText(req), /first message/);
  assertMatch(userText(req), /course_library/); // the library's size, so it doesn't keep searching
  assertMatch(userText(req), /Only 3 courses/);
  // The tool's shape: a draft is optional, questions are not.
  assertEquals(CHAT_TOOL.input_schema.required, ['message', 'questions']);
});

Deno.test('follow-up answers → the draft is built (all places looked up in ONE search)', async () => {
  const model = fakeModel([
    () => [use('t1', 'courses_near', { places: ['Hunter Valley', 'Mudgee'] })],
    (req) => {
      assertMatch(JSON.stringify(req.messages.at(-1)), /Kurri Kurri/);
      return [use('t2', 'reply_with_draft', { message: 'Here are some options — want to add any?', draft: DRAFT, questions: [{ text: 'Budget about $800 each?', quick: ['Yes', 'Less', 'More'] }] })];
    },
  ]);
  const { d, tools } = deps(model.fetchFn);
  const out: Any = await helperRequest({ mode: 'plan_chat', text: 'March, 12 of us, within 3 hours of Sydney', messages: [{ role: 'user', text: 'Golf trip next year' }, { role: 'assistant', text: 'Which month?' }] }, d);
  assertEquals(out.chat.draft.places.map((p: Any) => p.label), ['Hunter Valley', 'Mudgee']);
  assert(out.chat.summary.length > 0);
  assertEquals(tools.length, 1);
  assert(!/first message/.test(userText(model.calls[0])));
  const near = CHAT_TOOLS.find((t) => t.name === 'courses_near')!;
  assert('places' in near.input_schema.properties);
});

Deno.test('"plan it" stops the questions: the helper is told to build the draft now', async () => {
  for (const t of ['plan it', 'Just plan it mate', 'just suggest something', 'surprise us', 'enough questions']) assert(wantsPlanNow(t), t);
  for (const t of ['planning a trip in March', 'who is coming?']) assert(!wantsPlanNow(t), t);
  const model = fakeModel([() => [use('t1', 'reply_with_draft', { message: 'Here are some options', draft: DRAFT, questions: QUESTIONS })]]);
  await helperRequest({ mode: 'plan_chat', text: 'Plan it', messages: [{ role: 'user', text: 'Golf trip' }] }, deps(model.fetchFn).d);
  assertMatch(userText(model.calls[0]), /said to plan it now/);
});

Deno.test('driving or flying: asked early; flying is kept as a note on the draft (not planned yet)', () => {
  const sys = (CHAT_TOOL.input_schema.properties.draft as Any).properties.travel;
  assertEquals(sys.enum, ['drive', 'fly']);
  const v = validatePlanChat({ message: 'Flying trips are coming soon — want a driving one now?', draft: { name: 'Fly away', travel: 'fly', notes: 'Keen on a flying trip — coming soon' }, questions: [{ text: 'Plan a driving trip now?', quick: ['Yes', 'Keep the idea'] }] }, tctx);
  assert(v.ok, v.errors.join(' '));
  assertEquals(v.value!.draft!.travel, 'fly');
  assertEquals(validatePlanChat({ message: 'x', draft: { ...DRAFT, travel: 'boat' }, questions: QUESTIONS }, tctx).value!.draft!.travel, null);
});

Deno.test('never a dead-end "done": there is always a question to keep refining', () => {
  const v = validatePlanChat({ message: 'Looks good!', draft: DRAFT, questions: [], done: true }, tctx);
  assert(v.ok);
  assertEquals(v.value!.done, true);
  assertEquals(v.value!.questions.length, 1);
  assertMatch(v.value!.questions[0].text, /tweak/);
});

Deno.test('what the organiser changed on the trip screen goes to the helper as data', async () => {
  assertEquals(tripPageIn(null), null);
  assertEquals(tripPageIn({ areas: [] }), null);
  const page = tripPageIn({ areas: [{ area: 'Hunter Valley', courses: ['Kurri Kurri', { name: 'Cypress <b>Lakes</b>' }], stays: ['Cessnock'] }], weekends: ['13–15 Mar'], nights: 2, headcount: 12, chosen_area: 'Hunter Valley' })!;
  assertEquals(page.areas[0].courses.length, 2);
  assert(!JSON.stringify(page).includes('<b>'));
  const model = fakeModel([() => [use('t1', 'reply_with_draft', { message: 'Hi', questions: QUESTIONS })]]);
  await helperRequest({ mode: 'plan_chat', text: 'Swap a course', messages: [{ role: 'user', text: 'x' }], page: { areas: [{ area: 'Hunter Valley', courses: ['Kurri Kurri'] }] } }, deps(model.fetchFn).d);
  assertMatch(userText(model.calls[0]), /trip_page/);
});

// ------------------------------------------------------------------ 2. Never dead-end
Deno.test('the same problem twice → the draft comes back with the bad part left out (and a question), not too_many_rounds', async () => {
  const bad = { message: 'Options', draft: { ...DRAFT, dates: [{ start_date: '2019-03-12', end_date: '2019-03-14' }, ...DRAFT.dates] }, questions: QUESTIONS };
  const model = fakeModel([() => [use(`t${Math.random()}`, 'reply_with_draft', bad)]]);
  const { d, log } = deps(model.fetchFn);
  const out: Any = await helperRequest({ mode: 'plan_chat', text: 'March, 12, Hunter or Mudgee', messages: [{ role: 'user', text: 'x' }] }, d);
  assertEquals(model.calls.length, 2); // once to fix, then left out
  assertEquals(out.code, undefined);
  assertEquals(out.chat.draft.dates.length, 2);
  assertMatch(out.chat.draft.warnings.join(' '), /left out/);
  assert(out.chat.questions.length >= 1);
  assertMatch(log.at(-1).error, /^salvaged r2 past/);
});

Deno.test('the last round forces the reply tool (Anthropic: tool_choice; OpenAI-style: only that tool offered)', async () => {
  // A model that would search forever: a new place each time, until it's made to reply.
  const model = fakeModel([(req, n) => (req.tool_choice ? [use('last', 'reply_with_draft', { message: 'I couldn’t find courses near Orange in our list.', draft: DRAFT, questions: QUESTIONS })] : [use(`s${n}`, 'courses_near', { places: [`Town ${n}`] })])]);
  const { d, log } = deps(model.fetchFn);
  const out: Any = await helperRequest({ mode: 'plan_chat', text: 'Somewhere in NSW', messages: [{ role: 'user', text: 'x' }] }, d);
  assertEquals(model.calls.length, LIMITS.chatToolRounds);
  assertEquals(model.calls.at(-1).tool_choice, { type: 'tool', name: 'reply_with_draft' });
  assertEquals(model.calls[0].tool_choice, undefined);
  assertMatch(JSON.stringify(model.calls.at(-1).messages.at(-1)), /last turn/);
  assert(out.chat);
  assertEquals(log.at(-1).error, null); // a proper answer: counted as usual
  const body: Any = requestBody(OA, { system: 's', tools: CHAT_TOOLS as Any, messages: [{ role: 'user', text: 'q' }], maxTokens: 10, force: 'reply_with_draft' });
  assertEquals(body.tools.map((t: Any) => t.function.name), ['reply_with_draft']);
  assertEquals(body.tool_choice, 'auto');
});

Deno.test('a model that ignores the last-round push → "I got stuck finding …" with a question, keeping the draft', async () => {
  const model = fakeModel([(_req, n) => [use(`s${n}`, 'courses_near', { places: [n % 2 ? 'Orange' : 'Bathurst', `Nowhere ${n}`] })]]);
  const { d, log } = deps(model.fetchFn);
  const draft = { name: 'March', places: [{ label: 'Hunter Valley', courses: [K] }], dates: [] };
  const out: Any = await helperRequest({ mode: 'plan_chat', text: 'Add Orange', messages: [{ role: 'user', text: 'x' }], draft }, d);
  assertEquals(out.code, undefined);
  assertMatch(out.chat.message, /^I got stuck finding courses near Orange, Nowhere 1 or Bathurst/);
  assertEquals(out.chat.draft.places.map((p: Any) => p.label), ['Hunter Valley']);
  assertEquals(out.chat.questions[0].id, 'where');
  assertMatch(log.at(-1).error, /^stuck r\d+/);
  // Nothing found at all and no draft yet → the basics question.
  assertMatch(fallbackChat({ draft: null, missing: [] }).questions[0].text, /when, where and how many/);
});

Deno.test('the deadline near → the next call is the last one (forced), not a timeout', async () => {
  let t = 0;
  const fetchFn = fakeModel([(req) => (req.tool_choice ? [use('z', 'reply_with_draft', { message: 'Here you go', questions: QUESTIONS })] : [use(`a${t}`, 'courses_near', { place: `P${t}` })])]);
  const r = await runLoop({
    ai: AI, fetchFn: fetchFn.fetchFn, system: 's', tools: CHAT_TOOLS, allowed: new Set(CHAT_TOOLS.map((x) => x.name)), userText: 'q',
    exec: async () => { t += 1; return { courses: [] }; },
    stopTool: 'reply_with_draft', forceFinal: true,
    onStop: async (input) => { const v = validatePlanChat(input, tctx); return v.ok ? { ok: true, value: v.value } : { ok: false, errors: v.errors }; },
    deadline: 100000, now: () => (fetchFn.calls.length >= 2 ? 100000 - FINAL_RESERVE_MS + 1 : 0),
  });
  assertEquals(r.kind, 'stop');
  assertEquals(fetchFn.calls.length, 3);
  assertEquals(r.info!.ended, 'final_stop');
});

// ------------------------------------------------------------------ 3. Fewer wasted rounds
Deno.test('the same tool call twice is answered from the first lookup, with a note', async () => {
  const model = fakeModel([
    () => [use('a', 'courses_near', { places: ['Mudgee'] })],
    () => [use('b', 'courses_near', { places: ['Mudgee'] })],
    (req) => {
      assertMatch(JSON.stringify(req.messages.at(-1)), /already asked exactly this/);
      return [use('c', 'reply_with_draft', { message: 'Options', draft: DRAFT, questions: QUESTIONS })];
    },
  ]);
  const { d, tools } = deps(model.fetchFn);
  const out: Any = await helperRequest({ mode: 'plan_chat', text: 'Mudgee in March, 12 of us', messages: [{ role: 'user', text: 'x' }] }, d);
  assert(out.chat);
  assertEquals(tools.length, 1);
  assertEquals(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] }), stableJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
});

Deno.test('empty lookups are noted (one place or several); log detail fits 40 characters', () => {
  assertEquals(emptyLookups('courses_near', { places: ['Orange', 'Hunter'] }, { results: [{ near: 'Orange', courses: [] }, { near: 'Hunter', courses: [{ id: K }] }] }), ['Orange']);
  assertEquals(emptyLookups('courses_near', { place: 'Orange' }, { near: 'Orange', courses: [] }), ['Orange']);
  assertEquals(emptyLookups('find_course', { query: 'Kurri' }, []), ['Kurri']);
  assertEquals(emptyLookups('our_players', {}, []), []);
  assertEquals(errTags(['Date option 1: that’s in the past.', 'Course x isn’t in your courses or the course library.']), ['past', 'course']);
  const s = logDetail('too_many_rounds', { rounds: 10, ended: 'x', errs: ['Date option 1: that’s in the past.', 'At most 4 place options.', 'Place option 2 needs a name.', 'Round 1: hole 30 isn’t a hole from 1 to 18.'], repeats: 3, missing: ['a', 'b'] });
  assert(s.length <= 40, s);
  assertMatch(s, /^too_many_rounds r10 x3 past/);
});

Deno.test('setup: a course that keeps failing is left out (with a warning), the rest goes ahead', () => {
  const KURRI = '11111111-0000-4000-8000-000000000001';
  const GHOST = '99999999-0000-4000-8000-000000000009';
  const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: i % 5 === 1 ? 3 : 4, si: i + 1 }));
  const ctx = { courses: [], library: { [KURRI]: { id: KURRI, name: 'Kurri Kurri Golf Club', holes } }, trips: [], today: '2026-10-21', sideComps: true };
  const raw = { trip: { name: 'Hunter 2026', start_date: '2026-10-23', end_date: '2026-10-24' }, courses: [KURRI, GHOST], rounds: [{ date: '2026-10-23', course: KURRI, format: 'stableford' }, { date: '2026-10-24', course: GHOST, format: 'stableford' }] };
  const v = salvagePlan(raw, ctx);
  assert(v.ok, v.errors.join(' '));
  assertEquals(v.plan!.rounds.length, 1);
  assertMatch(v.plan!.warnings.join(' '), /One round was left out/);
  assertEquals(salvagePlan({ ...raw, rounds: [raw.rounds[1]] }, ctx).ok, false);
});
