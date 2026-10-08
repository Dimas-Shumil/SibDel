/**
 * End-to-end delivery smoke, against a running development server and an
 * isolated TEST database. Creates and removes a guest order and reservations.
 * Prerequisites: migrated DB, generated Prisma client, an active DeliveryZone
 * with a locality, an available SMOKE_PRODUCT_SLUG, a running APP_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { commerceConfig } from "../config/commerce.js";
import { connectDatabase, disconnectDatabase, prisma } from "../lib/prisma.js";
import { releaseInventoryForOrder } from "../services/inventory.service.js";
import { hashOpaqueToken } from "../utils/tokens.js";

const baseUrl = env.APP_URL.replace(/\/$/, "");
const origin = new URL(baseUrl).origin;
const productSlug = process.env.SMOKE_PRODUCT_SLUG || "kolbasa-taezhnaya";
let cookieHeader = "";
let guestToken = null;
let createdOrderId = null;

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Origin: origin,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const cookie = setCookie.split(";", 1)[0];
    const [name, value] = cookie.split("=", 2);
    if (name === commerceConfig.guestCookieName) {
      cookieHeader = cookie;
      guestToken = value;
    }
  }
  return { status: response.status, payload: await response.json().catch(() => null) };
}

async function ok(path, options) {
  const result = await request(path, options);
  assert.ok(result.status >= 200 && result.status < 300 && result.payload?.ok,
    `${options?.method || "GET"} ${path}: ${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload;
}

function tomorrowIso() {
  const date = new Date(Date.now() + 2 * 86400 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Krasnoyarsk", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

async function cleanup() {
  await connectDatabase();
  try {
    if (createdOrderId) {
      await prisma.$transaction(async (tx) => {
        await releaseInventoryForOrder(tx, createdOrderId, {
          reason: "Delivery smoke cleanup",
        });
        await tx.inventoryMovement.deleteMany({ where: { orderId: createdOrderId } });
        await tx.order.deleteMany({ where: { id: createdOrderId } });
      });
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

try {
  const health = await ok("/api/health");
  assert.equal(health.database, "ok", "database unavailable");

  const denied = await request("/api/admin/delivery");
  assert.equal(denied.status, 401, "delivery admin API must require authentication");
  console.log("PASS: anonymous admin access rejected");

  const deliveryCatalog = await ok("/api/delivery/zones");
  const zone = deliveryCatalog.zones?.[0];
  assert.ok(zone?.locality, "Configure at least one active DeliveryZone with locality");

  await ok("/api/cart/items", { method: "POST", body: { slug: productSlug, quantity: 1 } });
  const cart = await ok("/api/checkout");
  assert.equal(cart.checkout.cart.items.length, 1, "test product must exist");

  const quoted = await ok(`/api/checkout?${new URLSearchParams({
    receiveMethod: "delivery", deliveryZoneId: String(zone.id),
  })}`);
  const quote = quoted.checkout.cart.summary;
  assert.equal(quote.deliveryPriceConfirmed, true);
  assert.equal(quote.isFinal, true);
  const expectedTotal = Math.round(100 * quote.merchandiseTotal) + Math.round(100 * quote.deliveryPrice);
  assert.equal(Math.round(100 * quote.total), expectedTotal);
  const pickupQuery = new URLSearchParams({ receiveMethod: "pickup" });
  if (deliveryCatalog.pickupPoints?.length) pickupQuery.set("pickupPointId", String(deliveryCatalog.pickupPoints[0].id));
  const pickupCheckout = await ok(`/api/checkout?${pickupQuery}`);
  assert.equal(pickupCheckout.checkout.cart.summary.deliveryPrice, 0, "pickup must be free");
  assert.equal(pickupCheckout.checkout.cart.summary.deliveryPriceConfirmed, true);
  console.log("PASS: server courier quote and free pickup quote");

  const body = {
    idempotencyKey: randomUUID(), name: "Delivery Smoke", phone: "+79990000000",
    email: "delivery-smoke@example.com", receiveMethod: "delivery",
    deliveryZoneId: zone.id, address: `${zone.locality}, Тестовая улица, 1`,
    entrance: "", floor: "", receiveDate: tomorrowIso(), receiveSlotId: null,
    pickupPointId: null, paymentMethod: "on-receipt", comment: "smoke test", agreement: true,
  };

  // Never accept a browser-provided price, even when a valid zone is given.
  const injection = await request("/api/checkout", {
    method: "POST", body: { ...body, deliveryPrice: 0 },
  });
  assert.equal(injection.status, 400, "client shipping-price injection must be rejected");
  console.log("PASS: forged client deliveryPrice rejected");

  const invalidZone = await request("/api/checkout", {
    method: "POST", body: { ...body, deliveryZoneId: 2147483647 },
  });
  assert.equal(invalidZone.status, 409, "unconfigured zone must be rejected");
  console.log("PASS: unconfigured delivery zone rejected");

  const created = await ok("/api/checkout", { method: "POST", body });
  createdOrderId = created.order?.id || null;
  assert.ok(createdOrderId, "order not created");
  assert.equal(created.order.deliveryPriceConfirmed, true);
  assert.equal(created.order.deliveryTermsSnapshot?.zoneId, zone.id);
  assert.equal(created.order.deliveryTermsSnapshot?.method, "DELIVERY");
  assert.equal(Math.round(created.order.total * 100), expectedTotal);
  assert.equal(Math.round(created.order.deliveryPrice * 100), Math.round(quote.deliveryPrice * 100));

  await connectDatabase();
  const persisted = await prisma.order.findUnique({
    where: { id: createdOrderId },
    select: { deliveryPrice: true, total: true, deliveryZoneId: true, deliveryTermsSnapshot: true },
  });
  assert.equal(persisted.deliveryZoneId, zone.id);
  assert.equal(persisted.deliveryTermsSnapshot?.price, quote.deliveryPrice);
  assert.equal(Math.round(Number(persisted.total) * 100), expectedTotal);
  console.log("PASS: server calculated amount and delivery snapshot persisted");

  const replay = await ok("/api/checkout", { method: "POST", body });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.order.id, createdOrderId);
  const after = await ok("/api/cart");
  assert.equal(after.cart?.items?.length, 0);
  console.log("PASS: checkout replay idempotent; cart cleared");

  console.log("PASS: delivery smoke test complete");
} catch (error) {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (error) {
    console.error(`FAIL: cleanup: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
