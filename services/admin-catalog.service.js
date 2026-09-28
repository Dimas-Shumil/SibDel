import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { prisma } from "../lib/prisma.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRODUCT_UPLOAD_ROOT = path.resolve(__dirname, "..", "uploads", "products");
const ALLOWED_DECODED_FORMATS = new Set(["jpeg", "png", "webp"]);

function decimalToNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function createCatalogError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  if (details !== undefined) error.details = details;
  return error;
}

function productAvailability(product) {
  const stock = decimalToNumber(product.stockQuantity);
  const reserved = Math.max(0, decimalToNumber(product.reservedQuantity) ?? 0);
  return stock === null ? null : Math.max(0, roundQuantity(stock - reserved));
}

function serializeProduct(product) {
  return {
    ...product,
    price: decimalToNumber(product.price),
    oldPrice: decimalToNumber(product.oldPrice),
    step: decimalToNumber(product.step),
    minQuantity: decimalToNumber(product.minQuantity),
    stockQuantity: decimalToNumber(product.stockQuantity),
    reservedQuantity: decimalToNumber(product.reservedQuantity) ?? 0,
    availableQuantity: productAvailability(product),
  };
}

function serializeCategory(category) {
  return {
    ...category,
    productsCount: category._count?.products ?? category.productsCount ?? 0,
    _count: undefined,
  };
}

async function writeActivity(client, {
  actorId,
  action,
  entityType,
  entityId,
  description,
  metadata,
  ipAddress,
  userAgent,
}) {
  await client.adminActivity.create({
    data: {
      actorId,
      action,
      entityType,
      entityId: String(entityId),
      description,
      metadata,
      ipAddress,
      userAgent,
    },
  });
}

async function assertCategoryExists(categoryId, client = prisma) {
  const category = await client.category.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, isActive: true },
  });

  if (!category) {
    throw createCatalogError("Категория не найдена.", 404, "CATEGORY_NOT_FOUND");
  }

  return category;
}

async function assertUniqueProductFields({ slug, sku, excludeId = null }, client = prisma) {
  const conflicts = await client.product.findMany({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ slug }, { sku }],
    },
    select: { id: true, slug: true, sku: true },
    take: 2,
  });

  const slugConflict = conflicts.some((item) => item.slug === slug);
  const skuConflict = conflicts.some((item) => item.sku === sku);

  if (slugConflict || skuConflict) {
    throw createCatalogError(
      slugConflict && skuConflict
        ? "Товар с таким slug и SKU уже существует."
        : slugConflict
          ? "Товар с таким slug уже существует."
          : "Товар с таким SKU уже существует.",
      409,
      "PRODUCT_CONFLICT",
      { slug: slugConflict, sku: skuConflict },
    );
  }
}

async function assertUniqueCategorySlug({ slug, excludeId = null }, client = prisma) {
  const conflict = await client.category.findFirst({
    where: {
      slug,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (conflict) {
    throw createCatalogError(
      "Категория с таким slug уже существует.",
      409,
      "CATEGORY_SLUG_CONFLICT",
    );
  }
}

export async function listAdminProducts({
  q = "",
  categoryId,
  visibility = "all",
  page = 1,
  limit = 30,
} = {}) {
  const where = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(visibility === "active" ? { isActive: true } : {}),
    ...(visibility === "inactive" ? { isActive: false } : {}),
  };

  const skip = (page - 1) * limit;
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      skip,
      take: limit,
      select: {
        id: true,
        categoryId: true,
        name: true,
        slug: true,
        sku: true,
        unit: true,
        unitLabel: true,
        price: true,
        oldPrice: true,
        stockQuantity: true,
        reservedQuantity: true,
        isActive: true,
        isAvailable: true,
        isPopular: true,
        isFeatured: true,
        isNew: true,
        sortOrder: true,
        updatedAt: true,
        category: { select: { id: true, name: true, slug: true, isActive: true } },
        images: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
          take: 1,
          select: { id: true, url: true, alt: true, isPrimary: true },
        },
      },
    }),
  ]);

  return {
    items: products.map(serializeProduct),
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getAdminProduct(productId) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: { select: { id: true, name: true, slug: true, isActive: true } },
      images: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  });

  return product ? serializeProduct(product) : null;
}

