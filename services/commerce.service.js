import { prisma } from "../lib/prisma.js";
import {
  commerceConfig,
  getClearGuestCommerceCookieOptions,
  getGuestCommerceCookieOptions,
} from "../config/commerce.js";
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "../utils/tokens.js";

const PRODUCT_COMMERCE_SELECT = Object.freeze({
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
  isPopular: true,
  isNew: true,
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
    },
  },
  images: {
    orderBy: [
      {
        isPrimary: "desc",
      },
      {
        sortOrder: "asc",
      },
      {
        id: "asc",
      },
    ],
    take: 1,
    select: {
      id: true,
      url: true,
      alt: true,
      sortOrder: true,
      isPrimary: true,
    },
  },
});

function decimalToNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value?.toString?.() ?? value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundQuantity(value) {
  return Number(Number(value).toFixed(3));
}

function getDiscountBadge(product) {
  const price = decimalToNumber(product.price);
  const oldPrice = decimalToNumber(product.oldPrice);

  if (product.isPopular) {
    return "Хит";
  }

  if (product.isNew) {
    return "Новинка";
  }

  if (price && oldPrice && oldPrice > price) {
    const percent = Math.round(((oldPrice - price) / oldPrice) * 100);
    return `-${percent}%`;
  }

  return "";
}

export function getProductCommerceLimits(product) {
  const min = Math.max(0.001, decimalToNumber(product.minQuantity) ?? 1);
  const step = Math.max(0.001, decimalToNumber(product.step) ?? 1);
  const stock = decimalToNumber(product.stockQuantity);
  const reserved = Math.max(0, decimalToNumber(product.reservedQuantity) ?? 0);
  const availableStock =
    stock === null ? null : Math.max(0, stock - reserved);
  const max = availableStock === null ? 999 : availableStock;
  const available =
    product.isActive === true &&
    product.category?.isActive !== false &&
    product.isAvailable === true &&
    max >= min;

  return {
    min: roundQuantity(min),
    step: roundQuantity(step),
    max: roundQuantity(max),
    available,
  };
}

export function normalizeCommerceQuantity(value, product, options = {}) {
  const limits = getProductCommerceLimits(product);
  const allowZero = options.allowZero === true;
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return limits.min;
  }

  if (allowZero && numeric <= 0) {
    return 0;
  }

  if (!limits.available) {
    return 0;
  }

  const clamped = Math.min(limits.max, Math.max(limits.min, numeric));
  const steps = Math.round((clamped - limits.min) / limits.step);
  const normalized = limits.min + steps * limits.step;

  return roundQuantity(
    Math.min(limits.max, Math.max(limits.min, normalized)),
  );
}

export function serializeCommerceItem(product, quantity = 1) {
  const limits = getProductCommerceLimits(product);
  const primaryImage = Array.isArray(product.images) ? product.images[0] : null;
  const rawQuantity = decimalToNumber(quantity) ?? limits.min;
  const normalizedQuantity = limits.available
    ? normalizeCommerceQuantity(rawQuantity, product, { allowZero: true })
    : roundQuantity(Math.max(0, rawQuantity));

  return {
    key: product.slug,
    productId: product.id,
    slug: product.slug,
    title: product.name,
    image: primaryImage?.url || "",
    measure: product.unitLabel || "",
    badge: getDiscountBadge(product),
    available: limits.available,
    unitPrice: decimalToNumber(product.price) ?? 0,
    oldUnitPrice: decimalToNumber(product.oldPrice) ?? decimalToNumber(product.price) ?? 0,
    promotion: product.promotion ?? null,
    quantity: normalizedQuantity,
    min: limits.min,
    max: limits.max,
    step: limits.step,
  };
}

export function getCommerceProductSelect() {
  return PRODUCT_COMMERCE_SELECT;
}

export async function findPurchasableProductBySlug(slug, client = prisma) {
  return client.product.findFirst({
    where: {
      slug,
      isActive: true,
      category: {
        isActive: true,
      },
    },
    select: PRODUCT_COMMERCE_SELECT,
  });
}

function isValidGuestToken(value) {
  return (
    typeof value === "string" &&
    value.length >= 43 &&
    value.length <= 512 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export function readGuestCommerceToken(req) {
  const token = req.cookies?.[commerceConfig.guestCookieName];
  return isValidGuestToken(token) ? token : null;
}

export function clearGuestCommerceCookie(res) {
  res.clearCookie(
    commerceConfig.guestCookieName,
    getClearGuestCommerceCookieOptions(),
  );
}

export function resolveCommerceOwner(req, res, options = {}) {
  if (req.user?.id) {
    return {
      type: "user",
      userId: req.user.id,
      sessionId: null,
    };
  }

  let token = readGuestCommerceToken(req);

  if (!token && options.createGuest === true) {
    token = generateOpaqueToken(48);

    res.cookie(
      commerceConfig.guestCookieName,
      token,
      getGuestCommerceCookieOptions(),
    );
  }

  if (!token) {
    return null;
  }

  return {
    type: "guest",
    userId: null,
    sessionId: hashOpaqueToken(token),
  };
}

export function buildCommerceOwnerWhere(owner) {
  if (!owner) {
    return null;
  }

  return owner.type === "user"
    ? {
        userId: owner.userId,
      }
    : {
        sessionId: owner.sessionId,
      };
}

export async function mergeGuestCommerceIntoUser({ token, userId }) {
  if (!isValidGuestToken(token) || !Number.isInteger(userId)) {
    return false;
  }

  const sessionId = hashOpaqueToken(token);

  await prisma.$transaction(async (transaction) => {
    const guestCart = await transaction.cart.findUnique({
      where: {
        sessionId,
      },
      include: {
        items: {
          include: {
            product: {
              select: PRODUCT_COMMERCE_SELECT,
            },
          },
        },
      },
    });

    let userCart = await transaction.cart.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
      },
    });

    if (guestCart?.items?.length) {
      if (!userCart) {
        userCart = await transaction.cart.create({
          data: {
            userId,
          },
          select: {
            id: true,
          },
        });
      }

      for (const guestItem of guestCart.items) {
        const existing = await transaction.cartItem.findUnique({
          where: {
            cartId_productId: {
              cartId: userCart.id,
              productId: guestItem.productId,
            },
          },
          select: {
            quantity: true,
          },
        });

        const mergedQuantity = normalizeCommerceQuantity(
          (decimalToNumber(existing?.quantity) ?? 0) +
            (decimalToNumber(guestItem.quantity) ?? 0),
          guestItem.product,
          {
            allowZero: true,
          },
        );

        if (mergedQuantity > 0) {
          await transaction.cartItem.upsert({
            where: {
              cartId_productId: {
                cartId: userCart.id,
                productId: guestItem.productId,
              },
            },
            create: {
              cartId: userCart.id,
              productId: guestItem.productId,
              quantity: mergedQuantity,
            },
            update: {
              quantity: mergedQuantity,
            },
          });
        }
      }
    }

    if (guestCart) {
      await transaction.cart.delete({
        where: {
          id: guestCart.id,
        },
      });
    }

    const guestFavorites = await transaction.guestFavorite.findMany({
      where: {
        sessionId,
      },
      select: {
        productId: true,
      },
    });

    if (guestFavorites.length > 0) {
      await transaction.favorite.createMany({
        data: guestFavorites.map((favorite) => ({
          userId,
          productId: favorite.productId,
        })),
        skipDuplicates: true,
      });

      await transaction.guestFavorite.deleteMany({
        where: {
          sessionId,
        },
      });
    }
  });

  return true;
}
