import { randomBytes } from "node:crypto";

import { prisma } from "../lib/prisma.js";
import {
  buildCommerceOwnerWhere,
  getCommerceProductSelect,
  getProductCommerceLimits,
  normalizeCommerceQuantity,
  serializeCommerceItem,
} from "./commerce.service.js";
import { reserveInventoryForOrder } from "./inventory.service.js";
import { applyActivePromotionsToProducts } from "./promotion.service.js";
import { getActiveDeliveryZones, quoteDelivery, moneyToKopecks, kopecksToRubles } from "./delivery.service.js";

function createCheckoutError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;

  if (details !== undefined) {
    error.details = details;
  }

  return error;
}

function decimalToNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value?.toString?.() ?? value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCents(value) {
  return Math.round((decimalToNumber(value) ?? 0) * 100);
}

function fromCents(value) {
  return Number((value / 100).toFixed(2));
}

function roundQuantity(value) {
  return Number(Number(value).toFixed(3));
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
    baseLineTotal: fromCents(baseLineCents),
    total: fromCents(currentLineCents),
    discountTotal: fromCents(Math.max(0, baseLineCents - currentLineCents)),
    baseLineCents,
    currentLineCents,
  };
}

function validateCheckoutCartItem(item) {
  const product = item.product;
  const storedQuantity = roundQuantity(decimalToNumber(item.quantity) ?? 0);
  const limits = getProductCommerceLimits(product);

  if (!limits.available) {
    return {
      code: "PRODUCT_NOT_AVAILABLE",
      slug: product.slug,
      productName: product.name,
      message: `Товар «${product.name}» сейчас недоступен.`,
    };
  }

  if (storedQuantity > limits.max + 0.0005) {
    return {
      code: "INSUFFICIENT_STOCK",
      slug: product.slug,
      productName: product.name,
      message: `Для товара «${product.name}» доступно не более ${limits.max}.`,
      requestedQuantity: storedQuantity,
      availableQuantity: limits.max,
    };
  }

  if (storedQuantity > 0 && storedQuantity < limits.min - 0.0005) {
    return {
      code: "BELOW_MINIMUM_QUANTITY",
      slug: product.slug,
      productName: product.name,
      message: `Минимальное количество товара «${product.name}» — ${limits.min}.`,
      requestedQuantity: storedQuantity,
      minimumQuantity: limits.min,
    };
  }

  const normalized = normalizeCommerceQuantity(storedQuantity, product, {
    allowZero: true,
  });

  if (storedQuantity <= 0 || Math.abs(normalized - storedQuantity) > 0.0005) {
    return {
      code: "CART_QUANTITY_OUTDATED",
      slug: product.slug,
      productName: product.name,
      message: `Количество товара «${product.name}» больше не соответствует текущим условиям продажи или остатку.`,
      requestedQuantity: storedQuantity,
      allowedQuantity: normalized,
    };
  }

  return null;
}

async function calculateCart(cart, client = prisma) {
  const issues = [];
  let subtotalCents = 0;
  let discountCents = 0;
  let merchandiseTotalCents = 0;

  const sourceItems = cart?.items || [];
  const pricedProducts = await applyActivePromotionsToProducts(
    sourceItems.map((item) => item.product),
    client,
  );
  const pricedById = new Map(pricedProducts.map((product) => [product.id, product]));

  const items = sourceItems.map((item) => {
    const issue = validateCheckoutCartItem(item);

    if (issue) issues.push(issue);

    const quantity = roundQuantity(decimalToNumber(item.quantity) ?? 0);
    const pricedProduct = pricedById.get(item.productId) || item.product;
    const pricing = buildLinePricing(pricedProduct, quantity);

    subtotalCents += pricing.baseLineCents;
    discountCents += Math.max(0, pricing.baseLineCents - pricing.currentLineCents);
    merchandiseTotalCents += pricing.currentLineCents;

    return {
      ...serializeCommerceItem(pricedProduct, item.quantity),
      sku: item.product.sku,
      unit: item.product.unit,
      baseUnitPrice: pricing.baseUnitPrice,
      unitPrice: pricing.unitPrice,
      lineSubtotal: pricing.baseLineTotal,
      discountTotal: pricing.discountTotal,
      total: pricing.total,
    };
  });

  return {
    items,
    issues,
    summary: {
      lines: items.length,
      quantity: roundQuantity(items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)),
      subtotal: fromCents(subtotalCents),
      discount: fromCents(discountCents),
      merchandiseTotal: fromCents(merchandiseTotalCents),
      deliveryPrice: null,
      deliveryPriceConfirmed: false,
      total: fromCents(merchandiseTotalCents),
      currency: "RUB",
      isFinal: false,
    },
  };
}

