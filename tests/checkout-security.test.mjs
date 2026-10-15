import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { businessDateKey, isValidDateOnly } from "../utils/dates.js";

const hash = (identity) => createHash("sha256").update(identity).digest("hex");
const guest = { type: "guest", sessionId: "session-a" };
const order = (identity = "guest:session-a", userId = null) => ({
  id: 55, number: "AUDIT", userId, checkoutOwnerHash: hash(identity), total: "1000.00",
});

async function loadService(prisma, overrides = {}) {
  const modules = {
    "./order-notification.service.js": { notifyOrderCreated: async () => { assert.fail("Replay must not notify"); } },
    "node:crypto": { createHash, randomBytes },
    "../utils/dates.js": { businessDateKey, isValidDateOnly },
    "../lib/prisma.js": { prisma },
    "./commerce.service.js": Object.fromEntries(["buildCommerceOwnerWhere", "getCommerceProductSelect", "getProductCommerceLimits", "normalizeCommerceQuantity", "serializeCommerceItem"].map((name) => [name, () => { throw new Error(`Unexpected call: ${name}`); }])),
    "./inventory.service.js": { reserveInventoryForOrder() {} },
    "./promotion.service.js": { applyActivePromotionsToProducts() {} },
    "./delivery.service.js": Object.fromEntries(["getActiveDeliveryZones", "quoteDelivery", "moneyToKopecks", "kopecksToRubles"].map((name) => [name, () => {}])),
  };
  Object.assign(modules, overrides);
  const module = new SourceTextModule(await readFile(new URL("../services/checkout.service.js", import.meta.url), "utf8"));
  await module.link((name) => {
    const values = modules[name];
    assert.ok(values, `Unexpected import ${name}`);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    });
  });
  await module.evaluate();
  return module.namespace;
}

async function replay(existing, { owner = guest, userId = null, race = false } = {}) {
  let queries = 0;
  const service = await loadService({
    order: { findUnique: async () => (++queries === 1 && race ? null : existing) },
    $transaction: async () => { throw Object.assign(new Error("duplicate"), { code: "P2002" }); },
  });
  return service.createCheckoutOrder({ owner, userId, input: { idempotencyKey: "known-key" } });
}

for (const race of [false, true]) {
  const suffix = race ? "after P2002 race" : "initial lookup";
  test(`same guest can replay, private hash omitted: ${suffix}`, async () => {
    const result = await replay(order(), { race });
    assert.equal(result.created, false);
    assert.equal(result.order.id, 55);
    assert.equal("checkoutOwnerHash" in result.order, false);
  });
  test(`another guest cannot replay: ${suffix}`, async () => {
    await assert.rejects(replay(order(), { owner: { type: "guest", sessionId: "other" }, race }), { code: "CHECKOUT_KEY_CONFLICT" });
  });
  test(`guest cannot replay user order: ${suffix}`, async () => {
    await assert.rejects(replay(order("user:42", 42), { race }), { code: "CHECKOUT_KEY_CONFLICT" });
  });
  test(`another user cannot replay: ${suffix}`, async () => {
    await assert.rejects(replay(order("user:42", 42), { owner: { type: "user", userId: 43 }, userId: 43, race }), { code: "CHECKOUT_KEY_CONFLICT" });
  });
  test(`same user can replay: ${suffix}`, async () => {
    assert.equal((await replay(order("user:42", 42), { owner: { type: "user", userId: 42 }, userId: 42, race })).created, false);
  });
  test(`legacy order fails closed: ${suffix}`, async () => {
    await assert.rejects(replay({ ...order(), checkoutOwnerHash: null }, { race }), { code: "CHECKOUT_KEY_CONFLICT" });
  });
}

test("missing or inconsistent owner is rejected before any database lookup", async () => {
  const service = await loadService({ order: { findUnique() { assert.fail("must not query"); } } });
  for (const data of [{ owner: null }, { owner: guest, userId: 42 }, { owner: { type: "user", userId: 42 }, userId: 43 }]) {
    await assert.rejects(service.createCheckoutOrder({ ...data, input: {} }), { code: "CHECKOUT_OWNER_REQUIRED" });
  }
});

test("calendar date validation rejects rollover and accepts leap day", () => {
  for (const value of ["2027-02-31", "2027-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-1-01", "2026-01-00", "no", null]) assert.equal(isValidDateOnly(value), false);
  assert.equal(isValidDateOnly("2028-02-29"), true);
});

test("business day switches at midnight Krasnoyarsk, independently of machine timezone", () => {
  assert.equal(businessDateKey(new Date("2026-10-15T16:59:59Z")), "2026-10-15");
  assert.equal(businessDateKey(new Date("2026-10-15T17:00:00Z")), "2026-10-16");
});

async function creation(receiveDate = businessDateKey()) {
  let data;
  let reserved = false;
  let cleared = false;
  let committed = false;
  let notified = 0;
  const product = { id: 1, slug: "test", name: "Test", sku: "TEST", unit: "PIECE", price: 100 };
  const transaction = {
    cart: { findFirst: async () => ({ id: 1, items: [{ productId: 1, product, quantity: 1 }] }) },
    order: { create: async (args) => { data = args.data; return { ...data, id: 66 }; } },
    cartItem: { deleteMany: async () => { cleared = true; } },
  };
  const service = await loadService({
    order: { findUnique: async () => null },
    $transaction: async (work, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      const result = await work(transaction);
      committed = true;
      return result;
    },
  }, {
    "./order-notification.service.js": { notifyOrderCreated: async (id) => { assert.equal(committed, true); assert.equal(id, 66); notified++; } },
    "./commerce.service.js": {
      buildCommerceOwnerWhere: () => ({ sessionId: guest.sessionId }),
      getCommerceProductSelect: () => ({}),
      getProductCommerceLimits: () => ({ available: true, min: 1, max: 10 }),
      normalizeCommerceQuantity: (value) => value,
      serializeCommerceItem: () => ({ productId: 1, title: "Test", quantity: 1 }),
    },
    "./promotion.service.js": { applyActivePromotionsToProducts: async () => [product] },
    "./inventory.service.js": { reserveInventoryForOrder: async () => { reserved = true; } },
    "./delivery.service.js": {
      getActiveDeliveryZones() {},
      quoteDelivery: async () => ({ deliveryPrice: 0, deliveryPriceConfirmed: true, pickupPointId: null, deliveryZoneId: null, snapshot: { method: "PICKUP" } }),
      moneyToKopecks: (value) => Math.round(value * 100),
      kopecksToRubles: (value) => value / 100,
    },
  });
  const result = await service.createCheckoutOrder({ owner: guest, input: { idempotencyKey: "new-key", receiveMethod: "pickup", receiveDate, paymentMethod: "on-receipt" } });
  return { result, data, reserved, cleared, notified };
}

test("new order persists owner binding and retains reserve/clear transaction", async () => {
  const { result, data, reserved, cleared, notified } = await creation();
  assert.equal(notified, 1);
  assert.equal(data.checkoutOwnerHash, hash("guest:session-a"));
  assert.equal(data.checkoutKey, "new-key");
  assert.equal(result.created, true);
  assert.equal("checkoutOwnerHash" in result.order, false);
  assert.equal(reserved, true);
  assert.equal(cleared, true);
});

test("service rejects impossible and past receive dates even without route validation", async () => {
  for (const value of ["2099-02-31", "2000-01-01"]) await assert.rejects(creation(value), { code: "INVALID_RECEIVE_DATE" });
});
