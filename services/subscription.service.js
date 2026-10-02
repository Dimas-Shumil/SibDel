import { createHash, randomBytes } from "node:crypto";

import { prisma } from "../lib/prisma.js";
import {
  getCommerceProductSelect,
  getProductCommerceLimits,
  normalizeCommerceQuantity,
  serializeCommerceItem,
} from "./commerce.service.js";
import { reserveInventoryForOrder } from "./inventory.service.js";
import { applyActivePromotionsToProducts } from "./promotion.service.js";

const ALLOWED_INTERVAL_DAYS = new Set([7, 14, 30]);
const MAX_SUBSCRIPTION_ITEMS = 30;
const BUSINESS_TIME_ZONE = "Asia/Krasnoyarsk";

const SUBSCRIPTION_INCLUDE = Object.freeze({
  plan: {
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      price: true,
      durationDays: true,
      discountPercent: true,
    },
  },
  address: true,
  items: {
    orderBy: { id: "asc" },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          unit: true,
          unitLabel: true,
          price: true,
          oldPrice: true,
          step: true,
          minQuantity: true,
          stockQuantity: true,
          reservedQuantity: true,
          isActive: true,
          isAvailable: true,
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              isActive: true,
            },
          },
          images: {
            orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
            take: 1,
            select: {
              id: true,
              url: true,
              alt: true,
              sortOrder: true,
              isPrimary: true,
            },
          },
        },
      },
    },
  },
  events: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 30,
    include: {
      actor: {
        select: {
          id: true,
          role: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  },
  deliveries: {
    orderBy: [{ scheduledFor: "desc" }, { id: "desc" }],
    take: 20,
    include: {
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          paymentStatus: true,
          deliveryStatus: true,
          subtotal: true,
          discountTotal: true,
          deliveryPrice: true,
          deliveryPriceConfirmed: true,
          total: true,
          currency: true,
          createdAt: true,
        },
      },
    },
  },
});

function subscriptionError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  if (details !== undefined) error.details = details;
  return error;
}

async function runSerializable(work, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      lastError = error;
      if (error?.code !== "P2034" || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
}

function decimalToNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value?.toString?.() ?? value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function roundQuantity(value) {
  return Number(Number(value).toFixed(3));
}

function toCents(value) {
  return Math.round((decimalToNumber(value) ?? 0) * 100);
}

function fromCents(value) {
  return Number((value / 100).toFixed(2));
}

function getBaseUnitPriceCents(product) {
  const current = toCents(product.price);
  const old = toCents(product.oldPrice);
  return old > current ? old : current;
}

function buildLinePricing(product, quantity) {
  const currentUnitCents = toCents(product.price);
  const baseUnitCents = getBaseUnitPriceCents(product);
  const baseLineCents = Math.round(baseUnitCents * quantity);
  const currentLineCents = Math.round(currentUnitCents * quantity);

  return {
    baseUnitPrice: fromCents(baseUnitCents),
    unitPrice: fromCents(currentUnitCents),
    discountTotal: fromCents(Math.max(0, baseLineCents - currentLineCents)),
    total: fromCents(currentLineCents),
    baseLineCents,
    currentLineCents,
  };
}

function businessDateToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
}

function parseDateOnly(value, fieldName = "Дата") {
  const date = value instanceof Date ? new Date(value) : new Date(`${String(value)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw subscriptionError(`${fieldName} указана некорректно.`, 400, "SUBSCRIPTION_INVALID_DATE");
  }
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + Number(days));
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function nextCadenceDate(scheduledFor, intervalDays, now = new Date()) {
  const today = businessDateToday(now);
  let next = addDays(scheduledFor, intervalDays);
  while (next <= today) next = addDays(next, intervalDays);
  return next;
}

function validateIntervalDays(intervalDays) {
  if (!ALLOWED_INTERVAL_DAYS.has(Number(intervalDays))) {
    throw subscriptionError(
      "Доступная периодичность: раз в 7, 14 или 30 дней.",
      400,
      "SUBSCRIPTION_INVALID_INTERVAL",
    );
  }
  return Number(intervalDays);
}

function validateNextDeliveryDate(value, now = new Date()) {
  const date = parseDateOnly(value, "Дата следующей доставки");
  const today = businessDateToday(now);
  const max = addDays(today, 180);
  if (date < today || date > max) {
    throw subscriptionError(
      "Дата следующей доставки должна быть от сегодняшнего дня до 180 дней вперёд.",
      400,
      "SUBSCRIPTION_INVALID_NEXT_DELIVERY",
    );
  }
  return date;
}

function formatAddressSnapshot(address) {
  if (!address) return null;
  const parts = [address.city, `${address.street}, ${address.house}`];
  if (address.apartment) parts.push(`кв. ${address.apartment}`);
  if (address.entrance) parts.push(`подъезд ${address.entrance}`);
  if (address.floor) parts.push(`этаж ${address.floor}`);
  if (address.intercom) parts.push(`домофон ${address.intercom}`);
  return parts.filter(Boolean).join(", ");
}

function serializeAddress(address) {
  if (!address) return null;
  return {
    id: address.id,
    title: address.title,
    recipientName: address.recipientName,
    phone: address.phone,
    city: address.city,
    street: address.street,
    house: address.house,
    apartment: address.apartment,
    entrance: address.entrance,
    floor: address.floor,
    intercom: address.intercom,
    comment: address.comment,
    isDefault: address.isDefault,
    formatted: formatAddressSnapshot(address),
  };
}

function serializeActor(actor) {
  if (!actor) return null;
  return {
    id: actor.id,
    role: actor.role,
    name: [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.email || `#${actor.id}`,
    email: actor.email,
  };
}

