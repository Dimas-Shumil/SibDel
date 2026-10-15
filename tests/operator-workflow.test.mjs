import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import * as crypto from 'node:crypto';
import * as dates from '../utils/dates.js';
import * as transactions from '../utils/transactions.js';

async function load(file, imports) {
  const mod = new SourceTextModule(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  await mod.link((name) => {
    const values = imports[name];
    assert.ok(values, `Unexpected import ${name}`);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    });
  });
  await mod.evaluate();
  return mod.namespace;
}
const snapshot = {
  id: 7, number: 'SD-TEST', userId: 2, currency: 'RUB', customerName: '<b>Имя</b>',
  customerEmail: 'customer@example.invalid', customerPhone: '+79990000000',
  deliveryMethod: 'PICKUP', requestedReceiveDate: new Date('2026-10-15'),
  subtotal: 100, discountTotal: 10, deliveryPrice: 0, total: 90, paymentMethod: 'ON_RECEIPT',
  items: [{ productName: 'Товар', sku: 'TEST', quantity: 1, total: 90 }],
};
async function notifications({ order = snapshot, mode = 'development', failAdmin = false, failCustomer = false, failRead = false } = {}) {
  const messages = [], errors = [];
  const service = await load('services/order-notification.service.js', {
    '../lib/prisma.js': { prisma: { order: { findUnique: async () => { if (failRead) throw Error('database'); return order; } } } },
    '../config/env.js': { env: { NODE_ENV: mode, APP_URL: 'https://example.invalid/' } },
    '../lib/logger.js': { logger: { error: (...args) => errors.push(args) } },
    './notification.service.js': {
      sendAdminNotification: async (message) => { messages.push({ kind: 'admin', ...message }); if (failAdmin) throw Error('SMTP'); },
      sendCustomerNotification: async (message) => { messages.push({ kind: 'customer', ...message }); if (failCustomer) throw Error('SMTP'); },
    },
  });
  return { result: await service.notifyOrderCreated(7), messages, errors };
}
test('notifications include order snapshot and correct separate links', async () => {
  const { result, messages } = await notifications({ order: { ...snapshot, subscriptionDelivery: { subscriptionId: 4 } } });
  assert.deepEqual({ ...result }, { sent: 2, failed: 0 });
  assert.match(messages[0].text, /\/admin\/order\?order=SD-TEST/);
  assert.match(messages[1].text, /\/account\/order\?id=SD-TEST/);
  assert.doesNotMatch(messages[1].text, /\/admin\//);
  for (const message of messages) {
    assert.match(message.text, /Подписка #4/);
    assert.match(message.text, /Итого: 90.00 RUB/);
    assert.equal(message.html, undefined);
  }
});
for (const failure of ['failAdmin', 'failCustomer', 'failRead']) test(`notification ${failure} is contained`, async () => {
  const { result, errors } = await notifications({ [failure]: true });
  assert.equal(result.failed, 1);
  assert.ok(errors.length);
  if (failure !== 'failRead') assert.equal(result.sent, 1);
});
test('tests skip SMTP entirely, guests get no account link, missing email skips customer', async () => {
  assert.equal((await notifications({ mode: 'test', failRead: true })).messages.length, 0);
  const guest = await notifications({ order: { ...snapshot, userId: null } });
  assert.doesNotMatch(guest.messages[1].text, /\/account\//);
  assert.equal((await notifications({ order: { ...snapshot, customerEmail: null } })).messages.length, 1);
});

const dueDate = new Date(`${dates.businessDateKey()}T00:00:00.000Z`);
function fixture() {
  const state = { deliveries: new Map(), orders: [], reserves: 0, notified: [], failures: [], attempts: 0, committed: false };
  const subscription = {
    id: 1, userId: 2, status: 'ACTIVE', nextDeliveryAt: dueDate, intervalDays: 7,
    user: { id: 2, email: 'test@example.invalid', isActive: true },
    address: { id: 3, city: 'Абакан', street: 'Тест', house: '1' },
    items: [{ id: 11, product: { id: 8, name: 'Товар', price: 100, sku: 'TEST', unit: 'PIECE' }, quantity: 1 }],
  };
  const tx = {
    userSubscription: { findUnique: async () => subscription, update: async ({ data }) => Object.assign(subscription, data) },
    subscriptionDelivery: {
      findUnique: async ({ where }) => state.deliveries.get(where.subscriptionId_scheduledFor.subscriptionId) || null,
      create: async ({ data }) => {
        if (data.status === 'FAILED') state.failures.push(data);
        const delivery = { ...data, id: 6, order: state.orders.find((o) => o.id === data.orderId) };
        state.deliveries.set(data.subscriptionId, delivery); return delivery;
      },
    },
    order: { findUnique: async () => null, create: async ({ data }) => { const o = { ...data, id: 7 }; state.orders.push(o); return o; } },
    subscriptionItem: { update: async () => {} }, subscriptionEvent: { create: async () => {} },
    adminActivity: { create: async () => {} },
  };
  const prisma = { ...tx, $transaction: async (work) => { state.attempts++; const value = await work(tx); state.committed = true; return value; } };
  return { state, subscription, prisma, tx };
}
async function subscriptions(f) {
  return load('services/subscription.service.js', {
    '../utils/dates.js': dates, 'node:crypto': crypto,
    '../utils/transactions.js': transactions, '../lib/prisma.js': { prisma: f.prisma },
    './order-notification.service.js': { notifyOrderCreated: async (id) => { assert.equal(f.state.committed, true); f.state.notified.push(id); } },
    './commerce.service.js': {
      getCommerceProductSelect: () => ({}), getProductCommerceLimits: () => ({ available: true, max: 100 }),
      normalizeCommerceQuantity: (v) => v, serializeCommerceItem() {},
    },
    './inventory.service.js': { reserveInventoryForOrder: async () => { f.state.reserves++; } },
    './promotion.service.js': { applyActivePromotionsToProducts: async (products) => products.map((p) => ({ ...p, price: 90, oldPrice: 100 })) },
    './delivery.service.js': { quoteDelivery: async () => ({ deliveryPrice: 50, snapshot: { method: 'DELIVERY' } }), moneyToKopecks: (v) => Math.round(v * 100), kopecksToRubles: (v) => v / 100 },
  });
}
test('subscription generation uses promoted price/delivery; replay has no effects or notifications', async () => {
  const f = fixture(), service = await subscriptions(f);
  assert.equal((await service.generateSubscriptionOrder({ subscriptionId: 1, scheduledFor: dueDate })).created, true);
  assert.equal(f.state.orders[0].total, '140.00');
  assert.equal(f.state.orders[0].discountTotal, '10.00');
  assert.equal((await service.generateSubscriptionOrder({ subscriptionId: 1, scheduledFor: dueDate })).created, false);
  assert.equal(f.state.reserves, 1);
  assert.deepEqual(f.state.notified, [7]);
});
for (const status of ['PAUSED', 'CANCELLED']) test(`${status} subscription creates no order or reservation`, async () => {
  const f = fixture(); f.subscription.status = status;
  const service = await subscriptions(f);
  await assert.rejects(service.generateSubscriptionOrder({ subscriptionId: 1 }), { code: 'SUBSCRIPTION_NOT_ACTIVE' });
  assert.equal(f.state.orders.length, 0); assert.equal(f.state.reserves, 0);
});
test('future generation is rejected without consuming occurrence', async () => {
  const f = fixture(); f.subscription.nextDeliveryAt = new Date('2099-01-01');
  await assert.rejects((await subscriptions(f)).generateSubscriptionOrder({ subscriptionId: 1 }), { code: 'SUBSCRIPTION_NOT_DUE' });
  assert.equal(f.state.failures.length, 0);
});
for (const conflict of [{ code: 'P2034' }, { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40001' } } } }]) {
  test(`subscription retries ${conflict.code} before notification`, async () => {
    const f = fixture(), original = f.prisma.$transaction; let first = true;
    f.prisma.$transaction = async (...args) => { if (first) { first = false; throw Object.assign(Error('conflict'), conflict); } return original(...args); };
    assert.equal((await (await subscriptions(f)).generateSubscriptionOrder({ subscriptionId: 1 })).created, true);
    assert.equal(f.state.reserves, 1); assert.deepEqual(f.state.notified, [7]);
  });
}
test('database outage does not record failed delivery or advance due date', async () => {
  const f = fixture(); f.prisma.$transaction = async () => { throw Object.assign(Error('offline'), { code: 'P1001' }); };
  await assert.rejects((await subscriptions(f)).generateSubscriptionOrder({ subscriptionId: 1, scheduledFor: dueDate }), { code: 'P1001' });
  assert.equal(f.state.failures.length, 0); assert.equal(f.subscription.nextDeliveryAt, dueDate);
});
test('batch continues after business failure and reports it', async () => {
  const f = fixture(); f.subscription.items = [];
  f.prisma.userSubscription.findMany = async () => [{ id: 1, nextDeliveryAt: dueDate }, { id: 2, nextDeliveryAt: dueDate }];
  f.tx.userSubscription.findUnique = async ({ where }) => where.id === 1 ? { ...f.subscription, nextDeliveryAt: dueDate } : { ...f.subscription, status: 'PAUSED' };
  const summary = await (await subscriptions(f)).generateDueSubscriptionOrders();
  assert.equal(summary.checked, 2); assert.equal(summary.failed, 2);
  assert.equal(summary.results[0].code, 'SUBSCRIPTION_EMPTY');
  assert.equal(summary.results[1].code, 'SUBSCRIPTION_NOT_ACTIVE');
  assert.equal(f.state.failures.length, 1);
});

test('exhausted raw SQL conflicts leave occurrence due and never notify', async () => {
  const f = fixture(); let attempts = 0;
  f.prisma.$transaction = async () => { attempts++; throw Object.assign(Error('serialization'), { code: 'P2010', meta: { code: '40001' } }); };
  await assert.rejects((await subscriptions(f)).generateSubscriptionOrder({ subscriptionId: 1, scheduledFor: dueDate }), { code: 'P2010' });
  assert.equal(attempts, 3); assert.equal(f.state.failures.length, 0);
  assert.deepEqual(f.state.notified, []); assert.equal(f.subscription.nextDeliveryAt, dueDate);
});

test('operator detail reads only this order audit and exposes subscription without secrets', async () => {
  const service = await load('services/order.service.js', {
    '../utils/transactions.js': transactions,
    '../lib/prisma.js': { prisma: {
      order: { findFirst: async ({ include }) => { assert.ok(include.subscriptionDelivery); return { ...snapshot, status: 'NEW', subscriptionDelivery: { subscriptionId: 3, scheduledFor: dueDate } }; } },
      adminActivity: { findMany: async (query) => {
        assert.deepEqual({ ...query.where }, { entityType: 'Order', entityId: '7' });
        assert.equal(query.take, 100);
        assert.equal(query.select.actor.select.email, true);
        return [{ id: 1, description: 'Изменён статус', createdAt: dueDate, actor: { firstName: 'Оператор' }, metadata: { reason: '<script>тест</script>', secret: 'hidden' } },
          { id: 2, actorId: 5, actor: { firstName: null, lastName: null, email: 'operator@example.invalid' } },
          { id: 3, actorId: 6, actor: null },
          { id: 4, actorId: null, actor: null }];
      } },
    } },
    './inventory.service.js': { commitInventoryForOrder() {}, releaseInventoryForOrder() {} },
  });
  const order = await service.getAdminOrder('SD-TEST');
  assert.equal(order.subscriptionDelivery.subscriptionId, 3);
  assert.equal(order.history[0].actorName, 'Оператор');
  assert.equal(order.history[0].reason, '<script>тест</script>');
  assert.equal(order.history[0].metadata, undefined);
  assert.equal(order.history[1].actorName, 'operator@example.invalid');
  assert.equal(order.history[2].actorName, 'Оператор #6');
  assert.equal(order.history[3].actorName, 'Система');
});


test('batch creates the next subscription order after a failed entry', async () => {
  const f = fixture();
  f.prisma.userSubscription.findMany = async () => [{ id: 99, nextDeliveryAt: dueDate }, { id: 1, nextDeliveryAt: dueDate }];
  f.tx.userSubscription.findUnique = async ({ where }) => where.id === 99 ? null : f.subscription;
  const result = await (await subscriptions(f)).generateDueSubscriptionOrders();
  assert.equal(result.failed, 1); assert.equal(result.created, 1);
  assert.equal(result.results[1].created, true);
  assert.deepEqual(f.state.notified, [7]);
});
