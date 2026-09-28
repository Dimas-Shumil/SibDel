import { prisma } from "../lib/prisma.js";

const ADMIN_PROMOTION_INCLUDE = Object.freeze({
  products: {
    orderBy: { productId: "asc" },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          isActive: true,
          categoryId: true,
        },
      },
    },
  },
  categories: {
    orderBy: { categoryId: "asc" },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
        },
      },
    },
  },
});

function promotionError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  if (details !== undefined) error.details = details;
  return error;
}

function decimalToNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value?.toString?.() ?? value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value) {
  return Number(Number(value).toFixed(2));
}

function runtimeStatus(promotion, now = new Date()) {
  if (promotion.status === "DRAFT") return "DRAFT";
  if (promotion.status === "PAUSED") return "PAUSED";
  if (promotion.status === "EXPIRED") return "EXPIRED";

  const startsAt = new Date(promotion.startsAt);
  const endsAt = new Date(promotion.endsAt);

  if (endsAt <= now) return "EXPIRED";
  if (startsAt > now) return "SCHEDULED";
  return "ACTIVE";
}

function serializePromotion(promotion, now = new Date()) {
  const products = promotion.products?.map((item) => item.product).filter(Boolean) ?? [];
  const categories = promotion.categories?.map((item) => item.category).filter(Boolean) ?? [];

  return {
    id: promotion.id,
    name: promotion.name,
    slug: promotion.slug,
    description: promotion.description,
    type: promotion.type,
    discountValue: decimalToNumber(promotion.discountValue) ?? 0,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    status: promotion.status,
    runtimeStatus: runtimeStatus(promotion, now),
    isFeatured: promotion.isFeatured,
    createdAt: promotion.createdAt,
    updatedAt: promotion.updatedAt,
    scope: products.length || categories.length ? "TARGETED" : "GLOBAL",
    products,
    categories,
    productIds: products.map((item) => item.id),
    categoryIds: categories.map((item) => item.id),
  };
}

function promotionAppliesToProduct(promotion, product) {
  const productIds = promotion.products?.map((item) => item.productId) ?? [];
  const categoryIds = promotion.categories?.map((item) => item.categoryId) ?? [];

  if (productIds.length === 0 && categoryIds.length === 0) return true;
  if (productIds.includes(product.id)) return true;
  return Number.isInteger(product.category?.id) && categoryIds.includes(product.category.id);
}

function calculatePromotionUnitPrice(product, promotion) {
  const current = Math.max(0, decimalToNumber(product.price) ?? 0);
  const discountValue = Math.max(0, decimalToNumber(promotion.discountValue) ?? 0);

  if (promotion.type === "PERCENT") {
    return money(Math.max(0, current * (1 - discountValue / 100)));
  }

  return money(Math.max(0, current - discountValue));
}

function selectBestPromotion(product, promotions) {
  const current = money(decimalToNumber(product.price) ?? 0);
  let best = null;

  for (const promotion of promotions) {
    if (!promotionAppliesToProduct(promotion, product)) continue;

    const finalPrice = calculatePromotionUnitPrice(product, promotion);
    if (finalPrice >= current) continue;

    if (
      !best ||
      finalPrice < best.finalPrice ||
      (finalPrice === best.finalPrice && new Date(promotion.endsAt) < new Date(best.promotion.endsAt)) ||
      (finalPrice === best.finalPrice && Number(promotion.id) < Number(best.promotion.id))
    ) {
      best = { promotion, finalPrice };
    }
  }

  return best;
}

function serializeAppliedPromotion(promotion, originalPrice, finalPrice) {
  return {
    id: promotion.id,
    name: promotion.name,
    slug: promotion.slug,
    type: promotion.type,
    discountValue: decimalToNumber(promotion.discountValue) ?? 0,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    isFeatured: promotion.isFeatured,
    originalUnitPrice: money(originalPrice),
    finalUnitPrice: money(finalPrice),
    discountPerUnit: money(Math.max(0, originalPrice - finalPrice)),
  };
}

