// ai-helper — talking to the AI model, whichever company runs it (21 Oct 2026, v2).
//
// One small adapter so the helper can use any provider Josh picks, chosen by Supabase secrets (never in code):
//   AI_PROVIDER   'openai'    — any OpenAI-compatible Chat Completions API with tools (function calling):
//                               Moonshot Kimi, OpenRouter, DeepSeek, Together, Groq, OpenAI…
//                 'anthropic' — Anthropic's Messages API.
//                 Not set: 'openai' if AI_BASE_URL is set, else 'anthropic' if ANTHROPIC_API_KEY is set.
//   AI_BASE_URL   e.g. https://api.moonshot.ai/v1 or https://openrouter.ai/api/v1 (Anthropic: optional)
//   AI_API_KEY    the provider's key (Anthropic: ANTHROPIC_API_KEY also works)
//   AI_MODEL      the provider's model id — check your provider's model list; it must support tools.
//   AI_GROUP_MONTHLY_CAP (default 60), AI_PERSON_DAILY_CAP (default 10)
//
// Inside the helper, a conversation is kept in one plain shape (Msg) and translated to each provider's own format
// just before the call. Cheap models are sloppier than big ones, so replies are read forgivingly: tool arguments
// as a JSON string or an object, broken JSON repaired once, missing ids made up, missing token counts estimated.
// No key, prompt or answer is ever logged.

// deno-lint-ignore no-explicit-any
type Any = any;

export type Provider = 'openai' | 'anthropic';
export type AiConfig = {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
  caps: { groupPerMonth: number; personPerDay: number };
};
export const DEFAULT_CAPS = { groupPerMonth: 60, personPerDay: 10 };
export const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

export type ToolDef = { name: string; description: string; input_schema: Any };
/** A tool call from the model. `bad` is set when its arguments couldn't be read even after a repair. */
export type Call = { id: string; name: string; input: Any; raw?: string; bad?: boolean };
export type ToolResult = { id: string; name: string; content: string; is_error?: boolean };
export type Msg =
  | { role: 'user'; text: string; images?: string[] } // images: data URLs (data:image/jpeg;base64,…) — import mode only
  | { role: 'assistant'; text: string; calls: Call[] }
  | { role: 'tool'; results: ToolResult[] };
export type Usage = { input_tokens: number; output_tokens: number; estimated?: boolean };
export type Reply = { text: string; calls: Call[]; usage: Usage };
export type CallResult = { ok: true; reply: Reply } | { ok: false; code: string; message: string };

const int = (v: string | undefined, dflt: number) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : dflt;
};

/**
 * Which provider, key, model and caps to use, from the secrets. `get` reads one secret (Deno.env.get in the
 * function). Never throws; says why it's not set up (for the function's log — the reason never includes a key).
 */
export function aiConfig(get: (k: string) => string | undefined): { ok: true; cfg: AiConfig } | { ok: false; reason: string } {
  const s = (k: string) => String(get(k) ?? '').trim();
  const explicit = s('AI_PROVIDER').toLowerCase();
  const base = s('AI_BASE_URL');
  const anthropicKey = s('ANTHROPIC_API_KEY');
  if (explicit && explicit !== 'openai' && explicit !== 'anthropic') return { ok: false, reason: 'AI_PROVIDER must be openai or anthropic' };
  const provider: Provider | null = (explicit as Provider) || (base ? 'openai' : anthropicKey ? 'anthropic' : null);
  if (!provider) return { ok: false, reason: 'No AI provider set (AI_BASE_URL + AI_API_KEY + AI_MODEL, or ANTHROPIC_API_KEY + AI_MODEL)' };
  const baseUrl = (base || (provider === 'anthropic' ? ANTHROPIC_BASE : '')).replace(/\/+$/, '');
  if (!baseUrl) return { ok: false, reason: 'AI_BASE_URL is not set' };
  if (!/^https:\/\/[^\s/]+/i.test(baseUrl)) return { ok: false, reason: 'AI_BASE_URL must start with https://' };
  const apiKey = s('AI_API_KEY') || (provider === 'anthropic' ? anthropicKey : '');
  if (!apiKey) return { ok: false, reason: 'AI_API_KEY is not set' };
  const model = s('AI_MODEL');
  if (!model) return { ok: false, reason: 'AI_MODEL is not set (check your provider’s model list)' };
  if (model.length > 80 || /\s/.test(model)) return { ok: false, reason: 'AI_MODEL doesn’t look like a model id' };
  return {
    ok: true,
    cfg: {
      provider, baseUrl, apiKey, model,
      caps: { groupPerMonth: int(get('AI_GROUP_MONTHLY_CAP'), DEFAULT_CAPS.groupPerMonth), personPerDay: int(get('AI_PERSON_DAILY_CAP'), DEFAULT_CAPS.personPerDay) },
    },
  };
}

