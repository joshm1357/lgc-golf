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
// The app's own folder, worked out from where this file is served: '/lgc-golf/' on GitHub Pages,
// '/' on app.thegolftrip.club. So the same file works at either address.
const BASE = new URL('./', self.location).pathname;
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PAGE_CODE = new RegExp(`["'=]${esc(BASE)}assets/index-[^"'\\s)]+\\.js`); // inside the page's own src="…"
// Cloudflare answers a missing file with the app's page (status 200), not a 404. Never save that page
// under a code, icon or manifest name.
const isHtml = (res) => (res.headers.get('content-type') || '').includes('text/html');
const ALL_CODE = new RegExp(`${esc(BASE)}assets/[^"'\\s)]+`, 'g');

/** Every code/style file of the version on the server — including screens that load only when
 *  opened — from the list written at build time. Empty if it can't be fetched. */
async function allParts() {
  try {
    const res = await fetch(`${BASE}asset-list.json`, { cache: 'no-store' });
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list.filter((f) => /^assets\/[\w.-]+$/.test(f)).map((f) => BASE + f) : [];
  } catch { return []; }
}

/** Save the page and every code/style file the app uses; drop code files from older versions.
 *  Careful rules, because a bad save here is what leaves a phone with a blank app on the course:
 *   - only a real copy of this app is saved (not a Wi-Fi login page that answered instead);
 *   - the page is saved only once its own code and styles are saved;
 *   - old files are only cleared when the full list of parts loaded and every part was saved. */
async function saveShell(pageResponse) {
  const c = await caches.open(CACHE);
  const page = pageResponse || (await fetch(BASE, { cache: 'no-store' }));
  if (!page.ok) return;
  const html = await page.clone().text();
  if (!PAGE_CODE.test(html)) return; // not our app
  const fromPage = [...new Set(html.match(ALL_CODE) || [])];
  // The list only counts if it belongs to the same version as the page (it names the page's files).
  const parts = await allParts();
  const complete = parts.length > 0 && fromPage.every((u) => parts.includes(u));
  const used = [...new Set([...fromPage, ...(complete ? parts : [])])];
  const saved = await Promise.all(used.map(async (u) => {
    if (await c.match(u)) return true;
    try { await c.add(u); return true; } catch { return false; }
  }));
  const ok = (u) => saved[used.indexOf(u)];
  if (!fromPage.every(ok)) return; // try again next time; keep the old copy meanwhile
  await c.put(BASE, page);
  if (!complete || !saved.every(Boolean)) return;
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
    // Opening the app: if the network hasn't answered in 4 seconds (one bar of signal), open the
    // saved copy; the fresh copy is still saved in the background when it arrives.
    const opening = req.mode === 'navigate';
    let saving = Promise.resolve();
    const net = fetch(req, { cache: 'no-store' }).then((fresh) => {
      if (fresh.ok && opening) saving = saveShell(fresh.clone()).catch(() => {});
      return fresh;
    });
    event.waitUntil(net.then(() => saving, () => {}));
    event.respondWith((async () => {
      const saved = opening ? await caches.match(BASE) : null;
      if (saved) {
        const slow = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
        const fresh = await Promise.race([net.catch(() => null), slow]);
        return fresh && fresh.ok ? fresh : saved;
      }
      try {
        return await net;
      } catch {
        const copy = await caches.match(BASE);
        if (copy) return copy;
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
        if (fresh.ok && !isHtml(fresh)) (await caches.open(CACHE)).put(req, fresh.clone());
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
      if (fresh.ok && !isHtml(fresh)) {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    })());
  }
});

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { title: 'The Golf Trip', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(msg.title || 'The Golf Trip', {
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
