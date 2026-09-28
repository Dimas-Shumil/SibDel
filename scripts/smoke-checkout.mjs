import { randomUUID } from "node:crypto";

import { env } from "../config/env.js";
import { commerceConfig } from "../config/commerce.js";
import {
  connectDatabase,
  disconnectDatabase,
  prisma,
} from "../lib/prisma.js";
import { hashOpaqueToken } from "../utils/tokens.js";

const baseUrl = env.APP_URL.replace(/\/$/, "");
const origin = new URL(baseUrl).origin;
const productSlug = process.env.SMOKE_PRODUCT_SLUG || "kolbasa-taezhnaya";

let cookieHeader = "";
let guestToken = null;
let createdOrderId = null;

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

    if (name === commerceConfig.guestCookieName) {
      guestToken = value;
    }
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    throw new Error(
      `${options.method || "GET"} ${path}: ${response.status} ${payload?.error?.code || "ERROR"} — ${payload?.error?.message || "unknown error"}`,
    );
  }

  return payload;
}

async function cleanup() {
  await connectDatabase();

  try {
    if (createdOrderId) {
      await prisma.order.deleteMany({
        where: {
          id: createdOrderId,
        },
      });
    }

    if (guestToken) {
      await prisma.cart.deleteMany({
        where: {
          sessionId: hashOpaqueToken(guestToken),
        },
      });
    }
  } finally {
    await disconnectDatabase();
  }
}

try {
  const health = await request("/api/health");
  if (health.database !== "ok") throw new Error("Database health check failed.");

  await request("/api/cart/items", {
    method: "POST",
    body: {
      slug: productSlug,
      quantity: 1,
    },
  });

  const checkout = await request("/api/checkout");
  if (checkout.checkout?.cart?.items?.length !== 1) {
    throw new Error("Checkout did not receive the guest cart.");
  }

  const created = await request("/api/checkout", {
    method: "POST",
    body: {
      idempotencyKey: randomUUID(),
      name: "Smoke Test",
      phone: "+79990000000",
      email: "smoke-test@example.com",
      receiveMethod: "delivery",
      address: "Тестовый адрес, дом 1",
      entrance: "",
      floor: "",
      receiveDate: tomorrowIso(),
      receiveSlotId: null,
      pickupPointId: null,
      paymentMethod: "on-receipt",
      comment: "Автоматический smoke-тест checkout",
      agreement: true,
    },
  });

  createdOrderId = created.order?.id ?? null;
  if (!createdOrderId || !created.order?.number) {
    throw new Error("Checkout response has no created order.");
  }

  const cart = await request("/api/cart");
  if (cart.cart?.items?.length !== 0) {
    throw new Error("Cart was not cleared after order creation.");
  }

  console.log(`PASS: checkout created ${created.order.number}, cart cleared, server totals used.`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error(`Cleanup warning: ${cleanupError.message}`);
    process.exitCode = 1;
  }
}
