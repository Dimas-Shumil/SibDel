import { prisma } from "../lib/prisma.js";
import {
  buildCommerceOwnerWhere,
  findPurchasableProductBySlug,
  getCommerceProductSelect,
  normalizeCommerceQuantity,
  serializeCommerceItem,
} from "./commerce.service.js";

function createCartError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

async function findCart(owner, client = prisma) {
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

async function getOrCreateCart(owner, client = prisma) {
  if (owner.type === "user") {
    return client.cart.upsert({
      where: {
        userId: owner.userId,
      },
      create: {
        userId: owner.userId,
      },
      update: {},
      select: {
        id: true,
      },
    });
  }

  return client.cart.upsert({
    where: {
      sessionId: owner.sessionId,
    },
    create: {
      sessionId: owner.sessionId,
    },
    update: {},
    select: {
      id: true,
    },
  });
}

function serializeCart(cart) {
  const items = (cart?.items || []).map((item) =>
    serializeCommerceItem(item.product, item.quantity),
  );

  const totals = items.reduce(
    (result, item) => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const oldUnitPrice = Math.max(
        unitPrice,
        Number(item.oldUnitPrice) || unitPrice,
      );

      result.lines += 1;
      result.quantity += quantity;
      result.total += unitPrice * quantity;
      result.oldTotal += oldUnitPrice * quantity;
      return result;
    },
    {
      lines: 0,
      quantity: 0,
      total: 0,
      oldTotal: 0,
    },
  );

  return {
    items,
    summary: {
      lines: totals.lines,
      quantity: Number(totals.quantity.toFixed(3)),
      subtotal: Number(totals.oldTotal.toFixed(2)),
      discount: Number(Math.max(0, totals.oldTotal - totals.total).toFixed(2)),
      total: Number(totals.total.toFixed(2)),
      currency: "RUB",
    },
  };
}

export async function getCart(owner) {
  if (!owner) {
    return serializeCart(null);
  }

  return serializeCart(await findCart(owner));
}

export async function addCartItem(owner, { slug, quantity }) {
  const product = await findPurchasableProductBySlug(slug);

  if (!product) {
    throw createCartError(
      "Товар не найден или недоступен для покупки.",
      404,
      "PRODUCT_NOT_AVAILABLE",
    );
  }

  const normalizedIncrement = normalizeCommerceQuantity(quantity, product);

  if (normalizedIncrement <= 0) {
    throw createCartError(
      "Товар сейчас недоступен.",
      409,
      "PRODUCT_NOT_AVAILABLE",
    );
  }

  await prisma.$transaction(async (transaction) => {
    const cart = await getOrCreateCart(owner, transaction);
    const existing = await transaction.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: product.id,
        },
      },
      select: {
        quantity: true,
      },
    });

    const nextQuantity = normalizeCommerceQuantity(
      (Number(existing?.quantity?.toString?.() ?? existing?.quantity) || 0) +
        normalizedIncrement,
      product,
    );

    await transaction.cartItem.upsert({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: product.id,
        },
      },
      create: {
        cartId: cart.id,
        productId: product.id,
        quantity: nextQuantity,
      },
      update: {
        quantity: nextQuantity,
      },
    });
  });

  return getCart(owner);
}

export async function setCartItemQuantity(owner, { slug, quantity }) {
  if (!owner) {
    return serializeCart(null);
  }

  const product = await findPurchasableProductBySlug(slug);

  if (!product) {
    throw createCartError(
      "Товар не найден или недоступен для покупки.",
      404,
      "PRODUCT_NOT_AVAILABLE",
    );
  }

  const cart = await prisma.cart.findFirst({
    where: buildCommerceOwnerWhere(owner),
    select: {
      id: true,
    },
  });

  if (!cart) {
    return serializeCart(null);
  }

  const normalizedQuantity = normalizeCommerceQuantity(quantity, product, {
    allowZero: true,
  });

  if (normalizedQuantity <= 0) {
    await prisma.cartItem.deleteMany({
      where: {
        cartId: cart.id,
        productId: product.id,
      },
    });
  } else {
    const updated = await prisma.cartItem.updateMany({
      where: {
        cartId: cart.id,
        productId: product.id,
      },
      data: {
        quantity: normalizedQuantity,
      },
    });

    if (updated.count === 0) {
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: product.id,
          quantity: normalizedQuantity,
        },
      });
    }
  }

  return getCart(owner);
}

export async function removeCartItem(owner, slug) {
  if (!owner) {
    return serializeCart(null);
  }

  const product = await prisma.product.findUnique({
    where: {
      slug,
    },
    select: {
      id: true,
    },
  });

  if (!product) {
    return getCart(owner);
  }

  const cart = await prisma.cart.findFirst({
    where: buildCommerceOwnerWhere(owner),
    select: {
      id: true,
    },
  });

  if (cart) {
    await prisma.cartItem.deleteMany({
      where: {
        cartId: cart.id,
        productId: product.id,
      },
    });
  }

  return getCart(owner);
}

export async function clearCart(owner) {
  if (!owner) {
    return serializeCart(null);
  }

  const cart = await prisma.cart.findFirst({
    where: buildCommerceOwnerWhere(owner),
    select: {
      id: true,
    },
  });

  if (cart) {
    await prisma.cartItem.deleteMany({
      where: {
        cartId: cart.id,
      },
    });
  }

  return getCart(owner);
}
