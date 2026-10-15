import assert from "node:assert/strict";
import { getPublicCatalog } from "../services/catalog.service.js";
import { getPublicProductBySlug } from "../services/product.service.js";
import { addFavorite, getFavorites } from "../services/favorite.service.js";
import { businessDateKey } from "../utils/dates.js";
import { env } from "../config/env.js";
import { assertTestEnvironment } from "../utils/test-environment.js";
import { randomUUID } from "node:crypto";

import { connectDatabase, disconnectDatabase, prisma } from "../lib/prisma.js";
import { getCart } from "../services/cart.service.js";
import { createCheckoutOrder } from "../services/checkout.service.js";
import {
  applyActivePromotionsToProducts,
  createAdminPromotion,
  updateAdminPromotion,
} from "../services/promotion.service.js";

const suffix = randomUUID().slice(0, 8);
const now = new Date();
const hour = 60 * 60 * 1000;

let categoryId = null;
let productId = null;
let cartId = null;
let orderId = null;
const promotionIds = [];
const sessionId = `promo-smoke-${randomUUID()}`;

function number(value) {
  return Number(value?.toString?.() ?? value);
}

async function cleanup() {
  await prisma.guestFavorite.deleteMany({ where: { sessionId } });
  if (productId) {
    await prisma.inventoryMovement.deleteMany({ where: { productId } });
  }
  if (orderId) {
    await prisma.order.deleteMany({ where: { id: orderId } });
  }
  if (cartId) {
    await prisma.cart.deleteMany({ where: { id: cartId } });
  }
  if (promotionIds.length) {
    await prisma.adminActivity.deleteMany({
      where: { entityType: "Promotion", entityId: { in: promotionIds.map(String) } },
    });
    await prisma.promotion.deleteMany({ where: { id: { in: promotionIds } } });
  }
  if (productId) {
    await prisma.product.deleteMany({ where: { id: productId } });
  }
  if (categoryId) {
    await prisma.category.deleteMany({ where: { id: categoryId } });
  }
}

await assertTestEnvironment(env, prisma, { http: false });

