import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID, randomBytes, createECDH } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { createPushService } from '../services/push.service.js';
import { createPushWorker } from '../services/push-worker.service.js';

// A brand-new in-memory PostgreSQL WASM instance. Never uses DATABASE_URL/.env,
// external PostgreSQL, production data, SMTP, or real push endpoints.
test('Web Push migrations, transactional events and Prisma outbox integration', async (t) => {
  const pg = await PGlite.create();
  const socket = new PGLiteSocketServer({ db: pg, port: 0, host: '127.0.0.1' });
  await socket.start();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://unit@${socket.getServerConn()}/postgres`, max: 1 }) });
  const config = { enabled: true, marketingEnabled: true, consentVersion: 'test-v1' };
  const consent = { version: 'test-v1', text: 'Explicit test consent' };
  const service = createPushService(db, config, consent);
  const requests = [];
  const worker = createPushWorker(db, async (device, payload) => { requests.push({ device: device.id, payload }); }, config);
  const user = (role = 'CUSTOMER') => db.user.create({ data: { role, email: `${randomUUID()}@unit.invalid`, passwordHash: 'not-a-real-password-hash' } });
  const session = (u) => db.userSession.create({ data: { userId: u.id, tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 86400_000) } });
  const order = (u, suffix) => db.order.create({ data: { userId: u?.id ?? null, number: randomUUID(), deliveryMethod: 'PICKUP', customerName: 'PRIVATE NAME', customerPhone: 'PRIVATE PHONE', subtotal: 100, deliveryPrice: 0, total: 100 } });
  const subscription = () => { const key = createECDH('prime256v1'); key.generateKeys(); return { endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }; };
  try {
    const migrations = (await readdir(new URL('../prisma/migrations/', import.meta.url))).filter((v) => /^\d/.test(v)).sort();
    for (const name of migrations.filter((n) => n !== '20261028110000_web_push')) {
      await pg.exec(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
    }
    const customer = await user(), other = await user(), owner = await user('OWNER');
    const oldOrder = await order(customer);
    await pg.exec(await readFile(new URL('../prisma/migrations/20261028110000_web_push/migration.sql', import.meta.url), 'utf8'));
    const current = await session(customer), second = await session(other), admin = await session(owner);
    let device;
    await t.test('additive migration preserves old orders/users and does not send historic events', async () => {
      assert.equal((await db.order.findUnique({ where: { id: oldOrder.id } })).number, oldOrder.number);
      assert.equal(await db.user.count(), 3);
      assert.equal(await db.customerNotification.count(), 0);
    });
    await t.test('new order is durable, repeated status is idempotent, rollback leaves no event, guests get none', async () => {
      const created = await order(customer);
      assert.equal(await db.customerNotification.count({ where: { eventKey: `order:${created.id}:NEW` } }), 1);
      await db.order.update({ where: { id: created.id }, data: { status: 'CONFIRMED' } });
      await db.order.update({ where: { id: created.id }, data: { status: 'CONFIRMED' } });
      assert.equal(await db.customerNotification.count({ where: { eventKey: `order:${created.id}:CONFIRMED` } }), 1);
      const count = await db.customerNotification.count();
      await assert.rejects(db.$transaction(async (tx) => { await tx.order.update({ where: { id: created.id }, data: { status: 'ASSEMBLING' } }); throw Error('rollback'); }));
      assert.equal(await db.customerNotification.count(), count);
      await order(null);
      assert.equal(await db.customerNotification.count(), count);
      for (const state of ['ASSEMBLING','READY','DELIVERING','COMPLETED']) await db.order.update({ where: { id: created.id }, data: { status: state } });
      const events = await db.customerNotification.findMany({ where: { userId: customer.id } });
      assert.ok(events.some((e) => e.title === 'Заказ готов к самовывозу'));
      assert.equal(JSON.stringify(events.map((e) => [e.title,e.body])).includes('PRIVATE'), false);
    });
    await t.test('subscription changes are transactionally recorded without duplicating order-created events', async () => {
      const sub = await db.userSubscription.create({ data: { userId: customer.id, intervalDays: 7 } });
      const event = await db.subscriptionEvent.create({ data: { subscriptionId: sub.id, action: 'SUBSCRIPTION_PAUSED', source: 'CUSTOMER' } });
      assert.equal(await db.customerNotification.count({ where: { eventKey: `subscription:${sub.id}:1` } }), 1);
      await db.subscriptionEvent.create({ data: { subscriptionId: sub.id, action: 'SUBSCRIPTION_PAUSED', source: 'CUSTOMER' } });
      assert.equal(await db.customerNotification.count({ where: { eventKey: `subscription:${sub.id}:1` } }), 1);
      const count = await db.customerNotification.count();
      await db.subscriptionEvent.create({ data: { subscriptionId: sub.id, action: 'SUBSCRIPTION_ORDER_CREATED', source: 'WORKER' } });
      assert.equal(await db.customerNotification.count(), count);
      for (const interval of [14,14,7]) {
        await db.userSubscription.update({ where: { id: sub.id }, data: { intervalDays: interval } });
        await db.subscriptionEvent.create({ data: { subscriptionId: sub.id, action: 'SUBSCRIPTION_UPDATED', source: 'CUSTOMER' } });
      }
      assert.equal(await db.customerNotification.count(), count + 2); // change then restore, no duplicate no-op
      for (let repeat=0;repeat<2;repeat++) await db.subscriptionEvent.create({ data: { subscriptionId: sub.id, action: 'SUBSCRIPTION_ORDER_FAILED', source: 'WORKER', metadata: { scheduledFor: '2026-11-01', code: 'OUT_OF_STOCK' } } });
      assert.equal(await db.customerNotification.count(), count + 3);
    });
    await t.test('device requires valid session, cannot be stolen by another customer, never exposes keys', async () => {
      const input = subscription();
      device = await service.subscribe(customer.id, current.id, input);
      assert.equal((await service.subscribe(customer.id, current.id, input)).id, device.id);
      await assert.rejects(service.subscribe(other.id, second.id, input), { code: 'PUSH_BOUND' });
      await assert.rejects(service.subscribe(other.id, current.id, subscription()), { code: 'UNAUTHORIZED' });
      const safe = await service.devices(customer.id, current.id);
      assert.equal(safe[0].current, true);
      assert.equal(JSON.stringify(safe).includes(input.keys.auth), false);
      assert.equal(JSON.stringify(safe).includes(input.endpoint), false);
      await service.unsubscribe(other.id, device.id);
      assert.equal((await db.pushDevice.findUnique({ where: { id: device.id } })).disabledAt, null);
    });
    await t.test('explicit consent stores evidence, repeated grant is idempotent, service prefs cannot imply marketing', async () => {
      await service.setPreferences(customer.id, { orders: true, subscriptions: true });
      assert.equal((await service.preferences(customer.id)).marketing, false);
      await assert.rejects(service.consent(customer.id, current.id, true, 'old'), { code: 'CONSENT_VERSION' });
      await service.consent(customer.id, current.id, true, consent.version);
      await service.consent(customer.id, current.id, true, consent.version);
      assert.equal(await db.pushConsent.count(), 1);
      const evidence = await db.pushConsent.findFirst();
      assert.equal(evidence.text, consent.text); assert.equal(evidence.sessionId, current.id);
    });
    await t.test('worker expands once, claims once across parallel sends and persists accepted status', async () => {
      await worker.expand();
      const jobs = await db.pushJob.findMany({ where: { deviceId: device.id } });
      assert.ok(jobs.length > 0);
      const count = await db.pushJob.count();
      await worker.expand(); assert.equal(await db.pushJob.count(), count);
      await Promise.all([worker.sendJob(jobs[0].id), worker.sendJob(jobs[0].id)]);
      assert.equal(requests.length, 1);
      assert.equal((await db.pushJob.findUnique({ where: { id: jobs[0].id } })).status, 'ACCEPTED');
    });
    await t.test('marketing excludes nonconsenting customers; draft/send/cancel repeated calls cannot duplicate', async () => {
      const input = { requestKey: randomUUID(), title: 'Акция', body: 'Новые предложения', url: '/promotions.html', imageUrl: null, audience: 'ALL' };
      const c = await service.createCampaign(owner.id, input);
      assert.equal((await service.createCampaign(owner.id, input)).id, c.id);
      await service.schedule(owner.id, c.id, null);
      await service.schedule(owner.id, c.id, null);
      await worker.expand(); await worker.expand();
      assert.equal(await db.customerNotification.count({ where: { campaignId: c.id } }), 1);
      const event = await db.customerNotification.findFirst({ where: { campaignId: c.id } });
      assert.equal(event.userId, customer.id);
      const queued = await db.pushJob.findFirst({ where: { notificationId: event.id } });
      await service.consent(customer.id, current.id, false, consent.version);
      assert.equal((await db.pushJob.findUnique({ where: { id: queued.id } })).status, 'SKIPPED');
      assert.equal(await worker.sendJob(queued.id), 'ALREADY_CLAIMED');
      await assert.rejects(service.schedule(owner.id, c.id, null), { code: 'PUSH_STATE' });
      const draft = await service.createCampaign(owner.id, { ...input, requestKey: randomUUID() });
      await service.cancel(owner.id, draft.id); await service.cancel(owner.id, draft.id);
      await assert.rejects(service.schedule(owner.id, draft.id, null), { code: 'PUSH_STATE' });
    });
    await t.test('future campaigns wait; per-customer 24h cap applies; click attribution is isolated', async () => {
      await service.consent(customer.id, current.id, true, consent.version);
      const input = { requestKey: randomUUID(), title: 'Будущая акция', body: 'Позже', url: '/catalog.html', imageUrl: null, audience: 'ALL' };
      const c = await service.createCampaign(owner.id, input);
      await service.schedule(owner.id, c.id, new Date(Date.now() + 7200_000).toISOString());
      await worker.expand();
      assert.equal(await db.customerNotification.count({ where: { campaignId: c.id } }), 0);
      await db.pushCampaign.update({ where: { id: c.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
      await worker.expand();
      assert.equal(await db.customerNotification.count({ where: { campaignId: c.id } }), 0); // daily cap
      const event = await db.customerNotification.findFirst({ where: { userId: customer.id } });
      await service.opened(other.id, event.id);
      assert.equal((await db.customerNotification.findUnique({ where: { id: event.id } })).openedAt, null);
      await service.opened(customer.id, event.id);
      assert.ok((await db.customerNotification.findUnique({ where: { id: event.id } })).openedAt);
      const history = await service.campaigns(1); assert.ok(history.campaigns.length >= 3);
    });
    await t.test('revoked preference/session suppresses service push and logout preserves job history', async () => {
      const fresh = await order(customer); await worker.expand();
      const event = await db.customerNotification.findUnique({ where: { eventKey: `order:${fresh.id}:NEW` } });
      const job = await db.pushJob.findFirst({ where: { notificationId: event.id } });
      await service.setPreferences(customer.id, { orders: false, subscriptions: true });
      assert.equal(await worker.sendJob(job.id), 'SKIPPED');
      await db.userSession.delete({ where: { id: current.id } });
      assert.equal(await db.pushDevice.count({ where: { id: device.id } }), 0);
      assert.equal((await db.pushJob.findUnique({ where: { id: job.id } })).deviceId, null);
    });
    await t.test('owner test targets only current own session; unknown delivery and expired endpoint never retry', async () => {
      const d = await service.subscribe(owner.id, admin.id, subscription());
      const input = { requestKey: randomUUID(), deviceId: d.id, title: 'Тест', body: 'Тест без личных данных', url: '/', imageUrl: null };
      const n = await service.test(owner.id, admin.id, input);
      assert.equal((await service.test(owner.id, admin.id, input)).id, n.id);
      await assert.rejects(service.test(other.id, second.id, { ...input, requestKey: randomUUID() }), { code: 'PUSH_DEVICE' });
      const job = await db.pushJob.findFirst({ where: { notificationId: n.id } });
      let sent = 0;
      const unknown = createPushWorker(db, async () => { sent++; throw Error('private endpoint must not leak'); }, config);
      assert.equal(await unknown.sendJob(job.id), 'UNKNOWN');
      assert.equal(await unknown.sendJob(job.id), 'ALREADY_CLAIMED'); assert.equal(sent, 1);
      await db.customerNotification.update({ where: { id: n.id }, data: { createdAt: new Date(0) } });
      const n2 = await service.test(owner.id, admin.id, { ...input, requestKey: randomUUID() });
      const j2 = await db.pushJob.findFirst({ where: { notificationId: n2.id } });
      const expired = createPushWorker(db, async () => { throw { statusCode: 410 }; }, config);
      assert.equal(await expired.sendJob(j2.id), 'FAILED');
      assert.ok((await db.pushDevice.findUnique({ where: { id: d.id } })).disabledAt);
      assert.equal((await db.pushJob.findUnique({ where: { id: j2.id } })).errorCode, 'EXPIRED_DEVICE');
      await service.unsubscribe(owner.id, d.id);
      assert.equal(await db.pushDevice.findUnique({ where: { id: d.id } }), null);
      assert.equal((await db.pushJob.findUnique({ where: { id: j2.id } })).deviceId, null);
    });
    await t.test('subscriber segment, sender-version change, disabled marketing and interrupted jobs are enforced', async () => {
      const eligible = await user(), excluded = await user();
      const eSession = await session(eligible), xSession = await session(excluded);
      await service.consent(eligible.id, eSession.id, true, consent.version);
      await service.consent(excluded.id, xSession.id, true, consent.version);
      await db.userSubscription.create({ data: { userId: eligible.id, intervalDays: 7, status: 'ACTIVE' } });
      const input = { requestKey: randomUUID(), title: 'Подписчикам', body: 'Предложение', url: '/', imageUrl: null, audience: 'SUBSCRIBERS' };
      const c = await service.createCampaign(owner.id, input);
      await service.schedule(owner.id, c.id, new Date(Date.now() + 4 * 3600_000).toISOString());
      await db.pushCampaign.update({ where: { id: c.id }, data: { scheduledAt: new Date(0) } });
      await worker.expand();
      const recipients = await db.customerNotification.findMany({ where: { campaignId: c.id } });
      assert.deepEqual(recipients.map((n) => n.userId), [eligible.id]);
      const disabled = createPushService(db, { ...config, marketingEnabled: false }, consent);
      await assert.rejects(disabled.consent(excluded.id, xSession.id, true, consent.version), { code: 'PUSH_MARKETING_DISABLED' });
      await disabled.consent(excluded.id, xSession.id, false, consent.version);
      assert.equal((await service.preferences(excluded.id)).marketing, false);
      const changed = createPushService(db, config, { ...consent, version: 'changed-sender' });
      assert.equal((await changed.preferences(eligible.id)).marketing, false);
      const job = await db.pushJob.findFirst();
      await db.pushJob.update({ where: { id: job.id }, data: { status: 'SENDING', attemptedAt: new Date(0) } });
      await worker.expand();
      assert.equal((await db.pushJob.findUnique({ where: { id: job.id } })).errorCode, 'WORKER_INTERRUPTED');
    });
    await t.test('batch gives service jobs priority over earlier marketing jobs and skips stale events', async () => {
      // Only this fresh, disposable database is changed here.
      await db.pushJob.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
      const u = await user(), login = await session(u);
      const d = await service.subscribe(u.id, login.id, subscription());
      await service.consent(u.id, login.id, true, consent.version);
      const make = (category, age = new Date()) => db.customerNotification.create({ data: { userId: u.id, eventKey: randomUUID(), category, title: 'Тест', body: 'Тест', url: '/', queuedAt: new Date(), createdAt: age } });
      const ad = await make('MARKETING'), orderEvent = await make('ORDER');
      const adJob = await db.pushJob.create({ data: { deviceId: d.id, notificationId: ad.id } });
      await db.pushJob.create({ data: { deviceId: d.id, notificationId: orderEvent.id } });
      const result = await worker.run(1);
      assert.equal(result.ACCEPTED, 1);
      assert.equal(requests.at(-1).payload.id, orderEvent.id);
      assert.equal((await db.pushJob.findUnique({ where: { id: adJob.id } })).status, 'PENDING');
      const stale = await make('ORDER', new Date(0));
      const staleJob = await db.pushJob.create({ data: { deviceId: d.id, notificationId: stale.id } });
      assert.equal(await worker.sendJob(staleJob.id), 'SKIPPED');
      assert.equal((await db.pushJob.findUnique({ where: { id: staleJob.id } })).errorCode, 'STALE_NOTIFICATION');
    });
  } finally { await db.$disconnect(); await socket.stop(); await pg.close(); }
});
