// Service worker: phone notifications + opening the app with no signal.
//
// Offline rules (kept deliberately simple so updates are never blocked):
//   - The page itself (index.html): try the network first; if there's no signal, use the copy
//     saved last time. So a new version always wins when there's signal.
//   - The app's code/styles/icons (/assets/…, /brand/…): their file names change with every
//     release, so a saved copy is always the right one — use it, fetch it once otherwise.
//   - Everything else (the database, maps, photos) goes straight to the network, untouched.
//     Scores entered offline are queued by the app itself and sent when signal returns.
const CACHE = 'lgc-shell-v1';
const BASE = '/lgc-golf/';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([BASE, `${BASE}manifest.webmanifest`, `${BASE}brand/icon-192.png`]).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  const isPage = req.mode === 'navigate' || url.pathname === BASE || url.pathname.endsWith('/index.html');
  if (isPage) {
    // The "new version" check asks for a fresh copy — never answer it from the cache unless offline.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh.ok && req.mode === 'navigate') {
          const c = await caches.open(CACHE);
          await c.put(BASE, fresh.clone());
        }
        return fresh;
      } catch {
        const saved = await caches.match(BASE);
        if (saved) return saved;
        throw new Error('offline');
      }
    })());
    return;
  }

  if (url.pathname.startsWith(`${BASE}assets/`) || url.pathname.startsWith(`${BASE}brand/`) || url.pathname.endsWith('.webmanifest')) {
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
