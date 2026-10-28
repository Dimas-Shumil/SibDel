// Emergency rollback worker. Serve these bytes at /sw.js; NEVER at another URL.
self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('sibdel-pwa-')) await caches.delete(name);
    }
    await self.registration.unregister();
  })());
});
// No fetch handler, claim or forced client reload.
