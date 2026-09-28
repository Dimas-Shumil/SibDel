import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { connectDatabase, disconnectDatabase, prisma } from "../lib/prisma.js";
import {
  createAdminCategory,
  createAdminProduct,
  deleteAdminProductImage,
  deleteOrDeactivateCategory,
  getAdminProduct,
  updateAdminProduct,
  updateAdminProductImage,
  uploadAdminProductImages,
} from "../services/admin-catalog.service.js";
import { adjustInventory } from "../services/inventory.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const suffix = randomUUID().slice(0, 8);
const actor = {
  actorId: null,
  ipAddress: "127.0.0.1",
  userAgent: "admin-catalog-smoke",
};

let categoryId = null;
let productId = null;
const imageIds = [];

async function cleanup() {
  if (productId) {
    await prisma.inventoryMovement.deleteMany({ where: { productId } });
    await prisma.productImage.deleteMany({ where: { productId } });
    await prisma.adminActivity.deleteMany({
      where: {
        OR: [
          { entityType: "Product", entityId: String(productId) },
          ...imageIds.map((id) => ({ entityType: "ProductImage", entityId: String(id) })),
        ],
      },
    });
    await prisma.product.deleteMany({ where: { id: productId } });
    await fs.rm(path.resolve(__dirname, "..", "uploads", "products", String(productId)), {
      recursive: true,
      force: true,
    });
  }

  if (categoryId) {
    await prisma.adminActivity.deleteMany({
      where: { entityType: "Category", entityId: String(categoryId) },
    });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  }
}

try {
  await connectDatabase();

  const category = await createAdminCategory(
    {
      name: `CMS Smoke ${suffix}`,
      slug: `cms-smoke-${suffix}`,
      description: "Временная категория автоматического smoke-теста",
      imageUrl: null,
      isActive: true,
      sortOrder: 99999,
      isFeatured: false,
    },
    actor,
  );
  categoryId = category.id;

  const product = await createAdminProduct(
    {
      categoryId,
      name: `CMS Smoke Product ${suffix}`,
      slug: `cms-smoke-product-${suffix}`,
      sku: `CMS-SMOKE-${suffix}`.toUpperCase(),
      shortDescription: "Временный товар smoke-теста",
      description: "Автоматическая проверка Products / Categories CMS",
      unit: "PIECE",
      unitLabel: "шт.",
      highlights: ["Smoke test"],
      characteristics: { mode: "automatic" },
      nutrition: {},
      price: 1000,
      oldPrice: 1200,
      step: 1,
      minQuantity: 1,
      isActive: true,
      isAvailable: true,
      isPopular: false,
      isFeatured: false,
      isNew: false,
      sortOrder: 99999,
      seoTitle: null,
      seoDescription: null,
    },
    actor,
  );
  productId = product.id;

  await updateAdminProduct(
    productId,
    { name: `CMS Smoke Product Updated ${suffix}`, price: 950, oldPrice: 1200 },
    actor,
  );

  await adjustInventory({
    productId,
    actorId: null,
    stockQuantity: 5,
    reason: "Admin catalog smoke stock",
  });

  let loaded = await getAdminProduct(productId);
  if (!loaded || Number(loaded.stockQuantity) !== 5 || Number(loaded.reservedQuantity) !== 0) {
    throw new Error("Inventory adjustment was not reflected in product CMS data.");
  }

  const buffer = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 180, g: 140, b: 90 },
    },
  }).png().toBuffer();

  const images = await uploadAdminProductImages(
    productId,
    [{ originalname: "smoke.png", mimetype: "image/png", buffer }],
    actor,
  );
  if (images.length !== 1 || !images[0].isPrimary) {
    throw new Error("Product image upload/primary selection failed.");
  }
  imageIds.push(images[0].id);

  await updateAdminProductImage(productId, images[0].id, { alt: "Smoke image" }, actor);
  await deleteAdminProductImage(productId, images[0].id, actor);

  loaded = await getAdminProduct(productId);
  if (!loaded || loaded.images.length !== 0) {
    throw new Error("Product image deletion failed.");
  }

  const categoryDelete = await deleteOrDeactivateCategory(categoryId, actor);
  if (categoryDelete.mode !== "deactivated" || categoryDelete.category?.isActive !== false) {
    throw new Error("Linked category was not safely deactivated.");
  }

  console.log(`PASS: CMS product #${productId}, inventory, image lifecycle and safe category deactivation work.`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error(`Cleanup warning: ${cleanupError.message}`);
    process.exitCode = 1;
  }

  try {
    await disconnectDatabase();
  } catch {}
}
