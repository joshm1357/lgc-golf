// Sending email (079: vote emails) through Resend's web API. Secrets (set on the functions, never in code):
//   RESEND_API_KEY — from resend.com, once thegolftrip.club is verified there;
//   EMAIL_FROM     — e.g. "The Golf Trip <votes@thegolftrip.club>".
// Without the key, nothing is sent: the result says 'email not set up' (app notifications still go).

export type Email = { to: string; subject: string; html: string; text: string; unsubscribe?: string };
export type SendResult = { ok: true; id?: string } | { ok: false; skipped: 'email not set up' } | { ok: false; error: string };
type Env = { get(name: string): string | undefined };

export const RESEND_URL = 'https://api.resend.com/emails';

/** EMAIL_FROM as Resend wants it. Copes with the angle brackets going missing when the secret was typed in
 *  ("The Golf Trip votes@thegolftrip.club" → "The Golf Trip <votes@thegolftrip.club>"). */
export function normaliseFrom(raw: string): string {
  const s = String(raw || '').trim().replace(/^["']|["']$/g, '').trim();
  if (!s || s.includes('<')) return s;
  const m = /^(.*?)[\s,]*([^\s<>"]+@[^\s<>"]+\.[a-z]{2,})$/i.exec(s);
  if (!m) return s;
  const name = m[1].trim().replace(/[<>"]/g, '');
  return name ? `${name} <${m[2]}>` : m[2];
}

/** The request Resend expects (exported for tests). */
export function resendRequest(msg: Email, from: string, key: string): { url: string; init: RequestInit } {
  const headers: Record<string, string> = {};
  if (msg.unsubscribe) headers['List-Unsubscribe'] = `<${msg.unsubscribe}>`;
  return {
    url: RESEND_URL,
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, headers }),
    },
  };
}

export async function sendEmail(msg: Email, env: Env = Deno.env, fetchFn: typeof fetch = fetch): Promise<SendResult> {
  const key = env.get('RESEND_API_KEY') || '';
  const from = normaliseFrom(env.get('EMAIL_FROM') || '');
  if (!key || !from) {
    console.log('vote email skipped: email not set up');
    return { ok: false, skipped: 'email not set up' };
  }
  const { url, init } = resendRequest(msg, from, key);
  try {
    const res = await fetchFn(url, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${String((body as { message?: string }).message || '').slice(0, 120)}` };
    return { ok: true, id: (body as { id?: string }).id };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 120) };
  }
}