export async function applyActivePromotionsToProducts(products, client = prisma, now = new Date()) {
  const list = Array.isArray(products) ? products : [];
  if (list.length === 0) return [];

  const promotions = await client.promotion.findMany({
    where: {
      status: "ACTIVE",
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    orderBy: [{ endsAt: "asc" }, { id: "asc" }],
    include: {
      products: { select: { productId: true } },
      categories: { select: { categoryId: true } },
    },
  });

  if (promotions.length === 0) return list.map((product) => ({ ...product, promotion: null }));

  return list.map((product) => {
    const originalPrice = money(decimalToNumber(product.price) ?? 0);
    const best = selectBestPromotion(product, promotions);

    if (!best) return { ...product, promotion: null };

    const existingOldPrice = decimalToNumber(product.oldPrice) ?? 0;
    return {
      ...product,
      price: best.finalPrice,
      oldPrice: money(Math.max(existingOldPrice, originalPrice)),
      promotion: serializeAppliedPromotion(best.promotion, originalPrice, best.finalPrice),
    };
  });
}

async function assertPromotionTargets(client, productIds, categoryIds) {
  const products = productIds.length
    ? await client.product.findMany({ where: { id: { in: productIds } }, select: { id: true } })
    : [];
  const categories = categoryIds.length
    ? await client.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true } })
    : [];

  if (products.length !== productIds.length) {
    throw promotionError("Один или несколько выбранных товаров не найдены.", 400, "PROMOTION_PRODUCT_NOT_FOUND");
  }
  if (categories.length !== categoryIds.length) {
    throw promotionError("Одна или несколько выбранных категорий не найдены.", 400, "PROMOTION_CATEGORY_NOT_FOUND");
  }
}

function normalizeTargetIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(Number).filter(Number.isInteger))];
}


function assertPromotionBusinessRules({ type, discountValue, startsAt, endsAt }) {
  const discount = Number(discountValue);
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  if (!Number.isFinite(discount) || discount <= 0) {
    throw promotionError("Размер скидки должен быть больше нуля.", 400, "PROMOTION_INVALID_DISCOUNT");
  }
  if (type === "PERCENT" && discount > 100) {
    throw promotionError("Процент скидки не может превышать 100%.", 400, "PROMOTION_INVALID_DISCOUNT");
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw promotionError("Дата окончания должна быть позже даты начала.", 400, "PROMOTION_INVALID_PERIOD");
  }
}

function promotionWriteData(input) {
  return {
    name: input.name,
    slug: input.slug,
    description: input.description ?? null,
    type: input.type,
    discountValue: Number(input.discountValue).toFixed(2),
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
    status: input.status,
    isFeatured: input.isFeatured === true,
  };
}

export async function listAdminPromotions({ q = "", status = "all", page = 1, limit = 30 } = {}) {
  const now = new Date();
  const normalizedQuery = String(q || "").trim();
  const statusWhere = (() => {
    if (status === "ACTIVE") return { status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } };
    if (status === "EXPIRED") return { OR: [{ status: "EXPIRED" }, { status: "ACTIVE", endsAt: { lte: now } }] };
    if (["DRAFT", "PAUSED"].includes(status)) return { status };
    return {};
  })();
  const searchWhere = normalizedQuery
    ? { OR: [
        { name: { contains: normalizedQuery, mode: "insensitive" } },
        { slug: { contains: normalizedQuery, mode: "insensitive" } },
      ] }
    : {};
  const where = Object.keys(statusWhere).length && Object.keys(searchWhere).length
    ? { AND: [statusWhere, searchWhere] }
    : { ...statusWhere, ...searchWhere };
  const skip = (page - 1) * limit;

  const [total, promotions, totalCount, activeCount, featuredCount] = await Promise.all([
    prisma.promotion.count({ where }),
    prisma.promotion.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      include: ADMIN_PROMOTION_INCLUDE,
    }),
    prisma.promotion.count(),
    prisma.promotion.count({ where: { status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } } }),
    prisma.promotion.count({ where: { isFeatured: true, status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } } }),
  ]);

  return {
    items: promotions.map((promotion) => serializePromotion(promotion, now)),
    metrics: {
      total: totalCount,
      active: activeCount,
      featured: featuredCount,
      scheduled: await prisma.promotion.count({ where: { status: "ACTIVE", startsAt: { gt: now } } }),
    },
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getAdminPromotionOptions() {
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, slug: true, sku: true, isActive: true, categoryId: true },
    }),
    prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true, isActive: true },
    }),
  ]);
  return { products, categories };
}

export async function getAdminPromotion(promotionId) {
  const promotion = await prisma.promotion.findUnique({
    where: { id: promotionId },
    include: ADMIN_PROMOTION_INCLUDE,
  });
  return promotion ? serializePromotion(promotion) : null;
}