function serializeDelivery(delivery) {
  return {
    id: delivery.id,
    scheduledFor: delivery.scheduledFor,
    status: delivery.status,
    failureCode: delivery.failureCode,
    failureMessage: delivery.failureMessage,
    generatedAt: delivery.generatedAt,
    createdAt: delivery.createdAt,
    order: delivery.order
      ? {
          ...delivery.order,
          subtotal: decimalToNumber(delivery.order.subtotal) ?? 0,
          discountTotal: decimalToNumber(delivery.order.discountTotal) ?? 0,
          deliveryPrice: decimalToNumber(delivery.order.deliveryPrice) ?? 0,
          total: decimalToNumber(delivery.order.total) ?? 0,
        }
      : null,
  };
}

async function priceSubscriptionItems(items, client = prisma) {
  const activeProducts = items
    .map((item) => item.product)
    .filter(Boolean);
  const pricedProducts = await applyActivePromotionsToProducts(activeProducts, client);
  const pricedById = new Map(pricedProducts.map((product) => [product.id, product]));

  let subtotalCents = 0;
  let totalCents = 0;
  let unavailableCount = 0;

  const serializedItems = items.map((item) => {
    const current = item.product ? pricedById.get(item.product.id) || item.product : null;
    const quantity = roundQuantity(decimalToNumber(item.quantity) ?? 0);
    const fallbackUnitPrice = decimalToNumber(item.lastUnitPrice) ?? 0;

    if (!current) {
      const fallbackTotal = money(fallbackUnitPrice * quantity);
      unavailableCount += 1;
      subtotalCents += Math.round(fallbackTotal * 100);
      totalCents += Math.round(fallbackTotal * 100);
      return {
        id: item.id,
        productId: null,
        productName: item.productName,
        sku: item.sku,
        unit: item.unit,
        unitLabel: null,
        quantity,
        available: false,
        unavailableReason: "PRODUCT_DELETED",
        unitPrice: fallbackUnitPrice,
        baseUnitPrice: fallbackUnitPrice,
        discountTotal: 0,
        total: fallbackTotal,
        promotion: null,
        image: "",
      };
    }

    const limits = getProductCommerceLimits(current);
    const normalized = limits.available
      ? normalizeCommerceQuantity(quantity, current, { allowZero: true })
      : 0;
    const quantityValid = limits.available && Math.abs(normalized - quantity) <= 0.0005;
    if (!quantityValid) unavailableCount += 1;

    const pricing = buildLinePricing(current, quantity);
    subtotalCents += pricing.baseLineCents;
    totalCents += pricing.currentLineCents;

    return {
      id: item.id,
      productId: current.id,
      productName: current.name,
      slug: current.slug,
      sku: current.sku,
      unit: current.unit,
      unitLabel: current.unitLabel,
      quantity,
      available: quantityValid,
      unavailableReason: quantityValid ? null : "PRODUCT_UNAVAILABLE",
      unitPrice: pricing.unitPrice,
      baseUnitPrice: pricing.baseUnitPrice,
      discountTotal: pricing.discountTotal,
      total: pricing.total,
      promotion: current.promotion ?? null,
      image: current.images?.[0]?.url || "",
      limits,
    };
  });

  return {
    items: serializedItems,
    summary: {
      subtotal: fromCents(subtotalCents),
      discountTotal: fromCents(Math.max(0, subtotalCents - totalCents)),
      merchandiseTotal: fromCents(totalCents),
      deliveryPrice: 0,
      deliveryPriceConfirmed: false,
      total: fromCents(totalCents),
      currency: "RUB",
      unavailableCount,
      isOrderable: serializedItems.length > 0 && unavailableCount === 0,
    },
  };
}

async function serializeSubscription(subscription, client = prisma) {
  if (!subscription) return null;
  const priced = await priceSubscriptionItems(subscription.items || [], client);
  return {
    id: subscription.id,
    status: subscription.status,
    intervalDays: subscription.intervalDays,
    nextDeliveryAt: subscription.nextDeliveryAt,
    startsAt: subscription.startsAt,
    expiresAt: subscription.expiresAt,
    pausedAt: subscription.pausedAt,
    cancelledAt: subscription.cancelledAt,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
    legacyPlan: subscription.plan
      ? {
          ...subscription.plan,
          price: decimalToNumber(subscription.plan.price),
          discountPercent: decimalToNumber(subscription.plan.discountPercent),
        }
      : null,
    address: subscription.address
      ? serializeAddress(subscription.address)
      : subscription.addressSnapshot
        ? { id: null, title: null, formatted: subscription.addressSnapshot, isDeleted: true }
        : null,
    items: priced.items,
    summary: priced.summary,
    events: (subscription.events || []).map((event) => ({
      id: event.id,
      action: event.action,
      source: event.source,
      description: event.description,
      metadata: event.metadata,
      createdAt: event.createdAt,
      actor: serializeActor(event.actor),
    })),
    deliveries: (subscription.deliveries || []).map(serializeDelivery),
    canPause: subscription.status === "ACTIVE",
    canResume: subscription.status === "PAUSED",
    canCancel: ["ACTIVE", "PAUSED"].includes(subscription.status),
    isDue: Boolean(subscription.status === "ACTIVE" && subscription.nextDeliveryAt && subscription.nextDeliveryAt <= businessDateToday()),
    isDeliveryConfigured: Boolean(
      subscription.addressId &&
      subscription.intervalDays &&
      subscription.nextDeliveryAt &&
      (subscription.items || []).length,
    ),
  };
}

async function getOwnedAddress(client, userId, addressId) {
  const address = await client.address.findFirst({
    where: { id: addressId, userId },
  });
  if (!address) {
    throw subscriptionError("Адрес доставки не найден в вашем аккаунте.", 404, "SUBSCRIPTION_ADDRESS_NOT_FOUND");
  }
  return address;
}