async function findCheckoutCart(owner, client = prisma) {
  const ownerWhere = buildCommerceOwnerWhere(owner);

  if (!ownerWhere) {
    return null;
  }

  return client.cart.findFirst({
    where: ownerWhere,
    include: {
      items: {
        orderBy: {
          createdAt: "asc",
        },
        include: {
          product: {
            select: getCommerceProductSelect(),
          },
        },
      },
    },
  });
}

function serializeAddress(address) {
  if (!address) {
    return null;
  }

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
  };
}

function formatAddressSnapshot({ address, entrance, floor }) {
  const parts = [String(address || "").trim()];

  if (String(entrance || "").trim()) {
    parts.push(`подъезд ${String(entrance).trim()}`);
  }

  if (String(floor || "").trim()) {
    parts.push(`этаж ${String(floor).trim()}`);
  }

  return parts.filter(Boolean).join(", ");
}

function parseReceiveDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw createCheckoutError(
      "Некорректная дата получения.",
      400,
      "INVALID_RECEIVE_DATE",
    );
  }

  return date;
}

function createOrderNumber() {
  const now = new Date();
  const date = [
    String(now.getUTCFullYear()).slice(-2),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = randomBytes(5).toString("hex").toUpperCase();
  return `SD-${date}-${random}`;
}

const ORDER_RESULT_SELECT = Object.freeze({
  id: true,
  number: true,
  userId: true,
  status: true,
  paymentStatus: true,
  deliveryStatus: true,
  deliveryMethod: true,
  paymentMethod: true,
  subtotal: true,
  discountTotal: true,
  deliveryPrice: true,
  deliveryPriceConfirmed: true,
  deliveryTermsSnapshot: true,
  total: true,
  currency: true,
  requestedReceiveDate: true,
  requestedTimeWindow: true,
  createdAt: true,
});

function serializeOrderResult(order) {
  if (!order) {
    return null;
  }

  return {
    ...order,
    subtotal: decimalToNumber(order.subtotal) ?? 0,
    discountTotal: decimalToNumber(order.discountTotal) ?? 0,
    deliveryPrice: decimalToNumber(order.deliveryPrice) ?? 0,
    total: decimalToNumber(order.total) ?? 0,
    canViewInAccount: Number.isInteger(order.userId),
  };
}

export async function getCheckoutState({ owner, userId = null, receiveDate = null, receiveMethod = null, deliveryZoneId = null, pickupPointId = null }) {
  const [cart, user, defaultAddress, pickupPoints, deliverySlots, deliveryZones] = await Promise.all([
    findCheckoutCart(owner),
    userId
      ? prisma.user.findFirst({
          where: {
            id: userId,
            isActive: true,
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        })
      : null,
    userId
      ? prisma.address.findFirst({
          where: {
            userId,
          },
          orderBy: [
            { isDefault: "desc" },
            { updatedAt: "desc" },
          ],
        })
      : null,
    prisma.pickupPoint.findMany({
      where: {
        isActive: true,
      },
      orderBy: [
        { sortOrder: "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        workingHours: true,
      },
    }),
    receiveDate
      ? prisma.deliverySlot.findMany({
          where: {
            date: parseReceiveDate(receiveDate),
            isActive: true,
          },
          orderBy: [
            { startTime: "asc" },
            { endTime: "asc" },
          ],
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
            capacity: true,
          },
        })
      : [],
    getActiveDeliveryZones(),
  ]);

  const calculated = await calculateCart(cart);
  // Quotes are informational: order creation always recalculates inside its transaction.
  if (calculated.items.length && calculated.issues.length === 0 && receiveMethod) {
    const hasSelection = receiveMethod === "delivery" ? Boolean(deliveryZoneId) : (Boolean(pickupPointId) || pickupPoints.length === 0);
    if (hasSelection) {
      const quote = await quoteDelivery({
        method: receiveMethod === "pickup" ? "PICKUP" : "DELIVERY",
        merchandiseTotal: calculated.summary.merchandiseTotal,
        deliveryZoneId: receiveMethod === "delivery" ? deliveryZoneId : null,
        pickupPointId: receiveMethod === "pickup" ? pickupPointId : null,
      });
      calculated.summary.deliveryPrice = quote.deliveryPrice;
      calculated.summary.deliveryPriceConfirmed = quote.deliveryPriceConfirmed;
      calculated.summary.total = kopecksToRubles(moneyToKopecks(calculated.summary.merchandiseTotal) + moneyToKopecks(quote.deliveryPrice));
      calculated.summary.isFinal = true;
    }
  }

  return {
    cart: calculated,
    customer: user
      ? {
          firstName: user.firstName,
          lastName: user.lastName,
          name: [user.firstName, user.lastName].filter(Boolean).join(" "),
          email: user.email,
          phone: user.phone,
        }
      : null,
    defaultAddress: serializeAddress(defaultAddress),
    pickupPoints,
    deliverySlots,
    deliveryZones,
    capabilities: {
      guestCheckout: true,
      pickup: true,
      pickupPointSelectionRequired: pickupPoints.length > 0,
      promoCodes: false,
      onlinePayment: false,
      deliveryPriceCalculation: true,
    },
  };
}

async function resolveDeliverySelection(transaction, input, merchandiseTotal) {
  const receiveDate = parseReceiveDate(input.receiveDate);
  let deliverySlotId = null;
  let requestedTimeWindow = null;

  if (input.receiveSlotId) {
    const slot = await transaction.deliverySlot.findFirst({
      where: { id: input.receiveSlotId, date: receiveDate, isActive: true },
      select: { id: true, startTime: true, endTime: true, capacity: true },
    });
    if (!slot) throw createCheckoutError("Выбранный временной интервал больше недоступен.", 409, "DELIVERY_SLOT_UNAVAILABLE");
    if (slot.capacity !== null) {
      const reserved = await transaction.order.count({
        where: { deliverySlotId: slot.id, status: { not: "CANCELLED" } },
      });
      if (reserved >= slot.capacity) throw createCheckoutError("В выбранном интервале закончились места.", 409, "DELIVERY_SLOT_FULL");
    }
    deliverySlotId = slot.id;
    requestedTimeWindow = `${slot.startTime}–${slot.endTime}`;
  }

  const quote = await quoteDelivery({
    client: transaction,
    method: input.receiveMethod === "pickup" ? "PICKUP" : "DELIVERY",
    merchandiseTotal,
    deliveryZoneId: input.receiveMethod === "delivery" ? input.deliveryZoneId : null,
    pickupPointId: input.receiveMethod === "pickup" ? input.pickupPointId : null,
    address: input.receiveMethod === "delivery" ? input.address : null,
  });
  return {
    receiveDate,
    deliverySlotId,
    requestedTimeWindow,
    pickupPointId: quote.pickupPointId,
    deliveryZoneId: quote.deliveryZoneId,
    deliveryAddressSnapshot: input.receiveMethod === "delivery" ? formatAddressSnapshot(input) : quote.deliveryAddressSnapshot,
    deliveryTermsSnapshot: quote.snapshot,
    deliveryPrice: quote.deliveryPrice,
    deliveryPriceConfirmed: quote.deliveryPriceConfirmed,
  };
}

export async function createCheckoutOrder({ owner, userId = null, input }) {
  const existing = await prisma.order.findUnique({
    where: {
      checkoutKey: input.idempotencyKey,
    },
    select: ORDER_RESULT_SELECT,
  });

  if (existing) {
    if (userId && existing.userId !== userId) {
      throw createCheckoutError(
        "Ключ оформления уже был использован другим заказом.",
        409,
        "CHECKOUT_KEY_CONFLICT",
      );
    }

    return {
      order: serializeOrderResult(existing),
      created: false,
    };
  }

  if (!owner) {
    throw createCheckoutError(
      "Корзина пуста или сессия магазина истекла.",
      409,
      "CART_EMPTY",
    );
  }

  if (input.paymentMethod === "online") {
    throw createCheckoutError(
      "Онлайн-оплата пока не подключена. Выберите оплату при получении.",
      409,
      "PAYMENT_METHOD_UNAVAILABLE",
    );
  }

  try {
    const order = await prisma.$transaction(
      async (transaction) => {
        const cart = await findCheckoutCart(owner, transaction);

        if (!cart?.items?.length) {
          throw createCheckoutError(
            "Корзина пуста. Добавьте товары перед оформлением заказа.",
            409,
            "CART_EMPTY",
          );
        }

        const calculated = await calculateCart(cart, transaction);

        if (calculated.issues.length > 0) {
          throw createCheckoutError(
            "Состав корзины изменился. Проверьте наличие и количество товаров.",
            409,
            "CART_OUTDATED",
            calculated.issues,
          );
        }

        const delivery = await resolveDeliverySelection(transaction, input, calculated.summary.merchandiseTotal);
        const subtotal = calculated.summary.subtotal;
        const discountTotal = calculated.summary.discount;
        const merchandiseTotal = calculated.summary.merchandiseTotal;
        const deliveryPrice = delivery.deliveryPrice;
        const total = kopecksToRubles(moneyToKopecks(merchandiseTotal) + moneyToKopecks(deliveryPrice));

        const created = await transaction.order.create({
          data: {
            number: createOrderNumber(),
            checkoutKey: input.idempotencyKey,
            userId,
            status: "NEW",
            paymentStatus: "PENDING",
            deliveryStatus:
              input.receiveMethod === "pickup" ? "PENDING" : "PENDING",
            deliveryMethod:
              input.receiveMethod === "pickup" ? "PICKUP" : "DELIVERY",
            paymentMethod:
              input.paymentMethod === "on-receipt" ? "ON_RECEIPT" : "ONLINE",
            deliverySlotId: delivery.deliverySlotId,
            deliveryZoneId: delivery.deliveryZoneId,
            deliveryTermsSnapshot: delivery.deliveryTermsSnapshot,
            pickupPointId: delivery.pickupPointId,
            customerName: input.name,
            customerPhone: input.phone,
            customerEmail: input.email,
            deliveryAddressSnapshot: delivery.deliveryAddressSnapshot,
            requestedReceiveDate: delivery.receiveDate,
            requestedTimeWindow: delivery.requestedTimeWindow,
            comment: input.comment || null,
            subtotal: subtotal.toFixed(2),
            discountTotal: discountTotal.toFixed(2),
            deliveryPrice: deliveryPrice.toFixed(2),
            deliveryPriceConfirmed: delivery.deliveryPriceConfirmed,
            total: total.toFixed(2),
            currency: "RUB",
            items: {
              create: calculated.items.map((item) => ({
                productId: item.productId,
                productName: item.title,
                sku: item.sku,
                unit: item.unit,
                quantity: Number(item.quantity).toFixed(3),
                baseUnitPrice: Number(item.baseUnitPrice).toFixed(2),
                unitPrice: Number(item.unitPrice).toFixed(2),
                discountTotal: Number(item.discountTotal).toFixed(2),
                total: Number(item.total).toFixed(2),
              })),
            },
          },
          select: ORDER_RESULT_SELECT,
        });

        await reserveInventoryForOrder(transaction, created.id);

        await transaction.cartItem.deleteMany({
          where: {
            cartId: cart.id,
          },
        });

        return created;
      },
      {
        isolationLevel: "Serializable",
      },
    );

    return {
      order: serializeOrderResult(order),
      created: true,
    };
  } catch (error) {
    if (error?.code === "P2002") {
      const duplicate = await prisma.order.findUnique({
        where: {
          checkoutKey: input.idempotencyKey,
        },
        select: ORDER_RESULT_SELECT,
      });

      if (duplicate) {
        return {
          order: serializeOrderResult(duplicate),
          created: false,
        };
      }
    }

    if (error?.code === "P2034") {
      throw createCheckoutError(
        "Корзина изменилась во время оформления. Повторите отправку заказа.",
        409,
        "CHECKOUT_RETRY_REQUIRED",
      );
    }

    throw error;
  }
}