// ------------------------------------------------------------------ Reading sloppy JSON

/** Best-effort fix of the usual ways a model breaks JSON: code fences, text around the object, trailing commas,
 *  smart quotes, single-quoted keys/strings, Python's True/False/None. */
export function repairJson(s: string): string {
  let t = String(s ?? '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/,\s*([}\]])/g, '$1');
  // 'key': 'value' → "key": "value" (only when there are no double quotes to confuse things)
  if (!t.includes('"')) t = t.replace(/'/g, '"');
  t = t.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  t = t.replace(/:\s*True\b/g, ': true').replace(/:\s*False\b/g, ': false').replace(/:\s*None\b/g, ': null');
  return t;
}

/** Tool arguments as an object, from an object or a JSON string (repaired once if needed). */
export function readArgs(raw: unknown): { ok: true; value: Any } | { ok: false } {
  if (raw == null || raw === '') return { ok: true, value: {} };
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ok: true, value: raw };
  if (typeof raw !== 'string') return { ok: false };
  for (const attempt of [raw, repairJson(raw)]) {
    try {
      let v = JSON.parse(attempt);
      if (typeof v === 'string') v = JSON.parse(v); // double-encoded
      if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v };
    } catch { /* try the repair */ }
  }
  return { ok: false };
}

/** Some models think out loud in <think> tags; that never reaches people. */
export const stripThinking = (s: string) => String(s ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();

const estimate = (s: string) => Math.ceil(String(s || '').length / 4);
let seq = 0;
const newId = (i: number) => `call_${Date.now().toString(36)}_${(seq++).toString(36)}_${i}`;

// ------------------------------------------------------------------ The two formats

export function endpoint(cfg: AiConfig): string {
  if (/\/(chat\/completions|messages)$/.test(cfg.baseUrl)) return cfg.baseUrl;
  return cfg.provider === 'anthropic' ? `${cfg.baseUrl}/messages` : `${cfg.baseUrl}/chat/completions`;
}

export function headers(cfg: AiConfig): Record<string, string> {
  if (cfg.provider === 'anthropic') return { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  // X-Title / HTTP-Referer: optional, used by OpenRouter to name the app on its dashboard; ignored elsewhere.
  return { Authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json', 'X-Title': 'The Golf Trip', 'HTTP-Referer': 'https://thegolftrip.app' };
}

/** A photo (a data URL) as an Anthropic image block. */
function anthropicImage(url: string) {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(url);
  return { type: 'image', source: { type: 'base64', media_type: m ? m[1] : 'image/jpeg', data: m ? m[2] : url } };
}

/** The request body for one model call, in the provider's own format. */
export function requestBody(cfg: AiConfig, o: { system: string; tools: ToolDef[]; messages: Msg[]; maxTokens: number }) {
  if (cfg.provider === 'anthropic') {
    const messages = o.messages.map((m) => {
      if (m.role === 'user') return { role: 'user', content: m.images?.length ? [...m.images.map(anthropicImage), { type: 'text', text: m.text }] : m.text };
      if (m.role === 'assistant') {
        const content: Any[] = [];
        if (m.text) content.push({ type: 'text', text: m.text });
        for (const c of m.calls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.bad ? {} : (c.input ?? {}) });
        if (!content.length) content.push({ type: 'text', text: '…' });
        return { role: 'assistant', content };
      }
      return { role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) })) };
    });
    return { model: cfg.model, max_tokens: o.maxTokens, system: o.system, tools: o.tools, messages };
  }
  const messages: Any[] = [{ role: 'system', content: o.system }];
  for (const m of o.messages) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.images?.length ? [{ type: 'text', text: m.text }, ...m.images.map((url) => ({ type: 'image_url', image_url: { url } }))] : m.text });
    else if (m.role === 'assistant') {
      messages.push({
        role: 'assistant', content: m.text || '',
        ...(m.calls.length ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.bad ? (c.raw ?? '{}') : JSON.stringify(c.input ?? {}) } })) } : {}),
      });
    } else {
      for (const r of m.results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.is_error ? `Error: ${r.content}` : r.content });
    }
  }
  return {
    model: cfg.model, max_tokens: o.maxTokens, messages,
    tools: o.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    tool_choice: 'auto',
  };
}

