import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import sharp from 'sharp';

// Isolated PostgreSQL WASM database; never reads or changes a real project's DB.
test('production cards: migrations, API, real Prisma transactions, permissions and images', async () => {
  const pg = await PGlite.create();
  const socket = new PGLiteSocketServer({ db: pg, port: 0, host: '127.0.0.1' });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://test@${socket.getServerConn()}/postgres`;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'isolated-production-cards-test-secret-'.repeat(3);
  process.env.APP_URL = 'http://127.0.0.1:3001';
  Object.assign(process.env, { SMTP_HOST: 'smtp.invalid', SMTP_USER: 'test', SMTP_PASS: 'test', TO_EMAIL: 'test@example.invalid' });
  let prisma;
  let server;
  let uploaded;
  const uploadedCategoryImages = [];
  try {
    // PGlite supports one backend connection. Keep real Prisma/pg queries,
    // but configure its pool to one connection for this isolated test only.
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const connect = PrismaPg.prototype.connect;
    PrismaPg.prototype.connect = function () {
      this.config = { ...this.config, max: 1 };
      return connect.call(this);
    };
    try {
      ({ prisma } = await import('../lib/prisma.js'));
      await prisma.$connect();
    } finally { PrismaPg.prototype.connect = connect; }
    const migrations = (await readdir(new URL('../prisma/migrations/', import.meta.url))).filter(n => /^\d/.test(n)).sort();
    for (const migration of migrations) {
      if (migration === '20261108140000_home_production_cards') await pg.exec(`INSERT INTO "Category" ("name", "slug", "updatedAt") VALUES ('Существующая категория', 'existing-category', CURRENT_TIMESTAMP)`);
      await pg.exec(await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8'));
    }
    assert.equal((await prisma.category.findUnique({ where: { slug: 'existing-category' } })).name, 'Существующая категория');
    assert.equal(await prisma.productionCard.count(), 5);
    const { hashSessionToken } = await import('../services/auth.service.js');
    const { authConfig } = await import('../config/auth.js');
    const cookies = {};
    for (const role of ['OWNER', 'STAFF', 'CUSTOMER']) {
      const user = await prisma.user.create({ data: { email: role + '@test.invalid', passwordHash: 'unused', role } });
      const token = role.toLowerCase().repeat(24);
      await prisma.userSession.create({ data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) } });
      cookies[role] = `${authConfig.adminSessionCookieName}=${token}`;
    }
    const app = (await import('../app.js')).default;
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, { role = 'OWNER', method = 'GET', body, origin = process.env.APP_URL } = {}) {
      const response = await fetch(base + path, { method, headers: { ...(role ? { Cookie: cookies[role] } : {}), Origin: origin, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
      return { status: response.status, data: await response.json() };
    }
    const api = '/api/admin/catalog/production-cards';
    const publicCards = async () => (await request('/api/production-cards', { role: null })).data.cards;
    assert.equal((await publicCards()).length, 5);
    assert.equal((await request(api, { role: null })).status, 401);
    assert.equal((await request(api, { role: 'CUSTOMER' })).status, 401);
    assert.equal((await request(api, { role: 'STAFF' })).status, 200);
    const categoryApi = '/api/admin/catalog/categories';
    const categoryFile = async (buffer, name = 'category.png', type = 'image/png') => {
      const body = new FormData(); body.append('image', new Blob([buffer], { type }), name); return body;
    };
    assert.equal((await request(categoryApi + '/image', { method: 'POST', role: null, body: await categoryFile('bad') })).status, 401);
    assert.equal((await request(categoryApi + '/image', { method: 'POST', role: 'CUSTOMER', body: await categoryFile('bad') })).status, 401);
    assert.equal((await request(categoryApi + '/image', { method: 'POST', body: await categoryFile('bad') })).status, 400);
    assert.equal((await request(categoryApi + '/image', { method: 'POST', body: await categoryFile('<svg/>', 'test.svg', 'image/svg+xml') })).status, 400);
    assert.equal((await request(categoryApi + '/image', { method: 'POST', body: await categoryFile(new Uint8Array(8 * 1024 * 1024 + 1)) })).status, 413);
    const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#667733' } }).png().toBuffer();
    assert.equal((await request(categoryApi + '/image', { method: 'POST', origin: 'https://evil.test', body: await categoryFile(png) })).status, 403);
    const categoryImage = await request(categoryApi + '/image', { method: 'POST', role: 'STAFF', body: await categoryFile(png) });
    assert.equal(categoryImage.status, 201);
    uploadedCategoryImages.push(categoryImage.data.imageUrl);
    const categoryImageUrl = categoryImage.data.imageUrl;
    assert.match(categoryImageUrl, /^\/uploads\/categories\/[0-9a-f-]+\.webp$/);
    const servedImage = await fetch(base + categoryImageUrl);
    assert.equal(servedImage.status, 200);
    assert.equal((await sharp(Buffer.from(await servedImage.arrayBuffer())).metadata()).format, 'webp');
    const catBody = { name: 'Категория с фото', slug: 'category-with-photo', description: null, imageUrl: categoryImageUrl, sortOrder: 12, isActive: true, isFeatured: true };
    const catCreate = await request(categoryApi, { method: 'POST', role: 'STAFF', body: catBody });
    assert.equal(catCreate.status, 201);
    const catId = catCreate.data.category.id;
    const categoryResponse = await request('/api/categories', { role: null });
    assert.equal(categoryResponse.status, 200);
    const publicCategory = categoryResponse.data.categories.find(c => c.id === catId);
    assert.equal(publicCategory.imageUrl, categoryImageUrl);
    assert.equal(publicCategory.isFeatured, true);
    assert.equal(publicCategory.slug, 'category-with-photo');
    assert.equal((await publicCards()).length, 5); // no automatic production card
    const catEdit = await request(categoryApi + '/' + catId, { method: 'PATCH', body: { name: 'Фото сохранено', imageUrl: categoryImageUrl } });
    assert.equal(catEdit.status, 200);
    for (const imageUrl of ['https://evil.test/img.webp', 'javascript:alert(1)', '/uploads/../image.webp', '/uploads/%2e%2e/image.webp', '//evil.test/img.webp']) {
      assert.equal((await request(categoryApi + '/' + catId, { method: 'PATCH', body: { imageUrl } })).status, 400);
    }
    assert.equal((await request(categoryApi + '/' + catId, { method: 'PATCH', body: { imageUrl: null } })).data.category.imageUrl, null);
    assert.equal((await request(categoryApi + '/' + catId, { method: 'DELETE' })).status, 200);

    const category = await prisma.category.create({ data: { name: 'Тестовая категория', slug: 'actual-slug', isFeatured: false } });
    const body = { name: 'Новая карточка', imageUrl: '/site/images/production/bakery.webp', categoryId: category.id, pagePath: null, isActive: true, sortOrder: -10 };
    const created = await request(api, { method: 'POST', body, role: 'STAFF' });
    assert.equal(created.status, 201);
    const id = created.data.card.id;
    assert.equal((await publicCards())[0].href, '/catalog.html?category=actual-slug');
    await prisma.category.update({ where: { id: category.id }, data: { slug: 'changed-slug' } });
    assert.equal((await publicCards())[0].href, '/catalog.html?category=changed-slug');
    await prisma.category.update({ where: { id: category.id }, data: { isActive: false } });
    assert.equal((await publicCards()).length, 5);
    assert.equal((await request(api, { method: 'POST', body })).status, 400);
    await prisma.category.delete({ where: { id: category.id } });
    assert.equal((await publicCards()).length, 5);
    for (const patch of [{ pagePath: 'javascript:alert(1)', categoryId: null }, { pagePath: '//evil.test', categoryId: null }, { imageUrl: '/uploads/../secret' }, { imageUrl: 'https://evil.test/a.jpg' }, { isActive: 'true' }, { sortOrder: 0.1 }]) {
      assert.equal((await request(api + '/' + id, { method: 'PUT', body: { ...body, ...patch } })).status, 400);
    }
    assert.equal((await request(api, { method: 'POST', body, origin: 'https://evil.test' })).status, 403);
    const updated = { ...body, categoryId: null, pagePath: '/production.html', isActive: false };
    assert.equal((await request(api + '/' + id, { method: 'PUT', body: updated })).status, 200);
    assert.equal((await publicCards()).length, 5);
    const badFile = new FormData(); badFile.append('image', new Blob(['not an image'], { type: 'image/png' }), 'bad.png');
    assert.equal((await request(api + '/image', { method: 'POST', body: badFile })).status, 400);
    const svg = new FormData(); svg.append('image', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'bad.svg');
    assert.equal((await request(api + '/image', { method: 'POST', body: svg })).status, 400);
    const goodFile = new FormData(); goodFile.append('image', new Blob([await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } }).png().toBuffer()], { type: 'image/png' }), 'good.png');
    const image = await request(api + '/image', { method: 'POST', body: goodFile });
    assert.equal(image.status, 201); uploaded = image.data.imageUrl;
    assert.equal((await fetch(base + uploaded)).status, 200);
    assert.equal((await request(api + '/' + id, { method: 'PUT', body: { ...updated, imageUrl: uploaded, isActive: true } })).status, 200);
    assert.equal((await publicCards())[0].imageUrl, uploaded);
    assert.equal((await request(api + '/' + id, { method: 'DELETE', role: 'STAFF' })).status, 403);
    assert.equal((await request(api + '/' + id, { method: 'DELETE' })).status, 200);
    assert.equal(await prisma.productionCard.count(), 5);
    assert.equal(await prisma.adminActivity.count({ where: { entityType: 'ProductionCard' } }), 4);
    assert.equal(await prisma.category.count(), 1);
    const { mutateProductionCard } = await import('../services/production-cards.service.js');
    await assert.rejects(mutateProductionCard(null, updated, -1));
    assert.equal(await prisma.productionCard.count(), 5);
  } catch (error) { console.error(error); throw error; } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma?.$disconnect(); await socket.stop(); await pg.close();
    for (const image of uploadedCategoryImages) await unlink(new URL('..' + image, import.meta.url)).catch(() => {});
    if (uploaded) await unlink(new URL('..' + uploaded, import.meta.url)).catch(() => {});
  }
});
