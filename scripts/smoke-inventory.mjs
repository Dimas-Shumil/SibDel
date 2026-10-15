import assert from "node:assert/strict";
import { receiveInventory } from "../services/inventory.service.js";
import { businessDateKey } from "../utils/dates.js";
import { assertTestEnvironment } from "../utils/test-environment.js";
import { randomUUID } from "node:crypto";

import { env } from "../config/env.js";
import { commerceConfig } from "../config/commerce.js";
import {
  connectDatabase,
  disconnectDatabase,
  prisma,
} from "../lib/prisma.js";
import { updateOrderStatus } from "../services/order.service.js";
import { hashOpaqueToken } from "../utils/tokens.js";

const baseUrl = env.APP_URL.replace(/\/$/, "");
const origin = new URL(baseUrl).origin;
const productSlug = process.env.SMOKE_PRODUCT_SLUG || "kolbasa-taezhnaya";

let retryProductId = null;
let cookieHeader = "";
let guestToken = null;
let createdOrderId = null;
let createdOrderNumber = null;

function decimalNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value?.toString?.() ?? value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tomorrowIso() {
  return businessDateKey(new Date(Date.now() + 86400000));
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      Origin: origin,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    cookieHeader = setCookie.split(";", 1)[0];
    const [name, value] = cookieHeader.split("=", 2);
    if (name === commerceConfig.guestCookieName) guestToken = value;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(
      `${options.method || "GET"} ${path}: ${response.status} ${payload?.error?.code || "ERROR"} — ${payload?.error?.message || "unknown error"}`,
    );
  }

  return payload;
}

async function productBalance() {
  return prisma.product.findUnique({
    where: { slug: productSlug },
    select: {
      id: true,
      name: true,
      categoryId: true,
      stockQuantity: true,
      reservedQuantity: true,
    },
  });
}

async function cleanup() {
  await connectDatabase();
  try {
    if (retryProductId) {
      await prisma.inventoryMovement.deleteMany({ where: { productId: retryProductId } });
      await prisma.adminActivity.deleteMany({ where: { entityType: "Product", entityId: String(retryProductId) } });
      await prisma.product.deleteMany({ where: { id: retryProductId } });
    }
    if (createdOrderId) {
      await prisma.inventoryMovement.deleteMany({ where: { orderId: createdOrderId } });
      await prisma.adminActivity.deleteMany({
        where: {
          action: "ORDER_STATUS_CHANGED",
          entityType: "Order",
          entityId: String(createdOrderId),
        },
      });
      await prisma.order.deleteMany({ where: { id: createdOrderId } });
    }

    if (guestToken) {
      await prisma.cart.deleteMany({
        where: { sessionId: hashOpaqueToken(guestToken) },
      });
    }
  } finally {
    await disconnectDatabase();
  }
}

await assertTestEnvironment(env, prisma, { http: true });

