import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pwaMiddleware } from '../middleware/pwa.js';

const root = fileURLToPath(new URL('../public', import.meta.url));

test('root worker/manifest/offline HTTP headers and private paths prevent caching', async () => {
  const app = express();
  app.use(pwaMiddleware(root));
  app.use((_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const get = (url, options) => fetch(`http://127.0.0.1:${server.address().port}${url}`, options);
    for (const method of ['GET', 'HEAD']) {
      const sw = await get('/sw.js', { method });
      assert.equal(sw.status, 200);
      assert.match(sw.headers.get('content-type'), /javascript/);
      assert.equal(sw.headers.get('cache-control'), 'no-store');
      assert.equal(sw.headers.get('service-worker-allowed'), '/');
    }
    const manifest = await get('/manifest.webmanifest');
    assert.equal(manifest.status, 200);
    assert.match(manifest.headers.get('content-type'), /manifest\+json/);
    assert.equal(manifest.headers.get('cache-control'), 'no-cache');
    const adminManifest = await get('/admin.webmanifest');
    assert.equal(adminManifest.status, 200);
    assert.match(adminManifest.headers.get('content-type'), /manifest\+json/);
    assert.equal(adminManifest.headers.get('x-robots-tag'), 'noindex, nofollow');
    const offline = await get('/offline.html');
    assert.match(offline.headers.get('x-robots-tag'), /noindex/);
    assert.match(await offline.text(), /Пока нет подключения/);
    for (const url of ['/api/auth/me', '/api/account/orders', '/api/checkout', '/account', '/account/orders', '/admin', '/checkout.html', '/cart.html', '/login']) assert.equal((await get(url)).headers.get('cache-control'), 'no-store');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('manifest links real correctly sized icons and a public same-origin start URL', async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.webmanifest`, 'utf8'));
  assert.equal(manifest.name, 'Сибирские Деликатесы');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const bytes = await readFile(`${root}${icon.src}`);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('shop and authenticated admin templates link their own app; login has no install UI', async () => {
  const files = (await readdir(root)).filter((file) => file.endsWith('.html') && file !== 'offline.html');
  files.push('account/index.html');
  for (const file of files) {
    const html = await readFile(`${root}/${file}`, 'utf8');
    assert.equal((html.match(/rel="manifest"/g) || []).length, 1, file);
    assert.equal((html.match(/src="\/site\/js\/pwa.js"/g) || []).length, 1, file);
    assert.match(html, /apple-touch-icon/);
  }
  const adminRoot = new URL('../admin-pages/', import.meta.url);
  const adminFiles = (await readdir(adminRoot)).filter((file) => file.endsWith('.html'));
  for (const file of adminFiles) {
    const html = await readFile(new URL(file, adminRoot), 'utf8');
    assert.doesNotMatch(html, /src="\/site\/js\/pwa\.js"/, file);
    if (html.includes('data-admin-app')) {
      assert.match(html, /rel="manifest" href="\/admin\.webmanifest"/, file);
      assert.match(html, /src="\/site\/js\/admin-pwa\.js"/, file);
    } else {
      assert.doesNotMatch(html, /rel="manifest"|admin-pwa\.js/, file);
    }
  }
  const css = await readFile(new URL('../site/css/pwa.min.css', import.meta.url), 'utf8');
  assert.equal(css.includes('!important'), false);
  assert.match(css, /prefers-reduced-motion/);
});

test('admin manifest has its own identity, authenticated launch URL and icon sizes', async () => {
  const manifest = JSON.parse(await readFile(`${root}/admin.webmanifest`, 'utf8'));
  assert.equal(manifest.id, '/admin/');
  assert.equal(manifest.scope, '/admin/');
  assert.equal(manifest.start_url, '/admin/');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/pwa\/admin-icon-/);
    const bytes = await readFile(`${root}${icon.src}`);
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
  }
});
