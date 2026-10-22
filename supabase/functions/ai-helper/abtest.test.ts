// Deno tests for the A/B model test (abtest.ts): who gets which model, model B's set-up from the secrets, the
// fallback to A when B has a provider error, and that the usage log gets the variant and model.
// Run: deno test supabase/functions/ai-helper/abtest.test.ts  (no network, no real keys)
import nodeAssert from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
import { abFetch, abSetup, abVariant, costOf, fromBody, hash32, pickAi, toProviderJson } from './abtest.ts';
import { callModel, requestBody, type AiConfig, type Msg } from './providers.ts';
import { helperRequest, type Deps } from './logic.ts';

// deno-lint-ignore no-explicit-any
type Any = any;
const A: AiConfig = { provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'key-a-not-real', model: 'vendor/model-a', caps: { groupPerMonth: 60, personPerDay: 10 } };
const env = (o: Record<string, string>) => (k: string) => o[k];
const uid = (i: number) => `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

Deno.test('variant: stable per person, split respected, 0% and 100%', () => {
  assertEquals(hash32('abc'), hash32('abc'));
  for (let i = 0; i < 50; i++) assertEquals(abVariant(uid(i), 'ab1', 50), abVariant(uid(i), 'ab1', 50));
  const onB = (pct: number, salt = 'ab1') => Array.from({ length: 2000 }, (_, i) => abVariant(uid(i), salt, pct)).filter((v) => v === 'B').length;
  assertEquals(onB(0), 0);
  assertEquals(onB(100), 2000);
  const half = onB(50);
  assert(half > 900 && half < 1100, `about half on B (${half})`);
  const thirty = onB(30);
  assert(thirty > 500 && thirty < 700, `about 30% on B (${thirty})`);
  // A new salt shuffles people.
  const moved = Array.from({ length: 200 }, (_, i) => abVariant(uid(i), 'ab1', 50) !== abVariant(uid(i), 'ab2', 50)).filter(Boolean).length;
  assert(moved > 60, 'a new test (salt) shuffles people');
});

Deno.test('model B from the secrets: defaults to A’s provider, address and key; split 50 by default', () => {
  const none = abSetup(env({}), A);
  assertEquals([none.b, none.split, none.salt], [null, 0, 'ab1']);
  const s = abSetup(env({ AI_MODEL_B: 'vendor/model-b' }), A);
  assertEquals(s.b, { ...A, model: 'vendor/model-b' });
  assertEquals(s.split, 50);
  const t = abSetup(env({ AI_MODEL_B: 'claude-x', AI_PROVIDER_B: 'anthropic', AI_API_KEY_B: 'key-b', AI_AB_SPLIT: '20', AI_AB_SALT: 'kimi-vs-claude' }), A);
  assertEquals([t.b?.provider, t.b?.baseUrl, t.b?.apiKey, t.split, t.salt], ['anthropic', 'https://api.anthropic.com/v1', 'key-b', 20, 'kimi-vs-claude']);
  assertEquals(abSetup(env({ AI_MODEL_B: 'm', AI_AB_SPLIT: '250' }), A).split, 100);
  // Bad set-ups: B stays off, A for everyone, a reason for the log (never the key).
  for (const bad of [{ AI_MODEL_B: 'has space' }, { AI_MODEL_B: 'm', AI_PROVIDER_B: 'google' }, { AI_MODEL_B: 'm', AI_BASE_URL_B: 'http://insecure' }, { AI_MODEL_B: 'm', AI_PROVIDER_B: 'openai', AI_BASE_URL_B: '' }]) {
    const r = abSetup(env(bad as Record<string, string>), { ...A, provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' });
    if ((bad as Any).AI_PROVIDER_B === 'openai') { assert(r.b === null && /AI_BASE_URL_B/.test(r.reason!), 'openai B needs an address'); continue; }
    assert(r.b === null && r.split === 0 && !!r.reason && !r.reason.includes('key'), JSON.stringify(bad));
  }
  assertEquals(abSetup(env({ AI_MODEL_B: 'm' }), null).b, null);
  // Prices (US$ per million tokens) → a rough cost.
  const p = abSetup(env({ AI_PRICE_IN: '0.5', AI_PRICE_OUT: '2', AI_PRICE_IN_B: '3', AI_PRICE_OUT_B: '15' }), A).prices;
  assertEquals(costOf(p.A, 10000, 1000), 0.007);
  assertEquals(costOf(p.B, 10000, 1000), 0.045);
  assertEquals(costOf(null, 10000, 1000), null);
});

Deno.test('each person gets their own variant; people on A never get the wrapped fetch', () => {
  const s = abSetup(env({ AI_MODEL_B: 'vendor/model-b' }), A);
  let sawA = false, sawB = false;
  for (let i = 0; i < 40; i++) {
    const p = pickAi(s, uid(i), fetch);
    assertEquals(p.variant, abVariant(uid(i), 'ab1', 50));
    assertEquals(p.ai?.model, p.variant === 'B' ? 'vendor/model-b' : 'vendor/model-a');
    assertEquals(p.startCols(), { variant: p.variant, ab_test: 'ab1' });
    if (p.variant === 'A') { sawA = true; assert(p.fetchFn === fetch, 'A: plain fetch'); } else sawB = true;
  }
  assert(sawA && sawB, 'both variants turn up');
  // No B set: everyone is A.
  const none = abSetup(env({}), A);
  for (let i = 0; i < 20; i++) assertEquals(pickAi(none, uid(i), fetch).variant, 'A');
});

const okOpenAi = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { status: 200 });
const msgs: Msg[] = [{ role: 'user', text: 'Who won in 2024?' }];

Deno.test('B has a provider error → the same call goes once to A (same provider), fallback logged', async () => {
  const B: AiConfig = { ...A, model: 'vendor/model-b' };
  for (const failure of [
    () => new Response('busy', { status: 503 }),
    () => new Response(JSON.stringify({ error: { code: 402, message: 'no credit' } }), { status: 200 }),
    () => { throw new TypeError('network down'); },
  ]) {
    const sent: Any[] = [];
    let fell = false;
    const f = abFetch(B, A, (async (url: string, init: Any) => {
      sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
      if (JSON.parse(init.body).model === 'vendor/model-b') return failure();
      return okOpenAi('Kurt won.');
    }) as unknown as typeof fetch, () => { fell = true; });
    const r = await callModel(B, { system: 'sys', tools: [], messages: msgs, maxTokens: 100 }, f, 5000);
    assert(r.ok && r.reply.text === 'Kurt won.', 'A answered');
    assertEquals(sent.map((s) => s.body.model), ['vendor/model-b', 'vendor/model-a']);
    assertEquals(sent[1].body.messages, sent[0].body.messages);
    assert(fell, 'fallback noted');
  }
  // B fine → no second call.
  const sent: string[] = [];
  const f = abFetch(B, A, (async (_u: string, init: Any) => { sent.push(JSON.parse(init.body).model); return okOpenAi('B here'); }) as unknown as typeof fetch, () => { throw new Error('no fallback'); });
  const r = await callModel(B, { system: 'sys', tools: [], messages: msgs, maxTokens: 100 }, f, 5000);
  assert(r.ok && r.reply.text === 'B here');
  assertEquals(sent, ['vendor/model-b']);
});

Deno.test('fallback across providers: B (Anthropic) fails, A (OpenAI-style) answers, reply read as B', async () => {
  const B: AiConfig = { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'key-b', model: 'claude-b', caps: A.caps };
  const tools = [{ name: 'who_won', description: 'd', input_schema: { type: 'object', properties: {} } }];
  const conversation: Msg[] = [
    { role: 'user', text: 'Who won?' },
    { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'who_won', input: { year: 2024 } }] },
    { role: 'tool', results: [{ id: 'c1', name: 'who_won', content: '<data>Kurt</data>' }] },
  ];
  const sent: Any[] = [];
  const f = abFetch(B, A, (async (url: string, init: Any) => {
    sent.push({ url, body: JSON.parse(init.body) });
    if (url.includes('anthropic')) return new Response('down', { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'who_won', arguments: '{"year":2023}' } }] } }], usage: { prompt_tokens: 50, completion_tokens: 5 } }), { status: 200 });
  }) as unknown as typeof fetch, () => {});
  const r = await callModel(B, { system: 'sys', tools, messages: conversation, maxTokens: 100 }, f, 5000);
  assert(r.ok, 'answered');
  if (!r.ok) return;
  assertEquals(r.reply.calls.map((c) => [c.name, c.input]), [['who_won', { year: 2023 }]]);
  assertEquals(r.reply.usage, { input_tokens: 50, output_tokens: 5 });
  assertEquals(sent[1].url, 'https://openrouter.ai/api/v1/chat/completions');
  assertEquals(sent[1].body.model, 'vendor/model-a');
  // A got the same conversation, in its own format.
  assertEquals(sent[1].body, requestBody(A, { system: 'sys', tools, messages: conversation, maxTokens: 100 }));
});

Deno.test('fromBody is the inverse of requestBody (both formats, photos and tool errors too)', () => {
  const tools = [{ name: 't', description: 'd', input_schema: { type: 'object', properties: { q: { type: 'string' } } } }];
  const messages: Msg[] = [
    { role: 'user', text: 'Read this', images: ['data:image/png;base64,AAAA'] },
    { role: 'assistant', text: 'Looking', calls: [{ id: 'x1', name: 't', input: { q: 'a' } }, { id: 'x2', name: 't', input: {} }] },
    { role: 'tool', results: [{ id: 'x1', name: '', content: 'one' }, { id: 'x2', name: '', content: 'bad', is_error: true }] },
  ];
  for (const provider of ['openai', 'anthropic'] as const) {
    const cfg = { ...A, provider };
    const o = { system: 'sys', tools, messages, maxTokens: 321 };
    assertEquals(fromBody(provider, requestBody(cfg, o)), o);
  }
  const reply = { text: 'hi', calls: [{ id: 'q', name: 't', input: { q: 'z' } }], usage: { input_tokens: 1, output_tokens: 2 } };
  assertEquals(toProviderJson('anthropic', reply).content[1], { type: 'tool_use', id: 'q', name: 't', input: { q: 'z' } });
  assertEquals(toProviderJson('openai', reply).usage, { prompt_tokens: 1, completion_tokens: 2 });
});

Deno.test('a person on B: the question goes to B, and the usage log gets variant B, B’s model and the fallback', async () => {
  const s = abSetup(env({ AI_MODEL_B: 'vendor/model-b', AI_AB_SPLIT: '100', AI_PRICE_IN_B: '1', AI_PRICE_OUT_B: '1' }), A);
  const run = async (failB: boolean) => {
    const pick = pickAi(s, uid(7), (async (_u: string, init: Any) => {
      if (failB && JSON.parse(init.body).model === 'vendor/model-b') return new Response('', { status: 429 });
      return okOpenAi('Kurt won in 2024.');
    }) as unknown as typeof fetch);
    const log: Any[] = [];
    const d = {
      status: { is_member: true, is_admin: false, group_id: 'g1', group_name: 'L.G.C', role: 'player' },
      ai: pick.ai, fetchFn: pick.fetchFn, now: () => new Date('2026-10-22T03:00:00Z'),
      featureOn: async () => true, usage: async () => ({ month: 1, today: 1 }),
      logStart: async (row: Any) => { log.push({ ...row, ...pick.startCols() }); return 5; },
      logEnd: async (_id: Any, row: Any) => { log.push({ ...row, ...pick.endCols(row) }); },
    } as unknown as Deps;
    const out = await helperRequest({ mode: 'history', text: 'Who won in 2024?' }, d);
    return { out, log };
  };
  const ok = await run(false);
  assertEquals(ok.out.answer, 'Kurt won in 2024.');
  assertEquals([ok.log[0].variant, ok.log[0].model, ok.log[0].ab_test], ['B', 'vendor/model-b', 'ab1']);
  assertEquals([ok.log[1].ok, ok.log[1].fallback, ok.log[1].cost], [true, false, 0.000012]);
  const fb = await run(true);
  assertEquals(fb.out.answer, 'Kurt won in 2024.');
  assertEquals([fb.log[0].variant, fb.log[1].ok, fb.log[1].fallback], ['B', true, true]);
});

Deno.test('live commentary and running jokes (cron, no person) always use model A', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  const lines = src.split('\n').filter((l) => /commentaryRequest\(|jokesRequest\(/.test(l) && !/^import/.test(l));
  assert(lines.length >= 2, 'found the cron calls');
  for (const l of lines) assert(l.includes('AI.ok ? AI.cfg : null') && !/pickAi|\bab\./.test(l), `uses A: ${l.trim().slice(0, 80)}`);
  // And the person's model comes from pickAi in makeDeps.
  assert(/const ab = pickAi\(AB, uid, fetch\)/.test(src) && /ai: ab\.ai,/.test(src) && /fetchFn: ab\.fetchFn,/.test(src), 'makeDeps uses the person’s variant');
});
