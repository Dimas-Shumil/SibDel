import { prisma } from "../lib/prisma.js";

export async function listPublicCategories() {
  const [categories, groupedProducts] = await Promise.all([
    prisma.category.findMany({
      where: {
        isActive: true,
      },
      orderBy: [
        {
          sortOrder: "asc",
        },
        {
          name: "asc",
        },
      ],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        imageUrl: true,
        isFeatured: true,
        sortOrder: true,
      },
    }),
    prisma.product.groupBy({
      by: ["categoryId"],
      where: {
        isActive: true,
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  const counts = new Map(
    groupedProducts.map((row) => [row.categoryId, row._count._all]),
  );

  return categories.map((category) => ({
    ...category,
    productCount: counts.get(category.id) || 0,
  }));
}
