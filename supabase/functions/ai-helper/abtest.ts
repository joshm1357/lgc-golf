// ai-helper — A/B testing two AI models on real people (22 Oct 2026, migration 075).
//
// Josh: "build for an A/B testing for different models". Model A is the usual one (AI_PROVIDER / AI_BASE_URL /
// AI_API_KEY / AI_MODEL). Model B is switched on by more Supabase secrets (never in code):
//   AI_MODEL_B      B's model id. Not set: no test, everyone gets A.
//   AI_PROVIDER_B, AI_BASE_URL_B, AI_API_KEY_B — optional; each one not set is the same as A's.
//   AI_AB_SPLIT     % of PEOPLE on B (0–100). Default 50 when AI_MODEL_B is set.
//   AI_AB_SALT      the test's name (default 'ab1'). Change it to start a fresh test: people are shuffled again and
//                   Josh's results only count rows from the new test.
//   AI_PRICE_IN, AI_PRICE_OUT (and AI_PRICE_IN_B, AI_PRICE_OUT_B) — optional, US$ per million tokens, for a rough cost.
//
// Each PERSON gets a stable variant (a hash of their user id and the salt), so they see the same model all through
// a test. Ask, Plan it with AI, Set it up for me, Bring your history and the Caddie use it (anything built with
// makeDeps in index.ts). Live commentary and running jokes are cron jobs with no person, so they always use A.
// If B fails with a provider error, the same call is sent once to A instead (logged as fallback = true), so
// trying a flaky model never leaves anyone without an answer.
//
// The fallback works underneath callModel (providers.ts), as a wrapped fetch: it reads the request B was sent,
// rebuilds it for A and, if A speaks a different format, turns A's reply back into B's format. That keeps the
// question loops (logic.ts, import.ts and the Caddie) unchanged.
import {
  ANTHROPIC_BASE, endpoint, headers, parseReply, readArgs, requestBody,
  type AiConfig, type Call, type Msg, type Provider, type Reply, type ToolDef, type ToolResult,
} from './providers.ts';

// deno-lint-ignore no-explicit-any
type Any = any;
export type Variant = 'A' | 'B';
export const DEFAULT_SALT = 'ab1';

// ------------------------------------------------------------------ Who gets which model

/** FNV-1a: a small, fast, stable 32-bit hash (the same answer on every server, forever). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A person's variant: 'B' for about `splitPct`% of people, the same answer every time for the same id and salt. */
export function abVariant(userId: string, salt: string, splitPct: number): Variant {
  const p = Number(splitPct);
  if (!Number.isFinite(p) || p <= 0 || !userId) return 'A';
  if (p >= 100) return 'B';
  return hash32(`${salt || DEFAULT_SALT}:${String(userId).toLowerCase()}`) % 100 < p ? 'B' : 'A';
}

// ------------------------------------------------------------------ The secrets

export type Prices = { in: number; out: number } | null;
export type AbSetup = {
  a: AiConfig | null;
  b: AiConfig | null;
  split: number; // % of people on B (0 when there's no B)
  salt: string; // the test's name
  prices: { A: Prices; B: Prices };
  reason?: string; // why B isn't on, for the function's log (never a key)
};

