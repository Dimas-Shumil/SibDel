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
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
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
      stockQuantity: true,
      reservedQuantity: true,
    },
  });
}

async function cleanup() {
  await connectDatabase();
  try {
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

  await updateOrderStatus({
    orderKey: createdOrderNumber,
    nextStatus: "CANCELLED",
    actorId: null,
    reason: "Inventory smoke-test cancellation",
  });

  const released = await productBalance();
  const afterReleaseStock = decimalNumber(released.stockQuantity);
  const afterReleaseReserved = decimalNumber(released.reservedQuantity) ?? 0;

  if (Math.abs(afterReleaseStock - beforeStock) > 0.0005) {
    throw new Error("Physical stock changed after reservation release.");
  }
  if (Math.abs(afterReleaseReserved - beforeReserved) > 0.0005) {
    throw new Error("Reserved quantity was not restored after cancellation.");
  }

  await disconnectDatabase();
  console.log(
    `PASS: ${createdOrderNumber} reserved 1 unit, cancellation released it, physical stock stayed ${beforeStock}.`,
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
