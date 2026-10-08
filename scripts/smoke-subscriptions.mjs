import { randomUUID } from "node:crypto";

import { connectDatabase, disconnectDatabase, prisma } from "../lib/prisma.js";
import { releaseInventoryForOrder } from "../services/inventory.service.js";
import {
  createCustomerSubscription,
  generateSubscriptionOrder,
  getCustomerSubscription,
  pauseCustomerSubscription,
  resumeCustomerSubscription,
} from "../services/subscription.service.js";

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
let userId = null;
let foreignUserId = null;
let categoryId = null;
let productId = null;
let promotionId = null;
let subscriptionId = null;
let orderId = null;

function todayDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Krasnoyarsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function cleanup() {
  if (orderId) {
    try {
      await prisma.$transaction(async (transaction) => {
        await releaseInventoryForOrder(transaction, orderId, { reason: "Subscription smoke cleanup" });
      });
    } catch {}
  }
  if (subscriptionId) await prisma.userSubscription.deleteMany({ where: { id: subscriptionId } });
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  if (promotionId) await prisma.promotion.deleteMany({ where: { id: promotionId } });
  if (productId) await prisma.inventoryMovement.deleteMany({ where: { productId } });
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId, role: "CUSTOMER" } });
  if (foreignUserId) await prisma.user.deleteMany({ where: { id: foreignUserId, role: "CUSTOMER" } });
}

