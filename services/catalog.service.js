import { prisma } from "../lib/prisma.js";
import {
  getReviewStatsMap,
  serializeProductSummary,
} from "./product.service.js";
import { applyActivePromotionsToProducts } from "./promotion.service.js";

async function getAvailabilityProductIds(query) {
  const hasSpecificAvailability = query.lowStock || query.outOfStock;

  if (query.lowStock && query.outOfStock) {
    const rows = await prisma.$queryRaw`
      SELECT "id"
      FROM "Product"
      WHERE
        "isAvailable" = false
        OR (
          "stockQuantity" IS NOT NULL
          AND (("stockQuantity" - "reservedQuantity") <= 5
            OR ("stockQuantity" - "reservedQuantity") < "minQuantity")
        )
    `;
    return rows.map((row) => row.id);
  }

  if (query.lowStock) {
    const rows = await prisma.$queryRaw`
      SELECT "id"
      FROM "Product"
      WHERE "isAvailable" = true
        AND "stockQuantity" IS NOT NULL
        AND ("stockQuantity" - "reservedQuantity") >= "minQuantity"
        AND ("stockQuantity" - "reservedQuantity") <= 5
    `;
    return rows.map((row) => row.id);
  }

  if (query.outOfStock) {
    const rows = await prisma.$queryRaw`
      SELECT "id"
      FROM "Product"
      WHERE "isAvailable" = false
        OR (
          "stockQuantity" IS NOT NULL
          AND ("stockQuantity" - "reservedQuantity") < "minQuantity"
        )
    `;
    return rows.map((row) => row.id);
  }

  if (query.available && !hasSpecificAvailability) {
    const rows = await prisma.$queryRaw`
      SELECT "id"
      FROM "Product"
      WHERE "isAvailable" = true
        AND (
          "stockQuantity" IS NULL
          OR ("stockQuantity" - "reservedQuantity") >= "minQuantity"
        )
    `;
    return rows.map((row) => row.id);
  }

  return null;
}

function buildOrderBy(sort) {
  switch (sort) {
    case "price-asc":
      return [
        {
          price: "asc",
        },
        {
          id: "asc",
        },
      ];

    case "price-desc":
      return [
        {
          price: "desc",
        },
        {
          id: "asc",
        },
      ];

    case "new":
      return [
        {
          isNew: "desc",
        },
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ];

    case "discount":
      return [
        {
          oldPrice: {
            sort: "desc",
            nulls: "last",
          },
        },
        {
          price: "asc",
        },
        {
          id: "asc",
        },
      ];

    case "popular":
    default:
      return [
        {
          isPopular: "desc",
        },
        {
          sortOrder: "asc",
        },
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ];
  }
}

function buildWhere(query) {
  const where = {
    isActive: true,
    category: {
      isActive: true,
    },
  };

  if (query.category && query.category !== "all") {
    where.category = {
      isActive: true,
      slug: query.category,
    };
  }

  if (query.q) {
    where.OR = [
      {
        name: {
          contains: query.q,
          mode: "insensitive",
        },
      },
      {
        sku: {
          contains: query.q,
          mode: "insensitive",
        },
      },
      {
        shortDescription: {
          contains: query.q,
          mode: "insensitive",
        },
      },
    ];
  }

  if (query.new) {
    where.isNew = true;
  }

  if (query.hit) {
    where.isPopular = true;
  }

  return where;
}

export async function getPublicCatalog(query) {
  const where = buildWhere(query);
  const availabilityProductIds = await getAvailabilityProductIds(query);

  if (availabilityProductIds !== null) {
    where.id = {
      in: availabilityProductIds,
    };
  }

  const page = query.page;
  const limit = query.limit;
  const skip = (page - 1) * limit;

  const priceDependent = query.priceFrom !== undefined || query.priceTo !== undefined ||
    query.discount || ["price-asc", "price-desc", "discount"].includes(query.sort);
  const products = await prisma.product.findMany({
    where,
    orderBy: buildOrderBy(query.sort),
    ...(!priceDependent ? { skip, take: limit } : {}),
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

  // Price-dependent operations must see the same effective prices as Checkout.
  // Paginate only after filtering; otherwise discounted matches disappear.
  const priced = await applyActivePromotionsToProducts(products);
  const discountRatio = (product) => Number(product.oldPrice) > Number(product.price)
    ? (Number(product.oldPrice) - Number(product.price)) / Number(product.oldPrice) : 0;
  const filtered = priced.filter((product) =>
    (query.priceFrom === undefined || Number(product.price) >= query.priceFrom) &&
    (query.priceTo === undefined || Number(product.price) <= query.priceTo) &&
    (!query.discount || discountRatio(product) > 0),
  );
  if (query.sort === "price-asc" || query.sort === "price-desc") {
    const direction = query.sort === "price-desc" ? -1 : 1;
    filtered.sort((a, b) => direction * (Number(a.price) - Number(b.price)) || a.id - b.id);
  } else if (query.sort === "discount") {
    filtered.sort((a, b) => discountRatio(b) - discountRatio(a) ||
      Number(a.price) - Number(b.price) || a.id - b.id);
  }
  const total = priceDependent ? filtered.length : await prisma.product.count({ where });
  const pricedProducts = priceDependent ? filtered.slice(skip, skip + limit) : filtered;
  const reviewStats = await getReviewStatsMap(pricedProducts.map((product) => product.id));

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    products: pricedProducts.map((product) =>
      serializeProductSummary(
        product,
        reviewStats.get(product.id) || {
          average: null,
          count: 0,
        },
      ),
    ),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}