async function prepareSubscriptionItems(client, rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (items.length === 0) {
    throw subscriptionError("Добавьте хотя бы один товар в подписку.", 400, "SUBSCRIPTION_ITEMS_REQUIRED");
  }
  if (items.length > MAX_SUBSCRIPTION_ITEMS) {
    throw subscriptionError(`В подписке может быть не более ${MAX_SUBSCRIPTION_ITEMS} товаров.`, 400, "SUBSCRIPTION_TOO_MANY_ITEMS");
  }

  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.productId)) {
      throw subscriptionError("Один товар нельзя добавить в подписку дважды.", 400, "SUBSCRIPTION_DUPLICATE_PRODUCT");
    }
    seen.add(item.productId);
  }

  const products = await client.product.findMany({
    where: { id: { in: [...seen] } },
    select: getCommerceProductSelect(),
  });
  const productsById = new Map(products.map((product) => [product.id, product]));
  const priced = await applyActivePromotionsToProducts(products, client);
  const pricedById = new Map(priced.map((product) => [product.id, product]));
  const prepared = [];
  const issues = [];

  for (const item of items) {
    const product = productsById.get(item.productId);
    if (!product) {
      issues.push({ productId: item.productId, code: "PRODUCT_NOT_FOUND", message: "Товар не найден." });
      continue;
    }

    const quantity = roundQuantity(Number(item.quantity));
    const limits = getProductCommerceLimits(product);
    const normalized = limits.available
      ? normalizeCommerceQuantity(quantity, product, { allowZero: true })
      : 0;

    if (!limits.available) {
      issues.push({ productId: product.id, productName: product.name, code: "PRODUCT_NOT_AVAILABLE", message: `Товар «${product.name}» сейчас недоступен.` });
      continue;
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || Math.abs(normalized - quantity) > 0.0005) {
      issues.push({
        productId: product.id,
        productName: product.name,
        code: "INVALID_QUANTITY",
        message: `Количество товара «${product.name}» не соответствует текущему шагу, минимуму или остатку.`,
        min: limits.min,
        max: limits.max,
        step: limits.step,
      });
      continue;
    }

    const pricedProduct = pricedById.get(product.id) || product;
    prepared.push({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      unit: product.unit,
      quantity,
      lastUnitPrice: money(decimalToNumber(pricedProduct.price) ?? decimalToNumber(product.price) ?? 0),
    });
  }

  if (issues.length) {
    throw subscriptionError("Не удалось сохранить состав подписки. Проверьте товары и количество.", 409, "SUBSCRIPTION_ITEMS_INVALID", issues);
  }

  return prepared;
}

async function writeSubscriptionEvent(client, {
  subscriptionId,
  actorId = null,
  action,
  source,
  description = null,
  metadata = null,
}) {
  return client.subscriptionEvent.create({
    data: {
      subscriptionId,
      actorId,
      action,
      source,
      description,
      ...(metadata === null ? {} : { metadata }),
    },
  });
}

async function writeAdminActivity(client, {
  actorId,
  action,
  subscriptionId,
  description,
  metadata = null,
}) {
  if (!actorId) return;
  await client.adminActivity.create({
    data: {
      actorId,
      action,
      entityType: "UserSubscription",
      entityId: String(subscriptionId),
      description,
      ...(metadata === null ? {} : { metadata }),
    },
  });
}

