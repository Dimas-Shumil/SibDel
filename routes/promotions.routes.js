import { Router } from "express";
import { z } from "zod";

import {
  deletePromotion,
  getPromotion,
  getPromotionOptions,
  getPromotions,
  patchPromotion,
  postPromotion,
} from "../controllers/promotions.controller.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { adminMutationRateLimiter, sensitiveRateLimiter } from "../middleware/rate-limit.js";
import { requireRoles } from "../middleware/roles.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const slugSchema = z.string().trim().min(2).max(191).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug должен содержать латиницу, цифры и дефисы.");
const descriptionSchema = z.union([z.string().trim().max(10000), z.null()]).transform((value) => value || null);
const dateSchema = z.coerce.date();
const targetIdsSchema = z.array(z.coerce.number().int().positive()).max(500).refine((ids) => new Set(ids).size === ids.length, "Список содержит повторы.");
const statusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED"]);
const typeSchema = z.enum(["PERCENT", "FIXED"]);

const promotionShape = {
  name: z.string().trim().min(2).max(180),
  slug: slugSchema,
  description: descriptionSchema.optional().default(null),
  type: typeSchema,
  discountValue: z.coerce.number().positive().max(1000000000),
  startsAt: dateSchema,
  endsAt: dateSchema,
  status: statusSchema,
  isFeatured: z.boolean(),
  productIds: targetIdsSchema.optional().default([]),
  categoryIds: targetIdsSchema.optional().default([]),
};

function validatePromotionValues(value, ctx) {
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Дата окончания должна быть позже даты начала." });
  }
  if (value.type === "PERCENT" && value.discountValue !== undefined && value.discountValue > 100) {
    ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Процент скидки не может превышать 100%." });
  }
}

const promotionBase = z.object(promotionShape).strict().superRefine(validatePromotionValues);
const promotionPatch = z.object({
  name: promotionShape.name.optional(),
  slug: promotionShape.slug.optional(),
  description: descriptionSchema.optional(),
  type: typeSchema.optional(),
  discountValue: promotionShape.discountValue.optional(),
  startsAt: dateSchema.optional(),
  endsAt: dateSchema.optional(),
  status: statusSchema.optional(),
  isFeatured: z.boolean().optional(),
  productIds: targetIdsSchema.optional(),
  categoryIds: targetIdsSchema.optional(),
}).strict().superRefine(validatePromotionValues).refine((value) => Object.keys(value).length > 0, { message: "Передайте хотя бы одно поле для изменения." });

const listQuery = z.object({
  q: z.string().trim().max(120).optional().default(""),
  status: z.enum(["all", "DRAFT", "ACTIVE", "PAUSED", "EXPIRED"]).optional().default("all"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
}).strict();

const params = z.object({ promotionId: z.coerce.number().int().positive() }).strict();

router.use(adminAuth);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); return next(); });

router.get("/", validate({ query: listQuery }), getPromotions);
router.get("/options", getPromotionOptions);
router.get("/:promotionId", validate({ params }), getPromotion);
router.post("/", adminMutationRateLimiter, validate({ body: promotionBase }), postPromotion);
router.patch("/:promotionId", adminMutationRateLimiter, validate({ params, body: promotionPatch }), patchPromotion);
router.delete("/:promotionId", sensitiveRateLimiter, requireRoles("OWNER"), validate({ params }), deletePromotion);

export default router;
