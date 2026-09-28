import { Router } from "express";
import { z } from "zod";

import { getCatalog } from "../controllers/catalog.controller.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const booleanQuery = z
  .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
  .optional()
  .transform((value) => value === "1" || value === "true");

const optionalPrice = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === "") {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  })
  .refine(
    (value) => value === undefined || (Number.isFinite(value) && value >= 0 && value <= 10000000),
    "Некорректная цена.",
  );

const catalogQuerySchema = z
  .object({
    category: z.string().trim().max(191).optional(),
    q: z.string().trim().max(120).optional().transform((value) => value || undefined),
    priceFrom: optionalPrice,
    priceTo: optionalPrice,
    available: booleanQuery,
    lowStock: booleanQuery,
    outOfStock: booleanQuery,
    discount: booleanQuery,
    new: booleanQuery,
    hit: booleanQuery,
    sort: z
      .enum(["popular", "price-asc", "price-desc", "new", "discount"])
      .default("popular"),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(24).default(12),
  })
  .strict()
  .refine(
    (data) =>
      data.priceFrom === undefined ||
      data.priceTo === undefined ||
      data.priceFrom <= data.priceTo,
    {
      path: ["priceTo"],
      message: "Максимальная цена должна быть не меньше минимальной.",
    },
  );

router.get(
  "/",
  validate({
    query: catalogQuerySchema,
  }),
  getCatalog,
);

export default router;