async function getLiveSubscriptionRecord(userId, client = prisma) {
  return client.userSubscription.findFirst({
    where: { userId, intervalDays: { not: null }, status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: SUBSCRIPTION_INCLUDE,
  });
}

export async function getCustomerSubscription(userId) {
  const subscription = await getLiveSubscriptionRecord(userId);
  return serializeSubscription(subscription);
}

export async function getSubscriptionOptions(userId) {
  const [addresses, products] = await Promise.all([
    prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.product.findMany({
      where: {
        isActive: true,
        isAvailable: true,
        category: { isActive: true },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 200,
      select: getCommerceProductSelect(),
    }),
  ]);

  const pricedProducts = await applyActivePromotionsToProducts(products);

  const today = businessDateToday();

  return {
    today: dateKey(today),
    defaultNextDeliveryDate: dateKey(addDays(today, 1)),
    maxNextDeliveryDate: dateKey(addDays(today, 180)),
    intervals: [
      { days: 7, label: "Раз в неделю" },
      { days: 14, label: "Раз в 2 недели" },
      { days: 30, label: "Раз в 30 дней" },
    ],
    addresses: addresses.map(serializeAddress),
    products: pricedProducts.map((product) => serializeCommerceItem(product, decimalToNumber(product.minQuantity) ?? 1)),
  };
}

export async function createCustomerSubscription({ userId, input }) {
  const intervalDays = validateIntervalDays(input.intervalDays);
  const nextDeliveryAt = validateNextDeliveryDate(input.nextDeliveryDate);

  try {
    const subscriptionId = await runSerializable(async (transaction) => {
      const existing = await transaction.userSubscription.findFirst({
        where: { userId, intervalDays: { not: null }, status: { in: ["ACTIVE", "PAUSED"] } },
        select: { id: true },
      });
      if (existing) {
        throw subscriptionError("У вас уже есть активная или приостановленная подписка.", 409, "SUBSCRIPTION_ALREADY_EXISTS");
      }

      const address = await getOwnedAddress(transaction, userId, input.addressId);
      const items = await prepareSubscriptionItems(transaction, input.items);

      const created = await transaction.userSubscription.create({
        data: {
          userId,
          planId: null,
          addressId: input.addressId,
          addressSnapshot: formatAddressSnapshot(address),
          status: "ACTIVE",
          intervalDays,
          nextDeliveryAt,
          startsAt: new Date(),
          expiresAt: null,
          autoRenew: false,
          items: { create: items },
        },
        select: { id: true },
      });

      await writeSubscriptionEvent(transaction, {
        subscriptionId: created.id,
        actorId: userId,
        action: "SUBSCRIPTION_CREATED",
        source: "CUSTOMER",
        description: "Подписка на регулярную доставку создана.",
        metadata: {
          addressId: input.addressId,
          intervalDays,
          nextDeliveryDate: dateKey(nextDeliveryAt),
          itemCount: items.length,
        },
      });

      return created.id;
    });

    return getSubscriptionByIdForUser(subscriptionId, userId);
  } catch (error) {
    if (error?.code === "P2002") {
      throw subscriptionError("У вас уже есть активная или приостановленная подписка.", 409, "SUBSCRIPTION_ALREADY_EXISTS");
    }
    throw error;
  }
}

async function getSubscriptionByIdForUser(subscriptionId, userId) {
  const subscription = await prisma.userSubscription.findFirst({
    where: { id: subscriptionId, userId },
    include: SUBSCRIPTION_INCLUDE,
  });
  return serializeSubscription(subscription);
}

export async function updateCustomerSubscription({ userId, input }) {
  const resultId = await runSerializable(async (transaction) => {
    const existing = await transaction.userSubscription.findFirst({
      where: { userId, intervalDays: { not: null }, status: { in: ["ACTIVE", "PAUSED"] } },
      include: { items: true },
    });
    if (!existing) {
      throw subscriptionError("Активная подписка не найдена.", 404, "SUBSCRIPTION_NOT_FOUND");
    }

    const data = {};
    const metadata = {};

    if (Object.hasOwn(input, "addressId")) {
      const address = await getOwnedAddress(transaction, userId, input.addressId);
      data.addressId = input.addressId;
      data.addressSnapshot = formatAddressSnapshot(address);
      metadata.addressId = input.addressId;
    }
    if (Object.hasOwn(input, "intervalDays")) {
      data.intervalDays = validateIntervalDays(input.intervalDays);
      metadata.intervalDays = data.intervalDays;
    }
    if (Object.hasOwn(input, "nextDeliveryDate")) {
      data.nextDeliveryAt = validateNextDeliveryDate(input.nextDeliveryDate);
      metadata.nextDeliveryDate = dateKey(data.nextDeliveryAt);
    }

    if (Object.keys(data).length) {
      await transaction.userSubscription.update({ where: { id: existing.id }, data });
    }

    if (Object.hasOwn(input, "items")) {
      const items = await prepareSubscriptionItems(transaction, input.items);
      await transaction.subscriptionItem.deleteMany({ where: { subscriptionId: existing.id } });
      await transaction.subscriptionItem.createMany({
        data: items.map((item) => ({ ...item, subscriptionId: existing.id })),
      });
      metadata.itemCount = items.length;
    }

    await writeSubscriptionEvent(transaction, {
      subscriptionId: existing.id,
      actorId: userId,
      action: "SUBSCRIPTION_UPDATED",
      source: "CUSTOMER",
      description: "Параметры подписки изменены.",
      metadata,
    });

    return existing.id;
  });

  return getSubscriptionByIdForUser(resultId, userId);
}

export async function pauseCustomerSubscription(userId) {
  const id = await runSerializable(async (transaction) => {
    const subscription = await transaction.userSubscription.findFirst({
      where: { userId, intervalDays: { not: null }, status: "ACTIVE" },
      select: { id: true },
    });
    if (!subscription) throw subscriptionError("Активная подписка не найдена.", 404, "SUBSCRIPTION_NOT_ACTIVE");

    await transaction.userSubscription.update({
      where: { id: subscription.id },
      data: { status: "PAUSED", pausedAt: new Date() },
    });
    await writeSubscriptionEvent(transaction, {
      subscriptionId: subscription.id,
      actorId: userId,
      action: "SUBSCRIPTION_PAUSED",
      source: "CUSTOMER",
      description: "Подписка приостановлена покупателем.",
    });
    return subscription.id;
  });
  return getSubscriptionByIdForUser(id, userId);
}

export async function resumeCustomerSubscription({ userId, nextDeliveryDate = null }) {
  const id = await runSerializable(async (transaction) => {
    const subscription = await transaction.userSubscription.findFirst({
      where: { userId, intervalDays: { not: null }, status: "PAUSED" },
      select: { id: true, nextDeliveryAt: true, intervalDays: true },
    });
    if (!subscription) throw subscriptionError("Приостановленная подписка не найдена.", 404, "SUBSCRIPTION_NOT_PAUSED");

    let next = subscription.nextDeliveryAt;
    if (nextDeliveryDate) {
      next = validateNextDeliveryDate(nextDeliveryDate);
    } else if (!next || next < businessDateToday()) {
      next = addDays(businessDateToday(), 1);
    }

    await transaction.userSubscription.update({
      where: { id: subscription.id },
      data: { status: "ACTIVE", pausedAt: null, nextDeliveryAt: next },
    });
    await writeSubscriptionEvent(transaction, {
      subscriptionId: subscription.id,
      actorId: userId,
      action: "SUBSCRIPTION_RESUMED",
      source: "CUSTOMER",
      description: "Подписка возобновлена покупателем.",
      metadata: { nextDeliveryDate: next ? dateKey(next) : null },
    });
    return subscription.id;
  });
  return getSubscriptionByIdForUser(id, userId);
}

export async function cancelCustomerSubscription(userId) {
  return runSerializable(async (transaction) => {
    const subscription = await transaction.userSubscription.findFirst({
      where: { userId, intervalDays: { not: null }, status: { in: ["ACTIVE", "PAUSED"] } },
      select: { id: true },
    });
    if (!subscription) throw subscriptionError("Подписка не найдена.", 404, "SUBSCRIPTION_NOT_FOUND");

    const now = new Date();
    await transaction.userSubscription.update({
      where: { id: subscription.id },
      data: { status: "CANCELLED", cancelledAt: now, pausedAt: null },
    });
    await writeSubscriptionEvent(transaction, {
      subscriptionId: subscription.id,
      actorId: userId,
      action: "SUBSCRIPTION_CANCELLED",
      source: "CUSTOMER",
      description: "Подписка отменена покупателем.",
    });
    return { id: subscription.id, status: "CANCELLED", cancelledAt: now };
  });
}

function adminSubscriptionWhere({ q = "", status = "all" } = {}) {
  const and = [{ intervalDays: { not: null } }];
  const normalized = String(q || "").trim();
  if (["ACTIVE", "PAUSED", "CANCELLED", "EXPIRED"].includes(status)) and.push({ status });
  if (normalized) {
    and.push({
      OR: [
        { user: { is: { email: { contains: normalized, mode: "insensitive" } } } },
        { user: { is: { phone: { contains: normalized, mode: "insensitive" } } } },
        { user: { is: { firstName: { contains: normalized, mode: "insensitive" } } } },
        { user: { is: { lastName: { contains: normalized, mode: "insensitive" } } } },
        { items: { some: { productName: { contains: normalized, mode: "insensitive" } } } },
        { items: { some: { sku: { contains: normalized, mode: "insensitive" } } } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export async function listAdminSubscriptions({ q = "", status = "all", page = 1, limit = 30 } = {}) {
  const where = adminSubscriptionWhere({ q, status });
  const skip = (page - 1) * limit;
  const today = businessDateToday();
  const [total, subscriptions, allCount, activeCount, pausedCount, dueCount] = await Promise.all([
    prisma.userSubscription.count({ where }),
    prisma.userSubscription.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, isActive: true } },
        address: true,
        items: {
          orderBy: { id: "asc" },
          include: { product: { select: getCommerceProductSelect() } },
        },
        _count: { select: { deliveries: true } },
      },
    }),
    prisma.userSubscription.count({ where: { intervalDays: { not: null } } }),
    prisma.userSubscription.count({ where: { intervalDays: { not: null }, status: "ACTIVE" } }),
    prisma.userSubscription.count({ where: { intervalDays: { not: null }, status: "PAUSED" } }),
    prisma.userSubscription.count({ where: { intervalDays: { not: null }, status: "ACTIVE", nextDeliveryAt: { lte: today } } }),
  ]);

  const items = [];
  for (const subscription of subscriptions) {
    const priced = await priceSubscriptionItems(subscription.items);
    items.push({
      id: subscription.id,
      status: subscription.status,
      intervalDays: subscription.intervalDays,
      nextDeliveryAt: subscription.nextDeliveryAt,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
      customer: {
        id: subscription.user.id,
        name: [subscription.user.firstName, subscription.user.lastName].filter(Boolean).join(" ") || subscription.user.email || subscription.user.phone || `#${subscription.user.id}`,
        email: subscription.user.email,
        phone: subscription.user.phone,
        isActive: subscription.user.isActive,
      },
      address: subscription.address
        ? serializeAddress(subscription.address)
        : subscription.addressSnapshot
          ? { id: null, title: null, formatted: subscription.addressSnapshot, isDeleted: true }
          : null,
      items: priced.items,
      summary: priced.summary,
      deliveriesCount: subscription._count.deliveries,
    });
  }

  return {
    items,
    metrics: { total: allCount, active: activeCount, paused: pausedCount, due: dueCount },
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getAdminSubscription(subscriptionId) {
  const subscription = await prisma.userSubscription.findFirst({
    where: { id: subscriptionId, intervalDays: { not: null } },
    include: {
      ...SUBSCRIPTION_INCLUDE,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          isActive: true,
          createdAt: true,
        },
      },
    },
  });
  if (!subscription) return null;
  const serialized = await serializeSubscription(subscription);
  return {
    ...serialized,
    customer: {
      id: subscription.user.id,
      name: [subscription.user.firstName, subscription.user.lastName].filter(Boolean).join(" ") || subscription.user.email || subscription.user.phone || `#${subscription.user.id}`,
      email: subscription.user.email,
      phone: subscription.user.phone,
      isActive: subscription.user.isActive,
      createdAt: subscription.user.createdAt,
    },
  };
}

async function mutateAdminStatus({ subscriptionId, actorId, action, nextDeliveryDate = null }) {
  await runSerializable(async (transaction) => {
    const subscription = await transaction.userSubscription.findFirst({
      where: { id: subscriptionId, intervalDays: { not: null } },
      select: { id: true, userId: true, status: true, nextDeliveryAt: true },
    });
    if (!subscription) throw subscriptionError("Подписка не найдена.", 404, "SUBSCRIPTION_NOT_FOUND");

    const now = new Date();
    let data;
    let eventAction;
    let description;

    if (action === "pause") {
      if (subscription.status !== "ACTIVE") throw subscriptionError("Приостановить можно только активную подписку.", 409, "SUBSCRIPTION_STATUS_CONFLICT");
      data = { status: "PAUSED", pausedAt: now };
      eventAction = "SUBSCRIPTION_PAUSED";
      description = "Подписка приостановлена администратором.";
    } else if (action === "resume") {
      if (subscription.status !== "PAUSED") throw subscriptionError("Возобновить можно только приостановленную подписку.", 409, "SUBSCRIPTION_STATUS_CONFLICT");
      let next = nextDeliveryDate ? validateNextDeliveryDate(nextDeliveryDate) : subscription.nextDeliveryAt;
      if (!next || next < businessDateToday()) next = addDays(businessDateToday(), 1);
      data = { status: "ACTIVE", pausedAt: null, nextDeliveryAt: next };
      eventAction = "SUBSCRIPTION_RESUMED";
      description = "Подписка возобновлена администратором.";
    } else if (action === "cancel") {
      if (!["ACTIVE", "PAUSED"].includes(subscription.status)) throw subscriptionError("Эту подписку уже нельзя отменить.", 409, "SUBSCRIPTION_STATUS_CONFLICT");
      data = { status: "CANCELLED", cancelledAt: now, pausedAt: null };
      eventAction = "SUBSCRIPTION_CANCELLED";
      description = "Подписка отменена администратором.";
    } else {
      throw subscriptionError("Неизвестное действие.", 400, "SUBSCRIPTION_INVALID_ACTION");
    }

    await transaction.userSubscription.update({ where: { id: subscriptionId }, data });
    await writeSubscriptionEvent(transaction, {
      subscriptionId,
      actorId,
      action: eventAction,
      source: "ADMIN",
      description,
      metadata: { previousStatus: subscription.status, nextStatus: data.status },
    });
    await writeAdminActivity(transaction, {
      actorId,
      action: `ADMIN_${eventAction}`,
      subscriptionId,
      description,
      metadata: { customerId: subscription.userId, previousStatus: subscription.status, nextStatus: data.status },
    });
  });

  return getAdminSubscription(subscriptionId);
}

export async function pauseAdminSubscription(args) {
  return mutateAdminStatus({ ...args, action: "pause" });
}

export async function resumeAdminSubscription(args) {
  return mutateAdminStatus({ ...args, action: "resume" });
}

export async function cancelAdminSubscription(args) {
  return mutateAdminStatus({ ...args, action: "cancel" });
}

function createOrderNumber() {
  const now = new Date();
  const date = [
    String(now.getUTCFullYear()).slice(-2),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  return `SD-${date}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function subscriptionCheckoutKey(subscriptionId, scheduledFor) {
  return createHash("sha256")
    .update(`subscription:${subscriptionId}:${dateKey(scheduledFor)}`)
    .digest("hex");
}

async function loadGenerationSubscription(transaction, subscriptionId) {
  return transaction.userSubscription.findUnique({
    where: { id: subscriptionId },
    include: {
      user: { select: { id: true, email: true, phone: true, firstName: true, lastName: true, isActive: true } },
      address: true,
      items: {
        orderBy: { id: "asc" },
        include: { product: { select: getCommerceProductSelect() } },
      },
    },
  });
}

async function prepareOrderLines(subscription, transaction) {
  if (!subscription.items.length) {
    throw subscriptionError("В подписке нет товаров.", 409, "SUBSCRIPTION_EMPTY");
  }
  const currentProducts = subscription.items.map((item) => item.product).filter(Boolean);
  const pricedProducts = await applyActivePromotionsToProducts(currentProducts, transaction);
  const pricedById = new Map(pricedProducts.map((product) => [product.id, product]));
  const issues = [];
  let subtotalCents = 0;
  let totalCents = 0;
  const lines = [];

  for (const item of subscription.items) {
    const product = item.product;
    if (!product) {
      issues.push({ productName: item.productName, sku: item.sku, code: "PRODUCT_DELETED", message: `Товар «${item.productName}» больше не существует.` });
      continue;
    }
    const quantity = roundQuantity(decimalToNumber(item.quantity) ?? 0);
    const limits = getProductCommerceLimits(product);
    const normalized = limits.available ? normalizeCommerceQuantity(quantity, product, { allowZero: true }) : 0;
    if (!limits.available || Math.abs(normalized - quantity) > 0.0005) {
      issues.push({
        productId: product.id,
        productName: product.name,
        code: limits.available ? "INVALID_QUANTITY" : "PRODUCT_NOT_AVAILABLE",
        message: `Товар «${product.name}» сейчас нельзя добавить в плановый заказ в количестве ${quantity}.`,
        availableQuantity: limits.max,
      });
      continue;
    }

    const pricedProduct = pricedById.get(product.id) || product;
    const pricing = buildLinePricing(pricedProduct, quantity);
    subtotalCents += pricing.baseLineCents;
    totalCents += pricing.currentLineCents;
    lines.push({
      subscriptionItemId: item.id,
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      unit: product.unit,
      quantity,
      baseUnitPrice: pricing.baseUnitPrice,
      unitPrice: pricing.unitPrice,
      discountTotal: pricing.discountTotal,
      total: pricing.total,
    });
  }

  if (issues.length) {
    throw subscriptionError("Плановый заказ не создан: состав подписки сейчас недоступен.", 409, "SUBSCRIPTION_ORDER_ITEMS_UNAVAILABLE", issues);
  }

  return {
    lines,
    subtotal: fromCents(subtotalCents),
    discountTotal: fromCents(Math.max(0, subtotalCents - totalCents)),
    merchandiseTotal: fromCents(totalCents),
  };
}

async function recordGenerationFailure({ subscriptionId, scheduledFor, error, actorId = null, source = "SYSTEM", now = new Date() }) {
  const exposedMessage = error?.expose === true && typeof error?.message === "string"
    ? error.message.slice(0, 1000)
    : "Не удалось сформировать плановый заказ.";
  const code = typeof error?.code === "string" ? error.code.slice(0, 100) : "SUBSCRIPTION_GENERATION_FAILED";

  try {
    await runSerializable(async (transaction) => {
      const subscription = await transaction.userSubscription.findUnique({
        where: { id: subscriptionId },
        select: { id: true, status: true, intervalDays: true, nextDeliveryAt: true },
      });
      if (!subscription || subscription.status !== "ACTIVE" || !subscription.intervalDays || !subscription.nextDeliveryAt) return;
      if (dateKey(subscription.nextDeliveryAt) !== dateKey(scheduledFor)) return;

      const existing = await transaction.subscriptionDelivery.findUnique({
        where: { subscriptionId_scheduledFor: { subscriptionId, scheduledFor } },
        select: { id: true },
      });
      if (existing) return;

      await transaction.subscriptionDelivery.create({
        data: {
          subscriptionId,
          scheduledFor,
          status: "FAILED",
          failureCode: code,
          failureMessage: exposedMessage,
          generatedAt: now,
        },
      });
      const next = nextCadenceDate(scheduledFor, subscription.intervalDays, now);
      await transaction.userSubscription.update({
        where: { id: subscriptionId },
        data: { nextDeliveryAt: next },
      });
      await writeSubscriptionEvent(transaction, {
        subscriptionId,
        actorId,
        action: "SUBSCRIPTION_ORDER_FAILED",
        source,
        description: `Плановый заказ на ${dateKey(scheduledFor)} не сформирован: ${exposedMessage}`,
        metadata: { code, scheduledFor: dateKey(scheduledFor), nextDeliveryDate: dateKey(next) },
      });
      if (source === "ADMIN") {
        await writeAdminActivity(transaction, {
          actorId,
          action: "SUBSCRIPTION_ORDER_GENERATION_FAILED",
          subscriptionId,
          description: `Не удалось сформировать плановый заказ по подписке #${subscriptionId}: ${exposedMessage}`,
          metadata: { code, scheduledFor: dateKey(scheduledFor), nextDeliveryDate: dateKey(next) },
        });
      }
    });
  } catch (recordError) {
    if (!["P2002", "P2034"].includes(recordError?.code)) throw recordError;
  }
}

