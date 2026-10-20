// Replaces the old app's service worker at the old address. Phones check for a new copy of this file
// when they open the app; this one clears the old saved app and steps aside. It doesn't reload anything:
// the hand-over page does the moving itself.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
  })());
});
