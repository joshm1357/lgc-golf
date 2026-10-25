// Cloudflare Pages function (ov39): /i/<token> — the link preview page for a shared trip idea. See
// src/lib/ideapreview.js for what it does and why. Deployed with the site: `wrangler pages deploy dist` (in
// .github/workflows/cloudflare.yml) picks up this functions/ folder by itself. Reads only idea_preview(token) (108,
// by stage from 110) with the database's public address and key, which the build writes to /preview-db.json.
// ov42: fast and never stuck — ONE time limit (PREVIEW_WAIT_MS, 1.5 s) covers both lookups (the address file and the
// database); on a time-out or any error the plain preview goes out straight away. The address file is kept in memory
// between requests on the same worker.
import { previewResponse, PREVIEW_WAIT_MS } from '../../src/lib/ideapreview.js';

let dbCache = null;

export async function onRequestGet({ request, params, env }) {
  const here = new URL(request.url);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PREVIEW_WAIT_MS);
  const started = Date.now();
  try {
    let db = dbCache;
    if (!db) {
      try {
        const r = await env.ASSETS.fetch(new Request(new URL('/preview-db.json', here.origin), { signal: ctl.signal }));
        if (r.ok) { db = await r.json(); if (db?.url && db?.key) dbCache = db; }
      } catch { db = null; }
    }
    const rpc = db?.url && db?.key ? async (token) => {
      const res = await fetch(`${db.url}/rest/v1/rpc/idea_preview`, {
        method: 'POST',
        headers: { apikey: db.key, authorization: `Bearer ${db.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_token: token }),
        signal: ctl.signal,
      });
      return res.ok ? res.json() : null;
    } : null;
    const left = Math.max(50, PREVIEW_WAIT_MS - (Date.now() - started));
    const out = await previewResponse({ token: String(params.token || ''), url: `${here.origin}${here.pathname}`, rpc, image: `${here.origin}/brand/trip-512.png`, timeoutMs: left });
    return new Response(out.body, { status: out.status, headers: out.headers });
  } catch {
    const out = await previewResponse({ token: '', url: `${here.origin}${here.pathname}`, rpc: null, image: `${here.origin}/brand/trip-512.png` });
    return new Response(out.body, { status: out.status, headers: out.headers });
  } finally {
    clearTimeout(timer);
  }
}