export async function generateSubscriptionOrder({ subscriptionId, scheduledFor = null, actorId = null, source = "SYSTEM" }) {
  const now = new Date();
  let targetDate = scheduledFor ? parseDateOnly(scheduledFor, "Дата доставки") : null;

  try {
    const result = await runSerializable(async (transaction) => {
      const subscription = await loadGenerationSubscription(transaction, subscriptionId);
      if (!subscription) throw subscriptionError("Подписка не найдена.", 404, "SUBSCRIPTION_NOT_FOUND");
      if (subscription.status !== "ACTIVE") throw subscriptionError("Заказы создаются только для активной подписки.", 409, "SUBSCRIPTION_NOT_ACTIVE");
      targetDate ??= subscription.nextDeliveryAt;
      if (!subscription.user?.isActive) throw subscriptionError("Аккаунт клиента отключён.", 409, "SUBSCRIPTION_CUSTOMER_INACTIVE");
      if (!subscription.address || !subscription.intervalDays || !subscription.nextDeliveryAt) {
        throw subscriptionError("Подписка настроена не полностью.", 409, "SUBSCRIPTION_NOT_CONFIGURED");
      }
      const existingDelivery = await transaction.subscriptionDelivery.findUnique({
        where: { subscriptionId_scheduledFor: { subscriptionId, scheduledFor: targetDate } },
        include: { order: { select: { id: true, number: true, total: true, currency: true } } },
      });
      if (existingDelivery) {
        return { created: false, delivery: existingDelivery, nextDeliveryAt: subscription.nextDeliveryAt };
      }
      if (dateKey(targetDate) !== dateKey(subscription.nextDeliveryAt)) {
        throw subscriptionError("Дата генерации не совпадает со следующей доставкой.", 409, "SUBSCRIPTION_DELIVERY_DATE_CONFLICT");
      }
      if (targetDate > businessDateToday(now)) {
        throw subscriptionError("Дата следующей доставки ещё не наступила.", 409, "SUBSCRIPTION_NOT_DUE");
      }

      const lines = await prepareOrderLines(subscription, transaction);
      const deliveryPrice = 0;
      const total = money(lines.merchandiseTotal + deliveryPrice);
      const checkoutKey = subscriptionCheckoutKey(subscriptionId, targetDate);

      const duplicateOrder = await transaction.order.findUnique({ where: { checkoutKey }, select: { id: true, number: true, total: true, currency: true } });
      if (duplicateOrder) {
        const delivery = await transaction.subscriptionDelivery.create({
          data: {
            subscriptionId,
            orderId: duplicateOrder.id,
            scheduledFor: targetDate,
            status: "ORDER_CREATED",
            generatedAt: now,
          },
          include: { order: { select: { id: true, number: true, total: true, currency: true } } },
        });
        const next = nextCadenceDate(targetDate, subscription.intervalDays, now);
        await transaction.userSubscription.update({ where: { id: subscriptionId }, data: { nextDeliveryAt: next } });
        await writeSubscriptionEvent(transaction, {
          subscriptionId,
          actorId,
          action: "SUBSCRIPTION_ORDER_RECONCILED",
          source,
          description: `Связь с уже существующим заказом ${duplicateOrder.number} восстановлена для доставки ${dateKey(targetDate)}.`,
          metadata: { orderId: duplicateOrder.id, orderNumber: duplicateOrder.number, scheduledFor: dateKey(targetDate), nextDeliveryDate: dateKey(next) },
        });
        if (source === "ADMIN") {
          await writeAdminActivity(transaction, {
            actorId,
            action: "SUBSCRIPTION_ORDER_RECONCILED",
            subscriptionId,
            description: `По подписке #${subscriptionId} восстановлена связь с заказом ${duplicateOrder.number}.`,
            metadata: { orderId: duplicateOrder.id, scheduledFor: dateKey(targetDate) },
          });
        }
        return { created: false, delivery, nextDeliveryAt: next };
      }

      const order = await transaction.order.create({
        data: {
          number: createOrderNumber(),
          checkoutKey,
          userId: subscription.userId,
          status: "NEW",
          paymentStatus: "PENDING",
          deliveryStatus: "PENDING",
          deliveryMethod: "DELIVERY",
          paymentMethod: "ON_RECEIPT",
          addressId: subscription.address.id,
          customerName: subscription.address.recipientName || [subscription.user.firstName, subscription.user.lastName].filter(Boolean).join(" ") || "Покупатель",
          customerPhone: subscription.address.phone || subscription.user.phone || "",
          customerEmail: subscription.user.email,
          deliveryAddressSnapshot: formatAddressSnapshot(subscription.address),
          requestedReceiveDate: targetDate,
          requestedTimeWindow: null,
          comment: `Автоматически сформировано по подписке #${subscription.id}.`,
          subtotal: lines.subtotal.toFixed(2),
          discountTotal: lines.discountTotal.toFixed(2),
          deliveryPrice: deliveryPrice.toFixed(2),
          deliveryPriceConfirmed: false,
          total: total.toFixed(2),
          currency: "RUB",
          items: {
            create: lines.lines.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              sku: item.sku,
              unit: item.unit,
              quantity: item.quantity.toFixed(3),
              baseUnitPrice: item.baseUnitPrice.toFixed(2),
              unitPrice: item.unitPrice.toFixed(2),
              discountTotal: item.discountTotal.toFixed(2),
              total: item.total.toFixed(2),
            })),
          },
        },
        select: { id: true, number: true, total: true, currency: true },
      });

      await reserveInventoryForOrder(transaction, order.id);

      const delivery = await transaction.subscriptionDelivery.create({
        data: {
          subscriptionId,
          orderId: order.id,
          scheduledFor: targetDate,
          status: "ORDER_CREATED",
          generatedAt: now,
        },
        include: { order: { select: { id: true, number: true, total: true, currency: true } } },
      });

      for (const line of lines.lines) {
        await transaction.subscriptionItem.update({
          where: { id: line.subscriptionItemId },
          data: { lastUnitPrice: line.unitPrice.toFixed(2) },
        });
      }

      const next = nextCadenceDate(targetDate, subscription.intervalDays, now);
      await transaction.userSubscription.update({ where: { id: subscriptionId }, data: { nextDeliveryAt: next } });
      await writeSubscriptionEvent(transaction, {
        subscriptionId,
        actorId,
        action: "SUBSCRIPTION_ORDER_CREATED",
        source,
        description: `Создан заказ ${order.number} на доставку ${dateKey(targetDate)}.`,
        metadata: { orderId: order.id, orderNumber: order.number, scheduledFor: dateKey(targetDate), total, nextDeliveryDate: dateKey(next) },
      });
      if (source === "ADMIN") {
        await writeAdminActivity(transaction, {
          actorId,
          action: "SUBSCRIPTION_ORDER_GENERATED",
          subscriptionId,
          description: `По подписке #${subscriptionId} вручную создан заказ ${order.number}.`,
          metadata: { orderId: order.id, scheduledFor: dateKey(targetDate), total },
        });
      }

      return { created: true, delivery, nextDeliveryAt: next };
    });

    return {
      created: result.created,
      delivery: serializeDelivery(result.delivery),
      nextDeliveryAt: result.nextDeliveryAt,
    };
  } catch (error) {
    if (error?.code === "P2002") {
      const existing = targetDate
        ? await prisma.subscriptionDelivery.findUnique({
            where: { subscriptionId_scheduledFor: { subscriptionId, scheduledFor: targetDate } },
            include: { order: { select: { id: true, number: true, total: true, currency: true } } },
          })
        : null;
      if (existing) return { created: false, delivery: serializeDelivery(existing), nextDeliveryAt: null };
    }

    const noFailureRecordCodes = new Set([
      "SUBSCRIPTION_NOT_FOUND",
      "SUBSCRIPTION_NOT_ACTIVE",
      "SUBSCRIPTION_NOT_DUE",
      "SUBSCRIPTION_DELIVERY_DATE_CONFLICT",
      "P2034",
    ]);
    if (targetDate && !noFailureRecordCodes.has(error?.code)) {
      await recordGenerationFailure({ subscriptionId, scheduledFor: targetDate, error, actorId, source, now });
    }
    throw error;
  }
}

