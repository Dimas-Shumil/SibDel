import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function fixture() {
  const handlers = new Map(), stores = new Map(), calls = [];
  let online = true, httpStatus = 200;
  class WorkerRequest {
    constructor(input, options = {}) {
      Object.assign(this, typeof input === 'string' ? { url: new URL(input, 'https://sib-del.ru').href, method: 'GET' } : input, options);
    }
  }
  const caches = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return { put: async (url, response) => stores.get(name).set(url, response),
        match: async (url) => stores.get(name).get(url)?.clone() };
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
  const self = { location: { origin: 'https://sib-del.ru' }, addEventListener: (name, fn) => handlers.set(name, fn) };
  const fetch = async (request) => {
    calls.push(request);
    if (!online) throw Error('offline');
    return new Response(new URL(request.url).pathname === '/offline.html' ? 'offline shell' : 'network result', { status: httpStatus });
  };
  runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, caches, fetch, Request: WorkerRequest, URL, Response });
  const lifecycle = async (name) => { let work; handlers.get(name)({ waitUntil: (p) => { work = p; } }); await work; };
  const request = (pathname, options = {}) => {
    let result;
    handlers.get('fetch')({ request: { url: new URL(pathname, 'https://sib-del.ru').href, method: 'GET', mode: 'cors', ...options },
      respondWith: (promise) => { result = promise; } });
    return result;
  };
  return { stores, calls, lifecycle, request, offline: () => { online = false; }, status: (n) => { httpStatus = n; }, handlers };
}

test('install caches only the offline allowlist, omits cookies and never forces activation', async () => {
  const f = await fixture();
  await f.lifecycle('install');
  assert.equal(f.stores.size, 1);
  const urls = [...[...f.stores.values()][0].keys()];
  assert.equal(urls.length, 6);
  assert.ok(urls.includes('/offline.html'));
  for (const call of f.calls) {
    assert.equal(call.credentials, 'omit');
    assert.equal(call.cache, 'reload');
    assert.ok(!/^\/(api|account|admin|checkout|cart|catalog)/.test(new URL(call.url).pathname));
  }
  assert.equal(f.handlers.has('message'), true);
  assert.equal(f.handlers.has('push'), true);
});

test('worker bypasses API, admin, uploads, POST, external requests and application JS', async () => {
  const f = await fixture();
  for (const pathname of ['/api/auth/me', '/api/account/orders', '/admin', '/admin/login', '/uploads/products/a.png', '/components/header.html', '/site/js/main.js', '/site/js/admin.js']) {
    assert.equal(f.request(pathname), undefined);
  }
  assert.equal(f.request('/checkout.html', { method: 'POST', mode: 'navigate' }), undefined);
  assert.equal(f.request('https://other.example/a', { mode: 'navigate' }), undefined);
  assert.equal(f.calls.length, 0);
});

test('account, checkout, cart and catalog navigation never cache their network responses', async () => {
  const f = await fixture();
  await f.lifecycle('install');
  const before = [...[...f.stores.values()][0].keys()];
  for (const pathname of ['/account/order?id=1', '/checkout.html', '/cart.html', '/catalog.html']) {
    const response = await f.request(pathname, { mode: 'navigate' });
    assert.equal(await response.text(), 'network result');
    assert.equal(f.calls.at(-1).cache, 'no-store');
  }
  assert.deepEqual([... [...f.stores.values()][0].keys()], before);
  f.offline();
  assert.equal(await (await f.request('/account/order?id=2', { mode: 'navigate' })).text(), 'offline shell');
});

test('offline fallback is generic; HTTP failures stay HTTP failures; no cache yields 503', async () => {
  const f = await fixture();
  f.status(500);
  assert.equal((await f.request('/', { mode: 'navigate' })).status, 500);
  f.offline();
  const response = await f.request('/checkout.html', { mode: 'navigate' });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('activation cleans only this application cache prefix and preserves unrelated origin caches', async () => {
  const f = await fixture();
  await f.lifecycle('install');
  f.stores.set('sibdel-pwa-obsolete', new Map());
  f.stores.set('another-application', new Map());
  await f.lifecycle('activate');
  assert.equal(f.stores.has('sibdel-pwa-obsolete'), false);
  assert.equal(f.stores.has('another-application'), true);
  assert.equal(f.stores.size, 2);
});
