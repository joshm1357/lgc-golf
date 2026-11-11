// ask-fill — the Caddie box on "Anyone keen for a round?" (v2.1, Josh 12 Nov 2026; claude/round-ask-v2-1-rethink.md).
// "Tell the Caddie when you can play": the phone reads easy phrases itself (lib/ask.js quickFill); anything messier
// ("any arvo except the 21st, Sundays home by 12, 9 holes fine, anywhere east, not Moore Park again") comes here.
// The AI turns it into ✓ / ✗ / ? for the person's week and date exceptions, notes, and where they'll leave from.
// Nothing is saved: the phone puts it on the grid, shows what changed, and the person sends it themselves.
//
// Works on the no-sign-in link too (Josh 12 Nov: yes, capped), so this function checks for itself (verify_jwt off):
//   * the ask's link token must be a real v2 ask that's still open for answers;
//   * caps (migration 112's ask_ai_uses, server only): 5 a person per ask and 60 an ask (ASK_AI_PERSON_CAP /
//     ASK_AI_ASK_CAP). "A person" is their sign-in, else the key their phone keeps for their answer, else a random id
//     the phone makes — so the per-ask cap of 60 is the hard ceiling on spend;
//   * the text is cut to 300 characters and goes to the model as data it's told never to obey;
//   * the reply is cleaned twice (here and on the phone) to the ask's own dates and parts.
// Logs: which ask, a hashed "who", ok or the error kind. Never the text, the reply, a name or a key.
// AI: the same secrets as ai-helper (AI_PROVIDER, AI_BASE_URL, AI_API_KEY, AI_MODEL; AI_FAST_MODEL if set).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { aiConfig, fastConfig } from '../ai-helper/providers.ts';
import { caps, okToken, whoKey, room, fillOnce, MAX_TEXT } from './logic.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

const AI = aiConfig((k) => Deno.env.get(k));
const FAST = fastConfig((k) => Deno.env.get(k), AI.ok ? AI.cfg : null);
const CAPS = caps((k) => Deno.env.get(k));
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const body: Any = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Unknown request.' }, 400);
  const text = String(body.text ?? '').trim();
  if (text.length < 2) return json({ error: 'Tell the Caddie when you can play.' });
  if (text.length > MAX_TEXT) return json({ error: `Keep it under ${MAX_TEXT} characters.` });
  if (!okToken(body.token)) return json({ error: 'That link isn’t working — ask whoever sent it for a new one.' });
  if (!AI.ok || !FAST.cfg) return json({ error: 'The Caddie isn’t switched on yet — tap the squares instead.', off: true });

  // The ask behind the link.
  const { data: plan } = await admin.from('plans').select('id,status,ask,group_id').eq('ask_token', String(body.token).trim().toUpperCase()).eq('callout', true).maybeSingle();
  if (!plan?.ask) return json({ error: 'That link isn’t working — ask whoever sent it for a new one.' });
  if (plan.status !== 'planning') return json({ error: 'This one’s decided — no more answers needed.' });

  // Who's asking (for the cap). A real sign-in if there is one; the publishable key isn't a sign-in.
  let userId: string | null = null;
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (bearer && bearer.split('.').length === 3) {
    const { data } = await admin.auth.getUser(bearer).catch(() => ({ data: null as Any }));
    userId = data?.user?.id || null;
  }
  const who = await whoKey({ userId, key: body.key, device: body.device });
  if (!who) return json({ error: 'Couldn’t tell who’s asking — reload the page and try again.' });

  // Caps: uses that didn't fail (in-flight ones count, so two at once can't both slip through).
  const counted = (q: Any) => q.or('ok.eq.true,code.is.null');
  const [mine, all] = await Promise.all([
    counted(admin.from('ask_ai_uses').select('id', { count: 'exact', head: true }).eq('plan_id', plan.id).eq('who', who)),
    counted(admin.from('ask_ai_uses').select('id', { count: 'exact', head: true }).eq('plan_id', plan.id)),
  ]);
  if (mine.error || all.error) return json({ error: 'The Caddie hit a snag — tap the squares instead.' });
  const left = room({ person: mine.count || 0, ask: all.count || 0 }, CAPS);
  if (!left.ok) {
    return json({ error: left.you ? 'The Caddie’s done its share on this one — tap the squares instead.' : 'That’s your Caddie goes used up on this one — tap the squares instead.', capped: true, remaining: left });
  }
  const { data: row } = await admin.from('ask_ai_uses').insert({ plan_id: plan.id, who }).select('id').single();

  // What the AI service sent back, in outline only (finish reason, error words from the service) — never the content.
  const seen: Any[] = [];
  const watched = (async (u: string, init: Any) => {
    const res = await fetch(u, init);
    try {
      const j = await res.clone().json();
      const c = j?.choices?.[0];
      seen.push({ status: res.status, model: String(j?.model || '').slice(0, 60), finish: c?.finish_reason ?? j?.stop_reason ?? null, msg: !!c?.message, calls: c?.message?.tool_calls?.length ?? null,
        out: j?.usage?.completion_tokens ?? j?.usage?.output_tokens ?? null, think: j?.usage?.completion_tokens_details?.reasoning_tokens ?? null, text: String(c?.message?.content || '').length,
        err: String(j?.error?.message || c?.error?.message || '').slice(0, 160) || null });
    } catch { seen.push({ status: res.status }); }
    return res;
  }) as typeof fetch;
  const r = await fillOnce(FAST.cfg, plan.ask, sydneyToday(), text, watched, 30000);
  if (row?.id) await admin.from('ask_ai_uses').update(r.ok ? { ok: true } : { code: String(r.code).slice(0, 40) }).eq('id', row.id);
  if (!r.ok) {
    console.warn('ask-fill: no fill', r.code, JSON.stringify({ shape: (r as Any).shape || null, seen })); // outline only
    return json({ error: r.message, remaining: left, why: { code: r.code, seen } });
  }

  // Places they'll leave from → a spot on the map, from the course library's towns (else the phone asks them to pick).
  for (const f of r.fill.where.from) {
    const { data: hit } = await admin.from('course_library').select('area,lat,lng').eq('hidden', false).not('lat', 'is', null)
      .ilike('area', `${f.label.replace(/[%_\\]/g, '')}%`).limit(1).maybeSingle();
    if (hit) { f.lat = Math.round(Number(hit.lat) * 100) / 100; f.lng = Math.round(Number(hit.lng) * 100) / 100; }
  }
  return json({ fill: r.fill, remaining: { you: left.you - 1, ask: left.ask - 1 } });
});