function pickProductData(input) {
  const keys = [
    "categoryId",
    "name",
    "slug",
    "sku",
    "shortDescription",
    "description",
    "unit",
    "unitLabel",
    "highlights",
    "characteristics",
    "nutrition",
    "price",
    "oldPrice",
    "step",
    "minQuantity",
    "isActive",
    "isAvailable",
    "isPopular",
    "isFeatured",
    "isNew",
    "sortOrder",
    "seoTitle",
    "seoDescription",
  ];

  return Object.fromEntries(
    keys.filter((key) => Object.prototype.hasOwnProperty.call(input, key)).map((key) => [key, input[key]]),
  );
}

export async function createAdminProduct(input, actor) {
  await Promise.all([
    assertCategoryExists(input.categoryId),
    assertUniqueProductFields({ slug: input.slug, sku: input.sku }),
  ]);

  const product = await prisma.$transaction(async (transaction) => {
    const created = await transaction.product.create({
      data: {
        ...pickProductData(input),
        stockQuantity: "0.000",
        reservedQuantity: "0.000",
      },
      include: {
        category: { select: { id: true, name: true, slug: true, isActive: true } },
        images: true,
      },
    });

    await writeActivity(transaction, {
      ...actor,
      action: "PRODUCT_CREATE",
      entityType: "Product",
      entityId: created.id,
      description: `Создан товар «${created.name}»`,
      metadata: { sku: created.sku, slug: created.slug, categoryId: created.categoryId },
    });

    return created;
  });

  return serializeProduct(product);
}

export async function updateAdminProduct(productId, input, actor) {
  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, slug: true, sku: true, categoryId: true, price: true, oldPrice: true },
  });

  if (!existing) {
    throw createCatalogError("Товар не найден.", 404, "PRODUCT_NOT_FOUND");
  }

  const nextSlug = input.slug ?? existing.slug;
  const nextSku = input.sku ?? existing.sku;
  const nextCategoryId = input.categoryId ?? existing.categoryId;

  await Promise.all([
    assertCategoryExists(nextCategoryId),
    assertUniqueProductFields({ slug: nextSlug, sku: nextSku, excludeId: productId }),
  ]);

  const data = pickProductData(input);
  const effectivePrice = Object.prototype.hasOwnProperty.call(data, "price")
    ? Number(data.price)
    : decimalToNumber(existing.price);
  const effectiveOldPrice = Object.prototype.hasOwnProperty.call(data, "oldPrice")
    ? (data.oldPrice === null ? null : Number(data.oldPrice))
    : decimalToNumber(existing.oldPrice);

  if (effectiveOldPrice !== null && effectiveOldPrice <= effectivePrice) {
    throw createCatalogError(
      "Старая цена должна быть выше текущей цены.",
      400,
      "INVALID_OLD_PRICE",
    );
  }

  const changedFields = Object.keys(data);

  const product = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.product.update({
      where: { id: productId },
      data,
      include: {
        category: { select: { id: true, name: true, slug: true, isActive: true } },
        images: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });

    await writeActivity(transaction, {
      ...actor,
      action: "PRODUCT_UPDATE",
      entityType: "Product",
      entityId: productId,
      description: `Обновлён товар «${updated.name}»`,
      metadata: { changedFields },
    });

    return updated;
  });

  return serializeProduct(product);
}

export async function listAdminCategories({ includeInactive = true } = {}) {
  const categories = await prisma.category.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });

  return categories.map(serializeCategory);
}

export async function createAdminCategory(input, actor) {
  await assertUniqueCategorySlug({ slug: input.slug });

  const category = await prisma.$transaction(async (transaction) => {
    const created = await transaction.category.create({
      data: input,
      include: { _count: { select: { products: true } } },
    });

    await writeActivity(transaction, {
      ...actor,
      action: "CATEGORY_CREATE",
      entityType: "Category",
      entityId: created.id,
      description: `Создана категория «${created.name}»`,
      metadata: { slug: created.slug },
    });

    return created;
  });

  return serializeCategory(category);
}

export async function updateAdminCategory(categoryId, input, actor) {
  const existing = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, slug: true },
  });

  if (!existing) {
    throw createCatalogError("Категория не найдена.", 404, "CATEGORY_NOT_FOUND");
  }

  if (input.slug && input.slug !== existing.slug) {
    await assertUniqueCategorySlug({ slug: input.slug, excludeId: categoryId });
  }

  const category = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.category.update({
      where: { id: categoryId },
      data: input,
      include: { _count: { select: { products: true } } },
    });

    await writeActivity(transaction, {
      ...actor,
      action: "CATEGORY_UPDATE",
      entityType: "Category",
      entityId: categoryId,
      description: `Обновлена категория «${updated.name}»`,
      metadata: { changedFields: Object.keys(input) },
    });

    return updated;
  });

  return serializeCategory(category);
}