try {
  await connectDatabase();

  const user = await prisma.user.create({
    data: {
      email: `subscription-smoke-${suffix}@example.invalid`,
      phone: `+7997${suffix.slice(0, 7)}`,
      passwordHash: "subscription-smoke-no-login",
      firstName: "Иван",
      lastName: "Подпискин",
      role: "CUSTOMER",
      isActive: true,
    },
  });
  userId = user.id;

  const address = await prisma.address.create({
    data: {
      userId,
      title: "Дом",
      recipientName: "Иван Подпискин",
      phone: user.phone,
      city: "Абакан",
      street: "Тестовая",
      house: "1",
      isDefault: true,
    },
  });

  const foreignUser = await prisma.user.create({
    data: {
      email: `subscription-foreign-${suffix}@example.invalid`,
      phone: `+7888${suffix.slice(0, 7)}`,
      passwordHash: "subscription-smoke-no-login",
      firstName: "Чужой",
      lastName: "Адрес",
      role: "CUSTOMER",
      isActive: true,
    },
  });
  foreignUserId = foreignUser.id;
  const foreignAddress = await prisma.address.create({
    data: {
      userId: foreignUser.id,
      title: "Чужой адрес",
      recipientName: "Чужой Клиент",
      phone: foreignUser.phone,
      city: "Абакан",
      street: "Чужая",
      house: "2",
      isDefault: true,
    },
  });

  const category = await prisma.category.create({
    data: { name: `Subscription Smoke ${suffix}`, slug: `subscription-smoke-${suffix}`, isActive: true, sortOrder: 99999 },
  });
  categoryId = category.id;

  const product = await prisma.product.create({
    data: {
      categoryId,
      name: `Subscription Product ${suffix}`,
      slug: `subscription-product-${suffix}`,
      sku: `SUB-${suffix}`.toUpperCase(),
      unit: "PIECE",
      unitLabel: "шт.",
      price: "1000.00",
      step: "1.000",
      minQuantity: "1.000",
      stockQuantity: "20.000",
      reservedQuantity: "0.000",
      isActive: true,
      isAvailable: true,
    },
  });
  productId = product.id;

  const promotion = await prisma.promotion.create({
    data: {
      name: `Subscription Promo ${suffix}`,
      slug: `subscription-promo-${suffix}`,
      type: "PERCENT",
      discountValue: "10.00",
      startsAt: new Date(Date.now() - 3600000),
      endsAt: new Date(Date.now() + 86400000),
      status: "ACTIVE",
      products: { create: { productId } },
    },
  });
  promotionId = promotion.id;

  const scheduledFor = todayDateKey();

  let foreignAddressRejected = false;
  try {
    await createCustomerSubscription({
      userId,
      input: {
        addressId: foreignAddress.id,
        intervalDays: 7,
        nextDeliveryDate: scheduledFor,
        items: [{ productId, quantity: 1 }],
      },
    });
  } catch (error) {
    foreignAddressRejected = error?.code === "SUBSCRIPTION_ADDRESS_NOT_FOUND";
  }
  if (!foreignAddressRejected) throw new Error("Address ownership/IDOR protection failed.");

  const created = await createCustomerSubscription({
    userId,
    input: {
      addressId: address.id,
      intervalDays: 7,
      nextDeliveryDate: scheduledFor,
      items: [{ productId, quantity: 2 }],
    },
  });
  subscriptionId = created.id;

 if (
  created.status !== "ACTIVE" ||
  created.items.length !== 1 ||
  Number(created.summary.total) !== 2100
) {
  console.error("Subscription pricing mismatch:", created.summary);
  throw new Error(
    "Subscription creation or promotion-aware server pricing is invalid."
  );
}

  const generated = await generateSubscriptionOrder({ subscriptionId, scheduledFor, source: "SYSTEM" });
  if (!generated.created || !generated.delivery?.order?.id) throw new Error("Scheduled order was not generated.");
  orderId = generated.delivery.order.id;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, inventoryReservations: true },
  });
  if (!order || order.paymentMethod !== "ON_RECEIPT" || order.paymentStatus !== "PENDING") {
    throw new Error("Subscription order payment state is invalid.");
  }
  if (Number(order.total) !== 1800 + Number(order.deliveryPrice) || Number(order.items[0]?.unitPrice) !== 900 || !order.deliveryPriceConfirmed || order.deliveryTermsSnapshot?.method !== "DELIVERY") {
    throw new Error("Subscription order did not snapshot the current promoted server price.");
  }
  if (order.inventoryReservations.length !== 1 || Number(order.inventoryReservations[0].quantity) !== 2) {
    throw new Error("Subscription order did not reserve inventory.");
  }

  const stock = await prisma.product.findUnique({ where: { id: productId }, select: { reservedQuantity: true } });
  if (Number(stock?.reservedQuantity) !== 2) throw new Error("Reserved quantity was not updated.");

  const duplicate = await generateSubscriptionOrder({ subscriptionId, scheduledFor, source: "SYSTEM" });
  if (duplicate.created) throw new Error("Idempotency failed: duplicate scheduled order was created.");
  const orderCount = await prisma.order.count({ where: { checkoutKey: order.checkoutKey } });
  if (orderCount !== 1) throw new Error("Idempotency checkout key is not unique.");

  let futureGenerationRejected = false;
  try {
    await generateSubscriptionOrder({ subscriptionId, source: "ADMIN" });
  } catch (error) {
    futureGenerationRejected = error?.code === "SUBSCRIPTION_NOT_DUE";
  }
  if (!futureGenerationRejected) throw new Error("Future delivery was generated/reserved before it was due.");

  await prisma.product.update({ where: { id: productId }, data: { isAvailable: false } });
  const unavailableView = await getCustomerSubscription(userId);
  if (!unavailableView || unavailableView.items[0]?.available !== false) {
    throw new Error("Hidden/unavailable product broke subscription readability.");
  }
  await prisma.product.update({ where: { id: productId }, data: { isAvailable: true } });

  const paused = await pauseCustomerSubscription(userId);
  if (paused.status !== "PAUSED") throw new Error("Pause failed.");
  const resumed = await resumeCustomerSubscription({ userId });
  if (resumed.status !== "ACTIVE") throw new Error("Resume failed.");

  const loaded = await getCustomerSubscription(userId);
  if (!loaded || loaded.deliveries.length !== 1 || loaded.deliveries[0].order?.id !== orderId) {
    throw new Error("Subscription history does not expose the linked order.");
  }

  console.log(`PASS: subscription #${subscriptionId}, order ${order.number}; pricing, Promotions, address ownership, inventory reservation, due-date guard, hidden-product resilience, pause/resume and idempotency work.`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (cleanupError) { console.error(`Cleanup warning: ${cleanupError.message}`); process.exitCode = 1; }
  try { await disconnectDatabase(); } catch {}
}
