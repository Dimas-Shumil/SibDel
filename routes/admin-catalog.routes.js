import { Router } from "express";
import { z } from "zod";

import {
  deleteCategory,
  deleteProductImage,
  getCategories,
  getProduct,
  getProducts,
  patchCategory,
  patchProduct,
  patchProductImage,
  postCategory,
  postProduct,
  postProductImages,
  putProductImageOrder,
} from "../controllers/admin-catalog.controller.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { productImageUpload } from "../middleware/product-upload.js";
import { adminMutationRateLimiter, sensitiveRateLimiter } from "../middleware/rate-limit.js";
import { requireRoles } from "../middleware/roles.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(191)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug должен содержать латиницу, цифры и дефисы.");

const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._/-]+$/, "SKU содержит недопустимые символы.")
  .transform((value) => value.toUpperCase());

const nullableText = (max) => z.union([z.string().trim().max(max), z.null()]).transform((value) => value || null);
const optionalNullableText = (max) =>
  z.union([z.string().trim().max(max), z.null()]).optional().transform((value) =>
    value === undefined ? undefined : value || null,
  );

const jsonPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const jsonValue = z.lazy(() => z.union([jsonPrimitive, z.array(jsonValue), z.record(z.string(), jsonValue)]));

const productBodySchema = z
  .object({
    categoryId: z.coerce.number().int().positive(),
    name: z.string().trim().min(2).max(200),
    slug: slugSchema,
    sku: skuSchema,
    shortDescription: optionalNullableText(500),
    description: z.union([z.string().trim().max(50000), z.null()]).optional().transform((value) =>
      value === undefined ? undefined : value || null,
    ),
    unit: z.enum(["PIECE", "KILOGRAM", "GRAM", "LITER", "MILLILITER", "PACKAGE"]),
    unitLabel: optionalNullableText(100),
    highlights: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
    characteristics: z.record(z.string().trim().min(1).max(120), jsonValue).optional(),
    nutrition: z.record(z.string().trim().min(1).max(120), jsonValue).optional(),
    price: z.coerce.number().positive().max(1000000000),
    oldPrice: z.union([z.coerce.number().positive().max(1000000000), z.null()]).optional(),
    step: z.coerce.number().positive().max(1000000),
    minQuantity: z.coerce.number().positive().max(1000000),
    isActive: z.boolean(),
    isAvailable: z.boolean(),
    isPopular: z.boolean(),
    isFeatured: z.boolean(),
    isNew: z.boolean(),
    sortOrder: z.coerce.number().int().min(-100000).max(100000),
    seoTitle: optionalNullableText(255),
    seoDescription: optionalNullableText(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.oldPrice !== null && value.oldPrice !== undefined && value.oldPrice <= value.price) {
      ctx.addIssue({
        code: "custom",
        path: ["oldPrice"],
        message: "Старая цена должна быть выше текущей цены.",
      });
    }
  });

const productPatchSchema = z
  .object({
    categoryId: z.coerce.number().int().positive().optional(),
    name: z.string().trim().min(2).max(200).optional(),
    slug: slugSchema.optional(),
    sku: skuSchema.optional(),
    shortDescription: optionalNullableText(500),
    description: z.union([z.string().trim().max(50000), z.null()]).optional().transform((value) =>
      value === undefined ? undefined : value || null,
    ),
    unit: z.enum(["PIECE", "KILOGRAM", "GRAM", "LITER", "MILLILITER", "PACKAGE"]).optional(),
    unitLabel: optionalNullableText(100),
    highlights: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
    characteristics: z.record(z.string().trim().min(1).max(120), jsonValue).optional(),
    nutrition: z.record(z.string().trim().min(1).max(120), jsonValue).optional(),
    price: z.coerce.number().positive().max(1000000000).optional(),
    oldPrice: z.union([z.coerce.number().positive().max(1000000000), z.null()]).optional(),
    step: z.coerce.number().positive().max(1000000).optional(),
    minQuantity: z.coerce.number().positive().max(1000000).optional(),
    isActive: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
    isPopular: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    isNew: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(-100000).max(100000).optional(),
    seoTitle: optionalNullableText(255),
    seoDescription: optionalNullableText(500),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Передайте хотя бы одно поле для изменения.",
  });

const productListQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional().default(""),
    categoryId: z.coerce.number().int().positive().optional(),
    visibility: z.enum(["all", "active", "inactive"]).optional().default("all"),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  })
  .strict();

const productParamsSchema = z.object({ productId: z.coerce.number().int().positive() }).strict();
const productImageParamsSchema = z
  .object({
    productId: z.coerce.number().int().positive(),
    imageId: z.coerce.number().int().positive(),
  })
  .strict();

const categoryBodySchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    slug: slugSchema,
    description: z.union([z.string().trim().max(10000), z.null()]).optional().transform((value) =>
      value === undefined ? undefined : value || null,
    ),
    imageUrl: optionalNullableText(500),
    isActive: z.boolean(),
    sortOrder: z.coerce.number().int().min(-100000).max(100000),
    isFeatured: z.boolean(),
  })
  .strict();

const categoryPatchSchema = categoryBodySchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: "Передайте хотя бы одно поле для изменения.",
});

const categoryListQuerySchema = z
  .object({
    includeInactive: z
      .enum(["true", "false"])
      .optional()
      .default("true")
      .transform((value) => value === "true"),
  })
  .strict();

const categoryParamsSchema = z.object({ categoryId: z.coerce.number().int().positive() }).strict();
const imagePatchSchema = z
  .object({
    alt: optionalNullableText(255),
    isPrimary: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Передайте хотя бы одно поле для изменения.",
  });

const imageOrderSchema = z
  .object({
    imageIds: z.array(z.coerce.number().int().positive()).max(12).refine((ids) => new Set(ids).size === ids.length, {
      message: "Список изображений содержит повторы.",
    }),
  })
  .strict();

router.use(adminAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  return next();
});

router.get("/products", validate({ query: productListQuerySchema }), getProducts);
router.get("/products/:productId", validate({ params: productParamsSchema }), getProduct);
router.post("/products", adminMutationRateLimiter, validate({ body: productBodySchema }), postProduct);
router.patch(
  "/products/:productId",
  adminMutationRateLimiter,
  validate({ params: productParamsSchema, body: productPatchSchema }),
  patchProduct,
);
router.post(
  "/products/:productId/images",
  adminMutationRateLimiter,
  validate({ params: productParamsSchema }),
  productImageUpload.array("images", 10),
  postProductImages,
);
router.patch(
  "/products/:productId/images/:imageId",
  adminMutationRateLimiter,
  validate({ params: productImageParamsSchema, body: imagePatchSchema }),
  patchProductImage,
);
router.put(
  "/products/:productId/images/order",
  adminMutationRateLimiter,
  validate({ params: productParamsSchema, body: imageOrderSchema }),
  putProductImageOrder,
);
router.delete(
  "/products/:productId/images/:imageId",
  adminMutationRateLimiter,
  validate({ params: productImageParamsSchema }),
  deleteProductImage,
);

router.get("/categories", validate({ query: categoryListQuerySchema }), getCategories);
router.post("/categories", adminMutationRateLimiter, validate({ body: categoryBodySchema }), postCategory);
router.patch(
  "/categories/:categoryId",
  adminMutationRateLimiter,
  validate({ params: categoryParamsSchema, body: categoryPatchSchema }),
  patchCategory,
);
router.delete(
  "/categories/:categoryId",
  requireRoles("OWNER"),
  sensitiveRateLimiter,
  validate({ params: categoryParamsSchema }),
  deleteCategory,
);

export default router;