try {
  await connectDatabase();

  const category = await prisma.category.create({
    data: {
      name: `Promo Smoke ${suffix}`,
      slug: `promo-smoke-${suffix}`,
      isActive: true,
      sortOrder: 99999,
    },
  });
  categoryId = category.id;

  const product = await prisma.product.create({
    data: {
      categoryId,
      name: `Promo Smoke Product ${suffix}`,
      slug: `promo-smoke-product-${suffix}`,
      sku: `PROMO-SMOKE-${suffix}`.toUpperCase(),
      unit: "PIECE",
      unitLabel: "шт.",
      price: "1000.00",
      oldPrice: "1200.00",
      step: "1.000",
      minQuantity: "1.000",
      stockQuantity: "10.000",
      reservedQuantity: "0.000",
      isActive: true,
      isAvailable: true,
      isPopular: true,
    },
    include: {
      category: { select: { id: true, name: true, slug: true, isActive: true } },
      images: true,
    },
  });
  productId = product.id;

  const categoryPromotion = await createAdminPromotion({
    actorId: null,
    input: {
      name: `Category 10 ${suffix}`,
      slug: `category-10-${suffix}`,
      description: null,
      type: "PERCENT",
      discountValue: 10,
      startsAt: new Date(now.getTime() - hour),
      endsAt: new Date(now.getTime() + 24 * hour),
      status: "ACTIVE",
      isFeatured: false,
      productIds: [],
      categoryIds: [categoryId],
    },
  });
  promotionIds.push(categoryPromotion.id);

  const productPromotion = await createAdminPromotion({
    actorId: null,
    input: {
      name: `Product 25 ${suffix}`,
      slug: `product-25-${suffix}`,
      description: null,
      type: "PERCENT",
      discountValue: 25,
      startsAt: new Date(now.getTime() - hour),
      endsAt: new Date(now.getTime() + 24 * hour),
      status: "ACTIVE",
      isFeatured: true,
      productIds: [productId],
      categoryIds: [],
    },
  });
  promotionIds.push(productPromotion.id);

  const fixedPromotion = await createAdminPromotion({
    actorId: null,
    input: {
      name: `Global fixed ${suffix}`,
      slug: `global-fixed-${suffix}`,
      description: null,
      type: "FIXED",
      discountValue: 100,
      startsAt: new Date(now.getTime() - hour),
      endsAt: new Date(now.getTime() + 24 * hour),
      status: "ACTIVE",
      isFeatured: false,
      productIds: [],
      categoryIds: [],
    },
  });
  promotionIds.push(fixedPromotion.id);

  const scheduledPromotion = await createAdminPromotion({
    actorId: null,
    input: {
      name: `Scheduled 90 ${suffix}`,
      slug: `scheduled-90-${suffix}`,
      description: null,
      type: "PERCENT",
      discountValue: 90,
      startsAt: new Date(now.getTime() + 24 * hour),
      endsAt: new Date(now.getTime() + 48 * hour),
      status: "ACTIVE",
      isFeatured: false,
      productIds: [productId],
      categoryIds: [],
    },
  });
  promotionIds.push(scheduledPromotion.id);

  const pausedPromotion = await createAdminPromotion({
    actorId: null,
    input: {
      name: `Paused 99 ${suffix}`,
      slug: `paused-99-${suffix}`,
      description: null,
      type: "PERCENT",
      discountValue: 99,
      startsAt: new Date(now.getTime() - hour),
      endsAt: new Date(now.getTime() + 24 * hour),
      status: "PAUSED",
      isFeatured: false,
      productIds: [productId],
      categoryIds: [],
    },
  });
  promotionIds.push(pausedPromotion.id);

  await updateAdminPromotion({
    promotionId: fixedPromotion.id,
    actorId: null,
    input: { discountValue: 150 },
  });

  const [priced] = await applyActivePromotionsToProducts([product]);
  if (number(priced.price) !== 750 || priced.promotion?.id !== productPromotion.id) {
    throw new Error(`Best promotion selection failed: expected 750 / #${productPromotion.id}, got ${priced.price} / #${priced.promotion?.id}.`);
  }
  if (number(priced.oldPrice) !== 1200) {
    throw new Error(`Old price reference was corrupted: ${priced.oldPrice}.`);
  }

  const cart = await prisma.cart.create({
    data: {
      sessionId,
      items: { create: { productId, quantity: "2.000" } },
    },
  });
  cartId = cart.id;

  const owner = { type: "guest", userId: null, sessionId };
  const serializedCart = await getCart(owner);
  if (number(serializedCart.items[0]?.unitPrice) !== 750 || number(serializedCart.summary.total) !== 1500) {
    throw new Error(`Cart promotion pricing failed: ${JSON.stringify(serializedCart.summary)}.`);
  }

  const catalogQuery = { category: category.slug, page: 1, limit: 1, sort: "price-asc" };
  const filtered = await getPublicCatalog({ ...catalogQuery, priceFrom: 750, priceTo: 750, discount: true });
  assert.equal(filtered.pagination.total, 1);
  assert.equal(filtered.products[0].id, productId);
  assert.equal(number(filtered.products[0].price), 750);
  assert.equal((await getPublicCatalog({ ...catalogQuery, priceTo: 749.99 })).pagination.total, 0);
  assert.equal((await getPublicCatalog({ ...catalogQuery, page: 2 })).products.length, 0);
  const popular = await getPublicCatalog({ ...catalogQuery, hit: true, available: true, sort: "popular" });
  assert.equal(popular.products[0].id, productId);
  assert.equal(number(popular.products[0].price), 750);
  const detail = await getPublicProductBySlug(product.slug);
  assert.equal(number(detail.price), 750);
  await addFavorite(owner, product.slug);
  assert.equal((await getFavorites(owner)).items[0].unitPrice, 750);

  const pickupPoint = await prisma.pickupPoint.findFirst({ where: { isActive: true }, select: { id: true } });
  const receiveDate = businessDateKey();
  const checkout = await createCheckoutOrder({
    owner,
    input: {
      idempotencyKey: randomUUID(),
      name: "Promo Smoke",
      phone: "+79990000000",
      email: `promo-smoke-${suffix}@example.com`,
      receiveMethod: "pickup",
      address: "",
      entrance: "",
      floor: "",
      receiveDate,
      receiveSlotId: null,
      pickupPointId: pickupPoint?.id ?? null,
      paymentMethod: "on-receipt",
      comment: "promotion smoke",
      agreement: true,
    },
  });
  orderId = checkout.order.id;

  const savedOrder = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, inventoryReservations: true },
  });
  const line = savedOrder?.items?.[0];
  if (!savedOrder || number(savedOrder.subtotal) !== 2400 || number(savedOrder.discountTotal) !== 900 || number(savedOrder.total) !== 1500) {
    throw new Error(`Order totals did not persist promotional pricing.`);
  }
  if (!line || number(line.baseUnitPrice) !== 1200 || number(line.unitPrice) !== 750 || number(line.discountTotal) !== 900 || number(line.total) !== 1500) {
    throw new Error(`OrderItem promotional snapshot is invalid.`);
  }
  if (savedOrder.inventoryReservations.length !== 1 || number(savedOrder.inventoryReservations[0].quantity) !== 2) {
    throw new Error("Inventory reservation was not created for promoted checkout.");
  }

  // The order reserved two units. Less than one remaining is not purchasable.
  await prisma.product.update({ where: { id: productId }, data: { stockQuantity: "2.500" } });
  assert.equal((await getPublicCatalog({ ...catalogQuery, available: true })).pagination.total, 0);
  assert.equal((await getPublicCatalog({ ...catalogQuery, lowStock: true })).pagination.total, 0);
  assert.equal((await getPublicCatalog({ ...catalogQuery, outOfStock: true })).pagination.total, 1);
  assert.equal((await getPublicCatalog({ ...catalogQuery, lowStock: true, outOfStock: true })).pagination.total, 1);
  assert.equal((await getPublicProductBySlug(product.slug)).isAvailable, false);
  assert.equal((await getFavorites(owner)).items[0].available, false);
  await prisma.product.update({ where: { id: productId }, data: { stockQuantity: "10.000", isActive: false } });
  assert.equal((await getPublicCatalog(catalogQuery)).pagination.total, 0);
  assert.equal(await getPublicProductBySlug(product.slug), null);
  await prisma.product.update({ where: { id: productId }, data: { isActive: true } });
  await prisma.category.update({ where: { id: categoryId }, data: { isActive: false } });
  assert.equal((await getPublicCatalog(catalogQuery)).pagination.total, 0);
  assert.equal(await getPublicProductBySlug(product.slug), null);
  assert.equal((await getFavorites(owner)).items[0].available, false);
  console.log("PASS: effective catalog filters, popular query, product, favorites, cart, checkout and availability agree.");

  console.log(`PASS: promotion #${productPromotion.id} won overlap, cart total 1500, order snapshot kept 900 discount and inventory reservation.`);
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
  try {
    await disconnectDatabase();
  } catch {}
}