const num = (v: string | undefined) => {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const prices = (i: string | undefined, o: string | undefined): Prices => {
  const pi = num(i);
  const po = num(o);
  return pi == null && po == null ? null : { in: pi ?? 0, out: po ?? 0 };
};

/** Model B and the split, from the secrets. `a` is model A's set-up (aiConfig). Never throws. */
export function abSetup(get: (k: string) => string | undefined, a: AiConfig | null): AbSetup {
  const s = (k: string) => String(get(k) ?? '').trim();
  const salt = (s('AI_AB_SALT') || DEFAULT_SALT).slice(0, 40);
  const out: AbSetup = {
    a, b: null, split: 0, salt,
    prices: { A: prices(get('AI_PRICE_IN'), get('AI_PRICE_OUT')), B: prices(get('AI_PRICE_IN_B'), get('AI_PRICE_OUT_B')) },
  };
  const model = s('AI_MODEL_B');
  if (!model) return out;
  if (!a) return { ...out, reason: 'AI_MODEL_B is set but model A isn’t set up' };
  if (model.length > 80 || /\s/.test(model)) return { ...out, reason: 'AI_MODEL_B doesn’t look like a model id' };
  const p = s('AI_PROVIDER_B').toLowerCase();
  if (p && p !== 'openai' && p !== 'anthropic') return { ...out, reason: 'AI_PROVIDER_B must be openai or anthropic' };
  const provider = (p || a.provider) as Provider;
  const baseUrl = (s('AI_BASE_URL_B') || (provider === a.provider ? a.baseUrl : provider === 'anthropic' ? ANTHROPIC_BASE : '')).replace(/\/+$/, '');
  if (!baseUrl) return { ...out, reason: 'AI_BASE_URL_B is not set' };
  if (!/^https:\/\/[^\s/]+/i.test(baseUrl)) return { ...out, reason: 'AI_BASE_URL_B must start with https://' };
  const apiKey = s('AI_API_KEY_B') || a.apiKey;
  const splitRaw = num(get('AI_AB_SPLIT'));
  const split = splitRaw == null ? 50 : Math.min(100, Math.round(splitRaw));
  return { ...out, b: { provider, baseUrl, apiKey, model, caps: a.caps }, split };
}

// ------------------------------------------------------------------ One person's model, with the fallback

export type AbPick = {
  variant: Variant;
  test: string;
  ai: AiConfig | null;
  fetchFn: typeof fetch;
  /** Set when B failed and A answered instead (at least once during this request). */
  state: { fallback: boolean };
  /** Extra helper_log columns when the row is made. */
  startCols: () => { variant: Variant; ab_test: string };
  /** Extra helper_log columns when the row is finished. */
  endCols: (row: { input_tokens?: number; output_tokens?: number }) => { fallback: boolean; cost?: number };
};

/** Rough cost in US$ for these tokens (null when no prices are set). */
export function costOf(p: Prices, inTok: number, outTok: number): number | null {
  if (!p) return null;
  return Math.round(((Number(inTok) || 0) * p.in + (Number(outTok) || 0) * p.out)) / 1e6;
}

/** The model this person gets for this request, and a fetch that falls back to A if B has a provider error. */
export function pickAi(setup: AbSetup, userId: string, fetchFn: typeof fetch): AbPick {
  const variant: Variant = setup.b && setup.a ? abVariant(userId, setup.salt, setup.split) : 'A';
  const state = { fallback: false };
  const ai = variant === 'B' ? setup.b : setup.a;
  const f = variant === 'B' && setup.a && setup.b ? abFetch(setup.b, setup.a, fetchFn, () => { state.fallback = true; }) : fetchFn;
  return {
    variant, test: setup.salt, ai, fetchFn: f, state,
    startCols: () => ({ variant, ab_test: setup.salt }),
    endCols: (row) => {
      const c = costOf(setup.prices[variant], row.input_tokens ?? 0, row.output_tokens ?? 0);
      return { fallback: state.fallback, ...(c != null && (row.input_tokens || row.output_tokens) ? { cost: c } : {}) };
    },
  };
}

/** True when a reply from the provider is really an error (an HTTP failure, or an error inside a 200). */
async function isProviderError(res: Response): Promise<boolean> {
  if (!res.ok) return true;
  const j = await res.clone().json().catch(() => null);
  return !j || typeof j !== 'object' || !!j.error || !!j.choices?.[0]?.error;
}

/**
 * A fetch for people on B: calls to B's endpoint that fail (network, HTTP error, or an error inside a 200) are sent
 * once to A instead, rebuilt for A's provider. Anything else passes straight through. A timeout isn't retried (the
 * question has already used its time).
 */
export function abFetch(b: AiConfig, a: AiConfig, fetchFn: typeof fetch, onFallback: () => void): typeof fetch {
  const bUrl = endpoint(b);
  return (async (input: Any, init?: Any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (url !== bUrl || typeof init?.body !== 'string') return fetchFn(input, init);
    let failed = false;
    let res: Response | null = null;
    try {
      res = await fetchFn(input, init);
      failed = await isProviderError(res);
    } catch (e) {
      if (init?.signal?.aborted) throw e;
      failed = true;
    }
    if (!failed && res) return res;
    let sent: Any;
    try { sent = JSON.parse(init.body); } catch { if (res) return res; throw new Error('network'); }
    // Keep a model chosen for the job (e.g. the photo model in Bring your history); otherwise A's own model.
    const model = sent?.model && sent.model !== b.model ? String(sent.model) : a.model;
    const aCfg: AiConfig = { ...a, model };
    const o = fromBody(b.provider, sent);
    const body = JSON.stringify(requestBody(aCfg, o));
    await res?.body?.cancel().catch(() => {});
    onFallback();
    const res2 = await fetchFn(endpoint(aCfg), { method: 'POST', headers: headers(aCfg), body, signal: init?.signal });
    if (aCfg.provider === b.provider || !res2.ok) return res2;
    // A speaks another format: hand callModel a reply in B's format (it reads replies as B).
    const j = await res2.json().catch(() => null);
    const reply = j && !j.error ? parseReply(aCfg, j, body) : null;
    const back = reply ? toProviderJson(b.provider, reply) : (j && j.error ? { error: j.error } : {});
    return new Response(JSON.stringify(back), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

// ------------------------------------------------------------------ Turning a request back into the plain shape

/** The inverse of requestBody: a request in a provider's format → the helper's plain shape. */
export function fromBody(provider: Provider, body: Any): { system: string; tools: ToolDef[]; messages: Msg[]; maxTokens: number } {
  const maxTokens = Number(body?.max_tokens) || 1000;
  const msgs: Any[] = Array.isArray(body?.messages) ? body.messages : [];
  const messages: Msg[] = [];
  if (provider === 'anthropic') {
    const tools: ToolDef[] = (body?.tools || []).map((t: Any) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    for (const m of msgs) {
      const parts: Any[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : [];
      if (m.role === 'user') {
        const results = parts.filter((p) => p?.type === 'tool_result');
        if (results.length) {
          messages.push({ role: 'tool', results: results.map((r): ToolResult => ({ id: String(r.tool_use_id), name: '', content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? ''), ...(r.is_error ? { is_error: true } : {}) })) });
        } else {
          const images = parts.filter((p) => p?.type === 'image').map((p) => `data:${p.source?.media_type || 'image/jpeg'};base64,${p.source?.data || ''}`);
          const text = parts.filter((p) => p?.type === 'text').map((p) => String(p.text || '')).join('\n');
          messages.push({ role: 'user', text, ...(images.length ? { images } : {}) });
        }
      } else if (m.role === 'assistant') {
        const text = parts.filter((p) => p?.type === 'text').map((p) => String(p.text || '')).join('\n');
        const calls: Call[] = parts.filter((p) => p?.type === 'tool_use').map((p) => ({ id: String(p.id), name: String(p.name), input: p.input ?? {} }));
        messages.push({ role: 'assistant', text: text === '…' && calls.length ? '' : text, calls });
      }
    }
    return { system: String(body?.system ?? ''), tools, messages, maxTokens };
  }
  const tools: ToolDef[] = (body?.tools || []).map((t: Any) => ({ name: t.function?.name, description: t.function?.description, input_schema: t.function?.parameters }));
  let system = '';
  for (const m of msgs) {
    if (m.role === 'system') { system = String(m.content ?? ''); continue; }
    if (m.role === 'user') {
      if (Array.isArray(m.content)) {
        const text = m.content.filter((p: Any) => p?.type === 'text').map((p: Any) => String(p.text || '')).join('\n');
        const images = m.content.filter((p: Any) => p?.type === 'image_url').map((p: Any) => String(p.image_url?.url || ''));
        messages.push({ role: 'user', text, ...(images.length ? { images } : {}) });
      } else messages.push({ role: 'user', text: String(m.content ?? '') });
    } else if (m.role === 'assistant') {
      const calls: Call[] = (m.tool_calls || []).map((c: Any) => {
        const r = readArgs(c.function?.arguments);
        return { id: String(c.id), name: String(c.function?.name), input: r.ok ? r.value : {}, ...(r.ok ? {} : { bad: true, raw: String(c.function?.arguments ?? '') }) };
      });
      messages.push({ role: 'assistant', text: String(m.content ?? ''), calls });
    } else if (m.role === 'tool') {
      const content = String(m.content ?? '');
      const isErr = content.startsWith('Error: ');
      const r: ToolResult = { id: String(m.tool_call_id), name: '', content: isErr ? content.slice(7) : content, ...(isErr ? { is_error: true } : {}) };
      const last = messages[messages.length - 1];
      if (last?.role === 'tool') last.results.push(r);
      else messages.push({ role: 'tool', results: [r] });
    }
  }
  return { system, tools, messages, maxTokens };
}

/** A reply in the helper's plain shape → the JSON a provider would have sent (so callModel can read it as B). */
export function toProviderJson(provider: Provider, r: Reply): Any {
  if (provider === 'anthropic') {
    return {
      content: [
        ...(r.text ? [{ type: 'text', text: r.text }] : []),
        ...r.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input ?? {} })),
      ],
      usage: { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens },
    };
  }
  return {
    choices: [{
      message: {
        role: 'assistant', content: r.text,
        ...(r.calls.length ? { tool_calls: r.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) } : {}),
      },
    }],
    usage: { prompt_tokens: r.usage.input_tokens, completion_tokens: r.usage.output_tokens },
  };
}
