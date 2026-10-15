import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { runSerializable } from '../utils/transactions.js';

// Evaluate real service modules with a substituted database; no env or DB access.
async function services(prisma, replacements = {}) {
  const cache = new Map();
  const mocks = {
    'services/order-notification.service.js': { notifyOrderCreated: async () => {} },
    'lib/prisma.js': { prisma },
    'config/commerce.js': { commerceConfig: {}, getClearGuestCommerceCookieOptions() {}, getGuestCommerceCookieOptions() {} },
    'utils/tokens.js': { generateOpaqueToken() {}, hashOpaqueToken() {} },
    ...replacements,
  };
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    const key = url.pathname.slice(new URL('../', import.meta.url).pathname.length);
    const values = mocks[key];
    const mod = values
      ? new SyntheticModule(Object.keys(values), function () {
          for (const [name, value] of Object.entries(values)) this.setExport(name, value);
        }, { identifier: url.href })
      : new SourceTextModule(await readFile(url, 'utf8'), { identifier: url.href });
    cache.set(url.href, mod);
    await mod.link((specifier) => load(new URL(specifier, url)));
    return mod;
  }
  return async (name) => {
    const mod = await load(new URL(`../services/${name}.service.js`, import.meta.url));
    if (mod.status !== 'evaluated') await mod.evaluate();
    return mod.namespace;
  };
}
const product = (id, price, extra = {}) => ({
  id, price, slug: `p${id}`, name: `Product ${id}`, oldPrice: null,
  category: { id: 1, isActive: true }, isActive: true, isAvailable: true,
  minQuantity: 0.3, step: 0.2, stockQuantity: 2, reservedQuantity: 0.8,
  images: [], ...extra,
});
const now = new Date('2026-10-15T10:00:00Z');
const promotion = (extra = {}) => ({
  id: 1, status: 'ACTIVE', type: 'PERCENT', discountValue: 50,
  startsAt: new Date('2020-01-01'), endsAt: new Date('2099-01-01'),
  products: [{ productId: 1 }], categories: [], ...extra,
});
function pricingDB(products, promotions = [promotion()]) {
  return {
    product: {
      findMany: async ({ where, skip = 0, take }) => {
        assert.equal(where.isActive, true);
        assert.equal(where.category.isActive, true);
        assert.equal(where.price, undefined);
        assert.equal(where.oldPrice, undefined);
        return products.slice(skip, take === undefined ? undefined : skip + take);
      }, count: async () => products.length,
    },
    review: { findMany: async () => [] },
    promotion: { findMany: async ({ where }) => promotions.filter((p) =>
      p.status === where.status && p.startsAt <= where.startsAt.lte && p.endsAt > where.endsAt.gt) },
  };
}
const query = { page: 1, limit: 1, sort: 'price-asc' };

test('effective price filter precedes count and pagination; ties use ID', async () => {
  const load = await services(pricingDB([product(1, 200), product(2, 150), product(3, 100)]));
  const { getPublicCatalog } = await load('catalog');
  const first = await getPublicCatalog({ ...query, priceFrom: 100, priceTo: 100 });
  assert.equal(first.pagination.total, 2);
  assert.equal(first.pagination.totalPages, 2);
  assert.equal(first.products[0].id, 1);
  assert.equal(Number(first.products[0].price), 100);
  const second = await getPublicCatalog({ ...query, priceFrom: 100, priceTo: 100, page: 2 });
  assert.equal(second.products[0].id, 3);
  assert.equal(second.pagination.hasMore, false);
  assert.equal((await getPublicCatalog({ ...query, priceTo: 99 })).pagination.total, 0);
});

test('discount filter includes Promotions and excludes equal/lower oldPrice', async () => {
  const load = await services(pricingDB([product(1, 200), product(2, 150, { oldPrice: 100 }), product(3, 100, { oldPrice: 100 })]));
  const result = await (await load('catalog')).getPublicCatalog({ ...query, discount: true });
  assert.equal(result.pagination.total, 1);
  assert.equal(result.products[0].id, 1);
});

test('descending price and discount sort use effective prices and relative savings', async () => {
  const load = await services(pricingDB([product(1, 200), product(2, 150), product(3, 100, { oldPrice: 110 })]));
  const { getPublicCatalog } = await load('catalog');
  assert.equal((await getPublicCatalog({ ...query, sort: 'price-desc' })).products[0].id, 2);
  assert.equal((await getPublicCatalog({ ...query, sort: 'discount' })).products[0].id, 1);
});

test('promotion starts inclusively and ends exclusively; paused/future excluded', async () => {
  for (const [changes, expected] of [
    [{ startsAt: now }, 100], [{ endsAt: now }, 200],
    [{ startsAt: new Date(now.getTime() + 1) }, 200], [{ status: 'PAUSED' }, 200],
  ]) {
    const load = await services(pricingDB([], [promotion(changes)]));
    const result = await (await load('promotion')).applyActivePromotionsToProducts([product(1, 200)], undefined, now);
    assert.equal(Number(result[0].price), expected);
  }
});

