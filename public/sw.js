/* Bump VERSION whenever the offline document or its resources change. */
const VERSION = '11b-1';
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

// UI verifies that the active worker can receive push before subscribing.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SIBDEL_PUSH_VERSION' && event.ports?.[0]) event.ports[0].postMessage({ version: VERSION, push: true });
});

async function notificationDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sibdel-push-received', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('received', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error('Notification storage unavailable'));
  });
}
async function reserveNotification(id) {
  const db = await notificationDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('received', 'readwrite');
      const store = tx.objectStore('received');
      let duplicate = false;
      const get = store.get(id);
      get.onsuccess = () => {
        duplicate = Boolean(get.result);
        if (!duplicate) store.put({ id, at: Date.now() });
      };
      // Bound receipt storage without keeping message contents/URLs/user data.
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (item) { if (item.value.at < Date.now() - 30 * 86400_000) item.delete(); item.continue(); }
      };
      tx.oncomplete = () => resolve(!duplicate);
      tx.onerror = () => reject(Error('Notification storage failure'));
      tx.onabort = () => reject(Error('Notification storage failure'));
    });
  } finally { db.close(); }
}
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json(); } catch { return; }
    if (!Number.isInteger(data?.id) || data.id <= 0 || typeof data.title !== 'string'
      || typeof data.body !== 'string') return;
    // A receipt contains only an ID/time; no offline notification inbox/cache.
    let fresh;
    try { fresh = await reserveNotification(data.id); }
    catch { fresh = !(await self.registration.getNotifications({ tag: `sibdel-${data.id}` })).length; }
    if (!fresh) return;
    await self.registration.showNotification(data.title.slice(0, 80), {
      body: data.body.slice(0, 240), icon: '/pwa/icon-192.png', badge: '/pwa/icon-192.png',
      ...(typeof data.image === 'string' && /^\/(site\/images|uploads\/products)\//.test(data.image) && !data.image.includes('..') ? { image: data.image } : {}),
      tag: `sibdel-${data.id}`, renotify: false,
      data: { id: data.id, url: data.url, openPath: data.openPath },
    });
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data || {};
    let target;
    try { target = new URL(data.url || '/account', self.location.origin); } catch { target = new URL('/account', self.location.origin); }
    const allowed = ['/', '/catalog.html', '/promotions.html', '/product.html', '/subscription.html', '/account', '/account/orders', '/account/order', '/account/subscription'];
    if (target.origin !== self.location.origin || !allowed.includes(target.pathname)) target = new URL('/account', self.location.origin);
    let tracking = Promise.resolve();
    if (Number.isInteger(data.id) && ['/api/push/open','/api/admin/push/open'].includes(data.openPath)) {
      // Actual click, not delivery/open inference. Ownership checked on the server.
      try { tracking = fetch(data.openPath, { signal: AbortSignal.timeout(3000), method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: data.id }) }).catch(() => {}); } catch { /* Offline click cannot be counted. */ }
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url === target.href);
    if (existing) await existing.focus();
    else await self.clients.openWindow(target.href);
    await tracking;
  })());
});