try {
  await connectDatabase();
  const before = await productBalance();
  if (!before) throw new Error(`Smoke product not found: ${productSlug}`);
  if (before.stockQuantity === null) {
    throw new Error("Smoke product does not have inventory tracking enabled.");
  }
  const beforeStock = decimalNumber(before.stockQuantity);
  const beforeReserved = decimalNumber(before.reservedQuantity) ?? 0;
  await disconnectDatabase();

  await request("/api/health");
  await request("/api/cart/items", {
    method: "POST",
    body: { slug: productSlug, quantity: 1 },
  });

  const zones = (await request("/api/delivery/zones")).zones;
  const deliveryZone = zones[0];
  if (!deliveryZone) throw new Error("Configure an active DeliveryZone.locality before running this smoke test.");

  const created = await request("/api/checkout", {
    method: "POST",
    body: {
      idempotencyKey: randomUUID(),
      name: "Inventory Smoke Test",
      phone: "+79990000000",
      email: "inventory-smoke@example.com",
      receiveMethod: "delivery",
      deliveryZoneId: deliveryZone.id,
      address: `${deliveryZone.locality}, Тестовая улица, дом 1`,
      entrance: "",
      floor: "",
      receiveDate: tomorrowIso(),
      receiveSlotId: null,
      pickupPointId: null,
      paymentMethod: "on-receipt",
      comment: "Автоматический smoke-тест inventory",
      agreement: true,
    },
  });

  createdOrderId = created.order?.id ?? null;
  createdOrderNumber = created.order?.number ?? null;
  if (!createdOrderId || !createdOrderNumber) {
    throw new Error("Checkout response has no created order.");
  }

  await connectDatabase();
  const reserved = await productBalance();
  const afterReserveStock = decimalNumber(reserved.stockQuantity);
  const afterReserveReserved = decimalNumber(reserved.reservedQuantity) ?? 0;

  if (Math.abs(afterReserveStock - beforeStock) > 0.0005) {
    throw new Error("Physical stock changed during reservation.");
  }
  if (Math.abs(afterReserveReserved - (beforeReserved + 1)) > 0.0005) {
    throw new Error("Reserved quantity did not increase by 1.");
  }

  await Promise.all([1, 2].map(() => updateOrderStatus({
    orderKey: createdOrderNumber,
    nextStatus: "CANCELLED",
    actorId: null,
    reason: "Inventory smoke-test concurrent cancellation",
  })));
  assert.equal(await prisma.inventoryMovement.count({ where: { orderId: createdOrderId, type: "RELEASE" } }), 1);
  assert.equal(await prisma.adminActivity.count({ where: { entityType: "Order", entityId: String(createdOrderId), action: "ORDER_STATUS_CHANGED" } }), 1);

  const released = await productBalance();
  const afterReleaseStock = decimalNumber(released.stockQuantity);
  const afterReleaseReserved = decimalNumber(released.reservedQuantity) ?? 0;

  if (Math.abs(afterReleaseStock - beforeStock) > 0.0005) {
    throw new Error("Physical stock changed after reservation release.");
  }
  if (Math.abs(afterReleaseReserved - beforeReserved) > 0.0005) {
    throw new Error("Reserved quantity was not restored after cancellation.");
  }

  const retryProduct = await prisma.product.create({ data: {
    categoryId: before.categoryId, name: "Serializable smoke", slug: `retry-${randomUUID()}`,
    sku: `RETRY-${randomUUID()}`, unit: "PIECE", unitLabel: "шт.",
    price: "100.00", stockQuantity: "10.000", reservedQuantity: "0.000",
    minQuantity: "1.000", step: "1.000", isActive: true, isAvailable: true,
  } });
  retryProductId = retryProduct.id;
  await Promise.all([1, 2].map((quantity) => receiveInventory({
    productId: retryProductId, actorId: null, quantity, reason: "Concurrent receipt smoke",
  })));
  const afterReceipts = await prisma.product.findUnique({ where: { id: retryProductId } });
  assert.equal(decimalNumber(afterReceipts.stockQuantity), 13, "Concurrent receipts must add exactly 3 to stock");
  assert.equal(await prisma.inventoryMovement.count({ where: { productId: retryProductId, type: "RECEIPT" } }), 2, "Two receipts must create exactly two inventory movements");
  // These service calls have actorId=null. Inventory deliberately records
  // movements but omits administrator activity when there is no actor.
  assert.equal(await prisma.adminActivity.count({ where: { entityType: "Product", entityId: String(retryProductId), action: "INVENTORY_RECEIPT" } }), 0, "Actorless receipts must not create administrator activity");

  await disconnectDatabase();
  console.log(
    `PASS: ${createdOrderNumber} reserved 1 unit, cancellation released it, physical stock stayed ${beforeStock}; concurrent receipts added 3 with exactly 2 movements.`,
  );
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
  try {
    await disconnectDatabase();
  } catch {}
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error(`Cleanup warning: ${cleanupError.message}`);
    process.exitCode = 1;
  }
}
