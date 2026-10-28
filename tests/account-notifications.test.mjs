import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { createAccountNotificationService } from '../services/account-notification.service.js';
import { createPushWorker } from '../services/push-worker.service.js';
import { navigationSection } from '../site/js/pwa-navigation.js';

test('customer inbox: actual PostgreSQL history, ownership, pagination and read isolation', async (t) => {
  // Never reads .env or connects to a user-configured database.
  const pg = await PGlite.create();
  const socket = new PGLiteSocketServer({ db: pg, port: 0, host: '127.0.0.1' });
  await socket.start();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://unit@${socket.getServerConn()}/postgres`, max: 1 }) });
  const service = createAccountNotificationService(db);
  const user = () => db.user.create({ data: { role: 'CUSTOMER', email: `${randomUUID()}@unit.invalid`, passwordHash: 'test-only' } });
  const note = (u, data = {}) => db.customerNotification.create({ data: { userId: u.id, eventKey: randomUUID(), category: 'ORDER', title: 'Новый статус', body: 'Проверьте заказ.', url: '/account/orders', ...data } });
  try {
    for (const name of (await readdir(new URL('../prisma/migrations/', import.meta.url))).filter((n) => /^\d/.test(n)).sort()) {
      await pg.exec(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
    }
    const a = await user(), b = await user();
    let first, foreign;
    await t.test('real order event stays in the inbox with no device, disabled PUSH and rejected sends', async () => {
      const order = await db.order.create({ data: { userId: a.id, number: randomUUID(), deliveryMethod: 'PICKUP', customerName: 'private', customerPhone: 'private', subtotal: 100, deliveryPrice: 0, total: 100 } });
      const disabled = createPushWorker(db, () => { throw Error('must not send'); }, { enabled: false });
      await disabled.run();
      const worker = createPushWorker(db, () => { throw Error('no device'); }, { enabled: true });
      await worker.run();
      const result = await service.list(a.id);
      assert.equal(result.notifications.length, 1);
      first = result.notifications[0];
      assert.equal(first.url, `/account/order?id=${order.id}`);
      assert.equal(first.readAt, null);
      assert.equal(await db.pushJob.count(), 0);
      assert.deepEqual(Object.keys(first).sort(), ['id','category','title','body','url','imageUrl','createdAt','readAt'].sort());
    });
    await t.test('descending cursor pages do not repeat rows after a concurrent new message', async () => {
      for (let i = 0; i < 4; i++) await note(a);
      foreign = await note(b, { title: 'PRIVATE OTHER CUSTOMER' });
      await note(a, { category: 'TEST', title: 'OWNER TEST' });
      const p1 = await service.list(a.id, { limit: 2 });
      const fresh = await note(a);
      const p2 = await service.list(a.id, { before: p1.nextCursor, limit: 2 });
      const p3 = await service.list(a.id, { before: p2.nextCursor, limit: 2 });
      const ids = [...p1.notifications, ...p2.notifications, ...p3.notifications].map((n) => n.id);
      assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5);
      assert.ok(!ids.includes(fresh.id)); assert.ok(!ids.includes(foreign.id));
      assert.equal(p3.nextCursor, null);
      assert.equal(p1.unreadCount, 5);
    });
    await t.test('single read is idempotent, cannot touch another customer and never counts a PUSH click', async () => {
      await assert.rejects(service.markRead(a.id, foreign.id), { code: 'NOTIFICATION_NOT_FOUND' });
      const read = await service.markRead(a.id, first.id);
      assert.deepEqual(await service.markRead(a.id, first.id), read);
      assert.equal((await db.customerNotification.findUnique({ where: { id: foreign.id } })).readAt, null);
      assert.equal((await db.customerNotification.findUnique({ where: { id: first.id } })).openedAt, null);
      const ownerTest = await db.customerNotification.findFirst({ where: { userId: a.id, category: 'TEST' } });
      await assert.rejects(service.markRead(a.id, ownerTest.id), { code: 'NOTIFICATION_NOT_FOUND' });
    });
    await t.test('mark-all respects the displayed snapshot and leaves newer/foreign/test messages unread', async () => {
      const snapshot = await service.list(a.id);
      const fresh = await note(a);
      await service.markAllRead(a.id, snapshot.throughId);
      assert.equal(await service.markAllRead(a.id, snapshot.throughId), 0);
      assert.equal(await service.unreadCount(a.id), 1);
      assert.equal((await db.customerNotification.findUnique({ where: { id: fresh.id } })).readAt, null);
      assert.equal(await service.unreadCount(b.id), 1);
      assert.equal((await db.customerNotification.findFirst({ where: { category: 'TEST' } })).readAt, null);
    });
    await t.test('category/unread filters and empty states use only this customer; unsafe stored links are neutralized', async () => {
      const marketing = await note(a, { category: 'MARKETING', url: 'https://evil.invalid', imageUrl: '/uploads/products/../../private.png', title: '<img src=x onerror=alert(1)>' });
      const filtered = await service.list(a.id, { category: 'MARKETING', unread: true });
      assert.equal(filtered.notifications.length, 1);
      assert.equal(filtered.notifications[0].id, marketing.id);
      assert.equal(filtered.notifications[0].url, '/account');
      assert.equal(filtered.notifications[0].imageUrl, null);
      assert.equal((await service.list(b.id, { category: 'MARKETING' })).notifications.length, 0);
      assert.equal((await service.list(b.id, { before: 1 })).notifications.length, 0);
    });
  } finally { await db.$disconnect(); await socket.stop(); await pg.close(); }
});

test('installed navigation maps existing routes and aliases without marking unrelated pages active', () => {
  for (const [path, result] of Object.entries({ '/': 'home', '/index.html': 'home', '/catalog': 'catalog', '/product.html': 'catalog', '/promotions.html': 'promotions', '/cart': 'cart', '/account/notifications': 'profile', '/contacts.html': null })) {
    assert.equal(navigationSection(path), result);
  }
});