export async function deleteOrDeactivateCategory(categoryId, actor) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    include: { _count: { select: { products: true } } },
  });

  if (!category) {
    throw createCatalogError("Категория не найдена.", 404, "CATEGORY_NOT_FOUND");
  }

  if (category._count.products > 0) {
    const updated = await prisma.$transaction(async (transaction) => {
      const deactivated = await transaction.category.update({
        where: { id: categoryId },
        data: { isActive: false },
        include: { _count: { select: { products: true } } },
      });

      await writeActivity(transaction, {
        ...actor,
        action: "CATEGORY_DEACTIVATE",
        entityType: "Category",
        entityId: categoryId,
        description: `Категория «${deactivated.name}» деактивирована вместо удаления`,
        metadata: { productsCount: category._count.products },
      });

      return deactivated;
    });

    return { mode: "deactivated", category: serializeCategory(updated) };
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.category.delete({ where: { id: categoryId } });
    await writeActivity(transaction, {
      ...actor,
      action: "CATEGORY_DELETE",
      entityType: "Category",
      entityId: categoryId,
      description: `Удалена пустая категория «${category.name}»`,
      metadata: { slug: category.slug },
    });
  });

  return { mode: "deleted", category: null };
}

async function ensureProductUploadDirectory(productId) {
  const directory = path.join(PRODUCT_UPLOAD_ROOT, String(productId));
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

async function processProductImage(file, productId) {
  let metadata;
  try {
    metadata = await sharp(file.buffer, { failOn: "error" }).metadata();
  } catch {
    throw createCatalogError(
      "Файл не удалось распознать как корректное изображение.",
      400,
      "INVALID_PRODUCT_IMAGE",
    );
  }

  if (!ALLOWED_DECODED_FORMATS.has(metadata.format)) {
    throw createCatalogError(
      "Фактический формат изображения не поддерживается.",
      400,
      "UNSUPPORTED_PRODUCT_IMAGE",
    );
  }

  if (!metadata.width || !metadata.height || metadata.width > 12000 || metadata.height > 12000) {
    throw createCatalogError(
      "Некорректные размеры изображения.",
      400,
      "INVALID_PRODUCT_IMAGE_DIMENSIONS",
    );
  }

  const directory = await ensureProductUploadDirectory(productId);
  const filename = `${randomUUID()}.webp`;
  const absolutePath = path.join(directory, filename);

  await sharp(file.buffer, { failOn: "error" })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(absolutePath);

  return {
    absolutePath,
    url: `/uploads/products/${productId}/${filename}`,
  };
}

export async function uploadAdminProductImages(productId, files, actor) {
  if (!Array.isArray(files) || files.length === 0) {
    throw createCatalogError("Выберите хотя бы одно изображение.", 400, "PRODUCT_IMAGE_REQUIRED");
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true },
  });

  if (!product) {
    throw createCatalogError("Товар не найден.", 404, "PRODUCT_NOT_FOUND");
  }

  const existingCount = await prisma.productImage.count({ where: { productId } });

  const remainingSlots = 12 - existingCount;
  if (remainingSlots <= 0 || files.length > remainingSlots) {
    throw createCatalogError(
      `Для товара можно хранить не более 12 изображений. Доступно мест: ${Math.max(0, remainingSlots)}.`,
      400,
      "PRODUCT_IMAGE_LIMIT",
    );
  }

  const written = [];
  try {
    for (const file of files) {
      written.push(await processProductImage(file, productId));
    }

    const created = await prisma.$transaction(
      async (transaction) => {
        const [currentCount, lastImage] = await Promise.all([
          transaction.productImage.count({ where: { productId } }),
          transaction.productImage.findFirst({
            where: { productId },
            orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
            select: { sortOrder: true },
          }),
        ]);

        if (currentCount + written.length > 12) {
          throw createCatalogError(
            "Параллельная загрузка превысила лимит изображений. Обновите карточку и повторите попытку.",
            409,
            "PRODUCT_IMAGE_LIMIT",
          );
        }

        const baseSort = lastImage?.sortOrder ?? -1;
        const rows = [];

        for (let index = 0; index < written.length; index += 1) {
          rows.push(
            await transaction.productImage.create({
              data: {
                productId,
                url: written[index].url,
                alt: product.name,
                sortOrder: baseSort + index + 1,
                isPrimary: currentCount === 0 && index === 0,
              },
            }),
          );
        }

        await writeActivity(transaction, {
          ...actor,
          action: "PRODUCT_IMAGES_UPLOAD",
          entityType: "Product",
          entityId: productId,
          description: `Загружено изображений: ${rows.length}`,
          metadata: { imageIds: rows.map((row) => row.id) },
        });

        return rows;
      },
      { isolationLevel: "Serializable" },
    );

    return created;
  } catch (error) {
    await Promise.allSettled(written.map((item) => fs.unlink(item.absolutePath)));
    throw error;
  }
}

