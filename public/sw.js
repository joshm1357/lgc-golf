// Service worker: only shows phone notifications. It doesn't cache the app,
// so updates still arrive the normal way (the "New version ready" banner).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { title: 'L.G.C', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(msg.title || 'L.G.C', {
    body: msg.body || '',
    icon: '/lgc-golf/brand/icon-192.png',
    badge: '/lgc-golf/brand/icon-192.png',
    tag: msg.tag,
    data: { url: msg.url || '/lgc-golf/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/lgc-golf/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.includes('/lgc-golf/')) {
        await w.focus();
        try { await w.navigate(url); } catch { /* some browsers refuse; the focus is enough */ }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