export async function createAdminPromotion({ input, actorId }) {
  assertPromotionBusinessRules(input);
  const productIds = normalizeTargetIds(input.productIds);
  const categoryIds = normalizeTargetIds(input.categoryIds);

  try {
    return await prisma.$transaction(async (transaction) => {
      await assertPromotionTargets(transaction, productIds, categoryIds);
      const created = await transaction.promotion.create({
        data: {
          ...promotionWriteData(input),
          products: productIds.length ? { create: productIds.map((productId) => ({ productId })) } : undefined,
          categories: categoryIds.length ? { create: categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
        },
        include: ADMIN_PROMOTION_INCLUDE,
      });
      await transaction.adminActivity.create({
        data: {
          actorId,
          action: "PROMOTION_CREATED",
          entityType: "Promotion",
          entityId: String(created.id),
          description: `Создана акция «${created.name}»`,
          metadata: { type: created.type, productIds, categoryIds },
        },
      });
      return serializePromotion(created);
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw promotionError("Акция с таким slug уже существует.", 409, "PROMOTION_SLUG_EXISTS");
    }
    throw error;
  }
}

export async function updateAdminPromotion({ promotionId, input, actorId }) {
  const existing = await prisma.promotion.findUnique({
    where: { id: promotionId },
    select: {
      id: true,
      name: true,
      startsAt: true,
      endsAt: true,
      type: true,
      discountValue: true,
      products: { select: { productId: true } },
      categories: { select: { categoryId: true } },
    },
  });
  if (!existing) throw promotionError("Акция не найдена.", 404, "PROMOTION_NOT_FOUND");

  const effectiveStartsAt = input.startsAt ? new Date(input.startsAt) : new Date(existing.startsAt);
  const effectiveEndsAt = input.endsAt ? new Date(input.endsAt) : new Date(existing.endsAt);
  const effectiveType = input.type ?? existing.type;
  const effectiveDiscountValue = input.discountValue ?? decimalToNumber(existing.discountValue);
  assertPromotionBusinessRules({
    type: effectiveType,
    discountValue: effectiveDiscountValue,
    startsAt: effectiveStartsAt,
    endsAt: effectiveEndsAt,
  });

  const hasProductTargets = Object.hasOwn(input, "productIds");
  const hasCategoryTargets = Object.hasOwn(input, "categoryIds");
  const hasTargets = hasProductTargets || hasCategoryTargets;
  const productIds = hasProductTargets
    ? normalizeTargetIds(input.productIds)
    : existing.products.map((item) => item.productId);
  const categoryIds = hasCategoryTargets
    ? normalizeTargetIds(input.categoryIds)
    : existing.categories.map((item) => item.categoryId);

  try {
    return await prisma.$transaction(async (transaction) => {
      if (hasTargets) await assertPromotionTargets(transaction, productIds, categoryIds);

      const scalarData = {};
      for (const key of ["name", "slug", "description", "type", "discountValue", "startsAt", "endsAt", "status", "isFeatured"]) {
        if (!Object.hasOwn(input, key)) continue;
        if (key === "discountValue") scalarData[key] = Number(input[key]).toFixed(2);
        else if (key === "startsAt" || key === "endsAt") scalarData[key] = new Date(input[key]);
        else scalarData[key] = input[key];
      }

      if (hasTargets) {
        await transaction.promotionProduct.deleteMany({ where: { promotionId } });
        await transaction.promotionCategory.deleteMany({ where: { promotionId } });
        if (productIds.length) {
          await transaction.promotionProduct.createMany({ data: productIds.map((productId) => ({ promotionId, productId })) });
        }
        if (categoryIds.length) {
          await transaction.promotionCategory.createMany({ data: categoryIds.map((categoryId) => ({ promotionId, categoryId })) });
        }
      }

      await transaction.promotion.update({ where: { id: promotionId }, data: scalarData });
      await transaction.adminActivity.create({
        data: {
          actorId,
          action: "PROMOTION_UPDATED",
          entityType: "Promotion",
          entityId: String(promotionId),
          description: `Изменена акция «${input.name || existing.name}»`,
          metadata: { fields: Object.keys(input), ...(hasTargets ? { productIds, categoryIds } : {}) },
        },
      });

      const updated = await transaction.promotion.findUnique({ where: { id: promotionId }, include: ADMIN_PROMOTION_INCLUDE });
      return serializePromotion(updated);
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw promotionError("Акция с таким slug уже существует.", 409, "PROMOTION_SLUG_EXISTS");
    }
    throw error;
  }
}

export async function deleteAdminPromotion({ promotionId, actorId }) {
  const promotion = await prisma.promotion.findUnique({ where: { id: promotionId }, select: { id: true, name: true } });
  if (!promotion) throw promotionError("Акция не найдена.", 404, "PROMOTION_NOT_FOUND");

  await prisma.$transaction(async (transaction) => {
    await transaction.promotion.delete({ where: { id: promotionId } });
    await transaction.adminActivity.create({
      data: {
        actorId,
        action: "PROMOTION_DELETED",
        entityType: "Promotion",
        entityId: String(promotionId),
        description: `Удалена акция «${promotion.name}»`,
      },
    });
  });

  return true;
}