export async function generateDueSubscriptionOrders({ limit = 100, actorId = null, source = "SYSTEM" } = {}) {
  const today = businessDateToday();
  const due = await prisma.userSubscription.findMany({
    where: {
      status: "ACTIVE",
      nextDeliveryAt: { lte: today },
      intervalDays: { not: null },
    },
    orderBy: [{ nextDeliveryAt: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(Number(limit) || 100, 1), 500),
    select: { id: true, nextDeliveryAt: true },
  });

  const results = [];
  for (const subscription of due) {
    try {
      const result = await generateSubscriptionOrder({
        subscriptionId: subscription.id,
        scheduledFor: subscription.nextDeliveryAt,
        actorId,
        source,
      });
      results.push({ subscriptionId: subscription.id, ok: true, ...result });
    } catch (error) {
      results.push({
        subscriptionId: subscription.id,
        ok: false,
        code: typeof error?.code === "string" ? error.code : "SUBSCRIPTION_GENERATION_FAILED",
        message: error?.expose === true ? error.message : "Не удалось сформировать заказ.",
      });
    }
  }

  const summary = {
    checked: due.length,
    created: results.filter((item) => item.ok && item.created).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };

  if (source === "ADMIN" && actorId) {
    await prisma.adminActivity.create({
      data: {
        actorId,
        action: "SUBSCRIPTION_DUE_GENERATION_RUN",
        entityType: "UserSubscription",
        description: `Запущена обработка подписок: проверено ${summary.checked}, создано ${summary.created}, ошибок ${summary.failed}.`,
        metadata: { checked: summary.checked, created: summary.created, failed: summary.failed },
      },
    });
  }

  return summary;
}
