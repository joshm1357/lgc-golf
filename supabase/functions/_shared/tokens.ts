// One-tap answer links (079). A link carries "<row id>.<secret>": the secret is 32 random bytes, only the SHA-256 of it
// is stored (vote_email_tokens.secret_hash), and it's checked with a constant-time compare.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function b64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fresh secret and its hash. The row id is added once the row exists (`${id}.${secret}`). */
export async function newSecret() {
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  return { secret, hash: await sha256Hex(secret) };
}

/** "<uuid>.<secret>" → its parts, or null if it isn't that shape. */
export function splitToken(t: unknown): { id: string; secret: string } | null {
  if (typeof t !== 'string' || t.length > 200) return null;
  const i = t.indexOf('.');
  if (i < 0) return null;
  const id = t.slice(0, i);
  const secret = t.slice(i + 1);
  if (!UUID.test(id) || !/^[A-Za-z0-9_-]{40,60}$/.test(secret)) return null;
  return { id: id.toLowerCase(), secret };
}

/** Compare two strings without stopping at the first difference. */
export function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i % (x.length || 1)] ?? 0) ^ (y[i % (y.length || 1)] ?? 0);
  return diff === 0;
}
