// Service worker: phone notifications + opening the app with no signal.
//
// Offline rules (kept deliberately simple so updates are never blocked):
//   - The page itself (index.html): try the network first; if there's no signal, use the copy
//     saved last time. So a new version always wins when there's signal.
//   - The app's code and styles (/assets/…): their file names change with every release, so a saved
//     copy is always the right one. All of them are saved when the page is, and old ones are dropped.
//   - Icons and the manifest (/brand/…): network first, saved copy when offline.
//   - Everything else (the database, maps, photos) goes straight to the network, untouched.
//     Scores entered offline are queued by the app itself and sent when signal returns.
const CACHE = 'lgc-shell-v2';
const BASE = '/lgc-golf/';

/** Save the page and every code/style file it uses; drop code files from older versions. */
async function saveShell(pageResponse) {
  const c = await caches.open(CACHE);
  const page = pageResponse || (await fetch(BASE, { cache: 'no-store' }));
  if (!page.ok) return;
  const html = await page.clone().text();
  await c.put(BASE, page);
  const used = [...new Set((html.match(/\/lgc-golf\/assets\/[^"'\s)]+/g) || []))];
  await Promise.all(used.map(async (u) => { if (!(await c.match(u))) { try { await c.add(u); } catch { /* next time */ } } }));
  for (const req of await c.keys()) {
    const p = new URL(req.url).pathname;
    if (p.startsWith(`${BASE}assets/`) && !used.includes(p)) await c.delete(req);
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(saveShell().catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== TILES) await caches.delete(k);
    await self.clients.claim();
  })());
});

const TILES = 'lgc-tiles-v1';
const TILE_HOST = 'server.arcgisonline.com';
const MAX_TILES = 2500; // about 50 MB at most

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]); // oldest first
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Satellite map tiles: a saved copy first (so the course map works with no signal), else fetch and save.
  if (url.hostname === TILE_HOST && url.pathname.includes('/tile/')) {
    event.respondWith((async () => {
      let c = null;
      try {
        c = await caches.open(TILES);
        const saved = await c.match(req.url);
        if (saved) return saved;
      } catch { /* storage unavailable — just fetch */ }
      // Ask for a readable (CORS) copy so we only ever save real pictures, never error pages or
      // unreadable "opaque" responses (Chrome counts each of those as ~7 MB of storage).
      let fresh;
      try {
        fresh = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
      } catch {
        return fetch(req); // CORS refused or no signal: let the browser try its own way, save nothing
      }
      if (fresh.ok && c) {
        try {
          await c.put(req.url, fresh.clone());
          if (Math.random() < 0.05) event.waitUntil(trimTiles().catch(() => {}));
        } catch { /* storage full: show the tile anyway */ }
      }
      return fresh;
    })());
    return;
  }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  const isPage = req.mode === 'navigate' || url.pathname === BASE || url.pathname.endsWith('/index.html');
  if (isPage) {
    // The "new version" check asks for a fresh copy — never answer it from the cache unless offline.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh.ok && req.mode === 'navigate') event.waitUntil(saveShell(fresh.clone()).catch(() => {}));
        return fresh;
      } catch {
        const saved = await caches.match(BASE);
        if (saved) return saved;
        throw new Error('offline');
      }
    })());
    return;
  }

  // Icons and the manifest keep their names between versions: network first, saved copy offline.
  if (url.pathname.startsWith(`${BASE}brand/`) || url.pathname.endsWith('.webmanifest')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) (await caches.open(CACHE)).put(req, fresh.clone());
        return fresh;
      } catch {
        const saved = await caches.match(req);
        if (saved) return saved;
        throw new Error('offline');
      }
    })());
    return;
  }
  if (url.pathname.startsWith(`${BASE}assets/`)) {
    event.respondWith((async () => {
      const saved = await caches.match(req);
      if (saved) return saved;
      const fresh = await fetch(req);
      if (fresh.ok) {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    })());
  }
});

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { title: 'L.G.C', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(msg.title || 'L.G.C', {
    body: msg.body || '',
    icon: `${BASE}brand/icon-192.png`,
    badge: `${BASE}brand/icon-192.png`,
    tag: msg.tag,
    data: { url: msg.url || BASE },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || BASE;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.includes(BASE)) {
        await w.focus();
        try { await w.navigate(url); } catch { /* some browsers refuse; the focus is enough */ }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