export async function updateAdminProductImage(productId, imageId, input, actor) {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
  });

  if (!image) {
    throw createCatalogError("Изображение не найдено.", 404, "PRODUCT_IMAGE_NOT_FOUND");
  }

  const updated = await prisma.$transaction(async (transaction) => {
    if (input.isPrimary === true) {
      await transaction.productImage.updateMany({
        where: { productId, id: { not: imageId } },
        data: { isPrimary: false },
      });
    }

    const row = await transaction.productImage.update({
      where: { id: imageId },
      data: {
        ...(Object.prototype.hasOwnProperty.call(input, "alt") ? { alt: input.alt || null } : {}),
        ...(input.isPrimary === true ? { isPrimary: true } : {}),
      },
    });

    await writeActivity(transaction, {
      ...actor,
      action: "PRODUCT_IMAGE_UPDATE",
      entityType: "ProductImage",
      entityId: imageId,
      description: `Обновлено изображение товара #${productId}`,
      metadata: { productId, isPrimary: row.isPrimary },
    });

    return row;
  });

  return updated;
}

export async function reorderAdminProductImages(productId, imageIds, actor) {
  const existing = await prisma.productImage.findMany({
    where: { productId },
    select: { id: true },
  });

  const existingIds = existing.map((item) => item.id).sort((a, b) => a - b);
  const requestedIds = [...imageIds].sort((a, b) => a - b);

  if (
    existingIds.length !== requestedIds.length ||
    existingIds.some((id, index) => id !== requestedIds[index])
  ) {
    throw createCatalogError(
      "Порядок изображений должен содержать все изображения товара без повторов.",
      400,
      "INVALID_PRODUCT_IMAGE_ORDER",
    );
  }

  await prisma.$transaction(async (transaction) => {
    for (let index = 0; index < imageIds.length; index += 1) {
      await transaction.productImage.update({
        where: { id: imageIds[index] },
        data: { sortOrder: index },
      });
    }

    await writeActivity(transaction, {
      ...actor,
      action: "PRODUCT_IMAGES_REORDER",
      entityType: "Product",
      entityId: productId,
      description: "Изменён порядок изображений товара",
      metadata: { imageIds },
    });
  });

  return getAdminProduct(productId);
}

function managedImageAbsolutePath(productId, url) {
  const prefix = `/uploads/products/${productId}/`;
  if (typeof url !== "string" || !url.startsWith(prefix)) return null;

  const filename = path.basename(url);
  if (!/^[0-9a-f-]{36}\.webp$/i.test(filename)) return null;

  const productRoot = path.resolve(PRODUCT_UPLOAD_ROOT, String(productId));
  const absolutePath = path.resolve(productRoot, filename);
  return absolutePath.startsWith(`${productRoot}${path.sep}`) ? absolutePath : null;
}

export async function deleteAdminProductImage(productId, imageId, actor) {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
  });

  if (!image) {
    throw createCatalogError("Изображение не найдено.", 404, "PRODUCT_IMAGE_NOT_FOUND");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.productImage.delete({ where: { id: imageId } });

    if (image.isPrimary) {
      const replacement = await transaction.productImage.findFirst({
        where: { productId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true },
      });

      if (replacement) {
        await transaction.productImage.update({
          where: { id: replacement.id },
          data: { isPrimary: true },
        });
      }
    }

    await writeActivity(transaction, {
      ...actor,
      action: "PRODUCT_IMAGE_DELETE",
      entityType: "ProductImage",
      entityId: imageId,
      description: `Удалено изображение товара #${productId}`,
      metadata: { productId, url: image.url },
    });
  });

  const absolutePath = managedImageAbsolutePath(productId, image.url);
  if (absolutePath) {
    await fs.unlink(absolutePath).catch(() => {});
  }
}