const toCall = (name: unknown, args: unknown, id: unknown, i: number): Call => {
  const parsed = readArgs(args);
  return {
    id: typeof id === 'string' && id ? id.slice(0, 120) : newId(i),
    name: String(name ?? '').slice(0, 80),
    input: parsed.ok ? parsed.value : {},
    ...(parsed.ok ? {} : { bad: true, raw: String(args).slice(0, 2000) }),
  };
};

/** One reply from the provider, in the helper's plain shape. Null if it isn't a reply at all. */
export function parseReply(cfg: AiConfig, j: Any, sentBody: string): Reply | null {
  if (!j || typeof j !== 'object' || j.error) return null;
  let text = '';
  let calls: Call[] = [];
  let inTok: number | null = null;
  let outTok: number | null = null;
  if (cfg.provider === 'anthropic') {
    if (!Array.isArray(j.content)) return null;
    text = j.content.filter((b: Any) => b?.type === 'text').map((b: Any) => String(b.text || '')).join('\n');
    calls = j.content.filter((b: Any) => b?.type === 'tool_use').map((b: Any, i: number) => toCall(b.name, b.input, b.id, i));
    inTok = j.usage?.input_tokens ?? null;
    outTok = j.usage?.output_tokens ?? null;
  } else {
    const m = j.choices?.[0]?.message;
    if (!m || typeof m !== 'object') return null;
    text = typeof m.content === 'string' ? m.content
      : Array.isArray(m.content) ? m.content.map((p: Any) => (typeof p === 'string' ? p : p?.text || '')).join('\n') : '';
    const tc = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    calls = tc.map((c: Any, i: number) => toCall(c?.function?.name ?? c?.name, c?.function?.arguments ?? c?.arguments, c?.id, i));
    if (!calls.length && m.function_call) calls = [toCall(m.function_call.name, m.function_call.arguments, null, 0)]; // the old format
    inTok = j.usage?.prompt_tokens ?? j.usage?.input_tokens ?? null;
    outTok = j.usage?.completion_tokens ?? j.usage?.output_tokens ?? null;
  }
  calls = calls.filter((c) => c.name);
  text = stripThinking(text);
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const missing = !(num(inTok) >= 0) || !(num(outTok) >= 0);
  const usage: Usage = missing
    ? { input_tokens: estimate(sentBody), output_tokens: estimate(text + JSON.stringify(calls.map((c) => c.input))), estimated: true }
    : { input_tokens: Number(inTok), output_tokens: Number(outTok) };
  return { text, calls, usage };
}

/** Friendly words for an HTTP failure (and a short code for the usage log). */
export function httpFailure(status: number): { code: string; message: string } {
  if (status === 401 || status === 403) return { code: 'provider_key', message: 'The AI helper’s key isn’t working — tell the app’s owner.' };
  if (status === 402) return { code: 'provider_credit', message: 'The AI helper has run out of credit — tell the app’s owner.' };
  if (status === 404) return { code: 'provider_model', message: 'The AI helper’s model isn’t available — tell the app’s owner.' };
  if (status === 429 || status === 529 || status >= 500) return { code: 'provider_busy', message: 'The AI helper is busy right now — try again in a minute.' };
  return { code: 'provider_refused', message: 'The AI helper couldn’t answer that one.' };
}

/** Call the model once. Never throws. */
export async function callModel(cfg: AiConfig, o: { system: string; tools: ToolDef[]; messages: Msg[]; maxTokens: number }, fetchFn: typeof fetch, timeoutMs: number): Promise<CallResult> {
  const body = JSON.stringify(requestBody(cfg, o));
  let res: Response;
  try {
    res = await fetchFn(endpoint(cfg), { method: 'POST', headers: headers(cfg), body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = /timeout|abort/i.test(String((e as Error)?.name || '') + String((e as Error)?.message || ''));
    return { ok: false, code: timeout ? 'timeout' : 'network', message: timeout ? 'The AI helper took too long — try again.' : 'Couldn’t reach the AI helper just now — try again in a minute.' };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, ...httpFailure(res.status) };
  }
  const j = await res.json().catch(() => null);
  // OpenRouter and some others send errors with a 200.
  if (j?.error) {
    const st = Number(j.error.code ?? j.error.status);
    return { ok: false, ...(Number.isFinite(st) && st >= 400 ? httpFailure(st) : { code: 'provider_refused', message: 'The AI helper couldn’t answer that one.' }) };
  }
  const reply = parseReply(cfg, j, body);
  if (!reply) return { ok: false, code: 'odd_reply', message: 'The AI helper sent back something odd — try again.' };
  return { ok: true, reply };
}
