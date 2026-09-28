import { prisma } from "../lib/prisma.js";
import { applyActivePromotionsToProducts } from "./promotion.service.js";

function decimalToString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value?.toString === "function"
    ? value.toString()
    : String(value);
}

function decimalToNumber(value) {
  const parsed = Number(decimalToString(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeJsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function getDiscountPercent(price, oldPrice) {
  const current = decimalToNumber(price);
  const previous = decimalToNumber(oldPrice);

  if (!current || !previous || previous <= current) {
    return null;
  }

  return Math.round(((previous - current) / previous) * 100);
}

function getStockState(product) {
  const stock = decimalToNumber(product.stockQuantity);
  const reserved = Math.max(0, decimalToNumber(product.reservedQuantity) ?? 0);
  const availableStock = stock === null ? null : Math.max(0, stock - reserved);

  if (!product.isAvailable || (availableStock !== null && availableStock <= 0)) {
    return "out";
  }

  if (availableStock !== null && availableStock <= 5) {
    return "low";
  }

  return "available";
}

function getBadge(product) {
  if (product.isPopular) {
    return {
      type: "hit",
      label: "Хит",
    };
  }

  if (product.isNew) {
    return {
      type: "new",
      label: "Новинка",
    };
  }

  const discountPercent = getDiscountPercent(product.price, product.oldPrice);

  if (discountPercent) {
    return {
      type: "discount",
      label: `-${discountPercent}%`,
    };
  }

  return null;
}

function getPrimaryImage(product) {
  if (!Array.isArray(product.images) || product.images.length === 0) {
    return null;
  }

  return (
    product.images.find((image) => image.isPrimary) ||
    product.images[0]
  );
}

function serializeImage(image) {
  return {
    id: image.id,
    url: image.url,
    alt: image.alt,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
  };
}

function formatReviewStats(stats) {
  if (!stats || stats.count === 0) {
    return {
      average: null,
      count: 0,
    };
  }

  return {
    average: Number(stats.average.toFixed(1)),
    count: stats.count,
  };
}

export async function getReviewStatsMap(productIds) {
  const ids = [...new Set(productIds.filter(Number.isInteger))];

  if (ids.length === 0) {
    return new Map();
  }

  const reviews = await prisma.review.findMany({
    where: {
      productId: {
        in: ids,
      },
      status: "APPROVED",
    },
    select: {
      productId: true,
      rating: true,
    },
  });

  const totals = new Map();

  for (const review of reviews) {
    if (!Number.isInteger(review.productId)) {
      continue;
    }

    const current = totals.get(review.productId) || {
      sum: 0,
      count: 0,
    };

    current.sum += review.rating;
    current.count += 1;
    totals.set(review.productId, current);
  }

  return new Map(
    [...totals.entries()].map(([productId, value]) => [
      productId,
      formatReviewStats({
        average: value.sum / value.count,
        count: value.count,
      }),
    ]),
  );
}

export function serializeProductSummary(product, reviewStats = null) {
  const primaryImage = getPrimaryImage(product);
  const stockState = getStockState(product);

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    shortDescription: product.shortDescription,
    unit: product.unit,
    unitLabel: product.unitLabel,
    price: decimalToString(product.price),
    oldPrice: decimalToString(product.oldPrice),
    promotion: product.promotion ?? null,
    step: decimalToString(product.step),
    minQuantity: decimalToString(product.minQuantity),
    stockQuantity: decimalToString(product.stockQuantity),
    reservedQuantity: decimalToString(product.reservedQuantity ?? 0),
    availableQuantity:
      product.stockQuantity === null
        ? null
        : decimalToString(
            Math.max(
              0,
              (decimalToNumber(product.stockQuantity) ?? 0) -
                (decimalToNumber(product.reservedQuantity) ?? 0),
            ),
          ),
    isAvailable: product.isAvailable && stockState !== "out",
    stockState,
    isPopular: product.isPopular,
    isFeatured: product.isFeatured,
    isNew: product.isNew,
    badge: getBadge(product),
    category: product.category
      ? {
          id: product.category.id,
          name: product.category.name,
          slug: product.category.slug,
        }
      : null,
    primaryImage: primaryImage ? serializeImage(primaryImage) : null,
    rating: reviewStats || {
      average: null,
      count: 0,
    },
  };
}

function serializeReview(review) {
  return {
    id: review.id,
    authorName: review.authorName,
    rating: review.rating,
    text: review.text,
    createdAt: review.createdAt,
  };
}

export async function getPublicProductBySlug(slug) {
  const product = await prisma.product.findFirst({
    where: {
      slug,
      isActive: true,
      category: {
        isActive: true,
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      shortDescription: true,
      description: true,
      unit: true,
      unitLabel: true,
      highlights: true,
      characteristics: true,
      nutrition: true,
      price: true,
      oldPrice: true,
      step: true,
      minQuantity: true,
      stockQuantity: true,
      reservedQuantity: true,
      isAvailable: true,
      isPopular: true,
      isFeatured: true,
      isNew: true,
      seoTitle: true,
      seoDescription: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
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
        select: {
          id: true,
          url: true,
          alt: true,
          sortOrder: true,
          isPrimary: true,
        },
      },
      reviews: {
        where: {
          status: "APPROVED",
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 20,
        select: {
          id: true,
          authorName: true,
          rating: true,
          text: true,
          createdAt: true,
        },
      },
    },
  });

  if (!product) {
    return null;
  }

  const reviewStatsMap = await getReviewStatsMap([product.id]);
  const reviewStats = reviewStatsMap.get(product.id) || {
    average: null,
    count: 0,
  };
  const [pricedProduct] = await applyActivePromotionsToProducts([product]);
  const summary = serializeProductSummary(pricedProduct, reviewStats);

  const relatedProducts = await prisma.product.findMany({
    where: {
      id: {
        not: product.id,
      },
      categoryId: product.category.id,
      isActive: true,
      category: {
        isActive: true,
      },
    },
    orderBy: [
      {
        isPopular: "desc",
      },
      {
        sortOrder: "asc",
      },
      {
        createdAt: "desc",
      },
    ],
    take: 6,
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      shortDescription: true,
      unit: true,
      unitLabel: true,
      price: true,
      oldPrice: true,
      step: true,
      minQuantity: true,
      stockQuantity: true,
      reservedQuantity: true,
      isAvailable: true,
      isPopular: true,
      isFeatured: true,
      isNew: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
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
    },
  });

  const [relatedReviewStats, pricedRelatedProducts] = await Promise.all([
    getReviewStatsMap(relatedProducts.map((item) => item.id)),
    applyActivePromotionsToProducts(relatedProducts),
  ]);

  return {
    ...summary,
    description: product.description,
    highlights: normalizeJsonArray(product.highlights),
    characteristics: normalizeJsonArray(product.characteristics),
    nutrition: normalizeJsonArray(product.nutrition),
    seo: {
      title: product.seoTitle,
      description: product.seoDescription,
    },
    images: product.images.map(serializeImage),
    reviews: product.reviews.map(serializeReview),
    relatedProducts: pricedRelatedProducts.map((item) =>
      serializeProductSummary(
        item,
        relatedReviewStats.get(item.id) || {
          average: null,
          count: 0,
        },
      ),
    ),
  };
}
