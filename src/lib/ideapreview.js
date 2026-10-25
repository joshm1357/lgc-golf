// The link preview for a shared trip idea (ov39): what WhatsApp, Messenger and iMessage show under the link — a title,
// a line and the picture — and, for a person, a quick hop into the app.
//
// The app is one page with # addresses, so a link preview needs a real page on the server. On Cloudflare Pages that's
// functions/i/[token].js (a tiny page function, deployed with the site by the same `wrangler pages deploy`):
//   https://app.thegolftrip.club/i/<token>#/join/<code>?to=/idea/<id>
// The chat app fetches /i/<token> (it never sends the part after #) and reads the meta tags. A person's browser gets
// the same page, which sends them on to /#/join/<code>?to=/idea/<id> — the app's usual link (join first if needed).
// The page reads idea_preview(token) (108) with the public key: only the idea's name, rough when/where, who proposed
// it, the group's name and the picture. No token match → a plain "The Golf Trip" preview, and the hop still works.
// GitHub Pages (the current live address) can't run page functions: there the app shares the plain link, and the
// picture and the message are what people see.
// Pure — tested in ideapreview.test.js; the page function only does the fetching.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TOKEN = /^[A-Za-z0-9_-]{16,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const okToken = (t) => TOKEN.test(String(t || ''));

/** The words for the preview. p: idea_preview's answer (or null). */
export function previewWords(p) {
  if (!p || !p.name) {
    return { title: 'A golf trip idea — The Golf Trip', description: 'Help plan it: 4 quick taps — your dates, budget, how you’d get there and what golf you’re after.' };
  }
  const fx = p.fixed && typeof p.fixed === 'object' ? p.fixed : {};
  const when = fx.weekend?.start ? String(fx.weekend.start) : p.when;
  const shape = [when, fx.area || p.where, p.travel === 'fly' ? 'flying' : null].filter(Boolean).join(' · ');
  return {
    title: `💡 ${String(p.name).slice(0, 70)}`,
    description: `${p.by ? `${String(p.by).slice(0, 30)}’s trip idea` : 'A trip idea'}${p.group ? ` for ${String(p.group).slice(0, 40)}` : ''}${shape ? ` — ${shape.slice(0, 80)}` : ''}. Help plan it: 4 quick taps.`,
  };
}

/** The whole page. { preview, url (this page), image (fallback picture), appBase ('/') } */
export function previewPage({ preview = null, url = '', image = '', appBase = '/' } = {}) {
  const w = previewWords(preview);
  const img = preview?.card_url && /^https:\/\//.test(preview.card_url) ? preview.card_url : image;
  const planId = preview?.plan_id && UUID.test(preview.plan_id) ? preview.plan_id : null;
  const fallback = planId ? `#/idea/${planId}` : '#/';
  const base = /^\/[A-Za-z0-9/_-]*$/.test(appBase) ? appBase : '/';
  return `<!doctype html>
<html lang="en-AU"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(w.title)}</title>
<meta name="description" content="${esc(w.description)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="The Golf Trip" />
<meta property="og:title" content="${esc(w.title)}" />
<meta property="og:description" content="${esc(w.description)}" />
${url ? `<meta property="og:url" content="${esc(url)}" />\n` : ''}${img ? `<meta property="og:image" content="${esc(img)}" />\n<meta property="og:image:width" content="1200" />\n<meta property="og:image:height" content="630" />\n<meta name="twitter:image" content="${esc(img)}" />\n` : ''}<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}" />
<meta name="robots" content="noindex" />
<style>body{margin:0;font:16px/1.4 system-ui,sans-serif;background:#0E1F17;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}a{color:#E0B84A;font-weight:700}</style>
</head><body>
<div><p>${esc(w.title)}</p><p><a id="go" href="${esc(base + fallback)}">Open it in The Golf Trip</a></p></div>
<script>
(function () {
  var h = location.hash && location.hash.length > 2 ? location.hash : ${JSON.stringify(fallback)};
  if (!/^#\\/[A-Za-z0-9\\/_.~%=&?-]*$/.test(h)) h = ${JSON.stringify(fallback)};
  location.replace(${JSON.stringify(base)} + h);
})();
</script>
</body></html>`;
}

/** The page function's work, with the fetching handed in (so it's testable). */
export async function previewResponse({ token, url, rpc, image = '' }) {
  let preview = null;
  if (okToken(token) && rpc) {
    try { preview = await rpc(token); } catch { preview = null; }
  }
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': preview ? 'public, max-age=300' : 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' },
    body: previewPage({ preview, url, image }),
  };
}
