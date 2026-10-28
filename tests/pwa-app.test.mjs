import test from 'node:test';
import assert from 'node:assert/strict';

// Only unauthenticated, non-database routes are exercised. Never load user .env
// credentials, never import server.js (which connects to PostgreSQL/SMTP).
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/sibdel_stage11_test',
  APP_URL: 'http://127.0.0.1:3001', SESSION_SECRET: 'unit-test-only-'.repeat(6),
  SMTP_HOST: 'unit.invalid', SMTP_USER: 'unit@example.invalid', SMTP_PASS: 'unit-test-only',
  TO_EMAIL: 'unit@example.invalid', LOG_LEVEL: 'silent',
});

test('real Express app boots and serves PWA with CSP before SEO/static; private endpoints stay protected', async () => {
  const { default: app } = await import('../app.js');
  const { prisma } = await import('../lib/prisma.js');
  const { closeMailConnection } = await import('../config/mail.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const get = (url) => fetch(`http://127.0.0.1:${server.address().port}${url}`, { redirect: 'manual' });
    const home = await get('/');
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /rel="manifest"/);
    assert.match(html, /src="\/site\/js\/pwa.js"/);
    assert.match(home.headers.get('content-security-policy'), /worker-src 'self'/);
    assert.match(home.headers.get('content-security-policy'), /manifest-src 'self'/);
    assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await get('/sw.js')).headers.get('service-worker-allowed'), '/');
    assert.equal((await get('/manifest.webmanifest')).status, 200);
    assert.equal((await get('/offline.html')).headers.get('x-robots-tag'), 'noindex, nofollow');
    for (const url of ['/api/auth/me', '/api/account/sessions']) {
      const response = await get(url);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const admin = await get('/admin');
    assert.equal(admin.status, 302);
    assert.equal(admin.headers.get('location'), '/admin/login');
    assert.equal((await get('/account')).headers.get('cache-control'), 'no-store');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeMailConnection();
    await prisma.$disconnect();
  }
});