test('best targeted/global/category promotion; zero price is a real discount', async () => {
  const load = await services(pricingDB([], [promotion(), promotion({ id: 2, type: 'FIXED', discountValue: 500, products: [], categories: [{ categoryId: 1 }] })]));
  const priced = await (await load('promotion')).applyActivePromotionsToProducts([product(1, 200)], undefined, now);
  const summary = (await load('product')).serializeProductSummary(priced[0]);
  assert.equal(Number(summary.price), 0);
  assert.equal(summary.badge.label, '-100%');
});

test('quantity limits subtract reserve and remain on minimum/step grid', async () => {
  const load = await services({});
  const { getProductCommerceLimits, normalizeCommerceQuantity } = await load('commerce');
  const p = product(1, 200);
  const limits = getProductCommerceLimits(p);
  assert.equal(limits.max, 1.1);
  assert.equal(normalizeCommerceQuantity(1.2, p), 1.1);
  assert.equal(normalizeCommerceQuantity(0.3, p), 0.3);
  for (const patch of [{ stockQuantity: 1 }, { isActive: false }, { category: { isActive: false } }, { isAvailable: false }]) {
    assert.equal(getProductCommerceLimits({ ...p, ...patch }).available, false);
  }
  assert.equal((await load('product')).serializeProductSummary({ ...p, stockQuantity: 1 }).isAvailable, false);
});

test('favorites and cart expose the same promoted prices and available limits', async () => {
  const p = product(1, 200);
  const db = pricingDB([]);
  db.favorite = { findMany: async () => [{ product: p }] };
  db.cart = { findFirst: async () => ({ items: [{ product: p, productId: 1, quantity: 0.3 }] }) };
  const load = await services(db);
  const owner = { type: 'user', userId: 1 };
  const favorites = await (await load('favorite')).getFavorites(owner);
  const cart = await (await load('cart')).getCart(owner);
  assert.equal(favorites.items[0].unitPrice, 100);
  assert.equal(cart.items[0].unitPrice, 100);
  assert.equal(favorites.items[0].max, 1.1);
  assert.equal(cart.summary.total, 30);
});

test('retry is bounded and never retries unknown commit result or business errors', async () => {
  for (const code of ['P2034', 'P2002', 'P2028', 'STOCK_BELOW_RESERVED']) {
    let attempts = 0;
    await assert.rejects(runSerializable({ $transaction: async () => {
      attempts++; throw Object.assign(new Error(code), { code });
    } }, () => {}), { code });
    assert.equal(attempts, code === 'P2034' ? 3 : 1);
  }
});

function rollbackDB(initial, conflict = { code: 'P2034' }) {
  let state = structuredClone(initial);
  let calls = 0;
  return {
    state: () => state,
    $transaction: async (work, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      const draft = structuredClone(state);
      const tx = {
        $queryRaw: async () => [draft.product],
        product: { update: async ({ data }) => Object.assign(draft.product, data) },
        inventoryMovement: { create: async ({ data }) => { draft.movements.push(data); } },
        adminActivity: { create: async ({ data }) => { draft.activities.push(data); } },
        order: {
          findFirst: async () => draft.order,
          findUnique: async () => draft.order,
          update: async ({ data }) => Object.assign(draft.order, data),
        },
      };
      const result = await work(tx);
      if (++calls === 1) throw Object.assign(new Error('serialization rollback'), conflict);
      state = draft;
      return result;
    },
  };
}

