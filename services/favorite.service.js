import { prisma } from "../lib/prisma.js";
import {
  findPurchasableProductBySlug,
  getCommerceProductSelect,
  serializeCommerceItem,
} from "./commerce.service.js";

function serializeFavorites(rows) {
  return {
    items: (rows || []).map((row) => serializeCommerceItem(row.product, 1)),
  };
}

export async function getFavorites(owner) {
  if (!owner) {
    return serializeFavorites([]);
  }

  const rows =
    owner.type === "user"
      ? await prisma.favorite.findMany({
          where: {
            userId: owner.userId,
          },
          orderBy: {
            createdAt: "desc",
          },
          include: {
            product: {
              select: getCommerceProductSelect(),
            },
          },
        })
      : await prisma.guestFavorite.findMany({
          where: {
            sessionId: owner.sessionId,
          },
          orderBy: {
            createdAt: "desc",
          },
          include: {
            product: {
              select: getCommerceProductSelect(),
            },
          },
        });

  return serializeFavorites(rows);
}

export async function addFavorite(owner, slug) {
  const product = await findPurchasableProductBySlug(slug);

  if (!product) {
    const error = new Error("Товар не найден.");
    error.statusCode = 404;
    error.code = "PRODUCT_NOT_FOUND";
    error.expose = true;
    throw error;
  }

  if (owner.type === "user") {
    await prisma.favorite.upsert({
      where: {
        userId_productId: {
          userId: owner.userId,
          productId: product.id,
        },
      },
      create: {
        userId: owner.userId,
        productId: product.id,
      },
      update: {},
    });
  } else {
    await prisma.guestFavorite.upsert({
      where: {
        sessionId_productId: {
          sessionId: owner.sessionId,
          productId: product.id,
        },
      },
      create: {
        sessionId: owner.sessionId,
        productId: product.id,
      },
      update: {},
    });
  }

  return getFavorites(owner);
}

export async function removeFavorite(owner, slug) {
  if (!owner) {
    return serializeFavorites([]);
  }

  const product = await prisma.product.findUnique({
    where: {
      slug,
    },
    select: {
      id: true,
    },
  });

  if (product) {
    if (owner.type === "user") {
      await prisma.favorite.deleteMany({
        where: {
          userId: owner.userId,
          productId: product.id,
        },
      });
    } else {
      await prisma.guestFavorite.deleteMany({
        where: {
          sessionId: owner.sessionId,
          productId: product.id,
        },
      });
    }
  }

  return getFavorites(owner);
}

export async function clearFavorites(owner) {
  if (!owner) {
    return serializeFavorites([]);
  }

  if (owner.type === "user") {
    await prisma.favorite.deleteMany({
      where: {
        userId: owner.userId,
      },
    });
  } else {
    await prisma.guestFavorite.deleteMany({
      where: {
        sessionId: owner.sessionId,
      },
    });
  }

  return getFavorites(owner);
}
