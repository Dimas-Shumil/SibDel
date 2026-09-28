import { prisma } from "../lib/prisma.js";
import {
  getReviewStatsMap,
  serializeProductSummary,
} from "./product.service.js";

function buildAvailabilityFilter(query) {
  const conditions = [];

  // lowStock/outOfStock are more specific states than the broad
  // "available" flag. The UI keeps "available" checked by default,
  // so a specific state must not be neutralized by that default.
  const hasSpecificAvailability = query.lowStock || query.outOfStock;

  if (query.lowStock) {
    conditions.push({
      isAvailable: true,
      stockQuantity: {
        gt: 0,
        lte: 5,
      },
    });
  }

  if (query.outOfStock) {
    conditions.push({
      OR: [
        {
          isAvailable: false,
        },
        {
          stockQuantity: {
            lte: 0,
          },
        },
      ],
    });
  }

  if (query.available && !hasSpecificAvailability) {
    conditions.push({
      isAvailable: true,
      OR: [
        {
          stockQuantity: null,
        },
        {
          stockQuantity: {
            gt: 0,
          },
        },
      ],
    });
  }

  return conditions;
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

  if (query.priceFrom !== undefined || query.priceTo !== undefined) {
    where.price = {};

    if (query.priceFrom !== undefined) {
      where.price.gte = query.priceFrom;
    }

    if (query.priceTo !== undefined) {
      where.price.lte = query.priceTo;
    }
  }

  if (query.discount) {
    where.oldPrice = {
      not: null,
    };
  }

  if (query.new) {
    where.isNew = true;
  }

  if (query.hit) {
    where.isPopular = true;
  }

  const availabilityConditions = buildAvailabilityFilter(query);

  if (availabilityConditions.length > 0) {
    where.AND = [
      {
        OR: availabilityConditions,
      },
    ];
  }

  return where;
}

export async function getPublicCatalog(query) {
  const where = buildWhere(query);
  const page = query.page;
  const limit = query.limit;
  const skip = (page - 1) * limit;

  const [total, products] = await prisma.$transaction([
    prisma.product.count({
      where,
    }),
    prisma.product.findMany({
      where,
      orderBy: buildOrderBy(query.sort),
      skip,
      take: limit,
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
    }),
  ]);

  const reviewStats = await getReviewStatsMap(
    products.map((product) => product.id),
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    products: products.map((product) =>
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