test('stock receipt/adjustment retry commits exactly one movement and activity', async () => {
  for (const conflict of [{ code: 'P2034' }, { code: 'P2010', meta: { code: '40001' } }, { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40001', kind: 'TransactionWriteConflict' } } } }]) {
  for (const method of ['receiveInventory', 'adjustInventory']) {
    const db = rollbackDB({ product: product(1, 100, { stockQuantity: 10, reservedQuantity: 2 }), movements: [], activities: [] }, conflict);
    const service = await (await services(db))('inventory');
    await service[method]({ productId: 1, actorId: 1, quantity: 3, stockQuantity: 13, reason: 'Test' });
    assert.equal(Number(db.state().product.stockQuantity), 13);
    assert.equal(db.state().movements.length, 1);
    assert.equal(db.state().activities.length, 1);
  }
  }
});

test('order completion/cancellation retry commits once; same status replay does nothing', async () => {
  for (const nextStatus of ['COMPLETED', 'CANCELLED']) {
    const db = rollbackDB({ order: { id: 1, number: 'T1', status: 'READY', items: [], inventoryReservations: [] }, movements: [], activities: [] });
    const inventory = {
      commitInventoryForOrder: async (tx) => tx.inventoryMovement.create({ data: { type: 'COMMIT' } }),
      releaseInventoryForOrder: async (tx) => tx.inventoryMovement.create({ data: { type: 'RELEASE' } }),
    };
    const service = await (await services(db, { 'services/inventory.service.js': inventory }))('order');
    await service.updateOrderStatus({ orderKey: '1', nextStatus, actorId: 1 });
    await service.updateOrderStatus({ orderKey: '1', nextStatus, actorId: 1 });
    assert.equal(db.state().order.status, nextStatus);
    assert.equal(db.state().movements.length, 1);
    assert.equal(db.state().activities.length, 1);
  }
});

test('decimal subtraction does not hide a purchasable minimum', async () => {
  const load = await services({});
  const p = product(1, 10, { stockQuantity: 1.2, reservedQuantity: 0.9 });
  assert.equal((await load('commerce')).getProductCommerceLimits(p).available, true);
  const summary = (await load('product')).serializeProductSummary(p);
  assert.equal(summary.isAvailable, true);
  assert.equal(Number(summary.availableQuantity), 0.3);
});

test('home hydration escapes API content, preserves Swiper classes and quantity data', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../site/js/main.js', import.meta.url), 'utf8');
  const functionText = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const section = { hidden: false };
  const wrapper = { innerHTML: '', closest: () => section, querySelectorAll: () => [] };
  const context = {
    document: { querySelector: () => wrapper, dispatchEvent() {} },
    CustomEvent: class {},
    requestCommerceApi: async () => ({ products: [{
      ...product(1, 0, { name: '<script>alert(1)</script>' }), availableQuantity: '1.2',
      primaryImage: { url: '/uploads/products/1/file.webp' },
      badge: { type: 'discount', label: '-100%' },
    }] }),
    formatCommerceMoney: (value) => `${value} ₽`,
  };
  runInNewContext([
    functionText('function escapeHomeReviewHtml(', 'function formatHomeReviewDate('),
    functionText('function sanitizeCommerceImage(', 'function updateGlobalHeaderCartCount('),
    functionText('async function hydratePopularProducts(', 'function initPopularProductsSlider('),
  ].join('\n'), context);
  await context.hydratePopularProducts();
  assert.match(wrapper.innerHTML, /popular-products__slide swiper-slide/);
  assert.match(wrapper.innerHTML, /uploads\/products\/1\/file.webp/);
  assert.doesNotMatch(wrapper.innerHTML, /<script>/);
  assert.match(wrapper.innerHTML, /&lt;script&gt;/);
  const encoded = wrapper.innerHTML.match(/data-commerce-item="([^"]+)"/)[1];
  const item = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
  assert.equal(item.quantity, 0.3);
  assert.equal(item.max, 1.1);
  assert.equal(item.unitPrice, 0);
  context.requestCommerceApi = async () => ({ products: [] });
  await context.hydratePopularProducts();
  assert.equal(section.hidden, true);
});

test('cart quantity input preserves minimum precision independently of step precision', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../site/js/cart.js', import.meta.url), 'utf8');
  const context = {};
  runInNewContext(source.slice(0, source.indexOf('function formatCommerceMoney(')), context);
  const item = { min: 0.25, step: 0.5, max: 1.25 };
  assert.equal(context.normalizeCommerceQuantity(0.25, item), 0.25);
  assert.equal(context.normalizeCommerceQuantity(0.75, item), 0.75);
});


test('raw SQL serialization failure retries at most three times; unrelated raw errors never retry', async () => {
  for (const metaCode of ['40001', '23505', '23514', '42601', undefined]) {
    const error = Object.assign(new Error('raw query failed'), { code: 'P2010', meta: { code: metaCode } });
    let attempts = 0;
    await assert.rejects(runSerializable({ $transaction: async () => {
      attempts++;
      throw error;
    } }, () => {}), (actual) => actual === error);
    assert.equal(attempts, metaCode === '40001' ? 3 : 1);
  }
});


test('Prisma 7.10 adapter originalCode controls retry without matching message or kind', async () => {
  for (const originalCode of ['40001', '23505', '23514', undefined]) {
    const error = Object.assign(new Error('Raw query failed: 40001'), {
      code: 'P2010', clientVersion: '7.10.0',
      meta: { driverAdapterError: { name: 'DriverAdapterError', cause: {
        originalCode, kind: 'TransactionWriteConflict',
      } } },
    });
    let attempts = 0;
    await assert.rejects(runSerializable({ $transaction: async () => {
      attempts++;
      throw error;
    } }, () => {}), (actual) => actual === error);
    assert.equal(attempts, originalCode === '40001' ? 3 : 1);
  }
});


test('actorless stock receipt retries with one movement and no administrator activity', async () => {
  const conflict = { code: 'P2010', meta: { driverAdapterError: { cause: {
    originalCode: '40001', kind: 'TransactionWriteConflict',
  } } } };
  const db = rollbackDB({ product: product(1, 100, { stockQuantity: 10, reservedQuantity: 2 }), movements: [], activities: [] }, conflict);
  const service = await (await services(db))('inventory');
  await service.receiveInventory({ productId: 1, actorId: null, quantity: 3, reason: 'Actorless test' });
  assert.equal(Number(db.state().product.stockQuantity), 13);
  assert.equal(db.state().movements.length, 1);
  assert.equal(db.state().activities.length, 0);
});
