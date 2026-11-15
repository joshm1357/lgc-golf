// Cloudflare Pages function (ov44): /a/<token> — the link preview page for a round ask ("⛳ Josh: anyone keen for a
// round?"). See src/lib/askpreview.js for what it does and why. Deployed with the site, like functions/i/[token].js.
// Reads only ask_preview(token) (migration 113) with the database's public address and key, which the build writes
// to /preview-db.json. No contact details ever reach this page.
import { askPreviewResponse } from '../../src/lib/askpreview.js';

export async function onRequestGet({ request, params, env }) {
  const here = new URL(request.url);
  let db = null;
  try {
    const r = await env.ASSETS.fetch(new URL('/preview-db.json', here.origin));
    if (r.ok) db = await r.json();
  } catch { db = null; }
  const rpc = db?.url && db?.key ? async (token) => {
    const res = await fetch(`${db.url}/rest/v1/rpc/ask_preview`, {
      method: 'POST',
      headers: { apikey: db.key, authorization: `Bearer ${db.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    });
    return res.ok ? res.json() : null;
  } : null;
  const out = await askPreviewResponse({ token: String(params.token || ''), url: `${here.origin}${here.pathname}`, rpc, image: `${here.origin}/brand/trip-512.png` });
  return new Response(out.body, { status: out.status, headers: out.headers });
}
