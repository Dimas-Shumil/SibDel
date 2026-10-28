/* Bump VERSION whenever the offline document or its resources change. */
const VERSION = '11a-1';
const PREFIX = 'sibdel-pwa-';
const CACHE = `${PREFIX}${VERSION}`;
// Exhaustive allowlist. No runtime cache, application JS, prices or user data.
const OFFLINE_ASSETS = [
  '/offline.html', '/site/css/pwa.min.css', '/pwa/icon-192.png',
  '/pwa/icon-512.png', '/pwa/maskable-512.png', '/pwa/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const responses = await Promise.all(OFFLINE_ASSETS.map(async (url) => {
      const response = await fetch(new Request(url, { cache: 'reload', credentials: 'omit' }));
      if (!response.ok || response.redirected) throw new Error('Offline resource unavailable');
      return response;
    }));
    const cache = await caches.open(CACHE);
    await Promise.all(OFFLINE_ASSETS.map((url, index) => cache.put(url, responses[index])));
  })());
  // No skipWaiting/claim: updates must not replace a worker mid-checkout,
  // including when checkout is open in another tab.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE)
      .map((name) => caches.delete(name)));
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Root scope is needed for installation. These paths always bypass the SW.
  if (/^\/(?:api|admin|uploads|components)(?:\/|$)/.test(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Network only: neither HTTP cache nor CacheStorage may serve old pages.
        return await fetch(new Request(request, { cache: 'no-store' }));
      } catch {
        const cached = await (await caches.open(CACHE)).match('/offline.html');
        return cached || new Response('Нет подключения. Повторите попытку позже.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
    })());
    return;
  }
  if (!url.search && OFFLINE_ASSETS.includes(url.pathname)) {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })).catch(async () => {
      const cached = await (await caches.open(CACHE)).match(url.pathname);
      return cached || Response.error();
    }));
  }
});
