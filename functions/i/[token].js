// Cloudflare Pages function (ov39): /i/<token> — the link preview page for a shared trip idea. See
// src/lib/ideapreview.js for what it does and why. Deployed with the site: `wrangler pages deploy dist` (in
// .github/workflows/cloudflare.yml) picks up this functions/ folder by itself. Reads only idea_preview(token) (108)
// with the database's public address and key, which the build writes to /preview-db.json.
import { previewResponse } from '../../src/lib/ideapreview.js';

export async function onRequestGet({ request, params, env }) {
  const here = new URL(request.url);
  let db = null;
  try {
    const r = await env.ASSETS.fetch(new URL('/preview-db.json', here.origin));
    if (r.ok) db = await r.json();
  } catch { db = null; }
  const rpc = db?.url && db?.key ? async (token) => {
    const res = await fetch(`${db.url}/rest/v1/rpc/idea_preview`, {
      method: 'POST',
      headers: { apikey: db.key, authorization: `Bearer ${db.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    });
    return res.ok ? res.json() : null;
  } : null;
  const out = await previewResponse({ token: String(params.token || ''), url: `${here.origin}${here.pathname}`, rpc, image: `${here.origin}/brand/trip-512.png` });
  return new Response(out.body, { status: out.status, headers: out.headers });
}
