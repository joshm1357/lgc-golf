// The link preview for a round ask (ov44, Josh 15 Nov 2026; claude/round-door-addendum.md piece 2): what WhatsApp,
// Messenger and iMessage show under the ask's link — "⛳ Josh: anyone keen for a round?", one line and the picture —
// and, for a person, a quick hop into the app at #/a/<token> (the grid, no sign-in).
//
// Same idea as the trip idea's preview (lib/ideapreview.js): the app is one page with # addresses, which a chat app
// can't read, so the link people share on Cloudflare is a real page: https://app.thegolftrip.club/a/<token>
// (functions/a/[token].js). It reads ask_preview(token) (migration 113) with the public key: whoever asked (first
// name), the ask (days, times, how far ahead), the course, whether it's still open, and the picture. Never an answer,
// a name of anyone who answered, an email or a mobile. No token match → a plain "The Golf Trip" preview.
// The page is noindex. Pure — tested in askpreview.test.js; the page function only does the fetching.
import { previewPage } from './ideapreview.js';
import { askWords } from './ask.js';

const TOKEN = /^[23456789A-HJ-NP-Z]{16}$/;
export const askToken = (t) => { const s = String(t || '').trim().toUpperCase(); return TOKEN.test(s) ? s : null; };

export const PLAIN = { title: 'The Golf Trip', description: 'Sort a round or a golf trip with your mates. Ask when they can play; they tap the times. No app to install.' };
export const NO_SIGN_IN = 'Tap the times you can play. No app, no sign-in.';

/** The words for the preview. p: ask_preview's answer (or null → the plain preview). */
export function askPreviewWords(p) {
  if (!p || !p.ask || typeof p.ask !== 'object') return PLAIN;
  const who = String(p.by || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const title = `⛳ ${who ? `${who}: a` : 'A'}nyone keen for a round?`;
  const course = String(p.course || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  let when = '';
  try { when = askWords(p.ask); } catch { when = ''; }
  const line = [when, course].filter(Boolean).join(' · ').slice(0, 140);
  if (p.status === 'cancelled') return { title, description: 'This one was called off.' };
  if (p.status === 'confirmed' || p.status === 'done') return { title, description: `${course ? `${course} · ` : ''}It’s locked in. Tap to see when.` };
  return { title, description: `${line ? `${line}. ` : ''}${NO_SIGN_IN}` };
}

/** What goes on the ask's share picture (shareCard.js drawIdeaPreview — the 1200 × 630 one chat apps show). */
export function askCard({ who = '', ask = null, courseName = '', sun = '' } = {}) {
  let when = '';
  try { when = ask ? askWords(ask) : ''; } catch { when = ''; }
  return {
    eyebrow: '⛳ ANYONE KEEN FOR A ROUND?',
    title: `${who ? `${String(who).slice(0, 24)} is asking` : 'Who’s in?'}`,
    line: [when, courseName].filter(Boolean).join(' · ').slice(0, 60),
    cta: 'Tap the times you can play — no app, no sign-in',
    sub: String(sun || '').slice(0, 40),
  };
}

/** The whole page for a token. */
export function askPreviewPage({ preview = null, token = '', url = '', image = '' } = {}) {
  const tok = askToken(token);
  return previewPage({ preview: preview ? { card_url: preview.card_url } : null, url, image, words: askPreviewWords(preview), hop: tok ? `#/a/${tok}` : '#/' });
}

/** The page function's work, with the fetching handed in (so it's testable). */
export async function askPreviewResponse({ token, url, rpc, image = '' }) {
  let preview = null;
  const tok = askToken(token);
  if (tok && rpc) {
    try { preview = await rpc(tok); } catch { preview = null; }
  }
  if (preview && (typeof preview !== 'object' || !preview.ask)) preview = null;
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': preview ? 'public, max-age=300' : 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-robots-tag': 'noindex' },
    body: askPreviewPage({ preview, token, url, image }),
  };
}

/** The link to share: on Cloudflare (base '/') the /a/<token> page with a proper preview; elsewhere the # link. */
export function askShareLink({ origin = '', base = '/', token = '' } = {}) {
  const tok = askToken(token);
  if (!tok) return `${origin}${base}`;
  return base === '/' ? `${origin}/a/${tok}` : `${origin}${base}#/a/${tok}`;
}
